# Duplicates in the browser (S-030/S-031), singles filters (S-090/S-093), share target (S-086), manifest (S-085)
import sys, datetime, json, urllib.request
from playwright.sync_api import sync_playwright
BASE = "http://localhost:3000"; ok = True
def check(n, c):
    global ok; print(("PASS " if c else "FAIL ") + n); ok = ok and bool(c)
day = (datetime.date.today() + datetime.timedelta(days=6)).isoformat()
stamp = datetime.datetime.now().strftime("%H%M%S")
title = f"E2E Jollof Cookoff {stamp}"
def fill(pg, t, time):
    pg.goto(BASE + "/share", wait_until="networkidle"); pg.wait_for_timeout(1200)
    pg.fill("#link", "http://10.0.0.1/x"); pg.click("text=Find the event"); pg.wait_for_selector(".warn"); pg.click("text=Fill it in myself")
    pg.get_by_label("Event name").fill(t); pg.fill("input[type=date]", day); pg.fill("input[type=time] >> nth=0", time)
    pg.get_by_label("Venue").fill("Kola Kitchen"); pg.get_by_label("Address or city").fill("88 Grand Ave, Oakland")
    pg.click("fieldset >> text=Social & culture"); pg.click("button.chip:has-text('Good to go solo')")
    pg.click("text=Looks good — submit")
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={"width": 390, "height": 844}); pg = ctx.new_page()
    m = json.load(urllib.request.urlopen(BASE + "/manifest.webmanifest"))
    check("S-085 manifest: standalone, icons, name", m["display"] == "standalone" and len(m["icons"]) >= 2 and m["name"])
    check("S-086 manifest has a share target pointing at /share", m["share_target"]["action"] == "/share")
    pg.goto(BASE + "/share?text=" + "Look%20at%20this%20http%3A%2F%2F192.168.1.5%2Fparty", wait_until="networkidle")
    pg.wait_for_selector(".warn", timeout=20000)
    check("S-086 a shared link lands in the share screen and is read straight away", pg.input_value("#link").startswith("Look at this http://192.168.1.5"))
    fill(pg, title, "18:00"); pg.wait_for_selector("text=Thanks, it's in!")
    fill(pg, title + " Night", "18:30"); pg.wait_for_selector("text=Already listed")
    check("S-031 the same event shared again says Already listed", "being checked" in pg.content())
    # filters
    pg.goto(BASE + "/city/oakland", wait_until="networkidle"); pg.wait_for_timeout(1200)
    check("S-090 no dating events by default", "Speed Dating" not in pg.content())
    pg.click("button.filters"); pg.click("dialog >> text=Good to go solo"); pg.click("dialog >> text=Show events"); pg.wait_for_url("**solo=1**"); pg.wait_for_load_state("networkidle")
    tags = pg.locator(".card").evaluate_all("els => els.map(e => e.innerText.includes('Good to go solo'))")
    check("S-093 Go-solo filter shows only go-solo events", len(tags) > 0 and all(tags))
    pg.click("button.filters"); pg.locator("dialog >> text=Show dating events").click(); pg.click("dialog >> text=Show events"); pg.wait_for_url("**dating=1**"); pg.wait_for_load_state("networkidle"); pg.wait_for_timeout(800)
    pg.click("button.filters")
    check("S-092 dating filters appear once dating is on", pg.locator("dialog >> text=Speed dating").count() == 1)
    pg.screenshot(path="/home/claude/shots/afro/m_filters2.png")
    b.close()
sys.exit(0 if ok else 1)
