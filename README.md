# Number Rush

A multiplayer web game where players take turns finding numbered circles in order. The server is authoritative for all game state and rules.

## What it is

Number Rush is a turn-based game where numbered circles (1..N) are scattered randomly on a board, all face down. Players must find circles in order: 1, then 2, then 3, and so on by tapping/flipping them. Correct picks let you continue, wrong picks reset and pass the turn to the next player. The first player to reveal the last number wins the round.

## Features

- **Local mode**: 1-4 players on one device, no server needed
- **Online multiplayer**: Create rooms with shareable 5-character codes, up to 4 players per room
- **Authoritative server**: All game state and rules validated server-side
- **Dark/light mode**: Respects user's color scheme preference
- **Touch and mouse support**: Large tap targets, works on mobile and desktop
- **Auto-reconnect**: Client automatically reconnects with exponential backoff
- **Pure game engine**: Testable logic separated from networking

## Game Rules

- N is chosen by the host: 3 to 20 circles
- Players: 1 to 4 per game
- Players take turns finding circles in order: 1, 2, 3, ...
- Correct pick: circle stays flipped, same player continues
- Wrong pick: wrong circle flashes red for 1.5 seconds, then all circles flip back face down, expected resets to 1, turn passes to next player (wrap around)
- Player who reveals the last number wins the round
- Per player: best streak (highest number reached in a turn) and wins across rounds in the same room
- Circle positions are randomized and non-overlapping each round, fixed during the round

## Project Structure

```
number-rush/
  package.json        (scripts: start / test / verify:leave)
  server.js           (Express + WebSocket server, game engine, leave handling)
  public/
    index.html        (Frontend UI)
    style.css         (Styles with dark/light mode)
    app.js            (Client-side logic)
  test/
    engine.test.js    (Unit tests for the game engine)
    leave.test.js     (Unit tests for leave/disconnect logic)
  scripts/
    verify-leave.js   (End-to-end WebSocket check of the leave flow)
  README.md
```

## How to Run Locally

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Start the server**

   ```bash
   npm start
   ```

3. **Open in browser**
   - Go to http://localhost:3000
   - Choose local mode or create/join online rooms

The server runs on `process.env.PORT || 3000`.

## How to Play with Friends

### On the same Wi-Fi network

1. Find your local IP: `ip addr` or `ifconfig` (e.g., 192.168.1.100)
2. Start server on one machine: `npm start`
3. Share `http://YOUR_IP:3000` with friends on the same network
4. They can create or join rooms just like on localhost

## WebSocket Message Protocol

All messages are JSON: `{ type, ...payload }`

### Client → Server

- `create_room {name}` - Create a new room, become host
- `join_room {code, name}` - Join an existing room
- `start_game {n}` - Start game with N circles (host only, lobby phase)
- `pick {n}` - Pick a circle (current player only)
- `play_again` - Return to lobby for next round (host only, after game over)
- `leave` - Leave the current room (the socket stays open and can create/join again)

### Server → Client

- `room_state { ... }` - Full snapshot broadcast after every change
- `error {message}` - Error message (invalid code, room full, room closed, etc.)

### Leaving a room

There is a single shared server function (`handleLeaveConnection`, backed by the
pure `removePlayer` helper) used by both the `leave` message and the socket
`close`/`error` events, so a deliberate leave, a tab close, a refresh and a dead
connection all behave the same way:

- **Lobby**: the player is removed and the new `room_state` is broadcast.
- **Play**: the player is removed, the turn index is fixed (the next player takes
  over, wrapping around), the sequence resets to 1, circles flip back and any
  pending wrong-pick timer is cleared. If only one player remains, the round ends
  and that player is credited the win.
- **Host leaves**: the next player in the list is promoted to host.
- **Last player leaves**: the room is deleted and its code is freed.
- It is safe to call twice (for example clicking Leave and then the socket
  closing) and never throws if the room or player is already gone.

### Room State Structure

```json
{
  "code": "ABC12",
  "phase": "lobby|play|over",
  "hostId": "player_id",
  "players": [
    {"id": "player_id", "name": "Player", "best": 0, "wins": 0, "connected": true}
  ],
  "currentPlayerIndex": 0,
  "next": 1,
  "n": 8,
  "circles": [[number, x, y, size], ...],
  "revealed": [1, 2],
  "flash": 5,
  "locked": false,
  "youId": "your_player_id"
}
```

## Validation & Security

- Only current player can make picks
- Picks ignored while locked (during wrong-pick delay)
- Already revealed circles cannot be picked again
- Names sanitized (max 12 chars, only letters, digits, spaces, \_ . -)
- Cannot join full rooms or games in progress
- Invalid room codes rejected with clear errors
- Disconnects handled: lobby players removed, play continues, host promotion, empty rooms deleted
- Ping/pong heartbeats detect dead connections
- Rooms auto-cleanup after 30 minutes of inactivity
- Rate limiting: 20 messages/second per connection, 1KB max message size
- XSS protection: names rendered with `textContent` only
- Board uses 10:7 aspect ratio with responsive scaling

## Testing

Run the unit tests (Node's built-in test runner):

```bash
npm test
```

If `node --test` misbehaves on your Node build (some Node 22 builds ship without
an internal `glob` dependency), run the files directly instead:

```bash
npm run test:files
```

Tests cover:

- Circle generation produces N unique numbers
- No overlapping circles
- Correct pick advances sequence, win detection
- Wrong pick resets and passes turn
- Turn wrap-around
- Name sanitization
- Room code generation
- Leave logic: lobby removal, host promotion, turn-index fixing (including
  wrap-around when the last player leaves), sequence reset, single-player win
  default, room deletion on last leave, and safe double-leave

End-to-end check of the leave flow over real WebSockets (spawns the server):

```bash
npm run verify:leave
```

It verifies: B leaves and A's state drops to one player; the host leaving
mid-game promotes the guest and ends the round; leave is safe to call twice; an
abrupt disconnect behaves like leave; and the same socket can create or join
another room afterwards.

### Manually test leaving with two browser tabs

1. `npm install && npm start`
2. Open http://localhost:3000 in two browser tabs.
3. Tab A: enter a name, click **Create room**, copy the code.
4. Tab B: enter a name and the code, click **Join**.
5. In the lobby, click **Leave room** in either tab — the other tab's player list
   updates immediately. Leave as the host and the other tab becomes host.
6. Start a game (host), then click **Leave** mid-game: you get the small in-page
   "Leave this game?" dialog, and the other tab keeps playing (or is declared the
   winner if it was the last player).

## Assumptions Made

1. **Server as single file**: All logic in `server.js` for simplicity as specified
2. **No external assets**: No CDNs or Google Fonts - uses system fonts only
3. **Plain HTML/CSS/JS**: No build step, vanilla everything as requested
4. **Express serves public/**: Static files served from `public/` directory
5. **ws for WebSocket**: Using `ws` library (standard choice)
6. **Circle positions in 1000x700 logical space**: Translated to percentages in UI for responsive scaling
7. **Container query units (cqw)**: Used for font scaling in the board
8. **Local mode reuses same rules**: Implemented independently in client for offline play
9. **Health endpoint**: Returns "ok" at `/health`
10. **Authoritative server**: Client only sends intents (`pick`, `join`, etc.), server validates everything
11. **Leaving is immediate**: the client resets its own state and returns Home without waiting for a server reply; the server broadcast only informs the players who remain
12. **"Room was closed" notice**: shown when the client is no longer in the room's player list or the server reports the room closed (for example after idle cleanup)
13. **No spectator mode yet**: joining a room whose game has already started is rejected with an error, as in the base spec
14. **Reconnect is a banner only**: the client shows "Reconnecting..." but does not silently rejoin a room it deliberately left (no stored room code)

## Verification

The implementation includes:

1. ✅ All files created per specification
2. ✅ Dependencies installed (`express`, `ws`)
3. ✅ Server starts successfully
4. ✅ Health endpoint works (`/health` returns "ok")
5. ✅ Unit tests pass for game engine logic
6. ✅ Local and online modes implemented
7. ✅ Responsive design with light/dark mode
8. ✅ Disconnect handling and heartbeats
9. ✅ Rate limiting and validation
10. ✅ README with complete documentation
