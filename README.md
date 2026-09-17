# LeetCode Trainer

A local, LeetCode-style practice app that runs **your** Python against **real test cases** using your machine's own CPython — no subscription, no cloud judge.

Built as a sibling to `sentence-trainer` and `optiverLearning`, but local-first: progress lives in your browser's `localStorage`, and code execution goes through a tiny local Node server.

## Why this exists

LeetCode Premium is expensive, and the most useful feedback is *"what did my code actually do?"* — the real `IndexError` / `UnboundLocalError` and the exact line it happened on. This app gives you that, plus a place to keep the walkthroughs and explanations you accumulate.

## Features

- **Problem statement panel** with examples, constraints, and pattern tags.
- **"My original attempt" tab** — your buggy first try, plus bullet-by-bullet notes on exactly what needed fixing. This is the part that turns a wrong answer into a lesson.
- **Code editor** with live line numbers, 4-space Tab, `Shift+Tab` dedent, and `Ctrl/Cmd+Enter` to run.
- **Resizable layout** — drag the vertical handles to set the widths of the problem list, problem statement, and code panels. Drag the horizontal handle above the test results to resize the output. Double-click any handle to reset; widths are remembered.
- **Foldable problem list** — click `⟨` to hide the left panel and give the code more room; click `⟩ Problems` in the top bar to bring it back.
- **Real Python execution** via the local server. `Run` uses the example tests; `Submit` runs every test case.
- **Honest error reporting**: syntax errors get a caret pointer, runtime errors include the line in *your* code.
- **Time limits** so an accidental infinite loop can't hang the app.
- **"My answers" version history**: every **Submit** stores a full snapshot of your code, so you can review earlier approaches later (brute force vs. hash map) and load any version back into the editor. `Run` is *not* saved — only your real answers.
- **Mastery + stats**: solved counts, per-problem best time, submit success rate, and a full attempt log.

## Quick start

Requires **Node.js 18+** and **Python 3.9+** on your `PATH`.

```bash
cd leetcode-trainer
npm run serve
```

Then open **http://localhost:5050**.

The top-right badge shows which Python interpreter the judge found (e.g. `judge: python`). If it says `judge offline`, Python wasn't found — set it explicitly:

```bash
# Windows (Git Bash / PowerShell)
PYTHON=py npm run serve

# macOS / Linux
PYTHON=python3 npm run serve
```

Use a different port with `PORT=6060 npm run serve`.

## How it works

```
public/index.html     UI shell
public/styles.css     LeetCode-ish styling (dark editor, light panels)
public/app.js         Front-end: problem list, tabs, editor, results, stats
public/data/problems.json   All problem content (statement, attempt, solution, tests)
server/index.js       Static file server + POST /api/run
server/judge.py       Runs one submission in CPython and grades it
```

`POST /api/run` receives `{ code, className, method, tests }`, writes the job to a fresh
Python subprocess, and returns per-test pass/fail with the real output and any error.
The subprocess is killed after 8 s (override with `JUDGE_TIMEOUT_MS`).

## Adding a problem

Append an object to `public/data/problems.json` → `problems`. The shape:

```jsonc
{
  "id": "two-sum",                 // stable id; also the localStorage key
  "number": 1,
  "title": "Two Sum",
  "difficulty": "Easy",            // Easy | Medium | Hard
  "tags": ["array", "hash-table"],
  "patterns": ["brute-force"],     // shown as 🏷 chips
  "className": "Solution",         // class the judge instantiates
  "method": "twoSum",              // method the judge calls

  "statement": "Markdown supported.\n\nUse `code`, **bold**, lists, etc.",
  "examples": [
    { "input": "nums = [2,7,11,15], target = 9", "output": [0, 1], "explain": "optional" }
  ],
  "constraints": ["2 <= nums.length <= 10^4"],

  "starterCode": "class Solution:\n    def twoSum(...):\n        pass\n",
  "originalAttempt": "your first buggy version here",
  "attemptNotes": [ { "issue": "**Short title**", "detail": "Markdown explanation." } ],
  "hints": ["Markdown hint 1", "Markdown hint 2"],

  "solution": "class Solution:\n    ...",
  "explanation": "Markdown walkthrough. ## headings and `code` work.",
  "complexity": { "time": "O(n²)", "space": "O(1)" },

  "tests": [
    { "name": "Example 1", "args": [[2,7,11,15], 9], "expected": [0,1], "unordered": true }
  ]
}
```

`test.args` is spread into your method, so `args: [[2,7], 9]` calls `solution.twoSum([2,7], 9)`.
Set `unordered: true` when a list answer may be returned in any order.

### Judging rules

- Your code must define `className` with a callable `method`.
- A test passes when the returned value equals `expected` (or, with `unordered`, when the
  multisets match).
- Returning `None` is a failure unless `expected` is `null` — the app never silently
  accepts a missing `return`.

## Data & privacy

- **Progress, saved code, and run history** live in `localStorage` under `leetcodeTrainer_v1`.
  Nothing leaves your machine.
- **Your code is executed** by the Python subprocess started by `server/index.js`. Only run
  code you trust, and keep the server bound to localhost.

### What is stored

```jsonc
{
  "mastered":    { "two-sum": "2026-09-17T..." },   // "Mark mastered" marks
  "code":        { "two-sum": "…latest editor text…" },
  "runs":        [ { "kind": "run" | "submit", "ok": true, "passed": 5, "total": 5, "error": null } ],
  "submissions": { "two-sum": [ { "version": 1, "code": "…full source…", "ok": true } ] },
  "lastProblem": "two-sum"
}
```

- `code` is the **latest** editor text (overwritten on each keystroke).
- `submissions` is the **version history** — one full snapshot per **Submit**, capped at the
  last 30 per problem. This is what the **My answers** tab shows.
- `runs` keeps the last 500 entries.

### Layout preferences

Panel sizes are stored separately, so resetting your progress doesn't move your UI around:

| Key | Holds |
|---|---|
| `leetcodeTrainer_cols` | sidebar and problem-statement widths |
| `leetcodeTrainer_resultsH` | test-results panel height |
| `leetcodeTrainer_sidebarFolded` | whether the problem list is folded away |

**Reviewing your work later:** open a problem → **My answers**. Each version shows its
result, timestamp, and duration; expand it to see the code, then *Load into editor*,
*Copy code*, or *Delete*. Submitting the same code twice still creates a new version, so
re-submits appear as a timeline.

## Notes

- This project has no Firebase / auth dependency (unlike the Dutch and Optiver apps), by design.
- To reset everything, use **Stats → Reset progress**. Export a backup first with
  **Stats → Export JSON**.
