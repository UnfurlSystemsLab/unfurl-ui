import { useState } from "react";
import type { StudioEnvironmentProblem } from "@unfurl/fabric-validation-client";
import {
  emptyEnvironmentForm,
  formFromEnvironment,
  problemsAt,
  requestFromForm,
  type EnvironmentForm,
  type EnvironmentOutcome,
  type KeyValue
} from "./environments.js";
import { emitPlanStatus } from "./overlays.js";
import { currentEmitPlan, staleMessage, type WorkbenchData } from "./workbenchData.js";
import type { WorkbenchComposition } from "./useWorkbenchComposition.js";

/**
 * Substrate & Topology's Deployment Environment card (LLD-studio-viewpoints-and-perspectives §5.5): the tenant's
 * environments as Fabric lists them, the one chosen for the emit plan (none until the operator chooses), and the action
 * that opens the editor.
 */
export function EnvironmentSection({ composition }: { readonly composition: WorkbenchComposition }) {
  const [editing, setEditing] = useState(false);
  const data = composition.data;
  const environments = data.environments ?? [];
  return (
    <>
      <section className="inspector-card" aria-label="Deployment environment">
        <h2>Deployment Environment</h2>
        {data.environmentsError
          ? <p className="studio-error">The environments could not be listed: {data.environmentsError}</p>
          : environments.length === 0
            ? <p className="live-data-notice">This tenant has no deployment environment yet. Add one to preview an emit.</p>
            : (
              <label>Environment
                <select value={data.environment ?? ""} onChange={event => composition.commands.chooseEnvironment(event.target.value || undefined)}>
                  <option value="">None chosen</option>
                  {environments.map(environment => (
                    <option key={environment.name} value={environment.name}>
                      {environment.name} ({environment.target.kind ?? "no kind"}, revision {environment.revision})
                    </option>
                  ))}
                </select>
              </label>
            )}
        <button type="button" className="secondary" aria-expanded={editing} onClick={() => setEditing(open => !open)}>
          {editing ? "Close environments" : "Manage environments"}
        </button>
      </section>
      {editing && <EnvironmentEditor composition={composition} />}
    </>
  );
}

/**
 * Substrate & Topology's Emit Plan card (§5.5): the current emit plan for the chosen environment, Fabric's absent reason,
 * or why there is none. Hashes are this preview run's and are labelled so; a secret request shows its name, bound
 * component and store hint, never a value.
 */
export function EmitPlanSection({ data }: { readonly data: WorkbenchData }) {
  const status = emitPlanStatus(data);
  const current = currentEmitPlan(data);
  return (
    <section className="inspector-card" aria-label="Emit plan">
      <h2>Emit Plan</h2>
      {"plan" in status ? <EmitPlanFacts plan={status.plan} /> : (
        <>
          <p className={current && !current.available ? "absent-reason" : "live-data-notice"}>{status.why}</p>
          {data.emitPlan && !current && data.emitPlan.response.available
            && <p className="absent-reason">{staleMessage("the emit plan", data.emitPlan, data, "It is being asked for again.")}</p>}
        </>
      )}
    </section>
  );
}

function EmitPlanFacts({ plan }: { readonly plan: NonNullable<ReturnType<typeof currentEmitPlan>> }) {
  return (
    <>
      <dl>
        <dt>Environment</dt><dd>{`${plan.environment} (revision ${plan.environmentRevision ?? "unknown"})`}</dd>
        <dt>Target kind</dt><dd title="from emit-plan targetKind">{plan.targetKind ?? "not named"}</dd>
        <dt>Contract</dt><dd title="from emit-plan provenance">
          {plan.provenance ? `revision ${plan.provenance.sourceRevision}, ${plan.provenance.contractHash.slice(0, 12)}` : "no compile record"}
        </dd>
        <dt>Runtime bindings</dt><dd title="from emit-plan runtimeBindings">{String(plan.runtimeBindings.length)}</dd>
        <dt>Emit manifest</dt><dd title="this preview run only">{`preview hash ${plan.emitManifestSha256?.slice(0, 12) ?? "none"}`}</dd>
      </dl>
      <h3>Artifacts</h3>
      <ul aria-label="Emitted artifacts">
        {plan.artifacts.map(artifact => (
          <li key={artifact.path}><code>{artifact.path}</code> <small>{`${artifact.kind}, preview hash ${artifact.sha256.slice(0, 12)}`}</small></li>
        ))}
      </ul>
      <h3>Secret requests</h3>
      {plan.requiredSecrets.length === 0
        ? <p className="live-data-notice">This environment needs no secret.</p>
        : (
          <ul aria-label="Secret requests">
            {plan.requiredSecrets.map(secret => (
              <li key={secret.name}><code>{secret.name}</code> <small>{`bound to ${secret.boundComponentId}, store hint ${secret.targetStoreHint}`}</small></li>
            ))}
          </ul>
        )}
    </>
  );
}

/**
 * The environment editor (§5.5): lists the tenant's environments, and creates, edits and deletes them through Fabric.
 * Studio checks nothing itself: Fabric's problems are shown next to the field their path names, and a revision conflict
 * is shown as a conflict with a reload action, never retried.
 */
export function EnvironmentEditor({ composition }: { readonly composition: WorkbenchComposition }) {
  const environments = composition.data.environments ?? [];
  const [editing, setEditing] = useState<{ readonly form: EnvironmentForm; readonly revision: number } | undefined>();
  const [outcome, setOutcome] = useState<EnvironmentOutcome | undefined>();
  const [saving, setSaving] = useState(false);
  const problems: readonly StudioEnvironmentProblem[] = outcome?.status === "INVALID" ? outcome.problems : [];

  async function run(action: () => Promise<EnvironmentOutcome>) {
    setSaving(true);
    try {
      const result = await action();
      setOutcome(result);
      if (result.status === "SAVED") setEditing(undefined);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="inspector-card" aria-label="Environment editor">
      <h2>Deployment Environments</h2>
      <ul aria-label="Environments">
        {environments.map(environment => (
          <li key={environment.name}>
            <strong>{environment.name}</strong> <small>{`${environment.target.kind ?? "no kind"}, revision ${environment.revision}`}</small>
            <button type="button" className="secondary" onClick={() => { setOutcome(undefined); setEditing({ form: formFromEnvironment(environment), revision: environment.revision }); }}>Edit</button>
            <button type="button" className="secondary" disabled={saving}
              onClick={() => void run(() => composition.commands.deleteEnvironment(environment.name, environment.revision))}>Delete</button>
          </li>
        ))}
      </ul>
      <button type="button" className="secondary" onClick={() => { setOutcome(undefined); setEditing({ form: emptyEnvironmentForm(), revision: 0 }); }}>New environment</button>
      {outcome && <OutcomeNotice outcome={outcome} onReload={() => { composition.commands.reloadEnvironments(); setEditing(undefined); setOutcome(undefined); }} />}
      {editing && (
        <EnvironmentFormFields form={editing.form} creating={editing.revision === 0} problems={problems}
          onChange={form => setEditing({ ...editing, form })} saving={saving}
          onSave={() => void run(() => composition.commands.saveEnvironment(requestFromForm(editing.form, editing.revision)))}
          onCancel={() => { setEditing(undefined); setOutcome(undefined); }} />
      )}
    </section>
  );
}

/** What the last save or delete came to: saved, a conflict with a reload action, Fabric's problems, or a failure. */
function OutcomeNotice({ outcome, onReload }: { readonly outcome: EnvironmentOutcome; readonly onReload: () => void }) {
  switch (outcome.status) {
    case "SAVED":
      return <p className="live-data-notice">{outcome.environment ? `Saved ${outcome.environment.name} at revision ${outcome.environment.revision}.` : "Deleted."}</p>;
    case "CONFLICT":
      return (
        <div className="absent-reason" role="alert">
          <p>{`Someone saved this environment since you opened it: it is at revision ${outcome.currentRevision}. ${outcome.message}`}</p>
          <button type="button" className="secondary" onClick={onReload}>Reload environments</button>
        </div>
      );
    case "INVALID":
      return <p className="studio-error" role="alert">{`Fabric refused the save: ${outcome.problems.length} problem${outcome.problems.length === 1 ? "" : "s"}, shown by each field.`}</p>;
    case "FAILED":
      return <p className="studio-error" role="alert">{outcome.message}</p>;
  }
}

/**
 * The environment's structured form. Every value is a reference or a plain setting, never a secret value; each field
 * shows the problems Fabric named for its path, and a problem no field names is listed under the form. Exported so the
 * placement of Fabric's problems can be rendered on its own.
 */
export function EnvironmentFormFields({ form, creating, problems, onChange, onSave, onCancel, saving }: {
  readonly form: EnvironmentForm; readonly creating: boolean; readonly problems: readonly StudioEnvironmentProblem[];
  readonly onChange: (form: EnvironmentForm) => void; readonly onSave: () => void; readonly onCancel: () => void; readonly saving: boolean;
}) {
  const set = <K extends keyof EnvironmentForm>(key: K) => (value: EnvironmentForm[K]) => onChange({ ...form, [key]: value });
  const unplaced = problems.filter(problem => !PLACED_PATHS.some(path => problem.path === path || problem.path.startsWith(`${path}.`)));
  return (
    <form aria-label="Environment" onSubmit={event => { event.preventDefault(); onSave(); }}>
      <fieldset>
        <legend>Target</legend>
        <Field label="Name" value={form.name} onChange={set("name")} disabled={!creating} problems={problemsAt(problems, "name")} />
        <Field label="Kind" value={form.kind} onChange={set("kind")} hint="for example local-compose or k8s" problems={problemsAt(problems, "target.kind")} />
        <Field label="Environment" value={form.environment} onChange={set("environment")} problems={[]} />
        <Field label="Region" value={form.region} onChange={set("region")} problems={[]} />
        <Field label="Endpoint" value={form.endpoint} onChange={set("endpoint")} problems={[]} />
        <Rows label="Options" rows={form.options} onChange={set("options")} problems={problemsAt(problems, "target.options")} />
        <Lines label="Credential references" value={form.credentialRefs} onChange={set("credentialRefs")} hint="names or labels, one per line; never a value"
          problems={problems.filter(problem => problem.path === "target")} />
      </fieldset>
      <fieldset>
        <legend>Runtime bindings</legend>
        <Rows label="Service base URLs" rows={form.serviceBaseUrls} keyLabel="Provider claim URI" valueLabel="URL" onChange={set("serviceBaseUrls")}
          problems={problemsAt(problems, "bindings.serviceBaseUrls")} />
        <Field label="Runtime timeout (ms)" type="number" value={form.timeoutMs} onChange={set("timeoutMs")} problems={problemsAt(problems, "bindings.timeoutMs")} />
        <Field label="Telemetry namespace" value={form.telemetryNamespace} onChange={set("telemetryNamespace")} problems={[]} />
      </fieldset>
      <fieldset>
        <legend>Identity</legend>
        <label className="studio-checkbox">
          <input type="checkbox" checked={form.identityOn} onChange={event => onChange({ ...form, identityOn: event.target.checked })} />
          Identity settings (required exactly when identity-context is in the contract)
        </label>
        {form.identityOn && (
          <>
            <Field label="Issuer" value={form.issuer} onChange={set("issuer")} problems={problemsAt(problems, "bindings.identity.issuer")} />
            <Rows label="Audiences" rows={form.audiences} keyLabel="Service claim URI" valueLabel="Audience" onChange={set("audiences")} problems={problemsAt(problems, "bindings.identity.audiences")} />
            <Field label="Tenant claim" value={form.tenantClaim} onChange={set("tenantClaim")} problems={[]} />
            <Field label="Roles claim" value={form.rolesClaim} onChange={set("rolesClaim")} problems={[]} />
            <Field label="Permissions claim" value={form.permissionsClaim} onChange={set("permissionsClaim")} problems={[]} />
            <Field label="Token endpoint reference" value={form.tokenEndpointRef} onChange={set("tokenEndpointRef")} hint="config:// or secret://" problems={problemsAt(problems, "bindings.identity.tokenEndpointRef")} />
            <Field label="Verification keys reference" value={form.verificationKeysRef} onChange={set("verificationKeysRef")} hint="config:// or secret://" problems={problemsAt(problems, "bindings.identity.verificationKeysRef")} />
            <Field label="Client credentials reference" value={form.clientCredentialsRef} onChange={set("clientCredentialsRef")} hint="secret://" problems={problemsAt(problems, "bindings.identity.clientCredentialsRef")} />
            <Rows label="Service credentials" rows={form.serviceCredentials} keyLabel="Service claim URI" valueLabel="secret:// reference" onChange={set("serviceCredentials")}
              problems={problemsAt(problems, "bindings.identity.serviceCredentials")} />
          </>
        )}
      </fieldset>
      <fieldset>
        <legend>Hosted components and documentation</legend>
        <Lines label="Hosted component configuration" value={form.componentConfig} onChange={set("componentConfig")} hint="<claimUri>#<key>=<value>, one per line" problems={problemsAt(problems, "bindings.componentConfig")} />
        <Field label="Default documentation visibility" value={form.visibilityDefault} onChange={set("visibilityDefault")} hint="public, internal or private" problems={problemsAt(problems, "bindings.documentation")} />
        <Lines label="Documentation visibility file" value={form.visibility} onChange={set("visibility")} hint="the file's YAML text" problems={[]} />
        <Field label="Observation interval (ms)" type="number" value={form.observationIntervalMs} onChange={set("observationIntervalMs")} problems={[]} />
        <Field label="Observation maximum backoff (ms)" type="number" value={form.observationMaxBackoffMs} onChange={set("observationMaxBackoffMs")} problems={[]} />
        <Lines label="Disabled bindings" value={form.disabledBindings} onChange={set("disabledBindings")} hint="<provider-claim-uri>#<capability>, one per line" problems={problemsAt(problems, "bindings.disabledBindings")} />
      </fieldset>
      {unplaced.length > 0 && <ProblemList problems={unplaced} />}
      <div className="button-row">
        <button type="submit" disabled={saving}>{creating ? "Create environment" : "Save environment"}</button>
        <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

/** The field paths the form places next to a field; any other problem is listed under the form. */
const PLACED_PATHS = ["name", "target.kind", "target", "bindings.serviceBaseUrls", "bindings.timeoutMs", "bindings.identity",
  "bindings.componentConfig", "bindings.documentation", "bindings.disabledBindings"];

function Field({ label, value, onChange, problems, hint, type, disabled }: {
  readonly label: string; readonly value: string; readonly onChange: (value: string) => void;
  readonly problems: readonly StudioEnvironmentProblem[]; readonly hint?: string; readonly type?: "number"; readonly disabled?: boolean;
}) {
  return (
    <label>{label}
      <input type={type ?? "text"} value={value} disabled={disabled} placeholder={hint} aria-invalid={problems.length > 0}
        onChange={event => onChange(event.target.value)} />
      <ProblemList problems={problems} />
    </label>
  );
}

function Lines({ label, value, onChange, problems, hint }: {
  readonly label: string; readonly value: string; readonly onChange: (value: string) => void;
  readonly problems: readonly StudioEnvironmentProblem[]; readonly hint?: string;
}) {
  return (
    <label>{label}
      <textarea value={value} placeholder={hint} aria-invalid={problems.length > 0} onChange={event => onChange(event.target.value)} />
      <ProblemList problems={problems} />
    </label>
  );
}

function Rows({ label, rows, onChange, problems, keyLabel, valueLabel }: {
  readonly label: string; readonly rows: readonly KeyValue[]; readonly onChange: (rows: readonly KeyValue[]) => void;
  readonly problems: readonly StudioEnvironmentProblem[]; readonly keyLabel?: string; readonly valueLabel?: string;
}) {
  const replace = (index: number, row: KeyValue) => onChange(rows.map((current, at) => at === index ? row : current));
  return (
    <div role="group" aria-label={label}>
      <span>{label}</span>
      {rows.map((row, index) => (
        <div className="button-row" key={index}>
          <input aria-label={`${label} ${keyLabel ?? "key"} ${index + 1}`} value={row.key} placeholder={keyLabel ?? "key"} onChange={event => replace(index, { ...row, key: event.target.value })} />
          <input aria-label={`${label} ${valueLabel ?? "value"} ${index + 1}`} value={row.value} placeholder={valueLabel ?? "value"} onChange={event => replace(index, { ...row, value: event.target.value })} />
          <button type="button" className="secondary" onClick={() => onChange(rows.filter((_, at) => at !== index))}>Remove</button>
        </div>
      ))}
      <button type="button" className="secondary" onClick={() => onChange([...rows, { key: "", value: "" }])}>Add</button>
      <ProblemList problems={problems} />
    </div>
  );
}

function ProblemList({ problems }: { readonly problems: readonly StudioEnvironmentProblem[] }) {
  if (problems.length === 0) return null;
  return <ul className="studio-error">{problems.map(problem => <li key={`${problem.path}:${problem.message}`}>{`${problem.path}: ${problem.message}`}</li>)}</ul>;
}
