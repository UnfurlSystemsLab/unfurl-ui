import type { DeploymentPolicyDraft } from "@unfurl/fabric-validation-client";

export type IsolationMatchesPanelProps = {
  readonly policy: DeploymentPolicyDraft;
};

export function IsolationMatchesPanel({ policy }: IsolationMatchesPanelProps) {
  return (
    <section className="studio-panel">
      <h2>Isolation Policy</h2>
      {policy.requireIsolationForCapabilityPatterns.length === 0 ? (
        <p>No capability patterns require isolation.</p>
      ) : (
        <ul>
          {policy.requireIsolationForCapabilityPatterns.map(pattern => <li key={pattern}>{pattern}</li>)}
        </ul>
      )}
    </section>
  );
}
