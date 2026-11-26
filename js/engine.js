/* ════════════════════════════════════════════════════════════════════
   KIZUMICHI — SHARED SCENE ENGINE
   ════════════════════════════════════════════════════════════════════
   One engine file, loaded by every chapter/scene HTML page. Each page
   still owns its own scene content (kept inline in its own <script>,
   right in the HTML) so scene-specific tweaks and one-off effects stay
   easy to find and safe to touch — only the reusable machinery
   (typewriter, backgrounds, portraits, music, save/settings, pause
   menu, etc.) lives here.

   HOW A PAGE USES THIS FILE
   ─────────────────────────
   1. Before loading this file, the page sets window.FC_CONFIG:

        window.FC_CONFIG = {
          chapter:  "Part 1 - Chapter 1 - Scene 1 - Kaden", // shown in pause menu / save
          file:     "C1.html",       // this page's own filename
          rawFile:  "C1.html",       // (optional, defaults to `file`)
          nextFile: "C1S2.html",     // where "advance past the last line" goes
          endCard:  false,           // true = play the title-card outro instead of a plain cut (needs #end-card in the page)
          scenes:   [ ... ]          // the scene array — unchanged from before
        };

   2. Then it loads this file with a normal script tag pointing at
      engine.js (written here without angle brackets on purpose, so
      this comment can't ever be mistaken for a real closing tag).

   3. (Optional) Any bespoke, scene-only behavior — e.g. a one-off
      cinematic — goes in a THIRD inline <script>, after engine.js.
      It can safely override the base `showScene` like:

        const _base = showScene;
        showScene = function(i) { ...custom...; _base(i); };

   4. The page's LAST script line calls:
        FC_start();

      This is deliberately not automatic — it lets step 3's overrides
      register themselves before the very first scene actually renders.

   TABLE OF CONTENTS (search for these exact headers to jump around)
   ───────────────────────────────────────────────────────────────
   ENGINE BOOT CONFIG      — reads window.FC_CONFIG into FC / scenes / NEXT_FILE
   SAVE HELPER             — writes localStorage progress
   ELEMENTS                — grabs every DOM element the engine touches
   MUSIC CROSSFADE         — fades between background tracks
   CROSSFADE BG            — fades between background images
   PROGRESS                — the little dots along the top of the screen
   TYPEWRITER              — the letter-by-letter dialogue text effect
   KEYBINDING SYSTEM       — lets the player rebind the "advance" key
   BOOT                    — showScene(): renders one scene (bg/music/portraits/text)
   END-OF-SCENE TITLE CARD — the optional "chapter ended" outro screen
   START                   — FC_start(): kicks off the very first scene
   BACK/FORWARD-CACHE FIX  — repairs the page if the browser restores it from bfcache
   PAUSE MENU              — the in-game pause overlay and its buttons
   KEYBINDING SETTINGS UI  — the "rebind keys" list inside the settings panel
   SETTINGS SYSTEM         — the settings panel itself (volume, text speed, etc.)
   ════════════════════════════════════════════════════════════════════ */


/* ── CONTROLLER SUPPORT (auto-loaded) ─────────────────────
   Every page that loads engine.js gets gamepad/controller support
   for free — gamepad.js lives alongside this file and the scene
   pages, so we just pull it in here instead of making every scene
   page remember to add its own <script> tag. Harmless no-op if
   gamepad.js isn't reachable, and safe if a page happens to load
   it twice (gamepad.js guards itself against double-init). */
(function () {
  if (document.querySelector('script[src="gamepad.js"]')) return;
  const s = document.createElement('script');
  s.src = 'gamepad.js';
  document.head.appendChild(s);
})();


/* ── ENGINE BOOT CONFIG ──────────────────────────────────
   Every scene page sets `window.FC_CONFIG` (chapter, file,
   nextFile, scenes[, endCard]) in its own inline <script>
   BEFORE loading this file. See any chapter HTML for the shape. */
const FC = window.FC_CONFIG || {};
let scenes = FC.scenes || [];
const NEXT_FILE = FC.nextFile;

/* ── ENCOUNTER SKIP ──────────────────────────────────────
   When the "Skip Encounters" setting is on, any exit that would land on
   a *_encount.html battle page goes straight to the scene that battle
   would have sent the player to ("Keep Moving"). Resolved at the moment
   of navigation, so flipping the setting from the pause menu takes
   effect immediately. Keys are lowercase; if you add a new encounter
   file, add it here (js/battle-engine.js also bounces any encounter
   page on its own as a safety net). */
const FC_ENCOUNTER_NEXT = {
  'prac_encount.html':        'C2S1.html',
  'gatewarden_encount.html':  'C2S2.html',
  'alley_encount.html':       'C2S2.5.html',
  'ast_encount.html':         'C2S4.5.html',
  'chainkeeper_encount.html': 'C3S2.html',
  'agr_encount.html':         'C3S5.html',
  'ironcustodian_encount.html': 'C4S2.html',
  'als_encount.html':         'C4S6.html',
  'zenis_encount.html':       'C4S7.html'
};
function fcResolveNext(file) {
  file = String(file == null ? '' : file).replace(/(^|\/)((?:c\d+(?:s\d+(?:[._]\d+)?)?)|int\d)(\.html)/i, (m, a, b, c) => a + b.toUpperCase() + c);
  try {
    const s = JSON.parse(localStorage.getItem('fc_settings') || '{}');
    if (s.skipEncounters) {
      const k = String(file || '').toLowerCase();
      for (const key in FC_ENCOUNTER_NEXT) { if (key.toLowerCase() === k) return FC_ENCOUNTER_NEXT[key]; }
    }
  } catch (e) {}
  return file;
}

/* ── SAVE HELPER ─────────────────────────────────────── */
function saveProgress(sceneIndex) {
  localStorage.setItem('fc_save', JSON.stringify({
    chapter: FC.chapter,
    file: FC.file,
    rawFile: FC.rawFile || FC.file,
    scene: sceneIndex
  }
  ));
}

// Save only when the player actually leaves — not on every scene transition.
// suppressExitSave is set to true when a special save (e.g. a chapter-break
// save, see FC.chapterBreak below) has already been written and shouldn't be
// clobbered by this generic exit handler.
let suppressExitSave = false;
window.addEventListener('pagehide', () => { if (!suppressExitSave) saveProgress(index); });
window.addEventListener('beforeunload', () => { if (!suppressExitSave) saveProgress(index); });

/* ── ELEMENTS ────────────────────────────────────────── */
// Every DOM element the engine needs, grabbed once up front. If you rename
// an id in the HTML, this is the line you'd need to update to match.
const bgm              = document.getElementById("bgm");
/* ── MUSIC CROSSFADE ─────────────────────────────────── */
// Smoothly fades the current background track out, swaps the audio file,
// then fades the new one back in — instead of an abrupt cut. Called from
// showScene() whenever a scene's `music` field differs from what's playing.
let _currentMusicSrc = bgm.src;   // normalised absolute URL set by browser

function changeMusic(filename) {
  const newSrc = 'FC-OST/' + filename;
  // bgm.src is always absolute; compare with a normalised version of newSrc
  const abs = new URL(newSrc, location.href).href;
  if (abs === _currentMusicSrc) return;          // already playing this track
  _currentMusicSrc = abs;

  const FADE_MS = 1200;
  const step    = 50;
  const startVol = bgm.volume;

  // ── fade out ─────────────────────────────────────────
  let vol = startVol;
  const fadeOut = setInterval(() => {
    vol = Math.max(0, vol - startVol / (FADE_MS / step));
    bgm.volume = vol;
    if (vol <= 0) {
      clearInterval(fadeOut);
      bgm.pause();
      bgm.src  = newSrc;
      bgm.load();
      bgm.volume = 0;
      bgm.play().catch(() => {});

      // ── fade in ──────────────────────────────────────
      let vi = 0;
      const fadeIn = setInterval(() => {
        vi = Math.min(startVol, vi + startVol / (FADE_MS / step));
        bgm.volume = vi;
        if (vi >= startVol) clearInterval(fadeIn);
      }, step);
    }
  }, step);
}

const fadeOverlay      = document.getElementById('fade-overlay');
const bgWhiteCover     = (() => { // background-only fade-to-white, for bgSequence's fadeToWhite steps (styled in fc-theme.css)
  let el = document.getElementById('bg-white-cover');
  if (!el) {
    el = document.createElement('div');
    el.id = 'bg-white-cover';
    const black = document.getElementById('bg-black-cover');
    if (black && black.parentNode) black.parentNode.insertBefore(el, black.nextSibling);
    else document.body.appendChild(el);
  }
  return el;
})();
const bgBlackCover     = document.getElementById('bg-black-cover'); // background-only fade-to-black, used by bgSequence's fadeToBlack steps
const bgDrift          = document.getElementById('bg-drift');
const bgBase           = document.getElementById("bg-base");
const bgLayer          = document.getElementById("bg-layer");
// Pre-raster layer. The stall at the start of a fade is the browser rasterizing
// a big image at screen size for the first time (decode alone isn't enough).
// Painting the NEXT background here ahead of time — essentially invisible, one
// step above bgBase and under bgLayer — does that work while the player is
// reading instead of at the instant of the fade, and bgLayer then reuses it.
const bgWarm = (() => {
  const el = document.createElement('div');
  el.id = 'bg-warm';
  el.setAttribute('aria-hidden', 'true');
  Object.assign(el.style, {
    position: 'absolute', top: '0', left: '0', width: '100%', height: '100%',
    backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat',
    opacity: '0.001', pointerEvents: 'none', willChange: 'opacity',
  });
  bgLayer.parentNode.insertBefore(el, bgLayer);
  return el;
})();
const charName         = document.getElementById('char-name');
const speakerLine      = document.getElementById('speaker-line');
const portraitWrap   = document.getElementById('portrait-wrap');
// Per-slot state for up to 3 portraits
const portraitSlots = [1,2,3].map(n => ({
  slot:    document.getElementById(`portrait-slot-${n}`),
  imgA:    document.getElementById(`portrait-img-${n}a`),
  imgB:    document.getElementById(`portrait-img-${n}b`),
  active:  'a',   // which layer is currently shown
  current: '',    // current src
}));
const standingWrap     = document.getElementById('standing-portrait-wrap');
const standingImg      = document.getElementById('standing-portrait-img');
const dialogueEl       = document.getElementById('dialogue-text');
const cursor           = document.getElementById('typing-cursor');
const dotsEl           = document.getElementById('progress-dots');
const progressFill     = document.getElementById('progress-fill');

/* ── CROSSFADE BG ────────────────────────────────────── */
// Crossfades between two full-screen background images (see changeBackground
// below). A background never just "cuts" — the old and new image overlap
// and fade into each other over CROSSFADE_MS milliseconds.
const CROSSFADE_MS = 2000;
// Slower, cinematic durations used only for scenes flagged with
// `bgZoomGlide: true` / `bgSlideUp: true` (see computeBackgroundMotion below)
// — these reveals read better stretched out well past the opacity crossfade.
const BG_ZOOM_GLIDE_MS = 1700;
const BG_SLIDE_UP_MS   = 1500;
let currentBgUrl = '', isFading = false, pendingBg = null;

// Camera-move entrances, selectable per scene (`bgCamera:`) or per
// bgSequence step (`camera:`) — the incoming image starts offset from its
// resting pan/zoom and glides into place. Nothing flashier than a push-in,
// pull-back, or pan: no shapes, no flicker, just the camera moving.
//   'zoom-in'   — starts pulled back (less zoomed), glides in
//                 (alias of the older `bgZoomGlide: true`)
//   'zoom-out'  — starts zoomed in past rest, eases back out
//   'pan-left'  — starts shifted right of rest, glides left into place
//   'pan-right' — starts shifted left of rest, glides right into place
//   'pan-up'    — starts lower than rest, glides up into place
//                 (alias of the older `bgSlideUp: true`)
//   'pan-down'  — starts higher than rest, glides down into place
const CAMERA_OFFSET_PCT = 10;   // how far from rest a pan starts, as % of frame
const CAMERA_ZOOM_DELTA = 0.10; // how much more/less zoomed than rest a zoom starts

// Resolves the old boolean flags (bgZoomGlide/bgSlideUp) to the same
// camera preset they always meant, so every existing scene using them
// keeps behaving exactly as before — `camera` (when given) just wins.
function _resolveCamera(camera, zoomGlide, slideUp) {
  if (camera) return camera;
  if (zoomGlide) return 'zoom-in';
  if (slideUp) return 'pan-up';
  return null;
}

function cameraGlideMs(camera) {
  if (!camera) return 0;
  return (camera === 'zoom-in' || camera === 'zoom-out') ? BG_ZOOM_GLIDE_MS : BG_SLIDE_UP_MS;
}

// The pure per-image math behind computeBackgroundMotion below: given a
// background's own seed text, derive its resting pan/zoom/brightness.
// Split out (no DOM writes here) so playZoomThrough can also ask "where
// does this image want to rest?" without going through the bgLayer-facing
// machinery computeBackgroundMotion wraps it in.
function restStateFor(seedText) {
  let hash = 0;
  for (let i = 0; i < seedText.length; i++) hash = (hash * 31 + seedText.charCodeAt(i)) | 0;
  // Resting position is always dead center at 1:1 scale. This used to be
  // a per-image hash-derived pan/zoom, which meant every background sat at
  // a slightly different offset/size — so crossfades between two images
  // visibly shifted and resized. (#bg-drift already overscans by 5% on each
  // side, so a centered 1.0 scale never exposes an edge.)
  const panX = 0;
  const panY = 0;
  const zoom = 1;
  const filter = 0.92 + ((Math.abs(hash >> 2) % 8) * 0.01);
  return {
    panX, panY, zoom,
    restTransform: `translate(${panX}%, ${panY}%) scale(${zoom.toFixed(3)})`,
    filterBase: `brightness(${filter.toFixed(2)})`,
    filterLayer: `brightness(${(filter - 0.02).toFixed(2)})`,
  };
}

// Gives each background a tiny, consistent amount of pan/zoom/brightness
// drift so the scene doesn't feel like a static photo. "Consistent" is the
// key word: the same background filename always gets the same motion,
// because the numbers below are derived from the text itself (a simple
// hash), not from Math.random() — so it won't flicker between different
// values every time the same background is shown again.
//
// `camera` (see the preset list above) optionally layers an entrance on
// top of that rest position: the incoming layer starts offset from rest
// and glides to it over a slower duration than the usual static drift.
// This function only computes *where* bgLayer should start and end up —
// it doesn't touch bgLayer's opacity/transition/transform itself. That's
// left to _doFade, which combines this transform move with the opacity
// crossfade (when there is one) into a single `transition` declaration —
// setting transition as two separate assignments, one after another,
// would have the second overwrite the first instead of the two properties
// animating together.
function computeBackgroundMotion(seedText, camera) {
  if (!seedText) return { restTransform: null, startTransform: null, glideMs: 0, filterBase: null };
  const rest = restStateFor(seedText);
  const { panX, panY, zoom, restTransform } = rest;

  // bgBase keeps its current filter until the swap (see _doFade) — changing
  // a full-screen filter on the visible layer at fade start forces a
  // re-raster of it, right when the transition needs its first frame.
  bgLayer.style.filter = rest.filterLayer;

  // bgBase (the outgoing image, still visible underneath during a
  // crossfade) just jumps straight to rest — it never animates itself.
  bgBase.style.transition = 'none';
  bgBase.style.transform = restTransform;

  // Re-trigger slow drift so each background has slightly different momentum.
  bgDrift.style.animation = 'none';
  void bgDrift.offsetWidth;
  bgDrift.style.animation = '';

  if (!camera) return { restTransform, startTransform: null, glideMs: 0, filterBase: rest.filterBase };

  // bgLayer (the incoming image) starts offset from rest — pulled back or
  // pushed in on zoom, or shifted off in a pan direction — then glides to
  // the resting pan/zoom/scale on an ease-out curve.
  // A pure pan can walk the layer's edge past the viewport boundary,
  // uncovering whatever's behind it for however much of the glide the
  // shift outruns the layer's own overscan. Compensate by scaling the
  // layer up at the start by roughly 2x the shift fraction — enough to
  // cover the offset even with zero baked-in overscan — and ease that
  // extra scale back to rest on the *same* transform transition as the
  // pan, so the leftover shift and the leftover compensation shrink
  // together in lockstep and the edge is never exposed mid-glide.
  let startX = panX, startY = panY, startZoom = zoom;
  switch (camera) {
    case 'zoom-out': startZoom = zoom + CAMERA_ZOOM_DELTA; break;
    case 'pan-left':  startX = panX + CAMERA_OFFSET_PCT; startZoom += (CAMERA_OFFSET_PCT / 100) * 2; break;
    case 'pan-right': startX = panX - CAMERA_OFFSET_PCT; startZoom += (CAMERA_OFFSET_PCT / 100) * 2; break;
    case 'pan-down':  startY = panY - CAMERA_OFFSET_PCT; startZoom += (CAMERA_OFFSET_PCT / 100) * 2; break;
    case 'pan-up':    startY = panY + CAMERA_OFFSET_PCT; startZoom += (CAMERA_OFFSET_PCT / 100) * 2; break;
    case 'zoom-in':
    default:          startZoom = zoom - CAMERA_ZOOM_DELTA; break;
  }
  const startTransform = `translate(${startX}%, ${startY}%) scale(${startZoom.toFixed(3)})`;
  return { restTransform, startTransform, glideMs: cameraGlideMs(camera), filterBase: rest.filterBase };
}

function setTransition(el, duration) {
  el.style.transition = duration
    ? `opacity ${duration}ms cubic-bezier(0.4,0,0.2,1)`
    : 'none';
}

/* ── ASSET PRELOADING ────────────────────────────────── */
// The lag people notice on a background change is almost never the CSS
// crossfade itself — it's the browser fetching + decoding a full-screen
// image for the very first time at the exact moment the fade is supposed
// to start. img.decode() does that expensive decode work off the main
// render path; calling it *before* touching the DOM means by the time
// _doFade() actually runs, the bitmap is already sitting there ready to
// paint instead of blocking the first frame of the transition.
const _preloadedImages = new Set();
const _preloadedAudio  = new Map(); // src -> primed Audio element

// Hold a reference to recently decoded Images. A detached Image that nothing
// points at can be garbage-collected, and its decoded bitmap goes with it —
// which brings back the decode stall right when the fade starts. Capped so
// big backgrounds don't pile up in memory.
const _keepAliveImgs = new Map();
const KEEP_ALIVE_MAX = 8;
function _keepAlive(src, img) {
  _keepAliveImgs.delete(src);
  _keepAliveImgs.set(src, img);
  while (_keepAliveImgs.size > KEEP_ALIVE_MAX) _keepAliveImgs.delete(_keepAliveImgs.keys().next().value);
}

function preloadImage(src) {
  if (_preloadedImages.has(src)) {
    if (_keepAliveImgs.has(src)) return Promise.resolve();
    // Marked loaded earlier but no longer held (evicted) — re-warm it.
    _preloadedImages.delete(src);
  }
  const img = new Image();
  img.src = src;
  _keepAlive(src, img);
  const mark = () => _preloadedImages.add(src);
  if (img.decode) return img.decode().then(mark, mark); // resolve either way — a decode error shouldn't block the fade
  return new Promise(res => { img.onload = img.onerror = () => { mark(); res(); }; });
}

// Warm one background at a time, and never while a fade is running (painting a
// new image mid-fade would just move the hitch into the fade).
let _warmPending = null, _warmCurrent = '';
function warmBackground(src) { _warmPending = src; _flushWarm(); }
function _flushWarm() {
  if (!_warmPending || isFading) return;
  const src = _warmPending;
  if (src === _warmCurrent) { _warmPending = null; return; }
  _warmPending = null;
  const idle = window.requestIdleCallback || ((f) => setTimeout(f, 60));
  idle(() => {
    if (isFading) { _warmPending = src; return; } // a fade started meanwhile — retry when it ends
    _warmCurrent = src;
    bgWarm.style.backgroundImage = `url('${src}')`;
  });
}

function preloadAudio(src) {
  if (_preloadedAudio.has(src)) return _preloadedAudio.get(src);
  const a = new Audio();
  a.preload = 'auto';
  a.src = src;
  _preloadedAudio.set(src, a);
  return a;
}

// Warms whatever assets scene `i` needs, if that scene exists. Called both
// on boot and, from showScene(), one scene ahead of where the player
// actually is — so the *next* background/sfx is already downloaded and
// decoded well before it's needed, instead of starting cold on advance.
function preloadScene(i) {
  const s = scenes[i];
  if (!s) return;
  if (s.bg && s.bg !== 'blank') { // 'blank' is a solid color, not a file — nothing to preload
    const src = 'FC-MEDIA/' + s.bg;
    preloadImage(src).then(() => warmBackground(src));
  } else if (s.bgSequence) {
    const first = (Array.isArray(s.bgSequence) ? s.bgSequence : [s.bgSequence]).find(st => st.bg && st.bg !== 'blank');
    if (first) { const src = 'FC-MEDIA/' + first.bg; preloadImage(src).then(() => warmBackground(src)); }
  }
  if (s.bgSequence) {
    // Sequential, not parallel: these load in the order they're actually
    // needed, so the first step's image gets priority instead of splitting
    // bandwidth with later steps and risking a late hard-cut.
    (Array.isArray(s.bgSequence) ? s.bgSequence : [s.bgSequence]).reduce((chain, step) => {
      if (!step.bg || step.bg === 'blank') return chain;
      return chain.then(() => preloadImage('FC-MEDIA/' + step.bg));
    }, Promise.resolve());
  }
  if (s.sfx) preloadAudio('FC-MEDIA/' + s.sfx);
}

// A scene's `bg` is normally a filename, but `bg: 'blank'` is a special
// case meaning "plain black screen" rather than an image to load — no
// file, no decode, just a color. Resolving both shapes to the same
// {key, image, color} shape lets changeBackground/_doFade treat them
// identically everywhere else (dedupe, crossfade, pan/zoom drift).
function _resolveBg(newBg) {
  if (newBg === 'blank') return { key: 'blank', image: 'none', color: '#000' };
  return { key: `url('FC-MEDIA/${newBg}')`, image: `url('FC-MEDIA/${newBg}')`, color: '' };
}

function changeBackground(newBg, zoomGlide, skipFade, slideUp, onStart, onComplete, force, camera) {
  _clearGhostCanvas(); // drop any frozen ghostZoom frame — the background is changing for real
  const target = _resolveBg(newBg);
  // `force` skips the "already showing this" shortcut. Used by bgSequence
  // steps: within an explicit multi-step animation we always want this
  // step's image genuinely (re-)applied and its entrance motion genuinely
  // (re-)played, regardless of what currentBgUrl currently claims — if
  // that bookkeeping were ever stale (e.g. a scene restart mid-sequence),
  // the un-forced shortcut would fire onStart/onComplete without ever
  // touching the DOM, revealing whatever old image happened to still be
  // on screen instead of the intended one.
  if (!force && target.key === currentBgUrl) { if (onStart) onStart(); if (onComplete) onComplete(); return; }
  if (isFading) { pendingBg = { bg: newBg, zoomGlide, skipFade, slideUp, onStart, onComplete, force, camera }; return; }
  // Claim the fade slot *synchronously*, before the async decode below —
  // otherwise a second call that arrives while we're still decoding (e.g.
  // a bgSequence step's timer firing early) would see isFading still
  // false and race us instead of queuing behind us via pendingBg.
  isFading = true;
  currentBgUrl = target.key; // claim the target immediately so rapid re-calls (or a re-call while decoding) dedupe correctly
  if (newBg === 'blank') { _doFade(target, newBg, zoomGlide, skipFade, slideUp, onStart, onComplete, camera); return; } // no file to decode — fade straight to black
  // Decode before fading. In the rare cold-cache case this adds a beat of
  // latency before the fade *starts*, which reads as a clean pause — far
  // better than a fade that starts on time but stutters mid-flight while
  // the image is still decoding underneath it.
  preloadImage('FC-MEDIA/' + newBg).then(() => _doFade(target, newBg, zoomGlide, skipFade, slideUp, onStart, onComplete, camera));
}


// Resolves once every property in `propNames` has actually fired
// 'transitionend' on `el` — the real, browser-reported completion, rather
// than a setTimeout tuned to match the CSS duration. Under load (screen
// recording, a busy tab, a slow device) those two clocks can drift apart:
// the JS timer fires "on schedule" while the paint/transition hasn't
// visually caught up, so code gated on the timer runs against a frame
// that isn't there yet. `expectedMs` is only used for a generous safety-
// net timeout, in case a transitionend never fires (property already at
// its target value, transition interrupted, etc.) — without it a stalled
// transition would hang the caller forever.
function whenTransitionsDone(el, expectedMs, propNames) {
  return new Promise((resolve) => {
    let done = false;
    const remaining = new Set(propNames);
    function finish() {
      if (done) return;
      done = true;
      el.removeEventListener('transitionend', onEnd);
      resolve();
    }
    function onEnd(e) {
      if (e.target !== el || !remaining.has(e.propertyName)) return;
      remaining.delete(e.propertyName);
      if (remaining.size === 0) finish();
    }
    if (remaining.size === 0) { resolve(); return; }
    el.addEventListener('transitionend', onEnd);
    setTimeout(finish, expectedMs + 400);
  });
}

function _doFade(target, seedText, zoomGlide, skipFade, slideUp, onStart, onComplete, camera) {
  isFading = true;
  currentBgUrl = target.key;
  const resolvedCamera = _resolveCamera(camera, zoomGlide, slideUp);
  setTransition(bgLayer, 0);
  bgLayer.style.backgroundImage = target.image;
  bgLayer.style.backgroundColor = target.color;
  if (skipFade) {
    // Hard cut: there's no gradual opacity blend for bgBase to be seen
    // through, so there's no reason to leave it holding the *outgoing*
    // image for the whole glide (normally up to ~1.5s for a zoom/pan
    // camera move) — sync it to the same new image right away. That way,
    // even if the incoming layer's motion ever exposes a sliver of
    // whatever's underneath it, it's the same new image, not a stale
    // frame of the old one (which is exactly what let the previous
    // background peek through mid-glide before).
    setTransition(bgBase, 0);
    bgBase.style.backgroundImage = target.image;
    bgBase.style.backgroundColor = target.color;
  }
  const motion = computeBackgroundMotion(seedText || target.key, resolvedCamera);
  if (skipFade && motion.filterBase) bgBase.style.filter = motion.filterBase; // bgBase already shows the new image

  // Commit bgLayer's STARTING point for whichever properties are about to
  // animate — opacity (unless this is a hard cut) and transform (if a
  // camera move is active) — before building the transition that will
  // animate away from it.
  // For a real fade, park the layer at a hair above 0 (browsers skip painting
  // a fully transparent layer) so the new image's first raster/upload happens
  // *now*, invisibly, instead of inside the first frame of the transition —
  // that stall is the "freeze, then it suddenly fades in" effect.
  const needsWarmup = !skipFade && target.image !== 'none';
  bgLayer.style.opacity = skipFade ? '1' : (needsWarmup ? '0.001' : '0');
  bgLayer.style.transform = motion.startTransform || motion.restTransform || 'none';
  void bgLayer.offsetWidth; // commit the start state before animating away from it
  const startTransition = () => {

  // Both properties (when both apply) go into ONE `transition` declaration
  // set ONCE — assigning transition a second time overwrites the first
  // instead of adding to it, which used to mean a camera move only ever
  // actually animated on scenes that skipped the opacity crossfade
  // entirely. Combining them here also means a crossfading camera move no
  // longer has to be a hard cut: bgLayer eases in from opacity 0, so even
  // if the new image is still finishing its first paint (most likely
  // right after a cold reload, before the browser's image cache is warm),
  // that paint finishes somewhere under an invisible layer instead of
  // flashing through as a frame of black — bgBase keeps showing the
  // already-painted outgoing image right up until bgLayer is opaque
  // enough to hide any of that.
  const transitionParts = [];
  const watchProps = [];
  if (!skipFade) {
    transitionParts.push(`opacity ${CROSSFADE_MS}ms cubic-bezier(0.4,0,0.2,1)`);
    watchProps.push('opacity');
  }
  if (motion.startTransform) {
    transitionParts.push(`transform ${motion.glideMs}ms cubic-bezier(0.16, 1, 0.3, 1)`);
    watchProps.push('transform');
  }
  bgLayer.style.transition = transitionParts.length ? transitionParts.join(', ') : 'none';
  requestAnimationFrame(() => {
    if (!skipFade) bgLayer.style.opacity = '1';
    if (motion.startTransform) bgLayer.style.transform = motion.restTransform;
  });
  // The image is now applied and its entrance animation (if any) has just
  // kicked off — safe point for a caller (e.g. playBgSequence) to react:
  // reveal from black, or start counting a hold before the next step.
  if (onStart) onStart();
  // Normally the swap happens right after the opacity crossfade. With a
  // camera move active the transform keeps easing well past that, so the
  // swap is held open until the glide is done too — otherwise bgBase would
  // take over mid-ease and the motion would snap to rest instead of gliding.
  // Waiting on the real transitionend (rather than a setTimeout tuned to
  // CROSSFADE_MS/BG_ZOOM_GLIDE_MS/BG_SLIDE_UP_MS) keeps this correct even
  // when the browser is under enough load that paint lags behind the JS
  // clock — e.g. while screen recording.
  const fadeMs = skipFade ? 0 : CROSSFADE_MS;
  const glideMs = cameraGlideMs(resolvedCamera);
  const holdMs = glideMs ? Math.max(fadeMs, glideMs) : fadeMs;
  const settled = watchProps.length
    ? whenTransitionsDone(bgLayer, holdMs, watchProps)
    : new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))); // hard cut, nothing to watch — still wait a couple frames so the swap below can't outrun the paint of the cut itself
  settled.then(() => {
    setTransition(bgBase, 0);
    bgBase.style.backgroundImage = target.image;
    bgBase.style.backgroundColor = target.color;
    if (motion.filterBase) bgBase.style.filter = motion.filterBase;
    bgBase.style.opacity = '1';
    void bgBase.offsetWidth;
    setTransition(bgLayer, 0);
    bgLayer.style.opacity = '0';
    void bgLayer.offsetWidth;
    isFading = false;
    // Truly done — the motion (if any) has fully settled, not just started.
    if (onComplete) onComplete();
    if (pendingBg) { const p = pendingBg; pendingBg = null; changeBackground(p.bg, p.zoomGlide, p.skipFade, p.slideUp, p.onStart, p.onComplete, p.force, p.camera); }
    _flushWarm(); // fade is over — now it's safe to pre-raster whatever comes next
  });
  };
  if (needsWarmup) requestAnimationFrame(() => requestAnimationFrame(startTransition));
  else startTransition();
}


/* ── BACKGROUND SEQUENCES ────────────────────────────── */
// Lets a single scene fold what would otherwise be several click-through
// scenes into one automatic mini image-sequence: `bgSequence` is an array
// of steps, each shaped like a normal bg + its motion flags, e.g.
//   bgSequence: [
//     { bg: 'a.webp', zoomGlide: true, skipFade: true, holdMs: 200 },
//     { bg: 'b.webp', slideUp: true, skipFade: true },
//   ]
// Extra step types: `zoomThrough`, `fadeToBlack`, `fadeToWhite`, `ghostZoom` (push in on the
// current image with a trail of ghost frames, then pull back out) and
// `wipeUp` / `wipeDown` (soft bottom-to-top / top-to-bottom wipe into
// `bg`). See playGhostZoom / playWipe below; their visuals live in fc-theme.css.
// The first step plays immediately. Each subsequent step only starts once
// the previous one has *actually finished* (its glide settled, layers
// swapped) — never on a guessed timer — plus an optional extra pause
// (`holdMs`, default 0) after that real finish. The player never has to
// click between steps; the scene's own text/click advance is unaffected
// and layers on top as usual. `token` is this scene's sceneToken — if the
// player skips ahead before the sequence finishes, the stale steps
// quietly stop instead of bleeding into whatever scene is on screen now.
// Speed of the "fade to black" hide/reveal used by steps flagged with
// `fadeToBlack: true` — reuses the same #fade-overlay the rest of the
// engine uses for page-level fades, just with a faster inline duration.
const BG_BLACK_FADE_MS = 500;

// Durations/scale for `zoomThrough: true` steps — see playZoomThrough
// below. Deliberately much slower than the ordinary camera presets: this
// is meant to read as a deliberate push, not a quick cut.
const ZOOM_THROUGH_IN_MS  = 1600; // push into the OUTGOING image
const ZOOM_THROUGH_OUT_MS = 1600; // pull back out on the INCOMING image
const ZOOM_THROUGH_SCALE  = 3.4;  // how "fully in" the push goes before the swap

// A slower, more deliberate cousin of the plain camera zoom presets: push
// all the way into whatever's currently on screen until the frame is
// filled edge-to-edge with magnified detail, then crossfade into the new
// image at that peak WHILE pulling back out to its own normal resting
// pan/zoom — the two images blend into each other as the frame widens,
// like walking through a doorway into another room. Built for an entrance
// beat (a door, a threshold, "we're going in now") rather than an
// everyday scene change.
//
// Phase 1 (the push-in) animates bgBase directly, since there's nothing
// to blend yet — it's just closing in on the one image already on
// screen. Phase 2 (the pull-out) brings bgLayer in as the actual
// crossfade partner, starting invisible at that same peak scale and
// easing both its opacity and its transform at once. bgLayer is synced
// back to bgBase and parked hidden at the very end, so the next
// *ordinary* background change afterward has the same clean baseline
// (opacity 0, parked at rest) it always expects to start a crossfade from.
function playZoomThrough(step, token, onComplete) {
  const target = _resolveBg(step.bg);
  const inMs  = step.zoomThroughInMs  != null ? step.zoomThroughInMs  : ZOOM_THROUGH_IN_MS;
  const outMs = step.zoomThroughOutMs != null ? step.zoomThroughOutMs : ZOOM_THROUGH_OUT_MS;
  const peak  = step.zoomThroughScale != null ? step.zoomThroughScale : ZOOM_THROUGH_SCALE;

  isFading = true;
  currentBgUrl = target.key;

  // Phase 1: push the image ALREADY on screen (bgBase) in toward its own
  // center, all the way to `peak`, on an accelerating curve — leaning
  // into it rather than gliding.
  const curTransform = bgBase.style.transform || '';
  const peakTransform = /scale\([^)]*\)/.test(curTransform)
    ? curTransform.replace(/scale\([^)]*\)/, `scale(${peak})`)
    : `scale(${peak})`;
  setTransition(bgBase, 0);
  void bgBase.offsetWidth;
  bgBase.style.transition = `transform ${inMs}ms cubic-bezier(0.6,0,1,0.4)`;
  requestAnimationFrame(() => { bgBase.style.transform = peakTransform; });

  whenTransitionsDone(bgBase, inMs, ['transform']).then(() => {
    if (token !== sceneToken) return; // scene moved on — abandon mid-push
    preloadImage('FC-MEDIA/' + step.bg).then(() => {
      if (token !== sceneToken) return;
      // Phase 2+3, combined: bring the new image in as a genuine
      // crossfade instead of a jump-cut swap, WHILE pulling back out —
      // bgLayer starts invisible at the exact peak scale bgBase is
      // frozen at, then eases both its opacity up to 1 and its transform
      // back down to the new image's own resting pan/zoom over the same
      // span. The two images blend into each other as the frame widens,
      // rather than cutting at the peak and then pulling back on
      // already-new content.
      const rest = restStateFor(step.bg);
      setTransition(bgLayer, 0);
      bgLayer.style.backgroundImage = target.image;
      bgLayer.style.backgroundColor = target.color;
      bgLayer.style.filter = rest.filterLayer;
      bgLayer.style.opacity = '0';
      bgLayer.style.transform = peakTransform; // same peak bgBase is sitting at, so it starts perfectly aligned
      void bgLayer.offsetWidth; // commit the start state before animating away from it
      bgLayer.style.transition = `opacity ${outMs}ms cubic-bezier(0.4,0,0.2,1), transform ${outMs}ms cubic-bezier(0,0.55,0.35,1)`;
      requestAnimationFrame(() => {
        bgLayer.style.opacity = '1';
        bgLayer.style.transform = rest.restTransform;
      });

      whenTransitionsDone(bgLayer, outMs, ['opacity', 'transform']).then(() => {
        if (token !== sceneToken) return;
        // Settle: bgBase takes over holding the new image (so it's the
        // one "underneath" for whatever comes next) and bgLayer is
        // parked back in the same hidden baseline an ordinary crossfade
        // always leaves it in — so the next background change, whatever
        // it is, starts clean.
        setTransition(bgBase, 0);
        bgBase.style.backgroundImage = target.image;
        bgBase.style.backgroundColor = target.color;
        bgBase.style.filter = rest.filterBase;
        bgBase.style.transform = rest.restTransform;
        void bgBase.offsetWidth;

        setTransition(bgLayer, 0);
        bgLayer.style.opacity = '0';
        bgLayer.style.transform = rest.restTransform;
        void bgLayer.offsetWidth;
        isFading = false;
        if (onComplete) onComplete();
        if (pendingBg) { const p = pendingBg; pendingBg = null; changeBackground(p.bg, p.zoomGlide, p.skipFade, p.slideUp, p.onStart, p.onComplete, p.force, p.camera); }
      });
    });
  });
}

// ── ghostZoom / wipeUp / wipeDown steps ────────────────────────────────────────
// Three more bgSequence step types (see the list at the top of this section):
//
//   { ghostZoom: true }
//       Slow push-in on the image ALREADY on screen, drawn on a canvas
//       over it (bgBase itself is never scaled). "Ghost frames" — faint
//       echoes of the picture at the smaller scale the zoom had a few
//       frames earlier — trail behind the live frame, flaring out in a
//       last quick lunge at the peak. Then it pulls back out to rest
//       (echoes now lag at the larger scales). Doesn't change the image.
//       Optional: zoomPeak, zoomInMs, peakHoldMs (the lunge), zoomOutMs.
//       zoomOutMs: 0 skips the pull-out and stays pushed in — use it right
//       before a fadeToWhite / fadeToBlack step.
//
//   { bg: 'x.png', wipeUp: true }
//       Seamless bottom-to-top wipe into x.png: a soft-edged mask (see
//       .bg-wipe-up in fc-theme.css) rises up the incoming layer, so the
//       new image simply "fills in" over the old one — no bar, no slash.
//       Optional: wipeMs.
//
//   { bg: 'x.png', wipeDown: true }
//       Same soft mix-wipe, mirrored: fills in from the TOP edge downward.
const GHOST_ZOOM_PEAK    = 1.34;
const GHOST_ZOOM_IN_MS   = 2400;
const GHOST_PEAK_HOLD_MS = 420;
const GHOST_ZOOM_OUT_MS  = 1500;
const BG_WIPE_MS      = 1400;

const _sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function _scaleOf(el) {
  const t = getComputedStyle(el).transform;
  if (!t || t === 'none') return 1;
  try { return new DOMMatrix(t).a || 1; } catch (e) { return 1; }
}

// Resolves true/false: did this image load AND decode? (preloadImage
// deliberately resolves either way, which is right for ordinary fades but
// would let a wipe reveal a missing file as a black screen.) The Image
// objects are kept in a map so the browser has no reason to drop their
// decoded pixels before the wipe needs them — a big full-screen PNG that
// has to be re-decoded at the moment of a layer swap is what shows up as a
// black flash, and only some of the time.
const _wipeImgs = new Map();
function _decodeImage(src) {
  let img = _wipeImgs.get(src);
  if (!img) { img = new Image(); img.src = src; _wipeImgs.set(src, img); }
  if (img.decode) return img.decode().then(() => true, () => false);
  return new Promise((resolve) => {
    if (img.complete) return resolve(img.naturalWidth > 0);
    img.onload  = () => resolve(true);
    img.onerror = () => resolve(false);
  });
}

// Resolves once no other background fade is in flight (or the scene moved
// on, or after maxMs). Lets our steps start from a clean, settled state:
// a previous scene's fade that's still finishing would otherwise reset
// bgBase/bgLayer out from under us mid-zoom or mid-wipe.
function _waitIdle(token, maxMs) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const tick = () => {
      if (token !== sceneToken || !isFading || performance.now() - t0 > (maxMs || 5000)) return resolve();
      setTimeout(tick, 40);
    };
    tick();
  });
}

// ── ghostZoom: push-in with a trail of ghost frames ──────────────────
// The whole effect is drawn on ONE canvas that sits on top of bgBase inside
// #bg-drift. bgBase itself is never transformed, so the real background is
// untouched underneath the effect the entire time — if anything about the
// canvas can't run, the player just sees the normal image, never black.
// (Earlier versions scaled bgBase itself and stacked a DOM layer per ghost;
// big scaled, animated, filtered full-screen layers were the likely reason
// the screen dropped to black on some machines.)
//
// A ghost frame is the image as it was a moment ago in the zoom: same
// picture, same centre, at the smaller (on the way in) or larger (on the
// way out) scale the camera had a few frames earlier, drawn faintly over
// the live frame. Because the zoom is a pure function of elapsed time, an
// echo is just that function evaluated a little in the past.
const GHOST_TRAIL_COUNT  = 4;    // echoes behind the live frame (each one is another full-canvas blit per frame)
const GHOST_TRAIL_LAG_MS = 100;  // time between one echo and the next
const GHOST_TRAIL_ALPHA  = 0.32; // opacity of the nearest echo (later ones fade)
const GHOST_LUNGE        = 1.05; // the last quick lunge past the peak
const GHOST_SETTLE_MS    = 300;  // let the echoes catch up before the next step

const _easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
const _easeOut   = (p) => 1 - Math.pow(1 - p, 3);

function _ghostCanvas() {
  let c = document.getElementById('bg-ghost-canvas');
  if (!c) {
    c = document.createElement('canvas');
    c.id = 'bg-ghost-canvas';
    bgDrift.appendChild(c);
  }
  return c;
}

// Removes the effect frame (if any). Called from changeBackground so that
// whenever the background changes for real — e.g. under the white of a
// fadeToWhite — the frozen zoom frame goes with it.
function _clearGhostCanvas() {
  const c = document.getElementById('bg-ghost-canvas');
  if (!c) return;
  c.style.transition = 'none';
  c.style.opacity = '0';
  const ctx = c.getContext && c.getContext('2d');
  if (ctx) ctx.clearRect(0, 0, c.width, c.height);
}

function playGhostZoom(step, token, onComplete) {
  const peak   = step.zoomPeak   != null ? step.zoomPeak   : GHOST_ZOOM_PEAK;
  const inMs   = step.zoomInMs   != null ? step.zoomInMs   : GHOST_ZOOM_IN_MS;
  const lungeMs = step.peakHoldMs != null ? step.peakHoldMs : GHOST_PEAK_HOLD_MS;
  const outMs  = step.zoomOutMs  != null ? step.zoomOutMs  : GHOST_ZOOM_OUT_MS;
  const holdZoomed = outMs <= 0; // zoomOutMs: 0 -> stay pushed in and hand straight to the next step (e.g. fadeToWhite)
  const alive = () => token === sceneToken;

  // Camera scale as a pure function of elapsed ms.
  const top = peak * GHOST_LUNGE;
  const tIn = inMs, tLunge = tIn + lungeMs, tSettle = tLunge + GHOST_SETTLE_MS;
  const tEnd = holdZoomed ? tSettle : tSettle + outMs;
  const scaleAt = (t) => {
    if (t <= 0) return 1;
    if (t < tIn) return 1 + (peak - 1) * _easeInOut(t / tIn);
    if (t < tLunge) return peak + (top - peak) * _easeOut((t - tIn) / lungeMs);
    if (t < tSettle) return top;
    return top + (1 - top) * _easeInOut(Math.min(1, (t - tSettle) / outMs));
  };

  const bail = () => { _clearGhostCanvas(); isFading = false; };

  (async () => {
    try {
      await _waitIdle(token);
      if (!alive()) return;
      isFading = true;

      // Get the exact image bgBase is showing, decoded and ready to draw.
      const m = /url\(["']?(.*?)["']?\)/.exec(getComputedStyle(bgBase).backgroundImage || '');
      const src = m && m[1];
      const decoded = src ? await _decodeImage(src) : false;
      if (!alive()) return bail();
      const img = decoded ? _wipeImgs.get(src) : null;
      const canvas = _ghostCanvas();
      // alpha:false = an opaque canvas, which browsers can blit noticeably faster;
      // the live frame below covers every pixel, so nothing needs clearing.
      const ctx = img && canvas.getContext && canvas.getContext('2d', { alpha: false });
      if (!ctx) {
        // Can't draw the effect — keep the pacing, show the normal image.
        console.warn('[ghostZoom] canvas effect unavailable; skipping the zoom.');
        await _sleep(tEnd);
        if (!alive()) return bail();
        isFading = false;
        if (onComplete) onComplete();
        return;
      }

      // Pre-render the cover-fitted picture once, a bit over-sampled so it
      // stays sharp at peak zoom; every frame then just blits this.
      const dpr = 1; // 1 canvas pixel per CSS pixel: a moving, ghosted image doesn't need retina resolution, and it's 2-4x fewer pixels to push each frame
      const cw = Math.max(1, bgDrift.clientWidth), ch = Math.max(1, bgDrift.clientHeight);
      const OVER = 1.25;
      const off = document.createElement('canvas');
      off.width = Math.ceil(cw * dpr * OVER);
      off.height = Math.ceil(ch * dpr * OVER);
      const octx = off.getContext('2d');
      // Bake bgBase's brightness into the pre-rendered picture ONCE. (Setting
      // ctx.filter on every blit, every frame, is very slow.)
      const filt = getComputedStyle(bgBase).filter;
      if (filt && filt !== 'none') octx.filter = filt;
      const fit = Math.max(off.width / img.naturalWidth, off.height / img.naturalHeight);
      const dw = img.naturalWidth * fit, dh = img.naturalHeight * fit;
      octx.drawImage(img, (off.width - dw) / 2, (off.height - dh) / 2, dw, dh);

      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const drawAt = (s) => ctx.drawImage(off, cw / 2 - (cw * s) / 2, ch / 2 - (ch * s) / 2, cw * s, ch * s);
      const draw = (t) => {
        const cur = scaleAt(t);
        ctx.globalAlpha = 1;
        drawAt(cur); // the live frame (opaque, covers the whole canvas — no clear needed)
        for (let k = GHOST_TRAIL_COUNT; k >= 1; k--) { // ghost frames: the same picture, k steps back in the zoom
          const s = scaleAt(t - k * GHOST_TRAIL_LAG_MS);
          if (Math.abs(s - cur) < 0.004) continue;    // still sitting on the live frame — nothing to see yet
          ctx.globalAlpha = GHOST_TRAIL_ALPHA * (1 - (k - 1) / GHOST_TRAIL_COUNT);
          drawAt(s);
        }
        ctx.globalAlpha = 1;
      };

      draw(0); // first frame == what bgBase already shows, so fade the canvas in quickly to hide any resampling difference
      canvas.style.transition = 'opacity 120ms linear';
      canvas.style.opacity = '1';

      const outcome = await new Promise((resolve) => {
        const t0 = performance.now();
        const frame = (now) => {
          if (!alive()) return resolve('abort');
          const t = now - t0;
          draw(Math.min(t, tEnd));
          if (t >= tEnd) return resolve('done');
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
      if (outcome === 'abort') return bail();

      if (holdZoomed) {
        // Leave the pushed-in frame up. The next step (fadeToWhite/Black)
        // changes the background under its cover, and changeBackground
        // clears this canvas at that moment.
        isFading = false;
        if (onComplete) onComplete();
        return;
      }

      // Back at rest: the last frame matches bgBase, so fade out gently.
      canvas.style.transition = 'opacity 200ms linear';
      canvas.style.opacity = '0';
      await _sleep(230);
      if (!alive()) return bail();
      _clearGhostCanvas();
      isFading = false;
      if (onComplete) onComplete();
    } catch (err) {
      // Never leave the player stuck or on a broken frame.
      console.error('[ghostZoom]', err);
      bail();
      if (alive() && onComplete) onComplete();
    }
  })();
}

function playWipe(step, token, onComplete, dir) {
  const target = _resolveBg(step.bg);
  const ms = step.wipeMs != null ? step.wipeMs : BG_WIPE_MS;
  _waitIdle(token).then(() => {
    if (token !== sceneToken) return;
    isFading = true;
    return _decodeImage('FC-MEDIA/' + step.bg);
  }).then((ok) => {
    if (ok === undefined) return; // scene moved on before we started
    if (token !== sceneToken) { isFading = false; return; }
    if (!ok) {
      // Never wipe to a missing file — that would just be a black screen.
      console.error('[wipe] could not load FC-MEDIA/' + step.bg + ' — skipping the wipe and keeping the current image.');
      isFading = false;
      if (onComplete) onComplete();
      return;
    }
    currentBgUrl = target.key;
    const rest = restStateFor(step.bg);

    // Arm the incoming layer: image on, mask class on (starts fully masked
    // out), THEN make it visible — never a frame where it's unmasked.
    setTransition(bgLayer, 0);
    bgLayer.style.backgroundImage = target.image;
    bgLayer.style.backgroundColor = target.color;
    bgLayer.style.filter = rest.filterLayer;
    bgLayer.style.transform = rest.restTransform;
    bgLayer.style.setProperty('--wipe-ms', ms + 'ms');
    bgLayer.classList.add('bg-wipe-' + dir);
    void bgLayer.offsetWidth;
    bgLayer.style.opacity = '1';

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      bgLayer.removeEventListener('animationend', onEnd);
      // Put the finished image on bgBase *underneath* bgLayer, drop the
      // mask (bgLayer is now just the full image, identical to bgBase),
      // and only hide bgLayer once bgBase has had two frames to paint it.
      // Hiding it in the same frame is what could flash black whenever
      // bgBase's copy of a big image wasn't ready yet.
      setTransition(bgBase, 0);
      bgBase.style.backgroundImage = target.image;
      bgBase.style.backgroundColor = target.color;
      bgBase.style.filter = rest.filterBase;
      bgBase.style.transform = rest.restTransform;
      bgLayer.classList.remove('bg-wipe-' + dir);
      bgLayer.style.removeProperty('--wipe-ms');
      bgLayer.style.transform = rest.restTransform;
      void bgLayer.offsetWidth;
      let parked = false;
      const park = () => {
        if (parked) return;
        parked = true;
        bgLayer.style.opacity = '0';
        void bgLayer.offsetWidth;
        isFading = false;
        if (onComplete) onComplete();
        if (pendingBg) { const p = pendingBg; pendingBg = null; changeBackground(p.bg, p.zoomGlide, p.skipFade, p.slideUp, p.onStart, p.onComplete, p.force, p.camera); }
      };
      requestAnimationFrame(() => requestAnimationFrame(park));
      setTimeout(park, 160); // rAF doesn't fire in a hidden tab — don't stall there
    };
    const onEnd = (e) => { if (e.animationName === 'fc-wipe-' + dir) finish(); };
    bgLayer.addEventListener('animationend', onEnd);
    setTimeout(finish, ms + 500); // safety net if animationend never fires
  });
}

function playBgSequence(seq, token, onComplete) {
  if (seq && !Array.isArray(seq)) seq = [seq]; // tolerate `bgSequence: { ... }` for a single step
  if (!seq || !seq.length) { if (onComplete) onComplete(); return; }
  let idx = 0;
  const playStep = () => {
    if (token !== sceneToken) return; // scene moved on — abandon the rest of the sequence
    const step = seq[idx];
    const isLast = idx === seq.length - 1;

    // Fires once THIS step has truly finished (its glide has settled, the
    // layers have swapped, isFading is back to false) — this is the ONLY
    // thing that schedules the next step. Earlier this scheduled off
    // "applied" (image decoded/motion just started) using a hand-tuned
    // holdMs meant to roughly match the glide duration — but that's a
    // guess racing the real completion timer, and any drift between them
    // (slow decode, a slightly-off holdMs) let the next step's
    // changeBackground call land while this one was still mid-fade,
    // producing exactly the "reveals the old image, then hard-cuts to the
    // next one already half-animated" glitch. Chaining off the real
    // completion signal instead makes that race impossible: there's
    // nothing left to race against.
    const onStepComplete = () => {
      if (token !== sceneToken) return;
      if (isLast) { if (onComplete) onComplete(); return; }
      idx++;
      const nextStep = seq[idx];
      // holdMs is a pause *after* this step fully settles, not a guess at
      // how long settling takes — 0/omitted means move on immediately once
      // it's done. `immediate: true` on the UPCOMING step overrides that
      // and forces a zero-length hold regardless of what the step that
      // just finished asked for — the choice to skip standby lives with
      // whichever step actually cares about not sitting on one (typically
      // a zoomThrough step, where any pause right before the push-in reads
      // as a stall rather than a beat).
      const holdMs = (nextStep && nextStep.immediate) ? 0 : (step.holdMs != null ? step.holdMs : 0);
      setTimeout(playStep, holdMs);
    };

    if (step.zoomThrough) {
      playZoomThrough(step, token, onStepComplete);
    } else if (step.ghostZoom) {
      playGhostZoom(step, token, onStepComplete);
    } else if (step.wipeUp) {
      playWipe(step, token, onStepComplete, 'up');
    } else if (step.wipeDown) {
      playWipe(step, token, onStepComplete, 'down');
    } else if (step.fadeToBlack || step.fadeToWhite) {
      // Hide the outgoing image under black, swap underneath the cover
      // (skipFade on the step avoids a redundant crossfade nobody sees),
      // then reveal — any camera move (step.camera / zoomGlide / slideUp)
      // keeps animating underneath the reveal, so it's already moving as
      // it appears. Uses #bg-black-cover (background layer only) rather
      // than #fade-overlay, so the dialogue box/UI stay visible throughout
      // — falls back to the full-screen overlay if an older page doesn't
      // have #bg-black-cover in its markup yet.
      // fadeToWhite is the same move with a white cover; `fadeMs` on the
      // step overrides the fade length in both directions.
      const cover = step.fadeToWhite ? bgWhiteCover : (bgBlackCover || fadeOverlay);
      const fadeMs = step.fadeMs != null ? step.fadeMs : BG_BLACK_FADE_MS;
      cover.style.transition = `opacity ${fadeMs}ms ease`;
      void cover.offsetWidth;
      cover.style.opacity = '1';
      // Waiting for the cover's real transitionend (not a setTimeout tuned
      // to BG_BLACK_FADE_MS) means the swap only happens once the screen
      // is genuinely, visibly fully black — under load (screen recording,
      // a busy tab) a fixed timer can fire before the paint catches up,
      // which is exactly what let the old image peek through before.
      whenTransitionsDone(cover, fadeMs, ['opacity']).then(() => {
        if (token !== sceneToken) return;
        changeBackground(step.bg, step.zoomGlide, step.skipFade, step.slideUp, () => {
          if (token !== sceneToken) return;
          requestAnimationFrame(() => {
            if (token !== sceneToken) return;
            cover.style.transition = `opacity ${fadeMs}ms ease`;
            cover.style.opacity = '0';
          });
        }, onStepComplete, true, step.camera);
      });
    } else {
      changeBackground(step.bg, step.zoomGlide, step.skipFade, step.slideUp, null, onStepComplete, true, step.camera);
    }
  };
  playStep();
}



// Builds one small dot per scene along the top progress bar. Called once,
// when a page first loads, from FC_start() below.
function buildDots() {
  dotsEl.innerHTML = '';
  for (let i = 0; i < scenes.length; i++) {
    const d = document.createElement('div');
    d.className = 'pdot';
    dotsEl.appendChild(d);
  }
}

/* ── TYPEWRITER ──────────────────────────────────────── */
// Reveals dialogue one character at a time, like most visual novels do,
// instead of showing the whole line instantly. getTypingDelay() below
// slows down slightly on punctuation so it reads more like natural speech.
const TYPING_SPEED = 14;
let index = 0, isTyping = false, typingTimeout = null, currentFullText = '';
let isAdvancing = false; // true from showScene() start until typeText() actually begins — blocks input + freezes vignette

function getTypingDelay(ch) {
  if (/[,.!?]/.test(ch)) return TYPING_SPEED * 3;
  if (/[:;]/.test(ch)) return TYPING_SPEED * 2;
  if (/\s/.test(ch)) return Math.max(8, TYPING_SPEED - 4);
  return TYPING_SPEED;
}

/* ── KEYBINDING SYSTEM ──────────────────────────────────
   Lets the player change which key (or mouse click) triggers "advance".
   Bindings are stored in localStorage under KEYBIND_KEY. isBoundCode()
   below is the function everything else calls to ask "is this key/click
   currently mapped to this action?" */
const KEYBIND_KEY = 'fc_keybinds';
const KEYBIND_ACTIONS = [
  { id: 'advance', label: 'Advance / Continue' }
];
// Internal key codes we store: 'Mouse0' for left click, otherwise e.code values.
const KEYBIND_DEFAULTS = {
  advance: ['Mouse0', 'KeyZ', 'Space', 'Enter', 'NumpadEnter', 'ArrowDown']
};
const KEYBIND_DISPLAY = {
  Mouse0: 'Click', KeyZ: 'Z', Space: 'Space', Enter: 'Enter',
  NumpadEnter: 'Num ⏎', ArrowDown: '↓', ArrowUp: '↑', ArrowLeft: '←', ArrowRight: '→',
  Escape: 'Esc'
};
function kbDisplayName(code) {
  if (KEYBIND_DISPLAY[code]) return KEYBIND_DISPLAY[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  return code;
}
function loadKeybinds() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEYBIND_KEY) || '{}');
    const merged = {};
    KEYBIND_ACTIONS.forEach(a => {
      merged[a.id] = Array.isArray(raw[a.id]) && raw[a.id].length ? raw[a.id] : KEYBIND_DEFAULTS[a.id].slice();
    });
    return merged;
  } catch (e) {
    const d = {}; KEYBIND_ACTIONS.forEach(a => d[a.id] = KEYBIND_DEFAULTS[a.id].slice()); return d;
  }
}
function saveKeybinds(kb) { localStorage.setItem(KEYBIND_KEY, JSON.stringify(kb)); }
window.FC_KEYBINDS = loadKeybinds();

function isBoundCode(actionId, code) {
  const kb = window.FC_KEYBINDS || {};
  return Array.isArray(kb[actionId]) && kb[actionId].indexOf(code) !== -1;
}

document.addEventListener('click', (e) => {
  if (contentWarningOpen) return; // the content-warning dialog handles its own buttons
  if (e.target.closest('#pause-menu') || e.target.closest('#mobile-menu-btn')) return;
  if (e.button !== undefined && e.button !== 0) return;
  if (!isBoundCode('advance', 'Mouse0')) return;
  advance();
});

/* ── CONTENT WARNING ──────────────────────────────────────
   Any scene can opt in to a "this passage contains adult content"
   interstitial by adding a `contentWarning` field to its object in the
   scenes array:

     { ..., contentWarning: true, text: `...` }

   Use a string instead of `true` to override the default message:

     { ..., contentWarning: "This scene contains a graphic injury.", text: `...` }

   Choosing "Yes, skip it" fades out and jumps straight to NEXT_FILE
   (skipping the rest of this page). Choosing "No" dismisses the dialog
   and the scene plays normally. The whole thing is self-contained here
   — the modal markup/CSS is built once on first use, so no HTML edits
   are needed on any scene page. */
const CW_DEFAULT_MESSAGE = 'This passage contains adult content. Would you like to skip it?';
let contentWarningOpen = false;
let cwBackdrop = null;

function buildContentWarningModal() {
  if (cwBackdrop) return cwBackdrop;
  cwBackdrop = document.createElement('div');
  cwBackdrop.id = 'cw-backdrop';
  cwBackdrop.innerHTML = `
    <div id="cw-modal" role="alertdialog" aria-modal="true" aria-labelledby="cw-modal-title">
      <div id="cw-modal-icon">&#9888;</div>
      <div id="cw-modal-title">Content Warning</div>
      <div id="cw-modal-text"></div>
      <div id="cw-modal-actions">
        <button type="button" class="cw-btn cw-btn-no" id="cw-btn-no">No, continue</button>
        <button type="button" class="cw-btn cw-btn-yes" id="cw-btn-yes">Yes, skip</button>
      </div>
    </div>`;
  cwBackdrop.style.display = 'none';
  document.body.appendChild(cwBackdrop);
  return cwBackdrop;
}

function openContentWarning(scene, i) {
  contentWarningOpen = true;
  isAdvancing = true; // reuse the existing "ignore input" gate while the dialog is up
  const modal = buildContentWarningModal();
  modal.querySelector('#cw-modal-text').textContent =
    typeof scene.contentWarning === 'string' ? scene.contentWarning : CW_DEFAULT_MESSAGE;
  modal.style.display = 'flex';

  const btnYes = modal.querySelector('#cw-btn-yes');
  const btnNo  = modal.querySelector('#cw-btn-no');

  const cleanup = () => {
    modal.style.display = 'none';
    btnYes.onclick = null;
    btnNo.onclick = null;
    contentWarningOpen = false;
    isAdvancing = false;
  };

  btnYes.onclick = () => {
    // Don't call cleanup()'s isAdvancing reset here — the page is navigating
    // away, so there's nothing left to "resume" input for.
    modal.style.display = 'none';
    contentWarningOpen = false;
    fadeOverlay.style.opacity = 1;
    fadeOutAudio(800);
    setTimeout(() => { window.location.href = fcResolveNext(NEXT_FILE); }, 800);
  };

  btnNo.onclick = () => {
    scene._cwCleared = true; // don't re-show the dialog if showScene(i) runs again for this same scene
    cleanup();
    showScene(i);
  };
}

/* ── BOOT ──────────────────────────────────────────────
   showScene(i) is the heart of the engine: given a scene index, it puts
   everything on screen — background, music, portraits, and (once the
   portrait has finished appearing) the dialogue text itself. */
const metaLocation     = document.getElementById('meta-location');

// Scenes can involve async work (an image loading, a delayed portrait
// swap). If the player advances again before that finishes, the old
// callback shouldn't still be allowed to affect the screen. sceneToken
// is a simple "ticket" system for that: each showScene() call grabs the
// current number, and any callback it schedules checks that number is
// still the latest before touching anything.
let sceneToken = 0;

function showScene(i) {
  const scene = scenes[i];
  if (scene.contentWarning && !scene._cwCleared) {
    openContentWarning(scene, i);
    return;
  }
  const myToken = ++sceneToken; // this call "owns" the token until a newer one replaces it
  isAdvancing = true;

  // A scene can name one or more characters as newly introduced here
  // (see scene.introduces in the scenes array). First time we see each
  // one, add it to the codex and pop the "Character Data Added" toast.
  if (scene.introduces && scene.introduces.length) {
    scene.introduces.forEach(unlockCharacter);
  }
  document.body.classList.remove('portrait-transitioning'); // clear any stale veil left by a superseded scene
  updateProgress(i);
  // Scenes with a bgSequence keep input locked (see isAdvancing below)
  // until the whole sequence has actually finished playing — not just
  // started — so the player can't click through mid-animation.
  let bgSequenceDone = null;
  if (scene.bgSequence) {
    bgSequenceDone = new Promise((resolve) => playBgSequence(scene.bgSequence, myToken, resolve));
  } else if (scene.bg) {
    changeBackground(scene.bg, scene.bgZoomGlide, scene.bgSkipFade, scene.bgSlideUp, undefined, undefined, undefined, scene.bgCamera);
  }
  if (scene.music !== undefined) changeMusic(scene.music);
  if (scene.sfx) {
    // Play from the primed element when we have one (already downloaded,
    // sometimes already decoded) via cloneNode, so a sfx cue landing on the
    // same beat as a background crossfade isn't also kicking off a cold
    // fetch of its own right then. Falls back to a plain new Audio() if
    // this sfx was never preloaded (e.g. a scene overriding showScene).
    const src = 'FC-MEDIA/' + scene.sfx;
    const primed = preloadAudio(src);
    const sfx = primed.readyState > 0 ? primed.cloneNode() : new Audio(src);
    sfx.volume = bgm.volume > 0 ? Math.min(1, bgm.volume * 1.2) : 0.7;
    sfx.play().catch(() => {});
  }
  // Warm next scene's background/sfx now, while this scene is on screen and
  // there's no time pressure, instead of starting cold the moment the
  // player advances into it.
  preloadScene(i + 1);
  if (scene.location) metaLocation.textContent = '\u{1F4CD} ' + scene.location;
  if (scene.character) {
    charName.textContent = scene.character;
    charName.classList.add('visible');
  } else {
    charName.textContent = '';
    charName.classList.remove('visible');
  }
  // ── Multi-portrait routing ──
  const srcsX = [
    scene.portrait1 || scene.portrait || scene.standingPortrait || '',
    scene.portrait2 || '',
    scene.portrait3 || '',
  ];
  portraitWrap.setAttribute('data-count', Math.max(1, srcsX.filter(s=>!!s).length));

  // Track whether any portrait is actually changing this scene — if so,
  // we delay the dialogue text so the character visibly appears first.
  let portraitChanged = false;
  const pendingLoads = []; // promises that resolve once each new portrait image has actually loaded (or failed/timed out)

  srcsX.forEach((src, i) => {
    const st = portraitSlots[i];
    if (src) {
      const newSrc = 'FC-CHAR/' + src;
      if (st.current === newSrc && st.slot.classList.contains('active')) return;
      portraitChanged = true;
      st.current = newSrc;
      const nxt = st.active === 'a' ? st.imgB : st.imgA;
      const cur = st.active === 'a' ? st.imgA : st.imgB;

      const loadPromise = new Promise((resolve) => {
        let settled = false;
        const settle = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        // Safety net: never block the scene forever if an image is slow, missing, or cached oddly.
        const fallback = setTimeout(settle, 1200);
        nxt.onload = () => { clearTimeout(fallback); settle(); };
        nxt.onerror = () => { clearTimeout(fallback); settle(); };
        nxt.src = newSrc;
        // If the browser already has this image fully decoded (cache hit), `complete` may
        // already be true before onload would ever fire — handle that case immediately.
        if (nxt.complete && nxt.naturalWidth > 0) { clearTimeout(fallback); settle(); }
      }).then(() => new Promise((resolveFade) => {
        if (sceneToken !== myToken) { resolveFade(); return; } // a newer scene has since taken over — don't apply a stale fade-in
        nxt.classList.add('shown'); cur.classList.remove('shown');
        st.active = st.active === 'a' ? 'b' : 'a';
        st.slot.classList.add('active');
        portraitWrap.classList.add('active');
        // Hold the veil (vignette/text/input) until the portrait's own CSS fade-in
        // (.portrait-layer transition: opacity 0.38s) has actually finished playing,
        // not just until the image bytes arrived — otherwise the veil lifts mid-fade.
        setTimeout(resolveFade, 380);
      }));
      pendingLoads.push(loadPromise);
    } else {
      st.slot.classList.remove('active');
      if (!srcsX.some(s => !!s)) portraitWrap.classList.remove('active');
      setTimeout(() => {
        if (sceneToken !== myToken) return; // scene moved on — don't clear a slot that belongs to a newer scene
        st.imgA.classList.remove('shown'); st.imgA.src = '';
        st.imgB.classList.remove('shown'); st.imgB.src = '';
        st.active = 'a'; st.current = '';
      }, 450);
    }
  });

  if (portraitChanged) {
    document.body.classList.add('portrait-transitioning');
    // The vignette/text veil itself takes 550ms to fully fade OUT once this class is
    // added (#bg-vignette/#bg-light-sweep transition: 0.55s). If we remove the class
    // before that fade-out has finished, the veil immediately reverses direction and
    // fades back in early. So the veil must stay up for at least its own fade-out
    // duration, in addition to however long the portrait actually takes to load +
    // fade in. Whichever is longer wins.
    const veilSettleTime = new Promise((resolve) => setTimeout(resolve, 550));
    const waitList = [veilSettleTime, ...pendingLoads];
    if (bgSequenceDone) waitList.push(bgSequenceDone); // also hold input until the bg animation has actually finished
    Promise.all(waitList).then(() => {
      if (sceneToken !== myToken) return; // a later scene already moved past this one
      // Beat: let the portrait sit fully visible, on its own, for a moment before the
      // veil starts lifting — the reveal should read as "character has arrived, THEN
      // the scene opens back up," not as one motion blending into the next.
      setTimeout(() => {
        if (sceneToken !== myToken) return; // a later scene already moved past this one
        document.body.classList.remove('portrait-transitioning');
        isAdvancing = false;
        typeText(scene.text);
      }, 220);
    });
  } else if (bgSequenceDone) {
    // No portrait to wait on, but this scene's background is still
    // animating — keep input locked (advance() checks isAdvancing) until
    // the bg sequence genuinely finishes, not just starts.
    bgSequenceDone.then(() => {
      if (sceneToken !== myToken) return;
      isAdvancing = false;
      typeText(scene.text);
    });
  } else {
    isAdvancing = false;
    typeText(scene.text);
  }

  // ── Delayed in-scene portrait swap (e.g. a fleeting expression that
  // settles back to neutral) — crossfades the same slot's A/B layers
  // exactly like a normal portrait change, but without touching the
  // dialogue text or the portrait-transitioning veil.
  if (scene.portraitSwap) {
    const { slot: slotNum, to, delay } = scene.portraitSwap;
    const st = portraitSlots[slotNum - 1];
    const sceneAtSwap = i;
    setTimeout(() => {
      if (index !== sceneAtSwap || sceneToken !== myToken) return; // scene moved on — abandon the swap
      const newSrc = 'FC-CHAR/' + to;
      if (st.current === newSrc) return;
      st.current = newSrc;
      const nxt = st.active === 'a' ? st.imgB : st.imgA;
      const cur = st.active === 'a' ? st.imgA : st.imgB;
      nxt.onload = () => {
        if (index !== sceneAtSwap || sceneToken !== myToken) return;
        nxt.classList.add('shown'); cur.classList.remove('shown');
        st.active = st.active === 'a' ? 'b' : 'a';
      };
      nxt.src = newSrc;
      if (nxt.complete && nxt.naturalWidth > 0) { nxt.onload(); }
    }, delay || 1200);
  }
}

// Fewer lines are grouped together before the box clears when the player
// is on a bigger text size — keeps 'large' comfortably large without the
// box needing to shrink it back down to fit three lines at once.
function currentGroupSize() {
  const map = { small: 4, normal: 3, large: 2 };
  const key = (window.FC_SETTINGS && window.FC_SETTINGS.textSize) || 'normal';
  return map[key] || 3;
}
let groupLines = [];

function renderGroup(addCursor) {
  dialogueEl.innerHTML = '';
  groupLines.forEach((line, li) => {
    if (li > 0) {
      dialogueEl.appendChild(document.createElement('br'));
      dialogueEl.appendChild(document.createElement('br'));
    }
    if (line.char) {
      const nameSpan = document.createElement('span');
      nameSpan.className = 'nvl-speaker';
      nameSpan.textContent = line.char + ' ';
      dialogueEl.appendChild(nameSpan);
    }
    const textSpan = document.createElement('span');
    textSpan.className = 'nvl-text-line';
    textSpan.appendChild(document.createTextNode(line.text));
    dialogueEl.appendChild(textSpan);
  });
  if (addCursor) dialogueEl.appendChild(cursor);
  fitTextBlock();
}

// Keeps dialogue text fully inside the text box at any resolution or text-size
// setting: it starts at the size the player chose (small/normal/large) and only
// steps the font down, in small increments, if that specific line would overflow —
// no scrollbar, no clipped text, and it never shrinks more than it has to.
function fitTextBlock() {
  const block = document.getElementById('text-block');
  if (!block || !dialogueEl) return;
  const sizes = window.FC_TEXT_SIZES || { small: '0.95rem', normal: '1.1rem', large: '1.3rem' };
  const key = (window.FC_SETTINGS && window.FC_SETTINGS.textSize) || 'normal';
  const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  let px = parseFloat(sizes[key] || sizes.normal) * rootPx;
  const floor = rootPx * 0.72;
  const lineHeights = window.FC_LINE_HEIGHTS || { small: 1.78, normal: 1.7, large: 1.5 };
  dialogueEl.style.lineHeight = lineHeights[key] || lineHeights.normal;
  const cs = getComputedStyle(block);
  const maxHpx = parseFloat(cs.maxHeight) || block.clientHeight;
  const padV = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  const available = maxHpx - padV;
  dialogueEl.style.fontSize = px + 'px';
  let guard = 0;
  while (dialogueEl.scrollHeight > available && px > floor && guard < 40) {
    px -= 1;
    dialogueEl.style.fontSize = px + 'px';
    guard++;
  }
}
window.fitTextBlock = fitTextBlock;
window.addEventListener('resize', () => { if (typeof fitTextBlock === 'function') fitTextBlock(); });

function typeText(text) {
  currentFullText = text;
  isTyping = true;
  cursor.classList.remove('hidden');
  const posInGroup = index % currentGroupSize();
  if (posInGroup === 0) {
    groupLines = [];
    dialogueEl.style.opacity = '0';
    setTimeout(() => { dialogueEl.style.opacity = '1'; }, 80);
  }
  const currentChar = scenes[index] ? scenes[index].character || '' : '';
  groupLines.push({ char: currentChar, text: '' });
  const lineIdx = groupLines.length - 1;
  renderGroup(true);
  let charIndex = 0;
  function typeNext() {
    if (charIndex < text.length) {
      const ch = text[charIndex++];
      groupLines[lineIdx].text += ch;
      renderGroup(true);
      typingTimeout = setTimeout(typeNext, getTypingDelay(ch));
    } else { finishTyping(); }
  }
  typeNext();
}

function finishTyping() {
  if (typingTimeout) { clearTimeout(typingTimeout); typingTimeout = null; }
  isTyping = false;
  cursor.classList.add('hidden');
  groupLines[groupLines.length - 1].text = currentFullText;
  renderGroup(false);
  recordBacklogLine(index, scenes[index] ? (scenes[index].character || '') : '', currentFullText);
  // Add next indicator after last rendered line
  // ▶ = more lines in this group; ◆ = end of group (screen will clear on next click)
  const posInGroup = index % currentGroupSize();
  const isLastInGroup = posInGroup === currentGroupSize() - 1;
  const isLastScene   = index === scenes.length - 1;
  const lastTextLine = dialogueEl.querySelector('.nvl-text-line:last-of-type');
  if (lastTextLine) {
    const ind = document.createElement('span');
    ind.id = 'next-indicator';
    const isGroupEnd = isLastInGroup || isLastScene;
    ind.textContent = isGroupEnd ? ' ◇' : ' ▷ ▷';
    ind.className = isGroupEnd ? 'ind-diamond' : 'ind-arrow';
    lastTextLine.appendChild(ind);
  }
  // Auto-advance if enabled
  if (window.FC_SETTINGS && window.FC_SETTINGS.autoAdvance) {
    autoAdvanceTimer = setTimeout(() => { advance(); }, 1500);
  }
}

let autoAdvanceTimer = null;
let sceneHasEnded = false;

function fadeOutAudio(ms = 800) {
  const startVol = bgm.volume;
  if (startVol <= 0.001) { bgm.pause(); return; }
  const startTime = performance.now();
  const FLOOR = 0.001; // ~ -60dB — inaudible, used as the exponential's asymptote
  function tick(now) {
    const t = Math.min(1, (now - startTime) / ms);
    bgm.volume = t >= 1 ? 0 : startVol * Math.pow(FLOOR, t);
    if (t >= 1) { bgm.pause(); return; }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function advance() {
  if (contentWarningOpen) return; // waiting on the content-warning dialog — ignore advance input
  if (sceneHasEnded) return; // scene is already wrapping up — ignore further input
  if (autoAdvanceTimer) { clearTimeout(autoAdvanceTimer); autoAdvanceTimer = null; }
  if (isAdvancing) return; // portrait and/or background animation is still settling in — ignore clicks until it's done
  const _old = document.getElementById('next-indicator'); if (_old) _old.remove();
  if (isTyping) { finishTyping(); return; }
  if (typingTimeout) { clearTimeout(typingTimeout); typingTimeout = null; }
  index++;
  if (index < scenes.length) {
    showScene(index);
  } else {
    sceneHasEnded = true;
    // Some pages (e.g. an optional interlude) need "continue" to resume
    // somewhere other than this page's own NEXT_FILE — write that save now
    // and stop the generic exit-save from overwriting it on the way out.
    if (FC.chapterBreak) {
      try {
        localStorage.setItem('fc_save', JSON.stringify({
          chapter: FC.chapterBreak.chapter,
          file: FC.chapterBreak.file,
          rawFile: FC.chapterBreak.rawFile || FC.chapterBreak.file,
          nextAct: true
        }));
        suppressExitSave = true;
      } catch(e) {}
    }
    if (FC.endCard && document.getElementById('end-card')) {
      playEndCard(scenes[index - 1] && scenes[index - 1].musicNoFadeOut);
    } else {
      fadeOverlay.style.opacity = 1;
      // Opt-in per scene (`musicNoFadeOut: true` on the LAST scene of the
      // file) — skip the usual 800ms audio duck on the way out, so its
      // track cuts hard instead of easing down. Since we're not waiting
      // on a fade, there's nothing to delay navigation for either.
      if (scenes[index - 1] && scenes[index - 1].musicNoFadeOut) {
        window.location.href = fcResolveNext(NEXT_FILE);
      } else {
        fadeOutAudio(800);
        setTimeout(() => { window.location.href = fcResolveNext(NEXT_FILE); }, 800);
      }
    }
  }
}

/* ── END-OF-SCENE TITLE CARD SEQUENCE ────────────────────────── */
function playEndCard(skipMusicFade) {
  const endCard = document.getElementById('end-card');
  const endCardBg = document.getElementById('end-card-bg');
  const mobileMenuBtn = document.getElementById('mobile-menu-btn');
  if (mobileMenuBtn) mobileMenuBtn.style.display = 'none';

  // Carry the scene's own art into the card instead of cutting to a void —
  // same trick the reference title card uses, minus the characters.
  if (endCardBg) endCardBg.style.backgroundImage = bgBase.style.backgroundImage || '';

  // Duck the music out gently rather than cutting it dead — synced to the
  // 0.8s #fade-overlay transition in fc-theme.css, same fade used on every
  // other exit path. Skipped when the ending scene opts out via
  // `musicNoFadeOut: true`.
  if (!skipMusicFade) fadeOutAudio(800);

  // Fade the live scene to black first...
  fadeOverlay.style.opacity = 1;

  setTimeout(() => {
    // ...then reveal the title card over the black.
    endCard.classList.add('showing');

    // Hold on the card so it reads as a beat, not a flicker.
    setTimeout(() => {
      endCard.classList.remove('showing');
      endCard.classList.add('hiding');
      setTimeout(() => { window.location.href = fcResolveNext(NEXT_FILE); }, 900);
    }, 3400);
  }, 850);
}

function updateProgress(i) {
  const dots = dotsEl.querySelectorAll('.pdot');
  dots.forEach((d, idx) => {
    d.className = 'pdot';
    if (idx < i)  d.classList.add('done');
    if (idx === i) d.classList.add('current');
  });
  const pct = ((i + 1) / scenes.length) * 100;
  progressFill.style.width = pct + '%';
}

function getSavedScene() {
  try {
    const urlParam = new URLSearchParams(window.location.search).get('scene');
    if (urlParam !== null) return Math.max(0, Math.min(parseInt(urlParam, 10), scenes.length - 1));
  } catch(e) {}
  return 0;
}

/* ── START ────────────────────────────────────────────
   Each page calls this itself, as the LAST line of its own inline
   script — after `window.FC_CONFIG` is set and after any bespoke
   per-scene overrides (e.g. a cinematic wrapping `showScene`) have
   been installed. Keeping this a manual call (instead of engine.js
   auto-running on load) is what lets a page safely override engine
   behavior before the first scene actually renders. */
function FC_start() {
  buildDots();
  index = getSavedScene();
  // A fresh page load means nothing is cached yet — this is exactly the
  // "lags in the first chapter" case, since every other scene at least got
  // a head start from the previous scene's lookahead preload. Kick off the
  // current *and* next scene's assets before showScene() so the very first
  // background isn't decoding cold at the same moment the page fades in.
  // Backgrounds persist scene-to-scene (a scene with no `bg` leaves the
  // current one up), but starting mid-chapter (?scene=N) skips the scenes
  // that set it. So if this scene doesn't set its own bg, find the most
  // recent one set before it (last step of a bgSequence counts) and put it
  // up with a hard cut — same idea as a track carrying on from earlier.
  const inheritedBg = _inheritedBgFor(index);
  if (inheritedBg) changeBackground(inheritedBg, false, true);
  preloadScene(index);
  preloadScene(index + 1);
  showScene(index);
}

function _inheritedBgFor(i) {
  if (!scenes[i] || scenes[i].bg) return null;
  for (let k = i - 1; k >= 0; k--) {
    const sc = scenes[k];
    if (sc.bgSequence) {
      const steps = Array.isArray(sc.bgSequence) ? sc.bgSequence : [sc.bgSequence];
      for (let j = steps.length - 1; j >= 0; j--) if (steps[j].bg) return steps[j].bg;
    }
    if (sc.bg) return sc.bg;
  }
  return null;
}

window.addEventListener("load", () => {
  bgm.muted = false;
  bgm.play().catch(() => {});
  fadeOverlay.style.opacity = 0;

  // Sync standing portrait reveal with the fade-in (0.8s transition)
  setTimeout(() => {
    window._sceneHasLoaded = true;
    // NVL: portrait handled by showScene
  }, 200);
});

/* ── BACK/FORWARD-CACHE FIX ──────────────────────────────────────
   Clicking back into this page can restore it from the browser's
   bfcache instead of re-running it, so anything left mid-transition
   (fade-overlay at opacity 1, an end card showing, music ducked, the
   mobile menu button hidden) would stay stuck until a manual refresh.
   'pageshow' fires on that restore (event.persisted === true) even
   though 'load' does not, so we use it to put the scene back the way
   it should look when the player actually lands on it.
   ────────────────────────────────────────────────────────────────── */
window.addEventListener('pageshow', (event) => {
  if (!event.persisted) return; // normal first load already handled above

  sceneHasEnded = false;

  const endCard = document.getElementById('end-card');
  if (endCard) endCard.classList.remove('showing', 'hiding');

  const mobileMenuBtn = document.getElementById('mobile-menu-btn');
  if (mobileMenuBtn) mobileMenuBtn.style.display = '';

  fadeOverlay.style.transition = 'none';
  fadeOverlay.style.opacity = 1;
  void fadeOverlay.offsetWidth;
  fadeOverlay.style.transition = '';

  const targetVol = (window.FC_SETTINGS && typeof window.FC_SETTINGS.musicVol === 'number')
    ? window.FC_SETTINGS.musicVol / 100
    : 0.7;
  bgm.muted = false;
  bgm.volume = targetVol;
  bgm.play().catch(() => {});

  requestAnimationFrame(() => { fadeOverlay.style.opacity = 0; });
});

// Small helper: restarts a CSS animation on an element by removing it and
// forcing the browser to notice before adding it back. (Not currently
// called anywhere, but kept here since a couple of CSS effects elsewhere
// in the page may want it — see computeBackgroundMotion above for the same
// trick used inline.)
function reAnimateEl(el) {
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
}

/* ── PAUSE MENU ──────────────────────────────────────────
   The overlay that opens on Escape / the mobile menu button: resume,
   restart the current scene, jump to the map, or go to the main menu. */
const pauseMenu = document.getElementById('pause-menu');

function openPause() {
  pauseMenu.style.display = 'block';
  // Show chapter info in header
  try {
    const save = JSON.parse(localStorage.getItem('fc_save') || '{}');
    const info = document.getElementById('pause-chapter-info');
    if (info && save.chapter) info.innerHTML = 'Currently: <b>' + save.chapter + '</b>';
    const infoBar = document.getElementById('pause-chapter-info-bar');
    if (infoBar) infoBar.innerHTML = save.chapter ? 'Currently: <b>' + save.chapter + '</b>' : '';
    const sub = document.getElementById('pause-chapters-sub');
    if (sub) sub.textContent = save.chapter ? save.chapter : 'View all chapters';
  } catch(e) {}
}
function closePause() {
  pauseMenu.style.display = 'none';
}

document.getElementById('pause-resume').addEventListener('click', closePause);

const pauseMapBtn = document.getElementById('pause-map');
if (pauseMapBtn) pauseMapBtn.addEventListener('click', () => {
  fadeOverlay.style.opacity = 1;
  fadeOutAudio(800);
  setTimeout(() => { window.location.href = FC.mapFile || 'worldmap.html'; }, 800);
});

document.getElementById('pause-restart').addEventListener('click', () => {
  closePause();
  showScene(index);
});

const pauseMainMenuBtn = document.getElementById('pause-mainmenu');
if (pauseMainMenuBtn) pauseMainMenuBtn.addEventListener('click', () => {
  fadeOverlay.style.opacity = 1;
  fadeOutAudio(800);
  setTimeout(() => { window.location.href = 'launcher.html'; }, 800);
});

document.getElementById('pause-backdrop').addEventListener('click', closePause);

document.getElementById('mobile-menu-btn').addEventListener('click', openPause);

/* ── HIDE THE TOUCH PAUSE BUTTON WHEN A CONTROLLER IS PRESENT ──
   #mobile-menu-btn exists for touch/mobile players with no physical
   pause key. On a controller, Start already opens/closes the pause
   menu (see gamepad.js), so leaving this button on screen just gives
   gamepad.js's "first press reveals the top-most option" behavior a
   bad first target — pressing A would open pause instead of doing
   anything with the scene. Hide it while a controller is connected,
   and bring it back the moment one disconnects (or never touch it at
   all if the Gamepad API is blocked in this embed). */
(function () {
  const btn = document.getElementById('mobile-menu-btn');
  if (!btn) return;

  function setControllerPresent(present) {
    btn.style.display = present ? 'none' : '';
  }

  window.addEventListener('gamepadconnected', () => setControllerPresent(true));
  window.addEventListener('gamepaddisconnected', () => setControllerPresent(false));

  // A controller already connected before this listener attaches
  // (e.g. it was on before the page loaded) won't fire
  // 'gamepadconnected' in every browser — check once up front.
  try {
    if (navigator.getGamepads && Array.prototype.some.call(navigator.getGamepads(), Boolean)) {
      setControllerPresent(true);
    }
  } catch (err) {
    // Gamepad API blocked by permissions policy (e.g. an embedded
    // preview) — leave the touch button visible, nothing to do here.
  }
})();

document.addEventListener('keydown', (e) => {
  if (contentWarningOpen) return; // dialog is up — its own buttons handle input
  if (e.key === 'Escape') {
    // Escape closes whichever sub-panel is on top first (Character Data,
    // then Settings), and only toggles the pause menu itself once neither
    // of those is open — otherwise Esc would open/close the pause menu
    // underneath a panel that's still sitting on top of it.
    const settingsPanelEl = document.getElementById('settings-panel');
    if (backlogPanel.classList.contains('open')) {
      closeBacklogPanel();
      return;
    }
    if (charPanel.classList.contains('open')) {
      closeCharPanel();
      return;
    }
    if (settingsPanelEl && settingsPanelEl.classList.contains('open')) {
      settingsPanelEl.classList.remove('open');
      return;
    }
    if (pauseMenu.style.display === 'none') {
      openPause();
    } else {
      closePause();
    }
    return;
  }
  if (window._kbListening) return; // rebind UI is capturing a key — don't advance
  if (pauseMenu.style.display !== 'none') return; // menu open — don't advance underneath it
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;
  if (isBoundCode('advance', e.code)) {
    e.preventDefault();
    advance();
  }
});

/* ── CHARACTER CODEX ──────────────────────────────────────
   A small "unlockable character bios" system, entirely self-contained
   in this file — no HTML edits needed in any chapter page.

   How a scene marks someone as introduced: add an `introduces` array to
   that scene object, e.g. `introduces: ['kaden']`. The keys are whatever
   you use in CHARACTER_DB below. The very first time the player reaches
   a scene naming a given key, three things happen: it's remembered in
   localStorage, a "Character Data Added" toast appears in the corner,
   and the entry becomes visible (instead of a "???" silhouette) in the
   Character Data panel, opened from a new button in the pause menu.

   This is just starting data — feel free to add more characters, or
   edit names/roles/bios, any time. Portraits point at the same FC-CHAR/
   files already used for in-scene portraits, so no new art is needed. */
const CHARACTER_DB = {
  kaden:  { name: 'Kaden Acies',    role: 'Protagonist',
            portrait: 'kaden.png',
            bio: "An academy-trained practitioner, following the only lead his brother ever sent him: a letter, and a name." },
  kurt:   { name: 'Kurt',           role: 'Fire practitioner',
            portrait: 'kurt.png',
            bio: "Generous almost to a fault. Has a way of making a room feel warmer than it actually is — literally, sometimes." },
  sophia: { name: 'Sophia',         role: 'Healer',
            portrait: 'sophia.png',
            bio: "Keeps the group's folder, its schedule, and — when it counts — its people, in one piece." },
  ava:    { name: 'Ava',            role: 'Scout',
            portrait: 'ava.png',
            bio: "Trained to be unnoticed rather than hidden. Says the fewest words of anyone, and means the most by them." },
  noah:   { name: 'Noah',           role: 'Researcher',
            portrait: 'noah.png',
            bio: "Rarely seen without his notebook. Found the anomaly that started all of this." },
  iris:   { name: 'Iris Anima',     role: 'Fugitive of the Anima bloodline',
            portrait: 'iris.png',
            bio: "Three months a fugitive from her own family, and carrying a plan she hasn't fully explained to anyone yet." },
  mela:   { name: 'Mela',           role: "Iris's cousin",
            portrait: 'mela.png',
            bio: "Fifteen, sharp, and freshly out of hiding. Tends to say what everyone else is already thinking." },
  velda:  { name: 'Professor Velda', role: 'Academy mentor',
            portrait: 'velda.png',
            bio: "Kaden's mentor at the Academy, and one of the few people left who actually knew his father." },
  naomi:  { name: 'Naomi Acies',    role: "Kaden's mother",
            portrait: 'naomi.png',
            bio: "Kept two hard truths from her son for years — his father's death, and his brother's fate — until she couldn't anymore." },
};

const CHAR_UNLOCK_KEY = 'fc_characters';

function getUnlockedCharacters() {
  try { return JSON.parse(localStorage.getItem(CHAR_UNLOCK_KEY) || '[]'); }
  catch(e) { return []; }
}

function unlockCharacter(key) {
  if (!CHARACTER_DB[key]) return; // unknown key — nothing to unlock, ignore quietly
  const unlocked = getUnlockedCharacters();
  if (unlocked.includes(key)) return; // already seen this character before
  unlocked.push(key);
  try { localStorage.setItem(CHAR_UNLOCK_KEY, JSON.stringify(unlocked)); } catch(e) {}
  showCharacterToast(CHARACTER_DB[key]);
  refreshCharacterPanel(); // no-op if the panel isn't open right now
}

// ── Codex / toast styles now live in fc-theme.css (shared across pages) ──


// ── Toast ──
const toastContainer = document.createElement('div');
toastContainer.id = 'fc-toast-container';
document.body.appendChild(toastContainer);

function showCharacterToast(charData) {
  const toast = document.createElement('div');
  toast.className = 'fc-toast';
  toast.innerHTML =
    '<div class="fc-toast-portrait" style="background-image:url(\'FC-CHAR/' + charData.portrait + '\')"></div>' +
    '<div class="fc-toast-text">' +
      '<div class="fc-toast-label">Character Data Added</div>' +
      '<div class="fc-toast-name">' + charData.name + '</div>' +
    '</div>';
  toastContainer.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('fc-toast-in'));
  setTimeout(() => {
    toast.classList.remove('fc-toast-in');
    setTimeout(() => toast.remove(), 400);
  }, 3600);
}

// ── Pause menu button + panel (both built here, not in the HTML) ──
const charPanel = document.createElement('div');
charPanel.id = 'char-panel';
charPanel.innerHTML =
  '<div id="char-box">' +
    '<div id="char-heading">' +
      '<span id="char-title">Character Data<span id="char-count"></span></span>' +
      '<button id="char-close">✕</button>' +
    '</div>' +
    '<div id="char-list"></div>' +
  '</div>';
document.body.appendChild(charPanel);

function openCharPanel() {
  charPanel.classList.add('open');
  refreshCharacterPanel();
}
function closeCharPanel() {
  charPanel.classList.remove('open');
}
function refreshCharacterPanel() {
  if (!charPanel.classList.contains('open')) return; // don't bother building it while hidden
  const unlocked = getUnlockedCharacters();
  const listEl = document.getElementById('char-list');
  const countEl = document.getElementById('char-count');
  const allKeys = Object.keys(CHARACTER_DB);
  if (countEl) countEl.textContent = ' (' + unlocked.length + ' / ' + allKeys.length + ')';
  listEl.innerHTML = allKeys.map(key => {
    const data = CHARACTER_DB[key];
    if (unlocked.includes(key)) {
      return '<div class="char-card">' +
        '<div class="char-card-portrait" style="background-image:url(\'FC-CHAR/' + data.portrait + '\')"></div>' +
        '<div class="char-card-body">' +
          '<div class="char-card-name">' + data.name + '</div>' +
          '<div class="char-card-role">' + data.role + '</div>' +
          '<div class="char-card-bio">' + data.bio + '</div>' +
        '</div>' +
      '</div>';
    } else {
      return '<div class="char-card locked">' +
        '<div class="char-card-portrait">?</div>' +
        '<div class="char-card-body">' +
          '<div class="char-card-name">???</div>' +
          '<div class="char-card-role">Not yet discovered</div>' +
        '</div>' +
      '</div>';
    }
  }).join('');
}

document.getElementById('char-close').addEventListener('click', closeCharPanel);
charPanel.addEventListener('click', (e) => { if (e.target === charPanel) closeCharPanel(); });

// Insert the nav button itself, right before Settings, matching the
// existing pause-btn markup/classes exactly so it looks native.
(function addCharacterDataButton() {
  const navButtons = document.getElementById('pause-nav-buttons');
  const settingsBtn = document.getElementById('pause-settings');
  if (!navButtons || !settingsBtn) return;

  const sep = document.createElement('div');
  sep.className = 'pause-nav-sep';

  const btn = document.createElement('button');
  btn.className = 'pause-btn';
  btn.id = 'pause-characters';
  btn.innerHTML = '<span class="pause-btn-icon">◈</span>Character Data';
  btn.addEventListener('click', openCharPanel);

  navButtons.insertBefore(sep, settingsBtn);
  navButtons.insertBefore(btn, settingsBtn);
})();

/* ── BACKLOG ──────────────────────────────────────────────
   Lets the player reopen the pause menu and reread every line they've
   already typed through on THIS page — scoped to the current scene file,
   same as everything else here (music, settings-panel state, etc.), since
   each chapter/scene is its own page load with no cross-page save state.

   A line is recorded once it's finished typing (recordBacklogLine, called
   from finishTyping above), keyed by scene index so re-finishing the same
   line (e.g. clicking to skip mid-type) never duplicates it. */
const dialogueHistory = [];
const dialogueHistorySeenIdx = new Set();

function recordBacklogLine(sceneIndex, character, text) {
  if (dialogueHistorySeenIdx.has(sceneIndex)) return;
  dialogueHistorySeenIdx.add(sceneIndex);
  dialogueHistory.push({ char: character, text: text });
}

const backlogPanel = document.createElement('div');
backlogPanel.id = 'backlog-panel';
backlogPanel.innerHTML =
  '<div id="backlog-box">' +
    '<div id="backlog-heading">' +
      '<span id="backlog-title">Backlog<span id="backlog-count"></span></span>' +
      '<button id="backlog-close">✕</button>' +
    '</div>' +
    '<div id="backlog-list"></div>' +
  '</div>';
document.body.appendChild(backlogPanel);

function openBacklogPanel() {
  backlogPanel.classList.add('open');
  refreshBacklogPanel();
  const listEl = document.getElementById('backlog-list');
  if (listEl) listEl.scrollTop = listEl.scrollHeight; // land on the most recent line
}
function closeBacklogPanel() {
  backlogPanel.classList.remove('open');
}
function refreshBacklogPanel() {
  if (!backlogPanel.classList.contains('open')) return; // don't bother building it while hidden
  const listEl = document.getElementById('backlog-list');
  const countEl = document.getElementById('backlog-count');
  if (countEl) countEl.textContent = dialogueHistory.length ? ' (' + dialogueHistory.length + ')' : '';
  if (!dialogueHistory.length) {
    listEl.innerHTML = '<div id="backlog-empty">Nothing read yet on this scene.</div>';
    return;
  }
  listEl.innerHTML = dialogueHistory.map(line => {
    const speaker = line.char
      ? '<span class="backlog-speaker">' + line.char + '</span>'
      : '';
    return '<div class="backlog-line">' + speaker +
      '<span class="backlog-text"></span>' +
    '</div>';
  }).join('');
  // Text set via textContent (not innerHTML) below, so dialogue containing
  // "<" or "&" can never be misread as markup.
  const textEls = listEl.querySelectorAll('.backlog-text');
  dialogueHistory.forEach((line, i) => { textEls[i].textContent = line.text; });
}

document.getElementById('backlog-close').addEventListener('click', closeBacklogPanel);
backlogPanel.addEventListener('click', (e) => { if (e.target === backlogPanel) closeBacklogPanel(); });

(function addBacklogButton() {
  const navButtons = document.getElementById('pause-nav-buttons');
  const settingsBtn = document.getElementById('pause-settings');
  if (!navButtons || !settingsBtn) return;

  const sep = document.createElement('div');
  sep.className = 'pause-nav-sep';

  const btn = document.createElement('button');
  btn.className = 'pause-btn';
  btn.id = 'pause-backlog';
  btn.innerHTML = '<span class="pause-btn-icon">☰</span>Backlog';
  btn.addEventListener('click', openBacklogPanel);

  navButtons.insertBefore(sep, settingsBtn);
  navButtons.insertBefore(btn, settingsBtn);
})();

/* ── KEYBINDING SETTINGS UI ──────────────────────────────
   Renders the list of rebindable keys inside the settings panel and
   handles the "click a chip, then press a new key" rebind flow. This is
   the UI on top of the KEYBINDING SYSTEM further up the file. */
(function() {
  const listEl = document.getElementById('sv-keybind-list');
  if (!listEl) return;
  let listeningChip = null;

  function renderKeybindList() {
    const kb = loadKeybinds();
    window.FC_KEYBINDS = kb;
    listEl.innerHTML = '';
    KEYBIND_ACTIONS.forEach(action => {
      const row = document.createElement('div');
      row.className = 's-kb-row';
      const label = document.createElement('span');
      label.className = 's-kb-label';
      label.textContent = action.label;
      row.appendChild(label);

      const keysWrap = document.createElement('div');
      keysWrap.className = 's-kb-keys';

      (kb[action.id] || []).forEach((code, i) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 's-kb-chip';
        chip.dataset.action = action.id;
        chip.dataset.code = code;
        chip.innerHTML = kbDisplayName(code) + (kb[action.id].length > 1 ? '<span class="s-kb-chip-remove">✕</span>' : '');
        chip.addEventListener('click', function(ev) {
          if (ev.target.classList.contains('s-kb-chip-remove')) {
            ev.stopPropagation();
            const cur = loadKeybinds();
            cur[action.id] = cur[action.id].filter(c => c !== code);
            if (!cur[action.id].length) cur[action.id] = [code]; // never leave empty
            saveKeybinds(cur);
            renderKeybindList();
            return;
          }
          startListening(chip, action.id, code);
        });
        keysWrap.appendChild(chip);
      });

      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 's-kb-chip s-kb-chip-add';
      addBtn.textContent = '+';
      addBtn.addEventListener('click', function() { startListening(addBtn, action.id, null); });
      keysWrap.appendChild(addBtn);

      row.appendChild(keysWrap);
      listEl.appendChild(row);
    });
  }

  function startListening(chip, actionId, oldCode) {
    if (listeningChip) { listeningChip.classList.remove('listening'); }
    window._kbListening = true;
    chip.classList.add('listening');
    chip.textContent = '…';
    listeningChip = chip;

    function onKey(e) {
      e.preventDefault(); e.stopPropagation();
      if (e.code === 'Escape') { cancel(); return; }
      finish(e.code);
    }
    function onMouse(e) {
      if (e.target === chip || chip.contains(e.target)) return; // ignore the click that opened listening
      e.preventDefault(); e.stopPropagation();
      finish('Mouse0');
    }
    function cancel() {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onMouse, true);
      window._kbListening = false;
      listeningChip = null;
      renderKeybindList();
    }
    function finish(newCode) {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onMouse, true);
      window._kbListening = false;
      listeningChip = null;
      const cur = loadKeybinds();
      const arr = cur[actionId];
      if (oldCode) {
        const idx = arr.indexOf(oldCode);
        if (idx !== -1) arr[idx] = newCode;
      } else {
        if (arr.indexOf(newCode) === -1) arr.push(newCode);
      }
      // de-dupe
      cur[actionId] = arr.filter((c, i) => arr.indexOf(c) === i);
      saveKeybinds(cur);
      renderKeybindList();
    }
    setTimeout(() => {
      document.addEventListener('keydown', onKey, true);
      document.addEventListener('mousedown', onMouse, true);
    }, 50);
  }

  document.getElementById('sv-kb-reset').addEventListener('click', function() {
    const d = {}; KEYBIND_ACTIONS.forEach(a => d[a.id] = KEYBIND_DEFAULTS[a.id].slice());
    saveKeybinds(d);
    renderKeybindList();
  });

  renderKeybindList();
  document.getElementById('pause-settings').addEventListener('click', renderKeybindList);
})();


/* ── SETTINGS SYSTEM ──────────────────────────────────────
   The settings panel itself: music/SFX volume, typing speed, text size,
   "skip seen text", and auto-advance. Reads/writes localStorage and
   exposes the current values as window.FC_SETTINGS so other parts of the
   engine (the typewriter, fitTextBlock, etc.) can read them. */
(function() {
  const SETTINGS_KEY = 'fc_settings';
  const SPEED_LABELS = ['Crawl', 'Slow', 'Normal', 'Fast', 'Instant'];

  const defaults = {
    musicVol:  70,
    sfxVol:    80,
    textSpeed: 3,   // 1–5
    textSize:  'normal', // small | normal | large
    skipSeen:  true,
    autoAdvance: false,
    skipEncounters: false
  };

  function load() {
    try { return Object.assign({}, defaults, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); }
    catch(e) { return Object.assign({}, defaults); }
  }
  function save(s) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  }

  // Also keep legacy fc_volume in sync for any other pages that read it
  function applyMusicVol(v) {
    const b = document.getElementById('bgm');
    if (b) b.volume = v / 100;
    localStorage.setItem('fc_volume', v);
  }

  const TEXT_SIZES = { small: '0.95rem', normal: '1.1rem', large: '1.3rem' };
  window.FC_TEXT_SIZES = TEXT_SIZES;
  const LINE_HEIGHTS = { small: 1.78, normal: 1.7, large: 1.5 };
  window.FC_LINE_HEIGHTS = LINE_HEIGHTS;
  function applyTextSize(size) {
    const targets = document.querySelectorAll('#dialogue-text');
    targets.forEach(el => {
      el.style.fontSize = TEXT_SIZES[size] || TEXT_SIZES.normal;
      el.style.lineHeight = LINE_HEIGHTS[size] || LINE_HEIGHTS.normal;
    });
    if (typeof window.fitTextBlock === 'function') window.fitTextBlock();
  }

  // Expose speed so typeText can read it
  window.FC_SETTINGS = load();
  applyMusicVol(window.FC_SETTINGS.musicVol);
  applyTextSize(window.FC_SETTINGS.textSize);

  // Wire up sliders
  function sliderBg(el, v, min, max) {
    const pct = ((v - min) / (max - min)) * 100;
    el.style.background = 'linear-gradient(to right, #e2505f ' + pct + '%, #2a1414 ' + pct + '%)';
  }

  // ── "Skip Encounters" row — built here so every chapter page gets it
  // without its HTML being touched. Mirrors the Auto-Advance row markup.
  if (!document.getElementById('sv-encount')) {
    const autoRow = document.getElementById('sv-auto') && document.getElementById('sv-auto').closest('.s-row');
    if (autoRow) {
      const row = document.createElement('div');
      row.className = 's-row';
      row.innerHTML =
        '<div class="s-label-col">' +
          '<span class="s-label">Skip Encounters</span>' +
          '<span class="s-hint">Skip battles and go straight to the next scene</span>' +
        '</div>' +
        '<label class="s-toggle">' +
          '<input type="checkbox" id="sv-encount">' +
          '<span class="s-toggle-track"><span class="s-toggle-thumb"></span></span>' +
        '</label>';
      autoRow.parentNode.insertBefore(row, autoRow.nextSibling);
    }
  }

  const musicSlider = document.getElementById('sv-music');
  const musicPct    = document.getElementById('sv-music-pct');
  const sfxSlider   = document.getElementById('sv-sfx');
  const sfxPct      = document.getElementById('sv-sfx-pct');
  const speedSlider = document.getElementById('sv-speed');
  const speedPct    = document.getElementById('sv-speed-pct');
  const skipCb      = document.getElementById('sv-skip');
  const autoCb      = document.getElementById('sv-auto');
  const encCb       = document.getElementById('sv-encount');
  const sizebtns    = document.querySelectorAll('#sv-textsize .s-seg-btn');

  function refreshUI(s) {
    musicSlider.value = s.musicVol;
    musicPct.textContent = s.musicVol + '%';
    sliderBg(musicSlider, s.musicVol, 0, 100);

    sfxSlider.value = s.sfxVol;
    sfxPct.textContent = s.sfxVol + '%';
    sliderBg(sfxSlider, s.sfxVol, 0, 100);

    speedSlider.value = s.textSpeed;
    speedPct.textContent = SPEED_LABELS[s.textSpeed - 1];
    sliderBg(speedSlider, s.textSpeed, 1, 5);

    skipCb.checked = !!s.skipSeen;
    autoCb.checked = !!s.autoAdvance;
    if (encCb) encCb.checked = !!s.skipEncounters;

    sizebtns.forEach(b => {
      b.classList.toggle('active', b.dataset.size === s.textSize);
    });
    applyTextSize(s.textSize);
  }

  function updateSetting(key, value) {
    const s = load();
    s[key] = value;
    save(s);
    window.FC_SETTINGS = s;
  }

  // Load and show saved values on panel open
  const panel = document.getElementById('settings-panel');
  document.getElementById('pause-settings').addEventListener('click', () => {
    refreshUI(load());
    panel.classList.add('open');
  });
  document.getElementById('settings-close').addEventListener('click', () => {
    panel.classList.remove('open');
  });
  // Click backdrop of settings to close it too
  panel.addEventListener('click', function(e) {
    if (e.target === panel) panel.classList.remove('open');
  });

  musicSlider.addEventListener('input', function() {
    const v = parseInt(this.value, 10);
    musicPct.textContent = v + '%';
    sliderBg(this, v, 0, 100);
    applyMusicVol(v);
    updateSetting('musicVol', v);
  });

  sfxSlider.addEventListener('input', function() {
    const v = parseInt(this.value, 10);
    sfxPct.textContent = v + '%';
    sliderBg(this, v, 0, 100);
    updateSetting('sfxVol', v);
  });

  speedSlider.addEventListener('input', function() {
    const v = parseInt(this.value, 10);
    speedPct.textContent = SPEED_LABELS[v - 1];
    sliderBg(this, v, 1, 5);
    updateSetting('textSpeed', v);
  });

  skipCb.addEventListener('change', function() { updateSetting('skipSeen', this.checked); });
  autoCb.addEventListener('change', function() { updateSetting('autoAdvance', this.checked); });
  if (encCb) encCb.addEventListener('change', function() { updateSetting('skipEncounters', this.checked); });

  sizebtns.forEach(b => {
    b.addEventListener('click', function() {
      sizebtns.forEach(x => x.classList.remove('active'));
      this.classList.add('active');
      const size = this.dataset.size;
      updateSetting('textSize', size);
      applyTextSize(size);
    });
  });

  // Initial apply
  refreshUI(load());
})();