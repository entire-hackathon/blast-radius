/**
 * Is this symbol a test? Pure, shared by the radius tagger and test selection.
 *
 * Two signals: the file path matches a test glob, or the symbol name matches a
 * framework's test-name convention. Globs are configurable so a curveball
 * ("this repo puts tests in `spec/`") is a config change, not a code change.
 */
import type { SymbolRef, TestFramework } from "./model.js";

export const DEFAULT_TEST_FILE_PATTERNS: readonly RegExp[] = [
  /(^|\/)__tests__\//,
  /(^|\/)tests?\//,
  /(^|\/)spec\//,
  /\.test\.[cm]?[jt]sx?$/,
  /\.spec\.[cm]?[jt]sx?$/,
  /_test\.go$/,
  /(^|\/)test_[^/]+\.py$/,
  /_test\.py$/,
  /Test\.java$/,
  /Tests?\.(cs|kt|swift)$/,
  /_spec\.rb$/,
];

const TEST_NAME_PATTERNS: readonly RegExp[] = [
  /^Test[A-Z_]/, // Go
  /^test_/, // pytest / unittest
  /_test$/,
  /^(it|describe|test)\b/i, // vitest/jest blocks occasionally surface as symbols
];

export interface TestDetectOptions {
  readonly filePatterns?: readonly RegExp[];
}

export function isTestFile(file: string | undefined, opts: TestDetectOptions = {}): boolean {
  if (!file) return false;
  const patterns = opts.filePatterns ?? DEFAULT_TEST_FILE_PATTERNS;
  const normalized = file.replace(/\\/g, "/");
  return patterns.some((re) => re.test(normalized));
}

export function isTestSymbol(ref: SymbolRef, opts: TestDetectOptions = {}): boolean {
  if (isTestFile(ref.file, opts)) return true;
  return TEST_NAME_PATTERNS.some((re) => re.test(ref.name));
}

/** Best-effort framework guess from a test file path + language. */
export function frameworkOf(ref: SymbolRef): TestFramework {
  const file = (ref.file ?? "").replace(/\\/g, "/");
  const lang = (ref.language ?? "").toLowerCase();
  if (file.endsWith("_test.go") || lang === "go") return "go";
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(file)) {
    // vitest and jest share the file convention; default to vitest, the use-case
    // can override from config / a detected dependency.
    return "vitest";
  }
  if (/(^|\/)test_.*\.py$/.test(file) || /_test\.py$/.test(file) || lang === "python") {
    return "pytest";
  }
  return "unknown";
}
