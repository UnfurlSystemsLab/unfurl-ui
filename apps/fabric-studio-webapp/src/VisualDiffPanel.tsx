import { useMemo } from "react";
import { exportBundleFromCompile } from "./draftExport.js";
import { appendValidatedIntent, createIntentHistory } from "./intentHistory.js";
import { buildVisualDiff } from "./visualDiff.js";

export function VisualDiffPanel() {
  const diff = useMemo(() => buildVisualDiff(
    exportBundleFromCompile(compiled("old")),
    exportBundleFromCompile(compiled("new")),
    appendValidatedIntent(createIntentHistory(7), {
      tenantId: "tenant-local",
      assemblyId: "assembly-demo",
      sessionId: "studio-session-123",
      baseRevision: 7,
      type: "REPLACE_COMPONENT",
      oldComponentId: "storage-s3",
      newCatalogEntryId: "com.unfurl:storage-blob:1.1.0"
    }, {
      status: "VALID",
      newRevision: 8,
      updatedCandidateId: "cand-abc123",
      requiredSubstratePorts: ["secrets.provider"],
      warnings: []
    })
  ), []);

  return (
    <div className="studio-page">
      <header className="studio-header">
        <h1>Visual Diff</h1>
        <p>Compare exported Studio artifacts and the validated intent path that produced the change.</p>
      </header>

      <section className="studio-panel">
        <h2>Summary</h2>
        <div className="summary-row">
          <span>revision: {diff.revisionFrom} {"->"} {diff.revisionTo}</span>
          <span>intents: {diff.intentTypes.join(", ") || "none"}</span>
          <span>changed artifacts: {diff.changedArtifacts.length}</span>
        </div>
      </section>

      <section className="studio-panel">
        <h2>Artifact Changes</h2>
        <table>
          <thead><tr><th>Kind</th><th>Before SHA-256</th><th>After SHA-256</th></tr></thead>
          <tbody>
            {diff.changedArtifacts.map(change => (
              <tr key={change.kind}>
                <td>{change.kind}</td>
                <td>{change.beforeSha256 ?? "missing"}</td>
                <td>{change.afterSha256 ?? "missing"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function compiled(suffix: string) {
  return {
    status: "COMPILED" as const,
    candidateId: `cand-${suffix}`,
    contractArtifact: artifact(`contract-${suffix}`),
    substrateProfileArtifact: artifact(`profile-${suffix}`),
    warnings: []
  };
}

function artifact(name: string) {
  return {
    artifactId: name,
    mediaType: "application/yaml",
    sha256: `sha256:${name}`,
    url: `/studio/assets/${name}`
  };
}
