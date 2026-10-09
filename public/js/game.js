// Session de jeu : relie simulation (ou monde client), rendu, son, interface et réseau.
import { Sim } from './core/sim.js';
import { ClientWorld } from './core/client.js';
import { SIM_DT, teamSide, clamp } from './core/constants.js';
import { Match } from './core/rules.js';
import { SHOT_NAMES } from './core/shots.js';
import { TEAM_COLORS } from './render/character.js';
import { AIBrain } from './core/ai.js';

const REASONS = {
  double: 'Double rebond',
  wall: 'Vitre directe !',
  net: 'Filet !',
  ownfloor: 'Faute !',
  out: 'Dehors !',
  por3: '¡ POR 3 !',
  por4: '¡ POR 4 !',
  back: 'La balle revient !',
  body: 'Touché !',
  bodyown: 'Touche le partenaire !',
};

const SNAP_EVERY = 4; // 30 instantanés / s

export class Session {
  // opts : { mode: 'solo'|'host'|'client', slots, me, settings, seed, relay, renderer, audio, input, hud, onEnd }
  constructor(opts) {
    Object.assign(this, opts);
    this.acc = 0;
    this.tickCount = 0;
    this.paused = false;
    this.ended = false;
    this.lastSquad = 0;
    this.sendT = 0;
    this.names = [0, 1].map(t => this.slots.filter((s, i) => (i < 2 ? 0 : 1) === t).map(s => s.name).join(' & '));

    if (this.mode === 'client') {
      this.world = new ClientWorld(this.slots, this.me);
      this.world.humanErr = this.settings.humanErr;
      this.world.onLocalHit = (msg) => this.relay.send(msg, this.relay.host);
      this.match = Match.fromSnapshot(this.settings.matchSnap || new Match(this.settings.match).snapshot());
    } else {
      this.sim = new Sim({
        players: this.slots.map((s, i) => ({ name: s.name, char: s.char, ctrl: s.ctrl, peer: s.peer })),
        match: this.settings.match, aiLevel: this.settings.aiLevel, seed: this.seed,
        humanErr: this.settings.humanErr, introTime: 2.0,
      });
      for (const p of this.sim.players) p.assist = this.settings.assist !== false;
      this.match = this.sim.match;
      this.prev = this.capture();
    }

    const meTeam = this.me >= 0 ? (this.me < 2 ? 0 : 1) : 0;
    this.side = teamSide(meTeam);
    this.renderer.setCameraSide(this.side);
    this.renderer.orbit = false;
    this.renderer.setupPlayers(this.slots.map((s, i) => ({
      char: s.char, team: i < 2 ? 0 : 1, name: s.name,
      label: s.ctrl === 'ai' ? null : (i === this.me ? 'P' + (this.slotLabel(i)) : s.name.slice(0, 6)),
      local: i === this.me,
    })));
    this.hud.show(true);
    this.hud.setTeams(this.names, TEAM_COLORS.map(t => t.css));
    this.updateScore();
    this.hud.message('¡ Vamos !', 'big', 1.6);
    this.audio.applause(0.6);

    if (this.mode === 'host') {
      this.bindHost();
      // état initial pour les clients (placement du premier service)
      this.forward({ type: 'setup', server: this.sim.serve.id, faults: 0 });
    }
    if (this.mode === 'client') this.bindClient();
  }

  slotLabel(i) {
    // numérotation des humains
    let n = 0;
    for (let j = 0; j <= i; j++) if (this.slots[j].ctrl !== 'ai') n++;
    return n;
  }

  // ---------- Réseau ----------
  bindHost() {
    const r = this.relay;
    r.on('msg', (from, d) => {
      const idx = this.slots.findIndex(s => s.peer === from);
      if (idx < 0) return;
      const p = this.sim.players[idx];
      if (d.k === 'in') {
        // juste après le replacement, on ignore les positions envoyées avant que le client l'ait reçu
        if (this.sim.time - (this.setupT || 0) > 0.25 + r.rtt) {
          p.x = d.x; p.z = d.z; p.vx = d.vx; p.vz = d.vz; p.face = d.f;
        }
        p.held = !!d.h; p.armed = d.a ? 'drive' : null; p.aimX = d.ax; p.aimZ = d.ay;
      } else if (d.k === 'hit') {
        d.lag = clamp((d.lag || 0) + r.rtt / 2, 0, 0.2);
        this.sim.applyRemoteHit(p, d);
      } else if (d.k === 'serve') {
        p.held = true;
        this.sim.startServe(p, d.b, 0.6, d.ax, d.ay);
      }
    });
    r.on('leave', (m) => {
      const idx = this.slots.findIndex(s => s.peer === m.id);
      if (idx >= 0) {
        // le joueur parti est remplacé par l'IA
        this.slots[idx].ctrl = 'ai';
        this.sim.players[idx].ctrl = 'ai';
        this.sim.brains[idx] = new AIBrain(this.sim, this.sim.players[idx], this.settings.aiLevel);
        this.hud.message(`${this.slots[idx].name} a quitté la partie`, 'small', 2.5);
      }
    });
  }

  bindClient() {
    const r = this.relay;
    r.on('msg', (from, d) => {
      if (from !== r.host) return;
      if (d.k === 's') this.world.applySnapshot(d.s);
      else if (d.k === 'ev') this.onRemoteEvent(d.e);
    });
    r.on('leave', (m, wasHost) => {
      if (wasHost) this.abort("L'hôte a quitté la partie");
    });
    r.on('close', () => this.abort('Connexion perdue'));
  }

  abort(msg) {
    if (this.ended) return;
    this.ended = true;
    this.hud.message(msg, 'big', 3);
    setTimeout(() => this.onEnd && this.onEnd({ aborted: true }), 2500);
  }

  onRemoteEvent(e) {
    const w = this.world;
    if (e.type === 'setup') {
      w.teleport(e.pos);
      if (e.m) this.match = Match.fromSnapshot(e.m);
    }
    if (e.type === 'point' && e.m) this.match = Match.fromSnapshot(e.m);
    if (e.type === 'hit') {
      if (e.id === this.me) return; // déjà joué localement
      const p = w.players[e.id];
      p.swing = { kind: e.anim, t0: w.time - (w.lag || 0) };
    }
    this.handleEvent(e);
  }

  // ---------- Boucle ----------
  frame(dt) {
    if (this.ended && this.mode !== 'solo') { /* on continue d'afficher */ }
    const inp = this.input.poll();
    if (inp.pause && this.mode === 'solo' && !this.ended) {
      this.paused = !this.paused;
      this.hud.pause(this.paused, this);
    }
    if (this.paused) {
      this.renderer.render(this.view(1), 0);
      return;
    }
    const wx = inp.mx * (this.side > 0 ? 1 : -1);
    const wz = -inp.my * this.side;

    if (this.mode === 'client') return this.frameClient(dt, inp, wx, wz);

    const sim = this.sim;
    const me = this.me >= 0 ? sim.players[this.me] : null;
    if (me) {
      me.wantX = wx; me.wantZ = wz;
      me.aimX = inp.mx; me.aimZ = inp.my;
      me.held = inp.held;
      for (const b of inp.presses) sim.pressShot(me, b);
    }
    this.acc += Math.min(dt, 0.1);
    let n = 0;
    while (this.acc >= SIM_DT && n < 12) {
      this.prev = this.capture();
      sim.tick();
      this.tickCount++;
      n++;
      this.acc -= SIM_DT;
      for (const e of sim.events) {
        this.handleEvent(e);
        if (this.mode === 'host') this.forward(e);
      }
      sim.events.length = 0;
      if (this.mode === 'host' && this.tickCount % SNAP_EVERY === 0) {
        this.relay.send({ k: 's', s: sim.snapshot() });
      }
    }
    if (me) this.hud.power(me.armed && me.held ? clamp(me.holdT / 0.65, 0, 1) : me.armed ? -1 : null);
    this.hud.serveHint(sim.phase === 'serve' && sim.serve && sim.serve.id === this.me && sim.serve.state === 'ready');
    this.sneakers(sim.players, dt);
    this.renderer.render(this.view(this.acc / SIM_DT), dt);
  }

  frameClient(dt, inp, wx, wz) {
    const w = this.world;
    w.lag = clamp(this.relay.rtt, 0.02, 0.25);
    const me = w.me;
    for (const b of inp.presses) {
      if (w.phase === 'serve' && w.serve && w.serve.id === me.id && w.serve.state === 'ready') {
        this.relay.send({ k: 'serve', b, ax: inp.mx, ay: inp.my }, this.relay.host);
      } else if (w.phase === 'rally') {
        if (!me.armed) { me.holdT = 0; me.armT = w.time; }
        me.armed = b;
      }
    }
    if (w.phase !== 'rally') me.armed = null;
    w.update(Math.min(dt, 0.1), { wx, wz, mx: inp.mx, my: inp.my, held: inp.held });
    for (const e of w.events) this.handleEvent(e);
    w.events.length = 0;
    this.sendT += dt;
    if (this.sendT >= 1 / 20) {
      this.sendT = 0;
      this.relay.send({
        k: 'in', x: +me.x.toFixed(3), z: +me.z.toFixed(3), vx: +me.vx.toFixed(2), vz: +me.vz.toFixed(2), f: +me.face.toFixed(3),
        h: inp.held ? 1 : 0, a: me.armed ? 1 : 0, ax: +inp.mx.toFixed(2), ay: +inp.my.toFixed(2),
      }, this.relay.host);
    }
    this.hud.power(me.armed && me.held ? clamp(me.holdT / 0.65, 0, 1) : me.armed ? -1 : null);
    this.hud.serveHint(w.phase === 'serve' && w.serve && w.serve.id === me.id && w.serve.state === 'ready');
    const ball = w.displayBall();
    const players = w.players.map(p => this.playerView(p, w.time, ball));
    this.sneakers(w.players, dt);
    this.renderer.render({ players, ball, focus: me }, dt);
  }

  forward(e) {
    const t = e.type;
    if (t === 'ball') return;
    const out = { ...e };
    if (t === 'setup') {
      out.pos = this.sim.players.map(p => [p.x, p.z]);
      out.m = this.sim.match.snapshot();
    }
    if (t === 'point') out.m = this.sim.match.snapshot();
    this.relay.send({ k: 'ev', e: out });
  }

  capture() {
    const s = this.sim;
    return {
      b: [s.ball.x, s.ball.y, s.ball.z],
      p: s.players.map(p => [p.x, p.z]),
    };
  }

  playerView(p, time, b) {
    let armKind = 'fh';
    if (p.armed && b) {
      const lat = (b.x - p.x) * (p.team === 0 ? 1 : -1);
      armKind = b.y > 1.75 ? 'oh' : lat >= 0 ? 'fh' : 'bh';
    }
    return {
      x: p.x, z: p.z, vx: p.vx, vz: p.vz, face: p.face, jump: p.jump, armed: !!p.armed, armKind,
      swingKind: p.swing ? p.swing.kind : null, swingT: p.swing ? time - p.swing.t0 : 0, mood: p.mood,
    };
  }

  view(alpha) {
    const s = this.sim;
    const a = clamp(alpha, 0, 1);
    const pv = this.prev;
    const b = s.ball;
    const players = s.players.map((p, i) => {
      const v = this.playerView(p, s.time, b);
      v.x = pv.p[i][0] + (p.x - pv.p[i][0]) * a;
      v.z = pv.p[i][1] + (p.z - pv.p[i][1]) * a;
      return v;
    });
    const ball = {
      x: pv.b[0] + (b.x - pv.b[0]) * a, y: pv.b[1] + (b.y - pv.b[1]) * a, z: pv.b[2] + (b.z - pv.b[2]) * a,
      visible: s.ballVisible, speed: Math.hypot(b.vx, b.vy, b.vz),
    };
    const focus = this.me >= 0 ? s.players[this.me] : { x: 0, z: 0 };
    return { players, ball, focus };
  }

  // Crissements de baskets lors des changements d'appui brusques
  sneakers(players, dt) {
    if (!this.prevVel) this.prevVel = players.map(() => [0, 0]);
    players.forEach((p, i) => {
      const pv = this.prevVel[i];
      const acc = Math.hypot(p.vx - pv[0], p.vz - pv[1]) / Math.max(dt, 1e-3);
      if (acc > 22 && Math.hypot(p.vx, p.vz) > 1.2 && Math.random() < 0.35) this.audio.squeak(this.pan(p.x));
      pv[0] = p.vx; pv[1] = p.vz;
    });
  }

  // ---------- Événements : son, effets, interface ----------
  pan(x) {
    return clamp((x - this.renderer.camX) / 7, -1, 1) * this.side;
  }

  distGain(z) {
    return clamp(1 - Math.abs(z - this.side * 12) / 40, 0.45, 1);
  }

  handleEvent(e) {
    const A = this.audio, R = this.renderer, H = this.hud;
    switch (e.type) {
      case 'ball': {
        const ev = e.ev;
        const pan = this.pan(ev.x), dg = this.distGain(ev.z);
        if (ev.type === 'floor') { A.bounce(ev.speed, pan, dg); if (ev.speed > 3) R.dust(ev.x, ev.z, Math.min(1.5, ev.speed / 8)); }
        else if (ev.type === 'glass') A.glass(ev.speed, pan, dg);
        else if (ev.type === 'mesh') A.mesh(ev.speed, pan, dg);
        else if (ev.type === 'net' || ev.type === 'netcord') A.net(pan);
        else if (ev.type === 'out') A.ooh();
        break;
      }
      case 'hit': {
        A.hit(e.power, e.kind, this.pan(e.x), this.distGain(e.z));
        if (e.speed > 22 || e.kick) {
          R.burst(e.x, e.y, e.z, 1.2, 0xfff3a0, 10);
          R.shake = Math.min(1, R.shake + (e.kind === 'smash' ? 0.8 : 0.3));
        } else if (e.power > 0.7) R.burst(e.x, e.y, e.z, 0.7, 0xffffff, 5);
        if (e.id === this.me) H.shotName(SHOT_NAMES[e.kind] || '');
        if (e.kind === 'smash') this.renderer.arena.cheer(0.4);
        break;
      }
      case 'setup': {
        if (this.mode !== 'client') { this.prev = this.capture(); this.setupT = this.sim.time; }
        this.updateScore();
        if (this.match.isGoldenPoint()) H.message("Point d'or !", 'gold', 1.6);
        if (e.faults === 1) H.message('2e service', 'small', 1.2);
        break;
      }
      case 'fault': {
        H.message(e.fault === 'mesh' ? 'Faute : grillage !' : e.fault === 'net' ? 'Faute : filet' : 'Faute !', 'mid', 1.2);
        A.chime(false);
        break;
      }
      case 'let': {
        H.message('Let — à rejouer', 'mid', 1.2);
        break;
      }
      case 'point': {
        this.updateScore();
        const team = e.winner;
        const mine = this.me >= 0 && (this.me < 2 ? 0 : 1) === team;
        let txt = e.doubleFault ? 'Double faute' : REASONS[e.reason] || 'Point';
        let cls = 'mid';
        if (e.reason === 'por3' || e.reason === 'por4') { cls = 'fire'; R.confetti(); R.shake = 1; }
        H.message(txt, cls, 1.8);
        H.message(`Point ${TEAM_COLORS[team].name}`, 'team' + team, 1.8, true);
        let big = 0.5 + Math.min(1, (e.rally || 0) / 12);
        if (e.kind === 'game') { H.message('Jeu !', 'big', 1.8, true); big += 0.3; }
        if (e.kind === 'set') { H.message('Set !', 'big', 2.2, true); big += 0.6; }
        if (e.kind === 'match') big += 1;
        if (cls === 'fire') big += 0.6;
        A.applause(Math.min(1.4, big));
        A.chime(mine || this.me < 0);
        R.arena.cheer(big);
        break;
      }
      case 'matchEnd': {
        const w = e.winner;
        R.confetti();
        A.applause(1.5);
        this.ended = true;
        const mine = this.me >= 0 && (this.me < 2 ? 0 : 1) === w;
        setTimeout(() => this.hud.results({
          win: mine, winner: w, names: this.names, sets: this.match.setScores,
          colors: TEAM_COLORS.map(t => t.css), teamNames: TEAM_COLORS.map(t => t.name),
        }, () => this.onEnd && this.onEnd({ again: true }), () => this.onEnd && this.onEnd({})), 1500);
        break;
      }
    }
  }

  updateScore() {
    const m = this.match;
    let server = -1;
    try { const sv = m.server(); server = sv.team; } catch { /* */ }
    const pts = m.pointLabels();
    this.hud.score({ sets: m.sets, games: m.games, points: pts, server, tiebreak: m.tiebreak, golden: m.isGoldenPoint(), history: m.setScores });
    this.renderer.arena.drawScreen({ names: TEAM_COLORS.map(t => t.name), colors: TEAM_COLORS.map(t => t.css), sets: m.sets, games: m.games, points: pts });
  }

  setAiLevel(i) {
    this.settings.aiLevel = i;
    if (this.sim) this.sim.setAiLevel(i);
  }

  destroy() {
    this.ended = true;
    if (this.relay) {
      this.relay.on('msg', null);
      this.relay.on('leave', null);
      this.relay.on('close', null);
    }
  }
}
