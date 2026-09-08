/* Blinking Contest — Dorky Robot Arcade.
 *
 * Ported from the original at felixflor.es/blinking.html. The detection is
 * unchanged because it is tuned against real faces; what is new here is the
 * durable board: a round can be posted to the blinkers-api Worker, and any
 * posted round carries an openness curve that somebody else can race.
 *
 * FaceMesh runs in this tab. No frame of video ever leaves the device.
 */
(function () {
  'use strict';

  var API = window.BLINKERS_API || '';

  // ---- elements -------------------------------------------------------
  var video       = document.getElementById('video');
  var loading     = document.getElementById('loading');
  var stage       = document.getElementById('stage');
  var startButton = document.getElementById('startButton');
  var againButton = document.getElementById('againButton');
  var overlay     = document.getElementById('overlay');
  var statusEl    = document.getElementById('status');
  var timeVal     = document.getElementById('timeVal');
  var bestVal     = document.getElementById('bestVal');
  var blinkVal    = document.getElementById('blinkVal');
  var ghostStat   = document.getElementById('ghostStat');
  var ghostLabel  = document.getElementById('ghostLabel');
  var ghostVal    = document.getElementById('ghostVal');
  var submitEl    = document.getElementById('submit');
  var handleInput = document.getElementById('handle');
  var submitButton = document.getElementById('submitButton');
  var submitNote  = document.getElementById('submitNote');
  var boardList   = document.getElementById('boardList');

  var panels = {
    left:  { wrap: document.getElementById('eyeLeft'),  cv: document.getElementById('canvasLeft'),  ear: document.getElementById('earLeft'),  box: null },
    right: { wrap: document.getElementById('eyeRight'), cv: document.getElementById('canvasRight'), ear: document.getElementById('earRight'), box: null }
  };
  Object.keys(panels).forEach(function (k) { panels[k].ctx = panels[k].cv.getContext('2d'); });

  // ---- detection tuning ------------------------------------------------
  // FaceMesh eye rings. Which anatomical eye each index set lands on is
  // resolved at runtime by x position rather than trusted here.
  var EYE_A = [33, 160, 158, 133, 153, 144];
  var EYE_B = [362, 385, 387, 263, 373, 380];

  var CROP_ASPECT  = 3 / 2;   // panel shape
  var CROP_PAD     = 2.8;     // how much eye-width of context to include
  var SMOOTH       = 0.35;    // crop box easing per detection frame
  var LOCK_FRAMES  = 14;      // stable detections before we call it locked
  var COUNTDOWN_MS = 3000;
  var BEST_KEY     = 'dr.blinkers.best';
  var HANDLE_KEY   = 'dr.blinkers.handle';

  // Acquisition uses a deliberately permissive floor: eye shape and camera
  // angle push some people's open-eye EAR near 0.15, and gating lock-on at the
  // blink threshold would mean they could never start a round at all.
  var LOCK_MIN_EAR = 0.13;
  // Closure is judged as a fraction of this face's own resting EAR. An absolute
  // threshold misses people whose eyelid mesh never fully collapses and fires
  // early on anyone with narrow eyes.
  var CLOSE_RATIO = 0.72;   // mean of both eyes drops this far -> blink
  var HARD_RATIO  = 0.55;   // one eye this far down counts on its own
  // Glasses and poor eyelid tracking can leave the mesh barely collapsing, so a
  // blink may never cross an absolute line. It is still a fast dip, which a slow
  // squint is not — so also fire on rate of change.
  var DIP_WINDOW = 170;     // ms to look back over
  var DIP_FRAC   = 0.20;    // drop this fraction within the window -> blink
  // Opening the eyes WIDER pushes the reading above baseline, and relaxing back
  // to normal is a fast drop from that peak — indistinguishable from a blink to
  // the dip test alone. So the peak is capped at baseline (widening cannot raise
  // the bar) and the reading must also actually be low.
  var DIP_CEILING = 0.85;
  // A real blink spans several samples at this rate; a single frame of bad
  // landmarks does not. Requiring two in a row kills the noise spikes that were
  // ending rounds on their own.
  var CLOSE_STREAK = 2;
  // ...but a very short blink may only land on one sample, and a reading this
  // low is unambiguous — no amount of landmark noise puts a genuinely open eye
  // here. Deep closures fire immediately; only marginal ones, which is where the
  // false positives come from, have to persist.
  var DEEP_RATIO = 0.50;

  var TRACE_SPAN = 4000;    // ms of history the trace shows

  // ---- round state -----------------------------------------------------
  var history = [];         // {t, ratio} for the trace and the dip test
  var closedStreak = 0;
  var baseline = 0.30;
  var earThreshold = 0.21;
  var minRatio = 1;
  var triggerReason = '';

  var model = null;
  var state = 'idle';       // idle | searching | countdown | live | ended
  var stableFrames = 0;
  var calibration = [];
  var countdownEnds = 0;
  var roundStart = 0;
  var lastTime = 0;
  var blinkCount = 0;
  var best = parseFloat(localStorage.getItem(BEST_KEY) || '') || 0;
  var frame = 0;
  var lastShownCount = null;
  var detCount = 0, faceCount = 0, noKp = 0, lastErr = '';
  var lastRunPosted = false;

  if (best) bestVal.textContent = best.toFixed(2);

  var savedHandle = localStorage.getItem(HANDLE_KEY);
  if (savedHandle) handleInput.value = savedHandle;

  // ---- ghosts ----------------------------------------------------------
  // A ghost is one round's openness curve. Recording downsamples on the way in
  // so the payload is bounded no matter how long somebody lasts: once the buffer
  // is full it is halved and the interval doubles, which keeps even a ten-minute
  // round inside 400 samples at steadily coarser resolution.
  var GHOST_MAX_SAMPLES = 400;
  var GHOST_BASE_INTERVAL = 100;
  var ghostRecord = [];
  var ghostInterval = GHOST_BASE_INTERVAL;
  var ghostLastT = -Infinity;

  var challenge = null;     // {id, handle, durationMs, ghost:[{t,r}]}
  var challengeFrames = []; // challenge ghost mapped onto this round's clock
  var passedChallenge = false;

  function resetGhostRecording() {
    ghostRecord = [];
    ghostInterval = GHOST_BASE_INTERVAL;
    ghostLastT = -Infinity;
  }

  function recordGhost(tMs, ratio) {
    if (tMs - ghostLastT < ghostInterval) return;
    ghostLastT = tMs;
    ghostRecord.push({ t: Math.round(tMs), r: Math.round(ratio * 1000) / 1000 });
    if (ghostRecord.length >= GHOST_MAX_SAMPLES) {
      var thinned = [];
      for (var i = 0; i < ghostRecord.length; i += 2) thinned.push(ghostRecord[i]);
      ghostRecord = thinned;
      ghostInterval *= 2;
    }
  }

  // ---- frame plumbing --------------------------------------------------
  var work = document.createElement('canvas');
  var workCtx = work.getContext('2d', { willReadFrequently: false });

  function grabFrame() {
    if (!video.videoWidth) return false;
    if (work.width !== video.videoWidth) {
      work.width = video.videoWidth;
      work.height = video.videoHeight;
    }
    workCtx.drawImage(video, 0, 0, work.width, work.height);
    return true;
  }

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function meanX(pts) { return pts.reduce(function (s, p) { return s + p.x; }, 0) / pts.length; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // Eye Aspect Ratio: vertical opening over horizontal width, so it is
  // invariant to how far away the face is.
  function ear(p) {
    return (dist(p[1], p[5]) + dist(p[2], p[4])) / (2 * dist(p[0], p[3]));
  }

  function boxFor(pts) {
    var xs = pts.map(function (p) { return p.x; });
    var ys = pts.map(function (p) { return p.y; });
    var cx = (Math.min.apply(null, xs) + Math.max.apply(null, xs)) / 2;
    var cy = (Math.min.apply(null, ys) + Math.max.apply(null, ys)) / 2;
    var w = Math.max(Math.max.apply(null, xs) - Math.min.apply(null, xs), 12) * CROP_PAD;
    return { x: cx - w / 2, y: cy - w / CROP_ASPECT / 2, w: w, h: w / CROP_ASPECT };
  }

  function ease(prev, next) {
    if (!prev) return next;
    return {
      x: lerp(prev.x, next.x, SMOOTH), y: lerp(prev.y, next.y, SMOOTH),
      w: lerp(prev.w, next.w, SMOOTH), h: lerp(prev.h, next.h, SMOOTH)
    };
  }

  function drawEye(panel, pts, open) {
    var cv = panel.cv, ctx = panel.ctx;
    var W = cv.width, H = cv.height, b = panel.box;
    ctx.clearRect(0, 0, W, H);
    if (!b) return;

    // Mirror the crop so it reads like a mirror rather than a photo of you.
    ctx.save();
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
    try {
      ctx.drawImage(work, b.x, b.y, b.w, b.h, 0, 0, W, H);
    } catch (e) { /* video not ready for this frame */ }
    ctx.restore();

    // landmark ring, mapped into the mirrored crop
    var px = function (p) { return W - ((p.x - b.x) / b.w) * W; };
    var py = function (p) { return ((p.y - b.y) / b.h) * H; };
    ctx.strokeStyle = open ? '#00ff00' : '#ff3b30';
    ctx.lineWidth = 2;
    ctx.beginPath();
    pts.forEach(function (p, i) { i ? ctx.lineTo(px(p), py(p)) : ctx.moveTo(px(p), py(p)); });
    ctx.closePath();
    ctx.stroke();

    panel.wrap.classList.toggle('closed', !open);
  }

  // ---- proof replay ----------------------------------------------------
  // Rolling buffer of the last couple of seconds of both eye crops, so a round
  // that ends can show what actually happened instead of asserting it. Canvases
  // are preallocated and cycled — reallocating 30 times a second would churn the
  // heap badly.
  var REPLAY_FRAMES = 44, RW = 180, RH = 120;
  var ring = [];
  for (var i = 0; i < REPLAY_FRAMES; i++) {
    var rcv = document.createElement('canvas');
    rcv.width = RW * 2; rcv.height = RH;
    ring.push({ cv: rcv, ctx: rcv.getContext('2d'), t: 0, ratio: 1, used: false });
  }
  var ringHead = 0;
  var proofFrames = [];

  function capture(ratio) {
    var slot = ring[ringHead];
    ringHead = (ringHead + 1) % REPLAY_FRAMES;
    slot.ctx.clearRect(0, 0, RW * 2, RH);
    try {
      slot.ctx.drawImage(panels.left.cv, 0, 0, RW, RH);
      slot.ctx.drawImage(panels.right.cv, RW, 0, RW, RH);
    } catch (e) { /* panel not sized yet */ }
    slot.t = performance.now();
    slot.ratio = ratio;
    slot.used = true;
  }

  function collectProof() {
    var out = [];
    for (var i = 0; i < REPLAY_FRAMES; i++) {
      var slot = ring[(ringHead + i) % REPLAY_FRAMES];   // oldest first
      if (slot.used) out.push(slot);
    }
    return out;
  }

  var proofEl    = document.getElementById('proof');
  var replayCv   = document.getElementById('replayCv');
  var replayCtx  = replayCv.getContext('2d');
  var proofScrub = document.getElementById('proofScrub');
  var proofRead  = document.getElementById('proofRead');
  var proofPlay  = document.getElementById('proofPlay');
  var proofTimer = null, proofIdx = 0, proofPlaying = false;

  function drawProofFrame(i) {
    var f = proofFrames[i];
    if (!f) return;
    replayCv.width = f.cv.width; replayCv.height = f.cv.height;
    replayCtx.drawImage(f.cv, 0, 0);
    var last = proofFrames[proofFrames.length - 1];
    // the trigger frame is the final one; mark it
    if (i === proofFrames.length - 1) {
      replayCtx.strokeStyle = '#ff3b30'; replayCtx.lineWidth = 4;
      replayCtx.strokeRect(2, 2, replayCv.width - 4, replayCv.height - 4);
    }
    proofRead.textContent = '-' + Math.round(last.t - f.t) + 'ms · ' + (f.ratio * 100).toFixed(0) + '%';
    proofScrub.value = String(i);
  }

  function stopProof() {
    proofPlaying = false;
    if (proofTimer) { clearInterval(proofTimer); proofTimer = null; }
    proofPlay.textContent = '▶';
  }

  function startProof() {
    if (!proofFrames.length) return;
    proofPlaying = true;
    proofPlay.textContent = '❚❚';
    if (proofTimer) clearInterval(proofTimer);
    // quarter speed, so a 100ms blink is actually watchable
    proofTimer = setInterval(function () {
      proofIdx = (proofIdx + 1) % proofFrames.length;
      drawProofFrame(proofIdx);
    }, 120);
  }

  proofPlay.addEventListener('click', function () { proofPlaying ? stopProof() : startProof(); });
  proofScrub.addEventListener('input', function () {
    stopProof();
    proofIdx = Number(proofScrub.value);
    drawProofFrame(proofIdx);
  });

  // ---- trace -----------------------------------------------------------
  // Live trace of eye openness against the trigger line. If a blink shows as a
  // visible dip that never crosses, the threshold is wrong; if the line barely
  // moves at all, the eyelid landmarks are not tracking. A loaded challenge is
  // drawn in the same window, on the same clock, so you can see them coming.
  var trace = document.getElementById('trace');
  var traceCtx = trace.getContext('2d');

  function strokeSeries(ctx, X, Y, W, H, frames, endT, colour, width) {
    if (frames.length < 2) return;
    var y = function (r) { return Y + H - Math.max(0, Math.min(1.15, r)) / 1.15 * H; };
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.beginPath();
    var started = false;
    for (var i = 0; i < frames.length; i++) {
      var age = endT - frames[i].t;
      if (age > TRACE_SPAN || age < 0) continue;
      var px = X + W - (age / TRACE_SPAN) * W;
      started ? ctx.lineTo(px, y(frames[i].ratio)) : ctx.moveTo(px, y(frames[i].ratio));
      started = true;
    }
    ctx.stroke();
  }

  function drawTrace() {
    var W = trace.width, H = trace.height;
    if (!W) return;
    var endT = performance.now();
    var y = function (r) { return H - Math.max(0, Math.min(1.15, r)) / 1.15 * H; };

    traceCtx.clearRect(0, 0, W, H);
    traceCtx.save();
    traceCtx.setLineDash([4, 5]);
    traceCtx.strokeStyle = 'rgba(255,80,60,0.75)';
    traceCtx.lineWidth = 1;
    traceCtx.beginPath();
    traceCtx.moveTo(0, y(CLOSE_RATIO));
    traceCtx.lineTo(W, y(CLOSE_RATIO));
    traceCtx.stroke();
    traceCtx.setLineDash([]);

    if (challengeFrames.length) {
      strokeSeries(traceCtx, 0, 0, W, H, challengeFrames, endT, 'rgba(88,166,255,0.7)', 1.4);
    }
    strokeSeries(traceCtx, 0, 0, W, H, history, endT, '#00ff00', 1.6);

    traceCtx.font = '10px "Courier New", monospace';
    chip(traceCtx, 'EYES OPEN', W - 5, 12, 'right', 'rgba(0,255,0,0.5)');
    chip(traceCtx, 'BLINK', 5, y(CLOSE_RATIO) + 13, 'left', 'rgba(255,110,90,0.95)');
    if (challengeFrames.length) chip(traceCtx, 'GHOST', W - 5, H - 5, 'right', 'rgba(88,166,255,0.85)');
    traceCtx.restore();
  }

  function chip(ctx, txt, tx, ty, align, colour) {
    ctx.textAlign = align;
    var w = ctx.measureText(txt).width;
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(align === 'right' ? tx - w - 3 : tx - 3, ty - 10, w + 6, 13);
    ctx.fillStyle = colour;
    ctx.fillText(txt, tx, ty);
  }

  function sizeCanvases() {
    Object.keys(panels).forEach(function (k) {
      var p = panels[k];
      var w = Math.max(p.cv.clientWidth, 1);
      p.cv.width = Math.round(w);
      p.cv.height = Math.round(w / CROP_ASPECT);
    });
    trace.width = Math.max(trace.clientWidth, 1);
    trace.height = Math.max(trace.clientHeight, 1);
  }
  window.addEventListener('resize', sizeCanvases);

  // ---- round flow ------------------------------------------------------
  function setOverlay(html, kind) {
    overlay.innerHTML = html;
    overlay.classList.toggle('danger', kind === 'danger');
    overlay.classList.toggle('ahead', kind === 'ahead');
  }

  function toSearching(msg) {
    state = 'searching';
    stableFrames = 0;
    calibration = [];
    lastShownCount = null;
    againButton.hidden = true;
    submitEl.hidden = true;
    stopProof();
    proofEl.hidden = true;
    timeVal.textContent = '0.00';
    challengeFrames = [];
    passedChallenge = false;
    if (challenge) {
      ghostStat.hidden = false;
      ghostLabel.textContent = 'GHOST';
      ghostVal.textContent = (challenge.durationMs / 1000).toFixed(2);
    }
    setOverlay('<div class="msg">' + (msg || 'LOOKING FOR YOUR EYES') + '</div>');
    statusEl.textContent = 'Face the camera and hold still.';
  }

  function beginCountdown() {
    state = 'countdown';
    countdownEnds = performance.now() + COUNTDOWN_MS;
    lastShownCount = null;

    // Calibrate to this face: open-eye EAR varies enough between people and
    // camera angles that a fixed 0.21 misfires. A fraction of the resting
    // average sits comfortably between open and closed.
    if (calibration.length) {
      baseline = calibration.reduce(function (s, v) { return s + v; }, 0) / calibration.length;
      earThreshold = baseline * CLOSE_RATIO;
    }
    minRatio = 1;
    closedStreak = 0;
    triggerReason = '';
    statusEl.textContent = 'Locked on. Open ' + baseline.toFixed(3) +
                           ' · blink under ' + earThreshold.toFixed(3);
  }

  function beginRound() {
    state = 'live';
    roundStart = performance.now();
    resetGhostRecording();
    lastRunPosted = false;
    setOverlay('');
    // The challenge curve is stored relative to its own round start; replaying
    // it against this round's clock is what makes the two lines comparable.
    challengeFrames = challenge && challenge.ghost
      ? challenge.ghost.map(function (s) { return { t: roundStart + s.t, ratio: s.r }; })
      : [];
    statusEl.textContent = challenge
      ? 'Don\'t blink. ' + challenge.handle + ' lasted ' + (challenge.durationMs / 1000).toFixed(2) + 's.'
      : 'Don\'t blink.';
  }

  function endRound(reason) {
    var elapsed = (performance.now() - roundStart) / 1000;
    state = 'ended';
    lastTime = elapsed;
    timeVal.textContent = elapsed.toFixed(2);

    if (reason === 'blink') {
      proofFrames = collectProof();
      if (proofFrames.length) {
        proofScrub.max = String(proofFrames.length - 1);
        proofIdx = 0;
        proofEl.hidden = false;
        document.getElementById('proofReason').textContent =
          triggerReason ? 'TRIGGER: ' + triggerReason.toUpperCase() : '';
        drawProofFrame(0);
        startProof();
      }
      blinkCount++;
      blinkVal.textContent = String(blinkCount);

      var isBest = elapsed > best;
      if (isBest) {
        best = elapsed;
        localStorage.setItem(BEST_KEY, String(best));
        bestVal.textContent = best.toFixed(2);
      }

      var beat = challenge && elapsed * 1000 > challenge.durationMs;
      setOverlay(
        '<div class="big pop">BLINK</div><div class="msg">' +
        elapsed.toFixed(2) + 's' + (isBest ? ' — NEW BEST' : '') + '</div>', 'danger');
      statusEl.textContent =
        (beat ? 'You beat ' + challenge.handle + '. ' : '') +
        (isBest ? 'A new personal best. ' : 'Best so far: ' + best.toFixed(2) + 's. ') +
        '(dipped to ' + (minRatio * 100).toFixed(0) + '% of open)';

      offerSubmit(elapsed);
    } else {
      setOverlay('<div class="msg">LOST YOUR EYES</div>', 'danger');
      statusEl.textContent = 'Round abandoned — the camera lost track.';
    }
    againButton.hidden = false;
  }

  // ---- API -------------------------------------------------------------
  function offerSubmit(elapsed) {
    if (!API) return;
    submitEl.hidden = false;
    submitButton.disabled = false;
    submitButton.textContent = 'POST SCORE';
    submitNote.className = 'submit-note';
    submitNote.textContent = 'Posting ' + elapsed.toFixed(2) +
      's as a handle and a time. Nothing else is stored.';
  }

  function postRun() {
    if (!API || lastRunPosted || state !== 'ended' || lastTime <= 0) return;
    var handle = handleInput.value.trim();

    submitButton.disabled = true;
    submitButton.textContent = 'POSTING…';

    fetch(API + '/blinkers/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: handle || undefined,
        durationMs: Math.round(lastTime * 1000),
        blinks: blinkCount,
        ghost: ghostRecord.length ? ghostRecord : undefined
      })
    }).then(function (res) {
      return res.json().then(function (body) { return { ok: res.ok, body: body }; });
    }).then(function (out) {
      if (!out.ok) throw new Error(out.body && out.body.error ? out.body.error : 'could not post');
      lastRunPosted = true;
      // Remembered so the next visit prefills, and so the board can mark which
      // row is yours.
      savedHandle = out.body.handle;
      localStorage.setItem(HANDLE_KEY, savedHandle);
      submitButton.textContent = 'POSTED';
      submitNote.className = 'submit-note is-ok';
      submitNote.textContent = 'Posted as ' + out.body.handle + ' — rank #' + out.body.rank +
                               ' all time. Best: ' + (out.body.personalBestMs / 1000).toFixed(2) + 's.';
      loadBoard(currentPeriod);
    }).catch(function (err) {
      submitButton.disabled = false;
      submitButton.textContent = 'RETRY';
      submitNote.className = 'submit-note is-error';
      submitNote.textContent = 'Could not post: ' + err.message;
    });
  }

  submitButton.addEventListener('click', postRun);
  handleInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); postRun(); }
  });

  var currentPeriod = 'all';

  function boardRow(entry, index) {
    var li = document.createElement('li');
    if (savedHandle && entry.handle === savedHandle) li.className = 'is-you';

    var rank = document.createElement('span');
    rank.className = 'board-rank';
    rank.textContent = String(index + 1);

    // textContent throughout: the Worker constrains handles to a small
    // character set, but the board should not depend on that staying true.
    var handle = document.createElement('span');
    handle.className = 'board-handle';
    handle.textContent = entry.handle;

    var time = document.createElement('span');
    time.className = 'board-time';
    time.textContent = (entry.durationMs / 1000).toFixed(2) + 's';

    li.append(rank, handle, time);

    if (entry.hasGhost) {
      var link = document.createElement('a');
      link.className = 'board-challenge';
      link.href = '?ghost=' + encodeURIComponent(entry.id);
      link.textContent = 'CHALLENGE';
      link.title = 'Race ' + entry.handle + '’s round';
      li.append(link);
    }
    return li;
  }

  function boardMessage(text) {
    var li = document.createElement('li');
    li.className = 'board-empty';
    li.textContent = text;
    boardList.replaceChildren(li);
  }

  function loadBoard(period) {
    if (!API) return boardMessage('Leaderboard is not configured yet.');
    fetch(API + '/blinkers/leaderboard?period=' + period + '&limit=20')
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        // A slower tab switch can resolve after a faster one; only the period
        // the player is actually looking at should win.
        if (period !== currentPeriod) return;
        var entries = data.entries || [];
        if (!entries.length) {
          return boardMessage(period === 'day'
            ? 'Nobody has posted a time today. Be first.'
            : 'No times yet. Be first.');
        }
        boardList.replaceChildren.apply(boardList, entries.map(boardRow));
      })
      .catch(function () {
        boardMessage('Could not reach the leaderboard.');
      });
  }

  Array.prototype.forEach.call(document.querySelectorAll('.board-tabs .mini'), function (btn) {
    btn.addEventListener('click', function () {
      currentPeriod = btn.dataset.period;
      Array.prototype.forEach.call(document.querySelectorAll('.board-tabs .mini'), function (b) {
        b.classList.toggle('is-on', b === btn);
      });
      boardMessage('Loading the board…');
      loadBoard(currentPeriod);
    });
  });

  function loadChallenge() {
    var id = new URLSearchParams(location.search).get('ghost');
    // The id goes straight into a request path, so it is checked against the
    // Worker's own id alphabet before it is used rather than after.
    if (!API || !id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return;

    var banner = document.getElementById('ghostBanner');
    var text = document.getElementById('ghostBannerText');
    banner.hidden = false;
    text.textContent = 'Loading challenge…';

    fetch(API + '/blinkers/ghosts/' + id)
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (!data.ghost || !data.ghost.length) throw new Error('no ghost on that run');
        challenge = data;
        text.textContent = 'Racing ' + data.handle + ' — ' +
          (data.durationMs / 1000).toFixed(2) + 's to beat. Their eyes track in blue.';
        ghostStat.hidden = false;
        ghostLabel.textContent = 'GHOST';
        ghostVal.textContent = (data.durationMs / 1000).toFixed(2);
      })
      .catch(function () {
        text.textContent = 'That challenge could not be loaded — playing solo.';
      });
  }

  // ---- model and camera ------------------------------------------------
  function loadModel() {
    loading.textContent = 'Loading TensorFlow backend…';
    return tf.setBackend('webgl')
      .then(function () { return tf.ready(); })
      .then(function () {
        loading.textContent = 'Loading FaceMesh model…';
        return faceLandmarksDetection.createDetector(
          faceLandmarksDetection.SupportedModels.MediaPipeFaceMesh,
          { runtime: 'tfjs', refineLandmarks: true }
        );
      })
      .then(function (detector) {
        model = detector;
        loading.textContent = 'Ready when you are.';
        startButton.hidden = false;
      })
      .catch(function (err) {
        loading.textContent = 'Could not load the face model: ' + err.message +
          ' — this needs a browser with WebGL.';
        console.error('[blinkers] model load failed', err);
      });
  }

  function start() {
    navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }
    }).then(function (stream) {
      video.srcObject = stream;
      return new Promise(function (res) {
        if (video.readyState >= 1) return res();
        var done = false;
        var ok = function () {
          if (done) return;
          done = true;
          video.removeEventListener('loadedmetadata', ok);
          res();
        };
        video.addEventListener('loadedmetadata', ok);
        setTimeout(ok, 5000);   // never hang the UI on a missed event
      });
    }).then(function () {
      return video.play().catch(function (e) {
        statusEl.textContent = 'Camera stream would not play: ' + e.message;
        console.error('[blinkers] play() rejected', e);
      });
    }).then(function () {
      loading.hidden = true;
      startButton.hidden = true;
      stage.hidden = false;
      sizeCanvases();

      grabFrame();
      return model.estimateFaces(work).catch(function () {});
    }).then(function () {
      toSearching();
      detectLoop();
      requestAnimationFrame(renderLoop);
    }).catch(function (err) {
      loading.hidden = false;
      loading.textContent = 'Could not use the camera: ' + err.message;
      console.error('[blinkers] camera failed', err);
    });
  }

  // Detection runs in its own loop rather than inside requestAnimationFrame:
  // rAF would idle until the next vsync after every await, capping sampling near
  // 18Hz and letting short blinks fall between frames.
  var running = false;
  function detectLoop() {
    running = true;
    (function next() {
      if (!running) return;
      frame++;
      Promise.resolve()
        .then(step)
        .catch(function (err) {
          lastErr = 'ERR ' + err.message;
          console.error('[blinkers] detect error', err);
        })
        .then(function () {
          // Always yield to a macrotask. Resolving a promise immediately only
          // drains the microtask queue, which would starve rendering and timers
          // and lock the page up.
          setTimeout(next, state === 'live' ? 0 : 24);
        });
    })();
  }

  function renderLoop() {
    if (state === 'searching' && frame % 20 === 0) statusEl.textContent = diag();
    if (state === 'live') {
      var elapsedMs = performance.now() - roundStart;
      timeVal.textContent = (elapsedMs / 1000).toFixed(2);
      if (challenge) {
        var remain = challenge.durationMs - elapsedMs;
        if (remain > 0) {
          ghostLabel.textContent = 'GHOST LEFT';
          ghostVal.textContent = (remain / 1000).toFixed(2);
        } else {
          ghostLabel.textContent = 'AHEAD BY';
          ghostVal.textContent = (-remain / 1000).toFixed(2);
          if (!passedChallenge) {
            passedChallenge = true;
            setOverlay('<div class="msg">AHEAD OF ' + escapeText(challenge.handle) + '</div>', 'ahead');
            setTimeout(function () { if (state === 'live') setOverlay(''); }, 1400);
          }
        }
      }
    }
    drawTrace();
    requestAnimationFrame(renderLoop);
  }

  // setOverlay writes HTML for the countdown markup, so anything interpolated
  // into it has to be neutralised first — the handle comes off the network.
  function escapeText(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function diag() {
    return 'cam ' + (video.videoWidth || 0) + '×' + (video.videoHeight || 0) +
           ' · rs' + video.readyState + (video.paused ? ' · PAUSED' : '') +
           ' · scans ' + detCount + ' · faces ' + faceCount +
           (noKp ? ' · nokp ' + noKp : '') +
           (lastErr ? ' · ' + lastErr : '');
  }

  function step() {
    if (video.readyState < 2) {
      if (state === 'searching' && detCount === 0) {
        statusEl.textContent = 'Waiting for camera frames… ' + diag();
      }
      return Promise.resolve();
    }
    if (!grabFrame()) return Promise.resolve();
    detCount++;

    return model.estimateFaces(work, { flipHorizontal: false }).then(function (faces) {
      if (faces.length) faceCount++;
      if (state === 'searching' && detCount % 8 === 0) statusEl.textContent = diag();

      if (!faces.length) {
        if (state === 'live') return endRound('lost');
        if (state === 'countdown') return toSearching('LOST YOU — TRY AGAIN');
        if (state === 'searching') { stableFrames = 0; calibration = []; }
        return;
      }

      var kp = faces[0].keypoints;
      var a = EYE_A.map(function (i) { return kp[i]; });
      var b = EYE_B.map(function (i) { return kp[i]; });
      if (a.some(function (p) { return !p; }) || b.some(function (p) { return !p; })) {
        noKp++;
        return;
      }

      // Mirrored view puts the subject's left eye on the viewer's left, so the
      // left panel takes whichever ring sits further right in the raw frame.
      var ptsL = meanX(a) > meanX(b) ? a : b;
      var ptsR = meanX(a) > meanX(b) ? b : a;

      var earL = ear(ptsL), earR = ear(ptsR);
      var gate = state === 'searching' ? LOCK_MIN_EAR : baseline * CLOSE_RATIO;
      var openL = earL > gate, openR = earR > gate;

      panels.left.box  = ease(panels.left.box,  boxFor(ptsL));
      panels.right.box = ease(panels.right.box, boxFor(ptsR));
      drawEye(panels.left,  ptsL, openL);
      drawEye(panels.right, ptsR, openR);
      panels.left.ear.textContent  = earL.toFixed(3);
      panels.right.ear.textContent = earR.toFixed(3);

      var bothOpen = openL && openR;
      var meanEar = (earL + earR) / 2;
      var ratio = baseline > 0 ? meanEar / baseline : 1;
      var worst = baseline > 0 ? Math.min(earL, earR) / baseline : 1;

      if (state === 'searching') {
        if (bothOpen) {
          stableFrames++;
          calibration.push(meanEar);
          if (calibration.length > 40) calibration.shift();
          var left = Math.max(0, LOCK_FRAMES - stableFrames);
          setOverlay('<div class="msg">' + (left ? 'HOLD STILL…' : 'LOCKED') + '</div>');
          if (stableFrames >= LOCK_FRAMES) beginCountdown();
        } else {
          stableFrames = 0;
        }
        return;
      }

      if (state === 'countdown') {
        var remain = countdownEnds - performance.now();
        if (remain <= 0) return beginRound();
        var n = Math.ceil(remain / 1000);
        if (n !== lastShownCount) {
          lastShownCount = n;
          setOverlay('<div class="big pop">' + n + '</div><div class="msg">GET READY</div>');
        }
        return;
      }

      // Not once the round is over: proofFrames holds references into this ring,
      // and continuing to write would overwrite the evidence.
      if (state !== 'ended') capture(ratio);
      var now = performance.now();
      history.push({ t: now, ratio: ratio });
      while (history.length && now - history[0].t > TRACE_SPAN) history.shift();

      if (state === 'live') {
        minRatio = Math.min(minRatio, ratio);
        recordGhost(now - roundStart, ratio);

        // deepest reading in the recent window: a blink drops away from it fast
        var recentMax = ratio;
        for (var i = history.length - 1; i >= 0; i--) {
          if (now - history[i].t > DIP_WINDOW) break;
          if (history[i].ratio > recentMax) recentMax = history[i].ratio;
        }
        recentMax = Math.min(recentMax, 1);
        var dipped = recentMax > 0 && ratio < DIP_CEILING &&
                     (recentMax - ratio) / recentMax > DIP_FRAC;

        var why = '';
        if (ratio < CLOSE_RATIO) why = 'closed (' + (ratio * 100).toFixed(0) + '% of open)';
        else if (worst < HARD_RATIO) why = 'one eye shut (' + (worst * 100).toFixed(0) + '%)';
        else if (dipped) why = 'fast drop (' + ((1 - ratio / recentMax) * 100).toFixed(0) + '% in ' + DIP_WINDOW + 'ms)';

        if (why) {
          closedStreak++;
          if (closedStreak >= CLOSE_STREAK || ratio < DEEP_RATIO) {
            triggerReason = why;
            return endRound('blink');
          }
        } else {
          closedStreak = 0;
          // track slow drift, but ignore readings outside a sane band so a
          // held-wide eye cannot inflate what counts as "open"
          if (ratio > 0.92 && ratio < 1.08) baseline = baseline * 0.97 + meanEar * 0.03;
        }
      }
    });
  }

  startButton.addEventListener('click', start);
  againButton.addEventListener('click', function () {
    blinkVal.textContent = String(blinkCount);
    toSearching();
  });

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    loading.textContent = 'This browser will not give a page camera access, so the contest cannot run here.';
  } else {
    loadModel();
  }

  loadChallenge();
  loadBoard(currentPeriod);
})();
