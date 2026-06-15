# Mini Kart Racing

A Mario Kart-style browser racing game for kids, built with [Babylon.js](https://www.babylonjs.com/). Race around a 3D track, collect items, manage your oil level, and answer quiz questions at pit stops to refill. Play online with friends!

## Features

- 3D kart racing with AI opponents
- **8 themed courses** — Sunny Oval, Forest Hills, Desert Snake, City Rush (night),
  Formula GP, Green Valley, Alpine Drop (snow) and Kitchen Chaos (shrunk onto the
  breakfast table) — with sharp corners, hairpins and chicanes, up/down hills,
  drive-through caves and tunnels, oil/ice/mud/spike traps and boost pads
- **A railway crossing with a live train** on City Rush — warning lights blink, the
  bell rings, the horn sounds… and anyone still on the rails gets flattened
- **Online multiplayer** - race with up to 4 players
- 8 vehicles with different stats and **real-life relative sizes** — from a tiny
  go-kart to a towering truck (size changes the collision footprint too)
- **Realistic crash damage**: wall and car impacts drain health in proportion
  to impact speed (kinetic energy); each vehicle's Health rating absorbs
  damage — the Tank shrugs off slams that would leave the go-kart seeing stars.
  At zero health the kart sits dizzy while health crawls back (~2.5s) — and
  getting hit while dizzy knocks it back down, extending the recovery
- Speed boost and oil management mechanics
- Pit stop quiz system with multiple-choice and typing questions
- Minimap, HUD, and lap tracking
- Customizable question bank (edit files in `questions/`)
- **Real audio**: 10 racing background tracks (one loops per race) plus upgraded
  sound effects (boost, crash, pickup, lap, win fanfare, train horn, …), from
  [Pixabay](https://pixabay.com) — Pixabay Content License, no attribution
  required (see `assets/audio/CREDITS.txt`). Falls back to the synthesized
  engine/effects if the files are missing. Re-fetch with
  `node tools/pixabay-harvest.mjs && node tools/pixabay-download.mjs`.

## Controls

| Key | Action |
|-----|--------|
| WASD / Arrow Keys | Drive |
| Space | Use item |
| Drive into PIT | Refill oil (triggers quiz) |

## Quick Start

```bash
npm install
./start.sh
```

Then open [http://localhost:3000](http://localhost:3000) in your browser.

To use a different port:

```bash
PORT=8080 ./start.sh
```

## Multiplayer

1. Start the game and click **Create Room** to get a room code
2. Share the code with friends (up to 4 players total)
3. Friends click **Join Room** and enter the code
4. Everyone selects their kart
5. Host clicks **Start Race** when all players are ready

Or click **Single Player** to race against AI opponents.

## Adding Questions

Edit the question files in `questions/`:

- **multiple_choice.txt** — format: `Question?|correct answer|choice1,choice2,choice3,choice4`
- **typing.txt** — format: `Question?|answer`

## Tech

- Pure HTML/CSS/JS
- [Babylon.js](https://www.babylonjs.com/) for 3D rendering
- Node.js + Socket.io for multiplayer
- Web Audio API for sound effects

## Assets & Credits

This game uses free assets from the following sources:

### 3D Models
- **Kenney Car Kit** - Kart models (kart-oobi, kart-oodi, kart-ooli, kart-oopi, kart-oozi)
  - Source: https://kenney.nl/assets/car-kit
  - License: CC0 1.0 Universal (Public Domain)
  - Files: `assets/models/kart-*.glb`

### Sound Effects
- **Kenney Impact Sounds** - Collision and hit effects
  - Source: https://kenney.nl/assets/impact-sounds
  - License: CC0 1.0 Universal (Public Domain)
  - Files: `assets/sounds/collision.ogg`, `assets/sounds/hit.ogg`

- **Kenney UI Audio** - Interface and pickup sounds
  - Source: https://kenney.nl/assets/ui-audio
  - License: CC0 1.0 Universal (Public Domain)
  - Files: `assets/sounds/pickup.ogg`

### Attribution
All assets are used under CC0 1.0 Universal license. Special thanks to:
- **Kenney** (kenney.nl) - For providing high-quality free game assets
- **Freesound.org** - For additional sound effect resources
- **Babylon.js** - For the amazing 3D rendering engine

If you use this game as a base for your own project, please consider supporting these amazing asset creators!
