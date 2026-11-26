/* ═════════════════════════════════════════════════════════════════════
   gimmicks/zenis_arc.js — Zenis Anima
   ─────────────────────────────────────────────────────────────────────
   Load AFTER js/battle-engine.js and set  gimmick: 'zenis_arc'  in the HTML.
   Zenis is a normal boss (see zenis_duel in ENEMY_TEMPLATES). The one
   thing this file adds is his stance:

     Inside the Arc — after he uses it, any physical skill aimed at him
     is turned back with a counter (The Correction) and costs Kaden his
     action. Ether skills, items and Evade are unaffected. The stance
     ends the moment Zenis takes any other action. While it is up his
     card glows.
   ═════════════════════════════════════════════════════════════════════ */
window.GIMMICKS.zenis_arc = true;
console.info('[zenis_arc] gimmick loaded');

(function () {
  const style = document.createElement('style');
  style.textContent = '.enemy-card.zen-arc{box-shadow:0 0 0 1px #aeb8d8,0 0 26px rgba(174,184,216,.5)!important}';
  document.head.appendChild(style);

  const getZenis = () => state.enemies.find(e => e.isZenis && !e.dead);
  const glow = (z, on) => {
    const card = document.getElementById(`enemy-card-${z.id}`);
    if (card) card.classList.toggle('zen-arc', on);
  };

  const _orig = resolveAction;
  resolveAction = async function (actor, skill, targets) {
    const z = getZenis();
    if (!z) return _orig(actor, skill, targets);

    // Zenis acts: the stance is up only if the move he just used is Inside the Arc
    if (actor === z) {
      z.arc = skill.name === 'Inside the Arc';
      glow(z, z.arc);
      return _orig(actor, skill, targets);
    }

    // Kaden attacks into the stance: turned back, answered with a counter
    const list = Array.isArray(targets) ? targets : (targets ? [targets] : []);
    if (z.arc && actor.isParty && skill.type === 'physical' && !skill.isOverdrive && list.includes(z)) {
      z.arc = false;
      glow(z, false);
      if (skill.cost) actor.mp = Math.max(0, actor.mp - skill.cost);
      return _orig(z, { name: 'The Correction', power: 1.2, type: 'magic', target: 'random' }, [actor]);
    }

    return _orig(actor, skill, targets);
  };
})();