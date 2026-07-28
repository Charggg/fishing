/* Real-browser smoke: genuine clicks and keystrokes, every quality preset,
   save/reload, resize. Catches GL and DOM faults the sim harness cannot.
   Usage: node game/qa/render-smoke.js                                       */
const pw = require('./pw');
const path = require('path');
const GAME = 'file://' + path.resolve(__dirname, '..', 'index.html');

(async () => {
  const browser = await pw.launch(['--autoplay-policy=no-user-gesture-required']);
  const page = await browser.newPage({ viewport: { width: 1100, height: 640 } });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });

  await page.goto(GAME);
  await page.waitForFunction(() => window.DEEPCAST && window.DEEPCAST.started, { timeout: 180000 });
  const log = [];

  await page.click('#btn-play');
  await page.waitForTimeout(1200);
  log.push('audio ' + await page.evaluate(() => window.DEEPCAST.audio.ctx ? window.DEEPCAST.audio.ctx.state : 'none'));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  for (const k of ['Tab', 'Tab', 'b', 'b', 'h', 'h', 'p', 'p', 'e', 'q', 'q', 'e']) {
    await page.keyboard.press(k);
    await page.waitForTimeout(220);
  }
  log.push('panels closed: ' + (await page.evaluate(() => window.DEEPCAST.ui.openPanel) === null));

  for (const q of ['low', 'medium', 'ultra', 'high']) {
    await page.evaluate(qq => window.DEEPCAST.setQuality(qq), q);
    await page.waitForTimeout(1300);
    log.push('quality ' + q + ' glError ' + await page.evaluate(() => window.DEEPCAST.renderer.gl.getError()));
  }

  // Board and row for real, with the renderer live.
  await page.evaluate(() => {
    const g = window.DEEPCAST;
    const sp = g.world.spawn(g.dock);
    g.player.x = sp.x; g.player.z = sp.z; g.player.yaw = sp.yaw;
  });
  await page.keyboard.press('e');
  await page.waitForTimeout(400);
  log.push('aboard ' + await page.evaluate(() => window.DEEPCAST.boat.aboard));
  await page.keyboard.press('q');
  await page.keyboard.down('w');
  await page.waitForTimeout(2500);
  await page.keyboard.up('w');
  log.push('rowed, glError ' + await page.evaluate(() => window.DEEPCAST.renderer.gl.getError()));
  await page.keyboard.press('e');
  await page.waitForTimeout(400);

  await page.evaluate(() => window.DEEPCAST.save());
  await page.reload();
  await page.waitForFunction(() => window.DEEPCAST && window.DEEPCAST.started, { timeout: 180000 });
  log.push('reload ok, boat restored at ' + await page.evaluate(() =>
    window.DEEPCAST.boat.x.toFixed(1) + ',' + window.DEEPCAST.boat.z.toFixed(1)));

  await page.setViewportSize({ width: 760, height: 980 });
  await page.waitForTimeout(1500);
  log.push('resize glError ' + await page.evaluate(() => window.DEEPCAST.renderer.gl.getError()));

  console.log(log.join('\n'));
  console.log('errors: ' + (errs.length ? errs.join('\n') : 'none'));
  await browser.close();
  process.exit(errs.length ? 1 : 0);
})();
