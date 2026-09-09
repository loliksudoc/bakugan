'use strict';

/* =========================================================
   Справочник игры. Единый источник — data/catalog.json,
   тот же файл читает сервер, поэтому цены и характеристики
   на клиенте и на сервере не расходятся.
   ========================================================= */

let CATALOG = null;
let ATTR = null, CYCLE = null, POOL = null, ABILITIES = null,
    GATE_TYPES = null, DIFFS = null, PRICES = null, REWARDS = null;
let TEAM_CAP = 1150, HOME_BONUS = 50, RESONANCE = 30;

async function loadCatalog() {
  CATALOG = await API.get('/api/catalog');
  ATTR = CATALOG.attrs;
  CYCLE = CATALOG.cycle;
  POOL = CATALOG.pool;
  ABILITIES = CATALOG.abilities;
  GATE_TYPES = CATALOG.gateTypes;
  DIFFS = CATALOG.diffs;
  PRICES = CATALOG.prices;
  REWARDS = CATALOG.rewards;
  TEAM_CAP = CATALOG.teamCap;
  HOME_BONUS = CATALOG.homeBonus;
  RESONANCE = CATALOG.resonance;
}

/* каждая стихия бьёт следующую по кругу */
const beats = (a, b) => CYCLE[(CYCLE.indexOf(a) + 1) % 6] === b;

const bakuganByName = n => POOL.find(b => b.name === n);
const abilityById = id => ABILITIES.find(a => a.id === id);
const gateType = g => GATE_TYPES.find(t => t.id === g.type);

const GATE_COLORS = {
  normal: '#7f8dbd', swap: '#4fd6d0', underdog: '#7ee2a8',
  fortress: '#ffb020', silence: '#ff6a8a', mirror: '#c0c8e8', chaos: '#ff7ae0'
};
const gateColor = g => g.type === 'attr' ? ATTR[g.attr].c : GATE_COLORS[g.type];
const gateTitle = g => g.type === 'attr' ? 'Врата ' + ATTR[g.attr].n : gateType(g).title;
const gateDesc = g => g.type === 'attr'
  ? '+150 G бакугану стихии ' + ATTR[g.attr].n
  : gateType(g).desc;

const stars = n => '★'.repeat(n) + '☆'.repeat(3 - n);
const bakuganPrice = b => PRICES.bakugan[String(b.tier)];
