# Mini Kart Racing

A Mario Kart-style browser racing game for kids, built with [Babylon.js](https://www.babylonjs.com/). Race around a 3D track, collect items, manage your oil level, and answer quiz questions at pit stops to refill.

## Features

- 3D kart racing with AI opponents
- Speed boost and oil management mechanics
- Pit stop quiz system with multiple-choice and typing questions
- Minimap, HUD, and lap tracking
- Customizable question bank (edit files in `questions/`)

## Controls

| Key | Action |
|-----|--------|
| WASD / Arrow Keys | Drive |
| Space | Use item |
| Drive into PIT | Refill oil (triggers quiz) |

## Quick Start

```bash
./start.sh
```

Then open [http://localhost:8000](http://localhost:8000) in your browser.

To use a different port:

```bash
PORT=3000 ./start.sh
```

## Adding Questions

Edit the question files in `questions/`:

- **multiple_choice.txt** — format: `Question?|correct answer|choice1,choice2,choice3,choice4`
- **typing.txt** — format: `Question?|answer`

## Tech

- Pure HTML/CSS/JS
- [Babylon.js](https://www.babylonjs.com/) for 3D rendering
- No build tools or dependencies to install
