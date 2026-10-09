// Client du relais WebSocket (Worker Cloudflare + Durable Object).

export function defaultServer() {
  const q = new URLSearchParams(location.search).get('server');
  if (q) return q;
  try {
    const saved = localStorage.getItem('sp.server');
    if (saved) return saved;
  } catch { /* stockage indisponible */ }
  if (location.protocol.startsWith('http') && !/^(localhost|127\.|192\.168\.)/.test(location.hostname)) return location.origin;
  if (location.protocol.startsWith('http')) return location.origin;
  return '';
}

export function randomRoomCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let s = '';
  for (let i = 0; i < 4; i++) s += A[(Math.random() * A.length) | 0];
  return s;
}

export class Relay {
  constructor() {
    this.ws = null;
    this.id = null;
    this.host = null;
    this.peers = new Map();
    this.handlers = {};
    this.rtt = 0.08;
    this.pingTimer = null;
  }

  on(ev, fn) {
    this.handlers[ev] = fn;
  }

  fire(ev, ...a) {
    if (this.handlers[ev]) this.handlers[ev](...a);
  }

  get isHost() {
    return this.id !== null && this.id === this.host;
  }

  connect(server, room, name) {
    return new Promise((resolve, reject) => {
      let base = server.trim().replace(/\/+$/, '');
      if (!/^https?:|^wss?:/.test(base)) base = 'https://' + base;
      const wsUrl = base.replace(/^http/, 'ws') + '/ws/' + encodeURIComponent(room.toUpperCase()) + '?name=' + encodeURIComponent(name);
      let ws;
      try { ws = new WebSocket(wsUrl); } catch (e) { reject(e); return; }
      this.ws = ws;
      let welcomed = false;
      const timeout = setTimeout(() => { if (!welcomed) { ws.close(); reject(new Error('Délai dépassé')); } }, 8000);
      ws.onmessage = (e) => {
        let m;
        try { m = JSON.parse(e.data); } catch { return; }
        if (m.sys) {
          if (m.sys === 'welcome') {
            welcomed = true;
            clearTimeout(timeout);
            this.id = m.id;
            this.host = m.host;
            for (const p of m.peers) this.peers.set(p.id, p);
            this.startPing();
            resolve(this);
          } else if (m.sys === 'error') {
            clearTimeout(timeout);
            reject(new Error(m.reason === 'full' ? 'Salle pleine (4 joueurs max)' : m.reason));
          } else if (m.sys === 'join') {
            this.peers.set(m.id, { id: m.id, name: m.name });
            this.fire('join', m);
          } else if (m.sys === 'leave') {
            this.peers.delete(m.id);
            const oldHost = this.host;
            this.host = m.host;
            this.fire('leave', m, oldHost === m.id);
          } else if (m.sys === 'pong') {
            const r = (performance.now() - m.t) / 1000;
            this.rtt = this.rtt * 0.8 + r * 0.2;
          }
          return;
        }
        this.fire('msg', m.from, m.d);
      };
      ws.onerror = () => { if (!welcomed) { clearTimeout(timeout); reject(new Error('Connexion impossible')); } };
      ws.onclose = () => {
        clearInterval(this.pingTimer);
        if (welcomed) this.fire('close');
      };
    });
  }

  startPing() {
    clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ ping: performance.now() }));
    }, 2000);
  }

  send(d, to = null) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(to === null ? { d } : { to, d }));
  }

  close() {
    clearInterval(this.pingTimer);
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
    }
    this.ws = null;
  }
}
