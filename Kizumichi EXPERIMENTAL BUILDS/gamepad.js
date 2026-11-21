/* ════════════════════════════════════════════════════════════════════
   KIZUMICHI — GAMEPAD / CONTROLLER SUPPORT
   ════════════════════════════════════════════════════════════════════
   Drop-in controller support for every page. It doesn't know anything
   about a given page's own JS — it just drives the same buttons and
   links a mouse or keyboard already would, so the same file works for
   a VN scene (engine.js), a battle menu, the world map, and the
   launcher without any page-specific wiring.

   WHAT IT DOES
   ─────────────
   • D-pad / left stick    → moves a highlighted "controller focus"
                              between the visible, clickable things on
                              screen (buttons, links, target cards,
                              skill/item lists, chapter rows, etc.)
   • A / Cross  (button 0) → clicks whatever is currently focused. If
                              nothing on screen is focusable yet (e.g.
                              a menu just opened), the first press just
                              reveals the highlight instead of guessing.
                              If there's nothing focusable at all (e.g.
                              we're just reading dialogue), it clicks
                              the page itself — engine.js scenes treat
                              any such click as "advance".
   • B / Circle (button 1) → clicks the nearest visible back/cancel/
                              close control if there is one, otherwise
                              sends an Escape keypress (this is what
                              already opens/closes the pause menu and
                              closes panels on every page that has one —
                              we're just pressing the same key a
                              keyboard would).
   • Start      (button 9) → same as Escape (open/close pause menu).

   Right stick and triggers are intentionally left alone.

   HOW TO ADD IT TO A PAGE
   ─────────────────────────
     <script src="gamepad.js"></script>
   No config needed, and it's safe to include on every page — it stays
   completely idle until a real controller sends input.
   ════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';
  if (window.__FC_GAMEPAD_INIT__) return; // guard against double-include
  window.__FC_GAMEPAD_INIT__ = true;

  /* ── things a controller should be able to reach ──────────────── */
  const NAV_SELECTOR = [
    'button:not([disabled])',
    '[role="button"]',
    'a[href]',
    'input:not([type="hidden"]):not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
    '.action-btn', '.targetable', '.item-targetable', '.item-btn',
    '.skill-btn', '.back-btn', '.result-btn',
    '.chapter-list-item:not(.locked)', '.scene-item'
  ].join(', ');

  // The small set of controls that clearly mean "go back / cancel /
  // close" — B tries these before falling back to a plain Escape.
  const BACK_SELECTOR = [
    '.back-btn', '#btn-cancel-target', '#btn-cancel-item-target',
    '.cancel-btn', '#pause-backdrop', '#dev-menu-close',
    '#scene-picker-close', '#back-btn', '#mobile-back', '#confirmNo'
  ].join(', ');

  const FOCUS_CLASS = 'gp-focus';

  /* ── highlight style + connect/disconnect toast, injected once ── */
  const style = document.createElement('style');
  style.textContent = `
    .${FOCUS_CLASS} {
      outline: 3px solid #ffd76a !important;
      outline-offset: 2px !important;
      box-shadow: 0 0 0 3px rgba(255,215,106,.35), 0 0 14px rgba(255,215,106,.55) !important;
      border-radius: 6px;
    }
    #gp-indicator {
      position: fixed; right: 14px; bottom: 14px; z-index: 999999;
      display: flex; align-items: center; gap: 8px;
      background: rgba(10,10,14,.82); color: #f1e8d8;
      border: 1px solid rgba(255,215,106,.4);
      border-radius: 999px; padding: 7px 14px 7px 10px;
      font: 600 12.5px/1 'Segoe UI', system-ui, sans-serif;
      letter-spacing: .02em; pointer-events: none;
      opacity: 0; transform: translateY(8px);
      transition: opacity .35s ease, transform .35s ease;
    }
    #gp-indicator.show { opacity: 1; transform: translateY(0); }
    #gp-indicator svg { width: 18px; height: 18px; flex: none; }
  `;
  document.head.appendChild(style);

  const indicator = document.createElement('div');
  indicator.id = 'gp-indicator';
  indicator.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="#ffd76a" stroke-width="1.8" ' +
    'stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="2" y="7" width="20" height="11" rx="5.5"></rect>' +
    '<path d="M7 10v4M5 12h4"></path>' +
    '<circle cx="16" cy="10.5" r="1"></circle>' +
    '<circle cx="18.5" cy="13" r="1"></circle>' +
    '</svg><span id="gp-indicator-text">Controller Connected</span>';
  document.addEventListener('DOMContentLoaded', () => document.body.appendChild(indicator));
  if (document.body) document.body.appendChild(indicator);

  let indicatorTimer = null;
  function flashIndicator(text) {
    const label = document.getElementById('gp-indicator-text');
    if (label) label.textContent = text;
    indicator.classList.add('show');
    clearTimeout(indicatorTimer);
    indicatorTimer = setTimeout(() => indicator.classList.remove('show'), 2600);
  }

  /* ── visibility / interactability check ─────────────────────── */
  function isReachable(el) {
    if (!el || el.disabled) return false;
    if (el.closest('[disabled]')) return false;
    const cs = getComputedStyle(el);
    if (el.offsetParent === null && cs.position !== 'fixed') return false;
    if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    if (parseFloat(cs.opacity) < 0.05) return false;
    if (cs.pointerEvents === 'none') return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return false;
    return true;
  }

  function getNavigable() {
    return Array.from(document.querySelectorAll(NAV_SELECTOR)).filter(isReachable);
  }

  /* ── current controller focus ─────────────────────────────────── */
  let focused = null;

  function clearFocus() {
    if (focused) focused.classList.remove(FOCUS_CLASS);
    focused = null;
  }

  function setFocus(el) {
    if (focused === el) return;
    if (focused) focused.classList.remove(FOCUS_CLASS);
    focused = el;
    if (focused) {
      focused.classList.add(FOCUS_CLASS);
      focused.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
      if (typeof focused.focus === 'function') {
        try { focused.focus({ preventScroll: true }); } catch (e) { focused.focus(); }
      }
    }
  }

  /* ── spatial navigation: pick the best candidate in a direction ── */
  function center(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function navigate(dir) {
    const items = getNavigable();
    if (!items.length) { clearFocus(); return; }

    // Nothing highlighted yet — the first press just reveals the
    // top-most option instead of guessing a direction from nowhere.
    if (!focused || items.indexOf(focused) === -1) { setFocus(items[0]); return; }

    const c0 = center(focused);
    let best = null, bestScore = Infinity;
    for (const el of items) {
      if (el === focused) continue;
      const c1 = center(el);
      const dx = c1.x - c0.x, dy = c1.y - c0.y;
      let primary, cross, ok;
      switch (dir) {
        case 'up':    ok = dy < -4; primary = -dy; cross = Math.abs(dx); break;
        case 'down':  ok = dy > 4;  primary = dy;  cross = Math.abs(dx); break;
        case 'left':  ok = dx < -4; primary = -dx; cross = Math.abs(dy); break;
        case 'right': ok = dx > 4;  primary = dx;  cross = Math.abs(dy); break;
      }
      if (!ok) continue;
      if (cross > primary * 1.6 + 40) continue; // too far off-axis to feel like a straight move
      const score = primary + cross * 1.4;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) setFocus(best);
  }

  /* ── face / menu button actions ──────────────────────────────── */
  function pressConfirm() {
    const items = getNavigable();
    if (focused && items.indexOf(focused) !== -1) { focused.click(); return; }
    if (items.length) { setFocus(items[0]); return; } // reveal first, don't blind-click
    document.body.click(); // nothing on screen — treat like a click-to-advance
  }

  function pressCancel() {
    const back = Array.from(document.querySelectorAll(BACK_SELECTOR)).find(isReachable);
    if (back) { back.click(); return; }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
  }

  function pressStart() {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
  }

  /* ── polling loop ────────────────────────────────────────────── */
  const DEADZONE = 0.5;
  const REPEAT_FIRST = 320; // ms before a held direction starts repeating
  const REPEAT_RATE  = 150; // ms between repeats while held
  let activeDir = null, dirTimer = 0;
  let prevButtons = [];
  let rafId = null;

  function readDir(gp) {
    const dpUp = gp.buttons[12] && gp.buttons[12].pressed;
    const dpDown = gp.buttons[13] && gp.buttons[13].pressed;
    const dpLeft = gp.buttons[14] && gp.buttons[14].pressed;
    const dpRight = gp.buttons[15] && gp.buttons[15].pressed;
    if (dpUp) return 'up';
    if (dpDown) return 'down';
    if (dpLeft) return 'left';
    if (dpRight) return 'right';

    const lx = gp.axes[0] || 0, ly = gp.axes[1] || 0;
    if (Math.max(Math.abs(lx), Math.abs(ly)) < DEADZONE) return null;
    return Math.abs(lx) > Math.abs(ly) ? (lx < 0 ? 'left' : 'right') : (ly < 0 ? 'up' : 'down');
  }

  /* ── safe access to the Gamepad API ──────────────────────────
     Some embeds/previews (iframes without an explicit
     `allow="gamepad"`, certain sandboxed viewers, etc.) block the
     Gamepad API entirely via Permissions-Policy. In that case even
     *asking* navigator.getGamepads() whether a controller exists
     throws a SecurityError — so every call site goes through this
     wrapper, and the first time it throws we stop polling for good
     instead of spamming the console every frame. */
  let gamepadBlocked = false;
  function safeGetGamepads() {
    if (gamepadBlocked || !navigator.getGamepads) return [];
    try {
      return navigator.getGamepads() || [];
    } catch (err) {
      gamepadBlocked = true;
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      return [];
    }
  }

  function poll(ts) {
    if (gamepadBlocked) { rafId = null; return; }
    rafId = requestAnimationFrame(poll);
    const pads = safeGetGamepads();
    const gp = pads && (pads[0] || pads[1] || pads[2] || pads[3]);
    if (!gp) return;

    const dir = readDir(gp);
    if (dir) {
      if (dir !== activeDir) {
        activeDir = dir;
        dirTimer = ts + REPEAT_FIRST;
        navigate(dir);
      } else if (ts >= dirTimer) {
        dirTimer = ts + REPEAT_RATE;
        navigate(dir);
      }
    } else {
      activeDir = null;
    }

    const prev = prevButtons;
    const pressed = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
    if (pressed(0) && !prev[0]) pressConfirm(); // A / Cross
    if (pressed(1) && !prev[1]) pressCancel();  // B / Circle
    if (pressed(9) && !prev[9]) pressStart();   // Start / Options

    prevButtons = gp.buttons.map((b) => b.pressed);
  }

  function startPolling() {
    if (rafId || gamepadBlocked) return;
    rafId = requestAnimationFrame(poll);
  }

  window.addEventListener('gamepadconnected', () => {
    flashIndicator('Controller Connected');
    startPolling();
  });
  window.addEventListener('gamepaddisconnected', () => {
    flashIndicator('Controller Disconnected');
    clearFocus();
  });

  // Some browsers (older Firefox especially) never fire
  // 'gamepadconnected' for a pad that was already on before the page
  // loaded — check once up front in case one's already sitting there.
  if (Array.prototype.some.call(safeGetGamepads(), Boolean)) {
    startPolling();
  }
})();
