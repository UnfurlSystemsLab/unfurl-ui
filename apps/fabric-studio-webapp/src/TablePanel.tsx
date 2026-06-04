import type { StudioTableView } from "./tableView.js";

export type TablePanelProps = {
  readonly table: StudioTableView;
};

export function TablePanel({ table }: TablePanelProps) {
  return (
    <div className="table-stack">
      <section className="studio-panel">
        <h2>{table.title}</h2>
        <div className="summary-row">
          {table.summary.map(item => <span key={item}>{item}</span>)}
        </div>
      </section>

      {table.sections.map(section => (
        <section className="studio-panel" key={section.title}>
          <h2>{section.title}</h2>
          <table>
            <thead>
              <tr>
                {section.columns.map(column => <th key={column}>{column}</th>)}
              </tr>
            </thead>
            <tbody>
              {section.rows.length === 0 && (
                <tr>
                  <td colSpan={section.columns.length}>No rows</td>
                </tr>
              )}
              {section.rows.map((row, index) => (
                <tr key={`${section.title}-${index}`}>
                  {row.map((cell, cellIndex) => <td key={`${section.title}-${index}-${cellIndex}`}>{cell}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
