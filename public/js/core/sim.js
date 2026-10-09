// Simulation complète d'un match : joueurs, service, échange, score.
// Indépendante du rendu : tourne dans le navigateur (hôte) et dans Node (tests).
import {
  SIM_DT, BALL_SUBSTEPS, PLAYER_SPEED, PLAYER_ACCEL, REACH, MAX_HIT_H, SMASH_HIT_H,
  teamSide, teamRight, clamp, mulberry32, HALF_W,
} from './constants.js';
import { makeBall, stepBall, predictBall } from './physics.js';
import { Match, Referee } from './rules.js';
import { computeShot, shotKind } from './shots.js';
import { AIBrain, bestIntercept } from './ai.js';

const BALL_DT = SIM_DT / BALL_SUBSTEPS;

function makePlayer(id, cfg) {
  const team = id < 2 ? 0 : 1;
  return {
    id, team, slot: id % 2,
    name: cfg.name || 'Joueur', char: cfg.char ?? id, ctrl: cfg.ctrl || 'ai', peer: cfg.peer || null,
    x: 0, z: teamSide(team) * 8, vx: 0, vz: 0, jump: 0,
    face: team === 0 ? Math.PI : 0,
    wantX: 0, wantZ: 0, aimX: 0, aimZ: 0, held: false,
    armed: null, armT: 0, holdT: 0,
    swing: null, lastHitT: -10, zone: 1, speedMul: 1,
    mood: null, aiNotBefore: 0, aiPower: 0.5, aiTarget: null,
    prevBallDist: 99, assist: true,
  };
}

export class Sim {
  constructor(opts = {}) {
    this.opts = opts;
    this.time = 0;
    this.rng = mulberry32(opts.seed ?? (Math.random() * 1e9) | 0);
    this.ball = makeBall();
    this.ball.seed = (this.rng() * 1e9) | 0;
    this.ballVisible = false;
    this.match = new Match(opts.match || {});
    this.ref = new Referee();
    const cfgs = opts.players || [{}, {}, {}, {}];
    this.players = cfgs.map((c, i) => makePlayer(i, c));
    this.events = [];
    this.phase = 'intro';
    this.phaseT = 0;
    this.epoch = 0;
    this.epochTime = 0;
    this.pred = null;
    this.claims = [null, null];
    this.teamAttack = [false, false];
    this.faults = 0;
    this.serve = null;
    this.lastResult = null;
    this.stallT = 0;
    this.stats = { points: 0, rallyHits: 0, totalHits: 0, reasons: {} };
    this.brains = this.players.map(p => (p.ctrl === 'ai' ? new AIBrain(this, p, opts.aiLevel ?? 2) : null));
    this.setupPoint();
    this.phase = 'intro';
    this.phaseT = 0;
  }

  emit(ev) {
    this.events.push(ev);
  }

  partnerOf(p) {
    return this.players[p.team * 2 + (1 - p.slot)];
  }

  setAiLevel(i) {
    for (const b of this.brains) if (b) b.setLevel(i);
  }

  // ---------- Mise en place d'un point ----------
  setupPoint() {
    const m = this.match;
    const sv = m.server();
    const side = m.serveSide();
    const st = sv.team, rt = 1 - st;
    const sxs = (side === 'right' ? 1 : -1) * teamRight(st);
    const server = this.players[st * 2 + sv.slot];
    const sPartner = this.players[st * 2 + (1 - sv.slot)];
    const recvSlot = side === 'right' ? 0 : 1;
    const receiver = this.players[rt * 2 + recvSlot];
    const rPartner = this.players[rt * 2 + (1 - recvSlot)];
    const place = (p, x, z) => {
      p.x = x; p.z = z; p.vx = 0; p.vz = 0; p.jump = 0;
      p.armed = null; p.swing = null; p.mood = null; p.holdT = 0;
      p.face = p.team === 0 ? Math.PI : 0;
      p.zone = Math.sign(x) || 1;
      p.aiNotBefore = 0;
    };
    place(server, sxs * 1.5, teamSide(st) * 8.4);
    place(sPartner, -sxs * 2.4, teamSide(st) * 3.4);
    place(receiver, -sxs * 2.5, teamSide(rt) * 8.9);
    place(rPartner, sxs * 2.3, teamSide(rt) * 6.6);
    this.ref.reset();
    this.serve = { id: server.id, state: 'ready', boxSign: -sxs, sideSign: sxs, t: this.time };
    this.ballVisible = true;
    this.attachBallToServer();
    this.pred = null;
    this.claims = [null, null];
    this.teamAttack = [false, false];
    this.teamAttack[st] = false;
    this.phase = 'serve';
    this.phaseT = 0;
    this.stallT = 0;
    this.rallyHits = 0;
    for (const b of this.brains) if (b) { b.plan = null; b.planEpoch = -1; b.serveAt = -1; }
    this.emit({ type: 'setup', server: server.id, side, faults: this.faults });
  }

  attachBallToServer() {
    const s = this.players[this.serve.id];
    const b = this.ball;
    const r = teamRight(s.team);
    b.x = s.x + r * 0.32; b.y = 0.95; b.z = s.z - teamSide(s.team) * 0.25;
    b.vx = b.vy = b.vz = 0; b.top = b.side = 0;
    b.outside = false; b.rolling = false;
  }

  startServe(p, button, power, aimX, aimZ) {
    const sv = this.serve;
    if (this.phase !== 'serve' || !sv || sv.id !== p.id || sv.state !== 'ready') return false;
    sv.state = 'toss';
    sv.button = button;
    sv.power = power;
    sv.aimX = aimX; sv.aimZ = aimZ;
    sv.t = this.time;
    p.swing = { kind: 'serve', t0: this.time };
    this.attachBallToServer();
    this.ball.vy = -0.5;
    this.emit({ type: 'toss', id: p.id });
    return true;
  }

  // ---------- Boucle ----------
  tick() {
    const dt = SIM_DT;
    this.time += dt;
    this.phaseT += dt;

    for (const b of this.brains) if (b) b.update(dt);

    for (const p of this.players) this.updatePlayer(p, dt);

    if (this.phase === 'intro') {
      if (this.phaseT > (this.opts.introTime ?? 1.5)) { this.phase = 'serve'; this.phaseT = 0; }
      return;
    }

    if (this.phase === 'serve') {
      this.updateServeState(dt);
    }

    if (this.phase === 'rally' || this.phase === 'pointEnd' || this.phase === 'fault' || (this.phase === 'serve' && this.serve.state === 'toss')) {
      for (let i = 0; i < BALL_SUBSTEPS; i++) {
        const evs = [];
        stepBall(this.ball, BALL_DT, evs);
        for (const ev of evs) this.handleBallEvent(ev);
      }
    }

    if (this.phase === 'serve' && this.serve.state === 'toss') {
      const b = this.ball;
      const s = this.players[this.serve.id];
      if (this.time - this.serve.t > 0.3 && b.vy < 0 && b.y < 0.78) this.doServeHit(s);
    }

    if (this.phase === 'rally') {
      this.checkContacts();
      this.checkBodies();
      this.checkStall(dt);
    }

    if (this.phase === 'pointEnd' && this.phaseT > 2.6) {
      if (this.match.over) {
        this.phase = 'matchEnd';
        this.phaseT = 0;
        this.emit({ type: 'matchEnd', winner: this.match.winner });
      } else {
        this.faults = 0;
        this.setupPoint();
      }
    }
    if (this.phase === 'fault' && this.phaseT > 1.3) {
      this.setupPoint();
    }
  }

  updateServeState() {
    const sv = this.serve;
    if (sv.state === 'ready') {
      const s = this.players[sv.id];
      // le serveur reste derrière la ligne de service, de son côté
      const ts = teamSide(s.team);
      s.z = ts > 0 ? clamp(s.z, 7.2, 9.6) : clamp(s.z, -9.6, -7.2);
      const xs = sv.sideSign;
      s.x = xs > 0 ? clamp(s.x, 0.3, 4.5) : clamp(s.x, -4.5, -0.3);
      this.attachBallToServer();
    }
  }

  doServeHit(s) {
    const sv = this.serve;
    const b = this.ball;
    let power = sv.power;
    if (s.ctrl !== 'ai' && s.held) power = clamp(0.35 + (this.time - sv.t) * 0.9, 0, 1);
    const brain = this.brains[s.id];
    const sig = brain ? brain.errSigma(0.05) * 0.55 : 0.32 + power * power * 0.35;
    const res = computeShot({
      team: s.team, from: { x: b.x, y: b.y, z: b.z }, button: sv.button,
      aimX: sv.aimX, aimZ: sv.aimZ, power, errSigma: sig, rng: this.rng,
      serve: true, serveBoxSign: sv.boxSign,
    });
    this.applyShot(s, res, power, 'serve');
    this.ref.onHit(s, true, sv.boxSign);
    sv.state = 'done';
    this.phase = 'rally';
    this.phaseT = 0;
    this.newEpoch();
  }

  applyShot(p, res, power, anim) {
    const b = this.ball;
    b.vx = res.vx; b.vy = res.vy; b.vz = res.vz;
    b.top = res.top; b.side = res.side;
    b.rolling = false;
    b.kick = !!res.kick;
    p.lastHitT = this.time;
    for (const q of this.players) if (q.team === p.team) { q.armed = null; q.holdT = 0; }
    p.swing = { kind: anim, t0: this.time };
    const speed = Math.hypot(res.vx, res.vy, res.vz);
    this.stats.totalHits++;
    this.rallyHits = (this.rallyHits || 0) + 1;
    this.emit({ type: 'hit', id: p.id, kind: res.kind, anim, power, speed, kick: !!res.kick, x: b.x, y: b.y, z: b.z });
  }

  newEpoch() {
    this.epoch++;
    this.epochTime = this.time;
    this.computePrediction();
  }

  computePrediction() {
    const { samples, events } = predictBall(this.ball, 4.2, BALL_DT, 4);
    // Rejoue l'arbitrage sur la trajectoire prédite
    const r = new Referee();
    Object.assign(r, {
      lastHitTeam: this.ref.lastHitTeam, lastHitter: this.ref.lastHitter, isServe: this.ref.isServe,
      serveBoxSign: this.ref.serveBoxSign, crossed: this.ref.crossed, valid: this.ref.valid,
      touchedNet: this.ref.touchedNet, result: null,
    });
    let deadT = 4.2, validT = r.valid ? 0 : Infinity, hitterFault = false, landD = 0;
    for (const e of events) {
      const wasValid = r.valid;
      const res = r.onEvent(e);
      if (!wasValid && r.valid) { validT = e.t; landD = Math.abs(e.z); }
      if (res) {
        deadT = e.t;
        hitterFault = res.winner !== this.ref.lastHitTeam;
        break;
      }
    }
    let apex = 0;
    for (const s of samples) { if (s.t > validT) break; apex = Math.max(apex, s.y); }
    this.pred = { t0: this.time, samples, deadT, validT, hitterFault, isServe: this.ref.isServe, landD, apex, epoch: this.epoch };
  }

  // ---------- Joueurs ----------
  updatePlayer(p, dt) {
    if (p.swing && this.time - p.swing.t0 > 0.6) p.swing = null;
    if (p.jump > 0) p.jump = Math.max(0, p.jump - dt * 0.8);
    if (p.ctrl === 'remote') return; // position fournie par le réseau

    if (p.armed && p.held) p.holdT += dt;

    let wx = p.wantX, wz = p.wantZ;
    if (this.phase === 'pointEnd' || this.phase === 'matchEnd' || this.phase === 'fault' || this.phase === 'intro') {
      if (p.ctrl === 'ai') { wx = 0; wz = 0; }
    }
    // Aide au placement pour les humains qui ont armé un coup
    if (p.ctrl === 'local' && p.armed && p.assist && this.phase === 'rally' && this.pred) {
      const it = bestIntercept(this, p, 1, 0);
      if (it && it.margin > -0.4) {
        const dx = it.stand.x - p.x, dz = it.stand.z - p.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.12 && d < 3.2) {
          const k = Math.min(1, d * 1.5) * 0.7;
          wx += dx / d * k; wz += dz / d * k;
        }
      }
    }
    const mag = Math.hypot(wx, wz);
    if (mag > 1) { wx /= mag; wz /= mag; }
    let maxS = PLAYER_SPEED * p.speedMul;
    if (p.armed && p.held && p.ctrl === 'local') maxS *= 0.7;
    if (p.swing && this.time - p.swing.t0 < 0.3) maxS *= 0.4;
    if (this.phase === 'serve' && this.serve && this.serve.id === p.id && this.serve.state === 'toss') maxS = 0;
    const tvx = wx * maxS, tvz = wz * maxS;
    const acc = PLAYER_ACCEL * dt;
    p.vx += clamp(tvx - p.vx, -acc, acc);
    p.vz += clamp(tvz - p.vz, -acc, acc);
    p.x += p.vx * dt;
    p.z += p.vz * dt;
    const ts = teamSide(p.team);
    p.x = clamp(p.x, -4.75, 4.75);
    p.z = ts > 0 ? clamp(p.z, 0.35, 9.75) : clamp(p.z, -9.75, -0.35);
    // séparation des coéquipiers
    const o = this.partnerOf(p);
    const dx = p.x - o.x, dz = p.z - o.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.75 && d > 1e-4) {
      const push = (0.75 - d) * 0.5;
      p.x += dx / d * push; p.z += dz / d * push;
    }
    this.updateFacing(p, dt);
  }

  updateFacing(p, dt) {
    const base = p.team === 0 ? Math.PI : 0;
    let target = base;
    const sp = Math.hypot(p.vx, p.vz);
    if (sp > 2.5 && !p.armed) {
      const moveAng = Math.atan2(p.vx, p.vz);
      let diff = moveAng - base;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      target = base + clamp(diff, -1.1, 1.1) * Math.min(1, (sp - 2.5) / 2);
    }
    let diff = target - p.face;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    p.face += diff * Math.min(1, dt * 10);
  }

  // Un joueur (humain local) appuie sur un bouton de coup
  pressShot(p, button) {
    if (this.phase === 'serve' && this.serve && this.serve.id === p.id) {
      return this.startServe(p, button, 0.6, p.aimX, p.aimZ);
    }
    if (this.phase !== 'rally') return false;
    if (!p.armed) { p.holdT = 0; p.armT = this.time; }
    p.armed = button;
    return true;
  }

  canHit(p, ignoreGate = false) {
    const ref = this.ref;
    if (ref.result || ref.lastHitTeam < 0 || ref.lastHitTeam === p.team) return false;
    const b = this.ball;
    if (b.z * teamSide(p.team) < 0.05) return false;
    if (ref.isServe && !ref.valid) return false;
    if (this.time - p.lastHitT < 0.3) return false;
    if (p.ctrl === 'ai' && !ignoreGate && this.time < p.aiNotBefore) return false;
    return true;
  }

  checkContacts() {
    const b = this.ball;
    for (const p of this.players) {
      if (p.ctrl === 'remote') continue;
      const dist = Math.hypot(b.x - p.x, b.z - p.z);
      const prev = p.prevBallDist;
      p.prevBallDist = dist;
      if (!p.armed || !this.canHit(p)) continue;
      const maxH = p.armed === 'drive' ? SMASH_HIT_H : MAX_HIT_H;
      if (dist > REACH || b.y > maxH || b.y < 0.04) continue;
      const leaving = dist > prev + 1e-4;
      const dying = b.vy < 0 && b.y < 0.2 && this.ref.valid;
      if (dist < 0.72 || leaving || dying) {
        this.doHit(p);
        return;
      }
    }
  }

  doHit(p) {
    const b = this.ball;
    const ref = this.ref;
    const overhead = b.y > 1.75;
    const volley = !ref.valid;
    const lat = (b.x - p.x) * teamRight(p.team);
    const anim = overhead ? 'oh' : lat >= 0 ? 'fh' : 'bh';
    const brain = this.brains[p.id];
    let power, sig, target = null;
    const incoming = Math.hypot(b.vx, b.vy, b.vz);
    const dist = Math.hypot(b.x - p.x, b.z - p.z);
    let difficulty = 0;
    if (b.y < 0.4 && !overhead) difficulty += 0.4;
    if (dist > 0.95) difficulty += 0.3;
    if (incoming > 14) difficulty += (incoming - 14) * 0.05;
    if (Math.abs(b.z) > 9.1) difficulty += 0.25;
    if (overhead && Math.abs(b.z) > 7) difficulty += 0.3;
    if (volley && incoming > 12) difficulty += 0.15;
    const run = Math.hypot(p.vx, p.vz) / PLAYER_SPEED;
    if (brain) {
      power = p.aiPower;
      target = p.aiTarget;
      sig = brain.errSigma(difficulty + run * 0.2) * (0.7 + power * power * 0.6);
    } else {
      power = clamp(p.holdT / 0.65, 0.15, 1);
      const prep = this.time - p.armT;
      if (prep < 0.12) difficulty += 0.35;
      difficulty += run * 0.3;
      sig = (this.opts.humanErr ?? 0.3) * (0.6 + difficulty) + power * power * 0.45;
    }
    const button = p.armed;
    const res = computeShot({
      team: p.team, from: { x: b.x, y: b.y, z: b.z }, button,
      aimX: p.aimX, aimZ: p.aimZ, power, errSigma: sig, rng: this.rng,
      overhead, volley, target,
    });
    if (overhead) p.jump = 0.3;
    if (res.kind === 'smash' && power >= 0.8 && Math.abs(b.z) < 6.5 && b.y > 2.1) {
      const good = brain ? this.rng() < brain.L.smash * 0.6 : (this.time - p.armT) > 0.3 && this.rng() < 0.75;
      if (good) res.kick = true;
    }
    this.applyShot(p, res, power, anim);
    ref.onHit(p, false);
    this.updateAttack(p, res, b);
    this.newEpoch();
  }

  // Appliquer un coup calculé par un client distant (autorité du client sur ses frappes)
  applyRemoteHit(p, msg) {
    if (this.phase !== 'rally') return false;
    const ref = this.ref;
    if (ref.result || ref.lastHitTeam < 0 || ref.lastHitTeam === p.team) return false;
    if (ref.isServe && !ref.valid) return false;
    const b = this.ball;
    const dErr = Math.hypot(b.x - msg.bx, b.z - msg.bz);
    if (dErr > 4) return false;
    b.x = msg.bx; b.y = msg.by; b.z = msg.bz;
    b.outside = false;
    const res = { vx: msg.vx, vy: msg.vy, vz: msg.vz, top: msg.top, side: msg.side, kind: msg.kind, kick: !!msg.kick, target: msg.target || { x: 0, z: 0 } };
    this.applyShot(p, res, msg.power, msg.anim);
    ref.onHit(p, false);
    this.updateAttack(p, res, b);
    // rattrape la latence
    const lag = clamp(msg.lag || 0, 0, 0.2);
    const n = Math.round(lag / BALL_DT);
    for (let i = 0; i < n; i++) {
      const evs = [];
      stepBall(b, BALL_DT, evs);
      for (const ev of evs) this.handleBallEvent(ev);
    }
    this.newEpoch();
    return true;
  }

  updateAttack(p, res, b) {
    const t = p.team;
    const d = Math.abs(res.target.z);
    const k = res.kind;
    if (k === 'lob' || k === 'volleyLob') {
      this.teamAttack[t] = d > 7.6;
      if (d > 7.6) this.teamAttack[1 - t] = false;
    } else if (k === 'smash' || k === 'bandeja' || k === 'vibora' || k.startsWith('volley')) {
      this.teamAttack[t] = true;
    } else {
      this.teamAttack[t] = Math.abs(b.z) < 6;
    }
  }

  checkBodies() {
    const b = this.ball;
    const ref = this.ref;
    if (ref.result || ref.lastHitTeam < 0) return;
    const sp = Math.hypot(b.vx, b.vy, b.vz);
    if (sp < 3 || b.y > 1.35 || b.y < 0.08) return;
    for (const p of this.players) {
      if (this.time - p.lastHitT < 0.35) continue;
      if (Math.hypot(b.x - p.x, b.z - p.z) < 0.22) {
        // Un joueur qui peut jouer la balle la frappe plutôt que de la recevoir
        if (p.ctrl === 'ai' && this.canHit(p, true) && b.y < MAX_HIT_H) {
          if (!p.armed) this.brains[p.id].arm();
          this.doHit(p);
          return;
        }
        if (p.ctrl === 'local' && p.armed && this.canHit(p)) { this.doHit(p); return; }
        if (p.ctrl === 'remote') continue; // le client distant décide de ses frappes
        const r = ref.onBodyHit(p);
        if (r) this.resolve(r);
        return;
      }
    }
  }

  checkStall(dt) {
    const b = this.ball;
    if (b.rolling || Math.hypot(b.vx, b.vy, b.vz) < 0.5) this.stallT += dt;
    else this.stallT = 0;
    if (this.stallT > 1.2 && !this.ref.result) {
      const ref = this.ref;
      const r = ref._end(ref.valid ? ref.lastHitTeam : 1 - ref.lastHitTeam, ref.valid ? 'double' : 'ownfloor');
      this.resolve(r);
    }
  }

  handleBallEvent(ev) {
    this.emit({ type: 'ball', ev });
    if (this.phase !== 'rally') return;
    const r = this.ref.onEvent(ev);
    if (r) this.resolve(r);
  }

  resolve(r) {
    if (this.phase !== 'rally') return;
    this.lastResult = r;
    this.stats.reasons[r.reason === 'serveFault' ? 'fault:' + r.fault : r.reason] = (this.stats.reasons[r.reason === 'serveFault' ? 'fault:' + r.fault : r.reason] || 0) + 1;
    for (const p of this.players) p.armed = null;
    if (r.reason === 'let') {
      this.phase = 'fault';
      this.phaseT = 0;
      this.emit({ type: 'let' });
      return;
    }
    if (r.reason === 'serveFault') {
      this.faults++;
      if (this.faults < 2) {
        this.phase = 'fault';
        this.phaseT = 0;
        this.emit({ type: 'fault', fault: r.fault, n: this.faults });
        return;
      }
      r.winner = 1 - this.ref.lastHitTeam;
      r.reason = 'double';
      r.doubleFault = true;
    }
    const winner = r.winner;
    const before = this.match.isBreakOrSetPoint(winner);
    const goldenBefore = this.match.isGoldenPoint();
    const res = this.match.pointWon(winner);
    this.stats.points++;
    for (const p of this.players) p.mood = p.team === winner ? 'happy' : 'sad';
    this.phase = 'pointEnd';
    this.phaseT = 0;
    this.faults = 0;
    this.emit({
      type: 'point', winner, reason: r.reason, doubleFault: !!r.doubleFault, player: r.player,
      kind: res.kind, golden: goldenBefore, big: before, rally: this.rallyHits, lastHitter: this.ref.lastHitter,
    });
  }

  // État compact pour le réseau / le rendu
  snapshot() {
    const b = this.ball;
    return {
      t: this.time, ph: this.phase, pt: this.phaseT, ep: this.epoch,
      b: [b.x, b.y, b.z, b.vx, b.vy, b.vz, b.top, b.side, b.outside ? 1 : 0, b.rolling ? 1 : 0, b.seed, b.kick ? 1 : 0],
      bv: this.ballVisible ? 1 : 0,
      r: [this.ref.lastHitTeam, this.ref.isServe ? 1 : 0, this.ref.valid ? 1 : 0, this.ref.result ? 1 : 0],
      sv: this.serve ? [this.serve.id, this.serve.state === 'ready' ? 0 : this.serve.state === 'toss' ? 1 : 2] : null,
      pl: this.players.map(p => [
        +p.x.toFixed(3), +p.z.toFixed(3), +p.vx.toFixed(2), +p.vz.toFixed(2), +p.face.toFixed(3), +p.jump.toFixed(2),
        p.armed ? 1 : 0, p.swing ? p.swing.kind : 0, p.swing ? +(this.time - p.swing.t0).toFixed(3) : 0,
        p.mood ? (p.mood === 'happy' ? 1 : 2) : 0,
      ]),
    };
  }
}
