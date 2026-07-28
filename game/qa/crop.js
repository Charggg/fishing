/* Crop-and-zoom for screenshots. There is no image library here, so this
   borrows the browser's canvas to do it.
   Usage: node game/qa/crop.js <in.png> <x> <y> <w> <h> [zoom] [out.png]      */
const pw = require('./pw');
const path = require('path');
const fs = require('fs');

const [inPath, x, y, w, h] = process.argv.slice(2);
const zoom = Number(process.argv[7] || 2);
const outPath = process.argv[8] || path.join(path.dirname(path.resolve(inPath)),
  path.basename(inPath, '.png') + '-crop.png');

(async () => {
  const b64 = fs.readFileSync(path.resolve(inPath)).toString('base64');
  const browser = await pw.launch();
  const W = Math.round(Number(w) * zoom), H = Math.round(Number(h) * zoom);
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.setContent('<style>html,body{margin:0;background:#000}</style>' +
    '<canvas id="c" width="' + W + '" height="' + H + '"></canvas>');
  await page.evaluate(({ b64, sx, sy, sw, sh, W, H }) => new Promise(res => {
    const im = new Image();
    im.onload = () => {
      const g = document.getElementById('c').getContext('2d');
      g.imageSmoothingEnabled = false;
      g.drawImage(im, sx, sy, sw, sh, 0, 0, W, H);
      res();
    };
    im.src = 'data:image/png;base64,' + b64;
  }), { b64, sx: +x, sy: +y, sw: +w, sh: +h, W, H });
  await page.screenshot({ path: outPath });
  await browser.close();
  console.log(outPath);
})();
