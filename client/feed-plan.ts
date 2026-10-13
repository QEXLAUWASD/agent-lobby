import type { CrewNode, CrewState } from "./model";
import { activityAt } from "./model";

/**
 * Which agents get a live timeline subscription. Each one costs the daemon a
 * subscription, so the office holds at most `cap` of them and everyone else is
 * drawn from `agent_update` alone.
 */

export interface FeedCandidate {
  id: string;
  state: CrewState;
  /** Last activity, epoch ms; breaks ties between agents of the same state. */
  activityAt: number;
}

export const FEED_CAP = 8;
/** A subscription is kept at least this long once made, and this long after its agent goes quiet. */
export const FEED_HOLD_MS = 20_000;
/** After a subscription fails, its agent is left alone this long. */
export const FEED_RETRY_MS = 30_000;

/** Working agents are the ones producing a timeline; one waiting on you is about to. */
const WANTED: Partial<Record<CrewState, number>> = { working: 0, "needs-input": 1 };

export function isWanted(state: CrewState): boolean {
  return WANTED[state] !== undefined;
}

/** Every agent of a forest as a candidate; pass the roots of the room the view is showing. */
export function candidatesOf(roots: readonly CrewNode[]): FeedCandidate[] {
  const out: FeedCandidate[] = [];
  const walk = (node: CrewNode) => {
    const at = Date.parse(activityAt(node.agent));
    out.push({ id: node.agent.id, state: node.state, activityAt: Number.isFinite(at) ? at : 0 });
    for (const child of node.children) walk(child);
  };
  for (const root of roots) walk(root);
  return out;
}

export interface FeedPlanInput {
  /** The agents the view is showing, in any order. */
  candidates: readonly FeedCandidate[];
  /** agentId → when its subscription was made. */
  current: ReadonlyMap<string, number>;
  /** agentId → when it was last wanted while subscribed. */
  lastWanted: ReadonlyMap<string, number>;
  /** agentId → when its subscription last failed. */
  failed?: ReadonlyMap<string, number>;
  now: number;
  cap?: number;
  holdMs?: number;
  retryMs?: number;
}

export interface FeedPlan {
  /** Every agent that should be subscribed after this plan, best first. */
  selected: string[];
  subscribe: string[];
  unsubscribe: string[];
  /** When the plan can next change without any input changing, or null. */
  recheckAt: number | null;
}

/**
 * Chooses the subscriptions. A subscribed agent that is still wanted keeps its
 * slot against a newcomer of the same rank; a working newcomer may take the slot
 * of one that only waits, once that one has been held `holdMs`. An agent that
 * stops being wanted, or leaves the view, lingers `holdMs` in case it flickers
 * back, but gives its slot up at once to anyone wanted.
 */
export function planFeed(input: FeedPlanInput): FeedPlan {
  const cap = Math.max(0, input.cap ?? FEED_CAP);
  const holdMs = input.holdMs ?? FEED_HOLD_MS;
  const retryMs = input.retryMs ?? FEED_RETRY_MS;
  const { now, current } = input;
  let recheckAt: number | null = null;
  const recheck = (at: number) => {
    if (at > now) recheckAt = recheckAt === null ? at : Math.min(recheckAt, at);
  };

  const wanted: Array<FeedCandidate & { rank: number; held: boolean; settled: boolean }> = [];
  const wantedIds = new Set<string>();
  for (const candidate of input.candidates) {
    const rank = WANTED[candidate.state];
    if (rank === undefined || wantedIds.has(candidate.id)) continue;
    const failedAt = input.failed?.get(candidate.id);
    if (failedAt !== undefined && failedAt + retryMs > now) {
      recheck(failedAt + retryMs);
      continue;
    }
    const since = current.get(candidate.id);
    const held = since !== undefined;
    const settled = held && since + holdMs <= now;
    if (held && !settled) recheck((since as number) + holdMs);
    wantedIds.add(candidate.id);
    wanted.push({ ...candidate, rank, held, settled });
  }
  // Held and not yet past its hold: immovable. Then by rank, incumbents before
  // newcomers within a rank, the more recently active first.
  wanted.sort(
    (a, b) =>
      Number(b.held && !b.settled) - Number(a.held && !a.settled) ||
      a.rank - b.rank ||
      Number(b.held) - Number(a.held) ||
      b.activityAt - a.activityAt ||
      a.id.localeCompare(b.id),
  );
  const selected = wanted.slice(0, cap).map((candidate) => candidate.id);

  const lingering: Array<{ id: string; until: number }> = [];
  for (const [id, since] of current) {
    if (wantedIds.has(id)) continue;
    const until = Math.max(since, input.lastWanted.get(id) ?? since) + holdMs;
    if (until > now) lingering.push({ id, until });
  }
  lingering.sort((a, b) => b.until - a.until || a.id.localeCompare(b.id));
  for (const entry of lingering.slice(0, Math.max(0, cap - selected.length))) {
    selected.push(entry.id);
    recheck(entry.until);
  }

  const keep = new Set(selected);
  return {
    selected,
    subscribe: selected.filter((id) => !current.has(id)),
    unsubscribe: [...current.keys()].filter((id) => !keep.has(id)),
    recheckAt,
  };
}
