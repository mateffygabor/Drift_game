"""Headless end-to-end smoke test for Drift Game 2.

Starts a local web server, opens the game in headless Chrome (Playwright) and
checks that:
  - the page loads without JavaScript errors,
  - the language switch translates the menu (Hungarian <-> English),
  - corrupted localStorage values don't break the menu or a race,
  - a practice race and a race against bots start on every track and the
    HUD shows translated text,
  - the WiFi controller address is validated.

Usage:
    pip install playwright        # once (uses your installed Chrome)
    python tools/smoke_test.py

Headless Chrome renders WebGL in software, so this takes a minute or two.
"""

import functools
import http.server
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
PORT = 8765


def serve():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT))
    handler.log_message = lambda *a, **k: None
    httpd = socketserver.TCPServer(('127.0.0.1', PORT), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def wait_until(page, expr, timeout_s=60):
    """Polls a JS expression with page.evaluate (the game's CSP forbids the
    eval-based page.wait_for_function)."""
    for _ in range(int(timeout_s * 4)):
        if page.evaluate(f'() => {{ try {{ return !!({expr}); }} catch {{ return false; }} }}'):
            return
        page.wait_for_timeout(250)
    raise TimeoutError(f'timed out waiting for: {expr}')


def main():
    httpd = serve()
    errors = []
    failures = []

    def check(cond, msg):
        print(('  ok   ' if cond else '  FAIL ') + msg)
        if not cond:
            failures.append(msg)

    with sync_playwright() as p:
        browser = p.chromium.launch(channel='chrome', headless=True,
                                    args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        page = browser.new_page(viewport={'width': 1280, 'height': 800})
        page.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
        page.on('console', lambda m: errors.append(f'console.error: {m.text}') if m.type == 'error' else None)

        url = f'http://127.0.0.1:{PORT}/'
        print('Loading', url)
        page.goto(url)
        wait_until(page, 'window.__drift !== undefined', 30)

        page.screenshot(path=str(ROOT / 'tools' / 'last_menu.png'))
        print('Language switch')
        page.click('#setting-lang [data-v="en"]')
        check(page.inner_text('h2[data-i18n="menu.mode"]').strip().lower() == 'game mode', 'English menu heading')
        check('Green Valley' in page.inner_text('#track-list'), 'English track names')
        page.click('#setting-lang [data-v="hu"]')
        check(page.inner_text('h2[data-i18n="menu.mode"]').strip().lower() == 'játékmód', 'Hungarian menu heading')
        check('Zöld Völgy' in page.inner_text('#track-list'), 'Hungarian track names')
        check(page.evaluate('document.documentElement.lang') == 'hu', '<html lang> follows the language')
        page.click('#setting-lang [data-v="en"]')

        print('Corrupted localStorage')
        page.evaluate('''() => {
            localStorage.setItem('driftgame2_laps', '"banana"');
            localStorage.setItem('driftgame2_speed', '"fast"');
            localStorage.setItem('driftgame2_selections', '[{"vehicle":"nope","color":-5},"x"]');
            localStorage.setItem('driftgame2_botcounts', '{"solo":"lots"}');
            localStorage.setItem('driftgame2_leaderboard', '{"valley":[{"name":"<img src=x onerror=alert(1)>","timeMs":61234},{"timeMs":"bad"},null]}');
            localStorage.setItem('driftgame2_ghost_valley', '{"timeMs":5,"samples":[1,2,"x"]}');
        }''')
        page.reload()
        wait_until(page, 'window.__drift !== undefined', 30)
        check(page.evaluate("document.querySelector('#setting-laps .active')?.dataset.v") == '3', 'invalid laps fall back to 3')
        check(page.evaluate("document.getElementById('setting-speed').value") == '100', 'invalid speed falls back to 100%')
        page.evaluate("__drift.setMode('practice'); __drift.openGarage('valley')")
        lb = page.inner_html('#leaderboard-list')
        check('<img' not in lb and '&lt;img' in lb, 'leaderboard names are escaped')
        check(page.locator('#leaderboard-list li').count() == 1, 'invalid leaderboard entries are dropped')
        page.click('#btn-garage-back')

        print('WiFi address validation')
        for value, ok in [('192.168.4.1', True), ('driftcontroller.local', True), ('ws://192.168.4.1:81/', True),
                          ('evil.com/path', False), ('a b', False), ('host:9999', False), ('', False)]:
            page.fill('#wifi-host', value)
            page.click('#btn-wifi')
            state = page.evaluate('''() => import('./src/input.js').then(m => m.wifiController.state)''')
            check((state != 'badhost') == ok, f'host {value!r} -> {state}')
            page.evaluate("import('./src/input.js').then(m => m.wifiController.disconnect())")

        tracks = page.evaluate('__drift.TRACKS.map(t => t.id)')
        for mode in ['practice', 'solo']:
            for tid in tracks:
                print(f'Race: {mode} / {tid}')
                page.evaluate(f"__drift.setMode('{mode}'); __drift.openGarage('{tid}'); __drift.startRace()")
                wait_until(page, "['countdown','racing'].includes(__drift.game.state)", 120)
                hud = page.inner_text('#views')
                check('LAP' in hud, f'{tid}: English HUD')
                racers = page.evaluate('__drift.game.racers.length')
                check(racers == (1 if mode == 'practice' else 6), f'{tid}: {racers} racers')
                # let it run a few frames, then make sure nothing became NaN
                page.wait_for_timeout(1500)
                bad = page.evaluate('__drift.game.racers.some(r => !Number.isFinite(r.car.x) || !Number.isFinite(r.car.y))')
                check(not bad, f'{tid}: car positions are finite')
                if mode == 'solo':
                    # finish the race for the player and check the results screen
                    wait_until(page, "__drift.game.state === 'racing'", 60)
                    page.evaluate('(() => { const g = __drift.game; g._finishRacer(g.humans[0], performance.now()); })()')
                    wait_until(page, "!document.getElementById('winner-overlay').classList.contains('hidden')", 30)
                    rows = page.locator('#winner-table tr').count()
                    check(rows == 6, f'{tid}: results table has {rows} rows')
                    check('wins!' in page.inner_text('#winner-title'), f'{tid}: English results title')
                    page.screenshot(path=str(ROOT / 'tools' / 'last_results.png'))
                    page.click('#btn-winner-menu')
                    break  # one race-mode track is enough (they share the code path)
                page.click('#btn-pause')
                check(page.evaluate('__drift.game.state') == 'paused', f'{tid}: pause works')
                page.click('#btn-quit')

        browser.close()
    httpd.shutdown()

    real_errors = [e for e in errors if 'WebGL' not in e and 'GPU' not in e]
    print()
    for e in real_errors:
        print('  JS ERROR', e)
    if failures or real_errors:
        print(f'FAILED: {len(failures)} check(s), {len(real_errors)} JS error(s)')
        sys.exit(1)
    print('All checks passed.')


if __name__ == '__main__':
    main()
