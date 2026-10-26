// Codes de triche de l’arcade dans le navigateur : clavier n’importe où sur la page, glissements au doigt.
const { openPage, chromium, check, finish } = require('./lib/harness.cjs');
(async () => { const b = await chromium.launch();
  // 1) Clavier, sans cliquer la borne (focus sur la page)
  let p = await openPage(b, { page: 'jeux', hash: '#arcade-raclette', width: 1000, height: 900, init: 'fake-jeux.js' });
  await p.waitForSelector('#arc-canvas', { timeout: 8000 });
  await p.evaluate(() => document.body.focus());
  for (const k of ['d', 'o', 'm', 'u']) await p.keyboard.press(k);
  for (const k of ['ArrowRight', 'ArrowRight', 'ArrowLeft', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'ArrowDown', 'ArrowUp']) await p.keyboard.press(k);
  const t1 = await p.evaluate(async () => { const m = await import('/assets/js/eggs/arcade.js'); return { ...m.triche }; });
  check(t1.coeurs && t1.immortel, 'clavier, sans cliquer la borne : « domu » et → → ← ← ↓ ↑ ↓ ↑ activent les deux codes');
  await p.ctx.close();
  // 2) Doigt : glissements → → ← ← ↓ ↑ ↓ ↑
  p = await openPage(b, { page: 'jeux', hash: '#arcade-domu', width: 390, height: 844, mobile: true, init: 'fake-jeux.js' });
  await p.waitForSelector('#arc-canvas', { timeout: 8000 });
  const box = await p.locator('#arc-canvas').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const sw = async (dx, dy) => p.evaluate(([cx, cy, dx, dy]) => {
    const c = document.getElementById('arc-canvas');
    const o = (x, y) => ({ bubbles: true, pointerType: 'touch', pointerId: 7, clientX: x, clientY: y });
    c.dispatchEvent(new PointerEvent('pointerdown', o(cx, cy)));
    c.dispatchEvent(new PointerEvent('pointermove', o(cx + dx, cy + dy)));
    c.dispatchEvent(new PointerEvent('pointerup', o(cx + dx, cy + dy)));
  }, [cx, cy, dx, dy]);
  for (const [dx, dy] of [[80, 0], [80, 0], [-80, 0], [-80, 0], [0, 80], [0, -80], [0, 80], [0, -80]]) { await sw(dx, dy); await p.waitForTimeout(80); }
  const t2 = await p.evaluate(async () => { const m = await import('/assets/js/eggs/arcade.js'); return { ...m.triche }; });
  check(t2.immortel && !t2.coeurs && p.errs.length === 0, 'doigt : glissements → → ← ← ↓ ↑ ↓ ↑ = immortel, sans erreur JS');
  await p.ctx.close(); await b.close(); finish(); })();
