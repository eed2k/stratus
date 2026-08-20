# Datasheet and presentation corrections (Task 14)

The client-facing PPTX and datasheet are not held in this folder, so this is the
correction list rather than an edited deck. Every value below was read out of the
shipped code at the file and symbol named, so it can be checked rather than
taken on trust.

Verified against the code on the date this file was written. Re-check
`app/metrics.py` and `app/config.py` if either is edited later.

---

## 1. Alerting is SMS only

**Change to:** alerts are delivered by SMS through the Clickatell One API. No
other channel is included in this deployment.

**Remove or mark as not included:** WhatsApp, email, push notification, voice.

The database schema still carries legacy `whatsapp` and `channel` columns, so a
reader looking at the schema may reasonably assume more channels exist. They are
not wired to anything. The only sender is `app/clickatell_sender.py`, and
`README.md` states the SMS-only position under "SMS only".

Recipients need a mobile number in E.164 format. The "Switch alerts OFF" control
suppresses SMS delivery while still recording every strike for audit, so a
maintenance window does not create a gap in the record.

---

## 2. CPU thresholds

| Threshold | Value |
|-----------|-------|
| WARN | **70 degC** |
| CRIT | **78 degC** |

Source: `app/metrics.py`, `CPU_WARN_C = 70.0` and `CPU_CRIT_C = 78.0`.

These two numbers are surfaced in three places and must agree in all of them:
the reference lines on the dashboard CPU chart, the WARN/CRIT sample counts in
the monthly technical report, and the `/data/cpu` JSON payload. The chart reads
them from the payload rather than hardcoding them, so correcting the code in one
place propagates everywhere.

---

## 3. Energy is a relative, dimensionless value

**Change to:** the AS3935 reports strike energy as a 21-bit relative value in
the range **0 to 2,097,151**. It is a measure of received electromagnetic signal
strength, not an absolute physical quantity.

**Remove:** any expression of energy in joules, watts, amperes or kA, and any
claim that the figure can be compared between two different installations.
Antenna tuning and siting differ per unit, so the scale is only meaningful for
comparing strikes recorded by the same sensor.

Bands used by the panel, from `app/metrics.py`:

| Band | Range | Share of full scale |
|------|-------|---------------------|
| Low | 0 to 524,287 | 0 to 25% |
| Moderate | 524,288 to 1,048,575 | 25 to 50% |
| High | 1,048,576 to 1,572,863 | 50 to 75% |
| Extreme | 1,572,864 to 2,097,151 | 75 to 100% |

A high-intensity marker sits at **1,000,000**, about half scale
(`ENERGY_FIRE_RISK_MARKER`), which is the level the manufacturer associates with
an elevated fire risk.

---

## 4. Detection range is distance only

**Change to:** detection to **40 km**, reported as one of **14 discrete distance
steps**, distance only.

The steps are:

```
1, 5, 6, 8, 10, 12, 14, 17, 20, 24, 27, 31, 34, 37, 40 km
```

Rated accuracy is **+/- 4 km**. The sensor cannot return an arbitrary distance
between those steps.

**Remove:** any claim of bearing, direction, heading or triangulation. The
AS3935 does not measure bearing. Both the dashboard storm view and the report's
ring plot spread dots around the circle purely to stop overlapping distances
hiding one another, and both carry the caption "Distance only - bearing not
measured" so the picture is not read as directional.

Detection covers cloud-to-ground and intra-cloud flashes.

Other sensor facts worth stating correctly: antenna resonance 500 kHz +/- 3.5%,
programmable noise floor levels 0 to 7, and a programmable minimum strike
threshold of 1, 5, 9 or 16 events.

---

## 5. Calibration cadence

**Change to:** the detector self-calibrates on two independent triggers.

- **RC oscillator recalibration** on a CPU temperature delta or on a fixed
  interval, whichever comes first.
- **Antenna resonance check** once daily at **06:00 SAST**.

Both post their results to the panel at `POST /api/v1/calibration`, recorded as
`CalibrationEvent` rows with `kind` of `rc_recal` or `antenna_check`. An antenna
check stores the measured frequency, the tuning capacitor value before and
after, and whether the result was in tolerance. The monthly technical report
counts the recalibrations and lists the antenna checks, so a reader can see the
sensor was in tune over the reporting period.

Reporting is controlled by the detector-side flag `CALIBRATION_REPORT_ENABLED`,
default on.

---

## 6. Retention, if the deck quotes it

| Data | Retention | Source |
|------|-----------|--------|
| Heartbeat telemetry (hourly CPU temperature and load) | **70 days** | `HEARTBEAT_RETENTION_DAYS` |
| Calibration events | **400 days** | `CALIBRATION_RETENTION_DAYS` |
| Strike and alert events | not pruned | no retention setting |

70 days is chosen so a monthly report always has the current month plus a
complete prior month available. 400 days gives calibration a year-over-year
audit trail.

---

## 7. Liveness wording

A unit is shown as **INACTIVE** after **130 minutes** without a heartbeat
(`UNIT_ACTIVE_THRESHOLD_MIN`). The detector beats hourly, so that allows one
missed beat plus margin before the panel raises the state. Avoid describing the
unit as offline after a single missed heartbeat.

---

## Summary of edits to make

1. Replace every multi-channel alerting claim with SMS only via Clickatell.
2. Set WARN to 70 degC and CRIT to 78 degC everywhere.
3. Re-describe energy as relative and dimensionless, 0 to 2,097,151, and delete
   any joule, watt or kA figure.
4. State 40 km, 14 discrete steps, +/- 4 km, distance only, and delete any
   bearing or direction claim.
5. State the two calibration triggers and the 06:00 SAST antenna check.
6. Correct retention to 70 days telemetry and 400 days calibration if quoted.
7. Correct the inactive threshold to 130 minutes if quoted.
