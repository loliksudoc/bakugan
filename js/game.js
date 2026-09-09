'use strict';

/* =========================================================
   БАКУГАН — Битва Бойцов: игровой движок
   ========================================================= */

const W = 860, H = 560;          // размер поля
const LX = 430, LY = 516;        // точка броска
const FR = 0.985;                // трение
const DF = FR / (1 - FR);        // дальность = v0 * DF
const STOP = 0.14;               // порог остановки
const GATE_R = 54;               // радиус «поимки» вратами
const MAX_GATES = 3;             // максимум врат на арене
const DECK_SIZE = 6;             // сколько карт врат берётся в бой
const HAND_SIZE = 3;             // карт способностей в руке

const SLOTS = [
  { x: 168, y: 158 }, { x: 430, y: 128 }, { x: 692, y: 158 },
  { x: 252, y: 312 }, { x: 608, y: 312 }
];

/* ---------- утилиты ---------- */
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
const sleep = ms => new Promise(r => setTimeout(r, ms));
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function wpick(list) {
  const tot = list.reduce((s, x) => s + (x.w || 1), 0);
  let r = Math.random() * tot;
  for (const x of list) { r -= (x.w || 1); if (r <= 0) return x; }
  return list[list.length - 1];
}

let S = null;
let uid = 0;
let DIFF = null;
let MODE = 'ai';                 // 'ai' — против Маскерада, 'mp' — онлайн
let OPPNAME = 'Маскерад';

/* детерминированный генератор для случайных эффектов в онлайн-бою */
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* =========================================================
   Колоды игрока: строятся из его коллекции в базе
   ========================================================= */
function myAbilityPool() {
  const out = [];
  for (const c of PROFILE.cards.ability) {
    const a = abilityById(c.type);
    if (!a) continue;
    for (let i = 0; i < c.qty; i++) out.push({ ...a, attr: c.attr });
  }
  return out.length ? out : [{ ...ABILITIES[0], attr: PROFILE.user.element }];
}
function myGatePool() {
  const out = [];
  for (const c of PROFILE.cards.gate) {
    if (!GATE_TYPES.some(t => t.id === c.type)) continue;
    for (let i = 0; i < c.qty; i++) out.push({ type: c.type, attr: c.attr });
  }
  return out.length ? out : [{ type: 'normal', attr: PROFILE.user.element }];
}
function aiAbilityPool() {
  return ABILITIES.map(a => ({ ...a, attr: pick(CYCLE) }));
}
function aiGatePool() {
  const out = [];
  for (let i = 0; i < 10; i++) out.push({ type: wpick(GATE_TYPES).id, attr: pick(CYCLE) });
  return out;
}
function buildDeck(pool, n) {
  const s = shuffle(pool), d = [];
  while (d.length < n) d.push({ ...s[d.length % s.length], id: ++uid });
  return d;
}

/* =========================================================
   Новая партия
   ========================================================= */
function newGame(playerTeam) {
  const aiTeam = buildAiTeam(playerTeam);
  const mk = (src, owner) => src.map(p => ({ ...p, uid: ++uid, owner, where: 'hand' }));
  const pAb = myAbilityPool(), aAb = aiAbilityPool();
  S = {
    phase: 'idle', turn: 'p',
    gates: [],
    p: { team: mk(playerTeam, 'p'), abil: [], abilPool: pAb, gateHand: [],
         gateDeck: buildDeck(myGatePool(), DECK_SIZE), wins: 0 },
    a: { team: mk(aiTeam, 'a'), abil: [], abilPool: aAb, gateHand: [],
         gateDeck: buildDeck(aiGatePool(), DECK_SIZE), wins: 0 },
    ball: null,
    aim: { ang: 0, dir: 1, pow: 0.05, pdir: 1 },
    fx: [], battle: null, selected: null, placing: null
  };
  for (const side of ['p', 'a']) {
    for (let i = 0; i < HAND_SIZE; i++) S[side].abil.push(pick(S[side].abilPool));
    for (let i = 0; i < 3; i++) if (S[side].gateDeck.length) S[side].gateHand.push(S[side].gateDeck.pop());
  }
  renderAll();
  startTurn();
}

/* партия против живого соперника: колоды у каждого свои, счётчики соперника условные */
function newGameMP(myTeam, oppTeam, iFirst) {
  MODE = 'mp';
  const mk = (src, owner) => src.map(p => ({ ...p, uid: ++uid, owner, where: 'hand' }));
  S = {
    phase: 'idle', turn: iFirst ? 'p' : 'a',
    gates: [],
    p: { team: mk(myTeam, 'p'), abil: [], abilPool: myAbilityPool(), gateHand: [],
         gateDeck: buildDeck(myGatePool(), DECK_SIZE), wins: 0 },
    a: { team: mk(oppTeam, 'a'), abil: new Array(HAND_SIZE), abilPool: [],
         gateHand: new Array(3), gateDeck: new Array(DECK_SIZE - 3), wins: 0 },
    ball: null,
    aim: { ang: 0, dir: 1, pow: 0.05, pdir: 1 },
    fx: [], battle: null, selected: null, placing: null, battleNo: 0
  };
  for (let i = 0; i < HAND_SIZE; i++) S.p.abil.push(pick(S.p.abilPool));
  for (let i = 0; i < 3; i++) if (S.p.gateDeck.length) S.p.gateHand.push(S.p.gateDeck.pop());
  renderAll();
  startTurn();
}

/* Маскерад собирает команду под тот же лимит */
function buildAiTeam(playerTeam) {
  const avail = POOL.filter(p => !playerTeam.some(t => t.name === p.name));
  let best = null;
  for (let k = 0; k < 300; k++) {
    const t = shuffle(avail).slice(0, 3);
    const sum = t.reduce((s, x) => s + x.g, 0);
    if (sum > TEAM_CAP) continue;
    if (!best || sum > best.sum) best = { t, sum };
    if (best.sum > TEAM_CAP - 40) break;
  }
  return best ? best.t : shuffle(avail).slice(0, 3);
}

/* =========================================================
   Канвас: фон
   ========================================================= */
const canvas = document.getElementById('field');
const ctx = canvas.getContext('2d');

function rr(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

let BG = null;
function buildBG() {
  BG = document.createElement('canvas'); BG.width = W; BG.height = H;
  const c = BG.getContext('2d');
  const g = c.createRadialGradient(W / 2, 250, 40, W / 2, 250, 620);
  g.addColorStop(0, '#16224a'); g.addColorStop(1, '#050810');
  c.fillStyle = g; c.fillRect(0, 0, W, H);

  c.strokeStyle = 'rgba(90,130,220,.085)'; c.lineWidth = 1;
  const s = 34;
  for (let row = -1; row * s * 1.74 < H + s; row++) {
    for (let col = -1; col * s * 1.5 < W + s; col++) {
      const cx = col * s * 1.5, cy = row * s * 1.74 + (col % 2 ? s * 0.87 : 0);
      c.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = Math.PI / 3 * k;
        const px = cx + Math.cos(a) * s, py = cy + Math.sin(a) * s;
        k ? c.lineTo(px, py) : c.moveTo(px, py);
      }
      c.closePath(); c.stroke();
    }
  }
  c.strokeStyle = 'rgba(120,170,255,.15)'; c.lineWidth = 2;
  for (const r of [130, 230, 330]) { c.beginPath(); c.arc(W / 2, 235, r, 0, 7); c.stroke(); }

  c.strokeStyle = 'rgba(255,176,32,.3)'; c.setLineDash([6, 8]); c.lineWidth = 2;
  c.beginPath(); c.moveTo(60, 470); c.lineTo(W - 60, 470); c.stroke();
  c.setLineDash([]);
  c.fillStyle = 'rgba(255,176,32,.45)'; c.font = '600 10px Segoe UI'; c.textAlign = 'center';
  c.fillText('ЗОНА БРОСКА', LX, LY + 42);
}
buildBG();

function drawLauncher(t) {
  ctx.save();
  ctx.translate(LX, LY);
  ctx.rotate(t / 900);
  ctx.strokeStyle = 'rgba(255,176,32,.55)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, 0, 20, 0, 7); ctx.stroke();
  ctx.setLineDash([4, 6]);
  ctx.beginPath(); ctx.arc(0, 0, 29, 0, 7); ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function drawSlot(i, t) {
  const sl = SLOTS[i];
  const k = 0.5 + 0.5 * Math.sin(t / 260 + i);
  ctx.save();
  ctx.globalAlpha = 0.35 + k * 0.4;
  ctx.strokeStyle = '#ffb020'; ctx.lineWidth = 2; ctx.setLineDash([7, 6]);
  rr(ctx, sl.x - 48, sl.y - 48, 96, 96, 14); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#ffb020'; ctx.font = '700 11px Segoe UI'; ctx.textAlign = 'center';
  ctx.fillText('СЮДА', sl.x, sl.y + 4);
  ctx.restore();
}

function drawGate(gt, t) {
  const col = gateColor(gt);
  const pulse = 0.5 + 0.5 * Math.sin(t / 500 + gt.slot);
  const age = Math.min(1, (t - gt.born) / 320);
  const sc = 0.55 + 0.45 * (1 - Math.pow(1 - age, 3));

  ctx.save();
  ctx.translate(gt.x, gt.y);
  ctx.scale(sc, sc);
  ctx.globalAlpha = age;

  ctx.shadowColor = col; ctx.shadowBlur = 16 + pulse * 12;
  ctx.fillStyle = 'rgba(8,14,32,.93)';
  rr(ctx, -48, -48, 96, 96, 14); ctx.fill();
  ctx.shadowBlur = 0;

  ctx.strokeStyle = col; ctx.lineWidth = 2.5;
  rr(ctx, -48, -48, 96, 96, 14); ctx.stroke();
  ctx.globalAlpha = 0.25 * age;
  ctx.lineWidth = 1;
  rr(ctx, -40, -40, 80, 80, 10); ctx.stroke();
  ctx.globalAlpha = age;

  ctx.textAlign = 'center';
  ctx.fillStyle = col;
  ctx.font = '26px Segoe UI Symbol, Segoe UI';
  ctx.fillText(gt.type === 'attr' ? ATTR[gt.attr].i : gateType(gt).icon, 0, -10);
  ctx.font = '700 11px Segoe UI'; ctx.fillStyle = '#e6ecff';
  ctx.fillText(gateTitle(gt).toUpperCase(), 0, 14);
  ctx.font = '9px Segoe UI'; ctx.fillStyle = 'rgba(190,205,240,.62)';
  wrapText(gateDesc(gt), 0, 27, 88, 10);

  // стихия карты в углу
  if (gt.type !== 'attr') {
    ctx.font = '13px Segoe UI Emoji'; ctx.textAlign = 'left';
    ctx.fillText(ATTR[gt.attr].i, -44, -30);
    ctx.textAlign = 'center';
  }

  const oc = gt.owner === 'p' ? '#37a2ff' : '#ff4b26';
  ctx.fillStyle = oc; ctx.globalAlpha = age * 0.9;
  rr(ctx, -44, 38, 88, 15, 7); ctx.fill();
  ctx.fillStyle = '#08101f'; ctx.font = '800 9px Segoe UI';
  ctx.fillText(gt.owner === 'p' ? 'ВАШИ ВРАТА' : 'ЧУЖИЕ ВРАТА', 0, 49);
  ctx.restore();

  if (gt.occupant) drawBakugan(gt.x, gt.y - 44, gt.occupant.bk, 1, gt.occupant.owner, t);
}

function wrapText(text, x, y, maxw, lh) {
  const words = text.split(' ');
  let line = '', ln = 0;
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxw && line) { ctx.fillText(line, x, y + ln * lh); line = w; ln++; }
    else line = test;
  }
  ctx.fillText(line, x, y + ln * lh);
}

/* существо на вратах: (x, y) — точка опоры под ногами */
function drawBakugan(x, y, bk, scale, owner, t) {
  const size = 58 * scale;
  const own = owner === 'p' ? '#37a2ff' : '#ff4b26';

  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = own; ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.ellipse(x, y + 1, 26 * scale + Math.sin(t / 320) * 1.5, 8 * scale, 0, 0, 7);
  ctx.stroke();
  ctx.globalAlpha = 0.16; ctx.fillStyle = own; ctx.fill();
  ctx.globalAlpha = 1;
  ctx.restore();

  CRE.blit(ctx, bk, size, x, y, owner === 'p' ? 1 : -1, undefined, 0.55);

  if (scale >= 0.9) {                              // подпись одной строкой над головой
    const ly = y - size * 1.02;
    ctx.textAlign = 'center';
    ctx.font = '700 11px Segoe UI';
    const wName = ctx.measureText(bk.name).width;
    ctx.font = '800 11px Segoe UI';
    const wG = ctx.measureText(bk.g + ' G').width;
    const wAll = wName + wG + 10;
    ctx.fillStyle = 'rgba(6,10,22,.78)';
    rr(ctx, x - wAll / 2 - 6, ly - 11, wAll + 12, 16, 8); ctx.fill();
    ctx.strokeStyle = own; ctx.lineWidth = 1; ctx.globalAlpha = 0.6; ctx.stroke(); ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
    ctx.font = '700 11px Segoe UI'; ctx.fillStyle = '#fff';
    ctx.fillText(bk.name, x - wAll / 2, ly + 1);
    ctx.fillStyle = '#ffb020'; ctx.font = '800 11px Segoe UI';
    ctx.fillText(bk.g + ' G', x - wAll / 2 + wName + 10, ly + 1);
    ctx.textAlign = 'center';
  }
}

function drawBall(t) {
  const b = S.ball; if (!b) return;
  const col = ATTR[b.bk.attr].c;

  if (b.opening !== undefined) {
    const k = Math.min(1, b.opening);
    drawBakugan(b.x, b.y, b.bk, 0.4 + 0.6 * k, b.owner, t);
    ctx.strokeStyle = col; ctx.globalAlpha = 1 - k; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(b.x, b.y - 28, 12 + k * 60, 0, 7); ctx.stroke();
    ctx.globalAlpha = 1;
    return;
  }
  for (let i = 0; i < b.trail.length; i++) {
    const p = b.trail[i], a = i / b.trail.length;
    ctx.globalAlpha = a * 0.4; ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(p.x, p.y, 11 * a, 0, 7); ctx.fill();
  }
  ctx.globalAlpha = 1;

  CRE.ball(ctx, b.bk, 14, b.rot, { x: b.x, y: b.y });
}

function drawAim() {
  const len = 300;
  ctx.save(); ctx.translate(LX, LY); ctx.rotate(S.aim.ang);
  ctx.setLineDash([10, 9]);
  ctx.strokeStyle = 'rgba(255,176,32,.75)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0, -26); ctx.lineTo(0, -len); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#ffb020';
  ctx.beginPath(); ctx.moveTo(0, -len - 14); ctx.lineTo(-9, -len + 4); ctx.lineTo(9, -len + 4); ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawPower() {
  const x = 40, y = 300, w = 22, h = 190;
  ctx.fillStyle = 'rgba(0,0,0,.55)'; rr(ctx, x - 4, y - 4, w + 8, h + 8, 8); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.2)'; ctx.lineWidth = 1;
  rr(ctx, x - 4, y - 4, w + 8, h + 8, 8); ctx.stroke();
  const p = S.aim.pow;
  const g = ctx.createLinearGradient(0, y + h, 0, y);
  g.addColorStop(0, '#3fd18b'); g.addColorStop(0.55, '#ffb020'); g.addColorStop(1, '#ff3b1e');
  ctx.fillStyle = g; rr(ctx, x, y + h * (1 - p), w, h * p, 5); ctx.fill();
  ctx.fillStyle = '#dfe7ff'; ctx.font = '700 10px Segoe UI'; ctx.textAlign = 'center';
  ctx.fillText('СИЛА', x + w / 2, y + h + 22);
  ctx.fillText(Math.round(p * 100) + '%', x + w / 2, y - 12);
}

function drawFx(t) {
  S.fx = S.fx.filter(f => t - f.t < f.life);
  for (const f of S.fx) {
    const k = (t - f.t) / f.life;
    ctx.globalAlpha = 1 - k;
    if (f.kind === 'ring') {
      ctx.strokeStyle = f.col; ctx.lineWidth = 5 * (1 - k);
      ctx.beginPath(); ctx.arc(f.x, f.y, 10 + k * 90, 0, 7); ctx.stroke();
    } else {
      ctx.fillStyle = f.col; ctx.font = '800 20px Segoe UI'; ctx.textAlign = 'center';
      ctx.shadowColor = '#000'; ctx.shadowBlur = 8;
      ctx.fillText(f.text, f.x, f.y - k * 40);
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
  }
}
function fx(kind, x, y, col, text) {
  S.fx.push({ kind, x, y, col, text, t: performance.now(), life: kind === 'ring' ? 700 : 1100 });
}

/* =========================================================
   Главный цикл
   ========================================================= */
function loop(t) {
  requestAnimationFrame(loop);
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(BG, 0, 0);
  if (!S) { drawLauncher(t); return; }

  if (S.phase === 'aim') {
    S.aim.ang += 0.028 * S.aim.dir;
    if (S.aim.ang > 1.15) { S.aim.ang = 1.15; S.aim.dir = -1; }
    if (S.aim.ang < -1.15) { S.aim.ang = -1.15; S.aim.dir = 1; }
  }
  if (S.phase === 'power') {
    S.aim.pow += 0.019 * S.aim.pdir;
    if (S.aim.pow > 1) { S.aim.pow = 1; S.aim.pdir = -1; }
    if (S.aim.pow < 0.05) { S.aim.pow = 0.05; S.aim.pdir = 1; }
  }
  if (S.phase === 'flying') stepBall();

  if (S.phase === 'placeGate' && S.turn === 'p' && S.placing !== null)
    freeSlots().forEach(i => drawSlot(i, t));

  drawLauncher(t);
  for (const g of S.gates) drawGate(g, t);
  drawBall(t);
  if (S.phase === 'aim' || S.phase === 'power') drawAim();
  if (S.phase === 'power') drawPower();
  drawFx(t);

  ctx.textAlign = 'left'; ctx.font = '700 12px Segoe UI';
  ctx.fillStyle = S.turn === 'p' ? 'rgba(55,162,255,.85)' : 'rgba(255,75,38,.85)';
  ctx.fillText(S.turn === 'p' ? '► ВАШ ХОД' : '► ХОД МАСКЕРАДА', 20, 30);
}
requestAnimationFrame(loop);

/* ---------- физика ---------- */
function stepBall() {
  const b = S.ball;
  if (b.opening !== undefined) {
    b.opening += 0.055;
    if (b.opening >= 1) resolveLanding();
    return;
  }
  b.x += b.vx; b.y += b.vy;
  b.vx *= FR; b.vy *= FR;
  const sp = Math.hypot(b.vx, b.vy);
  b.rot += sp * 0.07;
  SFX.rollSet(sp);

  const R = 14;
  let hit = false;
  if (b.x < R) { b.x = R; b.vx = Math.abs(b.vx) * 0.72; hit = true; }
  if (b.x > W - R) { b.x = W - R; b.vx = -Math.abs(b.vx) * 0.72; hit = true; }
  if (b.y < R) { b.y = R; b.vy = Math.abs(b.vy) * 0.72; hit = true; }
  if (b.y > H - R) { b.y = H - R; b.vy = -Math.abs(b.vy) * 0.72; hit = true; }
  if (hit && sp > 1.2) SFX.bounce();

  b.trail.push({ x: b.x, y: b.y });
  if (b.trail.length > 14) b.trail.shift();

  if (sp < STOP) {
    b.vx = b.vy = 0;
    SFX.rollStop();
    let gt;
    if (b.forced) {                                // исход прислал соперник
      gt = b.forced.gate === null || b.forced.gate === undefined
        ? null : S.gates.find(g => g.slot === b.forced.gate);
    } else {
      gt = S.gates.find(g => Math.hypot(g.x - b.x, g.y - b.y) < GATE_R);
    }
    b.gate = gt || null;
    b.seed = b.forced ? b.forced.seed : Math.floor(Math.random() * 1e9);
    if (gt) { b.x = gt.x; b.y = gt.y - 44; fx('ring', gt.x, gt.y, gateColor(gt)); SFX.open(); }
    else SFX.miss();
    b.opening = 0;
  }
}

/* прогон физики без отрисовки: куда упадёт шар при таких угле и силе */
function simulateThrow(ang, pow) {
  const v0 = 2.0 + pow * 9.0, R = 14;
  let x = LX, y = LY, vx = Math.sin(ang) * v0, vy = -Math.cos(ang) * v0;
  for (let i = 0; i < 5000; i++) {
    x += vx; y += vy; vx *= FR; vy *= FR;
    const sp = Math.hypot(vx, vy);
    if (x < R) { x = R; vx = Math.abs(vx) * 0.72; }
    if (x > W - R) { x = W - R; vx = -Math.abs(vx) * 0.72; }
    if (y < R) { y = R; vy = Math.abs(vy) * 0.72; }
    if (y > H - R) { y = H - R; vy = -Math.abs(vy) * 0.72; }
    if (sp < STOP) break;
  }
  const gt = S.gates.find(g => Math.hypot(g.x - x, g.y - y) < GATE_R);
  return gt ? gt.slot : null;
}

function throwBall(owner, bk, ang, pow, forced) {
  const v0 = 2.0 + pow * 9.0;
  S.ball = { x: LX, y: LY, vx: Math.sin(ang) * v0, vy: -Math.cos(ang) * v0,
             rot: 0, trail: [], owner, bk, forced: forced || null };
  bk.where = 'field';
  S.phase = 'flying';
  SFX.throwBall(); SFX.rollStart();
  renderAll();
}

function resolveLanding() {
  const b = S.ball; const gt = b.gate;
  S.ball = null;

  if (!gt) {
    b.bk.where = 'hand';
    fx('text', b.x, b.y, '#ff8e7a', 'МИМО!');
    setHint((b.owner === 'p' ? 'Вы промахнулись' : OPPNAME + ' промахнулся') + ' — бакуган возвращается в руку.');
    endTurn(); return;
  }
  if (gt.occupant && gt.occupant.owner === b.owner) {
    b.bk.where = 'hand';
    fx('text', gt.x, gt.y - 100, '#ff8e7a', 'ЗАНЯТО');
    setHint('На этих вратах уже стоит свой бакуган — бросок пропал.');
    endTurn(); return;
  }
  if (gt.occupant) {
    startBattle(gt, { owner: b.owner, bk: b.bk }, gt.occupant, b.seed);
    return;
  }
  gt.occupant = { owner: b.owner, bk: b.bk };
  fx('text', gt.x, gt.y - 110, gateColor(gt), 'ОТКРЫТ!');
  setHint((b.owner === 'p' ? 'Ваш ' : 'Бакуган соперника ') + '<b>' + b.bk.name + '</b> занял «' + gateTitle(gt) + '».');
  renderAll();
  endTurn();
}

/* =========================================================
   Ходы
   ========================================================= */
const freeSlots = () => SLOTS.map((_, i) => i).filter(i => !S.gates.some(g => g.slot === i));
const canPlace = side => S.gates.length < MAX_GATES && freeSlots().length > 0 && S[side].gateHand.length > 0;

function startTurn() {
  if (!S || S.phase === 'over') return;
  S.selected = null; S.placing = null;
  const side = S[S.turn];
  if (!side.team.some(b => b.where === 'hand')) {
    setHint((S.turn === 'p' ? 'У вас' : 'У ' + esc(OPPNAME)) + ' нет бакуганов в руке — ход пропущен.');
    setTimeout(() => { S.turn = S.turn === 'p' ? 'a' : 'p'; startTurn(); }, 1500);
    return;
  }
  if (MODE === 'mp' && S.turn === 'a') {
    S.phase = 'wait';
    setHint('Ход соперника: <b>' + esc(OPPNAME) + '</b>…');
    renderAll();
    MP.pump();
    return;
  }
  if (canPlace(S.turn)) {
    S.phase = 'placeGate';
    setHint(S.turn === 'p'
      ? 'Ваш ход: выложите <b>карту врат</b> — выберите её внизу, затем площадку на поле.'
      : OPPNAME + ' выкладывает карту врат…');
  } else {
    S.phase = 'select';
    setHint(S.turn === 'p' ? 'Выберите бакугана и бросьте его на поле.' : OPPNAME + ' готовит бросок…');
  }
  renderAll();
  if (S.turn === 'a') setTimeout(aiAct, 900);
}

function endTurn() {
  renderAll();
  S.turn = S.turn === 'p' ? 'a' : 'p';
  S.phase = 'idle';
  setTimeout(startTurn, 1300);
}

function placeGateCard(owner, card, slot, x, y) {
  const sl = SLOTS[slot];
  S.gates.push({
    id: card.id || ++uid, slot,
    x: x === undefined ? sl.x + rnd(-8, 8) : x,
    y: y === undefined ? sl.y + rnd(-8, 8) : y,
    type: card.type, attr: card.attr, owner, occupant: null, born: performance.now()
  });
  SFX.place();
  fx('ring', sl.x, sl.y, owner === 'p' ? '#37a2ff' : '#ff4b26');
  S.placing = null;
  if (!(MODE === 'mp' && owner === 'a')) S.phase = 'select';
  renderAll();
}

function placeGate(owner, cardIdx, slot) {
  const side = S[owner];
  const card = side.gateHand.splice(cardIdx, 1)[0];
  if (side.gateDeck.length) side.gateHand.push(side.gateDeck.pop());
  const sl = SLOTS[slot];
  const x = sl.x + rnd(-8, 8), y = sl.y + rnd(-8, 8);
  placeGateCard(owner, card, slot, x, y);
  if (MODE === 'mp' && owner === 'p')
    MP.send({ t: 'gate', slot, type: card.type, attr: card.attr, x, y,
              hand: side.gateHand.length, deck: side.gateDeck.length });
}

/* ---------- ИИ ---------- */
function aiAct() {
  if (!S || S.turn !== 'a') return;
  if (S.phase === 'placeGate') {
    const hand = S.a.gateHand, slots = freeSlots();
    const strongest = S.a.team.reduce((m, b) => b.g > m.g ? b : m, S.a.team[0]);
    let bi = 0, bv = -1e9;
    hand.forEach((c, i) => {
      let v = rnd(0, 20);
      if (c.attr === strongest.attr) v += c.type === 'attr' ? 60 : 25;
      if (c.type === 'fortress') v += 40;
      if (c.type === 'underdog') v += 15;
      if (c.type === 'silence') v += 25;
      v *= DIFF.smart;
      if (v > bv) { bv = v; bi = i; }
    });
    placeGate('a', bi, pick(slots));
    setHint(OPPNAME + ' выложил карту врат. Теперь его бросок…');
    setTimeout(aiThrow, 900);
    return;
  }
  aiThrow();
}

function aiThrow() {
  if (!S || S.turn !== 'a' || S.phase !== 'select') return;
  const hand = S.a.team.filter(b => b.where === 'hand');
  if (!hand.length || !S.gates.length) { endTurn(); return; }

  let best = null;
  for (const gt of S.gates) {
    for (const bk of hand) {
      let score;
      if (!gt.occupant) score = 40 + (gt.type === 'attr' && gt.attr === bk.attr ? 40 : 0) + (gt.owner === 'a' ? 20 : 0);
      else if (gt.occupant.owner === 'a') score = -200;
      else { const e = estimate(gt, bk, gt.occupant.bk); score = 60 + (e.a - e.d) / 4; }
      score = score * DIFF.smart + rnd(-15, 15);
      if (!best || score > best.score) best = { gt, bk, score };
    }
  }
  const dx = best.gt.x - LX, dy = best.gt.y - LY;
  const dist = Math.hypot(dx, dy);
  const ang = Math.atan2(dx, -dy) + rnd(-DIFF.aim, DIFF.aim);
  const v = (dist / DF) * (1 + rnd(-DIFF.pow, DIFF.pow));
  const pow = Math.max(0.05, Math.min(1, (v - 2.0) / 9.0));
  throwBall('a', best.bk, ang, pow);
}

/* грубая оценка исхода без карт способностей */
function estimate(gt, aBk, dBk) {
  let a = aBk.g, d = dBk.g;
  if (gt.owner === 'a') a += HOME_BONUS; else d += HOME_BONUS;
  if (gt.type === 'attr') {
    if (gt.attr === aBk.attr) a += 150;
    if (gt.attr === dBk.attr) d += 150;
  } else {
    if (gt.attr === aBk.attr) a += RESONANCE;
    if (gt.attr === dBk.attr) d += RESONANCE;
  }
  if (gt.type === 'swap') { const x = a; a = d; d = x; }
  if (gt.type === 'underdog') { if (aBk.g < dBk.g) a += 250; else if (dBk.g < aBk.g) d += 250; }
  if (gt.type === 'fortress') d += 200;
  if (gt.type !== 'mirror') {
    if (beats(aBk.attr, dBk.attr)) a += 100;
    if (beats(dBk.attr, aBk.attr)) d += 100;
  }
  return { a, d };
}

/* =========================================================
   Битва
   ========================================================= */
const bOv = document.getElementById('battleOverlay');
const bBox = document.getElementById('battleBox');
const bGate = document.getElementById('bGate');
const bLeft = document.getElementById('bLeft');
const bRight = document.getElementById('bRight');
const bPick = document.getElementById('bPick');
const bLog = document.getElementById('bLog');
const bBtn = document.getElementById('bBtn');
const bfx = document.getElementById('bfx');
const bx = bfx.getContext('2d');

function sideHTML(x, role) {
  const A = ATTR[x.bk.attr];
  return `<div class="orb cre big" style="--ac:${A.c}" data-cre="${esc(x.bk.name)}"></div>
    <div class="nm">${x.bk.name}</div>
    <div class="at">${A.n} · ${x.owner === 'p' ? esc(PROFILE.user.username) : esc(OPPNAME)}</div>
    <div class="pw" id="pw_${x.owner}">${x.bk.g}<small>G-СИЛА</small></div>
    <div class="role">${role}</div>`;
}

async function startBattle(gt, attacker, defender, seed) {
  S.phase = 'battle';
  S.battleNo = (S.battleNo || 0) + 1;
  const battleNo = S.battleNo;
  const pSide = attacker.owner === 'p' ? attacker : defender;
  const aSide = attacker.owner === 'p' ? defender : attacker;
  const b = S.battle = { gt, attacker, defender, pSide, aSide, abA: null, abD: null, seed, no: battleNo };

  const home = gt.owner === 'p' ? 'Это ваши врата' : 'Это врата Маскерада';
  bGate.innerHTML = `Врата: <b>${gateTitle(gt)}</b> ${ATTR[gt.attr].i} — ${gateDesc(gt)}
    <span class="home">${home}: +${HOME_BONUS} G хозяину</span>`;
  bLeft.className = 'bside'; bRight.className = 'bside';
  bLeft.innerHTML = sideHTML(pSide, pSide === attacker ? 'АТАКУЮЩИЙ' : 'ЗАЩИТНИК');
  bRight.innerHTML = sideHTML(aSide, aSide === attacker ? 'АТАКУЮЩИЙ' : 'ЗАЩИТНИК');
  CRE.apply(bLeft); CRE.apply(bRight);
  bLog.innerHTML = ''; bPick.innerHTML = '';
  bBtn.classList.add('hidden');
  bOv.classList.remove('hidden');
  idleFx(b);
  SFX.battle();
  await sleep(750);

  let pAb = null, aAb = null;
  if (gt.type === 'silence') {
    bPick.innerHTML = '<div class="ttl silence">✖ ВРАТА «ТИШИНА» — КАРТЫ СПОСОБНОСТЕЙ ЗАБЛОКИРОВАНЫ</div>';
    await sleep(1200);
  } else if (MODE === 'mp') {
    const mine = askAbility(battleNo);
    const theirs = MP.waitAbility(battleNo);
    pAb = await mine;
    const wait = document.createElement('div');
    wait.className = 'aireveal';
    wait.innerHTML = '<div class="acard ai empty2">Ждём выбор соперника…</div>';
    bPick.appendChild(wait);
    aAb = await theirs;
    wait.remove();
    await revealAiAbility(aAb);
  } else {
    pAb = await askAbility();
    aAb = aiAbility();
    await revealAiAbility(aAb);
  }
  b.abA = attacker.owner === 'p' ? pAb : aAb;
  b.abD = defender.owner === 'p' ? pAb : aAb;

  const res = computeBattle(b);
  b.result = res;
  await battleAnim(b, res);
  await showResult(b, res);
}

function abilityCardHTML(c, i, cls) {
  const A = ATTR[c.attr];
  return `<div class="acard ${cls || ''}" style="--ac:${A.c}" data-i="${i}">
    <div class="ic">${c.icon}</div>
    <div><b>${c.name}</b><span>${c.desc}</span>
      <span class="attrtag" style="color:${A.c}">${A.i} ${A.n}</span></div></div>`;
}

function askAbility(battleNo) {
  return new Promise(resolve => {
    let html = '<div class="ttl">ВЫБЕРИТЕ КАРТУ СПОСОБНОСТИ</div><div class="row">';
    S.p.abil.forEach((c, i) => { html += abilityCardHTML(c, i, 'pick'); });
    html += `<div class="acard pick skip" data-i="-1"><div class="ic">🚫</div>
      <div><b>Пропустить</b><span>Сражаться без карты</span></div></div></div>`;
    bPick.innerHTML = html;
    bPick.querySelectorAll('.acard.pick').forEach(el => {
      el.onmouseenter = () => SFX.hover();
      el.onclick = () => {
        const i = +el.dataset.i;
        let card = null;
        if (i >= 0) {
          card = S.p.abil[i];
          S.p.abil.splice(i, 1);
          S.p.abil.push(pick(S.p.abilPool));
          SFX.ability();
        } else SFX.click();
        if (MODE === 'mp')
          MP.send({ t: 'ability', b: battleNo, card: card ? { id: card.id, attr: card.attr } : null });
        bPick.querySelectorAll('.acard').forEach(x => { x.classList.remove('pick'); x.onclick = null; });
        el.classList.add('chosen');
        renderAbilities();
        setTimeout(() => resolve(card), 380);
      };
    });
  });
}

function aiAbility() {
  const b = S.battle;
  const e = estimate(b.gt, b.attacker.bk, b.defender.bk);
  const aiIsAtt = b.attacker.owner === 'a';
  const mine = aiIsAtt ? e.a : e.d, theirs = aiIsAtt ? e.d : e.a;
  const gap = theirs - mine;
  const myAttr = (aiIsAtt ? b.attacker : b.defender).bk.attr;
  const opAttr = (aiIsAtt ? b.defender : b.attacker).bk.attr;

  if (gap < -180 && Math.random() < 0.5) return null;
  if (Math.random() > DIFF.smart)
    return Math.random() < 0.5 ? null : takeAiCard(Math.floor(Math.random() * S.a.abil.length));

  let bi = -1, bv = 0;
  S.a.abil.forEach((c, i) => {
    let v = 0;
    if (c.id === 'boost') v = 150;
    if (c.id === 'drain') v = 120;
    if (c.id === 'fury') v = 100 + (beats(myAttr, opAttr) ? 150 : 0);
    if (c.id === 'copy') v = (theirs + 60) - mine;
    if (c.id === 'swap') v = gap > 0 ? gap * 1.8 : -250;
    if (c.id === 'shield') v = 130;
    if (c.id === 'hack') v = b.gt.type === 'normal' ? -60 : 110;
    if (c.id === 'twin') v = gap > 0 ? gap / 2 + 80 : -100;
    if (c.attr === myAttr) v += RESONANCE;
    v += rnd(-25, 25);
    if (v > bv) { bv = v; bi = i; }
  });
  return bi < 0 ? null : takeAiCard(bi);
}
function takeAiCard(i) {
  const c = S.a.abil[i];
  S.a.abil.splice(i, 1);
  S.a.abil.push(pick(S.a.abilPool));
  return c;
}

async function revealAiAbility(card) {
  const el = document.createElement('div');
  el.className = 'aireveal';
  if (card) {
    const A = ATTR[card.attr];
    el.innerHTML = `<div class="acard ai flip" style="--ac:${A.c}"><div class="ic">${card.icon}</div>
      <div><b>${esc(OPPNAME)}: ${card.name}</b><span>${card.desc}</span>
      <span class="attrtag" style="color:${A.c}">${A.i} ${A.n}</span></div></div>`;
  } else {
    el.innerHTML = `<div class="acard ai flip empty2">${esc(OPPNAME)} не играет карту способности</div>`;
  }
  bPick.appendChild(el);
  if (card) SFX.ability(); else SFX.tick();
  renderAiMeta();
  await sleep(800);
}

/* =========================================================
   Анимация боя: разбег — удар — защита — развязка
   ========================================================= */
const FIG = 132;                       // рост бойца в окне боя
const GROUND = 190;                    // линия ног

const lerp = (a, b, t) => a + (b - a) * t;
const ease = x => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
const seg = (t, a, b) => ease((t - a) / (b - a));
function rgba(hex, a) {
  const h = hex.replace('#', '');
  return 'rgba(' + parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) +
         ',' + parseInt(h.slice(4, 6), 16) + ',' + a + ')';
}

function clearFxCanvas() { bx.clearRect(0, 0, bfx.width, bfx.height); }

function arenaBg(L, R) {
  const CW = bfx.width, CH = bfx.height;
  bx.clearRect(0, 0, CW, CH);
  const grd = bx.createLinearGradient(0, 0, CW, 0);
  grd.addColorStop(0, rgba(L.col, 0.22));
  grd.addColorStop(0.5, 'rgba(0,0,0,0)');
  grd.addColorStop(1, rgba(R.col, 0.22));
  bx.fillStyle = grd; bx.fillRect(0, 0, CW, CH);
  bx.strokeStyle = 'rgba(255,255,255,.05)'; bx.lineWidth = 1;
  for (let i = 0; i < 14; i++) {
    bx.beginPath(); bx.moveTo(i * CW / 14, 0); bx.lineTo(i * CW / 14 + 40, CH); bx.stroke();
  }
  const fl = bx.createLinearGradient(0, GROUND - 20, 0, CH);
  fl.addColorStop(0, 'rgba(255,255,255,0)');
  fl.addColorStop(1, 'rgba(120,160,255,.12)');
  bx.fillStyle = fl; bx.fillRect(0, GROUND - 20, CW, CH - GROUND + 20);
  bx.strokeStyle = 'rgba(150,190,255,.25)'; bx.lineWidth = 1.5;
  bx.beginPath(); bx.moveTo(0, GROUND + 4); bx.lineTo(CW, GROUND + 4); bx.stroke();
}

function fighter(x, side, dir, o) {
  o = o || {};
  bx.save();
  bx.translate(x, GROUND + (o.dy || 0));
  if (o.tilt) bx.rotate(o.tilt);
  if (o.scale) bx.scale(o.scale, o.scale);
  if (o.alpha !== undefined) bx.globalAlpha = o.alpha;
  CRE.blit(bx, side.bk, FIG, 0, 0, dir, undefined, o.glow);
  bx.globalAlpha = 1;
  bx.restore();
}

/* щит защитника: гранёная дуга, обращённая к атакующему */
function barrier(cx, cy, aDir, col, k, hit, cracks) {
  if (k <= 0) return;
  const r0 = 46, r1 = 70;
  bx.save(); bx.translate(cx, cy);
  if (aDir > 0) bx.scale(-1, 1);
  bx.globalAlpha = Math.min(1, k);
  const g = bx.createRadialGradient(0, 0, r0, 0, 0, r1);
  g.addColorStop(0, rgba(col, 0.05));
  g.addColorStop(0.55, rgba(col, 0.32 + hit * 0.5));
  g.addColorStop(1, rgba(col, 0.05));
  bx.beginPath(); bx.arc(0, 0, r1, -1.25, 1.25); bx.arc(0, 0, r0, 1.25, -1.25, true); bx.closePath();
  bx.fillStyle = g; bx.fill();
  bx.strokeStyle = hit > 0.3 ? '#ffffff' : rgba(col, 0.95);
  bx.lineWidth = 2.5 + hit * 2.5;
  bx.shadowColor = col; bx.shadowBlur = 12 + hit * 20;
  bx.stroke(); bx.shadowBlur = 0;
  bx.strokeStyle = rgba(col, 0.55); bx.lineWidth = 1.2;
  for (let i = -3; i <= 3; i++) {
    const a = i * 0.36;
    bx.beginPath();
    bx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
    bx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
    bx.stroke();
  }
  bx.beginPath(); bx.arc(0, 0, (r0 + r1) / 2, -1.25, 1.25); bx.stroke();
  if (cracks > 0) {                                   // трещины перед разрушением
    bx.strokeStyle = '#ffffff'; bx.lineWidth = 1.8;
    bx.globalAlpha = Math.min(1, k) * cracks;
    for (let i = -2; i <= 2; i++) {
      const a = i * 0.42;
      bx.beginPath();
      bx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      bx.lineTo(Math.cos(a + 0.12) * (r0 + r1) / 2, Math.sin(a + 0.12) * (r0 + r1) / 2);
      bx.lineTo(Math.cos(a - 0.1) * r1, Math.sin(a - 0.1) * r1);
      bx.stroke();
    }
  }
  bx.restore();
}

/* рассекающие дуги удара */
function slashFx(x, y, aDir, col, p) {
  bx.save(); bx.translate(x, y);
  if (aDir < 0) bx.scale(-1, 1);
  for (let i = 0; i < 3; i++) {
    const off = (i - 1) * 20;
    bx.globalAlpha = Math.max(0, 1 - p) * 0.95;
    bx.strokeStyle = i === 1 ? '#ffffff' : col;
    bx.lineWidth = (7 - i * 1.6) * (1 - p * 0.5);
    bx.shadowColor = col; bx.shadowBlur = 14;
    bx.beginPath();
    bx.arc(-28, off * 0.5, 54 + i * 8, -1.0 + p * 0.5, 1.0 + p * 0.5);
    bx.stroke();
  }
  bx.shadowBlur = 0; bx.globalAlpha = 1;
  bx.restore();
}

function burst(parts, x, y, n, cols, power) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, sp = rnd(2, 6 + power * 6);
    parts.push({
      x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.7,
      col: pick(cols), r: rnd(1.4, 4.4), life: 1
    });
  }
}
function drawParts(parts, dt) {
  const k = Math.min(3, dt * 60);
  for (const p of parts) {
    p.x += p.vx * k; p.y += p.vy * k;
    p.vx *= Math.pow(0.955, k); p.vy *= Math.pow(0.955, k); p.vy += 0.15 * k;
    p.life -= 0.02 * k;
    if (p.life <= 0) continue;
    bx.globalAlpha = Math.max(0, p.life);
    bx.fillStyle = p.col;
    bx.beginPath(); bx.arc(p.x, p.y, p.r, 0, 7); bx.fill();
  }
  bx.globalAlpha = 1;
}

function abilityMark(side, x, k, col) {
  if (!side.ab || k < 0.03) return;
  const a = Math.min(1, k * 8);
  const y = GROUND - FIG - 16 - (1 - a) * 14;
  bx.save();
  bx.globalAlpha = a * 0.85;
  bx.beginPath(); bx.arc(x, y - 7, 20 + Math.sin(k * 14) * 2, 0, 7);
  bx.strokeStyle = col; bx.lineWidth = 2; bx.shadowColor = col; bx.shadowBlur = 12;
  bx.stroke(); bx.shadowBlur = 0;
  bx.globalAlpha = a;
  bx.font = '24px Segoe UI Emoji'; bx.textAlign = 'center';
  bx.fillText(side.ab.icon, x, y);
  bx.globalAlpha = 1;
  bx.restore();
}

function idleFx(b) {
  const CW = bfx.width;
  const L = { bk: b.pSide.bk, col: ATTR[b.pSide.bk.attr].c, ab: null };
  const R = { bk: b.aSide.bk, col: ATTR[b.aSide.bk.attr].c, ab: null };
  arenaBg(L, R);
  fighter(100, L, 1, {});
  fighter(CW - 100, R, -1, {});
  bx.fillStyle = 'rgba(220,230,255,.55)';
  bx.font = '800 24px Segoe UI'; bx.textAlign = 'center';
  bx.fillText('VS', CW / 2, GROUND - 62);
}

/* главная анимация — знает исход, поэтому показывает пробитие или отбой */
function battleAnim(b, res) {
  return new Promise(resolve => {
    const CW = bfx.width;
    const L = { bk: b.pSide.bk, col: ATTR[b.pSide.bk.attr].c, ab: b.pSide === b.attacker ? b.abA : b.abD };
    const R = { bk: b.aSide.bk, col: ATTR[b.aSide.bk.attr].c, ab: b.aSide === b.attacker ? b.abA : b.abD };
    const atkIsL = b.attacker === b.pSide;
    const A = atkIsL ? L : R, D = atkIsL ? R : L;
    const aDir = atkIsL ? 1 : -1;                  // куда летит атака
    const homeA = atkIsL ? 100 : CW - 100;
    const homeD = atkIsL ? CW - 100 : 100;
    const meetA = CW / 2 - aDir * 58;
    const atkWins = res.attWins;

    const T = 3900, t0 = performance.now();
    const parts = [];
    const done = {};
    let cracks = 0, shieldOn = 0, broken = false, caption = null;
    let boomT = -1, hitT = -1, prevT = 0;

    SFX.charge();

    const frame = now => {
      const t = Math.min(1, (now - t0) / T);
      const dt = Math.max(0, (t - prevT) * T / 1000); prevT = t;
      const flash = boomT < 0 ? 0 : Math.max(0, 1 - (t - boomT) / 0.14);
      const hit = hitT < 0 ? 0 : Math.max(0, 1 - (t - hitT) / 0.12);
      arenaBg(L, R);

      /* ---- позиции ---- */
      let ax = homeA, dx = homeD, aTilt = 0, dTilt = 0, aAlpha = 1, dAlpha = 1, aDy = 0, dDy = 0;

      if (t < 0.13) {                                   // изготовка
        ax = homeA - aDir * 6 * seg(t, 0, 0.13);
      } else if (t < 0.36) {                            // разбег
        ax = lerp(homeA - aDir * 6, meetA, seg(t, 0.13, 0.36));
        dx = homeD + aDir * 8 * seg(t, 0.18, 0.36);
        dTilt = -aDir * 0.06 * seg(t, 0.18, 0.36);
      } else if (t < 0.5) {                             // удар в щит
        ax = meetA + Math.sin(t * 90) * 2;
        dx = homeD + aDir * (8 + 6 * seg(t, 0.36, 0.5));
        dTilt = -aDir * 0.1;
      } else if (t < 0.68) {                            // развязка обмена
        if (atkWins) {
          ax = meetA - aDir * 6 * Math.sin(seg(t, 0.5, 0.68) * 3.14);
          dx = homeD + aDir * 14;
          dTilt = -aDir * 0.12;
        } else {
          ax = lerp(meetA, homeA - aDir * 34, seg(t, 0.5, 0.68));
          aTilt = -aDir * 0.3 * seg(t, 0.5, 0.68);
          dx = homeD + aDir * 6;
        }
      } else if (t < 0.86) {                            // добивание
        if (atkWins) {
          ax = lerp(meetA, homeD - aDir * 74, seg(t, 0.68, 0.8));
          dx = lerp(homeD + aDir * 14, homeD + aDir * 52, seg(t, 0.72, 0.86));
          dTilt = -aDir * 0.5 * seg(t, 0.72, 0.86);
          dDy = 8 * seg(t, 0.74, 0.86);
        } else {
          ax = homeA - aDir * 34;
          aTilt = -aDir * (0.3 + 0.25 * seg(t, 0.68, 0.86));
          aDy = 10 * seg(t, 0.7, 0.86);
          dx = lerp(homeD, homeA + aDir * 108, seg(t, 0.68, 0.8));
        }
      } else {                                          // исход
        if (atkWins) {
          ax = homeD - aDir * 74; dx = homeD + aDir * 52;
          dTilt = -aDir * 0.5; dDy = 8; dAlpha = 0.65;
        } else {
          ax = homeA - aDir * 34; aTilt = -aDir * 0.55; aDy = 10; aAlpha = 0.65;
          dx = lerp(homeA + aDir * 108, homeD - aDir * 20, seg(t, 0.88, 1));
        }
      }

      /* ---- события со звуком ---- */
      if (t > 0.13 && !done.lunge) { done.lunge = 1; SFX.lunge(); }
      if (t > 0.2) shieldOn = Math.min(1, seg(t, 0.2, 0.34));
      if (t > 0.36 && !done.hit) {
        done.hit = 1; hitT = t; SFX.slash(); SFX.guard();
        burst(parts, dx - aDir * 52, GROUND - 68, 26, ['#ffffff', A.col, D.col], 0.6);
        bBox.classList.add('shake'); setTimeout(() => bBox.classList.remove('shake'), 420);
      }
      if (atkWins && t > 0.5 && t < 0.68) cracks = seg(t, 0.5, 0.64);
      if (atkWins && t > 0.64 && !done.broken) {
        done.broken = 1; broken = true; SFX.shatter();
        burst(parts, dx - aDir * 52, GROUND - 68, 34, ['#ffffff', D.col], 0.9);
      }
      if (!atkWins && t > 0.5 && !done.recoil) { done.recoil = 1; SFX.thud(); }
      if (t > 0.68 && !done.final) {
        done.final = 1; SFX.counter();
        setTimeout(() => SFX.clash(), 120);
      }
      if (t > 0.78 && !done.boom) {
        done.boom = 1; boomT = t;
        const bp = atkWins ? homeD + aDir * 10 : homeA - aDir * 10;
        burst(parts, bp, GROUND - 70, 70, ['#ffffff', A.col, D.col], 1.2);
        bBox.classList.add('shake'); setTimeout(() => bBox.classList.remove('shake'), 480);
        caption = atkWins ? 'ЗАЩИТА ПРОБИТА' : 'АТАКА ОТБИТА';
      }

      /* ---- отрисовка ---- */
      const shX = dx - aDir * 50, shY = GROUND - 66;
      if (!broken) barrier(shX, shY, aDir, D.col, shieldOn, hit, cracks);

      if (t > 0.13 && t < 0.4) {                        // шлейф разбега
        for (let i = 3; i >= 1; i--) fighter(ax - aDir * i * 17, A, aDir, { alpha: 0.08 * i });
      }
      if (!atkWins && t > 0.68 && t < 0.86) {           // шлейф контратаки
        for (let i = 3; i >= 1; i--) fighter(dx + aDir * i * 17, D, -aDir, { alpha: 0.08 * i });
      }

      fighter(ax, A, aDir, { tilt: aTilt, alpha: aAlpha, dy: aDy, glow: t > 0.86 && atkWins ? 0.9 : 0.55 });
      fighter(dx, D, -aDir, { tilt: dTilt, alpha: dAlpha, dy: dDy, glow: t > 0.86 && !atkWins ? 0.9 : 0.55 });

      if (hit > 0.02) slashFx(shX, shY, aDir, A.col, 1 - hit);
      drawParts(parts, dt);

      abilityMark(L, atkIsL ? ax : dx, seg(t, 0.03, 0.13), L.col);
      abilityMark(R, atkIsL ? dx : ax, seg(t, 0.03, 0.13), R.col);

      if (flash > 0) {                                  // вспышка и ударные волны
        const c = atkWins ? homeD + aDir * 10 : homeA - aDir * 10;
        bx.globalAlpha = flash * 0.85; bx.fillStyle = '#fff';
        bx.fillRect(0, 0, CW, bfx.height);
        bx.globalAlpha = 1;
        for (const n of [0, 1, 2]) {
          const p = Math.max(0, Math.min(1, (1 - flash) * 1.5 - n * 0.15));
          if (p <= 0 || p >= 1) continue;
          bx.globalAlpha = 1 - p;
          bx.strokeStyle = n % 2 ? A.col : D.col; bx.lineWidth = 6 * (1 - p);
          bx.beginPath(); bx.arc(c, GROUND - 66, 20 + p * 240, 0, 7); bx.stroke();
          bx.globalAlpha = 1;
        }
      }

      if (caption && t > 0.8) {                         // подпись исхода
        const a = Math.min(1, (t - 0.8) * 9);
        bx.globalAlpha = a;
        bx.font = '900 26px Segoe UI'; bx.textAlign = 'center';
        bx.lineWidth = 6; bx.strokeStyle = '#0a0d18';
        bx.strokeText(caption, CW / 2, 44);
        bx.fillStyle = atkWins ? '#ffb020' : '#7ee2a8';
        bx.fillText(caption, CW / 2, 44);
        bx.globalAlpha = 1;
      }

      if (t < 1) requestAnimationFrame(frame); else resolve();
    };
    requestAnimationFrame(frame);
  });
}

/* ---------- расчёт ---------- */
function computeBattle(b) {
  const att = b.attacker, def = b.defender, gt = b.gt;
  let pa = att.bk.g, pd = def.bk.g;
  const log = [];
  const nA = att.bk.name, nD = def.bk.name;
  let aAb = b.abA, dAb = b.abD;

  if (gt.type === 'silence') {
    if (aAb || dAb) log.push(['', '✖ Врата «Тишина»: карты способностей не действуют.']);
    aAb = dAb = null;
  }
  const says = s => s.owner === 'p' ? 'Вы играете' : OPPNAME + ' играет';
  if (aAb) log.push(['', `${says(att)} «${aAb.name}» ${aAb.icon}`]);
  if (dAb) log.push(['', `${says(def)} «${dAb.name}» ${dAb.icon}`]);

  if (aAb && aAb.id === 'shield' && dAb && dAb.id !== 'shield') { log.push(['minus', `🛡 Барьер отменяет «${dAb.name}».`]); dAb = null; }
  if (dAb && dAb.id === 'shield' && aAb && aAb.id !== 'shield') { log.push(['minus', `🛡 Барьер отменяет «${aAb.name}».`]); aAb = null; }

  if (gt.owner === att.owner) { pa += HOME_BONUS; log.push(['plus', `🏳 Родные врата: ${nA} +${HOME_BONUS} G.`]); }
  if (gt.owner === def.owner) { pd += HOME_BONUS; log.push(['plus', `🏳 Родные врата: ${nD} +${HOME_BONUS} G.`]); }

  let gateOn = true;
  if ((aAb && aAb.id === 'hack') || (dAb && dAb.id === 'hack')) {
    log.push(['minus', `🔓 Эффект врат «${gateTitle(gt)}» отменён.`]);
    gateOn = false;
  }

  if (gateOn) {
    if (gt.type === 'attr') {
      if (att.bk.attr === gt.attr) { pa += 150; log.push(['plus', `❂ Врата ${ATTR[gt.attr].n}: ${nA} +150 G.`]); }
      if (def.bk.attr === gt.attr) { pd += 150; log.push(['plus', `❂ Врата ${ATTR[gt.attr].n}: ${nD} +150 G.`]); }
    } else {
      const R = ATTR[gt.attr];
      if (att.bk.attr === gt.attr) { pa += RESONANCE; log.push(['plus', `${R.i} Созвучие врат: ${nA} +${RESONANCE} G.`]); }
      if (def.bk.attr === gt.attr) { pd += RESONANCE; log.push(['plus', `${R.i} Созвучие врат: ${nD} +${RESONANCE} G.`]); }
    }
    if (gt.type === 'swap') { const t = pa; pa = pd; pd = t; log.push(['', '⇄ Врата «Обмен»: силы поменялись местами.']); }
    if (gt.type === 'underdog') {
      if (att.bk.g < def.bk.g) { pa += 250; log.push(['plus', `▲ Аутсайдер: ${nA} +250 G.`]); }
      else if (def.bk.g < att.bk.g) { pd += 250; log.push(['plus', `▲ Аутсайдер: ${nD} +250 G.`]); }
      else log.push(['', '▲ Аутсайдер: базовые силы равны, эффекта нет.']);
    }
    if (gt.type === 'fortress') { pd += 200; log.push(['plus', `⛨ Крепость: защитник ${nD} +200 G.`]); }
    if (gt.type === 'chaos') {
      const rr = b.seed != null ? mulberry32(b.seed) : Math.random;
      const ra = Math.round((-100 + rr() * 300) / 10) * 10;
      const rd = Math.round((-100 + rr() * 300) / 10) * 10;
      pa += ra; pd += rd;
      log.push([ra >= 0 ? 'plus' : 'minus', `✦ Хаос: ${nA} ${ra >= 0 ? '+' : ''}${ra} G.`]);
      log.push([rd >= 0 ? 'plus' : 'minus', `✦ Хаос: ${nD} ${rd >= 0 ? '+' : ''}${rd} G.`]);
    }
  }

  const mirror = gateOn && gt.type === 'mirror';
  if (mirror) log.push(['', '◐ Зеркало: стихийные преимущества не работают.']);
  else {
    if (beats(att.bk.attr, def.bk.attr)) { pa += 100; log.push(['plus', `${ATTR[att.bk.attr].i} ${ATTR[att.bk.attr].n} бьёт ${ATTR[def.bk.attr].n}: ${nA} +100 G.`]); }
    if (beats(def.bk.attr, att.bk.attr)) { pd += 100; log.push(['plus', `${ATTR[def.bk.attr].i} ${ATTR[def.bk.attr].n} бьёт ${ATTR[att.bk.attr].n}: ${nD} +100 G.`]); }
  }

  const apply = (ab, isAtt) => {
    if (!ab) return;
    const me = isAtt ? nA : nD;
    const myAttr = isAtt ? att.bk.attr : def.bk.attr;
    const get = () => isAtt ? pa : pd, set = v => { if (isAtt) pa = v; else pd = v; };
    const oth = () => isAtt ? pd : pa, sOth = v => { if (isAtt) pd = v; else pa = v; };
    if (ab.id === 'boost') { set(get() + 150); log.push(['plus', `💥 ${me} +150 G.`]); }
    if (ab.id === 'drain') { sOth(Math.max(0, oth() - 120)); log.push(['minus', `🥀 ${isAtt ? nD : nA} теряет 120 G.`]); }
    if (ab.id === 'copy') { set(oth() + 60); log.push(['plus', `🪞 ${me} копирует силу соперника +60 → ${get()} G.`]); }
    if (ab.id === 'fury') {
      const adv = isAtt ? beats(att.bk.attr, def.bk.attr) : beats(def.bk.attr, att.bk.attr);
      const add = 100 + (adv && !mirror ? 150 : 0);
      set(get() + add); log.push(['plus', `⚡ ${me} +${add} G.`]);
    }
    if (ab.id === 'twin') {
      const avg = Math.round((pa + pd) / 2);
      pa = avg; pd = avg; set(get() + 80);
      log.push(['', `☯ Равновесие: обе силы = ${avg} G, ${me} +80 G.`]);
    }
    if (ab.attr === myAttr) {
      set(get() + RESONANCE);
      log.push(['plus', `${ATTR[ab.attr].i} Созвучие стихии: ${me} +${RESONANCE} G.`]);
    }
  };
  apply(aAb, true); apply(dAb, false);

  if ((aAb && aAb.id === 'swap') || (dAb && dAb.id === 'swap')) {
    const t = pa; pa = pd; pd = t;
    log.push(['', '🔄 Инверсия: итоговые силы поменялись местами!']);
  }

  pa = Math.max(0, Math.round(pa)); pd = Math.max(0, Math.round(pd));
  if (pa === pd) log.push(['', '⚖ Ничья по силе — врата удерживает защитник.']);
  return { pa, pd, attWins: pa > pd, log };
}

async function showResult(b, r) {
  const pIsAtt = b.attacker.owner === 'p';
  const pPow = pIsAtt ? r.pa : r.pd;
  const aPow = pIsAtt ? r.pd : r.pa;

  bLog.innerHTML = '';
  for (const [cls, text] of r.log) {
    const d = document.createElement('div');
    d.className = 'l ' + cls; d.textContent = text;
    bLog.appendChild(d);
    SFX.tick();
    await sleep(400);
  }
  countUp('pw_p', b.pSide.bk.g, pPow);
  countUp('pw_a', b.aSide.bk.g, aPow);
  SFX.count();
  await sleep(950);

  const pWon = pIsAtt ? r.attWins : !r.attWins;
  bLeft.classList.add(pWon ? 'win' : 'lose');
  bRight.classList.add(pWon ? 'lose' : 'win');
  const d = document.createElement('div');
  d.className = 'res';
  d.textContent = pWon ? '🏆 ВЫ ЗАБИРАЕТЕ ВРАТА!' : '💀 ВРАТА У СОПЕРНИКА';
  bLog.appendChild(d);
  pWon ? SFX.win() : SFX.lose();
  b.playerWon = pWon;
  bBtn.classList.remove('hidden');
}

function countUp(id, from, to) {
  const el = document.getElementById(id); if (!el) return;
  const t0 = performance.now(), dur = 800;
  const step = now => {
    const k = Math.min(1, (now - t0) / dur);
    const v = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
    el.innerHTML = v + '<small>G-СИЛА</small>';
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

document.getElementById('bBtn').onclick = () => {
  SFX.click();
  const b = S.battle;
  bOv.classList.add('hidden');
  clearFxCanvas();
  const winner = b.playerWon ? 'p' : 'a';
  S[winner].wins++;
  b.attacker.bk.where = 'hand';
  b.defender.bk.where = 'hand';
  S.gates = S.gates.filter(g => g !== b.gt);
  S.battle = null;
  renderAll();

  if (S[winner].wins >= 3) { gameOver(winner); return; }
  setHint(b.playerWon ? 'Врата ваши! Бакуганы вернулись в руки.' : OPPNAME + ' забрал врата.');
  S.turn = b.attacker.owner;
  endTurn();
};

async function gameOver(w) {
  S.phase = 'over';
  const won = w === 'p';
  document.getElementById('endTitle').textContent = won ? 'ПОБЕДА!' : 'ПОРАЖЕНИЕ';
  document.getElementById('endText').textContent = won
    ? `Вы выиграли ${S.p.wins} врат против ${S.a.wins}. Маскерад повержен!`
    : `Маскерад выиграл ${S.a.wins} врат против ${S.p.wins}. Реванш?`;
  document.getElementById('endReward').textContent = 'начисляем награду…';
  won ? SFX.victory() : SFX.defeat();

  try {
    const data = MODE === 'mp'
      ? await MP.finish(won)
      : await API.post('/api/game/result', {
          won, pWins: S.p.wins, aWins: S.a.wins,
          difficulty: DIFF.id, battlesWon: S.p.wins
        });
    if (data) {
      applyProfile(data);
      document.getElementById('endReward').innerHTML =
        `🪙 <b>+${data.reward}</b> жетонов · всего у вас <b>${data.user.tokens}</b>`;
    } else {
      document.getElementById('endReward').textContent = '';
    }
  } catch (e) {
    document.getElementById('endReward').textContent = 'Не удалось сохранить результат: ' + e.message;
  }
  if (MODE === 'mp') MP.stop();
  document.getElementById('endStats').innerHTML = statsHTML();
  renderStats();
  setTimeout(() => document.getElementById('endOverlay').classList.remove('hidden'), 600);
}

/* =========================================================
   Интерфейс
   ========================================================= */
const hint = document.getElementById('hint');
const setHint = t => hint.innerHTML = t;

function bcardHTML(b, opts = {}) {
  const A = ATTR[b.attr];
  const state = b.where === 'field' ? '<div class="bstate">НА ПОЛЕ</div>' : '';
  return `<div class="bcard ${opts.cls || ''}" style="--ac:${A.c}" data-uid="${b.uid}" data-name="${esc(b.name)}">
    <div class="orb cre" style="--ac:${A.c}" data-cre="${esc(b.name)}"></div>
    <div class="bmeta">
      <div class="bname">${b.name}</div>
      <div class="battr">${A.n.toUpperCase()} · ${b.kind}</div>${state}
    </div>
    <div class="bgv"><b>${b.g}</b><small>G</small><i class="tier">${stars(b.tier)}</i></div>
  </div>`;
}

function renderHands() {
  const ph = document.getElementById('playerHand');
  const canSel = S.turn === 'p' && S.phase === 'select';
  ph.innerHTML = S.p.team.map(b => bcardHTML(b, {
    cls: (b.where !== 'hand' || !canSel ? 'dis' : '') + (S.selected === b.uid ? ' sel' : '')
  })).join('');
  ph.querySelectorAll('.bcard').forEach(el => {
    el.onmouseenter = () => { if (!el.classList.contains('dis')) SFX.hover(); };
    el.onclick = () => {
      if (S.turn !== 'p' || S.phase !== 'select') { SFX.deny(); return; }
      const b = S.p.team.find(x => x.uid === +el.dataset.uid);
      if (!b || b.where !== 'hand') { SFX.deny(); return; }
      S.selected = b.uid;
      S.aim = { ang: 0, dir: 1, pow: 0.05, pdir: 1 };
      S.phase = 'aim';
      SFX.select();
      renderHands();
      setHint('<b>' + b.name + '</b> готов. <b>Пробел</b> или клик по полю — зафиксировать <b>угол</b>.');
    };
  });
  document.getElementById('oppTitle').textContent = OPPNAME;
  document.getElementById('scAiName').textContent = OPPNAME.toUpperCase();
  document.getElementById('aiHand').innerHTML = S.a.team.map(b => bcardHTML(b, { cls: 'ro' })).join('');
  CRE.apply(ph); CRE.apply(document.getElementById('aiHand'));
  document.getElementById('scMe').textContent = S.p.wins;
  document.getElementById('scAi').textContent = S.a.wins;
  renderAiMeta();
}

function renderAiMeta() {
  if (!S) return;
  document.getElementById('aiGates').textContent = S.a.gateHand.length;
  document.getElementById('aiAbil').textContent = S.a.abil.length;
}

function renderAbilities() {
  document.getElementById('playerAbilities').innerHTML =
    S.p.abil.map(c => abilityCardHTML(c, -1, '')).join('') || '<div class="acard empty">нет карт</div>';
}

function gateCardHTML(c, i, sel) {
  const g = { type: c.type, attr: c.attr };
  const A = ATTR[c.attr];
  return `<div class="gcard ${sel ? 'sel' : ''}" style="--ac:${gateColor(g)}" data-i="${i}">
    <div class="gi">${c.type === 'attr' ? A.i : gateType(c).icon}</div>
    <div class="gt">${gateTitle(g)}</div>
    <div class="gd">${gateDesc(g)}</div>
    <div class="ga" style="color:${A.c}">${A.i} ${A.n}</div>
  </div>`;
}

function renderGateHand() {
  const box = document.getElementById('gateHand');
  const active = S.phase === 'placeGate' && S.turn === 'p';
  box.className = 'gatehand' + (active ? ' active' : '');
  box.innerHTML = S.p.gateHand.map((c, i) => gateCardHTML(c, i, S.placing === i)).join('')
    || '<div class="gempty">Карты врат закончились</div>';
  document.getElementById('gateDeckCount').textContent = '(в колоде ещё ' + S.p.gateDeck.length + ')';
  box.querySelectorAll('.gcard').forEach(el => {
    el.onmouseenter = () => { if (active) SFX.hover(); };
    el.onclick = () => {
      if (!active) { SFX.deny(); setHint('Карту врат можно выложить только в начале своего хода.'); return; }
      const i = +el.dataset.i;
      S.placing = S.placing === i ? null : i;
      SFX.select();
      renderGateHand();
      setHint(S.placing === null
        ? 'Выберите карту врат.'
        : 'Теперь кликните по <b>подсвеченной площадке</b> на арене.');
    };
  });
}

function renderCycle() {
  document.getElementById('cycleBox').innerHTML = CYCLE.map((k, i) => {
    const nx = CYCLE[(i + 1) % 6];
    return `<div class="cyc" style="--ac:${ATTR[k].c}"><i></i>${ATTR[k].i} ${ATTR[k].n}
      <em>бьёт ${ATTR[nx].n}</em></div>`;
  }).join('');
}

function statsHTML() {
  const u = PROFILE.user;
  return `<div class="st"><b>${u.wins}</b><span>побед</span></div>
    <div class="st"><b>${u.losses}</b><span>поражений</span></div>
    <div class="st"><b>${u.streak}</b><span>серия</span></div>
    <div class="st"><b>${u.best}</b><span>рекорд</span></div>`;
}
function renderStats() {
  if (!PROFILE) return;
  document.getElementById('statsBox').innerHTML = statsHTML();
}

function renderAll() { if (!S) return; renderHands(); renderAbilities(); renderGateHand(); renderStats(); }

/* ---------- ввод на канвасе ---------- */
function canvasPos(e) {
  const r = canvas.getBoundingClientRect();
  const cx = e.clientX !== undefined ? e.clientX : e.touches[0].clientX;
  const cy = e.clientY !== undefined ? e.clientY : e.touches[0].clientY;
  return { x: (cx - r.left) * W / r.width, y: (cy - r.top) * H / r.height };
}

function press() {
  if (!S) return;
  if (S.phase === 'aim') {
    S.phase = 'power'; SFX.lock();
    setHint('Угол зафиксирован. Теперь поймайте <b>силу</b> броска — нажмите ещё раз.');
  } else if (S.phase === 'power') {
    const b = S.p.team.find(x => x.uid === S.selected);
    if (!b) return;
    SFX.lock();
    setHint('Бросок!');
    if (MODE === 'mp') {
      // исход считаем сразу и шлём сопернику, чтобы у обоих шар лёг одинаково
      const gate = simulateThrow(S.aim.ang, S.aim.pow);
      const seed = Math.floor(Math.random() * 1e9);
      MP.send({ t: 'throw', name: b.name, ang: S.aim.ang, pow: S.aim.pow, gate, seed });
      throwBall('p', b, S.aim.ang, S.aim.pow, { gate, seed });
    } else {
      throwBall('p', b, S.aim.ang, S.aim.pow);
    }
  }
}

function onField(e) {
  e.preventDefault();
  SFX.resume();
  if (!S) return;
  if (S.phase === 'placeGate' && S.turn === 'p') {
    if (S.placing === null) { SFX.deny(); setHint('Сначала выберите <b>карту врат</b> под ареной.'); return; }
    const p = canvasPos(e);
    let bi = -1, bd = 1e9;
    for (const i of freeSlots()) {
      const d = Math.hypot(SLOTS[i].x - p.x, SLOTS[i].y - p.y);
      if (d < bd) { bd = d; bi = i; }
    }
    if (bi < 0 || bd > 95) { SFX.deny(); setHint('Кликните ближе к <b>подсвеченной площадке</b>.'); return; }
    placeGate('p', S.placing, bi);
    setHint('Врата выложены. Теперь выберите бакугана и бросьте его.');
    return;
  }
  press();
}
canvas.addEventListener('mousedown', onField);
canvas.addEventListener('touchstart', onField, { passive: false });
window.addEventListener('keydown', e => {
  if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); SFX.resume(); press(); }
});

/* =========================================================
   Лобби: сборка команды из своей коллекции
   ========================================================= */
const startOv = document.getElementById('startOverlay');
let picked = [];
let filter = 'all';

function openLobby() {
  SFX.rollStop();
  if (MODE === 'mp') MP.leave();
  MODE = 'ai'; OPPNAME = 'Маскерад';
  document.getElementById('btnSurrender').classList.add('hidden');
  document.getElementById('endOverlay').classList.add('hidden');
  document.getElementById('battleOverlay').classList.add('hidden');
  S = null; picked = []; filter = 'all';
  setHint('Соберите команду, чтобы начать бой');
  renderCycle(); renderStats(); renderMode(); renderDiffs(); renderTabs(); renderPick();
  startOv.classList.remove('hidden');
}
function refreshLobby() { if (!startOv.classList.contains('hidden')) { renderTabs(); renderPick(); } }

function renderDiffs() {
  if (!DIFF) DIFF = DIFFS[1];
  document.getElementById('diffBox').innerHTML = DIFFS.map(d =>
    `<button class="dbtn ${DIFF.id === d.id ? 'on' : ''}" data-id="${d.id}">
      ${d.name}<em>${d.desc} · ×${d.mult} жетонов</em></button>`).join('');
  document.querySelectorAll('#diffBox .dbtn').forEach(el => {
    el.onclick = () => { DIFF = DIFFS.find(d => d.id === el.dataset.id); SFX.click(); renderDiffs(); };
  });
}

function ownedBakugan() { return PROFILE.bakugan.map(bakuganByName).filter(Boolean); }

/* собрать законную тройку самой, если игрок не выбирал её вручную */
function autoTeam() {
  const own = ownedBakugan();
  if (own.length < 3) return null;
  let best = null;
  for (let k = 0; k < 400; k++) {
    const t = shuffle(own).slice(0, 3);
    const sum = t.reduce((s, b) => s + b.g, 0);
    if (sum > TEAM_CAP) continue;
    if (!best || sum > best.sum) best = { t, sum };
    if (best.sum > TEAM_CAP - 40) break;
  }
  if (!best) best = { t: own.slice().sort((a, b) => a.g - b.g).slice(0, 3) };
  return best.t.map(b => b.name);
}

function renderTabs() {
  const own = ownedBakugan();
  const present = new Set(own.map(b => b.attr));
  const tabs = [{ id: 'all', n: 'Вся коллекция', c: '#8296c4', i: '⬢' }]
    .concat(CYCLE.filter(k => present.has(k)).map(k =>
      ({ id: k, n: ATTR[k].n + ' · ' + ATTR[k].ru, c: ATTR[k].c, i: ATTR[k].i })));
  document.getElementById('attrTabs').innerHTML = tabs.map(t =>
    `<button class="tab ${filter === t.id ? 'on' : ''}" style="--ac:${t.c}" data-id="${t.id}">
      <span>${t.i}</span>${t.n}</button>`).join('');
  document.querySelectorAll('#attrTabs .tab').forEach(el => {
    el.onclick = () => { filter = el.dataset.id; SFX.click(); renderTabs(); renderPick(); };
  });
}

function renderPick() {
  const own = ownedBakugan();
  const sum = picked.reduce((s, n) => s + (bakuganByName(n) ? bakuganByName(n).g : 0), 0);
  const list = document.getElementById('pickList');
  const items = own.filter(b => filter === 'all' || b.attr === filter);

  list.innerHTML = items.map(b => {
    const sel = picked.includes(b.name);
    const blocked = !sel && (picked.length >= 3 || sum + b.g > TEAM_CAP);
    return bcardHTML({ ...b, uid: 0, where: 'hand' }, { cls: (sel ? 'sel' : '') + (blocked ? ' dis' : '') });
  }).join('') || '<div class="gempty">В этой стихии у вас пока нет бакуганов — загляните в магазин.</div>';

  list.querySelectorAll('.bcard').forEach(el => {
    el.onmouseenter = () => SFX.hover();
    el.onclick = () => {
      const name = el.dataset.name;
      const k = picked.indexOf(name);
      if (k >= 0) { picked.splice(k, 1); SFX.click(); }
      else {
        const b = bakuganByName(name);
        const s = picked.reduce((a, n) => a + bakuganByName(n).g, 0);
        if (picked.length >= 3 || s + b.g > TEAM_CAP) { SFX.deny(); return; }
        picked.push(name); SFX.select();
      }
      renderPick();
    };
  });

  const sEl = document.getElementById('teamSum');
  sEl.textContent = sum;
  sEl.className = sum > TEAM_CAP ? 'over' : '';
  document.getElementById('teamCap').textContent = TEAM_CAP;
  document.getElementById('teamSlots').innerHTML = [0, 1, 2].map(n => {
    if (picked[n] === undefined) return '<div class="tslot empty">пусто</div>';
    const b = bakuganByName(picked[n]), A = ATTR[b.attr];
    return `<div class="tslot" style="--ac:${A.c}"><span class="orb cre" style="--ac:${A.c}" data-cre="${esc(b.name)}"></span>
      <b>${b.name}</b><i>${b.g} G</i></div>`;
  }).join('');
  document.getElementById('btnStart').disabled = picked.length !== 3 || sum > TEAM_CAP;
  CRE.apply(list); CRE.apply(document.getElementById('teamSlots'));

  const nA = PROFILE.cards.ability.reduce((s, c) => s + c.qty, 0);
  const nG = PROFILE.cards.gate.reduce((s, c) => s + c.qty, 0);
  document.getElementById('lobbyDeck').innerHTML =
    `В бой пойдут <b>${Math.min(DECK_SIZE, Math.max(nG, 1))}</b> карт врат из ваших <b>${nG}</b>
     и карты способностей из ваших <b>${nA}</b>.`;
}

let lobbyMode = 'ai';
function renderMode() {
  const box = document.getElementById('modeBox');
  const modes = [['ai', '🤖 Против Маскерада', 'Тренировочный бой с ИИ'],
                 ['mp', '🌐 Онлайн-бой', 'Живой соперник, награда больше']];
  box.innerHTML = modes.map(([id, n, d]) =>
    `<button class="mbtn ${lobbyMode === id ? 'on' : ''}" data-m="${id}">${n}<em>${d}</em></button>`).join('');
  box.querySelectorAll('.mbtn').forEach(el => {
    el.onclick = () => { lobbyMode = el.dataset.m; SFX.click(); renderMode(); renderPick(); };
  });
  document.getElementById('diffRow').style.display = lobbyMode === 'ai' ? '' : 'none';
  document.getElementById('btnStart').textContent = lobbyMode === 'ai' ? 'В БОЙ!' : 'НАЙТИ СОПЕРНИКА';
}

document.getElementById('btnStart').onclick = () => {
  SFX.resume(); SFX.open();
  if (lobbyMode === 'mp') { MP.find(picked.slice()); return; }
  MODE = 'ai'; OPPNAME = 'Маскерад';
  startOv.classList.add('hidden');
  newGame(picked.map(bakuganByName));
};
document.getElementById('btnSurrender').onclick = () => MP.surrender();

/* ---------- кнопки шапки ---------- */
const sndBtn = document.getElementById('btnSound');
function paintSound() {
  sndBtn.textContent = (SFX.on ? '🔊' : '🔇') + ' Звук';
  sndBtn.classList.toggle('off', !SFX.on);
}
sndBtn.onclick = () => { SFX.toggle(); paintSound(); };
paintSound();

document.getElementById('btnRules').onclick = () => { SFX.click(); document.getElementById('rulesOverlay').classList.remove('hidden'); };
document.getElementById('btnCloseRules').onclick = () => { SFX.click(); document.getElementById('rulesOverlay').classList.add('hidden'); };
document.getElementById('btnRestart').onclick = () => { SFX.click(); openLobby(); };
document.getElementById('btnAgain').onclick = () => { SFX.click(); openLobby(); };

/* ---------- легенды ---------- */
function renderLegends() {
  document.getElementById('gateLegend').innerHTML = GATE_TYPES.map(t =>
    `<li><b>${t.icon} ${t.title}</b> — ${t.desc}</li>`).join('');
  document.getElementById('abilLegend').innerHTML = ABILITIES.map(a =>
    `<li><b>${a.icon} ${a.name}</b> — ${a.desc}</li>`).join('');
  document.getElementById('resoNote').innerHTML =
    `У каждой карты есть стихия. Если она совпадает со стихией вашего бакугана — <b>+${RESONANCE} G</b>
     («созвучие»). У стихийных врат вместо этого работает их бонус <b>+150 G</b>.`;
}
