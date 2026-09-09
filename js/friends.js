'use strict';

/* =========================================================
   Друзья: поиск по нику, заявки, приглашения на бой.
   ========================================================= */

const FRIENDS = {
  data: null,
  timer: null,        // опрос, пока открыто окно
  bg: null,           // фоновый опрос ради значка на кнопке
  waitingFor: null,   // кого позвали на бой и ждём ответа

  /* ---------- окно ---------- */
  open() {
    if (!PROFILE) return;
    SFX.click();
    $('friendsOverlay').classList.remove('hidden');
    this.refresh();
    clearInterval(this.timer);
    this.timer = setInterval(() => this.refresh(), 4000);
  },
  close() {
    SFX.click();
    $('friendsOverlay').classList.add('hidden');
    clearInterval(this.timer); this.timer = null;
  },

  /* фоновая проверка входящих — раз в 20 секунд */
  watch() {
    if (this.bg || !PROFILE) return;
    this.bg = setInterval(() => {
      if (!PROFILE) return;
      if ($('friendsOverlay').classList.contains('hidden')) this.refresh(true);
    }, 20000);
    this.refresh(true);
  },

  msg(text, err) {
    const m = $('frMsg');
    m.className = 'msg' + (err ? ' err' : ' ok');
    m.textContent = text;
    clearTimeout(this._t);
    this._t = setTimeout(() => { m.textContent = ''; m.className = 'msg'; }, 4000);
  },

  async refresh(quiet) {
    try {
      this.data = await API.get('/api/friends');
      this.badge();
      if (!quiet || !$('friendsOverlay').classList.contains('hidden')) this.render();
      this.checkInviteAccepted();
    } catch (e) { /* сеть подождёт до следующего опроса */ }
  },

  badge() {
    const n = (this.data.incoming.length + this.data.invites.length);
    const el = $('frBadge');
    el.textContent = n;
    el.classList.toggle('hidden', n === 0);
    if (n > 0 && this._lastN !== n) SFX.tick();
    this._lastN = n;
  },

  /* ---------- отрисовка ---------- */
  render() {
    const d = this.data;
    if (!d) return;
    let html = '';

    if (d.invites.length) {
      html += this.section('Зовут на бой', d.invites.map(f => this.row(f, [
        ['ok', 'Принять бой', 'acceptBattle'],
        ['no', 'Отклонить', 'remove']
      ])).join(''));
    }
    if (d.incoming.length) {
      html += this.section('Заявки в друзья', d.incoming.map(f => this.row(f, [
        ['ok', 'Принять', 'accept'],
        ['no', 'Отклонить', 'remove']
      ])).join(''));
    }

    const fl = d.friends.map(f => {
      const acts = [];
      if (this.waitingFor === f.username) acts.push(['wait', 'Ждём ответа…', null]);
      else if (f.inMatch) acts.push(['dis', 'В бою', null]);
      else if (!f.online) acts.push(['dis', 'Не в сети', null]);
      else acts.push(['ok', 'Позвать в бой', 'invite']);
      acts.push(['no', 'Удалить', 'remove']);
      return this.row(f, acts);
    }).join('');
    html += this.section('Ваши друзья' + (d.friends.length ? ' · ' + d.friends.length : ''),
      fl || '<div class="frempty">Пока никого. Добавьте бойца по никнейму выше.</div>');

    if (d.outgoing.length) {
      html += this.section('Отправленные заявки', d.outgoing.map(f => this.row(f, [
        ['no', 'Отменить', 'remove']
      ])).join(''));
    }
    $('frBody').innerHTML = html;
    $('frBody').querySelectorAll('button[data-act]').forEach(el => {
      el.onclick = () => this[el.dataset.act](el.dataset.name);
    });
  },

  section(title, body) {
    return `<div class="frsec"><h4>${title}</h4>${body}</div>`;
  },

  row(f, acts) {
    const a = ATTR[f.element] || ATTR.pyrus;
    const stat = f.wins !== undefined ? `<em>${f.wins}–${f.losses} · рекорд ${f.best}</em>` : '';
    const dot = f.online === undefined ? ''
      : `<span class="dot ${f.online ? 'on' : ''}" title="${f.online ? 'в сети' : 'не в сети'}"></span>`;
    return `<div class="frrow" style="--ac:${a.c}">
      <span class="orb" style="--ac:${a.c}">${a.i}</span>
      <span class="frname">${dot}<b>${esc(f.username)}</b><i>${a.n}</i></span>
      ${stat}
      <span class="fracts">${acts.map(([cls, label, act]) => act
        ? `<button class="fbtn ${cls}" data-act="${act}" data-name="${esc(f.username)}">${label}</button>`
        : `<span class="fbtn ${cls}">${label}</span>`).join('')}</span>
    </div>`;
  },

  /* ---------- действия ---------- */
  async call(path, name, okText) {
    try {
      this.data = await API.post(path, { username: name });
      SFX.select();
      this.badge(); this.render();
      if (okText) this.msg(okText);
    } catch (e) { SFX.deny(); this.msg(e.message, true); }
  },

  add() {
    const v = $('frName').value.trim();
    if (!v) { SFX.deny(); this.msg('Введите никнейм', true); return; }
    $('frName').value = '';
    this.call('/api/friends/add', v, 'Заявка отправлена: ' + v);
  },
  accept(name) { this.call('/api/friends/accept', name, name + ' теперь у вас в друзьях'); },
  remove(name) {
    if (this.waitingFor === name) this.waitingFor = null;
    this.call('/api/friends/remove', name);
  },

  /* позвать друга на бой */
  async invite(name) {
    const team = this.team();
    if (!team) { SFX.deny(); this.msg('Сначала соберите команду в лобби', true); return; }
    try {
      await API.post('/api/mp/invite', { username: name, team });
      this.waitingFor = name;
      SFX.search();
      this.msg('Позвали ' + name + ' — ждём ответа');
      this.render();
    } catch (e) { SFX.deny(); this.msg(e.message, true); }
  },

  /* принять приглашение соперника */
  async acceptBattle(name) {
    const team = this.team();
    if (!team) { SFX.deny(); this.msg('Сначала соберите команду в лобби', true); return; }
    try {
      const info = await API.post('/api/mp/accept', { username: name, team });
      this.close();
      $('mmOverlay').classList.remove('hidden');
      MP.begin(info);
    } catch (e) { SFX.deny(); this.msg(e.message, true); }
  },

  /* пока ждём ответа на приглашение, следим за появлением матча */
  async checkInviteAccepted() {
    if (!this.waitingFor || MP.match) return;
    try {
      const r = await API.get('/api/mp/status');
      if (r.status === 'matched') {
        this.waitingFor = null;
        this.close();
        $('mmOverlay').classList.remove('hidden');
        MP.begin(r);
      } else if (!this.data.sentInvites.includes(this.waitingFor)) {
        this.waitingFor = null;      // приглашение отклонили или оно устарело
      }
    } catch (e) {}
  },

  /* команда для боя: выбранная в лобби или собранная автоматически */
  team() {
    if (typeof picked !== 'undefined' && picked.length === 3) return picked.slice();
    return autoTeam();
  }
};
