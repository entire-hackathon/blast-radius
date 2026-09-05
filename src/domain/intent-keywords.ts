/**
 * Turn free-text intent (a PR body, an issue, a checkpoint prompt) into a set
 * of comparable keywords, and split a symbol's identity into comparable tokens.
 *
 * Deliberately simple and inspectable — no embeddings. The scope-creep check
 * has to be explainable to a reviewer in one sentence ("this symbol shares no
 * words with the ticket"), and a lexical overlap is exactly that sentence.
 */

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "if",
  "then",
  "else",
  "for",
  "of",
  "to",
  "in",
  "on",
  "at",
  "by",
  "with",
  "from",
  "as",
  "is",
  "are",
  "be",
  "been",
  "being",
  "was",
  "were",
  "this",
  "that",
  "these",
  "those",
  "it",
  "its",
  "we",
  "i",
  "you",
  "they",
  "should",
  "would",
  "could",
  "can",
  "will",
  "shall",
  "may",
  "might",
  "must",
  "add",
  "adds",
  "added",
  "adding",
  "update",
  "updates",
  "updated",
  "fix",
  "fixes",
  "fixed",
  "change",
  "changes",
  "changed",
  "make",
  "makes",
  "made",
  "use",
  "using",
  "used",
  "support",
  "implement",
  "implements",
  "new",
  "also",
  "when",
  "so",
  "not",
  "no",
  "yes",
  "do",
  "does",
  "did",
  "done",
  "now",
  "just",
  "only",
  "into",
  "out",
  "up",
  "down",
  "via",
  "per",
  "each",
  "any",
  "all",
  "some",
  "more",
  "less",
  "than",
  "there",
  "here",
  "which",
  "what",
  "who",
  "how",
  "why",
  "pr",
  "issue",
  "ticket",
  "feature",
  "bug",
]);

/** camelCase / snake_case / kebab / dotted / slashed -> lowercase word list. */
export function splitIdentifier(raw: string): string[] {
  return raw
    .replace(/[/\\.]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

/** Naive suffix stemmer — enough to make "limiter"/"limiting"/"limits" collide. */
export function stem(word: string): string {
  return word
    .replace(/(ies)$/, "y")
    .replace(/(ing|edly|ed|ly|es|s)$/, "")
    .replace(/(er|or)$/, "");
}

function normalize(words: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const w of words) {
    if (w.length < 3) continue;
    if (STOPWORDS.has(w)) continue;
    const s = stem(w);
    if (s.length >= 3 && !STOPWORDS.has(s)) out.add(s);
  }
  return out;
}

/** Keywords for an intent text. `backtickedTerms` are weighted in as-is. */
export function extractKeywords(text: string): string[] {
  // pull `code spans` and Capitalised identifiers before generic splitting
  const spans = [...text.matchAll(/`([^`]+)`/g)].flatMap((m) => splitIdentifier(m[1] ?? ""));
  const words = splitIdentifier(text.replace(/`[^`]+`/g, " "));
  return [...normalize([...spans, ...words])].sort();
}

/** Tokens that identify a symbol: its qualified name + the meaningful path parts. */
export function symbolTokens(qualifiedName: string, file: string | undefined): Set<string> {
  const fromName = splitIdentifier(qualifiedName);
  const fromFile = file
    ? splitIdentifier(file.replace(/\.[a-z0-9]+$/i, "")).filter(
        (p) => !["src", "internal", "pkg", "lib", "app", "cmd", "test", "tests"].includes(p),
      )
    : [];
  return normalize([...fromName, ...fromFile]);
}

/** Extract `#123` / `GH-123` / `owner/repo#123` issue references from text. */
export function extractIssueRefs(text: string): string[] {
  const refs = new Set<string>();
  for (const m of text.matchAll(/(?:^|\s)(?:closes?|fixes?|resolves?|ref)?\s*#(\d+)/gi)) {
    refs.add(`#${m[1]}`);
  }
  for (const m of text.matchAll(/\b([\w.-]+\/[\w.-]+)#(\d+)\b/g)) {
    refs.add(`${m[1]}#${m[2]}`);
  }
  return [...refs];
}

export interface OverlapResult {
  readonly overlap: number;
  readonly shared: string[];
  readonly symbolTokenCount: number;
}

/** Fraction of a symbol's tokens that appear in the intent keyword set. */
export function keywordOverlap(
  qualifiedName: string,
  file: string | undefined,
  intentKeywords: readonly string[],
): OverlapResult {
  const tokens = symbolTokens(qualifiedName, file);
  if (tokens.size === 0) return { overlap: 1, shared: [], symbolTokenCount: 0 };
  const kw = new Set(intentKeywords);
  const shared = [...tokens].filter((t) => kw.has(t));
  return { overlap: shared.length / tokens.size, shared, symbolTokenCount: tokens.size };
}
