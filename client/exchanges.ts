/**
 * What agents say and send, reduced to what the office shows right now.
 *
 * Timeline payloads are normalized into `FeedEvent`s, a reducer folds them into
 * `FeedState`, and `visibleFeed` answers "what is on screen at this instant".
 * Everything here is pure; the clock is always an argument.
 */

export type ExchangeEvent = "message" | "finished" | "errored" | "permission-required" | "closed";

export type ToolStatus = "running" | "completed" | "failed" | "canceled";

export type FeedEvent =
  | {
      kind: "exchange";
      /** The daemon's message-id; the dedupe key across refetch and subscribe. */
      id: string;
      /** Null when the daemon delivered the message without its sender. */
      from: string | null;
      fromTitle: string | null;
      to: string;
      event: ExchangeEvent;
      text: string;
      at: number;
      seq?: number;
    }
  | {
      kind: "say";
      agentId: string;
      /** Chunks of one assistant message share a key. */
      key: string;
      text: string;
      /** Live chunks append; history entries are already merged and replace. */
      append: boolean;
      at: number;
      seq?: number;
    }
  | { kind: "tool"; agentId: string; callId: string; name: string; status: ToolStatus; at: number; seq?: number }
  | { kind: "failed"; agentId: string; text: string; at: number }
  | { kind: "permission"; agentId: string; requestId: string; text: string; at: number }
  | { kind: "permission-resolved"; agentId: string; requestId: string; at: number }
  | { kind: "turn-ended"; agentId: string; at: number }
  /** The timeline epoch was replaced; sequence numbers start over. */
  | { kind: "reset"; agentId: string };

export const BUBBLE_MAX_CHARS = 48;
const SAY_BUFFER_CHARS = 400;
const AGENT_MESSAGE_CALL_PREFIX = "paseo-agent-message:";

/** First non-empty line, without leading markdown markers, cut to `max` characters. */
export function firstLine(text: string, max = BUBBLE_MAX_CHARS): string {
  let line = "";
  for (const candidate of text.split(/\r?\n/)) {
    const cleaned = candidate
      .replace(/^[\s#>*\-`]+/, "")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned) {
      line = cleaned;
      break;
    }
  }
  // Bound the work before counting code points: a line can be megabytes long.
  const points = Array.from(line.slice(0, max * 4));
  if (points.length <= max) return line.length > max * 4 ? `${points.join("")}…` : line;
  return `${points.slice(0, max - 1).join("").trimEnd()}…`;
}

/** `mcp__paseo__send_agent_prompt` reads as `send agent prompt`; `Bash` stays `Bash`. */
export function toolLabel(name: string): string {
  const last = name.split("__").filter(Boolean).pop() ?? name;
  return firstLine(last.includes("_") ? last.replace(/_/g, " ") : last, 24) || "tool";
}

export interface Envelope {
  kind: "agent-message" | "agent-notification";
  event: ExchangeEvent;
  from: string;
  fromTitle: string | null;
  messageId: string;
  text: string;
}

function unescapeXml(value: string): string | null {
  if (/[<>]|&(?!amp;|lt;|gt;|quot;|apos;)/.test(value)) return null;
  return value.replace(/&(amp|lt|gt|quot|apos);/g, (_, entity: string) => {
    switch (entity) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      default:
        return "'";
    }
  });
}

const NOTIFICATION_EVENTS: readonly string[] = ["finished", "errored", "permission-required", "closed"];

/**
 * Reads a raw `<paseo-system version="1" …>` envelope, as strictly as the daemon
 * that wrote it: the envelope must be the whole text, attributes may not repeat,
 * and the body must be XML-escaped. A body that merely contains something shaped
 * like an envelope is escaped text and comes back as text; a raw `<` or `>`
 * anywhere inside rejects the whole thing. Human messages (`kind="user-message"`)
 * and anything else that is not agent-to-agent return null.
 */
export function parseEnvelope(text: string): Envelope | null {
  const envelope = /^<paseo-system((?:\s+[a-z-]+="[^"<>]*")+)>\n([\s\S]*)\n<\/paseo-system>$/.exec(text);
  if (!envelope) return null;
  const attributes = new Map<string, string>();
  for (const match of (envelope[1] as string).matchAll(/\s+([a-z-]+)="([^"<>]*)"/g)) {
    const value = unescapeXml(match[2] as string);
    if (value === null || attributes.has(match[1] as string)) return null;
    attributes.set(match[1] as string, value);
  }
  if (attributes.get("version") !== "1") return null;
  const messageId = attributes.get("message-id");
  const from = attributes.get("source-agent-id");
  const body = unescapeXml(envelope[2] as string);
  if (!messageId || !from || body === null) return null;
  const kind = attributes.get("kind");
  const fromTitle = attributes.get("source-agent-title") || null;
  if (kind === "agent-message") {
    if (attributes.has("event")) return null;
    return { kind, event: "message", from, fromTitle, messageId, text: body };
  }
  if (kind === "agent-notification") {
    const event = attributes.get("event");
    if (!event || !NOTIFICATION_EVENTS.includes(event)) return null;
    return { kind, event: event as ExchangeEvent, from, fromTitle, messageId, text: body };
  }
  return null;
}

/** The slice of a timeline item this module reads. Everything is optional: it is wire data. */
export interface TimelineItemLike {
  type?: unknown;
  text?: unknown;
  messageId?: unknown;
  callId?: unknown;
  name?: unknown;
  status?: unknown;
  detail?: unknown;
  agentMessage?: unknown;
}

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

const EXCHANGE_EVENTS: readonly string[] = ["message", ...NOTIFICATION_EVENTS];

/** A notification's body is the daemon's boilerplate ("Agent 7510… finished"); the bubble says what happened. */
const NOTIFICATION_TEXT: Record<Exclude<ExchangeEvent, "message">, string> = {
  finished: "Done",
  errored: "Failed",
  "permission-required": "Needs permission",
  closed: "Closed",
};

function exchangeText(event: ExchangeEvent, body: string): string {
  return event === "message" ? firstLine(body) : NOTIFICATION_TEXT[event];
}
const TOOL_STATUSES: readonly string[] = ["running", "completed", "failed", "canceled"];

interface ItemContext {
  agentId: string;
  at: number;
  seq?: number;
  turnId?: string | null;
  /** True for live stream chunks, false for merged history entries. */
  live: boolean;
}

function exchangeFromToolCall(item: TimelineItemLike, context: ItemContext): FeedEvent | null {
  const callId = text(item.callId) ?? "";
  const carried = item.agentMessage as
    | { event?: unknown; sender?: { id?: unknown; title?: unknown }; text?: unknown }
    | null
    | undefined;
  const tagged = callId.startsWith(AGENT_MESSAGE_CALL_PREFIX);
  if (!carried && !(tagged && item.name === "agent_message")) return null;
  const id = tagged ? callId.slice(AGENT_MESSAGE_CALL_PREFIX.length) : callId;
  if (!id) return null;
  const detail = item.detail as { text?: unknown } | null | undefined;
  const named = text(carried?.event);
  const event = named && EXCHANGE_EVENTS.includes(named) ? (named as ExchangeEvent) : "message";
  return {
    kind: "exchange",
    id,
    from: text(carried?.sender?.id) || null,
    fromTitle: text(carried?.sender?.title) || null,
    to: context.agentId,
    event,
    text: exchangeText(event, text(carried?.text) ?? text(detail?.text) ?? ""),
    at: context.at,
    ...(context.seq === undefined ? {} : { seq: context.seq }),
  };
}

function eventsFromItem(item: TimelineItemLike | null | undefined, context: ItemContext): FeedEvent[] {
  if (!item) return [];
  const seq = context.seq === undefined ? {} : { seq: context.seq };
  switch (item.type) {
    case "user_message": {
      // Daemons that predate the projection deliver the envelope as the message text.
      const envelope = parseEnvelope(text(item.text) ?? "");
      if (!envelope) return [];
      return [
        {
          kind: "exchange",
          id: envelope.messageId,
          from: envelope.from,
          fromTitle: envelope.fromTitle,
          to: context.agentId,
          event: envelope.event,
          text: exchangeText(envelope.event, envelope.text),
          at: context.at,
          ...seq,
        },
      ];
    }
    case "assistant_message": {
      const body = text(item.text);
      if (!body) return [];
      const key = text(item.messageId) ?? (context.turnId ? `turn:${context.turnId}` : "run");
      return [{ kind: "say", agentId: context.agentId, key, text: body, append: context.live, at: context.at, ...seq }];
    }
    case "tool_call": {
      const exchange = exchangeFromToolCall(item, context);
      if (exchange) return [exchange];
      const callId = text(item.callId);
      const status = text(item.status);
      if (!callId || !status || !TOOL_STATUSES.includes(status)) return [];
      return [
        {
          kind: "tool",
          agentId: context.agentId,
          callId,
          name: toolLabel(text(item.name) ?? ""),
          status: status as ToolStatus,
          at: context.at,
          ...seq,
        },
      ];
    }
    default:
      return [];
  }
}

/** The slice of a live `timeline.subscribe` payload this module reads. */
export interface StreamPayloadLike {
  agentId: string;
  timestamp?: string;
  seq?: number;
  event: {
    type: string;
    item?: TimelineItemLike;
    turnId?: string;
    error?: string;
    requestId?: string;
    request?: { id?: unknown; title?: unknown; name?: unknown; description?: unknown };
    epoch?: string;
  };
}

/**
 * Normalizes one live event. It is stamped with `receivedAt`, the viewer's own
 * clock, so a daemon whose clock disagrees cannot hide or pin a bubble.
 */
export function eventsFromStream(payload: StreamPayloadLike, receivedAt: number): FeedEvent[] {
  const { agentId, event } = payload;
  switch (event.type) {
    case "timeline":
      return eventsFromItem(event.item, {
        agentId,
        at: receivedAt,
        seq: payload.seq,
        turnId: event.turnId,
        live: true,
      });
    case "turn_failed":
      return [{ kind: "failed", agentId, text: firstLine(text(event.error) ?? "") || "Failed", at: receivedAt }];
    case "turn_completed":
    case "turn_canceled":
      return [{ kind: "turn-ended", agentId, at: receivedAt }];
    case "permission_requested": {
      const requestId = text(event.request?.id);
      if (!requestId) return [];
      const label = text(event.request?.title) ?? text(event.request?.name) ?? text(event.request?.description) ?? "";
      return [{ kind: "permission", agentId, requestId, text: firstLine(label) || "Needs you", at: receivedAt }];
    }
    case "permission_resolved": {
      const requestId = text(event.requestId);
      return requestId ? [{ kind: "permission-resolved", agentId, requestId, at: receivedAt }] : [];
    }
    case "replacement":
      return [{ kind: "reset", agentId }];
    default:
      return [];
  }
}

/** The slice of a `timeline.refetch` entry this module reads. */
export interface HistoryEntryLike {
  item: TimelineItemLike;
  timestamp: string;
  turnId?: string;
  seqEnd?: number;
}

/**
 * Normalizes a refetched page, oldest first. Entries keep the daemon's timestamp,
 * so anything older than its TTL never shows; a timestamp ahead of the viewer's
 * clock is clamped to `receivedAt`.
 */
export function eventsFromHistory(
  agentId: string,
  entries: readonly HistoryEntryLike[],
  receivedAt: number,
): FeedEvent[] {
  const out: FeedEvent[] = [];
  for (const entry of entries) {
    const stamped = Date.parse(entry.timestamp);
    out.push(
      ...eventsFromItem(entry.item, {
        agentId,
        at: Number.isFinite(stamped) ? Math.min(stamped, receivedAt) : 0,
        seq: entry.seqEnd,
        turnId: entry.turnId,
        live: false,
      }),
    );
  }
  return out;
}

export type BubbleTone = "say" | "tool" | "tell" | "ask" | "alert";

export interface Bubble {
  agentId: string;
  tone: BubbleTone;
  text: string;
  at: number;
  expiresAt: number;
  /** Identity of what the bubble is about: a message key, call id, request id or message-id. */
  key: string;
  /** For `tool`: how the call stands. */
  status?: ToolStatus;
  /** For `tell`: who is being addressed. */
  to?: string;
}

export interface Exchange {
  id: string;
  from: string | null;
  fromTitle: string | null;
  to: string;
  event: ExchangeEvent;
  text: string;
  at: number;
  expiresAt: number;
}

export interface FeedTtl {
  say: number;
  toolRunning: number;
  toolDone: number;
  tell: number;
  ask: number;
  alert: number;
  exchange: number;
}

export const DEFAULT_TTL: FeedTtl = {
  say: 8_000,
  // A running call holds its bubble until it settles; this only bounds a lost completion.
  toolRunning: 45_000,
  toolDone: 2_500,
  tell: 10_000,
  // A permission prompt stays up until it is resolved; the character's state carries it after.
  ask: 300_000,
  alert: 20_000,
  exchange: 10_000,
};

const TONE_RANK: Record<BubbleTone, number> = { say: 0, tool: 0, tell: 1, alert: 2, ask: 3 };

/** How long a seen message-id is remembered after its exchange expired. */
const SEEN_RETENTION_MS = 600_000;

export interface FeedState {
  bubbles: ReadonlyMap<string, Bubble>;
  exchanges: readonly Exchange[];
  /** message-id → when it was first seen. */
  seen: ReadonlyMap<string, number>;
  /** agentId → highest timeline seq already applied. */
  cursors: ReadonlyMap<string, number>;
  /** agentId → raw text of the assistant message being streamed. */
  drafts: ReadonlyMap<string, { key: string; text: string }>;
}

export const EMPTY_FEED: FeedState = {
  bubbles: new Map(),
  exchanges: [],
  seen: new Map(),
  cursors: new Map(),
  drafts: new Map(),
};

interface Draft {
  bubbles: Map<string, Bubble>;
  exchanges: Exchange[];
  seen: Map<string, number>;
  cursors: Map<string, number>;
  drafts: Map<string, { key: string; text: string }>;
}

/** A louder bubble holds its place until it expires; an equal or louder one replaces it. */
function post(draft: Draft, bubble: Bubble): void {
  const current = draft.bubbles.get(bubble.agentId);
  if (current && current.key !== bubble.key) {
    const alive = current.expiresAt > bubble.at;
    if (alive && TONE_RANK[current.tone] > TONE_RANK[bubble.tone]) return;
    // History is stamped earlier than what is live; it may still be louder.
    if (bubble.at < current.at && TONE_RANK[bubble.tone] <= TONE_RANK[current.tone]) return;
  }
  draft.bubbles.set(bubble.agentId, bubble);
}

function apply(draft: Draft, event: FeedEvent, ttl: FeedTtl): void {
  if (event.kind === "reset") {
    draft.cursors.delete(event.agentId);
    draft.drafts.delete(event.agentId);
    return;
  }
  if (event.kind === "exchange") {
    // message-id is the identity, whichever path and sequence number delivered it.
    if (draft.seen.has(event.id)) return;
    draft.seen.set(event.id, event.at);
    const expiresAt = event.at + ttl.exchange;
    draft.exchanges.push({
      id: event.id,
      from: event.from,
      fromTitle: event.fromTitle,
      to: event.to,
      event: event.event,
      text: event.text,
      at: event.at,
      expiresAt,
    });
    if (event.from && event.text) {
      post(draft, {
        agentId: event.from,
        tone: "tell",
        text: event.text,
        at: event.at,
        expiresAt: event.at + ttl.tell,
        key: event.id,
        to: event.to,
      });
    }
    return;
  }
  if ("seq" in event && event.seq !== undefined) {
    const agentId = event.agentId;
    const cursor = draft.cursors.get(agentId);
    if (cursor !== undefined && event.seq <= cursor) return;
    draft.cursors.set(agentId, event.seq);
  }
  switch (event.kind) {
    case "say": {
      const previous = draft.drafts.get(event.agentId);
      const raw =
        event.append && previous?.key === event.key ? previous.text + event.text : event.text;
      const kept = raw.slice(0, SAY_BUFFER_CHARS);
      draft.drafts.set(event.agentId, { key: event.key, text: kept });
      const line = firstLine(kept);
      if (!line) return;
      post(draft, {
        agentId: event.agentId,
        tone: "say",
        text: line,
        at: event.at,
        expiresAt: event.at + ttl.say,
        key: event.key,
      });
      return;
    }
    case "tool": {
      const running = event.status === "running";
      post(draft, {
        agentId: event.agentId,
        tone: "tool",
        text: event.name,
        at: event.at,
        expiresAt: event.at + (running ? ttl.toolRunning : ttl.toolDone),
        key: event.callId,
        status: event.status,
      });
      return;
    }
    case "failed":
      post(draft, {
        agentId: event.agentId,
        tone: "alert",
        text: event.text,
        at: event.at,
        expiresAt: event.at + ttl.alert,
        key: `failed:${event.at}`,
      });
      return;
    case "permission":
      post(draft, {
        agentId: event.agentId,
        tone: "ask",
        text: event.text,
        at: event.at,
        expiresAt: event.at + ttl.ask,
        key: event.requestId,
      });
      return;
    case "permission-resolved": {
      const current = draft.bubbles.get(event.agentId);
      if (current?.tone === "ask" && current.key === event.requestId) draft.bubbles.delete(event.agentId);
      return;
    }
    case "turn-ended": {
      // A call still marked running when its turn ends will never report back.
      const current = draft.bubbles.get(event.agentId);
      if (current?.tone === "tool" && current.status === "running") draft.bubbles.delete(event.agentId);
      draft.drafts.delete(event.agentId);
      return;
    }
  }
}

/**
 * Folds events into the feed and drops what expired before `now`. Applying the
 * same events twice changes nothing: exchanges dedupe on message-id, timeline
 * items on their sequence number.
 */
export function reduceFeed(
  state: FeedState,
  events: readonly FeedEvent[],
  now: number,
  ttl: FeedTtl = DEFAULT_TTL,
): FeedState {
  const draft: Draft = {
    bubbles: new Map(state.bubbles),
    exchanges: [...state.exchanges],
    seen: new Map(state.seen),
    cursors: new Map(state.cursors),
    drafts: new Map(state.drafts),
  };
  for (const event of events) apply(draft, event, ttl);
  for (const [agentId, bubble] of draft.bubbles) {
    if (bubble.expiresAt <= now) draft.bubbles.delete(agentId);
  }
  for (const [id, at] of draft.seen) {
    if (at + SEEN_RETENTION_MS <= now) draft.seen.delete(id);
  }
  return {
    bubbles: draft.bubbles,
    exchanges: draft.exchanges.filter((exchange) => exchange.expiresAt > now).sort((a, b) => a.at - b.at),
    seen: draft.seen,
    cursors: draft.cursors,
    drafts: draft.drafts,
  };
}

/** Forgets agents that left the office, so a long session does not accumulate them. */
export function retainAgents(state: FeedState, keep: ReadonlySet<string>): FeedState {
  const stale = (source: ReadonlyMap<string, unknown>) => [...source.keys()].some((agentId) => !keep.has(agentId));
  if (!stale(state.bubbles) && !stale(state.cursors) && !stale(state.drafts)) return state;
  const only = <T,>(source: ReadonlyMap<string, T>) =>
    new Map([...source].filter(([agentId]) => keep.has(agentId)));
  return {
    ...state,
    bubbles: only(state.bubbles),
    cursors: only(state.cursors),
    drafts: only(state.drafts),
  };
}

export interface VisibleFeed {
  bubbles: ReadonlyMap<string, Bubble>;
  exchanges: readonly Exchange[];
  /** When the next thing expires, or null when nothing is showing. */
  nextExpiry: number | null;
}

/** What is on screen at `now`. */
export function visibleFeed(state: FeedState, now: number): VisibleFeed {
  const bubbles = new Map<string, Bubble>();
  let nextExpiry: number | null = null;
  const note = (expiresAt: number) => {
    nextExpiry = nextExpiry === null ? expiresAt : Math.min(nextExpiry, expiresAt);
  };
  for (const [agentId, bubble] of state.bubbles) {
    if (bubble.expiresAt <= now) continue;
    bubbles.set(agentId, bubble);
    note(bubble.expiresAt);
  }
  const exchanges = state.exchanges.filter((exchange) => exchange.expiresAt > now);
  for (const exchange of exchanges) note(exchange.expiresAt);
  return { bubbles, exchanges, nextExpiry };
}
