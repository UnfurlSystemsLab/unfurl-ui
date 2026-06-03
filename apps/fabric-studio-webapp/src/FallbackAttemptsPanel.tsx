import type { DeploymentPolicyDraft, ResolveDeploymentResponse } from "@unfurl/fabric-validation-client";

export type FallbackAttemptsPanelProps = {
  readonly policy: DeploymentPolicyDraft;
  readonly response: ResolveDeploymentResponse | undefined;
};

export function FallbackAttemptsPanel({ policy, response }: FallbackAttemptsPanelProps) {
  const preferred = policy.preferredShapes.join(" -> ") || "none";
  const warnings = response?.status === "RESOLVED" ? response.warnings : [];
  return (
    <section className="studio-panel">
      <h2>Fallback Attempts</h2>
      <p>Preference order: {preferred}</p>
      {warnings.length === 0 ? (
        <p>No fallback warnings.</p>
      ) : (
        <ul>
          {warnings.map(warning => <li key={warning}>{warning}</li>)}
        </ul>
      )}
    </section>
  );
}
