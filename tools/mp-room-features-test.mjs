// Test: (a) every player sees the host's selected next track, (b) room chat
// (user + system messages), (c) screenshot the responsive lobby.
const puppeteer = (await import("puppeteer-core")).default;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LAUNCH = { executablePath: "/usr/bin/google-chrome", headless: "new",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist",
    "--no-sandbox", "--disable-dev-shm-usage", "--window-size=1200,860"] };
const A = await puppeteer.launch(LAUNCH), B = await puppeteer.launch(LAUNCH);
const host = await A.newPage(), guest = await B.newPage();
const results = []; const check = (l, ok) => { results.push(ok); console.log(`  ${l}: ${ok ? "✓" : "✗"}`); };
for (const p of [host, guest]) { await p.setViewport({ width: 1200, height: 860 }); await p.goto("http://localhost:3077", { waitUntil: "domcontentloaded" }); await p.waitForSelector("#create-room-btn", { timeout: 30000 }); }

await host.type("#name-input", "Alex"); await host.click("#create-room-btn");
await host.waitForFunction(() => document.getElementById("room-code").textContent.trim().length >= 4, { timeout: 15000 });
const code = await host.evaluate(() => document.getElementById("room-code").textContent.trim());
await guest.type("#name-input", "Sam"); await guest.type("#join-input", code); await guest.click("#join-room-btn");
await sleep(900);

// (a) host picks a track → guest must see it as the next track
await host.click("#lobby-pick-btn");
await host.evaluate(() => document.querySelector('.track-card[data-track-id="4"]').click()); // Formula GP
await sleep(700);
const guestTrack = await guest.evaluate(() => ({
  text: document.getElementById("next-track-name").textContent,
  shown: document.getElementById("next-track").style.display !== "none",
}));
check(`guest sees next track ("${guestTrack.text}")`, guestTrack.shown && /Formula GP/.test(guestTrack.text));
await host.click("#car-back-btn");

// (b) chat: system join message + two-way user messages
const hostSysSawJoin = await host.evaluate(() => [...document.querySelectorAll("#chat-messages .chat-msg.sys")].some(d => /Sam joined/.test(d.textContent)));
check("system chat: 'Sam joined the room' shown to host", hostSysSawJoin);

await guest.type("#chat-input", "hi everyone");
await guest.click("#chat-send");
await sleep(500);
const hostGotMsg = await host.evaluate(() => [...document.querySelectorAll("#chat-messages .chat-msg")].some(d => /Sam:\s*hi everyone/.test(d.textContent)));
const guestOwnMsg = await guest.evaluate(() => [...document.querySelectorAll("#chat-messages .chat-msg.me")].some(d => /hi everyone/.test(d.textContent)));
check("host receives guest's chat message", hostGotMsg);
check("guest sees own message styled as 'me'", guestOwnMsg);

await host.evaluate(() => { document.getElementById("chat-input").value = "<b>hello</b>"; });
await host.click("#chat-send");
await sleep(500);
const guestGotHost = await guest.evaluate(() => {
  const d = [...document.querySelectorAll("#chat-messages .chat-msg")].find(d => /Alex:/.test(d.textContent) && /hello/.test(d.textContent));
  return d ? { text: d.textContent, escaped: d.innerHTML.includes("&lt;b&gt;") } : null;
});
check("guest receives host's message", !!guestGotHost);
check("HTML in chat is escaped (no injection)", guestGotHost && guestGotHost.escaped);

await host.screenshot({ path: "/tmp/track-shots/room-feat.png" });
await A.close(); await B.close();
console.log(results.every(Boolean) ? "\nALL ROOM CHECKS PASS" : "\nSOME FAILED");
process.exit(results.every(Boolean) ? 0 : 2);
