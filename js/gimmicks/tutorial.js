/* ═════════════════════════════════════════════════════════════════════
   gimmicks/tutorial.js — Tutorial / practice encounter
   ─────────────────────────────────────────────────────────────────────
   Load AFTER js/battle-engine.js and set  gimmick: 'tutorial'  in the HTML.
   Everything specific to the training battle lives here: the step-by-step
   tutorial script (TUT), its overlay markup, and the three engine hooks it
   listens to. The battle itself runs on the normal engine.
   (Needs css/gimmicks/tutorial.css and the 'training_dummy' / 'rusted_sentinel'
   entries of ENEMY_TEMPLATES.)
   ═════════════════════════════════════════════════════════════════════ */
window.GIMMICKS.tutorial = true;

/* ═════════════════════════════════════════════════════════════════════
   OVERLAY MARKUP
   ═════════════════════════════════════════════════════════════════════ */
el('screen-flash').insertAdjacentHTML('beforebegin', `
<!-- ───────── TUTORIAL OVERLAY ───────── -->
<div id="tutorial-overlay" class="hidden">
  <div id="tutorial-box">
    <div class="tut-label">⬡ TRAINING PROTOCOL</div>
    <div class="tut-step-count" id="tut-step-count"></div>
    <div class="tut-text" id="tut-text"></div>
    <div class="tut-highlight hidden" id="tut-highlight"></div>
    <div style="overflow:hidden"><button id="tut-btn">Understood →</button></div>
    <div style="clear:both"></div>
  </div>
</div>

<!-- ───────── TUTORIAL PHASE BANNER ───────── -->
<div id="tut-phase-banner"></div>

<!-- ───────── BOSS INTRO CINEMATIC ───────── -->
<div id="tut-boss-intro">
  <div class="bi-label">TUTORIAL BOSS</div>
  <div class="bi-title">RUSTED SENTINEL</div>
  <div class="bi-rule"></div>
  <div class="bi-sub">The training ends here. Prove what you have learned.</div>
</div>
`);

/* ═════════════════════════════════════════════════════════════════════
   TUTORIAL SCRIPT
   ═════════════════════════════════════════════════════════════════════ */
// ═══════════════════════════════════════════════════════════
//  TUTORIAL SYSTEM
// ═══════════════════════════════════════════════════════════
const TUT = {
  active: false,
  step: 0,
  waitingForAction: null,  // 'attack' | 'skill' | 'item' | 'dodge' | 'boss'
  bossPhaseStarted: false,
  _resolve: null,

  steps: [
    {
      text: `Welcome to the <strong>Training Protocol</strong>. This is a safe environment to learn the battle system before your first real encounter.<br><br>Your party uses an <strong>Active Time Battle (ATB)</strong> system — each character has an AP gauge that fills automatically. When it reaches 100%, it's their turn to act.`,
      highlight: `Watch the AP bars at the bottom of each character panel fill up. The fastest member acts first.`,
      btnLabel: 'Got it →'
    },
    {
      text: `When a party member's AP fills, their <strong>action panel</strong> appears on the right. You have four options:<br><br><strong>▲ Attack</strong> — a basic physical strike<br><strong>◆ Skills</strong> — special abilities that cost MP<br><strong>◌ Evade</strong> — brace the whole party to dodge<br><strong>▣ Items</strong> — consumables for healing and buffs`,
      highlight: `Wait for a character's AP gauge to fill, then the action panel will appear automatically.`,
      btnLabel: 'Ready →'
    },
    {
      text: `Try using <strong>▲ Attack</strong> on the Training Dummy. Select Attack, then click the dummy to confirm the target.<br><br>Don't worry — the Dummy is built to absorb everything. It will not fall.`,
      highlight: null,
      btnLabel: null,
      waitFor: 'attack'
    },
    {
      text: `Good hit. Now try using a <strong>Skill</strong>. Open the Skills menu and pick any skill for the active character. Skills cost MP but deal significantly more damage or apply powerful effects.`,
      highlight: `Keep an eye on MP — if it runs low, use an Ether item to restore it.`,
      btnLabel: null,
      waitFor: 'skill'
    },
    {
      text: `Now try <strong>◌ Evade</strong>. This braces the entire party, giving them a high chance to dodge the next incoming attack. Use it when you see an enemy's intent bar turn red — that means a strike is imminent.`,
      highlight: `Watch the enemy's small intent label. When it shows "▶ STRIKE", Evade is your best response.`,
      btnLabel: null,
      waitFor: 'dodge'
    },
    {
      text: `Excellent. Now open <strong>▣ Items</strong> and use any item on a party member — a Healing Ether will do. Items require you to select a target from your own party.`,
      highlight: `Items don't end your turn in the usual sense — they consume your AP action slot just like attacks do.`,
      btnLabel: null,
      waitFor: 'item'
    },
    {
      text: `One final thing: <strong>Overdrive</strong>. When any party member's HP drops below <strong>30%</strong>, their Attack button transforms into a powerful Overdrive ability — unique to each character.<br><br>Overdrives can only be used once per battle, so time them wisely.`,
      highlight: `Each character's Overdrive is different: Kaden's Requiem chains four escalating strikes. Ava's Black Thread Severance is a single devastating blow. Kurt's Bastion Guard permanently reduces all incoming damage.`,
      btnLabel: 'Understood →'
    },
    {
      text: `Training complete. You have mastered the fundamentals. You are ready for what lies ahead.`,
      highlight: null,
      btnLabel: 'Finish Training →'
    }
  ],

  // Map from waitFor value → which button ids are ALLOWED
  _allowedButtons: {
    'attack': ['btn-attack'],
    'skill':  ['btn-skills'],
    'dodge':  ['btn-dodge'],
    'item':   ['btn-items'],
    'boss':   [],
  },

  refreshButtonLocks() {
    const allBtns = ['btn-attack', 'btn-skills', 'btn-dodge', 'btn-items'];
    allBtns.forEach(id => {
      const btn = document.getElementById(id);
      if (!btn) return;
      if (!this.active || !this.waitingForAction) {
        btn.classList.remove('tut-locked');
      } else {
        const allowed = this._allowedButtons[this.waitingForAction] || [];
        if (allowed.includes(id)) {
          btn.classList.remove('tut-locked');
        } else {
          btn.classList.add('tut-locked');
        }
      }
    });
  },

  start() {
    if (!BATTLE.isTutorial) return;
    this.active = true;
    this.step = 0;
    this.bossPhaseStarted = false;
    this.showStep(0);
  },

  showStep(idx) {
    const data = this.steps[idx];
    if (!data) return;
    this.step = idx;
    this.waitingForAction = data.waitFor || null;

    const overlay = el('tutorial-overlay');
    const box     = el('tutorial-box');
    const textEl  = el('tut-text');
    const hlEl    = el('tut-highlight');
    const btn     = el('tut-btn');
    const count   = el('tut-step-count');

    overlay.classList.remove('hidden');
    box.classList.remove('tut-exit');

    textEl.innerHTML = data.text;
    count.textContent = `${idx + 1} / ${this.steps.length}`;

    if (data.highlight) {
      hlEl.textContent = data.highlight;
      hlEl.classList.remove('hidden');
    } else {
      hlEl.classList.add('hidden');
    }

    if (data.btnLabel) {
      btn.textContent = data.btnLabel;
      btn.classList.remove('hidden');
      btn.onclick = () => this.advance();
    } else {
      btn.classList.add('hidden');
    }

    this.refreshButtonLocks();
  },

  onActionPerformed(type) {
    if (!this.active) return;
    if (!this.waitingForAction) return;
    if (type === this.waitingForAction) {
      this.waitingForAction = null;
      // Show next step after a short delay so the action can resolve first
      setTimeout(() => this.advance(), 600);
    }
  },

  advance() {
    const next = this.step + 1;
    if (next >= this.steps.length) {
      this.dismiss();
      return;
    }
    const box = el('tutorial-box');
    box.classList.add('tut-exit');
    setTimeout(() => {
      box.classList.remove('tut-exit');
      if (this.steps[next].waitFor === 'boss') {
        this.showStep(next);
      } else {
        this.showStep(next);
      }
    }, 300);
  },

  dismiss() {
    const box = el('tutorial-box');
    box.classList.add('tut-exit');
    setTimeout(() => {
      el('tutorial-overlay').classList.add('hidden');
      if (!this.bossPhaseStarted) {
        this.bossPhaseStarted = true;
        this.active = false;
        this.refreshButtonLocks();
        if (state.loopHandle) cancelAnimationFrame(state.loopHandle);
        endBattle(true);
      }
    }, 350);
  },

  async startBossPhase() {
    // Pause the game loop
    if (state.loopHandle) cancelAnimationFrame(state.loopHandle);
    state.phase = 'RESOLVING';
    state.animating = true;
    closeActionPanel();

    addLog(`The Training Dummy shudders — and goes dark.`, 'system');
    await wait(600);
    addLog(`Something older and more dangerous emerges in its place.`, 'system');
    await wait(700);

    // Boss intro cinematic
    const intro = el('tut-boss-intro');
    intro.classList.add('visible');
    await wait(2800);
    intro.style.transition = 'opacity 0.8s';
    intro.style.opacity = '0';
    await wait(800);
    intro.classList.remove('visible');
    intro.style.opacity = '';

    // Swap enemy: remove training dummy, add Rusted Sentinel
    const dummyIdx = state.enemies.findIndex(e => e.isTrainingDummy);
    if (dummyIdx !== -1) {
      const oldEnemy = state.enemies[dummyIdx];
      // Remove its card with a fade
      const oldCard = el(`enemy-card-${oldEnemy.id}`);
      if (oldCard) {
        oldCard.style.transition = 'opacity 0.5s, transform 0.5s';
        oldCard.style.opacity = '0';
        oldCard.style.transform = 'scale(0.85)';
        await wait(500);
        oldCard.remove();
      }
      // Kill the dummy in state
      oldEnemy.dead = true;
      oldEnemy.atb = 0;
      state.readyQueue = state.readyQueue.filter(c => c.id !== oldEnemy.id);

      // Add Rusted Sentinel
      const t = ENEMY_TEMPLATES.rusted_sentinel;
      const sentinel = {
        ...t, id: `e_sentinel`, hp: t.maxHp, _templateKey: 'rusted_sentinel',
        atb: 0,
        buffs: [], dead: false, isParty: false,
        atbMult: 1.0, defMult: 1.0, atkMult: 1.0,
        dodging: false
      };
      state.enemies.push(sentinel);

      // Build its card
      const cont = el('enemy-container');
      const card = document.createElement('div');
      card.className = `enemy-card boss`;
      card.id = `enemy-card-${sentinel.id}`;
      card.style.setProperty('--enemy-color', sentinel.color);
      card.style.position = 'relative';
      card.style.opacity = '0';
      card.style.transform = 'scale(0.85)';
      card.innerHTML = `
        <div class="enemy-symbol-wrap"><div class="enemy-symbol">${sentinel.symbol}</div></div>
        <div class="enemy-name">${sentinel.name}</div>
        <div class="enemy-subtitle">${sentinel.subtitle}</div>
        <div class="enemy-hp-bar"><div class="enemy-hp-fill" style="width:100%"></div></div>
        <div class="enemy-hp-text">${sentinel.hp} / ${sentinel.maxHp}</div>
        <div class="enemy-atb-bar"><div class="enemy-atb-fill" style="width:0%"></div></div>
        <div class="enemy-intent"></div>`;
      card.addEventListener('click', () => DEV.onEnemyClick(sentinel.id));
      cont.appendChild(card);

      // Animate card in
      await wait(80);
      card.style.transition = 'opacity 0.6s, transform 0.6s';
      card.style.opacity = '1';
      card.style.transform = 'scale(1)';

      VFX.screenFlash('rgba(200,50,20,0.12)', 600);
      AUDIO.sfxDefeat(); // repurpose as dramatic sting
      addLog(`⬟ RUSTED SENTINEL has emerged — the real test begins`, 'header');
      addLog(`Defeat it using everything you have learned.`, 'sub');
      await wait(700);
    }

    // Show phase banner
    const banner = el('tut-phase-banner');
    banner.textContent = '⬟  TUTORIAL BOSS  —  RUSTED SENTINEL';
    banner.classList.add('visible');
    setTimeout(() => banner.classList.remove('visible'), 4000);

    // Resume the game
    state.animating = false;
    state.phase = 'IDLE';
    this.refreshButtonLocks(); // fully unlocked for boss fight
    render();
    scheduleLoop();
  }
};

/* ═════════════════════════════════════════════════════════════════════
   ENGINE HOOKS
   ═════════════════════════════════════════════════════════════════════ */
// intro: the engine has just logged the intro line — start the tutorial
Gimmick.on('battleStart', () => { if (BATTLE.isTutorial) TUT.start(); });

// the player did attack / skill / item / dodge
Gimmick.on('actionPerformed', kind => TUT.onActionPerformed(kind));

// command panel was rebuilt — re-apply the tutorial's button locks
Gimmick.on('actionPanelOpened', () => TUT.refreshButtonLocks());
