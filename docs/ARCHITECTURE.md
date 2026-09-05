# Blast Radius — Architecture

> Impact-aware PR review powered by Entire Graph.
> Track 02 · Build with Graph Intelligence — Bangalore Tech Week Hackathon.

This document is the map. If you are a fresh agent session reconstructing this
project, read this file top to bottom, then `docs/PLAN.md`, then `src/cli.ts`
and follow the wiring in `src/composition-root.ts`.

---

## 1. What it does (in one paragraph)

When a pull request lands, Blast Radius asks Entire Graph for the real
dependency blast radius of every changed symbol — callers, callees, type
consumers, data flows, co-change files, service boundaries. It cross-checks
that radius against the **stated intent** of the change (the PR description, a
linked issue, or an `Entire-Checkpoint` trailer) and flags anything touched
that falls outside the original ask. It then ranks the affected tests by
proximity in the graph and proposes a minimal-but-sufficient test set instead
of "run everything". The reviewer gets one comment: _"This change touches 14
nodes, 3 outside stated intent — here are the 6 tests that actually cover it"_,
every claim linking back to the graph path that justifies it.

It uses the graph as a **real dependency**, not a viewer: `diff`, `impact`,
`neighbors`, and `snapshot` output is consumed, joined, scored, and turned into
a decision. Raw graph output is never shown on its own.

---

## 2. Design principles

| Principle                                | How it shows up                                                                                                                                                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hexagonal (Ports & Adapters)**         | The domain core (`src/domain/`) has zero I/O. It depends only on interfaces declared in `src/ports/`. Every external system — the `entire-graph` binary, GitHub, git, the filesystem — is an adapter behind a port. |
| **Dependency Inversion**                 | Core defines the interfaces it needs; adapters implement them. Nothing in `domain/` imports from `adapters/`.                                                                                                       |
| **Single composition root**              | All wiring happens in `src/composition-root.ts`. No `new SomeAdapter()` scattered through the code. Swapping an implementation is a one-line change there.                                                          |
| **Pure pipeline stages**                 | Analysis is a chain of pure functions `Stage<In, Out>` composed in `src/domain/pipeline.ts`. Each stage is unit-tested in isolation with plain objects.                                                             |
| **Strategy pattern for judgement calls** | Scope-creep detection is a set of interchangeable `ScopeCreepStrategy` implementations combined by a `CompositeStrategy`. Adding or changing a heuristic never touches the pipeline.                                |
| **Result types over exceptions**         | Adapter calls that can fail (`binary missing`, `git error`, `network`) return `Result<T, BlastRadiusError>`. Exceptions do not cross the port boundary.                                                             |
| **Validate at the boundary**             | Every blob of external JSON (entire-graph output, GitHub API) is parsed through a `zod` schema the moment it enters. The domain only ever sees validated value objects.                                             |
| **DRY via shared value objects**         | `Symbol`, `GraphNode`, `RadiusNode`, `IntentModel`, `Finding`, `TestCandidate` are declared once in `src/domain/model.ts` and reused everywhere.                                                                    |

---

## 3. Data flow

```
                      ┌───────────────────────────────────────────────┐
   git base..head ───▶│  cli.ts  →  composition-root.ts  →  app/review │
                      └───────────────────────┬───────────────────────┘
                                              │  (ports injected)
                    ┌─────────────────────────┼──────────────────────────┐
                    ▼                         ▼                          ▼
          GraphProvider port          IntentSource port           ReportSink port
                    │                         │                          │
   ┌────────────────┴───────┐      ┌───────────┴─────────┐     ┌──────────┴──────────┐
   │ EntireGraphCliAdapter  │      │ CompositeIntentSrc  │     │ GitHubCommentSink   │
   │ FixtureGraphAdapter    │      │  ├ PrBody           │     │ StdoutSink          │
   │                        │      │  ├ GitHubIssue      │     │ FileSink            │
   └────────────────────────┘      │  └ CheckpointTrailer│     └─────────────────────┘
                                   └─────────────────────┘

   DOMAIN PIPELINE  (src/domain/pipeline.ts — pure, no I/O)

   ChangeSet ─▶ BlastRadius ─▶ ┌── ScopeCheck ───┐
   (diff)       (impact ×N,    ├── TestSelection ┤─▶ AnalysisReport ─▶ Renderer ─▶ Sink
                 unioned)      └── RadiusSummary ─┘   (Builder)          (port)
```

### Stage contracts

| Stage                | Input                     | Output                                                              | Pure?   | Port used                         |
| -------------------- | ------------------------- | ------------------------------------------------------------------- | ------- | --------------------------------- |
| `collectChangeSet`   | `{base, head}`            | `ChangeSet` (changed symbols + `dependents_count`)                  | no      | `GraphProvider.diff`              |
| `computeBlastRadius` | `ChangeSet`               | `BlastRadius` (deduped `RadiusNode[]`, bucketed by relation)        | no      | `GraphProvider.impact` per symbol |
| `resolveIntent`      | `PrContext`               | `IntentModel`                                                       | no      | `IntentSource.get`                |
| `detectScopeCreep`   | `ChangeSet + IntentModel` | `Finding[]`                                                         | **yes** | —                                 |
| `selectTests`        | `BlastRadius`             | `TestPlan` (ranked `TestCandidate[]` + run command + coverage gaps) | **yes** | —                                 |
| `summarizeRadius`    | `BlastRadius`             | `RadiusSummary` (counts by module / service / relation)             | **yes** | —                                 |
| `buildReport`        | all of the above          | `AnalysisReport`                                                    | **yes** | — (Builder)                       |

The three impure stages are thin: they call a port, validate the response, and
map it to a value object. All judgement lives in the pure stages, which is what
makes the tests fast and the curveball cheap to absorb.

---

## 4. Module layout

```
blast-radius/
├── src/
│   ├── domain/                    pure core — no imports from adapters/ or node built-ins for I/O
│   │   ├── model.ts               value objects + zod schemas (single source of truth)
│   │   ├── errors.ts              BlastRadiusError hierarchy + Result<T,E> helpers
│   │   ├── pipeline.ts            Stage<In,Out>, compose(), run()
│   │   ├── blast-radius.ts        union / dedupe / bucket impact results
│   │   ├── summary.ts             counts by module, service, relation
│   │   ├── test-selection.ts      proximity ranking, minimal-set greedy cover, run-command synthesis
│   │   ├── report.ts             AnalysisReportBuilder
│   │   └── scope-creep/
│   │       ├── strategy.ts        ScopeCreepStrategy interface + CompositeStrategy
│   │       ├── keyword-overlap.ts intent keywords vs changed-symbol name tokens
│   │       └── dependents.ts      wide-reaching-change heuristic
│   ├── ports/                     interfaces only, no logic
│   │   ├── graph-provider.ts
│   │   ├── intent-source.ts
│   │   ├── report-sink.ts
│   │   └── renderer.ts
│   ├── adapters/
│   │   ├── graph/
│   │   │   ├── entire-graph-cli.ts   shells out to the real binary (execa)
│   │   │   └── fixture.ts            reads fixtures/entire-graph/*.json  (dev + tests + offline)
│   │   ├── intent/
│   │   │   ├── pr-body.ts
│   │   │   ├── github-issue.ts       `gh issue view --json`
│   │   │   ├── checkpoint-trailer.ts reads `Entire-Checkpoint:` trailer + optional .entire/intent/<id>.json
│   │   │   └── composite.ts          first non-empty wins, records which source answered
│   │   ├── sink/
│   │   │   ├── stdout.ts
│   │   │   ├── github-comment.ts     `gh pr comment --body-file` (upsert: edits its own previous comment)
│   │   │   └── file.ts
│   │   └── render/
│   │       ├── markdown.ts
│   │       ├── json.ts
│   │       └── sarif.ts              findings as SARIF → GitHub code-scanning tab
│   ├── app/
│   │   ├── review.ts                the use-case; wires stages into a pipeline and runs it
│   │   └── config.ts               zod config schema, env + flag merge
│   ├── composition-root.ts         Factory: build the adapter set from config
│   └── cli.ts                      commander; parse args → composition root → review()
├── test/
│   ├── domain/                     pure unit tests (majority of the suite)
│   ├── adapters/                   adapter tests against recorded fixtures / fakes
│   └── e2e/                        full pipeline on fixtures/scenarios/*
├── fixtures/
│   ├── entire-graph/               recorded `diff`, `impact`, `neighbors` JSON
│   └── scenarios/                  end-to-end PR scenarios (input + expected report snapshot)
├── action.yml                      composite GitHub Action
├── .github/workflows/
│   ├── ci.yml
│   └── blast-radius.yml            self-dogfood: runs Blast Radius on this repo's own PRs
└── docs/  ARCHITECTURE.md · PLAN.md · DEMO.md
```

**Import rule (enforced by an eslint boundary rule):**
`domain/` → may import `domain/` only.
`ports/` → may import `domain/model` only.
`adapters/` → may import `ports/`, `domain/model`, `domain/errors`.
`app/` → may import `domain/`, `ports/`.
`composition-root.ts` → the only file allowed to import `adapters/`.

---

## 5. Ports (the seams)

```ts
// ports/graph-provider.ts
export interface GraphProvider {
  diff(range: CommitRange): Promise<Result<ChangeSet, BlastRadiusError>>;
  impact(sym: SymbolRef): Promise<Result<Impact, BlastRadiusError>>;
  neighbors(sym: SymbolRef, opts: NeighborOpts): Promise<Result<Neighbors, BlastRadiusError>>;
}

// ports/intent-source.ts
export interface IntentSource {
  readonly name: string; // "pr-body" | "github-issue" | "checkpoint-trailer"
  get(ctx: PrContext): Promise<Result<IntentModel | null, BlastRadiusError>>;
}

// ports/report-sink.ts
export interface ReportSink {
  publish(rendered: RenderedReport): Promise<Result<void, BlastRadiusError>>;
}

// ports/renderer.ts
export interface Renderer {
  readonly format: "markdown" | "json" | "sarif";
  render(report: AnalysisReport): RenderedReport;
}
```

Every seam is an interface with at least two implementations, one of which is a
test/offline fake. That is the definition of "done" for a port.

---

## 6. Algorithms (v1 — deliberately explainable)

### 6.1 Blast radius

For each changed symbol from `diff`, call `impact --symbol <name> --file <path>
--format json`. Union the `callers`, `callees`, `type_consumers`, `data_flows`,
`co_changes`, `siblings` sections. Dedupe by `(file, symbol)` keeping the
shortest graph distance seen. Tag each node with the changed symbol(s) it
derives from and the relation path.

### 6.2 Scope-creep detection (Strategy)

`IntentModel.keywords` = significant tokens from intent text (identifiers,
nouns), lowercased, stopworded, light-stemmed.

- **KeywordOverlapStrategy** — for each _changed_ symbol `S`:
  `tokens(S)` = camelCase/snake/`/`/`.`-split of qualified name + path.
  `overlap = |tokens(S) ∩ keywords| / |tokens(S)|`.
  Emit a `Finding` when `overlap < 0.15` **and** `S.dependents_count >= 3`.
- **DependentsThresholdStrategy** — emit a `Finding` for any changed symbol with
  `dependents_count >= 8` ("wide-reaching change, not scoped in the ask").
- **CompositeStrategy** — runs all registered strategies, dedupes findings by
  symbol keeping the highest severity, attaches every strategy's evidence.

Each `Finding` carries: the symbol, `file:line`, `dependents_count`, the
relation path, the strategy name, and a severity. This is the verifiable
evidence trail.

### 6.3 Test selection

A `RadiusNode` is a **test** if its file matches configured test globs
(`**/*.{test,spec}.*`, `**/*_test.go`, `**/test_*.py`, `**/tests/**`) or its
name matches `^Test|^test_|_test$`.
`score = 1/(1+distance) + (isDirectCallerOfChangedSymbol ? 0.5 : 0)`.
**Minimal sufficient set** = greedily add tests by descending score until every
changed symbol is covered by ≥1 selected test. Report any changed symbol with
zero covering tests as an explicit **coverage gap**.
Run command synthesised per detected stack:
`go test -run 'TestA|TestB' ./pkg/...` · `npx vitest run <files> -t "<names>"` ·
`pytest <file>::<name>`.

### 6.4 Radius summary

Counts: total nodes, distinct files, distinct top-level modules (first path
segment, configurable), distinct services (from `SERVICE`/`HANDLES_ROUTE`
relations when present), and a per-relation breakdown.

---

## 7. Output surfaces

| Format   | Consumer                                  | Notes                                                                                                                                               |
| -------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Markdown | human reviewer (PR comment)               | headline metrics line, scope table, `<details>` test plan with copy-paste command, `<details>` full radius. Every row anchors to an evidence block. |
| JSON     | agents / scripts                          | the full `AnalysisReport` value object, schema-versioned                                                                                            |
| SARIF    | GitHub code-scanning tab / any SARIF tool | scope findings as results; makes the check a first-class CI signal and is a ready hedge for a "machine-verifiable output" curveball                 |

The **GitHubCommentSink upserts**: it finds its own previous comment (marker
`<!-- blast-radius -->`) and edits it, so re-runs don't spam the PR.

---

## 8. The GitHub Action

`action.yml` is a **composite action** (no bundled JS, no `dist/` step):

1. `actions/setup-go` + `actions/cache` (key: entire-graph version) → build or
   restore the `entire-graph` binary.
2. `npx github:<owner>/blast-radius review --base … --head … --format markdown
--out br.md --format sarif --sarif-out br.sarif`
3. `gh pr comment --body-file br.md` (token: `github.token`)
4. `github/codeql-action/upload-sarif` (optional, `if: inputs.upload-sarif`)

Inputs: `base`, `head`, `entire-graph-ref`, `fail-on-findings`,
`intent-source-order`, `upload-sarif`. All optional with sane defaults.

---

## 9. Curveball adaptability

The Noon Curve Ball drops a track-specific constraint at 12:00 IST. The design
is built so that most plausible constraints are **one adapter or one strategy**,
never a rewrite.

| If the curveball is…                           | The change is…                                                        | Files touched                                               |
| ---------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------- |
| "support GitLab / Bitbucket"                   | new `ReportSink` + `IntentSource` adapter                             | `adapters/sink/`, `adapters/intent/`, `composition-root.ts` |
| "another language"                             | entire-graph already parses it; widen test globs in config            | `app/config.ts`                                             |
| "machine-verifiable / SARIF / JUnit output"    | already have JSON + SARIF; add a renderer                             | `adapters/render/`                                          |
| "run as an MCP / agent tool"                   | `review()` is a pure use-case; add an MCP entry point beside `cli.ts` | new `src/mcp.ts`, `composition-root.ts`                     |
| "intent from Jira / Linear / Checkpoint only"  | new `IntentSource`; `CompositeIntentSource` already sequences them    | `adapters/intent/`                                          |
| "new scoring dimension / different scope rule" | new `Stage` or new `ScopeCreepStrategy`                               | `domain/scope-creep/` or `domain/pipeline.ts`               |
| "must work fully offline"                      | entire-graph is no-egress; fall back to `FileSink`, skip `gh`         | `composition-root.ts` (config flag already there)           |
| "pre-commit / local hook"                      | `review()` callable from a hook entry point                           | new `src/hook.ts`                                           |
| "explain WHY each node is in the radius"       | relation path is already captured per node; extend the renderer       | `adapters/render/markdown.ts`                               |

Keep this table honest — update it once the real constraint is known.

---

## 10. Testing strategy

- **Unit (domain/):** every pure stage and strategy, plain-object in / plain-object
  out. Target: the whole `domain/` folder covered. Fast (<1s).
- **Adapter (adapters/):** `EntireGraphCliAdapter` parsed against recorded
  fixtures; `FixtureGraphAdapter` is itself the test double. Intent adapters
  against recorded `gh` JSON. Sinks against a spy.
- **E2E (e2e/):** `fixtures/scenarios/*` — each scenario is `{ changeSet,
impacts, intent }` in, and a snapshot of the rendered Markdown out. This is
  the regression net for the demo.
- **Dogfood:** `.github/workflows/blast-radius.yml` runs the real thing on this
  repo's own PRs. If our own PR comment looks wrong, we see it before the judges.

No code merges without: `npm run lint && npm run typecheck && npm test` green.
