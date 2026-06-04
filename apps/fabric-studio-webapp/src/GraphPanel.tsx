import { useState } from "react";
import type { ReadOnlyCompositionView } from "@unfurl/fabric-scene-model";
import type { StudioFabricClient } from "@unfurl/fabric-validation-client";
import type { PositionedGraphLayout } from "@unfurl/graph-layout";
import { buildPositionedStudioGraphView } from "./graphView.js";

export type GraphRendererMode = "2d" | "3d";

export type GraphPanelProps = {
  readonly client: Pick<StudioFabricClient, "loadCompositionView">;
  readonly initialContractPath?: string;
  readonly initialSubstrateProfilePath?: string;
  readonly initialRenderer?: GraphRendererMode;
};

export function GraphPanel({
  client,
  initialContractPath = "",
  initialSubstrateProfilePath = "",
  initialRenderer = "2d"
}: GraphPanelProps) {
  const [contractPath, setContractPath] = useState(initialContractPath);
  const [substrateProfilePath, setSubstrateProfilePath] = useState(initialSubstrateProfilePath);
  const [renderer, setRenderer] = useState<GraphRendererMode>(initialRenderer);
  const [view, setView] = useState<ReadOnlyCompositionView | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    setError(undefined);
    try {
      const response = await client.loadCompositionView({ contractPath, substrateProfilePath });
      setView(response.view);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  const graph = view ? buildPositionedStudioGraphView(view) : undefined;

  return (
    <div className="studio-page">
      <header className="studio-header">
        <h1>Graph View</h1>
        <p>Inspect components, ports, substrate requirements, and warnings as a governed graph.</p>
      </header>

      <section className="studio-panel">
        <h2>Inputs</h2>
        <label>
          Contract path
          <input value={contractPath} onChange={event => setContractPath(event.target.value)} />
        </label>
        <label>
          Substrate profile path
          <input value={substrateProfilePath} onChange={event => setSubstrateProfilePath(event.target.value)} />
        </label>
        <div className="button-row">
          <button type="button" disabled={busy} onClick={load}>{busy ? "Loading..." : "Load Graph"}</button>
          <button type="button" className={renderer === "2d" ? "secondary-active" : "secondary"} onClick={() => setRenderer("2d")}>2D</button>
          <button type="button" className={renderer === "3d" ? "secondary-active" : "secondary"} onClick={() => setRenderer("3d")}>3D</button>
        </div>
      </section>

      {error && <p className="studio-error">{error}</p>}
      {!view && <section className="studio-panel"><h2>Graph</h2><p>No composition loaded.</p></section>}
      {view && renderer === "3d" && (
        <section className="studio-panel">
          <h2>3D Renderer</h2>
          <p>3D graph rendering lands in the next Studio phase. Use 2D for the governed inspection path.</p>
        </section>
      )}
      {graph && renderer === "2d" && <GraphSvg graph={graph} />}
    </div>
  );
}

function GraphSvg({ graph }: { readonly graph: PositionedGraphLayout }) {
  const width = Math.max(640, ...graph.nodes.map(node => node.x + 180));
  const height = Math.max(360, ...graph.nodes.map(node => node.y + 120));
  return (
    <section className="studio-panel">
      <h2>2D Graph</h2>
      <svg className="graph-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Composition graph">
        {graph.edges.map(edge => {
          const from = graph.nodes.find(node => node.id === edge.from);
          const to = graph.nodes.find(node => node.id === edge.to);
          if (!from || !to) {
            return null;
          }
          return (
            <g key={edge.id}>
              <line x1={from.x + 70} y1={from.y + 24} x2={to.x + 70} y2={to.y + 24} className="graph-edge" />
              <title>{edge.kind}</title>
            </g>
          );
        })}
        {graph.nodes.map(node => (
          <g key={node.id} transform={`translate(${node.x}, ${node.y})`}>
            <rect className={`graph-node graph-node-${node.kind.toLowerCase()}`} width="140" height="48" rx="6" />
            <text x="10" y="19">{node.kind}</text>
            <text x="10" y="36">{truncate(node.label)}</text>
          </g>
        ))}
      </svg>
    </section>
  );
}

function truncate(value: string): string {
  return value.length > 22 ? `${value.slice(0, 19)}...` : value;
}
