/**
 * Pick the smallest set of tests that actually exercises the change.
 *
 *  1. every test node in the blast radius is a candidate;
 *  2. score = proximity to a changed symbol (+ bonus for a direct caller);
 *  3. greedily add candidates by score until every *coverable* changed symbol
 *     has at least one selected test;
 *  4. changed symbols no test reaches are reported as explicit coverage gaps;
 *  5. synthesise the exact run command for the detected framework.
 *
 * "Run these six" beats "run everything" only if the reviewer can trust it —
 * hence the gaps are never hidden.
 */
import type {
  BlastRadius,
  ChangedSymbol,
  RadiusNode,
  SymbolRef,
  TestCandidate,
  TestFramework,
  TestPlan,
} from "./model.js";
import { frameworkOf } from "./test-detect.js";

export interface TestSelectionOptions {
  /** hard cap on how many tests to recommend (default 12). */
  readonly maxTests?: number;
  /** force a framework instead of detecting it. */
  readonly framework?: TestFramework;
}

function scoreOf(node: RadiusNode): number {
  const proximity = 1 / (1 + node.distance);
  const directCallerBonus = node.section === "callers" && node.distance <= 1 ? 0.5 : 0;
  return proximity + directCallerBonus;
}

/** A node whose "name" is really a file/module, not a test function. */
function isFileLevelName(ref: SymbolRef): boolean {
  return (
    /\.[cm]?[jt]sx?$/.test(ref.name) ||
    /_test\.(go|py)$/.test(ref.name) ||
    ref.name === ref.file ||
    ref.kind === "module" ||
    ref.kind === "file"
  );
}

function testNameFor(ref: SymbolRef, framework: TestFramework): string | null {
  if (isFileLevelName(ref)) return null;
  const raw = ref.name;
  if (framework === "pytest" || framework === "go") return raw;
  // vitest/jest -t takes a substring of the test title; the symbol name is the
  // best guess we have without the file's AST.
  return raw.replace(/^(test|it|describe)[_\s]*/i, "");
}

function detectFramework(candidates: readonly RadiusNode[], forced?: TestFramework): TestFramework {
  if (forced) return forced;
  const tally = new Map<TestFramework, number>();
  for (const c of candidates) {
    const f = frameworkOf(c.ref);
    if (f === "unknown") continue;
    tally.set(f, (tally.get(f) ?? 0) + 1);
  }
  let best: TestFramework = "unknown";
  let bestN = 0;
  for (const [f, n] of tally) {
    if (n > bestN) {
      best = f;
      bestN = n;
    }
  }
  return best;
}

function packageDir(file: string): string {
  const norm = file.replace(/\\/g, "/");
  const idx = norm.lastIndexOf("/");
  return idx === -1 ? "." : norm.slice(0, idx);
}

function synthesizeCommand(
  framework: TestFramework,
  selected: readonly TestCandidate[],
): string | null {
  if (selected.length === 0) return null;
  const names = [
    ...new Set(selected.map((t) => testNameFor(t.ref, framework)).filter((n): n is string => !!n)),
  ];
  const files = [...new Set(selected.map((t) => t.ref.file).filter((f): f is string => !!f))];
  const filter = names.length > 0 ? names.join("|") : null;

  switch (framework) {
    case "go": {
      const dirs = [...new Set(files.map(packageDir))].map((d) => `./${d}/...`);
      return filter
        ? `go test -run '^(${filter})$' ${dirs.join(" ")}`
        : `go test ${dirs.join(" ")}`;
    }
    case "vitest":
      return filter
        ? `npx vitest run ${files.join(" ")} -t "${filter}"`
        : `npx vitest run ${files.join(" ")}`;
    case "jest":
      return filter ? `npx jest ${files.join(" ")} -t "${filter}"` : `npx jest ${files.join(" ")}`;
    case "pytest":
      return `pytest ${selected
        .map((t) =>
          t.ref.file && !isFileLevelName(t.ref)
            ? `${t.ref.file}::${t.ref.name}`
            : (t.ref.file ?? t.ref.name),
        )
        .join(" ")}`;
    default:
      return null;
  }
}

export function selectTests(
  radius: BlastRadius,
  origin: readonly ChangedSymbol[],
  opts: TestSelectionOptions = {},
): TestPlan {
  const maxTests = opts.maxTests ?? 12;
  const testNodes = radius.nodes.filter((n) => n.isTest);
  const framework = detectFramework(testNodes, opts.framework);

  const ranked = testNodes
    .map((node) => ({ node, score: scoreOf(node) }))
    .sort((a, b) => b.score - a.score || a.node.distance - b.node.distance);

  // gaps are only meaningful for behaviour — callable symbols that changed.
  // A new type or a renamed field having "no test" is not a useful warning.
  const CALLABLE = new Set(["function", "method", "constructor"]);
  const behaviouralNames = origin
    .filter((s) => CALLABLE.has(s.ref.kind ?? "") && s.changeType !== "added")
    .map((s) => s.ref.qualifiedName);
  const covered = new Set<string>();
  const selected: TestCandidate[] = [];

  for (const { node, score } of ranked) {
    if (selected.length >= maxTests) break;
    const newlyCovered = node.originSymbols.filter((s) => !covered.has(s));
    if (newlyCovered.length === 0 && selected.length > 0) continue; // adds no coverage
    for (const s of node.originSymbols) covered.add(s);
    const nodeFramework = frameworkOf(node.ref);
    selected.push({
      ref: node.ref,
      score: Number(score.toFixed(3)),
      distance: node.distance,
      coversSymbols: [...node.originSymbols],
      framework: nodeFramework === "unknown" ? framework : nodeFramework,
    });
  }

  const coverageGaps = behaviouralNames.filter((s) => !covered.has(s));

  return {
    framework,
    selected,
    command: synthesizeCommand(framework, selected),
    coverageGaps,
  };
}
