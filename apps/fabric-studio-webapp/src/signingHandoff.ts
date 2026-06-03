import type { CompileDraftCandidateResponse } from "@unfurl/fabric-validation-client";
import type { DraftWorkspaceState } from "./draftWorkspace.js";

export type SigningHandoff =
  | {
      readonly status: "SIGNED";
      readonly signedContractUrl: string;
      readonly sha256: string;
    }
  | {
      readonly status: "UNSIGNED_READY";
      readonly contractUrl: string;
      readonly profileUrl: string;
      readonly message: string;
    }
  | {
      readonly status: "REQUEST_SIGNED_COMPILE";
      readonly message: string;
    }
  | {
      readonly status: "UNAVAILABLE";
      readonly reason: string;
    };

export function buildSigningHandoff(
  state: DraftWorkspaceState,
  options?: { readonly signingRequested?: boolean }
): SigningHandoff {
  if (state.status !== "READY") {
    return { status: "UNAVAILABLE", reason: "draft workspace is not ready" };
  }
  return signingHandoffFromCompile(state.lastCompile, options);
}

export function signingHandoffFromCompile(
  response: CompileDraftCandidateResponse | undefined,
  options?: { readonly signingRequested?: boolean }
): SigningHandoff {
  if (!response) {
    return options?.signingRequested
      ? { status: "REQUEST_SIGNED_COMPILE", message: "Run compile with signing enabled before export." }
      : { status: "UNAVAILABLE", reason: "draft has not been compiled" };
  }
  if (response.status === "STALE_REVISION") {
    return { status: "UNAVAILABLE", reason: "draft revision is stale; refresh before signing" };
  }
  if (response.status === "INVALID") {
    return { status: "UNAVAILABLE", reason: `${response.reason}: ${response.details}` };
  }
  if (response.signedContractArtifact) {
    return {
      status: "SIGNED",
      signedContractUrl: response.signedContractArtifact.url,
      sha256: response.signedContractArtifact.sha256
    };
  }
  if (options?.signingRequested) {
    return { status: "REQUEST_SIGNED_COMPILE", message: "Fabric did not return a signed contract artifact." };
  }
  return {
    status: "UNSIGNED_READY",
    contractUrl: response.contractArtifact.url,
    profileUrl: response.substrateProfileArtifact.url,
    message: "Unsigned artifacts are ready; hand off to Fabric signing when an operator key is available."
  };
}
