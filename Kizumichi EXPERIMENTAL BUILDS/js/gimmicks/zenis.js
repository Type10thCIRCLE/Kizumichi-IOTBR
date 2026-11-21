/* ═════════════════════════════════════════════════════════════════════
   gimmicks/zenis.js — Zenis Anima vs Kaden (solo duel)
   ─────────────────────────────────────────────────────────────────────
   Load AFTER js/battle-engine.js and set  gimmick: 'zenis',
   enemies: ['zenis_duel'], party: 'kaden_solo'  in the HTML.
   The enemy (zenis_duel) and the solo loadout (kaden_solo) live in
   js/battle-engine.js like every other enemy / party preset; this file
   only holds the mechanics.

   Everything here is built from Zenis's debut in Chapter IV:

     Assessment        "the brief sweep of someone cataloguing variables"
     Inside the Arc    he steps forward, inside the arc of Kaden's draw
     The Correction    point-blank Ether burst — "not a strike, a correction"
     Suppression Field the field he built for Iris in Rervite
     Tidal Presence    "the way the ocean is present when you’re standing at the edge"
     Still Here        the one uncontrolled moment (Kaden asks about his brother)
     Gathering Depth → Twenty-Four Years
                       "a sliver of what it held" — the telegraphed heavy hit

   Two canon rules are built in (fields on the zenis_duel entry):
     • retreatAt  Zenis only ever used about a third of his capacity and
                  walked away. Default: he withdraws at 35% HP and that
                  counts as the win. Set 0 to fight him to the death.
     • mercy      "He didn’t drive it deep." The first blow that would kill
                  Kaden is pulled at the last instant, leaving him on 1 HP.

   Needs no extra CSS file — styles are injected below.
   ═════════════════════════════════════════════════════════════════════ */
window.GIMMICKS.zenis = true;

(function () {
  'use strict';

  // retreatAt / mercy live on the enemy entry (zenis_duel in ENEMY_TEMPLATES)
  const ZEN_CFG = {
    get retreatAt() { const z = zen(); return z && z.retreatAt !== undefined ? z.retreatAt : 0.35; },
    get mercy()     { const z = zen(); return !z || z.mercy !== false; }
  };

  const PATTERNS = {
    1: ['Assessment', 'The Correction', 'Inside the Arc', 'Tidal Presence', 'Suppression Field', 'The Correction'],
    2: ['The Correction', 'Inside the Arc', 'Suppression Field', 'Tidal Presence', 'Assessment', 'The Correction', 'Inside the Arc'],
    3: ['Gathering Depth', 'Twenty-Four Years', 'Inside the Arc', 'The Correction', 'Suppression Field', 'Tidal Presence', 'Assessment']
  };
  const CAPACITY = { 1: 0.33, 2: 0.38, 3: 0.44 };

  /* ═══════════════════════════════════════════════════════════════════
     3. HUD + STYLES + DIALOGUE CAPTION
     ═══════════════════════════════════════════════════════════════════ */
  const style = document.createElement('style');
  style.textContent = `
  #zen-hud{position:fixed;top:3.3rem;left:50%;transform:translateX(-50%);z-index:40;pointer-events:none;
    display:none;flex-direction:column;align-items:center;gap:.35rem;font-family:'Space Grotesk','DM Sans',sans-serif;
    color:#c9d0e8;letter-spacing:.14em;font-size:.62rem;text-transform:uppercase}
  #zen-hud.on{display:flex}
  #zen-hud .zh-row{display:flex;align-items:center;gap:.6rem}
  #zen-hud .zh-k{color:#7d86a8}
  #zen-hud .zh-bar{width:150px;height:4px;background:rgba(174,184,216,.16);border:1px solid rgba(174,184,216,.25)}
  #zen-hud .zh-bar i{display:block;height:100%;width:33%;background:linear-gradient(90deg,#6b78b8,#c9d4ff);transition:width .8s}
  #zen-hud .zh-read{letter-spacing:.3em;color:#aeb8d8}
  #zen-hud .zh-stance{padding:.2rem .7rem;border:1px solid #aeb8d8;background:rgba(14,17,28,.78);color:#e6ebff;
    animation:zhPulse 1.1s ease-in-out infinite}
  #zen-hud .zh-stance.off{display:none}
  #zen-hud .zh-charge{color:#ffcf8a}
  #zen-hud .zh-charge.off{display:none}
  @keyframes zhPulse{50%{box-shadow:0 0 14px rgba(174,184,216,.55)}}
  .enemy-card.zen-arc{box-shadow:0 0 0 1px #aeb8d8,0 0 26px rgba(174,184,216,.5)!important}
  .enemy-card.zen-charge{box-shadow:0 0 0 1px #ffcf8a,0 0 34px rgba(255,190,110,.45)!important}
  #zen-speech{position:fixed;left:50%;top:38%;transform:translate(-50%,-50%);z-index:60;pointer-events:none;
    text-align:center;opacity:0;transition:opacity .6s;max-width:min(640px,86vw)}
  #zen-speech.on{opacity:1}
  #zen-speech .zs-who{font:600 .6rem 'Space Grotesk',sans-serif;letter-spacing:.34em;color:#8f99c0;margin-bottom:.5rem}
  #zen-speech .zs-text{font:italic 300 1.35rem/1.5 'DM Sans',serif;color:#eef1ff;text-shadow:0 2px 18px #000,0 0 30px #000}
  #zen-speech.kaden .zs-who{color:#6f95e8}`;
  document.head.appendChild(style);

  document.body.insertAdjacentHTML('beforeend', `
  <div id="zen-hud">
    <div class="zh-row"><span class="zh-k">Capacity</span><div class="zh-bar"><i id="zh-cap"></i></div><span id="zh-capv">33%</span></div>
    <div class="zh-row"><span class="zh-k">Read</span><span class="zh-read" id="zh-read">○○○</span></div>
    <div class="zh-row"><span class="zh-stance off" id="zh-stance">◈ Inside the arc — physical strikes will be turned</span></div>
    <div class="zh-row"><span class="zh-charge off" id="zh-charge">⬟ Gathering depth — brace for the release</span></div>
  </div>
  <div id="zen-speech"><div class="zs-who"></div><div class="zs-text"></div></div>`);

  let _sayT = null;
  function say(text, who, ms) {
    who = who || 'ZENIS'; ms = ms || 3000;
    const box = el('zen-speech');
    box.className = who === 'KADEN' ? 'kaden' : '';
    box.querySelector('.zs-who').textContent = who;
    box.querySelector('.zs-text').textContent = '“' + text + '”';
    void box.offsetWidth;
    box.classList.add('on');
    clearTimeout(_sayT);
    _sayT = setTimeout(() => box.classList.remove('on'), ms);
    addLog(`${who === 'KADEN' ? 'Kaden' : 'Zenis'}: “${text}”`, 'sub');
  }

  function zHud() {
    const z = zen();
    const hud = el('zen-hud');
    if (!hud || !z || !z._init) return;
    hud.classList.add('on');
    el('zh-cap').style.width = Math.round(z.capacity * 100) + '%';
    el('zh-capv').textContent = Math.round(z.capacity * 100) + '%';
    el('zh-read').textContent = '●'.repeat(z.read) + '○'.repeat(3 - z.read);
    el('zh-stance').classList.toggle('off', !z.arcStance);
    el('zh-charge').classList.toggle('off', !z.charged);
    const card = getCardEl(z);
    if (card) {
      card.classList.toggle('zen-arc', !!z.arcStance);
      card.classList.toggle('zen-charge', !!z.charged);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
     4. HELPERS
     ═══════════════════════════════════════════════════════════════════ */
  function zen() { return state.enemies.find(e => e.isZenis); }
  function kad() { return state.party.find(p => p.id === 'kaden'); }

  // Phase transitions. Capacity is the fraction of his power he is using —
  // it multiplies every hit. He never gets near a full draw.
  function zPhase(z) {
    const p = z.hp / z.maxHp;
    const want = p <= 0.52 ? 3 : p <= 0.75 ? 2 : 1;
    if (want > z.phase) {
      z.phase = want;
      z.capacity = CAPACITY[want];
      z.pattern = PATTERNS[want];
      z.patternIndex = 0;
      addLog(want === 2
        ? 'Zenis’s attention sharpens. The restraint loosens by a fraction.'
        : 'He stops weighing you and starts answering you. The pressure in the street doubles.', 'crit');
      showFloat(z, 'SHARPER', 'crit');
      VFX.screenFlash('rgba(150,160,220,0.10)', 500);
      zHud();
    }
  }

  function zKnockback(target) {
    if (target.dead) return;
    target.atb = Math.max(0, target.atb - 45);
    state.readyQueue = state.readyQueue.filter(c => c.id !== target.id);
    showFloat(target, '◌ DRIVEN BACK', 'debuff');
    addLog(`${target.name} is driven back — his AP scatters`, 'debuff');
  }

  function zAddStagger(z, frac) {
    if (z.staggerMax === undefined) {
      z.staggerMax = Math.max(60, Math.round(z.maxHp * 0.42));
      z.stagger = 0; z.staggered = false;
    }
    if (!z.staggered) z.stagger = Math.min(z.staggerMax - 1, z.stagger + z.staggerMax * frac);
  }

  // One Zenis hit on Kaden. Handles evade, capacity scaling, Read stacks and
  // the mercy clause.
  async function zHit(z, target, o) {
    if (!o.undodgeable && checkDodge(target)) {
      addLog(`${target.name} slips ${o.label}`, 'dodge');
      showFloat(target, 'EVADE', 'dodge');
      await wait(320);
      return { dodged: true, dmg: 0 };
    }
    const mult = (z.capacity / 0.33) * (1 + 0.08 * z.read);
    let { dmg, crit } = calcDamage(z, { name: o.label, power: o.power * mult, type: 'magic' }, target);
    let spared = false;
    if (ZEN_CFG.mercy && !z.mercyUsed && dmg >= target.hp) {
      z.mercyUsed = true; spared = true;
      dmg = Math.max(0, target.hp - 1);
    }
    target.hp = Math.max(0, target.hp - dmg);
    addLog(`${target.name} takes ${dmg} damage${crit ? ' ◈ Critical' : ''}`, crit ? 'crit' : 'damage');
    showFloat(target, dmg, crit ? 'crit' : 'player-dmg', z);
    VFX.burstMagic(target, z); AUDIO.sfxMagic();
    if (o.shake) VFX.shake(o.shake);
    render(); await wait(260);

    if (target.hp <= 0 && !target.dead) {
      target.dead = true; target.atb = 0;
      state.readyQueue = state.readyQueue.filter(c => c.id !== target.id);
      addLog(`${target.name} is defeated`, 'defeat');
      AUDIO.sfxDefeat();
      const c = getCardEl(target); if (c) c.classList.add('dead');
      await wait(360);
    }
    if (spared) await zMercy(z, target);
    return { dodged: false, dmg, crit };
  }

  async function zMercy(z, target) {
    addLog('Zenis’s strike stops short — pulled at the last instant.', 'crit');
    showFloat(target, 'SPARED', 'buff');
    z.atb = 0; z.pendingSkill = null;
    VFX.screenFlash('rgba(200,210,255,0.10)', 500);
    await wait(600);
    say('You have his eyes.', 'ZENIS', 3400);
    await wait(1800);
    addLog('Something in his face looks almost like regret. Kaden is still standing. Barely.', 'sub');
    await wait(500);
  }

  async function zFinishTurn(actor) {
    tickBuffs(actor);
    render();
    if (state.party.every(p => p.dead)) { await wait(500); endBattle(false); return; }
    state.animating = false; state.phase = 'IDLE';
    scheduleLoop();
  }

  /* ═══════════════════════════════════════════════════════════════════
     5. ZENIS'S TURN
     ═══════════════════════════════════════════════════════════════════ */
  async function zenisAct(z, skill) {
    state.animating = true;
    const k = kad();
    if (skill.custom !== 'arc') z.arcStance = false;
    addLog(`${z.name} uses ${skill.name}`, 'action');
    await wait(380);

    switch (skill.custom) {

      case 'assess':
        addLog('Zenis glances at Kaden once — the brief sweep of someone cataloguing variables.', 'debuff');
        z.read = Math.min(3, z.read + 1);
        applyBuff(k, 'atk_slow', 0.8, 2);
        showFloat(k, '◌ READ', 'debuff');
        VFX.screenFlash('rgba(150,170,220,0.07)', 400);
        addLog(`The read sharpens his aim (${z.read}/3). A clean break in his footing will wipe it.`, 'sub');
        await wait(450);
        break;

      case 'arc':
        z.arcStance = true;
        addLog('He doesn’t step back. He steps forward — inside the arc.', 'debuff');
        addLog('While he holds it, physical strikes are turned aside. Ether, items or a braced Evade are safe answers.', 'sub');
        showFloat(z, '◈ THE ARC', 'buff'); AUDIO.sfxBuff();
        await wait(450);
        break;

      case 'correction': {
        addLog('A controlled Ether burst at point-blank. Not a strike — a correction.', 'damage');
        VFX.shake(0.4);
        const r = await zHit(z, k, { power: skill.power, label: 'The Correction', shake: 0.7 });
        if (!r.dodged) zKnockback(k);
        break;
      }

      case 'suppress': {
        addLog('The broad-frequency field closes over Kaden. Kaden’s Ether core goes quiet — registering, not reading.', 'debuff');
        applyBuff(k, 'atb_slow', 0.6, 3);
        k.atb *= 0.65;
        const drain = Math.min(k.mp, Math.round(k.maxMp * 0.2));
        k.mp -= drain;
        showFloat(k, '◌ SLOW', 'debuff');
        if (drain) showFloat(k, `-${drain} MP`, 'debuff');
        VFX.screenFlash('rgba(120,130,190,0.10)', 500);
        render(); await wait(500);
        break;
      }

      case 'presence':
        addLog('Not directed at you. Simply present — the way the ocean is present at the edge of it.', 'damage');
        await zHit(z, k, { power: skill.power, label: 'Tidal Presence', undodgeable: true, shake: 0.3 });
        break;

      case 'kit':
        z._kitDone = true;
        say('Where is my brother?', 'KADEN', 2600);
        await wait(2400);
        say('Still here.', 'ZENIS', 2300);
        await wait(2000);
        say('He is the only thing that has ever asked me to stop. I have not stopped.', 'ZENIS', 4400);
        await wait(3800);
        addLog('For one breath the control slips — the first expression on his face that was not managed.', 'crit');
        z.atb = 0; z.pendingSkill = null;
        zAddStagger(z, 0.25);
        applyBuff(k, 'crit_next', 0, 2);
        showFloat(z, 'FALTER', 'crit');
        showFloat(k, 'CRIT+', 'buff');
        VFX.screenFlash('rgba(210,220,255,0.12)', 600);
        render(); await wait(500);
        break;

      case 'gather':
        z.charged = true;
        addLog('The Ether in the street draws toward him — twenty-four years of it.', 'debuff');
        addLog('Even a sliver is a different order of magnitude. Evade the release, or break his footing first.', 'sub');
        showFloat(z, 'GATHERING', 'buff'); AUDIO.sfxBuff();
        VFX.screenFlash('rgba(20,20,40,0.28)', 900);
        zHud();
        await wait(800);
        break;

      case 'release': {
        if (!z.charged) {
          addLog('The draw has scattered — nothing stands behind the strike.', 'system');
          await zHit(z, k, { power: 1.0, label: 'Twenty-Four Years', shake: 0.4 });
          break;
        }
        z.charged = false;
        addLog('A sliver of what he holds, released at once.', 'crit');
        VFX.shake(1.0);
        const r = await zHit(z, k, { power: skill.power, label: 'Twenty-Four Years', shake: 1.1 });
        if (!r.dodged) zKnockback(k);
        break;
      }
    }

    zHud();
    await zFinishTurn(z);
  }

  /* ═══════════════════════════════════════════════════════════════════
     6. KADEN'S TURN — Inside the Arc, Requiem clamp, withdrawal
     ═══════════════════════════════════════════════════════════════════ */
  async function playerAct(actor, skill, targets) {
    const z = zen();
    const hitsZ = !!z && !z.dead && (targets || []).some(t => t && t.isZenis);

    // ── Inside the Arc: physical strikes are turned back ──
    if (hitsZ && z.arcStance && skill.type === 'physical' && !skill.isOverdrive) {
      if (actor.dodging && checkDodge(actor)) {
        // Kaden braced and read the step — the correction misses, Zenis is exposed
        z.arcStance = false;
        addLog(`${actor.name} reads the step and slips inside the correction — Zenis overextends`, 'dodge');
        showFloat(actor, 'EVADE', 'dodge');
        showFloat(z, 'EXPOSED', 'crit');
        zAddStagger(z, 0.25);
        z.atb = Math.max(0, z.atb - 35);
        zHud();
        await wait(500);
        // fall through: the attack goes in normally
      } else {
        state.animating = true;
        z.arcStance = false;
        addLog(`${actor.name} uses ${skill.name}`, 'action');
        await wait(320);
        addLog(`Zenis steps inside the arc — ${skill.name} never reaches full extension.`, 'debuff');
        showFloat(actor, 'TURNED', 'debuff');
        VFX.shake(0.4);
        zHud();
        await wait(420);
        const r = await zHit(z, actor, { power: 1.2, label: 'The Correction', shake: 0.6 });
        if (!r.dodged) zKnockback(actor);
        if (skill.cost) actor.mp = Math.max(0, actor.mp - skill.cost);
        await zFinishTurn(actor);
        return;
      }
    }

    // ── Retreat mode: Requiem can bring him to the line, never through it ──
    if (hitsZ && ZEN_CFG.retreatAt > 0 && skill.isRequiem) {
      let left = Math.max(0, z.hp - 1);
      const strikes = skill.strikes.map(s => { const d = Math.min(s, left); left -= d; return d; }).filter(d => d > 0);
      skill = Object.assign({}, skill, { strikes });
    }

    await _origResolve(actor, skill, targets);

    // ── aftermath ──
    if (state.phase === 'WIN' || state.phase === 'LOSE') return;
    if (!z) return;

    if (z.staggered && !z._stagSeen) {
      z._stagSeen = true;
      if (z.read) { z.read = 0; addLog('The break wipes his read of you clean.', 'crit'); }
      z.arcStance = false;
      if (z.charged) {
        z.charged = false;
        if (z.pendingSkill && z.pendingSkill.custom === 'release') z.pendingSkill = null;
        addLog('The draw collapses — the gathered depth scatters.', 'crit');
      }
    }
    if (!z.staggered) z._stagSeen = false;
    zHud();

    if (ZEN_CFG.retreatAt > 0 && !z.dead && z.hp / z.maxHp <= ZEN_CFG.retreatAt) {
      state.animating = true; state.phase = 'RESOLVING';
      await zWithdraw(z);
    }
  }

  async function zWithdraw(z) {
    if (state.loopHandle) cancelAnimationFrame(state.loopHandle);
    closeActionPanel();
    state.readyQueue = [];
    await wait(600);
    addLog('Zenis steps back from the engagement. He could have done more — and chose not to.', 'sub');
    await wait(900);
    say('Get your people out of the corridor, Knight.', 'ZENIS', 3400);
    await wait(2900);
    say('What’s coming doesn’t have a room in it for you.', 'ZENIS', 3800);
    await wait(3400);
    addLog('He walks away. Not hurrying. His footsteps are even on the stone.', 'system');
    const card = getCardEl(z);
    if (card) {
      card.style.transition = 'opacity 1.8s, transform 1.8s';
      card.style.opacity = '0';
      card.style.transform = 'translateY(-8px)';
    }
    await wait(1900);
    z.dead = true; z.atb = 0;
    render();
    endBattle(true);
  }

  /* ═══════════════════════════════════════════════════════════════════
     7. ENGINE HOOKS
     ═══════════════════════════════════════════════════════════════════ */
  // Set up Zenis's duel state. Called from battleStart, but also lazily on his first
  // action so a timing hiccup can never drop him onto the engine's generic skill path.
  function zInit(z) {
    if (z._init) return;
    Object.assign(z, {
      _init: true, phase: 1, capacity: CAPACITY[1], pattern: PATTERNS[1], patternIndex: 0,
      read: 0, arcStance: false, charged: false, mercyUsed: false, _kitDone: false, _stagSeen: false
    });
  }

  const _origResolve = resolveAction;
  resolveAction = async function (actor, skill, targets) {
    const z = zen();
    if (z) {
      zInit(z);
      if (actor === z) return zenisAct(z, skill);
      if (actor && actor.isParty) return playerAct(actor, skill, targets);
    }
    return _origResolve(actor, skill, targets);
  };

  const _origAI = aiChooseSkill;
  aiChooseSkill = function (enemy) {
    if (enemy.isZenis) {
      zInit(enemy);
      zPhase(enemy);
      if (!enemy._kitDone && enemy.hp / enemy.maxHp <= 0.60) {
        enemy._kitDone = true;
        return enemy.skills.find(s => s.custom === 'kit');
      }
    }
    return _origAI(enemy);
  };

  const _origRender = render;
  render = function () { _origRender(); zHud(); };

  Gimmick.on('battleStart', () => {
    const z = zen();
    if (!z) return;
    z._init = false; zInit(z);   // fresh state on every (re)start
    el('zen-speech').classList.remove('on');
    addLog('The Ether coming off him is enormous — not threatening, just present, like the ocean at the edge of it.', 'system');
    if (ZEN_CFG.retreatAt > 0) {
      addLog(`Objective — press him until he withdraws (${Math.round(ZEN_CFG.retreatAt * 100)}% HP). He is not using all of himself.`, 'sub');
    }
    say('A Knight’s blade. You have his eyes. He looked at me the same way before he understood what he was facing.', 'ZENIS', 5200);
    zHud();
  });
})();
