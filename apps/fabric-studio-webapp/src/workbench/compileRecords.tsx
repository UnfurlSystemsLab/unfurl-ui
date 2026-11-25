import { useState } from "react";
import type { StudioCompileRecord } from "@unfurl/fabric-validation-client";
import { DiagnosticArtifactsPanel } from "../DiagnosticArtifactsPanel.js";
import type { WorkbenchComposition } from "./useWorkbenchComposition.js";
import { isCurrent, staleMessage, type WorkbenchData } from "./workbenchData.js";

/**
 * The revisions a contract diff can compare from, oldest first: every revision whose latest record is not the
 * session's current record. Fabric compares from a revision's latest record, so a revision compiled only by the
 * current record is not a base (it would compare the current compile with itself).
 */
export function diffBaseRevisions(records: readonly StudioCompileRecord[]): readonly number[] {
  const latest = records.at(-1);
  return [...new Set(records.map(record => record.revision))]
    .filter(revision => records.filter(record => record.revision === revision).at(-1) !== latest);
}

/** One fact with the Fabric field it came from, shown on hover. */
function FactRow({ label, value, source }: { readonly label: string; readonly value: string; readonly source: string }) {
  return <><dt>{label}</dt><dd title={`from ${source}`}>{value}</dd></>;
}

/**
 * Contract diff and verification (LLD §5.3; LLD-fabric-studio-api, Contract diff and verification): the compile panel's
 * view of the session's compile records. Every answer is Fabric's: the records come from the session, the diff and the
 * verification from Fabric's routes, which decide freshness from the records and the policy Studio sends. An answer is
 * shown only while it is current for the session, revision and policy it was asked with (§4.3 rule 6); a historical
 * answer is labelled with its revision and hash; an unavailable one shows Fabric's code and message.
 *
 * Pattern: Presenter over the pinned Fabric responses in `WorkbenchData`; it computes no comparison itself.
 */
export function CompileRecordsSection({ composition }: { readonly composition: WorkbenchComposition }) {
  const data = composition.data;
  const records = data.session?.compileRecords ?? [];
  const bases = diffBaseRevisions(records);
  const [chosenBase, setChosenBase] = useState<number | undefined>();
  const base = chosenBase !== undefined && bases.includes(chosenBase) ? chosenBase : bases.at(-1);
  const ready = composition.state?.status === "READY";
  return (
    <section aria-label="Contract diff and verification">
      <h3>Contract diff</h3>
      {records.length === 0 && <p className="absent-reason">COMPILE_REQUIRED: no compile is recorded for this session yet.</p>}
      {records.length > 0 && bases.length === 0 && (
        <p className="absent-reason">One compile is recorded; compile again after a change to compare two.</p>
      )}
      {base !== undefined && (
        <div className="button-row">
          <label>Compare from revision
            <select value={base} onChange={event => setChosenBase(Number(event.target.value))}>
              {bases.map(revision => <option value={revision} key={revision}>{revision}</option>)}
            </select>
          </label>
          <button type="button" disabled={!ready || composition.busy} onClick={() => void composition.commands.diffContract(base)}>Compare With Current</button>
        </div>
      )}
      <ContractDiffResult data={data} />
      <h3>Verification</h3>
      <button type="button" disabled={!ready || composition.busy || records.length === 0} onClick={() => void composition.commands.verifyContract()}>Verify Current Compile</button>
      <VerificationResult data={data} />
    </section>
  );
}

/** The pinned contract diff: Fabric's comparison while current, its absent reason, or why it is out of date. */
export function ContractDiffResult({ data }: { readonly data: WorkbenchData }) {
  const pinned = data.contractDiff;
  if (!pinned) return null;
  if (!isCurrent(pinned, data)) return <p className="absent-reason">{staleMessage("the contract diff", pinned, data, "Compare again.")}</p>;
  const result = pinned.response;
  if (!result.available || !result.diff) {
    return <p className="absent-reason">{absentText(result.absentReason, "Fabric returned no comparison.")}</p>;
  }
  const diff = result.diff;
  const groups: readonly (readonly [string, readonly string[]])[] = [
    ["Added selections", diff.addedSelections],
    ["Removed selections", diff.removedSelections],
    ["Changed selections", diff.changedSelections],
    ["Added deployment entries", diff.addedDeploymentEntries],
    ["Removed deployment entries", diff.removedDeploymentEntries],
    ["Changed deployment shapes", diff.changedDeploymentShapes.map(change =>
      `${change.key}: ${change.fromShape} -> ${change.toShape} (ports ${change.fromPorts.join(", ") || "none"} -> ${change.toPorts.join(", ") || "none"})`)],
    ["Added substrate ports", diff.ports?.added ?? []],
    ["Removed substrate ports", diff.ports?.removed ?? []],
    ["Changed substrate ports", diff.ports?.changed ?? []]
  ];
  const changed = groups.filter(([, items]) => items.length > 0);
  return (
    <section aria-label="Contract diff result">
      <dl>
        <FactRow label="From" value={provenanceText(result.base)} source="contract-diff base" />
        <FactRow label="To" value={`${provenanceText(result.target)}${result.historical ? " (historical)" : " (current)"}`} source="contract-diff target" />
        <FactRow label="Contract hash changed" value={diff.canonicalHashChanged ? "yes" : "no"} source="contract-diff diff.canonicalHashChanged" />
        <FactRow label="Substrate profile changed" value={diff.substrateProfileHashChanged ? "yes" : "no"} source="contract-diff diff.substrateProfileHashChanged" />
      </dl>
      {changed.length === 0
        ? <p>No selection, deployment or substrate-port differences.</p>
        : changed.map(([title, items]) => (
          <div key={title}><strong>{title}</strong><ul>{items.map(item => <li key={item}>{item}</li>)}</ul></div>
        ))}
      <DiagnosticArtifactsPanel artifacts={result.diagnosticArtifacts} />
    </section>
  );
}

/** The pinned verification: Fabric's signature and drift checks while current, its absent reason, or why it is out of date. */
export function VerificationResult({ data }: { readonly data: WorkbenchData }) {
  const pinned = data.verification;
  if (!pinned) return null;
  if (!isCurrent(pinned, data)) return <p className="absent-reason">{staleMessage("the verification", pinned, data, "Verify again.")}</p>;
  const result = pinned.response;
  if (!result.available) {
    return <p className="absent-reason">{absentText(result.absentReason, "Fabric returned no verification.")}</p>;
  }
  const drift = result.catalogDrift;
  return (
    <section aria-label="Verification result">
      <dl>
        <FactRow label="Contract" value={`${provenanceText(result.provenance)}${result.historical ? " (historical)" : " (current)"}`} source="verify provenance" />
        <FactRow label="Signature" value={`${result.signature?.result ?? "unknown"}: ${result.signature?.detail ?? ""}`} source="verify signature" />
        <FactRow label="Catalog" value={drift?.clean ? "clean" : "drifted"} source="verify catalogDrift" />
        <FactRow label="Overall" value={result.overallOk ? "verified" : "not verified"} source="verify overallOk" />
      </dl>
      {drift && !drift.clean && (
        <ul>{[...drift.hashDrifts, ...drift.missingFromCatalog].map(entry => <li key={entry.detail}>{entry.detail}</li>)}</ul>
      )}
      <DiagnosticArtifactsPanel artifacts={result.diagnosticArtifacts} />
    </section>
  );
}

/** A compile's provenance as text: its revision and the start of its contract hash, as Fabric reported them. */
function provenanceText(provenance: { readonly sourceRevision: number; readonly contractHash: string } | undefined): string {
  return provenance ? `revision ${provenance.sourceRevision}, contract ${provenance.contractHash.slice(0, 12)}` : "not named by Fabric";
}

/** Fabric's absent reason as one line, `CODE: message`, exactly as Fabric named it. */
function absentText(reason: { readonly code: string; readonly message: string } | undefined, none: string): string {
  return reason ? `${reason.code}: ${reason.message}` : `UNAVAILABLE: ${none}`;
}
