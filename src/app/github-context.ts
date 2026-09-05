/**
 * Read GitHub Actions context (event payload + env) into the fields the CLI
 * needs. Pure-ish: it only reads the env and one file the runner points at.
 */
import { readFileSync } from "node:fs";

export interface GitHubContext {
  base: string | undefined;
  head: string | undefined;
  prNumber: number | undefined;
  prTitle: string | undefined;
  prBody: string | undefined;
  repoSlug: string | undefined;
  repoBlobUrlBase: string | undefined;
}

export function readGitHubContext(env: NodeJS.ProcessEnv = process.env): GitHubContext | null {
  if (!env.GITHUB_ACTIONS) return null;

  const repoSlug = env.GITHUB_REPOSITORY;
  const server = env.GITHUB_SERVER_URL ?? "https://github.com";

  let base: string | undefined;
  let head: string | undefined;
  let prNumber: number | undefined;
  let prTitle: string | undefined;
  let prBody: string | undefined;

  if (env.GITHUB_EVENT_PATH) {
    try {
      const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8")) as {
        pull_request?: {
          number?: number;
          title?: string;
          body?: string | null;
          base?: { sha?: string };
          head?: { sha?: string };
        };
      };
      const pr = event.pull_request;
      if (pr) {
        prNumber = pr.number;
        prTitle = pr.title;
        prBody = pr.body ?? undefined;
        base = pr.base?.sha;
        head = pr.head?.sha;
      }
    } catch {
      // fall through to env-only
    }
  }

  head ??= env.GITHUB_SHA;
  const repoBlobUrlBase = repoSlug && head ? `${server}/${repoSlug}/blob/${head}` : undefined;

  return {
    base,
    head,
    prNumber,
    prTitle,
    prBody,
    repoSlug,
    repoBlobUrlBase,
  };
}
