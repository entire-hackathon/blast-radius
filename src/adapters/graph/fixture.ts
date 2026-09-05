/**
 * FixtureGraphAdapter — serves recorded `entire-graph` JSON from a directory.
 *
 * Layout (either form works):
 *   <dir>/scenario.json         { "diff": "...", "impacts": { "<qname>": "..." } }
 *   <dir>/diff.json             + <dir>/impact-<qname>.json   (convention)
 *
 * This is what makes the whole pipeline runnable with only Node — every test
 * and the offline demo go through here.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { BlastRadiusError, err, ok, type Result } from "../../domain/errors.js";
import { toChangeSet, toRadiusNodes } from "../../domain/graph-mapping.js";
import { rawDiffResult, rawImpactResult } from "../../domain/graph-schema.js";
import type { ChangeSet } from "../../domain/model.js";
import type {
  CommitRange,
  GraphProvider,
  ImpactQuery,
  ImpactResult,
} from "../../ports/graph-provider.js";

const scenarioSchema = z.object({
  diff: z.string(),
  impacts: z.record(z.string()).default({}),
});

function sanitize(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, "_");
}

export class FixtureGraphAdapter implements GraphProvider {
  readonly kind = "fixture";
  private readonly dir: string;
  private manifest: z.infer<typeof scenarioSchema> | null = null;
  private manifestLoaded = false;

  constructor(dir: string) {
    this.dir = dir;
  }

  private async readJson(file: string): Promise<Result<unknown>> {
    try {
      const raw = await readFile(path.resolve(this.dir, file), "utf8");
      return ok(JSON.parse(raw));
    } catch (e) {
      return err(
        BlastRadiusError.graph(`fixture not found or invalid: ${file}`, (e as Error).message),
      );
    }
  }

  private async loadManifest(): Promise<void> {
    if (this.manifestLoaded) return;
    this.manifestLoaded = true;
    const res = await this.readJson("scenario.json");
    if (res.ok) {
      const parsed = scenarioSchema.safeParse(res.value);
      if (parsed.success) this.manifest = parsed.data;
    }
  }

  async diff(_range: CommitRange): Promise<Result<ChangeSet>> {
    await this.loadManifest();
    const file = this.manifest?.diff ?? "diff.json";
    const res = await this.readJson(file);
    if (!res.ok) return res;
    const parsed = rawDiffResult.safeParse(res.value);
    if (!parsed.success) {
      return err(BlastRadiusError.schema("fixture diff failed schema", parsed.error.message));
    }
    return ok(toChangeSet(parsed.data));
  }

  async impact(query: ImpactQuery): Promise<Result<ImpactResult>> {
    await this.loadManifest();
    const candidates = [
      this.manifest?.impacts[query.name],
      `impact-${sanitize(query.name)}.json`,
      `impact-${sanitize(query.name.split(".").pop() ?? query.name)}.json`,
      path.join("impact", `${sanitize(query.name)}.json`),
    ].filter((c): c is string => !!c);

    for (const file of candidates) {
      const res = await this.readJson(file);
      if (!res.ok) continue;
      const parsed = rawImpactResult.safeParse(res.value);
      if (!parsed.success) {
        return err(BlastRadiusError.schema(`fixture ${file} failed schema`, parsed.error.message));
      }
      return ok({
        nodes: toRadiusNodes(parsed.data, query.name),
        disambiguationRequired: parsed.data.disambiguation_required,
      });
    }

    // a symbol with no recorded impact simply contributes nothing
    return ok({ nodes: [], disambiguationRequired: false });
  }
}
