const $ = id => document.getElementById(id);
const COLORS = ['#5b5bd6', '#e5484d', '#2fa866', '#e08a00'];

let ws = null;
let reconnectAttempts = 0;
let reconnectTimer = null;
let noticeTimer = null;
let isLocal = true;
let isHost = true;
let currentRoomCode = null;
let leaving = false;

let localState = {
    phase: 'home',
    N: 8,
    players: [],
    circles: [],
    revealed: [],
    flash: null,
    cur: 0,
    next: 1,
    best: [],
    wins: [],
    locked: false,
    round: 0
};
let onlineState = null;
let onlineYouId = null;

let playerCount = 2;

// Home view
function initHome() {
    const pOpts = $('pOpts');
    pOpts.innerHTML = '';
    [1, 2, 3, 4].forEach(k => {
        const b = document.createElement('button');
        b.className = 'opt' + (k === playerCount ? ' on' : '');
        b.textContent = k + (k === 1 ? ' player' : ' players');
        b.onclick = () => {
            playerCount = k;
            [...pOpts.children].forEach((c, i) => c.classList.toggle('on', i + 1 === k));
        };
        pOpts.appendChild(b);
    });
    
    $('n').oninput = e => { $('nVal').textContent = e.target.value; };
    $('n2').oninput = e => { $('nVal2').textContent = e.target.value; };
    
    $('startLocal').onclick = startLocal;
    $('createRoom').onclick = createRoom;
    $('joinRoom').onclick = joinRoom;
    $('copyCode').onclick = copyCode;
    $('startOnline').onclick = startOnline;
    $('again').onclick = playAgain;
    $('leave1').onclick = () => handleLeaveClick();
    $('leave2').onclick = () => handleLeaveClick();
    $('confirmOk').onclick = () => { hideConfirm(); performLeave(); };
    $('confirmCancel').onclick = () => hideConfirm();
    
    $('onNote').textContent = 'Create a room or join with a code to play online.';
}

function startLocal() {
    isLocal = true;
    isHost = true;
    localState = {
        phase: 'play',
        N: parseInt($('n').value),
        players: [],
        circles: [],
        revealed: [],
        flash: null,
        cur: 0,
        next: 1,
        best: [],
        wins: [],
        locked: false,
        round: 0
    };
    
    const nick = sanitizeName($('nick').value);
    for (let i = 0; i < playerCount; i++) {
        if (playerCount === 1) {
            localState.players.push({ id: 'L' + i, name: nick || 'You', best: 0, wins: 0 });
        } else {
            if (i === 0 && nick) {
                localState.players.push({ id: 'L' + i, name: nick, best: 0, wins: 0 });
            } else {
                localState.players.push({ id: 'L' + i, name: 'Player ' + (i + 1), best: 0, wins: 0 });
            }
        }
    }
    localState.wins = Array(localState.players.length).fill(0);
    localState.best = Array(localState.players.length).fill(0);
    startLocalRound();
}

function startLocalRound() {
    localState.circles = generateCirclesLocal(localState.N);
    localState.revealed = [];
    localState.flash = null;
    localState.cur = 0;
    localState.next = 1;
    localState.locked = false;
    localState.round++;
    showView('game');
    render();
}

function generateCirclesLocal(n) {
    const W = 1000;
    const H = 700;
    let size = Math.max(60, Math.min(140, Math.floor(Math.sqrt((W * H) / n / 2.6))));
    const margin = 8;
    const positions = [];
    for (let i = 0; i < n; i++) {
        let placed = false;
        let attempts = 0;
        while (!placed) {
            const x = 6 + Math.random() * (W - size - 12);
            const y = 6 + Math.random() * (H - size - 12);
            const rx = Math.round(x);
            const ry = Math.round(y);
            const ok = positions.every(p => Math.hypot(p[0] - rx, p[1] - ry) > size + margin);
            if (ok) {
                positions.push([rx, ry]);
                placed = true;
            } else if (++attempts > 500) {
                size = Math.max(30, size - 4);
                attempts = 0;
            }
        }
    }
    const nums = shuffleArray([...Array(n)].map((_, i) => i + 1));
    return positions.map((p, i) => [nums[i], p[0], p[1], size]);
}

function shuffleArray(a) {
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function sanitizeName(name) {
    return String(name || '')
        .replace(/[^\p{L}\p{N} _.-]/gu, '')
        .trim()
        .slice(0, 12);
}

function showView(v) {
    ['home', 'lobby', 'game'].forEach(x => $(x).classList.toggle('hide', x !== v));
}

function render() {
    if (isLocal) {
        renderLocal();
        return;
    }
    renderOnline();
}

function renderLocal() {
    showView('game');
    renderPlayerBar($('players'), localState.cur, localState.phase === 'play');
    let msg = '';
    const cur = localState.players[localState.cur];
    if (!cur) return;
    if (localState.locked && localState.flash) {
        msg = cur.name + ' picked ' + localState.flash + ' but needed ' + localState.next + '. Sequence broken!';
    } else if (localState.phase === 'play') {
        msg = cur.name + ', find circle ' + localState.next;
    }
    $('msg').textContent = msg;
    renderBoardLocal();
    const ov = $('over');
    ov.classList.toggle('show', localState.phase === 'over');
    if (localState.phase === 'over') {
        $('winTxt').textContent = '🎉 ' + cur.name + ' wins!';
        $('again').classList.toggle('hide', false);
        $('overNote').textContent = 'Play again';
        $('again').onclick = () => {
            startLocalRound();
        };
    }
}

function renderPlayerBar(el, turnIdx, showTurn) {
    el.innerHTML = '';
    const players = isLocal ? localState.players : (onlineState ? onlineState.players : []);
    players.forEach((p, i) => {
        const d = document.createElement('div');
        d.className = 'pl' + (showTurn && i === turnIdx ? ' turn' : '');
        const b = document.createElement('b');
        const dot = document.createElement('i');
        dot.className = 'dot';
        dot.style.background = COLORS[i % 4];
        b.appendChild(dot);
        let nameTxt = p.name;
        if (!isLocal && onlineState && p.id === onlineYouId) {
            nameTxt += ' (you)';
        }
        if (showTurn && i === turnIdx) {
            nameTxt += ' ◀';
        }
        b.appendChild(document.createTextNode(nameTxt));
        d.appendChild(b);
        const sp = document.createElement('span');
        sp.textContent = 'Best streak: ' + (p.best || 0) + ' · Wins: ' + (p.wins || 0);
        d.appendChild(sp);
        el.appendChild(d);
    });
}

function renderBoardLocal() {
    const b = $('board');
    const key = localState.round + ':L';
    if (b.dataset.r !== key) {
        b.dataset.r = key;
        b.querySelectorAll('.c').forEach(e => e.remove());
        localState.circles.forEach(([n, x, y, s]) => {
            const d = document.createElement('div');
            d.className = 'c';
            d.dataset.n = n;
            d.style.cssText = 'left:' + (x / 10) + '%;top:' + (y / 7) + '%;width:' + (s / 10) + '%;--f:' + (s / 10 * 0.42) + 'cqw';
            d.innerHTML = '<div class="in"><div class="f"></div><div class="b">' + n + '</div></div>';
            d.onclick = () => tryPickLocal(n);
            b.appendChild(d);
        });
    }
    b.querySelectorAll('.c').forEach(d => {
        const n = parseInt(d.dataset.n);
        const w = localState.flash === n;
        const r = localState.revealed.includes(n);
        d.classList.toggle('flip', r || w);
        d.classList.toggle('wrong', w);
        d.classList.toggle('done', r);
    });
}

function tryPickLocal(n) {
    if (localState.phase !== 'play' || localState.locked) return;
    if (localState.revealed.includes(n)) return;
    applyPickLocal(n);
}

function applyPickLocal(n) {
    if (n === localState.next) {
        localState.revealed.push(n);
        localState.best[localState.cur] = Math.max(localState.best[localState.cur] || 0, n);
        localState.next++;
        if (localState.next > localState.N) {
            localState.wins[localState.cur] = (localState.wins[localState.cur] || 0) + 1;
            localState.phase = 'over';
            localState.locked = false;
            render();
            return;
        }
    } else {
        localState.flash = n;
        localState.locked = true;
        setTimeout(() => {
            localState.revealed = [];
            localState.flash = null;
            localState.next = 1;
            localState.cur = (localState.cur + 1) % localState.players.length;
            localState.locked = false;
            render();
        }, 1500);
    }
    render();
}

// Online functions
function sendOnline(type, payload) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type, ...(payload || {}) }));
    }
}

// Host starts a round from the lobby.
function startOnline() {
    sendOnline('start_game', { n: parseInt($('n2').value) });
}

// Host returns everyone to the lobby after a win.
function playAgain() {
    sendOnline('play_again');
}

function createRoom() {
    const nick = sanitizeName($('nick').value);
    isLocal = false;
    isHost = true;
    onlineState = null;
    onlineYouId = null;
    reconnectAttempts = 0;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    hideReconnectBanner();
    hideNoticeBanner();
    leaving = false;
    ws = new WebSocket(getWebSocketUrl());
    ws.onopen = () => {
        reconnectAttempts = 0;
        hideReconnectBanner();
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'create_room',
                name: nick || 'Player'
            }));
        }
    };
    ws.onmessage = handleMessage;
    ws.onclose = handleDisconnect;
    ws.onerror = handleDisconnect;
}

function joinRoom() {
    const code = $('codeIn').value.toUpperCase().trim();
    const nick = sanitizeName($('nick').value);
    if (!code || code.length < 5) {
        alert('Please enter a valid room code');
        return;
    }
    isLocal = false;
    isHost = false;
    onlineState = null;
    onlineYouId = null;
    reconnectAttempts = 0;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    hideReconnectBanner();
    hideNoticeBanner();
    leaving = false;
    ws = new WebSocket(getWebSocketUrl());
    ws.onopen = () => {
        reconnectAttempts = 0;
        hideReconnectBanner();
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'join_room',
                code: code,
                name: nick || 'Player'
            }));
        }
    };
    ws.onmessage = handleMessage;
    ws.onclose = handleDisconnect;
    ws.onerror = handleDisconnect;
}

function getWebSocketUrl() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return protocol + '//' + location.host;
}

function handleMessage(e) {
    try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'room_state') {
            // If we're in leaving state, ignore updates
            if (leaving) return;
            const wasInRoom = onlineState && onlineYouId;
            onlineState = msg;
            onlineYouId = msg.youId;
            
            // If the server no longer lists us, the room was closed/removed.
            const me = onlineState.players.find(p => p.id === onlineYouId);
            if (!me && wasInRoom) {
                performLeave();
                showNotice('The room was closed');
                return;
            }
            
            if (onlineState.phase === 'lobby') {
                showView('lobby');
                $('lobCode').textContent = onlineState.code;
                $('lobPlayers').innerHTML = '';
                renderPlayerBar($('lobPlayers'), 0, false);
                const isHost = onlineYouId && onlineState.hostId === onlineYouId;
                $('hostCtl').classList.toggle('hide', !isHost);
                if (isHost) {
                    $('lobNote').textContent = 'Waiting for players. Start whenever you are ready.';
                } else {
                    if (!me) {
                        $('lobNote').textContent = 'Room is full or game already started.';
                    } else {
                        $('lobNote').textContent = 'Waiting for the host to start…';
                    }
                }
                // Host controls are wired once in initHome; the host slider
                // value is read when the host clicks Start.
            } else if (onlineState.phase === 'play' || onlineState.phase === 'over') {
                showView('game');
                renderOnline();
            }
        } else if (msg.type === 'error') {
            if (leaving) return;
            // A "room closed" error sends the player back home with a notice.
            if (/room.*(closed|no longer|removed)/i.test(msg.message || '')) {
                performLeave();
                showNotice('The room was closed');
                return;
            }
            alert(msg.message);
        }
    } catch (e) {
        console.error('Failed to parse message:', e);
    }
}

function renderOnline() {
    if (!onlineState) return;
    renderPlayerBar($('players'), onlineState.currentPlayerIndex, onlineState.phase === 'play');
    let msg = '';
    const cur = onlineState.players[onlineState.currentPlayerIndex];
    if (onlineState.phase === 'over') {
        msg = 'Sequence complete!';
    } else if (cur) {
        if (onlineState.locked && onlineState.flash) {
            msg = cur.name + ' picked ' + onlineState.flash + ' but needed ' + onlineState.next + '. Sequence broken!';
        } else {
            const isMyTurn = onlineYouId && cur.id === onlineYouId;
            if (isMyTurn) {
                msg = 'Your turn: find circle ' + onlineState.next;
            } else {
                msg = cur.name + ' is finding circle ' + onlineState.next;
            }
        }
    }
    $('msg').textContent = msg;
    renderBoardOnline();
    const ov = $('over');
    ov.classList.toggle('show', onlineState.phase === 'over');
    if (onlineState.phase === 'over') {
        const cur2 = onlineState.players[onlineState.currentPlayerIndex];
        $('winTxt').textContent = '🎉 ' + cur2.name + ' wins!';
        const isHost = onlineYouId && onlineState.hostId === onlineYouId;
        $('again').classList.toggle('hide', !isHost);
        $('overNote').textContent = isHost ? '' : 'Waiting for the host…';
        if (isHost) {
            $('again').onclick = () => {
                ws.send(JSON.stringify({ type: 'play_again' }));
            };
        }
    }
}

function renderBoardOnline() {
    if (!onlineState) return;
    const b = $('board');
    const key = 'o:' + onlineState.code + ':' + (onlineState.circles.length) + ':' + onlineState.phase;
    if (b.dataset.r !== key) {
        b.dataset.r = key;
        b.querySelectorAll('.c').forEach(e => e.remove());
        onlineState.circles.forEach(([n, x, y, s]) => {
            const d = document.createElement('div');
            d.className = 'c';
            d.dataset.n = n;
            d.style.cssText = 'left:' + (x / 10) + '%;top:' + (y / 7) + '%;width:' + (s / 10) + '%;--f:' + (s / 10 * 0.42) + 'cqw';
            d.innerHTML = '<div class="in"><div class="f"></div><div class="b">' + n + '</div></div>';
            d.onclick = () => tryPickOnline(n);
            b.appendChild(d);
        });
    }
    b.querySelectorAll('.c').forEach(d => {
        const n = parseInt(d.dataset.n);
        const w = onlineState.flash === n;
        const r = onlineState.revealed.includes(n);
        d.classList.toggle('flip', r || w);
        d.classList.toggle('wrong', w);
        d.classList.toggle('done', r);
    });
}

function tryPickOnline(n) {
    if (!onlineState || onlineState.phase !== 'play' || onlineState.locked) return;
    if (onlineState.revealed.includes(n)) return;
    const cur = onlineState.players[onlineState.currentPlayerIndex];
    const isMyTurn = cur && onlineYouId && cur.id === onlineYouId;
    if (!isMyTurn) return;
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'pick', n }));
    }
}

function copyCode() {
    const code = $('lobCode').textContent;
    if (code) {
        navigator.clipboard.writeText(code).then(() => {
            $('copyCode').textContent = 'Copied';
            setTimeout(() => {
                $('copyCode').textContent = 'Copy code';
            }, 1500);
        });
    }
}

function hideConfirm() {
    $('confirmDialog').classList.add('hide');
}

function showConfirm() {
    $('confirmDialog').classList.remove('hide');
}

function handleLeaveClick() {
    // Ask for a quick confirmation while a round is in progress (local or online).
    const inPlay = (isLocal && localState.phase === 'play') ||
                   (!isLocal && onlineState && onlineState.phase === 'play');
    if (inPlay) {
        showConfirm();
        return;
    }
    performLeave();
}

function performLeave() {
    leaving = true;
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    hideReconnectBanner();
    hideNoticeBanner();
    if (ws) {
        try {
            ws.send(JSON.stringify({ type: 'leave' }));
        } catch (e) {}
        try {
            ws.close();
        } catch (e) {}
        ws = null;
    }
    onlineState = null;
    onlineYouId = null;
    currentRoomCode = null;
    isLocal = true;
    reconnectAttempts = 0;
    showView('home');
    leaving = false;
}

// Keep old name for compatibility
function leave() {
    handleLeaveClick();
}

function showNotice(text) {
    $('noticeText').textContent = text;
    $('noticeBanner').classList.remove('hide');
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
        hideNoticeBanner();
    }, 3000);
}

function hideNoticeBanner() {
    $('noticeBanner').classList.add('hide');
    if (noticeTimer) {
        clearTimeout(noticeTimer);
        noticeTimer = null;
    }
}

function handleDisconnect() {
    hideReconnectBanner();
    if (leaving) return;
    if (!isLocal && ws) {
        showReconnectBanner();
        reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempts - 1), 10000);
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => {
            hideReconnectBanner();
        }, delay);
    }
}

function showReconnectBanner() {
    $('reconnectBanner').classList.remove('hide');
}

function hideReconnectBanner() {
    $('reconnectBanner').classList.add('hide');
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
}

function init() {
    initHome();
    showView('home');
}

init();