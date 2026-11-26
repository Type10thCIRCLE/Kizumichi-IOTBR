/* ═════════════════════════════════════════════════════════════════════
   gimmicks/chainkeeper.js — Chain Keeper gimmick
   ─────────────────────────────────────────────────────────────────────
   Load AFTER js/battle-engine.js and set  gimmick: 'chainkeeper'  in the HTML.

   The mechanic: the Chain Keeper snares party members (CHAINED = they are
   skipped and untargetable), builds a Chain Tension gauge, and its chains are
   separate enemy cards that must be broken. Killing the Keeper shatters every
   chain. (Needs css/gimmicks/chainkeeper.css and the 'chain_keeper' entry of
   ENEMY_TEMPLATES.)
   ═════════════════════════════════════════════════════════════════════ */
window.GIMMICKS.chainkeeper = true;

/* ═════════════════════════════════════════════════════════════════════
   ENGINE HOOKS
   ═════════════════════════════════════════════════════════════════════ */
// Rule notice goes in the battle log (a popup here could softlock the battle
// if it was never dismissed).
Gimmick.on('battleStart', () => {
  if (!state.enemies.some(e => e.isChainKeeper)) return;
  setTimeout(() => {
    addLog('▦ CHAIN KEEPER RULE', 'chain');
    addLog('Chained allies cannot act or be targeted. Destroy their Chains to free them.', 'chain');
    addLog('Breaking every chain exposes the Keeper\'s core. Killing the Keeper shatters all chains.', 'chain');
    addLog('Watch the Chain Tension gauge — at full tension, Bridge Crush hits the whole party.', 'chain');
  }, 400);
});

/* ═════════════════════════════════════════════════════════════════════
   CHAIN MECHANICS — new functions (not part of the shared engine)
   ═════════════════════════════════════════════════════════════════════ */
// ── CHAIN MECHANIC HELPERS ──────────────────────────────────
function applyChainedState(actor, target) {
  if (target.chained) return; // already chained
  target.chained = true;
  // Remove them from the ready queue — they can't act while chained
  state.readyQueue = state.readyQueue.filter(c => c.id !== target.id);
  target.atb = 0;

  // Spawn the "Chains" enemy object
  const chainIdx = state.enemies.length;
  const chainEnemy = {
    id: `chain_${target.id}`,
    name: `${target.name}'s Chains`,
    subtitle: `Break the chains to free ${target.name}`,
    maxHp: 280,
    hp: 280,
    atk: 0, def: 0, spd: 0,
    atb: 0,
    buffs: [],
    dead: false,
    isParty: false,
    isChains: true,
    chainedMemberId: target.id,
    color: '#8844cc',
    symbol: '◆',
    xp: 0,
    atbMult: 0,  // Chains don't act
    defMult: 1.0, atkMult: 1.0,
    dodging: false,
    skills: []  // no AI actions
  };
  state.enemies.push(chainEnemy);

  // Build the card for the new chain enemy
  buildSingleEnemyCard(chainEnemy, chainIdx);

  addLog(`${target.name} has been CHAINED — destroy ${target.name}'s Chains to free them.`, 'chain');
  showFloat(target, '▦ CHAINED', 'debuff');
  VFX.screenFlash('rgba(120,40,200,0.10)', 400);
  AUDIO.sfxMagic();
  render();
}

// ── Training Dummy: record hit, never die, update card display ──────────
function applyDummyDamage(target, dmg) {
  const s = target.dummyStats;
  const now = performance.now();
  if (s.startTime === null) s.startTime = now;
  s.lastHitTime = now;
  s.totalDmg += dmg;
  s.hits++;
  updateDummyCard(target);
}

function buildSingleEnemyCard(e, i) {
  const cont = el('enemy-container');
  const card = document.createElement('div');
  card.className = `enemy-card chain-enemy-card`;
  card.id = `enemy-card-${e.id}`;
  card.style.setProperty('--enemy-color', e.color);
  card.style.animationDelay = `${i * 0.12}s`;
  card.style.position = 'relative';
  const tensionBar = e.isChainKeeper
    ? `<div class="chain-tension-bar" style="margin-top:5px"><div class="chain-tension-fill" style="width:0%"></div></div>
       <div class="chain-tension-label">TENSION 0%</div>`
    : '';
  card.innerHTML = `
    <div class="enemy-symbol-wrap"><div class="enemy-symbol">${e.symbol}</div></div>
    <div class="enemy-name">${e.name}</div>
    <div class="enemy-subtitle">${e.subtitle}</div>
    <div class="enemy-hp-bar"><div class="enemy-hp-fill" style="width:100%"></div></div>
    <div class="enemy-hp-text">${e.hp} / ${e.maxHp}</div>
    <div class="enemy-atb-bar"><div class="enemy-atb-fill" style="width:100%;transform:scaleX(0)"></div></div>
    <div class="enemy-intent"></div>
    ${tensionBar}`;
  card.addEventListener('click', () => DEV.onEnemyClick(e.id));
  cont.appendChild(card);
}

function resolveChainDestroyed(chainEnemy) {
  // Find the chained party member and free them
  const member = state.party.find(p => p.id === chainEnemy.chainedMemberId);
  if (member && !member.dead) {
    member.chained = false;
    addLog(`${member.name}'s Chains shattered — ${member.name} is free to act.`, 'chain-free');
    showFloat(member, '▦ FREE', 'buff');
    AUDIO.sfxBuff();

    // Check if Chain Keeper has an Expose Core phase to trigger
    const keeper = state.enemies.find(e => e.isChainKeeper && !e.dead);
    const allChainsDead = state.enemies.filter(e => e.isChains && !e.dead).length === 0;
    if (keeper && allChainsDead && !keeper.exposeCoreActive) {
      triggerExposeCore(keeper);
    }
  }
  const panelEl = el(`panel-${chainEnemy.chainedMemberId}`);
  if (panelEl) panelEl.classList.remove('chained');
  render();
}

function shatterAllChains() {
  // Chain Keeper is down — every remaining chain breaks and everyone is freed
  const chains = state.enemies.filter(e => e.isChains && !e.dead);
  chains.forEach(c => {
    c.hp = 0; c.dead = true; c.atb = 0;
    state.readyQueue = state.readyQueue.filter(q => q.id !== c.id);
    const member = state.party.find(p => p.id === c.chainedMemberId);
    if (member) {
      member.chained = false;
      if (!member.dead) showFloat(member, '▦ FREE', 'buff');
    }
    const panelEl = el(`panel-${c.chainedMemberId}`);
    if (panelEl) panelEl.classList.remove('chained');
    const card = getCardEl(c);
    if (card) card.style.display = 'none';
  });
  // Safety: clear any stray chained flag
  state.party.forEach(p => { p.chained = false; });
  if (chains.length) addLog('The Chain Keeper falls — all remaining chains shatter.', 'chain-free');
  render();
}

function triggerExposeCore(keeper) {
  keeper.exposeCoreActive = true;
  keeper.exposeCoreturns = 1;
  keeper.defMult = 0.1; // Very vulnerable — 90% defense reduction for 1 turn
  addLog(`Chain Keeper — EXPOSE CORE — Vulnerable for 1 turn`, 'overdrive');
  showFloat(keeper, '◎ EXPOSED', 'crit');
  VFX.screenFlash('rgba(255,200,60,0.12)', 500);
  VFX.shake(0.4);
  render();
}

function updateDummyCard(target) {
  const card = document.getElementById('enemy-card-' + target.id);
  if (!card) return;
  const s = target.dummyStats;
  const elapsed = s.startTime !== null ? ((s.lastHitTime - s.startTime) / 1000) : 0;
  const dps = elapsed > 0 ? Math.round(s.totalDmg / elapsed) : 0;
  const avgHit = s.hits > 0 ? Math.round(s.totalDmg / s.hits) : 0;

  const statsEl = card.querySelector('.dummy-stats');
  if (statsEl) {
    statsEl.innerHTML =
      '<div class="dummy-stat-row"><span class="dummy-label">TOTAL DMG</span><span class="dummy-val">' + s.totalDmg.toLocaleString() + '</span></div>' +
      '<div class="dummy-stat-row"><span class="dummy-label">DPS</span><span class="dummy-val">' + dps.toLocaleString() + '</span></div>' +
      '<div class="dummy-stat-row"><span class="dummy-label">HITS</span><span class="dummy-val">' + s.hits + '</span></div>' +
      '<div class="dummy-stat-row"><span class="dummy-label">AVG HIT</span><span class="dummy-val">' + avgHit.toLocaleString() + '</span></div>' +
      '<div class="dummy-stat-row"><span class="dummy-label">TIME</span><span class="dummy-val">' + elapsed.toFixed(1) + 's</span></div>';
  }
}

/* ═════════════════════════════════════════════════════════════════════
   ENGINE FUNCTIONS THE GIMMICK REPLACES — same-named copies of the engine versions, with the chain logic added
   ═════════════════════════════════════════════════════════════════════ */
function initEnemies() {
  return BATTLE.enemies.map((key, i) => {
    const t = ENEMY_TEMPLATES[key];
    const base = {
      ...t, id: `e${i}`, hp: t.maxHp,
      atb: Math.random() * 25,
      buffs: [], dead: false, isParty: false,
      atbMult: 1.0, defMult: 1.0, atkMult: 1.0,
      dodging: false
    };
    if (t.isDummy) {
      base.dummyStats = { totalDmg: 0, hits: 0, startTime: null, lastHitTime: null };
    }
    if (t.isChainKeeper) {
      base.chainTension = 0;
    }
    return base;
  });
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

    // ── Chain Snare: apply CHAINED status to a random party member ──
    if (skill.type === 'chain_snare') {
      const eligible = state.party.filter(p => !p.dead && !p.chained);
      if (eligible.length) {
        const victim = eligible[Math.floor(Math.random() * eligible.length)];
        applyChainedState(actor, victim);
      } else {
        addLog('Chain Keeper — no unchained targets available.', 'system');
      }
      render(); await wait(500);
      break; // handled — don't fall through to damage
    }

    // ── Tension Raise: build the tension gauge ──
    if (skill.type === 'tension_raise') {
      actor.chainTension = Math.min(100, (actor.chainTension || 0) + (skill.tensionAmount || 40));
      addLog(`Chain Keeper — Tension rises (${Math.round(actor.chainTension)}%)`, 'debuff');
      showFloat(actor, `▦ ${Math.round(actor.chainTension)}%`, 'debuff');
      AUDIO.sfxBuff();
      render(); await wait(420);
      break;
    }

    if (target.pendingParry) {
      target.pendingParry = false;
      addLog(`${target.name} cancels ${skill.name}`, 'dodge');
      showFloat(target, 'CANCEL', 'dodge');
      await wait(300);
      continue;
    }

    if (checkDodge(target)) {
      addLog(`${target.name} evades the attack`, 'dodge');
      showFloat(target, 'EVADE', 'dodge');
      await wait(300);
      continue;
    }

    // ── Training Dummy: intercept all damage, never die ──
    if (target.isDummy) {
      let dummyDmg = 0;
      if (skill.isRequiem && skill.strikes) {
        VFX.shake(0.4);
        for (let si = 0; si < skill.strikes.length; si++) {
          const strikeDmg = skill.strikes[si];
          dummyDmg += strikeDmg;
          applyDummyDamage(target, strikeDmg);
          addLog('Training Dummy absorbs ' + strikeDmg + ' — Strike ' + (si+1) + (si===3?' ◈ FINAL':''), si===3?'crit':'overdrive');
          showFloat(target, strikeDmg, si===3?'crit':'enemy-dmg', actor);
          VFX.burstByActor(target, actor, si===3);
          if (si===3) AUDIO.sfxCrit(); else AUDIO.sfxHit();
          await wait(si===3?420:280);
        }
      } else if (skill.flatDamage !== undefined) {
        dummyDmg = skill.flatDamage;
        applyDummyDamage(target, dummyDmg);
        addLog('Training Dummy absorbs ' + dummyDmg + ' ◈ Overdrive', 'overdrive');
        showFloat(target, dummyDmg, 'crit', actor);
        VFX.burstByActor(target, actor, true);
        AUDIO.sfxCrit();
        VFX.shake(0.8);
      } else if (skill.type === 'physical' || skill.type === 'magic') {
        const { dmg, crit } = calcDamage(actor, skill, target);
        dummyDmg = dmg;
        applyDummyDamage(target, dummyDmg);
        addLog('Training Dummy absorbs ' + dummyDmg + (crit?' ◈ Critical':''), crit?'crit':'damage');
        showFloat(target, dummyDmg, crit?'crit':(actor.isParty?'enemy-dmg':'player-dmg'), actor);
        if (skill.type==='magic') { VFX.burstMagic(target, actor); AUDIO.sfxMagic(); }
        else if (crit) AUDIO.sfxCrit();
        else AUDIO.sfxHit();
        await wait(220);
      }
      continue;
    }

    // ── REQUIEM: multi-strike with fixed escalating damage ──
    if (skill.isRequiem && skill.strikes) {
      VFX.shake(0.6);
      for (let si = 0; si < skill.strikes.length; si++) {
        if (target.dead) break;
        const strikeDmg = skill.strikes[si];
        target.hp = Math.max(0, target.hp - strikeDmg);
        const strikeLabels = ['', '', '', '⬛ FINAL'];
        addLog(`${target.name} takes ${strikeDmg} damage — Strike ${si + 1}${si === 3 ? ' ◈ FINAL BLOW' : ''}`, si === 3 ? 'crit' : 'overdrive');
        showFloat(target, strikeDmg, si === 3 ? 'crit' : 'enemy-dmg', actor);
        VFX.burstByActor(target, actor, si === 3);
        if (si === 3) AUDIO.sfxCrit(); else AUDIO.sfxHit();
        render();
        await wait(si === 3 ? 420 : 280);
        if (target.hp <= 0 && !target.dead) {
          target.dead = true; target.atb = 0;
          state.readyQueue = state.readyQueue.filter(c => c.id !== target.id);
          if (target.isChains) { resolveChainDestroyed(target); }
          if (target.isChainKeeper) { shatterAllChains(); }
          addLog(`${target.name} is defeated`, 'defeat');
          AUDIO.sfxDefeat();
          VFX.burstDefeat(target);
          const card = getCardEl(target);
          if (card) {
            if (target.isChains) {
              card.style.transition = 'opacity 0.35s, transform 0.35s';
              card.style.opacity = '0';
              card.style.transform = 'scale(0.7)';
              await wait(360);
              card.style.display = 'none';
            } else {
              card.classList.add('dead');
              await wait(360);
            }
          } else { await wait(360); }
          break;
        }
      }
      continue;
    }

    // ── Flat damage overdrives (Silver Dirge, Black Thread Severance) ──
    if (skill.flatDamage !== undefined) {
      const flatDmg = skill.flatDamage;
      target.hp = Math.max(0, target.hp - flatDmg);
      addLog(`${target.name} takes ${flatDmg} damage ◈ Overdrive`, 'overdrive');
      showFloat(target, flatDmg, 'crit', actor);
      VFX.burstByActor(target, actor, true);
      AUDIO.sfxCrit();
      VFX.shake(1.0);
      VFX.screenFlash('rgba(180,60,40,0.08)', 280);
      render(); await wait(320);
      if (target.hp <= 0 && !target.dead) {
        target.dead = true; target.atb = 0;
        state.readyQueue = state.readyQueue.filter(c => c.id !== target.id);
        if (target.isChains) { resolveChainDestroyed(target); }
          if (target.isChainKeeper) { shatterAllChains(); }
        addLog(`${target.name} is defeated`, 'defeat');
        AUDIO.sfxDefeat();
        VFX.burstDefeat(target);
        const card = getCardEl(target);
        if (card) {
          if (target.isChains) {
            card.style.transition = 'opacity 0.35s, transform 0.35s';
            card.style.opacity = '0';
            card.style.transform = 'scale(0.7)';
            await wait(360);
            card.style.display = 'none';
          } else {
            card.classList.add('dead');
            await wait(360);
          }
        } else { await wait(360); }
      }
      continue;
    }

    // ── Bridge Crush: only fires when tension is full; resets gauge ──
    if (skill.isBridgeCrush) {
      actor.chainTension = 0;
      addLog('Chain Keeper — BRIDGE CRUSH — the tension shatters the field', 'overdrive');
      VFX.screenFlash('rgba(120,40,200,0.18)', 500);
      VFX.shake(0.9);
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
      target.dead = true; target.atb = 0;
      state.readyQueue = state.readyQueue.filter(c => c.id !== target.id);
      if (target.isChains) { resolveChainDestroyed(target); }
          if (target.isChainKeeper) { shatterAllChains(); }
      addLog(`${target.name} is defeated`, 'defeat');
      AUDIO.sfxDefeat();
      VFX.burstDefeat(target);
      const card = getCardEl(target);
      if (card) {
        if (target.isChains) {
          card.style.transition = 'opacity 0.35s, transform 0.35s';
          card.style.opacity = '0';
          card.style.transform = 'scale(0.7)';
          await wait(360);
          card.style.display = 'none';
        } else {
          card.classList.add('dead');
          await wait(360);
        }
      } else { await wait(360); }
    }
  }

  tickBuffs(actor);
  if (actor.isParty && skill.cost) actor.mp = Math.max(0, actor.mp - skill.cost);
  render();

  if (state.enemies.some(e => e.isChainKeeper && e.dead)) shatterAllChains();
  const aliveEnemies = state.enemies.filter(e => !e.dead && !e.isDummy);
  const aliveParty   = state.party.filter(p => !p.dead);
  if (!aliveEnemies.length) { await wait(500); endBattle(true);  return; }
  if (!aliveParty.length)   { await wait(500); endBattle(false); return; }

  state.animating = false;
  state.phase = 'IDLE';
  scheduleLoop();
}

function gameLoop(ts) {
  if (['WIN','LOSE','RESOLVING'].includes(state.phase) || state.animating) return;
  const delta = Math.min(ts - lastTime, 50);
  lastTime = ts;

  if (state.phase === 'IDLE') {
    const all = [...state.party, ...state.enemies].filter(c => !c.dead && !c.chained);
    for (const c of all) {
      if (c.atb >= 100) continue;
      c.atb = Math.min(100, c.atb + c.spd * delta * ATB_RATE * (c.atbMult || 1));
      // Telegraph: roll the enemy's next move as soon as it enters the
      // "striking" window (80% AP) rather than waiting until it's fully
      // ready. This gives the intent label time to show the real move
      // name before the hit actually lands. Training Dummy is excluded —
      // it's a passive practice target, not a real threat to telegraph.
      if (!c.isParty && !c.dead && !c.isDummy && c.atb >= 80 && !c.pendingSkill) {
        c.pendingSkill = aiChooseSkill(c);
      }
      if (c.atb >= 100 && !state.readyQueue.find(q => q.id === c.id)) {
        if (!c.isDummy) state.readyQueue.push(c);
      }
    }
    renderATBOnly();
    if (state.readyQueue.length) processNext();
  }
  state.loopHandle = requestAnimationFrame(gameLoop);
}

function processNext() {
  if (state.animating || state.phase === 'RESOLVING') return;
  while (state.readyQueue.length && (state.readyQueue[0].dead || state.readyQueue[0].chained)) state.readyQueue.shift();
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

    // Tick down Chain Keeper's Expose Core window each time it acts
    if (next.isChainKeeper && next.exposeCoreActive) {
      next.exposeCoreturns--;
      if (next.exposeCoreturns <= 0) {
        next.exposeCoreActive = false;
        next.defMult = 1.0;
        addLog('Chain Keeper — Expose Core window has closed.', 'system');
        render();
      }
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
  // (Chain Keeper intentionally has no `pattern` — its tension-gated
  // weighted AI below is its own built-in telegraph and is left untouched.)
  if (Array.isArray(enemy.pattern) && enemy.pattern.length) {
    if (typeof enemy.patternIndex !== 'number') enemy.patternIndex = 0;
    const wantedName = enemy.pattern[enemy.patternIndex % enemy.pattern.length];
    enemy.patternIndex++;
    const found = enemy.skills.find(sk => sk.name === wantedName);
    if (found) return found;
    // Name typo or skill removed — fall through to weighted/gated pool below.
  }

  // Build an effective weight list, gating special Chain Keeper moves
  const eligible = enemy.skills.filter(sk => {
    // Bridge Crush only fires when tension is full
    if (sk.isBridgeCrush) return (enemy.chainTension || 0) >= 100;
    // Tension Raise is suppressed when tension is already full (Bridge Crush is preferred)
    if (sk.type === 'tension_raise') return (enemy.chainTension || 0) < 100;
    // Chain Snare: skip if all party members are already chained
    if (sk.type === 'chain_snare') {
      const freeTargets = state.party.filter(p => !p.dead && !p.chained);
      return freeTargets.length > 0;
    }
    return true;
  });

  const pool = eligible.length ? eligible : enemy.skills;
  const total = pool.reduce((s, sk) => s + (sk.weight || 1), 0);
  let r = Math.random() * total;
  for (const sk of pool) { if ((r -= sk.weight || 1) <= 0) return sk; }
  return pool[0];
}

function _orig_aiChooseTargets(skill) {
  const alive = state.party.filter(p => !p.dead && !p.chained);
  if (!alive.length) return null;
  if (skill.target === 'all_party') return state.party.filter(p => !p.dead && !p.chained);
  return [alive[Math.floor(Math.random() * alive.length)]];
}

function _orig_buildEnemyCards() {
  const cont = el('enemy-container');
  cont.innerHTML = '';
  state.enemies.forEach((e, i) => {
    const card = document.createElement('div');
    card.className = `enemy-card${e.isBoss ? ' boss' : ''}${e.isDummy ? ' dummy-card' : ''}`;
    card.id = `enemy-card-${e.id}`;
    card.style.setProperty('--enemy-color', e.color);
    card.style.animationDelay = `${i * 0.12}s`;
    card.style.position = 'relative';
    if (e.isDummy) {
      card.innerHTML = `
        <div class="enemy-symbol-wrap"><div class="enemy-symbol">${e.symbol}</div></div>
        <div class="enemy-name">${e.name}</div>
        <div class="enemy-subtitle">${e.subtitle}</div>
        <div class="dummy-stats">
          <div class="dummy-stat-row"><span class="dummy-label">TOTAL DMG</span><span class="dummy-val">0</span></div>
          <div class="dummy-stat-row"><span class="dummy-label">DPS</span><span class="dummy-val">—</span></div>
          <div class="dummy-stat-row"><span class="dummy-label">HITS</span><span class="dummy-val">0</span></div>
          <div class="dummy-stat-row"><span class="dummy-label">AVG HIT</span><span class="dummy-val">—</span></div>
          <div class="dummy-stat-row"><span class="dummy-label">TIME</span><span class="dummy-val">0.0s</span></div>
        </div>`;
    } else {
      const tensionBar = e.isChainKeeper
        ? `<div class="chain-tension-bar" style="margin-top:5px"><div class="chain-tension-fill" style="width:0%"></div></div>
           <div class="chain-tension-label">TENSION 0%</div>`
        : '';
      card.innerHTML = `
        <div class="enemy-symbol-wrap"><div class="enemy-symbol">${e.symbol}</div></div>
        <div class="enemy-name">${e.name}</div>
        <div class="enemy-subtitle">${e.subtitle}</div>
        <div class="enemy-hp-bar"><div class="enemy-hp-fill" style="width:100%"></div></div>
        <div class="enemy-hp-text">${e.hp} / ${e.maxHp}</div>
        <div class="enemy-atb-bar"><div class="enemy-atb-fill" style="width:100%;transform:scaleX(0)"></div></div>
        <div class="enemy-intent"></div>
        ${tensionBar}`;
    }
    // Secret menu: track clicks on enemy card
    card.addEventListener('click', () => DEV.onEnemyClick(e.id));
    cont.appendChild(card);
  });
}

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
    p.classList.toggle('chained', !!m.chained);
    const si = p.querySelector('.status-icons');
    const icons = { def_up:'■', atk_up:'▲', crit_next:'◎', atb_slow:'▽', spd_up:'▶' };
    si.innerHTML = m.buffs.map(b => `<span class="status-icon" title="${b.effect}">${icons[b.effect]||'?'}</span>`).join('');
    if (m.dodging) si.innerHTML += `<span class="status-icon" title="Evading" style="color:var(--dodge-col)">◌</span>`;
    if (m.chained) si.innerHTML += `<span class="status-icon" title="Chained" style="color:#bb66ff">▦</span>`;
  });

  state.enemies.forEach(e => {
    const card = el(`enemy-card-${e.id}`);
    if (!card) return;
    if (e.isDummy) {
      // Dummy card has no HP bar — stats are updated by updateDummyCard()
      return;
    }
    const pct = Math.max(0, e.hp / e.maxHp * 100);
    const fill = card.querySelector('.enemy-hp-fill');
    fill.style.width = pct + '%';
    fill.style.background = pct < 25 ? 'var(--hp-lo)' : pct < 50 ? 'var(--hp-mid)' : 'var(--hp-hi)';
    card.querySelector('.enemy-hp-text').textContent = `${e.hp} / ${e.maxHp}`;
    if (e.isChains && e.dead) {
      card.style.display = 'none';
    } else {
      card.classList.toggle('dead', e.dead);
    }
    // Chain Keeper: update tension bar and expose-core vulnerability counter
    if (e.isChainKeeper) {
      const tensionFill = card.querySelector('.chain-tension-fill');
      const tensionLabel = card.querySelector('.chain-tension-label');
      if (tensionFill) {
        const pct = Math.min(100, e.chainTension || 0);
        tensionFill.style.width = pct + '%';
        tensionFill.classList.toggle('full', pct >= 100);
      }
      if (tensionLabel) {
        tensionLabel.textContent = `TENSION ${Math.min(100, Math.round(e.chainTension || 0))}%`;
      }
      // (Expose Core window countdown is handled in processNext when the Chain Keeper acts)
    }
  });
}