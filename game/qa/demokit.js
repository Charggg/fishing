/* Proves index.html?demo grants the kit exactly once and that a normal boot
   is untouched by it. This is what the shipped download tells players to use,
   so it needs to actually work.
   Usage: node game/qa/demokit.js                                             */
const pw = require('./pw');
const path = require('path');

const GAME = 'file://' + path.resolve(__dirname, '..', 'index.html');
let bad = 0;
const fail = m => { bad++; console.log('  FAIL ' + m); };

async function boot(page, query) {
  await page.goto(GAME + (query || ''));
  await page.waitForFunction(() => window.DEEPCAST && window.DEEPCAST.started, { timeout: 180000 });
  return page.evaluate(() => {
    const st = window.DEEPCAST.state;
    return {
      money: st.money, rods: st.rods.length, lures: st.lures.length,
      gear: (st.gear || []).slice(), demoKit: !!st.demoKit, rod: st.rod
    };
  });
}

(async () => {
  const browser = await pw.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));

  // A plain boot must look like a fresh save, not a demo one.
  await page.goto(GAME);
  await page.evaluate(() => localStorage.clear());
  const plain = await boot(page);
  console.log('plain   ' + JSON.stringify(plain));
  if (plain.money !== 150) fail('plain boot money is ' + plain.money + ', expected 150');
  if (plain.gear.length) fail('plain boot already has gear');
  if (plain.demoKit) fail('plain boot flagged as a demo save');

  // ?demo grants the kit.
  await page.evaluate(() => localStorage.clear());
  const demo = await boot(page, '?demo');
  console.log('demo    ' + JSON.stringify(demo));
  if (demo.money < 30000) fail('demo money is ' + demo.money);
  if (demo.gear.indexOf('sonar') < 0) fail('demo kit has no sounder');
  if (demo.lures < 7) fail('demo kit is missing lures (' + demo.lures + ')');
  if (demo.rods < 5) fail('demo kit is missing rods (' + demo.rods + ')');
  if (!demo.demoKit) fail('demo flag not recorded');

  /* Spending then reloading with ?demo must NOT top you back up — otherwise
     the flag is decorative and the economy is uncapped. */
  await page.evaluate(() => { window.DEEPCAST.state.money = 42; window.DEEPCAST.save(); });
  const again = await boot(page, '?demo');
  console.log('reboot  ' + JSON.stringify(again));
  if (again.money !== 42) fail('reloading ?demo re-granted money: ' + again.money);

  // A demo save must survive a plain reload with its gear intact.
  const plainAfter = await boot(page);
  if (plainAfter.gear.indexOf('sonar') < 0) fail('sounder lost on a plain reload');

  await page.evaluate(() => localStorage.clear());
  if (errs.length) { console.log('page errors:\n' + errs.join('\n')); bad += errs.length; }
  console.log(bad ? '\nDEMO KIT: ' + bad + ' problem(s)' : '\nDEMO KIT: ok');
  await browser.close();
  process.exit(bad ? 1 : 0);
})();
