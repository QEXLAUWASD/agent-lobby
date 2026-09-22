import type { PluginSurfaceProps, PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { CrewView } from "./panel";

export function CrewPanel(props: PluginWorkspacePanelProps) {
  return <CrewView {...props} scope={props.workspaceId} />;
}

export function CrewSurface(props: PluginSurfaceProps) {
  return <CrewView {...props} scope={null} />;
}
