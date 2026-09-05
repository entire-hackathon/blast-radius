/**
 * Zod schemas for the raw JSON that the `entire-graph` binary emits.
 *
 * These mirror the Go structs in entire-graph (`internal/sem/model.go`,
 * `internal/cli/impact.go`, `internal/cli/neighbors.go`). They are deliberately
 * lenient — `.passthrough()` everywhere, most fields optional — because the
 * graph schema is frozen-but-additive (ADR 0001) and we must not break when it
 * grows a field. Every value that enters the domain is parsed through one of
 * these first; nothing downstream ever touches an unvalidated blob.
 */
import { z } from "zod";

/* ------------------------------------------------------------------ diff --- */

export const rawEntityChange = z
  .object({
    type: z.string(),
    kind: z.string(),
    name: z.string(),
    old_name: z.string().optional(),
    new_name: z.string().optional(),
    old_signature: z.string().optional(),
    new_signature: z.string().optional(),
    old_path: z.string().optional(),
    new_path: z.string().optional(),
    before_start_line: z.number().int().optional(),
    after_start_line: z.number().int().optional(),
    dependents_count: z.number().int().default(0),
    similarity: z.number().optional(),
    reconciliation: z.string().optional(),
  })
  .passthrough();

export const rawFileChange = z
  .object({
    path: z.string(),
    old_path: z.string().optional(),
    status: z.string(),
    language: z.string().optional(),
    changes: z.array(rawEntityChange).default([]),
  })
  .passthrough();

export const rawDiffResult = z
  .object({
    base: z.string(),
    head: z.string(),
    checkpoint: z.string().optional(),
    files: z.array(rawFileChange).default([]),
    schema_version: z.string().optional(),
    producer_version: z.string().optional(),
    warnings: z.array(z.unknown()).optional(),
  })
  .passthrough();

export type RawDiffResult = z.infer<typeof rawDiffResult>;
export type RawEntityChange = z.infer<typeof rawEntityChange>;

/* --------------------------------------------------------------- impact --- */

export const rawEndpoint = z
  .object({
    id: z.string().default(""),
    name: z.string().default(""),
    qualified_name: z.string().optional(),
    kind: z.string().optional(),
    file_path: z.string().optional(),
    start_line: z.number().int().optional(),
    end_line: z.number().int().optional(),
    language: z.string().optional(),
    external: z.boolean().optional(),
  })
  .passthrough();

export const rawCallSite = z
  .object({
    file_path: z.string(),
    line: z.number().int(),
    additional_sites: z.number().int().optional(),
  })
  .passthrough();

export const rawImpactEntry = z
  .object({
    endpoint: rawEndpoint,
    relation: z.string().optional(),
    direction: z.string().optional(),
    depth: z.number().int().optional(),
    via: z.string().optional(),
    detail: z.string().optional(),
    call_site: rawCallSite.optional(),
  })
  .passthrough();

export const rawImpactSection = z
  .object({
    total: z.number().int().default(0),
    direct: z.number().int().optional(),
    transitive: z.number().int().optional(),
    in: z.number().int().optional(),
    out: z.number().int().optional(),
    entries: z.array(rawImpactEntry).default([]),
  })
  .passthrough();

export const rawImpactResult = z
  .object({
    format_version: z.number().int().optional(),
    repo_root: z.string().optional(),
    query: z.string().default(""),
    file: z.string().optional(),
    line: z.number().int().optional(),
    depth: z.number().int().optional(),
    disambiguation_required: z.boolean().default(false),
    definitions: z.array(rawEndpoint).optional(),
    focus: rawEndpoint.optional(),
    container: rawEndpoint.optional(),
    callers: rawImpactSection.default({ total: 0, entries: [] }),
    callees: rawImpactSection.default({ total: 0, entries: [] }),
    type_consumers: rawImpactSection.default({ total: 0, entries: [] }),
    data_flows: rawImpactSection.default({ total: 0, entries: [] }),
    co_changes: rawImpactSection.default({ total: 0, entries: [] }),
    siblings: rawImpactSection.default({ total: 0, entries: [] }),
    warnings: z.array(z.unknown()).optional(),
  })
  .passthrough();

export type RawImpactResult = z.infer<typeof rawImpactResult>;
export type RawImpactEntry = z.infer<typeof rawImpactEntry>;
export type RawEndpoint = z.infer<typeof rawEndpoint>;

/** The six impact sections, in the order we surface them. */
export const IMPACT_SECTIONS = [
  "callers",
  "callees",
  "type_consumers",
  "data_flows",
  "co_changes",
  "siblings",
] as const;
export type ImpactSectionName = (typeof IMPACT_SECTIONS)[number];

/* ------------------------------------------------------------ neighbors --- */

export const rawNeighborsResult = z
  .object({
    query: z.string().default(""),
    disambiguation_required: z.boolean().default(false),
    definitions: z.array(rawEndpoint).optional(),
    neighbors: z.array(rawImpactEntry).default([]),
  })
  .passthrough();

export type RawNeighborsResult = z.infer<typeof rawNeighborsResult>;
