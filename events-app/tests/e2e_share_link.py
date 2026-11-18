# S-110, S-111: sharing an event with friends
import sys, re
from playwright.sync_api import sync_playwright
BASE = "http://localhost:3000"; ok = True
def check(n, c):
    global ok; print(("PASS " if c else "FAIL ") + n); ok = ok and bool(c)
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 390, "height": 844}, permissions=["clipboard-read", "clipboard-write"])
    pg = ctx.new_page()
    pg.goto(BASE + "/city/oakland", wait_until="networkidle")
    pg.locator(".pick-card").first.click(); pg.wait_for_selector("h1"); pg.wait_for_load_state("networkidle"); pg.wait_for_timeout(1500)
    html = pg.content()
    check("S-111 preview title, description and flyer are in the page", 'property="og:title"' in html and 'property="og:description"' in html and re.search(r'property="og:image" content="http[^"]+/flyers/', html))
    pg.click("button:has-text('Share')"); pg.wait_for_selector("text=Link copied")
    check("S-110 copies the event link", re.fullmatch(BASE + r"/e/\d+", pg.evaluate("navigator.clipboard.readText()")))
    # with a share sheet available, it's used instead
    pg.evaluate("navigator.share = (d) => { window.__shared = d; return Promise.resolve(); }")
    pg.wait_for_timeout(2600); pg.click("button:has-text('Share')")
    d = pg.evaluate("window.__shared")
    check("S-110 uses the phone's share sheet when there is one", d and d["url"].startswith(BASE + "/e/") and d["title"])
    pg.screenshot(path="/home/claude/shots/afro/m_event_share.png")
    b.close()
sys.exit(0 if ok else 1)
