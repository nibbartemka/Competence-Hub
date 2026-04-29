import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type {
  JsonLine,
  JsonNode,
  RelationGraphComponent,
  RelationGraphInstance,
} from "relation-graph-react";

import { fetchGraphLayouts, isAbortError, saveGraphLayout } from "./api";
import type { GraphLayoutPayload } from "./types";

type ViewportScene = {
  key: string;
  rootId: string;
  nodes: JsonNode[];
  lines: JsonLine[];
  defaultSelectedNodeId: string;
};

type PersistedViewportOptions = {
  enabled?: boolean;
  graphRef: MutableRefObject<RelationGraphComponent | undefined>;
  scene: ViewportScene | null;
  scopeId?: string;
  scopeType: string;
};

const SAVE_DEBOUNCE_MS = 450;

function clonePayload(payload: GraphLayoutPayload): GraphLayoutPayload {
  return {
    offset_x: payload.offset_x,
    offset_y: payload.offset_y,
    zoom: payload.zoom,
    positions: Object.fromEntries(
      Object.entries(payload.positions).map(([nodeId, position]) => [
        nodeId,
        { x: position.x, y: position.y },
      ]),
    ),
  };
}

function captureGraphLayout(
  graphInstance: RelationGraphInstance,
): GraphLayoutPayload {
  const positions: GraphLayoutPayload["positions"] = {};

  for (const node of graphInstance.getNodes()) {
    positions[node.id] = { x: node.x, y: node.y };
  }

  const offset = graphInstance.getGraphOffet();

  return {
    positions,
    offset_x: offset?.offset_x ?? 0,
    offset_y: offset?.offset_y ?? 0,
    zoom:
      typeof graphInstance.options.canvasZoom === "number"
        ? graphInstance.options.canvasZoom
        : null,
  };
}

function buildSceneGraphData(
  scene: ViewportScene,
  layout: GraphLayoutPayload | undefined,
) {
  const nodes = layout
    ? scene.nodes.map((node) => {
        const position = layout.positions[node.id];
        return position ? { ...node, x: position.x, y: position.y } : node;
      })
    : scene.nodes;

  return {
    rootId: scene.rootId,
    nodes,
    lines: scene.lines,
  };
}

function restoreSceneLayout(
  graphComponent: RelationGraphComponent,
  scene: ViewportScene,
  layout: GraphLayoutPayload | undefined,
) {
  const graphData = buildSceneGraphData(scene, layout);

  const afterRefresh = (graphInstance: RelationGraphInstance) => {
    if (layout) {
      graphInstance.setCanvasOffset(layout.offset_x, layout.offset_y);
      if (typeof layout.zoom === "number") {
        graphInstance.setZoom(layout.zoom);
      }
    }

    if (scene.defaultSelectedNodeId) {
      graphInstance.setCheckedNode(scene.defaultSelectedNodeId);
    }
  };

  if (layout) {
    graphComponent.setJsonData(graphData, false, afterRefresh);
    return;
  }

  graphComponent.setJsonData(graphData, afterRefresh);
}

async function persistLayoutPayload(
  scopeType: string,
  scopeId: string,
  sceneKey: string,
  payload: GraphLayoutPayload,
  persistedLayoutsRef: MutableRefObject<Map<string, GraphLayoutPayload>>,
) {
  const savedLayout = await saveGraphLayout(scopeType, scopeId, {
    scene_key: sceneKey,
    payload,
  });
  persistedLayoutsRef.current.set(
    savedLayout.scene_key,
    clonePayload(savedLayout.payload),
  );
}

export function usePersistedGraphViewport({
  enabled = true,
  graphRef,
  scene,
  scopeId,
  scopeType,
}: PersistedViewportOptions) {
  const [layoutLoading, setLayoutLoading] = useState(Boolean(enabled && scopeId));
  const [layoutError, setLayoutError] = useState("");
  const [layoutVersion, setLayoutVersion] = useState(0);
  const persistedLayoutsRef = useRef<Map<string, GraphLayoutPayload>>(new Map());
  const runtimeLayoutsRef = useRef<Map<string, GraphLayoutPayload>>(new Map());
  const currentSceneKeyRef = useRef("");
  const saveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled || !scopeId) {
      persistedLayoutsRef.current = new Map();
      runtimeLayoutsRef.current = new Map();
      currentSceneKeyRef.current = "";
      setLayoutError("");
      setLayoutLoading(false);
      setLayoutVersion((current) => current + 1);
      return;
    }

    const controller = new AbortController();
    const scopeKey = scopeId;
    setLayoutLoading(true);
    setLayoutError("");
    currentSceneKeyRef.current = "";

    async function loadLayouts() {
      try {
        const items = await fetchGraphLayouts(scopeType, scopeKey, controller.signal);
        const nextMap = new Map<string, GraphLayoutPayload>();
        for (const item of items) {
          nextMap.set(item.scene_key, clonePayload(item.payload));
        }
        persistedLayoutsRef.current = nextMap;
        runtimeLayoutsRef.current = new Map(nextMap);
        setLayoutVersion((current) => current + 1);
      } catch (error) {
        if (!isAbortError(error)) {
          setLayoutError(
            error instanceof Error
              ? error.message
              : "Не удалось загрузить сохраненное положение графа.",
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          setLayoutLoading(false);
        }
      }
    }

    void loadLayouts();

    return () => {
      controller.abort();
    };
  }, [enabled, scopeId, scopeType]);

  useEffect(() => {
    if (!enabled || !scene || !graphRef.current || layoutLoading) {
      return;
    }

    const graphComponent = graphRef.current;
    const graphInstance = graphComponent.getInstance();
    const previousSceneKey = currentSceneKeyRef.current;

    if (previousSceneKey) {
      runtimeLayoutsRef.current.set(
        previousSceneKey,
        captureGraphLayout(graphInstance),
      );
    }

    const layout =
      runtimeLayoutsRef.current.get(scene.key) ??
      persistedLayoutsRef.current.get(scene.key);

    restoreSceneLayout(graphComponent, scene, layout);
    currentSceneKeyRef.current = scene.key;
  }, [enabled, graphRef, layoutLoading, layoutVersion, scene]);

  useEffect(() => {
    return () => {
      if (
        saveTimerRef.current !== null &&
        enabled &&
        scopeId &&
        graphRef.current
      ) {
        window.clearTimeout(saveTimerRef.current);
        const graphInstance = graphRef.current.getInstance();
        const sceneKey = currentSceneKeyRef.current;
        if (sceneKey) {
          const payload = captureGraphLayout(graphInstance);
          runtimeLayoutsRef.current.set(sceneKey, payload);
          void persistLayoutPayload(
            scopeType,
            scopeId,
            sceneKey,
            payload,
            persistedLayoutsRef,
          );
        }
      }
    };
  }, [enabled, graphRef, scopeId, scopeType]);

  const schedulePersist = useMemo(() => {
    return () => {
      if (!enabled || !scopeId || !graphRef.current) {
        return;
      }

      const graphInstance = graphRef.current.getInstance();
      const sceneKey = currentSceneKeyRef.current || scene?.key;
      if (!sceneKey) {
        return;
      }

      const payload = captureGraphLayout(graphInstance);
      runtimeLayoutsRef.current.set(sceneKey, payload);

      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }

      saveTimerRef.current = window.setTimeout(() => {
        void persistLayoutPayload(
          scopeType,
          scopeId,
          sceneKey,
          payload,
          persistedLayoutsRef,
        ).catch(() => {
          // Silent failure: the graph remains usable and runtime cache still holds the layout.
        });
      }, SAVE_DEBOUNCE_MS);
    };
  }, [enabled, graphRef, scene?.key, scopeId, scopeType]);

  return {
    layoutError,
    layoutLoading,
    onCanvasDragEnd: schedulePersist,
    onCanvasDragging: schedulePersist,
    onNodeDragEnd: schedulePersist,
    onNodeDragging: schedulePersist,
    onZoomEnd: schedulePersist,
  };
}
