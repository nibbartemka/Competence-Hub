import {
  createContext,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useContext,
} from "react";
import type { RGNodeSlotProps } from "relation-graph-react";

import type { SceneNodeData } from "../types";

export type GraphNodeRuntimeState = {
  selectedNodeIds?: ReadonlySet<string>;
  disabledNodeIds?: ReadonlySet<string>;
  lockStateByNodeId?: ReadonlyMap<string, "locked" | "open">;
  hintByNodeId?: ReadonlyMap<string, string | undefined>;
  secondaryHintByNodeId?: ReadonlyMap<string, string | undefined>;
  metricsByNodeId?: ReadonlyMap<string, string[]>;
  cardActionByNodeId?: ReadonlyMap<string, () => void>;
  hintActionByNodeId?: ReadonlyMap<string, () => void>;
  secondaryHintActionByNodeId?: ReadonlyMap<string, () => void>;
};

const GraphNodeRuntimeStateContext = createContext<GraphNodeRuntimeState | null>(null);

export function GraphNodeRuntimeStateProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: GraphNodeRuntimeState;
}) {
  return (
    <GraphNodeRuntimeStateContext.Provider value={value}>
      {children}
    </GraphNodeRuntimeStateContext.Provider>
  );
}

function isSceneNodeData(value: unknown): value is SceneNodeData {
  return Boolean(value) && typeof value === "object" && "entity" in (value as object);
}

type GraphNodeDataWithAction = SceneNodeData & {
  onCardClick?: () => void;
  onHintClick?: () => void;
  onSecondaryHintClick?: () => void;
};

function hasHintAction(value: SceneNodeData): value is GraphNodeDataWithAction {
  return "onHintClick" in value;
}

function hasCardAction(value: SceneNodeData): value is GraphNodeDataWithAction {
  return "onCardClick" in value;
}

function hasSecondaryHintAction(value: SceneNodeData): value is GraphNodeDataWithAction {
  return "onSecondaryHintClick" in value;
}

export function GraphNode({ node }: RGNodeSlotProps) {
  const data = isSceneNodeData(node.data) ? node.data : null;
  const runtimeState = useContext(GraphNodeRuntimeStateContext);

  if (!data) {
    return <div className="graph-node graph-node--fallback">{node.text}</div>;
  }

  const hint = runtimeState?.hintByNodeId?.has(node.id)
    ? runtimeState.hintByNodeId.get(node.id)
    : data.hint;
  const secondaryHint = runtimeState?.secondaryHintByNodeId?.has(node.id)
    ? runtimeState.secondaryHintByNodeId.get(node.id)
    : data.secondaryHint;
  const metrics = runtimeState?.metricsByNodeId?.has(node.id)
    ? (runtimeState.metricsByNodeId.get(node.id) ?? [])
    : data.metrics;
  const isSelected = runtimeState?.selectedNodeIds?.has(node.id) ?? data.isSelected;
  const isDisabled = runtimeState?.disabledNodeIds?.has(node.id) ?? data.isDisabled;
  const lockState = runtimeState?.lockStateByNodeId?.has(node.id)
    ? runtimeState.lockStateByNodeId.get(node.id)
    : data.lockState;
  const cardAction = runtimeState?.cardActionByNodeId?.get(node.id) ??
    (hasCardAction(data) ? data.onCardClick : undefined);
  const hintAction = runtimeState?.hintActionByNodeId?.get(node.id) ??
    (hasHintAction(data) ? data.onHintClick : undefined);
  const secondaryHintAction = runtimeState?.secondaryHintActionByNodeId?.get(node.id) ??
    (hasSecondaryHintAction(data) ? data.onSecondaryHintClick : undefined);

  const handleActionKeyDown =
    (action: (() => void) | undefined) => (event: KeyboardEvent<HTMLSpanElement>) => {
      if (!action) return;

      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        event.stopPropagation();
        action();
      }
    };

  const handleHintClick = (event: MouseEvent<HTMLSpanElement>) => {
    event.stopPropagation();
    hintAction?.();
  };

  const handleSecondaryHintClick = (event: MouseEvent<HTMLSpanElement>) => {
    event.stopPropagation();
    secondaryHintAction?.();
  };

  const handleCardClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!cardAction) return;

    event.stopPropagation();
    cardAction();
  };

  const handleCardKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!cardAction) return;

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      cardAction();
    }
  };

  const isCardClickable = Boolean(cardAction);

  return (
    <div
      className={`graph-node graph-node--${data.entity} graph-node--${data.tone} graph-node--accent-${
        data.accentTone ?? data.tone
      }${isSelected ? " graph-node--selected" : ""}${
        isDisabled ? " graph-node--disabled" : ""
      }${isCardClickable ? " graph-node--clickable" : ""}`}
      onClick={handleCardClick}
      onKeyDown={handleCardKeyDown}
      role={isCardClickable ? "button" : undefined}
      tabIndex={isCardClickable ? 0 : undefined}
      title={data.description ?? data.title}
    >
      {lockState ? (
        <span
          aria-label={lockState === "locked" ? "Заблокировано" : "Доступно"}
          className={`graph-node__lock graph-node__lock--${lockState}`}
          title={lockState === "locked" ? "Заблокировано" : "Доступно"}
        />
      ) : null}

      <div className="graph-node__header">
        <span
          className={`graph-node__badge graph-node__badge--${data.badgeTone ?? data.tone}`}
        >
          {data.badge}
        </span>

        {hint || secondaryHint ? (
          <div className="graph-node__actions">
            {hint ? (
              <span
                className="graph-node__hint"
                onClick={handleHintClick}
                role="button"
                tabIndex={0}
                onKeyDown={handleActionKeyDown(hintAction)}
              >
                {hint}
              </span>
            ) : null}

            {secondaryHint ? (
              <span
                className="graph-node__hint graph-node__hint--secondary"
                onClick={handleSecondaryHintClick}
                role="button"
                tabIndex={0}
                onKeyDown={handleActionKeyDown(secondaryHintAction)}
              >
                {secondaryHint}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      <strong className="graph-node__title">{data.title}</strong>
      {data.subtitle ? <p className="graph-node__subtitle">{data.subtitle}</p> : null}
      {data.description ? (
        <p className="graph-node__description">{data.description}</p>
      ) : null}

      {metrics.length ? (
        <div className="graph-node__metrics">
          {metrics.map((metric) => (
            <span key={metric}>{metric}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
