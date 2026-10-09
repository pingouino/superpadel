// Interface en jeu : tableau de score façon TV, messages, jauge de puissance.
import { AI_LEVELS } from '../core/ai.js';

const $ = (s, r = document) => r.querySelector(s);

export class Hud {
  constructor(root) {
    this.root = root;
    this.sb = $('#scoreboard', root);
    this.msgs = $('#messages', root);
    this.shot = $('#shotname', root);
    this.pw = $('#power', root);
    this.pwFill = $('#power .fill', root);
    this.hint = $('#hint', root);
    this.overlay = $('#overlay', root);
    this.shotTimer = 0;
    this.lastHint = null;
  }

  show(v) {
    this.root.classList.toggle('hidden', !v);
    if (!v) this.overlay.innerHTML = '';
  }

  setTeams(names, colors) {
    this.names = names;
    this.colors = colors;
  }

  score(s) {
    const rows = [0, 1].map(t => `
      <div class="row">
        <span class="sv">${s.server === t ? '●' : ''}</span>
        <span class="tm" style="--c:${this.colors[t]}">${this.names[t]}</span>
        ${s.history.map(h => `<span class="old">${h[t]}</span>`).join('')}
        <span class="gm">${s.games[t]}</span>
        <span class="pt">${s.points[t]}</span>
      </div>`).join('');
    const tag = s.tiebreak ? '<div class="tag">TIE-BREAK</div>' : s.golden ? '<div class="tag gold">POINT D\'OR</div>' : '';
    this.sb.innerHTML = rows + tag;
  }

  message(text, cls = 'mid', dur = 1.5, delayed = false) {
    const el = document.createElement('div');
    el.className = 'msg ' + cls;
    el.textContent = text;
    const add = () => {
      this.msgs.appendChild(el);
      setTimeout(() => el.classList.add('out'), dur * 1000);
      setTimeout(() => el.remove(), dur * 1000 + 500);
    };
    if (delayed) setTimeout(add, 450); else add();
  }

  shotName(t) {
    if (!t) return;
    this.shot.textContent = t;
    this.shot.classList.remove('pop');
    void this.shot.offsetWidth;
    this.shot.classList.add('pop');
  }

  // v : null = caché, -1 = armé sans charge, 0..1 = charge
  power(v) {
    if (v === null) { this.pw.classList.remove('on'); return; }
    this.pw.classList.add('on');
    this.pwFill.style.width = (Math.max(0, v) * 100).toFixed(0) + '%';
    this.pw.classList.toggle('full', v >= 0.99);
  }

  serveHint(on) {
    if (on === this.lastHint) return;
    this.lastHint = on;
    this.hint.classList.toggle('on', on);
  }

  pause(on, session) {
    if (!on) { this.overlay.innerHTML = ''; return; }
    const lvl = session.settings.aiLevel;
    this.overlay.innerHTML = `
      <div class="panel">
        <h2>Pause</h2>
        <label>Niveau de l'IA</label>
        <div class="seg" id="pz-lvl">${AI_LEVELS.map((l, i) => `<button data-v="${i}" class="${i === lvl ? 'on' : ''}">${l.name}</button>`).join('')}</div>
        <div class="btns">
          <button class="btn primary" id="pz-resume">Reprendre</button>
          <button class="btn" id="pz-quit">Quitter le match</button>
        </div>
      </div>`;
    this.overlay.querySelectorAll('#pz-lvl button').forEach(b => b.onclick = () => {
      session.setAiLevel(+b.dataset.v);
      this.overlay.querySelectorAll('#pz-lvl button').forEach(x => x.classList.toggle('on', x === b));
    });
    $('#pz-resume', this.overlay).onclick = () => { session.paused = false; this.pause(false); };
    $('#pz-quit', this.overlay).onclick = () => { session.paused = false; this.pause(false); session.onEnd && session.onEnd({}); };
  }

  results(info, onAgain, onMenu) {
    const sets = info.sets.map(s => `${s[0]}-${s[1]}`).join('  ');
    const title = info.win ? '¡ Victoria !' : info.winner >= 0 ? 'Défaite…' : 'Fin du match';
    this.overlay.innerHTML = `
      <div class="panel results ${info.win ? 'win' : ''}">
        <h2>${title}</h2>
        <p class="winner" style="color:${info.colors[info.winner]}">Équipe ${info.teamNames[info.winner]} gagne</p>
        <p class="who">${info.names[info.winner]}</p>
        <p class="sets">${sets}</p>
        <div class="btns">
          ${onAgain ? '<button class="btn primary" id="rs-again">Rejouer</button>' : ''}
          <button class="btn" id="rs-menu">Menu</button>
        </div>
      </div>`;
    const a = $('#rs-again', this.overlay);
    if (a) a.onclick = () => { this.overlay.innerHTML = ''; onAgain(); };
    $('#rs-menu', this.overlay).onclick = () => { this.overlay.innerHTML = ''; onMenu(); };
  }
}
