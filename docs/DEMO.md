# Demo script (90 seconds)

## Setup (before you present)

- `blast-radius-demo` repo pushed to GitHub, Action installed.
- PR open: `feat/redirect-rate-limit` → `main`.
- A terminal in `blast-radius/` for the offline fallback.
- Screen recording of the whole arc already saved (network insurance).

## The arc

1. **Frame it (10s).** Open the PR. Read the title: _"Rate-limit the redirect
   endpoint."_ "Small, contained change — I'd normally skim this and approve."

2. **The comment (20s).** Scroll to the Blast Radius comment.

   > **17 nodes · 6 modules · 4 scope findings · 2 tests**
   > "It touched 17 graph nodes. Four of them are outside what the ticket asked
   > for."

3. **The scope table (20s).** Point at `Database.query` — 🟠, 6 dependents,
   _"no vocabulary overlap with the stated intent."_ Then the three `LinkRepo`
   methods under it. "The PR also re-plumbed the entire data-access layer to
   thread a new options argument. Nothing in the ticket says that."

4. **Verify a flag (20s).** Expand _Evidence_. Read the graph path:
   `Database.query → LinkRepo.byId → ShortenService.create`. Click the
   `src/db/database.ts:12` link — lands on the signature change. "Every flag is
   backed by a path through the graph I can check."

5. **The tests (15s).** "And instead of running the whole suite —"

   ```bash
   npx vitest run test/redirect.test.ts test/link-repo.test.ts
   ```

   Run it. Green. "Two files, ranked by graph distance, cover every changed
   function."

6. **Land it (5s).** "Blast Radius uses Entire Graph as a dependency — `diff`,
   `impact`, and the checkpoint trailer, joined into one decision. Raw graph
   output alone wasn't the point; the workflow is."

## Offline fallback (if the Action / network misbehaves)

```bash
cd blast-radius
npx blast-radius review \
  --fixture fixtures/scenarios/redirect-rate-limit \
  --repo ../blast-radius-demo --head HEAD \
  --repo-slug entire-hackathon/linkshrink --suite-test-count 13
```

Same report, from recorded graph JSON, no binary needed. Show the terminal
output; the story is identical.

## If the Noon Curve Ball forces a change

1. Read the constraint, find its row in `ARCHITECTURE.md §9`.
2. Implement it as the adapter / strategy / stage that row names. Add a test.
3. `npm test`, re-run the demo command, update `test/adapters/render.test.ts`
   snapshot if the output shape changed.
4. Re-record the 20 seconds that changed. Resubmit. Check in.
