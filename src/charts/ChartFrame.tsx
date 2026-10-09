import { useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { Card, EmptyState } from '../ui';
import { t } from '../i18n';

export interface TableData {
  caption: string;
  columns: string[];
  /** Built only when the table is opened. */
  rows: () => (string | number)[][];
}

/**
 * Shared shell for every chart: a heading, a one-line headline in plain text (the number you actually want),
 * the chart itself (or a friendly hint when there isn't enough data), and the same numbers as a table.
 */
export function ChartFrame({
  id,
  title,
  headline,
  note,
  controls,
  empty,
  table,
  children,
}: {
  id: string;
  title: string;
  /** The takeaway, e.g. "Trend −1.2 kg over 3 months". Neutral wording only. */
  headline?: string;
  note?: string;
  controls?: ComponentChildren;
  /** When set, replaces the chart with this hint. */
  empty?: string;
  table?: TableData;
  children?: ComponentChildren;
}) {
  // The table's rows are only built once it is opened: hundreds of rows per chart would slow the page for nothing.
  const [open, setOpen] = useState(false);
  return (
    <Card labelledBy={`${id}-h`}>
      <div class="stack gap-3">
        <h2 id={`${id}-h`}>{title}</h2>
        {controls}
        {empty ? (
          <EmptyState>{empty}</EmptyState>
        ) : (
          <>
            {headline && <p class="t-label chart-headline">{headline}</p>}
            {children}
            {note && <p class="t-caption">{note}</p>}
            {table && (
              <details class="howto chart-table" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
                <summary>{t('chart.table')}</summary>
                {open && (
                <div class="table-wrap" tabIndex={0} role="region" aria-label={table.caption}>
                  <table>
                    <caption class="sr-only">{table.caption}</caption>
                    <thead>
                      <tr>{table.columns.map((c) => <th key={c} scope="col">{c}</th>)}</tr>
                    </thead>
                    <tbody>
                      {table.rows().map((r, i) => (
                        <tr key={i}>{r.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{c}</td>))}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                )}
              </details>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
