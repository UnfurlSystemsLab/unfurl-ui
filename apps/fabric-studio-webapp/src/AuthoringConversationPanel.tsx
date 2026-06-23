import { useState } from "react";
import type {
  AuthoringProposal,
  StudioFabricClient
} from "@unfurl/fabric-validation-client";
import type { DraftWorkspaceState } from "./draftWorkspace.js";
import {
  applyAuthoringProposal,
  converseAuthoring,
  finalizeAuthoringProposal,
  initialAuthoringSession,
  type AuthoringSessionState
} from "./authoringSession.js";

export type AuthoringConversationPanelProps = {
  readonly client: Pick<
    StudioFabricClient,
    "converseAuthoring" | "applyIntent" | "getDraftSession" | "compileCandidate" | "resolveDeployment"
  >;
  readonly tenantId: string;
  readonly assemblyId: string;
  readonly state: DraftWorkspaceState | undefined;
  readonly onStateChange: (state: DraftWorkspaceState) => void;
  readonly onDeploymentPolicy?: (proposal: AuthoringProposal) => void;
};

export function AuthoringConversationPanel({
  client,
  tenantId,
  assemblyId,
  state,
  onStateChange,
  onDeploymentPolicy
}: AuthoringConversationPanelProps) {
  const [session, setSession] = useState<AuthoringSessionState>(() => initialAuthoringSession());
  const [prompt, setPrompt] = useState("Build a docs chatbot that answers from approved content and escalates to a human.");
  const [status, setStatus] = useState<string | undefined>();
  const readySession = state?.status === "READY" ? state.session : undefined;
  const response = session.status === "READY" ? session.response : undefined;
  const proposal = response?.kind === "proposal" ? response.proposal : undefined;

  async function sendPrompt() {
    setStatus("Asking authoring agent...");
    const next = await converseAuthoring(client, session, {
      tenantId,
      assemblyId,
      ...(readySession?.sessionId === undefined ? {} : { sessionId: readySession.sessionId }),
      userMessage: prompt
    });
    setSession(next);
    setStatus(next.status === "FAILED" ? next.message : undefined);
  }

  async function acceptProposal() {
    if (!proposal || !state) {
      return;
    }
    setStatus("Applying proposal through Fabric validation...");
    const applied = await applyAuthoringProposal(client, state, proposal);
    onStateChange(applied.state);
    onDeploymentPolicy?.(proposal);
    if (applied.state.status !== "READY") {
      setStatus("Proposal could not be applied.");
      return;
    }
    if (applied.appliedIntentCount !== proposal.intents.length) {
      setStatus("Fabric rejected part of the proposal.");
      return;
    }
    const finalized = await finalizeAuthoringProposal(client, applied.state, applied.deploymentPolicy);
    onStateChange(finalized.state);
    setStatus(finalized.exportText);
  }

  return (
    <section className="authoring-panel" aria-label="AI contract authoring">
      <div className="panel-title">
        <span>AI Contract Authoring</span>
        <small>server-side foundry agent</small>
      </div>
      <div className="authoring-copy">
        <p>Describe the contract you need. Proposals are replayed through the existing Fabric draft and signing path.</p>
      </div>
      <label>
        Prompt
        <textarea
          value={prompt}
          onChange={event => setPrompt(event.target.value)}
          rows={3}
          aria-label="Authoring prompt"
        />
      </label>
      <div className="authoring-actions">
        <button type="button" disabled={!client.converseAuthoring} onClick={sendPrompt}>Ask Agent</button>
        <button type="button" disabled={!proposal || state?.status !== "READY"} onClick={acceptProposal}>Accept Proposal</button>
      </div>
      {!client.converseAuthoring && (
        <p className="live-data-notice">Studio authoring endpoint unavailable.</p>
      )}
      {response?.kind === "clarify" && (
        <div className="authoring-card">
          <strong>{response.assistantMessage}</strong>
          {response.questions.map(question => (
            <label key={question.id}>
              {question.label}
              {question.type === "FREE_TEXT" ? (
                <input aria-label={question.label} />
              ) : (
                <select aria-label={question.label} multiple={question.type === "MULTI_SELECT"}>
                  {(question.options ?? []).map(option => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
              )}
            </label>
          ))}
        </div>
      )}
      {response?.kind === "gap" && (
        <div className="authoring-card">
          <strong>{response.assistantMessage}</strong>
          <ul>
            {response.unmet.map(item => <li key={item}>{item}</li>)}
          </ul>
        </div>
      )}
      {proposal && (
        <div className="authoring-card">
          <strong>{proposal.summary}</strong>
          <dl>
            <dt>Needs</dt>
            <dd><pre>{proposal.needsYaml}</pre></dd>
            <dt>Validated intents</dt>
            <dd>{proposal.intents.length}</dd>
            <dt>Preferred deployment</dt>
            <dd>{proposal.deploymentPolicy?.preferredShapes[0] ?? "user-selected"}</dd>
          </dl>
        </div>
      )}
      {status && <pre className="authoring-status">{status}</pre>}
    </section>
  );
}
