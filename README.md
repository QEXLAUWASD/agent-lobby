# Crew

A Paseo plugin that shows every managed agent crew, live, in the shape Paseo already uses for
lists: a status dot, a title, a muted second line, and a detail that opens under the row.

Two surfaces share one component:

- **Explorer pane and workspace tab** (`Crew`): the crew of the current workspace. Managed children
  stay in their crew even when they run in another workspace.
- **Sidebar item** (`Crew`): every workspace at once, grouped by project and workspace, with the
  groups that need you first. This is the wide view.

Rows are ordered by state, then age. Needs you, Failed, Working, Ready, Idle, Closed. A row
carries the `ghostline/role` label as its role, and the detail lists `room`, `owner`, `scope` and
`concern` when present. Labels are display only; the plugin grants nothing.

Selecting a row shows the workspace, directory, last error and pending permissions with Allow,
Deny and Review, plus Open, Message and Archive. Archive confirms first.

## Data

One full page-walk of `agents.list` on mount, then every `agent_update` is applied in place. There
is no periodic refetch loop; a 60 s backstop only guards against a missed event. Workspace names
come from `workspaces.list` and refresh on `workspace_update`.

## Install

```bash
cd paseo-crew
npm install
paseo plugin install "$PWD"
```

Requires Paseo 0.8.0 or newer. There is no build step.

## Develop

```bash
npm run check   # tsc + vitest
paseo plugin reload crew
```

`client/model.ts` is pure and tested: state derivation, the crew forest, collapse, filters,
grouping and search. `client/panel.tsx` is the view. `client/ui.tsx` holds the few primitives the
plugin SDK does not ship (button, chip, status dot) sized to Paseo's control geometry.
