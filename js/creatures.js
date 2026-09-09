'use strict';

/* =========================================================
   Рисовка бакуганов.
   Каждое существо собирается процедурно из частей: корпус,
   голова, крылья, хвост, рога, лапы. Вид берётся из поля
   kind, лёгкие вариации — из имени, цвет — из стихии.
   Всё рисуется в системе координат -50..50, ноги на y = 44.
   ========================================================= */
const CRE = (() => {

  const INK = '#06090f';

  /* ---------------- цвет ---------------- */
  const hx = h => { h = h.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; };
  const cl = n => Math.max(0, Math.min(255, Math.round(n)));
  const hs = (r, g, b) => '#' + [r, g, b].map(n => cl(n).toString(16).padStart(2, '0')).join('');
  function shade(h, a) {
    const [r, g, b] = hx(h);
    return a >= 0 ? hs(r + (255 - r) * a, g + (255 - g) * a, b + (255 - b) * a) : hs(r * (1 + a), g * (1 + a), b * (1 + a));
  }
  function alpha(h, a) { const [r, g, b] = hx(h); return `rgba(${r},${g},${b},${a})`; }

  function palette(color) {
    return {
      base: color,
      lite: shade(color, 0.42),
      pale: shade(color, 0.78),
      mid: shade(color, -0.18),
      dark: shade(color, -0.48),
      deep: shade(color, -0.72),
      ink: INK,
      glow: color
    };
  }

  /* ---------------- геометрия ---------------- */
  function cubic(p0, p1, p2, p3, n) {
    const out = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      out.push([
        u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
        u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]
      ]);
    }
    return out;
  }

  /* лента переменной ширины вдоль ломаной — хвосты, шеи, лапы, щупальца */
  function ribbon(pts, w0, w1, pow) {
    const L = [], R = [], n = pts.length - 1;
    for (let i = 0; i <= n; i++) {
      const p = pts[i];
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n, i + 1)];
      let dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
      let t = i / n;
      if (pow) t = Math.pow(t, pow);
      const w = (w0 + (w1 - w0) * t) / 2;
      L.push([p[0] - dy * w, p[1] + dx * w]);
      R.push([p[0] + dy * w, p[1] - dx * w]);
    }
    return L.concat(R.reverse());
  }

  function poly(ctx, pts, close) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    if (close !== false) ctx.closePath();
  }

  function ell(ctx, x, y, rx, ry, rot) {
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot || 0, 0, 7);
  }

  /* ---------------- заливки ---------------- */
  function skin(ctx, P, opts) {
    opts = opts || {};
    const g = ctx.createLinearGradient(-30, -48, 24, 46);
    g.addColorStop(0, opts.flat ? P.base : P.pale);
    g.addColorStop(0.26, P.lite);
    g.addColorStop(0.62, P.base);
    g.addColorStop(1, P.deep);
    ctx.fillStyle = g;
    ctx.fill();
    if (opts.line !== 0) { ctx.strokeStyle = P.ink; ctx.lineWidth = opts.line || 2; ctx.stroke(); }
  }
  function plate(ctx, P) {           // тёмные части: перепонки, брюхо, тень
    const g = ctx.createLinearGradient(0, -40, 0, 44);
    g.addColorStop(0, P.dark); g.addColorStop(1, P.deep);
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = P.ink; ctx.lineWidth = 1.6; ctx.stroke();
  }
  function shell(ctx, P) {           // светлые панцири и броня
    const g = ctx.createLinearGradient(-20, -30, 20, 40);
    g.addColorStop(0, P.pale); g.addColorStop(1, P.mid);
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = P.ink; ctx.lineWidth = 1.8; ctx.stroke();
  }

  function eye(ctx, P, x, y, r, tilt) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(tilt || 0);
    ell(ctx, 0, 0, r * 1.5, r, 0);
    ctx.fillStyle = '#fffbe8'; ctx.fill();
    ctx.shadowColor = '#fff6c8'; ctx.shadowBlur = 8;
    ctx.fill(); ctx.shadowBlur = 0;
    ell(ctx, 0, 0, r * 0.42, r * 0.92, 0);
    ctx.fillStyle = P.ink; ctx.fill();
    ctx.restore();
  }

  function claws(ctx, P, x, y, ang, len, n) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
    for (let i = 0; i < n; i++) {
      const a = (i - (n - 1) / 2) * 0.45;
      ctx.save(); ctx.rotate(a);
      poly(ctx, [[0, -1.7], [len, -0.4], [0, 2.4]]);
      ctx.fillStyle = P.pale; ctx.fill();
      ctx.strokeStyle = P.ink; ctx.lineWidth = 1.1; ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  function crestSpikes(ctx, P, pts, h, n) {
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const idx = Math.min(pts.length - 2, Math.floor(t * (pts.length - 1)));
      const p = pts[idx], q = pts[idx + 1];
      let dx = q[0] - p[0], dy = q[1] - p[1];
      const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      const s = h * (0.55 + 0.45 * Math.sin(Math.PI * t));
      poly(ctx, [[p[0] - dx * 3, p[1] - dy * 3], [p[0] - dy * s, p[1] + dx * s], [p[0] + dx * 3, p[1] + dy * 3]]);
      ctx.fillStyle = P.pale; ctx.fill();
      ctx.strokeStyle = P.ink; ctx.lineWidth = 1.1; ctx.stroke();
    }
  }

  function horn(ctx, P, x, y, ang, len, curve) {
    const p0 = [x, y];
    const p3 = [x + Math.cos(ang) * len, y + Math.sin(ang) * len];
    const c1 = [x + Math.cos(ang) * len * 0.4 - Math.sin(ang) * curve, y + Math.sin(ang) * len * 0.4 + Math.cos(ang) * curve];
    const pts = cubic(p0, c1, c1, p3, 10);
    poly(ctx, ribbon(pts, len * 0.32, 0.6, 1.4));
    ctx.fillStyle = P.pale; ctx.fill();
    ctx.strokeStyle = P.ink; ctx.lineWidth = 1.2; ctx.stroke();
  }

  /* ================= АРХЕТИПЫ ================= */
  const ARCH = {};

  /* ---- дракон / гидра / ящер ---- */
  ARCH.dragon = (ctx, P, d) => {
    const heads = d.heads || 1;
    // крылья
    if (d.wings !== false) {
      for (const s of [-1, 1]) {
        const tip = [s * (40 + d.wing * 8), -34 - d.wing * 6];
        const web = [
          [s * 8, -12], tip, [s * (30 + d.wing * 5), -12],
          [s * (34 + d.wing * 6), -20], [s * 22, -4], [s * 26, 0], [s * 10, 6]
        ];
        poly(ctx, web); plate(ctx, P);
        poly(ctx, [[s * 8, -12], tip], false);
        ctx.strokeStyle = P.pale; ctx.lineWidth = 2.4; ctx.stroke();
        poly(ctx, [[s * 8, -10], [s * (32 + d.wing * 5), -13]], false); ctx.lineWidth = 1.6; ctx.stroke();
      }
    }
    // хвост
    const tail = cubic([-4, 24], [-26, 30], [-44, 18], [-46, -6], 14);
    poly(ctx, ribbon(tail, 15, 1.5, 1.2)); skin(ctx, P);
    crestSpikes(ctx, P, tail, 6, 5);
    // ноги
    for (const s of [-1, 1]) {
      const leg = cubic([s * 11, 18], [s * (16 + s), 30], [s * 15, 34], [s * 15, 42], 8);
      poly(ctx, ribbon(leg, 15, 9)); skin(ctx, P);
      claws(ctx, P, s * 15, 43, Math.PI / 2 + s * 0.25, 7, 3);
    }
    // корпус
    poly(ctx, [...cubic([-16, 22], [-22, 0], [-14, -14], [0, -16], 12),
               ...cubic([0, -16], [16, -14], [22, 2], [16, 22], 12),
               ...cubic([16, 22], [8, 30], [-8, 30], [-16, 22], 8)]);
    skin(ctx, P);
    // брюшные пластины
    ctx.save(); ctx.beginPath(); ctx.ellipse(4, 8, 11, 17, 0.1, 0, 7); ctx.clip();
    for (let i = -2; i < 4; i++) {
      poly(ctx, [[-8, i * 8], [16, i * 8 - 2]], false);
      ctx.strokeStyle = alpha(P.pale, 0.45); ctx.lineWidth = 2; ctx.stroke();
    }
    ctx.restore();
    // руки
    for (const s of [-1, 1]) {
      const arm = cubic([s * 12, -4], [s * 20, 4], [s * 21, 10], [s * 24, 15], 8);
      poly(ctx, ribbon(arm, 9, 5)); skin(ctx, P, { line: 1.6 });
      claws(ctx, P, s * 24, 16, Math.PI / 2.4 * s, 6, 3);
    }
    // шеи и головы
    for (let h = 0; h < heads; h++) {
      const off = heads === 1 ? 0 : (h - (heads - 1) / 2);
      const bx = off * 15, by = Math.abs(off) * 6;
      const neck = cubic([bx * 0.3, -12], [bx * 0.7, -22 + by], [bx, -30 + by], [bx + 3, -34 + by], 8);
      poly(ctx, ribbon(neck, 14, 10)); skin(ctx, P);
      drawDragonHead(ctx, P, bx + 3, -36 + by, d, heads > 1 ? 0.8 : 1, off * 0.14);
    }
  };

  function drawDragonHead(ctx, P, x, y, d, sc, rot) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot || 0); ctx.scale(sc, sc);
    // череп + морда
    poly(ctx, [[-9, -8], [4, -10], [16, -5], [21, 0], [16, 5], [2, 8], [-9, 6]]);
    skin(ctx, P);
    // челюсть
    poly(ctx, [[2, 6], [17, 4], [12, 10], [1, 10]]);
    ctx.fillStyle = P.deep; ctx.fill(); ctx.strokeStyle = P.ink; ctx.lineWidth = 1.3; ctx.stroke();
    // зубы
    for (let i = 0; i < 3; i++) {
      poly(ctx, [[6 + i * 4, 5], [8 + i * 4, 5], [7 + i * 4, 9]]);
      ctx.fillStyle = '#f4f6ff'; ctx.fill();
    }
    for (let i = 0; i < (d.horns || 2); i++) {
      const a = -2.4 + i * 0.32;
      horn(ctx, P, -5 + i * 2, -7, a, 15 + (i % 2) * 4, 4);
    }
    if (d.jawHorn) horn(ctx, P, 10, 8, 1.1, 9, -2);
    eye(ctx, P, 6, -3, 2.8, -0.25);
    poly(ctx, [[16, -1], [19, -1]], false);
    ctx.strokeStyle = P.ink; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.restore();
  }

  /* ---- кошачьи ---- */
  ARCH.feline = (ctx, P, d) => {
    const tail = cubic([-20, 8], [-36, 6], [-44, -8], [-40, -22], 12);
    poly(ctx, ribbon(tail, 9, 2.5, 1.2)); skin(ctx, P);
    // задние лапы
    for (const s of [1, -1]) {
      const leg = cubic([-14 + s * 3, 12], [-19 + s * 3, 24], [-15 + s * 3, 32], [-16 + s * 3, 42], 8);
      poly(ctx, ribbon(leg, 15, 9)); skin(ctx, P, { line: 1.6 });
      claws(ctx, P, -16 + s * 3, 43, Math.PI / 2, 5, 3);
    }
    // корпус
    poly(ctx, [...cubic([-22, 6], [-16, -10], [10, -12], [24, -2], 12),
               ...cubic([24, -2], [26, 12], [10, 22], [-10, 20], 12),
               ...cubic([-10, 20], [-20, 18], [-24, 14], [-22, 6], 6)]);
    skin(ctx, P);
    // полосы
    ctx.save(); poly(ctx, [...cubic([-22, 6], [-16, -10], [10, -12], [24, -2], 10),
               ...cubic([24, -2], [26, 12], [10, 22], [-10, 20], 10),
               ...cubic([-10, 20], [-20, 18], [-24, 14], [-22, 6], 5)]); ctx.clip();
    for (let i = 0; i < 5; i++) {
      const x = -16 + i * 9;
      poly(ctx, [[x, -14], [x - 5, 2], [x, 22]], false);
      ctx.strokeStyle = alpha(P.deep, 0.75); ctx.lineWidth = 3.4; ctx.stroke();
    }
    ctx.restore();
    // передние лапы
    for (const s of [1, -1]) {
      const leg = cubic([16 + s * 3, 8], [19 + s * 3, 24], [18 + s * 3, 32], [18 + s * 3, 42], 8);
      poly(ctx, ribbon(leg, 14, 9)); skin(ctx, P, { line: 1.6 });
      claws(ctx, P, 18 + s * 3, 43, Math.PI / 2, 5, 3);
    }
    if (d.blades) {                          // клинки на плечах
      for (const s of [-1, 1]) {
        poly(ctx, [[6, -8], [10 + s * 2, -30 - s * 4], [16, -6]]);
        shell(ctx, P);
      }
    }
    // голова
    ctx.save(); ctx.translate(26, -14); ctx.scale(1.22, 1.22);
    poly(ctx, [[-12, -6], [-6, -14], [8, -13], [14, -4], [11, 8], [-2, 11], [-11, 6]]);
    skin(ctx, P);
    for (const s of [-1, 1]) {               // уши
      poly(ctx, [[s * 3 - 3, -12], [s * 5 - 1, -24], [s * 9 + 1, -10]]);
      skin(ctx, P, { line: 1.4 });
    }
    poly(ctx, [[6, 0], [15, 2], [12, 9], [4, 8]]);
    ctx.fillStyle = P.pale; ctx.fill(); ctx.strokeStyle = P.ink; ctx.lineWidth = 1.3; ctx.stroke();
    for (let i = 0; i < 2; i++) {            // клыки
      poly(ctx, [[6 + i * 5, 7], [8.5 + i * 5, 7], [7 + i * 5, 12]]);
      ctx.fillStyle = '#f4f6ff'; ctx.fill();
    }
    eye(ctx, P, -2, -3, 2.6, -0.3); eye(ctx, P, 8, -4, 2.4, -0.3);
    ctx.restore();
  };

  /* ---- птицы ---- */
  ARCH.bird = (ctx, P, d) => {
    for (const s of [-1, 1]) {
      const span = 44 + d.wing * 4, rise = 34 + d.wing * 6;
      const base = [s * 9, -6];
      const tipA = [s * span, -rise];
      const lead = cubic(base, [s * 20, -rise - 8], [s * 34, -rise - 10], tipA, 10);
      const back = cubic(tipA, [s * (span - 8), -rise + 16], [s * 26, -6], [s * 11, 6], 10);
      poly(ctx, lead.concat(back)); plate(ctx, P);
      for (let i = 1; i <= 4; i++) {              // маховые перья
        const t = i / 5;
        const q = lead[Math.round(t * 10)];
        poly(ctx, [[base[0], base[1] + 2], q], false);
        ctx.strokeStyle = alpha(P.pale, 0.55); ctx.lineWidth = 1.7; ctx.stroke();
      }
      for (let i = 0; i < 3; i++) {                // кончики маховых
        const a = 0.2 + i * 0.22;
        poly(ctx, [[s * (span - 4), -rise + i * 8],
                   [s * (span + 9 - i * 2), -rise + 8 + i * 10],
                   [s * (span - 12), -rise + 10 + i * 8]]);
        ctx.fillStyle = i % 2 ? P.mid : P.dark; ctx.fill();
        ctx.strokeStyle = P.ink; ctx.lineWidth = 1.2; ctx.stroke();
      }
    }
    for (let i = -1; i <= 1; i++) {          // хвостовые перья
      const t = cubic([-2, 18], [-14 + i * 4, 28], [-22 + i * 10, 34], [-26 + i * 16, 44], 8);
      poly(ctx, ribbon(t, 10, 3, 1.1));
      ctx.fillStyle = i === 0 ? P.base : P.dark; ctx.fill();
      ctx.strokeStyle = P.ink; ctx.lineWidth = 1.4; ctx.stroke();
    }
    for (const s of [-1, 1]) {               // лапы
      const leg = cubic([s * 5, 16], [s * 7, 26], [s * 7, 32], [s * 8, 38], 6);
      poly(ctx, ribbon(leg, 6, 4)); ctx.fillStyle = P.pale; ctx.fill();
      ctx.strokeStyle = P.ink; ctx.lineWidth = 1.2; ctx.stroke();
      claws(ctx, P, s * 8, 39, Math.PI / 2, 6, 3);
    }
    // корпус
    poly(ctx, [...cubic([-12, 16], [-16, -6], [-6, -18], [6, -18], 12),
               ...cubic([6, -18], [16, -12], [16, 6], [8, 18], 12),
               ...cubic([8, 18], [2, 22], [-6, 22], [-12, 16], 6)]);
    skin(ctx, P);
    ell(ctx, 1, 4, 7, 11, 0.1); ctx.fillStyle = alpha(P.pale, 0.35); ctx.fill();
    // голова
    ctx.save(); ctx.translate(6, -24);
    ell(ctx, 0, 0, 11, 10, 0); skin(ctx, P, { line: 1.8 });
    poly(ctx, [[7, -3], [22, 1], [7, 6]]);   // клюв
    ctx.fillStyle = P.pale; ctx.fill(); ctx.strokeStyle = P.ink; ctx.lineWidth = 1.3; ctx.stroke();
    poly(ctx, [[8, 1], [20, 1.5]], false); ctx.lineWidth = 1; ctx.stroke();
    for (let i = 0; i < (d.crest || 3); i++) horn(ctx, P, -4 - i, -7, -2.5 + i * 0.28, 13 + (i % 2) * 5, 3);
    eye(ctx, P, 2, -2, 2.6, 0);
    ctx.restore();
  };

  /* ---- змеи ---- */
  ARCH.serpent = (ctx, P, d) => {
    const spine = cubic([-30, 44], [-46, 18], [10, 22], [4, -8], 22);
    poly(ctx, ribbon(spine, 22, 11, 0.9)); skin(ctx, P);
    for (let i = 3; i < spine.length - 2; i += 2) {   // чешуя
      const p = spine[i];
      ell(ctx, p[0], p[1], 4.5, 3, 0.4);
      ctx.strokeStyle = alpha(P.deep, 0.5); ctx.lineWidth = 1.2; ctx.stroke();
    }
    ctx.save(); ctx.translate(4, -12);
    if (d.hood) {                                   // капюшон кобры
      poly(ctx, [[-16, 6], [-14, -14], [0, -22], [14, -14], [16, 6], [0, 12]]);
      plate(ctx, P);
      ell(ctx, 0, -6, 6, 7, 0); ctx.fillStyle = alpha(P.pale, 0.5); ctx.fill();
    }
    poly(ctx, [[-9, -8], [6, -11], [17, -5], [19, 0], [14, 6], [0, 8], [-9, 5]]);
    skin(ctx, P, { line: 1.8 });
    poly(ctx, [[2, 6], [15, 4], [10, 10], [1, 10]]);
    ctx.fillStyle = P.deep; ctx.fill(); ctx.strokeStyle = P.ink; ctx.lineWidth = 1.2; ctx.stroke();
    poly(ctx, [[5, 8], [7, 8], [6, 14]]); ctx.fillStyle = '#f4f6ff'; ctx.fill();
    poly(ctx, [[11, 7], [13, 7], [12, 13]]); ctx.fill();
    poly(ctx, [[14, 8], [22, 12], [18, 12], [24, 15]], false);
    ctx.strokeStyle = '#ff4b6e'; ctx.lineWidth = 1.4; ctx.stroke();
    eye(ctx, P, 4, -3, 2.6, -0.2);
    ctx.restore();
  };

  /* ---- насекомые ---- */
  ARCH.insect = (ctx, P, d) => {
    const kind = d.insect || 'mantis';
    if (kind === 'centipede') {
      const spine = cubic([-42, 40], [-30, 4], [10, 30], [30, -2], 16);
      for (let i = 0; i < spine.length; i++) {       // лапы
        const p = spine[i], s = i % 2 ? 1 : -1;
        poly(ctx, [[p[0], p[1]], [p[0] + s * 12, p[1] + 10]], false);
        ctx.strokeStyle = P.dark; ctx.lineWidth = 2.4; ctx.stroke();
      }
      for (let i = spine.length - 1; i >= 0; i--) {  // сегменты
        const p = spine[i], r = 6 + 5 * (i / spine.length);
        ell(ctx, p[0], p[1], r, r * 0.86, 0); skin(ctx, P, { line: 1.5 });
      }
      const h = spine[spine.length - 1];
      ctx.save(); ctx.translate(h[0] + 4, h[1] - 4);
      ell(ctx, 0, 0, 10, 8, -0.2); skin(ctx, P, { line: 1.6 });
      for (const s of [-1, 1]) { poly(ctx, [[5, s * 3], [16, s * 8]], false); ctx.strokeStyle = P.pale; ctx.lineWidth = 2; ctx.stroke(); }
      eye(ctx, P, 1, -2, 2.4, 0); eye(ctx, P, 3, 3, 2, 0);
      ctx.restore();
      return;
    }
    if (kind === 'scorpion') {
      const tail = cubic([-16, 16], [-40, 4], [-30, -34], [4, -30], 16);
      for (let i = 0; i < tail.length; i += 2) {
        const p = tail[i];
        ell(ctx, p[0], p[1], 6 - i * 0.16, 5.5 - i * 0.15, 0); skin(ctx, P, { line: 1.4 });
      }
      const st = tail[tail.length - 1];
      poly(ctx, [[st[0] - 2, st[1] - 4], [st[0] + 14, st[1] + 4], [st[0] - 2, st[1] + 6]]);
      ctx.fillStyle = P.pale; ctx.fill(); ctx.strokeStyle = P.ink; ctx.lineWidth = 1.3; ctx.stroke();
      for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {   // лапы
        const leg = cubic([s * 6, 14], [s * (18 + i * 5), 16 + i * 4], [s * (24 + i * 6), 28], [s * (20 + i * 8), 42], 8);
        poly(ctx, ribbon(leg, 5, 2)); ctx.fillStyle = P.dark; ctx.fill();
        ctx.strokeStyle = P.ink; ctx.lineWidth = 1.1; ctx.stroke();
      }
      ell(ctx, 0, 14, 20, 15, 0); skin(ctx, P);
      for (const s of [-1, 1]) {                                // клешни
        const arm = cubic([s * 12, 6], [s * 24, 2], [s * 30, 2], [s * 34, 4], 6);
        poly(ctx, ribbon(arm, 7, 5)); skin(ctx, P, { line: 1.4 });
        ctx.save(); ctx.translate(s * 36, 4); ctx.rotate(s > 0 ? 0 : Math.PI);
        poly(ctx, [[-4, -8], [10, -6], [14, 0], [2, 2], [-4, 0]]); shell(ctx, P);
        poly(ctx, [[-4, 1], [10, 3], [12, 8], [-2, 8]]); shell(ctx, P);
        ctx.restore();
      }
      eye(ctx, P, -5, 8, 2.2, 0); eye(ctx, P, 5, 8, 2.2, 0);
      return;
    }
    // богомол
    const abd = cubic([2, 6], [-18, 16], [-34, 26], [-38, 42], 12);
    poly(ctx, ribbon(abd, 17, 4, 1.1)); skin(ctx, P);
    for (const s of [-1, 1]) for (let i = 0; i < 2; i++) {
      const leg = cubic([s * 5, 8], [s * (16 + i * 6), 14], [s * (14 + i * 8), 28], [s * (20 + i * 10), 42], 8);
      poly(ctx, ribbon(leg, 5, 2)); ctx.fillStyle = P.dark; ctx.fill();
      ctx.strokeStyle = P.ink; ctx.lineWidth = 1.1; ctx.stroke();
    }
    ell(ctx, 0, -2, 13, 17, 0.05); skin(ctx, P);
    for (const s of [-1, 1]) {                       // хватательные лапы
      const up = cubic([s * 9, -8], [s * 24, -14], [s * 30, -22], [s * 30, -30], 8);
      poly(ctx, ribbon(up, 8, 5)); skin(ctx, P, { line: 1.5 });
      const fore = cubic([s * 30, -30], [s * 34, -20], [s * 26, -8], [s * 20, -2], 8);
      poly(ctx, ribbon(fore, 7, 3)); shell(ctx, P);
      for (let i = 0; i < 4; i++) {                  // шипы
        poly(ctx, [[s * (28 - i * 2), -26 + i * 6], [s * (22 - i * 2), -24 + i * 6]], false);
        ctx.strokeStyle = P.pale; ctx.lineWidth = 1.3; ctx.stroke();
      }
    }
    ctx.save(); ctx.translate(2, -24);
    poly(ctx, [[-10, -2], [-6, -10], [8, -10], [12, 0], [4, 9], [-6, 8]]);
    skin(ctx, P, { line: 1.7 });
    for (const s of [-1, 1]) { poly(ctx, [[s * 4, -9], [s * 10, -22]], false); ctx.strokeStyle = P.pale; ctx.lineWidth = 1.8; ctx.stroke(); }
    eye(ctx, P, -4, -2, 3, 0.3); eye(ctx, P, 6, -2, 3, -0.3);
    ctx.restore();
  };

  /* ---- големы, панцирные, крепости ---- */
  ARCH.golem = (ctx, P, d) => {
    const v = d.golem || 'rock';
    if (v === 'turtle') {
      for (const s of [-1, 1]) {
        ell(ctx, s * 22, 30, 9, 12, s * 0.2); skin(ctx, P, { line: 1.6 });
        ell(ctx, s * 30, 6, 8, 11, s * 0.4); skin(ctx, P, { line: 1.6 });
      }
      ctx.save(); ctx.translate(26, -14);
      ell(ctx, 0, 0, 12, 10, -0.15); skin(ctx, P, { line: 1.8 });
      poly(ctx, [[4, 2], [13, 3], [10, 9], [3, 8]]); ctx.fillStyle = P.pale; ctx.fill();
      ctx.strokeStyle = P.ink; ctx.lineWidth = 1.2; ctx.stroke();
      eye(ctx, P, -1, -3, 2.4, 0);
      ctx.restore();
      ell(ctx, 0, 8, 34, 28, 0); shell(ctx, P);       // панцирь
      for (let i = 0; i < 6; i++) {                    // шестиугольные плиты
        const a = i / 6 * Math.PI * 2;
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const b = k / 6 * Math.PI * 2 + 0.5;
          const x = Math.cos(a) * 18 + Math.cos(b) * 8, y = 8 + Math.sin(a) * 15 + Math.sin(b) * 7;
          k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.closePath(); ctx.strokeStyle = alpha(P.deep, 0.75); ctx.lineWidth = 1.6; ctx.stroke();
      }
      ell(ctx, 0, 6, 11, 9, 0); ctx.fillStyle = alpha(P.pale, 0.45); ctx.fill();
      return;
    }
    // ноги
    for (const s of [-1, 1]) {
      poly(ctx, [[s * 6, 20], [s * 20, 20], [s * 22, 43], [s * 5, 43]]);
      skin(ctx, P);
    }
    // корпус
    poly(ctx, v === 'fort'
      ? [[-26, -18], [26, -18], [30, 24], [-30, 24]]
      : [[-22, -14], [-14, -22], [14, -22], [22, -14], [26, 22], [-26, 22]]);
    skin(ctx, P);
    if (v === 'fort') {
      for (let i = -2; i <= 2; i++) {                  // зубцы стены
        poly(ctx, [[i * 11 - 4, -18], [i * 11 + 4, -18], [i * 11 + 4, -28], [i * 11 - 4, -28]]);
        shell(ctx, P);
      }
      for (let i = -1; i <= 1; i++) {                  // бойницы
        poly(ctx, [[i * 14 - 3, -6], [i * 14 + 3, -6], [i * 14 + 3, 8], [i * 14 - 3, 8]]);
        ctx.fillStyle = P.deep; ctx.fill();
      }
    } else {
      for (let i = 0; i < 4; i++) {                    // трещины
        poly(ctx, [[-16 + i * 10, -14], [-12 + i * 10, 2], [-18 + i * 10, 22]], false);
        ctx.strokeStyle = alpha(P.deep, 0.65); ctx.lineWidth = 1.6; ctx.stroke();
      }
    }
    // плечи и кулаки
    for (const s of [-1, 1]) {
      poly(ctx, [[s * 18, -20], [s * 34, -14], [s * 36, 2], [s * 20, 0]]);
      shell(ctx, P);
      const arm = cubic([s * 30, 0], [s * 36, 10], [s * 34, 16], [s * 33, 22], 6);
      poly(ctx, ribbon(arm, 13, 11)); skin(ctx, P, { line: 1.6 });
      ell(ctx, s * 33, 28, 11, 10, 0); shell(ctx, P);
      if (d.spikes) for (let i = 0; i < 3; i++) horn(ctx, P, s * (24 + i * 5), -20, -1.6 - s * 0.3, 11, s * 2);
    }
    // голова
    ctx.save(); ctx.translate(0, -28);
    poly(ctx, [[-11, -8], [11, -8], [13, 4], [0, 10], [-13, 4]]); skin(ctx, P, { line: 1.8 });
    poly(ctx, [[-9, -2], [9, -2], [8, 3], [-8, 3]]);
    ctx.fillStyle = P.ink; ctx.fill();
    ctx.shadowColor = P.pale; ctx.shadowBlur = 9;
    poly(ctx, [[-7, -1], [7, -1], [6, 2], [-6, 2]]);
    ctx.fillStyle = '#fffbe8'; ctx.fill(); ctx.shadowBlur = 0;
    ctx.restore();
  };

  /* ---- рыцари, стражи, воины ---- */
  ARCH.knight = (ctx, P, d) => {
    if (d.cape) {                                    // плащ
      poly(ctx, [[-14, -14], [14, -14], [26, 34], [-26, 34]]);
      plate(ctx, P);
    }
    for (const s of [-1, 1]) {                       // ноги
      const leg = cubic([s * 8, 16], [s * 12, 26], [s * 11, 34], [s * 12, 42], 6);
      poly(ctx, ribbon(leg, 13, 9)); skin(ctx, P, { line: 1.6 });
      poly(ctx, [[s * 6, 41], [s * 18, 41], [s * 18, 45], [s * 6, 45]]); shell(ctx, P);
    }
    // корпус
    poly(ctx, [[-15, -14], [15, -14], [18, 6], [10, 20], [-10, 20], [-18, 6]]);
    skin(ctx, P);
    poly(ctx, [[-9, -10], [9, -10], [0, 12]]);       // нагрудник
    shell(ctx, P);
    for (const s of [-1, 1]) {                       // наплечники
      poly(ctx, [[s * 12, -16], [s * 27, -12], [s * 28, -1], [s * 14, -3]]);
      shell(ctx, P);
      if (d.spikes) horn(ctx, P, s * 24, -12, -1.7 - s * 0.5, 12, s * 3);
    }
    // руки и оружие
    const w = d.weapon || 'sword';
    for (const s of [-1, 1]) {
      const arm = cubic([s * 20, -4], [s * 26, 6], [s * 24, 12], [s * 24, 18], 6);
      poly(ctx, ribbon(arm, 9, 6)); skin(ctx, P, { line: 1.5 });
    }
    ctx.save(); ctx.translate(25, 19);
    if (w === 'sword') {
      ctx.rotate(0.34);
      poly(ctx, [[-3.5, 0], [3.5, 0], [3.5, -42], [0, -50], [-3.5, -42]]); shell(ctx, P);
      poly(ctx, [[-1, -40], [1, -40], [1, 0], [-1, 0]]);
      ctx.fillStyle = alpha(P.pale, 0.8); ctx.fill();
      poly(ctx, [[-10, 0], [10, 0], [10, 5], [-10, 5]]); ctx.fillStyle = P.dark; ctx.fill();
      ctx.strokeStyle = P.ink; ctx.lineWidth = 1.3; ctx.stroke();
      poly(ctx, [[-3, 5], [3, 5], [3, 13], [-3, 13]]); ctx.fillStyle = P.deep; ctx.fill(); ctx.stroke();
    } else if (w === 'lance') {
      ctx.rotate(0.42);
      poly(ctx, [[-2.5, 10], [2.5, 10], [2.5, -34], [0, -48], [-2.5, -34]]); shell(ctx, P);
      ell(ctx, 0, -2, 7, 4, 0); ctx.fillStyle = P.dark; ctx.fill();
      ctx.strokeStyle = P.ink; ctx.lineWidth = 1.2; ctx.stroke();
    } else {
      claws(ctx, P, 4, -2, -0.5, 16, 3);
    }
    ctx.restore();
    // шлем
    ctx.save(); ctx.translate(0, -26);
    poly(ctx, [[-11, 2], [-9, -10], [0, -14], [9, -10], [11, 2], [6, 10], [-6, 10]]);
    skin(ctx, P, { line: 1.8 });
    poly(ctx, [[-8, -1], [8, -1], [7, 4], [-7, 4]]); ctx.fillStyle = P.ink; ctx.fill();
    ctx.shadowColor = '#fff3c0'; ctx.shadowBlur = 10;
    poly(ctx, [[-6, 0.5], [6, 0.5], [5, 2.5], [-5, 2.5]]);
    ctx.fillStyle = '#fffbe8'; ctx.fill(); ctx.shadowBlur = 0;
    if (d.plume) for (let i = 0; i < 3; i++) horn(ctx, P, -1 + i, -12, -1.9 + i * 0.2, 16, 4);
    else for (const s of [-1, 1]) horn(ctx, P, s * 8, -8, -1.4 - s * 0.5, 13, s * 3);
    ctx.restore();
  };

  /* ---- водные ---- */
  ARCH.aqua = (ctx, P, d) => {
    const v = d.aqua || 'jelly';
    if (v === 'ray') {
      const tail = cubic([0, 10], [-16, 24], [-34, 30], [-44, 22], 12);
      poly(ctx, ribbon(tail, 8, 1.5, 1.3)); skin(ctx, P);
      poly(ctx, [[0, -22], [40, 2], [24, 12], [0, 18], [-24, 12], [-40, 2]]);
      skin(ctx, P);
      for (const s of [-1, 1]) {
        poly(ctx, [[0, -14], [s * 32, 3]], false);
        ctx.strokeStyle = alpha(P.pale, 0.5); ctx.lineWidth = 2; ctx.stroke();
      }
      eye(ctx, P, -8, -8, 2.6, 0); eye(ctx, P, 8, -8, 2.6, 0);
      return;
    }
    if (v === 'mermaid') {
      const tail = cubic([0, 12], [-8, 26], [-20, 32], [-26, 40], 12);
      poly(ctx, ribbon(tail, 16, 5, 1.1)); skin(ctx, P);
      poly(ctx, [[-26, 40], [-44, 30], [-38, 44], [-46, 48], [-24, 47]]);
      plate(ctx, P);
      for (let i = 2; i < 10; i += 2) {
        const p = tail[i]; ell(ctx, p[0], p[1], 5, 3.4, 0.5);
        ctx.strokeStyle = alpha(P.deep, 0.5); ctx.lineWidth = 1.1; ctx.stroke();
      }
      poly(ctx, [...cubic([-11, 12], [-13, -6], [-6, -16], [2, -17], 10),
                 ...cubic([2, -17], [11, -14], [13, -2], [11, 12], 10)]);
      skin(ctx, P);
      for (const s of [-1, 1]) {
        const arm = cubic([s * 10, -8], [s * 20, -2], [s * 22, 6], [s * 20, 12], 6);
        poly(ctx, ribbon(arm, 7, 4)); skin(ctx, P, { line: 1.4 });
      }
      ctx.save(); ctx.translate(2, -26);
      ell(ctx, 0, 0, 10, 11, 0); skin(ctx, P, { line: 1.7 });
      for (let i = 0; i < 5; i++) {                    // волосы-плавники
        const h = cubic([-4, -6], [-16 - i * 3, -2 + i * 3], [-20 - i * 4, 10 + i * 4], [-14 - i * 4, 22 + i * 5], 8);
        poly(ctx, ribbon(h, 7, 1.5, 1.2)); plate(ctx, P);
      }
      eye(ctx, P, -3, 0, 2.4, 0); eye(ctx, P, 5, 0, 2.4, 0);
      ctx.restore();
      return;
    }
    // медуза / спрут: купол и щупальца
    const n = d.arms || 6;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1) - 0.5;
      const sway = Math.sin(i * 1.7) * 10;
      const arm = cubic([t * 22, 4], [t * 34, 20], [t * 40 + sway, 30], [t * 44 + sway * 1.4, 44], 12);
      poly(ctx, ribbon(arm, 8 - Math.abs(t) * 2, 1.5, 1.2));
      ctx.fillStyle = i % 2 ? P.base : P.mid; ctx.fill();
      ctx.strokeStyle = P.ink; ctx.lineWidth = 1.3; ctx.stroke();
    }
    poly(ctx, [...cubic([-28, 6], [-30, -18], [-14, -30], [0, -30], 12),
               ...cubic([0, -30], [14, -30], [30, -18], [28, 6], 12),
               ...cubic([28, 6], [14, 12], [-14, 12], [-28, 6], 8)]);
    skin(ctx, P);
    ell(ctx, -6, -12, 11, 9, -0.3); ctx.fillStyle = alpha(P.pale, 0.4); ctx.fill();
    for (let i = -2; i <= 2; i++) {
      poly(ctx, [[i * 10, -26], [i * 12, 8]], false);
      ctx.strokeStyle = alpha(P.deep, 0.4); ctx.lineWidth = 1.4; ctx.stroke();
    }
    eye(ctx, P, -9, -6, 3.2, 0); eye(ctx, P, 9, -6, 3.2, 0);
  };

  /* ---- звери ---- */
  ARCH.beast = (ctx, P, d) => {
    const tail = cubic([-14, 20], [-32, 22], [-42, 8], [-38, -8], 12);
    poly(ctx, ribbon(tail, 11, 2.5, 1.2)); skin(ctx, P);
    if (d.wings) for (const s of [-1, 1]) {
      poly(ctx, [[s * 10, -12], [s * 40, -34], [s * 32, -8], [s * 20, -12], [s * 22, 0]]);
      plate(ctx, P);
    }
    for (const s of [-1, 1]) {                       // ноги
      const leg = cubic([s * 12, 16], [s * 18, 26], [s * 15, 34], [s * 16, 42], 8);
      poly(ctx, ribbon(leg, 16, 10)); skin(ctx, P, { line: 1.6 });
      claws(ctx, P, s * 16, 43, Math.PI / 2, 6, 3);
    }
    poly(ctx, [...cubic([-18, 20], [-22, 0], [-12, -12], [2, -14], 12),
               ...cubic([2, -14], [16, -12], [22, 2], [18, 20], 12),
               ...cubic([18, 20], [6, 26], [-8, 26], [-18, 20], 8)]);
    skin(ctx, P);
    for (const s of [-1, 1]) {                       // руки
      const arm = cubic([s * 15, -6], [s * 26, 2], [s * 26, 10], [s * 27, 17], 8);
      poly(ctx, ribbon(arm, 11, 7)); skin(ctx, P, { line: 1.5 });
      claws(ctx, P, s * 27, 19, Math.PI / 2.2 * s, 8, 3);
    }
    // грива
    ctx.save(); ctx.translate(2, -24);
    for (let i = 0; i < 13; i++) {
      const a = -Math.PI - 0.3 + i * (Math.PI / 10);
      poly(ctx, [[Math.cos(a) * 9, Math.sin(a) * 9],
                 [Math.cos(a - 0.08) * 30, Math.sin(a - 0.08) * 27],
                 [Math.cos(a + 0.34) * 10, Math.sin(a + 0.34) * 10]]);
      ctx.fillStyle = i % 2 ? P.deep : P.mid; ctx.fill();
      ctx.strokeStyle = P.ink; ctx.lineWidth = 1.1; ctx.stroke();
    }
    ell(ctx, 1, 1, 12, 11, 0); skin(ctx, P, { line: 1.8 });
    poly(ctx, [[5, 2], [16, 4], [12, 11], [3, 9]]);
    ctx.fillStyle = P.pale; ctx.fill(); ctx.strokeStyle = P.ink; ctx.lineWidth = 1.2; ctx.stroke();
    for (let i = 0; i < 2; i++) { poly(ctx, [[6 + i * 5, 9], [8.5 + i * 5, 9], [7 + i * 5, 14]]); ctx.fillStyle = '#f4f6ff'; ctx.fill(); }
    for (const s of [-1, 1]) horn(ctx, P, s * 8, -8, -1.5 - s * 0.6, 14, s * 3);
    eye(ctx, P, -3, -1, 2.6, -0.2); eye(ctx, P, 7, -2, 2.4, -0.2);
    ctx.restore();
  };

  /* ---- духи и феи ---- */
  ARCH.spirit = (ctx, P, d) => {
    for (const s of [-1, 1]) {                       // крылья
      poly(ctx, [[s * 6, -10], [s * 30, -40], [s * 40, -14], [s * 24, 0], [s * 30, 12], [s * 8, 6]]);
      ctx.globalAlpha = 0.75; plate(ctx, P); ctx.globalAlpha = 1;
      poly(ctx, [[s * 8, -8], [s * 32, -28]], false);
      ctx.strokeStyle = alpha(P.pale, 0.6); ctx.lineWidth = 1.6; ctx.stroke();
    }
    const body = cubic([0, -14], [-12, 8], [-4, 26], [-14, 44], 14);
    poly(ctx, ribbon(body, 24, 6, 1.1)); skin(ctx, P);
    for (let i = 0; i < 3; i++) {                    // огоньки
      const a = i * 2.1;
      ell(ctx, Math.cos(a) * 26, -18 + Math.sin(a) * 16, 3.4, 3.4, 0);
      ctx.fillStyle = P.pale; ctx.shadowColor = P.glow; ctx.shadowBlur = 10; ctx.fill(); ctx.shadowBlur = 0;
    }
    ctx.save(); ctx.translate(0, -24);
    poly(ctx, [[-11, 4], [-9, -8], [0, -13], [9, -8], [11, 4], [0, 12]]);
    skin(ctx, P, { line: 1.7 });
    for (let i = 0; i < 4; i++) horn(ctx, P, -6 + i * 4, -10, -2.1 + i * 0.35, 12 + (i % 2) * 5, 3);
    eye(ctx, P, -4, 0, 2.4, 0.2); eye(ctx, P, 4, 0, 2.4, -0.2);
    ctx.restore();
  };

  /* ================= описания видов ================= */
  const KIND = {
    'Дракон':      { arch: 'dragon', wing: 1, horns: 3, spikes: true },
    'Ящер':        { arch: 'dragon', wing: 0, horns: 2, wings: false, jawHorn: true },
    'Змей':        { arch: 'dragon', wing: 0, horns: 2, wings: false },
    'Гидра':       { arch: 'dragon', wing: 1, horns: 2, heads: 3 },
    'Грифон':      { arch: 'bird',   wing: 1, crest: 2 },
    'Феникс':      { arch: 'bird',   wing: 2, crest: 4 },
    'Сокол':       { arch: 'bird',   wing: 1, crest: 2 },
    'Кондор':      { arch: 'bird',   wing: 2, crest: 1 },
    'Тигр':        { arch: 'feline' },
    'Зверь':       { arch: 'beast' },
    'Мантикора':   { arch: 'beast',  wings: true },
    'Коготь':      { arch: 'beast' },
    'Змея':        { arch: 'serpent', hood: true },
    'Хамелеон':    { arch: 'serpent' },
    'Богомол':     { arch: 'insect', insect: 'mantis' },
    'Скорпион':    { arch: 'insect', insect: 'scorpion' },
    'Сколопендра': { arch: 'insect', insect: 'centipede' },
    'Голем':       { arch: 'golem',  golem: 'rock', spikes: true },
    'Титан':       { arch: 'golem',  golem: 'rock' },
    'Черепаха':    { arch: 'golem',  golem: 'turtle' },
    'Крепость':    { arch: 'golem',  golem: 'fort' },
    'Страж':       { arch: 'knight', weapon: 'lance', cape: false },
    'Рыцарь':      { arch: 'knight', weapon: 'sword', cape: true },
    'Воин':        { arch: 'knight', weapon: 'claw', plume: true },
    'Сирена':      { arch: 'aqua',   aqua: 'mermaid' },
    'Медуза':      { arch: 'aqua',   aqua: 'jelly', arms: 7 },
    'Спрут':       { arch: 'aqua',   aqua: 'jelly', arms: 8 },
    'Осьминог':    { arch: 'aqua',   aqua: 'jelly', arms: 8 },
    'Скат':        { arch: 'aqua',   aqua: 'ray' },
    'Фея':         { arch: 'spirit' },
    'Дух':         { arch: 'spirit' }
  };

  /* штучные приметы легенд и вторых форм */
  const NAMED = {
    'Дельта Драго':   { wing: 2, horns: 4, spikes: true },
    'Драго':          { wing: 1, horns: 3 },
    'Хайдраноид':     { heads: 3, wing: 2, horns: 3 },
    'Гораем':         { spikes: true },
    'Блейд Тигрерра': { blades: true },
    'Шторм Скайресс': { wing: 2, crest: 5 },
    'Фортресс':       { golem: 'fort', spikes: true },
    'Элфин':          { arch: 'spirit' },
    'Сааргон':        { wings: false, horns: 3, jawHorn: true },
    'Мэнион':         { wings: true },
    'Найтид':         { plume: true, weapon: 'sword', cape: true },
    'Апполон':        { weapon: 'lance', plume: true }
  };

  const designCache = new Map();
  function design(bk) {
    if (designCache.has(bk.name)) return designCache.get(bk.name);
    const base = KIND[bk.kind] || { arch: 'beast' };
    const d = Object.assign({ wing: 1, horns: 2, crest: 3, arms: 6 }, base, NAMED[bk.name] || {});
    // мелкие отличия у существ одного вида — по имени
    let h = 2166136261;
    for (let i = 0; i < bk.name.length; i++) { h ^= bk.name.charCodeAt(i); h = Math.imul(h, 16777619); }
    d.seed = (h >>> 0) / 4294967296;
    designCache.set(bk.name, d);
    return d;
  }

  /* ================= отрисовка ================= */
  /**
   * ctx    — контекст
   * bk     — бакуган {name, attr, kind}
   * size   — высота фигуры в пикселях
   * o.x,o.y— точка опоры (ноги)
   * o.facing — 1 вправо, -1 влево
   * o.glow — сила свечения
   */
  function draw(ctx, bk, size, o) {
    o = o || {};
    const P = palette(ATTR[bk.attr].c);
    const d = design(bk);
    const k = size / 100;
    ctx.save();
    ctx.translate(o.x || 0, o.y || 0);
    ctx.scale(k * (o.facing === -1 ? -1 : 1), k);
    ctx.translate(0, -44);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';

    if (o.shadow !== false) {                    // тень под ногами
      ell(ctx, 0, 46, 30, 7, 0);
      ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fill();
    }
    if (o.glow) {
      ctx.shadowColor = P.glow; ctx.shadowBlur = 26 * o.glow;
    }
    (ARCH[d.arch] || ARCH.beast)(ctx, P, d);
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  /* классический шар бакугана — форма до раскрытия */
  function ball(ctx, bk, r, rot, o) {
    o = o || {};
    const P = palette(ATTR[bk.attr].c);
    ctx.save(); ctx.translate(o.x || 0, o.y || 0); ctx.rotate(rot || 0);
    ctx.shadowColor = P.glow; ctx.shadowBlur = 20;
    const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.05, 0, 0, r);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.22, P.lite);
    g.addColorStop(0.6, P.base); g.addColorStop(1, P.deep);
    ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fillStyle = g; ctx.fill();
    ctx.shadowBlur = 0;
    // верхняя тёмная половина
    ctx.beginPath(); ctx.arc(0, 0, r, Math.PI, 0);
    ctx.fillStyle = alpha(P.deep, 0.55); ctx.fill();
    // шов и панельные линии
    ctx.strokeStyle = alpha('#ffffff', 0.85); ctx.lineWidth = Math.max(1, r * 0.13);
    ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(r, 0); ctx.stroke();
    ctx.strokeStyle = alpha(P.pale, 0.7); ctx.lineWidth = Math.max(0.8, r * 0.07);
    for (const s of [-1, 1]) {
      ctx.beginPath(); ctx.ellipse(0, 0, r * 0.55, r, 0, s > 0 ? -1.2 : 1.9, s > 0 ? 1.2 : 4.4); ctx.stroke();
    }
    // защёлка
    ctx.beginPath(); ctx.arc(r * 0.66, 0, r * 0.2, 0, 7);
    ctx.fillStyle = P.pale; ctx.fill();
    ctx.strokeStyle = INK; ctx.lineWidth = Math.max(0.7, r * 0.06); ctx.stroke();
    // блик
    ctx.beginPath(); ctx.ellipse(-r * 0.38, -r * 0.42, r * 0.26, r * 0.15, -0.7, 0, 7);
    ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.fill();
    ctx.restore();
  }

  /* готовый спрайт: рисуем существо один раз и дальше просто копируем */
  const spriteCache = new Map();
  function sprite(bk, size, facing, glow) {
    const key = bk.name + '|' + size + '|' + facing + '|' + (glow || 0);
    if (spriteCache.has(key)) return spriteCache.get(key);
    const k = size / 100;
    const w = Math.ceil(124 * k), h = Math.ceil(104 * k);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    draw(x, bk, size, { x: w / 2, y: 96 * k, facing, shadow: false, glow });
    const s = { c, ax: w / 2, ay: 96 * k };
    spriteCache.set(key, s);
    return s;
  }
  /* копия спрайта: x,y — точка опоры (ноги) */
  function blit(ctx, bk, size, x, y, facing, a, glow) {
    const s = sprite(bk, size, facing === -1 ? -1 : 1, glow);
    if (a !== undefined) ctx.globalAlpha = a;
    ctx.drawImage(s.c, Math.round(x - s.ax), Math.round(y - s.ay));
    if (a !== undefined) ctx.globalAlpha = 1;
  }

  /* круглый значок для карточек интерфейса — кэшируется */
  const badgeCache = new Map();
  function badge(bk, px) {
    const key = bk.name + '@' + px;
    if (badgeCache.has(key)) return badgeCache.get(key);
    const c = document.createElement('canvas');
    c.width = c.height = px;
    const x = c.getContext('2d');
    const P = palette(ATTR[bk.attr].c);
    x.save();
    x.beginPath(); x.arc(px / 2, px / 2, px / 2, 0, 7); x.clip();
    const g = x.createRadialGradient(px * 0.32, px * 0.24, px * 0.05, px / 2, px / 2, px * 0.72);
    g.addColorStop(0, alpha(P.lite, 0.55)); g.addColorStop(0.55, alpha(P.deep, 0.9)); g.addColorStop(1, '#05070e');
    x.fillStyle = g; x.fillRect(0, 0, px, px);
    for (let i = 0; i < 7; i++) {                    // лучи за спиной
      x.save(); x.translate(px / 2, px / 2); x.rotate(i * 0.9);
      x.beginPath(); x.moveTo(0, 0); x.lineTo(px * 0.7, -px * 0.06); x.lineTo(px * 0.7, px * 0.06);
      x.fillStyle = alpha(P.base, 0.12); x.fill(); x.restore();
    }
    draw(x, bk, px * 0.84, { x: px / 2, y: px * 0.95, shadow: false });
    x.restore();
    x.beginPath(); x.arc(px / 2, px / 2, px / 2 - 1, 0, 7);
    x.strokeStyle = alpha(P.base, 0.9); x.lineWidth = Math.max(1.5, px * 0.035); x.stroke();
    const url = c.toDataURL();
    badgeCache.set(key, url);
    return url;
  }

  /* подставляет значки во все элементы с data-cre */
  function apply(root) {
    (root || document).querySelectorAll('[data-cre]').forEach(el => {
      const b = bakuganByName(el.dataset.cre);
      if (!b) return;
      el.style.backgroundImage = `url(${badge(b, 128)})`;
      el.removeAttribute('data-cre');
    });
  }

  return { draw, blit, sprite, ball, badge, apply, palette, design };
})();
