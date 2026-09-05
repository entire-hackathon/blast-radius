/**
 * The human-facing PR comment.
 *
 * Layout: one headline metrics line, the scope table (the reason this tool
 * exists), a copy-paste test command, then collapsed details — evidence, the
 * test rationale, and the full node list. Every symbol is a link to
 * `file:line`; with a blob-url base it is a real GitHub link, without one it is
 * still a readable locator.
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
}

const SEV_ICON = { high: "🔴", medium: "🟠", low: "🟡" } as const;

export class MarkdownRenderer implements Renderer {
  readonly format = "markdown" as const;
  private readonly opts: MarkdownRendererOptions;

  constructor(opts: MarkdownRendererOptions = {}) {
    this.opts = opts;
  }

  render(report: AnalysisReport): RenderedReport {
    const L = (file?: string, line?: number, text?: string) => this.locator(file, line, text);
    const out: string[] = [];

    out.push(COMMENT_MARKER);
    out.push("## 🧨 Blast Radius");
    out.push("");
    out.push(this.headline(report));
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

    /* -------- scope -------- */
    if (report.findings.length > 0) {
      out.push(`### ⚠️ Scope check — ${report.findings.length} change(s) look outside the ask`);
      out.push("");
      out.push("| | Changed symbol | Why | Dependents |");
      out.push("|--|--|--|--|");
      for (const f of report.findings) {
        const sym = L(f.symbol.file, f.symbol.line, `\`${f.symbol.qualifiedName}\``);
        out.push(`| ${SEV_ICON[f.severity]} | ${sym} | ${f.reason} | ${f.dependentsCount} |`);
      }
      out.push("");
      out.push(this.evidenceBlock(report));
      out.push("");
    } else if (report.intent) {
      out.push("### ✅ Scope check — every change maps to the stated intent");
      out.push("");
    }

    /* -------- tests -------- */
    out.push(this.testsSection(report));
    out.push("");

    /* -------- radius -------- */
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

  private headline(r: AnalysisReport): string {
    const s = r.radiusSummary;
    const parts = [
      `**${s.totalNodes} node${s.totalNodes === 1 ? "" : "s"}**`,
      `${s.moduleCount} module${s.moduleCount === 1 ? "" : "s"}`,
    ];
    if (s.serviceCount > 0) parts.push(`${s.serviceCount} service${s.serviceCount === 1 ? "" : "s"}`);
    parts.push(
      r.findings.length > 0
        ? `**${r.findings.length} scope finding${r.findings.length === 1 ? "" : "s"}**`
        : "0 scope findings",
    );
    const gaps = r.testPlan.coverageGaps.length;
    parts.push(
      `**${r.testPlan.selected.length} test${r.testPlan.selected.length === 1 ? "" : "s"}**` +
        (gaps > 0 ? ` (${gaps} gap${gaps === 1 ? "" : "s"})` : ""),
    );
    return parts.join(" · ");
  }

  private checkpointNote(r: AnalysisReport): string {
    return r.range.checkpoint ? ` · \`${r.range.checkpoint}\`` : "";
  }

  private evidenceBlock(r: AnalysisReport): string {
    const lines = ["<details><summary>Evidence for these findings</summary>", ""];
    for (const f of r.findings) {
      lines.push(`**\`${f.symbol.qualifiedName}\`** — ${this.plain(f.symbol.file, f.symbol.line)}`);
      lines.push(`_strategy: ${f.strategy}_`);
      for (const e of f.evidence) {
        const loc = e.location ? ` — \`${e.location}\`` : "";
        lines.push(`- ${e.label}${loc}`);
        if (e.relationPath.length > 1) {
          lines.push(`  \`${e.relationPath.join(" → ")}\``);
        }
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
    const lines = [
      `### 🧪 Recommended tests — ${tp.selected.length}${suite}, ${cover}`,
      "",
    ];
    if (tp.command) {
      lines.push("```bash", tp.command, "```", "");
    }
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
      .map(([k, v]) => `${k}: ${v}`)
      .join(" · ");
    return [
      `<details><summary>Full blast radius — ${r.radiusSummary.totalNodes} nodes across ${r.radiusSummary.fileCount} files</summary>`,
      "",
      relSummary ? `_${relSummary}_` : "",
      "",
      "_Full node list is in the JSON / SARIF output (`--format json`)._",
      "",
      "</details>",
    ].join("\n");
  }

  private footer(r: AnalysisReport): string {
    const tool = this.opts.toolUrl ?? "Blast Radius";
    const rerun = `\`blast-radius review --base ${r.range.base} --head ${r.range.head}\``;
    return `<sub>Generated by ${tool} from Entire Graph · \`${r.range.base}\`..\`${r.range.head}\` · every row links to the graph path that justifies it · re-run: ${rerun}</sub>`;
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
