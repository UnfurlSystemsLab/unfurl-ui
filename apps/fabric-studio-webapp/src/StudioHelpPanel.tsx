export function StudioHelpPanel() {
  return (
    <div className="studio-help-page" aria-label="Studio help">
      <header className="studio-header">
        <h1>Studio Setup Help</h1>
        <p>Use these prerequisites before compiling a governed Fabric composition in Unfurl Studio.</p>
      </header>

      <section className="studio-panel help-section" id="scanned-catalog">
        <h2>Scanned Catalog</h2>
        <p>
          A catalog is the indexed set of component artifacts that Fabric can consider. Run Fabric scan against the
          component artifact directory, review scan diagnostics, and use the resulting catalog hash as the base for
          draft composition work.
        </p>
        <pre>{`fabric scan --catalog ./components --out ./catalog.yaml`}</pre>
      </section>

      <section className="studio-panel help-section" id="component-claims">
        <h2>Component Claims</h2>
        <p>
          Each Intelligent Component must ship a DCP claim in its catalog metadata. Claims declare offers,
          dependencies, refusals, lifecycle, capability versions, and binding modes. Studio renders these facts; it
          does not invent compatibility rules.
        </p>
        <pre>{`META-INF/unfurl-catalog.yaml
claim:
  offers:
    - capability: validate.order
      version: 1.1.0
  dependencies:
    - customer.query@^1?substrate=true`}</pre>
      </section>

      <section className="studio-panel help-section" id="needs">
        <h2>Needs</h2>
        <p>
          Needs describe what the operator wants the composition to satisfy. Fabric uses needs as matcher input before
          any Studio manipulation can become a candidate or compiled contract.
        </p>
        <pre>{`needs:
  - capability: validate.order
    version: ^1
    required: true`}</pre>
      </section>

      <section className="studio-panel help-section" id="trust-policy">
        <h2>Trust Policy</h2>
        <p>
          Trust policy controls which catalog entries are allowed, rejected, or require operator review. If no policy is
          supplied, fixture/demo mode is permissive; production use should provide an explicit policy.
        </p>
        <pre>{`trustedVendors:
  - platform-team
rejectedCoordinates:
  - com.example:legacy-adapter:*`}</pre>
      </section>

      <section className="studio-panel help-section" id="deployment-policy">
        <h2>Deployment Policy</h2>
        <p>
          Deployment policy constrains how selected components may run: service, sidecar, library, container, managed
          adapter, and runtime limits. Studio shows allowed and blocked options, but Fabric validates the final intent.
        </p>
        <pre>{`preferredShapes:
  - CONTAINERIZED_SERVICE
disallowedShapes:
  - MANAGED_EXTERNAL_ADAPTER
runtime:
  kubernetes: true
  maxServices: 12`}</pre>
      </section>
    </div>
  );
}
