/**
 * Headline metrics for the report: how wide is this change, really.
 */
import type { BlastRadius, RadiusSummary } from "./model.js";

export interface SummaryOptions {
  /** how many leading path segments define a "module" (default 2). */
  readonly moduleDepth?: number;
  /** relations that mark a service boundary. */
  readonly serviceRelations?: readonly string[];
}

const DEFAULT_SERVICE_RELATIONS = ["HANDLES_ROUTE", "HTTP_CALLS", "EMITS", "LISTENS_ON"];

function moduleOf(file: string, depth: number): string {
  const parts = file.replace(/\\/g, "/").split("/");
  if (parts.length <= 1) return parts[0] ?? file;
  return parts.slice(0, depth).join("/");
}

export function summarizeRadius(radius: BlastRadius, opts: SummaryOptions = {}): RadiusSummary {
  const moduleDepth = opts.moduleDepth ?? 2;
  const serviceRelations = new Set(opts.serviceRelations ?? DEFAULT_SERVICE_RELATIONS);

  const files = new Set<string>();
  const modules = new Set<string>();
  const services = new Set<string>();
  const byRelation: Record<string, number> = {};
  let testCount = 0;

  for (const node of radius.nodes) {
    if (node.ref.file) {
      files.add(node.ref.file);
      modules.add(moduleOf(node.ref.file, moduleDepth));
    }
    byRelation[node.relation] = (byRelation[node.relation] ?? 0) + 1;
    if (serviceRelations.has(node.relation) && node.ref.file) {
      services.add(moduleOf(node.ref.file, moduleDepth));
    }
    if (node.isTest) testCount += 1;
  }

  return {
    totalNodes: radius.nodes.length,
    fileCount: files.size,
    moduleCount: modules.size,
    serviceCount: services.size,
    testCount,
    byRelation,
  };
}
