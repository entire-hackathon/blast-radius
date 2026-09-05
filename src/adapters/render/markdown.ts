/**
 * The human-facing PR comment.
 *
 * Layout: a badge strip, a Mermaid graph of the change and its blast radius,
 * the scope table (the reason this tool exists), a copy-paste test command,
 * then collapsed details — evidence, the test rationale, and the full node
 * list. Every symbol links to `file:line`; with a blob-url base it is a real
 * GitHub link, without one it is still a readable locator.
 */
import type { AnalysisReport } from "../../domain/model.js";
import type { Renderer, RenderedReport } from "../../ports/renderer.js";
import { COMMENT_MARKER } from "../../ports/renderer.js";

export interface MarkdownRendererOptions {
  /** e.g. "https://github.com/org/repo/blob/<sha>" — makes locators clickable. */
  readonly repoBlobUrlBase?: string;
  /** total test count in the suite, for the "6 of ~N" phrasing. */
  readonly suiteTestCount?: number;
  /** tool URL for the footer. */
  readonly toolUrl?: string;
  /** draw the Mermaid diagram (default true). */
  readonly diagram?: boolean;
  /** max nodes in the diagram before it truncates (default 16). */
  readonly diagramMaxNodes?: number;
}

const SEV_ICON = { high: "🔴", medium: "🟠", low: "🟡" } as const;
const SEV_COLOR = { high: "da3633", medium: "d29922", low: "bf8700" } as const;

/** 40-hex commit SHAs render as 7 chars; refs like `main` pass through. */
function shortSha(ref: string): string {
  return /^[0-9a-f]{40}$/i.test(ref) ? ref.slice(0, 7) : ref;
}

/** shields.io escaping: `-` -> `--`, `_` -> `__`, space -> `_`. */
function badge(label: string, message: string, color: string): string {
  const enc = (s: string) =>
    encodeURIComponent(s.replace(/-/g, "--").replace(/_/g, "__").replace(/ /g, "_"));
  return `![${label}](https://img.shields.io/badge/${enc(label)}-${enc(message)}-${color})`;
}

export class MarkdownRenderer implements Renderer {
  readonly format = "markdown" as const;
  private readonly opts: MarkdownRendererOptions;

  constructor(opts: MarkdownRendererOptions = {}) {
    this.opts = opts;
  }

  render(report: AnalysisReport): RenderedReport {
    const out: string[] = [];

    out.push(COMMENT_MARKER);
    out.push("## 🧨 Blast Radius");
    out.push("");
    out.push(this.badgeStrip(report));
    out.push("");

    if (report.intent) {
      const title = report.intent.title || report.intent.body.slice(0, 160);
      out.push(`> **Intent** — _${JSON.stringify(title)}_  `);
      out.push(`> source: \`${report.intent.source}\`${this.checkpointNote(report)}`);
      out.push("");
    } else {
      out.push("> **Intent** — none found (no PR body, linked issue, or checkpoint trailer).");
      out.push("> Scope drift can't be judged; showing radius + tests only.");
      out.push("");
    }

    const diagram = this.diagram(report);
    if (diagram) {
      out.push(diagram, "");
    }

    /* -------- scope -------- */
    if (report.findings.length > 0) {
      out.push(`### ⚠️ Scope check — ${report.findings.length} change(s) look outside the ask`);
      out.push("");
      out.push("| | Changed symbol | Why | Dependents |");
      out.push("|--|--|--|--|");
      for (const f of report.findings) {
        const sym = this.locator(f.symbol.file, f.symbol.line, `\`${f.symbol.qualifiedName}\``);
        out.push(`| ${SEV_ICON[f.severity]} | ${sym} | ${f.reason} | ${f.dependentsCount} |`);
      }
      out.push("");
      out.push(this.evidenceBlock(report));
      out.push("");
    } else if (report.intent) {
      out.push("### ✅ Scope check — every change maps to the stated intent");
      out.push("");
    }

    out.push(this.testsSection(report));
    out.push("");
    out.push(this.radiusSection(report));
    out.push("");

    out.push("---");
    out.push(this.footer(report));

    return {
      format: "markdown",
      contentType: "text/markdown",
      body: out.join("\n"),
      marker: COMMENT_MARKER,
    };
  }

  /* ------------------------------------------------------------ sections --- */

  private badgeStrip(r: AnalysisReport): string {
    const s = r.radiusSummary;
    const maxSev = r.findings.reduce<"high" | "medium" | "low" | null>((acc, f) => {
      const rank = { high: 3, medium: 2, low: 1 };
      return !acc || rank[f.severity] > rank[acc] ? f.severity : acc;
    }, null);

    const badges = [
      badge("blast radius", `${s.totalNodes} nodes`, "1f6feb"),
      badge("modules", String(s.moduleCount), "1f6feb"),
    ];
    if (s.serviceCount > 0) badges.push(badge("services", String(s.serviceCount), "8250df"));
    badges.push(
      r.findings.length === 0
        ? badge("scope", "clean", "2da44e")
        : badge("scope", `${r.findings.length} findings`, maxSev ? SEV_COLOR[maxSev] : "d29922"),
    );
    const gaps = r.testPlan.coverageGaps.length;
    badges.push(
      gaps > 0
        ? badge("tests", `${r.testPlan.selected.length} · ${gaps} gaps`, "bf8700")
        : badge("tests", `${r.testPlan.selected.length} selected`, "2da44e"),
    );
    badges.push(
      badge("intent", r.intent ? r.intent.source : "none", r.intent ? "8250df" : "8b949e"),
    );
    return badges.join(" ");
  }

  /**
   * A Mermaid flowchart: changed symbols in the centre (red = flagged, amber =
   * clean), with the callers that reach them fanned out to the left. This is
   * the graph the whole tool runs on, shown directly.
   */
  private diagram(r: AnalysisReport): string | null {
    if (this.opts.diagram === false) return null;
    const cap = this.opts.diagramMaxNodes ?? 16;

    const changedNames = new Set(r.changedSymbols.map((c) => c.ref.qualifiedName));
    const changed = r.changedSymbols.filter((c) => {
      // a new symbol only earns a node if something in the radius points at it
      if (
        c.changeType === "added" &&
        !r.radiusNodes.some((n) => n.origins.includes(c.ref.qualifiedName))
      ) {
        return false;
      }
      // drop a container (class/interface) if one of its own members also changed
      // — the member node says everything the container would, without the island
      const isContainer = c.ref.kind === "class" || c.ref.kind === "interface";
      if (isContainer) {
        const prefix = `${c.ref.qualifiedName}.`;
        if ([...changedNames].some((n) => n.startsWith(prefix))) return false;
      }
      return true;
    });
    if (changed.length === 0) return null;

    const callers = r.radiusNodes
      .filter((n) => n.section === "callers")
      .sort((a, b) => a.distance - b.distance);
    if (callers.length === 0) return null;

    const id = mermaidIds();
    const lines: string[] = ["```mermaid", "flowchart LR"];
    let count = 0;

    for (const c of changed) {
      if (count >= cap) break;
      const cls = c.isFinding ? "finding" : "changed";
      lines.push(
        `  ${id.for(c.ref.qualifiedName)}["${mermaidLabel(c.ref.qualifiedName)}"]:::${cls}`,
      );
      count++;
    }

    // call edges among the changed symbols themselves
    for (const e of r.originEdges) {
      if (id.has(e.from) && id.has(e.to)) {
        lines.push(`  ${id.for(e.from)} --> ${id.for(e.to)}`);
      }
    }

    const shownCallers = new Set<string>();
    for (const n of callers) {
      if (count >= cap) {
        lines.push(`  more["+ ${callers.length - shownCallers.size} more callers…"]:::more`);
        break;
      }
      const key = n.ref.qualifiedName;
      if (shownCallers.has(key)) continue;
      shownCallers.add(key);
      const target =
        n.via.length > 0 && id.has(n.via[n.via.length - 1]!)
          ? n.via[n.via.length - 1]!
          : n.origins[0];
      if (!target || !id.has(target)) continue;
      if (!id.has(key)) {
        const cls = n.isTest ? "test" : "caller";
        lines.push(`  ${id.for(key)}["${mermaidLabel(key)}"]:::${cls}`);
        count++;
      }
      lines.push(`  ${id.for(key)} --> ${id.for(target)}`);
    }

    lines.push(
      "  classDef finding fill:#ffdcdc,stroke:#e5534b,color:#86181d;",
      "  classDef changed fill:#fff3d4,stroke:#d4a72c,color:#7a5c00;",
      "  classDef caller fill:#eef2f6,stroke:#8c959f,color:#1f2328;",
      "  classDef test fill:#e6f4ea,stroke:#4c9a5f,color:#1a4d2e;",
      "  classDef more fill:#f6f8fa,stroke:#d0d7de,color:#57606a;",
      "```",
    );

    const body = lines.join("\n");
    const legend = [
      body.includes(":::finding") ? "🟥 flagged — outside the stated intent" : "",
      body.includes(":::changed") ? "🟨 changed, in scope" : "",
      body.includes(":::caller") ? "⬜ caller (unchanged, in the radius)" : "",
      body.includes(":::test") ? "🟩 covering test" : "",
    ].filter(Boolean);

    return `${body}\n<sub>${legend.join("  ·  ")} · arrow = calls / depends on</sub>`;
  }

  private checkpointNote(r: AnalysisReport): string {
    return r.range.checkpoint ? ` · \`${r.range.checkpoint}\`` : "";
  }

  private evidenceBlock(r: AnalysisReport): string {
    const lines = ["<details><summary>Evidence for these findings</summary>", ""];
    for (const f of r.findings) {
      lines.push(`**\`${f.symbol.qualifiedName}\`** — ${this.plain(f.symbol.file, f.symbol.line)}`);
      lines.push(`_strategy: ${f.strategy}_`);
      const seen = new Set<string>();
      for (const e of f.evidence) {
        const loc = e.location ? ` — \`${e.location}\`` : "";
        const line = `- ${e.label}${loc}`;
        if (seen.has(line)) continue;
        seen.add(line);
        lines.push(line);
        if (e.relationPath.length > 1) lines.push(`  \`${e.relationPath.join(" → ")}\``);
      }
      lines.push("");
    }
    lines.push("</details>");
    return lines.join("\n");
  }

  private testsSection(r: AnalysisReport): string {
    const tp = r.testPlan;
    if (tp.selected.length === 0) {
      return [
        "### 🧪 Recommended tests — none found in the blast radius",
        "",
        tp.coverageGaps.length > 0
          ? `No test in the graph reaches: ${tp.coverageGaps.map((g) => `\`${g}\``).join(", ")}. Verify manually.`
          : "",
      ].join("\n");
    }
    const suite = this.opts.suiteTestCount ? ` of ~${this.opts.suiteTestCount}` : "";
    const cover =
      tp.coverageGaps.length === 0
        ? "covers every changed symbol"
        : `covers all but ${tp.coverageGaps.length}`;
    const lines = [`### 🧪 Recommended tests — ${tp.selected.length}${suite}, ${cover}`, ""];
    if (tp.command) lines.push("```bash", tp.command, "```", "");

    lines.push("<details><summary>Why these tests</summary>", "");
    lines.push("| Test | Covers | Distance |");
    lines.push("|--|--|--|");
    for (const t of tp.selected) {
      lines.push(
        `| ${this.locator(t.ref.file, t.ref.line, `\`${t.ref.name}\``)} | ${t.coversSymbols
          .map((c) => `\`${c}\``)
          .join(", ")} | ${t.distance} |`,
      );
    }
    if (tp.coverageGaps.length > 0) {
      lines.push("");
      lines.push(
        `**Not covered by any test:** ${tp.coverageGaps
          .map((g) => `\`${g}\``)
          .join(", ")} — add tests or verify manually.`,
      );
    }
    lines.push("", "</details>");
    return lines.join("\n");
  }

  private radiusSection(r: AnalysisReport): string {
    const rel = r.radiusSummary.byRelation;
    const relSummary = Object.entries(rel)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `\`${k}\` ${v}`)
      .join(" · ");

    const lines = [
      `<details><summary>Full blast radius — ${r.radiusSummary.totalNodes} nodes across ${r.radiusSummary.fileCount} files</summary>`,
      "",
      relSummary ? `${relSummary}` : "",
      "",
      "| Node | Relation | Dist | From |",
      "|--|--|--|--|",
    ];
    for (const n of r.radiusNodes.slice(0, 60)) {
      const name = this.locator(n.ref.file, n.ref.line, `\`${n.ref.qualifiedName}\``);
      const tag = n.isTest ? " 🧪" : "";
      lines.push(
        `| ${name}${tag} | \`${n.relation}\` | ${n.distance} | ${n.origins
          .map((o) => `\`${o}\``)
          .join(", ")} |`,
      );
    }
    if (r.radiusNodes.length > 60) {
      lines.push(`| _…and ${r.radiusNodes.length - 60} more (see \`--format json\`)_ | | | |`);
    }
    lines.push("", "</details>");
    return lines.join("\n");
  }

  private footer(r: AnalysisReport): string {
    const tool = this.opts.toolUrl ?? "Blast Radius";
    const base = shortSha(r.range.base);
    const head = shortSha(r.range.head);
    const rerun = `\`blast-radius review --base ${base} --head ${head}\``;
    return `<sub>Generated by ${tool} from Entire Graph · \`${base}\`..\`${head}\` · every row links to the graph path that justifies it · re-run: ${rerun}</sub>`;
  }

  /* ------------------------------------------------------------- helpers --- */

  private plain(file?: string, line?: number): string {
    if (!file) return "_(location unknown)_";
    return line ? `\`${file}:${line}\`` : `\`${file}\``;
  }

  private locator(file: string | undefined, line: number | undefined, text?: string): string {
    const label = text ?? (file ? this.plain(file, line) : "?");
    if (!file) return label;
    if (!this.opts.repoBlobUrlBase) return line ? `${label} \`${file}:${line}\`` : label;
    const anchor = line ? `#L${line}` : "";
    return `[${label}](${this.opts.repoBlobUrlBase}/${file}${anchor})`;
  }
}

/* --------------------------------------------------------------- mermaid --- */

function mermaidIds() {
  const map = new Map<string, string>();
  return {
    has: (name: string) => map.has(name),
    for(name: string): string {
      const existing = map.get(name);
      if (existing) return existing;
      const gen = `n${map.size}`;
      map.set(name, gen);
      return gen;
    },
  };
}

/** Mermaid node text: strip the characters that break the `["…"]` form. */
function mermaidLabel(raw: string): string {
  return raw
    .replace(/"/g, "'")
    .replace(/[[\]{}|]/g, "")
    .slice(0, 48);
}
