# Question format

Questions live in this folder as **JSON files, one per topic** (e.g. `arithmetic.json`,
`geometry.json`). Each file is a JSON **array of question objects**. To add a new topic,
create `mytopic.json` and add `"mytopic"` to **`index.json`**.

Run the validator before committing:

```bash
node tools/validate-questions.mjs
```

## Fields

| field        | required | type            | notes |
|--------------|:--------:|-----------------|-------|
| `prompt`     | ✅       | string          | The question text shown to the player. |
| `answer`     | ✅       | string          | The correct answer. |
| `topic`      | ✅       | string          | Grouping key (usually matches the file name). |
| `time`       | ✅       | number (seconds)| Expected time to answer. **Drives where the question is used** (see below). |
| `choices`    | –        | string[]        | Multiple-choice options (include the correct `answer`). Omit for typed answers. |
| `accept`     | –        | string[]        | Extra accepted spellings for typed answers, e.g. `["3/4", "0.75"]`. |
| `figure`     | –        | object          | A diagram (see **Figures**). Test-only. |
| `math`       | –        | string (LaTeX)  | Math notation, e.g. `"\\frac{1}{2} + \\frac{1}{4}"`. Test-only. |
| `difficulty` | –        | number 1–5      | Difficulty rating (the test can filter by it: Easy 1–2, Medium 3, Hard 4–5). |
| `explain`    | –        | string          | Feedback shown after answering. |
| `gen`        | –        | string          | Generate a fresh question each time (see **Generated questions**). When set, `prompt`/`answer`/`choices` are produced automatically. |
| `id`         | –        | string          | Stable identifier (recommended, e.g. `"geo-001"`). |

## Where a question is used (game vs. test)

- **Racing game** uses only **short multiple-choice** questions:
  `choices` present, **no** `figure`, **no** `math`, and `time` ≤ **8** seconds.
  (These are answered by driving through the box with the right answer.)
- **Test (outside the game)** can use **every** question, including diagrams, math
  notation, and typed answers — there is no time pressure there.

So a quick "What is 7 × 8?" appears in both; a "find the missing angle" diagram is
test-only.

## Figures (diagrams)

Use a named template so you never have to draw anything. `kind` is one of:

```jsonc
{ "kind": "triangle", "angles": [50, 60, "?"] }              // label two angles, ask the third
{ "kind": "polygon",  "sides": 6 }                            // a regular hexagon
{ "kind": "angle",    "degrees": 120 }                        // a single drawn angle
{ "kind": "segments", "parts": [["AB", 7], ["BC", 5]], "find": "AC" }
{ "kind": "fraction", "shaded": 3, "of": 8 }                  // pie/bar with part shaded
{ "kind": "count",    "item": "star", "n": 7 }               // n drawn items to count
{ "kind": "clock",    "time": "3:45" }                        // analog clock face at HH:MM
{ "kind": "coin",     "coins": [25, 25, 10, 5] }             // coins to count (values in cents)
```

Notes:
- **`clock`** — `time` is `"HH:MM"` (24- or 12-hour). The figure draws the clock face;
  your `prompt`/`answer` decide what's asked (read it, or "what time in 30 min?").
- **`coin`** — `coins` is a list of coin **values in cents** (`1, 5, 10, 25, 50, 100`);
  the renderer draws each coin. Your `answer` is the total (e.g. `"65¢"`).

Power users may instead supply `{ "raw_svg": "<svg>…</svg>" }` for full control.

## Generated (procedural) questions

Instead of fixed text, a question can use **`gen`** to build a fresh prompt, figure,
answer and choices **every time it's shown** — so it's never the same twice. Just give
`topic`, `time`, `difficulty`, and `gen`:

```json
{ "topic": "geometry", "gen": "triangleAngle", "time": 15, "difficulty": 3 }
{ "topic": "arithmetic", "gen": "multiplication", "time": 5, "difficulty": 2 }
```

Available generators: `addition`, `subtraction`, `multiplication`, `triangleAngle`,
`polygonSides`, `clockRead`, `coinCount`, `fractionAdd`. (These run in the **test**;
generated questions are not used in the racing game.)

## Examples

```json
{ "id": "ar-006", "topic": "arithmetic", "prompt": "What is 100 - 37?",
  "answer": "63", "choices": ["53", "63", "73", "83"], "time": 5, "difficulty": 2 }

{ "id": "geo-001", "topic": "geometry", "prompt": "Find the missing angle.",
  "figure": { "kind": "triangle", "angles": [50, 60, "?"] },
  "answer": "70", "choices": ["60", "70", "80", "90"], "time": 15, "difficulty": 3,
  "explain": "Angles in a triangle add to 180°: 180 − 50 − 60 = 70." }

{ "id": "fr-001", "topic": "fractions", "prompt": "Add these fractions.",
  "math": "\\frac{1}{2} + \\frac{1}{4}", "answer": "3/4", "accept": ["3/4", "0.75"],
  "time": 20, "difficulty": 3 }
```

## Rules the validator checks

- `prompt`, `answer`, `topic`, `time` are present and the right type.
- If `choices` is given: it's an array of ≥ 2 strings and **contains the `answer`**
  (case-insensitive).
- `figure.kind` (if present) is one of the templates above (or `raw_svg`).
- `id`s are unique across all files.
