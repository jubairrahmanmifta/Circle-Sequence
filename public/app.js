const $ = id => document.getElementById(id);
const COLORS = ['#5B4BFF', '#EF4444', '#22C55E', '#FFC928'];
const CONFETTI_COLORS = ['#5B4BFF', '#3478F6', '#22C55E', '#FFC928', '#EF4444'];
const CROWN_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 18h18l-1.3-8.5-4.3 3.1L12 5.4 8.6 12.6 4.3 9.5 3 18z"/><rect x="4.5" y="19" width="15" height="1.8" rx=".9"/></svg>';

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

// ----- Theme (presentational only) -----
function getTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try {
        localStorage.setItem('nr-theme', theme);
    } catch (e) { /* storage unavailable — theme still applies for this session */ }
}

function toggleTheme() {
    setTheme(getTheme() === 'dark' ? 'light' : 'dark');
}

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
    $('overHome').onclick = () => performLeave();
    $('themeToggle').onclick = toggleTheme;
    $('confirmOk').onclick = () => { hideConfirm(); performLeave(); };
    $('confirmCancel').onclick = hideConfirm;
    
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
    const cur = localState.players[localState.cur];
    if (!cur) return;
    if (localState.locked && localState.flash) {
        setStatus(cur.name + ' picked ' + localState.flash + ' but needed ' + localState.next + '. Sequence broken!');
    } else if (localState.phase === 'play') {
        setStatus(cur.name + ': find circle', localState.next);
    } else {
        setStatus('Sequence complete!');
    }
    renderBoardLocal();
    const ov = $('over');
    const isOver = localState.phase === 'over';
    const wasOver = ov.classList.contains('show');
    ov.classList.toggle('show', isOver);
    if (isOver) {
        updateWinOverlay(cur, {
            canPlayAgain: true,
            note: '',
            celebrate: !wasOver,
            best: localState.best[localState.cur] || 0,
            wins: localState.wins[localState.cur] || 0
        });
        $('again').onclick = () => {
            startLocalRound();
        };
        $('overHome').onclick = () => performLeave();
    }
}

function renderPlayerBar(el, turnIdx, showTurn, slots) {
    el.innerHTML = '';
    const players = isLocal ? localState.players : (onlineState ? onlineState.players : []);

    // Stats live on the player objects online, but in parallel arrays for local play.
    const statFor = (p, i) => ({
        best: isLocal ? (localState.best[i] || 0) : (p.best || 0),
        wins: isLocal ? (localState.wins[i] || 0) : (p.wins || 0)
    });

    // Crown the player with the most wins, only when it is unambiguous.
    let leaderIdx = -1;
    if (players.length > 1) {
        let max = 0, count = 0, idx = -1;
        players.forEach((p, i) => {
            const w = statFor(p, i).wins;
            if (w > max) { max = w; count = 1; idx = i; }
            else if (w === max) { count++; }
        });
        if (max > 0 && count === 1) leaderIdx = idx;
    }

    players.forEach((p, i) => {
        const d = document.createElement('div');
        d.className = 'pl' + (showTurn && i === turnIdx ? ' turn' : '') + (i === leaderIdx ? ' leader' : '');
        const b = document.createElement('b');
        const dot = document.createElement('i');
        dot.className = 'dot';
        dot.style.background = COLORS[i % COLORS.length];
        b.appendChild(dot);
        const nameEl = document.createElement('span');
        nameEl.className = 'name';
        let nameTxt = p.name;
        if (!isLocal && onlineState && p.id === onlineYouId) {
            nameTxt += ' (you)';
        }
        nameEl.textContent = nameTxt;
        b.appendChild(nameEl);
        if (i === leaderIdx) {
            const crown = document.createElement('span');
            crown.className = 'pl-crown';
            crown.title = 'Most wins';
            crown.innerHTML = CROWN_SVG;
            b.appendChild(crown);
        }
        d.appendChild(b);
        const st = statFor(p, i);
        const sp = document.createElement('span');
        sp.className = 'stats';
        sp.textContent = 'Best streak: ' + st.best + ' · Wins: ' + st.wins;
        d.appendChild(sp);
        el.appendChild(d);
    });

    // Dashed placeholders for empty lobby slots.
    if (slots && players.length < slots) {
        for (let i = players.length; i < slots; i++) {
            const d = document.createElement('div');
            d.className = 'pl empty';
            const dot = document.createElement('i');
            dot.className = 'dot';
            d.appendChild(dot);
            const t = document.createElement('span');
            t.textContent = 'Waiting for player…';
            d.appendChild(t);
            el.appendChild(d);
        }
    }
}

// Status pill with an optional "next number" badge.
function setStatus(text, next) {
    const el = $('msg');
    el.textContent = text;
    if (typeof next === 'number') {
        el.appendChild(document.createTextNode(' '));
        const badge = document.createElement('span');
        badge.className = 'next-badge';
        badge.textContent = String(next);
        el.appendChild(badge);
    }
}

function makeStat(label, value) {
    const d = document.createElement('div');
    d.className = 'stat';
    const v = document.createElement('strong');
    v.textContent = String(value);
    const l = document.createElement('small');
    l.textContent = label;
    d.appendChild(v);
    d.appendChild(l);
    return d;
}

function updateWinOverlay(winner, opts) {
    if (!winner) return;
    const options = opts || {};
    const best = (options.best != null) ? options.best : (winner.best || 0);
    const wins = (options.wins != null) ? options.wins : (winner.wins || 0);
    $('winTxt').textContent = winner.name + ' wins!';
    const stats = $('overStats');
    stats.innerHTML = '';
    stats.appendChild(makeStat('Best streak', best));
    stats.appendChild(makeStat('Total wins', wins));
    $('again').classList.toggle('hide', !options.canPlayAgain);
    $('overNote').textContent = options.note || '';
    if (options.celebrate) showConfetti();
}

function showConfetti() {
    const c = $('confetti');
    if (!c) return;
    c.innerHTML = '';
    for (let i = 0; i < 26; i++) {
        const s = document.createElement('i');
        s.style.setProperty('--x', (Math.random() * 100).toFixed(1) + '%');
        s.style.setProperty('--d', (Math.random() * 0.7).toFixed(2) + 's');
        s.style.setProperty('--r', Math.floor(Math.random() * 360) + 'deg');
        s.style.setProperty('--c', CONFETTI_COLORS[i % CONFETTI_COLORS.length]);
        c.appendChild(s);
    }
}

function renderBoardLocal() {
    const b = $('board');
    // Key on the actual layout so a freshly generated board always rebuilds
    // (e.g. after leaving a game and starting a new one).
    const key = 'L:' + localState.circles.map(c => c.join(',')).join(';');
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
                renderPlayerBar($('lobPlayers'), 0, false, 4);
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
    const cur = onlineState.players[onlineState.currentPlayerIndex];
    if (onlineState.phase === 'over') {
        setStatus('Sequence complete!');
    } else if (cur) {
        if (onlineState.locked && onlineState.flash) {
            setStatus(cur.name + ' picked ' + onlineState.flash + ' but needed ' + onlineState.next + '. Sequence broken!');
        } else {
            const isMyTurn = onlineYouId && cur.id === onlineYouId;
            setStatus(isMyTurn ? 'Your turn: find circle' : cur.name + ' is finding circle', onlineState.next);
        }
    }
    renderBoardOnline();
    const ov = $('over');
    const isOver = onlineState.phase === 'over';
    const wasOver = ov.classList.contains('show');
    ov.classList.toggle('show', isOver);
    if (isOver) {
        const winner = onlineState.players[onlineState.currentPlayerIndex];
        const isHost = onlineYouId && onlineState.hostId === onlineYouId;
        updateWinOverlay(winner, { canPlayAgain: !!isHost, note: isHost ? '' : 'Waiting for the host…', celebrate: !wasOver });
        if (isHost) {
            $('again').onclick = () => {
                sendOnline('play_again');
            };
        }
        $('overHome').onclick = () => performLeave();
    }
}

function renderBoardOnline() {
    if (!onlineState) return;
    const b = $('board');
    // Key on room + layout so a new round always rebuilds the board.
    const key = 'o:' + onlineState.code + ':' + onlineState.circles.map(c => c.join(',')).join(';');
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
    // Make sure the winner overlay never lingers over the home screen.
    $('over').classList.remove('show');
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