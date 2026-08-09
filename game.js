// ============================================================
// Mini Kart Racing - Mario Kart style browser game
// ============================================================

const canvas = document.getElementById("gameCanvas");
canvas.setAttribute("tabindex", "0");
const engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
// Render at device pixels (not CSS pixels) so the 3D is crisp on tablets/retina.
// Capped at 1.75× so high-DPR devices don't pay a full 2-3× fill-rate cost.
engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 1.75));

let playerCar = null;
let gameKeys = {};
let gameTime = 0;

// Pace multiplier for TRANSLATION only — top speed, acceleration, braking and AI
// speed. Baseline 1.0; 0.81 makes the karts travel ~19% slower so the race is
// calmer and easier for young players.
const GAME_SPEED = 0.81;
// Steering responsiveness, DECOUPLED from the pace. The turn rate is deliberately
// NOT tied to GAME_SPEED: when we slowed the karts down, scaling the turn rate
// with them made the wheel feel sluggish/laggy. Keeping steering at 0.9 (the
// snappy feel from before the slow-down) means a slower car that still turns
// crisply. Side effect: a touch tighter turning radius (maxSpeed/turnSpeed), i.e.
// a bit more nimble — which only helps on the sharp-corner tracks.
const STEER_SPEED = 0.9;
let networkCars = [];
let activeScene = null; // current scene; disposed before a new race is built

// Normalize an angle to [-PI, PI] in O(1). Using `while` loops here was unsafe:
// a non-finite angle (Infinity) made `angle > PI` stay true forever and hung the
// whole frame, freezing every car ("race hang").
function normAngle(a) {
    if (!isFinite(a)) return 0;
    a = a % (Math.PI * 2);
    if (a > Math.PI) a -= Math.PI * 2;
    else if (a < -Math.PI) a += Math.PI * 2;
    return a;
}

// Brief on-screen feedback when the player drives through a quiz answer box.
let _roadFeedbackTimer = null;
function showRoadFeedback(text, color, duration) {
    const el = document.getElementById("road-feedback");
    if (!el) return;
    el.textContent = text;
    el.style.color = color;
    el.style.opacity = "1";
    clearTimeout(_roadFeedbackTimer);
    _roadFeedbackTimer = setTimeout(() => { el.style.opacity = "0"; }, duration || 750);
}

// ------------------------------------------------------------
// "Who hit me?" — every attack records its attacker on the victim so the
// player can see who to chase down instead of guessing.
// ------------------------------------------------------------
let _revengeTimer = null;
const HIT_BLAME = {
    lightning: ["⚡", "Zapped by"],
    fireball: ["🔥", "Blasted by"],
    banana: ["🍌", "Slipped on a banana from"],
    oil: ["🛢️", "Oiled by"],
    bubble: ["🫧", "Bubbled by"],
    fog: ["💨", "Gassed by"],
    tornado: ["🌪️", "Spun by"],
    bump: ["💥", "Rammed by"],
};
function carLabel(c) {
    if (!c) return "someone";
    if (c._label) return c._label;
    if (/^ai(\d+)$/.test(c.name || "")) return "Rival " + (Number(RegExp.$1) + 1);
    return c.name || "someone";
}
function showRevenge(text) {
    const el = document.getElementById("revenge-banner");
    if (!el) return;
    el.textContent = text;
    el.style.opacity = "1";
    clearTimeout(_revengeTimer);
    _revengeTimer = setTimeout(() => { el.style.opacity = "0"; }, 3200);
}
// victim: the car that got hit. attacker: the car responsible (may be null for
// scenery). kind: a key of HIT_BLAME.
function creditHit(victim, attacker, kind) {
    if (!victim || !attacker || attacker === victim) return;
    victim._lastHitBy = { car: attacker, label: carLabel(attacker), kind };
    if (typeof playerCar !== "undefined" && victim === playerCar) {
        const [icon, verb] = HIT_BLAME[kind] || ["💫", "Hit by"];
        showRevenge(`${icon} ${verb} ${carLabel(attacker)}!`);
    }
}

// ============================================================
// ASSET LOADING SYSTEM
// ============================================================

const AssetManager = {
    models: {},
    sounds: {},
    loaded: false,

    async loadAssets(scene) {
        // Kenney "Car Kit" vehicles (CC0). Loaded once into asset containers that
        // stay out of the scene, then instantiated per car in createCar().
        const kartModels = ['race-future', 'race', 'sedan', 'suv', 'truck', 'van', 'taxi', 'hatchback-sports', 'kart-oobi'];
        for (const model of kartModels) {
            try {
                this.models[model] = await BABYLON.SceneLoader.LoadAssetContainerAsync("assets/models/", `${model}.glb`, scene);
            } catch (e) {
                console.warn(`Failed to load model ${model}:`, e);
            }
        }

        // Kenney "Impact Sounds" (CC0). Each effect is a pool of clips; a random
        // one is played each time so repeated hits don't sound identical.
        const soundPools = {
            collision: { vol: 0.5,  files: ['impactMetal_medium_000', 'impactMetal_medium_001', 'impactMetal_medium_002', 'impactMetal_medium_003', 'impactMetal_medium_004'] },
            hit:       { vol: 0.65, files: ['impactPlate_heavy_000', 'impactPlate_heavy_001', 'impactPlate_heavy_002', 'impactPlate_heavy_003', 'impactPlate_heavy_004'] },
            pickup:    { vol: 0.5,  files: ['impactGlass_light_000', 'impactGlass_light_001', 'impactGlass_light_002', 'impactGlass_light_003', 'impactGlass_light_004'] },
            lap:       { vol: 0.6,  files: ['impactBell_heavy_002', 'impactBell_heavy_003', 'impactBell_heavy_004'] },
        };

        for (const [name, pool] of Object.entries(soundPools)) {
            this.sounds[name] = pool.files.map((file, i) => {
                try {
                    return new BABYLON.Sound(`${name}_${i}`, `assets/Audio/${file}.ogg`, scene, null, { loop: false, autoplay: false, volume: pool.vol });
                } catch (e) {
                    console.warn(`Failed to load sound ${file}:`, e);
                    return null;
                }
            }).filter(Boolean);
        }

        this.loaded = true;
    },

    // Instantiates a fresh copy of a loaded model hierarchy into the scene and
    // returns its root node, or null if the model is unavailable.
    getModel(name, uniqueName) {
        const container = this.models[name];
        if (!container) return null;
        const entries = container.instantiateModelsToScene(
            n => `${uniqueName || name}_${n}`,
            false,
            { doNotInstantiate: true }
        );
        return entries.rootNodes[0] || null;
    },

    // Plays a random ready clip from a pool. Returns false if nothing is loaded
    // yet so callers can fall back to a synthesized sound.
    playSound(name) {
        const pool = this.sounds[name];
        if (!pool || !pool.length) return false;
        const ready = pool.filter(s => !s.isReady || s.isReady());
        const choices = ready.length ? ready : pool;
        const s = choices[Math.floor(Math.random() * choices.length)];
        if (!s || (s.isReady && !s.isReady())) return false;
        s.stop();
        s.play();
        return true;
    }
};

// ============================================================
// MULTIPLAYER SYSTEM
// ============================================================

let socket = null;
let isMultiplayer = false;
let isHost = false;
let myPlayerId = null;
let currentHostId = null; // server-authoritative host (= first connected player)
let currentRoomName = '';
let roomId = null;
let playerName = 'Player';
let networkPlayers = new Map();
let remoteCars = new Map();
// Set inside createScene to the item-effect applier so the global socket
// handler can replay a remote player's item (spawn their banana/oil/bubble/fog
// trap, fireball, tornado, or apply their lightning) against OUR local cars.
let applyRemoteItemEffect = null;
// Set inside createScene; the 'race-go' handler calls it to release the held
// 3-2-1 countdown once the SERVER says every client's scene is built.
let releaseRaceGo = null;
let socketHandlersRegistered = false;

// A STABLE identity that survives socket reconnects (a network blip gives the
// socket a brand-new socket.id; this id stays put so the server can re-bind us
// to our existing car instead of treating us as a new — and frozen — player).
// In-memory: unique per page load, distinct per tab, kept across reconnects.
const clientId = 'c_' + Math.random().toString(36).slice(2, 11) + Math.floor(Math.random() * 1e6).toString(36);
window.clientId = clientId; // exposed for tools/headless tests
let _connectedOnce = false;

function getPlayerName() {
    const input = document.getElementById('name-input');
    const name = input ? input.value.trim() : '';
    return name || 'Player';
}

function connectSocket() {
    if (socket) return socket;
    // Keep trying to reconnect forever, quickly — a brief network blip should
    // recover on its own (the 'connect' handler re-joins the room).
    // Use socket.io's DEFAULT transport negotiation: connect via HTTP polling
    // first (works across virtually any LAN/router/proxy) then auto-upgrade to a
    // websocket. Forcing websocket-first broke cross-device LAN connections
    // ("can't connect" / connect_error). Keep only the robust-reconnect tuning.
    socket = io({
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 500,
        reconnectionDelayMax: 3000,
        timeout: 20000,
    });

    socket.on('connect', () => {
        // On a RECONNECT (not the first connect), re-bind to our room with the
        // stable clientId so the server hands us back our existing car/slot and
        // our position updates start flowing again — the game keeps running.
        if (_connectedOnce && isMultiplayer && roomId) {
            socket.emit('join-room', { roomId, name: playerName, clientId }, () => {});
        }
        _connectedOnce = true;
    });

    socket.on('disconnect', () => {});

    // A peer dropped but may come back — keep their car on screen (prediction
    // freezes it in place); the standings stay until they're really gone. The
    // host's Start button is refreshed so a dropped player no longer blocks it.
    socket.on('player-reconnecting', (data) => {
        applyHostId(data && data.hostId);
        if (data && data.players) updatePlayersList(data.players);
        refreshStartButton(data && data.allReady);
    });

    socket.on('connect_error', (error) => {
        console.error('Socket connection error:', error && error.message ? error.message : error);
        // If we never managed to connect, the host is unreachable — give the
        // player an actionable hint (same WiFi? right code/IP? host firewall?).
        if (!_connectedOnce) {
            const el = document.getElementById('lobby-error');
            if (el) el.textContent = "Can't reach the game — check you're on the same WiFi as the host (and the host's firewall allows the port).";
        }
    });

    if (!socketHandlersRegistered) {
        socketHandlersRegistered = true;

    socket.on('player-joined', (data) => {
        // data.playerId is whoever just joined (not necessarily us), so never copy
        // it into myPlayerId. Our own id is the stable clientId. The previous code
        // overwrote the host's id with the joiner's id, which made the host ignore
        // the joiner's position updates and never animate the non-host car.
        if (!myPlayerId) {
            myPlayerId = clientId;
        }

        applyHostId(data.hostId);
        updatePlayersList(data.players);
        refreshStartButton(data.allReady);
    });

    socket.on('player-ready', (data) => {
        applyHostId(data.hostId);
        const playerItem = document.querySelector(`[data-player-id="${data.playerId}"]`);
        if (playerItem) {
            playerItem.classList.add('ready');
            playerItem.querySelector('.player-status').textContent = data.car ? data.car.name : 'Ready';
        }
        refreshStartButton(data.allReady);
    });

    socket.on('player-left', (data) => {
        // Host migration is server-authoritative: data.hostId names whoever now
        // owns the room (the first remaining player if the host left).
        applyHostId(data.hostId);
        updatePlayersList(data.players);
        refreshStartButton(data.allReady);
        const car = remoteCars.get(data.playerId);
        if (car) {
            remoteCars.delete(data.playerId);
        }
    });

    // The host renamed the room — update the title for everyone.
    socket.on('room-renamed', (data) => { if (data && data.name) setRoomName(data.name); });

    socket.on('race-countdown', (data) => {
        window._multiplayerPlayers = data.players;
        if (data.trackId != null) window._selectedTrackId = data.trackId;
        window._cupMode = !!data.cup;
        window._cupInfo = data.cup ? { index: data.cupTrackIndex, total: data.cupTotal } : null;

        // Clear any leftover race-over / cup-standings overlay before the next race.
        clearCupOverlays();

        document.getElementById('car-select-overlay').style.display = 'none';
        document.getElementById('lobby-overlay').style.display = 'none';

        const title = document.getElementById('countdown-title');
        if (title) title.textContent = data.cup ? `🏆 RACE ${data.cupTrackIndex + 1} OF ${data.cupTotal}` : 'GET READY!';

        showCountdownScreen(data.players, 5);
    });

    socket.on('countdown-tick', (data) => {
        updateCountdownNumber(data.count);
    });

    socket.on('race-start', (data) => {
        hideCountdownScreen();
        document.getElementById('hud').style.display = 'block';
        document.getElementById('corner-hud').style.display = 'flex';

        window._multiplayerPlayers = data.players;
        if (data.trackId != null) window._selectedTrackId = data.trackId;
        window._cupMode = !!data.cup;
        window._cupInfo = data.cup ? { index: data.cupTrackIndex, total: data.cupTotal } : null;
        createScene();
    });

    // The server has every client on the grid — release the held 3-2-1 so all
    // players count down and launch in lock-step (no scene-load head start).
    socket.on('race-go', () => { if (releaseRaceGo) releaseRaceGo(); });

    socket.on('player-update', (data) => {
        if (data.playerId === myPlayerId) {
            return;
        }

        networkPlayers.set(data.playerId, data);
    });

    socket.on('item-used', (data) => {
        if (data.playerId === myPlayerId) return;
        const car = remoteCars.get(data.playerId);
        if (!car || !data.item) return;
        // Replay the remote player's item on OUR client so world effects stay in
        // sync: their traps/projectile/tornado spawn from their ghost's position
        // and their lightning strikes our local cars. Pure self-effects
        // (boost/shield/star) also come through the position fx bitmask, so this
        // is mostly redundant for those — but it makes the SFX fire immediately.
        if (applyRemoteItemEffect) applyRemoteItemEffect(car, data.item);
    });

    socket.on('player-lap', (data) => {
        // Remote lap count is derived locally from the car's live position
        // (advanceProgress), so nothing to do here — kept for protocol compat.
    });

    socket.on('player-finished', (data) => {
        if (data.playerId === myPlayerId) return;
        const car = remoteCars.get(data.playerId);
        if (car) {
            car.finished = true;
            car.finishTime = data.finishTime;
        }
    });

    // Cup: after each track the server sends the per-track result + the combined
    // standings; on the last track `final` crowns the champion.
    socket.on('cup-standings', (data) => { renderCupStandings(data); });

    socket.on('room-reset', (data) => {
        applyHostId(data.hostId);
        updatePlayersList(data.players);
        window._cupMode = false;
        window._cupInfo = null;

        // Clear every race-over leftover (the guests' "waiting for host"
        // overlay used to stick around forever, dead-ending the room).
        clearCupOverlays();
        SoundManager.stopMusic();
        SoundManager.stopEngine();

        document.getElementById('hud').style.display = 'none';
        document.getElementById('corner-hud').style.display = 'none';
        document.getElementById('road-question').style.display = 'none';
        document.getElementById('lobby-start-btn').style.display = 'none';
        document.getElementById('lobby-waiting').style.display = 'block';

        selectedCarModel = null;
        document.querySelectorAll(".car-card").forEach(c => c.classList.remove("selected"));
        document.getElementById("start-race-btn").disabled = true;

        // Back to the SAME room's lobby — everyone re-picks vehicle (and the host
        // the track) for the next round via "Choose Your Ride". No code re-typing.
        enterLobby();
    });

    socket.on('track-selected', (data) => {
        if (data && data.trackId != null) updateNextTrack(data.trackId);
    });

    socket.on('chat', (msg) => { appendChat(msg); });

    } // End of socketHandlersRegistered check

    socket.on('disconnect', () => {});

    return socket;
}

// Show the host's chosen course to every player in the room. The host also gets
// a dropdown to change the track right here in the room.
function updateNextTrack(trackId) {
    if (trackId != null) selectedTrackId = trackId;
    const t = TRACKS.find(x => x.id === selectedTrackId) || TRACKS[0];
    const nm = document.getElementById('next-track-name');
    if (nm) nm.textContent = `${t.icon ? t.icon + ' ' : ''}${t.name}`;
    const el = document.getElementById('next-track');
    if (el) el.style.display = isMultiplayer ? 'block' : 'none';
    const sel = document.getElementById('room-track');
    if (sel) {
        sel.value = String(selectedTrackId);
        sel.style.display = (isMultiplayer && isHost) ? 'block' : 'none';
    }
}

// The in-room track picker (host only) — pick a different course without leaving
// the room; the choice broadcasts to everyone.
function buildRoomTrackSelect() {
    const sel = document.getElementById('room-track');
    if (!sel) return;
    sel.innerHTML = '';
    TRACKS.forEach((t) => {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = `${t.icon ? t.icon + ' ' : ''}${t.name}`;
        sel.appendChild(opt);
    });
    sel.addEventListener('change', () => {
        const id = parseInt(sel.value, 10);
        selectedTrackId = id;
        if (isMultiplayer && isHost && socket) socket.emit('select-track', { trackId: id });
        updateNextTrack(id);
    });
}

// Append one chat line. Text is set via textContent / text nodes, so any HTML
// in a message is shown literally (no injection).
function appendChat(msg) {
    const box = document.getElementById('chat-messages');
    if (!box || !msg) return;
    const div = document.createElement('div');
    if (msg.sys) {
        div.className = 'chat-msg sys';
        div.textContent = msg.text;
    } else {
        div.className = 'chat-msg' + (msg.pid && msg.pid === myPlayerId ? ' me' : '');
        const name = document.createElement('span');
        name.className = 'cm-name';
        name.textContent = (msg.name || 'Player') + ': ';
        div.appendChild(name);
        div.appendChild(document.createTextNode(msg.text));
    }
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
}

function sendChat() {
    const inp = document.getElementById('chat-input');
    const text = inp.value.trim();
    if (!text || !socket || !isMultiplayer) return;
    socket.emit('chat-message', { text });
    inp.value = '';
}

function showCountdownScreen(players, count) {
    const overlay = document.getElementById('countdown-overlay');
    const numberEl = document.getElementById('countdown-number');
    const playersEl = document.getElementById('countdown-players');
    
    overlay.style.display = 'flex';
    numberEl.textContent = count;
    
    playersEl.innerHTML = '';
    players.forEach((player) => {
        const div = document.createElement('div');
        div.className = 'countdown-player';
        
        const nameDiv = document.createElement('div');
        nameDiv.className = 'cp-name';
        nameDiv.textContent = player.name;
        div.appendChild(nameDiv);
        
        const carDiv = document.createElement('div');
        carDiv.className = 'cp-car';
        carDiv.textContent = player.car ? player.car.name : 'Unknown';
        div.appendChild(carDiv);
        
        playersEl.appendChild(div);
    });
}

function updateCountdownNumber(count) {
    const numberEl = document.getElementById('countdown-number');
    if (numberEl) {
        numberEl.textContent = count > 0 ? count : 'GO!';
        SoundManager.countdownBeep();
        if (count === 0) {
            SoundManager.countdownGo();
        }
    }
}

function hideCountdownScreen() {
    document.getElementById('countdown-overlay').style.display = 'none';
}

function updatePlayersList(players) {
    const list = document.getElementById('players-list');
    list.innerHTML = '';
    players.forEach((player, idx) => {
        const item = document.createElement('div');
        item.className = 'player-item';
        item.dataset.playerId = player.id;
        const offline = player.connected === false;
        if (player.ready && !offline) item.classList.add('ready');
        if (offline) item.style.opacity = '0.5';

        const isHostRow = (currentHostId != null) ? (player.id === currentHostId) : (idx === 0);
        const name = document.createElement('span');
        name.className = 'player-name';
        name.textContent = isHostRow ? `${player.name} (Host)` : player.name;
        item.appendChild(name);

        const status = document.createElement('span');
        status.className = 'player-status';
        status.textContent = offline ? 'reconnecting…' : (player.ready ? (player.car ? player.car.name : 'Ready') : 'Waiting');
        item.appendChild(status);

        list.appendChild(item);
    });
}

// Show/hide the host's Start button from a server "all ready" flag (only the
// host has the button; it appears when every CONNECTED player has picked a car).
function refreshStartButton(allReady) {
    if (!isHost) return;
    const show = !!allReady;
    document.getElementById('lobby-start-btn').style.display = show ? 'block' : 'none';
    const cupBtn = document.getElementById('lobby-cup-btn');
    if (cupBtn) cupBtn.style.display = show ? 'block' : 'none';
    document.getElementById('lobby-waiting').style.display = show ? 'none' : 'block';
}

// Adopt the server's authoritative host designation (the host is the first
// connected player). When the host leaves, everyone is told the new host's id
// here, so the promoted player's client switches on its host-only controls.
function applyHostId(hostId) {
    if (hostId == null) return;
    currentHostId = hostId;
    isHost = (hostId === myPlayerId);
    updateNextTrack();      // reveals/hides the host-only track picker
    updateRoomRenameUI();   // reveals/hides the host-only rename control
}

// Show the rename button (and pencil) only to the host.
function updateRoomRenameUI() {
    const btn = document.getElementById('room-rename-btn');
    if (btn) btn.style.display = isHost ? 'inline-block' : 'none';
    if (!isHost) {
        const edit = document.getElementById('room-rename-edit');
        if (edit) edit.style.display = 'none';
    }
}

function setRoomName(name) {
    if (name) currentRoomName = name;
    const el = document.getElementById('room-name');
    if (el && currentRoomName) el.textContent = currentRoomName;
}

// Remove any race-over / cup-standings overlays before the next race starts.
function clearCupOverlays() {
    ['cup-standings-overlay', 'play-again-overlay'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.remove();
    });
    const cd = document.getElementById('countdown');
    if (cd) { cd.style.display = 'none'; cd.textContent = ''; }
}

function ordinal(n) {
    if (n === 1) return '1st';
    if (n === 2) return '2nd';
    if (n === 3) return '3rd';
    return n + 'th';
}

// Detailed Grand Prix breakdown: one column per track played, one row per
// player (ordered by overall standing). Each cell shows the rank + points that
// player earned on that track; the final column is the running total. This is
// the "what track, what rank, how many points" view.
function buildCupBreakdown(data) {
    const results = data.results || [];
    if (!results.length) return null;
    const standings = data.standings || [];
    const totals = {};
    standings.forEach(s => { totals[s.pid] = s.points; });

    // Per-track lookup: pid → {rank, points, dnf} for fast cell fill.
    const byTrack = results.map(res => {
        const m = {};
        (res.ranking || []).forEach(r => { m[r.pid] = r; });
        return { trackId: res.trackId, byPid: m };
    });

    const wrap = document.createElement('div');
    wrap.className = 'cup-detail-wrap';
    const table = document.createElement('table');
    table.className = 'cup-detail';

    // Header: Racer | <track icons…> | Σ
    const thead = document.createElement('thead');
    const hr = document.createElement('tr');
    const hRacer = document.createElement('th');
    hRacer.className = 'cd-racer';
    hRacer.textContent = 'Racer';
    hr.appendChild(hRacer);
    const latest = byTrack.length - 1; // the track that just finished
    byTrack.forEach((t, i) => {
        const track = TRACKS.find(x => x.id === t.trackId);
        const th = document.createElement('th');
        th.textContent = track && track.icon ? track.icon : `T${i + 1}`;
        th.title = track ? track.name : `Track ${i + 1}`; // hover shows full name
        if (i === latest) th.className = 'cd-latest';
        hr.appendChild(th);
    });
    const hTot = document.createElement('th');
    hTot.className = 'cd-total';
    hTot.textContent = 'Σ';
    hTot.title = 'Total points';
    hr.appendChild(hTot);
    thead.appendChild(hr);
    table.appendChild(thead);

    // One row per player, in overall-standings order.
    const tbody = document.createElement('tbody');
    standings.forEach((s, idx) => {
        const tr = document.createElement('tr');
        if (idx === 0) tr.className = 'lead';
        if (s.pid === myPlayerId) tr.className += ' me';

        const nameTd = document.createElement('td');
        nameTd.className = 'cd-racer';
        nameTd.textContent = `${idx + 1}. ${s.pid === myPlayerId ? 'You' : s.name}`;
        tr.appendChild(nameTd);

        byTrack.forEach((t, ti) => {
            const cell = t.byPid[s.pid];
            const td = document.createElement('td');
            const latestCls = (ti === latest) ? ' cd-latest' : '';
            if (!cell) { td.className = 'cd-cell' + latestCls; td.textContent = '–'; tr.appendChild(td); return; }
            td.className = 'cd-cell' + latestCls + (cell.rank === 1 ? ' win' : '') + (cell.dnf ? ' dnf' : '');
            const pts = document.createElement('span');
            pts.className = 'cd-pts';
            pts.textContent = cell.dnf ? '0' : `+${cell.points}`;
            const rk = document.createElement('span');
            rk.className = 'cd-rank';
            rk.textContent = cell.dnf ? 'DNF' : ordinal(cell.rank);
            td.appendChild(pts);
            td.appendChild(rk);
            tr.appendChild(td);
        });

        const totTd = document.createElement('td');
        totTd.className = 'cd-total';
        totTd.textContent = totals[s.pid] != null ? totals[s.pid] : 0;
        tr.appendChild(totTd);

        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
}

// Build the Grand Prix standings screen shown between tracks (and at the end).
// `data` = { trackIndex, totalTracks, trackId, ranking, standings, results, final }.
function renderCupStandings(data) {
    clearCupOverlays();
    document.getElementById('hud').style.display = 'none';
    document.getElementById('corner-hud').style.display = 'none';
    document.getElementById('road-question').style.display = 'none';
    document.getElementById('countdown-overlay').style.display = 'none'; // no countdown bleed-through

    const gained = {};
    (data.ranking || []).forEach(r => { gained[r.pid] = r; });
    const track = TRACKS.find(t => t.id === data.trackId);
    const trackName = track ? `${track.icon ? track.icon + ' ' : ''}${track.name}` : 'Track';

    const ov = document.createElement('div');
    ov.id = 'cup-standings-overlay';

    const head = document.createElement('div');
    head.className = 'cup-head';
    head.textContent = data.final ? '🏆 GRAND PRIX CHAMPION' : '🏆 GRAND PRIX';
    ov.appendChild(head);

    const sub = document.createElement('div');
    sub.className = 'cup-sub';
    sub.textContent = data.final
        ? 'Final standings'
        : `Track ${data.trackIndex + 1} of ${data.totalTracks} done · ${trackName}`;
    ov.appendChild(sub);

    if (data.final && data.standings && data.standings[0]) {
        const champ = document.createElement('div');
        champ.className = 'cup-champ';
        const me = data.standings[0].pid === myPlayerId;
        champ.textContent = `🥇 ${me ? 'YOU' : data.standings[0].name} win${me ? '' : 's'} the cup!`;
        ov.appendChild(champ);
    }

    // Detailed track-by-track breakdown (rank + points per track, plus totals).
    // Falls back to a simple standings board if no per-track results arrived
    // (older server / first track only).
    const detail = buildCupBreakdown(data);
    if (detail) {
        const legend = document.createElement('div');
        legend.className = 'cup-sub';
        legend.textContent = 'Track by track — each cell: points (rank)';
        ov.appendChild(legend);
        ov.appendChild(detail);
    } else {
        const board = document.createElement('div');
        board.className = 'cup-board';
        (data.standings || []).forEach((s, idx) => {
            const row = document.createElement('div');
            row.className = 'cup-row' + (idx === 0 ? ' lead' : '') + (s.pid === myPlayerId ? ' me' : '');

            const pos = document.createElement('span');
            pos.className = 'cup-pos';
            pos.textContent = (idx + 1) + '.';
            row.appendChild(pos);

            const name = document.createElement('span');
            name.className = 'cup-name';
            name.textContent = (s.pid === myPlayerId ? 'You' : s.name);
            row.appendChild(name);

            const g = gained[s.pid];
            const gain = document.createElement('span');
            gain.className = 'cup-gain';
            gain.textContent = g ? (g.dnf ? 'DNF' : `+${g.points}`) : '';
            row.appendChild(gain);

            const pts = document.createElement('span');
            pts.className = 'cup-pts';
            pts.textContent = `${s.points} pt${s.points === 1 ? '' : 's'}`;
            row.appendChild(pts);

            board.appendChild(row);
        });
        ov.appendChild(board);
    }

    if (data.final) {
        if (isHost) {
            const btn = document.createElement('button');
            btn.className = 'lobby-btn';
            btn.textContent = 'Back to Lobby';
            btn.onclick = () => { socket.emit('reset-room'); ov.remove(); };
            ov.appendChild(btn);
        } else {
            const note = document.createElement('div');
            note.className = 'cup-note';
            note.textContent = 'Waiting for the host…';
            ov.appendChild(note);
        }
    } else {
        const note = document.createElement('div');
        note.className = 'cup-note';
        note.textContent = 'Next track starting soon…';
        ov.appendChild(note);
    }

    document.body.appendChild(ov);
}

document.getElementById('create-room-btn').addEventListener('click', () => {
    playerName = getPlayerName();
    connectSocket();
    socket.emit('create-room', { name: playerName, clientId }, (response) => {
        if (response.error) {
            document.getElementById('lobby-error').textContent = response.error;
            return;
        }
        roomId = response.roomId;
        myPlayerId = response.playerId;
        isMultiplayer = true;
        stopRoomListPolling();

        document.getElementById('room-code').textContent = roomId;
        document.getElementById('lobby-start-btn').style.display = 'none';
        document.getElementById('lobby-waiting').style.display = 'block';

        applyHostId(response.hostId || myPlayerId); // we created it → we're host
        setRoomName(response.roomName);
        updatePlayersList([{ id: myPlayerId, name: playerName, ready: false }]);

        // Land in the room lobby (share the code, wait for players) — vehicle and
        // track are chosen later, per round, from the "Choose Your Ride" button.
        enterLobby();
    });
});

// Join a room by its code — shared by the manual code box AND the tap-to-join
// network room list. `btn` (optional) is disabled while the request is in flight.
function joinRoomByCode(code, btn) {
    code = String(code || '').trim().toUpperCase();
    if (!code) {
        document.getElementById('lobby-error').textContent = 'Please enter a room code';
        return;
    }
    // Lock the button while the request is in flight — double-clicking used
    // to fire two join-room calls.
    if (btn) { if (btn.disabled) return; btn.disabled = true; }

    playerName = getPlayerName();
    connectSocket();
    socket.emit('join-room', { roomId: code, name: playerName, clientId }, (response) => {
        if (btn) btn.disabled = false;
        if (response.error) {
            document.getElementById('lobby-error').textContent = response.error;
            return;
        }
        roomId = code;
        myPlayerId = response.playerId;
        isMultiplayer = true;
        stopRoomListPolling();

        document.getElementById('room-code').textContent = roomId;
        document.getElementById('lobby-start-btn').style.display = 'none';
        document.getElementById('lobby-waiting').style.display = 'block';

        applyHostId(response.hostId);
        setRoomName(response.roomName);
        updatePlayersList(response.players);
        if (response.trackId != null) selectedTrackId = response.trackId; // adopt the room's current course
        enterLobby();
    });
}

document.getElementById('join-room-btn').addEventListener('click', () => {
    const code = document.getElementById('join-input').value;
    joinRoomByCode(code, document.getElementById('join-room-btn'));
});

// --- LAN room discovery: poll the server for open rooms while on the main menu
// so a player can just tap a game to join (no code to type). ---
let _roomPollTimer = null;
function startRoomListPolling() {
    refreshRoomList();
    if (_roomPollTimer) return;
    _roomPollTimer = setInterval(refreshRoomList, 2500);
}
function stopRoomListPolling() {
    if (_roomPollTimer) { clearInterval(_roomPollTimer); _roomPollTimer = null; }
}
function refreshRoomList() {
    const menu = document.getElementById('lobby-menu');
    if (!menu || menu.style.display === 'none') return; // only while the menu is up
    fetch('/rooms').then(r => r.json()).then(renderRoomList).catch(() => {});
}
function renderRoomList(list) {
    const el = document.getElementById('room-list');
    if (!el) return;
    const open = (list || []).filter(r => r.joinable);
    if (!open.length) {
        el.innerHTML = '';
        const empty = document.createElement('div');
        empty.className = 'room-list-empty';
        empty.textContent = 'No games yet — create one above, or wait for a host.';
        el.appendChild(empty);
        return;
    }
    el.innerHTML = '';
    open.forEach(r => {
        const row = document.createElement('div');
        row.className = 'room-item';

        const name = document.createElement('span');
        name.className = 'ri-name';
        name.textContent = `🏁 ${r.name || (r.host + "'s game")}`; // textContent: names can't inject HTML

        const meta = document.createElement('span');
        meta.className = 'ri-meta';
        meta.textContent = `${r.count}/4`;

        const join = document.createElement('button');
        join.className = 'ri-join';
        join.textContent = 'Join';

        row.appendChild(name);
        row.appendChild(meta);
        row.appendChild(join);
        row.addEventListener('click', () => joinRoomByCode(r.id));
        el.appendChild(row);
    });
}
startRoomListPolling();

document.getElementById('offline-btn').addEventListener('click', () => {
    playerName = getPlayerName();
    isMultiplayer = false;
    showCarSelectOverlay();
});

// ---- Touch driving controls (tablets/phones): steer/gas/brake set the same
// gameKeys the keyboard uses; the item button replays a Space press so it goes
// through the existing item logic. The overlay is shown by CSS only while the
// race HUD is on screen (body.in-race), synced here via a MutationObserver. ----
(function setupTouchControls() {
    document.querySelectorAll('#touch-controls [data-key]').forEach((b) => {
        const code = b.dataset.key;
        const down = (e) => { e.preventDefault(); if (code === 'Space') window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' })); else gameKeys[code] = true; };
        const up = (e) => { e.preventDefault(); if (code !== 'Space') gameKeys[code] = false; };
        b.addEventListener('pointerdown', down);
        b.addEventListener('pointerup', up);
        b.addEventListener('pointerleave', up);
        b.addEventListener('pointercancel', up);
    });
    const hud = document.getElementById('hud');
    if (hud && window.MutationObserver) {
        new MutationObserver(() => {
            document.body.classList.toggle('in-race', !!hud.style.display && hud.style.display !== 'none');
        }).observe(hud, { attributes: true, attributeFilter: ['style'] });
    }
})();

// In the room lobby, open vehicle (and, for the host, track) selection.
document.getElementById('lobby-pick-btn').addEventListener('click', () => {
    showCarSelectOverlay();
});

// Leave car-select without changing anything — back to the room lobby.
document.getElementById('car-back-btn').addEventListener('click', () => {
    enterLobby();
});

// Room chat
document.getElementById('chat-send').addEventListener('click', sendChat);
document.getElementById('chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); sendChat(); }
});

document.getElementById('lobby-start-btn').addEventListener('click', () => {
    if (!isHost) return;
    socket.emit('start-race', { trackId: selectedTrackId });
});

document.getElementById('lobby-cup-btn').addEventListener('click', () => {
    if (!isHost) return;
    // Race every track in order; the server tallies position points across all
    // of them into one overall ranking.
    socket.emit('start-cup', { trackIds: TRACKS.map(t => t.id) });
});

// --- Host: rename the room ---
document.getElementById('room-rename-btn').addEventListener('click', () => {
    if (!isHost) return;
    const input = document.getElementById('room-name-input');
    input.value = currentRoomName || '';
    document.getElementById('room-rename-edit').style.display = 'flex';
    input.focus();
    input.select();
});
function saveRoomName() {
    const name = document.getElementById('room-name-input').value.trim();
    if (name && socket) socket.emit('rename-room', { name });
    document.getElementById('room-rename-edit').style.display = 'none';
}
document.getElementById('room-rename-save').addEventListener('click', saveRoomName);
document.getElementById('room-rename-cancel').addEventListener('click', () => {
    document.getElementById('room-rename-edit').style.display = 'none';
});
document.getElementById('room-name-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); saveRoomName(); }
    else if (e.key === 'Escape') { document.getElementById('room-rename-edit').style.display = 'none'; }
});

function sendPositionUpdate() {
    if (!isMultiplayer || !socket || !playerCar) return;
    if (!socket.connected) return; // don't queue positions while reconnecting
    // Pack the player's authoritative effect state into a bitmask so ghosts on
    // other clients show the RIGHT visual (dizzy stars / stun) instead of a
    // fabricated one from local physics.
    let fx = 0;
    if (playerCar.dizzyTimer > 0) fx |= 1;
    if (playerCar.stunTimer > 0) fx |= 2;
    if (playerCar.invincibleTimer > 0) fx |= 4;
    const updateData = {
        pos: { x: playerCar.pos.x, y: playerCar.pos.y, z: playerCar.pos.z },
        rotY: playerCar.rotY,
        speed: playerCar.speed,
        boostTimer: playerCar.boostTimer,
        fx
    };
    // Volatile: only the latest position matters, so drop it rather than buffer
    // it on a congested link (buffer buildup is what forces a disconnect).
    socket.volatile.emit('update-position', updateData);
}

function sendItemUse(item) {
    if (!isMultiplayer || !socket) return;
    socket.emit('use-item', { item: item });
}

function sendLapComplete(lap) {
    if (!isMultiplayer || !socket) return;
    socket.emit('lap-complete', lap);
}

function sendRaceFinish(finishTime) {
    if (!isMultiplayer || !socket) return;
    socket.emit('race-finish', { finishTime: finishTime });
}

// ============================================================
// QUIZ SYSTEM - Load questions from files
// ============================================================

// Configuration
const QUIZ_CONFIG = {
    questionsPerStop: 3,           // Number of questions per pit stop
    penaltySeconds: 1,             // Seconds to halt car per wrong answer
    oilThreshold: 50,              // Oil level that forces pit stop (percentage)
    pitCooldownDuration: 180       // Frames before can pit again (3 seconds at 60fps)
};

// Questions follow questions/SCHEMA.md (JSON, one file per topic, listed in
// questions/index.json). `allQuestions` holds everything (for an out-of-game
// test); `mcQuestions` is the subset the racing game can use: short,
// multiple-choice, no figure/math.
const IN_GAME_MAX_TIME = 8;  // seconds — only quick questions go in the race
let allQuestions = [];
let mcQuestions = [];
let typingQuestions = [];
let questionsLoaded = false;

const FALLBACK_QUESTIONS = [
    { topic: "arithmetic", prompt: "What is 3 + 5?", answer: "8", choices: ["6", "8", "10", "12"], time: 3 },
    { topic: "arithmetic", prompt: "What is 4 × 6?", answer: "24", choices: ["18", "24", "30", "36"], time: 4 },
    { topic: "general", prompt: "What planet do we live on?", answer: "earth", choices: ["mars", "earth", "venus", "jupiter"], time: 4 },
    { topic: "general", prompt: "How many legs does a dog have?", answer: "4", choices: ["2", "3", "4", "6"], time: 3 },
];

function isInGameQuestion(q) {
    return Array.isArray(q.choices) && q.choices.length >= 2 && !q.figure && !q.math &&
        (q.time == null || q.time <= IN_GAME_MAX_TIME) &&
        // has to be readable at racing speed, and short enough to fit a door label
        String(q.prompt).length <= 90 && q.choices.every(c => String(c).length <= 22);
}

function normalizeQuestions(list) {
    return list
        .filter(q => q && q.prompt && q.answer != null)
        .map(q => Object.assign({}, q, { question: q.prompt, answer: String(q.answer) })); // `question` alias for compat
}

function loadQuestions() {
    const local = fetch("questions/index.json")
        .then(r => r.json())
        .then(topics => Promise.all(topics.map(t =>
            fetch(`questions/${t}.json`).then(r => r.json()).catch(() => []))))
        .then(lists => [].concat(...lists))
        .catch(() => []);
    // The handful of questions shipped here came round again every few laps, so
    // the bank is topped up from the sibling quiz project (same feed the tower and
    // dodge games use). Best-effort: if that project isn't there we just race on
    // the local set.
    const shared = fetch("/quiz/mcq")
        .then(r => r.json())
        .then(d => (d.questions || []).map(q => ({ topic: q.topic || "quiz", prompt: q.prompt, answer: q.answer, choices: q.choices })))
        .catch(() => []);

    Promise.all([local, shared]).then(([a, b]) => {
        const merged = normalizeQuestions([...a, ...b]);
        const seen = new Set();
        allQuestions = merged.filter(q => {
            const k = String(q.prompt).trim().toLowerCase();
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
        });
        mcQuestions = allQuestions.filter(isInGameQuestion);
        typingQuestions = allQuestions.filter(q => !q.choices);
        if (mcQuestions.length === 0) { allQuestions = normalizeQuestions(FALLBACK_QUESTIONS); mcQuestions = allQuestions.slice(); }
        questionsLoaded = true;
        window._questionPool = { total: allQuestions.length, inGame: mcQuestions.length }; // for tools/tests
    });
}

loadQuestions();

function getRandomQuestion() {
    const pool = [...mcQuestions, ...typingQuestions];
    if (pool.length === 0) {
        return { question: "What is 1 + 1?", answer: "2", type: "typing" };
    }
    return pool[Math.floor(Math.random() * pool.length)];
}

// ============================================================
// QUIZ UI
// ============================================================
let quizActive = false;
let quizResult = null;
let quizQuestion = null;
let quizTimer = null;
let quizTimeLeft = 15;
let quizCurrentQuestionIndex = 0;
let quizCorrectCount = 0;
let quizWrongCount = 0;
let quizPenaltyTimer = 0;
const quizOverlay = document.getElementById("quiz-overlay");
const quizQuestionEl = document.getElementById("quiz-question");
const quizChoicesEl = document.getElementById("quiz-choices");
const quizTypingArea = document.getElementById("quiz-typing-area");
const quizInput = document.getElementById("quiz-input");
const quizSubmit = document.getElementById("quiz-submit");
const quizFeedback = document.getElementById("quiz-feedback");
const quizTimerFill = document.getElementById("quiz-timer-fill");

function startQuiz() {
    quizActive = true;
    quizResult = null;
    quizCurrentQuestionIndex = 0;
    quizCorrectCount = 0;
    quizWrongCount = 0;
    showNextQuestion();
}

function showNextQuestion() {
    quizQuestion = getRandomQuestion();
    quizResult = null;
    quizQuestionEl.textContent = `Question ${quizCurrentQuestionIndex + 1}/${QUIZ_CONFIG.questionsPerStop}: ${quizQuestion.question}`;
    quizFeedback.textContent = "";
    quizFeedback.className = "";

    if (quizQuestion.type === "mc") {
        quizChoicesEl.style.display = "flex";
        quizTypingArea.classList.remove("active");
        quizChoicesEl.innerHTML = "";
        const shuffled = [...quizQuestion.choices].sort(() => Math.random() - 0.5);
        shuffled.forEach(choice => {
            const btn = document.createElement("button");
            btn.className = "quiz-choice";
            btn.textContent = choice;
            btn.addEventListener("click", () => handleQuizAnswer(choice));
            quizChoicesEl.appendChild(btn);
        });
    } else {
        quizChoicesEl.style.display = "none";
        quizTypingArea.classList.add("active");
        quizInput.value = "";
        setTimeout(() => quizInput.focus(), 100);
    }

    quizOverlay.style.display = "flex";

    quizTimeLeft = 15;
    quizTimerFill.style.width = "100%";

    if (quizTimer) clearInterval(quizTimer);
    quizTimer = setInterval(() => {
        quizTimeLeft -= 0.1;
        quizTimerFill.style.width = Math.max(0, (quizTimeLeft / 15) * 100) + "%";
        if (quizTimeLeft <= 5) {
            quizTimerFill.style.background = "#ff4444";
        } else {
            quizTimerFill.style.background = "#55aaff";
        }
        if (quizTimeLeft <= 0) {
            handleQuizAnswer(null);
        }
    }, 100);
}

function handleQuizAnswer(answer) {
    if (quizResult !== null) return;
    if (quizTimer) clearInterval(quizTimer);

    const correct = answer !== null && answer.toLowerCase() === quizQuestion.answer.toLowerCase();
    quizResult = correct;

    if (quizQuestion.type === "mc") {
        const btns = quizChoicesEl.querySelectorAll(".quiz-choice");
        btns.forEach(btn => {
            btn.style.pointerEvents = "none";
            if (btn.textContent === quizQuestion.answer || btn.textContent.toLowerCase() === quizQuestion.answer.toLowerCase()) {
                btn.classList.add("correct");
            } else if (btn.textContent === answer) {
                btn.classList.add("wrong");
            }
        });
    }

    if (correct) {
        quizCorrectCount++;
        quizFeedback.textContent = `Correct! (${quizCorrectCount}/${QUIZ_CONFIG.questionsPerStop})`;
        quizFeedback.className = "quiz-correct";
        SoundManager.quizCorrect();
    } else {
        quizWrongCount++;
        quizFeedback.textContent = `Wrong! +${QUIZ_CONFIG.penaltySeconds}s penalty`;
        quizFeedback.className = "quiz-wrong";
        SoundManager.quizWrong();
    }

    quizCurrentQuestionIndex++;

    if (quizCurrentQuestionIndex < QUIZ_CONFIG.questionsPerStop) {
        setTimeout(() => {
            showNextQuestion();
        }, 1000);
    } else {
        const totalPenaltyFrames = quizWrongCount * QUIZ_CONFIG.penaltySeconds * 60;
        setTimeout(() => {
            quizOverlay.style.display = "none";
            quizActive = false;
            quizResult = null;
            quizQuestion = null;
            if (playerCar) {
                playerCar.pitCooldown = QUIZ_CONFIG.pitCooldownDuration;
                playerCar.stunTimer = totalPenaltyFrames;
            }
            Object.keys(gameKeys).forEach(k => { gameKeys[k] = false; });
            document.activeElement.blur();
            canvas.focus();
        }, 1500);
    }
}

quizSubmit.addEventListener("click", () => {
    if (quizActive && quizQuestion && quizQuestion.type === "typing") {
        handleQuizAnswer(quizInput.value);
    }
});
quizInput.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter" && quizActive && quizQuestion && quizQuestion.type === "typing") {
        handleQuizAnswer(quizInput.value);
    }
});
quizInput.addEventListener("keyup", (e) => { e.stopPropagation(); });
quizInput.addEventListener("keypress", (e) => { e.stopPropagation(); });

// ============================================================
// SOUND SYSTEM - Web Audio API synthesized sounds
// ============================================================

const SoundManager = (() => {
    let ctx = null;
    let engineOsc = null;
    let engineGain = null;
    let engineOsc2 = null;
    let engineGain2 = null;
    let engineOsc3 = null;
    let engineGain3 = null;
    let engineSub = null;
    let engineSubGain = null;
    let engineNoise = null;
    let engineNoiseGain = null;
    let engineFilter = null;
    let enginePulse = null;      // amplitude gate driven by the firing-rate LFO
    let engineLFO = null;        // firing-rate oscillator (the "putt-putt")
    let engineLFODepth = null;
    let engineRunning = false;
    let masterGain = null;
    // Real engine sample (Pixabay) — looped through Web Audio so playbackRate
    // revs the pitch with speed. Falls back to the synth engine if not loaded.
    let engineBuffer = null, engineSampleLoading = false, engineSampleSrc = null, engineSampleGain = null;

    function loadEngineSample() {
        if (engineBuffer || engineSampleLoading || !ctx) return;
        engineSampleLoading = true;
        fetch("assets/audio/sfx/engine.mp3")
            .then((r) => r.arrayBuffer())
            .then((ab) => ctx.decodeAudioData(ab))
            .then((buf) => { engineBuffer = buf; })
            .catch(() => { engineSampleLoading = false; });
    }

    function init() {
        loadSfx(); // preload the Pixabay SFX (HTMLAudio, no AudioContext needed)
        if (ctx) return;
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        masterGain = ctx.createGain();
        masterGain.gain.value = 0.4;
        masterGain.connect(ctx.destination);
        loadEngineSample(); // decode the real engine loop for the buffer engine
    }

    function resume() {
        if (ctx && ctx.state === "suspended") ctx.resume();
    }

    // ============================================================
    // Real audio (Pixabay, CC0) — streamed HTMLAudio. Music loops one of 10
    // racing tracks per race; SFX play from small pools so they can overlap.
    // Everything falls back to the synthesized sounds if a file won't load.
    // ============================================================
    // (engine.mp3 is handled separately by the buffer engine, not as a one-shot.)
    const SFX_VOL = {
        boost: 0.55, crash: 0.6, hit: 0.6, pickup: 0.5, coin: 0.5, lap: 0.5,
        win: 0.6, countdown: 0.5, click: 0.4, start: 0.55, horn: 0.7,
    };
    const sfxPools = {};
    let sfxReady = false;

    function loadSfx() {
        if (sfxReady) return;
        sfxReady = true;
        for (const key of Object.keys(SFX_VOL)) {
            const pool = Array.from({ length: 3 }, () => {
                const a = new Audio(`assets/audio/sfx/${key}.mp3`);
                a.preload = "auto"; a.volume = SFX_VOL[key];
                a.addEventListener("error", () => { pool._broken = true; });
                return a;
            });
            pool._i = 0;
            sfxPools[key] = pool;
        }
    }

    // Returns false if the sample is missing/broken so callers fall back to synth.
    function playSfx(key, volScale) {
        const pool = sfxPools[key];
        if (!pool || pool._broken) return false;
        const a = pool[pool._i++ % pool.length];
        try {
            a.currentTime = 0;
            a.volume = Math.min(1, (SFX_VOL[key] || 0.5) * (volScale == null ? 1 : volScale));
            const p = a.play();
            if (p && p.catch) p.catch(() => {});
            return true;
        } catch (e) { return false; }
    }

    // ---- Background music (10 racing tracks) ----
    let musicEl = null, musicTracks = null, _lastTrackIdx = -1;

    async function ensureTracks() {
        if (musicTracks) return musicTracks;
        try { musicTracks = await fetch("assets/audio/music/tracks.json").then(r => r.json()); }
        catch (e) { musicTracks = []; }
        return musicTracks;
    }

    function fadeAudio(el, to, ms, done) {
        const from = el.volume, steps = 16, dt = Math.max(16, ms / steps);
        let k = 0;
        const iv = setInterval(() => {
            k++;
            try { el.volume = Math.max(0, Math.min(1, from + (to - from) * (k / steps))); } catch (e) {}
            if (k >= steps) { clearInterval(iv); if (done) done(); }
        }, dt);
    }

    function startEngine() {
        if (!ctx || engineRunning) return;

        // Real engine sample, looped; speed drives its playback rate (revs).
        if (engineBuffer) {
            engineSampleGain = ctx.createGain();
            engineSampleGain.gain.value = 0.0001;
            engineSampleGain.connect(masterGain);
            engineSampleSrc = ctx.createBufferSource();
            engineSampleSrc.buffer = engineBuffer;
            engineSampleSrc.loop = true;
            engineSampleSrc.playbackRate.value = 0.85;
            engineSampleSrc.connect(engineSampleGain);
            engineSampleSrc.start();
            engineRunning = true;
            window._engineMode = "sample"; // exposed for tools/headless tests
            return;
        }

        // Resonant low-pass gives the engine its "growl"; it opens up with revs.
        engineFilter = ctx.createBiquadFilter();
        engineFilter.type = "lowpass";
        engineFilter.frequency.value = 600;
        engineFilter.Q.value = 6;

        // The firing-rate LFO gates the whole engine's amplitude, producing the
        // characteristic putt-putt at idle that smooths into a tone at speed.
        enginePulse = ctx.createGain();
        enginePulse.gain.value = 0.4; // overall engine level (turned down vs music)
        engineFilter.connect(enginePulse);
        enginePulse.connect(masterGain);

        engineLFO = ctx.createOscillator();
        engineLFO.type = "sawtooth";
        engineLFO.frequency.value = 25;
        engineLFODepth = ctx.createGain();
        engineLFODepth.gain.value = 0.22;
        engineLFO.connect(engineLFODepth);
        engineLFODepth.connect(enginePulse.gain);
        engineLFO.start();

        // Sub-oscillator: low body/rumble.
        engineSub = ctx.createOscillator();
        engineSubGain = ctx.createGain();
        engineSub.type = "sine";
        engineSub.frequency.value = 30;
        engineSubGain.gain.value = 0;
        engineSub.connect(engineSubGain);
        engineSubGain.connect(engineFilter);
        engineSub.start();

        // Fundamental saw.
        engineOsc = ctx.createOscillator();
        engineGain = ctx.createGain();
        engineOsc.type = "sawtooth";
        engineOsc.frequency.value = 55;
        engineGain.gain.value = 0;
        engineOsc.connect(engineGain);
        engineGain.connect(engineFilter);
        engineOsc.start();

        // Detuned saw an octave up for a thicker, beating texture.
        engineOsc2 = ctx.createOscillator();
        engineGain2 = ctx.createGain();
        engineOsc2.type = "sawtooth";
        engineOsc2.frequency.value = 110;
        engineOsc2.detune.value = 12;
        engineGain2.gain.value = 0;
        engineOsc2.connect(engineGain2);
        engineGain2.connect(engineFilter);
        engineOsc2.start();

        // Square harmonic for the metallic edge.
        engineOsc3 = ctx.createOscillator();
        engineGain3 = ctx.createGain();
        engineOsc3.type = "square";
        engineOsc3.frequency.value = 82.5;
        engineGain3.gain.value = 0;
        engineOsc3.connect(engineGain3);
        engineGain3.connect(engineFilter);
        engineOsc3.start();

        // Exhaust hiss.
        const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const noiseData = noiseBuf.getChannelData(0);
        for (let i = 0; i < noiseData.length; i++) {
            noiseData[i] = (Math.random() * 2 - 1) * 0.5;
        }
        engineNoise = ctx.createBufferSource();
        engineNoise.buffer = noiseBuf;
        engineNoise.loop = true;
        engineNoiseGain = ctx.createGain();
        engineNoiseGain.gain.value = 0;
        const noiseFilter = ctx.createBiquadFilter();
        noiseFilter.type = "bandpass";
        noiseFilter.frequency.value = 220;
        noiseFilter.Q.value = 0.6;
        engineNoise.connect(noiseFilter);
        noiseFilter.connect(engineNoiseGain);
        engineNoiseGain.connect(enginePulse);
        engineNoise.start();

        engineRunning = true;
        window._engineMode = "synth"; // exposed for tools/headless tests
    }

    function updateEngine(speed, maxSpeed) {
        if (!engineRunning || !ctx) return;

        // Real-sample engine: rev the pitch + raise volume with speed.
        if (engineSampleSrc) {
            const r = Math.min(1, Math.abs(speed) / (maxSpeed || 1));
            const t = ctx.currentTime;
            engineSampleSrc.playbackRate.setTargetAtTime(0.85 + r * 1.05, t, 0.08); // idle → high rev
            engineSampleGain.gain.setTargetAtTime(0.16 + r * 0.5, t, 0.1);
            return;
        }

        const ratio = Math.min(1, Math.abs(speed) / maxSpeed);
        const rpm = 850 + Math.pow(ratio, 0.85) * 6500;
        const baseFreq = rpm / 60;       // ~14 Hz idle -> ~123 Hz redline
        const t = ctx.currentTime;
        const k = 0.06;

        engineSub.frequency.setTargetAtTime(baseFreq, t, k);
        engineSubGain.gain.setTargetAtTime(0.06 + ratio * 0.05, t, k);

        engineOsc.frequency.setTargetAtTime(baseFreq, t, k);
        engineGain.gain.setTargetAtTime(0.05 + ratio * 0.08, t, k);

        engineOsc2.frequency.setTargetAtTime(baseFreq * 2, t, k);
        engineGain2.gain.setTargetAtTime(0.02 + ratio * 0.06, t, k);

        engineOsc3.frequency.setTargetAtTime(baseFreq * 1.5, t, k);
        engineGain3.gain.setTargetAtTime(0.015 + ratio * 0.05, t, k);

        // Firing pulse follows the revs; it deepens at idle, softens at speed.
        engineLFO.frequency.setTargetAtTime(baseFreq, t, k);
        engineLFODepth.gain.setTargetAtTime(0.26 - ratio * 0.18, t, k);

        engineFilter.frequency.setTargetAtTime(450 + ratio * 2600, t, 0.08);
        engineFilter.Q.setTargetAtTime(7 - ratio * 4, t, 0.08);

        engineNoiseGain.gain.setTargetAtTime(0.012 + ratio * 0.04, t, 0.1);
    }

    function stopEngine() {
        if (engineSampleSrc) {
            try { engineSampleSrc.stop(); } catch (e) {}
            try { engineSampleSrc.disconnect(); engineSampleGain.disconnect(); } catch (e) {}
            engineSampleSrc = null; engineSampleGain = null;
            engineRunning = false;
            return;
        }
        if (engineOsc) { engineOsc.stop(); engineOsc = null; }
        if (engineOsc2) { engineOsc2.stop(); engineOsc2 = null; }
        if (engineOsc3) { engineOsc3.stop(); engineOsc3 = null; }
        if (engineSub) { engineSub.stop(); engineSub = null; }
        if (engineLFO) { engineLFO.stop(); engineLFO = null; }
        if (engineNoise) { engineNoise.stop(); engineNoise = null; }
        engineRunning = false;
    }

    function beep(freq, duration, vol, type) {
        if (!ctx) return;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = type || "square";
        osc.frequency.value = freq;
        g.gain.value = vol || 0.15;
        g.gain.setTargetAtTime(0, ctx.currentTime + duration * 0.7, duration * 0.15);
        osc.connect(g);
        g.connect(masterGain);
        osc.start();
        osc.stop(ctx.currentTime + duration);
    }

    function countdownBeep() { if (playSfx('countdown')) return; beep(440, 0.15, 0.2, "square"); }
    function countdownGo() { if (playSfx('start')) return; beep(880, 0.3, 0.25, "square"); }
    function win() { playSfx('win'); }

    function itemPickup() {
        if (playSfx('pickup')) return;
        // Prefer the Kenney sample; fall back to synthesized sound if not loaded.
        if (AssetManager.playSound('pickup')) return;
        if (!ctx) return;
        beep(600, 0.08, 0.15, "sine");
        setTimeout(() => beep(900, 0.1, 0.15, "sine"), 80);
    }

    function boost() {
        if (playSfx('boost')) return;
        if (!ctx) return;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = "sawtooth";
        osc.frequency.value = 200;
        osc.frequency.linearRampToValueAtTime(800, ctx.currentTime + 0.3);
        g.gain.value = 0.15;
        g.gain.setTargetAtTime(0, ctx.currentTime + 0.25, 0.08);
        osc.connect(g);
        g.connect(masterGain);
        osc.start();
        osc.stop(ctx.currentTime + 0.4);
    }

    function fireball() {
        if (!ctx) return;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = "sawtooth";
        osc.frequency.value = 500;
        osc.frequency.linearRampToValueAtTime(100, ctx.currentTime + 0.3);
        g.gain.value = 0.18;
        g.gain.setTargetAtTime(0, ctx.currentTime + 0.2, 0.06);
        osc.connect(g);
        g.connect(masterGain);
        osc.start();
        osc.stop(ctx.currentTime + 0.35);
    }

    function shield() {
        if (!ctx) return;
        beep(500, 0.1, 0.12, "sine");
        setTimeout(() => beep(700, 0.1, 0.12, "sine"), 100);
        setTimeout(() => beep(1000, 0.15, 0.12, "sine"), 200);
    }

    function lightning() {
        if (!ctx) return;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = "sawtooth";
        osc.frequency.value = 1200;
        osc.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.4);
        g.gain.value = 0.2;
        g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
        osc.connect(g);
        g.connect(masterGain);
        osc.start();
        osc.stop(ctx.currentTime + 0.5);
    }

    function banana() {
        if (!ctx) return;
        beep(300, 0.08, 0.1, "square");
        setTimeout(() => beep(200, 0.1, 0.1, "square"), 80);
    }

    function star() {
        if (!ctx) return;
        beep(600, 0.08, 0.15, "sine");
        setTimeout(() => beep(800, 0.08, 0.15, "sine"), 80);
        setTimeout(() => beep(1000, 0.08, 0.15, "sine"), 160);
        setTimeout(() => beep(1200, 0.12, 0.15, "sine"), 240);
    }

    function oil() {
        if (!ctx) return;
        const bufSize = ctx.sampleRate * 0.15;
        const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * 0.3;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = 400;
        const g = ctx.createGain();
        g.gain.value = 0.15;
        g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
        src.connect(filter);
        filter.connect(g);
        g.connect(masterGain);
        src.start();
    }

    function hit() {
        if (playSfx('hit')) return;
        // Prefer the Kenney sample; fall back to synthesized sound if not loaded.
        if (AssetManager.playSound('hit')) return;
        if (!ctx) return;
        const bufSize = ctx.sampleRate * 0.2;
        const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufSize);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const g = ctx.createGain();
        g.gain.value = 0.25;
        g.gain.setTargetAtTime(0, ctx.currentTime + 0.1, 0.05);
        src.connect(g);
        g.connect(masterGain);
        src.start();
    }

    function collision() {
        if (playSfx('crash', 0.7)) return;
        // Prefer the Kenney sample; fall back to synthesized sound if not loaded.
        if (AssetManager.playSound('collision')) return;
        if (!ctx) return;
        const bufSize = ctx.sampleRate * 0.15;
        const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufSize) * 0.5;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = 800;
        const g = ctx.createGain();
        g.gain.value = 0.3;
        g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
        src.connect(filter);
        filter.connect(g);
        g.connect(masterGain);
        src.start();
    }

    function lapComplete() {
        if (playSfx('lap')) return;
        // A Kenney bell toll for crossing the line, with a synth arpeggio fallback.
        if (AssetManager.playSound('lap')) return;
        if (!ctx) return;
        beep(523, 0.1, 0.18, "sine");
        setTimeout(() => beep(659, 0.1, 0.18, "sine"), 100);
        setTimeout(() => beep(784, 0.15, 0.2, "sine"), 200);
    }

    function quizCorrect() {
        if (!ctx) return;
        beep(523, 0.12, 0.15, "sine");
        setTimeout(() => beep(659, 0.12, 0.15, "sine"), 120);
        setTimeout(() => beep(784, 0.2, 0.18, "sine"), 240);
    }

    function quizWrong() {
        if (!ctx) return;
        beep(300, 0.15, 0.15, "sawtooth");
        setTimeout(() => beep(200, 0.25, 0.15, "sawtooth"), 150);
    }

    function oilWarning() { beep(220, 0.08, 0.08, "square"); }

    function trainHorn() {
        if (playSfx('horn')) return;
        if (!ctx) return;
        // Two-tone diesel horn: a pair of detuned sawtooths, held then released.
        for (const f of [311, 415]) {
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.type = "sawtooth";
            o.frequency.value = f;
            g.gain.value = 0.14;
            g.gain.setValueAtTime(0.14, ctx.currentTime + 0.55);
            g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.85);
            o.connect(g); g.connect(masterGain);
            o.start(); o.stop(ctx.currentTime + 0.9);
        }
    }

    function crossingBell() { beep(990, 0.07, 0.1, "square"); }

    // Shout the item's name out loud (Web Speech API). Best-effort: silently
    // does nothing if the browser has no voices available.
    function yell(text) {
        if (!text || !window.speechSynthesis) return;
        try {
            speechSynthesis.cancel();
            const u = new SpeechSynthesisUtterance(text);
            u.rate = 1.3;
            u.pitch = 1.4;
            u.volume = 1;
            speechSynthesis.speak(u);
        } catch (e) {}
    }

    function bubbleSound() {
        if (!ctx) return;
        // Rising watery bloop.
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = "sine";
        o.frequency.setValueAtTime(240, ctx.currentTime);
        o.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.35);
        g.gain.value = 0.18;
        g.gain.setTargetAtTime(0, ctx.currentTime + 0.3, 0.08);
        o.connect(g); g.connect(masterGain);
        o.start(); o.stop(ctx.currentTime + 0.45);
    }

    function popSound() {
        if (!ctx) return;
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = "square";
        o.frequency.setValueAtTime(900, ctx.currentTime);
        o.frequency.exponentialRampToValueAtTime(180, ctx.currentTime + 0.09);
        g.gain.value = 0.22;
        g.gain.setTargetAtTime(0, ctx.currentTime + 0.05, 0.03);
        o.connect(g); g.connect(masterGain);
        o.start(); o.stop(ctx.currentTime + 0.13);
    }

    function tornadoSound() {
        if (!ctx) return;
        // Swirling whoosh: filtered noise swept up and back down.
        const dur = 1.4;
        const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const f = ctx.createBiquadFilter();
        f.type = "bandpass";
        f.Q.value = 1.2;
        f.frequency.setValueAtTime(250, ctx.currentTime);
        f.frequency.linearRampToValueAtTime(1500, ctx.currentTime + dur * 0.55);
        f.frequency.linearRampToValueAtTime(350, ctx.currentTime + dur);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.04, ctx.currentTime);
        g.gain.linearRampToValueAtTime(0.32, ctx.currentTime + 0.25);
        g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + dur);
        src.connect(f); f.connect(g); g.connect(masterGain);
        src.start(); src.stop(ctx.currentTime + dur);
    }

    function fartSound() {
        if (!ctx) return;
        // Low sputtering raspberry: descending sawtooth chopped by a fast LFO.
        const t = ctx.currentTime, dur = 0.7;
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.setValueAtTime(115, t);
        o.frequency.linearRampToValueAtTime(50, t + dur);
        const lfo = ctx.createOscillator(), lfoG = ctx.createGain();
        lfo.type = "square";
        lfo.frequency.value = 24;
        lfoG.gain.value = 0.35;
        const f = ctx.createBiquadFilter();
        f.type = "lowpass";
        f.frequency.value = 300;
        const g = ctx.createGain();
        g.gain.value = 0.4;
        g.gain.setTargetAtTime(0, t + dur * 0.7, 0.1);
        lfo.connect(lfoG); lfoG.connect(g.gain);
        o.connect(f); f.connect(g); g.connect(masterGain);
        o.start(); lfo.start();
        o.stop(t + dur + 0.1); lfo.stop(t + dur + 0.1);
    }

    // ----- Background music (procedural chiptune loops with a drum kit) -----
    let musicTimer = null;
    let musicBus = null;
    let musicStep = 0;
    const N = {
        _: 0,
        E2: 82.41, F2: 87.31, G2: 98.0, A2: 110.0, B2: 123.47,
        C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196.0, A3: 220.0, B3: 246.94,
        C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0, B4: 493.88,
        C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.0,
    };
    // 16-step loops at racing tempo: a driving bass pumping on EVERY step,
    // four-on-the-floor kicks, off-beat snares and a punchy lead hook with
    // rests ("_") for groove — much more "race day" than the old laid-back loops.
    const MUSIC_TRACKS = [
        {   // Full Throttle — bright C major sprint
            step: 120,
            bass: ["C3", "C3", "G2", "C3", "F2", "F2", "C3", "F2", "G2", "G2", "D3", "G2", "A2", "A2", "E3", "G2"],
            lead: ["E5", "_", "G5", "_", "A5", "G5", "E5", "_", "C5", "D5", "E5", "_", "D5", "_", "B4", "D5"],
            arp:  ["C4", "E4", "G4", "C5", "F3", "A3", "C4", "F4", "G3", "B3", "D4", "G4", "A3", "C4", "E4", "A4"],
            drums: "k--sk--sk--sk-ss",
        },
        {   // Overdrive — urgent A minor charge
            step: 112,
            bass: ["A2", "A2", "A2", "C3", "D3", "D3", "D3", "C3", "F2", "F2", "F2", "A2", "E2", "E2", "G2", "B2"],
            lead: ["A4", "C5", "E5", "_", "F5", "E5", "D5", "C5", "D5", "_", "F5", "D5", "E5", "_", "B4", "C5"],
            arp:  ["A3", "E4", "A4", "E4", "D4", "F4", "A4", "F4", "F3", "C4", "F4", "C4", "E4", "B4", "E4", "B4"],
            drums: "k-sk-k-sk-sk-kss",
        },
        {   // Victory Lap — bouncy F major celebration
            step: 126,
            bass: ["F2", "F2", "C3", "F2", "G2", "G2", "D3", "G2", "A2", "A2", "E3", "A2", "C3", "C3", "G2", "C3"],
            lead: ["A4", "_", "C5", "A4", "B4", "_", "D5", "B4", "C5", "E5", "_", "C5", "E5", "D5", "C5", "G4"],
            arp:  ["F3", "A3", "C4", "A3", "G3", "B3", "D4", "B3", "A3", "C4", "E4", "C4", "C4", "E4", "G4", "E4"],
            drums: "k--sk-k-k--sk-ks",
        },
    ];

    function playMusicNote(freq, dur, type, vol) {
        if (!freq) return;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = type;
        o.frequency.value = freq;
        g.gain.value = 0;
        g.gain.linearRampToValueAtTime(vol, ctx.currentTime + 0.012);
        g.gain.setTargetAtTime(0, ctx.currentTime + dur * 0.55, dur * 0.22);
        o.connect(g);
        g.connect(musicBus);
        o.start();
        o.stop(ctx.currentTime + dur + 0.05);
    }

    function playKick(vol) {
        const t = ctx.currentTime;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "sine";
        o.frequency.setValueAtTime(150, t);
        o.frequency.exponentialRampToValueAtTime(50, t + 0.11);
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
        o.connect(g);
        g.connect(musicBus);
        o.start(t);
        o.stop(t + 0.18);
    }

    function playNoise(vol, dur, hp) {
        const t = ctx.currentTime;
        const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const f = ctx.createBiquadFilter();
        f.type = "highpass";
        f.frequency.value = hp;
        const g = ctx.createGain();
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        src.connect(f);
        f.connect(g);
        g.connect(musicBus);
        src.start(t);
        src.stop(t + dur + 0.02);
    }

    function startProceduralMusic(idx) {
        if (!ctx || musicTimer) return;
        const track = MUSIC_TRACKS[(idx == null ? Math.floor(Math.random() * MUSIC_TRACKS.length) : idx) % MUSIC_TRACKS.length];
        musicBus = ctx.createGain();
        musicBus.gain.value = 0;
        musicBus.gain.setTargetAtTime(0.3, ctx.currentTime, 1.0); // fade in (louder than before)
        musicBus.connect(masterGain);
        musicStep = 0;
        musicTimer = setInterval(() => {
            const s = musicStep % 16;
            const dur = track.step / 1000;

            // Driving bass on EVERY step — this is what makes it feel like racing.
            playMusicNote(N[track.bass[s]], dur * 1.1, "triangle", 0.42);
            // Lead melody hook (with rests for groove).
            playMusicNote(N[track.lead[s]], dur * 0.85, "square", 0.22);
            // Arpeggio sparkle, quieter.
            playMusicNote(N[track.arp[s]], dur * 0.5, "square", 0.09);

            // Drums: kick/snare from the pattern, plus a steady hi-hat tick.
            const hit = track.drums[s];
            if (hit === "k") playKick(0.5);
            else if (hit === "s") playNoise(0.32, 0.13, 1800);
            playNoise(s % 2 === 0 ? 0.07 : 0.11, 0.03, 7000); // hi-hat

            musicStep++;
        }, track.step);
    }

    function stopProceduralMusic() {
        if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
        if (musicBus) {
            const b = musicBus;
            b.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
            setTimeout(() => { try { b.disconnect(); } catch (e) {} }, 800);
            musicBus = null;
        }
    }

    // Background music: loop one of the 10 Pixabay racing tracks; if the files
    // aren't available, fall back to the synthesized chiptune loops.
    async function startMusic(idx) {
        stopMusic();
        const tracks = await ensureTracks();
        if (tracks && tracks.length) {
            let i = (idx == null) ? Math.floor(Math.random() * tracks.length) : (idx % tracks.length);
            if (tracks.length > 1 && i === _lastTrackIdx) i = (i + 1) % tracks.length;
            _lastTrackIdx = i;
            const el = new Audio(`assets/audio/music/${tracks[i].file}`);
            el.loop = true; el.volume = 0;
            const p = el.play();
            if (p && p.catch) p.catch(() => { if (musicEl === el) { musicEl = null; startProceduralMusic(idx); } });
            musicEl = el;
            fadeAudio(el, 0.35, 1400);
            return;
        }
        startProceduralMusic(idx);
    }

    function stopMusic() {
        if (musicEl) {
            const m = musicEl; musicEl = null;
            fadeAudio(m, 0, 400, () => { try { m.pause(); m.removeAttribute("src"); m.load(); } catch (e) {} });
        }
        stopProceduralMusic();
    }

    return {
        init, resume, startEngine, updateEngine, stopEngine,
        countdownBeep, countdownGo, win, itemPickup,
        boost, fireball, shield, hit, collision,
        lightning, banana, star, oil,
        yell, bubbleSound, popSound, tornadoSound, fartSound,
        lapComplete, quizCorrect, quizWrong, oilWarning,
        trainHorn, crossingBell,
        startMusic, stopMusic, playSfx
    };
})();

document.addEventListener("click", () => { SoundManager.init(); SoundManager.resume(); }, { once: false });
document.addEventListener("keydown", () => { SoundManager.init(); SoundManager.resume(); }, { once: false });

// ============================================================
// CAR MODELS
// ============================================================

const CAR_MODELS = [
    {
        id: "race",
        name: "Speedster",
        desc: "Featherweight rocket",
        model: "race-future",
        color: [0.95, 0.2, 0.2],
        stats: { speed: 5, accel: 4, handling: 3, weight: 1, health: 2 },
        weight: 0.7,
        maxSpeed: 1.0,
        acceleration: 0.02,
        turnSpeed: 0.034,
        scale: 1.30,
    },
    {
        id: "formula",
        name: "Formula",
        desc: "Track-day racer",
        model: "race",
        color: [0.2, 0.55, 1.0],
        stats: { speed: 4, accel: 4, handling: 4, weight: 1, health: 2 },
        weight: 0.8,
        maxSpeed: 0.98,
        acceleration: 0.021,
        turnSpeed: 0.038,
        scale: 1.35,
    },
    {
        id: "kart",
        name: "Lil' Kart",
        desc: "Tiny and nimble",
        model: "kart-oobi",
        color: [0.95, 0.75, 0.1],
        stats: { speed: 3, accel: 5, handling: 5, weight: 1, health: 1 },
        weight: 0.6,
        maxSpeed: 0.93,
        acceleration: 0.028,
        turnSpeed: 0.05,
        scale: 0.95,
    },
    {
        id: "sedan",
        name: "Cruiser",
        desc: "Well-rounded all-rounder",
        model: "sedan",
        color: [0.3, 0.75, 0.4],
        stats: { speed: 3, accel: 3, handling: 4, weight: 2, health: 3 },
        weight: 1.0,
        maxSpeed: 0.95,
        acceleration: 0.019,
        turnSpeed: 0.037,
        scale: 1.45,
    },
    {
        id: "taxi",
        name: "Taxi",
        desc: "Steady city cab",
        model: "taxi",
        color: [0.98, 0.8, 0.1],
        stats: { speed: 3, accel: 3, handling: 3, weight: 2, health: 3 },
        weight: 1.1,
        maxSpeed: 0.95,
        acceleration: 0.019,
        turnSpeed: 0.036,
        scale: 1.45,
    },
    {
        id: "suv",
        name: "Bruiser",
        desc: "Heavy, shoves rivals",
        model: "suv",
        color: [0.55, 0.3, 0.85],
        stats: { speed: 4, accel: 2, handling: 3, weight: 4, health: 4 },
        weight: 1.5,
        maxSpeed: 0.97,
        acceleration: 0.017,
        turnSpeed: 0.035,
        scale: 1.55,
    },
    {
        id: "van",
        name: "Hauler",
        desc: "Big and bulky",
        model: "van",
        color: [0.95, 0.5, 0.15],
        stats: { speed: 4, accel: 2, handling: 3, weight: 4, health: 4 },
        weight: 1.7,
        maxSpeed: 0.98,
        acceleration: 0.016,
        turnSpeed: 0.034,
        scale: 1.70,
    },
    {
        id: "truck",
        name: "Tank",
        desc: "Unstoppable wrecking ball",
        model: "truck",
        color: [0.85, 0.2, 0.25],
        stats: { speed: 5, accel: 1, handling: 2, weight: 5, health: 5 },
        weight: 2.2,
        maxSpeed: 1.0,
        acceleration: 0.015,
        turnSpeed: 0.033,
        scale: 1.85,
    },
];

let selectedCarModel = null;

// AI cars cycle through the fleet's models so the pack looks varied.
const VEHICLE_POOL = CAR_MODELS.map(m => m.model);
let _kartCursor = 0;

// ============================================================
// TRACK COURSES
// ============================================================
// Each course is a closed loop, defined one of two ways:
//   - an ellipse (rx, rz) optionally warped by sine harmonics (`warp`), with
//     optional `hills` harmonics that raise/lower the road (up & down hills);
//   - an explicit list of control `points` [x, z, y] smoothed into a closed
//     Catmull-Rom spline — this is how a course gets sharp corners, hairpins,
//     chicanes and designed climbs.
// `features` adds set pieces along the loop (positions are 0..1 around it):
//   { type:"tunnel", from, to, style }          drive-through cave/tunnel
//   { type:"train", at, period }                railway crossing + live train
//   { type:"trap",  at, lane, kind }            oil / ice / mud / spikes
//   { type:"boost", at, lane }                  glowing speed pad
// `theme` drives ground, sky, fog and scenery (forest, desert, city, formula,
// valley, snow, kitchen).
const TRACKS = [
    {
        id: 0,
        name: "Sunny Oval",
        icon: "🌞",
        desc: "A gentle beginner loop",
        rx: 200, rz: 95, warp: [],
        features: [{ type: "boost", at: 0.5, lane: 0 }],
        theme: {
            ground: [0.22, 0.55, 0.16],
            sky: "day",
            scenery: "forest",
            fog: [0.61, 0.75, 0.87], fogStart: 160, fogEnd: 470,
        },
    },
    {
        id: 1,
        name: "Forest Hills",
        icon: "🌲",
        desc: "Rolling woodland with a dark tree-cave",
        rx: 185, rz: 112, warp: [{ k: 2, ax: 42, az: 30, phase: 0.6 }],
        hills: [{ k: 2, amp: 6, phase: 0.5 }, { k: 1, amp: 4, phase: 2.0 }],
        features: [
            { type: "tunnel", from: 0.52, to: 0.66, style: "rock" },
            { type: "trap", at: 0.3, lane: -1, kind: "mud" },
            { type: "trap", at: 0.82, lane: 1, kind: "mud" },
            { type: "boost", at: 0.72, lane: 0 },
        ],
        theme: {
            ground: [0.16, 0.43, 0.12],
            sky: "day",
            scenery: "forest",
            fog: [0.58, 0.7, 0.8], fogStart: 130, fogEnd: 430,
        },
    },
    {
        id: 2,
        name: "Desert Snake",
        icon: "🏜️",
        desc: "Twisty dunes, a mine cave and oily sand",
        rx: 200, rz: 100, warp: [{ k: 3, ax: 26, az: 40, phase: 0.3 }, { k: 2, ax: 16, az: 0, phase: 1.1 }],
        hills: [{ k: 1, amp: 5, phase: 1.0 }],
        features: [
            { type: "tunnel", from: 0.30, to: 0.42, style: "rock" },
            { type: "trap", at: 0.55, lane: 0, kind: "oil" },
            { type: "trap", at: 0.78, lane: -1, kind: "spikes" },
            { type: "boost", at: 0.9, lane: 0 },
        ],
        theme: {
            ground: [0.78, 0.66, 0.42],
            sky: "sunset",
            scenery: "desert",
            fog: [0.88, 0.72, 0.5], fogStart: 150, fogEnd: 460,
        },
    },
    {
        id: 3,
        name: "City Rush",
        icon: "🌃",
        desc: "Neon streets, hard 90° corners — mind the train!",
        points: [
            [185, 88, 0], [60, 95, 0], [42, 42, 0], [-58, 46, 0], [-78, 95, 0], [-180, 88, 0],
            // The left "chicane" control point used to jut in to x=-120 — tighter than
            // the road is wide, so the inner guardrail folded ACROSS the road (a fence
            // in the middle you could drive through). Softened to -168 so the corner
            // radius stays ≥ the guardrail offset and the rail hugs the edge.
            [-186, 18, 0], [-168, -14, 0], [-186, -48, 0], [-180, -95, 0], [-60, -90, 0],
            [-40, -42, 0], [58, -46, 0], [78, -95, 0], [180, -88, 0], [186, 0, 0],
        ],
        features: [
            { type: "train", at: 0.69, period: 1500 },
            { type: "trap", at: 0.2, lane: 1, kind: "oil" },
            { type: "trap", at: 0.45, lane: -1, kind: "oil" },
            { type: "boost", at: 0.95, lane: 0 },
            { type: "boost", at: 0.33, lane: 0 },
        ],
        theme: {
            ground: [0.16, 0.17, 0.2],
            sky: "night",
            scenery: "city",
            fog: [0.07, 0.08, 0.14], fogStart: 120, fogEnd: 420,
        },
    },
    {
        id: 4,
        name: "Formula GP",
        icon: "🏎️",
        desc: "Chicanes, a hairpin and grandstand crowds",
        points: [
            // The hairpin here used to turn tighter than the road is wide, which folded
            // the inner guardrail across the track (tools/rail-fold-check.mjs).
            [190, 40, 0], [120, 72, 0], [40, 60, 0], [-30, 82, 0], [-120, 72, 0], [-180, 40, 0],
            [-188, -8, 0], [-142, -32, 0], [-100, -10, 0], [-58, -32, 0], [-18, -10, 0],
            [16, -44, 0], [19, -63, 0], [62, -96, 0], [140, -82, 0], [186, -42, 0],
        ],
        features: [
            { type: "boost", at: 0.02, lane: 0 },
            { type: "boost", at: 0.55, lane: 0 },
            { type: "trap", at: 0.42, lane: 0, kind: "oil" },
            { type: "trap", at: 0.78, lane: 1, kind: "oil" },
        ],
        theme: {
            ground: [0.25, 0.52, 0.2],
            sky: "day",
            scenery: "formula",
            fog: [0.62, 0.74, 0.86], fogStart: 170, fogEnd: 480,
        },
    },
    {
        id: 5,
        name: "Green Valley",
        icon: "⛰️",
        desc: "Big climbs and dives between canyon walls",
        rx: 190, rz: 105, warp: [{ k: 2, ax: 30, az: 24, phase: 1.4 }],
        hills: [{ k: 1, amp: 10, phase: 0.2 }, { k: 3, amp: 4, phase: 1.2 }],
        features: [
            { type: "tunnel", from: 0.74, to: 0.86, style: "rock" },
            { type: "trap", at: 0.25, lane: 1, kind: "mud" },
            { type: "boost", at: 0.5, lane: 0 },
        ],
        theme: {
            ground: [0.2, 0.5, 0.16],
            sky: "day",
            scenery: "valley",
            fog: [0.6, 0.72, 0.8], fogStart: 140, fogEnd: 440,
        },
    },
    {
        id: 6,
        name: "Alpine Drop",
        icon: "❄️",
        desc: "Climb the summit, slide down — ice everywhere",
        points: [
            [180, 80, 0], [80, 100, 3], [-20, 92, 8], [-110, 100, 14], [-180, 70, 18],
            [-190, 0, 21], [-150, -62, 15], [-60, -92, 9], [28, -72, 5], [59, -23, 8],
            [110, -42, 4], [167, -52, 0],
        ],
        features: [
            { type: "tunnel", from: 0.36, to: 0.48, style: "snow" },
            { type: "trap", at: 0.58, lane: 0, kind: "ice" },
            { type: "trap", at: 0.65, lane: -1, kind: "ice" },
            { type: "trap", at: 0.88, lane: 1, kind: "ice" },
            { type: "boost", at: 0.05, lane: 0 },
        ],
        theme: {
            ground: [0.88, 0.91, 0.95],
            sky: "day",
            scenery: "snow",
            fog: [0.82, 0.87, 0.93], fogStart: 110, fogEnd: 400,
        },
    },
    {
        id: 7,
        name: "Kitchen Chaos",
        icon: "🍳",
        desc: "Shrunk down! Race the table among giant snacks",
        points: [
            [150, 70, 0], [60, 82, 0], [21, 50, 2], [-40, 86, 4], [-120, 76, 0], [-152, 20, 0],
            [-100, -20, 3], [-107, -57, 0], [-60, -86, 0], [0, -42, 5], [60, -86, 0], [150, -60, 0],
        ],
        features: [
            { type: "tunnel", from: 0.55, to: 0.64, style: "cheese" },
            { type: "trap", at: 0.3, lane: 0, kind: "mud" },
            { type: "trap", at: 0.78, lane: -1, kind: "oil" },
            { type: "boost", at: 0.12, lane: 0 },
        ],
        theme: {
            ground: [0.85, 0.3, 0.25],
            sky: "day",
            scenery: "kitchen",
            fog: [0.85, 0.78, 0.7], fogStart: 150, fogEnd: 460,
        },
    },
];

let selectedTrackId = 0;
// In multiplayer the host's choice arrives via the race-start event.
function getActiveTrack() {
    const id = (isMultiplayer && window._selectedTrackId != null) ? window._selectedTrackId : selectedTrackId;
    return TRACKS[id] || TRACKS[0];
}

function buildCarSelectUI() {
    const grid = document.getElementById("car-grid");
    grid.innerHTML = "";

    CAR_MODELS.forEach((model) => {
        const card = document.createElement("div");
        card.className = "car-card";
        card.dataset.modelId = model.id;

        const preview = document.createElement("div");
        preview.className = "car-preview";
        const r = Math.round(model.color[0] * 255);
        const g = Math.round(model.color[1] * 255);
        const b = Math.round(model.color[2] * 255);
        preview.style.background = `linear-gradient(135deg, rgba(${r},${g},${b},0.3), rgba(${r},${g},${b},0.8))`;
        preview.innerHTML = `<svg viewBox="0 0 100 60" style="width:100%;height:100%">
            <rect x="20" y="20" width="60" height="25" rx="4" fill="rgb(${r},${g},${b})"/>
            <rect x="30" y="12" width="35" height="14" rx="3" fill="rgba(150,200,255,0.7)"/>
            <rect x="15" y="42" width="14" height="14" rx="7" fill="#222"/>
            <rect x="71" y="42" width="14" height="14" rx="7" fill="#222"/>
            <rect x="20" y="18" width="60" height="3" rx="1" fill="rgba(255,255,255,0.2)"/>
        </svg>`;
        card.appendChild(preview);

        const nameEl = document.createElement("div");
        nameEl.className = "car-name";
        nameEl.textContent = model.name;
        card.appendChild(nameEl);

        const descEl = document.createElement("div");
        descEl.className = "car-desc";
        descEl.textContent = model.desc;
        card.appendChild(descEl);

        const statColors = { speed: "#ff4444", accel: "#44cc44", handling: "#55aaff", weight: "#cc88ff", health: "#ffaa22" };
        const statLabels = { speed: "Speed", accel: "Accel", handling: "Handle", weight: "Weight", health: "Health" };
        ["speed", "accel", "handling", "weight", "health"].forEach((stat) => {
            const row = document.createElement("div");
            row.className = "stat-row";
            const label = document.createElement("span");
            label.className = "stat-label";
            label.textContent = statLabels[stat];
            row.appendChild(label);
            const barBg = document.createElement("div");
            barBg.className = "stat-bar-bg";
            const barFill = document.createElement("div");
            barFill.className = "stat-bar-fill";
            barFill.style.width = (model.stats[stat] / 5 * 100) + "%";
            barFill.style.background = statColors[stat];
            barBg.appendChild(barFill);
            row.appendChild(barBg);
            card.appendChild(row);
        });

        card.addEventListener("click", () => {
            selectedCarModel = model;
            document.querySelectorAll(".car-card").forEach(c => c.classList.remove("selected"));
            card.classList.add("selected");
            document.getElementById("start-race-btn").disabled = false;
            
            if (isMultiplayer && socket) {
                socket.emit('select-car', model);
                // Back to the room lobby; the player-ready broadcast marks us ready
                // and reveals the host's Start button once everyone has picked.
                enterLobby();
            }
        });

        grid.appendChild(card);
    });
}

buildCarSelectUI();

function buildTrackSelectUI() {
    const grid = document.getElementById("track-grid");
    grid.innerHTML = "";
    TRACKS.forEach((t) => {
        const card = document.createElement("div");
        card.className = "track-card" + (t.id === selectedTrackId ? " selected" : "");
        card.dataset.trackId = t.id;
        card.innerHTML = `<div class="tc-name">${t.icon ? t.icon + " " : ""}${t.name}</div><div class="tc-desc">${t.desc}</div>`;
        card.addEventListener("click", () => {
            selectedTrackId = t.id;
            document.querySelectorAll(".track-card").forEach(c => c.classList.remove("selected"));
            card.classList.add("selected");
            // Tell everyone in the room which course the host picked.
            if (isMultiplayer && isHost && socket) socket.emit('select-track', { trackId: t.id });
            updateNextTrack(t.id);
        });
        grid.appendChild(card);
    });
}
buildTrackSelectUI();
buildRoomTrackSelect();

// The room lobby: room code + players, with the "Choose Your Ride" button to
// open per-round vehicle/track selection. Hides the main menu and car-select.
function enterLobby() {
    document.getElementById("lobby-menu").style.display = "none";
    document.getElementById("room-info").style.display = "block";
    document.getElementById("lobby-pick-btn").style.display = "inline-block";
    document.getElementById("car-select-overlay").style.display = "none";
    document.getElementById("lobby-overlay").style.display = "flex";
    updateNextTrack(); // reveal the "next track" banner with the current course
}

// Vehicle picker. In a room the track is chosen in the room itself, so the
// in-overlay course picker is offline-only; picking a car returns to the lobby.
function showCarSelectOverlay() {
    document.getElementById("track-select-wrap").style.display = isMultiplayer ? "none" : "block";
    document.getElementById("start-race-btn").style.display = isMultiplayer ? "none" : "inline-block";
    document.getElementById("car-back-btn").style.display = isMultiplayer ? "inline-block" : "none";
    document.getElementById("lobby-overlay").style.display = "none";
    document.getElementById("car-select-overlay").style.display = "flex";
}

document.getElementById("start-race-btn").addEventListener("click", () => {
    if (!selectedCarModel) return;
    
    document.getElementById("car-select-overlay").style.display = "none";
    document.getElementById("hud").style.display = "block";
    document.getElementById("corner-hud").style.display = "flex";
    SoundManager.init();
    SoundManager.resume();
    createScene();
});

const createScene = async function () {
    // Tear down the previous race so scenes and render loops don't pile up
    // (each play-again used to leak a whole scene + stack another render loop).
    engine.stopRenderLoop();
    // Kill the previous race's audio and blank the canvas — otherwise the old
    // track stays frozen on screen (and its music keeps playing) while the new
    // course's assets load.
    SoundManager.stopMusic();
    SoundManager.stopEngine();
    if (activeScene) { activeScene.dispose(); activeScene = null; }
    engine.clear(new BABYLON.Color4(0.02, 0.03, 0.06, 1), true, true);

    const scene = new BABYLON.Scene(engine);
    activeScene = scene;
    scene.skipPointerMovePicking = true; // game never picks meshes on move
    scene.clearColor = new BABYLON.Color4(0.4, 0.65, 0.9, 1);

    // --- Color grading: a touch of contrast/exposure so the scene pops ---
    scene.imageProcessingConfiguration.contrast = 1.15;
    scene.imageProcessingConfiguration.exposure = 1.15;

    // Load assets first
    await AssetManager.loadAssets(scene);

    // --- Active course + theme ---
    const track = getActiveTrack();
    const theme = track.theme;
    const isSunset = theme.sky === "sunset";
    const isNight = theme.sky === "night";
    const C3 = a => new BABYLON.Color3(a[0], a[1], a[2]);

    // --- Sky: smooth vertical gradient dome (day / sunset / night palettes) ---
    const SKY_PALETTES = {
        day:    { top: [0.19, 0.45, 0.86], mid: [0.45, 0.72, 0.96], horizon: [0.83, 0.92, 0.99] },
        sunset: { top: [0.13, 0.09, 0.33], mid: [0.92, 0.42, 0.30], horizon: [1.0, 0.83, 0.5] },
        night:  { top: [0.02, 0.02, 0.08], mid: [0.05, 0.06, 0.16], horizon: [0.12, 0.13, 0.26] },
    };
    const pal = SKY_PALETTES[theme.sky] || SKY_PALETTES.day;
    const skyTop = pal.top;
    const skyMid = pal.mid;
    const skyHorizon = pal.horizon;
    const skyTex = new BABYLON.DynamicTexture("skyGrad", { width: 4, height: 256 }, scene, false);
    {
        const sctx = skyTex.getContext();
        const grad = sctx.createLinearGradient(0, 0, 0, 256);
        const rgb = a => `rgb(${Math.round(a[0] * 255)},${Math.round(a[1] * 255)},${Math.round(a[2] * 255)})`;
        grad.addColorStop(0.0, rgb(skyTop));
        grad.addColorStop(0.45, rgb(skyMid));
        grad.addColorStop(0.6, rgb(skyHorizon));
        grad.addColorStop(1.0, rgb(skyHorizon));
        sctx.fillStyle = grad;
        sctx.fillRect(0, 0, 4, 256);
        skyTex.update();
    }
    const skydome = BABYLON.MeshBuilder.CreateSphere("skydome", { diameter: 1200, segments: 24, sideOrientation: BABYLON.Mesh.BACKSIDE }, scene);
    const skyMat = new BABYLON.StandardMaterial("skyMat", scene);
    skyMat.backFaceCulling = false;
    skyMat.disableLighting = true;
    skyMat.emissiveTexture = skyTex;
    skyMat.diffuseColor = new BABYLON.Color3(0, 0, 0);
    skyMat.specularColor = new BABYLON.Color3(0, 0, 0);
    skydome.material = skyMat;
    skydome.infiniteDistance = true;
    skydome.applyFog = false;
    scene.clearColor = new BABYLON.Color4(skyHorizon[0], skyHorizon[1], skyHorizon[2], 1);

    // --- Sun (or moon at night) ---
    const sun = BABYLON.MeshBuilder.CreateSphere("sun", { diameter: isSunset ? 70 : (isNight ? 34 : 48), segments: 16 }, scene);
    sun.position = isSunset ? new BABYLON.Vector3(-180, 55, -420) : (isNight ? new BABYLON.Vector3(190, 230, -360) : new BABYLON.Vector3(160, 280, -380));
    const sunMat = new BABYLON.StandardMaterial("sunMat", scene);
    sunMat.disableLighting = true;
    sunMat.emissiveColor = isSunset ? new BABYLON.Color3(1.0, 0.62, 0.32) : (isNight ? new BABYLON.Color3(0.92, 0.93, 0.85) : new BABYLON.Color3(1.0, 0.96, 0.78));
    sun.material = sunMat;
    sun.applyFog = false;

    // Stars sprinkled across a night sky (one flattened-disc template, instanced).
    if (isNight) {
        const starMat = new BABYLON.StandardMaterial("starMat", scene);
        starMat.emissiveColor = new BABYLON.Color3(0.9, 0.92, 1);
        starMat.disableLighting = true;
        starMat.freeze();
        const starTmpl = BABYLON.MeshBuilder.CreateSphere("starTmpl", { diameter: 1.6, segments: 4 }, scene);
        starTmpl.material = starMat;
        starTmpl.applyFog = false;
        starTmpl.position.y = -500;
        starTmpl.isPickable = false;
        for (let s = 0; s < 90; s++) {
            const a = Math.random() * Math.PI * 2, elev = 0.15 + Math.random() * 0.75, R = 560;
            const st = starTmpl.createInstance("star" + s);
            st.position.set(Math.cos(a) * R * Math.cos(elev * Math.PI / 2), 60 + Math.sin(elev * Math.PI / 2) * 480, Math.sin(a) * R * Math.cos(elev * Math.PI / 2));
            st.applyFog = false;
            st.isPickable = false;
            st.freezeWorldMatrix();
        }
    }

    const sunLight = new BABYLON.PointLight("sunLight", new BABYLON.Vector3(50, 80, -100), scene);
    sunLight.intensity = isNight ? 0.25 : 0.4;
    sunLight.diffuse = isSunset ? new BABYLON.Color3(1, 0.7, 0.45) : (isNight ? new BABYLON.Color3(0.6, 0.7, 1) : new BABYLON.Color3(1, 0.95, 0.7));

    // --- Clouds (one shared material for all puffs) ---
    const cloudCol = isSunset ? [1.0, 0.72, 0.62] : (isNight ? [0.18, 0.2, 0.3] : [0.97, 0.97, 0.98]);
    const cloudCount = theme.scenery === "desert" ? 7 : (isNight ? 5 : 15);
    const cloudMat = new BABYLON.StandardMaterial("cloudMat", scene);
    cloudMat.emissiveColor = C3(cloudCol);
    cloudMat.diffuseColor = C3(cloudCol);
    cloudMat.specularColor = new BABYLON.Color3(0, 0, 0);
    cloudMat.disableLighting = true;
    cloudMat.alpha = 0.9;
    cloudMat.freeze();
    for (let c = 0; c < cloudCount; c++) {
        const cloudGroup = new BABYLON.TransformNode("cloud" + c, scene);
        cloudGroup.position = new BABYLON.Vector3((Math.random() - 0.5) * 460, 45 + Math.random() * 35, (Math.random() - 0.5) * 460);

        const numPuffs = 3 + Math.floor(Math.random() * 4);
        for (let p = 0; p < numPuffs; p++) {
            const puff = BABYLON.MeshBuilder.CreateSphere("cloudPuff" + c + "_" + p, { diameterX: 8 + Math.random() * 12, diameterY: 3 + Math.random() * 2, diameterZ: 6 + Math.random() * 8 }, scene);
            puff.position = new BABYLON.Vector3((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 6);
            puff.material = cloudMat;
            puff.isPickable = false;
            puff.parent = cloudGroup;
        }
        cloudGroup._cloudSpeed = 0.01 + Math.random() * 0.02;
    }

    // --- Lighting ---
    const hemisphericLight = new BABYLON.HemisphericLight("hemiLight", new BABYLON.Vector3(0, 1, 0), scene);
    hemisphericLight.intensity = isSunset ? 0.7 : (isNight ? 0.45 : 0.85);
    hemisphericLight.diffuse = isSunset ? new BABYLON.Color3(1, 0.85, 0.7) : (isNight ? new BABYLON.Color3(0.55, 0.62, 0.9) : new BABYLON.Color3(1, 0.98, 0.9));
    hemisphericLight.groundColor = C3(theme.ground).scale(0.6);
    const dirLight = new BABYLON.DirectionalLight("dirLight", new BABYLON.Vector3(-0.3, -0.7, 0.4), scene);
    dirLight.intensity = isSunset ? 0.8 : (isNight ? 0.5 : 0.9);
    dirLight.diffuse = isSunset ? new BABYLON.Color3(1, 0.78, 0.55) : (isNight ? new BABYLON.Color3(0.65, 0.7, 1) : new BABYLON.Color3(1, 0.96, 0.85));
    dirLight.position = new BABYLON.Vector3(-30, 40, 20);

    // --- Shadows ---
    const shadowGenerator = new BABYLON.ShadowGenerator(1024, dirLight);
    shadowGenerator.useBlurExponentialShadowMap = true;
    shadowGenerator.blurKernel = 32;
    shadowGenerator.setDarkness(0.5);

    // --- Glow: makes item boxes, boost flashes and pickups bloom ---
    const glowLayer = new BABYLON.GlowLayer("glow", scene);
    glowLayer.intensity = 0.5;
    // The sky dome and clouds are deliberately emissive; keep them out of the bloom.
    scene.meshes.forEach(mm => {
        if (mm.name && (mm.name.indexOf("cloudPuff") === 0 || mm.name === "skydome")) glowLayer.addExcludedMesh(mm);
    });

    // --- Fog ---
    scene.fogMode = BABYLON.Scene.FOGMODE_LINEAR;
    scene.fogColor = C3(theme.fog);
    scene.fogStart = theme.fogStart;
    scene.fogEnd = theme.fogEnd;

    // --- Ground ---
    const groundSize = 700;
    const ground = BABYLON.MeshBuilder.CreateGround("ground", { width: groundSize, height: groundSize }, scene);
    const groundMat = new BABYLON.StandardMaterial("groundMat", scene);
    groundMat.diffuseColor = C3(theme.ground);
    if (theme.scenery === "kitchen") {
        // The race is on a giant picnic tablecloth: red/white gingham checks.
        const clothTex = new BABYLON.DynamicTexture("clothTex", { width: 256, height: 256 }, scene, false);
        const cctx = clothTex.getContext();
        const cell = 32;
        for (let yy = 0; yy < 8; yy++) for (let xx = 0; xx < 8; xx++) {
            cctx.fillStyle = (xx + yy) % 2 === 0 ? "#d94f43" : "#f3eee6";
            cctx.fillRect(xx * cell, yy * cell, cell, cell);
        }
        clothTex.update();
        clothTex.wrapU = clothTex.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
        clothTex.uScale = 26; clothTex.vScale = 26;
        groundMat.diffuseTexture = clothTex;
        groundMat.diffuseColor = new BABYLON.Color3(1, 1, 1);
    }
    groundMat.specularColor = new BABYLON.Color3(0, 0, 0);
    ground.material = groundMat;
    ground.receiveShadows = true;
    ground.isPickable = false;
    ground.freezeWorldMatrix();

    // ============================================================
    // TRACK BUILDING
    // ============================================================

    const numPoints = 160;
    const trackCenterX = 0;
    const trackCenterZ = 0;
    const trackRibbonWidth = 18;

    // --- Course centreline ---
    // Generated FIRST so scenery, features and physics can all use the real
    // shape and elevation. Two source formats (see the TRACKS comment):
    const trackPoints = [];
    if (track.points) {
        // Closed Catmull-Rom spline through explicit control points: smooth
        // everywhere but faithful to sharp corners/hairpins/designed climbs.
        const cps = track.points, n = cps.length;
        const catmull = (a, b, c, d, u) =>
            0.5 * ((2 * b) + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u * u * u);
        for (let i = 0; i < numPoints; i++) {
            const t = (i / numPoints) * n;
            const seg = Math.floor(t), u = t - seg;
            const p0 = cps[(seg - 1 + n) % n], p1 = cps[seg % n], p2 = cps[(seg + 1) % n], p3 = cps[(seg + 2) % n];
            trackPoints.push(new BABYLON.Vector3(
                catmull(p0[0], p1[0], p2[0], p3[0], u),
                Math.max(0, catmull(p0[2] || 0, p1[2] || 0, p2[2] || 0, p3[2] || 0, u)) + 0.03,
                catmull(p0[1], p1[1], p2[1], p3[1], u),
            ));
        }
    } else {
        // Ellipse warped by sine harmonics; `hills` harmonics raise/lower the road.
        const rawY = [];
        for (let i = 0; i < numPoints; i++) {
            const angle = (i / numPoints) * Math.PI * 2 + 0.3;
            let rx = track.rx, rz = track.rz;
            for (const w of (track.warp || [])) {
                rx += w.ax * Math.sin(w.k * angle + w.phase);
                rz += w.az * Math.sin(w.k * angle + w.phase);
            }
            let y = 0;
            for (const h of (track.hills || [])) y += h.amp * Math.sin(h.k * angle + h.phase);
            rawY.push(y);
            trackPoints.push(new BABYLON.Vector3(trackCenterX + Math.cos(angle) * rx, 0, trackCenterZ + Math.sin(angle) * rz));
        }
        // Shift the profile so its lowest point sits on the ground (no digging).
        const minY = Math.min(...rawY);
        for (let i = 0; i < numPoints; i++) trackPoints[i].y = rawY[i] - minY + 0.03;
    }

    // Bounding radii of the real course (drives scenery scatter + minimap scale).
    let trackLength = 0, trackWidth = 0, trackMaxY = 0;
    for (const p of trackPoints) {
        trackLength = Math.max(trackLength, Math.abs(p.x));
        trackWidth = Math.max(trackWidth, Math.abs(p.z));
        trackMaxY = Math.max(trackMaxY, p.y);
    }
    window._trackPoints = trackPoints; // exposed for tools/headless tests

    // --- Decorative scenery ---
    // Scatter a point in the ring of land just outside the course bounds.
    // The ring is an ellipse, but boxy spline courses (City Rush, Kitchen)
    // poke through it near their corners — so every candidate is also checked
    // against the real centreline and rejected if it would sit on the road.
    const scatter = (pad) => {
        const clearance = trackRibbonWidth + 3 + Math.min(pad || 25, 15);
        let x = 0, z = 0;
        for (let tries = 0; tries < 30; tries++) {
            const angle = Math.random() * Math.PI * 2;
            const ox = trackLength + trackRibbonWidth + (pad || 25) + Math.random() * 90;
            const oz = trackWidth + trackRibbonWidth + (pad || 25) + Math.random() * 60;
            x = Math.cos(angle) * ox;
            z = Math.sin(angle) * oz;
            let clear = true;
            for (let i = 0; i < numPoints; i += 2) {
                const dx = x - trackPoints[i].x, dz = z - trackPoints[i].z;
                if (dx * dx + dz * dz < clearance * clearance) { clear = false; break; }
            }
            if (clear) return [x, z];
        }
        return [x * 1.6, z * 1.6]; // give up gracefully: push the last try far out
    };

    const sc = theme.scenery;
    const mtnBase = sc === "snow" ? [0.78, 0.82, 0.88]
        : sc === "city" ? [0.07, 0.08, 0.13]
        : isSunset ? [0.42, 0.30, 0.30]
        : sc === "desert" ? [0.56, 0.46, 0.33]
        : [0.34, 0.42, 0.47];
    const hillCol = sc === "desert" ? [0.74, 0.62, 0.4] : sc === "snow" ? [0.85, 0.88, 0.93] : [0.2, 0.5, 0.18];
    const flowerCols = [[1, 0.3, 0.4], [1, 0.85, 0.2], [0.9, 0.4, 0.95], [0.95, 0.95, 0.98]];
    const balloonCols = [[0.95, 0.3, 0.3], [0.3, 0.6, 0.95], [0.98, 0.8, 0.2], [0.5, 0.85, 0.4], [0.8, 0.4, 0.9]];

    // Shared, frozen materials + instanced meshes: one draw call per scenery type
    // (rather than one per object), and static world-matrices are frozen so they
    // are never recomputed.  See the babylonjs-engine review.
    const _smat = {};
    const sharedMat = (key, rgb, em) => {
        if (_smat[key]) return _smat[key];
        const mm = new BABYLON.StandardMaterial("sm_" + key, scene);
        mm.diffuseColor = C3(rgb);
        if (em) mm.emissiveColor = C3(em);
        mm.specularColor = new BABYLON.Color3(0, 0, 0);
        mm.freeze();
        _smat[key] = mm;
        return mm;
    };
    const _tmpl = {};
    // First object of a key becomes the template mesh; the rest are instances.
    const place = (key, build, idx, px, py, pz, sx, sy, sz, ry, rz) => {
        const node = _tmpl[key] ? _tmpl[key].createInstance(key + "_" + idx) : (_tmpl[key] = build(key));
        node.position.set(px, py, pz);
        if (sx != null) node.scaling.set(sx, sy, sz);
        if (ry != null) node.rotation.y = ry;
        if (rz != null) node.rotation.z = rz;
        node.isPickable = false;
        node.freezeWorldMatrix();
        return node;
    };

    // Distant mountain ring (3 shades, each scaled from one cone). The kitchen
    // is indoors — it gets a counter-top backdrop instead.
    if (sc !== "kitchen") {
        for (let m = 0; m < 18; m++) {
            const a = (m / 18) * Math.PI * 2 + (Math.random() - 0.5) * 0.25;
            const dist = 360 + Math.random() * 90, mh = 45 + Math.random() * 80, D = 70 + Math.random() * 70, v = m % 3;
            place("mtn" + v, (k) => { const me = BABYLON.MeshBuilder.CreateCylinder(k, { height: 1, diameterTop: 0, diameterBottom: 1, tessellation: 5 }, scene); me.material = sharedMat(k, [mtnBase[0] + v * 0.03, mtnBase[1] + v * 0.03, mtnBase[2] + v * 0.02]); return me; },
                m, Math.cos(a) * dist, mh / 2 - 6, Math.sin(a) * dist, D, mh, D, Math.random() * Math.PI);
        }
    }

    if (sc === "desert") {
        for (let i = 0; i < 80; i++) {
            const [x, z] = scatter(), h = 3 + Math.random() * 4;
            place("cactus", (k) => { const me = BABYLON.MeshBuilder.CreateCylinder(k, { height: 1, diameter: 0.9, tessellation: 8 }, scene); me.material = sharedMat("cactus", [0.17, 0.4, 0.2]); return me; }, i, x, h / 2, z, 1, h, 1);
            if (Math.random() < 0.6) {
                place("cactusArm", (k) => { const me = BABYLON.MeshBuilder.CreateCylinder(k, { height: 1.6, diameter: 0.55, tessellation: 8 }, scene); me.material = sharedMat("cactus", [0.17, 0.4, 0.2]); return me; }, i, x + 0.75, h * 0.6, z, null, null, null, null, Math.PI / 2);
            }
        }
    } else if (sc === "city") {
        // --- City blocks: instanced towers with one shared lit-window facade ---
        const winTex = new BABYLON.DynamicTexture("winTex", { width: 64, height: 128 }, scene, false);
        {
            const wc = winTex.getContext();
            wc.fillStyle = "#10131c"; wc.fillRect(0, 0, 64, 128);
            for (let yy = 4; yy < 124; yy += 10) for (let xx = 4; xx < 60; xx += 10) {
                wc.fillStyle = Math.random() < 0.55 ? (Math.random() < 0.5 ? "#ffd97a" : "#9fd3ff") : "#1b2030";
                wc.fillRect(xx, yy, 6, 6);
            }
            winTex.update();
        }
        for (let i = 0; i < 60; i++) {
            const [x, z] = scatter(12), v = i % 3;
            const h = 16 + Math.random() * 42, w = 9 + Math.random() * 9;
            place("bldg" + v, (k) => {
                const me = BABYLON.MeshBuilder.CreateBox(k, { size: 1 }, scene);
                const bm = new BABYLON.StandardMaterial("sm_" + k, scene);
                bm.diffuseColor = new BABYLON.Color3(0.1 + v * 0.03, 0.11 + v * 0.03, 0.16 + v * 0.03);
                bm.emissiveTexture = winTex;
                bm.specularColor = new BABYLON.Color3(0, 0, 0);
                bm.freeze();
                me.material = bm;
                return me;
            }, i, x, h / 2, z, w, h, w, Math.random() * Math.PI);
        }
        // Glowing street lamps along the road.
        for (let i = 0; i < numPoints; i += 8) {
            const pt = trackPoints[i], nextPt = trackPoints[(i + 1) % numPoints];
            const angle = Math.atan2(nextPt.z - pt.z, nextPt.x - pt.x);
            const side = (i / 8) % 2 === 0 ? -1 : 1;
            const off = (trackRibbonWidth + 4) * side;
            const lx = pt.x - Math.sin(angle) * off, lz = pt.z + Math.cos(angle) * off;
            place("lampPole", (k) => { const me = BABYLON.MeshBuilder.CreateCylinder(k, { height: 7, diameter: 0.35, tessellation: 6 }, scene); me.material = sharedMat("lampPole", [0.2, 0.2, 0.24]); return me; }, i, lx, pt.y + 3.5, lz);
            place("lampGlow", (k) => { const me = BABYLON.MeshBuilder.CreateSphere(k, { diameter: 1.1, segments: 6 }, scene); me.material = sharedMat("lampGlow", [1, 0.9, 0.6], [1, 0.85, 0.4]); return me; }, i, lx, pt.y + 7.2, lz);
        }
    } else if (sc === "snow") {
        // --- Snowy pines (green cone + white snow cap) and snowmen ---
        for (let i = 0; i < 110; i++) {
            const [x, z] = scatter();
            place("snowTrunk", (k) => { const me = BABYLON.MeshBuilder.CreateCylinder(k, { height: 3, diameter: 0.4, tessellation: 7 }, scene); me.material = sharedMat("snowTrunk", [0.32, 0.2, 0.12]); return me; }, i, x, 1.5, z);
            place("snowFol", (k) => { const me = BABYLON.MeshBuilder.CreateCylinder(k, { height: 5, diameterTop: 0, diameterBottom: 3.5, tessellation: 8 }, scene); me.material = sharedMat("snowFol", [0.08, 0.32, 0.12]); return me; }, i, x, 5, z);
            place("snowCap", (k) => { const me = BABYLON.MeshBuilder.CreateCylinder(k, { height: 2.2, diameterTop: 0, diameterBottom: 1.9, tessellation: 8 }, scene); me.material = sharedMat("snowCap", [0.95, 0.96, 1], [0.18, 0.19, 0.22]); return me; }, i, x, 6.6, z);
        }
        for (let i = 0; i < 10; i++) {
            const [x, z] = scatter(8);
            place("smBase", (k) => { const me = BABYLON.MeshBuilder.CreateSphere(k, { diameter: 2.4, segments: 8 }, scene); me.material = sharedMat("smBase", [0.97, 0.97, 1]); return me; }, i, x, 1.0, z);
            place("smMid", (k) => { const me = BABYLON.MeshBuilder.CreateSphere(k, { diameter: 1.7, segments: 8 }, scene); me.material = sharedMat("smBase", [0.97, 0.97, 1]); return me; }, i, x, 2.5, z);
            place("smHead", (k) => { const me = BABYLON.MeshBuilder.CreateSphere(k, { diameter: 1.1, segments: 8 }, scene); me.material = sharedMat("smBase", [0.97, 0.97, 1]); return me; }, i, x, 3.6, z);
            place("smNose", (k) => { const me = BABYLON.MeshBuilder.CreateCylinder(k, { height: 0.8, diameterTop: 0, diameterBottom: 0.25, tessellation: 6 }, scene); me.material = sharedMat("smNose", [0.95, 0.5, 0.1]); return me; }, i, x, 3.6, z + 0.7, null, null, null, null, -Math.PI / 2);
        }
    } else if (sc === "kitchen") {
        // --- Shrunk-down on the breakfast table: everything is enormous ---
        // Giant mugs (cylinder + half-torus handle).
        const mugCols = [[0.35, 0.6, 0.9], [0.9, 0.45, 0.5], [0.5, 0.8, 0.45]];
        for (let i = 0; i < 3; i++) {
            const [x, z] = scatter(40), col = mugCols[i];
            const mug = BABYLON.MeshBuilder.CreateCylinder("mug" + i, { height: 42, diameter: 34, tessellation: 20 }, scene);
            mug.position.set(x, 21, z);
            mug.material = sharedMat("mug" + i, col);
            mug.isPickable = false; mug.freezeWorldMatrix();
            const handle = BABYLON.MeshBuilder.CreateTorus("mugH" + i, { diameter: 22, thickness: 4.5, tessellation: 16 }, scene);
            handle.position.set(x + 19, 22, z);
            handle.rotation.z = Math.PI / 2;
            handle.material = mug.material;
            handle.isPickable = false; handle.freezeWorldMatrix();
        }
        // Plates with stacked pancakes / a donut.
        for (let i = 0; i < 4; i++) {
            const [x, z] = scatter(25);
            place("plate", (k) => { const me = BABYLON.MeshBuilder.CreateCylinder(k, { height: 1.6, diameter: 38, tessellation: 24 }, scene); me.material = sharedMat("plate", [0.96, 0.96, 0.98]); return me; }, i, x, 0.8, z);
            if (i % 2 === 0) {
                for (let p = 0; p < 3; p++) {
                    place("pancake", (k) => { const me = BABYLON.MeshBuilder.CreateCylinder(k, { height: 2.2, diameter: 24, tessellation: 18 }, scene); me.material = sharedMat("pancake", [0.85, 0.62, 0.3]); return me; }, i * 3 + p, x, 2.8 + p * 2.3, z, 1 - p * 0.06, 1, 1 - p * 0.06);
                }
            } else {
                const donut = BABYLON.MeshBuilder.CreateTorus("donut" + i, { diameter: 20, thickness: 7, tessellation: 18 }, scene);
                donut.position.set(x, 5, z);
                donut.material = sharedMat("donut", [0.95, 0.5, 0.65]);
                donut.isPickable = false; donut.freezeWorldMatrix();
            }
        }
        // Giant cutlery lying flat: forks (handle + tines) and spoons.
        for (let i = 0; i < 3; i++) {
            const [x, z] = scatter(15), ry = Math.random() * Math.PI;
            const dx = Math.sin(ry), dz = Math.cos(ry);
            place("forkHandle", (k) => { const me = BABYLON.MeshBuilder.CreateBox(k, { width: 4, height: 1.2, depth: 30 }, scene); me.material = sharedMat("steel", [0.75, 0.77, 0.82]); return me; }, i, x, 0.6, z, null, null, null, ry);
            for (let t = -1; t <= 1; t++) {
                place("forkTine", (k) => { const me = BABYLON.MeshBuilder.CreateBox(k, { width: 1, height: 1, depth: 12 }, scene); me.material = sharedMat("steel", [0.75, 0.77, 0.82]); return me; },
                    i * 3 + t + 1, x + dx * 21 + dz * t * 1.8, 0.5, z + dz * 21 - dx * t * 1.8, null, null, null, ry);
            }
        }
        // Fruit: giant apples and oranges.
        for (let i = 0; i < 6; i++) {
            const [x, z] = scatter(20), isApple = i % 2 === 0, d = 14 + Math.random() * 6;
            place(isApple ? "apple" : "orange", (k) => { const me = BABYLON.MeshBuilder.CreateSphere(k, { diameter: 1, segments: 10 }, scene); me.material = sharedMat(k, isApple ? [0.85, 0.15, 0.15] : [0.95, 0.55, 0.1]); return me; }, i, x, d * 0.45, z, d, d * 0.95, d);
            if (isApple) place("stem", (k) => { const me = BABYLON.MeshBuilder.CreateCylinder(k, { height: 4, diameter: 1, tessellation: 6 }, scene); me.material = sharedMat("stem", [0.4, 0.25, 0.1]); return me; }, i, x, d * 0.95, z);
        }
        // Milk cartons + cereal boxes as the skyline.
        for (let i = 0; i < 8; i++) {
            const [x, z] = scatter(60), v = i % 3, h = 50 + Math.random() * 30;
            const cols = [[0.9, 0.9, 0.95], [0.85, 0.3, 0.3], [0.3, 0.55, 0.85]];
            place("carton" + v, (k) => { const me = BABYLON.MeshBuilder.CreateBox(k, { size: 1 }, scene); me.material = sharedMat("carton" + v, cols[v]); return me; }, i, x, h / 2, z, 24, h, 18, Math.random() * Math.PI);
        }
        // Crumbs near the track.
        for (let i = 0; i < 40; i++) {
            const [x, z] = scatter(3), s = 0.4 + Math.random() * 0.8;
            place("crumb", (k) => { const me = BABYLON.MeshBuilder.CreateSphere(k, { diameter: 1, segments: 4 }, scene); me.material = sharedMat("crumb", [0.8, 0.65, 0.35]); return me; }, i, x, s * 0.3, z, s, s * 0.6, s);
        }
    } else if (sc === "formula") {
        // --- Race-day dressing: grandstands with crowds, billboards, cones ---
        const crowdTex = new BABYLON.DynamicTexture("crowdTex", { width: 128, height: 64 }, scene, false);
        {
            const cc = crowdTex.getContext();
            cc.fillStyle = "#2a2d36"; cc.fillRect(0, 0, 128, 64);
            const cols = ["#e74c3c", "#3498db", "#f1c40f", "#2ecc71", "#e67e22", "#ecf0f1", "#9b59b6"];
            for (let yy = 6; yy < 60; yy += 9) for (let xx = 4; xx < 124; xx += 7) {
                cc.fillStyle = cols[(Math.random() * cols.length) | 0];
                cc.beginPath(); cc.arc(xx, yy, 2.6, 0, Math.PI * 2); cc.fill();
            }
            crowdTex.update();
        }
        const crowdMat = new BABYLON.StandardMaterial("crowdMat", scene);
        crowdMat.diffuseTexture = crowdTex;
        crowdMat.emissiveColor = new BABYLON.Color3(0.35, 0.35, 0.35);
        crowdMat.specularColor = new BABYLON.Color3(0, 0, 0);
        crowdMat.freeze();
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2 + 0.4;
            const gx = Math.cos(a) * (trackLength + trackRibbonWidth + 55);
            const gz = Math.sin(a) * (trackWidth + trackRibbonWidth + 45);
            const ry = Math.atan2(-gx, -gz) + Math.PI; // stand faces the circuit
            const stand = BABYLON.MeshBuilder.CreateBox("stand" + i, { width: 42, height: 12, depth: 10 }, scene);
            stand.position.set(gx, 6, gz);
            stand.rotation.y = ry;
            stand.material = sharedMat("standBase", [0.45, 0.47, 0.52]);
            stand.isPickable = false; stand.freezeWorldMatrix();
            const crowd = BABYLON.MeshBuilder.CreatePlane("crowd" + i, { width: 40, height: 10 }, scene);
            crowd.position.set(gx - Math.sin(ry) * 5.2, 8.5, gz - Math.cos(ry) * 5.2);
            crowd.rotation.y = ry + Math.PI;
            crowd.rotation.x = -0.35;
            crowd.material = crowdMat;
            crowd.isPickable = false; crowd.freezeWorldMatrix();
            const roof = BABYLON.MeshBuilder.CreateBox("roof" + i, { width: 44, height: 0.8, depth: 12 }, scene);
            roof.position.set(gx, 13.5, gz);
            roof.rotation.y = ry;
            roof.material = sharedMat("roof", [0.85, 0.88, 0.92]);
            roof.isPickable = false; roof.freezeWorldMatrix();
        }
        // Sponsor-stripe billboards near the road.
        const bbCols = [[0.9, 0.2, 0.2], [0.2, 0.5, 0.9], [0.95, 0.8, 0.15]];
        for (let i = 0; i < 9; i++) {
            const [x, z] = scatter(10), v = i % 3;
            place("bbPanel" + v, (k) => { const me = BABYLON.MeshBuilder.CreateBox(k, { width: 12, height: 3.2, depth: 0.5 }, scene); me.material = sharedMat("bbPanel" + v, bbCols[v], [bbCols[v][0] * 0.15, bbCols[v][1] * 0.15, bbCols[v][2] * 0.15]); return me; }, i, x, 2.6, z, null, null, null, Math.random() * Math.PI);
            place("bbLeg", (k) => { const me = BABYLON.MeshBuilder.CreateCylinder(k, { height: 2.2, diameter: 0.4, tessellation: 6 }, scene); me.material = sharedMat("bbLeg", [0.4, 0.4, 0.45]); return me; }, i, x, 1.0, z);
        }
        // Pit-lane cones sprinkled along the verge.
        for (let i = 0; i < 26; i++) {
            const [x, z] = scatter(3);
            place("cone", (k) => { const me = BABYLON.MeshBuilder.CreateCylinder(k, { height: 1.3, diameterTop: 0.1, diameterBottom: 0.9, tessellation: 8 }, scene); me.material = sharedMat("cone", [1, 0.45, 0.05], [0.3, 0.12, 0]); return me; }, i, x, 0.65, z);
        }
    } else {
        // --- Forest / valley: trees, flowers, bushes ---
        for (let i = 0; i < 130; i++) {
            const [x, z] = scatter(), tt = Math.random();
            if (tt < 0.5) {
                place("pineTrunk", (k) => { const me = BABYLON.MeshBuilder.CreateCylinder(k, { height: 3, diameter: 0.4, tessellation: 7 }, scene); me.material = sharedMat("pineTrunk", [0.35, 0.2, 0.1]); return me; }, i, x, 1.5, z);
                place("pineFol", (k) => { const me = BABYLON.MeshBuilder.CreateCylinder(k, { height: 5, diameterTop: 0, diameterBottom: 3.5, tessellation: 8 }, scene); me.material = sharedMat("pineFol", [0.1, 0.4, 0.1]); return me; }, i, x, 5, z);
            } else if (tt < 0.75) {
                place("rndTrunk", (k) => { const me = BABYLON.MeshBuilder.CreateCylinder(k, { height: 2.5, diameter: 0.35, tessellation: 7 }, scene); me.material = sharedMat("rndTrunk", [0.4, 0.22, 0.1]); return me; }, i, x, 1.25, z);
                const d = 4 + Math.random() * 2;
                place("rndFol", (k) => { const me = BABYLON.MeshBuilder.CreateSphere(k, { diameter: 1, segments: 6 }, scene); me.material = sharedMat("rndFol", [0.13, 0.43, 0.1]); return me; }, i, x, 4.5, z, d, d, d);
            } else {
                place("tallTrunk", (k) => { const me = BABYLON.MeshBuilder.CreateCylinder(k, { height: 5, diameter: 0.3, tessellation: 7 }, scene); me.material = sharedMat("tallTrunk", [0.3, 0.18, 0.08]); return me; }, i, x, 2.5, z);
                place("tallFol", (k) => { const me = BABYLON.MeshBuilder.CreateCylinder(k, { height: 6, diameterTop: 0.3, diameterBottom: 2, tessellation: 8 }, scene); me.material = sharedMat("tallFol", [0.05, 0.3, 0.05]); return me; }, i, x, 7, z);
            }
        }
        // Bright flowers (4 colours) dotted across the grass.
        for (let f = 0; f < 110; f++) {
            const [x, z] = scatter(2), ci = Math.floor(Math.random() * 4), c = flowerCols[ci];
            place("flower" + ci, (k) => { const me = BABYLON.MeshBuilder.CreateSphere(k, { diameter: 0.5, segments: 4 }, scene); me.material = sharedMat(k, c, [c[0] * 0.2, c[1] * 0.2, c[2] * 0.2]); return me; }, f, x, 0.3, z);
        }
        // Small bushes near the track edges.
        for (let b = 0; b < 75; b++) {
            const [bx, bz] = scatter(6), s = 0.8 + Math.random() * 1.2;
            place("bush", (k) => { const me = BABYLON.MeshBuilder.CreateSphere(k, { diameter: 1, segments: 6 }, scene); me.material = sharedMat("bush", [0.1, 0.4, 0.1]); return me; }, b, bx, s * 0.3, bz, s, s * 0.6, s);
        }
        // Valley: steep canyon cliffs hugging the course on both sides.
        if (sc === "valley") {
            for (let i = 0; i < 26; i++) {
                const a = (i / 26) * Math.PI * 2;
                const cx = Math.cos(a) * (trackLength + trackRibbonWidth + 60 + Math.random() * 30);
                const cz = Math.sin(a) * (trackWidth + trackRibbonWidth + 55 + Math.random() * 30);
                const ch = 35 + Math.random() * 45, cd = 28 + Math.random() * 26, v = i % 2;
                place("cliff" + v, (k) => { const me = BABYLON.MeshBuilder.CreateCylinder(k, { height: 1, diameterTop: 0.55, diameterBottom: 1, tessellation: 6 }, scene); me.material = sharedMat(k, [0.42 + v * 0.05, 0.36 + v * 0.04, 0.3 + v * 0.04]); return me; },
                    i, cx, ch / 2 - 2, cz, cd, ch, cd, Math.random() * Math.PI);
            }
        }
    }

    // Rocks (2 shades; sandy in the desert, icy in the snow; not on the table).
    if (sc !== "kitchen" && sc !== "city") {
        for (let r = 0; r < 65; r++) {
            const [rx, rz] = scatter(15), rs = 0.6 + Math.random() * 1.7, v = r % 2;
            const col = sc === "desert" ? [0.6 + v * 0.06, 0.5 + v * 0.05, 0.34 + v * 0.04]
                : sc === "snow" ? [0.8 + v * 0.05, 0.84 + v * 0.05, 0.9 + v * 0.04]
                : [0.35 + v * 0.08, 0.32 + v * 0.05, 0.28 + v * 0.05];
            place("rock" + v, (k) => { const me = BABYLON.MeshBuilder.CreateSphere(k, { diameter: 1, segments: 5 }, scene); me.material = sharedMat(k, col); return me; },
                r, rx, rs * 0.3, rz, rs * (1 + Math.random() * 0.5), rs * (0.5 + Math.random() * 0.3), rs * (1 + Math.random() * 0.5));
        }
    }

    // --- Extra scenery to fill out every track ---
    // Rolling hills/mounds in the mid-distance (safely outside any course).
    if (sc !== "kitchen" && sc !== "city") {
        for (let i = 0; i < 16; i++) {
            const a = Math.random() * Math.PI * 2, dist = 300 + Math.random() * 90, hr = 18 + Math.random() * 26;
            place("hill", (k) => { const me = BABYLON.MeshBuilder.CreateSphere(k, { diameter: 1, segments: 8 }, scene); me.material = sharedMat("hill", hillCol); return me; },
                i, Math.cos(a) * dist, -hr * 0.25, Math.sin(a) * dist, hr * 2, hr * 0.9, hr * 2);
        }
    }

    // Colourful hot-air balloons drifting high in the sky (daylight themes only).
    if (!isNight && sc !== "kitchen") {
        for (let i = 0; i < 6; i++) {
            const a = Math.random() * Math.PI * 2, dist = 150 + Math.random() * 150;
            const bx = Math.cos(a) * dist, bz = Math.sin(a) * dist, by = 55 + Math.random() * 45, col = balloonCols[i % balloonCols.length];
            const balloon = BABYLON.MeshBuilder.CreateSphere("balloon" + i, { diameter: 14 + Math.random() * 8, segments: 10 }, scene);
            balloon.position = new BABYLON.Vector3(bx, by, bz);
            balloon.scaling = new BABYLON.Vector3(1, 1.2, 1);
            balloon.material = sharedMat("balloon" + (i % balloonCols.length), col, [col[0] * 0.25, col[1] * 0.25, col[2] * 0.25]);
            balloon.isPickable = false; balloon.freezeWorldMatrix();
            const basket = BABYLON.MeshBuilder.CreateBox("basket" + i, { size: 2 }, scene);
            basket.position = new BABYLON.Vector3(bx, by - (9 + Math.random() * 4), bz);
            basket.material = sharedMat("basket", [0.4, 0.28, 0.12]);
            basket.isPickable = false; basket.freezeWorldMatrix();
        }
    }

    // Roadside props near the track edge, themed.
    if (sc === "desert") {
        for (let i = 0; i < 18; i++) {
            const [x, z] = scatter(4), d = 1 + Math.random() * 0.8;
            place("tumble", (k) => { const me = BABYLON.MeshBuilder.CreateSphere(k, { diameter: 1, segments: 4 }, scene); me.material = sharedMat("tumble", [0.6, 0.5, 0.25]); return me; }, i, x, 0.6, z, d, d, d);
        }
    } else if (sc === "snow") {
        for (let i = 0; i < 18; i++) {
            const [x, z] = scatter(4), d = 1.4 + Math.random() * 1.2;
            place("snowPile", (k) => { const me = BABYLON.MeshBuilder.CreateSphere(k, { diameter: 1, segments: 6 }, scene); me.material = sharedMat("smBase", [0.97, 0.97, 1]); return me; }, i, x, d * 0.2, z, d, d * 0.5, d);
        }
    } else if (sc === "kitchen") {
        for (let i = 0; i < 14; i++) {
            const [x, z] = scatter(4);
            place("sugar", (k) => { const me = BABYLON.MeshBuilder.CreateBox(k, { size: 1.6 }, scene); me.material = sharedMat("sugar", [0.98, 0.98, 1], [0.12, 0.12, 0.13]); return me; }, i, x, 0.8, z, null, null, null, Math.random() * Math.PI);
        }
    } else if (sc === "forest" || sc === "valley") {
        for (let i = 0; i < 18; i++) {
            const [x, z] = scatter(4);
            place("hay", (k) => { const me = BABYLON.MeshBuilder.CreateCylinder(k, { height: 1.4, diameter: 1.8, tessellation: 12 }, scene); me.material = sharedMat("hay", [0.85, 0.72, 0.3]); return me; }, i, x, 0.9, z, null, null, null, Math.random() * Math.PI, Math.PI / 2);
        }
    }

    // Track surface (follows the elevation profile)
    const trackRibbonPoints = [];
    for (let i = 0; i < numPoints; i++) {
        const pt = trackPoints[i];
        const nextPt = trackPoints[(i + 1) % numPoints];
        const angle = Math.atan2(nextPt.z - pt.z, nextPt.x - pt.x);
        const perpX = -Math.sin(angle) * trackRibbonWidth;
        const perpZ = Math.cos(angle) * trackRibbonWidth;
        trackRibbonPoints.push([
            new BABYLON.Vector3(pt.x - perpX, pt.y + 0.03, pt.z - perpZ),
            new BABYLON.Vector3(pt.x + perpX, pt.y + 0.03, pt.z + perpZ),
        ]);
    }

    const trackMesh = BABYLON.MeshBuilder.CreateRibbon("track", {
        pathArray: trackRibbonPoints,
        closeArray: true,
        closePath: true,
        sideOrientation: BABYLON.Mesh.DOUBLESIDE
    }, scene);
    const tMat = new BABYLON.StandardMaterial("trackMat", scene);
    tMat.diffuseColor = new BABYLON.Color3(0.3, 0.3, 0.33);
    tMat.specularColor = new BABYLON.Color3(0.08, 0.08, 0.08);
    tMat.emissiveColor = new BABYLON.Color3(0.03, 0.03, 0.04);
    trackMesh.material = tMat;
    trackMesh.receiveShadows = true;
    trackMesh.isPickable = false;
    trackMesh.freezeWorldMatrix();

    // CreateRibbon leaves the track with invalid normals (the closed seam has
    // degenerate triangles, which also poisons ComputeNormals). Derive each
    // vertex's normal analytically from the centreline instead: perpendicular
    // to the track tangent, tilted by the slope, always pointing skyward.
    {
        const tPos = trackMesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
        const tNorm = new Array(tPos.length).fill(0);
        for (let v = 0; v < tPos.length; v += 3) {
            const x = tPos[v], z = tPos[v + 2];
            let ci = 0, cd = Infinity;
            for (let i = 0; i < numPoints; i++) {
                const dx = x - trackPoints[i].x, dz = z - trackPoints[i].z;
                const d = dx * dx + dz * dz;
                if (d < cd) { cd = d; ci = i; }
            }
            const a = trackPoints[ci], b = trackPoints[(ci + 1) % numPoints];
            const tx = b.x - a.x, ty = b.y - a.y, tz = b.z - a.z;
            // n = lateral × tangent  (lateral = (-tz, 0, tx)) — up + slope tilt.
            let nx = -tx * ty, ny = tx * tx + tz * tz, nz = -tz * ty;
            const nl = Math.hypot(nx, ny, nz) || 1;
            tNorm[v] = nx / nl; tNorm[v + 1] = ny / nl; tNorm[v + 2] = nz / nl;
        }
        trackMesh.setVerticesData(BABYLON.VertexBuffer.NormalKind, tNorm);
    }

    // Embankment skirts: where the road climbs, fill the gap between the track
    // edges and the ground with sloped earth so hills read as hills, not as a
    // floating ribbon.
    if (trackMaxY > 1) {
        const skirtMat = new BABYLON.StandardMaterial("skirtMat", scene);
        skirtMat.diffuseColor = C3(theme.ground).scale(0.75);
        skirtMat.specularColor = new BABYLON.Color3(0, 0, 0);
        skirtMat.freeze();
        for (let side = 0; side <= 1; side++) {
            const sgn = side === 0 ? -1 : 1;
            const top = [], bottom = [];
            for (let i = 0; i <= numPoints; i++) {
                const ii = i % numPoints;
                const pt = trackPoints[ii];
                const nextPt = trackPoints[(ii + 1) % numPoints];
                const angle = Math.atan2(nextPt.z - pt.z, nextPt.x - pt.x);
                const px = -Math.sin(angle), pz = Math.cos(angle);
                top.push(new BABYLON.Vector3(pt.x + px * sgn * trackRibbonWidth, pt.y + 0.02, pt.z + pz * sgn * trackRibbonWidth));
                bottom.push(new BABYLON.Vector3(pt.x + px * sgn * (trackRibbonWidth + 2 + pt.y * 1.6), 0, pt.z + pz * sgn * (trackRibbonWidth + 2 + pt.y * 1.6)));
            }
            const skirt = BABYLON.MeshBuilder.CreateRibbon("skirt" + side, { pathArray: [top, bottom], sideOrientation: BABYLON.Mesh.DOUBLESIDE }, scene);
            skirt.material = skirtMat;
            skirt.isPickable = false;
            skirt.freezeWorldMatrix();
        }
    }

    // (Plain white edge line and dashed centre line removed for a cleaner look;
    // the guardrails below define the track edges.)

    // Guardrails
    for (let side = 0; side <= 1; side++) {
        const barrierPoints = [];
        for (let i = 0; i < numPoints; i++) {
            const pt = trackPoints[i];
            const nextPt = trackPoints[(i + 1) % numPoints];
            const angle = Math.atan2(nextPt.z - pt.z, nextPt.x - pt.x);
            const perpX = -Math.sin(angle);
            const perpZ = Math.cos(angle);
            const offset = side === 0 ? -(trackRibbonWidth + 1.5) : (trackRibbonWidth + 1.5);
            barrierPoints.push(new BABYLON.Vector3(pt.x + perpX * offset, pt.y + 1.2, pt.z + perpZ * offset));
        }
        barrierPoints.push(barrierPoints[0].clone()); // close the loop
        const rail = BABYLON.MeshBuilder.CreateTube("barrier" + side, { path: barrierPoints, radius: 0.3, tessellation: 6, cap: BABYLON.Mesh.NO_CAP }, scene);
        const railMat = new BABYLON.StandardMaterial("railMat" + side, scene);
        railMat.diffuseColor = new BABYLON.Color3(0.88, 0.2, 0.2);
        railMat.specularColor = new BABYLON.Color3(0.25, 0.25, 0.25);
        rail.material = railMat;
        rail.isPickable = false;
        rail.freezeWorldMatrix();
    }

    // Barrier posts
    for (let i = 0; i < numPoints; i += 4) {
        const pt = trackPoints[i];
        const nextPt = trackPoints[(i + 1) % numPoints];
        const angle = Math.atan2(nextPt.z - pt.z, nextPt.x - pt.x);
        const perpX = -Math.sin(angle);
        const perpZ = Math.cos(angle);

        for (let side = 0; side <= 1; side++) {
            const offset = side === 0 ? -(trackRibbonWidth + 1.5) : (trackRibbonWidth + 1.5);
            place("post", (k) => { const me = BABYLON.MeshBuilder.CreateCylinder(k, { height: 2.5, diameter: 0.5, tessellation: 8 }, scene); me.material = sharedMat("post", [0.95, 0.95, 0.95]); return me; },
                i * 2 + side, pt.x + perpX * offset, pt.y + 1.25, pt.z + perpZ * offset);
        }
    }

    // Red-white kerbs
    for (let i = 0; i < numPoints; i += 2) {
        const pt = trackPoints[i];
        const nextPt = trackPoints[(i + 1) % numPoints];
        const angle = Math.atan2(nextPt.z - pt.z, nextPt.x - pt.x);
        const perpX = -Math.sin(angle);
        const perpZ = Math.cos(angle);

        for (let side = 0; side <= 1; side++) {
            const offset = side === 0 ? -(trackRibbonWidth - 1) : (trackRibbonWidth - 1);
            const red = (i % 4 === 0), key = red ? "kerbRed" : "kerbWhite", col = red ? [1, 0.15, 0.15] : [1, 1, 1];
            place(key, (k) => { const me = BABYLON.MeshBuilder.CreateBox(k, { width: 0.2, height: 0.08, depth: 2 }, scene); me.material = sharedMat(key, col); return me; },
                i * 2 + side, pt.x + perpX * offset, pt.y + 0.06, pt.z + perpZ * offset, null, null, null, -Math.atan2(perpX, perpZ));
        }
    }

    // Finish line
    const startPt = trackPoints[0];
    const startNextPt = trackPoints[1];
    const trackDir = startNextPt.subtract(startPt).normalize();
    const perpDir = new BABYLON.Vector3(-trackDir.z, 0, trackDir.x);
    const finishRows = 3;
    const finishCols = 18;
    const sqSize = (trackRibbonWidth * 2) / finishCols;
    const sqDepth = 1.3;
    const finishRy = Math.atan2(trackDir.x, trackDir.z);
    for (let row = 0; row < finishRows; row++) {
        for (let col = 0; col < finishCols; col++) {
            const isWhite = (row + col) % 2 === 0, key = isWhite ? "sfWhite" : "sfBlack";
            const alongTrack = (row - finishRows / 2 + 0.5) * sqDepth;
            const acrossTrack = (col - finishCols / 2 + 0.5) * sqSize;
            place(key, (k) => {
                const me = BABYLON.MeshBuilder.CreateBox(k, { width: sqSize - 0.04, height: 0.03, depth: sqDepth - 0.04 }, scene);
                me.material = isWhite ? sharedMat("sfWhite", [1, 1, 1], [0.5, 0.5, 0.5]) : sharedMat("sfBlack", [0.02, 0.02, 0.02]);
                return me;
            }, row * 100 + col,
                startPt.x + trackDir.x * alongTrack + perpDir.x * acrossTrack, startPt.y + 0.06, startPt.z + trackDir.z * alongTrack + perpDir.z * acrossTrack,
                null, null, null, finishRy);
        }
    }

    // ============================================================
    // TRACK FEATURES — tunnels/caves, railway + train, traps, boost pads
    // ============================================================
    const FEATURES = track.features || [];
    const idxAt = (t) => ((Math.floor(t * numPoints) % numPoints) + numPoints) % numPoints;
    // Geometry of the course at a sample index: point, forward angle and the
    // left/right perpendicular (all in the XZ plane).
    const segAt = (i) => {
        const pt = trackPoints[i], nx = trackPoints[(i + 1) % numPoints];
        const ang = Math.atan2(nx.z - pt.z, nx.x - pt.x);
        return { pt, ang, fx: Math.cos(ang), fz: Math.sin(ang), px: -Math.sin(ang), pz: Math.cos(ang), len: Math.hypot(nx.x - pt.x, nx.z - pt.z) };
    };

    // --- Tunnels / caves: side walls + roof over a stretch of road.
    // Tall enough that the chase camera (kart + 6) stays inside comfortably.
    const TUNNEL_STYLES = {
        rock:   { wall: [0.33, 0.29, 0.26], roof: [0.28, 0.245, 0.22], glow: [0.07, 0.06, 0.05], light: [1, 0.78, 0.4] },
        snow:   { wall: [0.82, 0.86, 0.93], roof: [0.76, 0.8, 0.89], glow: [0.12, 0.14, 0.18], light: [0.65, 0.85, 1] },
        cheese: { wall: [0.95, 0.74, 0.18], roof: [0.9, 0.68, 0.14], glow: [0.16, 0.11, 0.02], light: [1, 0.95, 0.6] },
    };
    for (const f of FEATURES) {
        if (f.type !== "tunnel") continue;
        const st = TUNNEL_STYLES[f.style] || TUNNEL_STYLES.rock;
        const key = f.style || "rock";
        const i0 = idxAt(f.from), span = (idxAt(f.to) - i0 + numPoints) % numPoints;
        for (let s = 0; s <= span; s++) {
            const i = (i0 + s) % numPoints;
            const g = segAt(i);
            const ry = Math.atan2(g.fx, g.fz); // box depth axis onto the track direction
            const segLen = g.len + 1.2;        // overlap so corners don't leave gaps
            for (let side = -1; side <= 1; side += 2) {
                place("tunWall_" + key, (k) => { const me = BABYLON.MeshBuilder.CreateBox(k, { width: 2.2, height: 10, depth: 1 }, scene); me.material = sharedMat(k, st.wall, st.glow); return me; },
                    i * 2 + (side + 1) / 2, g.pt.x + g.px * side * (trackRibbonWidth + 2.4), g.pt.y + 5, g.pt.z + g.pz * side * (trackRibbonWidth + 2.4), 1, 1, segLen, ry);
            }
            place("tunRoof_" + key, (k) => { const me = BABYLON.MeshBuilder.CreateBox(k, { width: 2 * (trackRibbonWidth + 3.5), height: 1.2, depth: 1 }, scene); me.material = sharedMat(k, st.roof, st.glow); return me; },
                i, g.pt.x, g.pt.y + 10.4, g.pt.z, 1, 1, segLen, ry);
            // Warm little ceiling lights so the inside isn't pitch black.
            if (s % 3 === 1) {
                place("tunLight_" + key, (k) => { const me = BABYLON.MeshBuilder.CreateSphere(k, { diameter: 0.8, segments: 6 }, scene); me.material = sharedMat(k, st.light, st.light); return me; },
                    i, g.pt.x, g.pt.y + 9.4, g.pt.z);
            }
        }
    }

    // --- Railway crossing + train: rails cut across the road; every so often
    // a train thunders through and flattens whoever is on the crossing ---
    const trains = [];
    {
        const railMat2 = sharedMat("railSteel", [0.45, 0.46, 0.5]);
        const sleeperMat = sharedMat("sleeper", [0.32, 0.22, 0.12]);
        for (const f of FEATURES) {
            if (f.type !== "train") continue;
            const i = idxAt(f.at);
            const g = segAt(i);
            const RAIL_HALF = 240;
            const railRy = Math.atan2(g.px, g.pz); // rails run along the road's perpendicular
            // Two rails + sleepers, instanced along the crossing line.
            for (let side = -1; side <= 1; side += 2) {
                const rail = BABYLON.MeshBuilder.CreateBox("rail" + i + "_" + side, { width: 0.35, height: 0.22, depth: RAIL_HALF * 2 }, scene);
                rail.position.set(g.pt.x + g.fx * side * 1.4, g.pt.y + 0.11, g.pt.z + g.fz * side * 1.4);
                rail.rotation.y = railRy;
                rail.material = railMat2;
                rail.isPickable = false; rail.freezeWorldMatrix();
            }
            for (let sl = -RAIL_HALF; sl <= RAIL_HALF; sl += 5) {
                place("sleeper", (k) => { const me = BABYLON.MeshBuilder.CreateBox(k, { width: 4.6, height: 0.14, depth: 1.1 }, scene); me.material = sleeperMat; return me; },
                    (sl + RAIL_HALF) / 5, g.pt.x + g.px * sl, g.pt.y + 0.05, g.pt.z + g.pz * sl, null, null, null, railRy + Math.PI / 2);
            }
            // Crossing signs: striped pole + two red warning lamps, one each side.
            const lamps = [];
            for (let side = -1; side <= 1; side += 2) {
                const sx = g.pt.x + g.fx * side * 5 + g.px * side * (trackRibbonWidth + 4);
                const sz = g.pt.z + g.fz * side * 5 + g.pz * side * (trackRibbonWidth + 4);
                const pole = BABYLON.MeshBuilder.CreateCylinder("xPole" + side, { height: 5, diameter: 0.4, tessellation: 8 }, scene);
                pole.position.set(sx, g.pt.y + 2.5, sz);
                pole.material = sharedMat("xPole", [0.9, 0.9, 0.9]);
                pole.isPickable = false; pole.freezeWorldMatrix();
                const cross = BABYLON.MeshBuilder.CreateBox("xSign" + side, { width: 2.6, height: 0.5, depth: 0.2 }, scene);
                cross.position.set(sx, g.pt.y + 4.6, sz);
                cross.rotation.z = Math.PI / 4;
                cross.material = sharedMat("xSign", [0.95, 0.15, 0.15]);
                cross.isPickable = false; cross.freezeWorldMatrix();
                for (let l = 0; l < 2; l++) {
                    const lampMat = new BABYLON.StandardMaterial("xLamp" + side + "_" + l, scene);
                    lampMat.diffuseColor = new BABYLON.Color3(0.5, 0.05, 0.05);
                    lampMat.emissiveColor = new BABYLON.Color3(0, 0, 0);
                    const lamp = BABYLON.MeshBuilder.CreateSphere("xLampM" + side + "_" + l, { diameter: 0.55, segments: 8 }, scene);
                    lamp.position.set(sx + (l === 0 ? -0.55 : 0.55), g.pt.y + 3.8, sz);
                    lamp.material = lampMat;
                    lamp.isPickable = false; lamp.freezeWorldMatrix();
                    lamps.push(lampMat);
                }
            }
            // The train itself: engine + wagons strung along the rail direction.
            const root = new BABYLON.TransformNode("train" + i, scene);
            const trainCols = [[0.75, 0.12, 0.12], [0.2, 0.3, 0.6], [0.85, 0.6, 0.1], [0.25, 0.55, 0.3]];
            const mkBox = (nm, w, h, d, zOff, yOff, col) => {
                const b = BABYLON.MeshBuilder.CreateBox(nm, { width: w, height: h, depth: d }, scene);
                b.position.set(0, yOff, zOff);
                b.material = sharedMat(nm.replace(/\d+$/, ""), col);
                b.parent = root;
                b.isPickable = false;
                return b;
            };
            mkBox("trnEngine" + i, 4.4, 3.6, 9, 0, 1.9, trainCols[0]);
            mkBox("trnCab" + i, 4.2, 2.4, 3.4, -2.2, 4.6, [0.55, 0.1, 0.1]);
            const chimney = BABYLON.MeshBuilder.CreateCylinder("trnChim" + i, { height: 1.8, diameter: 1.1, tessellation: 10 }, scene);
            chimney.position.set(0, 4.6, 3);
            chimney.material = sharedMat("trnChim", [0.15, 0.15, 0.17]);
            chimney.parent = root; chimney.isPickable = false;
            // Headlamp so you can see it coming at night.
            const head = BABYLON.MeshBuilder.CreateSphere("trnHead" + i, { diameter: 0.9, segments: 8 }, scene);
            head.position.set(0, 2.2, 4.7);
            head.material = sharedMat("trnHead", [1, 0.95, 0.7], [1, 0.9, 0.5]);
            head.parent = root; head.isPickable = false;
            for (let w = 0; w < 3; w++) {
                mkBox("trnWagon" + i + "_" + w, 4.2, 3, 7.5, -11 - w * 9, 1.8, trainCols[1 + (w % 3)]);
            }
            root.rotation.y = railRy;
            root.setEnabled(false);
            trains.push({
                root, lamps,
                cx: g.pt.x, cz: g.pt.z, y: g.pt.y,
                px: g.px, pz: g.pz,            // rail (travel) direction
                fx: g.fx, fz: g.fz,            // road direction at the crossing
                period: f.period || 1500,
                timer: Math.floor((f.period || 1500) * 0.55), // first pass comes fairly soon
                half: RAIL_HALF,
            });
        }
    }

    // --- Permanent traps + boost pads painted onto the road ---
    const staticHazards = [];
    const boostPads = [];
    {
        const HAZ_STYLE = {
            oil:    { col: [0.07, 0.07, 0.09], em: [0.02, 0.02, 0.03], r: 3.2, alpha: 0.9 },
            ice:    { col: [0.72, 0.88, 1], em: [0.25, 0.35, 0.45], r: 3.8, alpha: 0.85 },
            mud:    { col: [0.4, 0.28, 0.14], em: [0.05, 0.03, 0.01], r: 3.6, alpha: 1 },
            spikes: { col: [0.45, 0.45, 0.5], em: [0.05, 0.05, 0.06], r: 2.8, alpha: 1 },
        };
        for (const f of FEATURES) {
            if (f.type === "trap") {
                const g = segAt(idxAt(f.at));
                const lane = (f.lane || 0) * trackRibbonWidth * 0.45;
                const hx = g.pt.x + g.px * lane, hz = g.pt.z + g.pz * lane;
                const sdef = HAZ_STYLE[f.kind] || HAZ_STYLE.oil;
                const disc = BABYLON.MeshBuilder.CreateDisc("haz" + f.at, { radius: sdef.r, tessellation: 18 }, scene);
                disc.position.set(hx, g.pt.y + 0.08, hz);
                disc.rotation.x = Math.PI / 2;
                const hm = new BABYLON.StandardMaterial("hazMat" + f.at, scene);
                hm.diffuseColor = C3(sdef.col);
                hm.emissiveColor = C3(sdef.em);
                hm.alpha = sdef.alpha;
                hm.specularColor = f.kind === "ice" ? new BABYLON.Color3(0.8, 0.9, 1) : new BABYLON.Color3(0, 0, 0);
                disc.material = hm;
                disc.isPickable = false; disc.freezeWorldMatrix();
                if (f.kind === "spikes") {
                    // A strip of nasty little spikes poking out of the plate.
                    for (let sp = 0; sp < 7; sp++) {
                        place("spike", (k) => { const me = BABYLON.MeshBuilder.CreateCylinder(k, { height: 0.9, diameterTop: 0, diameterBottom: 0.45, tessellation: 6 }, scene); me.material = sharedMat("spike", [0.6, 0.6, 0.65]); return me; },
                            sp, hx + (Math.random() - 0.5) * sdef.r * 1.4, g.pt.y + 0.45, hz + (Math.random() - 0.5) * sdef.r * 1.4);
                    }
                }
                staticHazards.push({ kind: f.kind || "oil", x: hx, z: hz, r: sdef.r });
            } else if (f.type === "boost") {
                const g = segAt(idxAt(f.at));
                const lane = (f.lane || 0) * trackRibbonWidth * 0.45;
                const bx = g.pt.x + g.px * lane, bz = g.pt.z + g.pz * lane;
                const pad = BABYLON.MeshBuilder.CreateBox("boostPad" + f.at, { width: 6, height: 0.12, depth: 8 }, scene);
                pad.position.set(bx, g.pt.y + 0.1, bz);
                pad.rotation.y = Math.atan2(g.fx, g.fz);
                const pm = new BABYLON.StandardMaterial("boostMat" + f.at, scene);
                pm.diffuseColor = new BABYLON.Color3(0.1, 0.7, 0.9);
                pm.emissiveColor = new BABYLON.Color3(0.05, 0.5, 0.7);
                pad.material = pm;
                pad.isPickable = false; pad.freezeWorldMatrix();
                boostPads.push({ x: bx, z: bz, mat: pm });
            }
        }
    }
    // Exposed for tools/headless tests.
    window._trains = trains;
    window._staticHazards = staticHazards;
    window._boostPads = boostPads;

    // ============================================================
    // CAR CREATION
    // ============================================================

    function createCar(color, name, model) {
        const m = model || null;
        const car = {
            name: name,
            pos: { x: 0, y: 0.1, z: 0 },
            rotY: 0,
            speed: 0,
            maxSpeed: (m ? m.maxSpeed : 0.85) * GAME_SPEED,
            acceleration: (m ? m.acceleration : 0.018) * GAME_SPEED,
            braking: 0.03 * GAME_SPEED,
            // Steering uses STEER_SPEED, not GAME_SPEED, so slowing the karts down
            // doesn't dull the wheel.
            turnSpeed: (m ? m.turnSpeed : 0.034) * STEER_SPEED,
            weight: m ? m.weight : 1.0,
            knockbackX: 0,
            knockbackZ: 0,
            boostTimer: 0,
            currentItem: null,
            lap: 0,
            checkpointIndex: -1,
            _crossings: 0,        // start-line crossings — drives monotonic race progress
            _passedStart: false,  // first crossing is the grid→line start, not a lap
            finished: false,
            finishTime: 0,
            invincibleTimer: 0,
            stunTimer: 0,
            dizzyTimer: 0,        // dizzy = frozen in place, seeing stars, until it runs out
            dizzyStars: null,     // orbiting "seeing stars" planes above the kart
            _dizzyPhase: 0,
            bubbleTimer: 0,       // trapped floating inside a bubble (frozen until pop)
            bubbleMesh: null,     // the see-through sphere shown around a bubbled kart
            fogTimer: 0,          // blinded by a stink cloud (player: overlay, AI: weave)
            rating: 100,          // health 0-100: hits drain it, 0 = keel over dizzy
            oil: 100,
            pitCooldown: 0,
            aiTargetIdx: 0,
            aiBaseSpeed: 0.6,
            aiStartDelay: 0,
            positionLabel: null,
            positionMat: null,
            positionTex: null,
            wheels: [],
            body: null,
            bodyMat: null,
            cabin: null,
            spoiler: null,
            hubs: [],
        };

        // Prefer the Kenney 3D vehicle model; fall back to procedural boxes if the
        // asset failed to load. AI cars (no model) cycle through the fleet.
        const kartName = (m && m.model) ? m.model : VEHICLE_POOL[_kartCursor++ % VEHICLE_POOL.length];
        // Give AI cars the weight, size AND toughness of the vehicle they actually
        // drive, so a hulking truck shoves harder, towers over a little kart and
        // shrugs off hits that would send the kart reeling.
        let carScale = (m && m.scale) || 1.25;
        let health = (m && m.stats && m.stats.health) || 3;
        if (!m) {
            const proto = CAR_MODELS.find(c => c.model === kartName);
            if (proto) { car.weight = proto.weight; carScale = proto.scale || 1.25; health = proto.stats.health || 3; }
        }
        car._scale = carScale;
        // Health 1-5 → all damage is divided by this (Tank ≈ 2.1× sturdier
        // than the go-kart). Shown as the "Health" bar in the picker.
        car.toughness = 0.6 + health * 0.3;
        // Collision footprint grows with the vehicle (1.25 scale ≈ old 2.5 pair distance).
        car.radius = carScale;
        const glb = AssetManager.getModel(kartName, name + "_kart");

        if (glb) {
            const container = new BABYLON.TransformNode(name + "_root", scene);
            glb.parent = container;
            glb.position = BABYLON.Vector3.Zero();
            container.scaling = new BABYLON.Vector3(carScale, carScale, carScale);

            const childMeshes = glb.getChildMeshes();
            let carMat = null;
            childMeshes.forEach(cm => {
                // Clone the shared "colormap" material once per car so a boost/hit
                // flash on one kart doesn't tint every kart that shares it.
                if (cm.material) {
                    if (!carMat) carMat = cm.material.clone(name + "_mat");
                    cm.material = carMat;
                }
                shadowGenerator.addShadowCaster(cm);
            });
            car.bodyMat = carMat || new BABYLON.StandardMaterial(name + "_mat", scene);
            // Only the four CORNER wheels roll. Some models (the SUV/Bruiser) carry a
            // spare tyre meshed as "wheel-back" with no left/right side — that's a
            // mounted decoration and must NOT spin. So require a left/right side, and
            // only fall back to every "wheel" mesh if a model names them differently.
            car.wheels = childMeshes.filter(cm => /wheel/i.test(cm.name) && /(left|right)/i.test(cm.name));
            if (car.wheels.length < 2) car.wheels = childMeshes.filter(cm => /wheel/i.test(cm.name));

            // Babylon flips glTF handedness, so detect facing from the cloned wheel
            // positions and rotate the kart so its nose points along +Z (forward).
            container.computeWorldMatrix(true);
            let frontZ = 0, frontN = 0, backZ = 0, backN = 0;
            childMeshes.forEach(cm => {
                cm.computeWorldMatrix(true);
                const z = cm.getAbsolutePosition().z;
                if (/front/i.test(cm.name)) { frontZ += z; frontN++; }
                else if (/back/i.test(cm.name)) { backZ += z; backN++; }
            });
            car._facingOffset = (frontN && backN && (frontZ / frontN) < (backZ / backN)) ? Math.PI : 0;

            // Rest the wheels on the ground (y = 0) regardless of the model's pivot.
            const bb = container.getHierarchyBoundingVectors(true);
            car._groundY = -bb.min.y;
            car.root = container;
            car.spinWheels = (amt) => car.wheels.forEach(w => w.rotate(BABYLON.Axis.X, amt * 0.08, BABYLON.Space.LOCAL));
        } else {
            const bodyDims = (m && m.body) ? m.body : { width: 1.2, height: 0.45, depth: 2.4 };
            car._bodyH = bodyDims.height;
            const body = BABYLON.MeshBuilder.CreateBox(name + "_body", { width: bodyDims.width, height: bodyDims.height, depth: bodyDims.depth }, scene);
            const bodyMat = new BABYLON.StandardMaterial(name + "_bodyMat", scene);
            bodyMat.diffuseColor = color;
            bodyMat.specularColor = new BABYLON.Color3(0.3, 0.3, 0.3);
            bodyMat.specularPower = 32;
            body.material = bodyMat;
            shadowGenerator.addShadowCaster(body);
            car.body = body;
            car.bodyMat = bodyMat;

            const cabinDims = (m && m.cabin) ? m.cabin : { width: 1.0, height: 0.35, depth: 1.2 };
            car._cabinH = cabinDims.height;
            const cabin = BABYLON.MeshBuilder.CreateBox(name + "_cabin", { width: cabinDims.width, height: cabinDims.height, depth: cabinDims.depth }, scene);
            const cabinMat = new BABYLON.StandardMaterial(name + "_cabinMat", scene);
            cabinMat.diffuseColor = new BABYLON.Color3(0.5, 0.8, 1.0);
            cabinMat.alpha = 0.75;
            cabin.material = cabinMat;
            car.cabin = cabin;

            const spoilerDims = (m && m.spoiler) ? m.spoiler : { width: 1.35, height: 0.08, depth: 0.25 };
            const spoiler = BABYLON.MeshBuilder.CreateBox(name + "_spoiler", { width: spoilerDims.width, height: spoilerDims.height, depth: spoilerDims.depth }, scene);
            const spoilerMat = new BABYLON.StandardMaterial(name + "_spoilerMat", scene);
            spoilerMat.diffuseColor = new BABYLON.Color3(0.08, 0.08, 0.08);
            spoilerMat.specularPower = 64;
            spoiler.material = spoilerMat;
            car.spoiler = spoiler;

            const wheelDiam = (m && m.wheelDiam) ? m.wheelDiam : 0.48;
            const wheelPositions = [
                { x: -0.72, z: 0.7 },
                { x: 0.72, z: 0.7 },
                { x: -0.72, z: -0.7 },
                { x: 0.72, z: -0.7 },
            ];

            wheelPositions.forEach((wp, idx) => {
                const wheel = BABYLON.MeshBuilder.CreateCylinder(name + "_wheel" + idx, { height: 0.25, diameter: wheelDiam }, scene);
                wheel.rotation.x = Math.PI / 2;
                const wMat = new BABYLON.StandardMaterial(name + "_wheelMat" + idx, scene);
                wMat.diffuseColor = new BABYLON.Color3(0.08, 0.08, 0.08);
                wheel.material = wMat;
                car.wheels.push(wheel);
                shadowGenerator.addShadowCaster(wheel);

                const hub = BABYLON.MeshBuilder.CreateCylinder(name + "_hub" + idx, { height: 0.02, diameter: wheelDiam * 0.62 }, scene);
                hub.rotation.x = Math.PI / 2;
                const hMat = new BABYLON.StandardMaterial(name + "_hubMat" + idx, scene);
                hMat.diffuseColor = new BABYLON.Color3(0.7, 0.7, 0.75);
                hub.material = hMat;
                car.hubs.push(hub);
            });
            car.spinWheels = (amt) => car.wheels.forEach(w => { w.rotation.z += amt; });
        }

        // Position label
        const labelTex = new BABYLON.DynamicTexture(name + "_labelTex", { width: 64, height: 64 }, scene, true);
        car.positionTex = labelTex;
        car.positionMat = new BABYLON.StandardMaterial(name + "_labelMat", scene);
        car.positionMat.emissiveColor = new BABYLON.Color3(1, 1, 1);
        car.positionMat.disableLighting = true;
        car.positionMat.backFaceCulling = false;
        car.positionMat.opacityTexture = labelTex;
        car.positionMat.diffuseTexture = labelTex;

        const labelPlane = BABYLON.MeshBuilder.CreatePlane(name + "_label", { width: 1.2, height: 1.2 }, scene);
        labelPlane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
        labelPlane.material = car.positionMat;
        labelPlane.position.y = 3.4;
        car.positionLabel = labelPlane;
        // The rank label is pure emissive white; keep it out of the glow so it
        // doesn't bloom into an unreadable white blob over the karts.
        glowLayer.addExcludedMesh(labelPlane);

        car._labelColor = color;

        // Dizzy/feint stars that orbit above the kart when it's reeling from a heavy
        // hit or a lightning strike (shared texture/material — see _dizzyStarMat).
        car.dizzyStars = [];
        for (let s = 0; s < 3; s++) {
            const st = BABYLON.MeshBuilder.CreatePlane(name + "_dizzy" + s, { size: 0.7 }, scene);
            st.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
            st.material = _dizzyStarMat;
            st.isVisible = false;
            st.isPickable = false;
            glowLayer.addExcludedMesh(st);
            car.dizzyStars.push(st);
        }

        // See-through bubble shown around the kart while it's trapped (shared mat).
        const bub = BABYLON.MeshBuilder.CreateSphere(name + "_bubble", { diameter: 4.4, segments: 12 }, scene);
        bub.material = _bubbleMat;
        bub.isVisible = false;
        bub.isPickable = false;
        glowLayer.addExcludedMesh(bub);
        car.bubbleMesh = bub;

        updateCarMeshPositions(car);
        return car;
    }

    function updateCarMeshPositions(car) {
        const px = car.pos.x;
        const py = car.pos.y;
        const pz = car.pos.z;
        const ry = car.rotY;

        // 3D kart model: move/rotate the single container node.
        if (car.root) {
            car.root.position.x = px;
            car.root.position.y = (car._groundY || 0) + (py - 0.1);
            car.root.position.z = pz;
            car.root.rotation.y = ry + (car._facingOffset || 0);
            car.root.rotation.x = car._pitch || 0; // lean up/down hills
            if (car.positionLabel) {
                car.positionLabel.position.x = px;
                car.positionLabel.position.y = py + 2.2 + (car._scale || 1.25); // clear taller vehicles
                car.positionLabel.position.z = pz;
            }
            return;
        }

        const cosR = Math.cos(ry);
        const sinR = Math.sin(ry);

        const bodyH = car._bodyH || 0.45;
        const cabinH = car._cabinH || 0.35;

        car.body.position.x = px;
        car.body.position.y = py + 0.55;
        car.body.position.z = pz;
        car.body.rotation.y = ry;

        car.cabin.position.x = px + sinR * (-0.15);
        car.cabin.position.y = py + 0.55 + bodyH * 0.5 + cabinH * 0.5;
        car.cabin.position.z = pz + cosR * (-0.15);
        car.cabin.rotation.y = ry;

        car.spoiler.position.x = px + sinR * (-1.1);
        car.spoiler.position.y = py + 0.55 + bodyH * 0.5 + 0.15;
        car.spoiler.position.z = pz + cosR * (-1.1);
        car.spoiler.rotation.y = ry;

        const wheelOffsets = [
            { x: -0.72, z: 0.7 },
            { x: 0.72, z: 0.7 },
            { x: -0.72, z: -0.7 },
            { x: 0.72, z: -0.7 },
        ];
        wheelOffsets.forEach((wo, idx) => {
            const wx = px + wo.x * cosR - wo.z * sinR;
            const wz = pz + wo.x * sinR + wo.z * cosR;
            car.wheels[idx].position.x = wx;
            car.wheels[idx].position.y = py + 0.25;
            car.wheels[idx].position.z = wz;
            car.wheels[idx].rotation.y = ry;

            car.hubs[idx].position.x = wx;
            car.hubs[idx].position.y = py + 0.25;
            car.hubs[idx].position.z = wz;
            car.hubs[idx].rotation.y = ry;
        });

        if (car.positionLabel) {
            car.positionLabel.position.x = px;
            car.positionLabel.position.y = py + 3.4;
            car.positionLabel.position.z = pz;
        }
    }

    const carRotY = Math.atan2(startNextPt.x - startPt.x, startNextPt.z - startPt.z);

    // ============================================================
    // SHARED VFX — dizzy stars, trap materials, lightning bolts
    // ============================================================
    // One texture/material reused by every kart's dizzy stars (drawn once).
    const _dizzyStarTex = new BABYLON.DynamicTexture("dizzyStarTex", { width: 64, height: 64 }, scene, true);
    _dizzyStarTex.hasAlpha = true;
    (function () {
        const c = _dizzyStarTex.getContext(), cx = 32, cy = 32, spikes = 5, outer = 27, inner = 12;
        c.clearRect(0, 0, 64, 64);
        c.beginPath();
        for (let i = 0; i < spikes * 2; i++) {
            const r = i % 2 ? inner : outer, a = -Math.PI / 2 + i * Math.PI / spikes;
            const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
            i ? c.lineTo(x, y) : c.moveTo(x, y);
        }
        c.closePath();
        c.fillStyle = "#fff04d"; c.fill();
        c.lineWidth = 4; c.strokeStyle = "#6b4e00"; c.stroke();
        _dizzyStarTex.update();
    })();
    const _dizzyStarMat = new BABYLON.StandardMaterial("dizzyStarMat", scene);
    _dizzyStarMat.emissiveColor = new BABYLON.Color3(1, 1, 1);
    _dizzyStarMat.diffuseTexture = _dizzyStarTex;
    _dizzyStarMat.opacityTexture = _dizzyStarTex;
    _dizzyStarMat.disableLighting = true;
    _dizzyStarMat.backFaceCulling = false;

    // Shared trap materials (so a trail of bananas doesn't spawn a material each).
    const _bananaMat = new BABYLON.StandardMaterial("bananaMat", scene);
    _bananaMat.diffuseColor = new BABYLON.Color3(1, 0.86, 0.16);
    _bananaMat.emissiveColor = new BABYLON.Color3(0.3, 0.25, 0);
    _bananaMat.specularColor = new BABYLON.Color3(0.25, 0.22, 0.1);

    // A big curved crescent banana, built ONCE and instanced per drop (cheap +
    // shares one geometry/material). Lies flat in the XZ plane so it rests on
    // the road; instances just get a position and a random spin.
    const _bananaTemplate = (function () {
        const N = 11, arc = Math.PI * 0.95, R = 1.6, path = [];
        for (let i = 0; i < N; i++) {
            const a = -arc / 2 + (i / (N - 1)) * arc;
            path.push(new BABYLON.Vector3(Math.sin(a) * R, 0, Math.cos(a) * R - R * 0.82));
        }
        const tube = BABYLON.MeshBuilder.CreateTube("bananaTmpl", {
            path,
            tessellation: 10,
            radiusFunction: (i) => 0.08 + 0.42 * Math.pow(Math.sin(Math.PI * (i / (N - 1))), 0.55),
            cap: BABYLON.Mesh.CAP_ALL,
        }, scene);
        tube.material = _bananaMat;
        tube.isPickable = false;
        tube.position.y = -500; // park the template out of sight; only instances show
        return tube;
    })();

    // Oil slick: a plain dark disc was near-invisible on asphalt (and totally lost
    // on the night City Rush track). Paint an iridescent, self-lit slick so it
    // clearly reads as OIL and shows up on any road.
    const _oilMat = new BABYLON.StandardMaterial("oilMat", scene);
    {
        const ot = new BABYLON.DynamicTexture("oilTex", { width: 256, height: 256 }, scene, true);
        const c = ot.getContext(); c.clearRect(0, 0, 256, 256);
        const cx = 128, cy = 128;
        let g = c.createRadialGradient(cx, cy, 8, cx, cy, 122); // dark puddle, soft edges
        g.addColorStop(0, "rgba(24,20,32,0.96)"); g.addColorStop(0.55, "rgba(16,14,22,0.92)");
        g.addColorStop(0.85, "rgba(14,12,20,0.55)"); g.addColorStop(1, "rgba(14,12,20,0)");
        c.fillStyle = g; c.beginPath(); c.arc(cx, cy, 122, 0, 7); c.fill();
        for (const [col, x, y, r] of [["rgba(150,90,230,0.55)", 96, 84, 60], ["rgba(60,205,205,0.45)", 158, 150, 56], ["rgba(235,180,70,0.38)", 120, 168, 42], ["rgba(90,140,255,0.42)", 165, 96, 46]]) {
            const s = c.createRadialGradient(x, y, 2, x, y, r); s.addColorStop(0, col); s.addColorStop(1, "rgba(0,0,0,0)"); // iridescent sheen
            c.fillStyle = s; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
        }
        const h = c.createRadialGradient(102, 92, 2, 102, 92, 34); h.addColorStop(0, "rgba(255,255,255,0.6)"); h.addColorStop(1, "rgba(255,255,255,0)"); // glossy highlight
        c.fillStyle = h; c.beginPath(); c.arc(102, 92, 34, 0, 7); c.fill();
        ot.update(); ot.hasAlpha = true;
        _oilMat.diffuseTexture = ot; _oilMat.useAlphaFromDiffuseTexture = true;
        _oilMat.emissiveTexture = ot; _oilMat.emissiveColor = new BABYLON.Color3(0.55, 0.55, 0.6); // self-lit — visible on dark tracks
        _oilMat.diffuseColor = new BABYLON.Color3(0.25, 0.25, 0.25);
        _oilMat.specularColor = new BABYLON.Color3(0.5, 0.5, 0.6); _oilMat.specularPower = 96;
        _oilMat.backFaceCulling = false;
    }

    // Soapy see-through blue for bubble traps and the around-the-kart prison.
    const _bubbleMat = new BABYLON.StandardMaterial("bubbleMat", scene);
    _bubbleMat.diffuseColor = new BABYLON.Color3(0.55, 0.8, 1);
    _bubbleMat.emissiveColor = new BABYLON.Color3(0.12, 0.25, 0.4);
    _bubbleMat.specularColor = new BABYLON.Color3(1, 1, 1);
    _bubbleMat.specularPower = 96;
    _bubbleMat.alpha = 0.32;
    _bubbleMat.backFaceCulling = false;

    // Dusty grey funnel for tornadoes.
    const _tornadoMat = new BABYLON.StandardMaterial("tornadoMat", scene);
    _tornadoMat.diffuseColor = new BABYLON.Color3(0.75, 0.75, 0.8);
    _tornadoMat.emissiveColor = new BABYLON.Color3(0.22, 0.22, 0.26);
    _tornadoMat.alpha = 0.55;
    _tornadoMat.backFaceCulling = false;

    // Sickly green for the fart stink cloud.
    const _fogMat = new BABYLON.StandardMaterial("fogMat", scene);
    _fogMat.diffuseColor = new BABYLON.Color3(0.55, 0.62, 0.32);
    _fogMat.emissiveColor = new BABYLON.Color3(0.16, 0.19, 0.08);
    _fogMat.alpha = 0.42;
    _fogMat.backFaceCulling = false;

    // Live tornadoes: { root, dirX, dirZ, life, owner, seed }.
    const tornadoes = [];
    function spawnTornado(car) {
        const root = new BABYLON.TransformNode("tornado", scene);
        for (let k = 0; k < 4; k++) {
            const seg = BABYLON.MeshBuilder.CreateCylinder("tornadoSeg" + k, {
                height: 1.7, diameterTop: 1.6 + k * 1.7, diameterBottom: 0.7 + k * 1.3, tessellation: 12
            }, scene);
            seg.position.y = 0.9 + k * 1.6;
            seg.position.x = Math.sin(k * 1.9) * 0.3; // slight kink so the spin reads
            seg.material = _tornadoMat;
            seg.isPickable = false;
            glowLayer.addExcludedMesh(seg);
            seg.parent = root;
        }
        root.position.x = car.pos.x + Math.sin(car.rotY) * 6;
        root.position.z = car.pos.z + Math.cos(car.rotY) * 6;
        tornadoes.push({
            root,
            dirX: Math.sin(car.rotY), dirZ: Math.cos(car.rotY),
            life: 380, owner: car, seed: (gameTime % 100) * 0.37,
        });
    }

    // ----- STABILITY RATING -----
    // Every hit/collision chips away at a car's rating. Damage scales with the
    // weight ratio, so a heavy tank shrugs off most knocks while a light kart
    // crumples fast. When the rating hits 0 the car keels over dizzy for a
    // couple of seconds and comes back at half strength; the rating then slowly
    // regenerates over the race.
    // A knocked-out kart wakes up when its health crawls back to DIZZY_WAKE
    // (≈2.5s from zero at DIZZY_REGEN/frame). Hits taken while dizzy drain
    // health again, so they genuinely extend the recovery.
    const DIZZY_WAKE = 50;
    const DIZZY_REGEN = 0.34;

    // `raw` skips the toughness absorption — for effects that should cost
    // everyone the same fixed amount of health (e.g. lightning).
    function damageRating(car, amount, raw) {
        if (isNet(car)) return; // ghosts take damage on their own client, not here
        if (amount <= 0 || car.invincibleTimer > 0 || car.bubbleTimer > 0) return;
        car.rating -= raw ? amount : amount / (car.toughness || 1); // sturdy vehicles absorb hits
        if (car.rating <= 0) {
            car.rating = 0; // health rebuilds bit by bit while the kart sits dizzy
            if (car === playerCar && car.dizzyTimer <= 0) showRoadFeedback("💫 Too many hits — dizzy!", "#ffd93b", 1400);
            car.dizzyTimer = Math.max(car.dizzyTimer, 30); // floor; recovery loop sustains it until DIZZY_WAKE
        }
    }

    // Free a bubbled car: hide the bubble, drop it back onto the road.
    // Callable both mid-bubble (collision pop) and at natural expiry, when the
    // timer has already hit 0 — so it keys off the mesh, not the timer.
    function popBubble(c) {
        c.bubbleTimer = 0;
        if (c.bubbleMesh && c.bubbleMesh.isVisible) {
            c.bubbleMesh.isVisible = false;
            SoundManager.popSound();
        }
        c.pos.y = trackYAt(c.pos.x, c.pos.z) + 0.1;
        c.speed = 0;
        updateCarMeshPositions(c);
    }

    // Lightning bolt that flashes down onto a struck car (shared texture/material).
    const _boltTex = new BABYLON.DynamicTexture("boltTex", { width: 64, height: 256 }, scene, true);
    _boltTex.hasAlpha = true;
    (function () {
        const c = _boltTex.getContext();
        c.clearRect(0, 0, 64, 256);
        c.lineCap = "round"; c.lineJoin = "round";
        const pts = [[34, 4], [22, 62], [42, 112], [20, 162], [40, 206], [28, 252]];
        c.strokeStyle = "rgba(130,200,255,0.55)"; c.lineWidth = 18;
        c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.stroke();
        c.strokeStyle = "#ffffff"; c.lineWidth = 6;
        c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.stroke();
        _boltTex.update();
    })();
    const _boltMat = new BABYLON.StandardMaterial("boltMat", scene);
    _boltMat.emissiveColor = new BABYLON.Color3(0.85, 0.95, 1);
    _boltMat.diffuseTexture = _boltTex;
    _boltMat.opacityTexture = _boltTex;
    _boltMat.disableLighting = true;
    _boltMat.backFaceCulling = false;
    const lightningBolts = [];
    function strikeLightning(c) {
        const bolt = BABYLON.MeshBuilder.CreatePlane("bolt", { width: 2.6, height: 9 }, scene);
        bolt.billboardMode = BABYLON.Mesh.BILLBOARDMODE_Y;
        bolt.material = _boltMat;
        bolt.isPickable = false;
        bolt.position.x = c.pos.x; bolt.position.y = c.pos.y + 4.5; bolt.position.z = c.pos.z;
        lightningBolts.push({ mesh: bolt, car: c, life: 26 });
    }

    // ---- Starting grid -------------------------------------------------------
    // A proper staggered 2-wide grid laid out BEHIND the start/finish line and
    // along the actual track direction, so cars never overlap and never start
    // on top of (or past) the line. Slot 0 = pole.
    const gridFwdX = Math.sin(carRotY), gridFwdZ = Math.cos(carRotY); // travel dir
    const gridRightX = Math.cos(carRotY), gridRightZ = -Math.sin(carRotY); // lateral
    const GRID_BACK = 6, GRID_ROW_GAP = 6, GRID_LANE = 6;
    function placeOnGrid(car, slot) {
        const row = Math.floor(slot / 2), col = slot % 2;
        const back = GRID_BACK + row * GRID_ROW_GAP;       // distance behind the line
        const lat = (col === 0 ? -1 : 1) * GRID_LANE;      // left / right of centre
        const x = startPt.x - gridFwdX * back + gridRightX * lat;
        const z = startPt.z - gridFwdZ * back + gridRightZ * lat;
        car.pos.x = x;
        car.pos.z = z;
        car.pos.y = trackYAt(x, z) + 0.1;
        car.rotY = carRotY;
        car.checkpointIndex = findClosestTrackSegment(x, z); // a high index, behind the line
        car._crossings = 0;
        car._passedStart = false;
        updateCarMeshPositions(car);
    }

    const playerModel = selectedCarModel || CAR_MODELS[1];
    const playerColor = new BABYLON.Color3(playerModel.color[0], playerModel.color[1], playerModel.color[2]);
    playerCar = createCar(playerColor, "player", playerModel);
    // Grid slots come from the SHARED, server-ordered player list so every client
    // agrees who stands on which slot. Without this each client placed its OWN car
    // on slot 0, so in world space everyone (and their network ghosts) piled onto
    // the exact same spot. Now player P occupies the same slot on every screen.
    const _mpPlayers = (isMultiplayer && window._multiplayerPlayers) ? window._multiplayerPlayers : null;
    const slotOf = (pid) => { const i = _mpPlayers ? _mpPlayers.findIndex(p => p.id === pid) : -1; return i >= 0 ? i : 0; };
    placeOnGrid(playerCar, _mpPlayers ? slotOf(myPlayerId) : 0);

    // AI cars
    const aiColors = [
        new BABYLON.Color3(0.95, 0.2, 0.2),
        new BABYLON.Color3(0.2, 0.9, 0.2),
        new BABYLON.Color3(0.95, 0.75, 0.1),
        new BABYLON.Color3(0.75, 0.2, 0.9),
        new BABYLON.Color3(0.95, 0.5, 0.05),
    ];

    const aiCars = [];
    
    networkCars = [];
    if (_mpPlayers) {
        const otherPlayers = _mpPlayers.filter(p => p.id !== myPlayerId);
        otherPlayers.forEach((player, idx) => {
            const carModel = player.car || CAR_MODELS[1];
            const color = new BABYLON.Color3(carModel.color[0], carModel.color[1], carModel.color[2]);
            const networkCar = createCar(color, "net" + idx, carModel);
            placeOnGrid(networkCar, slotOf(player.id));
            networkCar._playerId = player.id;
            networkCar._label = player.name || ("Player " + (idx + 2));
            networkCar._targetPos = { x: networkCar.pos.x, y: networkCar.pos.y, z: networkCar.pos.z };
            networkCar._targetRotY = networkCar.rotY;
            networkCars.push(networkCar);
            remoteCars.set(player.id, networkCar);
        });
    }

    const totalHumanCars = _mpPlayers ? _mpPlayers.length : 1;
    const aiCarCount = Math.max(0, 5 - totalHumanCars);
    let _aiSlot = totalHumanCars; // AI fill the slots BEHIND every human

    for (let i = 0; i < aiCarCount; i++) {
        const aiCar = createCar(aiColors[i % aiColors.length], "ai" + i);
        placeOnGrid(aiCar, _aiSlot++);
        aiCar.aiTargetIdx = (aiCar.checkpointIndex + 4) % numPoints;
        aiCar.aiBaseSpeed = (0.95 + i * 0.03) * GAME_SPEED;
        aiCar.aiStartDelay = 8 + i * 6;
        aiCars.push(aiCar);
    }

    const allCars = [playerCar, ...aiCars, ...networkCars];
    // A unique tiny epsilon per car so two cars at the EXACT same spot still get
    // a deterministic, distinct rank (no two cars can ever share a position).
    allCars.forEach((c, idx) => { c._tieBreak = idx * 1e-4; });

    // Remote players are GHOSTS: their car is owned by their own client (position
    // + effect state arrive over the network). Local physics — collisions, traps,
    // train, projectiles, dizzy/stun/damage — must NEVER touch a ghost, or it
    // shows false dizzy/spins that aren't happening on the owner's screen.
    const isNet = (c) => c._playerId != null;

    // Live, fine-grained, monotonic race progress: completed start-line crossings,
    // plus the segment index, plus the fractional position WITHIN the segment, plus
    // the tiny per-car tiebreak. Used for every ranking decision.
    function carProgress(car) {
        const i = car.checkpointIndex < 0 ? 0 : car.checkpointIndex;
        const a = trackPoints[i], b = trackPoints[(i + 1) % numPoints];
        const dx = b.x - a.x, dz = b.z - a.z, len2 = dx * dx + dz * dz || 1;
        let t = ((car.pos.x - a.x) * dx + (car.pos.z - a.z) * dz) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        return (car._crossings || 0) * numPoints + i + t + (car._tieBreak || 0);
    }

    // Advance a car's segment + crossing counters from its current position.
    // Returns true on the frame it completes a real lap (not the grid→line start).
    function advanceProgress(car) {
        const cp = findClosestTrackSegment(car.pos.x, car.pos.z);
        let lapped = false;
        if (cp !== car.checkpointIndex) {
            if (cp < 12 && car.checkpointIndex > numPoints - 12) {        // forward over the line
                car._crossings = (car._crossings || 0) + 1;
                if (car._passedStart) { car.lap++; lapped = true; }
                else car._passedStart = true;                            // the start, not a lap
            } else if (cp > numPoints - 12 && car.checkpointIndex >= 0 && car.checkpointIndex < 12) {
                car._crossings = Math.max(0, (car._crossings || 0) - 1);  // spun back over the line
                if (car.lap > 0) car.lap--;
            }
            car.checkpointIndex = cp;
        }
        return lapped;
    }
    window._allCars = allCars; // exposed for tools/headless tests
    window._getItemRows = () => itemRows; // exposed for tools/headless tests (defined below)

    const GATE_CHANCE = 0.45;  // how often a question row is served as a wall
    const GATE_STYLES = [
        { name: "Castle Gate", wall: [0.60, 0.30, 0.24], trim: [0.42, 0.26, 0.15], glow: 0.05, cap: "🏰" },
        { name: "Ice Wall", wall: [0.62, 0.84, 0.95], trim: [0.30, 0.58, 0.82], glow: 0.16, cap: "❄️" },
        { name: "Candy Wall", wall: [0.96, 0.46, 0.70], trim: [0.55, 0.18, 0.40], glow: 0.12, cap: "🍬" },
        { name: "Jungle Gate", wall: [0.26, 0.56, 0.26], trim: [0.34, 0.24, 0.12], glow: 0.05, cap: "🌿" },
        { name: "Energy Gate", wall: [0.34, 0.26, 0.82], trim: [0.62, 0.32, 1.00], glow: 0.34, cap: "🚀" },
        { name: "Sand Gate", wall: [0.85, 0.72, 0.42], trim: [0.55, 0.42, 0.20], glow: 0.05, cap: "🏜️" },
    ];
    const GATE_HALF = 21;      // wall reaches past both guardrails — no driving round it
    const GATE_DOOR_W = 7.2;   // clear opening per door
    const GATE_H = 5.4;

    // ============================================================
    // ITEM BOXES
    // ============================================================

    // Item boxes are arranged in rows spanning the track. Each row poses a quiz
    // question shown on the on-screen dashboard (#road-question); its boxes are
    // plain (no labels), laid out left→right in the same order as the dashboard's
    // answer choices. The player reads the dashboard, works out which choice is
    // correct, and drives through the box in that lane position to win an item.
    const ITEM_ROWS = 4;           // fewer question rows so quizzes come up less often
    const BOXES_PER_ROW = 4;       // one box per answer choice (questions have 4)
    const LANE_SPACING = 30 / BOXES_PER_ROW;
    const ITEM_BASE_Y = 0.85;
    const ITEM_BOB = 0.18;
    const itemBoxes = [];
    const itemBoxBasePositions = [];
    const itemRows = [];

    // Pick a fresh multiple-choice question and lay ALL its answer choices out across
    // the row's boxes (one box per choice), in lane order. Each client picks
    // independently, so different players see different questions. The boxes look
    // identical — the player reads the dashboard to know which lane is correct.
    // Questions are dealt from a shuffled deck so every question in the bank
    // appears once before ANY repeats (random picks kept re-serving the same
    // few). The deck reshuffles when it runs dry.
    let _quizDeck = [];
    function drawQuizQuestion(avoid) {
        if (!mcQuestions.length) return null;
        if (!_quizDeck.length) {
            _quizDeck = [...mcQuestions];
            for (let k = _quizDeck.length - 1; k > 0; k--) {
                const j = Math.floor(Math.random() * (k + 1));
                [_quizDeck[k], _quizDeck[j]] = [_quizDeck[j], _quizDeck[k]];
            }
        }
        let q = _quizDeck.pop();
        // after a reshuffle, don't immediately re-deal what this row just asked
        if (avoid && q.question === avoid && _quizDeck.length) {
            const swap = _quizDeck.pop();
            _quizDeck.push(q);
            q = swap;
        }
        return q;
    }

    function assignRowQuiz(r) {
        const fallback = { question: "2 + 2 = ?", answer: "4", choices: ["3", "4", "5", "6"] };
        const q = drawQuizQuestion(r._lastQuestion) || fallback;
        r._lastQuestion = q.question;

        const ans = String(q.answer);
        const correct = q.choices.find(c => c.toLowerCase() === ans.toLowerCase()) || ans;
        const choices = [...q.choices];
        for (let k = choices.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [choices[k], choices[j]] = [choices[j], choices[k]]; }

        // Use as many boxes as the question has choices (capped at the boxes built).
        const n = Math.min(choices.length, r.boxes.length);
        let correctPos = choices.indexOf(correct);
        if (correctPos < 0 || correctPos >= n) {
            correctPos = Math.floor(Math.random() * n);
            choices[correctPos] = correct;
        }
        r.correctIdx = correctPos;
        r.questionText = q.question;
        r.choiceTexts = choices.slice(0, n); // in lane order (left → right)

        // Serve this question as a wall of doors instead of floating boxes now and
        // then. Same question, same place, same cadence — just a harsher way to
        // answer it. Decided fresh on every respawn so a lap is never predictable.
        r.kind = Math.random() < GATE_CHANCE ? "gate" : "boxes";
        if (r.kind === "gate") { buildRowGate(r); return; }
        clearRowGate(r);

        r.boxes.forEach((bi, j) => {
            const box = itemBoxes[bi];
            const used = j < n;
            box._quizUsed = used;
            box._isCorrect = used && (j === correctPos);
            box._itemActive = used;
            box.isVisible = used;
            if (used) {
                box.position = itemBoxBasePositions[bi].clone();
            }
            // Paint this lane's answer onto the floating label.
            if (box._label) {
                box._label.isVisible = used;
                if (used) {
                    const text = String(choices[j]);
                    const tex = box._labelTex;
                    const c2 = tex.getContext();
                    c2.clearRect(0, 0, 256, 96);
                    c2.fillStyle = "rgba(12, 16, 40, 0.92)";
                    c2.fillRect(0, 0, 256, 96);
                    c2.strokeStyle = "#ffd93b";
                    c2.lineWidth = 5;
                    c2.strokeRect(3, 3, 250, 90);
                    const size = text.length <= 4 ? 60 : text.length <= 8 ? 44 : 32;
                    tex.drawText(text, null, 48 + size * 0.36, `bold ${size}px Arial`, "#ffffff", null, true);
                }
            }
        });
    }

    for (let row = 0; row < ITEM_ROWS; row++) {
        const tIdx = Math.floor(row * (numPoints / ITEM_ROWS) + numPoints / ITEM_ROWS / 2) % numPoints;
        const pt = trackPoints[tIdx];
        const nextPt = trackPoints[(tIdx + 1) % numPoints];
        const angle = Math.atan2(nextPt.z - pt.z, nextPt.x - pt.x);
        const perpX = -Math.sin(angle);
        const perpZ = Math.cos(angle);

        // trackIndex lets the dashboard show the row the player is driving INTO
        // (next one ahead along the track), so its boxes match the shown choices.
        const rowObj = { idx: row, boxes: [], correctIdx: 0, respawnTimer: 0, trackIndex: tIdx, kind: "boxes", gate: null, gateMeshes: [] };

        for (let j = 0; j < BOXES_PER_ROW; j++) {
            const i = row * BOXES_PER_ROW + j;
            // Lane 0 sits on the player's LEFT so boxes line up with the dashboard's
            // left→right answer choices (otherwise the on-screen lanes are mirrored).
            const off = ((BOXES_PER_ROW - 1) / 2 - j) * LANE_SPACING;
            const pos = new BABYLON.Vector3(pt.x + perpX * off, pt.y + ITEM_BASE_Y, pt.z + perpZ * off);
            itemBoxBasePositions.push(pos.clone());

            const box = BABYLON.MeshBuilder.CreateBox("itemBox" + i, { width: 1.4, height: 1.4, depth: 1.4 }, scene);
            box.position = pos;
            box.rotation.y = Math.random() * Math.PI;
            const boxMat = new BABYLON.StandardMaterial("itemBoxMat" + i, scene);
            boxMat.diffuseColor = new BABYLON.Color3(1.0, 0.85, 0.2);
            boxMat.emissiveColor = new BABYLON.Color3(0.6, 0.5, 0.1);
            boxMat.specularColor = new BABYLON.Color3(0.5, 0.5, 0.5);
            box.material = boxMat;
            box._itemActive = true;
            box._itemIndex = i;
            box._row = row;
            itemBoxes.push(box);
            shadowGenerator.addShadowCaster(box);

            // Floating answer label above the box, always facing the camera —
            // so you can read each lane's answer without the dashboard.
            const lblTex = new BABYLON.DynamicTexture("boxLblTex" + i, { width: 256, height: 96 }, scene, true);
            const lblMat = new BABYLON.StandardMaterial("boxLblMat" + i, scene);
            lblMat.emissiveTexture = lblTex;
            lblMat.diffuseColor = new BABYLON.Color3(0, 0, 0);
            lblMat.specularColor = new BABYLON.Color3(0, 0, 0);
            lblMat.disableLighting = true;
            lblMat.backFaceCulling = false;
            const lbl = BABYLON.MeshBuilder.CreatePlane("boxLbl" + i, { width: 3.8, height: 1.42 }, scene);
            lbl.position = new BABYLON.Vector3(pos.x, pos.y + 1.75, pos.z);
            lbl.billboardMode = BABYLON.Mesh.BILLBOARDMODE_Y;
            lbl.material = lblMat;
            lbl.isPickable = false;
            glowLayer.addExcludedMesh(lbl);
            box._label = lbl;
            box._labelTex = lblTex;

            rowObj.boxes.push(i);
        }

        itemRows.push(rowObj);
        assignRowQuiz(rowObj);
    }

    // ============================================================
    // ANSWER GATES — a quiz row served as a wall of doors
    // ============================================================
    // A question row is served one of two ways, decided fresh each time the row
    // respawns: the usual floating item boxes, or a WALL across the road with one
    // labelled doorway per answer. Same questions, same cadence — but on a wall
    // row you can't just ignore it: drive through the right door and you collect
    // the item as usual, pick a wrong one (or smack a pillar) and you crash, see
    // stars, and come to on the far side.


    // Wall pieces belong to the row that owns them, so a row can switch between
    // "boxes" and "gate" every time it respawns.
    function clearRowGate(r) {
        if (r.gateMeshes) for (const m of r.gateMeshes) m.dispose();
        r.gateMeshes = [];
        r.gate = null;
    }

    function buildRowGate(r) {
        clearRowGate(r);
        const choices = r.choiceTexts;
        const n = choices.length;
        const styleIdx = Math.floor(Math.random() * GATE_STYLES.length);
        const style = GATE_STYLES[styleIdx];
        r.styleIdx = styleIdx;

        const pt = trackPoints[r.trackIndex];
        const nextPt = trackPoints[(r.trackIndex + 1) % numPoints];
        const ang = Math.atan2(nextPt.z - pt.z, nextPt.x - pt.x);
        const g = {
            pt,
            fx: Math.cos(ang), fz: Math.sin(ang),      // along the road
            px: -Math.sin(ang), pz: Math.cos(ang),     // across it (+ = the player's left)
            doors: [],
        };
        const spacing = (GATE_HALF * 2 - 3) / n;
        for (let j = 0; j < n; j++) g.doors.push(((n - 1) / 2 - j) * spacing);
        r.gate = g;
        r.gateMeshes = [];

        const wallMat = new BABYLON.StandardMaterial("gateWallMat" + r.idx, scene);
        wallMat.diffuseColor = new BABYLON.Color3(...style.wall);
        wallMat.emissiveColor = new BABYLON.Color3(style.wall[0] * style.glow, style.wall[1] * style.glow, style.wall[2] * style.glow);
        wallMat.specularColor = new BABYLON.Color3(0.15, 0.15, 0.15);
        const trimMat = new BABYLON.StandardMaterial("gateTrimMat" + r.idx, scene);
        trimMat.diffuseColor = new BABYLON.Color3(...style.trim);
        trimMat.emissiveColor = new BABYLON.Color3(style.trim[0] * 0.3, style.trim[1] * 0.3, style.trim[2] * 0.3);

        // `faceCamera` meshes must keep their own rotation untouched — setting
        // rotation.y on a billboarded plane fights the billboard and leaves some
        // labels edge-on or back-to-front.
        const place = (mesh, lat, y, faceCamera) => {
            mesh.position = new BABYLON.Vector3(pt.x + g.px * lat, pt.y + y, pt.z + g.pz * lat);
            if (!faceCamera) mesh.rotation.y = Math.atan2(g.fx, g.fz);
            mesh.isPickable = false;
            r.gateMeshes.push(mesh);
        };

        // Solid wall fills everything the doorways don't.
        const openings = g.doors.map(c => [c - GATE_DOOR_W / 2, c + GATE_DOOR_W / 2]).sort((a, b) => a[0] - b[0]);
        let cursor = -GATE_HALF;
        const solids = [];
        for (const [a, b] of openings) { if (a > cursor) solids.push([cursor, a]); cursor = Math.max(cursor, b); }
        if (cursor < GATE_HALF) solids.push([cursor, GATE_HALF]);
        for (const [a, b] of solids) {
            const w = b - a;
            if (w < 0.2) continue;
            const seg = BABYLON.MeshBuilder.CreateBox("gateSeg", { width: w, height: GATE_H, depth: 1.6 }, scene);
            seg.material = wallMat;
            place(seg, (a + b) / 2, GATE_H / 2);
            shadowGenerator.addShadowCaster(seg);
        }
        const beam = BABYLON.MeshBuilder.CreateBox("gateBeam", { width: GATE_HALF * 2, height: 1.3, depth: 2.0 }, scene);
        beam.material = trimMat;
        place(beam, 0, GATE_H + 0.65);

        // One answer label hanging in each doorway.
        g.doors.forEach((lat, j) => {
            const tex = new BABYLON.DynamicTexture("gateLbl" + r.idx + "_" + j, { width: 320, height: 120 }, scene, true);
            const c2 = tex.getContext();
            c2.fillStyle = "rgba(10, 14, 34, 0.92)"; c2.fillRect(0, 0, 320, 120);
            c2.strokeStyle = "#ffd93b"; c2.lineWidth = 6; c2.strokeRect(4, 4, 312, 112);
            const text = String(choices[j]);
            const size = text.length <= 4 ? 74 : text.length <= 8 ? 52 : text.length <= 14 ? 36 : 26;
            tex.drawText(text, null, 60 + size * 0.36, `bold ${size}px Arial`, "#ffffff", null, true);
            const mat = new BABYLON.StandardMaterial("gateLblMat" + r.idx + "_" + j, scene);
            mat.emissiveTexture = tex; mat.diffuseColor = new BABYLON.Color3(0, 0, 0);
            mat.specularColor = new BABYLON.Color3(0, 0, 0); mat.disableLighting = true; mat.backFaceCulling = false;
            const pl = BABYLON.MeshBuilder.CreatePlane("gateLblPl" + r.idx + "_" + j, { width: 6.4, height: 2.4 }, scene);
            pl.material = mat;
            pl.billboardMode = BABYLON.Mesh.BILLBOARDMODE_Y;
            glowLayer.addExcludedMesh(pl);
            place(pl, lat, GATE_H * 0.62, true);
        });

        // Hide this row's boxes — the wall replaces them entirely.
        r.boxes.forEach(b2 => {
            itemBoxes[b2]._itemActive = false;
            itemBoxes[b2].isVisible = false;
            if (itemBoxes[b2]._label) itemBoxes[b2]._label.isVisible = false;
        });

        // Every AI commits to a door now — mostly the right one, so the field
        // mostly gets through and the wall stays a hazard rather than a pile-up.
        for (const c of allCars) {
            if (c === playerCar || isNet(c)) continue;
            (c._gateChoice = c._gateChoice || {})[r.idx] = Math.random() < 0.72 ? r.correctIdx : Math.floor(Math.random() * n);
        }
        for (const c of allCars) if (c._gateRel) c._gateRel[r.idx] = undefined;
    }

    // The wall row the given car is driving towards, if any (used by the AI to
    // line up on its door well before it arrives).
    function gateRowAhead(car) {
        for (const r of itemRows) {
            if (r.kind !== "gate" || !r.gate || r.respawnTimer > 0) continue;
            const rel = (car.pos.x - r.gate.pt.x) * r.gate.fx + (car.pos.z - r.gate.pt.z) * r.gate.fz;
            if (rel < 0 && rel > -85) return r;
        }
        return null;
    }

    function resolveRow(r) {
        r.boxes.forEach(b2 => {
            itemBoxes[b2]._itemActive = false;
            itemBoxes[b2].isVisible = false;
            if (itemBoxes[b2]._label) itemBoxes[b2]._label.isVisible = false;
        });
        clearRowGate(r);
        r.respawnTimer = 220;
    }

    function updateGateRows() {
        for (const r of itemRows) {
            if (r.kind !== "gate" || !r.gate || r.respawnTimer > 0) continue;
            const g = r.gate;
            for (const car of allCars) {
                if (isNet(car)) continue;                 // ghosts judge their own wall
                const rel = (car.pos.x - g.pt.x) * g.fx + (car.pos.z - g.pt.z) * g.fz;
                const lat = (car.pos.x - g.pt.x) * g.px + (car.pos.z - g.pt.z) * g.pz;
                if (!car._gateRel) car._gateRel = {};
                const prev = car._gateRel[r.idx];
                car._gateRel[r.idx] = rel;
                if (prev === undefined || prev >= 0 || rel < 0) continue;
                if (Math.abs(lat) > GATE_HALF + 6 || rel > 14) continue;   // nowhere near it

                const j = g.doors.findIndex(c => Math.abs(lat - c) <= GATE_DOOR_W / 2 - 0.6);
                if (j === r.correctIdx) {
                    car.boostTimer = Math.max(car.boostTimer, 45);
                    if (car === playerCar) {
                        if (!playerCar.currentItem) { playerCar.currentItem = randomItem(); updateItemIndicator(); SoundManager.itemPickup(); }
                        SoundManager.quizCorrect();
                        showRoadFeedback("✅ Right door!", "#5dff7a");
                    }
                } else {
                    // Wrong door, or straight into the wall: crash, see stars, and
                    // come to on the far side so nobody is ever walled in.
                    car.speed *= 0.05;
                    car.stunTimer = Math.max(car.stunTimer, 60);
                    car.dizzyTimer = Math.max(car.dizzyTimer, 95);
                    damageRating(car, 45);
                    const keepLat = Math.max(-15, Math.min(15, lat));
                    car.pos.x = g.pt.x + g.fx * 5 + g.px * keepLat;
                    car.pos.z = g.pt.z + g.fz * 5 + g.pz * keepLat;
                    car._gateRel[r.idx] = 5;
                    if (car === playerCar) {
                        SoundManager.quizWrong();
                        showRevenge(j < 0 ? "🚪 Crashed into the wall!" : "🚪 Wrong door — dizzy!");
                        cameraShake = Math.max(cameraShake, 1.4);
                    }
                }
                if (car === playerCar) { resolveRow(r); break; }
            }
        }
    }

    // ============================================================
    // PROJECTILES
    // ============================================================

    const projectiles = [];

    // One shared, frozen material + a hidden template for collision sparks, so a
    // hit doesn't allocate 8 fresh meshes + materials.
    const sparkMat = new BABYLON.StandardMaterial("sparkMat", scene);
    sparkMat.diffuseColor = new BABYLON.Color3(1, 0.6, 0.1);
    sparkMat.emissiveColor = new BABYLON.Color3(1, 0.4, 0);
    sparkMat.freeze();
    const sparkTemplate = BABYLON.MeshBuilder.CreateSphere("sparkTmpl", { diameter: 0.2, segments: 4 }, scene);
    sparkTemplate.material = sparkMat;
    sparkTemplate.position.y = -500; // park the template out of sight; only instances show
    sparkTemplate.isPickable = false;

    function fireProjectile(shooter) {
        const proj = BABYLON.MeshBuilder.CreateSphere("proj" + Date.now(), { diameter: 2.5 }, scene);
        proj.position.x = shooter.pos.x;
        proj.position.y = shooter.pos.y + 0.9;
        proj.position.z = shooter.pos.z;
        const dir = { x: Math.sin(shooter.rotY), y: 0, z: Math.cos(shooter.rotY) };
        proj._dir = dir;
        proj._speed = 2.0;
        proj._life = 0;
        proj._maxLife = 150;
        proj._shooterIdx = allCars.indexOf(shooter);
        const projMat = new BABYLON.StandardMaterial("projMat" + Date.now(), scene);
        projMat.diffuseColor = new BABYLON.Color3(1.0, 0.3, 0.05);
        projMat.emissiveColor = new BABYLON.Color3(1.0, 0.4, 0.0);
        proj.material = projMat;

        const glow = new BABYLON.PointLight("projLight" + Date.now(), proj.position.clone(), scene);
        glow.intensity = 15;
        glow.diffuse = new BABYLON.Color3(1, 0.4, 0);
        glow.range = 30;
        proj._glow = glow;

        projectiles.push(proj);
    }

    // ============================================================
    // ITEM SYSTEM
    // ============================================================

    const traps = [];
    window._traps = traps; // exposed for tools/headless tests
    window._trackYAt = (x, z) => trackYAt(x, z);
    window._getItemBoxes = () => itemBoxes;
    window._forceGateRow = (r) => { r.respawnTimer = 0; r.kind = "gate"; buildRowGate(r); };
    window._creditHitForTest = creditHit;
    window._useItemForTest = (item) => { if (item) playerCar.currentItem = item; useItem(playerCar); };

    function randomItem() {
        const r = Math.random();
        if (r < 0.18) return "boost";
        if (r < 0.30) return "fireball";
        if (r < 0.40) return "shield";
        if (r < 0.50) return "lightning";
        if (r < 0.60) return "banana";
        if (r < 0.70) return "bubble";
        if (r < 0.80) return "tornado";
        if (r < 0.88) return "fart";
        if (r < 0.94) return "star";
        return "oil";
    }

    function useItem(car) {
        if (scene.isDisposed || !car.currentItem) return; // guard pending AI timers after a restart
        const item = car.currentItem;
        car.currentItem = null;

        applyItem(car, item);

        if (car === playerCar) {
            // Tell the other players so they can replay this item on their side.
            sendItemUse(item);
            // Shout the item name for extra hype.
            const yells = {
                boost: "Turbo!", fireball: "Fireball!", shield: "Shield!",
                lightning: "Lightning!", banana: "Banana!", star: "Super star!",
                oil: "Oil slick!", bubble: "Bubble!", tornado: "Tornado!", fart: "Stinky!"
            };
            SoundManager.yell(yells[item]);
            updateItemIndicator();
        }
    }

    // The actual world effect of an item, decoupled from who triggered it so it
    // can be replayed for a REMOTE player (car = their ghost). World effects
    // (traps/projectile/tornado/lightning) spawn from `car`'s position and are
    // simulated locally against our own cars; self-effects (boost/shield/star)
    // set the ghost's timers (harmless — also kept in sync via the position
    // fx bitmask). Sounds play for our own player AND for remote players (so you
    // hear a rival's banana/zap), but stay silent for local AI as before.
    function applyItem(car, item) {
        const audible = (car === playerCar) || isNet(car);

        if (item === "boost") {
            car.boostTimer = 180;
            if (audible) SoundManager.boost();
        } else if (item === "fireball") {
            fireProjectile(car);
            if (audible) SoundManager.fireball();
        } else if (item === "shield") {
            car.invincibleTimer = 360;
            if (audible) SoundManager.shield();
        } else if (item === "lightning") {
            allCars.forEach(c => {
                if (c !== car && !isNet(c)) { // only ever hit our LOCAL cars
                    c.speed *= 0.2;   // near-stop hit — much stronger than a bump
                    // Lightning costs everyone the SAME fixed health (no toughness
                    // absorption). Whoever it drops to zero gets knocked out and
                    // takes the long health-crawl dizzy; the rest just see stars
                    // briefly. A healthy Tank usually has the points to spare.
                    damageRating(c, 60, true);
                    c.stunTimer = Math.max(c.stunTimer, 70);
                    c.dizzyTimer = Math.max(c.dizzyTimer, 95);
                    creditHit(c, car, "lightning");
                    strikeLightning(c); // a bolt flashes down onto each rival
                }
            });
            if (audible) SoundManager.lightning();
        } else if (item === "banana") {
            // Drop a fat string of bananas trailing out behind the kart, fanned
            // slightly side to side so they cover more of the road.
            const sinR = Math.sin(car.rotY), cosR = Math.cos(car.rotY);
            const perpX = cosR, perpZ = -sinR;
            for (let b = 0; b < 5; b++) {
                const back = 3.0 + b * 2.4;
                const side = (b % 2 === 0 ? 1 : -1) * (b * 0.7);
                const bx = car.pos.x - sinR * back + perpX * side;
                const bz = car.pos.z - cosR * back + perpZ * side;
                traps.push({
                    type: "banana",
                    pos: { x: bx, y: trackYAt(bx, bz) + 0.35, z: bz },
                    rot: Math.random() * Math.PI * 2,
                    owner: car,
                    lifetime: 600
                });
            }
            if (audible) SoundManager.banana();
        } else if (item === "star") {
            car.invincibleTimer = 240;
            car.boostTimer = 240;
            if (audible) SoundManager.star();
        } else if (item === "oil") {
            // Sit the slick ON the road: a fixed y buried it under every climb
            // (Alpine Drop reaches y≈21), so the oil simply vanished on hills.
            const ox = car.pos.x - Math.sin(car.rotY) * 4;
            const oz = car.pos.z - Math.cos(car.rotY) * 4;
            const trap = {
                type: "oil",
                pos: { x: ox, y: trackYAt(ox, oz) + 0.2, z: oz },
                owner: car,
                lifetime: 900
            };
            traps.push(trap);
            if (audible) SoundManager.oil();
        } else if (item === "bubble") {
            // A trail of floating bubbles behind the kart; a rival who touches one
            // is sucked inside and floats helplessly until it pops.
            const sinR = Math.sin(car.rotY), cosR = Math.cos(car.rotY);
            for (let b = 0; b < 3; b++) {
                const back = 3 + b * 2.2;
                const bx = car.pos.x - sinR * back, bz = car.pos.z - cosR * back;
                traps.push({
                    type: "bubble",
                    pos: { x: bx, y: trackYAt(bx, bz) + 0.7, z: bz },
                    owner: car,
                    lifetime: 720
                });
            }
            if (audible) SoundManager.bubbleSound();
        } else if (item === "tornado") {
            spawnTornado(car);
            if (audible) SoundManager.tornadoSound();
        } else if (item === "fart") {
            // A lingering stink cloud right behind the kart — pursuers driving
            // into it can't see the road for a while.
            const fx2 = car.pos.x - Math.sin(car.rotY) * 7;
            const fz2 = car.pos.z - Math.cos(car.rotY) * 7;
            traps.push({
                type: "fog",
                pos: { x: fx2, y: trackYAt(fx2, fz2) + 1.2, z: fz2 },
                owner: car,
                lifetime: 540
            });
            if (audible) SoundManager.fartSound();
        }
    }
    // Expose the applier so the global `item-used` socket handler can replay a
    // remote player's item against our local world.
    applyRemoteItemEffect = applyItem;

    function updateItemIndicator() {
        const indicator = document.getElementById("item-indicator");
        if (!playerCar.currentItem) {
            indicator.style.opacity = "0";
            return;
        }
        const itemIcons = { 
            boost: "⚡", 
            fireball: "🔥", 
            shield: "🛡️",
            lightning: "⚡",
            banana: "🍌",
            star: "⭐",
            oil: "🛢️",
            bubble: "🫧",
            tornado: "🌪️",
            fart: "💨"
        };
        indicator.textContent = itemIcons[playerCar.currentItem] || "?";
        indicator.style.opacity = "1";
        
        // Add pulse animation
        indicator.style.transform = "translate(-50%, -50%) translateY(60px) scale(1.2)";
        setTimeout(() => {
            indicator.style.transform = "translate(-50%, -50%) translateY(60px) scale(1)";
        }, 150);
    }

    // ============================================================
    // CAMERA
    // ============================================================

    const camera = new BABYLON.UniversalCamera("camera", new BABYLON.Vector3(0, 8, -12), scene);
    camera.setTarget(new BABYLON.Vector3(0, 0, 0));
    let cameraShake = 0; // decaying screen-shake amount, bumped on collisions
    // Reused every frame so the chase camera never allocates a fresh Vector3 (GC hitches).
    const _camTargetLerp = new BABYLON.Vector3(playerCar.pos.x, playerCar.pos.y + 1.5, playerCar.pos.z);
    // Persistent array re-sorted in place each frame for race standings (no per-frame spread).
    const _sortedCars = allCars.slice();

    // Stink-cloud blindness overlay (opacity toggled only on state change).
    const fogOverlayEl = document.getElementById("fog-overlay");
    let fogShown = false;

    // Health bar (green → orange → red as it drains).
    const ratingBarEl = document.getElementById("ratingBar");

    // Cached refs for the static question panel.
    const roadQ = document.getElementById("road-question");
    const roadQText = roadQ.querySelector(".rq-text");
    const roadQChoices = roadQ.querySelector(".rq-choices");
    camera.minZ = 0.1;
    camera.panningSensibility = 0;

    // ============================================================
    // INPUT
    // ============================================================

    gameKeys = {};
    window.addEventListener("keydown", (e) => {
        if (quizActive) { e.stopPropagation(); return; }
        gameKeys[e.code] = true;
        if (e.code === "Space") {
            e.preventDefault();
            if (playerCar.currentItem) {
                useItem(playerCar);
            }
        }
    });
    window.addEventListener("keyup", (e) => { gameKeys[e.code] = false; });

    // ============================================================
    // TRACK HELPERS
    // ============================================================

    // True nearest point on the centreline POLYLINE (not the nearest vertex).
    // Each segment is projected onto with t clamped to [0,1], so the distance is
    // correct even at sharp spline corners where the nearest vertex's segment
    // points the wrong way. Returns the segment index, the closest point on the
    // road, and the squared distance to it. This is what stops cars slipping
    // through the guardrails on the boxy tracks (City Rush, Formula GP, …).
    function closestOnTrack(posX, posZ) {
        let bi = 0, bx = trackPoints[0].x, bz = trackPoints[0].z, bd2 = Infinity;
        for (let i = 0; i < numPoints; i++) {
            const a = trackPoints[i], b = trackPoints[(i + 1) % numPoints];
            const dx = b.x - a.x, dz = b.z - a.z;
            const len2 = dx * dx + dz * dz || 1;
            let t = ((posX - a.x) * dx + (posZ - a.z) * dz) / len2;
            if (t < 0) t = 0; else if (t > 1) t = 1;
            const cx = a.x + dx * t, cz = a.z + dz * t;
            const ex = posX - cx, ez = posZ - cz;
            const d2 = ex * ex + ez * ez;
            if (d2 < bd2) { bd2 = d2; bi = i; bx = cx; bz = cz; }
        }
        return { i: bi, cx: bx, cz: bz, d2: bd2 };
    }

    // Segment index of the nearest point — used by lap counting + trackYAt.
    function findClosestTrackSegment(posX, posZ) {
        return closestOnTrack(posX, posZ).i;
    }

    // The guardrail's inner face — the hard wall the car BODY may not cross.
    const WALL_DIST = trackRibbonWidth + 1.2;

    // Keep the whole car inside the rails. A car of half-width ≈ radius must stop
    // with its outer edge at the rail, so its CENTRE is capped at (rail − radius)
    // — that's why a hit no longer leaves part of the car poking past the bumper.
    // Only the velocity driving INTO the wall is bled off + scored as an impact,
    // so a car can still glide ALONG the wall without going sticky.
    // Pure positional clamp: rest the car's body edge against the rail. Safe to
    // call repeatedly (it never scores damage), so it also runs as a final sweep
    // AFTER collisions/knockback so a shove can't leave a car poking through.
    function clampToWall(car) {
        const c = closestOnTrack(car.pos.x, car.pos.z);
        const dist = Math.sqrt(c.d2);
        const limit = WALL_DIST - (car.radius || 1.25);
        if (dist <= limit) return null;
        let ux = car.pos.x - c.cx, uz = car.pos.z - c.cz;
        const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
        car.pos.x -= ux * (dist - limit);
        car.pos.z -= uz * (dist - limit);
        return { ux, uz };
    }

    function containCar(car) {
        const hit = clampToWall(car);
        if (!hit) return;
        // how hard the car was driving into the wall (outward velocity component)
        const into = Math.sin(car.rotY) * car.speed * hit.ux + Math.cos(car.rotY) * car.speed * hit.uz;
        if (into > 0.01) {
            wallImpact(car, into);
            // bleed the into-wall part of the speed; keep most of the glide
            car.speed *= Math.max(0.4, 1 - (into / (car.maxSpeed || 1)) * 0.9);
        }
    }


    // Road height under (x, z): closest centreline segment, lerped along it.
    // Cars, item boxes and projectiles all ride on this so the whole race
    // climbs and dives with the elevation profile.
    function trackYAt(x, z) {
        const i = findClosestTrackSegment(x, z);
        const a = trackPoints[i], b = trackPoints[(i + 1) % numPoints];
        const dx = b.x - a.x, dz = b.z - a.z;
        const len2 = dx * dx + dz * dz || 1;
        let t = ((x - a.x) * dx + (z - a.z) * dz) / len2;
        t = Math.max(0, Math.min(1, t));
        return a.y + (b.y - a.y) * t;
    }

    // Settle a car onto the road surface and lean it into the slope.
    function followGround(car) {
        const gy = trackYAt(car.pos.x, car.pos.z);
        car.pos.y += (gy + 0.1 - car.pos.y) * 0.35;
        // Pitch: sample the road a kart-length ahead; positive rotation.x is
        // nose-down in Babylon, so an uphill slope needs a negative pitch.
        const ax = car.pos.x + Math.sin(car.rotY) * 4;
        const az = car.pos.z + Math.cos(car.rotY) * 4;
        const targetPitch = -Math.atan2(trackYAt(ax, az) - gy, 4);
        car._pitch = (car._pitch || 0) + (targetPitch - (car._pitch || 0)) * 0.15;
    }

    // Slamming the guardrail hurts in proportion to speed — like the real
    // world, damage follows kinetic energy (∝ v²): a gentle scrape is free, a
    // full-speed crash drains serious stability. Sturdy vehicles absorb it
    // via toughness inside damageRating (the Tank barely notices).
    function wallImpact(car, intoSpeed) {
        if (car._wallCd > 0) return;
        const f = Math.min(1.2, (intoSpeed != null ? intoSpeed : Math.abs(car.speed)) / (car.maxSpeed || 1));
        if (f < 0.45) return; // soft graze — no harm, and don't burn the cooldown
        car._wallCd = 45;
        damageRating(car, f * f * 45);
        if (car === playerCar) {
            SoundManager.collision();
            cameraShake = Math.max(cameraShake, 0.4 + f * 0.8);
            if (f > 0.75) showRoadFeedback("💥 Wall slam!", "#ff9b6b", 1100);
        }
    }

    // Is the player close enough to a crossing to hear its bells?
    function playerNearby(tr, dist) {
        const dx = playerCar.pos.x - tr.cx, dz = playerCar.pos.z - tr.cz;
        return dx * dx + dz * dz < dist * dist;
    }

    function positionSuffix(pos) {
        if (pos === 1) return "1st";
        if (pos === 2) return "2nd";
        if (pos === 3) return "3rd";
        return pos + "th";
    }

    // ============================================================
    // GAME STATE
    // ============================================================

    const MAX_LAPS = 3;
    let raceStarted = false;
    let countdownValue = 3;
    let countdownTimer = 0;
    // Multiplayer: the 3-2-1 (and so the GO) is HELD until the server confirms
    // every client's scene is built — otherwise whoever's track loaded first got
    // a head start. Single-player releases immediately.
    let goReleased = !isMultiplayer;
    releaseRaceGo = () => { goReleased = true; };
    const countdownEl = document.getElementById("countdown");

    function endRace() {
        SoundManager.stopMusic();
        SoundManager.stopEngine();
        SoundManager.win(); // celebratory fanfare on race complete
        document.getElementById('road-question').style.display = 'none';
        document.getElementById('fog-overlay').style.opacity = '0';
        const finished = allCars.filter(c => c.finished);
        const unfinished = allCars.filter(c => !c.finished);
        const sortedFinished = finished.sort((a, b) => a.finishTime - b.finishTime);
        const sortedUnfinished = unfinished.sort((a, b) => carProgress(b) - carProgress(a));
        const positions = [...sortedFinished, ...sortedUnfinished];

        let resultText = "Race Over!\n\n";
        positions.forEach((car, idx) => {
            const name = car === playerCar ? "You" : car.name.replace("ai", "Rival ");
            resultText += positionSuffix(idx + 1) + ". " + name + "\n";
        });

        countdownEl.style.fontSize = "28px";
        countdownEl.style.whiteSpace = "pre-line";
        countdownEl.style.lineHeight = "1.6";
        countdownEl.textContent = resultText;
        countdownEl.style.display = "block";

        // In a cup the server tallies the points and pushes the standings screen,
        // so don't show the single-race "Play Again" overlay — just hold the local
        // finishing order until the cup-standings arrive.
        if (isMultiplayer && window._cupMode) {
            countdownEl.textContent = resultText + "\nTallying cup points…";
            return;
        }

        if (isMultiplayer && socket) {
            setTimeout(() => {
                countdownEl.style.display = "none";
                document.getElementById('hud').style.display = 'none';
        document.getElementById('corner-hud').style.display = 'none';
        document.getElementById('road-question').style.display = 'none';
                
                const playAgainOverlay = document.createElement('div');
                playAgainOverlay.id = 'play-again-overlay';
                playAgainOverlay.style.cssText = 'position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.85); display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 300;';
                
                const title = document.createElement('h1');
                title.textContent = 'Race Complete!';
                title.style.cssText = 'color: #fff; font-size: 48px; margin-bottom: 30px;';
                playAgainOverlay.appendChild(title);
                
                const resultsDiv = document.createElement('div');
                resultsDiv.style.cssText = 'color: #fff; font-size: 24px; margin-bottom: 40px; text-align: center;';
                resultsDiv.innerHTML = resultText.replace(/\n/g, '<br>');
                playAgainOverlay.appendChild(resultsDiv);
                
                if (isHost) {
                    const playAgainBtn = document.createElement('button');
                    playAgainBtn.textContent = 'Play Again';
                    playAgainBtn.style.cssText = 'background: linear-gradient(135deg, #2288ff, #55aaff); color: #fff; border: none; border-radius: 12px; padding: 16px 48px; font-size: 24px; font-weight: bold; cursor: pointer; margin: 10px;';
                    playAgainBtn.onclick = () => {
                        socket.emit('reset-room');
                        playAgainOverlay.remove();
                    };
                    playAgainOverlay.appendChild(playAgainBtn);
                } else {
                    const waitingText = document.createElement('div');
                    waitingText.textContent = 'Waiting for host to start new race...';
                    waitingText.style.cssText = 'color: rgba(255,255,255,0.7); font-size: 20px;';
                    playAgainOverlay.appendChild(waitingText);
                }
                
                document.body.appendChild(playAgainOverlay);
            }, 3000);
        } else {
            resultText += "\nPress F5 to restart";
            countdownEl.textContent = resultText;
        }
    }

    // ============================================================
    // MINIMAP
    // ============================================================

    const minimapCanvas = document.getElementById("minimap");
    const minimapCtx = minimapCanvas.getContext("2d");

    // Fit whatever course shape we have into the 300px canvas.
    const minimapScale = 130 / Math.max(trackLength, trackWidth, 1);

    function drawMinimap() {
        const w = 300, h = 300;
        minimapCtx.clearRect(0, 0, w, h);
        minimapCtx.fillStyle = "rgba(0, 25, 0, 0.75)";
        minimapCtx.fillRect(0, 0, w, h);

        const scale = minimapScale;
        const cx = w / 2;
        const cy = h / 2;

        minimapCtx.fillStyle = "#444";
        minimapCtx.beginPath();
        for (let i = 0; i < numPoints; i++) {
            let sx = cx + trackPoints[i].x * scale;
            let sy = cy + trackPoints[i].z * scale;
            if (i === 0) minimapCtx.moveTo(sx, sy);
            else minimapCtx.lineTo(sx, sy);
        }
        minimapCtx.closePath();
        minimapCtx.fill();

        // Finish line
        minimapCtx.strokeStyle = "#fff";
        minimapCtx.lineWidth = 2;
        minimapCtx.beginPath();
        const fStart = trackPoints[0];
        const fEnd = trackPoints[1];
        minimapCtx.moveTo(cx + fStart.x * scale, cy + fStart.z * scale);
        minimapCtx.lineTo(cx + fEnd.x * scale, cy + fEnd.z * scale);
        minimapCtx.stroke();

        // Item boxes
        minimapCtx.fillStyle = "#ffdd00";
        itemBoxes.forEach((box, i) => {
            if (box._itemActive) {
                const sx = cx + box.position.x * scale;
                const sy = cy + box.position.z * scale;
                minimapCtx.fillRect(sx - 3.5, sy - 3.5, 7, 7);
            }
        });

        // AI cars
        const aiCarColors = ["#ff3333", "#33ff33", "#ffcc00", "#cc33ff", "#ff8800"];
        aiCars.forEach((aiCar, idx) => {
            const sx = cx + aiCar.pos.x * scale;
            const sy = cy + aiCar.pos.z * scale;
            minimapCtx.fillStyle = aiCarColors[idx] || "#ff5555";
            minimapCtx.beginPath();
            minimapCtx.arc(sx, sy, 6, 0, Math.PI * 2);
            minimapCtx.fill();
            minimapCtx.strokeStyle = "rgba(0,0,0,0.5)";
            minimapCtx.lineWidth = 1.5;
            minimapCtx.beginPath();
            minimapCtx.arc(sx, sy, 6, 0, Math.PI * 2);
            minimapCtx.stroke();
        });

        // Player car
        const px = cx + playerCar.pos.x * scale;
        const py = cy + playerCar.pos.z * scale;
        minimapCtx.fillStyle = "#4488ff";
        minimapCtx.beginPath();
        minimapCtx.arc(px, py, 7, 0, Math.PI * 2);
        minimapCtx.fill();
        minimapCtx.strokeStyle = "#aaccff";
        minimapCtx.lineWidth = 2.5;
        minimapCtx.beginPath();
        minimapCtx.arc(px, py, 10, 0, Math.PI * 2);
        minimapCtx.stroke();

        // Direction arrow
        const arrowLen = 15;
        const arrowX = px + Math.sin(playerCar.rotY) * arrowLen;
        const arrowY = py + Math.cos(playerCar.rotY) * arrowLen;
        minimapCtx.strokeStyle = "#aaccff";
        minimapCtx.lineWidth = 2;
        minimapCtx.beginPath();
        minimapCtx.moveTo(px, py);
        minimapCtx.lineTo(arrowX, arrowY);
        minimapCtx.stroke();
    }

    // ============================================================
    // GAME LOOP
    // ============================================================

    // One physics/logic step = a FIXED 1/60s slice of game time. The dispatcher
    // below runs as many of these per rendered frame as real time demands, so
    // the game advances at the same wall-clock speed on every device — a slow
    // (low-fps) device no longer runs the whole frame-based game in slow motion
    // (which also made that player look slow to everyone else in multiplayer).
    const FIXED_DT = 1000 / 60;

    function stepGame() {
        gameTime++;

        // Safety: ensure quiz overlay is hidden when not active
        if (!quizActive && quizOverlay.style.display !== "none") {
            quizOverlay.style.display = "none";
        }

        // --- Countdown ---
        if (!raceStarted) {
            // goReleased is true at once for single-player; in multiplayer it flips
            // when the server's 'race-go' arrives (all clients built + on the grid),
            // so the 3-2-1 runs in lock-step and everyone launches together.
            if (goReleased) {
              countdownTimer++;
              if (countdownTimer >= 60) {
                countdownTimer = 0;
                countdownValue--;
                if (countdownValue > 0) {
                    countdownEl.textContent = countdownValue;
                    countdownEl.style.fontSize = "96px";
                    SoundManager.countdownBeep();
                } else if (countdownValue === 0) {
                    countdownEl.textContent = "GO!";
                    raceStarted = true;
                    window._raceEnded = false;
                    SoundManager.countdownGo();
                    SoundManager.startEngine();
                    SoundManager.startMusic();
                    setTimeout(() => { countdownEl.textContent = ""; }, 800);
                }
              }
            }

            const pPos = new BABYLON.Vector3(playerCar.pos.x, playerCar.pos.y + 1.5, playerCar.pos.z);
            const fwdX = Math.sin(playerCar.rotY);
            const fwdZ = Math.cos(playerCar.rotY);
            const camDist = 14;
            const camHeight = 6;
            const camX = playerCar.pos.x - fwdX * camDist;
            const camY = playerCar.pos.y + camHeight;
            const camZ = playerCar.pos.z - fwdZ * camDist;
            camera.position = BABYLON.Vector3.Lerp(camera.position, new BABYLON.Vector3(camX, camY, camZ), 0.05);
            camera.setTarget(pPos);
            return;
        }

        // --- QUIZ ACTIVE: pause game ---
        if (quizActive) {
            updateCarMeshPositions(playerCar);
            aiCars.forEach(ai => updateCarMeshPositions(ai));

            const fwdX2 = Math.sin(playerCar.rotY);
            const fwdZ2 = Math.cos(playerCar.rotY);
            const camDist2 = playerCar.boostTimer > 0 ? 18 : 14;
            const camHeight2 = playerCar.boostTimer > 0 ? 8 : 6;
            const camTarget2 = new BABYLON.Vector3(playerCar.pos.x, playerCar.pos.y + 1.5, playerCar.pos.z);
            const camPos2 = new BABYLON.Vector3(
                playerCar.pos.x - fwdX2 * camDist2,
                playerCar.pos.y + camHeight2,
                playerCar.pos.z - fwdZ2 * camDist2
            );
            camera.position = BABYLON.Vector3.Lerp(camera.position, camPos2, 0.06);
            camera.setTarget(BABYLON.Vector3.Lerp(camera.target, camTarget2, 0.1));
            return;
        }

        // --- PLAYER MOVEMENT ---
        const forward = gameKeys["KeyW"] || gameKeys["ArrowUp"];
        const backward = gameKeys["KeyS"] || gameKeys["ArrowDown"];
        const left = gameKeys["KeyA"] || gameKeys["ArrowLeft"];
        const right = gameKeys["KeyD"] || gameKeys["ArrowRight"];

        const effectiveMaxSpeed = playerCar.boostTimer > 0 ? playerCar.maxSpeed * 2.5 : playerCar.maxSpeed;
        const effectiveAccel = playerCar.boostTimer > 0 ? playerCar.acceleration * 2.5 : playerCar.acceleration;
        const effectiveTurn = playerCar.turnSpeed * (1 + (playerCar.boostTimer > 0 ? 0.5 : 0));

        if (playerCar.stunTimer > 0 || playerCar.dizzyTimer > 0 || playerCar.bubbleTimer > 0) {
            // Stunned, dizzy or bubbled: frozen — no throttle, no steering.
            if (playerCar.stunTimer > 0) playerCar.stunTimer--;
            playerCar.speed *= 0.9;
            if (Math.abs(playerCar.speed) < 0.01) playerCar.speed = 0;
        } else {
            if (forward) {
                playerCar.speed = Math.min(playerCar.speed + effectiveAccel, effectiveMaxSpeed);
            } else if (backward) {
                playerCar.speed = Math.max(playerCar.speed - playerCar.braking, -effectiveMaxSpeed * 0.3);
            } else {
                playerCar.speed *= 0.975;
                if (Math.abs(playerCar.speed) < 0.005) playerCar.speed = 0;
            }

            if (backward && playerCar.speed > 0) {
                playerCar.speed -= playerCar.braking * 2;
                if (playerCar.speed < 0) playerCar.speed = 0;
            }

            // Steering authority: full from ~40% of top speed, with a healthy
            // floor so a slow (or stuck) kart still pivots. Because the turn
            // rate no longer scales UP with speed, braking into a bend now
            // genuinely tightens the line — essential for the sharp-corner
            // courses (City Rush, Formula GP, Kitchen Chaos).
            const speedFactor = Math.max(0.5, Math.min(Math.abs(playerCar.speed) / (playerCar.maxSpeed * 0.4), 1.0));
            if (left) playerCar.rotY -= effectiveTurn * speedFactor;
            if (right) playerCar.rotY += effectiveTurn * speedFactor;
        }

        const moveX = Math.sin(playerCar.rotY) * playerCar.speed;
        const moveZ = Math.cos(playerCar.rotY) * playerCar.speed;
        playerCar.pos.x += moveX;
        playerCar.pos.z += moveZ;

        containCar(playerCar); // keep the body inside the rails (slows on a real hit)
        if (playerCar.bubbleTimer <= 0) followGround(playerCar);

        if (playerCar.boostTimer > 0) {
            playerCar.boostTimer--;
            if (playerCar.boostTimer <= 0) {
                updateItemIndicator();
            }
        }

        if (playerCar.invincibleTimer > 0) {
            playerCar.invincibleTimer--;
            // Mutate in place (copyFromFloats) instead of allocating a Color3 each frame.
            if (Math.floor(playerCar.invincibleTimer / 5) % 2 === 0) {
                playerCar.bodyMat.emissiveColor.copyFromFloats(0, 0.5, 1);
            } else {
                playerCar.bodyMat.emissiveColor.copyFromFloats(0, 0, 0);
            }
        } else {
            playerCar.bodyMat.emissiveColor.copyFromFloats(0, 0, 0);
        }

        // Wheel spin
        const wheelSpin = playerCar.speed * 15;
        playerCar.spinWheels(wheelSpin);

        updateCarMeshPositions(playerCar);

        // Lap detection (first start-line crossing is the start, not a lap)
        if (advanceProgress(playerCar)) {
            if (playerCar.lap < MAX_LAPS) SoundManager.lapComplete();
            if (playerCar.lap === MAX_LAPS - 1) showRoadFeedback("🏁 FINAL LAP!", "#ffd93b", 2200);
            sendLapComplete(playerCar.lap);
        }

        if (playerCar.lap >= MAX_LAPS && !playerCar.finished) {
            playerCar.finished = true;
            playerCar.finishTime = gameTime;
            sendRaceFinish(gameTime);
        }

        // --- AI MOVEMENT ---
        aiCars.forEach((aiCar, i) => {
            if (aiCar.aiStartDelay > 0) {
                aiCar.aiStartDelay--;
                updateCarMeshPositions(aiCar);
                return;
            }

            if (aiCar.stunTimer > 0 || aiCar.dizzyTimer > 0 || aiCar.bubbleTimer > 0) {
                // Frozen while stunned, dizzy or bubbled.
                if (aiCar.stunTimer > 0) aiCar.stunTimer--;
                aiCar.speed *= 0.85;
                updateCarMeshPositions(aiCar);
                return;
            }

            advanceProgress(aiCar);
            const aiCp = aiCar.checkpointIndex; // nearest segment, for the look-ahead below
            if (aiCar.lap >= MAX_LAPS && !aiCar.finished) {
                aiCar.finished = true;
                aiCar.finishTime = gameTime;
            }

            const lookAhead = 3;
            const targetIdx = (aiCar.aiTargetIdx + lookAhead) % numPoints;
            const targetPt = trackPoints[targetIdx];
            const futureTarget = trackPoints[(targetIdx + 3) % numPoints];
            const futureAngle = Math.atan2(futureTarget.z - targetPt.z, futureTarget.x - targetPt.x);

            let offset = Math.sin(gameTime * 0.012 + i * 2.1) * 3;
            // Line up for the answer gate while it's still ahead, otherwise the AI
            // would plough into a pillar every single lap.
            const gRow = gateRowAhead(aiCar);
            if (gRow && aiCar._gateChoice && aiCar._gateChoice[gRow.idx] != null) {
                offset = gRow.gate.doors[aiCar._gateChoice[gRow.idx]] || 0;
            }
            const raceLineX = targetPt.x - Math.sin(futureAngle) * offset;
            const raceLineZ = targetPt.z + Math.cos(futureAngle) * offset;

            const dx = raceLineX - aiCar.pos.x;
            const dz = raceLineZ - aiCar.pos.z;
            const dist = Math.sqrt(dx * dx + dz * dz);

            if (dist < 12) {
                aiCar.aiTargetIdx = (aiCar.aiTargetIdx + 1) % numPoints;
            }

            const desiredAngle = Math.atan2(dx, dz);
            const angleDiff = normAngle(desiredAngle - aiCar.rotY);

            const maxSteer = 0.12;
            const steerResponse = 0.18;
            const aiSteer = Math.max(-maxSteer, Math.min(maxSteer, angleDiff * steerResponse));
            aiCar.rotY += aiSteer;

            let turnSharpness = 0;
            for (let t = 1; t <= 10; t++) {
                const futureIdx = (aiCp + t) % numPoints;
                const pastIdx = (aiCp - t + numPoints) % numPoints;
                const fPt = trackPoints[futureIdx];
                const pPt = trackPoints[pastIdx];
                const fAngle = Math.atan2(fPt.z - aiCar.pos.z, fPt.x - aiCar.pos.x);
                const pAngle = Math.atan2(pPt.z - aiCar.pos.z, pPt.x - aiCar.pos.x);
                const aDiff = normAngle(fAngle - pAngle);
                turnSharpness += Math.abs(aDiff) * 0.25;
            }

            const angleToTarget = Math.abs(angleDiff);
            let targetSpeed = aiCar.aiBaseSpeed;

            targetSpeed *= (1 - angleToTarget / Math.PI * 0.22);

            if (turnSharpness > 1.0) {
                targetSpeed *= 0.74;
            } else if (turnSharpness > 0.6) {
                targetSpeed *= 0.88;
            }

            // Rubber-banding: keep the pack on the player's tail. Falls behind a
            // little so the player can still win, but catches up hard when lapped.
            const progressDiff = carProgress(playerCar) - carProgress(aiCar);
            if (progressDiff > 25) {
                targetSpeed *= 1.28;
            } else if (progressDiff > 8) {
                targetSpeed *= 1.16;
            } else if (progressDiff < -14) {
                targetSpeed *= 0.95;
            }

            // Blinded by a stink cloud: slow right down and weave like they
            // can't see where the road is.
            if (aiCar.fogTimer > 0) {
                aiCar.fogTimer--;
                targetSpeed *= 0.55;
                aiCar.rotY += (Math.random() - 0.5) * 0.06;
            }

            if (aiCar.boostTimer > 0) {
                targetSpeed *= 2.2;
                aiCar.boostTimer--;
            }
            if (aiCar.invincibleTimer > 0) aiCar.invincibleTimer--;

            if (aiCar.speed < targetSpeed) {
                aiCar.speed += aiCar.acceleration * 2.2;
                if (aiCar.speed > targetSpeed) aiCar.speed = targetSpeed;
            } else {
                aiCar.speed *= 0.96;
                if (aiCar.speed < targetSpeed) aiCar.speed = targetSpeed;
            }

            const aiMoveX = Math.sin(aiCar.rotY) * aiCar.speed;
            const aiMoveZ = Math.cos(aiCar.rotY) * aiCar.speed;
            aiCar.pos.x += aiMoveX;
            aiCar.pos.z += aiMoveZ;

            containCar(aiCar); // keep the body inside the rails
            if (aiCar.bubbleTimer <= 0) followGround(aiCar);

            aiCar.spinWheels(aiCar.speed * 15);
            updateCarMeshPositions(aiCar);
        });

        // --- NETWORK CAR UPDATES ---
        // Client-side prediction so remote karts glide at full speed and stay
        // smooth even when packets are sparse/irregular (slow device, VPN, lag).
        // The earlier code only moved a remote car WHEN a packet arrived (host
        // lerped, guest snapped), so a low/uneven packet rate made other players
        // look like they were crawling and "playing their own race".
        networkCars.forEach((netCar) => {
            const data = networkPlayers.get(netCar._playerId);
            const now = performance.now();

            if (data && data !== netCar._lastData) {
                netCar._lastData = data;
                const p = data.pos;
                if (netCar._gotFirst) {
                    // Velocity measured from the actual distance between authoritative
                    // positions over REAL time (units/ms) — independent of either
                    // player's frame rate, so a remote kart can't look "slow" just
                    // because one machine renders fewer frames.
                    const dt = Math.max(1, now - (netCar._packetTime || now));
                    netCar._vx = (p.x - netCar._authX) / dt;
                    netCar._vz = (p.z - netCar._authZ) / dt;
                } else {
                    netCar._vx = 0; netCar._vz = 0;
                    netCar.pos.x = p.x; netCar.pos.y = p.y; netCar.pos.z = p.z; netCar.rotY = data.rotY;
                    netCar._gotFirst = true;
                }
                netCar._authX = p.x; netCar._authY = p.y; netCar._authZ = p.z;
                netCar._authRotY = data.rotY;
                netCar._packetTime = now;
                netCar.speed = data.speed || 0;
                netCar.boostTimer = data.boostTimer || 0;
                // Authoritative effect state from the owner (drives the ghost's
                // dizzy stars / stun visual). Held until the next packet (the dizzy
                // animation block doesn't decrement these for ghosts).
                const fx = data.fx || 0;
                netCar.dizzyTimer = (fx & 1) ? 12 : 0;
                netCar.stunTimer = (fx & 2) ? 12 : 0;
                netCar.invincibleTimer = (fx & 4) ? 12 : 0;
            }

            if (netCar._gotFirst) {
                // Extrapolate the authoritative position forward by real elapsed time
                // (capped at 0.4s of silence so a dropped peer settles, not flies off).
                const ext = Math.min(now - (netCar._packetTime || now), 400);
                const predX = netCar._authX + netCar._vx * ext;
                const predZ = netCar._authZ + netCar._vz * ext;
                // Smoothing per FIXED step (stepGame runs at a fixed 1/60s).
                const k = 1 - Math.pow(1 - 0.5, FIXED_DT / 16.67);
                const ky = 1 - Math.pow(1 - 0.3, FIXED_DT / 16.67);
                netCar.pos.x += (predX - netCar.pos.x) * k;
                netCar.pos.z += (predZ - netCar.pos.z) * k;
                netCar.pos.y += (netCar._authY - netCar.pos.y) * ky;
                netCar.rotY += normAngle(netCar._authRotY - netCar.rotY) * k;
            }

            // Track the remote car's live progress so the standings are correct
            // (without this its rank was frozen at the grid and every client
            // thought IT was leading — two players could both show "1st").
            advanceProgress(netCar);
            netCar.spinWheels(netCar.speed * 15);
            updateCarMeshPositions(netCar);
        });

        // --- SEND POSITION UPDATE ---
        // Every 2 frames (~30Hz at 60fps). Client-side prediction smooths the
        // gaps, so this stays cheap while feeling responsive.
        if (gameTime % 2 === 0) {
            sendPositionUpdate();
        }

        // --- TRAIN CROSSINGS ---
        // Cycle: quiet → warning (lamps blink, bells, horn) → the train roars
        // across, flattening any kart still on the rails.
        for (const tr of trains) {
            tr.timer++;
            const WARN = 150, CROSS = 300;
            const phase = tr.timer % tr.period;
            const warning = phase < WARN;
            const active = phase >= WARN && phase < WARN + CROSS;

            // Blinking red lamps while the crossing is hot.
            if (warning || active) {
                const on = Math.floor(phase / 18) % 2;
                tr.lamps.forEach((lm, li) => lm.emissiveColor.copyFromFloats((li % 2 === on) ? 0.95 : 0, 0.03, 0.03));
                if (phase % 36 === 0 && playerNearby(tr, 140)) SoundManager.crossingBell();
                if (phase === 8 || phase === 70) SoundManager.trainHorn();
            } else if (phase === WARN + CROSS) {
                tr.lamps.forEach(lm => lm.emissiveColor.copyFromFloats(0, 0, 0));
            }

            if (active) {
                if (!tr.root.isEnabled()) tr.root.setEnabled(true);
                const u = (phase - WARN) / CROSS;
                const s = -tr.half + u * tr.half * 2;
                tr.root.position.x = tr.cx + tr.px * s;
                tr.root.position.y = tr.y + 0.2;
                tr.root.position.z = tr.cz + tr.pz * s;

                // Anyone on the rails when the train arrives gets launched.
                for (const car of allCars) {
                    if (isNet(car) || car.invincibleTimer > 0 || car.bubbleTimer > 0) continue;
                    const relX = car.pos.x - tr.cx, relZ = car.pos.z - tr.cz;
                    const along = relX * tr.px + relZ * tr.pz;     // position along the rails
                    const across = -relX * tr.pz + relZ * tr.px;   // distance off the rail line
                    if (Math.abs(across) < 2.6 + (car.radius || 1.25) && along < s + 7 && along > s - 38) {
                        const sgn = across >= 0 ? 1 : -1;
                        // Shoved off the rails and dragged a little down-line.
                        car.knockbackX += (-tr.pz) * sgn * 3.0 + tr.px * 1.4;
                        car.knockbackZ += (tr.px) * sgn * 3.0 + tr.pz * 1.4;
                        car.speed = 0;
                        damageRating(car, 999); // keels over dizzy, every time
                        if (car === playerCar) {
                            SoundManager.hit();
                            cameraShake = Math.max(cameraShake, 2.2);
                            showRoadFeedback("🚂 Hit by the train!", "#ff6b6b", 1800);
                        }
                    }
                }
            } else if (tr.root.isEnabled()) {
                tr.root.setEnabled(false);
            }
        }

        // --- PERMANENT ROAD HAZARDS (oil / ice / mud / spikes) ---
        for (const car of allCars) {
            if (isNet(car)) continue; // ghosts hit hazards on their own client
            if (car._hazCd > 0) car._hazCd--;
            if (car._wallCd > 0) car._wallCd--;
            if (car.invincibleTimer > 0 || car.bubbleTimer > 0) continue;
            for (const hz of staticHazards) {
                const dx = car.pos.x - hz.x, dz = car.pos.z - hz.z;
                if (dx * dx + dz * dz > hz.r * hz.r) continue;
                if (hz.kind === "mud") {
                    // Sticky while you're in it — no cooldown, just a hard drag.
                    car.speed *= 0.93;
                    if (car === playerCar && (car._hazCd || 0) <= 0) {
                        showRoadFeedback("🟤 Sticky mud!", "#d2a45c", 900);
                        car._hazCd = 90;
                    }
                    continue;
                }
                if ((car._hazCd || 0) > 0) continue;
                car._hazCd = 90;
                if (hz.kind === "oil") {
                    car.speed *= 0.25;
                    car.rotY += (Math.random() - 0.5) * 3.0;
                    car.stunTimer = 55;
                    if (car === playerCar) { SoundManager.hit(); showRoadFeedback("🛢 Oil slick!", "#ffd93b", 1200); }
                } else if (hz.kind === "ice") {
                    // Slippery: the kart skids and steering goes light for a moment.
                    car.rotY += (Math.random() - 0.5) * 1.2;
                    car.stunTimer = 22;
                    if (car === playerCar) showRoadFeedback("🧊 Ice — hold on!", "#9fd3ff", 1100);
                } else if (hz.kind === "spikes") {
                    car.speed *= 0.15;
                    car.stunTimer = 70;
                    damageRating(car, 55);
                    if (car === playerCar) { SoundManager.hit(); showRoadFeedback("📌 Spikes!", "#ff6b6b", 1300); }
                }
            }
        }

        // --- BOOST PADS ---
        for (const car of allCars) {
            if (isNet(car)) continue; // ghosts trigger boost pads on their own client
            if (car._padCd > 0) { car._padCd--; continue; }
            for (const bp of boostPads) {
                const dx = car.pos.x - bp.x, dz = car.pos.z - bp.z;
                if (dx * dx + dz * dz < 4.2 * 4.2) {
                    car.boostTimer = Math.max(car.boostTimer, 95);
                    car._padCd = 70;
                    if (car === playerCar) { SoundManager.boost(); showRoadFeedback("⚡ Speed pad!", "#5df0ff", 900); }
                    break;
                }
            }
        }
        // Pulse the pads so they read as pickups.
        if (gameTime % 4 === 0) {
            const bpPulse = 0.35 + Math.sin(gameTime * 0.09) * 0.25;
            for (const bp of boostPads) bp.mat.emissiveColor.copyFromFloats(0.05, bpPulse, bpPulse * 1.3);
        }

        // --- CAR COLLISION DETECTION ---
        for (let i = 0; i < allCars.length; i++) {
            for (let j = i + 1; j < allCars.length; j++) {
                const car1 = allCars[i];
                const car2 = allCars[j];
                
                const dx = car2.pos.x - car1.pos.x;
                const dz = car2.pos.z - car1.pos.z;
                const dist = Math.sqrt(dx * dx + dz * dz);
                // Contact distance follows the real vehicle sizes: kart vs kart
                // touches close in, truck vs truck collides much earlier.
                const minDist = (car1.radius || 1.25) + (car2.radius || 1.25);
                
                if (dist < minDist && dist > 0) {
                    const net1 = isNet(car1), net2 = isNet(car2);
                    if (net1 && net2) continue; // two ghosts: their own clients handle it

                    const overlap = minDist - dist;
                    const nx = dx / dist;
                    const nz = dz / dist;

                    // De-overlap weighted by mass — but a ghost is immovable here
                    // (owned remotely), so the local car absorbs the full push.
                    const w1 = car1.weight || 1;
                    const w2 = car2.weight || 1;
                    const total = w1 + w2;
                    if (!net1) { const s = net2 ? 1 : (w2 / total); car1.pos.x -= nx * overlap * s; car1.pos.z -= nz * overlap * s; }
                    if (!net2) { const s = net1 ? 1 : (w1 / total); car2.pos.x += nx * overlap * s; car2.pos.z += nz * overlap * s; }

                    // A bubbled (local) car pops the moment anything touches it.
                    if (!net1 && car1.bubbleTimer > 0) popBubble(car1);
                    if (!net2 && car2.bubbleTimer > 0) popBubble(car2);

                    const relVelX = (car2.speed * Math.sin(car2.rotY)) - (car1.speed * Math.sin(car1.rotY));
                    const relVelZ = (car2.speed * Math.cos(car2.rotY)) - (car1.speed * Math.cos(car1.rotY));
                    const relVelDotN = relVelX * nx + relVelZ * nz;
                    // How hard the two cars actually slam together: closing speed
                    // along the contact normal. A side-by-side rub is ~0; a head-on
                    // crash is the sum of both speeds. This is what all the impact
                    // effects scale from, so gentle nudges stay gentle.
                    const impactSpeed = Math.max(0, -relVelDotN);

                    if (relVelDotN < 0) {
                        // Heavier cars barely slow down and plow on; the lighter car
                        // in the crash loses far more of its speed. (damageRating
                        // already no-ops on ghosts.)
                        if (!net1) car1.speed *= 0.25 + 0.6 * (w1 / total);
                        if (!net2) car2.speed *= 0.25 + 0.6 * (w2 / total);
                        damageRating(car1, impactSpeed * 40 * (w2 / w1));
                        damageRating(car2, impactSpeed * 40 * (w1 / w2));

                        if (car1 === playerCar || car2 === playerCar) {
                            SoundManager.collision();
                            cameraShake = Math.max(cameraShake, Math.min(1.4, 0.4 + impactSpeed));
                        }
                    }

                    // Momentum-style shove (local cars only).
                    const impact = 0.3 + impactSpeed * 1.2;
                    if (!net1) { car1.knockbackX -= nx * impact * (w2 / total); car1.knockbackZ -= nz * impact * (w2 / total); }
                    if (!net2) { car2.knockbackX += nx * impact * (w1 / total); car2.knockbackZ += nz * impact * (w1 / total); }

                    // The bigger the weight gap, the more dramatic the launch of the
                    // lighter local car — a tank vs. a kart should be obvious + funny.
                    const ratio = Math.max(w1, w2) / Math.min(w1, w2);
                    if (ratio > 1.15) {
                        const k = Math.min(ratio - 1, 4) * impact * 0.9;
                        if (w1 > w2) { if (!net2) { car2.knockbackX += nx * k; car2.knockbackZ += nz * k; } }
                        else { if (!net1) { car1.knockbackX -= nx * k; car1.knockbackZ -= nz * k; } }
                    }
                }
            }
        }

        // --- APPLY WEIGHT KNOCKBACK (decaying shove from heavier cars) ---
        allCars.forEach(c => {
            if (isNet(c)) return; // ghosts move only via their network updates
            if (c.knockbackX || c.knockbackZ) {
                c.pos.x += c.knockbackX;
                c.pos.z += c.knockbackZ;
                c.knockbackX *= 0.85;
                c.knockbackZ *= 0.85;
                if (Math.abs(c.knockbackX) < 0.003 && Math.abs(c.knockbackZ) < 0.003) {
                    c.knockbackX = 0;
                    c.knockbackZ = 0;
                }
                updateCarMeshPositions(c);
            }
        });

        // Final wall sweep: after every collision / knockback / trap shove this
        // frame, make sure no car was pushed through the rail (local cars only —
        // network cars are positioned by their owner).
        if (raceStarted) {
            if (clampToWall(playerCar)) updateCarMeshPositions(playerCar);
            aiCars.forEach(c => { if (clampToWall(c)) updateCarMeshPositions(c); });
        }

        // --- BUBBLE PRISON (trapped cars float helplessly, then pop free) ---
        allCars.forEach(c => {
            if (isNet(c)) return; // a ghost's bubble state is owned by its client
            if (c.bubbleTimer > 0) {
                c.bubbleTimer--;
                c.speed = 0;
                // Drift slowly up to floating height (above the road, wherever
                // it is on the hill) with a gentle bob.
                const floatY = trackYAt(c.pos.x, c.pos.z) + 2.1 + Math.sin(gameTime * 0.07) * 0.25;
                c.pos.y += (floatY - c.pos.y) * 0.05;
                if (c.bubbleMesh) {
                    c.bubbleMesh.isVisible = true;
                    c.bubbleMesh.position.x = c.pos.x;
                    c.bubbleMesh.position.y = c.pos.y + 0.7;
                    c.bubbleMesh.position.z = c.pos.z;
                }
                updateCarMeshPositions(c);
                if (c.bubbleTimer <= 0) popBubble(c);
            }
        });

        // --- FEINT / DIZZY ANIMATION (heavy bumps + lightning) ---
        allCars.forEach(c => {
            // Ghosts: don't run the local health/recovery sim (that's owned by their
            // client) — just render the stars/wobble from the dizzy state we were
            // told about over the network.
            if (!isNet(c)) {
                if (c.dizzyTimer > 0) {
                    c.dizzyTimer--;
                    // Knocked-out health crawls back toward the wake-up threshold
                    // (~2.5s from zero). The kart STAYS dizzy until it gets there,
                    // so a fresh hit — which drains health — extends the recovery.
                    // (Lightning dizzies at higher health: that one stays timer-based.)
                    if (c.rating < DIZZY_WAKE) {
                        c.rating = Math.min(DIZZY_WAKE, c.rating + DIZZY_REGEN);
                        if (c.dizzyTimer <= 0 && c.rating < DIZZY_WAKE) c.dizzyTimer = 1;
                    }
                } else if (c.rating < 100) {
                    // On its wheels: health slowly recovers (~3/sec).
                    c.rating = Math.min(100, c.rating + 0.05);
                }
            }
            const dizzy = c.dizzyTimer > 0 || c.stunTimer > 0;
            if (!c.dizzyStars) return;
            if (dizzy) {
                c._dizzyPhase += 0.22;
                const n = c.dizzyStars.length;
                for (let k = 0; k < n; k++) {
                    const a = c._dizzyPhase + k * (Math.PI * 2 / n);
                    const st = c.dizzyStars[k];
                    st.isVisible = true;
                    st.position.x = c.pos.x + Math.cos(a) * 0.62;
                    st.position.y = c.pos.y + 1.5 + (c._scale || 1.25) + Math.sin(c._dizzyPhase * 1.7) * 0.08;
                    st.position.z = c.pos.z + Math.sin(a) * 0.62;
                }
                if (c.root) c.root.rotation.z = Math.sin(gameTime * 0.6) * 0.18; // reel/wobble
            } else if (c.dizzyStars[0].isVisible) {
                for (const st of c.dizzyStars) st.isVisible = false;
                if (c.root) c.root.rotation.z = 0;
            }
        });

        // --- LIGHTNING BOLT VFX (flicker, follow the car, then expire) ---
        for (let i = lightningBolts.length - 1; i >= 0; i--) {
            const b = lightningBolts[i];
            b.life--;
            b.mesh.position.x = b.car.pos.x;
            b.mesh.position.y = b.car.pos.y + 4.5;
            b.mesh.position.z = b.car.pos.z;
            b.mesh.visibility = (b.life % 4 < 2) ? 1 : 0.4;
            if (b.life <= 0) { b.mesh.dispose(); lightningBolts.splice(i, 1); }
        }

        // --- ANSWER GATES (question rows served as a wall of doors) ---
        updateGateRows();

        // --- TORNADO UPDATES (wanders forward, flings & dizzies whoever it catches) ---
        for (let i = tornadoes.length - 1; i >= 0; i--) {
            const t = tornadoes[i];
            t.life--;
            t.root.position.x += t.dirX * 0.45 + Math.sin(gameTime * 0.05 + t.seed) * 0.18;
            t.root.position.z += t.dirZ * 0.45 + Math.cos(gameTime * 0.043 + t.seed) * 0.18;
            t.root.rotation.y += 0.38;
            for (const car of allCars) {
                if (isNet(car) || car === t.owner || car.invincibleTimer > 0 || car.bubbleTimer > 0) continue;
                const dx = car.pos.x - t.root.position.x;
                const dz = car.pos.z - t.root.position.z;
                const d = Math.sqrt(dx * dx + dz * dz);
                if (d < 6.5 && d > 0.01) {
                    if (gameTime - (car._lastTornadoBlame || -999) > 90) { car._lastTornadoBlame = gameTime; creditHit(car, t.owner, "tornado"); }
                    car.knockbackX += (dx / d) * 1.8;
                    car.knockbackZ += (dz / d) * 1.8;
                    car.speed *= 0.3;
                    // Drains stability fast while caught — light cars get dizzied in
                    // a few frames, a heavy tank usually rides it out.
                    damageRating(car, 18 / (car.weight || 1));
                    if (car === playerCar && gameTime - (car._lastTornadoSfx || 0) > 30) {
                        car._lastTornadoSfx = gameTime;
                        SoundManager.hit();
                        cameraShake = Math.max(cameraShake, 1.1);
                    }
                }
            }
            if (t.life <= 0) {
                t.root.dispose(); // disposes the funnel segments; shared material survives
                tornadoes.splice(i, 1);
            }
        }

        // --- PROJECTILE UPDATES ---
        for (let i = projectiles.length - 1; i >= 0; i--) {
            const proj = projectiles[i];
            proj.position.x += proj._dir.x * proj._speed;
            proj.position.z += proj._dir.z * proj._speed;
            proj.position.y = trackYAt(proj.position.x, proj.position.z) + 0.8 + Math.sin(proj._life * 0.15) * 0.4;
            proj._life++;
            if (proj._glow) proj._glow.position = proj.position.clone();

            let hit = false;
            for (const car of allCars) {
                if (allCars.indexOf(car) === proj._shooterIdx) continue;
                if (isNet(car)) continue; // ghosts register projectile hits on their own client
                if (car.invincibleTimer > 0) continue;
                if (car.stunTimer > 0) continue;
                const dx = proj.position.x - car.pos.x;
                const dz = proj.position.z - car.pos.z;
                const distToCar = Math.sqrt(dx * dx + dz * dz);
                if (distToCar < 1.1 + (car.radius || 1.25)) {
                    creditHit(car, allCars[proj._shooterIdx], "fireball");
                    car.speed = -car.speed * 0.3;
                    car.rotY += (Math.random() - 0.5) * 3.0;
                    car.stunTimer = 60;
                    damageRating(car, 70);
                    hit = true;
                    if (car === playerCar) SoundManager.hit();

                    for (let p = 0; p < 8; p++) {
                        const spark = sparkTemplate.createInstance("spark" + gameTime + "_" + p);
                        spark.position = proj.position.clone();
                        spark._sparkLife = 15;
                        spark._sparkDir = new BABYLON.Vector3(
                            (Math.random() - 0.5) * 2,
                            Math.random() * 2,
                            (Math.random() - 0.5) * 2
                        );
                        spark._disposeAfter = true;
                    }

                    break;
                }
            }

            if (hit || proj._life > proj._maxLife ||
                Math.abs(proj.position.x) > 350 || Math.abs(proj.position.z) > 350) {
                if (proj._glow) proj._glow.dispose();
                proj.dispose();
                projectiles.splice(i, 1);
            }
        }

        // --- Spark particle cleanup ---
        const meshes = scene.meshes;
        for (let i = meshes.length - 1; i >= 0; i--) {
            const m = meshes[i];
            if (m._disposeAfter && m._sparkLife !== undefined) {
                m._sparkLife--;
                m.position.x += m._sparkDir.x * 0.3;
                m.position.y += m._sparkDir.y * 0.3;
                m.position.z += m._sparkDir.z * 0.3;
                if (m._sparkLife <= 0) {
                    m.dispose(); // instance only — the shared sparkMat stays
                }
            }
        }

        // --- TRAP UPDATES (Banana & Oil) ---
        for (let i = traps.length - 1; i >= 0; i--) {
            const trap = traps[i];
            trap.lifetime--;

            if (!trap.mesh) {
                if (trap.type === "banana") {
                    const mesh = _bananaTemplate.createInstance("trap" + i);
                    mesh.position = new BABYLON.Vector3(trap.pos.x, trap.pos.y, trap.pos.z);
                    mesh.rotation.y = trap.rot || 0;
                    mesh.isPickable = false;
                    trap.mesh = mesh;
                } else if (trap.type === "oil") {
                    const mesh = BABYLON.MeshBuilder.CreateDisc("trap" + i, { radius: 3.2, tessellation: 24 }, scene);
                    mesh.position = new BABYLON.Vector3(trap.pos.x, trap.pos.y + 0.02, trap.pos.z);
                    mesh.rotation.x = -Math.PI / 2;
                    mesh.material = _oilMat;
                    mesh.isPickable = false;
                    mesh.scaling.setAll(0.3); trap._grow = 0; // splash out to full size so the drop is obvious
                    trap.mesh = mesh;
                } else if (trap.type === "bubble") {
                    const mesh = BABYLON.MeshBuilder.CreateSphere("trap" + i, { diameter: 1.8, segments: 10 }, scene);
                    mesh.position = new BABYLON.Vector3(trap.pos.x, trap.pos.y, trap.pos.z);
                    mesh.material = _bubbleMat;
                    mesh.isPickable = false;
                    glowLayer.addExcludedMesh(mesh);
                    trap.mesh = mesh;
                } else if (trap.type === "fog") {
                    const mesh = BABYLON.MeshBuilder.CreateSphere("trap" + i, { diameter: 13, segments: 10 }, scene);
                    mesh.position = new BABYLON.Vector3(trap.pos.x, trap.pos.y, trap.pos.z);
                    mesh.scaling.y = 0.42;
                    mesh.material = _fogMat;
                    mesh.isPickable = false;
                    glowLayer.addExcludedMesh(mesh);
                    trap.mesh = mesh;
                }
            }

            // Loose bubbles bob gently in the air while they wait for a victim.
            if (trap.type === "bubble" && trap.mesh) {
                trap.mesh.position.y = trap.pos.y + 0.5 + Math.sin(gameTime * 0.06 + i) * 0.18;
            }
            // Fresh oil splashes out to full size (a quick "drop" tell).
            if (trap.type === "oil" && trap.mesh && trap._grow < 1) {
                trap._grow = Math.min(1, trap._grow + 0.14);
                trap.mesh.scaling.setAll(0.3 + 0.7 * trap._grow);
            }

            if (trap.lifetime <= 0) {
                if (trap.mesh) {
                    trap.mesh.dispose(); // shared material is reused — don't dispose it
                }
                traps.splice(i, 1);
                continue;
            }

            // Fog lingers: it blinds whoever drives in and is never consumed by a hit.
            if (trap.type === "fog") {
                for (const car of allCars) {
                    if (isNet(car) || car === trap.owner) continue;
                    const fdx = car.pos.x - trap.pos.x;
                    const fdz = car.pos.z - trap.pos.z;
                    if (fdx * fdx + fdz * fdz < 6.5 * 6.5) {
                        if (car === playerCar && car.fogTimer <= 0) SoundManager.fartSound();
                        if (car.fogTimer <= 0) creditHit(car, trap.owner, "fog");
                        car.fogTimer = Math.max(car.fogTimer, 170);
                    }
                }
                continue;
            }

            for (const car of allCars) {
                if (isNet(car)) continue; // ghosts register trap hits on their own client
                if (car === trap.owner) continue;
                if (car.invincibleTimer > 0) continue;
                if (car.stunTimer > 0 || car.bubbleTimer > 0) continue;

                const dx = car.pos.x - trap.pos.x;
                const dz = car.pos.z - trap.pos.z;
                const dist = Math.sqrt(dx * dx + dz * dz);
                const hitRadius = trap.type === "banana" ? 2.2 : trap.type === "bubble" ? 1.8 : 2.5;

                if (dist < hitRadius) {
                    creditHit(car, trap.owner, trap.type);
                    if (trap.type === "banana") {
                        car.speed *= 0.1;
                        car.rotY += (Math.random() - 0.5) * 3.5;
                        car.stunTimer = 90;
                        damageRating(car, 50);
                        if (car === playerCar) SoundManager.hit();
                    } else if (trap.type === "oil") {
                        car.speed *= 0.2;
                        car.stunTimer = 60;
                        damageRating(car, 30);
                        if (car === playerCar) SoundManager.hit();
                    } else if (trap.type === "bubble") {
                        // Sucked in: the car floats helplessly until the bubble pops.
                        car.speed = 0;
                        car.bubbleTimer = 240;
                        if (car === playerCar) SoundManager.bubbleSound();
                    }

                    if (trap.mesh) {
                        trap.mesh.dispose(); // shared material is reused — don't dispose it
                    }
                    traps.splice(i, 1);
                    break;
                }
            }
        }

        // --- QUIZ ITEM BOXES (player only) ---
        // The player answers by driving through the box with the correct answer.
        // Only checked when they have no item, so a held item never wastes a row.
        if (raceStarted && !playerCar.currentItem) {
            for (const row of itemRows) {
                if (row.respawnTimer > 0) continue;
                let hitBox = null;
                for (const bi of row.boxes) {
                    const box = itemBoxes[bi];
                    if (!box._itemActive) continue;
                    const dx = playerCar.pos.x - box.position.x;
                    const dz = playerCar.pos.z - box.position.z;
                    // The y check keeps a bubbled (floating) kart from collecting.
                    if (dx * dx + dz * dz < 2.8 * 2.8 && Math.abs(playerCar.pos.y - box.position.y) < 4) { hitBox = box; break; }
                }
                if (hitBox) {
                    if (hitBox._isCorrect) {
                        playerCar.currentItem = randomItem();
                        updateItemIndicator();
                        SoundManager.itemPickup();
                        SoundManager.quizCorrect();
                        showRoadFeedback("✓ Correct!", "#5dff7a");
                    } else {
                        SoundManager.quizWrong();
                        showRoadFeedback("✗ Wrong answer", "#ff6b6b");
                    }
                    // Resolve the row: hide all its boxes + labels, respawn later.
                    row.boxes.forEach(b2 => {
                        itemBoxes[b2]._itemActive = false;
                        itemBoxes[b2].isVisible = false;
                        if (itemBoxes[b2]._label) itemBoxes[b2]._label.isVisible = false;
                    });
                    row.respawnTimer = 220;
                    break;
                }
            }
        }

        // Respawn resolved rows with a fresh question (assignRowQuiz restores the
        // box visibility/positions for whichever answers the new question needs).
        for (const row of itemRows) {
            if (row.respawnTimer > 0) {
                row.respawnTimer--;
                if (row.respawnTimer === 0) {
                    assignRowQuiz(row);
                }
            }
        }

        // Item box animation: spin + gentle bob + glowing pulse.
        itemBoxes.forEach((box, i) => {
            if (box._itemActive) {
                box.rotation.y += 0.025;
                box.position.y = itemBoxBasePositions[i].y + Math.sin(gameTime * 0.04 + i) * ITEM_BOB;
                const pulse = 0.5 + Math.sin(gameTime * 0.08 + i) * 0.2;
                box.material.emissiveColor.copyFromFloats(pulse, pulse * 0.8, pulse * 0.2); // mutate, don't allocate per frame
            }
        });

        // --- STATIC QUESTION PANEL ---
        // Show the row the player is driving INTO: the nearest active row whose
        // track index is *ahead* of the player's current checkpoint (cyclically).
        // This guarantees the boxes in front match the choices shown, and the moment
        // one row is cleared (it respawns and is skipped) the next is already on screen.
        {
            let near = null, bestGap = Infinity;
            const pIdx = playerCar.checkpointIndex;
            for (const row of itemRows) {
                if (row.respawnTimer > 0 || !row.questionText) continue;
                let gap = row.trackIndex - pIdx;
                if (gap < 0) gap += numPoints; // cyclic: pick the next row ahead
                if (gap < bestGap) { bestGap = gap; near = row; }
            }
            if (near) {
                if (roadQ._row !== near || roadQ._q !== near.questionText || roadQ._kind !== near.kind) {
                    roadQ._row = near; roadQ._q = near.questionText; roadQ._kind = near.kind;
                    roadQText.textContent = near.kind === "gate"
                        ? `${GATE_STYLES[near.styleIdx].cap} Drive through the RIGHT door — ${near.questionText}`
                        : near.questionText;
                    roadQChoices.innerHTML = near.choiceTexts.map(c => `<span>${c}</span>`).join("");
                }
                roadQ.style.display = "block";
            } else {
                roadQ.style.display = "none";
                roadQ._row = null;
            }
        }

        // --- AI ITEMS ---
        // Boxes are the player's quiz, so AI receive items on a timer instead.
        aiCars.forEach((aiCar) => {
            if (aiCar._itemGrantTimer == null) aiCar._itemGrantTimer = 150 + Math.random() * 360;
            if (aiCar._itemGrantTimer > 0) aiCar._itemGrantTimer--;
            else if (!aiCar.currentItem) {
                aiCar.currentItem = randomItem();
                aiCar._itemGrantTimer = 360 + Math.random() * 600; // ~6-16s to next item
            }
            if (aiCar.currentItem && Math.random() < 0.006) {
                useItem(aiCar);
            }
        });

        // --- CAMERA ---
        const fwdX = Math.sin(playerCar.rotY);
        const fwdZ = Math.cos(playerCar.rotY);
        const camDist = playerCar.boostTimer > 0 ? 18 : 14;
        const camHeight = playerCar.boostTimer > 0 ? 8 : 6;
        // In-place chase-cam lerp — no per-frame Vector3 allocation (avoids GC stutter).
        const camPosX = playerCar.pos.x - fwdX * camDist;
        const camPosY = playerCar.pos.y + camHeight;
        const camPosZ = playerCar.pos.z - fwdZ * camDist;
        camera.position.x += (camPosX - camera.position.x) * 0.06;
        camera.position.y += (camPosY - camera.position.y) * 0.06;
        camera.position.z += (camPosZ - camera.position.z) * 0.06;
        // Collision screen-shake: jitter the camera, decaying over a few frames.
        if (cameraShake > 0.01) {
            camera.position.x += (Math.random() - 0.5) * cameraShake * 2;
            camera.position.y += (Math.random() - 0.5) * cameraShake * 2;
            camera.position.z += (Math.random() - 0.5) * cameraShake * 2;
            cameraShake *= 0.82;
        } else {
            cameraShake = 0;
        }
        _camTargetLerp.x += (playerCar.pos.x - _camTargetLerp.x) * 0.1;
        _camTargetLerp.y += (playerCar.pos.y + 1.5 - _camTargetLerp.y) * 0.1;
        _camTargetLerp.z += (playerCar.pos.z - _camTargetLerp.z) * 0.1;
        camera.setTarget(_camTargetLerp);

        // --- STINK-CLOUD BLINDNESS (player) ---
        if (playerCar.fogTimer > 0) {
            playerCar.fogTimer--;
            if (!fogShown) { fogShown = true; fogOverlayEl.style.opacity = "0.97"; }
        } else if (fogShown) {
            fogShown = false;
            fogOverlayEl.style.opacity = "0";
        }

        // --- HUD ---
        document.getElementById("lapNum").textContent = Math.min(playerCar.lap + 1, MAX_LAPS);
        const boostPercent = Math.min(100, Math.max(0, (playerCar.boostTimer / 180) * 100));
        document.getElementById("boostBar").style.width = boostPercent + "%";
        ratingBarEl.style.width = playerCar.rating.toFixed(1) + "%";
        const ratingColor = playerCar.rating > 50 ? "#44cc44" : playerCar.rating > 25 ? "#ffaa22" : "#ff4444";
        if (ratingBarEl._color !== ratingColor) {
            ratingBarEl._color = ratingColor;
            ratingBarEl.style.background = ratingColor;
        }
        document.getElementById("speedVal").textContent = Math.abs(Math.round(playerCar.speed * 200));

        SoundManager.updateEngine(playerCar.speed, playerCar.maxSpeed);

        // Sort the persistent array in place rather than spreading allCars every frame.
        const sortedCars = _sortedCars;
        sortedCars.sort((a, b) => carProgress(b) - carProgress(a));
        document.getElementById("position").textContent = positionSuffix(sortedCars.indexOf(playerCar) + 1);

        // --- POSITION LABELS ---
        // Only redraw + re-upload the texture when a car's rank actually changes —
        // re-uploading every car's label every frame was a major GPU stall.
        allCars.forEach((car, idx) => {
            const pos = sortedCars.indexOf(car) + 1;
            if (car.positionTex && car.positionMat && car._lastRankDrawn !== pos) {
                car._lastRankDrawn = pos;
                const tex = car.positionTex;
                const ctx = tex.getContext();
                ctx.clearRect(0, 0, 64, 64);

                const r = car._labelColor ? car._labelColor.r : 0.5;
                const g = car._labelColor ? car._labelColor.g : 0.5;
                const b = car._labelColor ? car._labelColor.b : 0.5;
                const bgR = Math.round(r * 255);
                const bgG = Math.round(g * 255);
                const bgB = Math.round(b * 255);

                ctx.fillStyle = "rgba(" + bgR + "," + bgG + "," + bgB + ",1)";
                ctx.beginPath();
                ctx.arc(32, 28, 24, 0, Math.PI * 2);
                ctx.fill();

                ctx.strokeStyle = "#ffffff";
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(32, 28, 24, 0, Math.PI * 2);
                ctx.stroke();

                ctx.fillStyle = "#ffffff";
                ctx.font = "bold 24px Arial";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(String(pos), 32, 30);

                tex.update();
            }
        });

        // Minimap
        if (gameTime % 2 === 0) drawMinimap();

        // --- END RACE CHECK ---
        if (playerCar.finished && !window._raceEnded) {
            window._raceEnded = true;
            setTimeout(() => endRace(), 2000);
        }

        // --- Cloud animation ---
        scene.transformNodes.forEach((node) => {
            if (node._cloudSpeed !== undefined) {
                node.position.x += node._cloudSpeed;
                if (node.position.x > 300) node.position.x = -300;
            }
        });
    }

    // Fixed-timestep dispatcher: accumulate real elapsed time and run stepGame()
    // in 1/60s slices. 60fps → ~1 step/frame (unchanged); 30fps → ~2 steps/frame
    // (physics keeps up, so the car covers the right distance per second). Capped
    // so a long stall (tab switch) or a very slow device can't death-spiral.
    let _stepAccum = 0;
    scene.onBeforeRenderObservable.add(() => {
        let frame = engine.getDeltaTime();
        if (!(frame > 0)) frame = FIXED_DT;     // guard against 0/NaN
        if (frame > 250) frame = 250;           // don't fast-forward after a big stall
        _stepAccum += frame;
        let n = 0;
        while (_stepAccum >= FIXED_DT && n < 8) { stepGame(); _stepAccum -= FIXED_DT; n++; }
        if (n >= 8) _stepAccum = 0;             // too far behind — stop trying to catch up
    });

    // ============================================================
    // RENDER LOOP
    // ============================================================

    engine.runRenderLoop(() => {
        scene.render();
    });

    window.addEventListener("resize", () => {
        engine.resize();
    });
    engine.resize();

    // Multiplayer: scene is built and the kart is on its grid slot — tell the
    // server. It holds the GO until EVERY client reports in, so nobody launches
    // early. Hold the 3-2-1 until then (goReleased stays false).
    if (isMultiplayer && socket) {
        countdownEl.textContent = "Waiting for players…";
        countdownEl.style.fontSize = "30px";
        countdownEl.style.display = "block";
        socket.emit('race-ready');
    }

    return scene;
};
