# Contributing To unfurl-ui

Thank you for helping improve `unfurl-ui`, the community-facing frontend
workspace for the Unfurl host shell and Studio experience.

## Community License

This repository is licensed under the [Apache License 2.0](LICENSE).

Unless you explicitly state otherwise, any contribution intentionally submitted
for inclusion in this repository is submitted under Apache 2.0, matching the
repository license.

Apache 2.0 keeps the Studio community surface open for individuals, open-source
projects, nonprofits, and commercial users. UnfurlSystemsLab may also provide
separate commercial products, hosted services, enterprise modules, support, or
managed deployments that include or interoperate with this Apache-licensed
community code.

## Open-Core Boundary

`unfurl-ui` should stay the open community frontend surface:

- host shell contracts;
- Fabric Studio visual composition experience;
- shared UI packages;
- validation clients and scene model contracts;
- themes and rendering primitives intended for public collaboration.

Enterprise-only features should not be slipped into this repository under an
unclear license. Put commercial-only code in a separately licensed repository,
package, or module with an explicit license header and README.

Past Apache 2.0 releases remain Apache 2.0. If the licensing model changes in
the future, existing released versions and accepted Apache-licensed
contributions remain available under their original terms.

## Pull Request Checklist

- Read the relevant design docs before changing behavior:
  - `docs/HLD-D-fabric-ui-host-shell.md`
  - `docs/LLD-unfurl-studio-visual-composition.md`
  - `docs/REPO-ai-contract-authoring-build-spec.md`
- Keep Studio as a projection of Fabric/DCP state; the visual scene must not
  become contract truth.
- Do not add browser-side model SDKs or provider keys.
- Keep tenant/user context and API calls behind the host/Fabric contracts.
- Update docs when behavior or operator workflow changes.
- Run typecheck/tests where practical and mention anything not run.
- Do not commit credentials, private prompts, raw model outputs, generated
  customer contracts, or uploaded customer artifacts.
