import { lazy, Suspense } from "react";
import type { DynamicDcpProjectionResponse, StudioLayoutMode, StudioViewpoint } from "@unfurl/fabric-validation-client";
import { gridLayout } from "@unfurl/graph-layout";
import type { SceneDropTarget, SemanticDcpSceneProjection, SemanticZoomLevel, ThreeAssemblySelection } from "../ThreeAssemblyScene.js";
import { migrateActiveView } from "./viewState.js";
import type { Fact, ModelNode, ViewModel } from "./projectors.js";
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

/** Plain-language name of each element kind, as the Table renderer lists it. */
export const NODE_KIND_LABELS: Readonly<Record<ModelNode["kind"], string>> = {
  COMPONENT: "component",
  SUBSTRATE_PORT: "substrate port",
  EXTERNAL_OWNER: "owner outside the catalog",
  OWNED_STATE: "owned state",
  OWNED_DECISION: "owned decision"
};

/** The scene selection for a model element. */
export function selectionFor(node: ModelNode): ThreeAssemblySelection {
  return node.kind === "SUBSTRATE_PORT"
    ? { id: `substrate:${node.id}`, kind: "substrate", surface: node.id, label: node.label }
    : { id: `component:${node.id}`, kind: "component", surface: node.id, label: node.label };
}

/** The 2D grid: columns, the distance between grid points, the canvas margin, and the node box (§5.7 rule 1). */
const GRID_COLUMNS = 4;
const GRID_GAP = 190;
const CANVAS_MARGIN = 24;
/** A node box is narrower than its column, so neighbouring boxes never overlap; a longer label wraps. */
export const NODE_BOX_WIDTH = 160;
/**
 * The height of every node box: room for the label, badges and a few fact lines, less than the gap between rows, so rows
 * never overlap; more facts scroll inside the box (§5.7 rule 1). An edge ends at the middle of a box.
 */
export const NODE_BOX_HEIGHT = 150;

/** Where the 2D renderer puts each node box and edge, all in one pixel coordinate system (§5.7 rule 1). */
export type TwoDLayout = {
  readonly width: number;
  readonly height: number;
  readonly boxes: ReadonlyMap<string, { readonly left: number; readonly top: number }>;
  readonly edges: ReadonlyMap<string, { readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number }>;
};

/**
 * Layout (pure) for the 2D renderer: nodes on a grid, each edge from the middle of one box to the middle of the other,
 * and the canvas size that holds them. Boxes and edges share one pixel space and the canvas is drawn at that size, never
 * scaled, so an edge always ends on its nodes' boxes (§5.7 rule 1).
 */
export function twoDLayout(model: ViewModel): TwoDLayout {
  const grid = gridLayout({
    nodes: model.nodes.map(node => ({ id: node.id, label: node.label, kind: node.kind === "SUBSTRATE_PORT" ? "SUBSTRATE" : "COMPONENT" })),
    edges: []
  }, { columns: GRID_COLUMNS, gap: GRID_GAP });
  const boxes = new Map(grid.nodes.map(node => [node.id, { left: node.x + CANVAS_MARGIN, top: node.y + CANVAS_MARGIN }]));
  const anchor = (id: string) => {
    const box = boxes.get(id);
    return box && { x: box.left + NODE_BOX_WIDTH / 2, y: box.top + NODE_BOX_HEIGHT / 2 };
  };
  const edges = new Map<string, { x1: number; y1: number; x2: number; y2: number }>();
  for (const edge of model.edges) {
    const from = anchor(edge.from);
    const to = anchor(edge.to);
    if (from && to) edges.set(edge.id, { x1: from.x, y1: from.y, x2: to.x, y2: to.y });
  }
  const columns = Math.max(1, Math.min(GRID_COLUMNS, model.nodes.length));
  const rows = Math.max(1, Math.ceil(model.nodes.length / GRID_COLUMNS));
  return {
    width: (columns - 1) * GRID_GAP + NODE_BOX_WIDTH + CANVAS_MARGIN * 2,
    height: (rows - 1) * GRID_GAP + NODE_BOX_HEIGHT + CANVAS_MARGIN * 2,
    boxes,
    edges
  };
}

/**
 * Strategy (2D renderer): the model's nodes on a grid with its edges as lines, keyboard-reachable (VC §20). It draws
 * exactly the model's elements, the same set the Table renderer lists (LLD §9 renderer parity). The lines and the boxes
 * are laid out by {@link twoDLayout} in one pixel space on a canvas of that size, which the stage scrolls (§5.7 rule 1).
 */
export function TwoDRenderer({ model, badges, selectedId, onSelect }: RendererProps) {
  const layout = twoDLayout(model);
  return (
    <div className="workbench-2d" aria-label="2D renderer">
      <div className="workbench-2d-canvas" style={{ width: layout.width, height: layout.height }}>
        <svg width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} role="img"
          aria-label={`${model.nodes.length} elements, ${model.edges.length} connections`}>
          {model.edges.map(edge => {
            const line = layout.edges.get(edge.id);
            if (!line) return null;
            // An annotated edge is drawn as a path, styled by its most severe annotation (LLD §4.3 rule 1), for example
            // Resilience & Faults' propagation up the CONTAINS tree; its title lists every annotation.
            const annotations = badges.get(edge.id) ?? [];
            const severity = mostSevere(annotations);
            return (
              <line key={edge.id} data-element-id={edge.id} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2}
                className={`workbench-edge ${edge.status === "BLOCKED" ? "blocked" : ""} ${severity ? `annotated ${severity.toLowerCase()}` : ""}`}>
                {annotations.length > 0 && <title>{annotations.map(annotation => `${annotation.label}: ${annotation.detail}`).join("\n")}</title>}
              </line>
            );
          })}
        </svg>
        <ul className="workbench-2d-nodes">
          {model.nodes.map(node => {
            const box = layout.boxes.get(node.id)!;
            return (
              <li key={node.id} style={{ left: box.left, top: box.top, width: NODE_BOX_WIDTH, height: NODE_BOX_HEIGHT }}>
                <button type="button" data-element-id={node.id} aria-pressed={selectedId === node.id} title={node.label}
                  className={`workbench-node ${node.kind === "SUBSTRATE_PORT" ? "substrate" : node.kind === "COMPONENT" ? "component" : node.kind.toLowerCase().replace("_", "-")}`} onClick={() => onSelect(selectionFor(node))}>
                  <strong>{node.label}</strong>
                  <Badges annotations={badges.get(node.id)} />
                  <FactLines facts={node.facts} />
                </button>
              </li>
            );
          })}
        </ul>
      </div>
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
              <td>{NODE_KIND_LABELS[node.kind]}</td>
              <td>{node.level ?? ""}</td>
              <td>{node.facts.map((fact, index) => <div key={`${fact.label}#${index}`}>{fact.label}: {fact.value}</div>)}</td>
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

/**
 * Strategy (2D renderer of Data & State, §3.2): the ownership matrix. Rows are the components, columns the owned
 * resources and decisions, and a cell holds the sensitivity or authority of an ownership edge. It draws exactly the
 * model's elements, the same set the Table renderer lists (LLD §9 renderer parity), and every element is a button.
 */
export function OwnershipMatrixRenderer({ model, badges, selectedId, onSelect }: RendererProps) {
  const owners = model.nodes.filter(node => node.kind === "COMPONENT");
  const owned = model.nodes.filter(node => node.kind === "OWNED_STATE" || node.kind === "OWNED_DECISION");
  const cell = new Map(model.edges.map(edge => [`${edge.from}|${edge.to}`, edge]));
  return (
    <div className="workbench-matrix" aria-label="2D renderer: ownership matrix">
      <table>
        <caption>Ownership: components by owned state and decisions</caption>
        <thead>
          <tr>
            <th scope="col">Component</th>
            {owned.map(node => (
              <th scope="col" key={node.id} data-element-id={node.id}>
                <button type="button" className="link-button" aria-pressed={selectedId === node.id} onClick={() => onSelect(selectionFor(node))}>
                  {node.label}</button>
                <small>{NODE_KIND_LABELS[node.kind]}</small>
                <Badges annotations={badges.get(node.id)} />
                <FactLines facts={node.facts} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {owners.map(owner => (
            <tr key={owner.id} data-element-id={owner.id}>
              <th scope="row">
                <button type="button" className="link-button" aria-pressed={selectedId === owner.id} onClick={() => onSelect(selectionFor(owner))}>
                  {owner.label}</button>
                <Badges annotations={badges.get(owner.id)} />
                <FactLines facts={owner.facts} />
              </th>
              {owned.map(node => {
                const edge = cell.get(`${owner.id}|${node.id}`);
                return <td key={node.id} {...(edge ? { "data-element-id": edge.id } : {})}>{edge?.label ?? ""}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * An element's facts as the 2D renderers show them (§5.7 rules 1 and 2): one line each, label and value, the full text
 * and the Fabric field it came from as the line's title. The same facts as the element's Table row, so a Topology shape or
 * a depth roll-up is never seen in one renderer and missing from another.
 */
export function FactLines({ facts }: { readonly facts: readonly Fact[] }) {
  if (facts.length === 0) return null;
  return (
    <ul className="node-facts">
      {facts.map((fact, index) => (
        <li key={`${fact.label}#${index}`} title={`${fact.label}: ${fact.value} (from ${fact.source})`}>
          <span className="node-fact-label">{fact.label}</span>{` ${fact.value}`}
        </li>
      ))}
    </ul>
  );
}

/** The most severe of an element's annotations, or undefined when it has none. */
function mostSevere(annotations: readonly OverlayAnnotation[]): OverlayAnnotation["severity"] | undefined {
  const order: readonly OverlayAnnotation["severity"][] = ["ERROR", "WARNING", "INFO"];
  return order.find(severity => annotations.some(annotation => annotation.severity === severity));
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
