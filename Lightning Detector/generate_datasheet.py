"""Generate a generic Lightning Detection System data sheet as DOCX."""

from docx import Document
from docx.shared import Pt, Inches, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn

doc = Document()

# -- Page margins --
for section in doc.sections:
    section.top_margin = Cm(2.0)
    section.bottom_margin = Cm(2.0)
    section.left_margin = Cm(2.5)
    section.right_margin = Cm(2.5)

# -- Style helpers --
style_normal = doc.styles["Normal"]
style_normal.font.name = "Calibri"
style_normal.font.size = Pt(10)
style_normal.paragraph_format.space_after = Pt(4)
style_normal.paragraph_format.space_before = Pt(0)

for level in range(1, 4):
    hs = doc.styles[f"Heading {level}"]
    hs.font.name = "Calibri"
    hs.font.color.rgb = RGBColor(0x1F, 0x3A, 0x5F)
    hs.font.bold = True
    if level == 1:
        hs.font.size = Pt(16)
        hs.paragraph_format.space_before = Pt(18)
        hs.paragraph_format.space_after = Pt(6)
    elif level == 2:
        hs.font.size = Pt(12)
        hs.paragraph_format.space_before = Pt(12)
        hs.paragraph_format.space_after = Pt(4)
    else:
        hs.font.size = Pt(10.5)
        hs.paragraph_format.space_before = Pt(8)
        hs.paragraph_format.space_after = Pt(4)


def add_table(headers, rows):
    """Add a formatted table to the document."""
    table = doc.add_table(rows=1 + len(rows), cols=len(headers))
    table.style = "Light Grid Accent 1"
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    # Header row
    for i, h in enumerate(headers):
        cell = table.rows[0].cells[i]
        cell.text = h
        for p in cell.paragraphs:
            p.style = doc.styles["Normal"]
            for run in p.runs:
                run.bold = True
                run.font.size = Pt(9)
    # Data rows
    for r_idx, row_data in enumerate(rows):
        for c_idx, val in enumerate(row_data):
            cell = table.rows[1 + r_idx].cells[c_idx]
            cell.text = str(val)
            for p in cell.paragraphs:
                p.style = doc.styles["Normal"]
                for run in p.runs:
                    run.font.size = Pt(9)
    doc.add_paragraph()


def add_bullet(text):
    p = doc.add_paragraph(text, style="List Bullet")
    p.style.font.size = Pt(10)


# ============================================================
# TITLE PAGE
# ============================================================
for _ in range(6):
    doc.add_paragraph()

title = doc.add_paragraph()
title.alignment = WD_ALIGN_PARAGRAPH.CENTER
run = title.add_run("LIGHTNING DETECTION SYSTEM")
run.bold = True
run.font.size = Pt(26)
run.font.color.rgb = RGBColor(0x1F, 0x3A, 0x5F)

sub = doc.add_paragraph()
sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
run = sub.add_run("Technical Data Sheet")
run.font.size = Pt(18)
run.font.color.rgb = RGBColor(0x4A, 0x4A, 0x4A)

doc.add_paragraph()
line = doc.add_paragraph()
line.alignment = WD_ALIGN_PARAGRAPH.CENTER
run = line.add_run("_" * 60)
run.font.color.rgb = RGBColor(0x1F, 0x3A, 0x5F)

doc.add_paragraph()
cls = doc.add_paragraph()
cls.alignment = WD_ALIGN_PARAGRAPH.CENTER
run = cls.add_run("Reference Document")
run.font.size = Pt(11)
run.font.color.rgb = RGBColor(0x88, 0x88, 0x88)
run.italic = True

doc.add_page_break()

# ============================================================
# TABLE OF CONTENTS (manual)
# ============================================================
doc.add_heading("TABLE OF CONTENTS", level=1)
toc_items = [
    "1.  Product Overview",
    "2.  System Performance Specifications",
    "3.  Detection Capabilities",
    "4.  Data Output and Communication",
    "5.  Alert and Notification Features",
    "6.  Power System Specifications",
    "7.  Environmental Ratings",
    "8.  Mechanical Specifications",
    "9.  Installation Requirements",
    "10. Maintenance Schedule",
    "11. Performance Comparison",
    "12. Limitations and Disclaimers",
    "13. Ordering and Support",
]
for item in toc_items:
    p = doc.add_paragraph(item)
    p.paragraph_format.space_after = Pt(2)

doc.add_page_break()

# ============================================================
# 1. PRODUCT OVERVIEW
# ============================================================
doc.add_heading("1. Product Overview", level=1)

doc.add_heading("1.1 Description", level=2)
doc.add_paragraph(
    "This standalone, solar-powered lightning detection system is designed "
    "for deployment at a wide range of outdoor sites including industrial "
    "facilities, weather stations, agricultural operations, and remote "
    "installations. The system provides continuous, autonomous lightning "
    "monitoring with real-time cloud data publishing, proximity-based alert "
    "notifications, and comprehensive local data logging."
)
doc.add_paragraph(
    "The system is engineered for reliable operation in demanding environments "
    "where conventional lightning detection equipment may experience excessive "
    "false triggers due to electromagnetic interference (EMI) from surrounding "
    "equipment and infrastructure."
)

doc.add_heading("1.2 Key Features", level=2)
features = [
    "Continuous 24/7 lightning detection up to 40 km range",
    "Storm distance estimation with 14-level resolution",
    "Lightning energy measurement for each detected event",
    "Cloud-to-ground and intra-cloud lightning detection",
    "Configurable EMI rejection for demanding environments",
    "Solar-powered with lithium-ion battery backup",
    "Real-time cloud data publishing via HTTPS (TLS 1.2+)",
    "Configurable proximity alerts (SMS, WhatsApp, Email)",
    "Automated weekly summary reports with PDF attachment",
    "Local CSV data logging with daily file rotation",
    "IP65+ weatherproof enclosure (IP67 available)",
    "Mast-mount or pole-mount installation",
    "Non-metallic enclosure for optimal RF transparency",
    "NTP time synchronisation for accurate event timestamps",
    "Offline data buffering with automatic cloud sync on reconnect",
    "Wi-Fi signal strength monitoring",
]
for f in features:
    add_bullet(f)

doc.add_heading("1.3 Typical Applications", level=2)
apps = [
    "Industrial plants and foundries",
    "Mining and quarrying operations",
    "Weather monitoring stations",
    "Agricultural and farming operations",
    "Airport and aviation weather observation",
    "Outdoor event safety management",
    "Construction site safety",
    "Power utility and transmission line monitoring",
    "Telecommunications tower monitoring",
    "Sports and recreation facility weather safety",
    "Solar and wind farm installations",
    "Oil and gas facilities",
]
for a in apps:
    add_bullet(a)

# ============================================================
# 2. SYSTEM PERFORMANCE SPECIFICATIONS
# ============================================================
doc.add_heading("2. System Performance Specifications", level=1)

doc.add_heading("2.1 Detection Performance", level=2)
add_table(
    ["Parameter", "Specification"],
    [
        ["Maximum Detection Range", "40 km"],
        ["Distance Estimation Levels", "14 discrete levels + out of range"],
        ["Distance Reporting Values", "1, 5, 6, 8, 10, 12, 14, 17, 20, 24, 27, 31, 34, 37, 40 km"],
        ["Distance Estimation Accuracy", "+/- 4 km (manufacturer rated)"],
        ["Detection Types", "Cloud-to-ground, intra-cloud"],
        ["Lightning Energy", "21-bit relative measurement per event"],
        ["Antenna Frequency", "500 kHz (+/- 3.5%)"],
        ["Disturber Rejection", "Hardware-embedded algorithm"],
        ["Noise Floor", "7 programmable levels (0-7)"],
        ["Watchdog Threshold", "Configurable (10 levels)"],
        ["Spike Rejection", "Configurable (12 levels)"],
        ["Minimum Strike Threshold", "1, 5, 9, or 16 events"],
        ["Event Latency (detect to log)", "< 2 seconds typical"],
    ],
)

doc.add_heading("2.2 System Performance", level=2)
add_table(
    ["Parameter", "Specification"],
    [
        ["Heartbeat Interval", "120 seconds (configurable)"],
        ["Cloud Publish Latency", "< 2 seconds from detection"],
        ["Local Log Format", "CSV (daily rotation)"],
        ["Time Accuracy", "NTP synchronised (UTC)"],
        ["Wi-Fi Connectivity", "2.4 GHz 802.11 b/g/n"],
        ["Cloud Protocol", "HTTPS POST (TLS 1.2+)"],
        ["Offline Buffering", "Automatic local buffer, sync on reconnect"],
        ["Alert Response Time", "< 5 seconds from detection"],
        ["Weekly Report Generation", "Automated PDF + email delivery"],
    ],
)

# ============================================================
# 3. DETECTION CAPABILITIES
# ============================================================
doc.add_heading("3. Detection Capabilities", level=1)

doc.add_heading("3.1 Lightning Detection Technology", level=2)
doc.add_paragraph(
    "The system utilises an industry-standard Franklin lightning sensor "
    "with a precision-wound 500 kHz detection antenna. The sensor features "
    "a hardware-embedded lightning detection algorithm that analyses incoming "
    "electromagnetic signatures and differentiates genuine lightning events "
    "from man-made electromagnetic disturbances."
)

doc.add_heading("3.2 EMI Rejection", level=2)
doc.add_paragraph(
    "The system is designed for deployment in environments with significant "
    "electromagnetic interference. The sensor's built-in disturber rejection "
    "algorithm identifies and filters interference from common sources including:"
)
emi_sources = [
    "Electric arc and induction furnaces",
    "Variable-frequency drives (VFDs) and large motor starters",
    "Overhead crane motors and slip-ring arcing",
    "High-current bus bars and switchgear",
    "Welding equipment",
    "Switch-mode power supplies",
    "High-intensity discharge (HID) lighting",
]
for s in emi_sources:
    add_bullet(s)

doc.add_paragraph(
    "The EMI rejection parameters are fully configurable to suit the specific "
    "noise profile of each installation site. On-site calibration is performed "
    "during commissioning to optimise detection sensitivity while minimising "
    "false positive rates."
)

doc.add_heading("3.3 Configurable Filter Settings", level=2)
doc.add_paragraph(
    "For sites with high ambient electromagnetic noise, the system is "
    "deployed with conservative filter settings:"
)
settings = [
    "Elevated noise floor to reject persistent broadband interference",
    "Higher watchdog threshold for transient spike rejection",
    "Aggressive spike rejection filtering",
    "Multi-event validation before alert issuance",
    "Outdoor analogue front-end mode (reduced gain)",
]
for s in settings:
    add_bullet(s)
doc.add_paragraph(
    "These settings are optimised during on-site commissioning and can be "
    "remotely adjusted as required. The target false positive rate is "
    "< 1 false event per day under typical conditions."
)

doc.add_heading("3.4 Antenna Calibration", level=2)
doc.add_paragraph(
    "Each unit undergoes antenna calibration during commissioning to "
    "ensure optimal performance. The antenna resonance is verified to be "
    "within 3.5% of the 500 kHz target frequency (482.5 \u2013 517.5 kHz). "
    "Calibration is performed using a proprietary software utility and the "
    "results are stored in the system configuration."
)

# ============================================================
# 4. DATA OUTPUT AND COMMUNICATION
# ============================================================
doc.add_heading("4. Data Output and Communication", level=1)

doc.add_heading("4.1 Cloud Data Publishing", level=2)
add_table(
    ["Parameter", "Specification"],
    [
        ["Protocol", "HTTPS POST (JSON payload)"],
        ["Encryption", "TLS 1.2+ (end-to-end)"],
        ["Authentication", "API key (per-station)"],
        ["Dashboard", "Real-time web-based visualisation"],
        ["Offline Handling", "Automatic local buffering with retry and sync on reconnect"],
    ],
)
doc.add_paragraph("Published data fields include:")
data_fields = [
    "Lightning distance (km)",
    "Lightning energy (relative)",
    "System heartbeat and health status",
    "Additional sensor fields supported (temperature, humidity, pressure, "
    "wind speed, rainfall, battery voltage)",
]
for d in data_fields:
    add_bullet(d)

doc.add_heading("4.2 Local Data Logging", level=2)
add_table(
    ["Parameter", "Specification"],
    [
        ["Format", "CSV (comma-separated values)"],
        ["File Rotation", "Daily (midnight UTC)"],
        ["Storage Capacity", "Years of continuous logging"],
        ["Data Fields", "Timestamp (UTC), event type, distance (km), energy, system parameters"],
        ["Compatibility", "Direct import to Excel, SCADA, LoggerNet, and data analysis tools"],
    ],
)

doc.add_heading("4.3 Data Access", level=2)
access = [
    "Real-time: Cloud dashboard via web browser",
    "Historical: Local CSV download via secure network connection",
    "Integration: Compatible with existing SCADA and data management "
    "systems via cloud API or local file export",
]
for a in access:
    add_bullet(a)

# ============================================================
# 5. ALERT AND NOTIFICATION FEATURES
# ============================================================
doc.add_heading("5. Alert and Notification Features", level=1)

doc.add_heading("5.1 Proximity Alerts", level=2)
doc.add_paragraph(
    "The system generates automatic alerts when lightning is detected within "
    "a configurable proximity threshold."
)
add_table(
    ["Parameter", "Specification"],
    [
        ["Default Alert Distance", "10 km (configurable)"],
        ["Alert Cooldown Period", "60 minutes (configurable)"],
        ["Alert Channels", "SMS, WhatsApp, Email"],
        ["Multiple Recipients", "Yes (configurable per channel)"],
        ["Alert Content", "Distance to storm, timestamp, station identifier"],
    ],
)

doc.add_heading("5.2 Weekly Summary Reports", level=2)
doc.add_paragraph(
    "Automated weekly lightning activity reports are generated and "
    "distributed via email. Reports include:"
)
report_items = [
    "Reporting period (7-day summary)",
    "Total lightning events detected",
    "Closest lightning approach distance",
    "Average and maximum lightning energy",
    "System uptime and health summary",
]
for r in report_items:
    add_bullet(r)
add_table(
    ["Parameter", "Specification"],
    [
        ["Report Schedule", "Configurable day and time (default: Monday 07:00)"],
        ["Report Format", "PDF (A4)"],
        ["Delivery", "Email with PDF attachment"],
    ],
)

# ============================================================
# 6. POWER SYSTEM SPECIFICATIONS
# ============================================================
doc.add_heading("6. Power System Specifications", level=1)

doc.add_heading("6.1 Power Supply", level=2)
add_table(
    ["Parameter", "Specification"],
    [
        ["Primary Power Source", "Solar panel (6\u201324 V DC input)"],
        ["Solar Charge Controller", "MPPT (Maximum Power Point Tracking)"],
        ["Battery Type", "3.7 V Lithium-ion"],
        ["Battery Configuration", "3 cells parallel (3P)"],
        ["Battery Capacity", "9,000 \u2013 10,500 mAh (33\u201339 Wh)"],
        ["Charge Protection", "Over-charge, over-discharge, over-temperature, over-current"],
        ["Output Voltage", "5 V regulated"],
        ["Output Current", "3 A maximum"],
    ],
)

doc.add_heading("6.2 Power Consumption", level=2)
add_table(
    ["Parameter", "Specification"],
    [
        ["Typical Power (listening)", "~1.4 W"],
        ["Peak Power (wireless transmit)", "~2.2 W"],
        ["Daily Energy Budget", "~18\u201336 Wh (usage dependent)"],
    ],
)

doc.add_heading("6.3 Battery Autonomy (No Solar)", level=2)
add_table(
    ["Condition", "Runtime"],
    [
        ["Typical operation", "25+ hours"],
        ["Power-optimised mode", "46+ hours"],
    ],
)

doc.add_heading("6.4 Solar Requirements", level=2)
doc.add_paragraph(
    "Minimum recommended panel: 5 W (6\u201324 V output). The system is "
    "energy-positive with 5 W of available solar input and 4\u20136 peak "
    "sun hours per day. The system can integrate with existing solar panel "
    "infrastructure or operate from a dedicated panel."
)

# ============================================================
# 7. ENVIRONMENTAL RATINGS
# ============================================================
doc.add_heading("7. Environmental Ratings", level=1)

doc.add_heading("7.1 Operating Conditions", level=2)
add_table(
    ["Parameter", "Specification"],
    [
        ["Operating Temperature", "\u221220 \u00b0C to +60 \u00b0C"],
        ["Storage Temperature", "\u221230 \u00b0C to +70 \u00b0C"],
        ["Humidity", "0\u2013100% RH (non-condensing)"],
        ["Ingress Protection", "IP65 minimum (IP67 available)"],
        ["UV Resistance", "UV-stabilised enclosure material"],
        ["Wind Survival", "150 km/h (with mast mounting)"],
        ["Altitude", "0 \u2013 5,000 m ASL"],
    ],
)

doc.add_heading("7.2 Enclosure", level=2)
add_table(
    ["Parameter", "Specification"],
    [
        ["Material", "ABS or polycarbonate (non-metallic)"],
        ["RF Transparency", "Optimised for 500 kHz reception"],
        ["Cable Entry", "IP68-rated cable glands (bottom entry)"],
        ["Mounting", "Rear-mount plate with U-bolt or pole clamp"],
        ["Seal Type", "Gasket seal (IP65 / IP67)"],
    ],
)

doc.add_heading("7.3 Lightning Survivability", level=2)
doc.add_paragraph(
    "The system should be mounted below an existing lightning protection "
    "system (lightning rod / air terminal). External transient voltage "
    "suppression is recommended on the solar input cable. The system "
    "includes internal input protection circuitry."
)

# ============================================================
# 8. MECHANICAL SPECIFICATIONS
# ============================================================
doc.add_heading("8. Mechanical Specifications", level=1)

doc.add_heading("8.1 Dimensions and Weight", level=2)
add_table(
    ["Parameter", "Specification"],
    [
        ["Enclosure Dimensions (typical)", "150 \u00d7 150 \u00d7 90 mm (W \u00d7 H \u00d7 D)"],
        ["Mounting Plate", "Aluminium, corrosion-resistant finish"],
        ["Mounting Hardware", "316 stainless steel U-bolts"],
        ["Cable Glands", "PG9 / M16, IP68 rated"],
        ["Mast Compatibility", "30\u201350 mm diameter (adjustable)"],
        ["Approximate System Weight", "< 1.0 kg (including batteries)"],
    ],
)

doc.add_heading("8.2 Mounting Requirements", level=2)
mount_reqs = [
    "Non-metallic enclosure positioned with antenna facing away from mast "
    "and away from major EMI sources",
    "Minimum 50 cm separation from other electronic equipment",
    "Minimum 30 cm clearance from large metal surfaces",
    "Bottom cable entry for water run-off protection",
    "Elevated mast position recommended for optimal reception",
]
for m in mount_reqs:
    add_bullet(m)

# ============================================================
# 9. INSTALLATION REQUIREMENTS
# ============================================================
doc.add_heading("9. Installation Requirements", level=1)

doc.add_heading("9.1 Site Requirements", level=2)
site_reqs = [
    "Weather station mast or suitable mounting pole (30\u201350 mm diameter)",
    "Solar panel (6\u201324 V output, 5 W minimum) or existing solar infrastructure",
    "2.4 GHz Wi-Fi network coverage at installation location",
    "Clear line of sight to sky (no overhead metallic structures directly above the sensor)",
]
for s in site_reqs:
    add_bullet(s)

doc.add_heading("9.2 Commissioning Services", level=2)
doc.add_paragraph("Professional installation and commissioning services include:")
commissioning = [
    "Physical installation and mounting",
    "Antenna calibration and frequency verification",
    "EMI noise profiling and filter optimisation",
    "Cloud platform configuration and verification",
    "Alert recipient configuration and test notifications",
    "Commissioning report and handover documentation",
]
for c in commissioning:
    add_bullet(c)

doc.add_heading("9.3 Network Requirements", level=2)
net_reqs = [
    "2.4 GHz Wi-Fi (802.11 b/g/n) with internet access",
    "HTTPS outbound access (port 443) to cloud platform",
    "NTP access (port 123) for time synchronisation",
    "SMTP access (port 587) for email report delivery (if enabled)",
]
for n in net_reqs:
    add_bullet(n)

# ============================================================
# 10. MAINTENANCE SCHEDULE
# ============================================================
doc.add_heading("10. Maintenance Schedule", level=1)

add_table(
    ["Frequency", "Activity"],
    [
        ["Monthly", "Verify system operation via cloud dashboard\nReview alert history and data integrity"],
        ["Quarterly", "Inspect enclosure seal and mounting hardware\nClean solar panel and cable connections\nReview and archive data files"],
        ["Annually", "Replace lithium-ion batteries\nReplace desiccant packs\nInspect internal components and cabling\nRe-calibrate antenna if required\nSoftware update (if available)"],
        ["Bi-annually", "Replace storage media (preventative)\nFull system functional verification"],
    ],
)

# ============================================================
# 11. PERFORMANCE COMPARISON
# ============================================================
doc.add_heading("11. Performance Comparison", level=1)

doc.add_paragraph(
    "The system offers comparable detection performance to commercial "
    "lightning detection systems at a significantly reduced cost and power "
    "footprint:"
)
add_table(
    ["Feature", "This System", "Commercial Systems"],
    [
        ["Detection Range", "40 km", "40\u201350 km"],
        ["Distance Accuracy", "+/- 4 km", "+/- 4 km"],
        ["Direction Finding", "No", "Yes (some models)"],
        ["Detection Types", "CG + IC", "CG + IC"],
        ["EMI Rejection", "Yes (configurable)", "Yes"],
        ["Power Consumption", "< 2.5 W", "5\u201315 W"],
        ["Solar Compatible", "Yes (standard)", "Limited"],
        ["Cloud Dashboard", "Yes (included)", "Varies (often extra cost)"],
        ["SMS / WhatsApp Alerts", "Yes (included)", "Rarely included"],
        ["Weekly PDF Reports", "Yes (included)", "Rarely included"],
        ["Offline Buffering", "Yes (automatic)", "Varies"],
        ["Maintenance", "Low", "Moderate\u2013High"],
    ],
)

# ============================================================
# 12. LIMITATIONS AND DISCLAIMERS
# ============================================================
doc.add_heading("12. Limitations and Disclaimers", level=1)

doc.add_heading("12.1 System Limitations", level=2)
limitations = [
    "The system estimates distance to the storm front, not to individual lightning strikes.",
    "No direction or bearing information is provided (distance only).",
    "Detection sensitivity may be lower than high-end commercial systems with large external antenna arrays.",
    "Distance estimation accuracy is +/- 4 km under optimal conditions.",
    "Performance may be reduced in extremely high EMI environments despite aggressive filtering. "
    "Site assessment is recommended prior to deployment.",
    "Battery runtime is reduced at temperatures below 0 \u00b0C.",
    "Requires 2.4 GHz Wi-Fi coverage for cloud publishing and alerts. "
    "Local logging continues without connectivity.",
]
for l in limitations:
    add_bullet(l)

doc.add_heading("12.2 Certification and Compliance", level=2)
compliance = [
    "This system is NOT a certified meteorological instrument.",
    "Data is indicative and intended for safety awareness, operational "
    "decision support, and general weather monitoring.",
    "Data should not be used as the sole basis for official weather "
    "reporting without independent validation.",
    "The system is designed as a complement to, not replacement for, "
    "certified lightning protection systems and safety procedures.",
    "All lightning safety protocols and evacuation procedures should remain "
    "in effect regardless of system status.",
]
for c in compliance:
    add_bullet(c)

# ============================================================
# 13. ORDERING AND SUPPORT
# ============================================================
doc.add_heading("13. Ordering and Support", level=1)

doc.add_heading("13.1 Standard Package Includes", level=2)
package = [
    "Lightning detection unit (fully assembled and tested)",
    "Weatherproof IP65+ enclosure with mounting hardware",
    "Lithium-ion battery pack (pre-installed)",
    "Stainless steel mast mounting kit",
    "Cable glands and power cable",
    "Desiccant packs",
    "Cloud platform account and configuration",
    "Professional installation and commissioning",
    "Commissioning report and system documentation",
    "12-month support",
]
for p in package:
    add_bullet(p)

doc.add_heading("13.2 Optional Add-Ons", level=2)
addons = [
    "Dedicated solar panel (6 V / 5 W or 12 V / 10 W)",
    "Extended battery pack for increased autonomy",
    "Cellular connectivity module (for sites without Wi-Fi)",
    "GPS timing module (for sites without internet / NTP)",
    "Hardware real-time clock (RTC) for power-loss time retention",
    "Integration with Campbell Scientific or other datalogger systems",
    "Extended support and maintenance agreements",
]
for a in addons:
    add_bullet(a)

# ============================================================
# FOOTER
# ============================================================
doc.add_paragraph()
doc.add_paragraph()
footer_line = doc.add_paragraph()
footer_line.alignment = WD_ALIGN_PARAGRAPH.CENTER
run = footer_line.add_run("_" * 60)
run.font.color.rgb = RGBColor(0xAA, 0xAA, 0xAA)

disclaimer = doc.add_paragraph()
disclaimer.alignment = WD_ALIGN_PARAGRAPH.CENTER
run = disclaimer.add_run(
    "This document is provided for reference purposes only.\n"
    "Specifications are subject to change without notice.\n"
    "Contact your representative for the latest information."
)
run.font.size = Pt(8)
run.font.color.rgb = RGBColor(0x88, 0x88, 0x88)
run.italic = True

# ============================================================
# SAVE
# ============================================================
output_path = r"c:\Users\eed2k\Downloads\Lightning Detector\Lightning_Detection_System_Data_Sheet.docx"
doc.save(output_path)
print(f"Data sheet saved to: {output_path}")
