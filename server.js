const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  // Tolerate a busy game loop / network jitter (VPN, wifi) before declaring a
  // drop: wait 60s for a heartbeat pong rather than the 20s default, so a brief
  // stall doesn't spuriously disconnect a player mid-race.
  pingInterval: 20000,
  pingTimeout: 60000,
  // Bigger low-level buffer so a burst of position packets never trips a limit.
  maxHttpBufferSize: 1e7,
});

const rooms = new Map();

// ============================================================
// GLOBE QUIZ — real-time multiplayer (join a room, then race to tap the right
// place fastest). Separate from the kart rooms. The host's client sends the list
// of round targets {name,lat,lon,cc} (it owns the dataset); the server runs the
// rounds, times the guesses, and scores accuracy × speed.
// ============================================================
const globeRooms = new Map();
const gPub = (r) => r.players.filter((p) => p.connected !== false).map((p) => ({ id: p.pid, name: p.name, score: p.score, host: p.pid === r.host }));
const D2R = Math.PI / 180;
function gHaversine(a, b) { const dLat = (b.lat - a.lat) * D2R, dLon = (b.lon - a.lon) * D2R; const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * D2R) * Math.cos(b.lat * D2R) * Math.sin(dLon / 2) ** 2; return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(s))); }
let GEO_BY_NAME = undefined;
function geoByName() {
  if (GEO_BY_NAME !== undefined) return GEO_BY_NAME;
  try { const g = JSON.parse(fs.readFileSync(path.join(__dirname, 'assets', 'geo', 'world.json'), 'utf8')); GEO_BY_NAME = {}; for (const f of g.features) GEO_BY_NAME[f.properties.name] = f; }
  catch { GEO_BY_NAME = {}; }
  return GEO_BY_NAME;
}
function gFeatureContains(f, lon, lat) {
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const poly of polys) { let inside = false; for (const ring of poly) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1]; if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside; } if (inside) return true; }
  return false;
}
function gPointInCountry(lon, lat, name) { const f = geoByName()[name]; return f ? gFeatureContains(f, lon, lat) : false; }
function gCountryAt(lon, lat) { const g = geoByName(); for (const name in g) if (gFeatureContains(g[name], lon, lat)) return name; return null; }
const GLOBE_WINDOW_MS = 15000; // max time to answer each question
function gHost(r) { const c = r.players.filter((p) => p.connected !== false); return c[0] ? c[0].pid : null; }
function gAdvance(room) {
  if (!room) return;
  if (room.timer) { clearTimeout(room.timer); room.timer = null; }
  room.round++;
  if (room.round >= room.targets.length) { room.state = 'done'; const standings = gPub(room).slice().sort((a, b) => b.score - a.score); io.to('g:' + room.id).emit('globe-final', { standings }); return; }
  room.state = 'asking'; room.guesses = {}; room.qStart = Date.now();
  const t = room.targets[room.round];
  io.to('g:' + room.id).emit('globe-question', { index: room.round, total: room.targets.length, clue: room.clue, windowMs: GLOBE_WINDOW_MS, name: room.clue === 'flag' ? undefined : t.name, cc: room.clue === 'flag' ? t.cc : undefined });
  room.timer = setTimeout(() => gEndRound(room), GLOBE_WINDOW_MS + 500);
}
function gEndRound(room) {
  if (!room || room.state !== 'asking') return;
  if (room.timer) { clearTimeout(room.timer); room.timer = null; }
  room.state = 'reveal';
  const t = room.targets[room.round];
  const results = room.players.filter((p) => p.connected !== false).map((p) => {
    const g = room.guesses[p.pid];
    if (!g) return { pid: p.pid, name: p.name, lon: null, lat: null, dist: null, pts: 0, ms: null, inside: false, clicked: null };
    const flagMode = room.clue === 'flag';
    const inside = flagMode && gPointInCountry(g.lon, g.lat, t.name);
    let dist, acc, clicked = null;
    if (flagMode) {
      // country quiz → binary: wrong country (or sea) scores 0, never partial credit
      if (inside) { dist = 0; acc = 1; }
      else { dist = Math.round(gHaversine(g, t)); acc = 0; clicked = gCountryAt(g.lon, g.lat); }
    } else { dist = Math.round(gHaversine(g, t)); acc = Math.exp(-dist / 1400); }
    const speed = Math.max(0, 1 - g.ms / GLOBE_WINDOW_MS);
    const pts = Math.round(acc * (700 + 300 * speed)); // accuracy × speed
    p.score += pts;
    return { pid: p.pid, name: p.name, lon: g.lon, lat: g.lat, dist, pts, ms: g.ms, inside, clicked };
  });
  const standings = gPub(room).slice().sort((a, b) => b.score - a.score);
  io.to('g:' + room.id).emit('globe-round-result', { index: room.round, target: { name: t.name, lat: t.lat, lon: t.lon, cc: t.cc }, results, standings });
  room.timer = setTimeout(() => gAdvance(room), 6500); // auto-advance to next question
}

// LAN discovery: list the open rooms so a player on the same network can tap to
// join instead of typing a 6-char code. Everyone connects to the host's server,
// so it already knows every room. Only rooms still accepting players are shown.
app.get('/rooms', (req, res) => {
  const list = [];
  for (const [id, room] of rooms) {
    const conn = room.players.filter((p) => p.connected !== false);
    if (conn.length === 0) continue; // a room everyone left (grace window) is a ghost — don't advertise it
    list.push({
      id,
      name: roomName(room),
      host: (room.players[0] && room.players[0].name) || 'Host',
      count: conn.length,
      state: room.state,
      joinable: (room.state === 'lobby' || room.state === 'post-race') && conn.length < 4,
    });
  }
  res.json(list);
});

// ============================================================
// PAIR-MATCHING content (match.html). Reads the sibling ../quiz project's
// question bank READ-ONLY and turns it into ready-to-play "pair sets". We never
// write to that project — only load its JSON. Two sources of pairs:
//   1. `match` questions     → their pairs directly (left ↔ right).
//   2. multiple_choice / short_answer with a plain text prompt + scalar answer
//      → grouped per topic into rounds of "question ↔ answer".
// ============================================================

// Where the quiz question bank lives (sibling repo). Override with QUIZ_DIR.
const QUIZ_DIR = process.env.QUIZ_DIR || path.join(__dirname, '..', 'quiz', 'questions');

// A Content (string or {text,math,image,figure,…}) is card-renderable here only
// if it's text/math/image — figures/audio/video need the quiz's own renderer.
function renderableContent(c) {
  if (c == null) return null;
  if (typeof c === 'string') return c.trim() ? c : null;
  if (typeof c === 'object') {
    if (c.figure || c.audio || c.video || c.raw_svg) return null;
    if (c.text || c.math || c.image) return c;
    return null;
  }
  return null;
}

function loadPairSets() {
  let files = [];
  try { files = fs.readdirSync(QUIZ_DIR).filter((f) => f.endsWith('.json') && f !== 'index.json'); }
  catch { return []; } // quiz project not present — match game just shows "no content"

  const all = [];
  for (const f of files) {
    try { const arr = JSON.parse(fs.readFileSync(path.join(QUIZ_DIR, f), 'utf8')); if (Array.isArray(arr)) all.push(...arr); }
    catch { /* skip a malformed file */ }
  }

  const sets = [];

  // 1. Native `match` questions.
  for (const q of all) {
    if (q.type !== 'match' || !Array.isArray(q.pairs)) continue;
    const pairs = [];
    for (const p of q.pairs) {
      const left = renderableContent(p.left), right = renderableContent(p.right);
      if (left != null && right != null) pairs.push({ left, right });
    }
    if (pairs.length >= 2) {
      sets.push({
        id: q.id, source: 'match',
        subject: q.subject || '', topic: q.topic || '',
        prompt: (typeof q.prompt === 'string' ? q.prompt : (q.prompt && q.prompt.text)) || 'Match the pairs',
        explain: typeof q.explain === 'string' ? q.explain : '',
        lang: q.lang || 'en',
        pairs: pairs.slice(0, 6), // cap a round at 6 pairs (12 cards)
      });
    }
  }

  // 2. Question ↔ answer pairs from MC / short_answer, grouped per topic.
  const buckets = {};
  for (const q of all) {
    if (q.generate) continue;
    if (q.type !== 'multiple_choice' && q.type !== 'short_answer') continue;
    const prompt = renderableContent(q.prompt);
    const ans = q.answer;
    if (prompt == null || (typeof ans !== 'string' && typeof ans !== 'number')) continue;
    const key = q.topic || 'general';
    (buckets[key] = buckets[key] || []).push({
      left: prompt, right: String(ans),
      subject: q.subject || '', topic: q.topic || '', lang: q.lang || 'en',
    });
  }
  for (const [topic, items] of Object.entries(buckets)) {
    // Chunk a topic's questions into rounds of 4 (last round ≥3, else dropped).
    for (let i = 0; i < items.length; i += 4) {
      const chunk = items.slice(i, i + 4);
      if (chunk.length < 3) continue;
      sets.push({
        id: `qa-${topic}-${i}`, source: 'qa',
        subject: chunk[0].subject, topic, lang: chunk[0].lang,
        prompt: 'Match each question to its answer',
        pairs: chunk.map((c) => ({ left: c.left, right: c.right })),
      });
    }
  }

  return sets;
}

app.get('/quiz/pairs', (req, res) => {
  const sets = loadPairSets();
  // Distinct subjects/topics for the picker.
  const subjects = [...new Set(sets.map((s) => s.subject).filter(Boolean))].sort();
  res.json({ sets, subjects, count: sets.length });
});

// ---- /quiz/mcq — a unified multiple-choice feed for the coin-earning games
// (Tower Quiz Defense, and anything else that wants quick MCQs). Built READ-ONLY
// from the sibling ../quiz bank; every question is normalised to
// { id, prompt, choices[4?], answer, diff:1|2|3, topic, subject }.
// diff comes from the bank's own difficulty field (1..3) so "harder question
// earns higher coin" maps directly.
function plainText(v) {
  if (typeof v === 'string') return v.includes('$') ? null : v;
  // object prompts may carry math/image/audio parts the canvas games can't show —
  // only accept ones that are PURELY text
  if (v && typeof v.text === 'string' && !v.math && !v.image && !v.audio && !v.figure) return v.text.includes('$') ? null : v.text;
  return null;
}
function shuffleArr(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function loadMcq() {
  let files = [];
  try { files = fs.readdirSync(QUIZ_DIR).filter((f) => f.endsWith('.json') && f !== 'index.json'); }
  catch { return []; }
  const all = [];
  for (const f of files) {
    try { const arr = JSON.parse(fs.readFileSync(path.join(QUIZ_DIR, f), 'utf8')); if (Array.isArray(arr)) all.push(...arr); }
    catch { /* skip a malformed file */ }
  }
  const out = [];
  const clampDiff = (d, fallback) => (d === 1 || d === 2 || d === 3) ? d : fallback;
  for (const q of all) {
    if (q.generate) continue;
    const prompt = plainText(q.prompt);
    if (!prompt) continue;
    const base = { id: q.id, topic: q.topic || 'general', subject: q.subject || '' };
    if (q.type === 'multiple_choice' && Array.isArray(q.choices) && q.choices.length >= 2) {
      const choices = q.choices.map((c) => plainText(c)).filter((c) => c != null).map(String);
      const answer = String(q.answer);
      if (choices.length >= 2 && choices.includes(answer)) out.push({ ...base, prompt, choices, answer, diff: clampDiff(q.difficulty, 2) });
    } else if (q.type === 'true_false') {
      const answer = (q.answer === true || String(q.answer).toLowerCase() === 'true') ? 'True' : 'False';
      out.push({ ...base, prompt, choices: ['True', 'False'], answer, diff: clampDiff(q.difficulty, 1) });
    } else if (q.type === 'match' && Array.isArray(q.pairs)) {
      // "What goes with X?" — distractors are other rights from the SAME set.
      const pairs = q.pairs.map((p) => ({ left: plainText(p.left), right: plainText(p.right) })).filter((p) => p.left && p.right);
      if (pairs.length >= 4) {
        for (const p of pairs) {
          const others = shuffleArr(pairs.filter((o) => o.right !== p.right).map((o) => o.right)).slice(0, 3);
          if (others.length < 3) continue;
          out.push({ ...base, id: `${q.id}-${p.left.slice(0, 12)}`, prompt: `What goes with “${p.left}”?`, choices: shuffleArr([p.right, ...others]), answer: p.right, diff: clampDiff(q.difficulty, 1) });
        }
      }
    } else if (q.type === 'short_answer' && (typeof q.answer === 'string' || typeof q.answer === 'number')) {
      const answer = String(q.answer);
      const n = Number(answer);
      let distractors;
      if (Number.isFinite(n) && answer.trim() !== '') {
        const step = Math.max(1, Math.round(Math.abs(n) * 0.12));
        distractors = [...new Set([n + step, n - step, n + step * 2 + 1].map(String))].filter((d) => d !== answer);
      } else {
        distractors = shuffleArr(all.filter((o) => o !== q && o.type === 'short_answer' && o.topic === q.topic && typeof o.answer === 'string').map((o) => String(o.answer))).slice(0, 3);
      }
      if (distractors.length >= 2) out.push({ ...base, prompt, choices: shuffleArr([answer, ...distractors.slice(0, 3)]), answer, diff: clampDiff(q.difficulty, 3) });
    }
  }
  return out;
}
app.get('/quiz/mcq', (req, res) => {
  const questions = loadMcq();
  res.json({ questions, count: questions.length, byDiff: { 1: questions.filter((q) => q.diff === 1).length, 2: questions.filter((q) => q.diff === 2).length, 3: questions.filter((q) => q.diff === 3).length } });
});

app.use(express.static(path.join(__dirname)));

// How long a dropped player's slot (and their car) is held open for a reconnect
// before they're really removed from the room.
const RECONNECT_GRACE_MS = 30000;

// Players are identified by a STABLE `pid` (a per-page-load id the client keeps
// across socket reconnects), not the transient socket.id. `socketId` is just the
// current transport address. Clients only ever see `id` (= pid).
const pub = (p) => ({ id: p.pid, name: p.name, car: p.car, ready: p.ready, connected: p.connected !== false });
const pubAll = (room) => room.players.map(pub);
// Only CONNECTED players gate the start — a player who dropped (and is sitting in
// the reconnect-grace window) must not block the host from starting the race.
const connected = (room) => room.players.filter((p) => p.connected !== false);
// The host is the first CONNECTED player. So when the host leaves, the next
// player still in the room automatically inherits the room (and its controls);
// if the original host reconnects, they reclaim it. Falls back to the first
// slot while everyone is briefly disconnected.
const hostPlayer = (room) => connected(room)[0] || room.players[0] || null;
const hostPid = (room) => { const h = hostPlayer(room); return h ? h.pid : null; };
const allReadyToStart = (room) => { const c = connected(room); return c.length > 0 && c.every((p) => p.ready); };
// Trim a user-supplied room name to something safe and short (or null to clear).
const cleanRoomName = (s) => {
  const t = String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24);
  return t || null;
};
const roomName = (room) => room.name || `${(room.players[0] && room.players[0].name) || 'Race'}'s Room`;
const nameOf = (room, pid) => { const p = room.players.find((x) => x.pid === pid); return p ? p.name : 'Player'; };

// Cup (Grand Prix) points by finishing position among the human players, 1st
// first. Up to 4 players use the first four; bigger fields fall back to 1 pt.
const CUP_POINTS = [10, 7, 5, 3, 2, 1];

// Run one race: a 5s lobby countdown, then the race-start. `cup` (optional)
// tags the round with its position in the Grand Prix so clients can show
// "Race X of Y" and suppress the single-race "Play Again" screen.
function launchRace(room, trackId, cup) {
  room.trackId = (typeof trackId === 'number') ? trackId : 0;
  room.state = 'countdown';
  const tag = cup ? { cup: true, cupTrackIndex: cup.index, cupTotal: cup.trackIds.length } : { cup: false };

  io.to(room.id).emit('race-countdown', { players: pubAll(room), trackId: room.trackId, ...tag });

  let countdown = 5;
  const iv = setInterval(() => {
    io.to(room.id).emit('countdown-tick', { count: countdown });
    countdown--;
    if (countdown < 0) {
      clearInterval(iv);
      room.state = 'racing';
      room.raceStartTime = Date.now();
      // Arm the synced-launch barrier: collect 'race-ready' from every client,
      // GO when all are in (fallback after 12s so one stuck loader can't hang it).
      room.raceReady = new Set();
      room._goSent = false;
      if (room.goTimer) clearTimeout(room.goTimer);
      room.goTimer = setTimeout(() => sendRaceGo(room), 12000);
      io.to(room.id).emit('race-start', { startTime: room.raceStartTime, players: pubAll(room), trackId: room.trackId, ...tag });
    }
  }, 1000);
}

// Tally one cup track: rank the players by finish time (no finish = DNF, ranked
// last, 0 pts), add the position points to the running totals, broadcast the
// standings, then either start the next track or crown the champion.
function finalizeCupTrack(room) {
  const cup = room.cup;
  if (!cup || cup.finalizing) return;
  cup.finalizing = true;
  if (cup._timer) { clearTimeout(cup._timer); cup._timer = null; }

  const ranking = room.players.map((p) => ({
    pid: p.pid, name: p.name,
    time: (cup.finishes[p.pid] != null ? cup.finishes[p.pid] : Infinity),
  })).sort((a, b) => a.time - b.time);
  ranking.forEach((r, i) => {
    r.dnf = !isFinite(r.time);
    r.points = r.dnf ? 0 : (CUP_POINTS[i] != null ? CUP_POINTS[i] : 1);
    cup.points[r.pid] = (cup.points[r.pid] || 0) + r.points;
  });
  const thisTrack = ranking.map((r, i) => ({ pid: r.pid, name: r.name, rank: i + 1, points: r.points, dnf: r.dnf }));
  cup.results.push({ trackId: cup.trackIds[cup.index], ranking: thisTrack });

  const standings = room.players.map((p) => ({ pid: p.pid, name: p.name, points: cup.points[p.pid] || 0 }))
    .sort((a, b) => b.points - a.points);
  const isFinal = cup.index >= cup.trackIds.length - 1;

  io.to(room.id).emit('cup-standings', {
    trackIndex: cup.index,
    totalTracks: cup.trackIds.length,
    trackId: cup.trackIds[cup.index],
    ranking: thisTrack,
    standings,
    results: cup.results, // every track played so far → detailed breakdown table
    final: isFinal,
  });

  if (isFinal) {
    room.state = 'post-race';
    room.cup = null;
  } else {
    // Hold the standings on screen, then roll into the next track.
    setTimeout(() => {
      const r = rooms.get(room.id);
      if (!r || !r.cup) return;
      r.cup.index++;
      r.cup.finishes = {};
      r.cup.finalizing = false;
      launchRace(r, r.cup.trackIds[r.cup.index], r.cup);
    }, 8000);
  }
}

// Synchronised launch: after race-start every client builds its scene and reports
// 'race-ready'; only once ALL have (or the fallback timer fires) does the server
// broadcast 'race-go'. This is what stops the host getting a head start just
// because its track finished loading first.
function sendRaceGo(room) {
  if (!room || room._goSent) return;
  room._goSent = true;
  if (room.goTimer) { clearTimeout(room.goTimer); room.goTimer = null; }
  io.to(room.id).emit('race-go');
}

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  socket.on('create-room', (data, callback) => {
    const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    const playerName = (data && data.name) || 'Host';
    const pid = (data && data.clientId) || socket.id;
    const room = {
      id: roomId,
      name: cleanRoomName(data && data.roomName) || `${playerName}'s Room`,
      players: [{ pid, socketId: socket.id, name: playerName, car: null, ready: false, connected: true }],
      state: 'lobby',
      raceStartTime: null
    };
    rooms.set(roomId, room);
    socket.join(roomId);
    socket.roomId = roomId;
    socket.pid = pid;
    console.log(`Room ${roomId} created by ${playerName} (${pid})`);
    callback({ roomId, playerId: pid, hostId: pid, roomName: room.name });
  });

  socket.on('join-room', (data, callback) => {
    const roomId = (data && data.roomId) || data;
    const playerName = (data && data.name) || `Player`;
    const pid = (data && data.clientId) || socket.id;
    const room = rooms.get(roomId);
    if (!room) { callback({ error: 'Room not found' }); return; }

    socket.join(roomId);
    socket.roomId = roomId;
    socket.pid = pid;

    // Reconnect / double-join: a slot with this stable pid already exists, so
    // just re-bind it to the new socket — keep the car, cancel any pending
    // removal, and DON'T reject even mid-race (this is how a dropped player
    // rejoins their own running race instead of being frozen out).
    const existing = room.players.find(p => p.pid === pid);
    if (existing) {
      if (existing._removeTimer) { clearTimeout(existing._removeTimer); existing._removeTimer = null; }
      existing.socketId = socket.id;
      existing.connected = true;
      if (playerName) existing.name = playerName;
      console.log(`${playerName} reconnected to room ${roomId} (${pid})`);
      io.to(roomId).emit('player-joined', { players: pubAll(room), playerId: pid, allReady: allReadyToStart(room), hostId: hostPid(room) });
      callback({ success: true, playerId: pid, players: pubAll(room), state: room.state, trackId: room.trackId, reconnected: true, hostId: hostPid(room), roomName: roomName(room) });
      return;
    }

    // Genuinely new player — enforce capacity + lobby state.
    if (room.players.length >= 4) { callback({ error: 'Room is full' }); return; }
    if (room.state !== 'lobby' && room.state !== 'post-race') { callback({ error: 'Race already started' }); return; }

    room.players.push({ pid, socketId: socket.id, name: playerName, car: null, ready: false, connected: true });
    console.log(`${playerName} joined room ${roomId} (${pid})`);
    io.to(roomId).emit('player-joined', { players: pubAll(room), playerId: pid, allReady: allReadyToStart(room), hostId: hostPid(room) });
    io.to(roomId).emit('chat', { sys: true, text: `${playerName} joined the room` });
    callback({ success: true, playerId: pid, players: pubAll(room), trackId: room.trackId, hostId: hostPid(room), roomName: roomName(room) });
  });

  // Host renames the room — broadcast the new name + advertise it in the LAN list.
  socket.on('rename-room', (data) => {
    const room = rooms.get(socket.roomId);
    if (!room) return;
    if (hostPid(room) !== socket.pid) return;
    const name = cleanRoomName(data && data.name);
    if (!name) return;
    room.name = name;
    io.to(socket.roomId).emit('room-renamed', { name: room.name });
  });

  socket.on('select-car', (carModel) => {
    const room = rooms.get(socket.roomId);
    if (!room) return;

    const player = room.players.find(p => p.pid === socket.pid);
    if (player) {
      player.car = carModel;
      player.ready = true;
    }

    io.to(socket.roomId).emit('player-ready', {
      playerId: socket.pid,
      car: carModel,
      allReady: allReadyToStart(room),
      hostId: hostPid(room)
    });
  });

  socket.on('start-race', (data) => {
    const room = rooms.get(socket.roomId);
    if (!room) return;
    if (hostPid(room) !== socket.pid) return;
    if (!allReadyToStart(room)) return;

    room.cup = null; // a single race clears any prior cup
    launchRace(room, (data && data.trackId), null);
  });

  // Start a CUP (Grand Prix): race every track in `trackIds` back to back and
  // add up each track's position points into one overall ranking. The host's
  // client sends the full ordered track list (it owns the TRACKS table).
  socket.on('start-cup', (data) => {
    const room = rooms.get(socket.roomId);
    if (!room) return;
    if (hostPid(room) !== socket.pid) return;
    if (!allReadyToStart(room)) return;

    let trackIds = (data && Array.isArray(data.trackIds)) ? data.trackIds.filter((n) => typeof n === 'number') : [];
    if (!trackIds.length) trackIds = [0];
    room.cup = { trackIds, index: 0, points: {}, finishes: {}, results: [], finalizing: false, _timer: null };
    room.players.forEach((p) => { room.cup.points[p.pid] = 0; }); // everyone starts at 0
    launchRace(room, trackIds[0], room.cup);
  });

  // A client finished building its scene and is sitting on the grid. Once every
  // connected player has reported in, release the synchronized GO.
  socket.on('race-ready', () => {
    const room = rooms.get(socket.roomId);
    if (!room || room.state !== 'racing' || !room.raceReady || room._goSent) return;
    room.raceReady.add(socket.pid);
    const conn = connected(room);
    if (conn.length > 0 && conn.every((p) => room.raceReady.has(p.pid))) sendRaceGo(room);
  });

  // Host picked the next course — show it to EVERY player in the room.
  socket.on('select-track', (data) => {
    const room = rooms.get(socket.roomId);
    if (!room || hostPid(room) !== socket.pid) return;
    room.trackId = (data && typeof data.trackId === 'number') ? data.trackId : 0;
    io.to(socket.roomId).emit('track-selected', { trackId: room.trackId });
  });

  // Room text chat. Server stamps the sender's name and relays to everyone.
  socket.on('chat-message', (data) => {
    const room = rooms.get(socket.roomId);
    if (!room) return;
    const text = String((data && data.text) || '').slice(0, 200).trim();
    if (!text) return;
    const player = room.players.find(p => p.pid === socket.pid);
    io.to(socket.roomId).emit('chat', { pid: socket.pid, name: (player && player.name) || 'Player', text });
  });

  socket.on('update-position', (data) => {
    if (!socket.roomId) return;
    // Volatile: position packets are superseded every frame, so if a recipient's
    // link is congested, DROP the stale one instead of queueing it (queueing is
    // what eventually overwhelms a slow connection and forces a disconnect).
    socket.to(socket.roomId).volatile.emit('player-update', { playerId: socket.pid, ...data });
  });

  socket.on('use-item', (data) => {
    if (!socket.roomId) return;
    socket.to(socket.roomId).emit('item-used', { playerId: socket.pid, ...data });
  });

  socket.on('lap-complete', (lap) => {
    if (!socket.roomId) return;
    io.to(socket.roomId).emit('player-lap', { playerId: socket.pid, lap });
  });

  socket.on('race-finish', (data) => {
    if (!socket.roomId) return;
    io.to(socket.roomId).emit('player-finished', { playerId: socket.pid, ...data });

    // Cup: record this player's finish time for the current track. Tally as soon
    // as every CONNECTED player is in; otherwise give stragglers a bounded wait
    // (a stuck/slow player can't hang the Grand Prix forever).
    const room = rooms.get(socket.roomId);
    if (room && room.cup && !room.cup.finalizing) {
      const cup = room.cup;
      if (cup.finishes[socket.pid] == null) {
        cup.finishes[socket.pid] = (data && typeof data.finishTime === 'number') ? data.finishTime : 1e12;
      }
      const conn = connected(room);
      const allIn = conn.length > 0 && conn.every((p) => cup.finishes[p.pid] != null);
      if (allIn) finalizeCupTrack(room);
      else if (!cup._timer) cup._timer = setTimeout(() => finalizeCupTrack(room), 25000);
    }
  });

  socket.on('reset-room', () => {
    const room = rooms.get(socket.roomId);
    if (!room) return;
    if (hostPid(room) !== socket.pid) return;

    room.players.forEach(p => { p.car = null; p.ready = false; });
    room.state = 'lobby';
    room.raceStartTime = null;
    room.cup = null; // abandon any cup in progress

    io.to(socket.roomId).emit('room-reset', { players: pubAll(room), hostId: hostPid(room) });
  });

  // ---- Globe Quiz multiplayer ----
  socket.on('globe-create', (data, cb) => {
    const id = Math.random().toString(36).substring(2, 7).toUpperCase();
    const pid = (data && data.clientId) || socket.id;
    const room = { id, players: [{ pid, socketId: socket.id, name: (data && data.name) || 'Host', score: 0, connected: true }], host: pid, state: 'lobby', targets: [], round: -1, clue: 'name', guesses: {}, timer: null };
    globeRooms.set(id, room);
    socket.join('g:' + id); socket.globeRoom = id; socket.gid = pid;
    cb && cb({ roomId: id, playerId: pid });
    io.to('g:' + id).emit('globe-players', { players: gPub(room), host: room.host });
  });
  socket.on('globe-join', (data, cb) => {
    const id = (data && data.roomId || '').toUpperCase(); const room = globeRooms.get(id);
    if (!room) { cb && cb({ error: 'Room not found' }); return; }
    const pid = (data && data.clientId) || socket.id;
    socket.join('g:' + id); socket.globeRoom = id; socket.gid = pid;
    let p = room.players.find((x) => x.pid === pid);
    if (p) { p.socketId = socket.id; p.connected = true; }
    else { if (room.state !== 'lobby') { cb && cb({ error: 'Game already started' }); return; } p = { pid, socketId: socket.id, name: (data && data.name) || 'Player', score: 0, connected: true }; room.players.push(p); }
    cb && cb({ roomId: id, playerId: pid, players: gPub(room), host: room.host });
    io.to('g:' + id).emit('globe-players', { players: gPub(room), host: room.host });
  });
  socket.on('globe-start', (data) => {
    const room = globeRooms.get(socket.globeRoom); if (!room || room.host !== socket.gid || room.state !== 'lobby') return;
    const targets = (data && Array.isArray(data.targets)) ? data.targets.filter((t) => t && typeof t.lat === 'number' && typeof t.lon === 'number') : [];
    if (!targets.length) return;
    room.targets = targets.slice(0, 20); room.clue = (data && data.clue) || 'name'; room.round = -1;
    room.players.forEach((p) => { p.score = 0; });
    io.to('g:' + room.id).emit('globe-go', { total: room.targets.length, clue: room.clue });
    setTimeout(() => gAdvance(room), 600);
  });
  socket.on('globe-guess', (data) => {
    const room = globeRooms.get(socket.globeRoom); if (!room || room.state !== 'asking') return;
    if (room.guesses[socket.gid]) return; // one guess per round
    if (!data || typeof data.lon !== 'number' || typeof data.lat !== 'number') return;
    room.guesses[socket.gid] = { lon: data.lon, lat: data.lat, ms: Date.now() - room.qStart };
    const conn = room.players.filter((p) => p.connected !== false);
    io.to('g:' + room.id).emit('globe-answered', { count: Object.keys(room.guesses).length, total: conn.length });
    if (conn.length && conn.every((p) => room.guesses[p.pid])) gEndRound(room);
  });

  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    // Globe room: mark dropped; if a quiz is waiting only on this player, end the
    // round; delete the room once empty.
    const gr = socket.globeRoom && globeRooms.get(socket.globeRoom);
    if (gr) {
      const gp = gr.players.find((p) => p.socketId === socket.id);
      if (gp) { gp.connected = false; gp.socketId = null; }
      const conn = gr.players.filter((p) => p.connected !== false);
      if (!conn.length) { if (gr.timer) clearTimeout(gr.timer); globeRooms.delete(gr.id); }
      else { gr.host = gHost(gr); io.to('g:' + gr.id).emit('globe-players', { players: gPub(gr), host: gr.host }); if (gr.state === 'asking' && conn.every((p) => gr.guesses[p.pid])) gEndRound(gr); }
    }
    const roomId = socket.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    const player = room.players.find(p => p.socketId === socket.id);
    if (!player) return; // already re-bound to a newer socket — ignore the stale drop

    // Hold the slot open for a reconnect; only really remove after the grace
    // window. During the gap the other clients keep the (now-still) car.
    player.connected = false;
    player.socketId = null;
    // Recompute readiness without this player so the host can start the others.
    // hostId now reflects the next connected player, so if the HOST dropped the
    // others immediately learn who inherited the room.
    io.to(roomId).emit('player-reconnecting', { playerId: player.pid, players: pubAll(room), allReady: allReadyToStart(room), hostId: hostPid(room) });

    // If a cup is mid-track and the only player(s) we were still waiting on just
    // dropped, tally now with whoever's left so the Grand Prix doesn't stall.
    if (room.cup && !room.cup.finalizing) {
      const conn = connected(room);
      if (conn.length > 0 && conn.every((p) => room.cup.finishes[p.pid] != null)) finalizeCupTrack(room);
    }

    player._removeTimer = setTimeout(() => {
      const r = rooms.get(roomId);
      if (!r) return;
      const idx = r.players.indexOf(player);
      if (idx === -1 || player.connected) return; // came back in time
      r.players.splice(idx, 1);
      console.log(`Player ${player.pid} removed from room ${roomId} (no reconnect)`);
      if (r.players.length === 0) {
        rooms.delete(roomId);
        console.log(`Room ${roomId} deleted`);
      } else {
        io.to(roomId).emit('player-left', { playerId: player.pid, players: pubAll(r), allReady: allReadyToStart(r), hostId: hostPid(r) });
        io.to(roomId).emit('chat', { sys: true, text: `${player.name} left the room` });
      }
    }, RECONNECT_GRACE_MS);
  });
});

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n✗ Port ${PORT} is already in use — the game may already be running.`);
    console.error(`  Open http://localhost:${PORT} in your browser, or start on another port:`);
    console.error(`      PORT=3001 ./start.sh\n`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, HOST, () => {
  const os = require('os');

  // Collect every shareable IPv4, but prefer a real LAN interface over VPN
  // tunnels (Tailscale/WireGuard/etc.) — a VPN address is unreachable for
  // players on the same WiFi, which made the old "share this URL" line wrong
  // whenever a VPN was up. (The old loop also kept overwriting the pick, so
  // the LAST interface won — usually the VPN.)
  const isVpnLike = (name) => /tailscale|wg|tun|tap|utun|zt|docker|veth|br-|virbr|vbox/i.test(name);
  const candidates = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const iface of list || []) {
      if (iface.family === 'IPv4' && !iface.internal) candidates.push({ name, address: iface.address });
    }
  }
  const lan = candidates.filter(c => !isVpnLike(c.name));
  const best = (lan[0] || candidates[0] || { address: 'localhost' }).address;

  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Network access: http://${best}:${PORT}`);
  console.log('Share the network URL with other players on the same WiFi/LAN');
  if (candidates.length > 1) {
    console.log('All addresses:');
    for (const c of candidates) {
      console.log(`  http://${c.address}:${PORT}   (${c.name}${isVpnLike(c.name) ? ' — VPN, only reachable by VPN peers' : ''})`);
    }
  }
});
