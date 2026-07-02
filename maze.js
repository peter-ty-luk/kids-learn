// ============================================================
// Pair Maze — navigate a grid maze, carry ONE pairing piece at a time, match
// every pair, then reach the exit. Pairs come from the quiz project via
// /quiz/pairs (same source as the card game). Twists: 2-player vs, dark maze
// (fog of war + light switches), and traps (patrolling guards + moving doors).
//
// Test hooks: the whole game lives on window.MZ (state + move/teleport/drop) so
// the headless test can drive it deterministically without pathfinding.
// ============================================================

const $ = (id) => document.getElementById(id);
const MZ = { state: null, opts: { players: 1, size: 'medium', dark: false, traps: false, hidden: false, subject: null }, sets: [], subjects: [] };
window.MZ = MZ;

// ---------- sound (reuses the kart game's Pixabay SFX + music) ----------
const Sound = {
  on: true, pools: {}, idx: {}, music: null, tracks: [],
  KEYS: { pickup: 'pickup', match: 'coin', win: 'win', caught: 'crash', door: 'click', drop: 'click', wrong: 'hit' },
  init() {
    try { this.on = localStorage.getItem('pm-sound') !== '0'; } catch { /* */ }
    for (const key of new Set(Object.values(this.KEYS))) {
      const pool = []; for (let i = 0; i < 4; i++) { const a = new Audio(`assets/audio/sfx/${key}.mp3`); a.preload = 'auto'; pool.push(a); }
      this.pools[key] = pool; this.idx[key] = 0;
    }
    fetch('assets/audio/music/tracks.json').then((r) => r.json()).then((l) => { this.tracks = l || []; }).catch(() => {});
    this.updateBtn();
  },
  play(name, vol = 1) {
    if (!this.on) return;
    const key = this.KEYS[name]; const pool = this.pools[key]; if (!pool) return;
    this.idx[key] = (this.idx[key] + 1) % pool.length; const a = pool[this.idx[key]];
    try { a.currentTime = 0; a.volume = vol; a.play().catch(() => {}); } catch { /* */ }
  },
  startMusic() {
    if (!this.on || !this.tracks.length) return;
    if (!this.music) { const t = this.tracks[Math.floor(Math.random() * this.tracks.length)]; this.music = new Audio(`assets/audio/music/${t.file}`); this.music.loop = true; this.music.volume = 0.18; }
    this.music.play().catch(() => {});
  },
  stopMusic() { if (this.music) { try { this.music.pause(); } catch { /* */ } } },
  toggle() { this.on = !this.on; try { localStorage.setItem('pm-sound', this.on ? '1' : '0'); } catch { /* */ } if (this.on) this.startMusic(); else this.stopMusic(); this.updateBtn(); },
  updateBtn() { const b = $('sound-btn'); if (b) { b.textContent = this.on ? '🔊' : '🔈'; b.classList.toggle('off', !this.on); } },
};

// ---------- helpers ----------
const WALL = 1, FLOOR = 0;
const SIZES = { small: { cw: 6, ch: 6 }, medium: { cw: 7, ch: 7 }, large: { cw: 8, ch: 8 } };
const P_COLORS = [{ body: '#3b82f6', edge: '#1d4ed8', soft: '#dbeafe' }, { body: '#ef4444', edge: '#b91c1c', soft: '#fee2e2' }];
const DIRV = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

function pairText(c) {
  if (c == null) return '';
  if (typeof c === 'string') return c.replace(/\$/g, '');
  if (c.text) return c.text.replace(/\$/g, '');
  if (c.math) return c.math;
  if (c.image) return '🖼';
  return '';
}
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const key2 = (x, y) => x + ',' + y;

// ---------- maze generation (recursive backtracker on an expanded wall grid) ----------
function genMaze(cw, ch) {
  const GW = 2 * cw + 1, GH = 2 * ch + 1;
  const g = Array.from({ length: GH }, () => new Array(GW).fill(WALL));
  const cellTile = (cx, cy) => [2 * cx + 1, 2 * cy + 1];
  const visited = Array.from({ length: ch }, () => new Array(cw).fill(false));
  const stack = [[0, 0]]; visited[0][0] = true; { const [sx, sy] = cellTile(0, 0); g[sy][sx] = FLOOR; }
  const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  while (stack.length) {
    const [cx, cy] = stack[stack.length - 1];
    const nb = [];
    for (const [dx, dy] of dirs) { const nx = cx + dx, ny = cy + dy; if (nx >= 0 && ny >= 0 && nx < cw && ny < ch && !visited[ny][nx]) nb.push([nx, ny, dx, dy]); }
    if (!nb.length) { stack.pop(); continue; }
    const [nx, ny, dx, dy] = nb[Math.floor(Math.random() * nb.length)];
    visited[ny][nx] = true;
    const [px, py] = cellTile(cx, cy); g[py + dy][px + dx] = FLOOR; // knock the wall between
    const [qx, qy] = cellTile(nx, ny); g[qy][qx] = FLOOR;
    stack.push([nx, ny]);
  }
  // Add loops (more interesting + fairer for 2 players): open a few interior walls
  // that sit between two floor tiles.
  let added = 0, tries = 0, want = Math.floor(cw * ch * 0.14);
  while (added < want && tries < want * 30) {
    tries++;
    const x = 1 + Math.floor(Math.random() * (GW - 2)), y = 1 + Math.floor(Math.random() * (GH - 2));
    if (g[y][x] !== WALL) continue;
    if ((g[y][x - 1] === FLOOR && g[y][x + 1] === FLOOR) || (g[y - 1][x] === FLOOR && g[y + 1][x] === FLOOR)) { g[y][x] = FLOOR; added++; }
  }
  return { g, GW, GH, cw, ch, cellTile };
}

// ---------- pair-set loading ----------
async function loadSets() {
  try { const res = await fetch('quiz/pairs'); const data = await res.json(); MZ.sets = data.sets || []; MZ.subjects = data.subjects || []; }
  catch { MZ.sets = []; MZ.subjects = []; }
  renderSubjectChips();
  if (!MZ.sets.length) {
    $('subject-chips').innerHTML = '<span class="empty" style="padding:6px">No questions found. Is the quiz project next to this one?</span>';
    $('start-btn').disabled = true; $('start-btn').style.opacity = '0.5';
  }
}
function renderSubjectChips() {
  const wrap = $('subject-chips'); wrap.innerHTML = '';
  const mk = (label, value) => { const c = document.createElement('div'); c.className = 'opt' + (MZ.opts.subject === value ? ' on' : ''); c.textContent = label; c.onclick = () => { MZ.opts.subject = value; renderSubjectChips(); }; wrap.appendChild(c); };
  mk('🎲 All', null); MZ.subjects.forEach((s) => mk(s, s));
}
// Prefer sets whose text fits a maze tile (short), with the right pair count.
function pickSet(maxPairs) {
  let pool = MZ.sets.filter((s) => !MZ.opts.subject || s.subject === MZ.opts.subject);
  if (!pool.length) pool = MZ.sets;
  const maxLen = (s) => Math.max(...s.pairs.flatMap((p) => [pairText(p.left).length, pairText(p.right).length]));
  pool = pool.filter((s) => s.pairs.length >= 3).sort((a, b) => maxLen(a) - maxLen(b));
  const short = pool.slice(0, Math.max(4, Math.ceil(pool.length * 0.5)));
  const set = (short.length ? short : pool)[Math.floor(Math.random() * (short.length ? short.length : pool.length))] || MZ.sets[0];
  return { prompt: set.prompt, pairs: set.pairs.slice(0, maxPairs) };
}

// ---------- build a level ----------
function buildLevel() {
  const { cw, ch } = SIZES[MZ.opts.size];
  const maze = genMaze(cw, ch);
  const twoP = MZ.opts.players === 2;
  const set = pickSet(twoP ? 4 : 5);
  const nPairs = set.pairs.length;

  // all interior cell tiles (the (odd,odd) positions)
  const cells = [];
  for (let cy = 0; cy < ch; cy++) for (let cx = 0; cx < cw; cx++) cells.push(maze.cellTile(cx, cy));

  // player starts + exits at far corners
  const starts = [maze.cellTile(0, 0), maze.cellTile(cw - 1, 0)];
  const exits = [maze.cellTile(cw - 1, ch - 1), maze.cellTile(0, ch - 1)];

  const reserved = new Set();
  const np = twoP ? 2 : 1;
  for (let i = 0; i < np; i++) { reserved.add(key2(...starts[i])); reserved.add(key2(...exits[i])); }

  // Short LABELS shown in the maze boxes (full text goes in the legend below).
  // Questions (left) get letters A,B,C…; answers (right) get numbers 1,2,3….
  // The letters/numbers are SHUFFLED vs pair order so the player must read the
  // legend and reason out which question pairs with which answer.
  const letters = shuffle(set.pairs.map((_, i) => String.fromCharCode(65 + i)));
  const numbers = shuffle(set.pairs.map((_, i) => String(i + 1)));
  const labelOf = (pid, side) => (side === 'left' ? letters[pid] : numbers[pid]);

  const free = shuffle(cells.filter((c) => !reserved.has(key2(...c))));
  const items = [];
  let fi = 0;
  for (let owner = 0; owner < np; owner++) {
    set.pairs.forEach((p, pid) => {
      for (const side of ['left', 'right']) {
        const cell = free[fi++ % free.length];
        const it = { x: cell[0], y: cell[1], ox: cell[0], oy: cell[1], owner, pairId: pid, side, label: labelOf(pid, side), text: pairText(side === 'left' ? p.left : p.right), matched: false, carried: false };
        items.push(it);
        reserved.add(key2(cell[0], cell[1]));
      }
    });
  }
  // legend entries (shared across players — same content), sorted by label
  const legendLeft = set.pairs.map((p, i) => ({ key: 'L' + i, label: letters[i], text: pairText(p.left), pairId: i, side: 'left' })).sort((a, b) => a.label.localeCompare(b.label));
  const legendRight = set.pairs.map((p, i) => ({ key: 'R' + i, label: numbers[i], text: pairText(p.right), pairId: i, side: 'right' })).sort((a, b) => (+a.label) - (+b.label));

  // players
  const players = [];
  for (let i = 0; i < np; i++) {
    players.push({ i, x: starts[i][0], y: starts[i][1], vx: starts[i][0], vy: starts[i][1], sx: starts[i][0], sy: starts[i][1], carrying: null, matched: 0, total: nPairs, moveCd: 0, stun: 0, color: P_COLORS[i], exit: { x: exits[i][0], y: exits[i][1] }, done: false });
  }

  // guards + doors (traps)
  const guards = [], doors = [];
  if (MZ.opts.traps) {
    const guardFloors = shuffle(cells.filter((c) => { const k = key2(...c); return !reserved.has(k) && !players.some((p) => Math.abs(p.x - c[0]) + Math.abs(p.y - c[1]) < 4); }));
    const nGuards = MZ.opts.size === 'small' ? 1 : MZ.opts.size === 'medium' ? 2 : 3;
    for (let i = 0; i < nGuards && i < guardFloors.length; i++) { const c = guardFloors[i]; guards.push({ x: c[0], y: c[1], vx: c[0], vy: c[1], dir: ['up', 'down', 'left', 'right'][Math.floor(Math.random() * 4)] }); }
    // moving doors: pick a few "passage" wall-gaps (even-row/odd-col or odd-row/even-col floors)
    const passages = [];
    for (let y = 1; y < maze.GH - 1; y++) for (let x = 1; x < maze.GW - 1; x++) {
      if (maze.g[y][x] !== FLOOR) continue;
      const isPassage = (x % 2 === 0 && y % 2 === 1) || (x % 2 === 1 && y % 2 === 0);
      if (isPassage) passages.push([x, y]);
    }
    shuffle(passages).slice(0, MZ.opts.size === 'small' ? 2 : 3).forEach(([x, y], i) => doors.push({ x, y, open: i % 2 === 0, phase: i }));
  }

  // light switches (dark mode): a few floor cells that permanently light a room
  const switches = [];
  const lit = new Set();
  if (MZ.opts.dark) {
    const swFloors = shuffle(cells.filter((c) => !reserved.has(key2(...c))));
    for (let i = 0; i < (MZ.opts.size === 'large' ? 4 : 3) && i < swFloors.length; i++) { const c = swFloors[i]; switches.push({ x: c[0], y: c[1], used: false }); }
  }

  MZ.state = {
    maze, players, items, guards, doors, switches, lit, set, nPairs, twoP,
    dark: MZ.opts.dark, traps: MZ.opts.traps, hidden: MZ.opts.hidden,
    legendLeft, legendRight, legendEls: null,
    visible: new Set(), startTime: performance.now(), guardAcc: 0, doorAcc: 0, status: 'playing', winner: null, msg: '',
    fx: [], // transient pixel sparkles (pickup/match bursts)
  };
  recomputeFog();
  computeTileSize();
  layoutHud();
  buildLegendDom();
  updateControlsHint();
}

// ---------- geometry / fog ----------
function computeTileSize() {
  const st = MZ.state; const target = Math.min((window.innerWidth || 800) - 28, 700);
  // Each tile is TP "art pixels" upscaled by an INTEGER factor (nearest-neighbour)
  // so every pixel is a uniform chunky block — true pixel-art look.
  const scale = Math.max(2, Math.min(5, Math.round((target / st.maze.GW) / TP)));
  st.ts = TP * scale;
  const cv = $('maze-canvas'); cv.width = st.maze.GW * st.ts; cv.height = st.maze.GH * st.ts;
  st.bg = null; st.low = null; // re-bake at the new size
}
function passable(x, y) {
  const st = MZ.state, m = st.maze;
  if (x < 0 || y < 0 || x >= m.GW || y >= m.GH) return false;
  if (m.g[y][x] !== FLOOR) return false;
  const d = st.doors.find((dd) => dd.x === x && dd.y === y);
  if (d && !d.open) return false;
  return true;
}
// Fog: BFS through passable tiles from each (active) player up to a depth, plus
// the immediate walls bounding visible floor, plus permanently-lit rooms.
function recomputeFog() {
  const st = MZ.state; if (!st.dark) return;
  const vis = new Set(); const R = 4;
  for (const p of st.players) {
    if (p.done) continue;
    const q = [[p.x, p.y, 0]]; const seen = new Set([key2(p.x, p.y)]);
    while (q.length) {
      const [x, y, dpt] = q.shift(); vis.add(key2(x, y));
      // reveal adjacent walls so corridors are framed
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) vis.add(key2(x + dx, y + dy));
      if (dpt >= R) continue;
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const nx = x + dx, ny = y + dy, k = key2(nx, ny);
        if (!seen.has(k) && passable(nx, ny)) { seen.add(k); q.push([nx, ny, dpt + 1]); }
      }
    }
  }
  st.visible = vis;
}
function visibleAt(x, y) { const st = MZ.state; if (!st.dark) return true; return st.visible.has(key2(x, y)) || st.lit.has(key2(x, y)); }
// Hidden-pairs mode: a piece shows its text only while a player stands on it or
// during a brief peek after stepping on it; otherwise it's face-down ("?").
function itemRevealed(it) {
  const st = MZ.state;
  if (!st.hidden || it.carried || it.matched) return true;
  if (st.players.some((p) => p.x === it.x && p.y === it.y)) return true;
  return !!(it.revealUntil && performance.now() < it.revealUntil);
}

// ---------- actions ----------
// Walking onto a tile NO LONGER picks up / matches — that's a deliberate action
// now (see doAction). On-step we only: trip light switches, peek a piece's text in
// hidden mode (so you can decide whether to grab it), and reach the exit.
function onEnter(p) {
  const st = MZ.state;
  const sw = st.switches.find((s) => !s.used && s.x === p.x && s.y === p.y);
  if (sw) { sw.used = true; lightRoom(sw.x, sw.y); Sound.play('door', 0.5); flash('💡 Lights on!'); }
  if (st.hidden) {
    const here = st.items.find((it) => !it.matched && !it.carried && it.x === p.x && it.y === p.y && it.owner === p.i);
    if (here) here.revealUntil = performance.now() + 1400; // peek so you can see it before grabbing
  }
  if (p.matched === p.total && p.x === p.exit.x && p.y === p.exit.y && !p.done) finishPlayer(p);
}

// A little burst of pixel sparkles at a tile (pickup = cool blue, match = gold).
function sparkle(x, y, cols, n = 12) {
  const st = MZ.state; if (!st || !st.fx) return;
  const cx = x * TP + TP / 2, cy = y * TP + TP / 2, now = performance.now();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.6;
    const r = TP * (0.5 + Math.random() * 0.9);
    st.fx.push({ x: cx, y: cy, dx: Math.cos(a) * r, dy: Math.sin(a) * r * 0.8, col: cols[i % cols.length], t0: now, life: 380 + Math.random() * 240 });
  }
}

// Deliberate "interact" — pick up a piece, match it on its partner, or drop it.
function doAction(pi) {
  const st = MZ.state; if (!st || st.status !== 'playing') return;
  const p = (typeof pi === 'number') ? st.players[pi] : pi; if (!p || p.done || p.stun > 0) return;
  const here = st.items.find((it) => !it.matched && !it.carried && it.x === p.x && it.y === p.y && it.owner === p.i);
  if (!p.carrying) {
    if (here) { p.carrying = here; here.carried = true; Sound.play('pickup', 0.85); popupPickup(p, here); sparkle(p.x, p.y, ['#9fd4ff', '#e6f4ff', '#5b8cff']); }
  } else if (here) {
    if (here.pairId === p.carrying.pairId && here.side !== p.carrying.side) {
      const a = p.carrying, b = here;
      a.matched = true; b.matched = true; p.carrying = null; p.matched++;
      Sound.play('match', 0.9); popupMatch(p, a, b);
      sparkle(p.x, p.y, ['#ffe066', '#fff7c0', '#7bf59b'], 18);
      if (p.matched === p.total) flash('🚪 All matched — race to the exit!');
    } else { // not the partner
      Sound.play('wrong', 0.4); flash(`❌ ${here.label} doesn't go with ${p.carrying.label}`);
      if (st.hidden) here.revealUntil = performance.now() + 1400;
    }
  } else { dropItem(p); flash('👇 Dropped the piece'); }
}
function lightRoom(x, y) {
  const st = MZ.state; const q = [[x, y, 0]]; const seen = new Set([key2(x, y)]);
  while (q.length) { const [cx, cy, d] = q.shift(); st.lit.add(key2(cx, cy)); for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) { st.lit.add(key2(cx + dx, cy + dy)); if (d < 3) { const nx = cx + dx, ny = cy + dy, k = key2(nx, ny); if (!seen.has(k) && passable(nx, ny)) { seen.add(k); q.push([nx, ny, d + 1]); } } } }
}
function dropItem(p) {
  const st = MZ.state; if (!p.carrying) return;
  if (st.items.some((it) => !it.matched && !it.carried && it.x === p.x && it.y === p.y)) return; // tile occupied
  const it = p.carrying; it.carried = false; it.x = p.x; it.y = p.y; it.revealUntil = performance.now() + 1100; p.carrying = null; Sound.play('drop', 0.4);
}
function finishPlayer(p) {
  p.done = true; const st = MZ.state;
  if (st.status === 'playing') { st.status = 'over'; st.winner = p.i; Sound.play('win', 0.85); showWin(p); }
}
function move(pi, dir) {
  const st = MZ.state; if (!st || st.status !== 'playing') return false;
  const p = st.players[pi]; if (!p || p.done || p.stun > 0) return false;
  const [dx, dy] = DIRV[dir]; const nx = p.x + dx, ny = p.y + dy;
  if (!passable(nx, ny)) return false;
  p.x = nx; p.y = ny; onEnter(p); if (st.dark) recomputeFog();
  return true;
}
// test/teleport helper
function teleport(pi, x, y) { const p = MZ.state.players[pi]; p.x = x; p.y = y; p.vx = x; p.vy = y; onEnter(p); if (MZ.state.dark) recomputeFog(); }

// ---------- guards & doors ----------
function stepGuards() {
  const st = MZ.state;
  for (const g of st.guards) {
    const opts = ['up', 'down', 'left', 'right'].filter((d) => { const [dx, dy] = DIRV[d]; return passable(g.x + dx, g.y + dy); });
    if (!opts.length) continue;
    const rev = { up: 'down', down: 'up', left: 'right', right: 'left' }[g.dir];
    let choice;
    const fwd = opts.includes(g.dir);
    if (fwd && Math.random() < 0.7) choice = g.dir;
    else { const noRev = opts.filter((d) => d !== rev); choice = (noRev.length ? noRev : opts)[Math.floor(Math.random() * (noRev.length ? noRev.length : opts.length))]; }
    g.dir = choice; const [dx, dy] = DIRV[choice]; g.x += dx; g.y += dy;
  }
  checkGuardCatch();
}
function checkGuardCatch() {
  const st = MZ.state;
  for (const p of st.players) {
    if (p.done || p.stun > 0) continue;
    if (st.guards.some((g) => g.x === p.x && g.y === p.y)) {
      // caught: drop carried back to its spot, send player home, brief stun
      if (p.carrying) { const it = p.carrying; it.carried = false; it.x = it.ox; it.y = it.oy; p.carrying = null; }
      p.x = p.sx; p.y = p.sy; p.vx = p.sx; p.vy = p.sy; p.stun = 700; Sound.play('caught', 0.6); flash('👻 Caught! Back to start.');
      if (st.dark) recomputeFog();
    }
  }
}
function stepDoors() { const st = MZ.state; for (const d of st.doors) { d.open = !d.open; } if (st.dark) recomputeFog(); }

// ---------- render: a procedural PIXEL-ART DUNGEON ----------
function drawWrappedText(ctx, text, cx, cy, maxW, maxH, color) {
  let font = Math.min(15, Math.max(8, Math.floor(maxW / 4)));
  for (; font >= 7; font--) {
    ctx.font = `700 ${font}px 'Segoe UI', system-ui, Arial`;
    const words = String(text).split(/\s+/); const lines = []; let line = '';
    for (const w of words) { const t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; }
    if (line) lines.push(line);
    if (lines.length * (font + 2) <= maxH && lines.every((l) => ctx.measureText(l).width <= maxW)) {
      const total = lines.length * (font + 2); let y = cy - total / 2 + font / 2 + 1;
      ctx.fillStyle = color || '#3c2a14'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const l of lines) { ctx.fillText(l, cx, y); y += font + 2; }
      return;
    }
  }
}
// deterministic per-tile pseudo-random so the stone texture is stable per level
function hash2(x, y) { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >> 13)) * 1274126177 | 0; h = h ^ (h >> 16); return ((h >>> 0) % 1000) / 1000; }
function lighten(hex, a) { const n = parseInt(hex.slice(1), 16); const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255; return `rgb(${Math.round(r + (255 - r) * a)},${Math.round(g + (255 - g) * a)},${Math.round(b + (255 - b) * a)})`; }
const TP = 12; // "art pixels" per tile in the low-res buffer (upscaled nearest-neighbour → chunky pixels)
const DUN = {
  floor: ['#6a6d7d', '#63667a', '#727589', '#5d6072'], grout: '#3a3c4b',
  wall: ['#332f49', '#3a3554', '#2d2941'], wallTop: '#4c4769', wallBot: '#1d1a2c', mortar: '#221f31', moss: '#557a3c',
};
// 8x8 pixel sprites ('.' = transparent)
const SPR_GHOST = ['..WWWW..', '.WWWWWW.', 'WWWWWWWW', 'WeeWWeeW', 'WeeWWeeW', 'WWWWWWWW', 'WWWWWWWW', 'W.WW.WW.'];
const GHOST_PAL = { W: '#e9f6ff', e: '#39306b' };
const SPR_HERO = ['..KKKK..', '.KHHHHK.', 'KCCCCCCK', 'KCWCCWCK', 'KCCCCCCK', 'KCCCCCCK', '.KCCCCK.', '..KKKK..'];
function drawBitmap(c, rows, pal, X, Y) { for (let j = 0; j < rows.length; j++) { const row = rows[j]; for (let i = 0; i < row.length; i++) { const ch = row[i]; if (ch === '.') continue; c.fillStyle = pal[ch]; c.fillRect(X + i, Y + j, 1, 1); } } }

// Bake the static dungeon into a LOW-RES offscreen canvas (TP px per tile), once
// per level. Everything here is drawn in art-pixel units, then upscaled in render.
function buildBackdrop() {
  const st = MZ.state, m = st.maze, GW = m.GW, GH = m.GH;
  const bg = document.createElement('canvas'); bg.width = GW * TP; bg.height = GH * TP;
  const c = bg.getContext('2d'); c.imageSmoothingEnabled = false;
  const rect = (x, y, w, h, col) => { c.fillStyle = col; c.fillRect(x | 0, y | 0, w | 0, h | 0); };
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const X = x * TP, Y = y * TP, h = hash2(x, y);
    if (m.g[y][x] === FLOOR) {
      rect(X, Y, TP, TP, DUN.floor[(h * 4) | 0]);
      rect(X, Y, TP, 1, 'rgba(255,255,255,0.06)'); rect(X, Y, 1, TP, 'rgba(255,255,255,0.05)'); // bevel
      rect(X, Y + TP - 1, TP, 1, DUN.grout); rect(X + TP - 1, Y, 1, TP, DUN.grout);             // grout seams
      const n = 1 + ((h * 3) | 0);
      for (let i = 0; i < n; i++) { const hx = hash2(x * 7 + i, y * 13 + 1), hy = hash2(x * 5 + 3, y * 11 + i); rect(X + 1 + (hx * (TP - 3) | 0), Y + 1 + (hy * (TP - 3) | 0), 1, 1, i % 2 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.13)'); }
    } else {
      rect(X, Y, TP, TP, DUN.wall[(h * 3) | 0]);
      const mid = (TP / 2) | 0; rect(X, Y + mid, TP, 1, DUN.mortar); // running-bond mortar
      const off = (y % 2) ? mid : 0; rect(X + off, Y, 1, mid, DUN.mortar); rect(X + ((off + mid) % TP), Y + mid, 1, TP - mid, DUN.mortar);
      rect(X, Y, TP, 1, DUN.wallTop); rect(X, Y + TP - 1, TP, 1, DUN.wallBot);                  // top light / base shadow
      if (h < 0.14) for (let i = 0; i < 3; i++) rect(X + (hash2(x + i, y) * (TP - 1) | 0), Y + TP - 2 - (hash2(x, y + i) * 2 | 0), 1, 1, DUN.moss);
    }
  }
  // wall torches with a baked warm glow
  let torches = 0, capT = m.cw <= 6 ? 5 : m.cw <= 7 ? 7 : 9;
  for (let y = 1; y < GH - 1 && torches < capT; y++) for (let x = 1; x < GW - 1 && torches < capT; x++) {
    if (m.g[y][x] !== WALL || !(m.g[y + 1] && m.g[y + 1][x] === FLOOR)) continue;
    if (hash2(x * 3 + 1, y * 9 + 2) > 0.16) continue;
    const X = x * TP, Y = y * TP, cx = X + (TP / 2 | 0);
    rect(cx, Y + (TP * 0.5 | 0), 1, (TP * 0.34) | 0, '#5a3a1c');                       // stick
    rect(cx - 1, Y + (TP * 0.4 | 0), 3, 2, '#ff7a18'); rect(cx, Y + (TP * 0.3 | 0), 1, 2, '#ffd23f'); // flame
    c.save(); c.globalCompositeOperation = 'lighter';
    const g = c.createRadialGradient(cx, Y + TP * 0.45, 1, cx, Y + TP * 0.6, TP * 1.7);
    g.addColorStop(0, 'rgba(255,170,70,0.5)'); g.addColorStop(1, 'rgba(255,170,70,0)');
    c.fillStyle = g; c.fillRect(X - TP * 1.5, Y - TP * 0.5, TP * 3, TP * 3); c.restore();
    torches++;
  }
  const vg = c.createRadialGradient(bg.width / 2, bg.height / 2, bg.height * 0.25, bg.width / 2, bg.height / 2, bg.height * 0.72);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(8,6,16,0.5)');
  c.fillStyle = vg; c.fillRect(0, 0, bg.width, bg.height);
  st.bg = bg;
}

// low-res entity drawers (all in TP art-pixel units, onto the low buffer)
function drawScrollLow(c, X, Y, owner, faceDown) {
  const col = P_COLORS[owner];
  if (faceDown) { // carved rune stone (the "?" is drawn crisp later)
    c.fillStyle = '#2b2840'; c.fillRect(X + 1, Y + 1, TP - 2, TP - 2);
    c.fillStyle = '#3a3656'; c.fillRect(X + 1, Y + 1, TP - 2, 1); c.fillStyle = '#1b1828'; c.fillRect(X + 1, Y + TP - 2, TP - 2, 1);
    c.fillStyle = col.edge; c.fillRect(X + 1, Y + 1, TP - 2, 1); c.fillRect(X + 1, Y + TP - 2, TP - 2, 1); c.fillRect(X + 1, Y + 1, 1, TP - 2); c.fillRect(X + TP - 2, Y + 1, 1, TP - 2);
    return;
  }
  c.fillStyle = '#ecd9a4'; c.fillRect(X + 1, Y + 2, TP - 2, TP - 4);                 // parchment
  c.fillStyle = '#d9c184'; c.fillRect(X + 1, Y + 1, TP - 2, 2); c.fillRect(X + 1, Y + TP - 3, TP - 2, 2); // rolled bands
  c.fillStyle = col.edge; c.fillRect(X + 1, Y + 2, 1, TP - 4); c.fillRect(X + TP - 2, Y + 2, 1, TP - 4);  // owner frame
}
function drawExitLow(c, X, Y, open) {
  const x = X + 2, y = Y + 1, w = TP - 4, h = TP - 2;
  c.fillStyle = open ? '#3a2a16' : '#5b3b20'; c.fillRect(x, y, w, h);
  c.fillStyle = open ? '#241a0d' : '#6e4a28'; c.fillRect(x + (w / 3 | 0), y, 1, h); c.fillRect(x + (2 * w / 3 | 0), y, 1, h); // planks
  c.fillStyle = '#8a8a98'; c.fillRect(x, y + (h * 0.2 | 0), w, 1); c.fillRect(x, y + (h * 0.74 | 0), w, 1);                   // iron bands
  if (open) {
    c.fillStyle = '#0b0a14'; c.fillRect(x + (w / 2 | 0), y + 1, (w / 2 | 0), h - 2);
    c.save(); c.globalCompositeOperation = 'lighter'; const g = c.createRadialGradient(X + TP / 2, Y + TP / 2, 1, X + TP / 2, Y + TP / 2, TP); g.addColorStop(0, 'rgba(120,255,170,0.55)'); g.addColorStop(1, 'rgba(120,255,170,0)'); c.fillStyle = g; c.fillRect(X - TP / 2, Y - TP / 2, TP * 2, TP * 2); c.restore();
  } else { c.fillStyle = '#caa14a'; c.fillRect(x + w - 3, y + (h / 2 | 0), 1, 1); } // handle (lock icon drawn crisp later)
}
function drawPortcullisLow(c, X, Y, open) {
  if (open) { c.fillStyle = '#9a9aa8'; for (let i = 0; i < 3; i++) c.fillRect(X + 3 + i * 3, Y + 1, 1, 2); return; } // raised bars
  c.fillStyle = 'rgba(10,8,18,0.45)'; c.fillRect(X, Y, TP, TP);
  c.fillStyle = '#9a9aa8'; for (let i = 0; i < 4; i++) c.fillRect(X + 2 + i * 2, Y + 1, 1, TP - 2);
  c.fillRect(X + 1, Y + (TP * 0.32 | 0), TP - 2, 1); c.fillRect(X + 1, Y + (TP * 0.66 | 0), TP - 2, 1);
}
function drawSwitchLow(c, X, Y) {
  const cx = X + (TP / 2 | 0); c.fillStyle = '#5a3a1c'; c.fillRect(cx, Y + (TP * 0.42 | 0), 1, (TP * 0.36) | 0);
  c.fillStyle = '#caa14a'; c.fillRect(cx - 1, Y + (TP * 0.34 | 0), 3, 2); c.fillStyle = '#fff7c0'; c.fillRect(cx, Y + (TP * 0.28 | 0), 1, 1);
}
function drawHeroLow(c, p) {
  // draw at the SMOOTH visual position (vx/vy glide toward the grid tile)
  const gx = (p.vx != null ? p.vx : p.x) * TP, gy = (p.vy != null ? p.vy : p.y) * TP;
  const X = Math.round(gx) + 2, Y = Math.round(gy) + 2, col = p.color;
  drawBitmap(c, SPR_HERO, { K: col.edge, C: col.body, H: lighten(col.body, 0.45), W: '#ffffff' }, X, Y);
  if (p.carrying) { c.fillStyle = '#ecd9a4'; c.fillRect(X + TP - 6, Y - 1, 2, 2); c.fillStyle = '#caa14a'; c.fillRect(X + TP - 6, Y - 1, 2, 1); }
  if (p.stun > 0) { c.fillStyle = '#ffe680'; c.fillRect(X + 1, Y - 1, 1, 1); c.fillRect(X + TP - 6, Y, 1, 1); }
}

function render() {
  const st = MZ.state; if (!st) return;
  const cv = $('maze-canvas'), ctx = cv.getContext('2d'), m = st.maze, ts = st.ts;
  if (!st.bg) buildBackdrop();
  if (!st.low) { st.low = document.createElement('canvas'); st.low.width = m.GW * TP; st.low.height = m.GH * TP; }
  const lc = st.low.getContext('2d'); lc.imageSmoothingEnabled = false;

  // --- compose the whole frame at LOW resolution (TP px / tile) ---
  lc.clearRect(0, 0, st.low.width, st.low.height);
  lc.drawImage(st.bg, 0, 0);
  for (const p of st.players) drawExitLow(lc, p.exit.x * TP, p.exit.y * TP, p.matched === p.total);
  for (const d of st.doors) drawPortcullisLow(lc, d.x * TP, d.y * TP, d.open);
  for (const s of st.switches) if (!s.used) drawSwitchLow(lc, s.x * TP, s.y * TP);
  for (const it of st.items) if (!it.matched && !it.carried) drawScrollLow(lc, it.x * TP, it.y * TP, it.owner, !itemRevealed(it));
  for (const g of st.guards) drawBitmap(lc, SPR_GHOST, GHOST_PAL, Math.round((g.vx != null ? g.vx : g.x) * TP) + 2, Math.round((g.vy != null ? g.vy : g.y) * TP) + 2);
  for (const p of st.players) if (!p.done) drawHeroLow(lc, p);
  // transient pixel sparkles (pickup/match): tiny plus-shapes flying out and fading
  if (st.fx && st.fx.length) {
    const now = performance.now();
    for (let i = st.fx.length - 1; i >= 0; i--) {
      const f = st.fx[i]; const t = (now - f.t0) / f.life;
      if (t >= 1) { st.fx.splice(i, 1); continue; }
      const px = Math.round(f.x + f.dx * t), py = Math.round(f.y + f.dy * t - 3 * Math.sin(Math.PI * t));
      lc.fillStyle = f.col; lc.globalAlpha = 1 - t;
      lc.fillRect(px, py, 1, 1);
      if (t < 0.5) { lc.fillRect(px - 1, py, 1, 1); lc.fillRect(px + 1, py, 1, 1); lc.fillRect(px, py - 1, 1, 1); lc.fillRect(px, py + 1, 1, 1); }
    }
    lc.globalAlpha = 1;
  }
  if (st.dark) {
    for (let y = 0; y < m.GH; y++) for (let x = 0; x < m.GW; x++) {
      if (!visibleAt(x, y)) { lc.fillStyle = '#0b0913'; lc.fillRect(x * TP, y * TP, TP, TP); }
      else if (!st.visible.has(key2(x, y)) && st.lit.has(key2(x, y))) { lc.fillStyle = 'rgba(11,9,19,0.45)'; lc.fillRect(x * TP, y * TP, TP, TP); }
    }
    lc.save(); lc.globalCompositeOperation = 'lighter';
    for (const p of st.players) { if (p.done) continue; const cx = (p.vx != null ? p.vx : p.x) * TP + TP / 2, cy = (p.vy != null ? p.vy : p.y) * TP + TP / 2; const g = lc.createRadialGradient(cx, cy, 1, cx, cy, TP * 2.6); g.addColorStop(0, 'rgba(255,160,60,0.22)'); g.addColorStop(1, 'rgba(255,160,60,0)'); lc.fillStyle = g; lc.fillRect(cx - TP * 2.6, cy - TP * 2.6, TP * 5.2, TP * 5.2); }
    lc.restore();
  }

  // --- upscale with NEAREST-NEIGHBOUR → chunky pixels ---
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.drawImage(st.low, 0, 0, st.low.width, st.low.height, 0, 0, cv.width, cv.height);

  // --- crisp label pass: a single big A/B/1/2 per box (full text is in the legend) ---
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const it of st.items) {
    if (it.matched || it.carried || !visibleAt(it.x, it.y)) continue;
    const X = it.x * ts, Y = it.y * ts;
    if (itemRevealed(it)) {
      ctx.font = `800 ${Math.floor(ts * 0.5)}px 'Segoe UI', system-ui, Arial`; ctx.fillStyle = '#3a2a12';
      ctx.fillText(it.label, X + ts / 2, Y + ts / 2 + 1);
    } else {
      ctx.save(); ctx.shadowColor = P_COLORS[it.owner].body; ctx.shadowBlur = 6; ctx.fillStyle = P_COLORS[it.owner].soft;
      ctx.font = `700 ${Math.floor(ts * 0.46)}px 'Segoe UI', system-ui, Arial`; ctx.fillText('?', X + ts / 2, Y + ts / 2 + 1); ctx.restore();
    }
  }
  for (const p of st.players) { if (p.matched < p.total && visibleAt(p.exit.x, p.exit.y)) { const X = p.exit.x * ts, Y = p.exit.y * ts; ctx.font = `${Math.floor(ts * 0.3)}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('🔒', X + ts / 2, Y + ts * 0.52); } }
  updateHud();
}
function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

// ---------- HUD ----------
function layoutHud() {
  const st = MZ.state; const hud = $('hud'); hud.innerHTML = '';
  st.players.forEach((p, i) => {
    const box = document.createElement('div'); box.className = 'pbox p' + (i + 1); box.id = 'pbox-' + i;
    box.innerHTML = `<div class="pname">${st.twoP ? (i === 0 ? '🔵 Player 1' : '🔴 Player 2') : '🔵 You'}</div>
      <div class="pcarry" id="carry-${i}"></div>
      <div class="pscore">Matched <b id="m-${i}">0</b>/${p.total}</div>`;
    hud.appendChild(box);
  });
}
function updateHud() {
  const st = MZ.state;
  st.players.forEach((p, i) => {
    const c = $('carry-' + i);
    if (c) c.innerHTML = p.carrying ? (`✋ <b>${escapeText(p.carrying.label)}</b> — ${escapeText(p.carrying.text)}`) : '<span class="empty-h">empty-handed</span>';
    const m = $('m-' + i); if (m) m.textContent = p.matched;
  });
  updateLegend();
}

// The legend below the maze: maps each box's label (A/B… questions, 1/2… answers)
// to its full text, so the boxes can stay tiny. Built once per level; updated
// each frame to grey out matched pairs and (in Hidden mode) mask undiscovered text.
function buildLegendDom() {
  const st = MZ.state, host = $('legend'); if (!host) return;
  host.innerHTML = ''; st.legendEls = new Map();
  const col = (cls, head, rows) => {
    const c = document.createElement('div'); c.className = 'leg-col ' + cls;
    const h = document.createElement('div'); h.className = 'leg-h'; h.textContent = head; c.appendChild(h);
    rows.forEach((e) => {
      const row = document.createElement('div'); row.className = 'leg-row'; row.dataset.key = e.key;
      const lab = document.createElement('span'); lab.className = 'leg-lab'; lab.textContent = e.label;
      const txt = document.createElement('span'); txt.className = 'leg-txt'; txt.textContent = e.text;
      row.appendChild(lab); row.appendChild(txt); c.appendChild(row);
      st.legendEls.set(e.key, { row, txt, entry: e });
    });
    return c;
  };
  host.appendChild(col('leg-q', '❓ Questions', st.legendLeft));
  host.appendChild(col('leg-a', '✅ Answers', st.legendRight));
}
function updateLegend() {
  const st = MZ.state; if (!st.legendEls) return;
  const matched = new Set(st.items.filter((it) => it.matched).map((it) => it.pairId + ':' + it.side));
  const discovered = (e) => st.items.some((it) => it.pairId === e.pairId && it.side === e.side && (it.matched || it.carried || itemRevealed(it)));
  st.legendEls.forEach(({ row, txt, entry }) => {
    const done = matched.has(entry.pairId + ':' + entry.side);
    row.classList.toggle('done', done);
    if (st.hidden && !done && !discovered(entry)) { txt.textContent = '❓ ❓ ❓'; txt.classList.add('hidden-q'); }
    else { txt.textContent = entry.text; txt.classList.remove('hidden-q'); }
  });
}
function escapeText(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
function flash(text) { const st = MZ.state; if (st) st.msg = text; const el = $('msg'); if (el) el.textContent = text; }

// pop-up panel announcing a pick-up / match — auto-hides after 4 seconds
let _popupTimer = null;
function showMazePopup(html, kind) {
  const el = $('maze-popup'); if (!el) return;
  el.innerHTML = html;
  el.classList.remove('pickup', 'match'); if (kind) el.classList.add(kind);
  el.classList.add('show');
  if (_popupTimer) clearTimeout(_popupTimer);
  _popupTimer = setTimeout(() => el.classList.remove('show'), 4000);
}
function hideMazePopup() { const el = $('maze-popup'); if (el) el.classList.remove('show'); if (_popupTimer) { clearTimeout(_popupTimer); _popupTimer = null; } }
function popupPickup(p, it) {
  const who = MZ.state.twoP ? `Player ${p.i + 1} ` : '';
  showMazePopup(`<div class="mp-title">✋ ${who}picked up <span class="mp-badge">${escapeText(it.label)}</span></div><div class="mp-text">“${escapeText(it.text)}”</div>`, 'pickup');
}
function popupMatch(p, a, b) {
  const who = MZ.state.twoP ? `Player ${p.i + 1} ` : '';
  const L = a.side === 'left' ? a : b, R = a.side === 'left' ? b : a; // show question → answer
  showMazePopup(`<div class="mp-title">✅ ${who}matched <span class="mp-badge">${escapeText(a.label)}</span> + <span class="mp-badge">${escapeText(b.label)}</span>!</div><div class="mp-text">“${escapeText(L.text)}” → “${escapeText(R.text)}”</div><div class="mp-prog">${p.matched}/${p.total} pairs done</div>`, 'match');
}
function updateControlsHint() {
  const st = MZ.state;
  $('controls-hint').textContent = st.twoP
    ? '🔵 P1: Arrows to move · Space = pick up / match / drop   ·   🔴 P2: W A S D · Q = pick up / match / drop'
    : 'Move: Arrow keys or W A S D   ·   Space (or ✋): pick up · match · drop';
}

// ---------- win ----------
function showWin(p) {
  const st = MZ.state; const secs = Math.round((performance.now() - st.startTime) / 1000);
  $('win-title').textContent = st.twoP ? `${p.i === 0 ? '🔵 Player 1' : '🔴 Player 2'} wins!` : 'You escaped! 🎉';
  $('win-sub').textContent = st.twoP ? `First to match all ${p.total} pairs and reach the exit.` : `All ${p.total} pairs matched in ${secs}s. Great memory!`;
  $('win-overlay').style.display = 'flex';
}

// ---------- main loop ----------
let _last = 0;
function loop(t) {
  const st = MZ.state;
  if (st && st.status === 'playing') {
    const dt = Math.min(60, t - _last || 16);
    // held-key movement with per-player cooldown
    for (const p of st.players) {
      if (p.stun > 0) { p.stun -= dt; }
      p.moveCd -= dt;
      if (p.moveCd <= 0 && p.stun <= 0 && !p.done) {
        const dir = heldDir(p.i);
        if (dir && move(p.i, dir)) p.moveCd = 110;
      }
    }
    // guards
    if (st.guards.length) { st.guardAcc += dt; if (st.guardAcc >= 240) { st.guardAcc = 0; stepGuards(); } }
    // doors
    if (st.doors.length) { st.doorAcc += dt; if (st.doorAcc >= 2600) { st.doorAcc = 0; stepDoors(); } }
    // glide the visual positions toward the grid tiles (smooth movement)
    const k = 1 - Math.exp(-dt / 40);
    for (const p of st.players) {
      if (p.vx == null) { p.vx = p.x; p.vy = p.y; }
      p.vx += (p.x - p.vx) * k; p.vy += (p.y - p.vy) * k;
      if (Math.abs(p.x - p.vx) < 0.02) p.vx = p.x; if (Math.abs(p.y - p.vy) < 0.02) p.vy = p.y;
    }
    for (const g of st.guards) {
      if (g.vx == null) { g.vx = g.x; g.vy = g.y; }
      g.vx += (g.x - g.vx) * k * 0.7; g.vy += (g.y - g.vy) * k * 0.7; // ghosts drift a little slower
      if (Math.abs(g.x - g.vx) < 0.02) g.vx = g.x; if (Math.abs(g.y - g.vy) < 0.02) g.vy = g.y;
    }
    render();
  }
  _last = t;
  requestAnimationFrame(loop);
}

// ---------- input ----------
const keys = new Set();
const P1_MOVE = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
const P2_MOVE = { KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right' };
function heldDir(pi) {
  const map = pi === 0 ? P1_MOVE : P2_MOVE;
  for (const code of keys) if (map[code]) return map[code];
  return null;
}
window.addEventListener('keydown', (e) => {
  const st = MZ.state; if (!st || st.status !== 'playing' || $('game').style.display === 'none') return;
  if (P1_MOVE[e.code] || P2_MOVE[e.code] || e.code === 'Space') e.preventDefault();
  keys.add(e.code);
  if (e.code === 'Space') doAction(0);                    // pick up / match / drop
  if (e.code === 'KeyQ' && st.twoP) doAction(1);
});
window.addEventListener('keyup', (e) => keys.delete(e.code));

// touch dpad (player 1)
document.querySelectorAll('#dpad button').forEach((b) => {
  const dir = b.dataset.dir;
  const press = (on) => { if (dir === 'drop') { if (on && MZ.state) doAction(0); return; } const code = Object.keys(P1_MOVE).find((k) => P1_MOVE[k] === dir); if (on) keys.add(code); else keys.delete(code); };
  b.addEventListener('touchstart', (e) => { e.preventDefault(); press(true); }, { passive: false });
  b.addEventListener('touchend', (e) => { e.preventDefault(); press(false); }, { passive: false });
  b.addEventListener('mousedown', () => press(true)); b.addEventListener('mouseup', () => press(false)); b.addEventListener('mouseleave', () => press(false));
});

// canvas as a virtual joystick (tablets): DRAG in a direction to move player 1,
// quick TAP = the action (pick up / match / drop). Feeds the same `keys` set the keyboard uses.
(function () {
  const cv = $('maze-canvas'); if (!cv) return;
  let active = false, ox = 0, oy = 0, moved = false, startT = 0, cur = null;
  const setKey = (code) => { if (code === cur) return; if (cur) keys.delete(cur); cur = code; if (code) keys.add(code); };
  const dirKey = (dx, dy) => { const ax = Math.abs(dx), ay = Math.abs(dy); if (ax < 16 && ay < 16) return null; return ax > ay ? (dx > 0 ? 'ArrowRight' : 'ArrowLeft') : (dy > 0 ? 'ArrowDown' : 'ArrowUp'); };
  const start = (x, y) => { active = true; moved = false; ox = x; oy = y; startT = performance.now(); };
  const move = (x, y) => { if (!active) return; const dx = x - ox, dy = y - oy; if (Math.abs(dx) > 16 || Math.abs(dy) > 16) moved = true; setKey(dirKey(dx, dy)); };
  const end = () => { if (!active) return; active = false; setKey(null); if (!moved && performance.now() - startT < 350 && MZ.state) doAction(0); };
  cv.addEventListener('touchstart', (e) => { e.preventDefault(); const t = e.touches[0]; start(t.clientX, t.clientY); }, { passive: false });
  cv.addEventListener('touchmove', (e) => { e.preventDefault(); const t = e.touches[0]; move(t.clientX, t.clientY); }, { passive: false });
  cv.addEventListener('touchend', (e) => { e.preventDefault(); end(); }, { passive: false });
  cv.addEventListener('touchcancel', () => end(), { passive: false });
})();

// ---------- screens / wiring ----------
function setOpt(group, attr, val) { document.querySelectorAll(`#${group} .opt`).forEach((o) => o.classList.toggle('on', o.dataset[attr] === String(val))); }
$('opt-players').addEventListener('click', (e) => { const o = e.target.closest('.opt'); if (!o) return; MZ.opts.players = +o.dataset.players; setOpt('opt-players', 'players', MZ.opts.players); });
$('opt-size').addEventListener('click', (e) => { const o = e.target.closest('.opt'); if (!o) return; MZ.opts.size = o.dataset.size; setOpt('opt-size', 'size', MZ.opts.size); });
$('opt-twists').addEventListener('click', (e) => { const o = e.target.closest('.opt'); if (!o) return; const t = o.dataset.twist; if (t === 'dark') MZ.opts.dark = !MZ.opts.dark; if (t === 'traps') MZ.opts.traps = !MZ.opts.traps; if (t === 'hidden') MZ.opts.hidden = !MZ.opts.hidden; o.classList.toggle('on'); });

function startGame() { hideMazePopup(); $('setup').style.display = 'none'; $('game').style.display = 'block'; $('win-overlay').style.display = 'none'; buildLevel(); flash(MZ.state.set.prompt || ''); Sound.startMusic(); }
$('start-btn').addEventListener('click', startGame);
$('quit-btn').addEventListener('click', () => { MZ.state = null; hideMazePopup(); $('game').style.display = 'none'; $('setup').style.display = 'block'; });
$('win-again').addEventListener('click', () => { hideMazePopup(); $('win-overlay').style.display = 'none'; buildLevel(); flash(MZ.state.set.prompt || ''); });
$('win-menu').addEventListener('click', () => { $('win-overlay').style.display = 'none'; $('game').style.display = 'none'; $('setup').style.display = 'block'; });
$('sound-btn').addEventListener('click', () => Sound.toggle());
window.addEventListener('resize', () => { if (MZ.state) computeTileSize(); });

// expose for tests
MZ.move = move; MZ.teleport = teleport; MZ.drop = dropItem; MZ.stepGuards = stepGuards; MZ.stepDoors = stepDoors;
MZ.checkCatch = checkGuardCatch; MZ.passable = passable; MZ.revealed = itemRevealed; MZ.start = startGame; MZ.keys = keys; MZ.action = doAction;

Sound.init();
loadSets();
requestAnimationFrame(loop);
