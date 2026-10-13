import type { PaseoAgent, PaseoWorkspace } from "@getpaseo/client";
import { describe, expect, it } from "vitest";
import {
  buildForest,
  countStates,
  crewState,
  filterForest,
  flatten,
  formatAge,
  groupByWorkspace,
  matches,
  nextAgeChange,
  summary,
} from "../client/model";

function agent(overrides: Partial<PaseoAgent> & { id: string }): PaseoAgent {
  return {
    provider: "claude",
    cwd: "/repo",
    workspaceId: "ws-a",
    model: "claude-opus-5",
    thinkingOptionId: null,
    createdAt: "2026-09-22T10:00:00.000Z",
    updatedAt: "2026-09-22T10:00:00.000Z",
    lastUserMessageAt: null,
    status: "idle",
    activeTurn: null,
    capabilities: {} as PaseoAgent["capabilities"],
    currentModeId: null,
    availableModes: [],
    pendingPermissions: [],
    persistence: null,
    title: null,
    labels: {},
    ...overrides,
  } as PaseoAgent;
}

describe("crewState", () => {
  it("ranks pending permissions above everything, and closed above ready", () => {
    expect(crewState(agent({ id: "a", status: "running", pendingPermissions: [{ id: "p" } as never] }))).toBe(
      "needs-input",
    );
    expect(crewState(agent({ id: "b", status: "closed", requiresAttention: true, attentionReason: "finished" }))).toBe(
      "closed",
    );
    expect(crewState(agent({ id: "c", status: "idle", requiresAttention: true, attentionReason: "finished" }))).toBe(
      "ready",
    );
    expect(crewState(agent({ id: "d", status: "idle", attentionReason: "error" }))).toBe("failed");
    expect(crewState(agent({ id: "e", status: "initializing" }))).toBe("working");
  });
});

describe("buildForest", () => {
  const root = agent({ id: "root", title: "Lead", createdAt: "2026-09-22T09:00:00.000Z" });
  const childHere = agent({ id: "c1", labels: { "paseo.parent-agent-id": "root" }, status: "running" });
  const childElsewhere = agent({
    id: "c2",
    workspaceId: "ws-b",
    labels: { "paseo.parent-agent-id": "root" },
  });
  const stranger = agent({ id: "s", workspaceId: "ws-b" });
  const archived = agent({ id: "z", archivedAt: "2026-09-22T11:00:00.000Z" });

  it("keeps cross-workspace children in their crew and drops archived agents", () => {
    const roots = buildForest([root, childHere, childElsewhere, stranger, archived], "ws-a");
    expect(roots.map((node) => node.agent.id)).toEqual(["root"]);
    expect(roots[0].children.map((node) => node.agent.id)).toEqual(["c1", "c2"]);
    expect(roots[0].descendants).toBe(2);
  });

  it("orders roots by state, then creation", () => {
    const later = agent({ id: "later", createdAt: "2026-09-22T12:00:00.000Z", status: "error" });
    const roots = buildForest([root, later], "ws-a");
    expect(roots.map((node) => node.agent.id)).toEqual(["later", "root"]);
  });

  it("survives a parent cycle", () => {
    const a = agent({ id: "a", labels: { "paseo.parent-agent-id": "b" } });
    const b = agent({ id: "b", labels: { "paseo.parent-agent-id": "a" } });
    const roots = buildForest([a, b], "ws-a");
    expect(flatten(roots, new Set()).length).toBeGreaterThan(0);
  });

  it("flattens with collapse and filters while keeping matching descendants", () => {
    const roots = buildForest([root, childHere, childElsewhere], null);
    expect(flatten(roots, new Set(["root"])).map((node) => node.agent.id)).toEqual(["root"]);
    const working = filterForest(roots, (node) => node.state === "working");
    expect(working.map((node) => node.agent.id)).toEqual(["root"]);
    expect(working[0].children.map((node) => node.agent.id)).toEqual(["c1"]);
    expect(countStates(working)).toMatchObject({ working: 1, idle: 1 });
  });

  it("groups by workspace with attention first", () => {
    const needy = agent({ id: "n", workspaceId: "ws-b", pendingPermissions: [{ id: "p" } as never] });
    const workspaces = new Map<string, PaseoWorkspace>([
      ["ws-a", { id: "ws-a", name: "alpha", projectDisplayName: "proj" } as PaseoWorkspace],
    ]);
    const groups = groupByWorkspace(buildForest([root, needy], null), workspaces);
    expect(groups.map((group) => group.name)).toEqual(["ws-b", "proj · alpha"]);
    expect(summary(groups[0].counts)).toBe("1 agent · 1 need you");
  });
});

describe("helpers", () => {
  it("formats ages", () => {
    const now = Date.parse("2026-09-22T12:00:00.000Z");
    expect(formatAge("2026-09-22T11:59:40.000Z", now)).toBe("now");
    expect(formatAge("2026-09-22T11:30:00.000Z", now)).toBe("30m");
    expect(formatAge("2026-09-22T06:00:00.000Z", now)).toBe("6h");
    expect(formatAge("2026-09-19T12:00:00.000Z", now)).toBe("3d");
  });

  it("matches across title, labels and workspace name", () => {
    const a = agent({ id: "abc", title: "Fix login", labels: { "ghostline/role": "meow" } });
    expect(matches(a, "MEOW", null)).toBe(true);
    expect(matches(a, "alpha", "Alpha")).toBe(true);
    expect(matches(a, "nope", null)).toBe(false);
  });
});

describe("nextAgeChange", () => {
  const then = Date.parse("2026-09-22T10:00:00.000Z");
  const iso = new Date(then).toISOString();

  it("is the very moment the age reads differently, for ages from seconds to weeks", () => {
    const minute = 60_000;
    for (const age of [0, 10_000, 44_999, 45_000, 80_000, 29.4 * minute, 29.5 * minute, 58 * minute, 59.6 * minute, 90 * minute, 5.2 * 60 * minute, 23.2 * 60 * minute, 23.6 * 60 * minute, 40 * 60 * minute, 9.7 * 24 * 60 * minute]) {
      const now = then + age;
      const next = nextAgeChange(iso, now);
      expect(next).not.toBeNull();
      expect(next!).toBeGreaterThan(now);
      expect(formatAge(iso, next! - 1)).toBe(formatAge(iso, now));
      expect(formatAge(iso, next!)).not.toBe(formatAge(iso, now));
    }
  });

  it("has nothing to wait for when the timestamp cannot be read", () => {
    expect(nextAgeChange("not a date", then)).toBeNull();
  });
});
