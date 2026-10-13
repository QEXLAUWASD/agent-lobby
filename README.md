# Crew

A Paseo plugin that shows every managed agent crew, live, as a pixel-art office: a room per
workspace, a desk per agent, and a character whose outline is its role and whose pose is its state.

Two surfaces share one component:

- **Explorer pane and workspace tab** (`Crew`): the room of the current workspace, which can widen
  to every workspace. Managed children stay in their crew even when they run in another workspace,
  and a crew's parent from another workspace stands in the lounge as a visitor.
- **Sidebar item** (`Crew`): every workspace at once, as one floor plan: rooms of different sizes
  that share their walls, each with its door. Workspaces whose agents
  are all closed stay folded away until a search or the Closed filter asks for them. This is the
  wide view.

## Reading the office

| State | What you see |
| --- | --- |
| Working | seated, typing, screen lit |
| Needs you | standing by the desk with a `?` |
| Failed | at the desk, error screen, a cross |
| Ready | at the pantry with the others who have finished, check over its head, its screen left on; after 15 minutes, standing at its desk |
| Idle | resting for 15 minutes (on the sofa, dozing or with a book, at the shelves, stretching), then asleep at the desk |
| Closed | no desk: it walks out, and the room's filing cabinet counts it |

The `ghostline/role` label picks the outline: a hat and cape for an Overseer, a headset for a Nexus,
cat ears and a tail for a Meow. Labels are display only; the plugin grants nothing.

The office is small on purpose: it lives in a side pane and is meant to be glanced at. It is drawn
at about one and a half screen pixels to the art pixel, moved to the nearest size the display can
draw without blur.

A seat comes from who an agent's parent is and when it was created, never from what it is doing,
so nobody moves when somebody else starts, finishes or arrives. The one thing that frees a desk is
closing: the agent walks out, and only then do the teammates seated after it walk one desk up. A
room is as large as what it holds, with each team of a crew on a floor of its own and the pantry and
lounge beside the desks where the pane is wide enough, under them where it is not. Pressing a
room's filing cabinet lists its closed agents, each with what can still be done with it. Search and
the state chips dim everyone who does not match, in place, and mark the cabinet of a room with a
closed agent that matches.

Characters walk. When an agent starts work, finishes, goes on a break or closes, its character
walks there at one pace along the aisle and the room's corridor; a new agent walks in from the door
and a closed one walks out (up to four at a time: when more leave at once, as when a whole crew
is archived, the rest simply go). When the room itself changes (a resize, a new desk row) characters are
simply placed.

A message from one agent to another shows as a pixel bubble over the sender and an envelope that
travels to the recipient's desk. A working agent's bubble says what its tool does in a word (`Bash`,
`Read`, `Edit`, `Find`, `Web`, `Msg`, `Agent`, `Plan`), or the start of what it is saying, on up to
three short lines; a screen reader gets the full line. Under reduced motion nothing walks or travels: characters stand where
they belong and a line joins sender and recipient.

Selecting a character, or an empty desk, shows the workspace, directory, last error and pending
permissions with Allow, Deny and Review, plus Open, Message and Archive. Archive confirms first.
The **List** toggle keeps the earlier view: rows ordered by state then age, the same detail under a
row.

## Data

One full page-walk of `agents.list` on mount and one list subscription, whose `agent_update` events
are applied in place. A 60 s backstop only guards against a missed event. Workspace names come from
`workspaces.list` and refresh on `workspace_update`.

Speech and messages come from agent timelines. Each timeline subscription costs the daemon one, so
the plugin keeps at most eight open per daemon connection, however many Crew panels and surfaces
are mounted: views share one registry, and two views watching the same agent share one
subscription. Each view asks for the working and waiting agents of the rooms it has on screen;
when the eight are taken, a view goes without and asks again half a minute later. Everyone else is
drawn from `agent_update` alone. A typed message is never read as a message between agents.

## Art

Every sprite is original and drawn in `client/pixel/` as code: text grids, a palette taken from the
Paseo theme, and a PNG encoder. No third-party asset is bundled.

## Install

```bash
cd paseo-crew
npm install
paseo plugin install "$PWD"
```

Requires Paseo 0.11.2 or newer: that is the first release whose daemon hands clients a message
between agents with its verified sender. There is no build step.

## Develop

```bash
npm run check   # tsc + vitest
paseo plugin reload crew
```

The pure, tested modules: `client/model.ts` (state, the crew forest, filters), `client/office-model.ts`
(rooms, desks, seats, zones, breaks, presence), `client/exchanges.ts` (messages and bubbles), `client/feed-plan.ts`
and `client/feed-hub.ts` (which timelines to subscribe to, and the shared budget), `client/scene-model.ts` (scale, walks, marker paths) and
`client/pixel/` (the art). `client/office.tsx` is the scene and draws only through
`client/sprites.tsx`; `client/crew-view.tsx` hosts the office, the list, the detail and the dialogs.
