import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { fetchWorkspaces } from "./use-directory";

const RESYNC_DEBOUNCE_MS = 500;

/**
 * Puts a Lobby button on every workspace header. Pressing it opens Lobby as an Explorer tab,
 * next to Files and Changes; the tab then persists with that workspace's layout. Header buttons
 * are registered per workspace, so the set follows the workspace list.
 */
export function addCrewHeaderButtons(client: PluginClientContext): () => void {
  const buttons = new Map<string, PluginButtonRegistration>();
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function sync(): Promise<void> {
    const workspaces = await fetchWorkspaces(client.paseo);
    if (disposed) return;
    for (const [workspaceId, button] of buttons) {
      if (workspaces.has(workspaceId)) continue;
      button.remove();
      buttons.delete(workspaceId);
    }
    for (const workspaceId of workspaces.keys()) {
      if (buttons.has(workspaceId)) continue;
      buttons.set(
        workspaceId,
        client.addHeaderButton({
          id: "lobby",
          workspaceId,
          button: {
            title: "Show Lobby in Explorer",
            icon: "Users",
            behavior: {
              kind: "action",
              onPress() {
                client.openPanel("lobby", { workspaceId, location: "explorer" });
              },
            },
          },
        }),
      );
    }
  }

  const resync = () => void sync().catch(() => {});
  resync();
  const unsubscribe = client.paseo.workspaces.subscribe(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      resync();
    }, RESYNC_DEBOUNCE_MS);
  });

  return () => {
    disposed = true;
    if (timer) clearTimeout(timer);
    unsubscribe();
    for (const button of buttons.values()) button.remove();
    buttons.clear();
  };
}
