# Near me in a real browser (phone size): S-004, S-005, S-006, S-007, S-009
import sys
from playwright.sync_api import sync_playwright
BASE = "http://localhost:3000"
OUT = "/home/claude/shots/afro"
ok = True
def check(name, cond):
    global ok
    print(("PASS " if cond else "FAIL ") + name); ok = ok and cond

with sync_playwright() as p:
    b = p.chromium.launch()
    phone = dict(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, device_scale_factor=2)
    # Allowed
    ctx = b.new_context(**phone, geolocation={"latitude": 37.80441, "longitude": -122.27118})
    pg = ctx.new_page()
    asked = []
    pg.add_init_script("const g=navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);navigator.geolocation.getCurrentPosition=(...a)=>{window.__asked=(window.__asked||0)+1;return g(...a)}")
    pg.goto(BASE + "/?pick=1", wait_until="networkidle")
    check("S-004 no location request on page load", pg.evaluate("window.__asked||0") == 0)
    pg.screenshot(path=f"{OUT}/m_near_pick.png")
    ctx.grant_permissions(["geolocation"])
    pg.click("text=Show events near me")
    pg.wait_for_url("**/?*near=*", timeout=15000)
    pg.wait_for_load_state("networkidle")
    url = pg.url
    check("S-009 only ~1 km coordinates in the URL", "near=37.8%2C-122.27" in url or "near=37.8,-122.27" in url)
    check("S-005 radius 25 by default", "r=25" in url)
    dist = pg.locator(".meta").first.inner_text()
    check("S-005 cards show distance", " mi" in dist)
    pg.screenshot(path=f"{OUT}/m_near_feed.png")
    n25 = pg.locator(".card").count()
    pg.click(".chips.radius >> text=5 mi")
    pg.wait_for_load_state("networkidle")
    check("S-005 radius change updates URL", "r=5" in pg.url)
    n5 = pg.locator(".card").count()
    check("S-005 smaller radius, fewer or equal events", n5 <= n25)
    # S-007 come back: remembered, no prompt (permission granted)
    pg.goto(BASE + "/", wait_until="networkidle")
    pg.wait_for_url("**/?*near=*", timeout=15000)
    check("S-007 returning visitor goes straight to near me", "near=" in pg.url)
    # Picking a city turns near me off
    pg.goto(BASE + "/city/oakland", wait_until="networkidle")
    pg.goto(BASE + "/", wait_until="networkidle")
    check("picking a city turns near me off", "city=" in pg.url or "near=" not in pg.url)
    ctx.close()
    # Denied
    ctx = b.new_context(**phone)
    pg = ctx.new_page()
    pg.add_init_script("navigator.geolocation.getCurrentPosition=(ok,err)=>setTimeout(()=>err({code:1,message:'denied'}),50)")
    pg.goto(BASE + "/?pick=1", wait_until="networkidle")
    pg.click("text=Show events near me")
    pg.wait_for_selector("text=No problem, pick a city instead")
    check("S-006 denied shows friendly fallback", pg.locator(".cities a").count() >= 1)
    errs = []
    pg.screenshot(path=f"{OUT}/m_near_denied.png")
    ctx.close()
    b.close()
sys.exit(0 if ok else 1)
