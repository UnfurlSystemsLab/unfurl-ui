import { useMemo, useState } from "react";
import type { DeploymentShape, ResolveDeploymentResponse, StudioFabricClient } from "@unfurl/fabric-validation-client";
import {
  DEPLOYMENT_SHAPE_OPTIONS,
  createDefaultDeploymentPlannerState,
  deploymentPolicyFromPlannerState,
  disallowDeploymentShape,
  preferDeploymentShape,
  requireIsolationForCapabilityPattern,
  setDeploymentRuntime,
  type DeploymentPlannerState
} from "./deploymentPlanner.js";
import { buildDeploymentPlannerView } from "./deploymentPlannerView.js";
import { SelectedShapesPanel } from "./SelectedShapesPanel.js";
import { RejectedShapesPanel } from "./RejectedShapesPanel.js";
import { IsolationMatchesPanel } from "./IsolationMatchesPanel.js";
import { FallbackAttemptsPanel } from "./FallbackAttemptsPanel.js";
import { RequiredPortsPanel } from "./RequiredPortsPanel.js";
import { DiagnosticArtifactsPanel } from "./DiagnosticArtifactsPanel.js";

export type DeploymentPlannerPanelProps = {
  readonly client: Pick<StudioFabricClient, "resolveDeployment">;
  readonly initialTenantId?: string;
  readonly initialAssemblyId?: string;
  readonly initialSessionId?: string;
  readonly initialNeedsId?: string;
  readonly initialNeedsYaml?: string;
  readonly initialCatalogPath?: string;
  readonly initialAssemblyPath?: string;
  readonly initialPlannerState?: DeploymentPlannerState | undefined;
};

/**
 * Panel component: resolves deployment shapes either from a Studio draft session
 * or from filesystem catalog/needs paths for debug launches.
 */
export function DeploymentPlannerPanel({
  client,
  initialTenantId = "",
  initialAssemblyId = "",
  initialSessionId = "",
  initialNeedsId = "",
  initialNeedsYaml = "",
  initialCatalogPath = "",
  initialAssemblyPath = "",
  initialPlannerState
}: DeploymentPlannerPanelProps) {
  const [catalogPath, setCatalogPath] = useState(initialCatalogPath);
  const [assemblyPath, setAssemblyPath] = useState(initialAssemblyPath);
  const [candidateId, setCandidateId] = useState("");
  const [autoSelectBest, setAutoSelectBest] = useState(false);
  const [isolationPattern, setIsolationPattern] = useState("");
  const [planner, setPlanner] = useState<DeploymentPlannerState>(
    initialPlannerState ?? createDefaultDeploymentPlannerState()
  );
  const [response, setResponse] = useState<ResolveDeploymentResponse | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const policy = useMemo(() => deploymentPolicyFromPlannerState(planner), [planner]);
  const view = useMemo(() => buildDeploymentPlannerView(planner, response), [planner, response]);
  const sessionBacked = initialTenantId.trim() !== ""
    && initialAssemblyId.trim() !== ""
    && initialSessionId.trim() !== "";

  async function resolve() {
    if (!client.resolveDeployment) {
      setError("resolveDeployment API is not available");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const resolved = await client.resolveDeployment({
        ...(sessionBacked
          ? {
              tenantId: initialTenantId,
              assemblyId: initialAssemblyId,
              sessionId: initialSessionId,
              ...(initialNeedsId.trim() === "" ? {} : { needsId: initialNeedsId.trim() }),
              ...(initialNeedsYaml.trim() === "" ? {} : { needsYaml: initialNeedsYaml })
            }
          : {
              catalogPath,
              needsPath: assemblyPath
            }),
        ...(candidateId.trim() === "" ? {} : { candidateId: candidateId.trim() }),
        autoSelectBest,
        deploymentPolicy: policy
      });
      setResponse(resolved);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  function prefer(shape: DeploymentShape) {
    setPlanner(current => preferDeploymentShape(current, shape));
  }

  function disallow(shape: DeploymentShape, checked: boolean) {
    setPlanner(current => checked ? disallowDeploymentShape(current, shape) : current);
  }

  function addIsolationPattern() {
    setPlanner(current => requireIsolationForCapabilityPattern(current, isolationPattern));
    setIsolationPattern("");
  }

  return (
    <div className="studio-page">
      <header className="studio-header">
        <h1>{view.title}</h1>
        <p>Resolve physical deployment shapes from catalog, assembly profile, and operator policy.</p>
      </header>

      <section className="studio-panel">
        <h2>Inputs</h2>
        {sessionBacked ? (
          <div className="summary-list">
            <span>Tenant {initialTenantId}</span>
            <span>Assembly {initialAssemblyId}</span>
            <span>Session {initialSessionId}</span>
          </div>
        ) : (
          <>
            <label>
              Catalog directory
              <input value={catalogPath} onChange={event => setCatalogPath(event.target.value)} />
            </label>
            <label>
              Assembly YAML path
              <input value={assemblyPath} onChange={event => setAssemblyPath(event.target.value)} />
            </label>
          </>
        )}
        <label>
          Candidate ID
          <input value={candidateId} onChange={event => setCandidateId(event.target.value)} />
        </label>
        <label className="studio-checkbox">
          <input
            type="checkbox"
            checked={autoSelectBest}
            onChange={event => setAutoSelectBest(event.target.checked)}
          />
          Auto-select best ambiguous candidate
        </label>
      </section>

      <section className="studio-panel">
        <h2>Shape Policy</h2>
        <div className="shape-grid">
          {DEPLOYMENT_SHAPE_OPTIONS.map(option => (
            <div className="shape-card" key={option.shape}>
              <strong>{option.label}</strong>
              <p>{option.description}</p>
              <button type="button" onClick={() => prefer(option.shape)}>Prefer</button>
              <label className="studio-checkbox">
                <input
                  type="checkbox"
                  checked={policy.disallowedShapes.includes(option.shape)}
                  onChange={event => disallow(option.shape, event.target.checked)}
                />
                Disallow
              </label>
            </div>
          ))}
        </div>
        <label>
          Java version
          <input
            value={planner.runtime.javaVersion ?? ""}
            onChange={event => setPlanner(current => setDeploymentRuntime(current, {
              ...current.runtime,
              javaVersion: event.target.value
            }))}
          />
        </label>
        <label className="studio-checkbox">
          <input
            type="checkbox"
            checked={planner.runtime.springBoot === true}
            onChange={event => setPlanner(current => setDeploymentRuntime(current, {
              ...current.runtime,
              springBoot: event.target.checked
            }))}
          />
          Spring Boot available
        </label>
        <label className="studio-checkbox">
          <input
            type="checkbox"
            checked={planner.runtime.kubernetes === true}
            onChange={event => setPlanner(current => setDeploymentRuntime(current, {
              ...current.runtime,
              kubernetes: event.target.checked
            }))}
          />
          Kubernetes available
        </label>
        <label className="studio-checkbox">
          <input
            type="checkbox"
            checked={planner.runtime.serviceMesh === true}
            onChange={event => setPlanner(current => setDeploymentRuntime(current, {
              ...current.runtime,
              serviceMesh: event.target.checked
            }))}
          />
          Service mesh available
        </label>
        <label>
          Maximum services
          <input
            type="number"
            value={planner.runtime.maxServices ?? ""}
            onChange={event => setPlanner(current => {
              const { maxServices: _ignored, ...runtimeWithoutMaxServices } = current.runtime;
              return setDeploymentRuntime(current, event.target.value === ""
                ? runtimeWithoutMaxServices
                : { ...runtimeWithoutMaxServices, maxServices: Number(event.target.value) });
            })}
          />
        </label>
        <label>
          Require isolation for capability pattern
          <input value={isolationPattern} onChange={event => setIsolationPattern(event.target.value)} />
        </label>
        <button type="button" onClick={addIsolationPattern}>Add isolation pattern</button>
      </section>

      <button className="primary-action" type="button" disabled={busy} onClick={resolve}>
        {busy ? "Resolving..." : "Resolve Deployment"}
      </button>
      {error && <p className="studio-error">{error}</p>}
      {response && (
        <section className="studio-panel">
          <h2>Diagnostics</h2>
          <DiagnosticArtifactsPanel
            artifacts={response.diagnosticArtifacts}
            localArtifact={{
              label: "download deployment resolution",
              fileName: "deployment-resolution.json",
              value: response
            }}
          />
        </section>
      )}

      <div className="panel-grid">
        <SelectedShapesPanel response={response} />
        <RejectedShapesPanel response={response} />
        <IsolationMatchesPanel policy={policy} />
        <FallbackAttemptsPanel policy={policy} response={response} />
        <RequiredPortsPanel response={response} />
      </div>
    </div>
  );
}
