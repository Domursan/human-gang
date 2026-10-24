const { ouvrir, fermer } = require('./lib.js');
(async () => {
  const p = await ouvrir(+process.argv[3] || 1, process.argv[2], 390);
  const r = await p.evaluate(() => { const W = document.documentElement.clientWidth; const out = [];
    for (const e of document.querySelectorAll('body *')) { const b = e.getBoundingClientRect(); if (b.right > W + 1 && b.width > 0) out.push(`${e.tagName}.${[...e.classList].join('.')} right=${Math.round(b.right)} w=${Math.round(b.width)}`); }
    return [W, document.documentElement.scrollWidth, ...out.slice(0, 12)]; });
  console.log(r.join('\n')); await fermer();
})();
