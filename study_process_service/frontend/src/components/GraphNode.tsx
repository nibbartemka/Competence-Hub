import type { MouseEvent } from "react";
import type { RGNodeSlotProps } from "relation-graph-react";

import type { SceneNodeData } from "../types";

function isSceneNodeData(value: unknown): value is SceneNodeData {
  return Boolean(value) && typeof value === "object" && "entity" in (value as object);
}

type GraphNodeDataWithAction = SceneNodeData & {
  onHintClick?: () => void;
};

function hasHintAction(value: SceneNodeData): value is GraphNodeDataWithAction {
  return "onHintClick" in value;
}

export function GraphNode({ node }: RGNodeSlotProps) {
  const data = isSceneNodeData(node.data) ? node.data : null;

  if (!data) {
    return <div className="graph-node graph-node--fallback">{node.text}</div>;
  }

  const handleHintClick = (event: MouseEvent<HTMLSpanElement>) => {
    event.stopPropagation();

    if (hasHintAction(data)) {
      data.onHintClick?.();
    }
  };

  return (
    <div
      className={`graph-node graph-node--${data.entity} graph-node--${data.tone}`}
      title={data.description ?? data.title}
    >
      <div className="graph-node__header">
        <span className={`graph-node__badge graph-node__badge--${data.tone}`}>
          {data.badge}
        </span>

        {data.hint ? (
          <span
            className="graph-node__hint"
            onClick={handleHintClick}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
                if (hasHintAction(data)) {
                  data.onHintClick?.();
                }
              }
            }}
          >
            {data.hint}
          </span>
        ) : null}
      </div>

      <strong className="graph-node__title">{data.title}</strong>
      {data.subtitle ? <p className="graph-node__subtitle">{data.subtitle}</p> : null}
      {data.description ? (
        <p className="graph-node__description">{data.description}</p>
      ) : null}

      {data.metrics.length ? (
        <div className="graph-node__metrics">
          {data.metrics.map((metric) => (
            <span key={metric}>{metric}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}