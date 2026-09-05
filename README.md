<h1 align="center">🧨 Blast Radius</h1>

<p align="center">
  <b>Impact-aware PR review, powered by <a href="https://github.com/entireio/entire-graph">Entire Graph</a>.</b><br>
  Know what a change really touches, whether it drifted from the ask, and the
  smallest test set that actually covers it — before you approve.
</p>

<p align="center">
  <em>Bangalore Tech Week Hackathon · Track 02 — Build with Graph Intelligence</em>
</p>

---

## The problem

Two things happen on almost every pull request:

1. **The reviewer can't see the blast radius.** A three-line diff to a shared
   helper can ripple through 20 call sites and three services. The diff doesn't
   show that. The reviewer approves on vibes.
2. **CI runs everything.** No signal about which tests actually exercise the
   changed code, so the whole suite runs on every push — slow feedback, wasted
   minutes, and *still* no confidence the right paths were covered.

And a quieter one: **the change quietly grew.** The ticket said "add rate
limiting to one endpoint"; the PR also refactored a database signature. Nobody
flagged it because nobody cross-checked the diff against the original intent.

## What Blast Radius does

On every PR, it runs a pipeline over the Entire Graph:

```
changed symbols ──▶ blast radius ──▶ ┌─ scope check vs stated intent
  (graph diff)      (graph impact)   ├─ minimal sufficient test set
                                     └─ radius summary
                                              │
                                     one PR comment, every claim
                                     linked to the graph path that proves it
```

It posts a single comment like:

> ## 🧨 Blast Radius
> **14 nodes** · 4 modules · 3 services · **3 scope findings** · **6 tests (2 gaps)**
>
> **Scope check** — intent: *"add rate limiting to the redirect endpoint"* (source: `Entire-Checkpoint` trailer)
>
> | | Changed symbol | Why flagged | Dependents |
> |--|--|--|--|
> | 🔴 | `Database.query` `src/db/database.ts:41` | not referenced in intent · 9 dependents | 9 |
> | 🟠 | `LinkRepo.byId` `src/repo/link-repo.ts:12` | not referenced in intent · 4 dependents | 4 |
>
> **Recommended tests (6)** — covers all but 2 changed symbols
> ```bash
> npx vitest run test/redirect.test.ts test/rate-limit.test.ts test/link-repo.test.ts -t "redirect|rate|byId"
> ```
> <details><summary>Full blast radius (14 nodes)</summary> … </details>

Every row links to an **evidence block** that names the exact graph path
(`Database.query` → called by `LinkRepo.byId` → called by `RedirectService` →
covered by `redirect.test.ts`), so the reviewer can verify each flag instead of
trusting it.

## How it uses the graph (not just displaying it)

| Graph command | What Blast Radius does with the output |
| --- | --- |
| `entire-graph diff --base A --head B --json` | the set of changed symbols and each one's `dependents_count` |
| `entire-graph impact --symbol S --file F --json` | per-symbol callers / callees / type consumers / data flows / co-change files / siblings — unioned and deduped into the radius |
| `entire-graph neighbors --symbol S --relation CALLS --direction in` | distance refinement for test ranking |
| `Entire-Checkpoint:` git trailer | resolves the change back to its originating session so the *stated intent* is the real captured prompt, not a guess |

The raw output is never shown on its own. It is joined, scored, and turned into
a decision (approve / look here / run these) — which is the point of the track.

## Install

```bash
npm install -g blast-radius        # or: npx blast-radius <cmd>
```

Requires **Node ≥ 20**. For live analysis it also needs the `entire-graph`
binary on `PATH` (the GitHub Action builds it for you). For local development
and demos you don't need it — see *Fixture mode*.

## Usage

```bash
# analyse a range in the current repo, print the markdown report
blast-radius review --base origin/main --head HEAD

# machine-readable, for agents
blast-radius review --base origin/main --head HEAD --format json

# code-scanning integration
blast-radius review --base origin/main --head HEAD --format sarif --out blast-radius.sarif

# no entire-graph binary? run against recorded fixtures
blast-radius review --fixture ./fixtures/entire-graph --format markdown
```

Key flags: `--repo <path>`, `--intent-source pr-body,github-issue,checkpoint-trailer`,
`--fail-on-findings`, `--out <file>` (repeatable with `--format`).

## GitHub Action

```yaml
# .github/workflows/blast-radius.yml
name: Blast Radius
on: pull_request
permissions: { contents: read, pull-requests: write, security-events: write }

jobs:
  blast-radius:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: entire-hackathon/blast-radius@v0.1.0
        with:
          base: ${{ github.event.pull_request.base.sha }}
          head: ${{ github.event.pull_request.head.sha }}
          upload-sarif: true
```

The action builds `entire-graph` (cached), runs the review, upserts one PR
comment, and optionally uploads SARIF to the Code scanning tab.

## Fixture mode

`FixtureGraphAdapter` reads recorded `entire-graph` JSON from a directory, so
the entire pipeline — scope check, test selection, rendering — runs with **only
Node installed**. Every test and the demo use this path. Recorded fixtures live
in [`fixtures/entire-graph/`](fixtures/entire-graph).

## Architecture

Hexagonal. Pure domain core, everything external behind a port with a test
fake, single composition root, pipeline of pure stages, strategy pattern for
the scope-creep heuristics. Full detail in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Build plan and status board in
[`docs/PLAN.md`](docs/PLAN.md).

```
src/domain/     pure — model, pipeline, blast-radius, scope-creep/, test-selection
src/ports/      interfaces — graph-provider, intent-source, report-sink, renderer
src/adapters/   entire-graph CLI, fixtures, gh, sinks, renderers
src/app/        the review use-case + config
src/composition-root.ts   the only file that wires adapters
```

## Development

```bash
npm ci
npm test              # vitest, runs on fixtures, no binary needed
npm run typecheck
npm run lint          # includes the hexagonal import-boundary rule
npm run build
```

## License

MIT.
