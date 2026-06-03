import type { CompileDraftCandidateResponse, StudioExportArtifact } from "@unfurl/fabric-validation-client";
import type { DraftWorkspaceState } from "./draftWorkspace.js";

export type DraftExportItem = {
  readonly kind: "COMPOSITION_CONTRACT" | "SUBSTRATE_PROFILE" | "SIGNED_CONTRACT";
  readonly label: string;
  readonly artifact: StudioExportArtifact;
};

export type DraftExportBundle =
  | {
      readonly status: "READY";
      readonly candidateId: string;
      readonly items: readonly DraftExportItem[];
      readonly warnings: readonly string[];
    }
  | {
      readonly status: "UNAVAILABLE";
      readonly reason: string;
    };

export function buildDraftExportBundle(state: DraftWorkspaceState): DraftExportBundle {
  if (state.status !== "READY") {
    return { status: "UNAVAILABLE", reason: "draft workspace is not ready" };
  }
  return exportBundleFromCompile(state.lastCompile);
}

export function exportBundleFromCompile(response: CompileDraftCandidateResponse | undefined): DraftExportBundle {
  if (!response) {
    return { status: "UNAVAILABLE", reason: "draft has not been compiled" };
  }
  if (response.status === "STALE_REVISION") {
    return { status: "UNAVAILABLE", reason: "draft revision is stale; refresh before export" };
  }
  if (response.status === "INVALID") {
    return { status: "UNAVAILABLE", reason: `${response.reason}: ${response.details}` };
  }

  const items: DraftExportItem[] = [
    {
      kind: "COMPOSITION_CONTRACT",
      label: "CompositionContract YAML",
      artifact: response.contractArtifact
    },
    {
      kind: "SUBSTRATE_PROFILE",
      label: "SubstrateProfile YAML",
      artifact: response.substrateProfileArtifact
    }
  ];
  if (response.signedContractArtifact) {
    items.push({
      kind: "SIGNED_CONTRACT",
      label: "Signed Fabric contract YAML",
      artifact: response.signedContractArtifact
    });
  }

  return {
    status: "READY",
    candidateId: response.candidateId,
    items,
    warnings: response.warnings
  };
}

export function renderDraftExportText(bundle: DraftExportBundle): string {
  if (bundle.status === "UNAVAILABLE") {
    return `export unavailable: ${bundle.reason}`;
  }
  const lines = [`export candidate: ${bundle.candidateId}`];
  for (const item of bundle.items) {
    lines.push(`${item.kind}: ${item.artifact.url} (${item.artifact.sha256})`);
  }
  for (const warning of bundle.warnings) {
    lines.push(`WARNING: ${warning}`);
  }
  return lines.join("\n");
}
