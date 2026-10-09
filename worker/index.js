// Worker Cloudflare : sert le jeu (assets statiques) et relaie le multijoueur.
// Chaque salle est un Durable Object qui fait suivre les messages WebSocket entre 4 joueurs max.
import { DurableObject } from 'cloudflare:workers';

const MAX_PLAYERS = 4;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/ws\/([A-Za-z0-9]{4,8})$/);
    if (m) {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('WebSocket attendu', { status: 426 });
      }
      const id = env.ROOMS.idFromName(m[1].toUpperCase());
      return env.ROOMS.get(id).fetch(request);
    }
    if (url.pathname === '/api/health') {
      return Response.json({ ok: true, game: 'superpadel' }, { headers: { 'Access-Control-Allow-Origin': '*' } });
    }
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Super Padel relay', { status: 200 });
  },
};

export class Room extends DurableObject {
  peers() {
    const out = [];
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (a) out.push({ ws, ...a });
    }
    return out;
  }

  hostId(peers) {
    let h = null;
    for (const p of peers) if (h === null || p.id < h) h = p.id;
    return h;
  }

  broadcast(msg, except) {
    const s = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      try { ws.send(s); } catch { /* socket fermée */ }
    }
  }

  async fetch(request) {
    const url = new URL(request.url);
    const name = (url.searchParams.get('name') || 'Joueur').replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 14) || 'Joueur';
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    const others = this.peers().filter(p => p.ws !== server);
    if (others.length >= MAX_PLAYERS) {
      server.send(JSON.stringify({ sys: 'error', reason: 'full' }));
      server.close(4000, 'full');
      return new Response(null, { status: 101, webSocket: client });
    }
    const id = others.reduce((m, p) => Math.max(m, p.id), 0) + 1;
    server.serializeAttachment({ id, name });
    const all = [...others.map(p => ({ id: p.id, name: p.name })), { id, name }];
    const host = this.hostId(all);
    server.send(JSON.stringify({ sys: 'welcome', id, host, peers: all }));
    this.broadcast({ sys: 'join', id, name, host }, server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    if (typeof message !== 'string' || message.length > 32768) return;
    const me = ws.deserializeAttachment();
    if (!me) return;
    let env;
    try { env = JSON.parse(message); } catch { return; }
    if (env.ping) {
      ws.send(JSON.stringify({ sys: 'pong', t: env.ping }));
      return;
    }
    const out = JSON.stringify({ from: me.id, d: env.d });
    for (const o of this.ctx.getWebSockets()) {
      if (o === ws) continue;
      if (env.to != null) {
        const a = o.deserializeAttachment();
        if (!a || a.id !== env.to) continue;
      }
      try { o.send(out); } catch { /* ignore */ }
    }
  }

  async webSocketClose(ws) {
    this.leave(ws);
  }

  async webSocketError(ws) {
    this.leave(ws);
  }

  leave(ws) {
    const me = ws.deserializeAttachment();
    if (!me) return;
    ws.serializeAttachment(null);
    try { ws.close(1000, 'bye'); } catch { /* déjà fermée */ }
    const rest = this.peers().filter(p => p.ws !== ws);
    this.broadcast({ sys: 'leave', id: me.id, host: this.hostId(rest) }, ws);
  }
}
