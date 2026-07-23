import { useEffect, useRef, useState } from "react";
import type {
  AuthoringActionContext,
  AuthoringQuestion,
  AuthoringQuestionAnswers,
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

export type AuthoringPromptSeed = {
  readonly id: number;
  readonly text: string;
  readonly actionContext?: AuthoringActionContext;
  readonly autoSend?: boolean;
};

/**
 * Props contract for the AI authoring panel. The component intentionally receives only the Fabric
 * client methods needed to converse, validate intents, compile, and resolve deployment so browser UI
 * never owns model/provider credentials or bypasses Fabric validation.
 */
export type AuthoringConversationPanelProps = {
  readonly client: Pick<
    StudioFabricClient,
    "converseAuthoring" | "applyIntent" | "getDraftSession" | "compileCandidate" | "resolveDeployment"
  >;
  readonly tenantId: string;
  readonly assemblyId: string;
  readonly catalogFileId?: string;
  readonly displayName?: string;
  readonly promptSeed?: AuthoringPromptSeed | undefined;
  readonly state: DraftWorkspaceState | undefined;
  readonly onStateChange: (state: DraftWorkspaceState) => void;
  readonly onDeploymentPolicy?: (proposal: AuthoringProposal) => void;
  readonly onProposalApplied?: (proposal: AuthoringProposal, appliedIntentCount: number) => void;
};

/**
 * Adapter component: renders the conversational authoring surface over the existing governed draft
 * workspace pipeline. User prompts go to the server-side authoring endpoint, accepted proposals are
 * replayed as Fabric intents, and every state change flows back through the caller-owned workspace.
 */
export function AuthoringConversationPanel({
  client,
  tenantId,
  assemblyId,
  catalogFileId,
  displayName,
  promptSeed,
  state,
  onStateChange,
  onDeploymentPolicy,
  onProposalApplied
}: AuthoringConversationPanelProps) {
  const [session, setSession] = useState<AuthoringSessionState>(() => initialAuthoringSession());
  const [prompt, setPrompt] = useState("Help me create a governed Fabric assembly from the selected tenant catalog.");
  const [promptActionContext, setPromptActionContext] = useState<AuthoringActionContext | undefined>();
  const [questionAnswers, setQuestionAnswers] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<string | undefined>();
  const lastPromptSeedId = useRef<number | undefined>();
  const readySession = state?.status === "READY" ? state.session : undefined;
  const response = session.status === "READY" ? session.response : undefined;
  const proposal = response?.kind === "proposal" ? response.proposal : undefined;

  /**
   * Effect adapter: accepts action-scoped prompt seeds from the visual
   * workbench, optionally auto-submitting them through the same server-side
   * authoring endpoint as a manually typed prompt.
   */
  useEffect(() => {
    if (!promptSeed || promptSeed.id === lastPromptSeedId.current) {
      return;
    }
    lastPromptSeedId.current = promptSeed.id;
    setPrompt(promptSeed.text);
    setPromptActionContext(promptSeed.actionContext);
    if (promptSeed.autoSend) {
      void sendPromptText(promptSeed.text, promptSeed.actionContext);
    } else {
      setStatus("Review the action assist prompt, then ask the authoring agent.");
    }
  }, [promptSeed?.id]);

  /**
   * State reset: each new clarification response starts with blank local
   * answers so stale values from a prior action do not leak into follow-up
   * turns.
   */
  useEffect(() => {
    if (response?.kind === "clarify") {
      setQuestionAnswers({});
    }
  }, [response?.assistantMessage, response?.kind]);

  /**
   * Event handler: sends the current prompt to the server-side Foundry-backed authoring endpoint.
   * Empty prompts short-circuit locally; failures stay in panel status rather than mutating draft
   * state because Fabric has not validated anything yet.
   */
  async function sendPrompt() {
    await sendPromptText(prompt, promptActionContext);
  }

  /**
   * Command helper: sends one prompt with optional visual-edit action context
   * and structured clarification answers through Fabric's DCP authoring bridge.
   */
  async function sendPromptText(
    message: string,
    actionContext?: AuthoringActionContext,
    structuredAnswers?: AuthoringQuestionAnswers
  ) {
    if (!message.trim()) {
      setStatus("Add a prompt before asking the authoring agent.");
      return;
    }
    setStatus("Asking authoring agent...");
    const next = await converseAuthoring(client, session, {
      tenantId,
      assemblyId,
      ...(readySession?.sessionId === undefined ? {} : { sessionId: readySession.sessionId }),
      ...(catalogFileId === undefined || catalogFileId === "" ? {} : { catalogFileId }),
      ...(displayName === undefined || displayName === "" ? {} : { displayName }),
      ...(actionContext === undefined ? {} : { actionContext }),
      ...(structuredAnswers === undefined || Object.keys(structuredAnswers).length === 0 ? {} : { questionAnswers: structuredAnswers }),
      userMessage: message
    });
    setSession(next);
    setStatus(next.status === "FAILED" ? next.message : undefined);
  }

  /**
   * Event handler: applies an accepted proposal through Fabric validation and then finalizes the
   * deployment/compile path. Partial validation failure is surfaced as status instead of fabricating
   * a complete contract from UI state.
   */
  async function acceptProposal() {
    if (!proposal || !state) {
      return;
    }
    setStatus("Applying proposal through Fabric validation...");
    const applied = await applyAuthoringProposal(client, state, proposal);
    onStateChange(applied.state);
    onProposalApplied?.(proposal, applied.appliedIntentCount);
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

  /**
   * Event handler: sends the operator's typed/select answers back as a normal
   * user turn, preserving any actionContext attached to the current assist flow.
   */
  async function sendQuestionAnswers() {
    if (response?.kind !== "clarify") {
      return;
    }
    await sendPromptText(
      "Here are my structured answers.",
      promptActionContext,
      structuredQuestionAnswers(response.questions, questionAnswers)
    );
  }

  return (
    <section className="authoring-panel" aria-label="AI contract authoring">
      <div className="panel-title">
        <span>AI Contract Authoring</span>
        <small>server-side foundry agent</small>
      </div>
      <label className="authoring-prompt">
        <span>Prompt</span>
        <textarea
          value={prompt}
          onChange={event => setPrompt(event.target.value)}
          rows={4}
          aria-label="Authoring prompt"
          placeholder="Describe the governed component contract you need."
        />
      </label>
      <div className="authoring-actions">
        <button type="button" disabled={!client.converseAuthoring || !prompt.trim()} onClick={sendPrompt}>Ask Agent</button>
        <button type="button" className="secondary" disabled={!proposal || state?.status !== "READY"} onClick={acceptProposal}>Accept Proposal</button>
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
              {question.type === "FREE_TEXT" || question.type === "TEXT" ? (
                <input
                  aria-label={question.label}
                  value={questionAnswers[question.id] ?? ""}
                  onChange={event => setQuestionAnswers(current => ({
                    ...current,
                    [question.id]: event.target.value
                  }))}
                />
              ) : (
                <select
                  aria-label={question.label}
                  multiple={question.type === "MULTI_SELECT"}
                  value={question.type === "MULTI_SELECT"
                    ? (questionAnswers[question.id] ?? "").split("\n").filter(Boolean)
                    : questionAnswers[question.id] ?? ""}
                  onChange={event => {
                    const value = question.type === "MULTI_SELECT"
                      ? Array.from(event.currentTarget.selectedOptions).map(option => option.value).join("\n")
                      : event.currentTarget.value;
                    setQuestionAnswers(current => ({
                      ...current,
                      [question.id]: value
                    }));
                  }}
                >
                  {(question.options ?? []).map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              )}
            </label>
          ))}
          <button type="button" className="secondary" onClick={() => void sendQuestionAnswers()}>
            Send Answers
          </button>
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

/**
 * Answer projector: converts the controlled form state into the structured map
 * Fabric and Foundry consume, preserving select option values rather than UI
 * labels or prose bullet text.
 */
function structuredQuestionAnswers(
  questions: readonly AuthoringQuestion[],
  answers: Record<string, string>
): AuthoringQuestionAnswers {
  const structured: AuthoringQuestionAnswers = {};
  for (const question of questions) {
    const raw = answers[question.id] ?? "";
    if (question.type === "MULTI_SELECT") {
      const selected = raw.split("\n").filter(Boolean);
      structured[question.id] = selected;
      continue;
    }
    if (question.type === "SINGLE_SELECT") {
      structured[question.id] = raw || question.options?.[0]?.value || "";
      continue;
    }
    structured[question.id] = raw.trim();
  }
  return structured;
}
