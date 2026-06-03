import type { ReadOnlyCompositionView } from "@unfurl/fabric-scene-model";

export type StudioTableSection = {
  readonly title: string;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly string[])[];
};

export type StudioTableView = {
  readonly title: string;
  readonly summary: readonly string[];
  readonly sections: readonly StudioTableSection[];
};

export function buildStudioTableView(view: ReadOnlyCompositionView): StudioTableView {
  return {
    title: `Composition ${view.contractId}`,
    summary: [
      `candidate: ${view.candidateId}`,
      `components: ${view.components.length}`,
      `ports: ${view.ports.length}`,
      `substrate ports: ${view.substrate.length}`,
      `warnings: ${view.warnings.length}`
    ],
    sections: [
      componentSection(view),
      portSection(view),
      substrateSection(view),
      warningSection(view)
    ]
  };
}

export function renderStudioTableText(table: StudioTableView): string {
  const lines: string[] = [table.title, ...table.summary.map(item => `- ${item}`)];
  for (const section of table.sections) {
    lines.push("", section.title, section.columns.join(" | "));
    for (const row of section.rows) {
      lines.push(row.join(" | "));
    }
  }
  return lines.join("\n");
}

function componentSection(view: ReadOnlyCompositionView): StudioTableSection {
  return {
    title: "Components",
    columns: ["Component", "Name", "Coordinates", "Claim", "Artifact", "Visual"],
    rows: view.components.map(row => [
      row.componentId,
      row.name,
      row.coordinates,
      row.claimHash,
      row.artifactSha256,
      row.visualStatus
    ])
  };
}

function portSection(view: ReadOnlyCompositionView): StudioTableSection {
  return {
    title: "Ports",
    columns: ["Component", "Port", "Capability", "Kind", "Status"],
    rows: view.ports.map(row => [
      row.componentId,
      row.portId,
      row.capability,
      row.kind,
      row.status
    ])
  };
}

function substrateSection(view: ReadOnlyCompositionView): StudioTableSection {
  return {
    title: "Substrate",
    columns: ["Port", "Status", "Profile Hash"],
    rows: view.substrate.map(row => [
      row.port,
      row.status,
      row.profileHash
    ])
  };
}

function warningSection(view: ReadOnlyCompositionView): StudioTableSection {
  return {
    title: "Warnings",
    columns: ["Code", "Message"],
    rows: view.warnings.map(row => [
      row.code,
      row.message
    ])
  };
}
