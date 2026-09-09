<div align="center">

# 🔥 BAKUGAN — Battle Brawlers

**A browser game inspired by Bakugan: physics-based throwing, Gate cards, a collection, a shop and online matches.**

No libraries, no image files, no `pip install`.
Every sprite is drawn in code on a canvas, every sound is synthesised through Web Audio,
the server is plain Python from the standard library, the data lives in SQLite3.

[![Python](https://img.shields.io/badge/Python-3.8%2B-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![SQLite](https://img.shields.io/badge/SQLite-3-003B57?logo=sqlite&logoColor=white)](https://www.sqlite.org/)
![Vanilla JS](https://img.shields.io/badge/JavaScript-vanilla-F7DF1E?logo=javascript&logoColor=black)
![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)
![Multiplayer](https://img.shields.io/badge/multiplayer-yes-ff4b26)
![License](https://img.shields.io/badge/license-MIT-blue)

**English** · [Русский](README.ru.md)

<img src="docs/creatures.png" alt="36 Bakugan, all drawn in code" width="100%">

<sub>All 36 Bakugan. Not a single image file — every creature is assembled procedurally on a canvas.</sub>

</div>

> **Note:** the game interface is in Russian. This README is the English guide to it.

---

## What it is

The Bakugan tabletop game moved into the browser in full: you lay down Gate cards,
throw a Bakugan onto the arena, it rolls with friction and opens wherever it stops.
Land on a gate held by your opponent and a battle starts — Ability cards, attribute
advantages, attack and defence animation, and a line-by-line G-Power breakdown.

Battles pay out tokens; tokens buy new Bakugan and cards in the shop.
You can play against the AI or against a live opponent — through the open queue
or by inviting a friend directly.

<div align="center">
<img src="docs/arena.png" alt="The arena" width="86%">
<br><sub>The arena: creatures stand on their Gate cards, each card showing its attribute and owner.</sub>
<br><br>
<img src="docs/battle.png" alt="A battle" width="86%">
<br><sub>A battle: the attacker strikes, the defender holds a faceted barrier in their own attribute.</sub>
</div>

---

## Running it

All you need is Python 3.8+. Nothing to install.

```bash
git clone https://github.com/loliksudoc/bakugan.git
cd bakugan
python server.py
```

Open <http://localhost:8123>. On Windows you can just double-click `start.bat`.

The first run creates `bakugan.db` next to the server — it holds accounts, collections,
tokens, friends, and the history of matches and purchases.

---

## Features

### 🎮 Gameplay
- **Throwing is a skill.** One press locks the angle, the next locks the power. The ball
  rolls with friction, bounces off the walls and opens where it comes to rest.
  Miss and you lose the turn.
- **Gate cards, laid in turn.** At the start of your turn you place one Gate card on a free
  pad. Up to three gates sit on the arena at once, and your Bakugan gets +50 G on your own gate.
- **Battle.** Each side may play one Ability card, then the final G-Powers are compared.
  On a tie the defender keeps the gate. First to take three gates wins.
- **8 gate types** and **8 ability cards**, each carrying an attribute and a +30 G *resonance* bonus.

### 🐉 36 Bakugan drawn in code
Ten body archetypes — dragon, feline, bird, serpent, insect, golem, knight, aquatic,
beast, spirit. The creature's kind assembles the silhouette: torso, neck, head, horns,
wings, tail, limbs, glowing eyes. The attribute sets the palette, the name adds
distinguishing marks: four horns on Delta Dragonoid, three heads on Hydranoid,
shoulder blades on Blade Tigrerra.

The same drawing serves as the portrait on a card, the full figure on the arena,
and the large fighter in the battle animation.

### ⚔️ Attack and defence animation
Ready stance → charge with an afterimage trail → impact on the faceted barrier with sparks
and screen shake → the barrier cracks and shatters **or** the attacker is thrown back →
a finishing blow or a counterattack → **GUARD BROKEN** / **ATTACK REPELLED**.
Only then does the G-Power breakdown unfold line by line.

### 🌐 Online matches
A live opponent through the open queue, or a direct invitation to a friend.
The exchange runs on long polling: the connection hangs for up to 18 seconds and wakes
the moment the opponent moves. No WebSockets, no external libraries.

To keep the two clients from drifting apart, the thrower computes the outcome of the
throw and sends it along with the angle and power; the random Chaos gate is rolled from
a shared seed — so the battle result matches on both sides down to a single point of G.
Ability cards are chosen simultaneously and revealed together.

### 👥 Friends
Search by nickname, friend requests, "online" and "in battle" status, and a direct
battle invite that skips the queue. Nicknames are unique regardless of letter case
or stray spaces — for Cyrillic too, which SQLite's `COLLATE NOCASE` does not handle.

### 🛒 Accounts, collection, shop
Registration picks an attribute, and the whole starter kit comes in it: three Bakugan,
six Gate cards, five Ability cards and 100 tokens.
Passwords use PBKDF2-HMAC-SHA256, 120 000 iterations, with a per-user salt.
The session is a token in an HttpOnly cookie.

| Item | Price |
|---|---|
| Bakugan ★☆☆ / ★★☆ / ★★★ | 🪙 120 / 260 / 500 |
| Ability card (any type × any attribute) | 🪙 60 |
| Gate card (any type × any attribute) | 🪙 45 |
| Nickname change | 🪙 150 |
| Attribute change | 🪙 400 |

Every price and every check lives on the server — the client cannot grant itself
tokens or items.

### 🔊 Sound without a single file
The whistle of the throw, the rolling rumble that shifts timbre with speed, wall bounces,
the opening chord, the ring of the barrier, the crunch of a broken guard, the explosion,
the victory fanfare — all synthesised from oscillators and noise through Web Audio.

---

## Rules

**Attributes.** Pyrus (Fire) → Ventus (Wind) → Subterra (Earth) → Aquos (Water) →
Darkus (Darkness) → Haos (Light) → Pyrus. Each beats the next one round the circle: **+100 G**.

**Team.** You take 3 Bakugan from your collection into battle, with a combined G-Power
of no more than **1150** — you cannot field three legendaries.

**Battle total** = base G + gate owner bonus + gate effect + attribute resonance
+ attribute advantage + ability cards.

<details>
<summary><b>Gate cards</b></summary>

| Card | Effect |
|---|---|
| ◈ Plain | no effect |
| ❂ Attribute | +150 G to a Bakugan of the gate's attribute |
| ⇄ Swap | base G-Powers trade places |
| ▲ Underdog | +250 G to whoever has the lower base |
| ⛨ Fortress | +200 G to the gate's defender |
| ✖ Silence | ability cards do not work |
| ◐ Mirror | attribute advantages do not work |
| ✦ Chaos | both sides get a random −100 to +200 G |

</details>

<details>
<summary><b>Ability cards</b></summary>

| Card | Effect |
|---|---|
| 💥 Blast Strike | +150 G to your own Bakugan |
| 🥀 Withering | −120 G to the opponent's Bakugan |
| 🔄 Inversion | final G-Powers trade places |
| 🛡 Barrier | cancels the opponent's ability |
| 🪞 Reflection | your G = opponent's G + 60 |
| ⚡ Attribute Fury | +100, and another +150 with an attribute advantage |
| 🔓 Gate Hack | cancels the Gate card's effect |
| ☯ Equilibrium | both G-Powers become their average; the player gets +80 |

</details>

**Controls.** Click a Gate card → click a highlighted pad.
Click a Bakugan → `Space` (angle) → `Space` (power).

---

## How it is built

```
server.py           HTTP server, JSON API and SQLite3 — standard library only
start.bat           one-click launch on Windows
data/catalog.json   shared reference: Bakugan, cards, prices, difficulties
index.html          markup and every dialog
css/style.css       styling
js/api.js           fetch wrapper
js/catalog.js       loads the reference data from the server
js/creatures.js     procedural creature drawing
js/sound.js         Web Audio sound synthesiser
js/auth.js          login, registration, profile header, shop
js/friends.js       friends, requests, battle invites
js/mp.js            online play: queue, move sync, surrender
js/game.js          game logic, throw physics, AI, battle animation
js/app.js           entry point
```

`data/catalog.json` is read by both the client and the server, so stats and prices
cannot drift apart.

<details>
<summary><b>API</b></summary>

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/catalog` | game reference data |
| `POST` | `/api/register` · `/api/login` · `/api/logout` | account |
| `GET` | `/api/me` | profile and collection |
| `POST` | `/api/game/result` | AI match result, token payout |
| `POST` | `/api/shop/buy` | purchase |
| `GET` | `/api/leaderboard` | top brawlers |
| `GET` | `/api/friends` | friends, requests, invites |
| `POST` | `/api/friends/add` · `/accept` · `/remove` | friend requests |
| `POST` | `/api/mp/queue` · `GET /api/mp/status` | open queue |
| `POST` | `/api/mp/invite` · `/api/mp/accept` | battle with a friend |
| `GET` | `/api/mp/sync` | long poll for the opponent's moves |
| `POST` | `/api/mp/move` · `/finish` · `/leave` | move, result, surrender |

**Tables:** `users`, `sessions`, `user_bakugan`, `user_cards`, `matches`,
`purchases`, `friends`, `mp_queue`, `mp_match`, `mp_move`, `mp_seen`, `mp_invite`.

</details>

The server listens on `127.0.0.1` only. The port is set by the `BAKUGAN_PORT`
environment variable.

> **To play against another person** you need two separate browser sessions: two
> browsers, or one normal window plus a private one — otherwise both logins land
> in the same account.

---

<div align="center">
<sub>Built for the fun of it. Bakugan is a trademark of its respective owners;
this is an unaffiliated fan project.</sub>
</div>
