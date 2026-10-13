import { FEED_CAP } from "./feed-plan";

/**
 * One registry of live timeline subscriptions for the whole plugin. Every
 * mounted Crew view (a panel per workspace tab, the global surface) takes its
 * subscriptions from here, so `cap` bounds what the daemon carries however many
 * views are open, and two views watching the same agent share one subscription.
 *
 * The budget is shared fairly. Each view that wants subscriptions is entitled
 * to `floor(cap / views)` of them, at least one. When the budget is spent, a
 * view below its share takes a slot from a view above its share: that view's
 * least important agent that nobody else is watching. A view at or above its
 * share never takes from anyone, so a slot cannot be passed back and forth.
 */

export interface TimelineSource<Update> {
  /** Opens one daemon subscription. May throw. */
  subscribe(agentId: string, handler: (update: Update) => void): { stop(): void; ready: Promise<unknown> };
}

export interface Lease {
  /** Gives the share back; the subscription closes when nobody holds one. */
  release(): void;
  /** Resolves once the daemon delivers live events; rejects if it never will. */
  ready: Promise<unknown>;
}

export interface Claim {
  /** Who is asking: one token per mounted view. */
  view: object;
  /** How much the view wants this agent; lower is more. A view's highest-ranked lease is the first it loses. */
  rank: number;
  /** The hub took the lease back for another view. It is already released. */
  onRevoked(): void;
}

export interface FeedHub<Update> {
  /**
   * A share of the agent's subscription, opening it if nobody has one yet.
   * Null when the budget is spent and this view has had its share, or the
   * subscription could not be opened: the caller goes without and asks later.
   */
  acquire(agentId: string, handler: (update: Update) => void, claim?: Claim): Lease | null;
  /** How many daemon subscriptions are open. */
  size(): number;
}

interface Holder<Update> {
  handler: (update: Update) => void;
  claim: Claim;
}

interface Entry<Update> {
  holders: Set<Holder<Update>>;
  stop: () => void;
  ready: Promise<unknown>;
}

interface Slot<Update> {
  agentId: string;
  entry: Entry<Update>;
  holder: Holder<Update>;
}

const ANYONE = {};

export function createFeedHub<Update extends { event: { type: string } }>(
  source: TimelineSource<Update>,
  cap: number = FEED_CAP,
): FeedHub<Update> {
  const open = new Map<string, Entry<Update>>();

  const held = (view: object) => {
    let count = 0;
    for (const entry of open.values()) for (const holder of entry.holders) if (holder.claim.view === view) count += 1;
    return count;
  };
  const views = () => {
    const all = new Set<object>();
    for (const entry of open.values()) for (const holder of entry.holders) all.add(holder.claim.view);
    return all;
  };

  /** The slot `asker` may take: it is below its share and somebody else is above theirs. */
  const slotFor = (asker: object): Slot<Update> | null => {
    const everyone = views();
    everyone.add(asker);
    const share = Math.max(1, Math.floor(cap / everyone.size));
    if (held(asker) >= share) return null;
    let victim: Slot<Update> | null = null;
    let most = share;
    for (const view of everyone) {
      const count = held(view);
      if (view === asker || count <= most) continue;
      // Only an agent this view alone is watching frees a slot.
      let worst: Slot<Update> | null = null;
      for (const [agentId, entry] of open) {
        if (entry.holders.size !== 1) continue;
        const [holder] = entry.holders as unknown as [Holder<Update>];
        if (holder.claim.view !== view) continue;
        if (!worst || holder.claim.rank > worst.holder.claim.rank) worst = { agentId, entry, holder };
      }
      if (worst) {
        victim = worst;
        most = count;
      }
    }
    return victim;
  };

  /** Opens the daemon subscription for an agent and fans its updates out to `holders`. Null if it cannot be opened. */
  const connect = (agentId: string, holders: Set<Holder<Update>>): Entry<Update> | null => {
    try {
      const subscription = source.subscribe(agentId, (update) => {
        const current = open.get(agentId);
        if (!current || current.holders !== holders) return;
        // An error means the SDK has already released the subscription.
        if (update.event.type === "error") open.delete(agentId);
        for (const holder of [...holders]) holder.handler(update);
      });
      const entry = { holders, stop: () => subscription.stop(), ready: subscription.ready };
      open.set(agentId, entry);
      return entry;
    } catch {
      return null;
    }
  };

  return {
    size: () => open.size,
    acquire(agentId, handler, claim = { view: ANYONE, rank: 0, onRevoked() {} }) {
      let entry = open.get(agentId) ?? null;
      if (!entry) {
        const victim = open.size >= cap ? slotFor(claim.view) : null;
        if (open.size >= cap && !victim) return null;
        if (victim) {
          // Close the slot first, so the daemon never carries more than the cap.
          open.delete(victim.agentId);
          victim.entry.stop();
        }
        entry = connect(agentId, new Set());
        if (victim) {
          if (entry) {
            victim.entry.holders.clear();
            victim.holder.claim.onRevoked();
          } else if (!connect(victim.agentId, victim.entry.holders)) {
            // The newcomer could not be opened and neither could the slot it was given: its holder loses it after all.
            victim.entry.holders.clear();
            victim.holder.claim.onRevoked();
          }
        }
        if (!entry) return null;
      }
      const mine = entry;
      const holder: Holder<Update> = { handler, claim };
      mine.holders.add(holder);
      let released = false;
      return {
        ready: mine.ready,
        release() {
          if (released) return;
          released = true;
          if (!mine.holders.delete(holder)) return;
          // A slot that was closed and reopened lives on under the same holders.
          const current = open.get(agentId);
          if (mine.holders.size > 0 || !current || current.holders !== mine.holders) return;
          open.delete(agentId);
          current.stop();
        },
      };
    },
  };
}

const hubs = new WeakMap<object, FeedHub<never>>();

/** The hub for one daemon connection: the same `key` always gets the same hub. */
export function hubFor<Update extends { event: { type: string } }>(
  key: object,
  source: () => TimelineSource<Update>,
): FeedHub<Update> {
  let hub = hubs.get(key) as FeedHub<Update> | undefined;
  if (!hub) {
    hub = createFeedHub(source());
    hubs.set(key, hub as unknown as FeedHub<never>);
  }
  return hub;
}
