import type { StudioExportArtifact } from "@unfurl/fabric-validation-client";

export type DiagnosticArtifactsPanelProps = {
  readonly artifacts?: readonly StudioExportArtifact[] | undefined;
  readonly localArtifact?: {
    readonly label: string;
    readonly fileName: string;
    readonly value: unknown;
  } | undefined;
};

/**
 * Presenter: renders hash-pinned server diagnostic artifacts and optional client-side
 * JSON snapshots through the same compact download surface.
 */
export function DiagnosticArtifactsPanel({ artifacts = [], localArtifact }: DiagnosticArtifactsPanelProps) {
  const localHref = localArtifact ? localJsonHref(localArtifact.value) : undefined;
  if (artifacts.length === 0 && !localArtifact) {
    return null;
  }
  return (
    <div className="summary-list">
      {artifacts.map(artifact => (
        <a href={artifact.url} download key={artifact.artifactId}>
          {artifactLabel(artifact)}
        </a>
      ))}
      {localArtifact && localHref && (
        <a href={localHref} download={localArtifact.fileName}>
          {localArtifact.label}
        </a>
      )}
    </div>
  );
}

/**
 * Label helper: keeps artifact links readable while preserving the hash in browser
 * status/tooltips through the underlying URL.
 */
function artifactLabel(artifact: StudioExportArtifact): string {
  if (artifact.mediaType === "application/zip" && artifact.url.includes("claims.zip")) {
    return "Download Claims Bundle";
  }
  return artifact.artifactId.replace(/-[0-9a-f-]{36}$/i, "").replaceAll("-", " ");
}

/**
 * URL helper: creates a data URL for local diagnostic snapshots when a backend route
 * is not yet tenant-scoped.
 */
function localJsonHref(value: unknown): string {
  return `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(value, null, 2))}`;
}
