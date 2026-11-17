"""Browser UI tests without a listening server. Routes serve only local project files.
Run: python tests/browser_smoke.py (requires Playwright + Chromium).
"""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'test-results'
OUT.mkdir(exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--no-sandbox'])
    context = browser.new_context(viewport={'width':1280,'height':950}, device_scale_factor=1)
    def route(r):
        name = r.request.url.split('cyber-sushi.test/',1)[-1].split('?')[0]
        file = ROOT / 'frontend' / name
        types = {'.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json'}
        if file.is_file() and file.parent == ROOT / 'frontend':
            r.fulfill(body=file.read_bytes(), content_type=types.get(file.suffix,'application/octet-stream'))
        else:
            r.fulfill(status=404, body='not found')
    context.route('https://cyber-sushi.test/**', route)
    page=context.new_page()
    errors=[]
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto('https://cyber-sushi.test/index.html')
    page.wait_for_selector('#newGame')
    page.screenshot(path=str(OUT/'01-menu.png'), full_page=True)
    page.click('#login')
    assert '로컬 데모 모드' in page.locator('#modalContent').inner_text()
    page.click('#closeModal')
    page.click('#newGame')
    page.wait_for_selector('#begin')
    assert page.evaluate('S.day') == 1
    assert page.evaluate('S.queue.length') == 6
    assert page.evaluate('S.tutorial') is True
    # Real UI ingredient selection + stage interaction, no direct finished dish injection.
    order=page.evaluate('E.menu(S,S.queue[S.index].menu).ingredients')
    for k,v in order.items():
        for _ in range(v): page.click('[data-ing="'+k+'"]')
    before=page.evaluate('S.inventory.rice')
    page.click('#begin')
    assert page.evaluate('S.inventory.rice') == before-1
    page.click('#miniAction')
    page.click('#miniAction')
    page.click('#miniAction')
    assert page.evaluate('S.cooking.stage') == 'rice'
    # Hold control until stage completes.
    page.locator('#miniAction').dispatch_event('pointerdown', {'pointerId':1, 'pointerType':'mouse'})
    page.wait_for_timeout(6500)
    page.locator('#miniAction').dispatch_event('pointerup', {'pointerId':1, 'pointerType':'mouse'})
    page.wait_for_function('S.cooking && S.cooking.stage === "plate"')
    page.click('#miniAction')
    assert page.evaluate('S.dish !== null')
    page.screenshot(path=str(OUT/'02-service.png'), full_page=True)
    page.click('#serve')
    assert page.evaluate('S.ledger.satisfied') == 1
    assert page.evaluate('S.complaints') == 0
    page.click('#shop')
    page.fill('input[name="rice"]','3')
    page.locator('#shopForm button[type=submit]').click()
    assert page.evaluate('S.deliveries.length') == 1
    saved_queue=page.evaluate('JSON.stringify(S.queue)')
    saved_inventory=page.evaluate('S.inventory.rice')
    page.reload()
    page.wait_for_selector('#continue')
    page.click('#continue')
    page.wait_for_selector('#begin')
    assert page.evaluate('JSON.stringify(S.queue)') == saved_queue
    assert page.evaluate('S.inventory.rice') == saved_inventory
    assert page.evaluate('S.index') == 1
    # Another tab cannot write the demo while first tab holds Web Lock.
    other=context.new_page()
    other.goto('https://cyber-sushi.test/index.html')
    other.wait_for_selector('#continue')
    other.click('#continue')
    other.wait_for_timeout(150)
    assert '다른 탭' in other.locator('#toast').inner_text()
    other.close()
    # Multiple customer timeouts -> persisted gameover.
    page.evaluate('S.tutorial=false; for(let i=0;i<5;i++) E.tick(S,90.01); checkpoint();render();')
    assert page.evaluate('S.phase') == 'gameover'
    page.wait_for_selector('#restart')
    page.click('#backMenu');page.click('#continue')
    page.wait_for_selector('#restart')
    assert page.evaluate('S.phase') == 'gameover'
    page.click('#restart')
    page.wait_for_selector('#confirmNew')
    page.click('#confirmNew')
    page.wait_for_selector('#begin')
    # Finish a day through engine to exercise the summary/preparation UI.
    page.evaluate('''S.tutorial=false; while(S.phase==='service'){
      const r=E.menu(S,S.queue[S.index].menu); S.dish={menu:r.id,quality:80,mix:r.ingredients};E.serve(S,crypto.randomUUID());
    }checkpoint();render();''')
    page.wait_for_selector('#prepare')
    page.click('#shop');page.fill('input[name="egg"]','2');page.locator('#shopForm button[type=submit]').click()
    assert page.evaluate('S.pendingPurchases') == 6
    page.click('#prepare')
    assert page.evaluate('S.day') == 2
    assert page.evaluate('S.ledger.purchases') == 6
    assert page.evaluate('S.phase') == 'prep'
    page.click('#openShop')
    assert page.evaluate('S.queue.length') == 7
    # Small-screen control remains reachable without horizontal page overflow.
    page.set_viewport_size({'width':390,'height':844})
    page.screenshot(path=str(OUT/'03-mobile.png'), full_page=True)
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth+1')
    assert not errors, errors
    report={'browser':'Chromium','result':'PASS','page_errors':errors,
      'checked':['menu','demo notice','new game','real ingredient clicks','cut/rice/plating','serve',
                 'purchase','refresh restore','queue stability','multi-tab lock','gameover persistence',
                 'overwrite confirmation','summary','next-day purchases','prep start','390px layout']}
    (OUT/'browser-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False,indent=2))
    browser.close()
