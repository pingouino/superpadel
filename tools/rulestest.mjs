// Tests des règles : score, rotation du service, arbitrage.
import assert from 'node:assert/strict';
import { Match, Referee } from '../public/js/core/rules.js';

// Point d'or
let m = new Match({ golden: true });
for (let i = 0; i < 3; i++) { m.pointWon(0); m.pointWon(1); }
assert.equal(m.isGoldenPoint(), true);
assert.deepEqual(m.pointLabels(), ['40', '40']);
assert.equal(m.pointWon(1).kind, 'game');
assert.deepEqual(m.games, [0, 1]);

// Avantages
m = new Match({ golden: false });
for (let i = 0; i < 3; i++) { m.pointWon(0); m.pointWon(1); }
m.pointWon(0);
assert.deepEqual(m.pointLabels(), ['AV', '40']);
m.pointWon(1);
assert.deepEqual(m.pointLabels(), ['40', '40']);
m.pointWon(1); assert.equal(m.pointWon(1).kind, 'game');

// Rotation du service : A1, B1, A2, B2
m = new Match({ golden: true });
const servers = [];
for (let g = 0; g < 4; g++) { servers.push(`${m.server().team}${m.server().slot}`); for (let i = 0; i < 4; i++) m.pointWon(g % 2); }
assert.deepEqual(servers, ['00', '10', '01', '11']);

// Côté de service : droite puis gauche
m = new Match();
assert.equal(m.serveSide(), 'right'); m.pointWon(0); assert.equal(m.serveSide(), 'left');

// Set 6-4, tie-break à 6-6
m = new Match({ gamesPerSet: 6 });
const winGame = t => { for (let i = 0; i < 4; i++) m.pointWon(t); };
for (let g = 0; g < 5; g++) { winGame(0); winGame(1); }
winGame(0); winGame(1);
assert.equal(m.tiebreak, true);
const tbFirst = m.server();
for (let i = 0; i < 6; i++) m.pointWon(0);
assert.equal(m.isBreakOrSetPoint(0), 'match');
assert.equal(m.pointWon(0).kind, 'match');
assert.equal(m.over, true); assert.equal(m.winner, 0);
assert.deepEqual(m.setScores, [[7, 6]]);
void tbFirst;

// Tie-break : ordre des serveurs 1, 2, 2, 2...
m = new Match({ gamesPerSet: 1 });
m.pointWon(0); m.pointWon(0); m.pointWon(0); m.pointWon(0); // 1-0
for (let i = 0; i < 4; i++) m.pointWon(1); // 1-1 -> tie-break
assert.equal(m.tiebreak, true);
const seq = [];
for (let i = 0; i < 6; i++) { seq.push(m.server().team); i % 2 ? m.pointWon(0) : m.pointWon(1); }
assert.deepEqual(seq, [seq[0], 1 - seq[0], 1 - seq[0], seq[0], seq[0], 1 - seq[0]]);

// Arbitrage
const P0 = { id: 0, team: 0 }, P2 = { id: 2, team: 1 };
let r = new Referee();
r.onHit(P0, true, -1); // service de l'équipe 0 vers la boîte x<0
r.onEvent({ type: 'cross', from: 1 });
assert.equal(r.onEvent({ type: 'floor', x: -2, z: -5 }), null);
assert.equal(r.onEvent({ type: 'mesh', x: -5, z: -3 }).fault, 'mesh');

r = new Referee(); r.onHit(P0, true, -1);
r.onEvent({ type: 'net' }); r.onEvent({ type: 'cross', from: 1 });
assert.equal(r.onEvent({ type: 'floor', x: -2, z: -5 }).reason, 'let');

r = new Referee(); r.onHit(P0, true, -1); r.onEvent({ type: 'cross', from: 1 });
assert.equal(r.onEvent({ type: 'floor', x: 2, z: -5 }).fault, 'fault'); // mauvaise boîte

r = new Referee(); r.onHit(P0, true, -1); r.onEvent({ type: 'cross', from: 1 });
assert.equal(r.onEvent({ type: 'floor', x: -2, z: -8 }).fault, 'fault'); // trop long

// Échange : vitre directe
r = new Referee(); r.onHit(P2, false); r.onEvent({ type: 'cross', from: -1 });
let res = r.onEvent({ type: 'glass', x: 0, z: 10 });
assert.deepEqual([res.winner, res.reason], [0, 'wall']);

// Contre-vitre (sa propre vitre) autorisée puis passage du filet
r = new Referee(); r.onHit(P2, false);
assert.equal(r.onEvent({ type: 'glass', x: 0, z: -10 }), null);
r.onEvent({ type: 'cross', from: -1 });
assert.equal(r.onEvent({ type: 'floor', x: 0, z: 5 }), null);
res = r.onEvent({ type: 'floor', x: 0, z: 7 });
assert.deepEqual([res.winner, res.reason], [1, 'double']);

// Por 3
r = new Referee(); r.onHit(P0, false); r.onEvent({ type: 'cross', from: 1 });
r.onEvent({ type: 'floor', x: 3, z: -4 });
res = r.onEvent({ type: 'out', wall: 'side', x: 5, z: -6 });
assert.deepEqual([res.winner, res.reason], [0, 'por3']);

// Balle dans le filet qui retombe chez le frappeur
r = new Referee(); r.onHit(P0, false); r.onEvent({ type: 'net' });
res = r.onEvent({ type: 'floor', x: 0, z: 0.2 });
assert.deepEqual([res.winner, res.reason], [1, 'net']);

// Balle qui touche un adversaire
r = new Referee(); r.onHit(P0, false);
assert.equal(r.onBodyHit(P2).winner, 0);

console.log('Règles : tous les tests passent ✓');
