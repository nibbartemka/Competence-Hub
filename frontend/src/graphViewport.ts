import type { MutableRefObject } from "react";
import type {
  JsonLine,
  JsonNode,
  RelationGraphComponent,
  RelationGraphInstance,
} from "relation-graph-react";

type SceneViewportSnapshot = {
  offsetX: number;
  offsetY: number;
  positions: Map<string, { x: number; y: number }>;
  zoom: number | undefined;
};

type ViewportScene = {
  key: string;
  rootId: string;
  nodes: JsonNode[];
  lines: JsonLine[];
  defaultSelectedNodeId: string;
};

function captureSceneViewport(
  graphInstance: RelationGraphInstance,
): SceneViewportSnapshot {
  const positions = new Map<string, { x: number; y: number }>();
  for (const node of graphInstance.getNodes()) {
    positions.set(node.id, { x: node.x, y: node.y });
  }

  const offset = graphInstance.getGraphOffet();

  return {
    positions,
    offsetX: offset?.offset_x ?? 0,
    offsetY: offset?.offset_y ?? 0,
    zoom: graphInstance.options.canvasZoom,
  };
}

export function applySceneWithViewportMemory(
  graphComponent: RelationGraphComponent,
  scene: ViewportScene,
  currentSceneKeyRef: MutableRefObject<string>,
  sceneViewportRef: MutableRefObject<Map<string, SceneViewportSnapshot>>,
) {
  const graphInstance = graphComponent.getInstance();
  const currentSceneKey = currentSceneKeyRef.current;

  if (currentSceneKey) {
    sceneViewportRef.current.set(
      currentSceneKey,
      captureSceneViewport(graphInstance),
    );
  }

  const savedViewport = sceneViewportRef.current.get(scene.key);
  const nodes = savedViewport
    ? scene.nodes.map((node) => {
        const position = savedViewport.positions.get(node.id);
        return position ? { ...node, x: position.x, y: position.y } : node;
      })
    : scene.nodes;

  const graphData = {
    rootId: scene.rootId,
    nodes,
    lines: scene.lines,
  };

  const afterRefresh = (nextGraphInstance: RelationGraphInstance) => {
    if (savedViewport) {
      nextGraphInstance.setCanvasOffset(
        savedViewport.offsetX,
        savedViewport.offsetY,
      );
      if (typeof savedViewport.zoom === "number") {
        nextGraphInstance.setZoom(savedViewport.zoom);
      }
    }

    if (scene.defaultSelectedNodeId) {
      nextGraphInstance.setCheckedNode(scene.defaultSelectedNodeId);
    }
  };

  if (savedViewport) {
    graphComponent.setJsonData(graphData, false, afterRefresh);
  } else {
    graphComponent.setJsonData(graphData, afterRefresh);
  }

  currentSceneKeyRef.current = scene.key;
}
