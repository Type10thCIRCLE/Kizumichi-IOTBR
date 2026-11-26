/* ── SKIP ENCOUNTERS (safety net) ─────────────────────────
   If the player turned on "Skip Encounters", any way of landing on an
   encounter page (the world map, a direct link, a page that still points
   here) bounces straight on to the scene this encounter would have led
   to. The chapter pages already skip ahead on their own; this covers the
   rest. Runs before anything else in the engine. */
(function () {
  try {
    const cfg = window.ENCOUNTER;
    if (!cfg || !cfg.nextPage) return;
    if (!/_encount\.html$/i.test(location.pathname)) return;
    const s = JSON.parse(localStorage.getItem('fc_settings') || '{}');
    if (s.skipEncounters) {
      document.documentElement.style.background = '#000';
      document.body && (document.body.style.display = 'none');
      window.stop && window.stop();
      location.replace(cfg.nextPage);
    }
  } catch (e) {}
})();

/* ═════════════════════════════════════════════════════════════════════
   battle-engine.js — the shared battle engine
   ─────────────────────────────────────────────────────────────────────
   Every *_encount.html loads this file. It contains

     1. the page markup           (injected into <body> — HTML files stay tiny)
     2. the encounter setup reader (window.ENCOUNTER from the HTML → BATTLE)
     3. the ENEMY LIBRARY          (add / tune enemies here)
     4. party + item loadouts      (PARTY_PRESETS)
     5. all of the battle logic    (ATB loop, skills, items, AI, VFX, audio, UI)

   The HTML file only decides: background, music, which enemies, which
   party loadout, where "Keep Moving" goes, and whether a gimmick is used.

   Gimmicks (js/gimmicks/*.js) load AFTER this file. They plug in through
   the small Gimmick hook registry below, and — where a mechanic changes a
   whole function — by re-declaring that function.
   ═════════════════════════════════════════════════════════════════════ */

/* ═════════════════════════════════════════════════════════════════════
   1. PAGE MARKUP
   ═════════════════════════════════════════════════════════════════════ */
document.body.insertAdjacentHTML('afterbegin', `
<!-- full-black cover: shown from page load until the encounter transition opens -->
<div id="pre-black" style="position:fixed;inset:0;background:#000;z-index:9990"></div>


<!-- ───────── BATTLE TRANSITION ───────── -->
<div id="battle-transition" class="hidden" aria-hidden="true">
  <div class="bt-iris"></div>
  <div class="bt-lattice"></div>
  <div class="bt-ring bt-ring-a"></div>
  <div class="bt-ring bt-ring-b"></div>
  <div class="bt-card">
    <div class="bt-label">Encounter</div>
    <div class="bt-title" id="trans-title"></div>
    <div class="bt-rule"><i></i></div>
    <div class="bt-sub" id="trans-sub"></div>
  </div>
  <div class="bt-epigraph" id="trans-observation"></div>
  <div class="bt-hint" id="trans-hint"></div>
  <div class="bt-skip">Click to skip</div>
</div>



<!-- ───────── BATTLE SCREEN ───────── -->
<div id="screen-flash"></div>
<div id="battle-screen" class="screen">
  <div id="battle-bg"></div>
  <canvas id="vfx-canvas"></canvas>
  <div id="battle-header">
    <span id="turn-counter">Turn <span id="turn-num">0</span></span>
  </div>

  <div id="enemy-field">
    <div id="enemy-container"></div>
  </div>

  <div id="party-hud">
    <div id="party-panels"></div>

    <div id="battle-log-wrap">
      <div id="battle-log"></div>
    </div>

    <div id="action-panel" class="hidden">
      <div id="action-header">— Select Action —</div>
      <div id="main-actions">
        <button class="action-btn" id="btn-attack">
          <span class="btn-icon">▲</span> Attack
        </button>
        <button class="action-btn" id="btn-skills">
          <span class="btn-icon">◆</span> Skills
        </button>
        <button class="action-btn" id="btn-dodge">
          <span class="btn-icon">◌</span> Evade
        </button>
        <button class="action-btn" id="btn-items">
          <span class="btn-icon">▣</span> Items
        </button>
      </div>
      <div id="skill-list" class="hidden"></div>
      <div id="item-list" class="hidden"></div>
      <div id="target-prompt" class="hidden">Select a target ↑</div>
    </div>
  </div>
</div>

<!-- ───────── RESULT SCREEN ───────── -->
<div id="result-screen" class="screen hidden">
  <!-- Particle canvas for win -->
  <div class="result-particles" id="result-particles"></div>
  <!-- Win layout -->
  <div class="result-win-screen hidden" id="result-win-layout">
    <div class="result-top-rule"></div>
    <div class="result-status-badge">ENCOUNTER RESOLVED</div>
    <div class="result-title result-win" id="result-title"></div>
    <div class="result-title-line"></div>
    <div id="result-body"></div>
    <button class="result-btn" id="result-btn"></button>
  </div>
  <!-- Lose layout -->
  <div class="result-box hidden" id="result-lose-layout">
    <div class="result-title result-lose" id="result-title-lose"></div>
    <div id="result-body-lose"></div>
    <button class="result-btn" id="result-btn-lose"></button>
  </div>
  <!-- Corner flavour text (win only) -->
  <div class="result-corner-text" id="result-corner-r">FRACTURED CADENCE</div>
  <div class="result-corner-left" id="result-corner-l">the path continues beyond here</div>
</div>

<!-- ───────── DEV SECRET MENU ───────── -->
<div id="dev-menu" style="
  display:none;
  position:fixed;
  inset:0;
  z-index:99998;
  background:rgba(0,0,0,0.85);
  align-items:center;
  justify-content:center;
  font-family:-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Arial, sans-serif;
">
  <div style="
    background:#0e1118;
    border:1px solid #d09030;
    padding:32px 40px;
    min-width:300px;
    text-align:center;
  ">
    <div style="color:#d09030;font-size:0.65rem;letter-spacing:0.3em;margin-bottom:6px;">DEV ACCESS</div>
    <div style="color:#f0b848;font-size:1.4rem;font-weight:400;letter-spacing:0.15em;margin-bottom:4px;">TWDEVMENU</div>
    <div style="color:#60584a;font-size:0.7rem;font-style:italic;margin-bottom:28px;">you found it. now what.</div>
    <div style="display:flex;flex-direction:column;gap:10px;">
      <button id="dev-btn-win" style="
        background:transparent;
        border:1px solid #3ab870;
        color:#3ab870;
        font-family:-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Arial, sans-serif;
        font-size:0.85rem;
        padding:10px 24px;
        cursor:pointer;
        letter-spacing:0.1em;
      ">INSTANT VICTORY</button>
      <button id="dev-btn-lose" style="
        background:transparent;
        border:1px solid #c83030;
        color:#c83030;
        font-family:-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Arial, sans-serif;
        font-size:0.85rem;
        padding:10px 24px;
        cursor:pointer;
        letter-spacing:0.1em;
      ">✕ SURRENDER</button>
      <button id="dev-btn-overdrive" style="
        background:transparent;
        border:1px solid #ff6644;
        color:#ff6644;
        font-family:-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Arial, sans-serif;
        font-size:0.85rem;
        padding:10px 24px;
        cursor:pointer;
        letter-spacing:0.1em;
      ">◈ TRIGGER OVERDRIVES</button>
      <!-- ── FORCE NEXT ENEMY MOVE ── -->
      <div id="dev-force-move-section" style="
        border-top:1px solid #21252e;
        margin-top:6px;
        padding-top:14px;
        text-align:left;
      ">
        <div style="color:#d09030;font-size:0.58rem;letter-spacing:0.25em;margin-bottom:10px;text-align:center;">
          ◈ FORCE NEXT ENEMY MOVE
        </div>
        <div style="display:flex;flex-direction:column;gap:7px;">
          <div style="display:flex;align-items:center;gap:8px;">
            <label style="color:#8a8070;font-size:0.68rem;letter-spacing:0.1em;min-width:52px;">ENEMY</label>
            <select id="dev-force-enemy" style="
              flex:1;
              background:#07090d;
              border:1px solid #2e3340;
              color:#d8d0c0;
              font-family:-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Arial, sans-serif;
              font-size:0.72rem;
              padding:5px 8px;
              cursor:pointer;
              outline:none;
            ">
              <option value="">— select —</option>
            </select>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <label style="color:#8a8070;font-size:0.68rem;letter-spacing:0.1em;min-width:52px;">MOVE</label>
            <select id="dev-force-skill" style="
              flex:1;
              background:#07090d;
              border:1px solid #2e3340;
              color:#d8d0c0;
              font-family:-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Arial, sans-serif;
              font-size:0.72rem;
              padding:5px 8px;
              cursor:pointer;
              outline:none;
            " disabled>
              <option value="">— pick enemy first —</option>
            </select>
          </div>
          <button id="dev-btn-force-move" style="
            background:transparent;
            border:1px solid #4878d4;
            color:#4878d4;
            font-family:-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Arial, sans-serif;
            font-size:0.78rem;
            padding:9px 24px;
            cursor:pointer;
            letter-spacing:0.1em;
            margin-top:2px;
          " disabled>⟳ QUEUE FORCED MOVE</button>
          <div id="dev-force-status" style="
            font-size:0.62rem;
            color:#60584a;
            font-style:italic;
            text-align:center;
            min-height:14px;
          "></div>
        </div>
      </div>
      <button id="dev-btn-close" style="
        background:transparent;
        border:1px solid #21252e;
        color:#60584a;
        font-family:-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Arial, sans-serif;
        font-size:0.75rem;
        padding:8px 24px;
        cursor:pointer;
        letter-spacing:0.08em;
        margin-top:6px;
      ">← CLOSE</button>
    </div>
  </div>
</div>

<!-- ───────── EXIT TRANSITION ───────── -->
<div id="exit-transition"><span id="exit-transition-label">LOADING</span></div>
`);

/* ═════════════════════════════════════════════════════════════════════
   2. ENCOUNTER SETUP  (read from window.ENCOUNTER, defined in the HTML file)
   ═════════════════════════════════════════════════════════════════════ */

if (!window.ENCOUNTER) throw new Error('[encounter] window.ENCOUNTER is missing — define it in the HTML before loading js/battle-engine.js');

// BATTLE is the live copy of the setup. Fields the HTML can set:
//   name, subtitle, location, bg, bgm, enemies[], isBoss, party,
//   nextPage, introLog, victoryMusic, victoryText, resultTitle, isTutorial, gimmick
const BATTLE = { ...window.ENCOUNTER };

// ── Gimmick hook registry ───────────────────────────────────────
// Gimmick files call  Gimmick.on('name', fn)  to react to engine events:
//   battleStart            — right after the intro log in startBattle()
//   actionPerformed(kind)  — 'attack' | 'skill' | 'item' | 'dodge'
//   actionPanelOpened      — whenever the command panel is (re)built
const Gimmick = {
  _h: {},
  on(name, fn) { (this._h[name] = this._h[name] || []).push(fn); },
  emit(name, ...args) { (this._h[name] || []).forEach(fn => fn(...args)); }
};
window.GIMMICKS = window.GIMMICKS || {};   // each gimmick file marks itself here

/* ═════════════════════════════════════════════════════════════════════
   3. ENEMY LIBRARY
   ═════════════════════════════════════════════════════════════════════ */
// Every enemy any encounter can use. The HTML picks them by key:  enemies: ['anima_soldier', ...]
// To add an enemy: copy an entry below, give it a new key, and list that key in an encounter's HTML.
const ENEMY_TEMPLATES = {
  // ── Bloodline Practitioner
  bl_pract: {
    name: 'Bloodline Practitioner',
    subtitle: 'Grey Coat Specialist',
    maxHp: 165,
    atk: 75, def: 18, spd: 52,
    color: '#7040b0',
    symbol: '◈',
    xp: 90,
    canDodge: true,            // this one tries to dodge
    skills: [
      { name: 'Dark Strike',      power: 1.25, type: 'magic',  target: 'random',    weight: 0.55 },
      { name: 'Suppression Wave', power: 0,    type: 'debuff', target: 'all_party',
        effect: 'atb_slow', amount: 0.55, duration: 2,                              weight: 0.45 }
    ],
    pattern: ['Dark Strike', 'Dark Strike', 'Suppression Wave']
  },

  // ── Anima Soldier
  anima_soldier: {
    name: 'Anima Soldier',
    subtitle: 'Loyal to the bloodline',
    maxHp: 220,
    atk: 65, def: 35, spd: 40,
    color: '#c03030',
    symbol: '⬡',
    xp: 55,
    canDodge: false,
    skills: [
      { name: 'Strike',             power: 1.0,  type: 'physical', target: 'random', weight: 0.65 },
      { name: 'Coordinated Strike', power: 1.4,  type: 'physical', target: 'random', weight: 0.35 }
    ],
    pattern: ['Strike', 'Strike', 'Coordinated Strike']
  },

  // ── Anima Army Leader
  anima_army_leader: {
    name: 'Anima Army Leader',
    subtitle: 'Field Commander of the Anima vanguard',
    maxHp: 980,
    atk: 130, def: 42, spd: 62,
    color: '#9a2d3c',
    symbol: '◆',
    xp: 420,
    canDodge: true,
    skills: [
      { name: 'Command Slash',   power: 1.45, type: 'physical', target: 'random',    weight: 0.42 },
      { name: 'Anima Burst',     power: 1.2,  type: 'magic',    target: 'all_party', weight: 0.28 },
      { name: 'Rally Disruption', power: 0,   type: 'debuff',   target: 'all_party',
        effect: 'atb_slow', amount: 0.50, duration: 2,                               weight: 0.30 }
    ],
    pattern: ['Command Slash', 'Anima Burst', 'Command Slash', 'Rally Disruption']
  },

  // ── Anima Vanguard
  anima_vanguard: {
    name: 'Anima Vanguard',
    subtitle: 'Loyal to the bloodline — front-line soldier',
    maxHp: 260,
    atk: 74, def: 40, spd: 44,
    color: '#c03030',
    symbol: '⬡',
    xp: 70,
    canDodge: false,
    skills: [
      { name: 'Strike',             power: 1.0, type: 'physical', target: 'random', weight: 0.60 },
      { name: 'Coordinated Strike', power: 1.5, type: 'physical', target: 'random', weight: 0.40 }
    ],
    pattern: ['Strike', 'Strike', 'Coordinated Strike']
  },

  // ── Anima Lead Soldier  (mini-boss)
  anima_lead_soldier: {
    name: 'Anima Lead Soldier',
    subtitle: 'Squad lead of the Anima Army — hardened veteran',
    maxHp: 2400,
    atk: 125, def: 25, spd: 50,
    color: '#9a2d3c',
    symbol: '◆',
    xp: 900,
    isBoss: true,              // gets the boss card + one-time ENRAGE at 30% HP
    drops: [
      { name: 'Remnant Ether', amount: 4 }
    ],
    canDodge: true,
    skills: [
      { name: 'Command Slash',    power: 1.6,  type: 'physical', target: 'random',    weight: 0.30 },
      { name: 'Anima Burst',      power: 1.3,  type: 'magic',    target: 'all_party', weight: 0.20 },
      { name: 'Rally Disruption', power: 0,    type: 'debuff',   target: 'all_party',
        effect: 'atb_slow', amount: 0.50, duration: 2,                               weight: 0.20 },
      { name: 'Piercing Order',   power: 1.0,  type: 'debuff',   target: 'random',
        effect: 'atk_slow', amount: 0.60, duration: 3,                               weight: 0.15 },
      // Telegraphed heavy hit — players see it coming one turn ahead
      { name: 'Vanguard Crush',   power: 2.0,  type: 'physical', target: 'all_party', weight: 0.15, telegraph: true }
    ],
    // Fixed rotation so the Crush is learnable: Disruption -> Slash -> Burst -> Piercing -> Slash -> CRUSH
    pattern: ['Rally Disruption', 'Command Slash', 'Anima Burst', 'Piercing Order', 'Command Slash', 'Vanguard Crush']
  },

  // ── Gate Warden
  gate_warden: {
    name: 'Gate-Warden',
    subtitle: 'The first real threat, forged by Zenis.',
    maxHp: 1100,
    atk: 58, def: 28, spd: 50,
    color: '#d4a020',
    symbol: '⬟',
    xp: 600,
    drops: [
      { name: 'Remnant Ether', amount: 6 },
      { name: 'Pure Ether Crystal', amount: 1 }
    ],
    isBoss: true,
    canDodge: false,
    // Skills still carry `weight` as a fallback for any code path that
    // doesn't use the pattern (e.g. if `pattern` were ever removed).
    skills: [
      { name: 'Keystone Sweep', power: 1.1,  type: 'physical', target: 'all_party', weight: 0.30, telegraph: true },
      { name: 'Bridge Slam',    power: 1.7,  type: 'physical', target: 'random',    weight: 0.50 },
      { name: 'Ether Drain',    power: 0.75, type: 'magic',    target: 'random',
        effect: 'mp_drain',                                                          weight: 0.20 }
    ],
    // ── Fixed attack pattern ──────────────────────────────────────
    // Cycles through these skill names in order (matched against the
    // `skills` list by name). Once players see Sweep, they know Slam is
    // coming next — teaches them to respect the boss's tells without
    // being a true memorize-or-die soulslike pattern. Loops at the end.
    pattern: ['Bridge Slam', 'Keystone Sweep', 'Bridge Slam', 'Ether Drain']
  },

  // ── Chain Keeper  (needs gimmick: chainkeeper)
  chain_keeper: {
    name: 'Chain Keeper',
    subtitle: 'Warden of the Bound — it does not fight to kill, only to hold',
    maxHp: 3200,
    atk: 118, def: 55, spd: 48,
    color: '#8844cc',
    symbol: '▦',
    xp: 680,
    isBoss: true,
    isChainKeeper: true,
    chainTension: 0,         // 0–100 tension gauge
    drops: [
      { name: 'Pure Ether Crystal', amount: 1 },
      { name: 'Remnant Ether', amount: 7 }
    ],
    canDodge: false,
    skills: [
      {
        // Basic melee swing — single target
        name: 'Chain Lash',
        power: 1.3,
        type: 'physical',
        target: 'random',
        weight: 0.30
      },
      {
        // Light hit on all party — chip damage / pressure
        name: 'Sweep Chain',
        power: 0.65,
        type: 'physical',
        target: 'all_party',
        weight: 0.20
      },
      {
        // Applies CHAINED to one party member — main gimmick
        name: 'Chain Snare',
        power: 0,
        type: 'chain_snare',
        target: 'random_party',
        weight: 0.25
      },
      {
        // Raises Chain Tension gauge — signals Bridge Crush coming
        name: 'Tension Pull',
        power: 0,
        type: 'tension_raise',
        target: 'self',
        tensionAmount: 40,
        weight: 0.15
      },
      {
        // Heavy party damage — only usable when tension is full
        name: 'Bridge Crush',
        power: 2.5,
        type: 'physical',
        target: 'all_party',
        isBridgeCrush: true,
        weight: 0.10
      }
    ]
  },

  // ── Iron Custodian
  iron_custodian: {
    name: 'Iron Custodian',
    subtitle: 'First Draft — the only Sentinel that still argues back',
    maxHp: 4200,
    atk: 135, def: 46, spd: 68,
    color: '#8378c4',
    symbol: '▤',
    xp: 780,
    isBoss: true,
    drops: [
      { name: 'Pure Ether Crystal', amount: 1 },
      { name: 'Remnant Ether', amount: 8 }
    ],
    canDodge: true,   // human-hybrid — faster and more evasive than a pure construct
    skills: [
      {
        // Old identity: the reach-arc melee counter that staggered Kaden
        // straight into the bridge railing in the original engagement.
        name: 'Drawer Slam',
        power: 1.4,
        type: 'physical',
        target: 'random',
        piercing: 0.15,
        weight: 0.26
      },
      {
        // New identity: her signature move from the pre-battle exchange —
        // three columns of filing cabinets torn up through the bridge deck.
        name: 'Filing Column',
        power: 1.7,
        type: 'physical',
        target: 'all_party',
        weight: 0.16
      },
      {
        // She spent three bridges cataloguing how the party moves, and the
        // conversation before the fight cataloguing them personally — this
        // is her cashing that in. Reduces one party member's ATK.
        name: 'Open File',
        power: 0,
        type: 'debuff',
        target: 'random',
        effect: 'atk_slow',
        amount: 0.5,
        duration: 2,
        weight: 0.18
      },
      {
        // Old identity, reframed: the drawers no longer just cycle looking
        // for a prediction that isn't there — she's sentient enough now to
        // actually update the read and act on it. Self-buff.
        name: 'Cross-Index',
        power: 0,
        type: 'buff',
        target: 'self',
        effect: 'atk_up',
        amount: 0.35,
        duration: 3,
        weight: 0.14
      },
      {
        // A cold, precise Ether discharge — the "directive architecture"
        // Noah flagged in the pre-battle read, drawing on the party's own
        // Ether reserves the way she draws on everything else.
        name: 'Case Closed',
        power: 2.0,
        type: 'magic',
        target: 'random',
        effect: 'mp_drain',
        weight: 0.14
      },
      {
        // Old identity: the suppression-field pulse the drawers threw off
        // while she was still failing to predict the split formation —
        // now a deliberate move instead of a tell.
        name: 'Recalibrate',
        power: 0,
        type: 'debuff',
        target: 'all_party',
        effect: 'atb_slow',
        amount: 0.5,
        duration: 2,
        weight: 0.12
      }
    ],
    // Telegraphed rotation rather than pure RNG: she opens by reading a
    // weakness, follows with a physical reach attack, updates her own read,
    // unloads her signature AoE, drains the field, then disrupts tempo
    // before looping — readable, but still dangerous if ignored.
    pattern: [
      'Open File',
      'Drawer Slam',
      'Cross-Index',
      'Filing Column',
      'Case Closed',
      'Recalibrate'
    ]
  },

  // ── Zenis Anima PHASE 2  (not used by any encounter yet)
  zenis_anima2: {
    name: 'Zenis Anima II',
    subtitle: 'Sovereign of Assurinlands, his power precedes industry and outlasts it',
    maxHp: 15000,
    atk: 200, def: 50, spd: 65,
    color: '#9040c8',
    symbol: '◈',
    xp: 2400,
    isBoss: true,
    canDodge: true,
    drops: [
      { name: 'Pure Ether Crystal', amount: 7 },
      { name: 'Remnant Ether', amount: 9999 }
    ],
    skills: [
      {
        // Zenis deploys the same broad-frequency suppression wave his army uses —
        // at the source level, it hits everything and slows the whole party's ATB.
        name: 'Sovereign Suppression',
        power: 0,
        type: 'debuff',
        target: 'all_party',
        effect: 'atb_slow',
        amount: 0.30,
        duration: 3,
        weight: 0.18
      },
      {
        // The Anima bloodline at combat magnitude — a concentrated Ether strike
        // that operates at a level Academy training doesn't fully prepare you for.
        name: 'Bloodline Magnitude',
        power: 1.9,
        type: 'magic',
        target: 'random',
        weight: 0.22
      },
      {
        // A wide-field discharge — the same architecture-level Ether that powers
        // the Sentinels, directed outward as a pressure front across the whole party.
        name: 'Architecture Wave',
        power: 1.0,
        type: 'magic',
        target: 'all_party',
        weight: 0.20
      },
      {
        // Zenis inhabits Kit as a vessel — he surfaces Kit's presence as a feint,
        // breaking the party's focus and reducing their ATK.
        name: 'Vessel Fracture',
        power: 0,
        type: 'debuff',
        target: 'all_party',
        effect: 'atk_slow',
        amount: 0.60,
        duration: 2,
        weight: 0.15
      },
      {
        // A single directed strike channeled through twenty-four years of bloodline
        // control — his hardest-hitting focused attack.
        name: "Sovereign's Decree",
        power: 2.3,
        type: 'magic',
        target: 'random',
        weight: 0.15
      },
      {
        // Zenis restructures the ambient Ether field around him — the same
        // 'structured' directive pattern Noah identified from the geological data.
        // Temporarily raises his own DEF as the field tightens around him.
        name: 'Directive Field',
        power: 0,
        type: 'debuff',
        target: 'all_party',
        effect: 'atb_slow',
        amount: 0.50,
        duration: 2,
        weight: 0.10
      }
    ],
    // Escalating cycle: open with a focused hit, mix in feints/suppression,
    // build to the two heaviest moves (AoE wave, then the named "Decree"
    // finisher) before looping. Reads as a deliberate boss rotation
    // rather than arbitrary randomness, fitting for a final encounter.
    pattern: [
      'Bloodline Magnitude',
      'Sovereign Suppression',
      "Sovereign's Decree",
      'Architecture Wave',
      'Vessel Fracture',
      'Directive Field'
    ]
  },

  // ── Zenis Anima — Chapter IV duel  (use with gimmick: zenis_arc, party: 'kaden_solo')
  zenis_duel: {
    name: 'Zenis Anima',
    subtitle: 'Sovereign of the Assurinlands',
    maxHp: 9000,
    atk: 160, def: 50, spd: 72,
    color: '#aeb8d8',
    symbol: '◈',
    xp: 2400,
    isBoss: true,
    isZenis: true,             // lets js/gimmicks/zenis_arc.js find him
    canDodge: false,
    drops: [],
    skills: [
      { name: 'Assessment',        power: 0,   type: 'debuff', target: 'all_party',
        effect: 'atk_slow', amount: 0.8, duration: 2,                       weight: 0.12 },
      { name: 'Inside the Draw',    power: 0,   type: 'buff',   target: 'self',
        effect: 'def_up',   amount: 1.2, duration: 2,                       weight: 0.16 },
      { name: 'Point-Blank Burst',    power: 1.7, type: 'magic',  target: 'random', weight: 0.26 },
      { name: 'Quiet Accord', power: 0,   type: 'debuff', target: 'all_party',
        effect: 'atb_slow', amount: 0.6, duration: 3,                       weight: 0.14 },
      { name: 'Standing Tide',    power: 0.9, type: 'magic',  target: 'random', weight: 0.18 },
      { name: 'Full Draw', power: 2.6, type: 'magic',  target: 'random', weight: 0.14 }
    ],
pattern: [
  'Quiet Accord', 'Assessment', 'Point-Blank Burst', 'Standing Tide',
  'Point-Blank Burst', 'Inside the Draw', 'Full Draw', 'Point-Blank Burst',
  'Standing Tide', 'Full Draw'
]
  },

  // ── Training Dummy  (tutorial)
  training_dummy: {
    name: 'Training Dummy',
    subtitle: 'An unbreakable practice target',
    maxHp: 9999,
    atk: 18, def: 8, spd: 22,
    color: '#7a8090',
    symbol: '◎',
    xp: 0,
    canDodge: false,
    isTrainingDummy: true,
    skills: [
      { name: 'Tap', power: 0.18, type: 'physical', target: 'random', weight: 0.70 },
      { name: 'Nudge', power: 0.10, type: 'physical', target: 'random', weight: 0.30 }
    ]
  },

  // ── Rusted Sentinel  (tutorial boss)
  rusted_sentinel: {
    name: 'Rusted Sentinel',
    subtitle: 'What remains when the training ends',
    maxHp: 1200,
    atk: 95, def: 28, spd: 38,
    color: '#c05020',
    symbol: '⬟',
    xp: 0,
    drops: [],
    isBoss: true,
    isTutorialBoss: true,
    canDodge: false,
    skills: [
      { name: 'Iron Swing',       power: 1.10, type: 'physical', target: 'random',    weight: 0.40 },
      { name: 'Corroded Slam',    power: 1.55, type: 'physical', target: 'random',    weight: 0.35 },
      { name: 'Rust Surge',       power: 0.80, type: 'physical', target: 'all_party', weight: 0.25 }
    ]
  }
};

/* ═════════════════════════════════════════════════════════════════════
   4. PARTY / ITEM LOADOUTS
   ═════════════════════════════════════════════════════════════════════ */
// Party + item loadouts. An encounter picks one with  party: 'stageN'  in its HTML setup.
//   stage1 — Kaden / Kurt / Ava, 4 skills each        (Gate Warden)
//   stage2 — Kaden / Kurt / Ava, 8 skills each        (Alley, Tutorial)
//   stage3 — + Iris, 8 skills each                    (Anima Lead Soldier, Anima Strike Team, Chain Keeper, Iron Custodian)
//   stage4 — + Iris, 12 skills each                   (Garrison Raid)
//
//   Stat progression (maxHp / maxMp / atk / def / spd) — every stat only ever goes UP stage to stage.
//                stage1                stage2                stage3                stage4
//   Kaden   460/ 90/ 68/42/50    640/130/105/46/55    820/175/140/50/65   1100/230/155/58/75
//   Kurt    360/120/ 75/24/45    480/160/ 80/60/48    650/230/ 90/90/56    820/270/105/110/62
//   Ava     300/ 70/ 72/20/110   360/110/ 85/24/110   420/150/100/30/110   560/190/115/40/110
//   Iris      —                    —                  450/210/100/50/65    600/250/115/60/70
//   Ava keeps SPD 110 (the party's fastest) at every stage.
const ITEMS_BASIC = [
  // ── Heal HP ──────────────────────────────────────────────
  {
    id: 'healing_ether',
    name: 'Healing Ether',
    icon: '⊕',
    count: 8,
    desc: 'Restores 220 HP to one ally — refined Ether compound, standard field issue',
    effect: 'heal_hp',
    amount: 220,
    target: 'single_ally'
  },
  {
    id: 'resonant_shard',
    name: 'Resonant Shard',
    icon: '◆',
    count: 4,
    desc: 'Restores 320 HP to one ally — a crystallised fragment of bridge Ether, packed with residual energy',
    effect: 'heal_hp',
    amount: 320,
    target: 'single_ally'
  },
  {
    id: 'revival_vial',
    name: 'Revival Vial',
    icon: '⬡',
    count: 3,
    desc: 'Restores 480 HP to one ally — emergency-grade compound, not meant for casual use',
    effect: 'heal_hp',
    amount: 480,
    target: 'single_ally'
  },
  {
    id: 'full_ether',
    name: 'Full Ether',
    icon: '●',
    count: 2,
    desc: 'Restores full HP to one ally — a rare, fully-concentrated vial. Use it when it counts',
    effect: 'heal_hp_full',
    target: 'single_ally'
  },
  // ── Heal MP ──────────────────────────────────────────────
  {
    id: 'mp_book',
    name: 'MP Book',
    icon: '□',
    count: 8,
    desc: 'Restores 60 MP to one ally — compact field manual with embedded Ether notation',
    effect: 'heal_mp',
    amount: 60,
    target: 'single_ally'
  },
  {
    id: 'ether_crystal_shard',
    name: 'Ether Shard',
    icon: '◇',
    count: 6,
    desc: 'Restores 110 MP to one ally — raw crystal fragment, sharp but effective',
    effect: 'heal_mp',
    amount: 110,
    target: 'single_ally'
  },
  {
    id: 'ether_vial',
    name: 'Ether Vial',
    icon: '○',
    count: 5,
    desc: 'Restores 180 MP to one ally — a standard practitioner supply, useful at any stage',
    effect: 'heal_mp',
    amount: 180,
    target: 'single_ally'
  },
  // ── Dual Restore ─────────────────────────────────────────
  {
    id: 'corridor_tonic',
    name: 'Corridor Tonic',
    icon: '◧',
    count: 4,
    desc: 'Restores 200 HP and 80 MP to one ally — a mixed-use field supply, scarce enough to use thoughtfully',
    effect: 'heal_dual',
    amount: 200,
    amount_mp: 80,
    target: 'single_ally'
  },
  {
    id: 'prime_tonic',
    name: 'Prime Tonic',
    icon: '◨',
    count: 2,
    desc: 'Restores 350 HP and 150 MP to one ally — a high-grade compound recovered from the bridge supply cache',
    effect: 'heal_dual',
    amount: 350,
    amount_mp: 150,
    target: 'single_ally'
  },
  // ── AP ───────────────────────────────────────────────────
  {
    id: 'atb_crystal',
    name: 'AP Crystal',
    icon: '⟳',
    count: 3,
    desc: 'Fills one ally\'s AP gauge immediately — lets them act out of turn sequence',
    effect: 'atb_fill',
    target: 'single_ally'
  },
  // ── Buff Items ───────────────────────────────────────────
  {
    id: 'swift_book',
    name: 'Swift Book',
    icon: '▶',
    count: 4,
    desc: 'Permanently raises one ally\'s SPD by 50% for this battle — a field-annotated speed primer',
    effect: 'spd_up',
    amount: 0.5,
    target: 'single_ally'
  },
  {
    id: 'iron_coat',
    name: 'Iron Coat',
    icon: '■',
    count: 3,
    desc: 'Applies DEF +60% to one ally for 4 turns — a field-hardening compound painted onto exposed joints',
    effect: 'item_def_up',
    amount: 0.60,
    duration: 4,
    target: 'single_ally'
  },
  {
    id: 'edge_primer',
    name: 'Edge Primer',
    icon: '▲',
    count: 3,
    desc: 'Applies ATK +50% to one ally for 3 turns — sharpens Ether output and physical strike pressure',
    effect: 'item_atk_up',
    amount: 0.50,
    duration: 3,
    target: 'single_ally'
  },
  {
    id: 'crit_lens',
    name: 'Crit Lens',
    icon: '◎',
    count: 4,
    desc: 'Guarantees one ally\'s next attack is a critical hit — a targeting lens tuned to Ether resonance points',
    effect: 'item_crit_next',
    target: 'single_ally'
  },
  {
    id: 'surge_capsule',
    name: 'Surge Capsule',
    icon: '⬟',
    count: 2,
    desc: 'ATK +70% and SPD +30% to one ally for 2 turns — short but brutal. A last-resort accelerant',
    effect: 'item_surge',
    amount_atk: 0.70,
    amount_spd: 0.30,
    duration: 2,
    target: 'single_ally'
  },
  // ── Debuff Items ─────────────────────────────────────────
  {
    id: 'anchor_seal',
    name: 'Anchor Seal',
    icon: '▽',
    count: 4,
    desc: 'Slows one enemy\'s AP charge rate by 50% for 3 turns — an Ether-laced seal that disrupts field timing',
    effect: 'item_atb_slow',
    amount: 0.50,
    duration: 3,
    target: 'single_enemy'
  },
  {
    id: 'fracture_vial',
    name: 'Fracture Vial',
    icon: '▼',
    count: 3,
    desc: 'Reduces one enemy\'s ATK by 40% for 3 turns — shatters Ether cohesion in the target\'s strike arm',
    effect: 'item_atk_slow',
    amount: 0.60,
    duration: 3,
    target: 'single_enemy'
  },
  {
    id: 'suppress_grenade',
    name: 'Suppression Grenade',
    icon: '✕',
    count: 2,
    desc: 'Slows AP by 60% and cuts ATK by 30% on all enemies for 2 turns — wide-field disruption device',
    effect: 'item_suppress_all',
    amount_atb: 0.40,
    amount_atk: 0.70,
    duration: 2,
    target: 'all_enemies'
  }
];

const ITEMS_FULL = [
  // ── Heal HP ──────────────────────────────────────────────
  {
    id: 'thorn_salve',
    name: 'Thorn Salve',
    icon: '✚',
    count: 4,
    desc: 'Restores 120 HP to one ally — a field dressing repurposed from bloodline botanical lore',
    effect: 'heal_hp',
    amount: 120,
    target: 'single_ally'
  },
  {
    id: 'healing_ether',
    name: 'Healing Ether',
    icon: '⊕',
    count: 8,
    desc: 'Restores 220 HP to one ally — refined Ether compound, standard field issue',
    effect: 'heal_hp',
    amount: 220,
    target: 'single_ally'
  },
  {
    id: 'resonant_shard',
    name: 'Resonant Shard',
    icon: '◆',
    count: 4,
    desc: 'Restores 320 HP to one ally — a crystallised fragment of bridge Ether, packed with residual energy',
    effect: 'heal_hp',
    amount: 320,
    target: 'single_ally'
  },
  {
    id: 'revival_vial',
    name: 'Revival Vial',
    icon: '⬡',
    count: 3,
    desc: 'Restores 480 HP to one ally — emergency-grade compound, not meant for casual use',
    effect: 'heal_hp',
    amount: 480,
    target: 'single_ally'
  },
  {
    id: 'full_ether',
    name: 'Full Ether',
    icon: '●',
    count: 2,
    desc: 'Restores full HP to one ally — a rare, fully-concentrated vial. Use it when it counts',
    effect: 'heal_hp_full',
    target: 'single_ally'
  },
  // ── Heal MP ──────────────────────────────────────────────
  {
    id: 'mp_book',
    name: 'MP Book',
    icon: '□',
    count: 8,
    desc: 'Restores 60 MP to one ally — compact field manual with embedded Ether notation',
    effect: 'heal_mp',
    amount: 60,
    target: 'single_ally'
  },
  {
    id: 'ether_crystal_shard',
    name: 'Ether Shard',
    icon: '◇',
    count: 6,
    desc: 'Restores 110 MP to one ally — raw crystal fragment, sharp but effective',
    effect: 'heal_mp',
    amount: 110,
    target: 'single_ally'
  },
  {
    id: 'ether_vial',
    name: 'Ether Vial',
    icon: '○',
    count: 5,
    desc: 'Restores 180 MP to one ally — a standard practitioner supply, useful at any stage',
    effect: 'heal_mp',
    amount: 180,
    target: 'single_ally'
  },
  // ── Dual Restore ─────────────────────────────────────────
  {
    id: 'corridor_tonic',
    name: 'Corridor Tonic',
    icon: '◧',
    count: 4,
    desc: 'Restores 200 HP and 80 MP to one ally — a mixed-use field supply, scarce enough to use thoughtfully',
    effect: 'heal_dual',
    amount: 200,
    amount_mp: 80,
    target: 'single_ally'
  },
  {
    id: 'prime_tonic',
    name: 'Prime Tonic',
    icon: '◨',
    count: 2,
    desc: 'Restores 350 HP and 150 MP to one ally — a high-grade compound recovered from the bridge supply cache',
    effect: 'heal_dual',
    amount: 350,
    amount_mp: 150,
    target: 'single_ally'
  },
  // ── ATB ──────────────────────────────────────────────────
  {
    id: 'atb_crystal',
    name: 'AP Crystal',
    icon: '⟳',
    count: 3,
    desc: 'Fills one ally\'s AP gauge immediately — lets them act out of turn sequence',
    effect: 'atb_fill',
    target: 'single_ally'
  },
  // ── Buff Items ───────────────────────────────────────────
  {
    id: 'swift_book',
    name: 'Swift Book',
    icon: '▶',
    count: 4,
    desc: 'Permanently raises one ally\'s SPD by 50% for this battle — a field-annotated speed primer',
    effect: 'spd_up',
    amount: 0.5,
    target: 'single_ally'
  },
  {
    id: 'iron_coat',
    name: 'Iron Coat',
    icon: '■',
    count: 3,
    desc: 'Applies DEF +60% to one ally for 4 turns — a field-hardening compound painted onto exposed joints',
    effect: 'item_def_up',
    amount: 0.60,
    duration: 4,
    target: 'single_ally'
  },
  {
    id: 'edge_primer',
    name: 'Edge Primer',
    icon: '▲',
    count: 3,
    desc: 'Applies ATK +50% to one ally for 3 turns — sharpens Ether output and physical strike pressure',
    effect: 'item_atk_up',
    amount: 0.50,
    duration: 3,
    target: 'single_ally'
  },
  {
    id: 'crit_lens',
    name: 'Crit Lens',
    icon: '◎',
    count: 4,
    desc: 'Guarantees one ally\'s next attack is a critical hit — a targeting lens tuned to Ether resonance points',
    effect: 'item_crit_next',
    target: 'single_ally'
  },
  {
    id: 'surge_capsule',
    name: 'Surge Capsule',
    icon: '⬟',
    count: 2,
    desc: 'ATK +70% and SPD +30% to one ally for 2 turns — short but brutal. A last-resort accelerant',
    effect: 'item_surge',
    amount_atk: 0.70,
    amount_spd: 0.30,
    duration: 2,
    target: 'single_ally'
  },
  // ── Debuff Items ─────────────────────────────────────────
  {
    id: 'anchor_seal',
    name: 'Anchor Seal',
    icon: '▽',
    count: 4,
    desc: 'Slows one enemy\'s AP charge rate by 50% for 3 turns — an Ether-laced seal that disrupts field timing',
    effect: 'item_atb_slow',
    amount: 0.50,
    duration: 3,
    target: 'single_enemy'
  },
  {
    id: 'fracture_vial',
    name: 'Fracture Vial',
    icon: '▼',
    count: 3,
    desc: 'Reduces one enemy\'s ATK by 40% for 3 turns — shatters Ether cohesion in the target\'s strike arm',
    effect: 'item_atk_slow',
    amount: 0.60,
    duration: 3,
    target: 'single_enemy'
  },
  {
    id: 'suppress_grenade',
    name: 'Suppression Grenade',
    icon: '✕',
    count: 2,
    desc: 'Slows AP by 60% and cuts ATK by 30% on all enemies for 2 turns — wide-field disruption device',
    effect: 'item_suppress_all',
    amount_atb: 0.40,
    amount_atk: 0.70,
    duration: 2,
    target: 'all_enemies'
  }
];

const PARTY_PRESETS = {
  stage1: { party: [
  {
    id: 'kaden',
    name: 'Kaden',
    subtitle: 'Vanguard Striker',
    maxHp: 460,
    maxMp: 90,
    atk: 68,
    def: 42,
    spd: 50,
    color: '#244fb1',
    symbol: '<svg viewBox="0 0 24 24" style="width:1.6em;height:1.6em" fill="none" stroke="currentColor" stroke-width="1.1"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="6.4" stroke-width="0.6"/><path d="M12,1 L12,3 M12,21 L12,23 M1,12 L3,12 M21,12 L23,12" stroke-width="0.9"/><polygon points="12,3 13.5,8 13.5,14.3 10.5,14.3 10.5,8"/><path d="M12,8 L12,14.3"/><path d="M8,14.3 L16,14.3" stroke-width="1.6"/><path d="M12,14.3 L12,17.5"/><path d="M9.8,14.3 L9.8,16.2 L8.6,16.2"/><rect x="10.8" y="17.5" width="2.4" height="1.6"/></svg>',
    canDodge: true,
    skills: [
      {
        name: 'Resonant Pulse',
        cost: 22,
        power: 1.5,
        type: 'magic',
        target: 'single',
        desc: 'Channel Ether through the body and discharge at close range'
      },
      {
        name: 'Hold the Line',
        cost: 16,
        power: 0,
        type: 'buff',
        target: 'all_party',
        effect: 'def_up',
        amount: 0.5,
        duration: 3,
        desc: 'Kaden plants himself at the front — whole party gains DEF +50% for 3 turns'
      },
      {
        name: 'Fault Line',
        cost: 28,
        power: 2.0,
        type: 'physical',
        target: 'single',
        piercing: 0.7,
        desc: 'Drive a point-blank Ether-charged blow through the guard, tearing through armor with brutal force'
      },
      {
        name: 'Rally Cry',
        cost: 20,
        power: 0,
        type: 'buff',
        target: 'all_party',
        effect: 'atk_up',
        amount: 0.35,
        duration: 3,
        desc: 'Kaden shouts to push the party forward — everyone\'s ATK rises by 35% for 3 turns'
      }
    ]
  },
  {
    id: 'kurt',
    name: 'Kurt',
    subtitle: 'Fire Specialist',
    maxHp: 360,
    maxMp: 120,
    atk: 75,
    def: 24,
    spd: 45,
    color: '#ed8149',
    symbol: '<svg viewBox="0 0 24 24" style="width:1.6em;height:1.6em" fill="none" stroke="currentColor" stroke-width="1.1"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="6.4" stroke-width="0.6"/><path d="M12,1 L12,3 M12,21 L12,23 M1,12 L3,12 M21,12 L23,12" stroke-width="0.9"/><path d="M12,7 C9.8,10 9,12.3 9,14 A3,3 0 0,0 15,14 C15,12.3 14.2,10.7 12.8,9.3 C13,10.7 12,11.3 12,10 C12,9 12.3,8 12,7 Z" fill="currentColor" stroke="none"/></svg>',
    canDodge: true,
    skills: [
      {
        name: 'Firestorm',
        cost: 32,
        power: 1.15,
        type: 'magic',
        target: 'all',
        desc: 'Unleash a wide wave of combustion across the entire field'
      },
      {
        name: 'Concentrated Burn',
        cost: 40,
        power: 2.4,
        type: 'magic',
        target: 'single',
        desc: 'Collapse all heat to a single scorching focal point — devastating on one target'
      },
      {
        name: 'Ignition Aura',
        cost: 26,
        power: 0,
        type: 'buff',
        target: 'all_party',
        effect: 'atk_up',
        amount: 0.45,
        duration: 2,
        desc: 'Kurt wraps the party in volatile heat — ATK +45% for 2 turns across the whole team'
      },
      {
        name: 'Backdraft',
        cost: 35,
        power: 1.7,
        type: 'magic',
        target: 'single',
        desc: 'A delayed pressure wave of superheated air — hits after a brief pause for extra impact'
      }
    ]
  },
  {
    id: 'ava',
    name: 'Ava',
    subtitle: 'Shadow Operative',
    maxHp: 300,
    maxMp: 70,
    atk: 72,
    def: 20,
    spd: 110,
    color: '#4a4a52',
    symbol: '<svg viewBox="0 0 24 24" style="width:1.6em;height:1.6em" fill="none" stroke="currentColor" stroke-width="1.1"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="6.4" stroke-width="0.6"/><path d="M12,1 L12,3 M12,21 L12,23 M1,12 L3,12 M21,12 L23,12" stroke-width="0.9"/><polygon points="12,3 13.6,15 10.4,15"/><path d="M8,15 L16,15 M12,15 L12,19"/><circle cx="12" cy="20" r="1.2" fill="currentColor" stroke="none"/></svg>',
    canDodge: true,
    skills: [
      {
        name: 'Shadow Mark',
        cost: 20,
        power: 0,
        type: 'buff',
        target: 'all_party',
        effect: 'crit_next',
        duration: 1,
        desc: 'Ava reads the enemy and signals the whole party — everyone\'s next hit lands as a critical'
      },
      {
        name: 'Vital Point',
        cost: 30,
        power: 1.8,
        type: 'physical',
        target: 'single',
        piercing: 0.55,
        desc: 'Drive the blade through armor into a critical gap — ignores most DEF'
      },
      {
        name: 'Phantom Flurry',
        cost: 28,
        power: 0.7,
        type: 'physical',
        target: 'all',
        piercing: 0.3,
        desc: 'Ava blurs through every enemy in a single pass, dealing light damage to all targets'
      },
      {
        name: 'Exploit Weakness',
        cost: 24,
        power: 2.2,
        type: 'physical',
        target: 'single',
        piercing: 0.8,
        desc: 'Strike the exact seam Ava has already mapped — almost completely bypasses armor'
      }
    ]
  }
], items: ITEMS_BASIC },

  stage2: { party: [
  {
    id: 'kaden',
    name: 'Kaden',
    subtitle: 'Vanguard Striker',
    maxHp: 640,
    maxMp: 130,
    atk: 105,
    def: 46,
    spd: 55,
    color: '#244fb1',
    symbol: '<svg viewBox="0 0 24 24" style="width:1.6em;height:1.6em" fill="none" stroke="currentColor" stroke-width="1.1"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="6.4" stroke-width="0.6"/><path d="M12,1 L12,3 M12,21 L12,23 M1,12 L3,12 M21,12 L23,12" stroke-width="0.9"/><polygon points="12,3 13.5,8 13.5,14.3 10.5,14.3 10.5,8"/><path d="M12,8 L12,14.3"/><path d="M8,14.3 L16,14.3" stroke-width="1.6"/><path d="M12,14.3 L12,17.5"/><path d="M9.8,14.3 L9.8,16.2 L8.6,16.2"/><rect x="10.8" y="17.5" width="2.4" height="1.6"/></svg>',
    canDodge: true,
    skills: [
      {
        name: 'Resonant Pulse',
        cost: 22,
        power: 2.0,
        type: 'magic',
        target: 'single',
        desc: 'Channel Ether through the body and discharge at close range — hits harder than it looks'
      },
      {
        name: 'Hold the Line',
        cost: 16,
        power: 0,
        type: 'buff',
        target: 'all_party',
        effect: 'def_up',
        amount: 0.5,
        duration: 3,
        desc: 'Kaden plants himself at the front — whole party gains DEF +50% for 3 turns'
      },
      {
        name: 'Fault Line',
        cost: 28,
        power: 2.8,
        type: 'physical',
        target: 'single',
        piercing: 0.75,
        desc: 'Drive a point-blank Ether-charged blow through the guard, tearing through armor with brutal force'
      },
      {
        name: 'Rally Cry',
        cost: 20,
        power: 0,
        type: 'buff',
        target: 'all_party',
        effect: 'atk_up',
        amount: 0.35,
        duration: 3,
        desc: 'Kaden shouts to push the party forward — everyone\'s ATK rises by 35% for 3 turns'
      },
      {
        name: 'Steel Surge',
        cost: 120,
        power: 1.4,
        type: 'physical',
        target: 'all',
        piercing: 0.35,
        desc: 'Kaden charges through the line with overwhelming force, striking every enemy with crushing impact'
      },
      {
        name: 'Iron Resolve',
        cost: 18,
        power: 0,
        type: 'buff',
        target: 'all_party',
        effect: 'def_up',
        amount: 0.8,
        duration: 2,
        desc: 'Kaden braces the team against the worst — DEF +80% for 2 turns, a brief but powerful shield'
      },
      {
        name: 'Crossfall',
        cost: 38,
        power: 3.4,
        type: 'physical',
        target: 'single',
        piercing: 0.6,
        desc: 'Kaden commits his whole frame to one crossing motion — his hardest hitting single strike'
      },
      {
        name: 'Vanguard Oath',
        cost: 30,
        power: 0,
        type: 'buff',
        target: 'all_party',
        effect: 'atk_up',
        amount: 0.6,
        duration: 2,
        desc: 'Kaden swears on the front line — the whole party surges with ATK +60% for 2 turns, his most powerful war cry'
      }
    ]
  },
  {
    id: 'kurt',
    name: 'Kurt',
    subtitle: 'Flame Bulwark',
    maxHp: 480,
    maxMp: 160,
    atk: 80,
    def: 60,
    spd: 48,
    color: '#ed8149',
    symbol: '<svg viewBox="0 0 24 24" style="width:1.6em;height:1.6em" fill="none" stroke="currentColor" stroke-width="1.1"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="6.4" stroke-width="0.6"/><path d="M12,1 L12,3 M12,21 L12,23 M1,12 L3,12 M21,12 L23,12" stroke-width="0.9"/><path d="M12,7 C9.8,10 9,12.3 9,14 A3,3 0 0,0 15,14 C15,12.3 14.2,10.7 12.8,9.3 C13,10.7 12,11.3 12,10 C12,9 12.3,8 12,7 Z" fill="currentColor" stroke="none"/></svg>',
    canDodge: false,
    skills: [
      {
        name: 'Firestorm',
        cost: 32,
        power: 1.0,
        type: 'magic',
        target: 'all',
        desc: 'Unleash a wide wave of combustion across the entire field'
      },
      {
        name: 'Concentrated Burn',
        cost: 40,
        power: 1.8,
        type: 'magic',
        target: 'single',
        desc: 'Collapse all heat to a single scorching focal point — Kurt\'s strongest offensive fire'
      },
      {
        name: 'Ignition Aura',
        cost: 26,
        power: 0,
        type: 'buff',
        target: 'all_party',
        effect: 'atk_up',
        amount: 0.45,
        duration: 2,
        desc: 'Kurt wraps the party in volatile heat — ATK +45% for 2 turns across the whole team'
      },
      {
        name: 'Backdraft',
        cost: 35,
        power: 1.4,
        type: 'magic',
        target: 'single',
        desc: 'A delayed pressure wave of superheated air — solid damage with a brief delay'
      },
      {
        name: 'Cinder Wall',
        cost: 22,
        power: 0,
        type: 'buff',
        target: 'all_party',
        effect: 'def_up',
        amount: 0.55,
        duration: 3,
        desc: 'Kurt raises a wall of burning cinders — DEF +55% for 3 turns, his signature defensive stance'
      },
      {
        name: 'Meltdown',
        cost: 48,
        power: 2.2,
        type: 'magic',
        target: 'single',
        desc: 'Kurt channels all his heat into one burst — heavy damage, but his body takes the strain too'
      },
      {
        name: 'Ember Lance',
        cost: 30,
        power: 1.5,
        type: 'magic',
        target: 'single',
        desc: 'A narrow focused jet of flame — reliable mid-tier fire with consistent output'
      },
      {
        name: 'Flashover',
        cost: 44,
        power: 1.2,
        type: 'magic',
        target: 'all',
        desc: 'The air itself ignites — simultaneous field-wide combustion, prioritizing wide coverage over raw power'
      }
    ]
  },
  {
    id: 'ava',
    name: 'Ava',
    subtitle: 'Shadow Tactician',
    maxHp: 360,
    maxMp: 110,
    atk: 85,
    def: 24,
    spd: 110,
    color: '#4a4a52',
    symbol: '<svg viewBox="0 0 24 24" style="width:1.6em;height:1.6em" fill="none" stroke="currentColor" stroke-width="1.1"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="6.4" stroke-width="0.6"/><path d="M12,1 L12,3 M12,21 L12,23 M1,12 L3,12 M21,12 L23,12" stroke-width="0.9"/><polygon points="12,3 13.6,15 10.4,15"/><path d="M8,15 L16,15 M12,15 L12,19"/><circle cx="12" cy="20" r="1.2" fill="currentColor" stroke="none"/></svg>',
    canDodge: true,
    skills: [
      {
        name: 'Shadow Mark',
        cost: 20,
        power: 0,
        type: 'buff',
        target: 'all_party',
        effect: 'crit_next',
        duration: 1,
        desc: 'Ava reads the enemy and signals the whole party — everyone\'s next hit lands as a critical'
      },
      {
        name: 'Vital Point',
        cost: 30,
        power: 1.8,
        type: 'physical',
        target: 'single',
        piercing: 0.55,
        desc: 'Drive the blade through armor into a critical gap — ignores most DEF'
      },
      {
        name: 'Phantom Flurry',
        cost: 28,
        power: 0.75,
        type: 'physical',
        target: 'all',
        piercing: 0.3,
        desc: 'Ava blurs through every enemy in a single pass, dealing light damage to all targets'
      },
      {
        name: 'Exploit Weakness',
        cost: 24,
        power: 2.2,
        type: 'physical',
        target: 'single',
        piercing: 0.85,
        desc: 'Strike the exact seam Ava has already mapped — almost completely bypasses armor'
      },
      {
        name: 'Smoke Screen',
        cost: 16,
        power: 0,
        type: 'debuff',
        target: 'all',
        effect: 'atb_slow',
        amount: 0.40,
        duration: 3,
        desc: 'Ava deploys a smoke canister — the enemy loses all visibility, their ATB slowed for 3 turns'
      },
      {
        name: 'Death Mark',
        cost: 36,
        power: 2.8,
        type: 'physical',
        target: 'single',
        piercing: 0.9,
        desc: 'The culmination of every observation Ava has made — a single, near-unblockable execution strike'
      },
      {
        name: 'Nerve Cut',
        cost: 22,
        power: 1.2,
        type: 'physical',
        target: 'single',
        piercing: 0.4,
        desc: 'A precise slash targeting motor nerves — moderate damage that disrupts the target\'s rhythm'
      },
      {
        name: 'Ghost Step',
        cost: 18,
        power: 0,
        type: 'buff',
        target: 'all_party',
        effect: 'crit_next',
        duration: 1,
        desc: 'Ava phases through the battlefield unseen, repositioning the whole team for a guaranteed critical follow-up'
      }
    ]
  }
], items: ITEMS_BASIC },

  stage3: { party: [
  {
    id: 'kaden',
    name: 'Kaden',
    subtitle: 'Vanguard Striker',
    maxHp: 820,
    maxMp: 175,
    atk: 140,
    def: 50,
    spd: 65,
    color: '#244fb1',
    symbol: '<svg viewBox="0 0 24 24" style="width:1.6em;height:1.6em" fill="none" stroke="currentColor" stroke-width="1.1"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="6.4" stroke-width="0.6"/><path d="M12,1 L12,3 M12,21 L12,23 M1,12 L3,12 M21,12 L23,12" stroke-width="0.9"/><polygon points="12,3 13.5,8 13.5,14.3 10.5,14.3 10.5,8"/><path d="M12,8 L12,14.3"/><path d="M8,14.3 L16,14.3" stroke-width="1.6"/><path d="M12,14.3 L12,17.5"/><path d="M9.8,14.3 L9.8,16.2 L8.6,16.2"/><rect x="10.8" y="17.5" width="2.4" height="1.6"/></svg>',
    canDodge: true,
    skills: [
      {
        name: 'Resonant Pulse',
        cost: 22,
        power: 2.0,
        type: 'magic',
        target: 'single',
        desc: 'Channel Ether through the body and discharge at close range — hits harder than it looks'
      },
      {
        name: 'Hold the Line',
        cost: 16,
        power: 0,
        type: 'buff',
        target: 'all_party',
        effect: 'def_up',
        amount: 0.5,
        duration: 3,
        desc: 'Kaden plants himself at the front — whole party gains DEF +50% for 3 turns'
      },
      {
        name: 'Fault Line',
        cost: 28,
        power: 2.8,
        type: 'physical',
        target: 'single',
        piercing: 0.75,
        desc: 'Drive a point-blank Ether-charged blow through the guard, tearing through armor with brutal force'
      },
      {
        name: 'Rally Cry',
        cost: 20,
        power: 0,
        type: 'buff',
        target: 'all_party',
        effect: 'atk_up',
        amount: 0.35,
        duration: 3,
        desc: 'Kaden shouts to push the party forward — everyone\'s ATK rises by 35% for 3 turns'
      },
      {
        name: 'Steel Surge',
        cost: 120,
        power: 1.4,
        type: 'physical',
        target: 'all',
        piercing: 0.35,
        desc: 'Kaden charges through the line with everything he has — moderate damage to all enemies, high MP cost, best saved for clustered fights'
      },
      {
        name: 'Iron Resolve',
        cost: 18,
        power: 0,
        type: 'buff',
        target: 'all_party',
        effect: 'def_up',
        amount: 0.8,
        duration: 2,
        desc: 'Kaden braces the team against the worst — DEF +80% for 2 turns, a brief but powerful shield'
      },
      {
        name: 'Crossfall',
        cost: 38,
        power: 3.4,
        type: 'physical',
        target: 'single',
        piercing: 0.6,
        desc: 'Kaden commits his whole frame to one crossing motion — his hardest single-target hit at this stage of the fight'
      },
      {
        name: 'Vanguard Oath',
        cost: 30,
        power: 0,
        type: 'buff',
        target: 'all_party',
        effect: 'atk_up',
        amount: 0.6,
        duration: 2,
        desc: 'Kaden swears on the front line — ATK +60% for 2 turns across the whole party, shorter window than Rally Cry but the multiplier is stronger'
      }
    ]
  },
  {
    id: 'kurt',
    name: 'Kurt',
    subtitle: 'Flame Bulwark',
    maxHp: 650,
    maxMp: 230,
    atk: 90,
    def: 90,
    spd: 56,
    color: '#ed8149',
    symbol: '<svg viewBox="0 0 24 24" style="width:1.6em;height:1.6em" fill="none" stroke="currentColor" stroke-width="1.1"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="6.4" stroke-width="0.6"/><path d="M12,1 L12,3 M12,21 L12,23 M1,12 L3,12 M21,12 L23,12" stroke-width="0.9"/><path d="M12,7 C9.8,10 9,12.3 9,14 A3,3 0 0,0 15,14 C15,12.3 14.2,10.7 12.8,9.3 C13,10.7 12,11.3 12,10 C12,9 12.3,8 12,7 Z" fill="currentColor" stroke="none"/></svg>',
    canDodge: false,
    skills: [
      {
        name: 'Firestorm',
        cost: 32,
        power: 1.0,
        type: 'magic',
        target: 'all',
        desc: 'Unleash a wide wave of combustion across the entire field'
      },
      {
        name: 'Concentrated Burn',
        cost: 40,
        power: 1.8,
        type: 'magic',
        target: 'single',
        desc: 'Collapse all heat to a single focal point — reliable single-target fire damage, good MP efficiency'
      },
      {
        name: 'Ignition Aura',
        cost: 26,
        power: 0,
        type: 'buff',
        target: 'all_party',
        effect: 'atk_up',
        amount: 0.45,
        duration: 2,
        desc: 'Kurt wraps the party in volatile heat — ATK +45% for 2 turns across the whole team'
      },
      {
        name: 'Backdraft',
        cost: 35,
        power: 1.4,
        type: 'magic',
        target: 'single',
        desc: 'A delayed pressure wave of superheated air — solid damage with a brief delay'
      },
      {
        name: 'Cinder Wall',
        cost: 22,
        power: 0,
        type: 'buff',
        target: 'all_party',
        effect: 'def_up',
        amount: 0.55,
        duration: 3,
        desc: 'Kurt raises a wall of burning cinders — DEF +55% for 3 turns, his go-to defensive stance'
      },
      {
        name: 'Meltdown',
        cost: 48,
        power: 2.2,
        type: 'magic',
        target: 'single',
        desc: 'Kurt forces everything into a single burst — high damage, high cost, and it shows on him afterward'
      },
      {
        name: 'Ember Lance',
        cost: 30,
        power: 1.5,
        type: 'magic',
        target: 'single',
        desc: 'A narrow focused jet of flame — reliable mid-tier fire with consistent output'
      },
      {
        name: 'Flashover',
        cost: 44,
        power: 1.2,
        type: 'magic',
        target: 'all',
        desc: 'The air itself ignites — simultaneous field-wide combustion, prioritizing wide coverage over raw power'
      }
    ]
  },
  {
    id: 'ava',
    name: 'Ava',
    subtitle: 'Shadow Tactician',
    maxHp: 420,
    maxMp: 150,
    atk: 100,
    def: 30,
    spd: 110,
    color: '#4a4a52',
    symbol: '<svg viewBox="0 0 24 24" style="width:1.6em;height:1.6em" fill="none" stroke="currentColor" stroke-width="1.1"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="6.4" stroke-width="0.6"/><path d="M12,1 L12,3 M12,21 L12,23 M1,12 L3,12 M21,12 L23,12" stroke-width="0.9"/><polygon points="12,3 13.6,15 10.4,15"/><path d="M8,15 L16,15 M12,15 L12,19"/><circle cx="12" cy="20" r="1.2" fill="currentColor" stroke="none"/></svg>',
    canDodge: true,
    skills: [
      {
        name: 'Shadow Mark',
        cost: 20,
        power: 0,
        type: 'buff',
        target: 'all_party',
        effect: 'crit_next',
        duration: 1,
        desc: 'Ava reads the enemy and signals the whole party — everyone\'s next hit lands as a critical'
      },
      {
        name: 'Vital Point',
        cost: 30,
        power: 1.8,
        type: 'physical',
        target: 'single',
        piercing: 0.55,
        desc: 'Drive the blade through armor into a critical gap — ignores most DEF'
      },
      {
        name: 'Phantom Flurry',
        cost: 28,
        power: 0.75,
        type: 'physical',
        target: 'all',
        piercing: 0.3,
        desc: 'Ava blurs through every enemy in a single pass, dealing light damage to all targets'
      },
      {
        name: 'Exploit Weakness',
        cost: 24,
        power: 2.2,
        type: 'physical',
        target: 'single',
        piercing: 0.85,
        desc: 'Strike a structural gap Ava has already mapped — high piercing, most of the target\'s DEF means nothing'
      },
      {
        name: 'Smoke Screen',
        cost: 16,
        power: 0,
        type: 'debuff',
        target: 'all',
        effect: 'atb_slow',
        amount: 0.40,
        duration: 3,
        desc: 'Ava deploys a smoke canister — the enemy loses all visibility, their AP slowed for 3 turns'
      },
      {
        name: 'Death Mark',
        cost: 36,
        power: 2.8,
        type: 'physical',
        target: 'single',
        piercing: 0.9,
        desc: 'Ava commits everything she has read on the target — precise, near-unblockable, bypasses nearly all DEF'
      },
      {
        name: 'Nerve Cut',
        cost: 22,
        power: 1.2,
        type: 'physical',
        target: 'single',
        piercing: 0.4,
        desc: 'A precise slash targeting motor nerves — moderate damage that disrupts the target\'s rhythm'
      },
      {
        name: 'Ghost Step',
        cost: 18,
        power: 0,
        type: 'buff',
        target: 'all_party',
        effect: 'crit_next',
        duration: 1,
        desc: 'Ava repositions unseen — the whole team gets a guaranteed critical on their next hit'
      }
    ]
  },
  {
    id: 'iris',
    name: 'Iris',
    subtitle: 'Anima Sorceress',
    maxHp: 450,
    maxMp: 210,
    atk: 100,
    def: 50,
    spd: 65,
    color: '#1f81d1',
    symbol: '<svg viewBox="0 0 24 24" style="width:1.6em;height:1.6em" fill="none" stroke="currentColor" stroke-width="1.1"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="6.4" stroke-width="0.6"/><path d="M12,1 L12,3 M12,21 L12,23 M1,12 L3,12 M21,12 L23,12" stroke-width="0.9"/><polygon points="12,7.5 16.5,12 12,16.5 7.5,12"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/></svg>',
    canDodge: true,
    skills: [
      {
        name: 'Bloodline Strike',
        cost: 24,
        power: 2.1,
        type: 'magic',
        target: 'single',
        desc: 'A focused Anima discharge — silver Ether compressed to a single point, reliable magic damage'
      },
      {
        name: 'Mend',
        cost: 28,
        power: 0,
        type: 'heal',
        target: 'all_party',
        healAmount: 120,
        desc: 'Iris reads the damage and threads healing through it — restores HP to all party members'
      },
      {
        name: 'Suppression Step',
        cost: 20,
        power: 0,
        type: 'debuff',
        target: 'all',
        effect: 'atb_slow',
        amount: 0.45,
        duration: 3,
        desc: 'Three months inside her own bloodline\'s suppression taught her how it works — all enemies\' AP slowed for 3 turns'
      },
      {
        name: 'Anima Barrier',
        cost: 22,
        power: 0,
        type: 'buff',
        target: 'all_party',
        effect: 'def_up',
        amount: 0.55,
        duration: 3,
        desc: 'Iris wraps the party in a structured Ether field — DEF +55% for 3 turns, the same architecture her bloodline uses to suppress others turned inward'
      },
      {
        name: 'Silver Surge',
        cost: 36,
        power: 1.15,
        type: 'magic',
        target: 'all',
        desc: 'Release a wide-field Anima discharge — silver light sweeps all enemies, trading raw power for coverage'
      },
      {
        name: 'Field Read',
        cost: 18,
        power: 0,
        type: 'buff',
        target: 'all_party',
        effect: 'atk_up',
        amount: 0.40,
        duration: 3,
        desc: 'Iris reads the enemy formation in the methodical sequence trained into the bloodline — the whole party\'s ATK rises by 40% for 3 turns'
      },
      {
        name: 'Ether Inversion',
        cost: 44,
        power: 2.6,
        type: 'magic',
        target: 'single',
        desc: 'Turn the target\'s own Ether field against them — concentrated reversal, her heaviest single-target hit'
      },
      {
        name: 'Ether Resonance',
        cost: 80,
        power: 0,
        type: 'heal',
        target: 'all_party',
        healAmount: 180,
        healFull: false,
        desc: 'Iris harmonises the party\'s Ether fields into a single resonant frequency — restoring a significant portion of each member\'s HP. Costly, but far more forgiving than pushing the bloodline to its limit'
      }
    ]
  }
], items: ITEMS_FULL },

  stage4: { party: [
  {
    id: 'kaden',
    name: 'Kaden',
    subtitle: 'Vanguard Striker',
    maxHp: 1100,
    maxMp: 230,
    atk: 155,
    def: 58,
    spd: 75,
    color: '#244fb1',
    symbol: '<svg viewBox="0 0 24 24" style="width:1.6em;height:1.6em" fill="none" stroke="currentColor" stroke-width="1.1"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="6.4" stroke-width="0.6"/><path d="M12,1 L12,3 M12,21 L12,23 M1,12 L3,12 M21,12 L23,12" stroke-width="0.9"/><polygon points="12,3 13.5,8 13.5,14.3 10.5,14.3 10.5,8"/><path d="M12,8 L12,14.3"/><path d="M8,14.3 L16,14.3" stroke-width="1.6"/><path d="M12,14.3 L12,17.5"/><path d="M9.8,14.3 L9.8,16.2 L8.6,16.2"/><rect x="10.8" y="17.5" width="2.4" height="1.6"/></svg>',
    canDodge: true,
    skills: [
      {
        name: 'Resonant Pulse',
        cost: 22,
        power: 2.0,
        type: 'magic',
        target: 'single',
        desc: 'Channel Ether through the body and discharge at close range — hits harder than it looks'
      },
      {
        name: 'Hold the Line',
        cost: 16,
        power: 0,
        type: 'buff',
        target: 'all_party',
        effect: 'def_up',
        amount: 0.5,
        duration: 3,
        desc: 'Kaden plants himself at the front — whole party gains DEF +50% for 3 turns'
      },
      {
        name: 'Fault Line',
        cost: 28,
        power: 2.8,
        type: 'physical',
        target: 'single',
        piercing: 0.75,
        desc: 'Drive a point-blank Ether-charged blow through the guard, tearing through armor with brutal force'
      },
      {
        name: 'Rally Cry',
        cost: 20,
        power: 0,
        type: 'buff',
        target: 'all_party',
        effect: 'atk_up',
        amount: 0.35,
        duration: 3,
        desc: 'Kaden shouts to push the party forward — everyone\'s ATK rises by 35% for 3 turns'
      },
      {
        name: 'Steel Surge',
        cost: 120,
        power: 1.4,
        type: 'physical',
        target: 'all',
        piercing: 0.35,
        desc: 'Kaden charges through the line with everything he has — moderate damage to all enemies, high MP cost, best saved for clustered fights'
      },
      {
        name: 'Iron Resolve',
        cost: 18,
        power: 0,
        type: 'buff',
        target: 'all_party',
        effect: 'def_up',
        amount: 0.8,
        duration: 2,
        desc: 'Kaden braces the team against the worst — DEF +80% for 2 turns, a brief but powerful shield'
      },
      {
        name: 'Crossfall',
        cost: 38,
        power: 3.4,
        type: 'physical',
        target: 'single',
        piercing: 0.6,
        desc: 'Kaden commits his whole frame to one crossing motion — his hardest single-target hit at this stage of the fight'
      },
      {
        name: 'Vanguard Oath',
        cost: 30,
        power: 0,
        type: 'buff',
        target: 'all_party',
        effect: 'atk_up',
        amount: 0.6,
        duration: 2,
        desc: 'Kaden swears on the front line — ATK +60% for 2 turns across the whole party, shorter window than Rally Cry but the multiplier is stronger'
      },
      {
        name: 'Ether Bash',
        cost: 18,
        power: 1.5,
        type: 'physical',
        target: 'single',
        piercing: 0.2,
        desc: 'A blunt Ether-charged strike — no finesse, just force. Decent damage for a low MP investment'
      },
      {
        name: 'Cover Ground',
        cost: 14,
        power: 0,
        type: 'buff',
        target: 'all_party',
        effect: 'def_up',
        amount: 0.3,
        duration: 2,
        desc: 'Kaden repositions, tightening the formation — a modest DEF boost that costs little and keeps the team from taking unnecessary punishment'
      },
      {
        name: 'Pressure Point',
        cost: 24,
        power: 2.1,
        type: 'physical',
        target: 'single',
        piercing: 0.45,
        desc: 'A mid-range burst of focused Ether — solid single-target damage, reliable when the bigger hits aren\'t worth the cost yet'
      },
      {
        name: 'Frontline Shout',
        cost: 16,
        power: 0,
        type: 'buff',
        target: 'all_party',
        effect: 'atk_up',
        amount: 0.25,
        duration: 3,
        desc: 'A rough call from the front — the boost isn\'t dramatic, but it\'s cheap and lasts long enough to matter across several turns'
      }
    ]
  },
  {
    id: 'kurt',
    name: 'Kurt',
    subtitle: 'Flame Bulwark',
    maxHp: 820,
    maxMp: 270,
    atk: 105,
    def: 110,
    spd: 62,
    color: '#ed8149',
    symbol: '<svg viewBox="0 0 24 24" style="width:1.6em;height:1.6em" fill="none" stroke="currentColor" stroke-width="1.1"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="6.4" stroke-width="0.6"/><path d="M12,1 L12,3 M12,21 L12,23 M1,12 L3,12 M21,12 L23,12" stroke-width="0.9"/><path d="M12,7 C9.8,10 9,12.3 9,14 A3,3 0 0,0 15,14 C15,12.3 14.2,10.7 12.8,9.3 C13,10.7 12,11.3 12,10 C12,9 12.3,8 12,7 Z" fill="currentColor" stroke="none"/></svg>',
    canDodge: false,
    skills: [
      {
        name: 'Firestorm',
        cost: 32,
        power: 1.0,
        type: 'magic',
        target: 'all',
        desc: 'Unleash a wide wave of combustion across the entire field'
      },
      {
        name: 'Concentrated Burn',
        cost: 40,
        power: 1.8,
        type: 'magic',
        target: 'single',
        desc: 'Collapse all heat to a single focal point — reliable single-target fire damage, good MP efficiency'
      },
      {
        name: 'Ignition Aura',
        cost: 26,
        power: 0,
        type: 'buff',
        target: 'all_party',
        effect: 'atk_up',
        amount: 0.45,
        duration: 2,
        desc: 'Kurt wraps the party in volatile heat — ATK +45% for 2 turns across the whole team'
      },
      {
        name: 'Backdraft',
        cost: 35,
        power: 1.4,
        type: 'magic',
        target: 'single',
        desc: 'A delayed pressure wave of superheated air — solid damage with a brief delay'
      },
      {
        name: 'Cinder Wall',
        cost: 22,
        power: 0,
        type: 'buff',
        target: 'all_party',
        effect: 'def_up',
        amount: 0.55,
        duration: 3,
        desc: 'Kurt raises a wall of burning cinders — DEF +55% for 3 turns, his go-to defensive stance'
      },
      {
        name: 'Meltdown',
        cost: 48,
        power: 2.2,
        type: 'magic',
        target: 'single',
        desc: 'Kurt forces everything into a single burst — high damage, high cost, and it shows on him afterward'
      },
      {
        name: 'Ember Lance',
        cost: 30,
        power: 1.5,
        type: 'magic',
        target: 'single',
        desc: 'A narrow focused jet of flame — reliable mid-tier fire with consistent output'
      },
      {
        name: 'Flashover',
        cost: 44,
        power: 1.2,
        type: 'magic',
        target: 'all',
        desc: 'The air itself ignites — simultaneous field-wide combustion, prioritizing wide coverage over raw power'
      },
      {
        name: 'Scorched Earth',
        cost: 28,
        power: 1.1,
        type: 'magic',
        target: 'all',
        desc: 'Kurt floods the ground with sustained heat — not spectacular, but applies consistent pressure across the whole field'
      },
      {
        name: 'Heat Sink',
        cost: 18,
        power: 0,
        type: 'buff',
        target: 'all_party',
        effect: 'def_up',
        amount: 0.35,
        duration: 2,
        desc: 'Kurt vents combustion outward as a radiant shell — a moderate defensive layer bought with minimal effort'
      },
      {
        name: 'Thermal Lance',
        cost: 36,
        power: 1.6,
        type: 'magic',
        target: 'single',
        desc: 'A sustained column of heat driven into a single target — less volatile than Meltdown, but more controlled and still bites'
      },
      {
        name: 'Kindle',
        cost: 14,
        power: 0.9,
        type: 'magic',
        target: 'single',
        desc: 'Small ignition, low cost — useful for keeping pressure on a softened target without burning through MP reserves'
      }
    ]
  },
  {
    id: 'ava',
    name: 'Ava',
    subtitle: 'Shadow Tactician',
    maxHp: 560,
    maxMp: 190,
    atk: 115,
    def: 40,
    spd: 110,
    color: '#4a4a52',
    symbol: '<svg viewBox="0 0 24 24" style="width:1.6em;height:1.6em" fill="none" stroke="currentColor" stroke-width="1.1"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="6.4" stroke-width="0.6"/><path d="M12,1 L12,3 M12,21 L12,23 M1,12 L3,12 M21,12 L23,12" stroke-width="0.9"/><polygon points="12,3 13.6,15 10.4,15"/><path d="M8,15 L16,15 M12,15 L12,19"/><circle cx="12" cy="20" r="1.2" fill="currentColor" stroke="none"/></svg>',
    canDodge: true,
    skills: [
      {
        name: 'Shadow Mark',
        cost: 20,
        power: 0,
        type: 'buff',
        target: 'all_party',
        effect: 'crit_next',
        duration: 1,
        desc: 'Ava reads the enemy and signals the whole party — everyone\'s next hit lands as a critical'
      },
      {
        name: 'Vital Point',
        cost: 30,
        power: 1.8,
        type: 'physical',
        target: 'single',
        piercing: 0.55,
        desc: 'Drive the blade through armor into a critical gap — ignores most DEF'
      },
      {
        name: 'Phantom Flurry',
        cost: 28,
        power: 0.75,
        type: 'physical',
        target: 'all',
        piercing: 0.3,
        desc: 'Ava blurs through every enemy in a single pass, dealing light damage to all targets'
      },
      {
        name: 'Exploit Weakness',
        cost: 24,
        power: 2.2,
        type: 'physical',
        target: 'single',
        piercing: 0.85,
        desc: 'Strike a structural gap Ava has already mapped — high piercing, most of the target\'s DEF means nothing'
      },
      {
        name: 'Smoke Screen',
        cost: 16,
        power: 0,
        type: 'debuff',
        target: 'all',
        effect: 'atb_slow',
        amount: 0.40,
        duration: 3,
        desc: 'Ava deploys a smoke canister — the enemy loses all visibility, their AP slowed for 3 turns'
      },
      {
        name: 'Death Mark',
        cost: 36,
        power: 2.8,
        type: 'physical',
        target: 'single',
        piercing: 0.9,
        desc: 'Ava commits everything she has read on the target — precise, near-unblockable, bypasses nearly all DEF'
      },
      {
        name: 'Nerve Cut',
        cost: 22,
        power: 1.2,
        type: 'physical',
        target: 'single',
        piercing: 0.4,
        desc: 'A precise slash targeting motor nerves — moderate damage that disrupts the target\'s rhythm'
      },
      {
        name: 'Ghost Step',
        cost: 18,
        power: 0,
        type: 'buff',
        target: 'all_party',
        effect: 'crit_next',
        duration: 1,
        desc: 'Ava repositions unseen — the whole team gets a guaranteed critical on their next hit'
      },
      {
        name: 'Quick Slash',
        cost: 12,
        power: 1.0,
        type: 'physical',
        target: 'single',
        piercing: 0.25,
        desc: 'A fast, uncomplicated cut — Ava\'s speed makes it land before most enemies can react, nothing more'
      },
      {
        name: 'Disruption Strike',
        cost: 20,
        power: 1.3,
        type: 'physical',
        target: 'single',
        piercing: 0.35,
        desc: 'A strike aimed at throwing off the target\'s timing — moderate damage with a practical edge'
      },
      {
        name: 'Flicker Step',
        cost: 14,
        power: 0,
        type: 'debuff',
        target: 'all',
        effect: 'atb_slow',
        amount: 0.20,
        duration: 2,
        desc: 'Ava darts across the field in a blur — a lighter smoke screen, briefer and cheaper, but enough to buy the party a breath'
      },
      {
        name: 'Feint Cut',
        cost: 22,
        power: 1.6,
        type: 'physical',
        target: 'single',
        piercing: 0.5,
        desc: 'Ava fakes low then drives high — the misdirection doesn\'t guarantee a kill but it punches through a decent chunk of armor'
      }
    ]
  },
  {
    id: 'iris',
    name: 'Iris',
    subtitle: 'Anima Sorceress',
    maxHp: 600,
    maxMp: 250,
    atk: 115,
    def: 60,
    spd: 70,
    color: '#1f81d1',
    symbol: '<svg viewBox="0 0 24 24" style="width:1.6em;height:1.6em" fill="none" stroke="currentColor" stroke-width="1.1"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="6.4" stroke-width="0.6"/><path d="M12,1 L12,3 M12,21 L12,23 M1,12 L3,12 M21,12 L23,12" stroke-width="0.9"/><polygon points="12,7.5 16.5,12 12,16.5 7.5,12"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/></svg>',
    canDodge: true,
    skills: [
      {
        name: 'Bloodline Strike',
        cost: 24,
        power: 2.1,
        type: 'magic',
        target: 'single',
        desc: 'A focused Anima discharge — silver Ether compressed to a single point, reliable magic damage'
      },
      {
        name: 'Mend',
        cost: 28,
        power: 0,
        type: 'heal',
        target: 'all_party',
        healAmount: 120,
        desc: 'Iris reads the damage and threads healing through it — restores HP to all party members'
      },
      {
        name: 'Suppression Step',
        cost: 20,
        power: 0,
        type: 'debuff',
        target: 'all',
        effect: 'atb_slow',
        amount: 0.45,
        duration: 3,
        desc: 'Three months inside her own bloodline\'s suppression taught her how it works — all enemies\' AP slowed for 3 turns'
      },
      {
        name: 'Anima Barrier',
        cost: 22,
        power: 0,
        type: 'buff',
        target: 'all_party',
        effect: 'def_up',
        amount: 0.55,
        duration: 3,
        desc: 'Iris wraps the party in a structured Ether field — DEF +55% for 3 turns, the same architecture her bloodline uses to suppress others turned inward'
      },
      {
        name: 'Silver Surge',
        cost: 36,
        power: 1.15,
        type: 'magic',
        target: 'all',
        desc: 'Release a wide-field Anima discharge — silver light sweeps all enemies, trading raw power for coverage'
      },
      {
        name: 'Field Read',
        cost: 18,
        power: 0,
        type: 'buff',
        target: 'all_party',
        effect: 'atk_up',
        amount: 0.40,
        duration: 3,
        desc: 'Iris reads the enemy formation in the methodical sequence trained into the bloodline — the whole party\'s ATK rises by 40% for 3 turns'
      },
      {
        name: 'Ether Inversion',
        cost: 44,
        power: 2.6,
        type: 'magic',
        target: 'single',
        desc: 'Turn the target\'s own Ether field against them — concentrated reversal, her heaviest single-target hit'
      },
      {
        name: 'Ether Resonance',
        cost: 80,
        power: 0,
        type: 'heal',
        target: 'all_party',
        healAmount: 180,
        healFull: false,
        desc: 'Iris harmonises the party\'s Ether fields into a single resonant frequency — restoring a significant portion of each member\'s HP. Costly, but far more forgiving than pushing the bloodline to its limit'
      },
      {
        name: 'Anima Pulse',
        cost: 20,
        power: 1.4,
        type: 'magic',
        target: 'single',
        desc: 'A sharp discharge of silver Ether — not as refined as Bloodline Strike, but quicker to execute and cheaper on reserves'
      },
      {
        name: 'Trace Mend',
        cost: 22,
        power: 0,
        type: 'heal',
        target: 'all_party',
        healAmount: 70,
        desc: 'Iris runs a light pass of healing through the party — less thorough than Mend, but a useful top-up when MP is running low'
      },
      {
        name: 'Ether Scatter',
        cost: 28,
        power: 0.85,
        type: 'magic',
        target: 'all',
        desc: 'Iris releases a diffuse Anima discharge with little focus — the spread is wide but the individual hits are modest'
      },
      {
        name: 'Still Point',
        cost: 16,
        power: 0,
        type: 'debuff',
        target: 'all',
        effect: 'atb_slow',
        amount: 0.25,
        duration: 2,
        desc: 'A narrow suppression pattern from the bloodline — briefly slows all enemies without the full cost of Suppression Step'
      }
    ]
  }
], items: ITEMS_FULL }
};

// Solo loadouts — Kaden alone, same kit as stage4 with a bigger HP/MP pool (used by the Zenis duel)
PARTY_PRESETS.kaden_solo = {
  party: [{ ...PARTY_PRESETS.stage4.party[0], maxHp: 2200, maxMp: 260 }],
  items: ITEMS_FULL
};

const _preset = PARTY_PRESETS[BATTLE.party] || (console.warn('[encounter] unknown party preset "' + BATTLE.party + '", using stage3'), PARTY_PRESETS.stage3);
const PARTY_CONFIG = _preset.party;
const ITEMS_CONFIG = _preset.items;

const OVERDRIVE_CONFIG = {
  kaden: {
    name: 'REQUIEM',
    desc: 'A cascading sequence of strikes — each hit resonates deeper than the last, tearing open whatever stands in its way',
    skill: {
      name: 'Requiem',
      type: 'physical',
      target: 'single',
      cost: 0,
      isOverdrive: true,
      isRequiem: true,
      strikes: [200, 400, 800, 3200]
    }
  },
  iris: {
    name: 'PURIFICATION',
    desc: 'Iris turns her bloodline inward — silver Ether floods the party, purging wounds and restoring every member to full health',
    skill: {
      name: 'Purification',
      type: 'heal',
      target: 'all_party',
      cost: 0,
      isOverdrive: true,
      healFull: true,
      isPurification: true
    }
  },
  ava: {
    name: 'BLACK THREAD SEVERANCE',
    desc: 'Every gap Ava has mapped, every weakness she has read — executed simultaneously in a single precise strike',
    skill: {
      name: 'Black Thread Severance',
      type: 'physical',
      target: 'single',
      cost: 0,
      isOverdrive: true,
      flatDamage: 3500
    }
  },
  kurt: {
    name: 'BASTION GUARD',
    desc: 'Kurt locks the field. Every blow the party takes for the rest of the fight is reduced — permanent, unconditional',
    skill: {
      name: 'Bastion Guard',
      type: 'buff',
      target: 'all_party',
      power: 0,
      cost: 0,
      isOverdrive: true,
      isBastionGuard: true
    }
  }
};

/* ═════════════════════════════════════════════════════════════════════
   AUDIO
   ═════════════════════════════════════════════════════════════════════ */
const AUDIO = {
  bgm: null,
  muted: false,
  _sfx: {},
  _stopped: false,

  init() {
    this.bgm = new Audio(BATTLE.bgm);
    this.bgm.loop   = true;
    this.bgm.volume = fcLoadSettings().musicVol / 100;

    const sfxFiles = {
      hit:     'FC-MEDIA/hit.wav',
      crit:    'FC-MEDIA/crit.wav',
      magic:   'FC-MEDIA/magic.wav',
      buff:    'FC-MEDIA/buff.wav',
      defeat:  'FC-MEDIA/defeat.wav',
      victory: 'FC-MEDIA/win.wav',
      encount: 'FC-MEDIA/encount_start.wav'
    };
    for (const [key, path] of Object.entries(sfxFiles)) {
      const a = new Audio(path);
      a.preload = 'auto';
      this._sfx[key] = a;
    }
  },

  _playSfx(key) {
    if (this.muted) return;
    const src = this._sfx[key];
    if (!src) return;
    const clone = src.cloneNode();
    clone.volume = fcLoadSettings().sfxVol / 100;
    clone.play().catch(() => {});
  },

  startBGM() {
    this._stopped = false;
    if (!this.bgm || this.muted) return;
    this.bgm.loop = true;
    if (this.bgm.paused) {
      this.bgm.play().catch(() => {});
    }
  },

  stopBGM() {
    this._stopped = true;
    if (!this.bgm) return;
    this.bgm.loop = false;
    this.bgm.pause();
    this.bgm.currentTime = 0;
  },

  toggleMute() {
    this.muted = !this.muted;
    if (this.bgm) this.bgm.muted = this.muted;
    const btn = el('btn-mute');
    if (btn) btn.textContent = this.muted ? 'MUTED' : 'SOUND';
  },

  sfxHit()     { this._playSfx('hit'); },
  sfxCrit()    { this._playSfx('crit'); },
  sfxMagic()   { this._playSfx('magic'); },
  sfxBuff()    { this._playSfx('buff'); },
  sfxDefeat()  { this._playSfx('defeat'); },
  sfxVictory() { this._playSfx('victory'); },
  sfxEncount() { this._playSfx('encount'); }
};
/* ═════════════════════════════════════════════════════════════════════
   5. BATTLE LOGIC
   ═════════════════════════════════════════════════════════════════════ */

// ═══════════════════════════════════════════════════════════
//  FRACTURED CADENCE — ATB BATTLE SYSTEM
// ═══════════════════════════════════════════════════════════
const DODGE_CHANCE = 0.70;

const ENEMY_PARRY_CHANCE = 0.30;

// HP threshold below which OVERDRIVE becomes available (30%)
const OVERDRIVE_THRESHOLD = 0.30;

const ATB_RATE  = 0.00048;

const CRIT_MULT = 1.75;

let state = {
  phase: 'IDLE',
  party: [],
  enemies: [],
  activeChar: null,
  selectedAction: null,
  readyQueue: [],
  turn: 0,
  animating: false,
  loopHandle: null
};

let lastTime = 0;

function initParty() {
  return PARTY_CONFIG.map(cfg => ({
    ...cfg, hp: cfg.maxHp, mp: cfg.maxMp,
    atb: 0, buffs: [], dead: false, isParty: true,
    critNext: false, atbMult: 1.0, defMult: 1.0, atkMult: 1.0,
    dodging: false, overdriveUsed: false,
    items: ITEMS_CONFIG.map(it => ({ ...it }))
  }));
}

function initEnemies() {
  return BATTLE.enemies.map((key, i) => {
    const t = ENEMY_TEMPLATES[key];
    return {
      ...t, id: `e${i}`, hp: t.maxHp, _templateKey: key,
      atb: Math.random() * 25,
      buffs: [], dead: false, isParty: false,
      atbMult: 1.0, defMult: 1.0, atkMult: 1.0,
      dodging: false
    };
  });
}

function calcDamage(attacker, skill, defender) {
  const r = _orig_calcDamage(attacker, skill, defender);
  let dmg = r.dmg, crit = r.crit;

  // Natural crit chance on top of any forced crit (items/buffs already
  // handled by the original calc) — adds baseline damage variance.
  if (!crit && defender && Math.random() < (attacker.critChance ?? 0.10)) {
    dmg = Math.round(dmg * CRIT_MULT);
    crit = true;
  }

  // Escalating combo: consecutive player hits on the same enemy target
  // ramp up to +35% damage, resetting whenever the target changes.
  if (attacker.isParty && defender && !defender.isParty) {
    if (!state.combo) state.combo = { targetId: null, count: 0 }; // startBattle() rebuilds `state` fresh each run, so this can't be a one-time init
    if (state.combo.targetId === defender.id) state.combo.count++;
    else { state.combo.targetId = defender.id; state.combo.count = 1; }
    const bonus = Math.min(0.35, (state.combo.count - 1) * 0.06);
    if (bonus > 0) {
      dmg = Math.round(dmg * (1 + bonus));
      if (state.combo.count >= 3) {
        showFloat(defender, `${state.combo.count}x COMBO`, 'combo');
        VFX.burstComboSpark(defender, state.combo.count);
      }
    }
  }

  // Stagger/Break: enemies build a hidden meter from damage taken. Once it
  // fills they're marked staggered (bonus damage window) and lose their
  // next turn once it comes up (handled in processNext).
  if (defender && !defender.isParty && !defender.isTrainingDummy && !defender.isDummy && !defender.isChains) {
    if (defender.staggerMax === undefined) {
      defender.staggerMax = Math.max(60, Math.round(defender.maxHp * 0.42));
      defender.stagger = 0;
      defender.staggered = false;
    }
    if (defender.staggered) {
      dmg = Math.round(dmg * 1.4);
    } else {
      defender.stagger += crit ? dmg * 1.5 : dmg;
      if (defender.stagger >= defender.staggerMax) {
        defender.staggered = true;
        defender.staggerPending = true;
        VFX.burstStagger(defender);
        if (AUDIO.sfxCrit) AUDIO.sfxCrit();
        addLog(`${defender.name} is staggered — its footing breaks`, 'crit');
        showFloat(defender, 'BREAK', 'crit');
      }
    }
  }

  return { dmg: Math.max(1, dmg), crit };
}

function applyBuff(target, effect, amount, duration) {
  target.buffs = target.buffs.filter(b => b.effect !== effect);
  target.buffs.push({ effect, amount, duration });
  switch (effect) {
    // atk_up/atk_slow (and def_up/its future debuff counterpart) no longer
    // clobber a single shared field. Each writes its own component, and the
    // effective multiplier is the product of both, so a buff and a debuff
    // on the same stat can coexist instead of one erasing the other.
    case 'def_up':    target.defBuffMult    = 1 + amount; break;
    case 'atk_up':    target.atkBuffMult    = 1 + amount; break;
    case 'crit_next': target.critNext = true;        break;
    case 'atb_slow':  target.atbMult  = amount;      break;
    case 'atk_slow':  target.atkDebuffMult = amount; break;
    case 'spd_up':    target.spd = Math.round(target.spd * (1 + amount)); break;
  }
  target.atkMult = (target.atkBuffMult ?? 1) * (target.atkDebuffMult ?? 1);
  target.defMult = (target.defBuffMult ?? 1) * (target.defDebuffMult ?? 1);
}

function tickBuffs(char) {
  char.buffs = char.buffs.filter(b => {
    if (b.effect === 'spd_up') return true;
    if (--b.duration <= 0) {
      switch (b.effect) {
        case 'def_up':    char.defBuffMult    = 1.0; break;
        case 'atk_up':    char.atkBuffMult    = 1.0; break;
        case 'atb_slow':  char.atbMult        = 1.0; break;
        case 'atk_slow':  char.atkDebuffMult  = 1.0; break;
        // crit_next previously fell through with no case here: the buff
        // entry disappeared from the list on expiry but char.critNext
        // stayed true under the hood until the character's next hit,
        // letting a "next hit crits" buff outlive its displayed duration.
        case 'crit_next': char.critNext       = false; break;
      }
      char.atkMult = (char.atkBuffMult ?? 1) * (char.atkDebuffMult ?? 1);
      char.defMult = (char.defBuffMult ?? 1) * (char.defDebuffMult ?? 1);
      return false;
    }
    return true;
  });
}

function aiChooseSkill(enemy) {
  const base = _orig_aiChooseSkill(enemy);
  // One-time desperation phase for bosses once they drop to 30% HP —
  // keeps late fights from fizzling out at the same pace as they started.
  if (enemy.isBoss && !enemy._enraged) {
    const hpPct = enemy.hp / enemy.maxHp;
    if (hpPct <= 0.30) {
      enemy._enraged = true;
      enemy.atkMult = (enemy.atkMult || 1) * 1.25;
      enemy.spd = Math.round(enemy.spd * 1.15);
      addLog(`${enemy.name} grows desperate — its attacks intensify`, 'debuff');
      showFloat(enemy, 'ENRAGE', 'crit');
      VFX.burstEnrage(enemy);
    }
  }
  return base;
}

function aiChooseTargets(skill) {
  const base = _orig_aiChooseTargets(skill);
  // Leave AoE and any special-case targeting (chains, tension gating, etc.)
  // completely alone — only single-target rolls get the kill-priority pass.
  if (!base || base.length !== 1 || skill.target === 'all_party') return base;
  if (Math.random() < 0.45) {
    const pool = state.party.filter(p => !p.dead && !p.chained);
    if (pool.length) {
      let weakest = pool[0];
      for (const p of pool) if ((p.hp / p.maxHp) < (weakest.hp / weakest.maxHp)) weakest = p;
      return [weakest];
    }
  }
  return base;
}

function checkDodge(target) {
  // Player dodge action
  if (target.dodging) {
    target.dodging = false;
    return Math.random() < DODGE_CHANCE;
  }
  // AP-based enemy evasion — scales with AP, bigger jump in red zone
  if (!target.isParty) {
    const ap = target.atb;
    let chance;
    if (target.canDodge) {
      // Full dodgers: 0→20% normal zone, 20→55% red zone
      chance = ap >= 80
        ? 0.20 + ((ap - 80) / 20) * 0.35
        : (ap / 80) * 0.20;
    } else {
      // Non-dodgers: small residual evasion at high AP
      chance = ap >= 80
        ? 0.05 + ((ap - 80) / 20) * 0.10
        : (ap / 80) * 0.05;
    }
    return Math.random() < chance;
  }
  return false;
}

// Returns the display dodge % for an enemy at a given AP (mirrors checkDodge curve)
function enemyEvaPercent(enemy) {
  const ap = enemy.atb;
  if (enemy.canDodge) {
    if (ap >= 80) return Math.round((0.20 + ((ap - 80) / 20) * 0.35) * 100);
    return Math.round((ap / 80) * 0.20 * 100);
  } else {
    // Non-dodgers still have a small residual evasion at high AP
    if (ap >= 80) return Math.round((0.05 + ((ap - 80) / 20) * 0.10) * 100);
    return Math.round((ap / 80) * 0.05 * 100);
  }
}

function shouldEnemyParry(actor, skill, target) {
  if (!actor?.isParty || target?.isParty || target?.dead) return false;
  if (skill.type !== 'physical' && skill.type !== 'magic') return false;
  return Math.random() < ENEMY_PARRY_CHANCE;
}

async function resolveAction(actor, skill, targets) {
  state.animating = true;
  if (!Array.isArray(targets)) targets = targets ? [targets] : [];

  if (skill.isOverdrive && !skill.isBastionGuard) {
    VFX.screenFlash('rgba(255,80,40,0.12)', 350);
    VFX.shake(0.5);
  }
  addLog(`${actor.name} uses ${skill.name}`, skill.isOverdrive ? 'overdrive' : 'action');
  await wait(skill.isOverdrive ? 480 : 320);

  for (const target of targets) {
    if (!target || target.dead) continue;

    if (skill.type === 'buff') {
      const buffTargets = skill.target === 'all_party'
        ? state.party.filter(p => !p.dead)
        : [actor];
      for (const bt of buffTargets) {
        applyBuff(bt, skill.effect, skill.amount || 0, skill.duration || 2);
        const msg = {
          crit_next: `${bt.name} is marked — next hit is critical`,
          def_up:    `${bt.name}'s DEF increases`,
          atk_up:    `${bt.name}'s ATK increases`
        }[skill.effect] || `${bt.name} buffed`;
        addLog(msg, 'buff');
        showFloat(bt, skill.effect === 'crit_next' ? 'CRIT+' : 'BUFF', 'buff');
      }
      AUDIO.sfxBuff();
      await wait(380);
      break; // buff is applied once to all targets — do not loop again per target
    }

    if (skill.type === 'heal') {
      const healTargets = skill.target === 'all_party'
        ? state.party.filter(p => !p.dead)
        : [target];
      for (const ht of healTargets) {
        const amt = skill.healFull ? ht.maxHp - ht.hp : (skill.healAmount || 80);
        ht.hp = Math.min(ht.maxHp, ht.hp + amt);
        addLog(`${ht.name} recovers ${amt} HP`, 'buff');
        showFloat(ht, `+${amt}`, 'heal');
      }
      AUDIO.sfxBuff();
      render(); await wait(380);
      break;
    }

    if (skill.type === 'debuff') {
      const debuffTargets = skill.target === 'all_party'
        ? state.party.filter(p => !p.dead)
        : [target];
      for (const dt of debuffTargets) {
        applyBuff(dt, skill.effect, skill.amount || 0.5, skill.duration || 2);
        if (skill.effect === 'atb_slow') dt.atb *= 0.65;
        showFloat(dt, '◌ SLOW', 'debuff');
      }
      const debuffMsg = {
        'atb_slow': 'The field compresses — AP slowed',
        'atk_slow': 'Focus fractures — ATK reduced',
        'def_down': 'Defenses crumble'
      }[skill.effect] || 'A debuff settles over the field';
      addLog(debuffMsg, 'debuff');
      render(); await wait(380);
      continue;
    }

    if (target.pendingParry) {
      target.pendingParry = false;
      addLog(`${target.name} cancels ${skill.name}`, 'dodge');
      showFloat(target, 'CANCEL', 'dodge');
      await wait(300);
      continue;
    }

    // ── REQUIEM: multi-strike with fixed escalating damage ──
    if (skill.isRequiem && skill.strikes) {
      VFX.shake(0.6);
      for (let si = 0; si < skill.strikes.length; si++) {
        if (target.dead) break;
        const strikeDmg = skill.strikes[si];
        target.hp = Math.max(0, target.hp - strikeDmg);
        addLog(`${actor.name} — Strike ${si+1}${si===3?' ◈ FINAL':''}: ${strikeDmg}`, si===3?'crit':'overdrive');
        showFloat(target, strikeDmg, si===3?'crit':'enemy-dmg', actor);
        VFX.burstByActor(target, actor, si===3);
        if (target.hp <= 0) target.dead = true;
        if (si===3) AUDIO.sfxCrit(); else AUDIO.sfxHit();
        render();
        await wait(si===3?420:280);
      }
      if (target.dead) { target.atb = 0; state.readyQueue = state.readyQueue.filter(c => c.id !== target.id); addLog(`${target.name} is defeated`, 'defeat'); }
      continue;
    }

    // ── FLAT DAMAGE OVERDRIVE (Silver Dirge / Black Thread Severance) ──
    if (skill.flatDamage !== undefined) {
      const fdmg = skill.flatDamage;
      target.hp = Math.max(0, target.hp - fdmg);
      addLog(`${actor.name} — ${skill.name}: ${fdmg} ◈ Overdrive`, 'overdrive');
      showFloat(target, fdmg, 'crit', actor);
      VFX.burstByActor(target, actor, true);
      if (target.hp <= 0) target.dead = true;
      AUDIO.sfxCrit();
      VFX.shake(0.8);
      if (target.dead) { target.atb = 0; state.readyQueue = state.readyQueue.filter(c => c.id !== target.id); addLog(`${target.name} is defeated`, 'defeat'); }
      render();
      await wait(420);
      continue;
    }

    if (checkDodge(target)) {
      addLog(`${target.name} evades the attack`, 'dodge');
      showFloat(target, 'EVADE', 'dodge');
      await wait(300);
      continue;
    }

    const { dmg, crit } = calcDamage(actor, skill, target);
    target.hp = Math.max(0, target.hp - dmg);

    if (skill.effect === 'mp_drain' && target.mp !== undefined) {
      const d = Math.min(target.mp, Math.round(dmg * 0.3));
      target.mp -= d;
      if (actor.mp !== undefined) actor.mp = Math.min(actor.maxMp || 999, (actor.mp || 0) + d);
    }

    addLog(`${target.name} takes ${dmg} damage${crit ? ' ◈ Critical' : ''}`, crit ? 'crit' : 'damage');
    showFloat(target, dmg, crit ? 'crit' : (actor.isParty ? 'enemy-dmg' : 'player-dmg'), actor);
    if (skill.type === 'magic') { VFX.burstMagic(target, actor); AUDIO.sfxMagic(); }
    else if (crit) AUDIO.sfxCrit();
    else AUDIO.sfxHit();
    render(); await wait(220);

    if (target.hp <= 0 && !target.dead) {
      // Training dummy is unkillable — bounce back to 1 HP
      if (target.isTrainingDummy) {
        target.hp = 1;
        addLog(`The Training Dummy absorbs the blow and holds firm`, 'system');
        showFloat(target, 'IMMUNE', 'dodge');
        render();
        await wait(280);
      } else {
        target.dead = true; target.atb = 0;
        state.readyQueue = state.readyQueue.filter(c => c.id !== target.id);
        addLog(`${target.name} is defeated`, 'defeat');
        AUDIO.sfxDefeat();
        VFX.burstDefeat(target);
        const card = getCardEl(target);
        if (card) card.classList.add('dead');
        await wait(360);
      }
    }
  }

  tickBuffs(actor);
  if (actor.isParty && skill.cost) actor.mp = Math.max(0, actor.mp - skill.cost);
  render();

  const aliveEnemies = state.enemies.filter(e => !e.dead);
  const aliveParty   = state.party.filter(p => !p.dead);
  if (!aliveEnemies.length) { await wait(500); endBattle(true);  return; }
  if (!aliveParty.length)   { await wait(500); endBattle(false); return; }

  state.animating = false;
  state.phase = 'IDLE';
  scheduleLoop();
}

async function resolvePlayerDodge(actor) {
  state.animating = true;
  const alive = state.party.filter(p => !p.dead);
  alive.forEach(p => {
    p.dodging = true;
    showFloat(p, '◌ READY', 'dodge');
  });
  addLog('The party braces to evade', 'dodge');
  render();
  await wait(400);
  Gimmick.emit('actionPerformed', 'dodge');
  state.animating = false;
  state.phase = 'IDLE';
  scheduleLoop();
}

async function resolveEnemyDodge(enemy) {
  state.animating = true;
  enemy.dodging = true;
  // Clear any telegraphed move — the enemy spent this turn evading instead
  // of attacking, so the next cycle needs a fresh roll (and pattern-based
  // enemies should still advance their sequence on their next real turn).
  enemy.pendingSkill = null;
  enemy._aoeWarned = false;
  addLog(`${enemy.name} braces to evade`, 'dodge');
  showFloat(enemy, '◌ EVADE', 'dodge');
  render(); await wait(400);
  state.animating = false;
  state.phase = 'IDLE';
  scheduleLoop();
}

function scheduleLoop() {
  if (state.loopHandle) cancelAnimationFrame(state.loopHandle);
  lastTime = performance.now();
  state.loopHandle = requestAnimationFrame(gameLoop);
}

function gameLoop(ts) {
  if (['WIN','LOSE','RESOLVING'].includes(state.phase) || state.animating) return;
  const delta = Math.min(ts - lastTime, 50);
  lastTime = ts;

  if (state.phase === 'IDLE') {
    const all = [...state.party, ...state.enemies].filter(c => !c.dead);
    for (const c of all) {
      if (c.atb >= 100) continue;
      c.atb = Math.min(100, c.atb + c.spd * delta * ATB_RATE * (c.atbMult || 1));
      // Telegraph: roll the enemy's next move as soon as it enters the
      // "striking" window (80% AP) rather than waiting until it's fully
      // ready. This gives the intent label time to show the real move
      // name before the hit actually lands.
      if (!c.isParty && !c.dead && c.atb >= 80 && !c.pendingSkill) {
        c.pendingSkill = aiChooseSkill(c);
      }
      if (c.atb >= 100 && !state.readyQueue.find(q => q.id === c.id)) {
        state.readyQueue.push(c);
      }
    }
    renderATBOnly();
    if (state.readyQueue.length) processNext();
  }
  state.loopHandle = requestAnimationFrame(gameLoop);
}

function processNext() {
  if (state.animating || state.phase === 'RESOLVING') return;
  while (state.readyQueue.length && state.readyQueue[0].dead) state.readyQueue.shift();
  if (!state.readyQueue.length) return;

  const next = state.readyQueue[0];

  if (next.isParty) {
    state.phase = 'PLAYER_ACTION';
    state.activeChar = next;
    openActionPanel(next);
    render();
  } else {
    state.readyQueue.shift();
    state.phase = 'RESOLVING';
    state.animating = true;
    next.atb = 0;
    state.turn++;
    updateTurnNum();

    // Staggered enemies lose the turn their break window catches up to them —
    // this is the payoff for building the stagger meter with calcDamage hits.
    if (!next.isParty && next.staggered && next.staggerPending) {
      next.staggerPending = false;
      next.staggered = false;
      next.stagger = 0;
      addLog(`${next.name} is reeling and can't act this turn`, 'system');
      showFloat(next, 'STUNNED', 'debuff');
      render();
      setTimeout(() => { state.animating = false; state.phase = 'IDLE'; scheduleLoop(); }, 550);
      return;
    }

    // Dodge chance scales with AP: higher AP = more reactive = better dodge
    // Range: 0% at 0 AP → up to 50% at 100 AP, only if canDodge
    const apDodgeChance = next.canDodge && !next.dodging
      ? (next.atb / 100) * 0.50
      : 0;
    if (next.canDodge && !next.dodging && Math.random() < apDodgeChance) {
      setTimeout(() => resolveEnemyDodge(next), 300);
    } else {
      // Use pre-rolled skill if available, otherwise pick now
      const skill   = next.pendingSkill || aiChooseSkill(next);
      next.pendingSkill = null;
      const targets = aiChooseTargets(skill);
      setTimeout(() => resolveAction(next, skill, targets), 460);
    }
  }
}

function openActionPanel(char) {
  const panel  = el('action-panel');
  const header = el('action-header');
  const main   = el('main-actions');
  const skillLi = el('skill-list');
  const prompt = el('target-prompt');

  panel.classList.remove('hidden');
  skillLi.classList.add('hidden');
  el('item-list').classList.add('hidden');
  prompt.classList.add('hidden');
  main.classList.remove('hidden');
  header.textContent = `${char.name}'s Turn`;
  header.style.color = char.color;
  header.style.setProperty('--who', char.color);

  // ── OVERDRIVE button swap ──
  const btnAttack = el('btn-attack');
  const btnSkills = el('btn-skills');
  const btnDodge  = el('btn-dodge');
  const btnItems  = el('btn-items');
  const od = OVERDRIVE_CONFIG[char.id];
  const hpPct = char.hp / char.maxHp;
  const overdriveAvailable = od && !char.overdriveUsed && hpPct <= OVERDRIVE_THRESHOLD;

  if (overdriveAvailable) {
    btnAttack.classList.add('overdrive-mode');
    btnAttack.innerHTML = `<span class="overdrive-label">OVERDRIVE</span><span>${od.name}</span>`;
    btnSkills.classList.add('hidden');
    btnDodge.classList.add('hidden');
    btnItems.classList.add('hidden');
  } else {
    btnAttack.classList.remove('overdrive-mode');
    btnAttack.innerHTML = `<span class="btn-icon">▲</span> Attack`;
    btnSkills.classList.remove('hidden');
    btnDodge.classList.remove('hidden');
    btnItems.classList.remove('hidden');
    btnDodge.style.opacity = '1';
    btnDodge.style.pointerEvents = 'auto';
  }

  Gimmick.emit('actionPanelOpened');
}

function closeActionPanel() {
  el('action-panel').classList.add('hidden');
  el('skill-list').classList.add('hidden');
  el('item-list').classList.add('hidden');
  el('target-prompt').classList.add('hidden');
  el('main-actions').classList.remove('hidden');
  clearTargetMode();
  clearItemTargetMode();
}

function enterTargetMode() {
  state.phase = 'PLAYER_TARGET';
  el('main-actions').classList.add('hidden');
  el('skill-list').classList.add('hidden');
  const prompt = el('target-prompt');
  prompt.classList.remove('hidden');
  prompt.innerHTML = `Select a target above &nbsp;↑<br><button class="back-btn" id="btn-cancel-target" style="margin-top:6px">← Back</button>`;
  document.getElementById('btn-cancel-target').onclick = cancelTargetMode;
  state.enemies.filter(e => !e.dead).forEach(e => {
    const card = el(`enemy-card-${e.id}`);
    if (card) { card.classList.add('targetable'); card.onclick = () => playerTargetEnemy(e.id); }
  });
}

function cancelTargetMode() {
  clearTargetMode();
  state.phase = 'PLAYER_ACTION';
  el('main-actions').classList.remove('hidden');
  el('target-prompt').classList.add('hidden');
  el('target-prompt').innerHTML = '';
}

function clearTargetMode() {
  state.enemies.forEach(e => {
    const card = el(`enemy-card-${e.id}`);
    if (card) { card.classList.remove('targetable', 'targeted'); card.onclick = null; }
  });
}

function playerTargetEnemy(enemyId) {
  if (state.phase !== 'PLAYER_TARGET') return;
  const target = state.enemies.find(e => e.id === enemyId && !e.dead);
  if (!target) return;
  clearTargetMode();
  commitPlayerAction([target]);
}

function commitPlayerAction(targets) {
  const actor = state.activeChar;
  const skill = state.selectedAction.skill;
  state.readyQueue.shift();
  actor.atb = 0;
  state.phase = 'RESOLVING';
  state.turn++;
  updateTurnNum();
  closeActionPanel();

  resolveAction(actor, skill, targets);
}

function onAttack() {
  if (state.phase !== 'PLAYER_ACTION') return;
  const actor = state.activeChar;
  const od = OVERDRIVE_CONFIG[actor.id];
  const hpPct = actor.hp / actor.maxHp;
  const overdriveAvailable = od && !actor.overdriveUsed && hpPct <= OVERDRIVE_THRESHOLD;

  if (overdriveAvailable) {
    actor.overdriveUsed = true;
    const skill = od.skill;

    // PURIFICATION: full heal on every party member — resolve immediately, no targeting
    if (skill.isPurification) {
      state.readyQueue.shift();
      actor.atb = 0;
      state.phase = 'RESOLVING';
      state.turn++;
      updateTurnNum();
      closeActionPanel();
      addLog(`${actor.name} — OVERDRIVE — PURIFICATION`, 'overdrive');
      addLog(`Silver Ether washes over the party — all wounds erased.`, 'buff');
      state.party.filter(p => !p.dead).forEach(p => {
        const restored = p.maxHp - p.hp;
        p.hp = p.maxHp;
        showFloat(p, `+${restored}`, 'heal');
      });
      AUDIO.sfxBuff();
      VFX.screenFlash('rgba(180,220,255,0.13)', 500);
      render();
      state.animating = false;
      state.phase = 'IDLE';
      scheduleLoop();
      return;
    }

    if (skill.isBastionGuard) {
      state.readyQueue.shift();
      actor.atb = 0;
      state.phase = 'RESOLVING';
      state.turn++;
      updateTurnNum();
      closeActionPanel();
      state.party.filter(p => !p.dead).forEach(p => {
        applyBuff(p, 'def_up', 0.60, Infinity);
      });
      addLog(`${actor.name} — OVERDRIVE — BASTION GUARD`, 'overdrive');
      addLog(`The field locks. All incoming damage reduced permanently.`, 'buff');
      state.party.filter(p => !p.dead).forEach(p => showFloat(p, 'BASTION', 'buff'));
      AUDIO.sfxBuff();
      VFX.screenFlash('rgba(255,140,0,0.08)', 400);
      render();
      state.animating = false;
      state.phase = 'IDLE';
      scheduleLoop();
      return;
    }

    addLog(`${actor.name} — OVERDRIVE — ${od.name}`, 'overdrive');
    state.selectedAction = { skill };
    if (skill.target === 'all') {
      commitPlayerAction(state.enemies.filter(e => !e.dead));
    } else {
      enterTargetMode();
    }
    return;
  }

  state.selectedAction = { skill: { name: 'Attack', type: 'physical', power: 1.0, target: 'single', cost: 0 } };
  enterTargetMode();
  Gimmick.emit('actionPerformed', 'attack');
}

// ── Skill / item menus ───────────────────────────────────────────
// The two lists used to live inside the narrow sidebar action panel, which
// clips them into a tiny scrolling box. They are lifted to <body> the first
// time a menu opens so css/battle-menus.css can show them as a large overlay.
function mountBattleMenus() {
  ['skill-list', 'item-list'].forEach(id => {
    const node = el(id);
    if (node && node.parentElement !== document.body) document.body.appendChild(node);
  });
  if (mountBattleMenus._wired) return;
  mountBattleMenus._wired = true;
  const closeMenus = () => { el('skill-list').classList.add('hidden'); el('item-list').classList.add('hidden'); };
  // Esc closes the menu
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenus(); });
  // clicking the dimmed area outside the menu closes it too
  document.addEventListener('mousedown', e => {
    const open = ['skill-list', 'item-list'].map(el).find(n => n && !n.classList.contains('hidden'));
    if (!open || open.contains(e.target)) return;
    if (e.target.closest && e.target.closest('#btn-skills, #btn-items')) return; // those buttons toggle themselves
    closeMenus();
  });
}

function menuHead(title, actor, extraHtml) {
  const head = document.createElement('div');
  head.className = 'menu-head';
  head.innerHTML = `<span class="menu-title">${title}</span><span class="menu-who" style="color:${actor.color || 'inherit'}">${actor.name}</span>${extraHtml || ''}`;
  return head;
}

// MP readout for the header: number plus a thin bar
function menuMpHtml(actor) {
  const mp = actor.mp || 0, max = actor.maxMp || mp || 1;
  return `<span class="menu-mp"><span class="menu-mp-text">MP <b>${mp}</b>${actor.maxMp ? ' / ' + actor.maxMp : ''}</span>` +
         `<span class="mp-track"><span class="mp-have" style="width:${Math.min(100, mp / max * 100)}%"></span><span class="mp-spend head-spend" style="left:0;width:0"></span></span></span>`;
}

// What this skill costs, drawn against the actor's MP bar
function mpPreviewHtml(actor, cost) {
  const mp = actor.mp || 0, max = actor.maxMp || mp || 1;
  const short = mp < cost;
  const left = Math.max(0, mp - cost);
  const haveW  = short ? Math.min(100, mp / max * 100) : Math.min(100, left / max * 100);
  const spendW = short ? 0 : Math.min(100 - haveW, cost / max * 100);
  const after = short
    ? `<b class="short">${cost - mp} short</b>`
    : `<b>${left}</b>`;
  return `<div class="md-mp">
    <div class="md-mp-line"><span>MP after use</span><span><b>${mp}</b> → ${after}</span></div>
    <span class="mp-track big"><span class="mp-have" style="width:${haveW}%"></span><span class="mp-spend" style="left:${haveW}%;width:${spendW}%"></span></span>
  </div>`;
}

const SKILL_KIND = {
  physical: 'Physical', magic: 'Magic', heal: 'Healing', buff: 'Buff', debuff: 'Debuff',
  chain_snare: 'Special', tension_raise: 'Special'
};

// Master / detail menu shared by Skills and Items.
// entries: [{ name, icon?, chip, kind, kindLabel, desc, stats:[[label,value]], extraHtml?, locked?, lockedReason?, useLabel, onUse }]
function openBattleMenu(li, cfg) {
  const touch = window.matchMedia && window.matchMedia('(hover: none)').matches;
  li.innerHTML = '';
  li.dataset.menu = cfg.id;
  li.appendChild(menuHead(cfg.title, cfg.actor, cfg.headExtra));

  const body   = document.createElement('div'); body.className = 'menu-body';
  const list   = document.createElement('div'); list.className = 'menu-list'; list.setAttribute('role', 'listbox');
  const detail = document.createElement('div'); detail.className = 'menu-detail';
  body.append(list, detail);
  li.appendChild(body);

  const foot = document.createElement('div'); foot.className = 'menu-foot';
  const back = document.createElement('button'); back.className = 'back-btn'; back.textContent = '← Back';
  back.onclick = () => li.classList.add('hidden');
  const hint = document.createElement('span'); hint.className = 'menu-hint';
  hint.innerHTML = touch ? '' : '<kbd>↑</kbd><kbd>↓</kbd> choose <kbd>Enter</kbd> use <kbd>Esc</kbd> close';
  const useBtn = document.createElement('button'); useBtn.className = 'menu-use';
  foot.append(back, hint, useBtn);
  li.appendChild(foot);

  let sel = -1;
  const rows = [];

  function select(i, focus) {
    if (i < 0 || i >= cfg.entries.length) return;
    sel = i;
    const e = cfg.entries[i];
    rows.forEach((r, n) => { r.classList.toggle('selected', n === i); r.setAttribute('aria-selected', n === i); });
    if (focus) rows[i].focus({ preventScroll: false });
    rows[i].scrollIntoView({ block: 'nearest' });
    detail.dataset.kind = e.kind || '';
    detail.innerHTML =
      `<div class="md-top">${e.icon ? `<span class="md-icon">${e.icon}</span>` : ''}
         <div><div class="md-name">${e.name}</div>
         <div class="md-kind" data-kind="${e.kind || ''}">${e.kindLabel || ''}</div></div></div>
       <p class="md-desc">${e.desc || ''}</p>
       <dl class="md-stats">${(e.stats || []).map(s => `<div><dt>${s[0]}</dt><dd>${s[1]}</dd></div>`).join('')}</dl>
       ${e.extraHtml || ''}
       ${e.locked ? `<div class="md-warn">${e.lockedReason}</div>` : ''}`;
    useBtn.disabled = !!e.locked;
    useBtn.textContent = e.useLabel;
    const hs = li.querySelector('.head-spend');
    if (hs) {
      const mp = cfg.actor.mp || 0, max = cfg.actor.maxMp || mp || 1, c = e.cost || 0;
      const haveW = Math.min(100, Math.max(0, mp - c) / max * 100);
      hs.style.left = haveW + '%';
      hs.style.width = (e.locked ? 0 : Math.min(100 - haveW, c / max * 100)) + '%';
    }
    detail.classList.remove('swap'); void detail.offsetWidth; detail.classList.add('swap');
  }

  function use(i) {
    const e = cfg.entries[i];
    if (!e || e.locked) return;
    e.onUse();
  }

  cfg.entries.forEach((e, i) => {
    const row = document.createElement('button');
    row.className = cfg.rowClass + (e.locked ? ' ' + cfg.lockedClass + ' is-locked' : '');
    row.setAttribute('role', 'option');
    if (e.locked) row.setAttribute('aria-disabled', 'true');
    row.dataset.kind = e.kind || '';
    row.setAttribute('aria-label', `${e.name}${e.kindLabel ? ', ' + e.kindLabel : ''}, ${String(e.chip).replace(/<[^>]+>/g, ' ')}${e.locked ? ', unavailable' : ''}`);
    row.innerHTML = `${e.icon ? `<span class="row-icon">${e.icon}</span>` : '<span class="row-mark"></span>'}` +
                    `<span class="${cfg.nameClass}">${e.name}</span><span class="${cfg.chipClass}">${e.chip}</span>`;
    row.addEventListener('pointerenter', ev => { if (ev.pointerType === 'mouse') select(i); });
    row.addEventListener('focus', () => select(i));
    row.addEventListener('click', () => {
      if (touch && sel !== i) { select(i); return; }   // touch: first tap previews, Use confirms
      select(i);
      use(i);
    });
    rows.push(row);
    list.appendChild(row);
  });

  useBtn.onclick = () => use(sel);

  // Arrow keys move through the list, Enter/Space use via the focused row
  li.onkeydown = ev => {
    const n = cfg.entries.length;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowRight') { ev.preventDefault(); select((sel + 1) % n, true); }
    else if (ev.key === 'ArrowUp' || ev.key === 'ArrowLeft') { ev.preventDefault(); select((sel - 1 + n) % n, true); }
    else if (/^[1-9]$/.test(ev.key) && +ev.key <= n) { ev.preventDefault(); select(+ev.key - 1, true); }
  };

  if (!cfg.entries.length) {
    detail.innerHTML = `<p class="md-desc">${cfg.emptyText || 'Nothing here.'}</p>`;
    useBtn.disabled = true; useBtn.textContent = 'Use';
    li.classList.remove('hidden');
    return;
  }
  li.classList.remove('hidden');
  const first = Math.max(0, cfg.entries.findIndex(e => !e.locked));
  select(first, !touch);
}

// What picking this skill will actually do (mirrors onSkillSelect)
function skillTargetLabel(sk) {
  if (sk.type === 'buff' || sk.type === 'heal' || sk.target === 'all_party') return 'Whole party';
  if (sk.target === 'self') return 'Self';
  if (sk.target === 'all') return 'All enemies';
  return 'One enemy';
}

function onSkills() {
  if (state.phase !== 'PLAYER_ACTION') return;
  mountBattleMenus();
  const li = el('skill-list');
  if (!li.classList.contains('hidden')) { li.classList.add('hidden'); return; }
  el('item-list').classList.add('hidden');
  const actor = state.activeChar;
  openBattleMenu(li, {
    id: 'skills', title: 'Skills', actor, headExtra: menuMpHtml(actor),
    rowClass: 'skill-btn', lockedClass: 'cant-afford',
    nameClass: 'skill-name', chipClass: 'skill-mp',
    emptyText: 'No skills learned yet.',
    entries: actor.skills.map((sk, i) => {
      const cost = sk.cost || 0;
      const stats = [['Target', skillTargetLabel(sk)]];
      if (sk.power > 0) stats.push(['Power', `×${sk.power}`]);
      if (sk.piercing) stats.push(['Ignores DEF', `${Math.round(sk.piercing * 100)}%`]);
      if (sk.duration) stats.push(['Lasts', `${sk.duration} turn${sk.duration > 1 ? 's' : ''}`]);
      return {
        name: sk.name,
        chip: cost ? `${cost}<small>MP</small>` : 'Free',
        kind: sk.type, kindLabel: SKILL_KIND[sk.type] || 'Special', cost,
        desc: sk.desc || '', stats,
        extraHtml: cost ? mpPreviewHtml(actor, cost) : '',
        locked: (actor.mp || 0) < cost,
        lockedReason: `Needs ${cost} MP, ${actor.name} has ${actor.mp || 0}.`,
        useLabel: `Use ${sk.name}`,
        onUse: () => onSkillSelect(i)
      };
    })
  });
}

function onSkillSelect(idx) {
  const skill = state.activeChar.skills[idx];
  if ((state.activeChar.mp || 0) < (skill.cost || 0)) return;
  state.selectedAction = { skill };
  el('skill-list').classList.add('hidden');
  Gimmick.emit('actionPerformed', 'skill');
  if (skill.type === 'buff' || skill.type === 'heal' || skill.target === 'all_party') {
    commitPlayerAction(state.party.filter(p => !p.dead));
  } else if (skill.target === 'self') {
    commitPlayerAction([state.activeChar]);
  } else if (skill.target === 'all') {
    commitPlayerAction(state.enemies.filter(e => !e.dead));
  } else {
    enterTargetMode();
  }
}

function onDodge() {
  if (state.phase !== 'PLAYER_ACTION') return;
  const actor = state.activeChar;
  state.readyQueue.shift();
  actor.atb = 0;
  state.phase = 'RESOLVING';
  state.turn++;
  updateTurnNum();
  closeActionPanel();
  resolvePlayerDodge(actor);
}

function itemTargetLabel(item) {
  if (item.target === 'all_enemies') return 'All enemies';
  if (item.target === 'single_enemy') return 'One enemy';
  return 'One ally';
}

function onItems() {
  if (state.phase !== 'PLAYER_ACTION') return;
  mountBattleMenus();
  const li = el('item-list');
  el('skill-list').classList.add('hidden');
  if (!li.classList.contains('hidden')) { li.classList.add('hidden'); return; }
  const actor = state.activeChar;
  openBattleMenu(li, {
    id: 'items', title: 'Items', actor, headExtra: '',
    rowClass: 'item-btn', lockedClass: 'depleted',
    nameClass: 'item-name', chipClass: 'item-count',
    emptyText: 'No items in the pack.',
    entries: actor.items.map((item, i) => {
      const depleted = item.count <= 0;
      const stats = [['Target', itemTargetLabel(item)]];
      if (item.effect === 'heal_hp' && item.amount) stats.push(['Restores', `${item.amount} HP`]);
      else if (item.effect === 'heal_mp' && item.amount) stats.push(['Restores', `${item.amount} MP`]);
      else if (item.effect === 'heal_hp_full') stats.push(['Restores', 'Full HP']);
      if (item.duration) stats.push(['Lasts', `${item.duration} turn${item.duration > 1 ? 's' : ''}`]);
      stats.push(['In stock', item.count]);
      return {
        name: item.name, icon: item.icon,
        chip: `×${item.count}`,
        kind: 'item', kindLabel: '',
        desc: item.desc || '',
        stats,
        locked: depleted, lockedReason: 'None left.',
        useLabel: `Use ${item.name}`,
        onUse: () => onItemSelect(i)
      };
    })
  });
}

function onItemSelect(idx) {
  if (state.phase !== 'PLAYER_ACTION') return;
  const item = state.activeChar.items[idx];
  if (!item || item.count <= 0) return;
  state.selectedAction = { item, itemIdx: idx };
  el('item-list').classList.add('hidden');
  enterItemTargetMode();
}

function enterItemTargetMode() {
  state.phase = 'PLAYER_ITEM_TARGET';
  el('main-actions').classList.add('hidden');
  el('skill-list').classList.add('hidden');
  el('item-list').classList.add('hidden');
  const prompt = el('target-prompt');
  prompt.classList.remove('hidden');
  const item = state.selectedAction.item;

  // all_enemies: no targeting needed, fire immediately
  if (item.target === 'all_enemies') {
    prompt.classList.add('hidden');
    el('main-actions').classList.remove('hidden');
    state.phase = 'PLAYER_ACTION';
    const actor = state.activeChar;
    item.count--;
    const allEnemies = state.enemies.filter(e => !e.dead);
    allEnemies.forEach(e => {
      applyBuff(e, 'atb_slow', item.amount_atb, item.duration);
      applyBuff(e, 'atk_slow', item.amount_atk, item.duration);
      showFloat(e, 'SUPPRESSED', 'debuff');
    });
    addLog(`${actor.name} uses ${item.name} — all enemies suppressed for ${item.duration} turns`, 'debuff');
    AUDIO.sfxMagic();
    render();
    openActionPanel(actor);
    return;
  }

  // single_enemy: highlight enemy cards as targets
  if (item.target === 'single_enemy') {
    prompt.innerHTML = `Use on which enemy?<br><button class="back-btn" id="btn-cancel-item-target" style="margin-top:6px">← Back</button>`;
    document.getElementById('btn-cancel-item-target').onclick = cancelItemTargetMode;
    state.enemies.filter(e => !e.dead).forEach(e => {
      const card = el(`enemy-card-${e.id}`);
      if (card) {
        card.classList.add('targetable');
        card.onclick = () => playerUseItemOnEnemy(e.id);
      }
    });
    return;
  }

  // single_ally: default
  prompt.innerHTML = `Use on which ally?<br><button class="back-btn" id="btn-cancel-item-target" style="margin-top:6px">← Back</button>`;
  document.getElementById('btn-cancel-item-target').onclick = cancelItemTargetMode;
  state.party.filter(p => !p.dead).forEach(p => {
    const panel = el(`panel-${p.id}`);
    if (panel) {
      panel.classList.add('item-targetable');
      panel.onclick = () => playerUseItem(p.id);
    }
  });
}

function playerUseItemOnEnemy(enemyId) {
  if (state.phase !== 'PLAYER_ITEM_TARGET') return;
  const target = state.enemies.find(e => e.id === enemyId && !e.dead);
  if (!target) return;
  // clear enemy targetable state
  state.enemies.forEach(e => {
    const card = el(`enemy-card-${e.id}`);
    if (card) { card.classList.remove('targetable'); card.onclick = null; }
  });
  el('target-prompt').classList.add('hidden');
  el('main-actions').classList.remove('hidden');

  const actor = state.activeChar;
  const { item } = state.selectedAction;
  item.count--;

  switch (item.effect) {
    case 'item_atb_slow':
      applyBuff(target, 'atb_slow', item.amount, item.duration);
      addLog(`${actor.name} uses ${item.name} on ${target.name} — AP slowed for ${item.duration} turns`, 'debuff');
      showFloat(target, 'AP↓', 'debuff');
      AUDIO.sfxMagic();
      break;
    case 'item_atk_slow':
      applyBuff(target, 'atk_slow', item.amount, item.duration);
      addLog(`${actor.name} uses ${item.name} on ${target.name} — ATK reduced for ${item.duration} turns`, 'debuff');
      showFloat(target, 'ATK↓↓', 'debuff');
      AUDIO.sfxMagic();
      break;
  }

  render();
  state.phase = 'PLAYER_ACTION';
  openActionPanel(actor);
}

function cancelItemTargetMode() {
  clearItemTargetMode();
  state.phase = 'PLAYER_ACTION';
  el('main-actions').classList.remove('hidden');
  el('target-prompt').classList.add('hidden');
  el('target-prompt').innerHTML = '';
}

function clearItemTargetMode() {
  state.party.forEach(p => {
    const panel = el(`panel-${p.id}`);
    if (panel) { panel.classList.remove('item-targetable'); panel.onclick = null; }
  });
  state.enemies.forEach(e => {
    const card = el(`enemy-card-${e.id}`);
    if (card) { card.classList.remove('targetable'); card.onclick = null; }
  });
}

async function playerUseItem(memberId) {
  if (state.phase !== 'PLAYER_ITEM_TARGET') return;
  const target = state.party.find(p => p.id === memberId && !p.dead);
  if (!target) return;
  clearItemTargetMode();
  el('target-prompt').classList.add('hidden');
  el('main-actions').classList.remove('hidden');

  const actor = state.activeChar;
  const { item, itemIdx } = state.selectedAction;
  item.count--;

  switch (item.effect) {
    case 'heal_hp':
      target.hp = Math.min(target.maxHp, target.hp + item.amount);
      addLog(`${actor.name} uses ${item.name} on ${target.name} — restored ${item.amount} HP`, 'buff');
      showFloat(target, `+${item.amount} HP`, 'heal');
      AUDIO.sfxBuff();
      break;
    case 'heal_hp_full':
      target.hp = target.maxHp;
      addLog(`${actor.name} uses ${item.name} on ${target.name} — HP fully restored`, 'buff');
      showFloat(target, 'FULL HP', 'heal');
      AUDIO.sfxBuff();
      break;
    case 'heal_mp':
      target.mp = Math.min(target.maxMp, target.mp + item.amount);
      addLog(`${actor.name} uses ${item.name} on ${target.name} — restored ${item.amount} MP`, 'buff');
      showFloat(target, `+${item.amount} MP`, 'buff');
      AUDIO.sfxBuff();
      break;
    case 'spd_up':
      if (!target.buffs.find(b => b.effect === 'spd_up')) {
        applyBuff(target, 'spd_up', item.amount, Infinity);
        addLog(`${actor.name} uses ${item.name} on ${target.name} — SPD increased`, 'buff');
        showFloat(target, 'SPD↑', 'buff');
        AUDIO.sfxBuff();
      } else {
        addLog(`${target.name}'s SPD is already boosted`, 'system');
        item.count++;
      }
      break;
    case 'heal_dual':
      target.hp = Math.min(target.maxHp, target.hp + item.amount);
      target.mp = Math.min(target.maxMp, target.mp + (item.amount_mp || 0));
      addLog(`${actor.name} uses ${item.name} on ${target.name} — restored ${item.amount} HP and ${item.amount_mp} MP`, 'buff');
      showFloat(target, `+${item.amount} HP`, 'heal');
      AUDIO.sfxBuff();
      break;
    case 'atb_fill':
      // Fill target's ATB and put them at the front of the queue (after the actor finishes)
      target.atb = 100;
      // Remove target from queue if already in it, then re-insert at front after actor
      state.readyQueue = state.readyQueue.filter(q => q.id !== target.id);
      // Actor ends their turn: reset ATB, remove from queue
      state.readyQueue.shift();
      actor.atb = 0;
      // Now put the target at the front so they act next
      state.readyQueue.unshift(target);
      addLog(`${actor.name} uses ${item.name} on ${target.name} — AP filled, acting next`, 'buff');
      showFloat(target, 'AP FULL', 'buff');
      AUDIO.sfxBuff();
      render();
      state.phase = 'IDLE';
      closeActionPanel();
      return;
    case 'item_def_up':
      applyBuff(target, 'def_up', item.amount, item.duration);
      addLog(`${actor.name} uses ${item.name} on ${target.name} — DEF +${Math.round(item.amount*100)}% for ${item.duration} turns`, 'buff');
      showFloat(target, 'DEF↑↑', 'buff');
      AUDIO.sfxBuff();
      break;
    case 'item_atk_up':
      applyBuff(target, 'atk_up', item.amount, item.duration);
      addLog(`${actor.name} uses ${item.name} on ${target.name} — ATK +${Math.round(item.amount*100)}% for ${item.duration} turns`, 'buff');
      showFloat(target, 'ATK↑↑', 'buff');
      AUDIO.sfxBuff();
      break;
    case 'item_crit_next':
      applyBuff(target, 'crit_next', 1, 1);
      addLog(`${actor.name} uses ${item.name} on ${target.name} — next attack is a guaranteed critical`, 'buff');
      showFloat(target, 'CRIT↑', 'buff');
      AUDIO.sfxBuff();
      break;
    case 'item_surge':
      applyBuff(target, 'atk_up', item.amount_atk, item.duration);
      applyBuff(target, 'spd_up', item.amount_spd, item.duration);
      addLog(`${actor.name} uses ${item.name} on ${target.name} — ATK +${Math.round(item.amount_atk*100)}% and SPD +${Math.round(item.amount_spd*100)}% for ${item.duration} turns`, 'buff');
      showFloat(target, 'SURGE', 'buff');
      AUDIO.sfxBuff();
      break;
    case 'item_atb_slow':
      applyBuff(target, 'atb_slow', item.amount, item.duration);
      addLog(`${actor.name} uses ${item.name} on ${target.name} — AP slowed for ${item.duration} turns`, 'debuff');
      showFloat(target, 'AP↓', 'debuff');
      AUDIO.sfxMagic();
      break;
    case 'item_atk_slow':
      applyBuff(target, 'atk_slow', item.amount, item.duration);
      addLog(`${actor.name} uses ${item.name} on ${target.name} — ATK reduced for ${item.duration} turns`, 'debuff');
      showFloat(target, 'ATK↓↓', 'debuff');
      AUDIO.sfxMagic();
      break;
    case 'item_suppress_all': {
      const allEnemies = state.enemies.filter(e => !e.dead);
      allEnemies.forEach(e => {
        applyBuff(e, 'atb_slow', item.amount_atb, item.duration);
        applyBuff(e, 'atk_slow', item.amount_atk, item.duration);
        showFloat(e, 'SUPPRESSED', 'debuff');
      });
      addLog(`${actor.name} uses ${item.name} — all enemies suppressed for ${item.duration} turns`, 'debuff');
      AUDIO.sfxMagic();
      break;
    }
  }

  render();
  Gimmick.emit('actionPerformed', 'item');
  state.phase = 'PLAYER_ACTION';
  openActionPanel(actor);
}

function buildPartyPanels() {
  const cont = el('party-panels');
  cont.innerHTML = `<div id="party-diamond-formation"></div><div id="party-stat-strip"></div>`;
  const formation = el('party-diamond-formation');
  const strip = el('party-stat-strip');

  state.party.forEach(m => {
    // Diamond slot keeps the historical id/class so every existing lookup
    // (render, VFX targeting, item/skill targeting, DEV menu) still works
    // untouched. Its own stat sub-block is kept for compatibility but is
    // visually hidden (see .legacy-stats) — the visible readout is mirrored
    // into a separate stat-chip below by the render()/renderATBOnly() wraps.
    const div = document.createElement('div');
    div.className = 'party-panel diamond-slot';
    div.id = `panel-${m.id}`;
    div.style.setProperty('--member-color', m.color);

    div.innerHTML = `
      <div class="diamond-shape">
        <div class="diamond-fallback-symbol">${m.symbol}</div>
      </div>
      <div class="panel-bottom legacy-stats">
        <div class="portrait-name">${m.name}</div>
        <div class="portrait-sub">${m.subtitle}</div>
        <div class="status-icons"></div>
        <div class="panel-stats">
          <div class="stat-row">
            <span class="stat-label">HP</span>
            <div class="stat-bar hp-bar"><div class="hp-fill stat-fill" style="width:100%"></div></div>
            <span class="stat-value hp-val">${m.hp}/${m.maxHp}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">MP</span>
            <div class="stat-bar"><div class="mp-fill stat-fill" style="width:100%"></div></div>
            <span class="stat-value mp-val">${m.mp}/${m.maxMp}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">AP</span>
            <div class="stat-bar"><div class="atb-fill stat-fill" style="width:100%;transform:scaleX(0)"></div></div>
            <span class="stat-value"></span>
          </div>
        </div>
      </div>`;
    div.addEventListener('click', () => DEV.onPartyClick(m.id));
    formation.appendChild(div);

    // Visible compact stat chip, mirrored below the diamond formation
    const chip = document.createElement('div');
    chip.className = 'stat-chip';
    chip.id = `statchip-${m.id}`;
    chip.style.setProperty('--member-color', m.color);
    chip.innerHTML = `
      <div class="chip-name">${m.name}</div>
      <div class="status-icons"></div>
      <div class="panel-stats">
        <div class="stat-row">
          <span class="stat-label">HP</span>
          <div class="stat-bar hp-bar"><div class="hp-fill stat-fill" style="width:100%"></div></div>
          <span class="stat-value hp-val">${m.hp}/${m.maxHp}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">MP</span>
          <div class="stat-bar"><div class="mp-fill stat-fill" style="width:100%"></div></div>
          <span class="stat-value mp-val">${m.mp}/${m.maxMp}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">AP</span>
          <div class="stat-bar"><div class="atb-fill stat-fill" style="width:100%;transform:scaleX(0)"></div></div>
          <span class="stat-value"></span>
        </div>
      </div>`;
    strip.appendChild(chip);
  });

  positionDiamondFormation(true);
}

function buildEnemyCards() {
  _orig_buildEnemyCards();
  state.enemies.forEach(e => {
    if (e.isDummy || e.isChains) return;
    const card = el(`enemy-card-${e.id}`);
    if (!card || card.querySelector('.enemy-stagger-bar')) return;
    card.insertAdjacentHTML('beforeend', `<div class="enemy-stagger-bar"><div class="enemy-stagger-fill"></div></div>`);
  });
  fitEnemyField();
}

/* moved into PARTY HUD ENHANCEMENT block below */

/* moved into PARTY HUD ENHANCEMENT block below */
function addLog(text, type = 'normal') {
  const log = el('battle-log');
  const div = document.createElement('div');
  div.className = `log-entry log-${type}`;
  div.textContent = text;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  while (log.children.length > 35) log.removeChild(log.firstChild);
}

// ── Battle background parallax ────────────────────────────
const BATTLE_BG = {
  init() {
    const bgDiv = el('battle-bg');
    if (!bgDiv) return;
    bgDiv.style.backgroundImage = BATTLE.bg ? `url('${BATTLE.bg}')` : '';
  }
};

// ═══════════════════════════════════════════════════════════
//  VFX SYSTEM
// ═══════════════════════════════════════════════════════════
const VFX = {
  _canvas: null,
  _ctx: null,
  _particles: [],
  _draws: [],       // one-shot canvas draws (slashes, flames, sigils)
  _raf: null,
  _shakeX: 0, _shakeY: 0, _shakeDecay: 0,
  _battleEl: null,

  init() {
    this._canvas  = el('vfx-canvas');
    this._battleEl = el('battle-screen');
    if (!this._canvas) return;
    this._ctx = this._canvas.getContext('2d');
    this._resize();
    window.addEventListener('resize', () => this._resize());
    this._loop();
  },

  _resize() {
    if (!this._canvas || !this._battleEl) return;
    this._canvas.width  = this._battleEl.offsetWidth;
    this._canvas.height = this._battleEl.offsetHeight;
  },

  _loop() {
    this._raf = requestAnimationFrame(() => this._loop());
    const ctx = this._ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);

    // screen shake
    if (this._shakeDecay > 0) {
      this._shakeX = (Math.random() - 0.5) * this._shakeDecay * 12;
      this._shakeY = (Math.random() - 0.5) * this._shakeDecay * 8;
      this._shakeDecay = Math.max(0, this._shakeDecay - 0.065);
      if (this._battleEl) {
        this._battleEl.style.transform = `translate(${this._shakeX}px, ${this._shakeY}px)`;
      }
    } else if (this._battleEl && this._battleEl.style.transform) {
      this._battleEl.style.transform = '';
    }

    // ── one-shot procedural draws ──────────────────────────
    this._draws = this._draws.filter(d => d.life > 0);
    for (const d of this._draws) {
      d.life -= d.decay;
      const t = Math.max(0, d.life);
      ctx.save();
      ctx.globalAlpha = Math.min(1, t / d.fadeStart);
      d.draw(ctx, t);
      ctx.restore();
    }

    // ── particles ─────────────────────────────────────────
    this._particles = this._particles.filter(p => p.life > 0);
    for (const p of this._particles) {
      p.x  += p.vx;
      p.y  += p.vy;
      p.vy += p.gravity;
      p.vx *= p.drag;
      p.vy *= p.drag;
      p.life -= p.decay;
      const a = Math.min(1, p.life / p.fadeStart);
      ctx.save();
      ctx.globalAlpha = a * p.alpha;

      if (p.shape === 'slash') {
        const spd = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        const angle = Math.atan2(p.vy, p.vx);
        const len = p.size * (4 + spd * 1.4);
        ctx.translate(p.x, p.y);
        ctx.rotate(angle);
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size * 0.55;
        ctx.shadowColor = p.color;
        ctx.shadowBlur  = p.size * 1.5;
        ctx.beginPath();
        ctx.moveTo(-len * 0.65, 0);
        ctx.lineTo(len * 0.35, 0);
        ctx.stroke();
      } else if (p.shape === 'wisp') {
        const angle = Math.atan2(p.vy, p.vx);
        const len = p.size * 5;
        ctx.translate(p.x, p.y);
        ctx.rotate(angle);
        const grad = ctx.createLinearGradient(-len * 0.5, 0, len * 0.5, 0);
        grad.addColorStop(0, 'transparent');
        grad.addColorStop(0.4, p.color);
        grad.addColorStop(1, 'transparent');
        ctx.strokeStyle = grad;
        ctx.lineWidth = p.size * 0.4;
        ctx.shadowColor = p.color;
        ctx.shadowBlur  = p.size * 1.2;
        ctx.beginPath();
        ctx.moveTo(-len * 0.5, 0);
        ctx.lineTo(len * 0.5, 0);
        ctx.stroke();
      } else if (p.shape === 'ring') {
        ctx.translate(p.x, p.y);
        const t = 1 - p.life / p.fadeStart;
        ctx.strokeStyle = p.color;
        ctx.lineWidth   = p.size * 0.15;
        ctx.shadowColor = p.color;
        ctx.shadowBlur  = p.size * 1.5;
        ctx.globalAlpha *= Math.max(0, 1 - t);
        ctx.beginPath();
        ctx.arc(0, 0, p.size * (0.1 + t) * 22, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.translate(p.x, p.y);
        ctx.fillStyle   = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur  = p.size * 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  },

  _emit(x, y, count, cfg) {
    for (let i = 0; i < count; i++) {
      const angle = cfg.angleMin + Math.random() * (cfg.angleMax - cfg.angleMin);
      const speed = cfg.speedMin + Math.random() * (cfg.speedMax - cfg.speedMin);
      this._particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        gravity:  cfg.gravity  ?? 0.12,
        drag:     cfg.drag     ?? 0.93,
        size:     (cfg.sizeMin ?? 2) + Math.random() * ((cfg.sizeMax ?? 4) - (cfg.sizeMin ?? 2)),
        color:    Array.isArray(cfg.colors) ? cfg.colors[Math.floor(Math.random() * cfg.colors.length)] : cfg.color,
        life:     1,
        decay:    cfg.decay ?? (0.018 + Math.random() * 0.014),
        fadeStart: cfg.fadeStart ?? 0.55,
        alpha:    cfg.alpha ?? 1,
        shape:    cfg.shape ?? 'dot'
      });
    }
  },

  // Register a one-shot procedural draw (slash arc, flame tongue, sigil ring)
  _addDraw(drawFn, duration, fadeStart) {
    this._draws.push({ life: 1, decay: 1 / (duration / 16.67), fadeStart: fadeStart ?? 0.55, draw: drawFn });
  },

  _getCardCenter(target) {
    const cardEl = target.isParty
      ? el(`panel-${target.id}`)
      : el(`enemy-card-${target.id}`);
    const battleEl = this._battleEl;
    if (!cardEl || !battleEl) return { x: this._canvas.width / 2, y: this._canvas.height / 2 };
    const cr = cardEl.getBoundingClientRect();
    const br = battleEl.getBoundingClientRect();
    return { x: cr.left - br.left + cr.width / 2, y: cr.top - br.top + cr.height / 2 };
  },

  shake(intensity = 1) {
    this._shakeDecay = Math.max(this._shakeDecay, intensity);
  },

  screenFlash(color, duration = 180) {
    const f = el('screen-flash');
    if (!f) return;
    f.style.background = color;
    f.style.transition = 'none';
    f.style.opacity    = '1';
    requestAnimationFrame(() => {
      f.style.transition = `opacity ${duration}ms ease-out`;
      f.style.opacity    = '0';
    });
  },

  hitFlash(target, type) {
    const cardEl = target.isParty
      ? el(`panel-${target.id}`)
      : el(`enemy-card-${target.id}`);
    if (!cardEl) return;
    const f = document.createElement('div');
    f.className = `hit-flash hit-flash-${type}`;
    cardEl.appendChild(f);
    setTimeout(() => f.remove(), 560);
  },

  // ── KADEN / AVA — sword slash arc ──────────────────────────
  _drawSlash(x, y, isCrit) {
    // Two overlapping curved arcs — a diagonal slash across the target card
    const W = isCrit ? 90 : 65;
    const H = isCrit ? 80 : 58;
    const color1 = isCrit ? 'rgba(255,255,255,0.92)' : 'rgba(220,215,205,0.82)';
    const color2 = isCrit ? 'rgba(200,180,160,0.55)' : 'rgba(160,150,135,0.40)';

    this._addDraw((ctx, t) => {
      // Primary slash — sharp diagonal curve from top-left to bottom-right offset
      ctx.save();
      ctx.translate(x, y);
      ctx.strokeStyle = color1;
      ctx.lineWidth = isCrit ? 2.2 : 1.5;
      ctx.shadowColor = isCrit ? 'rgba(255,240,220,0.8)' : 'rgba(200,190,175,0.5)';
      ctx.shadowBlur = isCrit ? 12 : 6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-W * 0.55, -H * 0.45);
      ctx.quadraticCurveTo(W * 0.05, -H * 0.10, W * 0.55, H * 0.50);
      ctx.stroke();

      if (isCrit) {
        // Second cross-slash
        ctx.strokeStyle = color2;
        ctx.lineWidth = 1.2;
        ctx.shadowBlur = 5;
        ctx.beginPath();
        ctx.moveTo(W * 0.40, -H * 0.50);
        ctx.quadraticCurveTo(-W * 0.05, -H * 0.05, -W * 0.40, H * 0.45);
        ctx.stroke();
      }
      ctx.restore();
    }, isCrit ? 280 : 220, 0.45);

    // A few velocity-streak particles trailing the arc
    const slashAngle = Math.PI * 0.30; // ~54 degrees — matches the arc direction
    this._emit(x - W * 0.3, y - H * 0.2, isCrit ? 4 : 2, {
      angleMin: slashAngle - 0.18, angleMax: slashAngle + 0.18,
      speedMin: 3.5, speedMax: 6.5,
      colors: isCrit ? ['#ffffff', '#e0d8d0', '#b0a898'] : ['#d0c8bc', '#a89888'],
      sizeMin: 0.8, sizeMax: 1.4,
      gravity: 0.14, drag: 0.88,
      decay: 0.038, fadeStart: 0.45,
      shape: 'slash'
    });
  },

  // ── KURT — flame tongue ──────────────────────────────────
  _drawFlame(x, y, isCrit) {
    const tongues = isCrit ? 5 : 3;
    const spread  = isCrit ? 0.52 : 0.35;

    // Spawn animated flame particles that rise and flicker
    for (let i = 0; i < tongues; i++) {
      const ox = (Math.random() - 0.5) * (isCrit ? 28 : 18);
      this._emit(x + ox, y + 10, 1, {
        angleMin: -Math.PI * (0.5 + spread * 0.5) + i * (Math.PI * spread / (tongues - 1 || 1)),
        angleMax: -Math.PI * (0.5 + spread * 0.5) + i * (Math.PI * spread / (tongues - 1 || 1)) + 0.15,
        speedMin: isCrit ? 2.0 : 1.2,
        speedMax: isCrit ? 4.5 : 3.0,
        colors: isCrit
          ? ['#ff8830', '#ff6010', '#ffaa40', '#cc3010']
          : ['#d06020', '#b04010', '#e08030'],
        sizeMin: isCrit ? 2.5 : 1.8,
        sizeMax: isCrit ? 5.0 : 3.5,
        gravity: -0.18,
        drag: 0.93,
        decay: 0.016,
        fadeStart: 0.55,
        shape: 'dot'
      });
    }

    // Ember micro-sparks drifting sideways
    this._emit(x, y, isCrit ? 10 : 6, {
      angleMin: -Math.PI * 0.85, angleMax: -Math.PI * 0.15,
      speedMin: 0.8, speedMax: 3.2,
      colors: isCrit ? ['#ff9940', '#ffcc60', '#ff6620'] : ['#c05820', '#e07830'],
      sizeMin: 0.8, sizeMax: 1.8,
      gravity: -0.08, drag: 0.92,
      decay: 0.024, fadeStart: 0.5,
      shape: 'slash'
    });

    // Core flash — brief bright center
    this._addDraw((ctx, t) => {
      ctx.save();
      ctx.translate(x, y);
      const r = isCrit ? 22 : 14;
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      grad.addColorStop(0, isCrit ? 'rgba(255,200,80,0.55)' : 'rgba(220,120,40,0.40)');
      grad.addColorStop(1, 'rgba(180,60,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }, isCrit ? 200 : 150, 0.35);
  },

  // ── IRISELLE — ether sigil ring ──────────────────────────
  _drawSigil(x, y, isCrit) {
    const rings   = isCrit ? 3 : 2;
    const baseR   = isCrit ? 38 : 26;
    const color   = isCrit ? 'rgba(160,120,220,0.75)' : 'rgba(110,80,170,0.65)';
    const gColor  = isCrit ? 'rgba(200,160,255,0.5)' : 'rgba(150,110,210,0.38)';

    // Expanding concentric rings
    for (let i = 0; i < rings; i++) {
      const delay = i * 55;
      setTimeout(() => {
        const r0 = baseR + i * 14;
        const lifeFrames = isCrit ? 340 : 260;
        this._addDraw((ctx, t) => {
          ctx.save();
          ctx.translate(x, y);
          const expand = (1 - t) * r0 * 0.35; // rings expand outward as they fade
          ctx.strokeStyle = i === 0 ? color : gColor;
          ctx.lineWidth = i === 0 ? 1.4 : 0.9;
          ctx.shadowColor = isCrit ? 'rgba(190,130,255,0.6)' : 'rgba(130,90,200,0.45)';
          ctx.shadowBlur = isCrit ? 10 : 6;
          ctx.beginPath();
          ctx.arc(0, 0, r0 + expand, 0, Math.PI * 2);
          ctx.stroke();

          // Tick marks on outer ring — a sigil-like detail
          if (i === 0) {
            const ticks = isCrit ? 8 : 6;
            for (let k = 0; k < ticks; k++) {
              const a = (k / ticks) * Math.PI * 2;
              const ir = r0 + expand - 5;
              const or = r0 + expand + 5;
              ctx.beginPath();
              ctx.moveTo(Math.cos(a) * ir, Math.sin(a) * ir);
              ctx.lineTo(Math.cos(a) * or, Math.sin(a) * or);
              ctx.stroke();
            }
          }
          ctx.restore();
        }, lifeFrames, 0.50);
      }, delay);
    }

    // Slow-rising ether wisps
    this._emit(x, y, isCrit ? 8 : 5, {
      angleMin: -Math.PI * 0.90, angleMax: -Math.PI * 0.10,
      speedMin: 0.5, speedMax: 2.0,
      colors: isCrit
        ? ['#8060c8', '#a080e0', '#604898', '#c0a0ff']
        : ['#6048a0', '#8060b8', '#503880'],
      sizeMin: 1.0, sizeMax: 2.2,
      gravity: -0.10, drag: 0.96,
      decay: 0.011, fadeStart: 0.50,
      shape: 'wisp'
    });
  },

  // ── Route physical hit by actor ──────────────────────────
  burstByActor(target, actor, isCrit) {
    const { x, y } = this._getCardCenter(target);
    const id = actor ? actor.id : null;

    if (id === 'kurt') {
      // Flame
      this.shake(isCrit ? 0.7 : 0.4);
      this.hitFlash(target, 'magic');
      this._drawFlame(x, y, isCrit);
      if (isCrit) this.screenFlash('rgba(180,70,10,0.08)', 220);
    } else if (id === 'iris') {
      // Ether sigil
      this.shake(isCrit ? 0.5 : 0.28);
      this.hitFlash(target, 'magic');
      this._drawSigil(x, y, isCrit);
      if (isCrit) this.screenFlash('rgba(80,40,140,0.08)', 240);
    } else {
      // Kaden, Ava, or any unknown — sword slash
      this.shake(isCrit ? 0.85 : 0.38);
      this.hitFlash(target, 'dmg');
      this._drawSlash(x, y, isCrit);
      if (isCrit) this.screenFlash('rgba(255,255,255,0.06)', 180);
    }
  },

  burstMagic(target, actor) {
    // Magic skills always route through actor identity
    this.burstByActor(target, actor, false);
  },

  burstCrit(target, actor) {
    this.burstByActor(target, actor, true);
  },

  // Generic enemy hit — no actor identity, plain impact
  burstHit(target) {
    const { x, y } = this._getCardCenter(target);
    this.shake(0.32);
    this.hitFlash(target, 'dmg');
    this._emit(x, y, 3, {
      angleMin: -Math.PI * 0.85, angleMax: -Math.PI * 0.15,
      speedMin: 1.5, speedMax: 4.5,
      colors: ['#b8b0a8', '#807870', '#d0c8c0'],
      sizeMin: 0.9, sizeMax: 1.8,
      gravity: 0.18, drag: 0.90,
      decay: 0.030, fadeStart: 0.45,
      shape: 'slash'
    });
  },

  burstHeal(target) {
    const { x, y } = this._getCardCenter(target);
    this.hitFlash(target, 'heal');
    this._emit(x, y, 4, {
      angleMin: -Math.PI * 0.85, angleMax: -Math.PI * 0.15,
      speedMin: 0.5, speedMax: 1.8,
      colors: ['#c0b068', '#a89850', '#d8c880'],
      sizeMin: 1.0, sizeMax: 1.8,
      gravity: -0.09, drag: 0.96,
      decay: 0.010, fadeStart: 0.42,
      shape: 'wisp'
    });
  },

  burstDebuff(target) {
    const { x, y } = this._getCardCenter(target);
    this.hitFlash(target, 'magic');
    this._emit(x, y, 3, {
      angleMin: Math.PI * 0.20, angleMax: Math.PI * 0.80,
      speedMin: 0.4, speedMax: 1.4,
      colors: ['#382040', '#281830', '#503058'],
      sizeMin: 1.0, sizeMax: 2.0,
      gravity: 0.07, drag: 0.95,
      decay: 0.012, fadeStart: 0.38,
      shape: 'wisp'
    });
  },

  burstDefeat(target) {
    const { x, y } = this._getCardCenter(target);
    this.shake(0.55);
    this.screenFlash('rgba(100,80,60,0.05)', 400);
    this._emit(x, y, 5, {
      angleMin: Math.PI * 0.3, angleMax: Math.PI * 0.7,
      speedMin: 1.0, speedMax: 3.5,
      colors: ['#584848', '#403838', '#706060'],
      sizeMin: 1.2, sizeMax: 2.2,
      gravity: 0.22, drag: 0.88,
      decay: 0.020, fadeStart: 0.42,
      shape: 'slash'
    });
  }
};

function showFloat(target, value, type, actor) {
  // Trigger appropriate VFX burst — routed by actor identity when available
  if (type === 'crit') {
    VFX.burstCrit(target, actor);
  } else if (type === 'enemy-dmg') {
    VFX.burstByActor(target, actor, false);
  } else if (type === 'player-dmg') {
    VFX.burstHit(target);   // enemy hitting party — generic impact
  } else if (type === 'heal') {
    VFX.burstHeal(target);
  } else if (type === 'debuff') {
    VFX.burstDebuff(target);
  }

  const container = target.isParty
    ? el(`panel-${target.id}`)
    : el(`enemy-card-${target.id}`);
  if (!container) return;
  const f = document.createElement('div');
  f.className = `floater floater-${type}`;
  f.textContent = value;
  container.appendChild(f);
  setTimeout(() => f.remove(), 1400);
}

function spawnResultParticles() {
  const container = el('result-particles');
  if (!container) return;
  container.innerHTML = '';
  const count = 38;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'result-particle';
    const x = Math.random() * 100;
    const delay = Math.random() * 4;
    const dur   = 5 + Math.random() * 8;
    const size  = 1 + Math.random() * 2.5;
    p.style.cssText = `
      left: ${x}%;
      bottom: -10px;
      width: ${size}px;
      height: ${size}px;
      animation-duration: ${dur}s;
      animation-delay: ${delay}s;
      box-shadow: 0 0 ${size * 3}px rgba(226,80,95,0.8);
    `;
    container.appendChild(p);
  }
}

function endBattle(won, fled = false) {
  if (state.loopHandle) cancelAnimationFrame(state.loopHandle);
  state.phase = won ? 'WIN' : 'LOSE';
  AUDIO.stopBGM();
  if (won) {
    AUDIO.sfxVictory();
    setTimeout(() => {
      const respite = new Audio('FC-OST/interlude, the breathing life.mp3');
      respite.volume = fcLoadSettings().musicVol / 100 * 0.85;
      respite.play().catch(() => {});
    }, 900);
  }

  setTimeout(() => {
  if (won) {
        el('battle-screen').classList.add('hidden');
        el('result-screen').classList.remove('hidden');

        el('result-win-layout').classList.remove('hidden');
        el('result-lose-layout').classList.add('hidden');
        el('result-corner-r').classList.remove('hidden');
        el('result-corner-l').classList.remove('hidden');

        spawnResultParticles();

        const titleEl = el('result-title');
        const body    = el('result-body');
        const btn     = el('result-btn');

        titleEl.textContent = 'Encounter Finished';
        const partyRows = state.party.map(p => {
          const hpClass = p.dead ? 'result-member-hp down' : 'result-member-hp';
          const hpText  = p.dead ? '— down —' : `${p.hp} / ${p.maxHp} HP`;
          return `<div class="result-member" style="color:${p.color}">
            <span>${p.name}</span>
            <span class="${hpClass}">${hpText}</span>
          </div>`;
        }).join('');

        body.innerHTML = `
          <p class="result-sub">An obstacle in your journey has been put aside, you may now Proceed forward.</p>
          <div class="result-party-status">
            <div class="result-party-header">PARTY STATUS</div>
            ${partyRows}
          </div>`;

        btn.textContent = '→ Keep Moving';
        btn.onclick = () => { exitTo('PROCEEDING', () => { window.location.href = 'c3s5.html'; }); };
    } else {
      el('battle-screen').classList.add('hidden');
      el('result-screen').classList.remove('hidden');

      el('result-win-layout').classList.add('hidden');
      el('result-lose-layout').classList.remove('hidden');
      el('result-corner-r').classList.add('hidden');
      el('result-corner-l').classList.add('hidden');

      const titleEl = el('result-title-lose');
      const body    = el('result-body-lose');
      const btn     = el('result-btn-lose');

      titleEl.textContent = fled ? 'WITHDRAWAL' : 'DISARMED';
      body.innerHTML = `<p class="result-sub" style="margin-bottom:0">The crew falls. It is in your hands for them to stand back up.</p>`;
      btn.textContent = 'Try Again';
      btn.onclick = () => { exitTo('REENGAGING', () => { startBattle(); el('exit-transition').classList.remove('active'); }); };
    }
  }, 700);
}

function exitTo(label, action, delay = 650) {
  const overlay = el('exit-transition');
  const labelEl = el('exit-transition-label');
  labelEl.textContent = label;
  overlay.classList.add('active');
  setTimeout(action, delay);
}

async function startBattle() {
  if (state.loopHandle) cancelAnimationFrame(state.loopHandle);
  state = {
    phase: 'IDLE',
    party: initParty(),
    enemies: initEnemies(),
    activeChar: null, selectedAction: null,
    readyQueue: [], turn: 0, animating: false,
    loopHandle: null
  };

  el('result-screen').classList.add('hidden');
  el('battle-screen').classList.remove('hidden');
  // Fade out exit transition overlay if it was showing
  const exitOverlay = el('exit-transition');
  if (exitOverlay) { exitOverlay.classList.remove('active'); }
  el('action-panel').classList.add('hidden');
  el('battle-log').innerHTML = '';
  DEV.reset();

  updateTurnNum();
  buildPartyPanels();
  buildEnemyCards();
  BATTLE_BG.init();
  VFX._resize();
  render();

  AUDIO.startBGM();
  await playBattleTransition(BATTLE.name, BATTLE.subtitle);

  addLog(BATTLE.subtitle, 'sub');
  addLog(`Encountered ANIMA ARMY troops.`, 'system');

  scheduleLoop();
}

const el = id => document.getElementById(id);

const getCardEl = t => t.isParty ? el(`panel-${t.id}`) : el(`enemy-card-${t.id}`);

const wait = ms => new Promise(r => setTimeout(r, ms));

function updateTurnNum() { const e = el('turn-num'); if (e) e.textContent = state.turn; }

// ═══════════════════════════════════════════════════════════
//  AUDIO SYSTEM
// ═══════════════════════════════════════════════════════════

// ── Shared FC settings reader (synced from C4 settings panel) ──
function fcLoadSettings() {
  try {
    return Object.assign(
      { musicVol: 70, sfxVol: 80 },
      JSON.parse(localStorage.getItem('fc_settings') || '{}')
    );
  } catch (e) {
    return { musicVol: 70, sfxVol: 80 };
  }
}

function dropPreBlack() { const b = document.getElementById('pre-black'); if (b) b.remove(); }

function playBattleTransition(battleName, subtitle) {
  return new Promise(resolve => {
    const overlay = el('battle-transition');
    const reduce  = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    // Timings (ms) — keep in step with the durations in the BATTLE TRANSITION css block
    const CLOSE_MS = 520;                 // iris closing
    const HOLD_MS  = reduce ? 1200 : 2200; // when the iris starts to open
    const OPEN_MS  = reduce ? 450  : 720;  // iris opening

    el('trans-title').textContent = battleName || '';
    const subEl = el('trans-sub');
    subEl.textContent = subtitle || '';
    subEl.style.display = subtitle ? '' : 'none';
    el('trans-observation').innerHTML =
      'There is no war without a wound that started it,<br>' +
      'No wound without a name,<br>' +
      'And no name without something worth losing.';
    el('trans-hint').textContent =
      'With the right sequence of actions, encounters can be fast and tactical. Remember to move accordingly and without hesitation.';

    overlay.classList.remove('hidden', 'is-open');
    void overlay.offsetWidth;            // restart the CSS animations
    AUDIO.sfxEncount();

    const t0 = performance.now();
    let openTimer = null, doneTimer = null, opened = false, finished = false;

    function finish() {
      if (finished) return;
      finished = true;
      dropPreBlack();
      clearTimeout(openTimer); clearTimeout(doneTimer);
      overlay.removeEventListener('pointerdown', skip);
      document.removeEventListener('keydown', onKey);
      overlay.classList.add('hidden');
      overlay.classList.remove('is-open');
      resolve();
    }
    function open() {
      if (opened) return;
      opened = true;
      dropPreBlack();
      overlay.classList.add('is-open');
      doneTimer = setTimeout(finish, OPEN_MS + 60);
    }
    // Skip: jump to the opening, but never cut the iris off mid-close
    function skip() {
      if (opened) return;
      clearTimeout(openTimer);
      openTimer = setTimeout(open, Math.max(0, CLOSE_MS - (performance.now() - t0)));
    }
    function onKey(e) { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') skip(); }

    overlay.addEventListener('pointerdown', skip);
    document.addEventListener('keydown', onKey);
    openTimer = setTimeout(open, HOLD_MS);
  });
}

// ═══════════════════════════════════════════════════════════
//  SECRET DEV MENU — click C1+C2+C3 x2 each, then E1 x5, then type TWDEVMENU
// ═══════════════════════════════════════════════════════════
const DEV = {
  // click counts per target id
  clicks: {},
  // sequence state
  stage: 0,       // 0=chars, 1=enemy, 2=typing
  charsDone: false,
  typedSoFar: '',
  CODE: 'TWDEVMENU',

  // call after every relevant click
  onPartyClick(memberId) {
    if (this.stage !== 0) return;
    this.clicks[memberId] = (this.clicks[memberId] || 0) + 1;
    // check if all 3 party members have been clicked exactly 2 times
    const ids = state.party.map(p => p.id);
    const allTwo = ids.every(id => (this.clicks[id] || 0) >= 2);
    if (allTwo && !this.charsDone) {
      this.charsDone = true;
      this.stage = 1;
      addLog('...', 'system');
    }
  },

  onEnemyClick(enemyId) {
    if (this.stage !== 1) return;
    this.clicks[enemyId] = (this.clicks[enemyId] || 0) + 1;
    if (this.clicks[enemyId] >= 5) {
      this.stage = 2;
      this.typedSoFar = '';
      addLog('......', 'system');
    }
  },

  onKey(e) {
    if (this.stage !== 2) return;
    const ch = e.key.toUpperCase();
    if (ch.length === 1 && /[A-Z]/.test(ch)) {
      this.typedSoFar += ch;
      if (this.CODE.startsWith(this.typedSoFar)) {
        if (this.typedSoFar === this.CODE) {
          this.open();
        }
      } else {
        // reset typing if wrong key
        this.typedSoFar = ch;
        if (!this.CODE.startsWith(this.typedSoFar)) this.typedSoFar = '';
      }
    }
  },

  reset() {
    this.clicks = {};
    this.stage = 0;
    this.charsDone = false;
    this.typedSoFar = '';
  },

  open() {
    const menu = el('dev-menu');
    menu.style.display = 'flex';
    this.reset();
  },

  close() {
    el('dev-menu').style.display = 'none';
  }
};

// ═══════════════════════════════════════════════════════════
//  COMBAT ENHANCEMENT PATCH
//  Adds: natural crit chance, stagger/break meter with a bonus-
//  damage window, escalating combo damage on a focused target,
//  low-HP kill-priority AI targeting, and a one-time boss enrage
//  phase at 30% HP. Wraps the engine's own functions (captured
//  below under _orig_ names) rather than replacing their logic,
//  so existing per-boss mechanics keep working unmodified.
// ═══════════════════════════════════════════════════════════
function _orig_calcDamage(attacker, skill, defender) {
  let base = attacker.atk * (attacker.atkMult || 1) * skill.power;
  base *= 0.9 + Math.random() * 0.2;
  if (skill.type === 'physical') {
    const eff = defender.def * (defender.defMult || 1);
    const pierce = skill.piercing || 0;
    base -= eff * (1 - pierce) * 0.4;
  }
  let crit = false;
  if (attacker.critNext) {
    base *= CRIT_MULT;
    crit = true;
    attacker.critNext = false;
  }
  return { dmg: Math.max(1, Math.round(base)), crit };
}

function _orig_aiChooseSkill(enemy) {
  // DEV: if a forced move is queued for this enemy, use it once then clear
  if (enemy._forcedSkillIndex !== undefined && enemy._forcedSkillIndex !== null) {
    const sk = enemy.skills[enemy._forcedSkillIndex];
    enemy._forcedSkillIndex = null;
    const statusEl = el('dev-force-status');
    if (statusEl) statusEl.textContent = `✓ Forced move fired: ${sk ? sk.name : '??'}`;
    if (sk) return sk;
  }
  // If the enemy has a fixed `pattern` (array of skill names), cycle through
  // it in order instead of picking randomly. This is what lets a boss
  // "telegraph" — players can learn the rhythm instead of facing pure RNG.
  if (Array.isArray(enemy.pattern) && enemy.pattern.length) {
    if (typeof enemy.patternIndex !== 'number') enemy.patternIndex = 0;
    const wantedName = enemy.pattern[enemy.patternIndex % enemy.pattern.length];
    enemy.patternIndex++;
    const found = enemy.skills.find(sk => sk.name === wantedName);
    if (found) return found;
    // Name typo or skill removed — fall through to random as a safety net.
  }
  const total = enemy.skills.reduce((s, sk) => s + (sk.weight || 1), 0);
  let r = Math.random() * total;
  for (const sk of enemy.skills) { if ((r -= sk.weight || 1) <= 0) return sk; }
  return enemy.skills[0];
}

function _orig_aiChooseTargets(skill) {
  const alive = state.party.filter(p => !p.dead);
  if (!alive.length) return null;
  if (skill.target === 'all_party') return alive;
  return [alive[Math.floor(Math.random() * alive.length)]];
}

function _orig_buildEnemyCards() {
  const cont = el('enemy-container');
  cont.innerHTML = '';
  state.enemies.forEach((e, i) => {
    const card = document.createElement('div');
    card.className = `enemy-card${e.isBoss ? ' boss' : ''}`;
    card.id = `enemy-card-${e.id}`;
    card.style.setProperty('--enemy-color', e.color);
    card.style.animationDelay = `${i * 0.12}s`;
    card.style.position = 'relative';
    card.innerHTML = `
      <div class="enemy-symbol-wrap"><div class="enemy-symbol">${e.symbol}</div></div>
      <div class="enemy-name">${e.name}</div>
      <div class="enemy-subtitle">${e.subtitle}</div>
      <div class="enemy-hp-bar"><div class="enemy-hp-fill" style="width:100%"></div></div>
      <div class="enemy-hp-text">${e.hp} / ${e.maxHp}</div>
      <div class="enemy-atb-bar"><div class="enemy-atb-fill" style="width:100%;transform:scaleX(0)"></div></div>
      <div class="enemy-intent"></div>`;
    // Secret menu: track clicks on enemy card
    card.addEventListener('click', () => DEV.onEnemyClick(e.id));
    cont.appendChild(card);
  });
}

function _orig_renderATBOnly() {
  state.party.forEach(m => {
    const p = el(`panel-${m.id}`);
    if (!p) return;
    const fill = p.querySelector('.atb-fill');
    if (fill) {
      fill.style.width = Math.min(100, m.atb) + '%';
      fill.classList.toggle('ready', m.atb >= 100);
    }
  });
  state.enemies.forEach(e => {
    const card = el(`enemy-card-${e.id}`);
    if (!card || e.dead) return;
    const fill = card.querySelector('.enemy-atb-fill');
    if (fill) {
      fill.style.transform = 'scaleX(' + (Math.min(100, e.atb) / 100) + ')';
      fill.classList.toggle('ready', e.atb >= 100);
      fill.classList.toggle('striking', e.atb >= 80 && e.atb < 100);
      // Note: pendingSkill itself is now rolled early in gameLoop() at the
      // 80% AP mark, not here — this just renders whatever state it's in.
    }
    // Update intent label
    const intent = card.querySelector('.enemy-intent');
    if (intent) {
      if (e.atb <= 0) {
        intent.textContent = '';
        intent.className = 'enemy-intent';
      } else if (e.atb >= 80 && e.pendingSkill) {
        // Telegraph window — name the actual move so players can react,
        // not just "something is coming". AoE moves get a louder,
        // distinct warning style since they punish the whole party.
        const evaPct = enemyEvaPercent(e);
        const isAoe = e.pendingSkill.target === 'all_party' || e.pendingSkill.target === 'all';
        const ready = e.atb >= 100;
        const arrow = ready ? '▶' : '◇';
        if (isAoe) {
          intent.innerHTML = `${arrow} [!] ${e.pendingSkill.name.toUpperCase()} <span class="intent-eva intent-eva-red">| ALL</span>`;
          intent.className = 'enemy-intent intent-aoe-warn';
        } else {
          intent.innerHTML = `${arrow} ${e.pendingSkill.name.toUpperCase()} <span class="intent-eva${ready ? ' intent-eva-red' : ''}">| EVA%: ${evaPct}</span>`;
          intent.className = `enemy-intent${ready ? ' intent-striking' : ' intent-windup'}`;
        }
      } else if (e.atb > 0) {
        const evaPct = enemyEvaPercent(e);
        intent.innerHTML = `ACTIVE <span class="intent-eva">| EVA%: ${evaPct}</span>`;
        intent.className = 'enemy-intent intent-active';
      }
    }

    // One-time AoE screen warning the instant the telegraph appears —
    // separate from the per-frame label update above, so it only fires
    // once per windup rather than every frame.
    const isAoeIncoming = !!(e.pendingSkill && (e.pendingSkill.target === 'all_party' || e.pendingSkill.target === 'all'));
    card.classList.toggle('aoe-incoming', isAoeIncoming);
    if (isAoeIncoming && !e._aoeWarned) {
      e._aoeWarned = true;
      VFX.screenFlash('rgba(220,40,30,0.10)', 260);
    }
    if (!e.pendingSkill && e._aoeWarned) {
      e._aoeWarned = false;
    }
  });
}

// ── Enemy field auto-fit: wrap first, then shrink as a last resort ──
// #enemy-container already wraps onto additional rows via flex-wrap
// when a row runs out of horizontal room. If the wrapped layout still
// doesn't fit the available box (very small screens, many enemies),
// this scales the whole container down just enough to fit, instead of
// letting cards spill off-screen.
function fitEnemyField() {
  const field = el('enemy-field');
  const cont = el('enemy-container');
  if (!field || !cont) return;
  cont.style.transform = '';
  const availW = field.clientWidth - 16;
  const availH = field.clientHeight - 16;
  const natW = cont.offsetWidth;
  const natH = cont.offsetHeight;
  if (!natW || !natH) return;
  const scale = Math.min(1, availW / natW, availH / natH);
  cont.style.transform = scale < 0.995 ? `scale(${scale})` : '';
}

if (typeof window !== 'undefined') {
  let _fitEnemyFieldTimer = null;
  const _scheduleFitEnemyField = () => {
    clearTimeout(_fitEnemyFieldTimer);
    _fitEnemyFieldTimer = setTimeout(fitEnemyField, 60);
  };
  window.addEventListener('resize', _scheduleFitEnemyField);
  window.addEventListener('orientationchange', _scheduleFitEnemyField);
  if (typeof ResizeObserver !== 'undefined') {
    const _enemyFieldRO = new ResizeObserver(_scheduleFitEnemyField);
    const _efField = el('enemy-field');
    if (_efField) _enemyFieldRO.observe(_efField);
  }
}

function renderATBOnly() {
  _orig_renderATBOnly2();
  state.party.forEach(m => {
    const chip = el(`statchip-${m.id}`);
    const legacy = el(`panel-${m.id}`);
    if (!chip || !legacy) return;
    const atbSrc = legacy.querySelector('.legacy-stats .atb-fill');
    const atbDst = chip.querySelector('.atb-fill');
    if (atbSrc && atbDst) {
      atbDst.style.transform = 'scaleX(' + ((parseFloat(atbSrc.style.width) || 0) / 100) + ')';
      atbDst.classList.toggle('ready', atbSrc.classList.contains('ready'));
    }
  });
}

// ═══════════════════════════════════════════════════════════
//  VFX ENHANCEMENT — dedicated bursts for stagger/enrage/combo
//  Added as plain method assignments on the existing VFX object
//  (never reconstructed) so its live canvas/particle state is
//  untouched.
// ═══════════════════════════════════════════════════════════
VFX.burstStagger = function(target) {
  const { x, y } = this._getCardCenter(target);
  // Twin expanding shockwave rings
  this._emit(x, y, 1, {
    angleMin: 0, angleMax: 0, speedMin: 0, speedMax: 0,
    colors: ['#ffcf7a'], sizeMin: 1, sizeMax: 1,
    gravity: 0, drag: 1, decay: 0.022, fadeStart: 0.9, shape: 'ring'
  });
  this._emit(x, y, 1, {
    angleMin: 0, angleMax: 0, speedMin: 0, speedMax: 0,
    colors: ['#ff6a3d'], sizeMin: 1.7, sizeMax: 1.7,
    gravity: 0, drag: 1, decay: 0.014, fadeStart: 0.9, shape: 'ring'
  });
  // Radiating shards
  this._emit(x, y, 16, {
    angleMin: 0, angleMax: Math.PI * 2,
    speedMin: 2.5, speedMax: 6.2,
    colors: ['#ffcf7a', '#ff8a3d', '#ffe6b0'],
    sizeMin: 1.2, sizeMax: 2.6,
    gravity: 0.05, drag: 0.90,
    decay: 0.02, fadeStart: 0.5, shape: 'slash'
  });
  this.hitFlash(target, 'crit');
  this.shake(0.65);
  this.screenFlash('rgba(255,150,50,0.10)', 260);
};

VFX.burstEnrage = function(target) {
  const { x, y } = this._getCardCenter(target);
  this._emit(x, y, 18, {
    angleMin: -Math.PI * 0.85, angleMax: -Math.PI * 0.15,
    speedMin: 1.0, speedMax: 3.6,
    colors: ['#ff3020', '#ff6a30', '#ffb050'],
    sizeMin: 1.4, sizeMax: 3.0,
    gravity: -0.10, drag: 0.94,
    decay: 0.014, fadeStart: 0.55, shape: 'dot'
  });
  this._emit(x, y, 1, {
    angleMin: 0, angleMax: 0, speedMin: 0, speedMax: 0,
    colors: ['#ff3020'], sizeMin: 1.8, sizeMax: 1.8,
    gravity: 0, drag: 1, decay: 0.012, fadeStart: 0.9, shape: 'ring'
  });
  this.hitFlash(target, 'magic');
  this.shake(0.45);
  this.screenFlash('rgba(220,40,20,0.12)', 320);
};

VFX.burstComboSpark = function(target, comboCount) {
  const { x, y } = this._getCardCenter(target);
  const n = Math.min(12, 3 + comboCount);
  this._emit(x, y, n, {
    angleMin: -Math.PI, angleMax: Math.PI,
    speedMin: 1.2, speedMax: 2.8 + Math.min(2.2, comboCount * 0.2),
    colors: ['#ffb84d', '#ffd98a', '#ff8a3d'],
    sizeMin: 1.0, sizeMax: 2.0,
    gravity: 0.06, drag: 0.92,
    decay: 0.022, fadeStart: 0.5, shape: 'dot'
  });
};

// ═══════════════════════════════════════════════════════════
//  PARTY HUD ENHANCEMENT — diamond mosaic layout
//  Rearranges party portraits into the rotated-diamond mosaic
//  (top slot always shows whoever is acting), with the detailed
//  HP/MP/AP stat bars mirrored into a compact strip underneath.
//  Wraps render()/renderATBOnly() rather than replacing their
//  actual stat computation, so nothing else in the engine needed
//  to change.
// ═══════════════════════════════════════════════════════════
function _orig_render() {
  state.party.forEach(m => {
    const p = el(`panel-${m.id}`);
    if (!p) return;
    const hpPct = Math.max(0, m.hp / m.maxHp * 100);
    const mpPct = Math.max(0, m.mp / m.maxMp * 100);
    p.querySelector('.hp-val').textContent = `${m.hp}/${m.maxHp}`;
    p.querySelector('.mp-val').textContent = `${m.mp}/${m.maxMp}`;
    const hpFill = p.querySelector('.hp-fill');
    hpFill.style.width = hpPct + '%';
    let r, g, b;
    if (hpPct >= 50) {
      const t = (hpPct - 50) / 50;
      r = Math.round(58  + (200 - 58)  * (1 - t));
      g = Math.round(184 + (160 - 184) * (1 - t));
      b = Math.round(112 + (48  - 112) * (1 - t));
    } else {
      const t = hpPct / 50;
      r = Math.round(200);
      g = Math.round(160 * t + 48 * (1 - t));
      b = Math.round(48);
    }
    hpFill.style.background = `rgb(${r},${g},${b})`;
    hpFill.className = 'hp-fill stat-fill' + (hpPct < 25 ? ' critical' : '');
    p.querySelector('.mp-fill').style.width = mpPct + '%';
    p.classList.toggle('dead', m.dead);
    p.classList.toggle('active', m === state.activeChar && !m.dead);
    const si = p.querySelector('.status-icons');
    const icons = { def_up:'■', atk_up:'▲', crit_next:'◎', atb_slow:'▽', spd_up:'▶' };
    si.innerHTML = m.buffs.map(b => `<span class="status-icon" title="${b.effect}">${icons[b.effect]||'?'}</span>`).join('');
    if (m.dodging) si.innerHTML += `<span class="status-icon" title="Evading" style="color:var(--dodge-col)">◌</span>`;
  });

  state.enemies.forEach(e => {
    const card = el(`enemy-card-${e.id}`);
    if (!card) return;
    const pct = e.isTrainingDummy ? 100 : Math.max(0, e.hp / e.maxHp * 100);
    const fill = card.querySelector('.enemy-hp-fill');
    fill.style.width = pct + '%';
    fill.style.background = pct < 25 ? 'var(--hp-lo)' : pct < 50 ? 'var(--hp-mid)' : 'var(--hp-hi)';
    card.querySelector('.enemy-hp-text').textContent = e.isTrainingDummy ? '∞  (Immune)' : `${e.hp} / ${e.maxHp}`;
    card.classList.toggle('dead', e.dead);
  });
}

function _orig_renderATBOnly2() {
  state.party.forEach(m => {
    const p = el(`panel-${m.id}`);
    if (!p) return;
    const fill = p.querySelector('.atb-fill');
    if (fill) {
      fill.style.width = Math.min(100, m.atb) + '%';
      fill.classList.toggle('ready', m.atb >= 100);
    }
  });
  state.enemies.forEach(e => {
    const card = el(`enemy-card-${e.id}`);
    if (!card || e.dead) return;
    const fill = card.querySelector('.enemy-atb-fill');
    if (fill) {
      fill.style.transform = 'scaleX(' + (Math.min(100, e.atb) / 100) + ')';
      fill.classList.toggle('ready', e.atb >= 100);
      fill.classList.toggle('striking', e.atb >= 80 && e.atb < 100);
      // Note: pendingSkill itself is now rolled early in gameLoop() at the
      // 80% AP mark, not here — this just renders whatever state it's in.
    }
    // Update intent label
    const intent = card.querySelector('.enemy-intent');
    if (intent) {
      if (e.atb <= 0) {
        intent.textContent = '';
        intent.className = 'enemy-intent';
      } else if (e.atb >= 80 && e.pendingSkill) {
        // Telegraph window — name the actual move so players can react,
        // not just "something is coming". AoE moves get a louder,
        // distinct warning style since they punish the whole party.
        const evaPct = enemyEvaPercent(e);
        const isAoe = e.pendingSkill.target === 'all_party' || e.pendingSkill.target === 'all';
        const ready = e.atb >= 100;
        const arrow = ready ? '▶' : '◇';
        if (isAoe) {
          intent.innerHTML = `${arrow} [!] ${e.pendingSkill.name.toUpperCase()} <span class="intent-eva intent-eva-red">| ALL</span>`;
          intent.className = 'enemy-intent intent-aoe-warn';
        } else {
          intent.innerHTML = `${arrow} ${e.pendingSkill.name.toUpperCase()} <span class="intent-eva${ready ? ' intent-eva-red' : ''}">| EVA%: ${evaPct}</span>`;
          intent.className = `enemy-intent${ready ? ' intent-striking' : ' intent-windup'}`;
        }
      } else if (e.atb > 0) {
        const evaPct = enemyEvaPercent(e);
        intent.innerHTML = `ACTIVE <span class="intent-eva">| EVA%: ${evaPct}</span>`;
        intent.className = 'enemy-intent intent-active';
      }
    }

    // One-time AoE screen warning the instant the telegraph appears —
    // separate from the per-frame label update above, so it only fires
    // once per windup rather than every frame.
    const isAoeIncoming = !!(e.pendingSkill && (e.pendingSkill.target === 'all_party' || e.pendingSkill.target === 'all'));
    card.classList.toggle('aoe-incoming', isAoeIncoming);
    if (isAoeIncoming && !e._aoeWarned) {
      e._aoeWarned = true;
      VFX.screenFlash('rgba(220,40,30,0.10)', 260);
    }
    if (!e.pendingSkill && e._aoeWarned) {
      e._aoeWarned = false;
    }
  });
}

let _lastDiamondActiveId = undefined;

function positionDiamondFormation(force) {
  const activeId = (state.activeChar && !state.activeChar.dead) ? state.activeChar.id : null;
  if (!force && activeId === _lastDiamondActiveId) return;
  _lastDiamondActiveId = activeId;

  const activeMember = activeId ? state.party.find(p => p.id === activeId) : null;
  const rest = state.party.filter(p => p !== activeMember);
  const order = activeMember ? [activeMember, ...rest] : [...rest];

  const slotNames = ['slot-top', 'slot-left', 'slot-bottom', 'slot-right'];
  order.forEach((m, i) => {
    const d = el(`panel-${m.id}`);
    if (!d) return;
    d.classList.remove('slot-top', 'slot-left', 'slot-right', 'slot-bottom', 'slot-hidden');
    d.classList.add(i < slotNames.length ? slotNames[i] : 'slot-hidden');
  });
}

function mirrorStatChip(m) {
  const chip = el(`statchip-${m.id}`);
  const legacy = el(`panel-${m.id}`);
  if (!chip || !legacy) return;

  const hpFillSrc = legacy.querySelector('.legacy-stats .hp-fill');
  const hpFillDst = chip.querySelector('.hp-fill');
  if (hpFillSrc && hpFillDst) {
    hpFillDst.style.width = hpFillSrc.style.width;
    hpFillDst.style.background = hpFillSrc.style.background;
    hpFillDst.className = hpFillSrc.className;
  }
  const mpFillSrc = legacy.querySelector('.legacy-stats .mp-fill');
  const mpFillDst = chip.querySelector('.mp-fill');
  if (mpFillSrc && mpFillDst) mpFillDst.style.width = mpFillSrc.style.width;

  const hpValSrc = legacy.querySelector('.legacy-stats .hp-val');
  const hpValDst = chip.querySelector('.hp-val');
  if (hpValSrc && hpValDst) hpValDst.textContent = hpValSrc.textContent;

  const mpValSrc = legacy.querySelector('.legacy-stats .mp-val');
  const mpValDst = chip.querySelector('.mp-val');
  if (mpValSrc && mpValDst) mpValDst.textContent = mpValSrc.textContent;

  const siSrc = legacy.querySelector('.legacy-stats .status-icons');
  const siDst = chip.querySelector('.status-icons');
  if (siSrc && siDst) siDst.innerHTML = siSrc.innerHTML;

  chip.classList.toggle('dead', !!m.dead);
  chip.classList.toggle('is-turn', m === state.activeChar && !m.dead);
}

function render() {
  _orig_render();
  positionDiamondFormation();
  state.party.forEach(mirrorStatChip);
}

/* ═════════════════════════════════════════════════════════════════════
   ENCOUNTER START / END
   ═════════════════════════════════════════════════════════════════════ */

async function startBattle() {
  if (state.loopHandle) cancelAnimationFrame(state.loopHandle);
  state = {
    phase: 'IDLE',
    party: initParty(),
    enemies: initEnemies(),
    activeChar: null, selectedAction: null,
    readyQueue: [], turn: 0, animating: false,
    loopHandle: null
  };

  el('result-screen').classList.add('hidden');
  el('battle-screen').classList.remove('hidden');
  // Fade out exit transition overlay if it was showing
  const exitOverlay = el('exit-transition');
  if (exitOverlay) { exitOverlay.classList.remove('active'); }
  el('action-panel').classList.add('hidden');
  el('battle-log').innerHTML = '';
  DEV.reset();

  updateTurnNum();
  buildPartyPanels();
  buildEnemyCards();
  BATTLE_BG.init();
  VFX._resize();
  render();

  AUDIO.startBGM();
  await playBattleTransition(BATTLE.name, BATTLE.subtitle);

  addLog(BATTLE.subtitle, 'sub');
  addLog(BATTLE.introLog || 'Encountered ANIMA ARMY troops.', 'system');
  Gimmick.emit('battleStart');

  scheduleLoop();
}

function endBattle(won, fled = false) {
  if (state.loopHandle) cancelAnimationFrame(state.loopHandle);
  state.phase = won ? 'WIN' : 'LOSE';
  AUDIO.stopBGM();
  if (won) {
    AUDIO.sfxVictory();
    setTimeout(() => {
      const respite = new Audio(BATTLE.victoryMusic || 'FC-OST/interlude, the breathing life.mp3');
      respite.volume = fcLoadSettings().musicVol / 100 * 0.85;
      respite.play().catch(() => {});
    }, 900);
  }

  setTimeout(() => {
  if (won) {
        el('battle-screen').classList.add('hidden');
        el('result-screen').classList.remove('hidden');

        el('result-win-layout').classList.remove('hidden');
        el('result-lose-layout').classList.add('hidden');
        el('result-corner-r').classList.remove('hidden');
        el('result-corner-l').classList.remove('hidden');

        spawnResultParticles();

        const titleEl = el('result-title');
        const body    = el('result-body');
        const btn     = el('result-btn');

        titleEl.textContent = BATTLE.resultTitle || 'Encounter Finished';
        const partyRows = state.party.map(p => {
          const hpClass = p.dead ? 'result-member-hp down' : 'result-member-hp';
          const hpText  = p.dead ? '— down —' : `${p.hp} / ${p.maxHp} HP`;
          return `<div class="result-member" style="color:${p.color}">
            <span>${p.name}</span>
            <span class="${hpClass}">${hpText}</span>
          </div>`;
        }).join('');

        body.innerHTML = `
          <p class="result-sub">${BATTLE.victoryText || 'An obstacle in your journey has been put aside, you may now Proceed forward.'}</p>
          <div class="result-party-status">
            <div class="result-party-header">PARTY STATUS</div>
            ${partyRows}
          </div>`;

        btn.textContent = '→ Keep Moving';
        btn.onclick = () => { exitTo('PROCEEDING', () => { window.location.href = BATTLE.nextPage || 'c3s5.html'; }); };
    } else {
      el('battle-screen').classList.add('hidden');
      el('result-screen').classList.remove('hidden');

      el('result-win-layout').classList.add('hidden');
      el('result-lose-layout').classList.remove('hidden');
      el('result-corner-r').classList.add('hidden');
      el('result-corner-l').classList.add('hidden');

      const titleEl = el('result-title-lose');
      const body    = el('result-body-lose');
      const btn     = el('result-btn-lose');

      titleEl.textContent = fled ? 'WITHDRAWAL' : 'DISARMED';
      body.innerHTML = `<p class="result-sub" style="margin-bottom:0">The crew falls. It is in your hands for them to stand back up.</p>`;
      btn.textContent = 'Try Again';
      btn.onclick = () => { exitTo('REENGAGING', () => { startBattle(); el('exit-transition').classList.remove('active'); }); };
    }
  }, 700);
}

/* ═════════════════════════════════════════════════════════════════════
   PAGE INIT
   ═════════════════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(dropPreBlack, 12000);  // safety net
  AUDIO.init();
  VFX.init();


  // Dev menu key listener
  document.addEventListener('keydown', e => DEV.onKey(e));

  // Dev menu buttons
  el('dev-btn-win').addEventListener('click', () => {
    DEV.close();
    state.enemies.forEach(e => { e.hp = 0; e.dead = true; e.atb = 0; });
    state.readyQueue = state.readyQueue.filter(c => c.isParty);
    if (state.loopHandle) cancelAnimationFrame(state.loopHandle);
    render();
    endBattle(true);
  });
  el('dev-btn-lose').addEventListener('click', () => {
    DEV.close();
    endBattle(false, true);
  });
  el('dev-btn-overdrive').addEventListener('click', () => {
    DEV.close();
    // Set every living party member's HP to just below the overdrive threshold
    state.party.filter(p => !p.dead).forEach(p => {
      const targetHp = Math.floor(p.maxHp * OVERDRIVE_THRESHOLD) - 1;
      p.hp = Math.max(1, targetHp);
    });
    addLog('[!] DEV — All members at critical HP. Overdrives available.', 'overdrive');
    render();
    // If the action panel is open, refresh it so the button swaps immediately
    if (state.activeChar && state.phase === 'PLAYER_ACTION') {
      openActionPanel(state.activeChar);
    }
  });
  el('dev-btn-close').addEventListener('click', () => DEV.close());

  // ── DEV: Force Next Enemy Move ──────────────────────────────
  const devEnemySel = el('dev-force-enemy');
  const devSkillSel = el('dev-force-skill');
  const devForceBtn = el('dev-btn-force-move');
  const devForceStatus = el('dev-force-status');

  // Populate enemy dropdown whenever the dev menu is opened
  const origDevOpen = DEV.open.bind(DEV);
  DEV.open = function() {
    origDevOpen();
    devEnemySel.innerHTML = '<option value="">\u2014 select \u2014</option>';
    devSkillSel.innerHTML = '<option value="">\u2014 pick enemy first \u2014</option>';
    devSkillSel.disabled = true;
    devForceBtn.disabled = true;
    devForceStatus.textContent = '';

    const alive = (state.enemies || []).filter(e => !e.dead && e.skills && e.skills.length);
    if (!alive.length) {
      devEnemySel.innerHTML = '<option value="">no living enemies</option>';
      return;
    }
    alive.forEach(e => {
      const opt = document.createElement('option');
      opt.value = e.id;
      opt.textContent = e.name + ' (' + e.id + ')';
      devEnemySel.appendChild(opt);
    });
  };

  devEnemySel.addEventListener('change', () => {
    const eid = devEnemySel.value;
    devSkillSel.innerHTML = '';
    devSkillSel.disabled = true;
    devForceBtn.disabled = true;
    devForceStatus.textContent = '';

    if (!eid) {
      devSkillSel.innerHTML = '<option value="">\u2014 pick enemy first \u2014</option>';
      return;
    }
    const enemy = (state.enemies || []).find(e => e.id === eid);
    if (!enemy || !enemy.skills || !enemy.skills.length) {
      devSkillSel.innerHTML = '<option value="">no skills</option>';
      return;
    }
    enemy.skills.forEach((sk, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = sk.name + ' [' + sk.type + (sk.target ? ' \u2192 ' + sk.target : '') + ']';
      devSkillSel.appendChild(opt);
    });
    devSkillSel.disabled = false;
    devForceBtn.disabled = false;
  });

  devForceBtn.addEventListener('click', () => {
    const eid = devEnemySel.value;
    const skillIdx = devSkillSel.value;
    if (!eid || skillIdx === '') {
      devForceStatus.textContent = '\u26a0 Select an enemy and a move first.';
      return;
    }
    const enemy = (state.enemies || []).find(e => e.id === eid);
    if (!enemy || enemy.dead) {
      devForceStatus.textContent = '\u26a0 Enemy is dead or not found.';
      return;
    }
    enemy._forcedSkillIndex = parseInt(skillIdx, 10);
    const sk = enemy.skills[enemy._forcedSkillIndex];
    devForceStatus.textContent = '\u27f3 Queued: "' + (sk ? sk.name : '??') + '" for ' + enemy.name;
    devForceBtn.style.borderColor = '#3ab870';
    devForceBtn.style.color = '#3ab870';
    setTimeout(() => {
      devForceBtn.style.borderColor = '#4878d4';
      devForceBtn.style.color = '#4878d4';
    }, 1200);
  });
  el('btn-attack').addEventListener('click', onAttack);
  el('btn-skills').addEventListener('click', onSkills);
  el('btn-dodge' ).addEventListener('click', onDodge);
  el('btn-items' ).addEventListener('click', onItems);

  const startAudio = () => {
    if (AUDIO.bgm && AUDIO.bgm.paused && !AUDIO.muted && !AUDIO._stopped) {
      AUDIO.bgm.play().catch(() => {});
    }
  };
  document.addEventListener('click', startAudio, { once: true });
  document.addEventListener('keydown', startAudio, { once: true });

  startBattle();
});

document.addEventListener('DOMContentLoaded', () => {
  if (BATTLE.gimmick && !window.GIMMICKS[BATTLE.gimmick])
    console.error('[encounter] gimmick "' + BATTLE.gimmick + '" is set in the HTML but js/gimmicks/' + BATTLE.gimmick + '.js was not loaded');
  const missing = (BATTLE.enemies || []).filter(k => !ENEMY_TEMPLATES[k]);
  if (missing.length) console.error('[encounter] enemies not found in ENEMY_TEMPLATES:', missing.join(', '));
});