/**
 * Build an IntentModel from raw text. Pure — adapters gather the text, this
 * turns it into the comparable shape the scope-creep strategies expect.
 */
import { extractIssueRefs, extractKeywords } from "./intent-keywords.js";
import type { IntentModel } from "./model.js";

export interface RawIntent {
  readonly source: string;
  readonly title?: string | undefined;
  readonly body?: string | undefined;
  readonly extraReferences?: readonly string[] | undefined;
}

export function buildIntentModel(raw: RawIntent): IntentModel | null {
  const title = (raw.title ?? "").trim();
  const body = (raw.body ?? "").trim();
  const text = `${title}\n${body}`.trim();
  if (text.length === 0) return null;

  return {
    source: raw.source,
    title,
    body,
    keywords: extractKeywords(text),
    references: [...new Set([...extractIssueRefs(text), ...(raw.extraReferences ?? [])])],
  };
}
