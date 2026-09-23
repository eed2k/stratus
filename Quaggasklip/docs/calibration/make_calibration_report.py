"""Build the Quaggasklip antenna calibration report.

Layout, field set and section order follow the GWLD1 report so the two are
comparable side by side. Page setup is A4 portrait, scaled to one page, so it
exports straight to PDF.

All measurements are from a sweep run on this unit. Nothing is carried over from
GWLD1.
"""
import os
import textwrap

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.worksheet.properties import PageSetupProperties

# Characters per prose line. Columns A to D total 82 characters of width, so this
# leaves a small margin and guarantees a line never runs past column D.
WRAP = 78

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(OUT_DIR, "QUAGGASKLIP_CALIBRATION_REPORT.xlsx")

TARGET = 500000
TOL = 0.035
LOW = round(TARGET * (1 - TOL))
HIGH = round(TARGET * (1 + TOL))

REPORT_DATE = "2026-09-14"

# Antenna frequency at each tuning capacitor step, measured on GPIO 6 with the
# AS3935 internal divider set to /128.
SWEEP = [
    (0, 0, 516736), (1, 8, 514688), (2, 16, 513280), (3, 24, 510976),
    (4, 32, 509696), (5, 40, 507776), (6, 48, 507008), (7, 56, 505216),
    (8, 64, 503424), (9, 72, 500480), (10, 80, 499456), (11, 88, 495616),
    (12, 96, 496256), (13, 104, 493568), (14, 112, 492416), (15, 120, 491520),
]
BEST_CAP = 9

TITLE = Font(bold=True, size=14)
SECTION = Font(bold=True, size=14)
LBL = Font(bold=True, size=12)
TXT = Font(size=12)
SEL = Font(bold=True, size=12)
HDR_FILL = PatternFill("solid", fgColor="FFE8E8E8")
SEL_FILL = PatternFill("solid", fgColor="FFFFF2CC")

wb = Workbook()
ws = wb.active
ws.title = "Antenna Calibration"

for col, width in (("A", 26), ("B", 18), ("C", 22), ("D", 16)):
    ws.column_dimensions[col].width = width

r = 1


def span(text, font):
    global r
    ws.cell(r, 1, text).font = font
    ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=4)
    r += 1


def field(label, value):
    global r
    ws.cell(r, 1, label).font = LBL
    ws.cell(r, 2, value).font = TXT
    ws.merge_cells(start_row=r, start_column=2, end_row=r, end_column=4)
    r += 1


def para(text, lines=None):
    """Prose, pre-wrapped in Python with one line per row.

    Deliberately not a merged, wrapped cell. Excel does not auto-fit the row
    height of a merged cell, so such a cell either clips its text or needs a
    guessed height. The first version of this report guessed the height from a
    character count, and that is what made the spacing wrong on export.

    Each line is written unmerged into column A. With B, C and D empty on these
    rows the text simply overflows to the right the way it would in any document,
    default row heights apply, and the PDF comes out exactly as the sheet looks.
    """
    global r
    for line in textwrap.wrap(" ".join(text.split()), width=WRAP):
        ws.cell(r, 1, line).font = TXT
        r += 1


def blank():
    global r
    r += 1


span("AS3935 LIGHTNING DETECTOR", TITLE)
span("Antenna Calibration Report [IN ENCLOSURE]", TITLE)
blank()

field("Station ID", "QUAGGASKLIP")
field("Sensor", "AS3935")
field("Interface", "SPI bus 0, device 0, mode 1, 1 MHz; IRQ/LCO on GPIO 6")
field("Calibration date", REPORT_DATE)
field("Enclosure state",
      "ABS enclosure CLOSED and sealed; nylon standoffs; antenna toward lid")
blank()

span("1. PURPOSE", SECTION)
para(
    "Performed with the unit fully assembled inside its ABS enclosure, lid closed "
    "and sealed, in the configuration it will operate in, because nearby materials "
    "shift the antenna's resonant frequency. The AS3935 antenna must resonate at "
    "500 kHz +/- 3.5%%, a band of %s to %s Hz. Each of the sixteen internal tuning "
    "capacitor steps is measured and the step closest to target is locked in the "
    "unit's configuration."
    % (f"{LOW:,}", f"{HIGH:,}")
)
blank()

span("2. METHOD", SECTION)
para(
    "The antenna LC oscillator is routed to the IRQ pin via DISP_LCO in register "
    "0x08, with the internal divider raised to /128 in register 0x03. Rising edges "
    "are counted on the IRQ GPIO over a fixed window and multiplied by 128 to "
    "recover the antenna frequency. Error is the difference from 500,000 Hz as a "
    "percentage. Registers 0x03 and 0x08 are saved on entry and restored on exit."
)
para(
    "The /128 divider is used because the default /16 puts about 31.25 kHz on the "
    "pin, which cannot be counted reliably and reads as 0 Hz. The IRQ GPIO was "
    "established by measurement rather than from the pinout: only GPIO 6 carried "
    "the clock."
)
blank()

span("3. MEASURED RESULTS (IN ENCLOSURE, SEALED)", SECTION)
for i, text in enumerate(["Cap step", "Cap (pF)", "Measured freq (Hz)",
                          "Error (%)"], start=1):
    c = ws.cell(r, i, text)
    c.font = LBL
    c.fill = HDR_FILL
    c.alignment = Alignment(horizontal="center")
r += 1

for cap, pf, hz in SWEEP:
    err = abs(hz - TARGET) / TARGET * 100.0
    chosen = cap == BEST_CAP
    for i, v in enumerate([cap, pf, f"{hz:,}", f"{err:.2f}"], start=1):
        c = ws.cell(r, i, v)
        c.font = SEL if chosen else TXT
        c.alignment = Alignment(horizontal="center")
        if chosen:
            c.fill = SEL_FILL
    r += 1
blank()
span("Selected setting (cap %d) is highlighted above." % BEST_CAP, TXT)
blank()

best_hz = dict((c, h) for c, _, h in SWEEP)[BEST_CAP]
best_err = abs(best_hz - TARGET) / TARGET * 100.0

span("4. SELECTED SETTING", SECTION)
field("TUNE_CAP", str(BEST_CAP))
field("Tuning capacitance", "%d pF" % (BEST_CAP * 8))
field("Measured antenna frequency", "%s Hz" % f"{best_hz:,}")
field("Frequency error", "%.2f %%   (target +/- 3.5 %%)" % best_err)
field("Result", "PASS")
para(
    "The selected setting sits %+d Hz from target, an error of %.2f%%, roughly %dx "
    "margin against the +/- 3.5%% tolerance. All sixteen steps fall inside "
    "tolerance, confirming a healthy antenna inside the sealed enclosure; the worst "
    "case is cap 0 at 3.35%%."
    % (best_hz - TARGET, best_err, int(3.5 / best_err))
)
blank()

span("5. AS-MEASURED ENVIRONMENT (AT CALIBRATION)", SECTION)
for i, text in enumerate(["Item", "Value", "Notes"], start=1):
    c = ws.cell(r, i, text)
    c.font = LBL
    c.fill = HDR_FILL
ws.merge_cells(start_row=r, start_column=3, end_row=r, end_column=4)
r += 1

for label, value, note in [
        ("CPU temperature", "45.5 C", "Nominal, no throttling"),
        ("WiFi signal", "-17 dBm", "Very strong"),
        ("Selected tune_cap", "9 (72 pF)", "Locked in config"),
        ("Noise floor setting", "5", "Disturber masking enabled"),
        ("Minimum strikes", "5", "Strikes required before an event"),
]:
    ws.cell(r, 1, label).font = TXT
    ws.cell(r, 2, value).font = TXT
    ws.cell(r, 3, note).font = TXT
    ws.merge_cells(start_row=r, start_column=3, end_row=r, end_column=4)
    r += 1

last_row = r - 1

# A4 portrait, scaled to a single page, so File > Export > PDF needs no fiddling.
ws.print_area = "A1:D%d" % last_row
ws.page_setup.paperSize = ws.PAPERSIZE_A4
ws.page_setup.orientation = "portrait"
ws.sheet_properties.pageSetUpPr = PageSetupProperties(fitToPage=True)
ws.page_setup.fitToWidth = 1
ws.page_setup.fitToHeight = 1
ws.page_margins.left = 0.6
ws.page_margins.right = 0.4
ws.page_margins.top = 0.5
ws.page_margins.bottom = 0.5
ws.page_margins.header = 0.2
ws.page_margins.footer = 0.2
ws.sheet_view.showGridLines = False

wb.save(OUT)
print("written: %s" % OUT)
print("rows: %d  print area: %s" % (last_row, ws.print_area))
print("best: cap %d, %s Hz, %.2f%%" % (BEST_CAP, f"{best_hz:,}", best_err))
