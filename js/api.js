'use strict';

/* Тонкая обёртка над fetch: единый разбор ошибок сервера */
const API = {
  async req(method, url, body) {
    let r;
    try {
      r = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        credentials: 'same-origin',
        body: body ? JSON.stringify(body) : undefined
      });
    } catch (e) {
      throw new Error('Сервер недоступен. Запустите server.py');
    }
    let data = null;
    try { data = await r.json(); } catch (e) { data = null; }
    if (!r.ok) throw new Error((data && data.error) || ('Ошибка ' + r.status));
    return data;
  },
  get(u) { return this.req('GET', u); },
  post(u, b) { return this.req('POST', u, b || {}); }
};
