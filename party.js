// ============================================================
// Party Mode — a tournament across ALL the kids-learn games.
// Configure the players by hand, pick how many rounds; each round the party
// assigns a game (shuffled, no repeats until every picked game was played),
// everyone plays it, then you tap the players in finishing order to award
// CUP-style points. After the last round: podium + champion. State lives in
// localStorage so coming back from a game (or a reload) resumes the party.
// ============================================================

const $ = (id) => document.getElementById(id);
const AVATARS = ['🦊', '🐼', '🐸', '🐯', '🐵', '🐭', '🦄', '🐙', '🐳', '🦁', '🐨', '🐷'];
const POINTS = [10, 7, 5, 3, 2, 1];               // same feel as the kart cup
const GAMES = [
  { id: 'kart',  name: 'Kart Racing',    emoji: '🏎', url: 'index.html',
    hint: 'Race! Take turns (one race each, compare positions) or join a room together on your devices.' },
  { id: 'match', name: 'Pair Match',     emoji: '🃏', url: 'match.html',
    hint: 'Take turns on the same round — fewest tries wins the round.' },
  { id: 'maze',  name: 'Pair Maze',      emoji: '🧩', url: 'maze.html',
    hint: 'Play the 2-player maze head-to-head (or take turns racing the clock).' },
  { id: 'globe', name: 'Globe Quiz',     emoji: '🌍', url: 'globe.html',
    hint: 'Pick 2–4 players — pass the device each turn; highest score wins.' },
  { id: 'tower', name: 'Tower Defense',  emoji: '🏰', url: 'tower.html',
    hint: 'Each player battles the AI once — best result (or biggest win) takes it.' },
  { id: 'dodge', name: 'Dodge Ball',     emoji: '🤾', url: 'dodge.html',
    hint: 'Take turns vs the AI team — most hearts left when you win (or fastest knockout).' },
  { id: 'test',  name: 'Practice Test',  emoji: '📝', url: 'test.html',
    hint: 'Same topics, same number of questions — highest score wins the round.' },
];
const KEY = 'party-state-v1';

const PARTY = { st: null };
window.PARTY = PARTY;

// ---------- state ----------
function defaultPlayers() { return [{ name: 'Player 1', avatar: '🦊' }, { name: 'Player 2', avatar: '🐼' }]; }
let setupPlayers = defaultPlayers();
let setupRounds = 5;
let setupPool = GAMES.map((g) => g.id);

function save() { try { localStorage.setItem(KEY, JSON.stringify(PARTY.st)); } catch { /* private mode */ } }
function load() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } }
function clearSave() { try { localStorage.removeItem(KEY); } catch { /* */ } }

function newParty() {
  // schedule: shuffle the pool; if more rounds than games, reshuffle another lap
  const shuffled = () => setupPool.slice().sort(() => Math.random() - 0.5);
  let sched = [];
  while (sched.length < setupRounds) {
    let lap = shuffled();
    // avoid the same game twice in a row across laps
    if (sched.length && lap[0] === sched[sched.length - 1] && lap.length > 1) [lap[0], lap[1]] = [lap[1], lap[0]];
    sched = sched.concat(lap);
  }
  PARTY.st = {
    players: setupPlayers.map((p, i) => ({ ...p, id: i, score: 0 })),
    rounds: setupRounds, round: 0,
    schedule: sched.slice(0, setupRounds),
    ranks: [],                                   // player ids tapped this round, in order
    history: [],                                 // [{game, ranking:[ids]}]
    done: false,
  };
  save();
}

// ---------- setup UI ----------
function renderPlayers() {
  const box = $('player-list'); box.innerHTML = '';
  setupPlayers.forEach((p, i) => {
    const row = document.createElement('div'); row.className = 'prow';
    const av = document.createElement('button'); av.className = 'avatar-btn'; av.textContent = p.avatar;
    av.title = 'Change avatar';
    av.addEventListener('click', () => { p.avatar = AVATARS[(AVATARS.indexOf(p.avatar) + 1) % AVATARS.length]; renderPlayers(); });
    const inp = document.createElement('input'); inp.value = p.name; inp.maxLength = 14; inp.placeholder = 'Name';
    inp.addEventListener('input', () => { p.name = inp.value; });
    const del = document.createElement('button'); del.className = 'del-btn'; del.textContent = '✕';
    del.disabled = setupPlayers.length <= 2;
    del.addEventListener('click', () => { setupPlayers.splice(i, 1); renderPlayers(); });
    row.append(av, inp, del); box.appendChild(row);
  });
  $('add-player').disabled = setupPlayers.length >= 6;
}
function renderPool() {
  const box = $('game-pool'); box.innerHTML = '';
  GAMES.forEach((g) => {
    const chip = document.createElement('div');
    chip.className = 'opt game-chip' + (setupPool.includes(g.id) ? ' on' : '');
    chip.innerHTML = `<span>${g.emoji}</span> ${g.name}`;
    chip.addEventListener('click', () => {
      if (setupPool.includes(g.id)) { if (setupPool.length > 1) setupPool = setupPool.filter((x) => x !== g.id); }
      else setupPool.push(g.id);
      renderPool();
    });
    box.appendChild(chip);
  });
}

// ---------- round UI ----------
function gameOf(id) { return GAMES.find((g) => g.id === id); }
function showRound() {
  const st = PARTY.st;
  $('setup').hidden = true; $('finale').hidden = true; $('round').hidden = false;
  const g = gameOf(st.schedule[st.round]);
  $('round-title').textContent = `ROUND ${st.round + 1} OF ${st.rounds}`;
  $('game-emoji').textContent = g.emoji;
  $('game-name').textContent = g.name;
  $('game-hint').textContent = g.hint;
  $('open-game').href = g.url;
  st.ranks = [];
  renderRanks(); renderStandings($('standings'));
  save();
}
function renderRanks() {
  const st = PARTY.st;
  const zone = $('rank-zone'); zone.innerHTML = '';
  st.players.forEach((p) => {
    const pos = st.ranks.indexOf(p.id);
    const tag = document.createElement('div');
    tag.className = 'ptag' + (pos >= 0 ? ' ranked' : '');
    const medal = pos === 0 ? '🥇 1st' : pos === 1 ? '🥈 2nd' : pos === 2 ? '🥉 3rd' : pos >= 3 ? `${pos + 1}th` : '';
    tag.innerHTML = `<span class="face">${p.avatar}</span><span>${escapeHtml(p.name)}</span><span class="medal">${medal || 'tap to rank'}</span>`;
    tag.addEventListener('click', () => { if (st.ranks.includes(p.id)) return; st.ranks.push(p.id); renderRanks(); });
    zone.appendChild(tag);
  });
  $('confirm-round').disabled = st.ranks.length !== st.players.length;
}
function renderStandings(box, final = false) {
  const st = PARTY.st;
  const order = st.players.slice().sort((a, b) => b.score - a.score);
  box.innerHTML = '';
  order.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'standing' + (i === 0 && p.score > 0 ? ' lead' : '');
    row.innerHTML = `<span class="pos">${i + 1}</span><span class="face">${p.avatar}</span><span class="nm">${escapeHtml(p.name)}</span><span class="pts">${p.score} pts</span>`;
    box.appendChild(row);
  });
  if (final && order.length) $('champ-title').textContent = `👑 ${order[0].name} is the Party Champion!`;
}
function confirmRound() {
  const st = PARTY.st;
  if (st.ranks.length !== st.players.length) return;
  st.ranks.forEach((pid, pos) => { const p = st.players.find((x) => x.id === pid); p.score += POINTS[pos] != null ? POINTS[pos] : 1; });
  st.history.push({ game: st.schedule[st.round], ranking: st.ranks.slice() });
  st.round++;
  if (st.round >= st.rounds) { st.done = true; save(); showFinale(); }
  else showRound();
}
function showFinale() {
  const st = PARTY.st;
  $('setup').hidden = true; $('round').hidden = true; $('finale').hidden = false;
  const order = st.players.slice().sort((a, b) => b.score - a.score);
  const podium = $('podium'); podium.innerHTML = '';
  const steps = [{ i: 1, cls: 's2' }, { i: 0, cls: 's1' }, { i: 2, cls: 's3' }];
  for (const s of steps) {
    const p = order[s.i]; if (!p) continue;
    const el = document.createElement('div');
    el.className = 'step ' + s.cls;
    el.innerHTML = `<span class="face">${p.avatar}</span>${escapeHtml(p.name)}<br>${p.score} pts`;
    podium.appendChild(el);
  }
  renderStandings($('final-standings'), true);
  confettiBurst(46);
  clearSave();                                    // the party is over — next visit starts fresh
}
function confettiBurst(n = 30) {
  const glyphs = ['🎉', '⭐', '✨', '🎈', '💛', '💙', '💜', '🧡'];
  for (let i = 0; i < n; i++) {
    const s = document.createElement('span');
    s.className = 'confetti'; s.textContent = glyphs[i % glyphs.length];
    s.style.left = (Math.random() * 100) + 'vw';
    s.style.animationDuration = (1.6 + Math.random() * 1.8) + 's';
    s.style.animationDelay = (Math.random() * 0.6) + 's';
    s.style.fontSize = (16 + Math.random() * 16) + 'px';
    document.body.appendChild(s);
    s.addEventListener('animationend', () => s.remove());
  }
}
function escapeHtml(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

// ---------- wiring ----------
$('add-player').addEventListener('click', () => {
  if (setupPlayers.length >= 6) return;
  const used = setupPlayers.map((p) => p.avatar);
  setupPlayers.push({ name: `Player ${setupPlayers.length + 1}`, avatar: AVATARS.find((a) => !used.includes(a)) || '🦄' });
  renderPlayers();
});
$('opt-rounds').addEventListener('click', (e) => {
  const o = e.target.closest('.opt'); if (!o) return;
  setupRounds = +o.dataset.rounds;
  document.querySelectorAll('#opt-rounds .opt').forEach((x) => x.classList.toggle('on', x === o));
});
$('start-party').addEventListener('click', () => {
  const names = setupPlayers.map((p) => p.name.trim());
  if (names.some((n) => !n)) { $('setup-error').textContent = 'Every player needs a name!'; return; }
  if (setupPlayers.length < 2) { $('setup-error').textContent = 'Add at least 2 players!'; return; }
  if (!setupPool.length) { $('setup-error').textContent = 'Pick at least one game!'; return; }
  $('setup-error').textContent = '';
  newParty(); showRound();
});
$('confirm-round').addEventListener('click', confirmRound);
$('reset-ranks').addEventListener('click', () => { PARTY.st.ranks = []; renderRanks(); });
$('quit-party').addEventListener('click', () => { if (confirm('End the party?')) { clearSave(); PARTY.st = null; $('round').hidden = true; $('setup').hidden = false; } });
$('again-party').addEventListener('click', () => { clearSave(); PARTY.st = null; $('finale').hidden = true; $('setup').hidden = false; });

// resume a party in progress (e.g. coming back from a game tab)
const saved = load();
if (saved && !saved.done && saved.players && saved.round < saved.rounds) {
  PARTY.st = saved;
  showRound();
  // restore any half-entered ranking
  PARTY.st.ranks = saved.ranks || [];
  renderRanks();
} else {
  renderPlayers(); renderPool();
}
// always render the setup widgets so a finished/cleared party can start a new one
renderPlayers(); renderPool();

// expose for tests
PARTY.newParty = newParty; PARTY.showRound = showRound; PARTY.confirmRound = confirmRound;
PARTY.GAMES = GAMES; PARTY.POINTS = POINTS;
PARTY._setup = { get players() { return setupPlayers; }, set players(v) { setupPlayers = v; }, get rounds() { return setupRounds; }, set rounds(v) { setupRounds = v; }, get pool() { return setupPool; }, set pool(v) { setupPool = v; } };
