'use strict';

/* =========================================================
   Аккаунт: регистрация / вход, шапка профиля, магазин
   ========================================================= */

let PROFILE = null;

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------------- регистрация / вход ---------------- */
let authMode = 'login';
let authElement = 'pyrus';

function showAuth() {
  $('authOverlay').classList.remove('hidden');
  $('startOverlay').classList.add('hidden');
  renderAuth();
}

function renderAuth() {
  $('authTabs').innerHTML = [['login', 'Вход'], ['register', 'Регистрация']].map(([id, n]) =>
    `<button class="tab ${authMode === id ? 'on' : ''}" style="--ac:#ffb020" data-m="${id}">${n}</button>`).join('');
  $('authTabs').querySelectorAll('.tab').forEach(el => {
    el.onclick = () => { authMode = el.dataset.m; SFX.click(); renderAuth(); };
  });

  $('authElemWrap').style.display = authMode === 'register' ? '' : 'none';
  $('authHint').textContent = authMode === 'register'
    ? 'Стихия определяет ваш стартовый набор: три бакугана, карты врат и карты способностей — все выбранной стихии.'
    : 'Войдите, чтобы продолжить со своей коллекцией и жетонами.';
  $('btnAuth').textContent = authMode === 'register' ? 'СОЗДАТЬ БОЙЦА' : 'ВОЙТИ';

  $('elemPick').innerHTML = CYCLE.map(k => {
    const a = ATTR[k];
    return `<button class="elem ${authElement === k ? 'on' : ''}" style="--ac:${a.c}" data-k="${k}">
      <span class="orb" style="--ac:${a.c}">${a.i}</span>
      <b>${a.n}</b><i>${a.ru}</i></button>`;
  }).join('');
  $('elemPick').querySelectorAll('.elem').forEach(el => {
    el.onclick = () => { authElement = el.dataset.k; SFX.select(); renderAuth(); };
  });
  $('authMsg').textContent = '';
}

async function submitAuth() {
  const username = $('authName').value.trim();
  const password = $('authPass').value;
  const msg = $('authMsg');
  msg.className = 'msg';
  msg.textContent = 'Отправляем…';
  try {
    const data = authMode === 'register'
      ? await API.post('/api/register', { username, password, element: authElement })
      : await API.post('/api/login', { username, password });
    SFX.open();
    applyProfile(data);
    $('authOverlay').classList.add('hidden');
    $('authPass').value = '';
    openLobby();
  } catch (e) {
    SFX.deny();
    msg.className = 'msg err';
    msg.textContent = e.message;
  }
}

async function doLogout() {
  SFX.click();
  try { await API.post('/api/logout'); } catch (e) {}
  PROFILE = null;
  location.reload();
}

/* ---------------- шапка ---------------- */
function applyProfile(data) {
  PROFILE = data;
  renderHeaderUser();
  if (typeof FRIENDS !== 'undefined') FRIENDS.watch();
}

function renderHeaderUser() {
  const box = $('userChip');
  if (!PROFILE) { box.innerHTML = ''; return; }
  const u = PROFILE.user, a = ATTR[u.element];
  box.innerHTML = `
    <span class="orb" style="--ac:${a.c}" title="${a.n} · ${a.ru}">${a.i}</span>
    <span class="uname">${esc(u.username)}</span>
    <span class="tok" title="Жетоны">🪙 ${u.tokens}</span>
    <span class="wl" title="Победы / поражения">${u.wins}–${u.losses}</span>`;
}

/* ---------------- магазин ---------------- */
let shopTab = 'bakugan';
let shopAttr = 'pyrus';

function openShop() {
  if (!PROFILE) return;
  SFX.click();
  shopAttr = PROFILE.user.element;
  $('shopOverlay').classList.remove('hidden');
  renderShop();
  loadTop();
}
function closeShop() { SFX.click(); $('shopOverlay').classList.add('hidden'); }

function shopMsg(text, err) {
  const m = $('shopMsg');
  m.className = 'msg' + (err ? ' err' : ' ok');
  m.textContent = text;
  clearTimeout(shopMsg._t);
  shopMsg._t = setTimeout(() => { m.textContent = ''; m.className = 'msg'; }, 4000);
}

async function buy(payload, label) {
  try {
    const data = await API.post('/api/shop/buy', payload);
    applyProfile(data);
    SFX.open();
    shopMsg('Куплено: ' + label);
    renderShop();
    if (typeof refreshLobby === 'function') refreshLobby();
  } catch (e) {
    SFX.deny();
    shopMsg(e.message, true);
  }
}

function renderShop() {
  const tabs = [['bakugan', '🎱 Бакуганы'], ['ability', '⚡ Способности'],
                ['gate', '❂ Карты врат'], ['account', '👤 Аккаунт']];
  $('shopTabs').innerHTML = tabs.map(([id, n]) =>
    `<button class="tab ${shopTab === id ? 'on' : ''}" style="--ac:#ffb020" data-t="${id}">${n}</button>`).join('');
  $('shopTabs').querySelectorAll('.tab').forEach(el => {
    el.onclick = () => { shopTab = el.dataset.t; SFX.click(); renderShop(); };
  });
  $('shopTokens').innerHTML = `🪙 <b>${PROFILE.user.tokens}</b> жетонов`;

  if (shopTab === 'bakugan') renderShopBakugan();
  else if (shopTab === 'account') renderShopAccount();
  else renderShopCards(shopTab);
}

function attrFilterHTML(sel) {
  return `<div class="tabs small">` + CYCLE.map(k =>
    `<button class="tab ${sel === k ? 'on' : ''}" style="--ac:${ATTR[k].c}" data-a="${k}">
      <span>${ATTR[k].i}</span>${ATTR[k].n}</button>`).join('') + `</div>`;
}

function renderShopBakugan() {
  const owned = new Set(PROFILE.bakugan);
  let html = attrFilterHTML(shopAttr) + '<div class="shopgrid">';
  html += POOL.filter(b => b.attr === shopAttr).map(b => {
    const A = ATTR[b.attr], have = owned.has(b.name), price = bakuganPrice(b);
    return `<div class="sitem ${have ? 'have' : ''}" style="--ac:${A.c}">
      <div class="orb cre big" style="--ac:${A.c}" data-cre="${esc(b.name)}"></div>
      <div class="sinfo">
        <b>${b.name}</b>
        <span>${A.n} · ${b.kind} · <i class="tier">${stars(b.tier)}</i></span>
        <span class="gv">${b.g} G</span>
      </div>
      ${have ? '<div class="own">в коллекции</div>'
             : `<button class="buy" data-name="${esc(b.name)}">🪙 ${price}</button>`}
    </div>`;
  }).join('') + '</div>';
  $('shopBody').innerHTML = html;
  CRE.apply($('shopBody'));
  bindAttrFilter();
  $('shopBody').querySelectorAll('.buy').forEach(el => {
    el.onclick = () => buy({ item: 'bakugan', name: el.dataset.name }, el.dataset.name);
  });
}

function renderShopCards(kind) {
  const list = kind === 'ability' ? ABILITIES : GATE_TYPES;
  const price = PRICES[kind];
  const mine = {};
  for (const c of PROFILE.cards[kind]) mine[c.type + '|' + c.attr] = c.qty;

  let html = attrFilterHTML(shopAttr) + '<div class="shopgrid">';
  html += list.map(t => {
    const fake = { type: t.id, attr: shopAttr };
    const col = kind === 'gate' ? gateColor(fake) : '#a08bff';
    const title = kind === 'gate' ? gateTitle(fake) : t.name;
    const desc = kind === 'gate' ? gateDesc(fake) : t.desc;
    const icon = kind === 'gate' ? (t.id === 'attr' ? ATTR[shopAttr].i : t.icon) : t.icon;
    const have = mine[t.id + '|' + shopAttr] || 0;
    return `<div class="sitem" style="--ac:${col}">
      <div class="sicon">${icon}</div>
      <div class="sinfo">
        <b>${title}</b>
        <span>${desc}</span>
        <span class="gv">${ATTR[shopAttr].i} ${ATTR[shopAttr].n}${have ? ' · у вас: ' + have : ''}</span>
      </div>
      <button class="buy" data-type="${t.id}">🪙 ${price}</button>
    </div>`;
  }).join('') + '</div>';
  html += `<p class="shophint">Стихия карты даёт <b>+${RESONANCE} G</b> бакугану той же стихии
    («созвучие»). У стихийных врат вместо этого работает их обычный бонус +150 G.</p>`;
  $('shopBody').innerHTML = html;
  bindAttrFilter();
  $('shopBody').querySelectorAll('.buy').forEach(el => {
    el.onclick = () => {
      const t = el.dataset.type;
      const nm = kind === 'gate' ? gateTitle({ type: t, attr: shopAttr }) : abilityById(t).name;
      buy({ item: kind, type: t, attr: shopAttr }, nm + ' (' + ATTR[shopAttr].n + ')');
    };
  });
}

function bindAttrFilter() {
  $('shopBody').querySelectorAll('.tabs.small .tab').forEach(el => {
    el.onclick = () => { shopAttr = el.dataset.a; SFX.click(); renderShop(); };
  });
}

function renderShopAccount() {
  const u = PROFILE.user, a = ATTR[u.element];
  $('shopBody').innerHTML = `
    <div class="acctgrid">
      <div class="acct">
        <h4>Смена никнейма <em>🪙 ${PRICES.rename}</em></h4>
        <p class="small">Текущий: <b>${esc(u.username)}</b></p>
        <div class="row2">
          <input id="newName" maxlength="16" placeholder="Новый никнейм">
          <button class="mini" id="doRename">Сменить</button>
        </div>
      </div>
      <div class="acct">
        <h4>Смена стихии <em>🪙 ${PRICES.element}</em></h4>
        <p class="small">Текущая: <b style="color:${a.c}">${a.i} ${a.n} · ${a.ru}</b>.
          Коллекция сохраняется — меняется только ваша родная стихия.</p>
        <div class="elemrow">${CYCLE.filter(k => k !== u.element).map(k =>
          `<button class="mini el" style="--ac:${ATTR[k].c}" data-k="${k}">${ATTR[k].i} ${ATTR[k].n}</button>`).join('')}</div>
      </div>
      <div class="acct wide">
        <h4>Ваша статистика</h4>
        <div class="stats">
          <div class="st"><b>${u.wins}</b><span>побед</span></div>
          <div class="st"><b>${u.losses}</b><span>поражений</span></div>
          <div class="st"><b>${u.streak}</b><span>серия</span></div>
          <div class="st"><b>${u.best}</b><span>рекорд</span></div>
          <div class="st"><b>${u.battlesWon}</b><span>врат взято</span></div>
          <div class="st"><b>${PROFILE.bakugan.length}</b><span>бакуганов</span></div>
        </div>
      </div>
      <div class="acct wide">
        <h4>Топ бойцов</h4>
        <div id="topList" class="toplist">загрузка…</div>
      </div>
    </div>`;

  $('doRename').onclick = () => {
    const v = $('newName').value.trim();
    if (!v) { SFX.deny(); shopMsg('Введите новый никнейм', true); return; }
    buy({ item: 'rename', value: v }, 'никнейм ' + v);
  };
  $('shopBody').querySelectorAll('.mini.el').forEach(el => {
    el.onclick = () => buy({ item: 'element', value: el.dataset.k }, 'стихия ' + ATTR[el.dataset.k].n);
  });
  loadTop();
}

async function loadTop() {
  const box = $('topList');
  if (!box) return;
  try {
    const { top } = await API.get('/api/leaderboard');
    box.innerHTML = top.length ? top.map((r, i) => {
      const a = ATTR[r.element];
      const me = PROFILE && r.username === PROFILE.user.username;
      return `<div class="toprow ${me ? 'me' : ''}">
        <i>${i + 1}</i>
        <span class="orb" style="--ac:${a.c}">${a.i}</span>
        <b>${esc(r.username)}</b>
        <em>${r.wins}–${r.losses}</em>
        <u>рекорд ${r.best_streak}</u></div>`;
    }).join('') : '<div class="small">пока никто не играл</div>';
  } catch (e) {
    box.innerHTML = '<div class="small">не удалось загрузить</div>';
  }
}

/* ---------------- привязка кнопок ---------------- */
function bindAccountUI() {
  $('btnAuth').onclick = submitAuth;
  $('authPass').addEventListener('keydown', e => { if (e.key === 'Enter') submitAuth(); });
  $('authName').addEventListener('keydown', e => { if (e.key === 'Enter') submitAuth(); });
  $('btnShop').onclick = openShop;
  $('btnShop2').onclick = openShop;
  $('btnCloseShop').onclick = closeShop;
  $('btnMmCancel').onclick = () => MP.cancel();
  $('btnFriends').onclick = () => FRIENDS.open();
  $('btnCloseFriends').onclick = () => FRIENDS.close();
  $('btnFrAdd').onclick = () => FRIENDS.add();
  $('frName').addEventListener('keydown', e => { if (e.key === 'Enter') FRIENDS.add(); });
  $('btnLogout').onclick = doLogout;
}
