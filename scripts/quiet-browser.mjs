// The one way a proof in this repo opens a browser: muted. A headless browser
// still plays out of the machine's speakers, so silence is part of the launch
// and not something each proof has to remember.
//
//   PLAYWRIGHT=<path to playwright-core's index.mjs>   when it is not installed here
const pw = await import(process.env.PLAYWRIGHT || 'playwright-core');
const engines = { chromium: pw.chromium || pw.default.chromium, webkit: pw.webkit || pw.default.webkit };

// WebKit has no mute flag: mute every media element and put a gain of 0 in
// front of every AudioContext's destination, before the page's scripts run.
const hush = () => {
  const quiet = (el) => { try { el.muted = true; el.volume = 0; } catch {} };
  new MutationObserver(() => document.querySelectorAll('audio,video').forEach(quiet)).observe(document, { childList: true, subtree: true });
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () { quiet(this); return play.apply(this, arguments); };
  for (const name of ['AudioContext', 'webkitAudioContext']) {
    const Real = window[name];
    if (!Real) continue;
    window[name] = class extends Real {
      constructor(...a) { super(...a); const g = this.createGain(); g.gain.value = 0; g.connect(super.destination); this._quiet = g; }
      get destination() { return this._quiet; }
    };
  }
};

export async function open(engine, { width, height }) {
  const browser = await engines[engine].launch(engine === 'chromium' ? { args: ['--mute-audio'] } : {});
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  await context.addInitScript(hush);
  return { browser, page: await context.newPage() };
}
