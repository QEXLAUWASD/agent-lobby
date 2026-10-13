import { FEED_CAP } from "./feed-plan";

/**
 * One registry of live timeline subscriptions for the whole plugin. Every
 * mounted Crew view (a panel per workspace tab, the global surface) takes its
 * subscriptions from here, so `cap` bounds what the daemon carries however many
 * views are open, and two views watching the same agent share one subscription.
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

export interface FeedHub<Update> {
  /**
   * A share of the agent's subscription, opening it if nobody has one yet.
   * Null when the budget is spent on other agents, or the subscription could
   * not be opened: the caller goes without and asks again later.
   */
  acquire(agentId: string, handler: (update: Update) => void): Lease | null;
  /** How many daemon subscriptions are open. */
  size(): number;
}

export function createFeedHub<Update extends { event: { type: string } }>(
  source: TimelineSource<Update>,
  cap: number = FEED_CAP,
): FeedHub<Update> {
  const open = new Map<
    string,
    { handlers: Set<(update: Update) => void>; stop: () => void; ready: Promise<unknown> }
  >();
  return {
    size: () => open.size,
    acquire(agentId, handler) {
      let entry = open.get(agentId);
      if (!entry) {
        if (open.size >= cap) return null;
        const handlers = new Set<(update: Update) => void>();
        try {
          const subscription = source.subscribe(agentId, (update) => {
            const current = open.get(agentId);
            if (!current || current.handlers !== handlers) return;
            // An error means the SDK has already released the subscription.
            if (update.event.type === "error") open.delete(agentId);
            for (const notify of [...handlers]) notify(update);
          });
          entry = { handlers, stop: () => subscription.stop(), ready: subscription.ready };
        } catch {
          return null;
        }
        open.set(agentId, entry);
      }
      const held = entry;
      held.handlers.add(handler);
      let released = false;
      return {
        ready: held.ready,
        release() {
          if (released) return;
          released = true;
          held.handlers.delete(handler);
          if (held.handlers.size > 0 || open.get(agentId) !== held) return;
          open.delete(agentId);
          held.stop();
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
