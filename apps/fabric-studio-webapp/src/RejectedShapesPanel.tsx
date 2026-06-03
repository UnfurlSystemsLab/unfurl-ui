import type { ResolveDeploymentResponse } from "@unfurl/fabric-validation-client";

export type RejectedShapesPanelProps = {
  readonly response: ResolveDeploymentResponse | undefined;
};

export function RejectedShapesPanel({ response }: RejectedShapesPanelProps) {
  const rejected = response?.status === "INVALID" ? response.rejectedShapes : [];
  return (
    <section className="studio-panel">
      <h2>Rejected Shapes</h2>
      {response?.status === "INVALID" && (
        <p className="studio-error">{response.reason}: {response.details}</p>
      )}
      {rejected.length === 0 ? (
        <p>No rejected shapes reported.</p>
      ) : (
        <ul>
          {rejected.map(item => <li key={item}>{item}</li>)}
        </ul>
      )}
    </section>
  );
}
