// ============================================================
// Practice Test — standalone quiz that renders every question
// type from the standardized collection (see questions/SCHEMA.md):
// text, multiple-choice, typed answers, math (KaTeX) and figures.
// ============================================================

const D2R = Math.PI / 180;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Fit math-coordinate points (y up) into an SVG box (y down), centered.
function fitPoints(pts, W, H, pad) {
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
  const w = (maxx - minx) || 1, h = (maxy - miny) || 1;
  const s = Math.min((W - 2 * pad) / w, (H - 2 * pad) / h);
  const ox = (W - s * w) / 2 - s * minx, oy = (H - s * h) / 2 - s * miny;
  return pts.map(p => [s * p[0] + ox, H - (s * p[1] + oy)]);
}

// ---------- Figure renderers (each returns an SVG string) ----------
const Figures = {
  triangle(f) {
    const raw = f.angles;
    const nums = raw.map(x => x === "?" ? null : Number(x));
    const known = nums.reduce((s, x) => s + (x || 0), 0);
    const v = nums.map(x => x == null ? 180 - known : x);
    const aA = v[0] * D2R, aB = v[1] * D2R, aC = v[2] * D2R;
    // Law of sines: A=(0,0), B=(sin C,0), C=(sin B·cosA, sin B·sinA)
    const tri = [[0, 0], [Math.sin(aC), 0], [Math.sin(aB) * Math.cos(aA), Math.sin(aB) * Math.sin(aA)]];
    const p = fitPoints(tri, 320, 240, 46);
    const cen = [(p[0][0] + p[1][0] + p[2][0]) / 3, (p[0][1] + p[1][1] + p[2][1]) / 3];
    const lbl = (pt, text) => {
      const dx = cen[0] - pt[0], dy = cen[1] - pt[1], len = Math.hypot(dx, dy) || 1;
      const x = pt[0] + dx / len * 32, y = pt[1] + dy / len * 32 + 6;
      return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" font-size="20" font-weight="bold" fill="#1b4a86">${esc(text)}</text>`;
    };
    const txt = i => raw[i] === "?" ? "?" : raw[i] + "°";
    return `<svg viewBox="0 0 320 240" width="320" role="img">
      <polygon points="${p.map(q => q.map(n => n.toFixed(1)).join(",")).join(" ")}" fill="#cfe8ff" stroke="#2b6cb0" stroke-width="3" stroke-linejoin="round"/>
      ${lbl(p[0], txt(0))}${lbl(p[1], txt(1))}${lbl(p[2], txt(2))}
    </svg>`;
  },

  polygon(f) {
    const n = Math.max(3, f.sides | 0), cx = 120, cy = 120, R = 92;
    const pts = [];
    for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + i * 2 * Math.PI / n; pts.push(`${(cx + R * Math.cos(a)).toFixed(1)},${(cy + R * Math.sin(a)).toFixed(1)}`); }
    return `<svg viewBox="0 0 240 240" width="240" role="img"><polygon points="${pts.join(" ")}" fill="#d7f0d7" stroke="#2f855a" stroke-width="3" stroke-linejoin="round"/></svg>`;
  },

  angle(f) {
    const deg = Number(f.degrees) || 0, vx = 40, vy = 150, len = 150, ar = 42;
    const x1 = vx + len, y1 = vy;
    const x2 = vx + len * Math.cos(deg * D2R), y2 = vy - len * Math.sin(deg * D2R);
    const ax2 = vx + ar * Math.cos(deg * D2R), ay2 = vy - ar * Math.sin(deg * D2R);
    const large = deg > 180 ? 1 : 0;
    return `<svg viewBox="0 0 240 180" width="240" role="img">
      <line x1="${vx}" y1="${vy}" x2="${x1}" y2="${y1}" stroke="#2b3a55" stroke-width="3"/>
      <line x1="${vx}" y1="${vy}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#2b3a55" stroke-width="3"/>
      <path d="M ${vx + ar} ${vy} A ${ar} ${ar} 0 ${large} 0 ${ax2.toFixed(1)} ${ay2.toFixed(1)}" fill="none" stroke="#e07b39" stroke-width="3"/>
      <text x="${vx + ar + 14}" y="${vy - 14}" font-size="20" font-weight="bold" fill="#c25d1c">${deg}°</text>
    </svg>`;
  },

  segments(f) {
    const parts = f.parts, total = parts.reduce((s, p) => s + p[1], 0);
    const x0 = 40, x1 = 400, y = 80, scale = (x1 - x0) / total;
    const ptNames = [parts[0][0][0]]; parts.forEach(p => ptNames.push(p[0][1] || "?"));
    const xs = [x0]; let acc = 0; parts.forEach(p => { acc += p[1]; xs.push(x0 + acc * scale); });
    let svg = `<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" stroke="#2b3a55" stroke-width="4"/>`;
    xs.forEach((x, i) => {
      svg += `<line x1="${x.toFixed(1)}" y1="${y - 12}" x2="${x.toFixed(1)}" y2="${y + 12}" stroke="#2b3a55" stroke-width="3"/>`;
      svg += `<text x="${x.toFixed(1)}" y="${y - 18}" text-anchor="middle" font-size="18" font-weight="bold" fill="#1b4a86">${esc(ptNames[i])}</text>`;
    });
    parts.forEach((p, i) => {
      const mid = (xs[i] + xs[i + 1]) / 2;
      svg += `<text x="${mid.toFixed(1)}" y="${y + 32}" text-anchor="middle" font-size="17" fill="#3a4a66">${esc(p[1])}</text>`;
    });
    if (f.find) svg += `<text x="${((x0 + x1) / 2).toFixed(1)}" y="${y + 60}" text-anchor="middle" font-size="18" font-weight="bold" fill="#c25d1c">${esc(f.find)} = ?</text>`;
    return `<svg viewBox="0 0 440 150" width="440" role="img">${svg}</svg>`;
  },

  fraction(f) {
    const n = Math.max(1, f.of | 0), k = Math.max(0, f.shaded | 0), cx = 110, cy = 110, R = 92;
    let segs = "";
    for (let i = 0; i < n; i++) {
      const a1 = -Math.PI / 2 + i * 2 * Math.PI / n, a2 = -Math.PI / 2 + (i + 1) * 2 * Math.PI / n;
      const x1 = cx + R * Math.cos(a1), y1 = cy + R * Math.sin(a1), x2 = cx + R * Math.cos(a2), y2 = cy + R * Math.sin(a2);
      segs += `<path d="M ${cx} ${cy} L ${x1.toFixed(1)} ${y1.toFixed(1)} A ${R} ${R} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z" fill="${i < k ? "#ffcf5c" : "#ffffff"}" stroke="#b7791f" stroke-width="2"/>`;
    }
    return `<svg viewBox="0 0 220 220" width="220" role="img">${segs}</svg>`;
  },

  count(f) {
    const emoji = { star: "⭐", apple: "🍎", ball: "⚽", heart: "❤️", dog: "🐶", cat: "🐱", flower: "🌸", fish: "🐟", balloon: "🎈" };
    const ch = emoji[f.item] || "⭐";
    const n = Math.max(1, f.n | 0), cols = Math.min(n, 5), rows = Math.ceil(n / cols);
    let out = "";
    for (let i = 0; i < n; i++) { const c = i % cols, r = (i / cols) | 0; out += `<text x="${30 + c * 56}" y="${48 + r * 56}" font-size="42" text-anchor="middle">${ch}</text>`; }
    return `<svg viewBox="0 0 ${cols * 56 + 4} ${rows * 56 + 16}" width="${Math.min(cols * 56 + 4, 360)}" role="img">${out}</svg>`;
  },

  clock(f) {
    const [H, M] = String(f.time).split(":").map(Number);
    const cx = 120, cy = 120, R = 100;
    let ticks = "";
    for (let i = 0; i < 12; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 6;
      const x1 = cx + R * 0.86 * Math.cos(a), y1 = cy + R * 0.86 * Math.sin(a), x2 = cx + R * Math.cos(a), y2 = cy + R * Math.sin(a);
      ticks += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#333" stroke-width="3"/>`;
      const nx = cx + R * 0.72 * Math.cos(a), ny = cy + R * 0.72 * Math.sin(a) + 6;
      ticks += `<text x="${nx.toFixed(1)}" y="${ny.toFixed(1)}" text-anchor="middle" font-size="18" font-weight="bold" fill="#2b3a55">${i === 0 ? 12 : i}</text>`;
    }
    const ma = -Math.PI / 2 + (M / 60) * 2 * Math.PI;
    const ha = -Math.PI / 2 + ((H % 12) / 12) * 2 * Math.PI + (M / 60) * (Math.PI / 6);
    const hx = cx + R * 0.5 * Math.cos(ha), hy = cy + R * 0.5 * Math.sin(ha);
    const mx = cx + R * 0.78 * Math.cos(ma), my = cy + R * 0.78 * Math.sin(ma);
    return `<svg viewBox="0 0 240 240" width="220" role="img">
      <circle cx="${cx}" cy="${cy}" r="${R}" fill="#fff" stroke="#222" stroke-width="4"/>
      ${ticks}
      <line x1="${cx}" y1="${cy}" x2="${hx.toFixed(1)}" y2="${hy.toFixed(1)}" stroke="#222" stroke-width="6" stroke-linecap="round"/>
      <line x1="${cx}" y1="${cy}" x2="${mx.toFixed(1)}" y2="${my.toFixed(1)}" stroke="#2b6cb0" stroke-width="4" stroke-linecap="round"/>
      <circle cx="${cx}" cy="${cy}" r="6" fill="#222"/>
    </svg>`;
  },

  coin(f) {
    const meta = { 1: { n: "1¢", c: "#c9803c", r: 24 }, 5: { n: "5¢", c: "#c4c4c4", r: 31 }, 10: { n: "10¢", c: "#c8c8c8", r: 22 }, 25: { n: "25¢", c: "#d0d0d0", r: 35 }, 50: { n: "50¢", c: "#d4d4d4", r: 39 }, 100: { n: "$1", c: "#d4af37", r: 40 } };
    const coins = f.coins, perRow = Math.min(coins.length, 5), rows = Math.ceil(coins.length / perRow);
    let out = "";
    coins.forEach((vc, i) => {
      const m = meta[vc] || { n: vc + "¢", c: "#ccc", r: 28 };
      const cx = 44 + (i % perRow) * 82, cy = 48 + ((i / perRow) | 0) * 88;
      out += `<circle cx="${cx}" cy="${cy}" r="${m.r}" fill="${m.c}" stroke="#7a6a2a" stroke-width="3"/>`;
      out += `<text x="${cx}" y="${cy + 6}" text-anchor="middle" font-size="17" font-weight="bold" fill="#3a3320">${m.n}</text>`;
    });
    return `<svg viewBox="0 0 ${perRow * 82 + 6} ${rows * 88 + 8}" width="${Math.min(perRow * 82 + 6, 440)}" role="img">${out}</svg>`;
  },

  raw_svg(f) { return f.raw_svg || ""; },
};

function renderFigure(f) {
  if (!f) return "";
  const fn = Figures[f.raw_svg ? "raw_svg" : f.kind];
  try { return fn ? fn(f) : ""; } catch (e) { return `<div style="color:#c0392b">⚠ figure error: ${esc(e.message)}</div>`; }
}

// ---------- Answer checking ----------
const norm = (s) => String(s).trim().toLowerCase().replace(/\s+/g, "").replace(/\$/g, "");
function isCorrect(q, given) {
  const accepts = [q.answer, ...(q.accept || [])].map(norm);
  return accepts.includes(norm(given));
}

// ---------- Procedural generators ----------
// A question can carry `"gen": "name"` instead of fixed text; the generator
// produces a fresh prompt/figure/answer/choices each time it's shown, so the
// question is never the same twice.
const rand = (lo, hi) => Math.floor(Math.random() * (hi - lo + 1)) + lo;
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; } return a; }
function numChoices(correct, ...distractors) {
  const set = new Set();
  for (const d of distractors) { const v = Math.round(d); if (v >= 0 && v !== correct) set.add(v); }
  let off = 1;
  while (set.size < 3 && off < 60) { for (const c of [correct + off, correct - off]) { if (c >= 0 && c !== correct) set.add(c); } off++; }
  const arr = [...set].slice(0, 3); arr.push(correct);
  return shuffle(arr.map(String));
}

const Generators = {
  addition() { const a = rand(10, 60), b = rand(10, 60), c = a + b; return { prompt: `What is ${a} + ${b}?`, answer: String(c), choices: numChoices(c, c + 10, c - 10, c + 1) }; },
  subtraction() { const a = rand(20, 95), b = rand(5, a - 1), c = a - b; return { prompt: `What is ${a} - ${b}?`, answer: String(c), choices: numChoices(c, c + 10, c - 10, c + 1) }; },
  multiplication() { const a = rand(2, 12), b = rand(2, 12), c = a * b; return { prompt: `What is ${a} × ${b}?`, answer: String(c), choices: numChoices(c, c + a, c - b, c + 10) }; },
  triangleAngle() {
    const a = rand(30, 80), b = rand(30, Math.min(110, 165 - a)), c = 180 - a - b;
    return { prompt: "Find the missing angle.", figure: { kind: "triangle", angles: [a, b, "?"] }, answer: String(c), choices: numChoices(c, c + 10, c - 10, c + 20), explain: `Angles in a triangle add to 180°: 180 − ${a} − ${b} = ${c}.` };
  },
  polygonSides() { const sides = rand(3, 8); return { prompt: "How many sides does this shape have?", figure: { kind: "polygon", sides }, answer: String(sides), choices: numChoices(sides, sides + 1, sides - 1, sides + 2) }; },
  clockRead() {
    const h = rand(1, 12), mm = [0, 15, 30, 45][rand(0, 3)], fmt = (H, M) => `${H}:${String(M).padStart(2, "0")}`;
    const ans = fmt(h, mm), set = new Set([ans]);
    while (set.size < 4) set.add(fmt(rand(1, 12), [0, 15, 30, 45][rand(0, 3)]));
    return { prompt: "What time does the clock show?", figure: { kind: "clock", time: `${h}:${mm}` }, answer: ans, choices: shuffle([...set]) };
  },
  coinCount() {
    const denoms = [1, 5, 10, 25], k = rand(2, 5), coins = []; let total = 0;
    for (let i = 0; i < k; i++) { const v = denoms[rand(0, 3)]; coins.push(v); total += v; }
    const set = new Set([total]);
    while (set.size < 4) { const w = total + [5, -5, 10, -10, 1, 20][rand(0, 5)]; if (w > 0) set.add(w); }
    return { prompt: "How much money is this?", figure: { kind: "coin", coins }, answer: total + "¢", accept: [String(total), total + "c"], choices: shuffle([...set].map(v => v + "¢")), explain: `${coins.join(" + ")} = ${total} cents.` };
  },
  fractionAdd() {
    const d = [2, 3, 4, 5, 6, 8][rand(0, 5)], a = rand(1, d - 1), b = rand(1, d - a), num = a + b, ans = `${num}/${d}`;
    const distract = new Set([`${a + b}/${d + d}`, `${a}/${d}`, `${b}/${d}`, `${num}/${d + 1}`]); distract.delete(ans);
    return { prompt: "Add these fractions.", math: `\\frac{${a}}{${d}} + \\frac{${b}}{${d}}`, answer: ans, accept: [ans], choices: shuffle([ans, ...[...distract].slice(0, 3)]), explain: `Same bottom number: ${a} + ${b} = ${num}, so ${num}/${d}.` };
  },
};

function resolveQuestion(raw) {
  if (raw.gen && Generators[raw.gen]) return Object.assign({}, raw, Generators[raw.gen]());
  return raw;
}

// ---------- Data ----------
let ALL = [];
async function loadAll() {
  const topics = await fetch("questions/index.json").then(r => r.json());
  const lists = await Promise.all(topics.map(t => fetch(`questions/${t}.json`).then(r => r.json()).catch(() => [])));
  return [].concat(...lists).filter(q => q && (q.gen || (q.prompt && q.answer != null)));
}

// ---------- Setup screen ----------
function buildSetup() {
  const topics = [...new Set(ALL.map(q => q.topic || "other"))].sort();
  const list = $("topic-list");
  list.innerHTML = "";
  topics.forEach(t => {
    const count = ALL.filter(q => (q.topic || "other") === t).length;
    const chip = document.createElement("label");
    chip.className = "topic-chip on";
    chip.innerHTML = `<input type="checkbox" value="${esc(t)}" checked> ${esc(t)} <span style="opacity:.6">(${count})</span>`;
    chip.querySelector("input").addEventListener("change", e => chip.classList.toggle("on", e.target.checked));
    list.appendChild(chip);
  });
}

// ---------- Quiz state ----------
const STATE = { questions: [], i: 0, score: 0, answered: false, results: [], startedAt: 0 };

function startTest() {
  const chosen = [...document.querySelectorAll("#topic-list input:checked")].map(c => c.value);
  if (!chosen.length) { $("setup-error").textContent = "Pick at least one topic."; return; }
  const diff = $("difficulty").value;
  const inDiff = (q) => {
    if (diff === "all") return true;
    const d = q.difficulty || 2;
    return diff === "easy" ? d <= 2 : diff === "medium" ? d === 3 : d >= 4;
  };
  let pool = ALL.filter(q => chosen.includes(q.topic || "other") && inDiff(q));
  if (!pool.length) { $("setup-error").textContent = "No questions match those topics + difficulty."; return; }
  $("setup-error").textContent = "";
  for (let k = pool.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1));[pool[k], pool[j]] = [pool[j], pool[k]]; }
  const count = parseInt($("count").value, 10);
  STATE.questions = count > 0 ? pool.slice(0, count) : pool;
  STATE.i = 0; STATE.score = 0; STATE.results = []; STATE.startedAt = Date.now();
  $("setup").hidden = true; $("results").hidden = true; $("quiz").hidden = false;
  showQuestion();
}

function showQuestion() {
  const q = resolveQuestion(STATE.questions[STATE.i]);  // generated questions get fresh values each time
  STATE.answered = false;
  const n = STATE.questions.length;
  $("q-progress").textContent = `Question ${STATE.i + 1} / ${n}`;
  $("q-score").textContent = `Score: ${STATE.score}`;
  $("q-fill").style.width = `${(STATE.i / n) * 100}%`;

  $("q-prompt").textContent = q.prompt;
  $("q-figure").innerHTML = renderFigure(q.figure);
  const mathEl = $("q-math");
  if (q.math && window.katex) { mathEl.hidden = false; try { katex.render(q.math, mathEl, { throwOnError: false, displayMode: true }); } catch (e) { mathEl.textContent = q.math; } }
  else if (q.math) { mathEl.hidden = false; mathEl.textContent = q.math; }
  else { mathEl.hidden = true; mathEl.innerHTML = ""; }
  $("q-hint").textContent = q.time ? `⏱ about ${q.time}s · ${q.topic || ""}` : (q.topic || "");

  const ans = $("q-answer");
  ans.innerHTML = "";
  if (Array.isArray(q.choices) && q.choices.length) {
    const grid = document.createElement("div");
    grid.className = "choices";
    [...q.choices].sort(() => Math.random() - 0.5).forEach(c => {
      const b = document.createElement("button");
      b.className = "choice"; b.textContent = c;
      b.addEventListener("click", () => answer(q, c, b));
      grid.appendChild(b);
    });
    ans.appendChild(grid);
  } else {
    const wrap = document.createElement("div");
    wrap.className = "typed";
    wrap.innerHTML = `<input id="typed-input" type="text" autocomplete="off" placeholder="Type your answer…"><button class="btn" id="typed-submit">Check</button>`;
    ans.appendChild(wrap);
    const input = $("typed-input"), submit = $("typed-submit");
    const go = () => answer(q, input.value, null);
    submit.addEventListener("click", go);
    input.addEventListener("keydown", e => { if (e.key === "Enter") go(); });
    setTimeout(() => input.focus(), 50);
  }

  $("q-feedback").className = "feedback"; $("q-feedback").innerHTML = "";
  $("next-btn").hidden = true;
}

function answer(q, given, btn) {
  if (STATE.answered) return;
  if (given == null || String(given).trim() === "") return;
  STATE.answered = true;
  const correct = isCorrect(q, given);
  if (correct) STATE.score++;
  STATE.results.push({ q, given: String(given), correct });

  // lock & highlight
  document.querySelectorAll(".choice").forEach(b => {
    b.disabled = true;
    if (norm(b.textContent) === norm(q.answer)) b.classList.add("correct");
    else if (btn && b === btn) b.classList.add("wrong");
  });
  const ti = $("typed-input"), ts = $("typed-submit");
  if (ti) ti.disabled = true; if (ts) ts.disabled = true;

  const fb = $("q-feedback");
  fb.className = "feedback show " + (correct ? "good" : "bad");
  fb.innerHTML = (correct ? "✓ Correct!" : `✗ Not quite — the answer is <b>${esc(q.answer)}</b>`) +
    (q.explain ? `<div class="explain">${esc(q.explain)}</div>` : "");
  $("q-score").textContent = `Score: ${STATE.score}`;
  $("next-btn").hidden = false;
  $("next-btn").textContent = STATE.i + 1 < STATE.questions.length ? "Next ▶" : "See Results 🏁";
  $("next-btn").focus();
}

function nextQuestion() {
  STATE.i++;
  if (STATE.i < STATE.questions.length) showQuestion();
  else showResults();
}

function showResults() {
  $("quiz").hidden = true; $("results").hidden = false;
  const n = STATE.questions.length, pct = n ? Math.round(STATE.score / n * 100) : 0;
  const secs = Math.round((Date.now() - STATE.startedAt) / 1000);
  $("r-score").textContent = `${STATE.score} / ${n}`;
  const emoji = pct >= 80 ? "🌟" : pct >= 50 ? "👍" : "💪";
  $("r-sub").textContent = `${pct}%  ${emoji}  ·  ${secs}s`;

  // per-topic
  const byTopic = {};
  STATE.results.forEach(r => { const t = r.q.topic || "other"; (byTopic[t] = byTopic[t] || { c: 0, n: 0 }), byTopic[t].n++; if (r.correct) byTopic[t].c++; });
  $("r-breakdown").innerHTML = Object.keys(byTopic).sort().map(t =>
    `<div class="brow"><span>${esc(t)}</span><span>${byTopic[t].c} / ${byTopic[t].n}</span></div>`).join("");

  const missed = STATE.results.filter(r => !r.correct);
  $("r-missed").innerHTML = missed.length
    ? `<h3>Review (${missed.length})</h3>` + missed.map(r =>
      `<div class="miss"><div class="q">${esc(r.q.prompt)}</div><div class="a"><span class="yours">You: ${esc(r.given)}</span> · <span class="right">Answer: ${esc(r.q.answer)}</span></div>${r.q.explain ? `<div class="a">${esc(r.q.explain)}</div>` : ""}</div>`).join("")
    : `<h3 style="color:#2f855a">Perfect — no mistakes! 🎉</h3>`;
}

// ---------- Init ----------
$("start-btn").addEventListener("click", startTest);
$("next-btn").addEventListener("click", nextQuestion);
$("retry-btn").addEventListener("click", startTest);
$("back-btn").addEventListener("click", () => { $("results").hidden = true; $("quiz").hidden = true; $("setup").hidden = false; });

loadAll().then(qs => {
  ALL = qs;
  if (!ALL.length) { $("setup-error").textContent = "No questions found in questions/."; return; }
  buildSetup();
}).catch(e => { $("setup-error").textContent = "Failed to load questions: " + e.message; });
