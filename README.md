# Crew

A Paseo plugin that shows every managed agent crew, live, as a pixel-art office: a room per
workspace, a desk per agent, and a character whose outline is its role and whose pose is its state.

Two surfaces share one component:

- **Explorer pane and workspace tab** (`Crew`): the room of the current workspace, which can widen
  to every workspace. Managed children stay in their crew even when they run in another workspace,
  and a crew's parent from another workspace stands in the lounge as a visitor.
- **Sidebar item** (`Crew`): every workspace at once, rooms side by side. Workspaces whose agents
  are all closed stay folded away until a search or the Closed filter asks for them. This is the
  wide view.

## Reading the office

| State | What you see |
| --- | --- |
| Working | seated, typing, screen lit |
| Needs you | standing by the desk with a `?` |
| Failed | at the desk, error screen, a cross |
| Ready | standing by the desk with a check |
| Idle | walking the lounge for 15 minutes, then asleep at the desk |
| Closed | an empty desk, labelled |

The `ghostline/role` label picks the outline: a hat and cape for an Overseer, a headset for a Nexus,
cat ears and a tail for a Meow. Labels are display only; the plugin grants nothing.

A seat never depends on state. It comes from who an agent's parent is and when it was created, so
nobody moves when somebody else changes state or arrives. Search and the state chips dim everyone
who does not match, in place.

A message from one agent to another shows as a bubble over the sender and an envelope that travels
to the recipient's desk. Working agents also show what they are saying and which tool they are
running. Under reduced motion nothing walks or travels: characters stand where they belong and a
line joins sender and recipient.

Selecting a character, or an empty desk, shows the workspace, directory, last error and pending
permissions with Allow, Deny and Review, plus Open, Message and Archive. Archive confirms first.
The **List** toggle keeps the earlier view: rows ordered by state then age, the same detail under a
row.

## Data

One full page-walk of `agents.list` on mount and one list subscription, whose `agent_update` events
are applied in place. A 60 s backstop only guards against a missed event. Workspace names come from
`workspaces.list` and refresh on `workspace_update`.

Speech and messages come from agent timelines. Each timeline subscription costs the daemon one, so
at most eight are open: the working and waiting agents of the rooms on screen. Everyone else is
drawn from `agent_update` alone.

## Art

Every sprite is original and drawn in `client/pixel/` as code: text grids, a palette taken from the
Paseo theme, and a PNG encoder. No third-party asset is bundled.

## Install

```bash
cd paseo-crew
npm install
paseo plugin install "$PWD"
```

Built and checked against Paseo 0.11.2; it needs the timeline and list subscriptions of that SDK. There is no build step.

## Develop

```bash
npm run check   # tsc + vitest
paseo plugin reload crew
```

The pure, tested modules: `client/model.ts` (state, the crew forest, filters), `client/office-model.ts`
(rooms, desks, seats, presence), `client/exchanges.ts` (messages and bubbles), `client/feed-plan.ts`
(which timelines to subscribe to), `client/scene-model.ts` (scale, walks, marker paths) and
`client/pixel/` (the art). `client/office.tsx` is the scene and draws only through
`client/sprites.tsx`; `client/crew-view.tsx` hosts the office, the list, the detail and the dialogs.
