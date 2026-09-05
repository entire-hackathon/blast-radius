/**
 * Domain value objects — the vocabulary every stage speaks.
 *
 * Raw `entire-graph` JSON is parsed (in `adapters/graph`) into these normalized
 * shapes and nothing downstream ever sees the wire format again. Intermediate
 * types are plain interfaces; the two shapes that cross an outer boundary — the
 * final `AnalysisReport` (rendered / emitted as JSON) and `IntentModel` (may be
 * supplied via config) — also get a zod schema so the contract is enforced.
 */
import { z } from "zod";

export const SCHEMA_VERSION = "1.0.0" as const;

/* ------------------------------------------------------------- symbols --- */

export interface SymbolRef {
  readonly name: string;
  readonly qualifiedName: string;
  readonly kind: string | undefined;
  readonly file: string | undefined;
  readonly line: number | undefined;
  readonly language: string | undefined;
  readonly external: boolean;
}

export type ChangeType =
  "added" | "removed" | "renamed" | "moved" | "signature_changed" | "body_changed" | "unknown";

export interface ChangedSymbol {
  readonly ref: SymbolRef;
  readonly changeType: ChangeType;
  readonly dependentsCount: number;
  readonly oldSignature: string | undefined;
  readonly newSignature: string | undefined;
}

export interface ChangeSet {
  readonly base: string;
  readonly head: string;
  /** `Entire-Checkpoint` id when the diff resolved one; else undefined. */
  readonly checkpoint: string | undefined;
  readonly symbols: readonly ChangedSymbol[];
  readonly changedFiles: readonly string[];
}

/* --------------------------------------------------------- blast radius --- */

export type RadiusRelation =
  | "CALLS"
  | "CALLED_BY"
  | "USES_TYPE"
  | "PARAM_TYPE"
  | "RETURNS_TYPE"
  | "DATA_FLOWS"
  | "FILE_CHANGES_WITH"
  | "SIBLING"
  | "HANDLES_ROUTE"
  | "OTHER";

export type RadiusSection =
  "callers" | "callees" | "type_consumers" | "data_flows" | "co_changes" | "siblings";

export interface RadiusNode {
  readonly ref: SymbolRef;
  readonly section: RadiusSection;
  readonly relation: RadiusRelation;
  readonly direction: "in" | "out" | "none";
  /** graph hops from the nearest changed symbol (1 = direct). */
  readonly distance: number;
  /** intermediate symbol names on the path from the changed symbol. */
  readonly viaChain: readonly string[];
  readonly callSite: { file: string; line: number } | undefined;
  /** qualified names of the changed symbols this node derives from. */
  readonly originSymbols: readonly string[];
  readonly isTest: boolean;
}

export interface BlastRadius {
  readonly origin: readonly ChangedSymbol[];
  readonly nodes: readonly RadiusNode[];
  readonly sectionTotals: Readonly<Record<RadiusSection, number>>;
}

/* --------------------------------------------------------------- intent --- */

export const intentModelSchema = z.object({
  source: z.string(),
  title: z.string().default(""),
  body: z.string().default(""),
  keywords: z.array(z.string()).default([]),
  references: z.array(z.string()).default([]),
});
export type IntentModel = z.infer<typeof intentModelSchema>;

/* ------------------------------------------------------------- findings --- */

export type Severity = "high" | "medium" | "low";

export interface EvidenceItem {
  readonly label: string;
  /** `path/to/file.ts:42` — clickable in a PR comment. */
  readonly location: string | undefined;
  /** e.g. ["Database.query", "LinkRepo.byId", "RedirectService.handle"]. */
  readonly relationPath: readonly string[];
}

export interface Finding {
  readonly symbol: SymbolRef;
  readonly severity: Severity;
  /** which strategy raised it: "keyword-overlap" | "dependents-threshold" | … */
  readonly strategy: string;
  readonly reason: string;
  readonly dependentsCount: number;
  readonly evidence: readonly EvidenceItem[];
}

/* --------------------------------------------------------- test selection --- */

export type TestFramework = "go" | "vitest" | "jest" | "pytest" | "unknown";

export interface TestCandidate {
  readonly ref: SymbolRef;
  readonly score: number;
  readonly distance: number;
  /** qualified names of changed symbols this test transitively reaches. */
  readonly coversSymbols: readonly string[];
  readonly framework: TestFramework;
}

export interface TestPlan {
  readonly framework: TestFramework;
  readonly selected: readonly TestCandidate[];
  /** copy-paste command that runs exactly `selected`, or null if unknown. */
  readonly command: string | null;
  /** qualified names of changed symbols with no covering test. */
  readonly coverageGaps: readonly string[];
}

/* -------------------------------------------------------------- summary --- */

export interface RadiusSummary {
  readonly totalNodes: number;
  readonly fileCount: number;
  readonly moduleCount: number;
  readonly serviceCount: number;
  readonly testCount: number;
  readonly byRelation: Readonly<Record<string, number>>;
}

/* --------------------------------------------------------------- report --- */

export const analysisReportSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  generatedAt: z.string(),
  range: z.object({ base: z.string(), head: z.string(), checkpoint: z.string().optional() }),
  intent: intentModelSchema.nullable(),
  changeSummary: z.object({
    symbolCount: z.number().int(),
    fileCount: z.number().int(),
    widestDependents: z.number().int(),
  }),
  radiusSummary: z.object({
    totalNodes: z.number().int(),
    fileCount: z.number().int(),
    moduleCount: z.number().int(),
    serviceCount: z.number().int(),
    testCount: z.number().int(),
    byRelation: z.record(z.number().int()),
  }),
  findings: z.array(
    z.object({
      symbol: z.object({
        name: z.string(),
        qualifiedName: z.string(),
        kind: z.string().optional(),
        file: z.string().optional(),
        line: z.number().int().optional(),
        language: z.string().optional(),
        external: z.boolean(),
      }),
      severity: z.enum(["high", "medium", "low"]),
      strategy: z.string(),
      reason: z.string(),
      dependentsCount: z.number().int(),
      evidence: z.array(
        z.object({
          label: z.string(),
          location: z.string().optional(),
          relationPath: z.array(z.string()),
        }),
      ),
    }),
  ),
  testPlan: z.object({
    framework: z.enum(["go", "vitest", "jest", "pytest", "unknown"]),
    selected: z.array(
      z.object({
        ref: z.object({
          name: z.string(),
          qualifiedName: z.string(),
          kind: z.string().optional(),
          file: z.string().optional(),
          line: z.number().int().optional(),
          language: z.string().optional(),
          external: z.boolean(),
        }),
        score: z.number(),
        distance: z.number().int(),
        coversSymbols: z.array(z.string()),
        framework: z.enum(["go", "vitest", "jest", "pytest", "unknown"]),
      }),
    ),
    command: z.string().nullable(),
    coverageGaps: z.array(z.string()),
  }),
});

export type AnalysisReport = z.infer<typeof analysisReportSchema>;

/* --------------------------------------------------------------- helpers --- */

export function symbolKey(ref: Pick<SymbolRef, "qualifiedName" | "file">): string {
  return `${ref.file ?? "?"}::${ref.qualifiedName}`;
}

export function formatLocation(ref: Pick<SymbolRef, "file" | "line">): string | undefined {
  if (!ref.file) return undefined;
  return ref.line ? `${ref.file}:${ref.line}` : ref.file;
}
