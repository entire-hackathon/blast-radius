/**
 * Pure mappers: validated raw `entire-graph` JSON  ->  domain value objects.
 *
 * The graph adapters do the I/O and the zod parse, then call these. Keeping the
 * translation here (not in the adapter) means it is covered by fast unit tests
 * with plain fixtures and there is exactly one place that knows the wire shape.
 */
import type {
  RawDiffResult,
  RawEndpoint,
  RawImpactEntry,
  RawImpactResult,
} from "./graph-schema.js";
import { IMPACT_SECTIONS, type ImpactSectionName } from "./graph-schema.js";
import type {
  ChangedSymbol,
  ChangeSet,
  ChangeType,
  RadiusNode,
  RadiusRelation,
  RadiusSection,
  SymbolRef,
} from "./model.js";
import { isTestSymbol } from "./test-detect.js";

/* --------------------------------------------------------------- symbols --- */

export function toSymbolRef(ep: RawEndpoint): SymbolRef {
  const qualified = ep.qualified_name && ep.qualified_name.length > 0 ? ep.qualified_name : ep.name;
  return {
    name: ep.name,
    qualifiedName: qualified,
    kind: ep.kind,
    file: ep.file_path,
    line: ep.start_line,
    language: ep.language,
    external: ep.external ?? false,
  };
}

const CHANGE_TYPE_MAP: Record<string, ChangeType> = {
  added: "added",
  removed: "removed",
  renamed: "renamed",
  moved: "moved",
  signature_changed: "signature_changed",
  body_changed: "body_changed",
};

function mapChangeType(raw: string, reconciliation: string | undefined): ChangeType {
  if (reconciliation === "MOVED") return "moved";
  if (reconciliation === "RENAMED") return "renamed";
  return CHANGE_TYPE_MAP[raw] ?? "unknown";
}

/* ----------------------------------------------------------------- diff --- */

/** Structural (module-scope) change rows we don't treat as symbols. */
const NON_SYMBOL_KINDS = new Set(["module", "file"]);

export function toChangeSet(raw: RawDiffResult): ChangeSet {
  const symbols: ChangedSymbol[] = [];
  const changedFiles = new Set<string>();

  for (const file of raw.files) {
    changedFiles.add(file.path);
    for (const change of file.changes) {
      if (NON_SYMBOL_KINDS.has(change.kind)) continue;
      const line = change.after_start_line ?? change.before_start_line;
      const ref: SymbolRef = {
        name: change.new_name ?? change.name,
        qualifiedName: change.new_name ?? change.name,
        kind: change.kind,
        file: change.new_path ?? file.path,
        line: line && line > 0 ? line : undefined,
        language: file.language,
        external: false,
      };
      symbols.push({
        ref,
        changeType: mapChangeType(change.type, change.reconciliation),
        dependentsCount: change.dependents_count,
        oldSignature: change.old_signature,
        newSignature: change.new_signature,
      });
    }
  }

  return {
    base: raw.base,
    head: raw.head,
    checkpoint: raw.checkpoint,
    symbols,
    changedFiles: [...changedFiles],
  };
}

/* --------------------------------------------------------------- impact --- */

const SECTION_TO_RELATION: Record<ImpactSectionName, RadiusRelation> = {
  callers: "CALLED_BY",
  callees: "CALLS",
  type_consumers: "USES_TYPE",
  data_flows: "DATA_FLOWS",
  co_changes: "FILE_CHANGES_WITH",
  siblings: "SIBLING",
};

const SECTION_TO_DOMAIN: Record<ImpactSectionName, RadiusSection> = {
  callers: "callers",
  callees: "callees",
  type_consumers: "type_consumers",
  data_flows: "data_flows",
  co_changes: "co_changes",
  siblings: "siblings",
};

function relationOf(section: ImpactSectionName, entry: RawImpactEntry): RadiusRelation {
  const explicit = entry.relation?.toUpperCase();
  if (explicit === "USES_TYPE" || explicit === "PARAM_TYPE" || explicit === "RETURNS_TYPE") {
    return explicit;
  }
  return SECTION_TO_RELATION[section];
}

function directionOf(entry: RawImpactEntry): "in" | "out" | "none" {
  return entry.direction === "in" || entry.direction === "out" ? entry.direction : "none";
}

/**
 * One impact result -> the radius nodes it contributes, all tagged with the
 * changed symbol they came from.
 */
export function toRadiusNodes(raw: RawImpactResult, originQualifiedName: string): RadiusNode[] {
  const nodes: RadiusNode[] = [];

  for (const section of IMPACT_SECTIONS) {
    const bucket = raw[section];
    for (const entry of bucket.entries) {
      const ref = toSymbolRef(entry.endpoint);
      const via = entry.via ? entry.via.split(/\s*->\s*|\s*,\s*/).filter(Boolean) : [];
      nodes.push({
        ref,
        section: SECTION_TO_DOMAIN[section],
        relation: relationOf(section, entry),
        direction: directionOf(entry),
        distance: entry.depth && entry.depth > 0 ? entry.depth : 1,
        viaChain: via,
        callSite: entry.call_site
          ? { file: entry.call_site.file_path, line: entry.call_site.line }
          : undefined,
        originSymbols: [originQualifiedName],
        isTest: isTestSymbol(ref),
      });
    }
  }

  return nodes;
}

export function isDisambiguationRequired(raw: RawImpactResult): boolean {
  return raw.disambiguation_required === true;
}
