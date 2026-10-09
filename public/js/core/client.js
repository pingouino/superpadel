// Monde côté client en ligne : prédit localement son joueur et la balle,
// se recale sur les instantanés envoyés par l'hôte.
import { Sim } from './sim.js';
import { makeBall, copyBall, stepBall } from './physics.js';
import { SIM_DT, BALL_SUBSTEPS, REACH, MAX_HIT_H, SMASH_HIT_H, teamSide, teamRight, clamp, mulberry32, PLAYER_SPEED } from './constants.js';
import { computeShot } from './shots.js';
import { predictBall } from './physics.js';

const BALL_DT = SIM_DT / BALL_SUBSTEPS;

export class ClientWorld {
  constructor(slots, meId) {
    this.time = 0;
    this.meId = meId;
    this.rng = mulberry32((Math.random() * 1e9) | 0);
    this.players = slots.map((c, i) => ({
      id: i, team: i < 2 ? 0 : 1, slot: i % 2, name: c.name, char: c.char,
      ctrl: i === meId ? 'local' : 'net',
      x: 0, z: 0, vx: 0, vz: 0, face: i < 2 ? Math.PI : 0, jump: 0,
      wantX: 0, wantZ: 0, aimX: 0, aimZ: 0, held: false, armed: null, armT: 0, holdT: 0,
      swing: null, lastHitT: -10, speedMul: 1, mood: null, assist: true, prevBallDist: 99,
      tx: 0, tz: 0, tvx: 0, tvz: 0, tface: 0,
    }));
    this.me = this.players[meId];
    this.ball = makeBall();
    this.ballVisible = false;
    this.offset = { x: 0, y: 0, z: 0 };
    this.phase = 'intro';
    this.ref = { lastHitTeam: -1, isServe: false, valid: false, result: false };
    this.serve = null;
    this.epoch = 0;
    this.localValid = false;
    this.pending = null; // frappe locale en attente de confirmation
    this.pred = null;
    this.predEpoch = -1;
    this.events = [];
    this.match = null;
    this.lag = 0.05;
  }

  partnerOf(p) {
    return this.players[p.team * 2 + (1 - p.slot)];
  }

  teleport(pos) {
    this.synced = true;
    for (let i = 0; i < 4; i++) {
      const p = this.players[i];
      p.x = p.tx = pos[i][0]; p.z = p.tz = pos[i][1];
      p.vx = p.vz = 0;
      p.armed = null; p.swing = null; p.mood = null;
    }
  }

  applySnapshot(s) {
    this.phase = s.ph;
    this.serve = s.sv ? { id: s.sv[0], state: ['ready', 'toss', 'done'][s.sv[1]] } : null;
    this.ballVisible = !!s.bv;
    const pend = this.pending;
    if (pend && (s.ep > pend.epoch || this.time - pend.t > 0.7 || s.ph !== 'rally')) this.pending = null;

    if (s.ep !== this.epoch) {
      this.epoch = s.ep;
      this.localValid = false;
    }
    if (!this.pending) {
      this.ref.lastHitTeam = s.r[0];
      this.ref.isServe = !!s.r[1];
      this.ref.valid = !!s.r[2];
      this.ref.result = !!s.r[3];
    }

    if (!this.synced) {
      this.synced = true;
      this.teleport(s.pl.map(a => [a[0], a[1]]));
    }
    // autres joueurs
    for (let i = 0; i < 4; i++) {
      const p = this.players[i];
      const a = s.pl[i];
      if (i !== this.meId) {
        p.tx = a[0]; p.tz = a[1]; p.tvx = a[2]; p.tvz = a[3]; p.tface = a[4];
        p.jump = a[5];
        p.armed = a[6] ? 'drive' : null;
        if (a[7]) {
          if (!p.swing || p.swing.kind !== a[7] || Math.abs((this.time - p.swing.t0) - a[8]) > 0.25) {
            p.swing = { kind: a[7], t0: this.time - a[8] - this.lag };
          }
        } else if (p.swing && this.time - p.swing.t0 > 0.5) p.swing = null;
      }
      p.mood = a[9] === 1 ? 'happy' : a[9] === 2 ? 'sad' : null;
    }

    // balle
    if (this.pending) return;
    const b = s.b;
    const tgt = makeBall();
    tgt.x = b[0]; tgt.y = b[1]; tgt.z = b[2]; tgt.vx = b[3]; tgt.vy = b[4]; tgt.vz = b[5];
    tgt.top = b[6]; tgt.side = b[7]; tgt.outside = !!b[8]; tgt.rolling = !!b[9]; tgt.seed = b[10]; tgt.kick = !!b[11];
    const moving = s.ph === 'rally' || s.ph === 'pointEnd' || s.ph === 'fault' || (this.serve && this.serve.state === 'toss');
    if (moving) {
      const n = Math.round(clamp(this.lag, 0, 0.25) / BALL_DT);
      for (let i = 0; i < n; i++) stepBall(tgt, BALL_DT, null);
    }
    const cur = this.ball;
    const d = Math.hypot(cur.x - tgt.x, cur.y - tgt.y, cur.z - tgt.z);
    if (d > 3 || !moving) {
      this.offset.x = this.offset.y = this.offset.z = 0;
    } else {
      this.offset.x += cur.x - tgt.x; this.offset.y += cur.y - tgt.y; this.offset.z += cur.z - tgt.z;
    }
    copyBall(tgt, cur);
  }

  // Avance d'une frame (dt variable)
  update(dt, input) {
    this.time += dt;
    const me = this.me;
    // joueurs distants : lissage + extrapolation
    for (const p of this.players) {
      if (p === me) continue;
      const k = Math.min(1, dt * 14);
      p.x += (p.tx + p.tvx * 0.03 - p.x) * k;
      p.z += (p.tz + p.tvz * 0.03 - p.z) * k;
      p.vx = p.tvx; p.vz = p.tvz;
      let df = p.tface - p.face;
      df = Math.atan2(Math.sin(df), Math.cos(df));
      p.face += df * k;
      if (p.swing && this.time - p.swing.t0 > 0.6) p.swing = null;
    }

    // mon joueur
    me.wantX = input.wx; me.wantZ = input.wz;
    me.aimX = input.mx; me.aimZ = input.my; me.held = input.held;
    if (this.phase === 'serve' && this.serve && this.serve.id === me.id && this.serve.state !== 'ready') { me.wantX = 0; me.wantZ = 0; }
    this.updatePlayer(me, dt);
    if (this.phase === 'serve' && this.serve && this.serve.id === me.id && this.serve.state === 'ready') {
      const ts = teamSide(me.team);
      me.z = ts > 0 ? clamp(me.z, 7.2, 9.6) : clamp(me.z, -9.6, -7.2);
      const xs = Math.sign(me.x) || 1;
      me.x = xs > 0 ? clamp(me.x, 0.3, 4.5) : clamp(me.x, -4.5, -0.3);
    }

    // balle locale
    const moving = this.phase === 'rally' || this.phase === 'pointEnd' || this.phase === 'fault' || (this.serve && this.serve.state === 'toss');
    if (moving) {
      let steps = Math.round(dt / BALL_DT);
      steps = Math.min(steps, 16);
      for (let i = 0; i < steps; i++) {
        const evs = [];
        stepBall(this.ball, BALL_DT, evs);
        for (const e of evs) {
          this.events.push({ type: 'ball', ev: e });
          if (e.type === 'floor' && (e.z > 0 ? 0 : 1) === me.team) this.localValid = true;
        }
        if (this.phase === 'rally') this.checkMyContact();
      }
    }
    const f = Math.exp(-dt * 9);
    this.offset.x *= f; this.offset.y *= f; this.offset.z *= f;

    // prédiction pour l'aide au placement
    if (this.phase === 'rally' && this.predEpoch !== this.epoch + (this.pending ? 0.5 : 0)) {
      this.predEpoch = this.epoch + (this.pending ? 0.5 : 0);
      const { samples } = predictBall(this.ball, 3.5, BALL_DT, 4);
      this.pred = { t0: this.time, samples, deadT: 3.5, validT: this.ref.valid ? 0 : this.estimateValidT(samples), isServe: this.ref.isServe };
    }
  }

  estimateValidT(samples) {
    const myTeam = this.me.team;
    for (const s of samples) if (s.ev && s.ev.includes('floor') && (s.z > 0 ? 0 : 1) === myTeam) return s.t;
    return Infinity;
  }

  canHitLocal() {
    const me = this.me, r = this.ref;
    if (r.result || r.lastHitTeam < 0 || r.lastHitTeam === me.team) return false;
    if (this.pending) return false;
    const b = this.ball;
    if (b.z * teamSide(me.team) < 0.05) return false;
    if (r.isServe && !(r.valid || this.localValid)) return false;
    if (this.time - me.lastHitT < 0.3) return false;
    return true;
  }

  checkMyContact() {
    const me = this.me, b = this.ball;
    const dist = Math.hypot(b.x - me.x, b.z - me.z);
    const prev = me.prevBallDist;
    me.prevBallDist = dist;
    if (!me.armed || !this.canHitLocal()) return;
    const maxH = me.armed === 'drive' ? SMASH_HIT_H : MAX_HIT_H;
    if (dist > REACH || b.y > maxH || b.y < 0.04) return;
    const leaving = dist > prev + 1e-4;
    const dying = b.vy < 0 && b.y < 0.2 && (this.ref.valid || this.localValid);
    if (!(dist < 0.72 || leaving || dying)) return;

    const overhead = b.y > 1.75;
    const volley = !(this.ref.valid || this.localValid);
    const lat = (b.x - me.x) * teamRight(me.team);
    const anim = overhead ? 'oh' : lat >= 0 ? 'fh' : 'bh';
    const power = clamp(me.holdT / 0.65, 0.15, 1);
    let difficulty = 0;
    const incoming = Math.hypot(b.vx, b.vy, b.vz);
    if (b.y < 0.4 && !overhead) difficulty += 0.4;
    if (dist > 0.95) difficulty += 0.3;
    if (incoming > 14) difficulty += (incoming - 14) * 0.05;
    if (this.time - me.armT < 0.12) difficulty += 0.35;
    difficulty += Math.hypot(me.vx, me.vz) / PLAYER_SPEED * 0.3;
    const sig = (this.humanErr ?? 0.3) * (0.6 + difficulty) + power * power * 0.45;
    const from = { x: b.x, y: b.y, z: b.z };
    const res = computeShot({
      team: me.team, from, button: me.armed, aimX: me.aimX, aimZ: me.aimZ, power,
      errSigma: sig, rng: this.rng, overhead, volley,
    });
    if (res.kind === 'smash' && power >= 0.8 && Math.abs(b.z) < 6.5 && b.y > 2.1 && this.time - me.armT > 0.3 && this.rng() < 0.75) res.kick = true;
    b.vx = res.vx; b.vy = res.vy; b.vz = res.vz; b.top = res.top; b.side = res.side; b.rolling = false; b.kick = !!res.kick;
    me.armed = null; me.holdT = 0; me.lastHitT = this.time;
    me.swing = { kind: anim, t0: this.time };
    if (overhead) me.jump = 0.3;
    this.ref.lastHitTeam = me.team;
    this.pending = { epoch: this.epoch, t: this.time };
    const speed = Math.hypot(res.vx, res.vy, res.vz);
    this.events.push({ type: 'hit', id: me.id, kind: res.kind, anim, power, speed, kick: !!res.kick, x: from.x, y: from.y, z: from.z, local: true });
    this.onLocalHit && this.onLocalHit({
      k: 'hit', bx: from.x, by: from.y, bz: from.z, vx: res.vx, vy: res.vy, vz: res.vz, top: res.top, side: res.side,
      kind: res.kind, anim, power, kick: !!res.kick, target: res.target, lag: this.lag,
    });
  }

  displayBall() {
    const b = this.ball;
    return { x: b.x + this.offset.x, y: Math.max(0.03, b.y + this.offset.y), z: b.z + this.offset.z, visible: this.ballVisible, speed: Math.hypot(b.vx, b.vy, b.vz) };
  }
}

// Emprunte le déplacement des joueurs à la simulation complète
ClientWorld.prototype.updatePlayer = Sim.prototype.updatePlayer;
ClientWorld.prototype.updateFacing = Sim.prototype.updateFacing;
