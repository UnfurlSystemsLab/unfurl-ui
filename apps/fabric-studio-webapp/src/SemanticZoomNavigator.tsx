import { useEffect, useMemo, useState } from "react";
import type { DynamicDcpNode, DynamicDcpProjectionResponse } from "@unfurl/fabric-validation-client";

export type SemanticZoomNavigatorProps = {
  readonly projection?: DynamicDcpProjectionResponse | undefined;
  // Fired when the operator drills into or selects a node, so the rest of the
  // workbench (inspector / scene selection) can follow. Passes the real nodeId.
  readonly onSelectNode?: (nodeId: string) => void;
};

/**
 * Recursive, depth-agnostic composition navigator. It reads nesting purely from
 * the projection's {@code CONTAINS} edges, so it drills to whatever depth the
 * data provides today (PARENT → ASSEMBLY → CHILD) and automatically extends to
 * arbitrary depth once the backend emits a recursive projection — no UI change
 * needed. It never fabricates nodes: a node with no contained children renders
 * an honest leaf state, and a missing projection renders an empty state.
 *
 * This is a separate DOM control; it does not drive the 3D ThreeAssemblyScene.
 */
export function SemanticZoomNavigator({ projection, onSelectNode }: SemanticZoomNavigatorProps) {
  const [path, setPath] = useState<readonly string[]>(() => (projection ? [projection.rootNodeId] : []));

  // Resync the focus path when the projection root changes (effects don't run
  // during SSR, so initial render derives from the lazy initializer above).
  useEffect(() => {
    setPath(projection ? [projection.rootNodeId] : []);
  }, [projection?.rootNodeId]);

  const nodeById = useMemo(() => {
    const map = new Map<string, DynamicDcpNode>();
    for (const node of projection?.nodes ?? []) {
      map.set(node.nodeId, node);
    }
    return map;
  }, [projection]);

  // parentNodeId -> contained child nodes, derived only from CONTAINS edges.
  const childrenByParent = useMemo(() => {
    const map = new Map<string, DynamicDcpNode[]>();
    for (const edge of projection?.edges ?? []) {
      if (edge.relationship !== "CONTAINS") {
        continue;
      }
      const child = nodeById.get(edge.toNodeId);
      if (!child) {
        continue;
      }
      const existing = map.get(edge.fromNodeId) ?? [];
      existing.push(child);
      map.set(edge.fromNodeId, existing);
    }
    return map;
  }, [projection, nodeById]);

  if (!projection || nodeById.size === 0) {
    return (
      <section className="zoom-navigator" aria-label="Semantic zoom navigator">
        <div className="zoom-empty" role="status">No composition projection available to navigate.</div>
      </section>
    );
  }

  // Keep only path segments that still exist; collapse to the deepest valid one.
  const validPath = path.filter(id => nodeById.has(id));
  const focusId = validPath[validPath.length - 1] ?? projection.rootNodeId;
  const focus = nodeById.get(focusId);
  const children = childrenByParent.get(focusId) ?? [];

  const drillToCrumb = (index: number) => {
    const next = validPath.slice(0, index + 1);
    setPath(next.length > 0 ? next : [projection.rootNodeId]);
    const target = next[next.length - 1];
    if (target) {
      onSelectNode?.(target);
    }
  };
  const drillInto = (nodeId: string) => {
    setPath([...validPath, nodeId]);
    onSelectNode?.(nodeId);
  };
  const zoomOut = () => {
    if (validPath.length > 1) {
      drillToCrumb(validPath.length - 2);
    }
  };
  const zoomIn = () => {
    if (children[0]) {
      drillInto(children[0].nodeId);
    }
  };
  const zoomTop = () => {
    setPath([projection.rootNodeId]);
    onSelectNode?.(projection.rootNodeId);
  };

  const depthLabel = `${focus?.level ?? focus?.dcpType ?? "—"} · depth ${validPath.length}`;

  return (
    <section className="zoom-navigator" aria-label="Semantic zoom navigator">
      <div className="zoom-bar">
        <div className="zoom-crumbs" aria-label="Composition breadcrumb">
          {validPath.map((id, index) => {
            const node = nodeById.get(id);
            const isLast = index === validPath.length - 1;
            return (
              <span className="zoom-crumb-wrap" key={id}>
                <button
                  type="button"
                  className={isLast ? "zoom-crumb active" : "zoom-crumb"}
                  onClick={() => drillToCrumb(index)}
                >
                  {node?.label ?? id}
                </button>
                {!isLast && <span className="zoom-sep" aria-hidden="true">›</span>}
              </span>
            );
          })}
        </div>
        <div className="zoom-controls">
          <span className="zoom-depth">{depthLabel}</span>
          <button type="button" className="zoom-btn" title="Zoom out one level" disabled={validPath.length <= 1} onClick={zoomOut}>−</button>
          <button type="button" className="zoom-btn" title="Zoom into first aggregate" disabled={children.length === 0} onClick={zoomIn}>+</button>
          <button type="button" className="zoom-btn" title="Zoom to top" onClick={zoomTop}>Top</button>
        </div>
      </div>
      <div className="zoom-children">
        {children.length === 0 ? (
          <div className="zoom-leaf" role="status">
            <strong>{focus?.label ?? focusId}</strong>
            <span>Deepest composition unit on this path — no further aggregates. Zoom back out to continue.</span>
          </div>
        ) : (
          children.map(child => {
            const grandchildren = childrenByParent.get(child.nodeId) ?? [];
            return (
              <button type="button" className="zoom-tile" key={child.nodeId} onClick={() => drillInto(child.nodeId)}>
                <span className="zoom-tile-kind">{child.level ?? child.dcpType}</span>
                <span className="zoom-tile-name">{child.label}</span>
                <span className="zoom-tile-meta">
                  {grandchildren.length > 0 ? `${grandchildren.length} contained · drill in →` : "leaf unit"}
                </span>
              </button>
            );
          })
        )}
      </div>
    </section>
  );
}
