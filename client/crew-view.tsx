import { usePaseo, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { ScrollView, TextInput } from "@getpaseo/plugin/client/react-native";
import type { PaseoAgent } from "@getpaseo/client";
import { useCallback, useMemo, useState } from "react";
import { Text, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";
import { AgentDialogs, Detail, useAgentActions } from "./detail";
import { candidatesOf } from "./feed-plan";
import { CrewList } from "./list";
import {
  buildForest,
  countStates,
  crewState,
  displayModel,
  displayTitle,
  filterForest,
  groupByWorkspace,
  matches,
  roleOf,
  STATE_LABEL,
  STATE_ORDER,
  summary,
  type CrewNode,
  type CrewState,
} from "./model";
import { OfficeScene } from "./office";
import { layoutOffice, presences as presencesOf } from "./office-model";
import { highlighted as highlightedBy, indexNodes, sceneScale } from "./scene-model";
import { Chip, Empty, IconButton, Muted, StatusDot, font, space, stateColor, useReducedMotion } from "./ui";
import { useClock, useDirectory } from "./use-directory";
import { useFeed } from "./use-feed";

type Filter = CrewState | "all";
type Mode = "office" | "list";

/** Below this width the detail docks under the office instead of beside it. */
const SIDE_DOCK_MIN_WIDTH = 720;
const SIDE_DOCK_WIDTH = 320;

export interface CrewViewProps extends PluginSurfaceProps {
  scope: string | null;
}

export function CrewView({ scope: homeScope, theme, host, layout, navigation }: CrewViewProps) {
  // A panel starts on its own workspace and can widen to every workspace; the surface is always wide.
  const inPanel = homeScope !== null;
  const [allWorkspaces, setAllWorkspaces] = useState(false);
  const scope = inPanel && !allWorkspaces ? homeScope : null;
  const paseo = usePaseo();
  const now = useClock();
  const directory = useDirectory(paseo);
  const actions = useAgentActions(paseo);
  const reducedMotion = useReducedMotion();
  const [mode, setMode] = useState<Mode>("office");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [size, setSize] = useState({ view: 0, scene: 0 });
  const [inView, setInView] = useState<readonly string[] | null>(null);
  const { colors } = theme;
  const { setDialog, respond, busy } = actions;

  const roots = useMemo(() => buildForest(directory.agents.values(), scope), [directory.agents, scope]);
  const counts = useMemo(() => countStates(roots), [roots]);
  const workspaceName = useCallback(
    (agent: PaseoAgent) => (agent.workspaceId ? (directory.workspaces.get(agent.workspaceId)?.name ?? null) : null),
    [directory.workspaces],
  );
  const keep = useCallback(
    (node: CrewNode) =>
      (filter === "all" || node.state === filter) && matches(node.agent, query, workspaceName(node.agent)),
    [filter, query, workspaceName],
  );
  // The list drops what does not match; the office keeps every seat and dims instead.
  const listed = useMemo(() => filterForest(roots, keep), [roots, keep]);
  const highlighted = useMemo(
    () => highlightedBy(roots, filter, query, workspaceName),
    [roots, filter, query, workspaceName],
  );

  const office = mode === "office";
  const scale = useMemo(() => sceneScale(size.scene), [size.scene]);
  const groups = useMemo(() => groupByWorkspace(roots, directory.workspaces), [roots, directory.workspaces]);
  const plan = useMemo(
    () =>
      layoutOffice(groups, {
        width: scale.widthTiles,
        agents: directory.agents,
        ...(scope !== null ? { roomColumns: 1 } : {}),
      }),
    [groups, scale.widthTiles, scope, directory.agents],
  );
  const nodes = useMemo(() => indexNodes(roots), [roots]);
  const presences = useMemo(
    () => presencesOf(plan, directory.agents, crewState, now),
    [plan, directory.agents, now],
  );
  // Only the rooms on screen compete for the live subscriptions.
  const candidates = useMemo(() => {
    const visible = inView ? new Set(inView) : null;
    return candidatesOf(groups.filter((group) => !visible || visible.has(group.workspaceId)).flatMap((group) => group.roots));
  }, [groups, inView]);
  const feed = useFeed(paseo, candidates, { enabled: office && size.scene > 0 });

  const openAgent = useCallback(
    (agent: PaseoAgent) => navigation?.openAgent({ agentId: agent.id, serverId: host.id }),
    [navigation, host.id],
  );
  const toggle = useCallback((agentId: string) => setSelected((current) => (current === agentId ? null : agentId)), []);

  const renderDetail = useCallback(
    (node: CrewNode, style: StyleProp<ViewStyle>) => (
      <Detail
        theme={theme}
        node={node}
        workspaceName={workspaceName(node.agent)}
        canOpen={Boolean(navigation)}
        onOpen={() => openAgent(node.agent)}
        onMessage={() => setDialog({ kind: "message", agent: node.agent })}
        onArchive={() => setDialog({ kind: "archive", agent: node.agent })}
        onReview={(requestId) => setDialog({ kind: "permission", agent: node.agent, requestId })}
        onRespond={(requestId, allow) => void respond(node.agent, requestId, allow)}
        busy={busy}
        style={style}
      />
    ),
    [theme, workspaceName, navigation, openAgent, setDialog, respond, busy],
  );

  const chips = STATE_ORDER.filter((state) => counts[state] > 0);
  const emptyLabel =
    directory.phase === "loading"
      ? ""
      : scope
        ? "No agents in this workspace"
        : "No agents";
  const noMatchLabel = query || filter !== "all" ? "No matching agents" : emptyLabel;

  // A visitor has no node in this forest; it still has a detail.
  const selectedNode = useMemo<CrewNode | undefined>(() => {
    if (!selected) return undefined;
    const seated = nodes.get(selected);
    if (seated) return seated;
    const visitor = office && plan.visitors.has(selected) ? directory.agents.get(selected) : undefined;
    return visitor
      ? { agent: visitor, state: crewState(visitor), depth: 0, children: [], descendants: 0 }
      : undefined;
  }, [selected, nodes, office, plan.visitors, directory.agents]);
  const sideDock = size.view >= SIDE_DOCK_MIN_WIDTH;
  // A workspace pane fills its dock; the global list is reading-width, like Paseo's list pages.
  const column = !inPanel ? { width: "100%" as const, maxWidth: 720, alignSelf: "center" as const } : null;
  const onViewLayout = (event: LayoutChangeEvent) => {
    const width = Math.round(event.nativeEvent.layout.width);
    setSize((current) => (current.view === width ? current : { ...current, view: width }));
  };
  const onSceneLayout = (event: LayoutChangeEvent) => {
    const width = Math.round(event.nativeEvent.layout.width);
    setSize((current) => (current.scene === width ? current : { ...current, scene: width }));
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface0 }} onLayout={onViewLayout}>
      <View style={[{ paddingHorizontal: space.lg, paddingTop: space.md, gap: space.sm }, office ? null : column]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          {directory.phase === "loading" ? (
            <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: space.sm }}>
              <StatusDot theme={theme} state="working" pulse />
              <Muted theme={theme} size={font.sm}>
                Loading agents
              </Muted>
            </View>
          ) : (
            <Muted theme={theme} size={font.sm} style={{ flex: 1 }}>
              {summary(counts)}
              {directory.truncated ? " · first 2000" : ""}
            </Muted>
          )}
          <Chip theme={theme} label="Office" selected={office} onPress={() => setMode("office")} />
          <Chip theme={theme} label="List" selected={!office} onPress={() => setMode("list")} />
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
            borderRadius: 8,
            borderWidth: 1,
            borderColor: colors.border,
            color: colors.foreground,
            fontSize: font.base,
          }}
        />
        {inPanel ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
            <Chip theme={theme} label="This workspace" selected={!allWorkspaces} onPress={() => setAllWorkspaces(false)} />
            <Chip theme={theme} label="All workspaces" selected={allWorkspaces} onPress={() => setAllWorkspaces(true)} />
          </View>
        ) : null}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
          <Chip theme={theme} label="All" selected={filter === "all"} onPress={() => setFilter("all")} />
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
        {office && highlighted && highlighted.size === 0 ? (
          <Muted theme={theme} size={font.xs}>
            No matching agents
          </Muted>
        ) : null}
        {directory.error ? (
          <Text style={{ color: colors.statusDanger, fontSize: font.xs }}>{directory.error}</Text>
        ) : null}
      </View>

      {office ? (
        <View style={{ flex: 1, flexDirection: sideDock ? "row" : "column", paddingTop: space.sm }}>
          <View style={{ flex: 1, minWidth: 0, minHeight: 0 }} onLayout={onSceneLayout}>
            {roots.length === 0 ? (
              emptyLabel ? (
                <Empty theme={theme} label={emptyLabel} />
              ) : null
            ) : size.scene > 0 ? (
              <OfficeScene
                theme={theme}
                office={plan}
                tile={scale.tile}
                nodes={nodes}
                agents={directory.agents}
                presences={presences}
                bubbles={feed.bubbles}
                exchanges={feed.exchanges}
                selected={selected}
                highlighted={highlighted}
                still={reducedMotion}
                onSelect={toggle}
                onRoomsInView={setInView}
              />
            ) : null}
          </View>
          {selectedNode ? (
            <View
              style={[
                { backgroundColor: colors.surface1, borderColor: colors.border },
                sideDock
                  ? { width: SIDE_DOCK_WIDTH, borderLeftWidth: 1 }
                  : { maxHeight: "50%", borderTopWidth: 1 },
              ]}
            >
              <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                  <StatusDot theme={theme} state={selectedNode.state} />
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Text numberOfLines={2} style={{ color: colors.foreground, fontSize: font.base, fontWeight: "600" }}>
                      {displayTitle(selectedNode.agent)}
                    </Text>
                    <Muted theme={theme} size={font.xs} numberOfLines={1}>
                      {[roleOf(selectedNode.agent), displayModel(selectedNode.agent)].filter(Boolean).join(" · ")}
                    </Muted>
                  </View>
                  <Text style={{ color: stateColor(theme, selectedNode.state), fontSize: font.xs }}>
                    {STATE_LABEL[selectedNode.state]}
                  </Text>
                  <IconButton theme={theme} icon="X" label="Close details" onPress={() => setSelected(null)} />
                </View>
                {feed.bubbles.get(selectedNode.agent.id) ? (
                  <Muted theme={theme} size={font.xs} numberOfLines={2}>
                    {feed.bubbles.get(selectedNode.agent.id)?.text}
                  </Muted>
                ) : null}
                {renderDetail(selectedNode, null)}
              </ScrollView>
            </View>
          ) : null}
        </View>
      ) : (
        <CrewList
          theme={theme}
          roots={listed}
          grouped={scope === null}
          workspaces={directory.workspaces}
          now={now}
          compact={layout.compact}
          selected={selected}
          onSelect={setSelected}
          renderDetail={renderDetail}
          emptyLabel={noMatchLabel}
          extraData={busy}
          contentStyle={column}
        />
      )}

      <AgentDialogs
        theme={theme}
        paseo={paseo}
        actions={actions}
        agents={directory.agents}
        platform={layout.platform}
      />
    </View>
  );
}
