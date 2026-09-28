import type { PaseoAgent, PaseoApi, PaseoWorkspace } from "@getpaseo/client";
import { useCallback, useEffect, useRef, useState } from "react";

const PAGE_LIMIT = 200;
const MAX_PAGES = 10;
const BACKSTOP_MS = 60_000;
const WORKSPACE_DEBOUNCE_MS = 500;

export interface Directory {
  agents: ReadonlyMap<string, PaseoAgent>;
  workspaces: ReadonlyMap<string, PaseoWorkspace>;
  phase: "loading" | "ready" | "error";
  error: string | null;
  truncated: boolean;
  reload: () => void;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function fetchAgents(paseo: PaseoApi): Promise<{ agents: Map<string, PaseoAgent>; truncated: boolean }> {
  const agents = new Map<string, PaseoAgent>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await paseo.agents.list({
      filter: { includeArchived: false },
      sort: [{ key: "updated_at", direction: "desc" }],
      page: { limit: PAGE_LIMIT, ...(cursor ? { cursor } : {}) },
    });
    for (const entry of result.entries) agents.set(entry.agent.id, entry.agent);
    if (!result.pageInfo.hasMore || !result.pageInfo.nextCursor) return { agents, truncated: false };
    cursor = result.pageInfo.nextCursor;
  }
  return { agents, truncated: true };
}

export async function fetchWorkspaces(paseo: PaseoApi): Promise<Map<string, PaseoWorkspace>> {
  const workspaces = new Map<string, PaseoWorkspace>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await paseo.workspaces.list({
      page: { limit: PAGE_LIMIT, ...(cursor ? { cursor } : {}) },
    });
    for (const workspace of result.entries) workspaces.set(workspace.id, workspace);
    if (!result.pageInfo.hasMore || !result.pageInfo.nextCursor) break;
    cursor = result.pageInfo.nextCursor;
  }
  return workspaces;
}

/**
 * One full load, then live `agent_update` events applied in place. The
 * backstop refetch only guards against a missed event; it is not the feed.
 */
export function useDirectory(paseo: PaseoApi): Directory {
  const [agents, setAgents] = useState<Map<string, PaseoAgent>>(() => new Map());
  const [workspaces, setWorkspaces] = useState<Map<string, PaseoWorkspace>>(() => new Map());
  const [phase, setPhase] = useState<Directory["phase"]>("loading");
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const generation = useRef(0);

  const reload = useCallback(() => {
    const run = ++generation.current;
    void (async () => {
      try {
        const [loaded, loadedWorkspaces] = await Promise.all([fetchAgents(paseo), fetchWorkspaces(paseo)]);
        if (run !== generation.current) return;
        setAgents(loaded.agents);
        setWorkspaces(loadedWorkspaces);
        setTruncated(loaded.truncated);
        setError(null);
        setPhase("ready");
      } catch (cause) {
        if (run !== generation.current) return;
        setError(message(cause));
        setPhase((current) => (current === "ready" ? "ready" : "error"));
      }
    })();
  }, [paseo]);

  useEffect(() => {
    reload();
    const unsubscribeAgents = paseo.agents.subscribe((update) => {
      setAgents((current) => {
        const next = new Map(current);
        if (update.kind === "remove") {
          if (!next.delete(update.agentId)) return current;
          return next;
        }
        if (update.agent.archivedAt) {
          if (!next.delete(update.agent.id)) return current;
          return next;
        }
        next.set(update.agent.id, update.agent);
        return next;
      });
    });
    let workspaceTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribeWorkspaces = paseo.workspaces.subscribe(() => {
      if (workspaceTimer) clearTimeout(workspaceTimer);
      workspaceTimer = setTimeout(() => {
        workspaceTimer = null;
        void fetchWorkspaces(paseo).then(setWorkspaces).catch(() => {});
      }, WORKSPACE_DEBOUNCE_MS);
    });
    const backstop = setInterval(reload, BACKSTOP_MS);
    return () => {
      generation.current += 1;
      unsubscribeAgents();
      unsubscribeWorkspaces();
      if (workspaceTimer) clearTimeout(workspaceTimer);
      clearInterval(backstop);
    };
  }, [paseo, reload]);

  return { agents, workspaces, phase, error, truncated, reload };
}

export function useClock(intervalMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
