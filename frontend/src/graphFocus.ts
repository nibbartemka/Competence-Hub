import type { JsonLine, JsonNode } from "relation-graph-react";

import type { SceneNodeData } from "./types";

export const NO_NODE_SELECTION = "__none__";

function parseHexColor(value: string) {
  const normalized = value.replace("#", "").trim();
  if (normalized.length === 3) {
    return {
      r: Number.parseInt(normalized[0] + normalized[0], 16),
      g: Number.parseInt(normalized[1] + normalized[1], 16),
      b: Number.parseInt(normalized[2] + normalized[2], 16),
    };
  }

  if (normalized.length === 6) {
    return {
      r: Number.parseInt(normalized.slice(0, 2), 16),
      g: Number.parseInt(normalized.slice(2, 4), 16),
      b: Number.parseInt(normalized.slice(4, 6), 16),
    };
  }

  return null;
}

function parseRgbColor(value: string) {
  const match = value.match(
    /rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*[\d.]+\s*)?\)/i,
  );
  if (!match) {
    return null;
  }

  return {
    r: Number.parseInt(match[1], 10),
    g: Number.parseInt(match[2], 10),
    b: Number.parseInt(match[3], 10),
  };
}

function fadeColor(value: unknown, alpha: number) {
  if (typeof value !== "string" || !value.trim()) {
    return `rgba(118, 132, 150, ${alpha})`;
  }

  const color = value.trim();
  const parsed =
    (color.startsWith("#") ? parseHexColor(color) : null) ??
    (color.startsWith("rgb") ? parseRgbColor(color) : null);

  if (!parsed) {
    return `rgba(118, 132, 150, ${alpha})`;
  }

  return `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${alpha})`;
}

function sceneNodeData(node: JsonNode) {
  const data = node.data as SceneNodeData | undefined;
  if (!data || typeof data !== "object" || !("entity" in data)) {
    return null;
  }
  return data;
}

function dimLine(line: JsonLine): JsonLine {
  const baseColor = line.color ?? "#768496";

  return {
    ...line,
    color: fadeColor(baseColor, 0.16),
    fontColor: fadeColor(line.fontColor ?? baseColor, 0.24),
    lineWidth: Math.max(1, (line.lineWidth ?? 2) * 0.78),
    animation: 0,
  };
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
  const highlightedLineIndexes = new Set<number>();

  scene.lines.forEach((line, index) => {
    if (line.from === activeNodeId || line.to === activeNodeId) {
      highlightedLineIndexes.add(index);
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
    scene: {
      ...scene,
      lines: scene.lines.map((line, index) =>
        highlightedLineIndexes.has(index) ? line : dimLine(line),
      ),
    },
    dimmedNodeIds,
  };
}
