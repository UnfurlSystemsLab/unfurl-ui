import { lazy, Suspense } from "react";
import type { DynamicDcpProjectionResponse, StudioLayoutMode, StudioViewpoint } from "@unfurl/fabric-validation-client";
import { gridLayout } from "@unfurl/graph-layout";
import type { SceneDropTarget, SemanticDcpSceneProjection, SemanticZoomLevel, ThreeAssemblySelection } from "../ThreeAssemblyScene.js";
import { migrateActiveView } from "./viewState.js";
import type { ModelNode, ViewModel } from "./projectors.js";
import type { OverlayAnnotation } from "./overlays.js";

const ThreeAssemblyScene = lazy(async () => {
  const module = await import("../ThreeAssemblyScene.js");
  return { default: module.ThreeAssemblyScene };
});

/** What every renderer receives: the active view's model, the overlay badges, the selection and how to select. */
export type RendererProps = {
  readonly model: ViewModel;
  readonly badges: ReadonlyMap<string, readonly OverlayAnnotation[]>;
  readonly selectedId?: string;
  readonly onSelect: (selection: ThreeAssemblySelection) => void;
};

/** The scene selection for a model element. */
export function selectionFor(node: ModelNode): ThreeAssemblySelection {
  return node.kind === "SUBSTRATE_PORT"
    ? { id: `substrate:${node.id}`, kind: "substrate", surface: node.id, label: node.label }
    : { id: `component:${node.id}`, kind: "component", surface: node.id, label: node.label };
}

/**
 * Strategy (2D renderer): the model's nodes on a grid with its edges as lines, keyboard-reachable (VC §20). It draws
 * exactly the model's elements, the same set the Table renderer lists (LLD §9 renderer parity).
 */
export function TwoDRenderer({ model, badges, selectedId, onSelect }: RendererProps) {
  const layout = gridLayout({
    nodes: model.nodes.map(node => ({ id: node.id, label: node.label, kind: node.kind === "SUBSTRATE_PORT" ? "SUBSTRATE" : "COMPONENT" })),
    edges: []
  }, { columns: 4, gap: 180 });
  const position = new Map(layout.nodes.map(node => [node.id, node]));
  const width = Math.max(1, Math.min(4, model.nodes.length)) * 180;
  const height = Math.max(1, Math.ceil(model.nodes.length / 4)) * 180;
  return (
    <div className="workbench-2d" aria-label="2D renderer">
      <svg viewBox={`-40 -40 ${width + 40} ${height + 40}`} role="img" aria-label={`${model.nodes.length} elements, ${model.edges.length} connections`}>
        {model.edges.map(edge => {
          const from = position.get(edge.from);
          const to = position.get(edge.to);
          if (!from || !to) return null;
          return <line key={edge.id} data-element-id={edge.id} x1={from.x + 60} y1={from.y + 30} x2={to.x + 60} y2={to.y + 30}
            className={`workbench-edge ${edge.status === "BLOCKED" ? "blocked" : ""}`} />;
        })}
      </svg>
      <ul className="workbench-2d-nodes">
        {model.nodes.map(node => {
          const point = position.get(node.id)!;
          return (
            <li key={node.id} style={{ left: point.x + 40, top: point.y + 40 }}>
              <button type="button" data-element-id={node.id} aria-pressed={selectedId === node.id}
                className={`workbench-node ${node.kind === "SUBSTRATE_PORT" ? "substrate" : "component"}`} onClick={() => onSelect(selectionFor(node))}>
                <strong>{node.label}</strong>
                <Badges annotations={badges.get(node.id)} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Strategy (Table renderer): the model's nodes and edges as accessible tables, available for every view (VC §20). It
 * lists exactly the 2D renderer's elements, with each overlay's badges as a column.
 */
export function TableRenderer({ model, badges, selectedId, onSelect }: RendererProps) {
  return (
    <div className="workbench-table" aria-label="Table renderer">
      <table>
        <caption>Elements</caption>
        <thead><tr><th scope="col">Element</th><th scope="col">Kind</th><th scope="col">Level</th><th scope="col">Facts</th><th scope="col">Overlays</th></tr></thead>
        <tbody>
          {model.nodes.map(node => (
            <tr key={node.id} data-element-id={node.id} aria-selected={selectedId === node.id}>
              <td><button type="button" className="link-button" onClick={() => onSelect(selectionFor(node))}>{node.label}</button></td>
              <td>{node.kind === "SUBSTRATE_PORT" ? "substrate port" : "component"}</td>
              <td>{node.level ?? ""}</td>
              <td>{node.facts.map(fact => <div key={fact.label}>{fact.label}: {fact.value}</div>)}</td>
              <td><Badges annotations={badges.get(node.id)} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <table>
        <caption>Connections</caption>
        <thead><tr><th scope="col">From</th><th scope="col">To</th><th scope="col">Kind</th><th scope="col">Status</th><th scope="col">Reason</th><th scope="col">Overlays</th></tr></thead>
        <tbody>
          {model.edges.length === 0
            ? <tr><td colSpan={6}>No connections in this view.</td></tr>
            : model.edges.map(edge => (
              <tr key={edge.id} data-element-id={edge.id}>
                <td>{edge.from}</td><td>{edge.to}</td><td>{edge.label ? `${edge.kind} (${edge.label})` : edge.kind}</td>
                <td>{edge.status ?? ""}</td><td>{edge.reason ?? ""}</td><td><Badges annotations={badges.get(edge.id)} /></td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

/** Overlay badges on one element. */
function Badges({ annotations }: { readonly annotations: readonly OverlayAnnotation[] | undefined }) {
  if (!annotations || annotations.length === 0) return null;
  return <span className="overlay-badges">{annotations.map(annotation => (
    <span key={`${annotation.label}:${annotation.source}`} className={`overlay-badge ${annotation.severity.toLowerCase()}`} title={annotation.detail}>
      {annotation.label}
    </span>
  ))}</span>;
}

/**
 * Adapter: the 3D scene's mode for a view and layout. The scene's internals still speak the retired tab values, so this is
 * the one place they are mapped (LLD §5.4, in reverse): 3D exists only for Flow (assembly or exploded) and Topology.
 */
export function sceneModeFor(view: StudioViewpoint, layout: StudioLayoutMode | undefined): string {
  if (view === "TOPOLOGY") return "Substrate";
  return layout === "EXPLODED" ? "Exploded" : "Assembly";
}

/** Adapter: a mode the scene switched to by keyboard, as a view and layout (LLD §5.4). */
export function viewForSceneMode(mode: string): { readonly view: StudioViewpoint; readonly layout?: StudioLayoutMode } | undefined {
  const migrated = migrateActiveView(mode);
  return migrated ? { view: migrated.view, ...(migrated.layout === undefined ? {} : { layout: migrated.layout }) } : undefined;
}

export type ThreeDRendererProps = {
  readonly view: StudioViewpoint;
  readonly layout?: StudioLayoutMode;
  readonly projection: DynamicDcpProjectionResponse;
  readonly semanticProjection: SemanticDcpSceneProjection;
  readonly requestedZoom: SemanticZoomLevel;
  readonly selection: ThreeAssemblySelection;
  readonly extractedPartId?: string;
  readonly draftCatalogEntryIds?: ReadonlySet<string>;
  readonly preview?: { readonly connectionNodes: ReadonlySet<string>; readonly replacementNodes: ReadonlySet<string>; readonly portIds: ReadonlySet<string> };
  readonly onSelect: (selection: ThreeAssemblySelection) => void;
  readonly onSceneMode: (mode: string) => void;
  readonly onZoom: (level: SemanticZoomLevel) => void;
  readonly onDrop: (catalogEntryId: string, target: SceneDropTarget) => void;
};

/** Strategy (3D renderer): the existing scene over the draft projection, in the view's mode. */
export function ThreeDRenderer(props: ThreeDRendererProps) {
  return (
    <Suspense fallback={<div className="three-assembly-scene" aria-label="3D assembly scene" />}>
      <ThreeAssemblyScene
        activeView={sceneModeFor(props.view, props.layout)}
        selectedSurface={props.selection.surface}
        selectedPartId={props.selection.id}
        extractedPartId={props.extractedPartId}
        semanticProjection={props.semanticProjection}
        requestedSemanticZoomLevel={props.requestedZoom}
        dynamicProjection={props.projection}
        draftCatalogEntryIds={props.draftCatalogEntryIds}
        previewConnectionNodes={props.preview?.connectionNodes}
        previewReplacementNodes={props.preview?.replacementNodes}
        previewPortIds={props.preview?.portIds}
        onCatalogEntryDropped={props.onDrop}
        onSelect={surface => props.onSelect({ id: surface === "substrate" ? "substrate:base" : `component:${surface}`,
          kind: surface === "substrate" ? "substrate" : "component", surface, label: surface })}
        onSelectPart={props.onSelect}
        onViewChange={props.onSceneMode}
        onSemanticZoomChange={props.onZoom}
      />
    </Suspense>
  );
}
