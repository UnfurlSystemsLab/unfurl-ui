import type { ResolveDeploymentResponse } from "@unfurl/fabric-validation-client";

export type RequiredPortsPanelProps = {
  readonly response: ResolveDeploymentResponse | undefined;
};

export function RequiredPortsPanel({ response }: RequiredPortsPanelProps) {
  const ports = response?.status === "RESOLVED"
    ? [...new Set(response.selections.flatMap(selection => selection.requiredPorts))].sort()
    : [];
  return (
    <section className="studio-panel">
      <h2>Required Substrate Ports</h2>
      {ports.length === 0 ? (
        <p>No deployment-specific substrate ports.</p>
      ) : (
        <ul>
          {ports.map(port => <li key={port}>{port}</li>)}
        </ul>
      )}
    </section>
  );
}
