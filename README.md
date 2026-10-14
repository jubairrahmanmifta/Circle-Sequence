# Circle Sequence Game

Pick a number of circles (3-20) and players (up to 4). Circles are placed randomly, face down,
each with a hidden number. Players take turns finding 1, 2, 3 ... in order. When the sequence
breaks, the wrong circle flips, the circles hide again, and the next player starts from 1.

## Files
- index.html      Full version: local play + online rooms with a code.
- local-only.html Simple version: local play on one device only. Works anywhere.

## Run
Open either file in a browser. No install or server needed.

## Important
Online rooms in index.html use the Claude artifact runtime (window.claude, "room" capability).
They only work when the page is published as a Claude artifact and opened while signed in to claude.ai.
Opened as a plain file, index.html still works for "Play on this device", but online buttons stay disabled.
For online play anywhere, you need your own backend (e.g. Node.js + WebSocket server).
