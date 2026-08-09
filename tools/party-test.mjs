// Party Mode — headless checks: player setup, round flow, scoring, resume, podium.
const puppeteer = (await import("puppeteer-core")).default;
const results = [];
const check = (label, ok, extra = "") => { results.push({ label, ok }); console.log(`  ${ok ? "✓" : "✗"} ${label}${extra ? "  " + extra : ""}`); };

const b = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const p = await b.newPage();
let pageErrors = 0;
p.on("pageerror", (e) => { pageErrors++; console.log("PAGEERR:", e.message.slice(0, 150)); });
p.on("dialog", (d) => d.accept());
await p.goto("http://localhost:3077/party.html", { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.PARTY, { timeout: 15000 });

// ---- setup: 3 players, 2 rounds, only two games in the pool ----
const setup = await p.evaluate(() => {
  localStorage.removeItem("party-state-v1");
  PARTY._setup.players = [{ name: "Mia", avatar: "🦊" }, { name: "Leo", avatar: "🐼" }, { name: "Zoe", avatar: "🐸" }];
  PARTY._setup.rounds = 2;
  PARTY._setup.pool = ["globe", "dodge"];
  PARTY.newParty(); PARTY.showRound();
  const st = PARTY.st;
  return { players: st.players.length, rounds: st.rounds, sched: st.schedule, fromPool: st.schedule.every((g) => ["globe", "dodge"].includes(g)), title: document.getElementById("round-title").textContent, gameShown: document.getElementById("game-name").textContent, link: document.getElementById("open-game").getAttribute("href") };
});
check("party starts with the configured players and rounds", setup.players === 3 && setup.rounds === 2);
check("each round is assigned a game from the chosen pool", setup.fromPool && setup.sched.length === 2, JSON.stringify(setup.sched));
check("the round screen shows the game + a working open link", /ROUND 1 OF 2/.test(setup.title) && setup.gameShown.length > 2 && /\.html$/.test(setup.link));

// ---- ranking: tap players in finishing order → cup points ----
const r1 = await p.evaluate(() => {
  const tags = [...document.querySelectorAll("#rank-zone .ptag")];
  tags[2].click(); tags[0].click(); tags[1].click();          // Zoe 1st, Mia 2nd, Leo 3rd
  const enabled = !document.getElementById("confirm-round").disabled;
  document.getElementById("confirm-round").click();            // award + next round
  const st = PARTY.st;
  const scores = Object.fromEntries(st.players.map((x) => [x.name, x.score]));
  return { enabled, scores, round: st.round, title: document.getElementById("round-title").textContent };
});
check("confirm unlocks once every player is ranked", r1.enabled);
check("cup points awarded by finishing order (10/7/5)", r1.scores.Zoe === 10 && r1.scores.Mia === 7 && r1.scores.Leo === 5, JSON.stringify(r1.scores));
check("the party advances to round 2", r1.round === 1 && /ROUND 2 OF 2/.test(r1.title));

// ---- resume: a reload mid-party comes back to the same round ----
await p.reload({ waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.PARTY, { timeout: 15000 });
const resumed = await p.evaluate(() => ({ round: PARTY.st && PARTY.st.round, shown: !document.getElementById("round").hidden, scores: PARTY.st ? PARTY.st.players.map((x) => x.score) : [] }));
check("reload mid-party RESUMES at the same round with the scores kept", resumed.round === 1 && resumed.shown && resumed.scores.includes(10));

// ---- final round → podium + champion ----
const fin = await p.evaluate(() => {
  const tags = [...document.querySelectorAll("#rank-zone .ptag")];
  tags[2].click(); tags[1].click(); tags[0].click();          // Zoe 1st again
  document.getElementById("confirm-round").click();
  const st = PARTY.st;
  return { done: st.done, finaleShown: !document.getElementById("finale").hidden, champ: document.getElementById("champ-title").textContent, podium: document.querySelectorAll("#podium .step").length, cleared: localStorage.getItem("party-state-v1") == null };
});
check("after the last round the podium + champion show", fin.done && fin.finaleShown && fin.podium === 3);
check("the best player is crowned champion", /Zoe/.test(fin.champ), fin.champ);
check("a finished party clears its save (next visit starts fresh)", fin.cleared);

check("no page errors during the whole run", pageErrors === 0, `errors=${pageErrors}`);

await b.close();
const fails = results.filter((r) => !r.ok);
console.log(fails.length ? `\n${fails.length} FAILED` : "\nALL PARTY CHECKS PASS");
process.exit(fails.length ? 2 : 0);
