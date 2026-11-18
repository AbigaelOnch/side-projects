# S-080 widths, S-081 keyboard, S-082 reduced motion, S-083 contrast spot checks, S-084 tap targets, S-088 input font size
import sys
from playwright.sync_api import sync_playwright
BASE = "http://localhost:3000"; ok = True
def check(n, c, extra=""):
    global ok; print(("PASS " if c else "FAIL ") + n + (" " + extra if extra and not c else "")); ok = ok and bool(c)
PAGES = ["/?city=oakland&tab=month", "/?pick=1", "/share", "/admin", "/?city=oakland&tab=tonight&cat=career"]
with sync_playwright() as p:
    b = p.chromium.launch()
    for w, h in [(360, 800), (768, 1024), (1440, 900)]:
        pg = b.new_context(viewport={"width": w, "height": h}).new_page()
        bad = []
        for url in PAGES + ["EVENT"]:
            if url == "EVENT":
                pg.goto(BASE + "/?city=oakland&tab=month", wait_until="networkidle"); pg.locator(".card").first.click(); pg.wait_for_selector("h1")
            else: pg.goto(BASE + url, wait_until="networkidle")
            if pg.evaluate("document.documentElement.scrollWidth > window.innerWidth + 1"): bad.append(url)
        check(f"S-080 no sideways scroll at {w}px", not bad, str(bad)); pg.close()
    pg = b.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True, reduced_motion="reduce").new_page()
    small = []
    for url in ["/?city=oakland&tab=month", "/share", "/?pick=1"]:
        pg.goto(BASE + url, wait_until="networkidle")
        small += pg.evaluate("""() => [...document.querySelectorAll('a.btn,button,a.tab,a.loc,a.fab,a.back,.cities a,a.card,a.pick-card')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.height < 43.5) && !e.closest('.sr-only'); }).map(e => (e.innerText||e.getAttribute('aria-label')||e.className).slice(0,30) + ' ' + Math.round(e.getBoundingClientRect().height))""")
    check("S-084 tap targets are at least 44px tall", not small, str(small[:6]))
    pg.goto(BASE + "/share", wait_until="networkidle")
    fs = pg.evaluate("parseFloat(getComputedStyle(document.querySelector('#link')).fontSize)")
    check("S-088 text fields use 16px+ (no iPhone zoom)", fs >= 16, str(fs))
    pg.goto(BASE + "/?city=oakland&tab=month", wait_until="networkidle")
    anim = pg.evaluate("[...document.querySelectorAll('*')].filter(e => getComputedStyle(e).animationName !== 'none').length")
    check("S-082 no animations with reduced motion", anim == 0, str(anim))
    def lum(c):
        import re
        r, g, bl = [int(x) / 255 for x in re.findall(r"\d+", c)[:3]]
        f = lambda v: v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(bl)
    def ratio(a, b_):
        la, lb = sorted([lum(a), lum(b_)], reverse=True); return (la + 0.05) / (lb + 0.05)
    pairs = pg.evaluate("""() => { const cs = (s) => getComputedStyle(document.querySelector(s)); const bg = getComputedStyle(document.body).backgroundColor;
      return [[cs('.card .meta').color, cs('.card').backgroundColor, 'card meta'], [cs('.tab:not([aria-current])').color, bg, 'tab'], [cs('.day span').color, bg, 'date'],
              [cs('.fab').color, cs('.fab').backgroundColor, 'share button'], [cs('.tag').color, cs('.card').backgroundColor, 'tag'], [cs('footer.foot').color, bg, 'footer']]; }""")
    low = [(n, round(ratio(a, b_), 2)) for a, b_, n in pairs if ratio(a, b_) < 4.5]
    check("S-083 text contrast is at least 4.5:1", not low, str(low))
    # keyboard: tab to the first card and open it with Enter; filters sheet opens and closes with the keyboard
    pg2 = b.new_context(viewport={"width": 1280, "height": 900}).new_page()
    pg2.goto(BASE + "/?city=oakland&tab=month", wait_until="networkidle"); pg2.wait_for_timeout(500)
    for _ in range(40):
        pg2.keyboard.press("Tab")
        if pg2.evaluate("document.activeElement?.classList.contains('card')"): break
    vis = pg2.evaluate("(() => { const s = getComputedStyle(document.activeElement); return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2; })()")
    pg2.keyboard.press("Enter"); pg2.wait_for_url("**/e/*")
    check("S-081 keyboard: reach a card with visible focus and open it", vis)
    pg2.go_back(wait_until="networkidle"); pg2.wait_for_timeout(500); pg2.locator("button.filters").focus(); pg2.keyboard.press("Enter")
    opened = pg2.evaluate("document.querySelector('dialog.sheet').open"); pg2.keyboard.press("Escape")
    check("S-081 keyboard: Filters opens with Enter and closes with Escape", opened and not pg2.evaluate("document.querySelector('dialog.sheet').open"))
    b.close()
sys.exit(0 if ok else 1)
