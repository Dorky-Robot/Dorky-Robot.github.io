// Proof that a page reads at a phone's width and a laptop's, in both engines:
// nothing runs off the side, no script error, every link in the page resolves,
// and the picture of the paths keeps its boxes inside their lanes.
//
//   node scripts/page-proof.mjs <base url> <path> [shots folder]
import { open } from './quiet-browser.mjs';
const [base, path, shots] = process.argv.slice(2);
const sizes = { phone: { width: 375, height: 812 }, laptop: { width: 1280, height: 800 } };
let red = 0;
const say = (ok, what) => { console.log(`${ok ? 'ok' : 'FAIL'} ${what}`); if (!ok) red = 1; };

for (const engine of (process.env.ENGINES || 'chromium,webkit').split(',')) {
  for (const [name, size] of Object.entries(sizes)) {
    const tag = `${engine} ${name}`;
    const { browser, page } = await open(engine, size);
    try {
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      const failed = [];
      page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
      await page.goto(base + path, { waitUntil: 'load' });
      await page.waitForTimeout(300);
      say(errors.length === 0, `${tag}: no script errors ${errors.join(' | ')}`);
      say(failed.length === 0, `${tag}: every file loads ${failed.join(' | ')}`);
      const m = await page.evaluate(() => {
        const de = document.documentElement;
        const out = { wide: de.scrollWidth - de.clientWidth, spill: [], small: [] };
        // anything wider than its scrolling box, other than code that scrolls by itself
        for (const el of document.querySelectorAll('main *')) {
          if (el.closest('pre, .table-wrap')) continue;
          const r = el.getBoundingClientRect();
          if (r.width && (r.right > de.clientWidth + 0.5 || r.left < -0.5)) out.spill.push(el.tagName + '.' + el.className);
        }
        for (const lane of document.querySelectorAll('.lane')) {
          const l = lane.getBoundingClientRect();
          for (const el of lane.querySelectorAll('.node, .hop span')) {
            const r = el.getBoundingClientRect();
            if (r.left < l.left - 0.5 || r.right > l.right + 0.5 || r.top < l.top - 0.5 || r.bottom > l.bottom + 0.5) out.spill.push('lane:' + el.textContent.trim());
          }
          // a hop's words must not sit on top of a box
          const boxes = [...lane.querySelectorAll('.node')].map((n) => n.getBoundingClientRect());
          for (const s of lane.querySelectorAll('.hop span')) {
            const r = s.getBoundingClientRect();
            if (boxes.some((b) => r.left < b.right - 0.5 && r.right > b.left + 0.5 && r.top < b.bottom - 0.5 && r.bottom > b.top + 0.5)) out.spill.push('over a box:' + s.textContent.trim());
          }
        }
        for (const el of document.querySelectorAll('main p, main li, main td, main th, main span, main small, main code')) {
          if (parseFloat(getComputedStyle(el).fontSize) < 11) out.small.push(el.textContent.trim().slice(0, 30));
        }
        return out;
      });
      say(m.wide <= 0, `${tag}: the page does not scroll sideways (${m.wide}px)`);
      say(m.spill.length === 0, `${tag}: nothing spills ${[...new Set(m.spill)].join(' | ')}`);
      say(m.small.length === 0, `${tag}: no words under 11px ${m.small.join(' | ')}`);
      const links = await page.$$eval('main a[href^="/"], header a[href^="/"]', (as) => as.map((a) => a.getAttribute('href')));
      for (const href of [...new Set(links)]) {
        const r = await page.request.get(base + href);
        say(r.ok(), `${tag}: ${href} answers`);
      }
      if (shots) await page.screenshot({ path: `${shots}/${path.replace(/\W+/g, '') || 'home'}-${engine}-${name}.png`, fullPage: true });
    } finally {
      await browser.close();
    }
  }
}
console.log(red ? 'red' : 'green');
process.exit(red);
