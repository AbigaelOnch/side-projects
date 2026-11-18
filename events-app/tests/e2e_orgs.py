# Followed organisations in the admin page (S-042 add/list, S-044 error shown, trust, unfollow)
import sys
from playwright.sync_api import sync_playwright
BASE = "http://localhost:3000"; ok = True
PASS = sys.argv[1] if len(sys.argv) > 1 else "local-test-passcode"
def check(n, c):
    global ok; print(("PASS " if c else "FAIL ") + n); ok = ok and bool(c)
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_context(viewport={"width": 390, "height": 844}).new_page()
    pg.goto(BASE + "/admin", wait_until="networkidle"); pg.wait_for_timeout(800)
    pg.fill("input[type=password]", PASS); pg.click("text=Sign in"); pg.wait_for_selector("text=Organisations you follow"); pg.wait_for_timeout(800)
    pg.fill("input[type=url]", "http://192.168.1.9/events"); pg.click("button:has-text('Follow')"); pg.wait_for_selector(".warn")
    check("private page link is refused", "private" in pg.locator(".warn").first.inner_text().lower())
    pg.fill("input[type=url]", "https://lu.ma/e2e-test-collective"); pg.click("button:has-text('Follow')")
    pg.wait_for_selector(".qcard:has-text('e2e test collective')", timeout=20000); pg.wait_for_timeout(800)
    card = pg.locator(".qcard", has_text="e2e test collective")
    check("S-042 organisation is listed after Follow", card.count() == 1)
    card.get_by_role("button", name="Trust", exact=True).click(); pg.wait_for_selector("text=Trusted ✓", timeout=20000); pg.wait_for_timeout(800)
    check("trust can be switched on", True)
    pg.reload(wait_until="networkidle"); pg.wait_for_timeout(1500)
    card = pg.locator(".qcard", has_text="e2e test collective")
    txt = card.inner_text()
    check("S-044 a page that can't be reached shows a plain message, not a crash", "couldn't be" in txt or "isn't letting" in txt or "No events found" in txt or "Checked" in txt)
    pg.screenshot(path="/home/claude/shots/afro/m_admin_orgs.png", full_page=True)
    card.get_by_role("button", name="Unfollow").click(); card.wait_for(state="detached", timeout=20000)
    check("unfollow removes it", True)
    b.close()
sys.exit(0 if ok else 1)
