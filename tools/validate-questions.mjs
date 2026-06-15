#!/usr/bin/env node
// Validates the question collection against questions/SCHEMA.md.
// Usage: node tools/validate-questions.mjs
import fs from "fs";
import path from "path";

const QDIR = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "questions");
const FIGURE_KINDS = ["triangle", "polygon", "angle", "segments", "fraction", "count", "clock", "coin", "raw_svg"];
const GENERATORS = ["addition", "subtraction", "multiplication", "triangleAngle", "polygonSides", "clockRead", "coinCount", "fractionAdd"];
const IN_GAME_MAX_TIME = 8;

const errors = [];
const ids = new Map();
let total = 0, gameCount = 0;

function err(file, id, msg) { errors.push(`${file}${id ? " [" + id + "]" : ""}: ${msg}`); }

let topics;
try {
  topics = JSON.parse(fs.readFileSync(path.join(QDIR, "index.json"), "utf8"));
  if (!Array.isArray(topics)) throw new Error("index.json must be an array of topic names");
} catch (e) {
  console.error("Cannot read questions/index.json:", e.message);
  process.exit(1);
}

for (const topic of topics) {
  const file = `${topic}.json`;
  let list;
  try {
    list = JSON.parse(fs.readFileSync(path.join(QDIR, file), "utf8"));
  } catch (e) {
    err(file, "", "invalid JSON or missing file — " + e.message);
    continue;
  }
  if (!Array.isArray(list)) { err(file, "", "must be a JSON array"); continue; }

  list.forEach((q, i) => {
    total++;
    const id = q.id || `#${i}`;
    if (typeof q.topic !== "string" || !q.topic) err(file, id, "missing 'topic'");
    if (typeof q.time !== "number" || q.time <= 0) err(file, id, "missing/invalid 'time' (positive number of seconds)");

    if (q.gen !== undefined) {
      // Generated questions build their prompt/answer/choices at run time.
      if (!GENERATORS.includes(q.gen)) err(file, id, `unknown 'gen' "${q.gen}" — must be one of ${GENERATORS.join(", ")}`);
    } else {
      if (typeof q.prompt !== "string" || !q.prompt.trim()) err(file, id, "missing 'prompt' (or use 'gen')");
      if (q.answer === undefined || q.answer === null || String(q.answer) === "") err(file, id, "missing 'answer' (or use 'gen')");
    }

    if (q.choices !== undefined) {
      if (!Array.isArray(q.choices) || q.choices.length < 2) {
        err(file, id, "'choices' must be an array of at least 2 options");
      } else if (q.answer !== undefined && !q.choices.some(c => String(c).toLowerCase() === String(q.answer).toLowerCase())) {
        err(file, id, `'choices' must contain the answer "${q.answer}"`);
      }
    }

    if (q.figure !== undefined) {
      const kind = q.figure.raw_svg ? "raw_svg" : q.figure.kind;
      if (!FIGURE_KINDS.includes(kind)) err(file, id, `figure.kind "${kind}" is not one of ${FIGURE_KINDS.join(", ")}`);
    }

    if (q.id) {
      if (ids.has(q.id)) err(file, id, `duplicate id (also in ${ids.get(q.id)})`);
      else ids.set(q.id, file);
    }

    const game = Array.isArray(q.choices) && q.choices.length >= 2 && !q.figure && !q.math && q.time <= IN_GAME_MAX_TIME;
    if (game) gameCount++;
  });
}

console.log(`Checked ${total} questions across ${topics.length} topics (${gameCount} eligible for the racing game).`);
if (errors.length) {
  console.error(`\n${errors.length} problem(s):`);
  errors.forEach(e => console.error("  - " + e));
  process.exit(1);
}
console.log("All questions valid. ✅");
