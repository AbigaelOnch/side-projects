import sys
from playwright.sync_api import sync_playwright
BASE = "http://localhost:3000"
OUT = sys.argv[1] if len(sys.argv) > 1 else "/home/claude/shots/afro"
pages = [("home", "/?city=oakland"), ("home_month", "/?city=oakland&tab=month"), ("pick", "/?pick=1"),
         ("dating", "/?city=oakland&dating=1&cat=dating&tab=month"), ("share", "/share"), ("empty", "/?city=oakland&tab=tonight&cat=wellness")]
with sync_playwright() as p:
    b = p.chromium.launch()
    for w, h, tag in [(390, 844, "m"), (1440, 900, "d")]:
        ctx = b.new_context(viewport={"width": w, "height": h})
        pg = ctx.new_page()
        errs = []
        pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: errs.append(str(e)))
        for name, url in pages:
            pg.goto(BASE + url, wait_until="networkidle")
            pg.screenshot(path=f"{OUT}/{tag}_{name}.png")
        pg.goto(BASE + "/?city=oakland", wait_until="networkidle")
        pg.click(".card >> nth=0")
        pg.wait_for_load_state("networkidle")
        pg.screenshot(path=f"{OUT}/{tag}_event.png", full_page=True)
        sw = pg.evaluate("document.documentElement.scrollWidth")
        print(tag, "errors:", errs, "scrollWidth:", sw)
        ctx.close()
    b.close()
