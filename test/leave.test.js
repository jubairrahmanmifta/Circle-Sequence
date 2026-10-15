const { test, describe } = require('node:test');
const assert = require('node:assert');
const { Room, removePlayer, clampIndex } = require('../server.js');

// Build a room with `count` fake players. `size`-th player (0-based) is host.
function makeRoom(count, phase = 'lobby', currentPlayerIndex = 0) {
  const room = new Room('TEST1');
  room.phase = phase;
  room.currentPlayerIndex = currentPlayerIndex;
  for (let i = 0; i < count; i++) {
    room.players.push({
      id: 'p' + i,
      ws: { fake: i },
      name: 'P' + i,
      best: 0,
      wins: 0,
      connected: true
    });
  }
  room.hostId = room.players[0] ? room.players[0].id : null;
  return room;
}

describe('Leave logic', () => {
  test('removes the player in the lobby', () => {
    const room = makeRoom(3);
    const res = removePlayer(room, 'p1');
    assert.strictEqual(res.removed, true);
    assert.strictEqual(res.deleted, false);
    assert.deepStrictEqual(room.players.map(p => p.id), ['p0', 'p2']);
  });

  test('host promotion: host leaves, next player becomes host', () => {
    const room = makeRoom(3);
    assert.strictEqual(room.hostId, 'p0');
    removePlayer(room, 'p0');
    assert.strictEqual(room.hostId, 'p1');
  });

  test('room deletion: last player leaving signals deletion', () => {
    const room = makeRoom(1);
    const res = removePlayer(room, 'p0');
    assert.strictEqual(res.removed, true);
    assert.strictEqual(res.deleted, true);
    assert.strictEqual(room.players.length, 0);
  });

  test('turn index fix: removing before the current player keeps the same player', () => {
    // P1's turn; P0 leaves -> P1 should still be the current player (index 0).
    const room = makeRoom(3, 'play', 1);
    removePlayer(room, 'p0');
    assert.deepStrictEqual(room.players.map(p => p.id), ['p1', 'p2']);
    assert.strictEqual(room.currentPlayerIndex, 0);
    assert.strictEqual(room.players[room.currentPlayerIndex].id, 'p1');
  });

  test('turn index fix: removing the current player hands the turn on', () => {
    // P1's turn; P1 leaves -> P2 should get the turn (index 1).
    const room = makeRoom(3, 'play', 1);
    removePlayer(room, 'p1');
    assert.deepStrictEqual(room.players.map(p => p.id), ['p0', 'p2']);
    assert.strictEqual(room.players[room.currentPlayerIndex].id, 'p2');
  });

  test('turn index fix: the last player leaving wraps the turn to the start', () => {
    // P2 (last) is the current player and leaves -> P0 gets the turn (wrap).
    const room = makeRoom(3, 'play', 2);
    removePlayer(room, 'p2');
    assert.deepStrictEqual(room.players.map(p => p.id), ['p0', 'p1']);
    assert.strictEqual(room.currentPlayerIndex, 0);
    assert.strictEqual(room.players[room.currentPlayerIndex].id, 'p0');
  });

  test('turn index fix: removing after the current player keeps the turn', () => {
    // P0's turn; P2 leaves -> P0 should still be the current player.
    const room = makeRoom(3, 'play', 0);
    removePlayer(room, 'p2');
    assert.strictEqual(room.players[room.currentPlayerIndex].id, 'p0');
  });

  test('play phase: removing a player resets the sequence in a 3+ player game', () => {
    const room = makeRoom(4, 'play', 2);
    room.revealed = [1, 2, 3];
    room.next = 4;
    room.flash = 7;
    room.locked = true;
    removePlayer(room, 'p0');
    assert.deepStrictEqual(room.revealed, []);
    assert.strictEqual(room.next, 1);
    assert.strictEqual(room.flash, null);
    assert.strictEqual(room.locked, false);
    assert.strictEqual(room.phase, 'play');
  });

  test('play phase: when only one player is left, the round ends and they win', () => {
    const room = makeRoom(2, 'play', 0);
    room.revealed = [1];
    room.next = 2;
    room.players[1].wins = 0;
    removePlayer(room, 'p0');
    assert.strictEqual(room.players.length, 1);
    assert.strictEqual(room.phase, 'over');
    assert.strictEqual(room.players[0].wins, 1);
    assert.strictEqual(room.currentPlayerIndex, 0);
  });

  test('lobby phase: index stays valid and phase is untouched', () => {
    const room = makeRoom(2, 'lobby', 1);
    removePlayer(room, 'p1');
    assert.strictEqual(room.phase, 'lobby');
    assert.strictEqual(room.currentPlayerIndex, 0);
  });

  test('over phase: index is clamped when the winner leaves', () => {
    const room = makeRoom(3, 'over', 2);
    removePlayer(room, 'p2');
    assert.strictEqual(room.currentPlayerIndex, 1);
  });

  test('safe to call twice / with unknown players / null room', () => {
    const room = makeRoom(2);
    const first = removePlayer(room, 'p0');
    assert.strictEqual(first.removed, true);
    // Second call with the same (already removed) player must not throw.
    const second = removePlayer(room, 'p0');
    assert.strictEqual(second.removed, false);
    assert.strictEqual(second.deleted, false);
    // Unknown player id.
    assert.strictEqual(removePlayer(room, 'nope').removed, false);
    // Socket that was never in the room.
    assert.strictEqual(removePlayer(room, { fake: 99 }).removed, false);
    // Null room.
    assert.doesNotThrow(() => removePlayer(null, 'p0'));
  });

  test('removing by socket works and clears a pending wrong-pick timeout', () => {
    const room = makeRoom(3, 'play', 0);
    // A real timer handle so clearTimeout has something to clear.
    room.wrongTimeout = setTimeout(() => {}, 10000);
    const res = removePlayer(room, room.players[0].ws);
    assert.strictEqual(res.removed, true);
    assert.strictEqual(room.wrongTimeout, null);
  });

  test('clampIndex keeps indices in range', () => {
    assert.strictEqual(clampIndex(-1, 3), 0);
    assert.strictEqual(clampIndex(0, 3), 0);
    assert.strictEqual(clampIndex(2, 3), 2);
    assert.strictEqual(clampIndex(5, 3), 2);
    assert.strictEqual(clampIndex(0, 0), 0);
  });
});