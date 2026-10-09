// Score (jeux, sets, tie-break, point d'or) et arbitrage d'un échange de padel.
import { SERVICE_LINE, BALL_R, HALF_W } from './constants.js';

const LABELS = ['0', '15', '30', '40'];

export class Match {
  constructor({ gamesPerSet = 6, setsToWin = 1, golden = true } = {}) {
    this.gamesPerSet = gamesPerSet;
    this.setsToWin = setsToWin;
    this.golden = golden;
    this.points = [0, 0];
    this.games = [0, 0];
    this.sets = [0, 0];
    this.setScores = [];
    this.tiebreak = false;
    this.serveTeam = 0;
    this.nextServer = [0, 0];
    this.serverSlot = 0;
    this.tbOrder = null;
    this.over = false;
    this.winner = -1;
  }

  pointsPlayed() {
    return this.points[0] + this.points[1];
  }

  server() {
    if (this.tiebreak) {
      const p = this.pointsPlayed();
      const idx = p === 0 ? 0 : (1 + Math.floor((p - 1) / 2)) % 4;
      return this.tbOrder[idx];
    }
    return { team: this.serveTeam, slot: this.serverSlot };
  }

  // 'right' = côté droit (égalité), 'left' = côté gauche (avantage)
  serveSide() {
    return this.pointsPlayed() % 2 === 0 ? 'right' : 'left';
  }

  isGoldenPoint() {
    return !this.tiebreak && this.golden && this.points[0] === 3 && this.points[1] === 3;
  }

  isBreakOrSetPoint(team) {
    // Renvoie 'match', 'set', 'game' ou null si l'équipe gagne le jeu au prochain point
    const o = 1 - team;
    let winsGame;
    if (this.tiebreak) winsGame = this.points[team] >= 6 && this.points[team] - this.points[o] >= 1;
    else if (this.golden) winsGame = this.points[team] === 3;
    else winsGame = this.points[team] >= 3 && this.points[team] - this.points[o] >= 1;
    if (!winsGame) return null;
    const g = this.games[team] + 1;
    const winsSet = this.tiebreak || (g >= this.gamesPerSet && g - this.games[o] >= 2);
    if (!winsSet) return 'game';
    if (this.sets[team] + 1 >= this.setsToWin) return 'match';
    return 'set';
  }

  pointLabels() {
    if (this.tiebreak) return [String(this.points[0]), String(this.points[1])];
    const [a, b] = this.points;
    if (a >= 3 && b >= 3 && !this.golden) {
      if (a === b) return ['40', '40'];
      return a > b ? ['AV', '40'] : ['40', 'AV'];
    }
    return [LABELS[Math.min(a, 3)], LABELS[Math.min(b, 3)]];
  }

  pointWon(team) {
    if (this.over) return { kind: 'over' };
    const o = 1 - team;
    this.points[team]++;
    const p = this.points;
    let gameWon = false;
    if (this.tiebreak) {
      gameWon = p[team] >= 7 && p[team] - p[o] >= 2;
    } else if (this.golden) {
      gameWon = p[team] >= 4;
    } else {
      gameWon = p[team] >= 4 && p[team] - p[o] >= 2;
      if (!gameWon && p[0] >= 4 && p[1] >= 4 && p[0] === p[1]) { p[0] = 3; p[1] = 3; }
    }
    if (!gameWon) return { kind: 'point' };
    return this._gameWon(team);
  }

  _gameWon(team) {
    const o = 1 - team;
    const wasTb = this.tiebreak;
    this.games[team]++;
    this.points = [0, 0];
    const g = this.games;
    const n = this.gamesPerSet;
    let setWon = false;
    if (wasTb) setWon = true;
    else if (g[team] >= n && g[team] - g[o] >= 2) setWon = true;

    // Rotation du service
    if (wasTb) {
      const first = this.tbOrder[0];
      this.nextServer[first.team] ^= 1;
      this.serveTeam = 1 - first.team;
      this.serverSlot = this.nextServer[this.serveTeam];
      this.tiebreak = false;
      this.tbOrder = null;
    } else {
      this.nextServer[this.serveTeam] ^= 1;
      this.serveTeam ^= 1;
      this.serverSlot = this.nextServer[this.serveTeam];
    }

    if (setWon) {
      this.sets[team]++;
      this.setScores.push([g[0], g[1]]);
      this.games = [0, 0];
      if (this.sets[team] >= this.setsToWin) {
        this.over = true;
        this.winner = team;
        return { kind: 'match' };
      }
      return { kind: 'set' };
    }
    if (g[0] === n && g[1] === n) {
      this.tiebreak = true;
      const st = this.serveTeam, ot = 1 - st;
      this.tbOrder = [
        { team: st, slot: this.nextServer[st] },
        { team: ot, slot: this.nextServer[ot] },
        { team: st, slot: 1 - this.nextServer[st] },
        { team: ot, slot: 1 - this.nextServer[ot] },
      ];
    }
    return { kind: 'game' };
  }

  snapshot() {
    return {
      p: this.points.slice(), g: this.games.slice(), s: this.sets.slice(), ss: this.setScores.map(a => a.slice()),
      tb: this.tiebreak, st: this.serveTeam, ns: this.nextServer.slice(), sv: this.serverSlot,
      to: this.tbOrder, ov: this.over, w: this.winner,
      gps: this.gamesPerSet, stw: this.setsToWin, gold: this.golden,
    };
  }

  static fromSnapshot(s) {
    const m = new Match({ gamesPerSet: s.gps, setsToWin: s.stw, golden: s.gold });
    m.points = s.p; m.games = s.g; m.sets = s.s; m.setScores = s.ss; m.tiebreak = s.tb;
    m.serveTeam = s.st; m.nextServer = s.ns; m.serverSlot = s.sv; m.tbOrder = s.to;
    m.over = s.ov; m.winner = s.w;
    return m;
  }
}

// Arbitre d'échange : reçoit les frappes et les événements physiques, décide de la fin du point.
export class Referee {
  constructor() {
    this.reset();
  }

  reset() {
    this.lastHitTeam = -1;
    this.lastHitter = -1;
    this.isServe = false;
    this.serveBoxSign = 0; // signe x de la boîte de service visée
    this.crossed = false;
    this.valid = false; // la balle a rebondi dans le camp adverse
    this.touchedNet = false;
    this.hits = 0;
    this.result = null;
  }

  // Le côté (signe z) de l'équipe qui a frappé
  hitterSide() {
    return this.lastHitTeam === 0 ? 1 : -1;
  }

  onHit(player, isServe, serveBoxSign = 0) {
    this.lastHitTeam = player.team;
    this.lastHitter = player.id;
    this.isServe = isServe;
    this.serveBoxSign = serveBoxSign;
    this.crossed = false;
    this.valid = false;
    this.touchedNet = false;
    this.hits++;
  }

  _end(winner, reason, extra = {}) {
    if (!this.result) this.result = { winner, reason, ...extra };
    return this.result;
  }

  // Renvoie un résultat de point, 'fault', 'let' ou null
  onEvent(ev) {
    if (this.result || this.lastHitTeam < 0) return null;
    const hitter = this.lastHitTeam;
    const opp = 1 - hitter;
    const hs = this.hitterSide();
    switch (ev.type) {
      case 'cross': {
        if (ev.from === hs) {
          if (!this.valid) this.crossed = true;
        } else if (this.valid) {
          // Revenue seule dans le camp du frappeur après rebond : point au frappeur
          return this._end(hitter, 'back');
        }
        return null;
      }
      case 'net':
      case 'netcord':
        this.touchedNet = true;
        return null;
      case 'floor': {
        const side = ev.z > 0 ? 1 : -1;
        if (!this.crossed || side === hs) {
          if (this.isServe) return this._serveFault(this.touchedNet ? 'net' : 'fault');
          return this._end(opp, this.touchedNet ? 'net' : 'ownfloor');
        }
        if (!this.valid) {
          this.valid = true;
          if (this.isServe) {
            const inBox = Math.abs(ev.z) <= SERVICE_LINE + BALL_R
              && ev.x * this.serveBoxSign >= -BALL_R && Math.abs(ev.x) <= HALF_W;
            if (!inBox) return this._serveFault('fault');
            if (this.touchedNet) return this._let();
          }
          return null;
        }
        return this._end(hitter, 'double');
      }
      case 'glass':
      case 'mesh': {
        const wallSide = ev.z > 0 ? 1 : -1;
        if (!this.valid) {
          if (!this.crossed && wallSide === hs && !this.isServe) return null; // contre-vitre autorisée
          if (this.isServe) return this._serveFault('fault');
          return this._end(opp, 'wall');
        }
        if (this.isServe && ev.type === 'mesh') return this._serveFault('mesh');
        return null;
      }
      case 'out': {
        if (this.valid) return this._end(hitter, ev.wall === 'back' ? 'por4' : 'por3');
        if (this.isServe) return this._serveFault('fault');
        return this._end(opp, 'out');
      }
      default:
        return null;
    }
  }

  onBodyHit(player) {
    if (this.result || this.lastHitTeam < 0) return null;
    const hitter = this.lastHitTeam;
    if (player.team === hitter) {
      if (this.isServe) return this._serveFault('body');
      return this._end(1 - hitter, 'bodyown', { player: player.id });
    }
    return this._end(hitter, 'body', { player: player.id });
  }

  _serveFault(reason) {
    return this._end(-1, 'serveFault', { fault: reason });
  }

  _let() {
    return this._end(-1, 'let');
  }
}
