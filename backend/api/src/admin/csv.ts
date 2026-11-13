/**
 * CSV for admin exports (RFC 4180), safe to open in a spreadsheet.
 *
 * Formula injection: a cell that starts with = + - @ (or tab / carriage return, which some
 * spreadsheets skip before those characters) would run as a formula, e.g. =HYPERLINK(...).
 * Such cells get a leading apostrophe, which spreadsheets show as text and never evaluate.
 * Every cell is then quoted, with embedded quotes doubled, so commas and newlines are safe.
 */
export type CsvValue = string | number | boolean | Date | null | undefined;

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: CsvValue): string {
  let text: string;
  if (value === null || value === undefined) text = '';
  else if (value instanceof Date) text = value.toISOString();
  else text = String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/** A UTF-8 BOM (so Excel reads accents correctly), a header row, then one CRLF-terminated row each. */
export function toCsv(headers: readonly string[], rows: ReadonlyArray<readonly CsvValue[]>): string {
  const lines = [headers.map(csvCell).join(','), ...rows.map((row) => row.map(csvCell).join(','))];
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
