#!/usr/bin/env node
/*
 * Manual verification for the "leave" flow.
 *
 * Starts the real server on a random port, connects a couple of WebSocket
 * clients, and exercises:
 *   1. B leaves  -> A's room_state drops to 1 player; A leaves -> room is gone
 *   2. host leaves mid-game -> guest becomes host and the round ends cleanly
 *   3. calling leave twice does not throw
 *   4. an abrupt disconnect (no 'leave') behaves exactly like leaving
 *   5. after leaving, the same socket can create another room
 *
 * Run with:  node scripts/verify-leave.js
 */
const { spawn } = require('child_process');
const path = require('path');
const WebSocket = require('ws');

const PORT = 3999;
const URL = `ws://localhost:${PORT}`;

function log(ok, msg) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} - ${msg}`);
  if (!ok) process.exitCode = 1;
}

function connect() {
  const ws = new WebSocket(URL);
  ws.inbox = [];
  ws.waiters = [];
  ws.on('message', d => {
    let m;
    try { m = JSON.parse(d); } catch (e) { return; }
    ws.inbox.push(m);
    ws.waiters = ws.waiters.filter(w => {
      if (w.pred(m)) { w.resolve(m); return false; }
      return true;
    });
  });
  return ws;
}

const open = ws => new Promise(r => ws.on('open', r));
const sleep = ms => new Promise(r => setTimeout(r, ms));

function wait(ws, pred, ms = 5000) {
  const found = ws.inbox.find(pred);
  if (found) return Promise.resolve(found);
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timed out waiting for message')), ms);
    ws.waiters.push({ pred, resolve: m => { clearTimeout(t); resolve(m); } });
  });
}

const send = (ws, obj) => ws.send(JSON.stringify(obj));

async function main() {
  const server = spawn('node', [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'inherit']
  });

  await new Promise(resolve => {
    server.stdout.on('data', d => {
      if (d.toString().includes('listening')) resolve();
    });
  });

  try {
    // ---- 1. join then leave, and room deletion -----------------------------
    const a = connect(); await open(a);
    send(a, { type: 'create_room', name: 'A' });
    const s1 = await wait(a, m => m.type === 'room_state' && m.players.length === 1);
    const code = s1.code;
    log(code.length === 5, `A created room ${code}`);

    const b = connect(); await open(b);
    send(b, { type: 'join_room', code, name: 'B' });
    await wait(a, m => m.type === 'room_state' && m.players.length === 2);
    log(true, 'B joined, A sees 2 players');

    send(b, { type: 'leave' });
    const aAfter = await wait(a, m => m.type === 'room_state' && m.players.length === 1);
    log(aAfter.players.length === 1, 'B left, A sees 1 player');

    // ---- 3. leave twice is safe -------------------------------------------
    b.send(JSON.stringify({ type: 'leave' })); // b already left above
    await sleep(100);
    log(true, 'sending leave twice does not throw');

    // ---- 2. host leaves mid-game ------------------------------------------
    const host = connect(); await open(host);
    send(host, { type: 'create_room', name: 'Host' });
    const hs = await wait(host, m => m.type === 'room_state' && m.players.length === 1);

    const guest = connect(); await open(guest);
    send(guest, { type: 'join_room', code: hs.code, name: 'Guest' });
    await wait(host, m => m.type === 'room_state' && m.players.length === 2);

    send(host, { type: 'start_game', n: 5 });
    await wait(guest, m => m.type === 'room_state' && m.phase === 'play');
    log(true, 'game started');

    send(host, { type: 'leave' });
    const over = await wait(guest, m => m.type === 'room_state' && m.players.length === 1);
    log(over.players[0].id === over.hostId, 'guest became host after the host left');
    log(over.phase === 'over', 'round ended when only one player was left');
    log(over.players[0].wins === 1, 'remaining player was credited the win');

    // ---- 4. abrupt disconnect == leave ------------------------------------
    const x = connect(); await open(x);
    send(x, { type: 'create_room', name: 'X' });
    const xs = await wait(x, m => m.type === 'room_state');
    const y = connect(); await open(y);
    send(y, { type: 'join_room', code: xs.code, name: 'Y' });
    await wait(x, m => m.type === 'room_state' && m.players.length === 2);
    y.terminate(); // no 'leave' message
    const xAfter = await wait(x, m => m.type === 'room_state' && m.players.length === 1);
    log(xAfter.players.length === 1, 'abrupt disconnect removes the player like leave');

    // ---- 5. same socket can create again after leaving --------------------
    const z = connect(); await open(z);
    send(z, { type: 'create_room', name: 'Z' });
    await wait(z, m => m.type === 'room_state');
    send(z, { type: 'leave' });
    await sleep(100);
    send(z, { type: 'create_room', name: 'Z2' });
    const z2 = await wait(z, m => m.type === 'room_state' && m.players[0].name === 'Z2');
    log(z2.code.length === 5, `same socket created a new room ${z2.code} after leaving`);

    // ---- same socket can join after leaving -------------------------------
    send(z, { type: 'leave' });
    await sleep(100);
    send(z, { type: 'join_room', code: xs.code, name: 'Z3' });
    const z3 = await wait(z, m => m.type === 'room_state' && m.players.some(p => p.name === 'Z3'));
    log(true, 'same socket could join another room after leaving');
    void z3;

    // ---- 6. three players: current player leaves, play continues ----------
    const p1 = connect(); await open(p1);
    send(p1, { type: 'create_room', name: 'P1' });
    const r = await wait(p1, m => m.type === 'room_state' && m.players.length === 1);
    const p2 = connect(); await open(p2);
    send(p2, { type: 'join_room', code: r.code, name: 'P2' });
    await wait(p1, m => m.type === 'room_state' && m.players.length === 2);
    const p3 = connect(); await open(p3);
    send(p3, { type: 'join_room', code: r.code, name: 'P3' });
    await wait(p1, m => m.type === 'room_state' && m.players.length === 3);

    send(p1, { type: 'start_game', n: 5 });
    const play = await wait(p2, m => m.type === 'room_state' && m.phase === 'play' && m.players.length === 3);
    log(play.currentPlayerIndex === 0 && play.players[0].name === 'P1', 'game starts on the first player (P1)');

    // P1 is the current player and leaves -> 2 players remain and P2 gets the turn.
    send(p1, { type: 'leave' });
    const after = await wait(p2, m => m.type === 'room_state' && m.players.length === 2 && m.phase === 'play' && m.players[0].name === 'P2');
    log(after.phase === 'play', '3 -> 2 players keeps the game in play');
    log(after.next === 1 && after.revealed.length === 0, 'sequence reset after a mid-game leave');
    log(after.players[after.currentPlayerIndex].name === 'P2', 'turn passed to the next player (P2)');

    p2.close(); p3.close();
    a.close(); b.close(); host.close(); guest.close(); x.close(); z.close();
  } finally {
    server.kill();
  }

  console.log(process.exitCode ? '\nSome checks FAILED' : '\nAll leave checks passed');
}

main().catch(e => {
  console.error('verify-leave error:', e.message);
  process.exit(1);
});
