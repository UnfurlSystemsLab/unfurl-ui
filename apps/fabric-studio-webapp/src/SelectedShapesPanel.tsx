import type { ResolveDeploymentResponse } from "@unfurl/fabric-validation-client";

export type SelectedShapesPanelProps = {
  readonly response: ResolveDeploymentResponse | undefined;
};

export function SelectedShapesPanel({ response }: SelectedShapesPanelProps) {
  const selections = response?.status === "RESOLVED" ? response.selections : [];
  return (
    <section className="studio-panel">
      <h2>Selected Shapes</h2>
      {selections.length === 0 ? (
        <p>No deployment plan resolved yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Component</th>
              <th>Capability</th>
              <th>Shape</th>
              <th>Required ports</th>
            </tr>
          </thead>
          <tbody>
            {selections.map(selection => (
              <tr key={`${selection.componentId}:${selection.capability}`}>
                <td>{selection.componentId}</td>
                <td>{selection.capability}</td>
                <td>{selection.deploymentShape}</td>
                <td>{selection.requiredPorts.join(", ") || "none"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
