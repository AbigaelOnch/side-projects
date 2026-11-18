# Share an event on a phone-sized screen, then approve it as admin. S-024/S-052 fallback, S-028, S-040, S-046, S-047, S-062, S-095, S-090
import sys, datetime, json
from playwright.sync_api import sync_playwright
BASE = "http://localhost:3000"; OUT = "/home/claude/shots/afro"
PASS = sys.argv[1] if len(sys.argv) > 1 else "local-test-passcode"
ok = True
def check(name, cond):
    global ok
    print(("PASS " if cond else "FAIL ") + name); ok = ok and bool(cond)
day = (datetime.date.today() + datetime.timedelta(days=4)).isoformat()
title = "E2E Rooftop Mixer " + datetime.datetime.now().strftime("%H%M%S")

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    # visitor: no sign-up anywhere
    pg.goto(BASE + "/city/oakland", wait_until="networkidle")
    check("S-047 no sign-in prompt for visitors", pg.locator("input[type=password]").count() == 0 and "Sign in" not in pg.content())
    check("S-046 admin API refuses visitors", pg.evaluate("fetch('/api/admin/events/1',{method:'POST',headers:{'content-type':'application/json'},body:'{\"action\":\"approve\"}'}).then(r=>r.status)") == 401)
    pg.click("a.fab"); pg.wait_for_url("**/share")
    pg.fill("#link", "http://192.168.0.1/party"); pg.click("text=Find the event")
    pg.wait_for_selector(".warn")
    check("S-062 private link refused with a message", "private" in pg.locator(".warn").inner_text().lower())
    pg.screenshot(path=f"{OUT}/m_share_problem.png")
    pg.click("text=Fill it in myself")
    pg.click("text=Looks good — submit")
    check("missing details are highlighted, nothing sent", pg.locator(".bad").count() >= 3)
    pg.get_by_label("Event name").fill(title)
    pg.fill("input[type=date]", day); pg.fill("input[type=time] >> nth=0", "19:00")
    pg.get_by_label("Venue").fill("Skyline Terrace"); pg.get_by_label("Address or city").fill("410 14th St, Oakland")
    pg.click("fieldset >> text=Networking"); pg.click("button.chip:has-text('Good to go solo')"); pg.click("button.chip:has-text('Free')")
    box = pg.locator("button:has-text('Looks good')").bounding_box()
    check("S-084 submit button is thumb-sized", box["height"] >= 44)
    pg.screenshot(path=f"{OUT}/m_share_form.png")
    pg.click("text=Looks good — submit")
    pg.wait_for_selector("text=Thanks, it's in!")
    pg.screenshot(path=f"{OUT}/m_share_done.png")
    pg.goto(BASE + "/?city=oakland&tab=month", wait_until="networkidle")
    check("S-040 not public before approval", title not in pg.content())
    # admin
    pg.goto(BASE + "/admin", wait_until="networkidle")
    check("S-046 admin page asks for the passcode", pg.locator("input[type=password]").count() == 1 and title not in pg.content())
    pg.fill("input[type=password]", "wrong-one"); pg.click("text=Sign in"); pg.wait_for_selector(".warn")
    check("wrong passcode is refused", "isn't right" in pg.locator(".warn").inner_text())
    pg.fill("input[type=password]", PASS); pg.click("text=Sign in")
    pg.wait_for_selector("text=Waiting for review")
    pg.wait_for_load_state("networkidle"); pg.wait_for_timeout(1500)
    card = pg.locator(".qcard", has_text=title)
    check("submission is in the queue with the submitter's details", card.count() == 1 and "Skyline Terrace" in card.inner_text())
    pg.screenshot(path=f"{OUT}/m_admin.png")
    card.get_by_role("button", name="Edit", exact=True).click(); pg.wait_for_selector(".qedit")
    pg.locator(".qedit input").first.fill(title + " (edited)")
    pg.get_by_role("button", name="Save and approve").click()
    card.wait_for(state="detached", timeout=20000)
    pg.goto(BASE + "/?city=oakland&tab=month", wait_until="networkidle")
    for _ in range(6):
        if title in pg.content(): break
        pg.mouse.wheel(0, 6000); pg.wait_for_timeout(700)
    check("S-040/S-041 approved event is public with the admin's edit", (title + " (edited)") in pg.content())
    pg.locator(".card", has_text=title).first.click(); pg.wait_for_selector("h1")
    check("event page shows it with Good to go solo", "Good to go solo" in pg.content() and "Skyline Terrace" in pg.content())
    pg.wait_for_load_state("networkidle"); pg.wait_for_timeout(1500)
    pg.click("text=Report this event"); pg.fill("textarea", "Test report"); pg.click("text=Send report")
    pg.wait_for_selector("text=We'll take a look")
    pg.goto(BASE + "/admin", wait_until="networkidle")
    pg.wait_for_timeout(1500)
    rep = pg.locator(".qcard", has_text="Test report")
    check("S-095 report reaches the admin", rep.count() == 1)
    rep.locator("text=Remove event").click(); pg.wait_for_selector("text=No open reports.", timeout=20000)
    pg.goto(BASE + "/?city=oakland&tab=month", wait_until="networkidle")
    check("removed event is no longer public", title not in pg.content())
    check("no page errors", not errs)
    ctx.close(); b.close()
sys.exit(0 if ok else 1)
