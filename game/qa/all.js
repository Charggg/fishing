/* Run the whole QA suite and print a scorecard.
   Usage: node game/qa/all.js [--quick]

   --quick trims the harness to one session and skips the screenshot pass.
   Exit code is non-zero if any gate failed, so this can gate a commit.

   Everything here boots a real Chromium with software GL, so the full run
   takes several minutes. That is the price of testing a renderer without a
   GPU; any FPS number these produce is meaningless.                          */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const QUICK = process.argv.indexOf('--quick') >= 0;

/* gate: a real pass/fail. tuning: informational, never fails the run. */
const SUITE = [
  { name: 'harness', kind: 'gate', args: ['harness.js', QUICK ? '1' : '2'],
    what: 'simulated frames + invariant assertions' },
  { name: 'viewmodel', kind: 'gate', args: ['viewmodel.js', '--probe'],
    what: 'first-person rod/hand geometry' },
  { name: 'render-smoke', kind: 'gate', args: ['render-smoke.js'],
    what: 'real boot, clicks, quality presets, save/reload, resize' },
  { name: 'demokit', kind: 'gate', args: ['demokit.js'],
    what: 'index.html?demo grants the kit once and only once' },
  { name: 'questplay', kind: 'gate', args: ['questplay.js'],
    what: 'a scripted angler gets >=10 of 12 commissions unaided' },
  { name: 'spotbias', kind: 'tuning', args: ['spotbias.js', '10'],
    what: 'which species each spot actually yields' },
  { name: 'shots', kind: 'gate', args: ['shots.js'], skip: QUICK,
    what: 'screenshots render without page errors' },
  // Only runs where the Electron shell has had `npm install` in desktop/.
  { name: 'desktop', kind: 'gate', args: ['desktop.js'],
    what: 'Electron shell boots, bridge is safe, saves reach disk',
    needs: path.join(__dirname, '..', '..', 'desktop', 'node_modules', 'electron') }
];

function run(step) {
  return new Promise(res => {
    const t0 = Date.now();
    const useXvfb = step.name === 'desktop' && process.platform === 'linux';
    const cmd = useXvfb ? 'xvfb-run' : process.execPath;
    const argv = useXvfb
      ? ['-a', process.execPath, path.join(__dirname, step.args[0])].concat(step.args.slice(1))
      : [path.join(__dirname, step.args[0])].concat(step.args.slice(1));
    const p = spawn(cmd, argv, { cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { out += d; });
    p.on('close', code => res({ code, out, secs: (Date.now() - t0) / 1000 }));
  });
}

(async () => {
  const results = [];
  for (const step of SUITE) {
    if (step.skip) { results.push({ step, skipped: true }); continue; }
    if (step.needs && !fs.existsSync(step.needs)) {
      results.push({ step, skipped: true, why: 'desktop/node_modules missing — run `npm install` in desktop/' });
      continue;
    }
    process.stdout.write('· ' + step.name + ' … ');
    const r = await run(step);
    const ok = r.code === 0;
    process.stdout.write((ok ? 'ok' : 'FAIL') + ' (' + r.secs.toFixed(0) + 's)\n');
    results.push({ step, ok, out: r.out, secs: r.secs });
  }

  console.log('\n' + '='.repeat(66) + '\nSCORECARD\n' + '='.repeat(66));
  let failed = 0;
  for (const r of results) {
    if (r.skipped) { console.log('  --   ' + pad(r.step.name) + 'skipped' + (r.why ? '  (' + r.why + ')' : '')); continue; }
    const gate = r.step.kind === 'gate';
    if (gate && !r.ok) failed++;
    const mark = r.ok ? ' ok  ' : (gate ? 'FAIL ' : 'note ');
    console.log('  ' + mark + ' ' + pad(r.step.name) + r.step.what);
  }

  // Pull the interesting lines out of each log rather than dumping all of it.
  for (const r of results) {
    if (r.skipped) continue;
    const keep = r.out.split('\n').filter(l =>
      /✗|FAIL|Error|error(s)?:(?! none)|not finite|✓|all invariants|COMPLETE|VIEWMODEL/.test(l));
    if (!keep.length) continue;
    console.log('\n--- ' + r.step.name + ' ---');
    console.log(keep.slice(0, r.ok ? 6 : 40).join('\n'));
  }

  console.log('\n' + (failed ? failed + ' GATE(S) FAILED' : 'all gates passed'));
  process.exit(failed ? 1 : 0);
})();

function pad(s) { return (s + '            ').slice(0, 14); }
