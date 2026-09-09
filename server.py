# -*- coding: utf-8 -*-
"""
БАКУГАН — Битва Бойцов
Сервер на стандартной библиотеке Python: статика + JSON API + база SQLite3.
Запуск:  python server.py   →   http://localhost:8123
"""

import json
import os
import re
import sys
import sqlite3
import secrets
import time
import hashlib
import threading
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from http.cookies import SimpleCookie
from urllib.parse import urlparse, parse_qs

# консоль Windows может быть не в UTF-8 — иначе кириллица в логах роняет сервер
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, 'bakugan.db')
CATALOG_PATH = os.path.join(BASE_DIR, 'data', 'catalog.json')
PORT = int(os.environ.get('BAKUGAN_PORT', '8123'))
HIDDEN = {'/server.py', '/bakugan.db', '/bakugan.db-journal', '/bakugan.db-wal'}

PBKDF_ROUNDS = 120_000
NAME_RE = re.compile(r'^[A-Za-zА-Яа-яЁё0-9 _-]{3,16}$')

with open(CATALOG_PATH, encoding='utf-8') as f:
    CATALOG = json.load(f)

ATTRS = CATALOG['attrs']
POOL = {b['name']: b for b in CATALOG['pool']}
ABILITY_IDS = {a['id'] for a in CATALOG['abilities']}
GATE_IDS = {g['id'] for g in CATALOG['gateTypes']}
PRICES = CATALOG['prices']
REWARDS = CATALOG['rewards']
DIFF_MULT = {d['id']: d['mult'] for d in CATALOG['diffs']}

# ------------------------------------------------------------------ база

_lock = threading.Lock()
_db = sqlite3.connect(DB_PATH, check_same_thread=False)
_db.row_factory = sqlite3.Row
_db.execute('PRAGMA foreign_keys = ON')

SCHEMA = """
CREATE TABLE IF NOT EXISTS users(
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  username    TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash   BLOB NOT NULL,
  salt        BLOB NOT NULL,
  element     TEXT NOT NULL,
  tokens      INTEGER NOT NULL DEFAULT 0,
  wins        INTEGER NOT NULL DEFAULT 0,
  losses      INTEGER NOT NULL DEFAULT 0,
  streak      INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  battles_won INTEGER NOT NULL DEFAULT 0,
  uname_key   TEXT,
  last_seen   REAL NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_uname_key ON users(uname_key);
CREATE TABLE IF NOT EXISTS friends(
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status     TEXT NOT NULL,          -- out | in | ok
  created_at TEXT NOT NULL,
  PRIMARY KEY(user_id, friend_id)
);
CREATE TABLE IF NOT EXISTS mp_invite(
  from_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  ts         REAL NOT NULL,
  PRIMARY KEY(from_id, to_id)
);
CREATE TABLE IF NOT EXISTS sessions(
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS user_bakugan(
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name    TEXT NOT NULL,
  got_at  TEXT NOT NULL,
  PRIMARY KEY(user_id, name)
);
CREATE TABLE IF NOT EXISTS user_cards(
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind    TEXT NOT NULL,
  type    TEXT NOT NULL,
  attr    TEXT NOT NULL,
  qty     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(user_id, kind, type, attr)
);
CREATE TABLE IF NOT EXISTS matches(
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  won        INTEGER NOT NULL,
  p_wins     INTEGER NOT NULL,
  a_wins     INTEGER NOT NULL,
  difficulty TEXT NOT NULL,
  reward     INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mp_queue(
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  team    TEXT NOT NULL,
  ts      REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS mp_match(
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  p1          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  p2          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  p1_team     TEXT NOT NULL,
  p2_team     TEXT NOT NULL,
  first_side  TEXT NOT NULL,
  winner      TEXT,
  r1          INTEGER NOT NULL DEFAULT 0,
  r2          INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  finished_at TEXT
);
CREATE TABLE IF NOT EXISTS mp_move(
  match_id   INTEGER NOT NULL REFERENCES mp_match(id) ON DELETE CASCADE,
  n          INTEGER NOT NULL,
  by_side    TEXT NOT NULL,
  payload    TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(match_id, n)
);
CREATE TABLE IF NOT EXISTS mp_seen(
  match_id INTEGER NOT NULL,
  user_id  INTEGER NOT NULL,
  ts       REAL NOT NULL,
  PRIMARY KEY(match_id, user_id)
);
CREATE TABLE IF NOT EXISTS purchases(
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item       TEXT NOT NULL,
  detail     TEXT NOT NULL,
  price      INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
"""
with _lock:
    for _col, _decl in (('uname_key', 'TEXT'), ('last_seen', 'REAL NOT NULL DEFAULT 0')):
        try:
            _db.execute('ALTER TABLE users ADD COLUMN %s %s' % (_col, _decl))
        except sqlite3.Error:
            pass
    _db.executescript(SCHEMA)
    _db.commit()


def now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def q(sql, args=()):
    with _lock:
        return _db.execute(sql, args).fetchall()


def q1(sql, args=()):
    rows = q(sql, args)
    return rows[0] if rows else None


def run(sql, args=()):
    with _lock:
        cur = _db.execute(sql, args)
        _db.commit()
        return cur


# ------------------------------------------------------------------ пароли

def hash_password(password, salt=None):
    salt = salt or secrets.token_bytes(16)
    h = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, PBKDF_ROUNDS)
    return h, salt


def check_password(password, salt, expected):
    h, _ = hash_password(password, salt)
    return secrets.compare_digest(h, expected)


# ------------------------------------------------------------------ ошибки

class ApiError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


# ------------------------------------------------------------------ профиль

def add_card(user_id, kind, ctype, attr, qty=1):
    run("""INSERT INTO user_cards(user_id, kind, type, attr, qty) VALUES(?,?,?,?,?)
           ON CONFLICT(user_id, kind, type, attr) DO UPDATE SET qty = qty + excluded.qty""",
        (user_id, kind, ctype, attr, qty))


def starter_kit(user_id, element):
    """Стартовый набор — целиком в выбранной стихии."""
    mine = sorted((b for b in CATALOG['pool'] if b['attr'] == element), key=lambda b: b['g'])
    for b in mine[:3]:
        run("INSERT OR IGNORE INTO user_bakugan(user_id, name, got_at) VALUES(?,?,?)",
            (user_id, b['name'], now()))
    for aid in ('boost', 'drain', 'shield', 'fury', 'copy'):
        add_card(user_id, 'ability', aid, element, 1)
    for gid, n in (('attr', 2), ('fortress', 1), ('underdog', 1), ('normal', 1), ('swap', 1)):
        add_card(user_id, 'gate', gid, element, n)


def profile(user_id):
    u = q1("SELECT * FROM users WHERE id=?", (user_id,))
    if not u:
        raise ApiError('Пользователь не найден', 404)
    bak = [r['name'] for r in q("SELECT name FROM user_bakugan WHERE user_id=? ORDER BY name", (user_id,))]
    cards = q("SELECT kind, type, attr, qty FROM user_cards WHERE user_id=? AND qty>0", (user_id,))
    return {
        'user': {
            'id': u['id'], 'username': u['username'], 'element': u['element'],
            'tokens': u['tokens'], 'wins': u['wins'], 'losses': u['losses'],
            'streak': u['streak'], 'best': u['best_streak'], 'battlesWon': u['battles_won'],
            'createdAt': u['created_at'],
        },
        'bakugan': bak,
        'cards': {
            'ability': [dict(r) for r in cards if r['kind'] == 'ability'],
            'gate': [dict(r) for r in cards if r['kind'] == 'gate'],
        },
    }


# ------------------------------------------------------------------ API

def api_catalog(_h, _b):
    return CATALOG


def api_register(h, body):
    username = (body.get('username') or '').strip()
    password = body.get('password') or ''
    element = body.get('element') or ''
    if not NAME_RE.match(username):
        raise ApiError('Никнейм: 3–16 символов, буквы, цифры, пробел, - или _')
    if len(password) < 4:
        raise ApiError('Пароль — минимум 4 символа')
    if element not in ATTRS:
        raise ApiError('Выберите стихию')
    username = ' '.join(username.split())
    key = norm_name(username)
    if q1("SELECT id FROM users WHERE uname_key=?", (key,)):
        raise ApiError('Такой никнейм уже занят')

    ph, salt = hash_password(password)
    cur = run("""INSERT INTO users(username, uname_key, pass_hash, salt, element, tokens,
                                   last_seen, created_at)
                 VALUES(?,?,?,?,?,?,?,?)""",
              (username, key, ph, salt, element, REWARDS['startTokens'], time.time(), now()))
    uid = cur.lastrowid
    starter_kit(uid, element)
    return _login_ok(h, uid)


def api_login(h, body):
    username = (body.get('username') or '').strip()
    password = body.get('password') or ''
    u = _user_by_name(username)
    if not u or not check_password(password, u['salt'], u['pass_hash']):
        raise ApiError('Неверный никнейм или пароль', 401)
    return _login_ok(h, u['id'])


def _login_ok(h, user_id):
    token = secrets.token_hex(32)
    run("INSERT INTO sessions(token, user_id, created_at) VALUES(?,?,?)", (token, user_id, now()))
    h.set_cookie = token
    return profile(user_id)


def api_logout(h, _b):
    if h.session_token:
        run("DELETE FROM sessions WHERE token=?", (h.session_token,))
    h.clear_cookie = True
    return {'ok': True}


def api_me(h, _b):
    return profile(h.require_user())


def api_leaderboard(_h, _b):
    rows = q("""SELECT username, element, wins, losses, best_streak, tokens FROM users
                ORDER BY wins DESC, best_streak DESC, tokens DESC LIMIT 10""")
    return {'top': [dict(r) for r in rows]}


def api_game_result(h, body):
    uid = h.require_user()
    won = bool(body.get('won'))
    p_wins = max(0, min(3, int(body.get('pWins') or 0)))
    a_wins = max(0, min(3, int(body.get('aWins') or 0)))
    diff = body.get('difficulty') if body.get('difficulty') in DIFF_MULT else 'normal'
    battles = max(0, min(3, int(body.get('battlesWon') or 0)))

    base = REWARDS['winGame'] if won else REWARDS['loseGame']
    reward = int(round((base + REWARDS['perBattle'] * battles) * DIFF_MULT[diff]))

    u = q1("SELECT streak, best_streak FROM users WHERE id=?", (uid,))
    streak = u['streak'] + 1 if won else 0
    best = max(u['best_streak'], streak)
    run("""UPDATE users SET tokens = tokens + ?, wins = wins + ?, losses = losses + ?,
           streak = ?, best_streak = ?, battles_won = battles_won + ? WHERE id=?""",
        (reward, 1 if won else 0, 0 if won else 1, streak, best, battles, uid))
    run("""INSERT INTO matches(user_id, won, p_wins, a_wins, difficulty, reward, created_at)
           VALUES(?,?,?,?,?,?,?)""", (uid, int(won), p_wins, a_wins, diff, reward, now()))

    data = profile(uid)
    data['reward'] = reward
    return data


def api_shop_buy(h, body):
    uid = h.require_user()
    item = body.get('item')
    u = q1("SELECT * FROM users WHERE id=?", (uid,))
    tokens = u['tokens']

    if item == 'bakugan':
        name = body.get('name')
        b = POOL.get(name)
        if not b:
            raise ApiError('Такого бакугана нет')
        if q1("SELECT 1 FROM user_bakugan WHERE user_id=? AND name=?", (uid, name)):
            raise ApiError('Этот бакуган уже у вас есть')
        price = PRICES['bakugan'][str(b['tier'])]
        _charge(uid, tokens, price, 'bakugan', name)
        run("INSERT INTO user_bakugan(user_id, name, got_at) VALUES(?,?,?)", (uid, name, now()))

    elif item in ('ability', 'gate'):
        ctype = body.get('type')
        attr = body.get('attr')
        valid = ABILITY_IDS if item == 'ability' else GATE_IDS
        if ctype not in valid:
            raise ApiError('Такой карты нет')
        if attr not in ATTRS:
            raise ApiError('Неизвестная стихия')
        price = PRICES[item]
        _charge(uid, tokens, price, item, f'{ctype}:{attr}')
        add_card(uid, item, ctype, attr, 1)

    elif item == 'rename':
        new = (body.get('value') or '').strip()
        if not NAME_RE.match(new):
            raise ApiError('Никнейм: 3–16 символов, буквы, цифры, пробел, - или _')
        new = ' '.join(new.split())
        key = norm_name(new)
        if key == u['uname_key']:
            raise ApiError('Это ваш текущий никнейм')
        if q1("SELECT id FROM users WHERE uname_key=?", (key,)):
            raise ApiError('Такой никнейм уже занят')
        _charge(uid, tokens, PRICES['rename'], 'rename', new)
        run("UPDATE users SET username=?, uname_key=? WHERE id=?", (new, key, uid))

    elif item == 'element':
        new = body.get('value')
        if new not in ATTRS:
            raise ApiError('Неизвестная стихия')
        if new == u['element']:
            raise ApiError('Это ваша текущая стихия')
        _charge(uid, tokens, PRICES['element'], 'element', new)
        run("UPDATE users SET element=? WHERE id=?", (new, uid))

    else:
        raise ApiError('Неизвестный товар')

    return profile(uid)


def _charge(uid, tokens, price, item, detail):
    if tokens < price:
        raise ApiError(f'Не хватает жетонов: нужно {price}, у вас {tokens}')
    run("UPDATE users SET tokens = tokens - ? WHERE id=?", (price, uid))
    run("INSERT INTO purchases(user_id, item, detail, price, created_at) VALUES(?,?,?,?,?)",
        (uid, item, detail, price, now()))


# ------------------------------------------------------------------ мультиплеер
#
# Обмен идёт длинным опросом: клиент висит на /api/mp/sync до 18 секунд,
# сервер будит все ожидающие потоки, как только появляется новый ход.
# Правила боя считает клиент, сервер хранит очередь ходов и следит,
# чтобы оба видели одну и ту же последовательность.

_cv = threading.Condition()
QUEUE_TTL = 40.0     # секунд без опроса — игрок выпадает из очереди
SEEN_TTL = 25.0      # секунд без sync — соперник считается отключившимся


def _prune_queue():
    run("DELETE FROM mp_queue WHERE ts < ?", (time.time() - QUEUE_TTL,))


def _active_match(uid):
    return q1("""SELECT * FROM mp_match WHERE (p1=? OR p2=?) AND winner IS NULL
                 ORDER BY id DESC LIMIT 1""", (uid, uid))


def _match_payload(m, uid):
    side = 'p1' if m['p1'] == uid else 'p2'
    opp_id = m['p2'] if side == 'p1' else m['p1']
    opp = q1("SELECT username, element FROM users WHERE id=?", (opp_id,))
    return {
        'status': 'matched',
        'match': m['id'],
        'side': side,
        'first': m['first_side'],
        'myTeam': json.loads(m['p1_team'] if side == 'p1' else m['p2_team']),
        'oppTeam': json.loads(m['p2_team'] if side == 'p1' else m['p1_team']),
        'opponent': {'username': opp['username'], 'element': opp['element']},
        'winner': m['winner'],
    }


def _check_team(uid, team):
    if not isinstance(team, list) or len(team) != 3 or len(set(team)) != 3:
        raise ApiError('Нужно ровно три разных бакугана')
    if any(t not in POOL for t in team):
        raise ApiError('Неизвестный бакуган')
    if sum(POOL[t]['g'] for t in team) > CATALOG['teamCap']:
        raise ApiError('Команда превышает лимит G-силы')
    owned = {r['name'] for r in q("SELECT name FROM user_bakugan WHERE user_id=?", (uid,))}
    if any(t not in owned for t in team):
        raise ApiError('В команде есть бакуган не из вашей коллекции')


def api_mp_queue(h, body):
    uid = h.require_user()
    m = _active_match(uid)
    if m:
        return _match_payload(m, uid)

    team = body.get('team') or []
    _check_team(uid, team)
    _prune_queue()

    other = q1("SELECT * FROM mp_queue WHERE user_id<>? ORDER BY ts LIMIT 1", (uid,))
    if other:
        run("DELETE FROM mp_queue WHERE user_id IN (?,?)", (uid, other['user_id']))
        first = 'p1' if secrets.randbelow(2) == 0 else 'p2'
        cur = run("""INSERT INTO mp_match(p1, p2, p1_team, p2_team, first_side, created_at)
                     VALUES(?,?,?,?,?,?)""",
                  (other['user_id'], uid, other['team'],
                   json.dumps(team, ensure_ascii=False), first, now()))
        with _cv:
            _cv.notify_all()
        return _match_payload(q1("SELECT * FROM mp_match WHERE id=?", (cur.lastrowid,)), uid)

    run("INSERT OR REPLACE INTO mp_queue(user_id, team, ts) VALUES(?,?,?)",
        (uid, json.dumps(team, ensure_ascii=False), time.time()))
    return {'status': 'queued', 'waiting': len(q("SELECT user_id FROM mp_queue"))}


def api_mp_status(h, _qs):
    """Длинный опрос, пока игрок стоит в очереди."""
    uid = h.require_user()
    deadline = time.time() + 15
    while True:
        m = _active_match(uid)
        if m:
            return _match_payload(m, uid)
        if not q1("SELECT 1 FROM mp_queue WHERE user_id=?", (uid,)):
            return {'status': 'idle'}
        run("UPDATE mp_queue SET ts=? WHERE user_id=?", (time.time(), uid))
        if time.time() >= deadline:
            return {'status': 'queued', 'waiting': len(q("SELECT user_id FROM mp_queue"))}
        with _cv:
            _cv.wait(0.7)


def api_mp_sync(h, qs):
    """Длинный опрос новых ходов соперника."""
    uid = h.require_user()
    mid = int((qs.get('match') or ['0'])[0] or 0)
    since = int((qs.get('since') or ['0'])[0] or 0)
    m = q1("SELECT * FROM mp_match WHERE id=?", (mid,))
    if not m or uid not in (m['p1'], m['p2']):
        raise ApiError('Матч не найден', 404)
    opp_id = m['p2'] if m['p1'] == uid else m['p1']

    deadline = time.time() + 18
    while True:
        run("INSERT OR REPLACE INTO mp_seen(match_id, user_id, ts) VALUES(?,?,?)",
            (mid, uid, time.time()))
        rows = q("SELECT n, by_side, payload FROM mp_move WHERE match_id=? AND n>? ORDER BY n",
                 (mid, since))
        cur = q1("SELECT winner FROM mp_match WHERE id=?", (mid,))
        seen = q1("SELECT ts FROM mp_seen WHERE match_id=? AND user_id=?", (mid, opp_id))
        online = bool(seen) and (time.time() - seen['ts'] < SEEN_TTL)
        if rows or cur['winner'] or time.time() >= deadline:
            return {
                'moves': [{'n': r['n'], 'by': r['by_side'], 'payload': json.loads(r['payload'])}
                          for r in rows],
                'oppOnline': online,
                'winner': cur['winner'],
            }
        with _cv:
            _cv.wait(0.6)


def api_mp_move(h, body):
    uid = h.require_user()
    mid = int(body.get('match') or 0)
    m = q1("SELECT * FROM mp_match WHERE id=?", (mid,))
    if not m or uid not in (m['p1'], m['p2']):
        raise ApiError('Матч не найден', 404)
    if m['winner']:
        raise ApiError('Матч уже завершён')
    payload = body.get('payload')
    if not isinstance(payload, dict):
        raise ApiError('Пустой ход')
    side = 'p1' if m['p1'] == uid else 'p2'
    n = (q1("SELECT MAX(n) mx FROM mp_move WHERE match_id=?", (mid,))['mx'] or 0) + 1
    run("INSERT INTO mp_move(match_id, n, by_side, payload, created_at) VALUES(?,?,?,?,?)",
        (mid, n, side, json.dumps(payload, ensure_ascii=False), now()))
    with _cv:
        _cv.notify_all()
    return {'n': n}


def _settle(m, winner):
    """Начисляет награды обоим игрокам и закрывает матч. Вызывается один раз."""
    wid = m['p1'] if winner == 'p1' else m['p2']
    lid = m['p2'] if winner == 'p1' else m['p1']
    rw, rl = REWARDS['mpWin'], REWARDS['mpLose']
    for uid_, rew, won in ((wid, rw, True), (lid, rl, False)):
        u = q1("SELECT streak, best_streak FROM users WHERE id=?", (uid_,))
        st = (u['streak'] + 1) if won else 0
        run("""UPDATE users SET tokens=tokens+?, wins=wins+?, losses=losses+?,
               streak=?, best_streak=? WHERE id=?""",
            (rew, 1 if won else 0, 0 if won else 1, st, max(u['best_streak'], st), uid_))
        run("""INSERT INTO matches(user_id, won, p_wins, a_wins, difficulty, reward, created_at)
               VALUES(?,?,?,?,?,?,?)""",
            (uid_, int(won), 3 if won else 0, 0 if won else 3, 'mp', rew, now()))
    run("UPDATE mp_match SET winner=?, r1=?, r2=?, finished_at=? WHERE id=?",
        (winner, rw if winner == 'p1' else rl, rw if winner == 'p2' else rl, now(), m['id']))
    with _cv:
        _cv.notify_all()


def api_mp_finish(h, body):
    uid = h.require_user()
    mid = int(body.get('match') or 0)
    m = q1("SELECT * FROM mp_match WHERE id=?", (mid,))
    if not m or uid not in (m['p1'], m['p2']):
        raise ApiError('Матч не найден', 404)
    side = 'p1' if m['p1'] == uid else 'p2'
    if not m['winner']:
        winner = body.get('winner')
        if winner not in ('p1', 'p2'):
            raise ApiError('Некорректный итог матча')
        _settle(m, winner)
        m = q1("SELECT * FROM mp_match WHERE id=?", (mid,))
    data = profile(uid)
    data['reward'] = m['r1'] if side == 'p1' else m['r2']
    data['won'] = (m['winner'] == side)
    return data


def api_mp_leave(h, body):
    """Выход из очереди или сдача текущего матча."""
    uid = h.require_user()
    run("DELETE FROM mp_queue WHERE user_id=?", (uid,))
    run("DELETE FROM mp_invite WHERE from_id=?", (uid,))
    mid = body.get('match')
    if mid:
        m = q1("SELECT * FROM mp_match WHERE id=?", (int(mid),))
        if m and not m['winner'] and uid in (m['p1'], m['p2']):
            _settle(m, 'p2' if m['p1'] == uid else 'p1')
    with _cv:
        _cv.notify_all()
    return {'ok': True}


# ------------------------------------------------------------------ друзья
#
# Ник уникален без оглядки на регистр и лишние пробелы — сравнение идёт
# по ключу uname_key (casefold корректно сворачивает и кириллицу,
# в отличие от COLLATE NOCASE, который знает только латиницу).

def norm_name(s):
    return ' '.join((s or '').split()).casefold()


def _user_by_name(name):
    key = norm_name(name)
    if not key:
        return None
    return q1("SELECT * FROM users WHERE uname_key=?", (key,))


def _touch_user(uid):
    run("UPDATE users SET last_seen=? WHERE id=?", (time.time(), uid))


def _friend_row(uid, fid):
    return q1("SELECT status FROM friends WHERE user_id=? AND friend_id=?", (uid, fid))


def _set_pair(a, b, sa, sb):
    run("INSERT OR REPLACE INTO friends(user_id, friend_id, status, created_at) VALUES(?,?,?,?)",
        (a, b, sa, now()))
    run("INSERT OR REPLACE INTO friends(user_id, friend_id, status, created_at) VALUES(?,?,?,?)",
        (b, a, sb, now()))


def _drop_pair(a, b):
    run("DELETE FROM friends WHERE (user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?)",
        (a, b, b, a))


def api_friends(h, _b):
    uid = h.require_user()
    ts = time.time()
    rows = q("""SELECT f.status, u.id, u.username, u.element, u.wins, u.losses,
                       u.best_streak, u.tokens, u.last_seen
                FROM friends f JOIN users u ON u.id = f.friend_id
                WHERE f.user_id=? ORDER BY u.username""", (uid,))

    def item(r):
        return {
            'username': r['username'], 'element': r['element'],
            'wins': r['wins'], 'losses': r['losses'], 'best': r['best_streak'],
            'online': bool(r['last_seen']) and (ts - r['last_seen'] < 70),
            'inMatch': bool(_active_match(r['id'])),
        }

    inv = q("""SELECT u.username, u.element FROM mp_invite i JOIN users u ON u.id = i.from_id
               WHERE i.to_id=? AND i.ts > ?""", (uid, ts - 180))
    sent = q("""SELECT u.username FROM mp_invite i JOIN users u ON u.id = i.to_id
                WHERE i.from_id=? AND i.ts > ?""", (uid, ts - 180))
    return {
        'friends': [item(r) for r in rows if r['status'] == 'ok'],
        'incoming': [item(r) for r in rows if r['status'] == 'in'],
        'outgoing': [item(r) for r in rows if r['status'] == 'out'],
        'invites': [{'username': r['username'], 'element': r['element']} for r in inv],
        'sentInvites': [r['username'] for r in sent],
    }


def api_friend_add(h, body):
    uid = h.require_user()
    other = _user_by_name(body.get('username'))
    if not other:
        raise ApiError('Такого бойца нет')
    if other['id'] == uid:
        raise ApiError('Себя в друзья не добавить')
    cur = _friend_row(uid, other['id'])
    if cur:
        if cur['status'] == 'ok':
            raise ApiError('Уже у вас в друзьях')
        if cur['status'] == 'out':
            raise ApiError('Заявка уже отправлена')
        _set_pair(uid, other['id'], 'ok', 'ok')      # встречная заявка — сразу дружба
        return api_friends(h, None)
    _set_pair(uid, other['id'], 'out', 'in')
    return api_friends(h, None)


def api_friend_accept(h, body):
    uid = h.require_user()
    other = _user_by_name(body.get('username'))
    if not other:
        raise ApiError('Такого бойца нет')
    cur = _friend_row(uid, other['id'])
    if not cur or cur['status'] != 'in':
        raise ApiError('Заявки нет')
    _set_pair(uid, other['id'], 'ok', 'ok')
    return api_friends(h, None)


def api_friend_remove(h, body):
    """Отклонить заявку, отменить свою или удалить из друзей."""
    uid = h.require_user()
    other = _user_by_name(body.get('username'))
    if not other:
        raise ApiError('Такого бойца нет')
    _drop_pair(uid, other['id'])
    run("DELETE FROM mp_invite WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?)",
        (uid, other['id'], other['id'], uid))
    return api_friends(h, None)


def api_mp_invite(h, body):
    """Позвать друга на бой напрямую, минуя общую очередь."""
    uid = h.require_user()
    other = _user_by_name(body.get('username'))
    if not other:
        raise ApiError('Такого бойца нет')
    if not _friend_row(uid, other['id']) or _friend_row(uid, other['id'])['status'] != 'ok':
        raise ApiError('Позвать в бой можно только друга')
    if _active_match(uid):
        raise ApiError('Вы уже в матче')
    if _active_match(other['id']):
        raise ApiError('Соперник сейчас в бою')
    _check_team(uid, body.get('team') or [])
    run("DELETE FROM mp_queue WHERE user_id=?", (uid,))
    run("INSERT OR REPLACE INTO mp_invite(from_id, to_id, team, created_at, ts) VALUES(?,?,?,?,?)",
        (uid, other['id'], json.dumps(body['team'], ensure_ascii=False), now(), time.time()))
    with _cv:
        _cv.notify_all()
    return {'ok': True}


def api_mp_accept(h, body):
    uid = h.require_user()
    other = _user_by_name(body.get('username'))
    inv = q1("SELECT * FROM mp_invite WHERE from_id=? AND to_id=?", (other['id'], uid)) if other else None
    if not inv:
        raise ApiError('Приглашение не найдено или устарело')
    _check_team(uid, body.get('team') or [])
    if _active_match(uid) or _active_match(other['id']):
        raise ApiError('Один из бойцов уже в матче')
    run("DELETE FROM mp_invite WHERE from_id=? OR to_id=?", (other['id'], other['id']))
    run("DELETE FROM mp_queue WHERE user_id IN (?,?)", (uid, other['id']))
    first = 'p1' if secrets.randbelow(2) == 0 else 'p2'
    cur = run("""INSERT INTO mp_match(p1, p2, p1_team, p2_team, first_side, created_at)
                 VALUES(?,?,?,?,?,?)""",
              (other['id'], uid, inv['team'], json.dumps(body['team'], ensure_ascii=False),
               first, now()))
    with _cv:
        _cv.notify_all()
    return _match_payload(q1("SELECT * FROM mp_match WHERE id=?", (cur.lastrowid,)), uid)


ROUTES_GET = {
    '/api/catalog': api_catalog,
    '/api/me': api_me,
    '/api/leaderboard': api_leaderboard,
    '/api/mp/status': api_mp_status,
    '/api/mp/sync': api_mp_sync,
    '/api/friends': api_friends,
}
ROUTES_POST = {
    '/api/register': api_register,
    '/api/login': api_login,
    '/api/logout': api_logout,
    '/api/game/result': api_game_result,
    '/api/shop/buy': api_shop_buy,
    '/api/mp/queue': api_mp_queue,
    '/api/mp/move': api_mp_move,
    '/api/mp/finish': api_mp_finish,
    '/api/mp/leave': api_mp_leave,
    '/api/mp/invite': api_mp_invite,
    '/api/mp/accept': api_mp_accept,
    '/api/friends/add': api_friend_add,
    '/api/friends/accept': api_friend_accept,
    '/api/friends/remove': api_friend_remove,
}


# ------------------------------------------------------------------ HTTP

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        self.set_cookie = None
        self.clear_cookie = False
        super().__init__(*a, directory=BASE_DIR, **kw)

    def handle_one_request(self):
        self.set_cookie = None
        self.clear_cookie = False
        super().handle_one_request()

    # ---- сессия
    @property
    def session_token(self):
        raw = self.headers.get('Cookie')
        if not raw:
            return None
        try:
            return SimpleCookie(raw).get('bk_session').value
        except Exception:
            return None

    def current_user(self):
        tok = self.session_token
        if not tok:
            return None
        row = q1("SELECT user_id FROM sessions WHERE token=?", (tok,))
        return row['user_id'] if row else None

    def require_user(self):
        uid = self.current_user()
        if not uid:
            raise ApiError('Нужно войти в аккаунт', 401)
        _touch_user(uid)
        return uid

    # ---- ответы
    def send_json(self, data, status=200):
        payload = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(payload)))
        if self.set_cookie:
            self.send_header('Set-Cookie',
                             f'bk_session={self.set_cookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000')
        if self.clear_cookie:
            self.send_header('Set-Cookie', 'bk_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0')
        self.end_headers()
        self.wfile.write(payload)

    def read_json(self):
        length = int(self.headers.get('Content-Length') or 0)
        if not length:
            return {}
        try:
            return json.loads(self.rfile.read(length).decode('utf-8'))
        except Exception:
            raise ApiError('Некорректный запрос')

    def handle_api(self, routes, body):
        path = urlparse(self.path).path
        fn = routes.get(path)
        if not fn:
            self.send_json({'error': 'Метод не найден'}, 404)
            return
        try:
            self.send_json(fn(self, body))
        except ApiError as e:
            self.send_json({'error': e.message}, e.status)
        except Exception as e:            # непредвиденное — не роняем сервер
            self.log_message('API error: %r', e)
            self.send_json({'error': 'Внутренняя ошибка сервера'}, 500)

    # ---- маршрутизация
    def do_GET(self):
        path = urlparse(self.path).path
        if path in HIDDEN:
            self.send_error(404)
            return
        if path.startswith('/api/'):
            self.handle_api(ROUTES_GET, parse_qs(urlparse(self.path).query))
            return
        super().do_GET()

    def do_HEAD(self):
        if urlparse(self.path).path in HIDDEN:
            self.send_error(404)
            return
        super().do_HEAD()

    def do_POST(self):
        if not urlparse(self.path).path.startswith('/api/'):
            self.send_error(405)
            return
        try:
            body = self.read_json()
        except ApiError as e:
            self.send_json({'error': e.message}, e.status)
            return
        self.handle_api(ROUTES_POST, body)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def log_message(self, fmt, *args):
        print('[%s] %s' % (datetime.now().strftime('%H:%M:%S'), fmt % args))


def main():
    srv = ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    print('=' * 54)
    print('  БАКУГАН — Битва Бойцов')
    print('  Сервер:  http://localhost:%d' % PORT)
    print('  База:    %s' % DB_PATH)
    print('  Остановить: Ctrl+C')
    print('=' * 54)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print('\nОстановлено.')
    finally:
        srv.server_close()


if __name__ == '__main__':
    main()
