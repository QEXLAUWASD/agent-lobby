import { usePaseo, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { FlatList, Icon, Modal, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import type { PaseoAgent } from "@getpaseo/client";
import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  activityAt,
  buildForest,
  countStates,
  displayModel,
  displayTitle,
  filterForest,
  flatten,
  formatAge,
  groupByWorkspace,
  matches,
  roleOf,
  STATE_LABEL,
  STATE_ORDER,
  summary,
  type CrewNode,
  type CrewState,
} from "./model";
import { Button, Chip, Empty, IconButton, Muted, StatusDot, font, pressStyle, radius, space, stateColor } from "./ui";
import { useClock, useDirectory } from "./use-directory";

type Filter = CrewState | "all";

type Row =
  | { kind: "group"; key: string; name: string; text: string }
  | { kind: "agent"; key: string; node: CrewNode };

type Dialog =
  | { kind: "message"; agent: PaseoAgent }
  | { kind: "archive"; agent: PaseoAgent }
  | { kind: "permission"; agent: PaseoAgent; requestId: string };

interface CrewViewProps extends PluginSurfaceProps {
  scope: string | null;
}

export function CrewView({ scope, theme, host, layout, navigation }: CrewViewProps) {
  const paseo = usePaseo();
  const toast = useToast();
  const now = useClock();
  const directory = useDirectory(paseo);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const { colors } = theme;

  const roots = useMemo(
    () => buildForest(directory.agents.values(), scope),
    [directory.agents, scope],
  );
  const counts = useMemo(() => countStates(roots), [roots]);
  const visible = useMemo(() => {
    const workspaceName = (agent: PaseoAgent) =>
      agent.workspaceId ? (directory.workspaces.get(agent.workspaceId)?.name ?? null) : null;
    return filterForest(
      roots,
      (node) =>
        (filter === "all" || node.state === filter) &&
        matches(node.agent, query, workspaceName(node.agent)),
    );
  }, [roots, filter, query, directory.workspaces]);

  const rows = useMemo<Row[]>(() => {
    if (scope !== null) {
      return flatten(visible, collapsed).map((node) => ({ kind: "agent", key: node.agent.id, node }));
    }
    const out: Row[] = [];
    for (const group of groupByWorkspace(visible, directory.workspaces)) {
      out.push({
        kind: "group",
        key: `group:${group.workspaceId}`,
        name: group.name,
        text: summary(group.counts),
      });
      for (const node of flatten(group.roots, collapsed)) {
        out.push({ kind: "agent", key: node.agent.id, node });
      }
    }
    return out;
  }, [scope, visible, collapsed, directory.workspaces]);

  const toggleCollapsed = useCallback((id: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const openAgent = useCallback(
    (agent: PaseoAgent) => navigation?.openAgent({ agentId: agent.id, serverId: host.id }),
    [navigation, host.id],
  );

  const run = useCallback(
    async (label: string, action: () => Promise<unknown>) => {
      setBusy(true);
      try {
        await action();
        toast.show(label, { variant: "success" });
        setDialog(null);
        setDraft("");
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );

  const respond = useCallback(
    (agent: PaseoAgent, requestId: string, allow: boolean) =>
      run(allow ? "Allowed" : "Denied", () =>
        paseo.agents.ref(agent.id).respondToPermission({
          requestId,
          response: allow ? { behavior: "allow" } : { behavior: "deny", message: "Denied from Crew" },
        }),
      ),
    [paseo, run],
  );

  const renderRow = useCallback(
    ({ item }: { item: Row }) => {
      if (item.kind === "group") {
        return (
          <View
            style={{
              paddingHorizontal: space.lg,
              paddingTop: space.lg,
              paddingBottom: space.xs,
              flexDirection: "row",
              alignItems: "baseline",
              gap: space.sm,
            }}
          >
            <Text
              numberOfLines={1}
              style={{ color: colors.foreground, fontSize: font.sm, fontWeight: "600", flexShrink: 1 }}
            >
              {item.name}
            </Text>
            <Muted theme={theme} size={font.xs}>
              {item.text}
            </Muted>
          </View>
        );
      }
      const { node } = item;
      const { agent } = node;
      const isSelected = selected === agent.id;
      const role = roleOf(agent);
      const secondary = [role, displayModel(agent)].filter(Boolean).join(" · ");
      return (
        <View style={{ paddingHorizontal: space.sm }}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            onPress={() => setSelected(isSelected ? null : agent.id)}
            style={pressStyle(({ hovered }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: space.sm,
              paddingVertical: layout.compact ? space.md : space.sm + 2,
              paddingLeft: space.sm + node.depth * space.lg,
              paddingRight: space.sm,
              borderRadius: radius.lg,
              backgroundColor: isSelected ? colors.surface2 : hovered ? colors.surface1 : "transparent",
            }))}
          >
            {node.depth > 0 ? (
              <View
                style={{
                  position: "absolute",
                  left: space.sm + (node.depth - 1) * space.lg + 3,
                  top: 0,
                  bottom: 0,
                  width: 1,
                  backgroundColor: colors.border,
                }}
              />
            ) : null}
            <StatusDot theme={theme} state={node.state} />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: font.base }}>
                {displayTitle(agent)}
              </Text>
              <Muted theme={theme} size={font.xs} numberOfLines={1}>
                {secondary}
              </Muted>
            </View>
            <View style={{ alignItems: "flex-end", gap: 2 }}>
              <Text style={{ color: stateColor(theme, node.state), fontSize: font.xs }}>
                {STATE_LABEL[node.state]}
              </Text>
              <Muted theme={theme} size={font.xs}>
                {formatAge(activityAt(agent), now)}
              </Muted>
            </View>
            {node.children.length > 0 ? (
              <IconButton
                theme={theme}
                icon={collapsed.has(agent.id) ? "ChevronRight" : "ChevronDown"}
                label={collapsed.has(agent.id) ? `Expand ${node.descendants}` : "Collapse"}
                onPress={() => toggleCollapsed(agent.id)}
                size={24}
              />
            ) : (
              <View style={{ width: 24 }} />
            )}
          </Pressable>
          {isSelected ? (
            <Detail
              theme={theme}
              node={node}
              workspaceName={
                agent.workspaceId ? (directory.workspaces.get(agent.workspaceId)?.name ?? null) : null
              }
              canOpen={Boolean(navigation)}
              onOpen={() => openAgent(agent)}
              onMessage={() => setDialog({ kind: "message", agent })}
              onArchive={() => setDialog({ kind: "archive", agent })}
              onReview={(requestId) => setDialog({ kind: "permission", agent, requestId })}
              onRespond={(requestId, allow) => void respond(agent, requestId, allow)}
              busy={busy}
            />
          ) : null}
        </View>
      );
    },
    [
      colors,
      theme,
      layout.compact,
      selected,
      collapsed,
      now,
      toggleCollapsed,
      directory.workspaces,
      navigation,
      openAgent,
      respond,
      busy,
    ],
  );

  const chips = STATE_ORDER.filter((state) => counts[state] > 0);
  const emptyLabel =
    directory.phase === "loading"
      ? "Loading agents"
      : query || filter !== "all"
        ? "No matching agents"
        : scope
          ? "No agents in this workspace"
          : "No agents";

  const pendingAgent = dialog?.kind === "permission" ? directory.agents.get(dialog.agent.id) : undefined;
  const pending =
    dialog?.kind === "permission"
      ? pendingAgent?.pendingPermissions.find((request) => request.id === dialog.requestId)
      : undefined;

  // A workspace pane fills its dock; the global surface is reading-width, like Paseo's list pages.
  const column = scope === null ? { width: "100%" as const, maxWidth: 720, alignSelf: "center" as const } : null;
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface0 }}>
      <View style={[{ paddingHorizontal: space.lg, paddingTop: space.md, gap: space.sm }, column]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Muted theme={theme} size={font.sm} style={{ flex: 1 }}>
            {summary(counts)}
            {directory.truncated ? " · first 2000" : ""}
          </Muted>
          <IconButton theme={theme} icon="RefreshCw" label="Refresh" onPress={directory.reload} />
        </View>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Find an agent"
          placeholderTextColor={colors.foregroundMuted}
          autoCorrect={false}
          style={{
            height: 32,
            paddingHorizontal: space.md,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: colors.border,
            color: colors.foreground,
            fontSize: font.base,
          }}
        />
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
          <Chip
            theme={theme}
            label="All"
            selected={filter === "all"}
            onPress={() => setFilter("all")}
          />
          {chips.map((state) => (
            <Chip
              key={state}
              theme={theme}
              label={STATE_LABEL[state]}
              count={counts[state]}
              color={stateColor(theme, state)}
              selected={filter === state}
              onPress={() => setFilter(filter === state ? "all" : state)}
            />
          ))}
        </View>
        {directory.error ? (
          <Text style={{ color: colors.statusDanger, fontSize: font.xs }}>{directory.error}</Text>
        ) : null}
      </View>
      <FlatList
        data={rows}
        keyExtractor={(row: Row) => row.key}
        renderItem={renderRow}
        extraData={[selected, collapsed, now, busy]}
        contentContainerStyle={[{ paddingVertical: space.sm, paddingBottom: space.xl }, column]}
        ListEmptyComponent={<Empty theme={theme} label={emptyLabel} />}
        style={{ flex: 1 }}
      />

      <Modal
        title={dialog?.kind === "message" ? "Message agent" : ""}
        open={dialog?.kind === "message"}
        onOpenChange={(open) => !open && setDialog(null)}
      >
        <Modal.Content>
          {dialog?.kind === "message" ? (
            <>
              <Muted theme={theme}>{displayTitle(dialog.agent)}</Muted>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                multiline
                autoFocus
                placeholder="What should it know or do next?"
                placeholderTextColor={colors.foregroundMuted}
                style={{
                  minHeight: 96,
                  padding: space.md,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: colors.border,
                  color: colors.foreground,
                  fontSize: font.base,
                  textAlignVertical: "top",
                }}
              />
              <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: space.sm }}>
                <Button theme={theme} label="Cancel" onPress={() => setDialog(null)} />
                <Button
                  theme={theme}
                  variant="default"
                  label="Send"
                  disabled={busy || draft.trim().length === 0}
                  onPress={() =>
                    void run("Message sent", () => paseo.agents.ref(dialog.agent.id).send(draft.trim()))
                  }
                />
              </View>
            </>
          ) : null}
        </Modal.Content>
      </Modal>

      <Modal
        title="Archive agent"
        open={dialog?.kind === "archive"}
        onOpenChange={(open) => !open && setDialog(null)}
      >
        <Modal.Content>
          {dialog?.kind === "archive" ? (
            <>
              <Text style={{ color: colors.foreground, fontSize: font.base, lineHeight: font.base * 1.5 }}>
                Archive “{displayTitle(dialog.agent)}”? Its chat stays in History. Children keep running.
              </Text>
              <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: space.sm }}>
                <Button theme={theme} label="Cancel" onPress={() => setDialog(null)} />
                <Button
                  theme={theme}
                  variant="destructive"
                  label="Archive"
                  disabled={busy}
                  onPress={() =>
                    void run("Archived", () => paseo.agents.ref(dialog.agent.id).archive())
                  }
                />
              </View>
            </>
          ) : null}
        </Modal.Content>
      </Modal>

      <Modal
        title={pending?.title ?? pending?.name ?? "Permission"}
        open={dialog?.kind === "permission"}
        onOpenChange={(open) => !open && setDialog(null)}
      >
        <Modal.Content>
          {dialog?.kind === "permission" && pending ? (
            <>
              <Muted theme={theme}>{displayTitle(dialog.agent)}</Muted>
              {pending.description ? (
                <Text style={{ color: colors.foreground, fontSize: font.base, lineHeight: font.base * 1.5 }}>
                  {pending.description}
                </Text>
              ) : null}
              {pending.input ? (
                <Text
                  selectable
                  style={{
                    color: colors.foregroundMuted,
                    fontSize: font.sm,
                    fontFamily: layout.platform === "ios" ? "Menlo" : "monospace",
                    backgroundColor: colors.surface1,
                    padding: space.md,
                    borderRadius: radius.md,
                  }}
                >
                  {JSON.stringify(pending.input, null, 2)}
                </Text>
              ) : null}
              <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: space.sm }}>
                <Button
                  theme={theme}
                  variant="outline"
                  label="Deny"
                  disabled={busy}
                  onPress={() => void respond(dialog.agent, dialog.requestId, false)}
                />
                <Button
                  theme={theme}
                  variant="default"
                  label="Allow"
                  disabled={busy}
                  onPress={() => void respond(dialog.agent, dialog.requestId, true)}
                />
              </View>
            </>
          ) : dialog?.kind === "permission" ? (
            <Muted theme={theme}>This request was already answered.</Muted>
          ) : null}
        </Modal.Content>
      </Modal>
    </View>
  );
}

function Detail({
  theme,
  node,
  workspaceName,
  canOpen,
  onOpen,
  onMessage,
  onArchive,
  onReview,
  onRespond,
  busy,
}: {
  theme: CrewViewProps["theme"];
  node: CrewNode;
  workspaceName: string | null;
  canOpen: boolean;
  onOpen: () => void;
  onMessage: () => void;
  onArchive: () => void;
  onReview: (requestId: string) => void;
  onRespond: (requestId: string, allow: boolean) => void;
  busy: boolean;
}) {
  const { agent } = node;
  const { colors } = theme;
  const facts: Array<[string, string]> = [];
  if (workspaceName) facts.push(["Workspace", workspaceName]);
  facts.push(["Directory", agent.cwd]);
  for (const key of ["team/room", "team/owner", "team/scope", "team/concern"]) {
    const value = agent.labels[key];
    if (value) facts.push([key.slice("team/".length), value]);
  }
  if (agent.lastError) facts.push(["Last error", agent.lastError]);
  return (
    <View
      style={{
        marginLeft: space.sm + node.depth * space.lg + space.lg,
        marginRight: space.sm,
        marginBottom: space.sm,
        gap: space.md,
      }}
    >
      <View style={{ gap: space.xs }}>
        {facts.map(([label, value]) => (
          <View key={label} style={{ flexDirection: "row", gap: space.sm }}>
            <Muted theme={theme} size={font.xs} style={{ width: 72 }}>
              {label}
            </Muted>
            <Text
              selectable
              numberOfLines={label === "Last error" ? 4 : 2}
              style={{
                flex: 1,
                color: label === "Last error" ? colors.statusDanger : colors.foreground,
                fontSize: font.xs,
                lineHeight: font.xs * 1.4,
              }}
            >
              {value}
            </Text>
          </View>
        ))}
      </View>
      {agent.pendingPermissions.map((request) => (
        <View
          key={request.id}
          style={{
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: radius.md,
            padding: space.md,
            gap: space.sm,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <Icon name="ShieldQuestion" size={14} color={colors.statusWarning} />
            <Text numberOfLines={2} style={{ flex: 1, color: colors.foreground, fontSize: font.sm }}>
              {request.title ?? request.name}
            </Text>
          </View>
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <Button theme={theme} size="xs" variant="ghost" label="Review" onPress={() => onReview(request.id)} />
            <View style={{ flex: 1 }} />
            <Button
              theme={theme}
              size="xs"
              variant="outline"
              label="Deny"
              disabled={busy}
              onPress={() => onRespond(request.id, false)}
            />
            <Button
              theme={theme}
              size="xs"
              variant="default"
              label="Allow"
              disabled={busy}
              onPress={() => onRespond(request.id, true)}
            />
          </View>
        </View>
      ))}
      <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
        {canOpen ? <Button theme={theme} label="Open" icon="ArrowUpRight" onPress={onOpen} /> : null}
        <Button theme={theme} variant="outline" label="Message" icon="MessageSquare" onPress={onMessage} />
        {agent.status !== "closed" ? (
          <Button theme={theme} variant="outline" label="Archive" icon="Archive" onPress={onArchive} />
        ) : null}
      </View>
    </View>
  );
}
