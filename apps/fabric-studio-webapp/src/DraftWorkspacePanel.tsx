import { useState } from "react";
import type { StudioFabricClient } from "@unfurl/fabric-validation-client";
import {
  applyDraftIntent,
  compileDraftWorkspace,
  createDraftWorkspace,
  type DraftWorkspaceState
} from "./draftWorkspace.js";
import { buildSigningHandoff } from "./signingHandoff.js";

export type DraftWorkspacePanelProps = {
  readonly client: Pick<StudioFabricClient, "createDraftComposition" | "applyIntent" | "getDraftSession" | "compileCandidate">;
  readonly initialBaseCatalogHash?: string | undefined;
};

export function DraftWorkspacePanel({ client, initialBaseCatalogHash = "sha256:catalog" }: DraftWorkspacePanelProps) {
  const [baseCatalogHash, setBaseCatalogHash] = useState(initialBaseCatalogHash);
  const [needsId, setNeedsId] = useState("");
  const [catalogEntryId, setCatalogEntryId] = useState("com.unfurl:storage-s3:1.2.0");
  const [fromPort, setFromPort] = useState("workflow.storage.required");
  const [toPort, setToPort] = useState("storage-s3.storage.put");
  const [sign, setSign] = useState(false);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<DraftWorkspaceState | undefined>();

  async function create() {
    setBusy(true);
    try {
      setState(await createDraftWorkspace(client, {
        baseCatalogHash,
        ...(needsId.trim() === "" ? {} : { needsId: needsId.trim() })
      }));
    } finally {
      setBusy(false);
    }
  }

  async function addComponent() {
    if (!state) {
      return;
    }
    setBusy(true);
    try {
      setState(await applyDraftIntent(client, state, { type: "ADD_COMPONENT", catalogEntryId }));
    } finally {
      setBusy(false);
    }
  }

  async function connectPorts() {
    if (!state) {
      return;
    }
    setBusy(true);
    try {
      setState(await applyDraftIntent(client, state, { type: "CONNECT", fromPort, toPort }));
    } finally {
      setBusy(false);
    }
  }

  async function compile() {
    if (!state) {
      return;
    }
    setBusy(true);
    try {
      setState(await compileDraftWorkspace(client, state, { sign }));
    } finally {
      setBusy(false);
    }
  }

  const handoff = state ? buildSigningHandoff(state, { signingRequested: sign }) : undefined;

  return (
    <div className="studio-page">
      <header className="studio-header">
        <h1>Draft Workspace</h1>
        <p>Create a governed draft session, apply operator intents, and compile artifacts.</p>
      </header>

      <section className="studio-panel">
        <h2>Session</h2>
        <label>
          Base catalog hash
          <input value={baseCatalogHash} onChange={event => setBaseCatalogHash(event.target.value)} />
        </label>
        <label>
          Needs ID
          <input value={needsId} onChange={event => setNeedsId(event.target.value)} />
        </label>
        <button type="button" disabled={busy} onClick={create}>{busy ? "Working..." : "Create Draft"}</button>
      </section>

      <div className="panel-grid">
        <section className="studio-panel">
          <h2>Add Component</h2>
          <label>
            Catalog entry ID
            <input value={catalogEntryId} onChange={event => setCatalogEntryId(event.target.value)} />
          </label>
          <button type="button" disabled={busy || state?.status !== "READY"} onClick={addComponent}>Apply Add</button>
        </section>

        <section className="studio-panel">
          <h2>Connect Ports</h2>
          <label>
            From port
            <input value={fromPort} onChange={event => setFromPort(event.target.value)} />
          </label>
          <label>
            To port
            <input value={toPort} onChange={event => setToPort(event.target.value)} />
          </label>
          <button type="button" disabled={busy || state?.status !== "READY"} onClick={connectPorts}>Apply Connect</button>
        </section>
      </div>

      <section className="studio-panel">
        <h2>Compile</h2>
        <label className="studio-checkbox">
          <input type="checkbox" checked={sign} onChange={event => setSign(event.target.checked)} />
          Request signed compile
        </label>
        <button type="button" disabled={busy || state?.status !== "READY"} onClick={compile}>Compile Draft</button>
      </section>

      <section className="studio-panel">
        <h2>Draft State</h2>
        {!state && <p>No draft session created.</p>}
        {state?.status === "FAILED" && <p className="studio-error">{state.message}</p>}
        {state?.status === "READY" && (
          <div className="summary-list">
            <span>session: {state.session.sessionId}</span>
            <span>revision: {state.session.sceneRevision}</span>
            <span>candidate: {state.session.currentCandidateId ?? "none"}</span>
            <span>last intent: {state.lastResponse?.status ?? "none"}</span>
            <span>last compile: {state.lastCompile?.status ?? "none"}</span>
          </div>
        )}
      </section>

      <section className="studio-panel">
        <h2>Signing Handoff</h2>
        {handoff ? <SigningHandoffSummary handoff={handoff} /> : <p>Compile the draft to prepare handoff artifacts.</p>}
      </section>
    </div>
  );
}

function SigningHandoffSummary({ handoff }: { readonly handoff: ReturnType<typeof buildSigningHandoff> }) {
  switch (handoff.status) {
    case "SIGNED":
      return <p>Signed contract ready: <a href={handoff.signedContractUrl}>{handoff.sha256}</a></p>;
    case "UNSIGNED_READY":
      return (
        <div className="summary-list">
          <span>{handoff.message}</span>
          <a href={handoff.contractUrl}>contract</a>
          <a href={handoff.profileUrl}>substrate profile</a>
        </div>
      );
    case "REQUEST_SIGNED_COMPILE":
      return <p>{handoff.message}</p>;
    case "UNAVAILABLE":
      return <p>{handoff.reason}</p>;
  }
}
