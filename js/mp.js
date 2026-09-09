'use strict';

/* =========================================================
   Онлайн-бой.
   Правила считает клиент, сервер хранит очередь ходов.
   Обмен — длинный опрос /api/mp/sync: соединение висит,
   пока не появится ход соперника (до 18 секунд).
   ========================================================= */

const MP = {
  match: null, side: null, oppSide: null, opp: null,
  since: 0, running: false, searching: false, ended: false, online: true,
  inbox: [],            // ходы соперника, ждущие своей очереди
  oppAbil: {},          // карты соперника по номеру битвы
  waiters: {},          // ожидающие промисы выбора карты

  /* ---------- подбор соперника ---------- */
  async find(team) {
    this.searching = true;
    $('mmOverlay').classList.remove('hidden');
    $('mmText').textContent = 'Встаём в очередь…';
    $('mmOpp').innerHTML = '';
    try {
      let r = await API.post('/api/mp/queue', { team });
      while (this.searching && r.status !== 'matched') {
        if (r.status === 'idle') { r = await API.post('/api/mp/queue', { team }); continue; }
        SFX.search();
        $('mmText').textContent = 'Ищем соперника… в очереди: ' + (r.waiting || 1);
        r = await API.get('/api/mp/status');
      }
      if (!this.searching) return;
      this.begin(r);
    } catch (e) {
      this.searching = false;
      $('mmOverlay').classList.add('hidden');
      SFX.deny();
      openLobby();
      setHint('Онлайн-бой недоступен: ' + e.message);
    }
  },

  async cancel() {
    this.searching = false;
    $('mmOverlay').classList.add('hidden');
    SFX.click();
    try { await API.post('/api/mp/leave', {}); } catch (e) {}
    openLobby();
  },

  /* ---------- запуск матча ---------- */
  begin(info) {
    this.searching = false;
    this.match = info.match;
    this.side = info.side;
    this.oppSide = info.side === 'p1' ? 'p2' : 'p1';
    this.opp = info.opponent;
    this.since = 0; this.inbox = []; this.oppAbil = {}; this.waiters = {};
    this.ended = false; this.online = true;
    OPPNAME = info.opponent.username;

    const a = ATTR[info.opponent.element];
    $('mmText').textContent = 'Соперник найден!';
    $('mmOpp').innerHTML =
      `<div class="mmvs"><span class="orb" style="--ac:${a.c}">${a.i}</span>
        <b>${esc(info.opponent.username)}</b>
        <em>${a.n} · ${a.ru}</em></div>
       <div class="mmteam">${info.oppTeam.map(n => {
         const b = bakuganByName(n), A = ATTR[b.attr];
         return `<span class="tslot" style="--ac:${A.c}">
           <span class="orb cre" style="--ac:${A.c}" data-cre="${esc(b.name)}"></span>
           <b>${b.name}</b><i>${b.g} G</i></span>`;
       }).join('')}</div>
       <p class="small">${info.first === info.side ? 'Вы ходите первым' : 'Первым ходит соперник'}</p>`;
    CRE.apply($('mmOpp'));
    SFX.found();

    setTimeout(() => {
      $('mmOverlay').classList.add('hidden');
      $('startOverlay').classList.add('hidden');
      $('btnSurrender').classList.remove('hidden');
      newGameMP(info.myTeam.map(bakuganByName), info.oppTeam.map(bakuganByName),
                info.first === info.side);
      this.loop();
    }, 1800);
  },

  /* ---------- поток ходов ---------- */
  async loop() {
    this.running = true;
    while (this.running && this.match) {
      try {
        const r = await API.get('/api/mp/sync?match=' + this.match + '&since=' + this.since);
        if (!this.running) break;
        this.online = r.oppOnline;
        for (const m of r.moves) {
          this.since = Math.max(this.since, m.n);
          if (m.by === this.side) continue;              // свои ходы уже применены
          if (m.payload.t === 'ability') this.gotAbility(m.payload);
          else this.inbox.push(m.payload);
        }
        this.pump();
        if (r.winner && !this.ended) this.remoteEnd(r.winner);
      } catch (e) {
        if (!this.running) break;
        await sleep(1500);
      }
    }
  },

  async send(payload) {
    if (!this.match) return;
    try { await API.post('/api/mp/move', { match: this.match, payload }); }
    catch (e) { setHint('Ход не ушёл на сервер: ' + e.message); }
  },

  /* применяем ход соперника, когда игра к этому готова */
  pump() {
    if (!S || !this.inbox.length || S.phase !== 'wait') return;
    const m = this.inbox.shift();
    if (m.t === 'gate') {
      S.a.gateHand.length = Math.max(0, m.hand | 0);
      S.a.gateDeck.length = Math.max(0, m.deck | 0);
      placeGateCard('a', { type: m.type, attr: m.attr }, m.slot, m.x, m.y);
      setHint('<b>' + esc(OPPNAME) + '</b> выложил карту врат…');
      renderAll();
      setTimeout(() => this.pump(), 800);
    } else if (m.t === 'throw') {
      const bk = S.a.team.find(b => b.name === m.name && b.where === 'hand')
              || S.a.team.find(b => b.name === m.name);
      if (!bk) return;
      setHint('<b>' + esc(OPPNAME) + '</b> бросает…');
      throwBall('a', bk, m.ang, m.pow, { gate: m.gate, seed: m.seed });
    }
  },

  /* ---------- карты способностей ---------- */
  gotAbility(p) {
    const key = p.b || 0;
    const card = p.card ? Object.assign({}, abilityById(p.card.id), { attr: p.card.attr }) : null;
    if (this.waiters[key]) { this.waiters[key](card); delete this.waiters[key]; }
    else this.oppAbil[key] = card;
  },
  waitAbility(no) {
    return new Promise(res => {
      if (Object.prototype.hasOwnProperty.call(this.oppAbil, no)) {
        const c = this.oppAbil[no]; delete this.oppAbil[no]; res(c);
      } else this.waiters[no] = res;
    });
  },

  /* ---------- завершение ---------- */
  async finish(iWon) {
    if (this.ended) return null;
    this.ended = true;
    const winner = iWon ? this.side : this.oppSide;
    try {
      const d = await API.post('/api/mp/finish', { match: this.match, winner });
      applyProfile(d);
      return d;
    } catch (e) { return null; }
  },

  /* матч закончил сервер: сдача или обрыв связи соперника */
  async remoteEnd(winner) {
    if (this.ended || !S || S.phase === 'over') { this.ended = true; return; }
    this.ended = true;
    const iWon = winner === this.side;
    S.phase = 'over';
    let d = null;
    try { d = await API.post('/api/mp/finish', { match: this.match, winner }); applyProfile(d); }
    catch (e) {}
    $('endTitle').textContent = iWon ? 'ПОБЕДА!' : 'ПОРАЖЕНИЕ';
    $('endText').textContent = iWon
      ? 'Соперник вышел из боя — победа за вами.'
      : 'Матч завершён: вы вышли из боя.';
    $('endReward').innerHTML = d
      ? `🪙 <b>+${d.reward}</b> жетонов · всего у вас <b>${d.user.tokens}</b>` : '';
    $('endStats').innerHTML = statsHTML();
    renderStats();
    iWon ? SFX.victory() : SFX.defeat();
    $('endOverlay').classList.remove('hidden');
    this.stop();
  },

  stop() {
    this.running = false;
    $('btnSurrender').classList.add('hidden');
    $('btnSurrender').textContent = '🏳 Сдаться';
    $('btnSurrender').dataset.armed = '';
  },

  async leave() {
    const mid = this.match;
    this.stop();
    this.searching = false;
    this.match = null;
    if (mid && !this.ended) { try { await API.post('/api/mp/leave', { match: mid }); } catch (e) {} }
    else { try { await API.post('/api/mp/leave', {}); } catch (e) {} }
  },

  /* сдача — в два клика, без блокирующих диалогов */
  surrender() {
    const btn = $('btnSurrender');
    if (btn.dataset.armed !== '1') {
      btn.dataset.armed = '1';
      btn.textContent = 'Точно сдаться?';
      SFX.deny();
      setTimeout(() => { btn.dataset.armed = ''; btn.textContent = '🏳 Сдаться'; }, 4000);
      return;
    }
    btn.dataset.armed = '';
    const mid = this.match;
    this.remoteEnd(this.oppSide);
    if (mid) API.post('/api/mp/leave', { match: mid }).catch(() => {});
  }
};
