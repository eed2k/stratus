"""Aligned, RFC 4180 CSV writing.

A deliberate port of the browser helper in Stratus (client/src/lib/csvExport.ts)
so a client who exports weather data from Stratus and calibration data from this
panel gets files that look and parse the same way. The two products previously
disagreed: one padded its columns, the other joined raw values with commas.

Two alignment rules, both chosen for a reason:

  - Padding goes on the RIGHT, so a value still begins immediately after its
    comma. Spaces inside a field are part of the field under RFC 4180, and a
    numeric column with LEADING spaces is exactly what makes Excel import that
    column as text. Trailing spaces are dropped when a cell is coerced to a
    number, so the file stays machine-readable as well as legible.
  - The last column is never padded. Trailing whitespace at end of line buys no
    alignment and several diff and lint tools flag it.

Width is computed per block, not across the document. A calibration record holds
several tables with different shapes, and stretching a two-column summary to the
width of a five-column log would misalign both.

A UTF-8 BOM is prepended once, at the top of the document. Without it Excel
assumes the system code page.

Property of METRON (PTY) LTD | Inteltronics
Developed by L.J. Esterhuizen, Inteltronics
"""

BOM = "\ufeff"

# Characters that force a field to be quoted, per RFC 4180.
_MUST_QUOTE = ('"', ",", "\n", "\r")


def csv_field(value):
    """Quote one value to RFC 4180. None becomes an empty field."""
    text = "" if value is None else str(value)
    if any(ch in text for ch in _MUST_QUOTE):
        return '"' + text.replace('"', '""') + '"'
    return text


def align_block(rows):
    """Format a grid of already-stringified rows into aligned CSV lines.

    `rows` is a sequence of sequences. Ragged rows are allowed: a short row is
    treated as having empty trailing fields, which is what a section title row
    is.
    """
    cells = [[csv_field(v) for v in row] for row in rows]
    if not cells:
        return []

    col_count = max(len(r) for r in cells)
    widths = [0] * col_count
    for row in cells:
        # A one-cell row is a section title, not a table row, so it must not set
        # the width of column A. Otherwise a heading like "Oscillator
        # recalibration by trigger" padded every label under it out to 35
        # characters and the table it introduces looked worse than unaligned.
        if len(row) < 2:
            continue
        for i, cell in enumerate(row):
            if len(cell) > widths[i]:
                widths[i] = len(cell)

    lines = []
    for row in cells:
        last = len(row) - 1
        out = []
        for i, cell in enumerate(row):
            # Never pad the final field of the row it is actually in, otherwise a
            # one-cell title row would carry the whole grid's width in spaces.
            out.append(cell if i == last else cell.ljust(widths[i]))
        lines.append(",".join(out))
    return lines


def build_aligned_csv(headers, rows, extra_rows=()):
    """One aligned table as a complete CSV document.

    `extra_rows` are appended after a blank line and are NOT padded to the grid:
    provenance lines are prose, not table rows.
    """
    lines = align_block([list(headers)] + [list(r) for r in rows])
    if extra_rows:
        lines.append("")
        lines.extend(str(r) for r in extra_rows)
    return BOM + "\n".join(lines) + "\n"


def build_csv_document(blocks, notes=()):
    """Several aligned tables as one CSV document.

    `blocks` is a sequence of row-sequences; each block is aligned on its own and
    separated from the next by a blank line. Empty blocks are skipped so a
    section that had no data does not leave a gap.

    `notes` are plain single-field lines appended at the end, each wrapped in its
    own row so a spreadsheet keeps the text in column A.
    """
    out = []
    for rows in blocks:
        lines = align_block([list(r) for r in rows])
        if not lines:
            continue
        if out:
            out.append("")
        out.extend(lines)
    if notes:
        if out:
            out.append("")
        out.extend(csv_field(n) for n in notes)
    return BOM + "\n".join(out) + "\n"
