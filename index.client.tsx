import type { PluginClientContext } from "@getpaseo/plugin/client";
import { addCrewHeaderButtons } from "./client/header-buttons";
import { CrewPanel, CrewSurface } from "./client/main";

export default function contribute(client: PluginClientContext) {
  const disposers = [
    client.addWorkspacePanel({
      id: "crew",
      title: "Crew",
      icon: "Users",
      context: "workspace",
      locations: ["explorer", "workspace"],
      Component: CrewPanel,
    }),
    client.addSurface("crew", CrewSurface),
    addCrewHeaderButtons(client),
    client.addCommandCenterItem({
      id: "open-crew",
      title: "Open Crew",
      icon: "Users",
      keywords: ["agents", "crew", "subagents", "orchestration", "room"],
      context: "workspace",
      onSelect: (context) => context.openPanel("crew", { location: "explorer" }),
    }),
    client.addCommandCenterItem({
      id: "open-crew-all",
      title: "Open Crew across workspaces",
      icon: "Users",
      keywords: ["agents", "crew", "rooms"],
      context: "global",
      onSelect: (context) => context.openSurface("crew"),
    }),
  ];
  return () => {
    for (const dispose of disposers) dispose();
  };
}
