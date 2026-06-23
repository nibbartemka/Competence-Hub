import type { JsonLine, JsonNode } from "relation-graph-react";

import type { SceneNodeData } from "./types";

export const NO_NODE_SELECTION = "__none__";

function sceneNodeData(node: JsonNode) {
  const data = node.data as SceneNodeData | undefined;
  if (!data || typeof data !== "object" || !("entity" in data)) {
    return null;
  }
  return data;
}

export function hasConcreteNodeSelection(nodeId: string | null | undefined) {
  return Boolean(nodeId && nodeId !== NO_NODE_SELECTION);
}

export function buildFocusedScene<T extends { nodes: JsonNode[]; lines: JsonLine[] }>(
  scene: T,
  selectedNodeId: string | null | undefined,
): {
  scene: T;
  dimmedNodeIds: ReadonlySet<string>;
} {
  if (!hasConcreteNodeSelection(selectedNodeId)) {
    return {
      scene,
      dimmedNodeIds: new Set<string>(),
    };
  }

  const selectedNode = scene.nodes.find((node) => node.id === selectedNodeId);
  const selectedData = selectedNode ? sceneNodeData(selectedNode) : null;

  if (!selectedNode || selectedData?.entity !== "element") {
    return {
      scene,
      dimmedNodeIds: new Set<string>(),
    };
  }

  const activeNodeId = selectedNodeId as string;
  const highlightedNodeIds = new Set<string>([activeNodeId]);
  scene.lines.forEach((line) => {
    if (line.from === activeNodeId || line.to === activeNodeId) {
      if (line.from) {
        highlightedNodeIds.add(line.from);
      }
      if (line.to) {
        highlightedNodeIds.add(line.to);
      }
    }
  });

  const dimmedNodeIds = new Set(
    scene.nodes.map((node) => node.id).filter((nodeId) => !highlightedNodeIds.has(nodeId)),
  );

  return {
    scene,
    dimmedNodeIds,
  };
}
