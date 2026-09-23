/**
 * Shared CSV export helper.
 *
 * Every export in the app used to join rows with `r.join(",")`, which has two
 * faults.
 *
 * It is not valid RFC 4180. Any value containing a comma, a double quote or a
 * newline silently shifts every following column, so one text field with a comma
 * in it corrupts the whole row and the reader has no way to tell.
 *
 * And nothing lined up. A heading like "Barometric Pressure (hPa)" is 25
 * characters and its values are 4, so no value sat under the name it belonged to
 * and the file could only be read in a spreadsheet, never as text. That is the
 * complaint this module exists to fix.
 *
 * Alignment rules, both deliberate:
 *
 *  - Padding goes on the RIGHT, so a value still begins immediately after its
 *    comma. Spaces inside a field are part of the field under RFC 4180, and a
 *    numeric column with LEADING spaces is what makes Excel import the column as
 *    text. Trailing spaces are trimmed when a cell is coerced to a number, so the
 *    file stays machine-readable as well as legible.
 *  - The last column is never padded. Trailing whitespace at end of line buys no
 *    alignment and some diff and lint tools flag it.
 *
 * A UTF-8 BOM is prepended because Excel assumes the system code page otherwise
 * and mangles degree signs and anything else non-ASCII.
 *
 * Property of METRON (PTY) LTD | Inteltronics
 * Developed by L.J. Esterhuizen, Inteltronics
 */

/** Quote a single field to RFC 4180. */
export function csvField(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Build an aligned, RFC 4180 quoted CSV document.
 *
 * `extraRows` are appended after a blank line and are NOT padded to the data
 * grid: provenance lines are prose, not table rows, and stretching them to the
 * column widths only misaligns them.
 */
export function buildAlignedCsv(
  headers: readonly unknown[],
  rows: readonly (readonly unknown[])[],
  extraRows: readonly string[] = [],
): string {
  const headerCells = headers.map(csvField);
  const dataCells = rows.map(r => r.map(csvField));

  const colCount = headerCells.length;
  const widths = new Array<number>(colCount).fill(0);
  for (const row of [headerCells, ...dataCells]) {
    for (let i = 0; i < colCount; i++) {
      const len = (row[i] ?? "").length;
      if (len > widths[i]) widths[i] = len;
    }
  }

  const formatRow = (row: string[]): string =>
    row
      .map((cell, i) => {
        const s = cell ?? "";
        return i === colCount - 1 ? s : s + " ".repeat(Math.max(0, widths[i] - s.length));
      })
      .join(",");

  const lines = [formatRow(headerCells), ...dataCells.map(formatRow)];
  if (extraRows.length > 0) {
    lines.push("");
    lines.push(...extraRows);
  }
  // Leading BOM so Excel reads it as UTF-8.
  return "\uFEFF" + lines.join("\n");
}

/** Trigger a browser download of `text` as `filename`. */
export function downloadTextFile(
  text: string,
  filename: string,
  mime = "text/csv;charset=utf-8;",
): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
