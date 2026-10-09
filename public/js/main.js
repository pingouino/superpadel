// Point d'entrée : menus, salle d'attente en ligne, boucle d'animation.
import { GameRenderer } from './render/scene.js';
import { ROSTER, TEAM_COLORS, renderPortraits } from './render/character.js';
import { Audio } from './audio.js';
import { Input } from './input.js';
import { Hud } from './ui/hud.js';
import { Session } from './game.js';
import { Relay, defaultServer, randomRoomCode } from './net.js';
import { AI_LEVELS } from './core/ai.js';

const $ = (s, r = document) => r.querySelector(s);

const FORMATS = {
  quick: { label: 'Rapide · 1 set de 4 jeux', match: { gamesPerSet: 4, setsToWin: 1 } },
  set: { label: '1 set de 6 jeux', match: { gamesPerSet: 6, setsToWin: 1 } },
  match: { label: '2 sets gagnants', match: { gamesPerSet: 6, setsToWin: 2 } },
};

function load(k, d) {
  try { const v = localStorage.getItem('sp.' + k); return v === null ? d : JSON.parse(v); } catch { return d; }
}
function save(k, v) {
  try { localStorage.setItem('sp.' + k, JSON.stringify(v)); } catch { /* */ }
}

const prefs = {
  name: load('name', 'Joueur'),
  char: load('char', 0),
  level: load('level', 2),
  format: load('format', 'quick'),
  golden: load('golden', true),
  server: load('server', '') || defaultServer(),
  volume: load('volume', 0.8),
  assist: load('assist', true),
};

const audio = new Audio();
audio.setVolume(prefs.volume);
const input = new Input();
const renderer = new GameRenderer($('#view'));
const hud = new Hud($('#hud'));
input.attachTouch($('#touch'));
if (matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');

let portraits = [];
try { portraits = renderPortraits(160); } catch { portraits = []; }

let session = null;
let relay = null;
const menu = $('#menu');

// Décor animé derrière les menus
renderer.orbit = true;
renderer.setCameraSide(1);
const idleView = {
  players: [
    { x: 2, z: 8, vx: 0, vz: 0, face: Math.PI, jump: 0 }, { x: -2, z: 3, vx: 0, vz: 0, face: Math.PI, jump: 0 },
    { x: -2, z: -8, vx: 0, vz: 0, face: 0, jump: 0 }, { x: 2, z: -3, vx: 0, vz: 0, face: 0, jump: 0 },
  ],
  ball: { x: 0, y: 1, z: 0, visible: false },
};
renderer.setupPlayers([0, 1, 2, 3].map(i => ({ char: [0, 1, 2, 3][i], team: i < 2 ? 0 : 1 })));

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (session) session.frame(dt);
  else {
    const t = now / 1000;
    idleView.players.forEach((p, i) => { p.mood = Math.sin(t * 0.5 + i) > 0.6 ? 'happy' : null; });
    renderer.render(idleView, dt);
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

function click() {
  audio.init();
  audio.ui('click');
}

function show(html) {
  menu.innerHTML = html;
  menu.classList.remove('hidden');
  menu.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { audio.init(); audio.ui('click'); }, { capture: true }));
}

function charPicker(sel) {
  return `<div class="chars">${ROSTER.map((c, i) => `
    <button class="char ${i === sel ? 'on' : ''}" data-c="${i}" title="${c.name}">
      ${portraits[i] ? `<img src="${portraits[i]}" alt="">` : `<span class="dot" style="background:#${c.hair.toString(16).padStart(6, '0')}"></span>`}
      <span>${c.name}</span>
    </button>`).join('')}</div>`;
}

function bindCharPicker(onPick) {
  menu.querySelectorAll('.char').forEach(b => b.onclick = () => {
    prefs.char = +b.dataset.c; save('char', prefs.char);
    menu.querySelectorAll('.char').forEach(x => x.classList.toggle('on', x === b));
    onPick && onPick(prefs.char);
  });
}

function levelSeg(lvl, id = 'lvl') {
  return `<div class="seg" id="${id}">${AI_LEVELS.map((l, i) => `<button data-v="${i}" class="${i === lvl ? 'on' : ''}">${l.name}</button>`).join('')}</div>`;
}

function bindSeg(id, cb) {
  menu.querySelectorAll(`#${id} button`).forEach(b => b.onclick = () => {
    menu.querySelectorAll(`#${id} button`).forEach(x => x.classList.toggle('on', x === b));
    cb(b.dataset.v);
  });
}

function formatSeg(f, id = 'fmt') {
  return `<div class="seg" id="${id}">${Object.entries(FORMATS).map(([k, v]) => `<button data-v="${k}" class="${k === f ? 'on' : ''}">${v.label}</button>`).join('')}</div>`;
}

// ---------- Écrans ----------
function titleScreen() {
  endSession();
  renderer.orbit = true;
  renderer.setupPlayers([0, 1, 2, 3].map(i => ({ char: (prefs.char + i * 3) % ROSTER.length, team: i < 2 ? 0 : 1 })));
  show(`
    <div class="title">
      <h1 class="logo"><span>SUPER</span><b>PADEL</b></h1>
      <p class="tag">Le padel mignon, rapide et explosif</p>
      <div class="col">
        <button class="btn primary big" id="b-solo">Jouer contre l'IA</button>
        <button class="btn big" id="b-online">Multijoueur en ligne</button>
        <button class="btn" id="b-help">Commandes & règles</button>
        <button class="btn" id="b-opts">Options</button>
      </div>
    </div>`);
  $('#b-solo').onclick = soloScreen;
  $('#b-online').onclick = onlineScreen;
  $('#b-help').onclick = helpScreen;
  $('#b-opts').onclick = optionsScreen;
}

function soloScreen() {
  show(`
    <div class="panel wide">
      <h2>Partie contre l'IA</h2>
      <label>Ton personnage</label>
      ${charPicker(prefs.char)}
      <label>Difficulté de l'IA</label>
      ${levelSeg(prefs.level)}
      <label>Format</label>
      ${formatSeg(prefs.format)}
      <label class="check"><input type="checkbox" id="gold" ${prefs.golden ? 'checked' : ''}> Point d'or à 40-40 (sinon avantages)</label>
      <p class="note">Tu joues avec un(e) partenaire IA contre deux IA.</p>
      <div class="btns">
        <button class="btn" id="back">Retour</button>
        <button class="btn primary" id="go">¡ Vamos !</button>
      </div>
    </div>`);
  bindCharPicker();
  bindSeg('lvl', v => { prefs.level = +v; save('level', prefs.level); });
  bindSeg('fmt', v => { prefs.format = v; save('format', v); });
  $('#gold').onchange = e => { prefs.golden = e.target.checked; save('golden', prefs.golden); };
  $('#back').onclick = titleScreen;
  $('#go').onclick = startSolo;
}

function pickAiChars(used, n) {
  const free = ROSTER.map((_, i) => i).filter(i => !used.includes(i));
  for (let i = free.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [free[i], free[j]] = [free[j], free[i]]; }
  return free.slice(0, n);
}

function startSolo() {
  audio.init();
  audio.ui('start');
  const ai = pickAiChars([prefs.char], 3);
  const slots = [
    { name: prefs.name || 'Toi', char: prefs.char, ctrl: 'local' },
    { name: ROSTER[ai[0]].name, char: ai[0], ctrl: 'ai' },
    { name: ROSTER[ai[1]].name, char: ai[1], ctrl: 'ai' },
    { name: ROSTER[ai[2]].name, char: ai[2], ctrl: 'ai' },
  ];
  const settings = {
    match: { ...FORMATS[prefs.format].match, golden: prefs.golden },
    aiLevel: prefs.level, assist: prefs.assist, humanErr: 0.3,
  };
  menu.classList.add('hidden');
  session = new Session({
    mode: 'solo', slots, me: 0, settings, seed: (Math.random() * 1e9) | 0,
    renderer, audio, input, hud,
    onEnd: (r) => { if (r.again) startSolo(); else titleScreen(); },
  });
}

function helpScreen() {
  show(`
    <div class="panel wide help">
      <h2>Commandes</h2>
      <div class="grid2">
        <div>
          <h3>Clavier</h3>
          <p><kbd>←↑↓→</kbd> ou <kbd>WASD</kbd>/<kbd>ZQSD</kbd> : se déplacer</p>
          <p><kbd>J</kbd> / <kbd>Espace</kbd> : <b>Liftado</b> (coup puissant) · en hauteur : <b>Remate</b> (smash)</p>
          <p><kbd>K</kbd> : <b>Cortado</b> (coupé, rebond bas) · en hauteur : <b>Bandeja</b></p>
          <p><kbd>L</kbd> : <b>Globo</b> (lob) · en hauteur : <b>Víbora</b></p>
          <p><kbd>Échap</kbd> : pause</p>
          <h3>Manette</h3>
          <p>Stick / croix : déplacement · <b>A</b> Liftado · <b>B</b> Cortado · <b>X/Y</b> Globo</p>
        </div>
        <div>
          <h3>Comment frapper</h3>
          <p>Appuie sur un coup <b>avant</b> que la balle arrive : ton joueur se prépare et frappe tout seul au bon moment.
          Plus tu <b>maintiens</b> le bouton, plus le coup est puissant (mais plus risqué).</p>
          <p>Au moment de la frappe, la <b>direction</b> tenue vise : gauche/droite pour l'angle, haut pour une balle longue, bas pour une balle courte.</p>
          <p>Tu peux laisser la balle rebondir sur les vitres puis la jouer : c'est tout l'art du padel !</p>
          <h3>Règles</h3>
          <p>Service à la cuillère, en diagonale, rebond dans le carré. Une balle de service qui touche le grillage après le rebond est faute.
          En jeu, la balle doit rebondir au sol chez l'adversaire avant de toucher une vitre. Deux rebonds = point perdu.
          Un smash qui sort par-dessus les vitres après un rebond (<b>por 3 / por 4</b>) est gagnant !</p>
        </div>
      </div>
      <div class="btns"><button class="btn primary" id="back">OK</button></div>
    </div>`);
  $('#back').onclick = titleScreen;
}

function optionsScreen() {
  show(`
    <div class="panel">
      <h2>Options</h2>
      <label>Ton pseudo</label>
      <input id="name" maxlength="12" value="${escapeHtml(prefs.name)}">
      <label>Volume des bruitages</label>
      <input type="range" id="vol" min="0" max="1" step="0.05" value="${prefs.volume}">
      <label class="check"><input type="checkbox" id="assist" ${prefs.assist ? 'checked' : ''}> Aide au placement quand un coup est armé</label>
      <div class="btns"><button class="btn primary" id="back">OK</button></div>
    </div>`);
  $('#name').oninput = e => { prefs.name = e.target.value.trim() || 'Joueur'; save('name', prefs.name); };
  $('#vol').oninput = e => { prefs.volume = +e.target.value; save('volume', prefs.volume); audio.setVolume(prefs.volume); };
  $('#vol').onchange = () => { audio.init(); audio.hit(0.6, 'drive'); };
  $('#assist').onchange = e => { prefs.assist = e.target.checked; save('assist', prefs.assist); };
  $('#back').onclick = titleScreen;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- En ligne ----------
function onlineScreen(err) {
  endSession();
  show(`
    <div class="panel wide">
      <h2>Multijoueur en ligne</h2>
      <p class="note">Jusqu'à 4 joueurs. Les places libres sont prises par l'IA.</p>
      <div class="grid2">
        <div>
          <label>Ton pseudo</label>
          <input id="name" maxlength="12" value="${escapeHtml(prefs.name)}">
        </div>
        <div>
          <label>Serveur relais</label>
          <input id="server" placeholder="https://superpadel.xxx.workers.dev" value="${escapeHtml(prefs.server)}">
        </div>
      </div>
      <label>Ton personnage</label>
      ${charPicker(prefs.char)}
      <div class="grid2 join">
        <button class="btn primary big" id="create">Créer une salle</button>
        <div class="joinbox">
          <input id="code" maxlength="6" placeholder="CODE" autocapitalize="characters">
          <button class="btn big" id="join">Rejoindre</button>
        </div>
      </div>
      ${err ? `<p class="error">${escapeHtml(err)}</p>` : ''}
      <div class="btns"><button class="btn" id="back">Retour</button></div>
    </div>`);
  bindCharPicker();
  $('#name').oninput = e => { prefs.name = e.target.value.trim() || 'Joueur'; save('name', prefs.name); };
  $('#server').oninput = e => { prefs.server = e.target.value.trim(); save('server', prefs.server); };
  $('#back').onclick = titleScreen;
  $('#create').onclick = () => connect(randomRoomCode());
  $('#join').onclick = () => {
    const c = $('#code').value.trim().toUpperCase();
    if (!/^[A-Z0-9]{4,6}$/.test(c)) return onlineScreen('Code de salle invalide');
    connect(c);
  };
  const params = new URLSearchParams(location.search);
  if (params.get('room') && !err) $('#code').value = params.get('room').toUpperCase();
}

let lobby = null;

async function connect(code) {
  if (!prefs.server) return onlineScreen("Indique l'adresse du serveur relais (ton Worker Cloudflare).");
  show(`<div class="panel"><h2>Connexion…</h2><p class="note">Salle ${code}</p></div>`);
  relay = new Relay();
  try {
    await relay.connect(prefs.server, code, prefs.name);
  } catch (e) {
    relay = null;
    return onlineScreen('Connexion impossible : ' + e.message);
  }
  lobby = {
    code,
    slots: [null, null, null, null],
    settings: { level: prefs.level, format: prefs.format, golden: prefs.golden },
  };
  if (relay.isHost) {
    lobby.slots[0] = { peer: relay.id, name: prefs.name, char: prefs.char };
  } else {
    relay.send({ k: 'hello', name: prefs.name, char: prefs.char }, relay.host);
  }
  bindLobby();
  lobbyScreen();
}

function bindLobby() {
  relay.on('msg', (from, d) => {
    if (relay.isHost) {
      if (d.k === 'hello') {
        if (session) { relay.send({ k: 'busy' }, from); return; }
        if (!lobby.slots.some(s => s && s.peer === from)) {
          const order = [2, 1, 3, 0];
          const free = order.find(i => !lobby.slots[i]);
          if (free === undefined) return;
          lobby.slots[free] = { peer: from, name: d.name, char: d.char };
        }
        broadcastLobby();
      } else if (d.k === 'pick') {
        if (session) return;
        const cur = lobby.slots.findIndex(s => s && s.peer === from);
        if (cur >= 0 && !lobby.slots[d.slot]) {
          lobby.slots[d.slot] = lobby.slots[cur];
          lobby.slots[cur] = null;
          broadcastLobby();
        }
      } else if (d.k === 'char') {
        const s = lobby.slots.find(s => s && s.peer === from);
        if (s) { s.char = d.char; broadcastLobby(); }
      }
    } else {
      if (d.k === 'lobby') {
        lobby.slots = d.slots;
        lobby.settings = d.settings;
        if (!session) lobbyScreen();
      } else if (d.k === 'start') {
        startOnline(d);
      } else if (d.k === 'busy') {
        leaveOnline('La partie a déjà commencé dans cette salle.');
      }
    }
  });
  relay.on('join', () => { if (relay.isHost) broadcastLobby(); });
  relay.on('leave', (m, wasHost) => {
    if (wasHost) return leaveOnline("L'hôte a quitté la salle.");
    if (relay.isHost) {
      const i = lobby.slots.findIndex(s => s && s.peer === m.id);
      if (i >= 0 && !session) { lobby.slots[i] = null; broadcastLobby(); }
    } else if (!session) lobbyScreen();
  });
  relay.on('close', () => leaveOnline('Connexion perdue.'));
}

function broadcastLobby() {
  relay.send({ k: 'lobby', slots: lobby.slots, settings: lobby.settings });
  if (!session) lobbyScreen();
}

function leaveOnline(msg) {
  if (relay) relay.close();
  relay = null;
  lobby = null;
  onlineScreen(msg);
}

function lobbyScreen() {
  const host = relay.isHost;
  const myIdx = lobby.slots.findIndex(s => s && s.peer === relay.id);
  const link = `${location.origin}${location.pathname}?room=${lobby.code}${prefs.server && prefs.server !== location.origin ? '&server=' + encodeURIComponent(prefs.server) : ''}`;
  const slotHtml = (i) => {
    const s = lobby.slots[i];
    const side = i % 2 === 0 ? 'Droite' : 'Gauche';
    if (s) {
      return `<div class="slot taken ${s.peer === relay.id ? 'me' : ''}">
        ${portraits[s.char] ? `<img src="${portraits[s.char]}">` : ''}
        <b>${escapeHtml(s.name)}</b><small>${side}${s.peer === relay.host ? ' · hôte' : ''}</small></div>`;
    }
    return `<div class="slot ai"><span class="robot">🤖</span><b>IA</b><small>${side}</small>
      <button class="btn small" data-slot="${i}">Prendre</button></div>`;
  };
  show(`
    <div class="panel wide lobby">
      <h2>Salle <span class="code">${lobby.code}</span></h2>
      <p class="note">Partage ce code (ou ce lien) à tes amis : <input class="link" readonly value="${escapeHtml(link)}"></p>
      <div class="teams">
        <div class="team" style="--c:${TEAM_COLORS[0].css}"><h3>Équipe ${TEAM_COLORS[0].name}</h3>${slotHtml(0)}${slotHtml(1)}</div>
        <div class="vs">VS</div>
        <div class="team" style="--c:${TEAM_COLORS[1].css}"><h3>Équipe ${TEAM_COLORS[1].name}</h3>${slotHtml(2)}${slotHtml(3)}</div>
      </div>
      ${host ? `
        <label>Difficulté de l'IA</label>${levelSeg(lobby.settings.level)}
        <label>Format</label>${formatSeg(lobby.settings.format)}
        <label class="check"><input type="checkbox" id="gold" ${lobby.settings.golden ? 'checked' : ''}> Point d'or</label>
      ` : `<p class="note">IA : ${AI_LEVELS[lobby.settings.level].name} · ${FORMATS[lobby.settings.format].label} · ${lobby.settings.golden ? "point d'or" : 'avantages'}</p>`}
      <div class="btns">
        <button class="btn" id="quit">Quitter</button>
        ${host ? '<button class="btn primary" id="start">Lancer le match</button>' : '<span class="wait">En attente de l\'hôte…</span>'}
      </div>
    </div>`);
  void myIdx;
  menu.querySelector('.link').onclick = (e) => { e.target.select(); navigator.clipboard?.writeText(link); };
  menu.querySelectorAll('[data-slot]').forEach(b => b.onclick = () => {
    const slot = +b.dataset.slot;
    if (host) {
      const cur = lobby.slots.findIndex(s => s && s.peer === relay.id);
      lobby.slots[slot] = lobby.slots[cur];
      lobby.slots[cur] = null;
      broadcastLobby();
    } else relay.send({ k: 'pick', slot }, relay.host);
  });
  $('#quit').onclick = () => leaveOnline();
  if (host) {
    bindSeg('lvl', v => { lobby.settings.level = +v; prefs.level = +v; save('level', prefs.level); broadcastLobby(); });
    bindSeg('fmt', v => { lobby.settings.format = v; broadcastLobby(); });
    $('#gold').onchange = e => { lobby.settings.golden = e.target.checked; broadcastLobby(); };
    $('#start').onclick = () => {
      const used = lobby.slots.filter(Boolean).map(s => s.char);
      const ai = pickAiChars(used, 4);
      let k = 0;
      const slots = lobby.slots.map(s => s ? { name: s.name, char: s.char, peer: s.peer } : { name: ROSTER[ai[k]].name, char: ai[k++], peer: null });
      const settings = {
        match: { ...FORMATS[lobby.settings.format].match, golden: lobby.settings.golden },
        aiLevel: lobby.settings.level, assist: prefs.assist, humanErr: 0.3,
      };
      const msg = { k: 'start', slots, settings, seed: (Math.random() * 1e9) | 0 };
      relay.send(msg);
      startOnline(msg);
    };
  }
}

function startOnline(msg) {
  audio.init();
  audio.ui('start');
  const me = msg.slots.findIndex(s => s.peer === relay.id);
  const host = relay.isHost;
  const slots = msg.slots.map(s => ({
    name: s.name, char: s.char, peer: s.peer,
    ctrl: s.peer === null ? 'ai' : s.peer === relay.id ? 'local' : 'remote',
  }));
  menu.classList.add('hidden');
  const settings = { ...msg.settings, assist: prefs.assist };
  session = new Session({
    mode: host ? 'host' : 'client', slots, me, settings, seed: msg.seed, relay,
    renderer, audio, input, hud,
    onEnd: (r) => {
      if (r && r.aborted) return leaveOnline('La partie a été interrompue.');
      endSession(false);
      if (relay) { bindLobby(); if (relay.isHost) broadcastLobby(); else lobbyScreen(); }
      else onlineScreen();
    },
  });
}

function endSession(closeRelay = true) {
  if (session) session.destroy();
  session = null;
  hud.show(false);
  hud.power(null);
  hud.serveHint(false);
  renderer.orbit = true;
  renderer.setCameraSide(1);
  if (closeRelay && relay) { relay.close(); relay = null; }
}

// Débloque l'audio au premier geste
window.addEventListener('pointerdown', () => audio.init(), { once: true });
window.addEventListener('keydown', () => audio.init(), { once: true });

if (new URLSearchParams(location.search).get('room')) onlineScreen();
else titleScreen();

// Accès de débogage
window.__sp = { renderer, get session() { return session; }, startSolo, prefs };
void click;
