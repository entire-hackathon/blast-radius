/**
 * Fold the per-changed-symbol impact node lists into one blast radius.
 *
 * Rules:
 *  - dedupe by (file, qualifiedName): the same downstream symbol reached from
 *    two changed symbols is one node, keeping the SHORTEST distance and the
 *    union of origin symbols;
 *  - a node that is itself one of the changed symbols is dropped (it is the
 *    origin, not the blast);
 *  - section totals count distinct nodes per section after dedupe.
 */
import type { BlastRadius, ChangedSymbol, RadiusNode, RadiusSection } from "./model.js";
import { symbolKey } from "./model.js";

const SECTIONS: readonly RadiusSection[] = [
  "callers",
  "callees",
  "type_consumers",
  "data_flows",
  "co_changes",
  "siblings",
];

function emptyTotals(): Record<RadiusSection, number> {
  return { callers: 0, callees: 0, type_consumers: 0, data_flows: 0, co_changes: 0, siblings: 0 };
}

function mergeNode(existing: RadiusNode, incoming: RadiusNode): RadiusNode {
  const origins = new Set([...existing.originSymbols, ...incoming.originSymbols]);
  const closer = incoming.distance < existing.distance ? incoming : existing;
  return {
    ...closer,
    originSymbols: [...origins],
    // keep the richer via chain / call site if the closer one lacks it
    viaChain: closer.viaChain.length > 0 ? closer.viaChain : existing.viaChain,
    callSite: closer.callSite ?? existing.callSite,
    isTest: existing.isTest || incoming.isTest,
  };
}

export function computeBlastRadius(
  origin: readonly ChangedSymbol[],
  nodeLists: readonly (readonly RadiusNode[])[],
): BlastRadius {
  const originKeys = new Set(origin.map((s) => symbolKey(s.ref)));
  const originNames = new Set(origin.map((s) => s.ref.qualifiedName));
  const byKey = new Map<string, RadiusNode>();

  for (const list of nodeLists) {
    for (const node of list) {
      if (node.ref.external) {
        // external callees (fmt.Errorf, etc.) are noise for a review summary
        if (node.section === "callees") continue;
      }
      const key = symbolKey(node.ref);
      // a changed symbol is the origin of the blast, never part of it; match on
      // the (file, name) key, falling back to the qualified name alone so a
      // cosmetically different path (./ prefix, case) still excludes it.
      if (originKeys.has(key) || originNames.has(node.ref.qualifiedName)) continue;
      const existing = byKey.get(key);
      byKey.set(key, existing ? mergeNode(existing, node) : node);
    }
  }

  const nodes = [...byKey.values()].sort(
    (a, b) => a.distance - b.distance || a.ref.qualifiedName.localeCompare(b.ref.qualifiedName),
  );

  const sectionTotals = emptyTotals();
  for (const node of nodes) sectionTotals[node.section] += 1;

  return { origin: [...origin], nodes, sectionTotals };
}

/** Nodes that sit on a caller path (what a reviewer most wants to see). */
export function upstreamNodes(radius: BlastRadius): RadiusNode[] {
  return radius.nodes.filter((n) => n.section === "callers");
}

export { SECTIONS as RADIUS_SECTIONS };
