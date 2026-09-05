/**
 * GraphProvider port — everything Blast Radius needs from Entire Graph.
 *
 * Implementations return already-validated domain value objects; the raw wire
 * format never escapes the adapter. Two implementations ship:
 *   - EntireGraphCliAdapter  (shells out to the real `entire-graph` binary)
 *   - FixtureGraphAdapter     (reads recorded JSON — dev, tests, offline demo)
 */
import type { Result } from "../domain/errors.js";
import type { ChangeSet, RadiusNode, SymbolRef } from "../domain/model.js";

export interface CommitRange {
  readonly base: string;
  readonly head: string;
}

export interface ImpactQuery {
  readonly name: string;
  readonly file: string | undefined;
  readonly line: number | undefined;
}

export interface ImpactResult {
  /** blast-radius nodes contributed by this one symbol, origin already tagged. */
  readonly nodes: readonly RadiusNode[];
  /** the graph could not resolve the name to a single definition. */
  readonly disambiguationRequired: boolean;
}

export interface GraphProvider {
  readonly kind: string;
  diff(range: CommitRange): Promise<Result<ChangeSet>>;
  impact(query: ImpactQuery): Promise<Result<ImpactResult>>;
}

export function impactQueryFor(sym: SymbolRef): ImpactQuery {
  return { name: sym.qualifiedName, file: sym.file, line: sym.line };
}
