# Prework: forecast sector products

Investigation of each requirement against the existing code, before any
implementation. The purpose is to find the places where a criterion cannot be
implemented as written, where it conflicts with code that already exists, or
where it needs a decision that the requirements phase left open.

Findings are graded:

- **CONFLICT** the criterion contradicts existing behavior. Needs a decision and
  probably a requirements amendment.
- **DECISION** the criterion is implementable but more than one reasonable route
  exists and the choice has consequences.
- **CONFIRMED** the criterion is implementable as written; the groundwork exists.
- **GAP** nothing exists yet, and nothing blocks building it.

## Summary of what needs a decision before coding

| Ref | Grade | Issue |
|---|---|---|
| R5.7 to R5.10 | CONFLICT | `assess_frost` already sets `frost_type` by guessing from wind speed. R5.10 forbids guessing |
| R5 vs R7 | CONFLICT | Two different frost probabilities now exist and would appear on the same page disagreeing |
| R1.1 | DECISION | One Stratus alias is claimed by two canonical fields, so parity is ambiguous |
| R1.4 vs R1.5 | DECISION | The tier 2 and tier 3 split is asserted in the design but not enumerated anywhere |
| R3.4 to R3.6 | DECISION | Validation residuals need a home in a schema that has no place for them |
| R7.11 | DECISION | What exactly the method version hashes over |
| R2.13 | DECISION | Provider clear-sky is per-hour model output, not a function; needs plumbing |

Everything else is CONFIRMED or GAP.

## Requirement 1: vocabulary parity

**Measured, not estimated.** `server/parsers/campbellScientific.ts` `fieldMappings`
holds **76 canonical fields** and **343 alias strings, of which 342 are unique**.
`forecast/app/ingest.py` `ALIASES` holds **14 canonical fields**. The gap is 62
fields.

Breakdown of the 62, by what they unlock:

| Group | Count | Fields |
|---|---|---|
| Frost typing | 2 | `temperature8m`, `deltaTemperature` |
| Turbulence | 3 | `windDirStdDev`, `windSpeedMin`, `sdi12WindVector` |
| Air quality and soiling | 4 | `pm25`, `pm10`, `particulateCount`, `so2` |
| Measured PV | 4 | `solarMJTotal`, `panelTemperature`, `moduleTemperature`, `visibilityVolt` |
| Lightning | 4 | `lightning`, `lightningDistance`, `lightningEnergy`, `lightningRaw` |
| MPPT regulators | 33 | `mpptSolarVoltage` through `mppt2ICalSlope` |
| Other | 12 | `batteryVoltage2`, `lithiumBattery`, `waterLevel`, `chargerVoltage`, switches, ports, pump selectors |

The specific aliases for the fields this feature depends on, confirmed by reading
the parser:

    temperature8m       Temp8m_Avg, Temp_8m_Avg, Temp8m, AirTC_8m_Avg
    deltaTemperature    DeltaTemp_Avg, Delta_Temp_Avg, DeltaTemp, Delta_T_Avg
    windDirStdDev       Wind_Dir_SD1_WVT, WindDir_SD1_WVT, WDir_SD1_WVT,
                        WDir_1_Std, WDir_Std, WDir_2_Std
    windSpeedMin        WSpd_1_Min, WSpd_Min, WS_ms_Min, WindSpeed_Min, WSpd_2_Min
    moduleTemperature   MOD_TEMP_Avg, MOD_TEMP, ModTemp_Avg, Module_Temp_Avg
    panelTemperature    PTemp, PTemp_C, Panel_Temp, PTemp_Avg, PTemp_C_Avg,
                        LoggerTemp_Avg, LoggerTemp
    mpptSolarPower      MPPT_SolP_Avg, MPPT_SolarPower, Solar_Power, SolP_Avg,
                        MPPT_Psol, Psol_Avg, SolarCharger_PanelPower_1_Avg
    pm25                PM2_5_Avg, PM2_5, PM25, PM25_Avg
    pm10                PM10_Avg, PM10, PM_10_Avg
    solarMJTotal        SlrMJ_Tot, SlrMJ, Solar_MJ_Tot, SolarMJ_Tot
    particulateCount    partic_Avg, partic, Particulate_Avg, Particulate_Count

### R1.1 DECISION: one alias is claimed by two fields

`SolarCharger_BatteryVoltage_2_Avg` appears in the alias list of **both**
`batteryVoltage2` and `mppt2BatteryVoltage`. It is the only duplicate, and it is
also the only case-insensitive collision.

This is a latent ambiguity in Stratus itself: which canonical field wins depends
on JavaScript object iteration order. The forecast's `build_column_map` iterates
`ALIASES` in insertion order and marks a column as used once claimed, so it would
have the same order dependence.

A parity test that demands an exact one-to-one mapping will fail on this column no
matter which way it is resolved.

Options:

1. Mirror Stratus exactly, duplicate included, and have the parity test accept
   either owner. Preserves bug-for-bug compatibility but encodes an ambiguity.
2. Assign it to `batteryVoltage2` in the forecast and record the divergence, on
   the grounds that a battery voltage is a battery voltage and the MPPT namespace
   is for regulator telemetry.
3. Assign it to `mppt2BatteryVoltage`, on the grounds that the column name says
   SolarCharger.

**Recommendation: option 1.** The requirement is parity with Stratus, and a
deliberate divergence in the first field we touch undermines that. The parity test
should assert the alias is recognized and resolves to one of the two documented
owners, with a comment naming this as the single known ambiguity. Fixing it
properly belongs in the main Stratus parser, not here.

**Requirements impact:** R1.1 should be amended to say every alias is recognized,
and that where Stratus itself maps one alias to two canonical fields the forecast
resolves it the same way Stratus does.

### R1.4 and R1.5 DECISION: the tier 2 and tier 3 split is not enumerated

The design names three tiers and gives examples, but no requirement lists which of
the 62 fields is a product input and which is stored only. Without that list, two
implementers would split them differently, and the split determines what the
sector modules can read.

Proposed enumeration, to be written into the requirements:

**Tier 2, product inputs (13):** `temperature8m`, `deltaTemperature`,
`windDirStdDev`, `windSpeedMin`, `moduleTemperature`, `panelTemperature`,
`mpptSolarPower`, `mppt2SolarPower`, `pm25`, `pm10`, `particulateCount`,
`solarMJTotal`, `rainfall` (already present).

**Tier 3, stored only (49):** everything else, dominated by the 33 MPPT
configuration and calibration channels, plus switches, ports and pump selectors.

Rationale for the boundary: a field is tier 2 when a product in this feature or the
next one reads it as a physical quantity. A calibration slope or a charger state
code is not a physical quantity of the site.

### R1.7 CONFIRMED

`IngestReport` already carries `mapped`, `unmapped_columns`, `conversions` and
`warnings`, and `upload_done.html` already renders the mapping table with a
"forecast" or "stored only" role column. Extending the role column to three tiers
is presentation work on an existing structure.

### R1.8 CONFIRMED

Already implemented and tested. `_conversion_for` consults the units row first,
then `_CANONICAL_UNITS` to short-circuit an already-canonical unit, and only then
falls back to the column name. This was fixed earlier after a test caught a units
row of `kph` being multiplied by 3.6 because the column was still named
`WS_ms_Avg`.

## Requirement 2: solar decomposition and plane-of-array

### R2.1 to R2.12, R2.14, R2.15 GAP

Nothing solar exists in `forecast/app/`. `products.py` has
`extraterrestrial_radiation(latitude_deg, day_of_year)` for the FAO-56 ET0
calculation, which is a daily integral and not reusable for hourly geometry.

No blockers. All of it is arithmetic on the standard library.

### R2.13 DECISION: provider clear-sky needs plumbing that does not exist

The criterion says the provider's clear-sky figure is preferred over Haurwitz.
`providers/xweather.py` does fetch `solradClearSkyWM2`, and it is carried in
`NwpPoint.extras` rather than in `values`, deliberately, so that the bias
correction cannot treat it as a forecast variable.

But `forecast_points` stores no extras. So at the point where a solar page is
rendered from stored forecast points, the provider clear-sky value is gone.

Options:

1. Add clear-sky to the stored forecast point. Pollutes the forecast table with a
   provider-specific column.
2. Re-fetch the background when rendering a solar page. Spends the access budget
   on a page view, which the caching design explicitly set out to avoid.
3. Use Haurwitz always for stored history, and use the provider figure only in a
   live view where the background is already in hand.
4. Store the provider clear-sky series in its own small table keyed by station and
   valid time, written when a run is issued.

**Recommendation: option 4.** It keeps the forecast table clean, costs no extra
API calls, and makes the better clear-sky reference available to any historical
view. Option 3 is the acceptable fallback if the table is judged not worth it.

**Requirements impact:** R2.13 should state where the provider figure is stored,
or be softened to "where a provider clear-sky value is available for that hour".

## Requirement 3: PV yield and validation against measurement

### R3.1 to R3.3 GAP

Straightforward once `solar.py` exists. `thermo.air_density` is built and tested,
so R3.3 is a call rather than new work.

### R3.4 to R3.6 DECISION: validation residuals have nowhere to live

The criteria say modeled cell temperature and DC yield are scored against
`moduleTemperature` and `mpptSolarPower`, and that the residual appears on the
verification page with its sample size.

The existing verification path only knows how to score a **forecast point against
an observation of the same variable**. `db.matched_pairs` joins
`forecast_points` to `observations` on `variable` and `valid_at`. Modeled cell
temperature is not a forecast variable and has no row in `forecast_points`, so
there is nothing for the join to match.

This is a structural mismatch, not an oversight in the criteria. Two honest routes:

1. **Treat the solar model as a diagnostic, not a forecast.** Compute modeled cell
   temperature from *observed* GHI, temperature and wind for past hours, and score
   it against observed `moduleTemperature` over the same hours. This measures the
   model, which is what R3 actually wants, and needs no schema change. It is a
   hindcast comparison and should be labeled as such.
2. **Make cell temperature and DC yield first-class forecast variables**, so they
   flow through `forecast_points` and score like any other. Much larger: it means
   the engine forecasts them, which contradicts the constraint that the engine is
   out of scope.

**Recommendation: option 1.** R3 is asking "is the model right at this site", which
is a question about the model and not about the forecast. Scoring modeled-from-
observed against measured isolates the model error from the forecast error, which
is the more useful decomposition anyway: if the solar page is wrong, this says
whether it is the weather forecast or the PV model that is at fault.

**Requirements impact:** R3.4 and R3.5 should state that validation is a hindcast
of the model driven by observed inputs, distinct from forecast verification, and
R3.6 should place it in its own section of the verification page rather than
implying it sits in the same table as the weather scores.

### R3.7 CONFIRMED as a presentation rule, and worth keeping

Stating "unvalidated at this site" is exactly the honesty the design's risk section
demands, and it is cheap.

## Requirement 4: wind resource

### R4.1 to R4.4, R4.8 to R4.14 GAP

Nothing wind-specific exists beyond `thermo`. No blockers.

### R4.5 to R4.7 CONFIRMED

`thermo.mean_wind_power_density` exists, takes (speed, density) pairs, and is
tested for exactly the two properties these criteria state: a varying series
exceeds the mean-speed calculation (test asserts the ratio is above 1.5), and
power falls linearly with density. R4.5 is satisfied by calling it rather than
reimplementing.

### R4.2 GAP with a caveat worth recording

Measuring a shear exponent needs wind at two heights. The Stratus vocabulary has
`windSpeed` and `windSpeedMin` but **no second-height wind field**. `temperature8m`
exists for temperature; there is no `windSpeed8m`.

So in practice R4.2 will almost never fire on current stations, and R4.3 (assumed
exponent, labeled as assumed) is the normal path. That is not a reason to drop
R4.2, because a met mast added later would supply it, but the requirement should
not imply that measured shear is the common case. The honest framing is that the
assumed path is the default and the output says so, which R4.4 already covers.

### R4.11 CONFIRMED as reachable

`windDirStdBev` is a direction standard deviation, not a speed standard deviation.
Turbulence intensity is conventionally sigma_u over mean u, using the **speed**
standard deviation.

This is a real subtlety: the vocabulary has `WDir_Std` style fields for direction
scatter, and no speed standard deviation field at all. Direction scatter is a
related but different quantity.

Options: compute a proxy turbulence indicator from the gust factor
(`windGust` over `windSpeed`), which the vocabulary does support, and label it as a
gust-factor proxy rather than IEC turbulence intensity; or report turbulence
intensity only where a speed standard deviation column turns up in a real file.

**Recommendation: both.** Report the gust factor always, since it is computable
everywhere and is genuinely informative, and reserve the phrase "turbulence
intensity" and the IEC class for a true sigma_u. Calling a gust factor
"turbulence intensity" would be the kind of quiet mislabeling this spec keeps
trying to avoid.

**Requirements impact:** R4.11 should be split into a gust-factor criterion that
always applies and an IEC turbulence-intensity criterion conditional on a speed
standard deviation being present.

## Requirement 5: agricultural products

### R5.7 to R5.10 CONFLICT: frost type is already guessed from wind

`products.assess_frost` already returns `frost_type`, and it derives it from mean
wind speed during the coldest four hours:

    mean_wind <= 6 km/h    -> "radiation"
    mean_wind >= 20 km/h   -> "advection", but only if the minimum is at or below zero
    otherwise              -> "mixed"

R5.10 says the type "SHALL be reported as undetermined and SHALL NOT be guessed"
when only one temperature height exists. Taken literally, that requires deleting
working behavior on every station that lacks an 8 m sensor, which is currently all
of them.

The wind-based inference is not worthless. Mixing genuinely does suppress surface
decoupling, so wind is a real physical proxy. What it is not is a measurement of
inversion strength, and it should not be presented with the same confidence.

**Recommendation: add provenance rather than remove capability.** Introduce
`frost_type_basis` with three values:

    "inversion"    determined from two temperature heights
    "wind_proxy"   inferred from wind speed, indicative only
    "undetermined" neither available

Keep the existing wind inference under `wind_proxy`, add the inversion
determination when `temperature8m` or `deltaTemperature` is present, and let the
UI phrase the two differently. Only the inversion basis may state that frost fans
will or will not help, because that is the claim that costs money.

**Requirements impact:** R5.7 to R5.10 need rewriting around the basis field. R5.8
and R5.9, which say the output states whether fans will help, must be conditional
on `basis == "inversion"`.

### R5 versus R7 CONFLICT: two frost probabilities that will disagree

`products.assess_frost` returns `probability`, a heuristic score built from
threshold, dew point, wind and cloud terms. Its own docstring is explicit that it
is "not a calibrated probability from a verified ensemble".

`probabilistic.frost_risk`, built in this session, returns an empirical
probability counted from ensemble members, and R7 will make it verifiable through
a reliability diagram.

Both now exist. Put on the same agricultural page they would show two different
frost percentages for the same night, and no user can be expected to reconcile
them.

**Recommendation:** `probabilistic.frost_risk` is authoritative for any number
presented as a probability, because it is the one that can be verified.
`assess_frost` keeps its value as the explainer: the risk band, the reasoning
list, the timing and the type. Its `probability` field should stop being rendered,
and should be renamed to something that cannot be mistaken for the real one, such
as `heuristic_score`, with the reliability-diagram-backed figure taking the label
"probability".

**Requirements impact:** a new criterion is needed stating that exactly one frost
probability is presented, that it is the ensemble one, and that the heuristic
assessment supplies explanation only.

### R5.1 and R5.2 GAP, and R5.2 is a guard worth keeping

No crop coefficient table exists. `et0_penman_monteith` and `et0_hargreaves` both
exist, so ETc is a multiplication once Kc exists. R5.2, which forbids an
irrigation recommendation, is the guard that keeps the excluded soil water balance
excluded, and it should survive review.

### R5.3 and R5.4 GAP, with existing groundwork

`assess_dew` already computes dew onset, clearing, `duration_hours` and a
`disease_pressure` band. That is most of a leaf wetness duration already, under a
different name. Leaf wetness duration should be built on `assess_dew` rather than
beside it, or the two will drift.

### R5.5 and R5.6 GAP

No disease models exist. `assess_dew.disease_pressure` is a three-band heuristic,
not a named model, so it does not satisfy R5.6's requirement to name the model.

### R5.11 and R5.12 GAP

`chill_hours(hours, low=0.0, high=7.2)` exists. Utah units and the Dynamic model
are new. R5.12's note that chill hours underestimates in warm winters is a
presentation string.

### R5.13 GAP

No THI. `heat_index` and `wbgt_shade` exist and are human-comfort measures, not
livestock ones.

### R5.14 CONFIRMED as reachable, conditional on the same sensors as R5.7

Spray inversion detection needs the two temperature heights, so it inherits the
availability problem. `find_spray_windows` exists with delta-T bounds and gust
limits and is the right place to add an inversion flag.

## Requirement 6: PAR, DLI and the agrivoltaic tradeoff

### R6.1 to R6.10 GAP

Nothing exists. Depends on `solar.py` for geometry and on `products.py` for the ET
and heat-stress terms, which is why the design places `agrivoltaics.py` at the top
of the dependency graph.

One observation on R6.5. The crop branch needs "evapotranspiration avoided", which
means ET0 computed twice: once for open sky and once with the shading fraction
applied. `et0_penman_monteith` takes solar radiation as an argument, so this works
by calling it twice with different radiation inputs. That is clean, and worth
recording so nobody tries to invent a shading correction factor for ET0 when
recomputing it is both easier and more defensible.

R6.10, which says quantities are None and the page invites configuration rather
than showing zeros, matters more than it looks. A DLI of zero and a DLI of unknown
look identical in a chart, and the first is a claim about the site.

## Requirement 7: ensemble verification

### R7.1 to R7.3 GAP, and now unblocked

CRPS needs the ensemble members. `forecast_points.members` was added in this
session and `db.matched_pairs` already returns the members column, so the data is
in place and this is arithmetic.

### R7.2 CONFIRMED as a property worth testing

CRPS reducing to mean absolute error for a single-member ensemble is the standard
sanity check on a CRPS implementation, and it is cheap to assert.

### R7.4 to R7.6 GAP

Nothing exists. The rank histogram needs the members, which are now stored.

One caveat for implementation: with 15 members there are 16 possible ranks, and
ties need a rule. Random tie-breaking is conventional; deterministic tie-breaking
biases the histogram. The rule should be stated in the docstring, and the tests
should use distinct values to stay deterministic.

### R7.7 to R7.10 GAP

Reliability diagram, Brier score and its three-way decomposition, and ROC. All
need a binary event definition, and frost is the natural first one. The event
definition should be shared with `probabilistic.frost_risk` so the thing being
scored is the thing being shown.

### R7.11 to R7.13 DECISION: what the method version hashes over

The constants that determine a forecast, found by reading `engine.py`:

    VARIABLE_RULES               the nine variables and their bounds
    ANALOG_WEIGHTS               which variables define similarity, and weights
    ANALOG_TRAJECTORY_HOURS = 6
    NWP_MAX_WEIGHT = 0.70
    ANALOG_MAX_WEIGHT_WITH_NWP = 0.40
    ANALOG_MAX_WEIGHT_NO_NWP = 0.60

Plus, from `forecasting.py`: `DEFAULT_HISTORY_DAYS = 35`,
`MIN_HOURS_FOR_CLIMATOLOGY = 24`, `MIN_HOURS_FOR_ANALOGS = 240`, and the harmonic
count passed to `fit_climatology`.

Options:

1. Hash the source of `engine.py` and `forecasting.py`. Maximally sensitive, but a
   comment change invalidates every historical score, which defeats the purpose.
2. Hash an explicit tuple of the named constants above. Sensitive to what matters
   and stable against edits that do not change behavior. Requires the tuple to be
   maintained by hand, and a forgotten entry gives a false sense of continuity.
3. Hash the constants and additionally record a short human-readable version
   string bumped by hand on a deliberate method change.

**Recommendation: option 2, with the tuple defined in one place and a test that
fails if a new module-level constant is added to `engine.py` without being
considered.** That test is the thing that stops option 2's failure mode. Option 3's
hand-bumped string is worth having as well and costs nothing.

R7.12 as written is directly testable under option 2: same constants give the same
hash, a changed weight gives a different one.

### R7.14 and R7.15 CONFIRMED

`Score` already carries `n` and `interval_n`, and `summary_table` already exposes
them, so sample size is available. A provisional marker is a threshold on `n`.

## Requirement 8: sector configuration and presentation

### R8.1 to R8.4 GAP

No `sector_config` table. The migration pattern is established: `Database._migrate`
already adds columns for `stations`, `forecast_points` and `forecast_runs`, and
`upsert_dropbox_source` is a working template for a one-row-per-station config
table with an `ON CONFLICT` upsert.

### R8.5 CONFIRMED and already true of every page

The existing pages render without scripting; `app.js` only drives the loading
percentage and a confirm dialog. New pages must not regress this.

### R8.6 CONFIRMED as reachable

`charts._empty_box(width, height, message)` already exists for exactly this, and is
used when a chart has no data. Naming the missing sensor rather than the internal
field is a message-construction detail.

### R8.7 CONFIRMED as the right call, with one exception already handled

Deriving on demand rather than caching avoids a second source of truth. The
exception, the method version, is already correctly identified in R8.8 as the one
thing that must be captured at issue time.

### R8.9 CONFIRMED

`_migrate` only ever issues `ALTER TABLE ADD COLUMN`, which is all SQLite allows,
and the existing `wanted` dict is the place to add to.

## Cross-cutting findings

### Test isolation is already load-bearing

`conftest.py` has an autouse fixture stripping `XWEATHER_*` and `DROPBOX_*` from
the environment, added after a test made a real Dropbox API call using deploy
credentials that had leaked into the shell. Any new test that touches a provider
must not undo it.

### The 320 MB cap is close enough to matter

The running container measured 41.74 MiB against a 320 MB limit. Five new modules
of pure-Python arithmetic will not threaten that, but a Weibull fit or a
transposition loop run over 120 hours times 9 variables times 15 members on every
page view could. R8.7's derive-on-demand rule and the per-request cost need to be
checked once, not assumed.

### There is no sector data to test against yet

The live site has zero stations by design. Every acceptance criterion here will be
verified against `conftest.make_toa5`, which currently generates temperature,
humidity, dew point, pressure, wind, gust, direction, solar radiation, rainfall,
soil temperature and battery voltage. It does **not** generate `temperature8m`,
`deltaTemperature`, `moduleTemperature`, `mpptSolarPower` or the particulate
channels.

So the fixture must be extended before R3, R4.11 and R5.7 can be tested at all.
That is a prerequisite task, and it is not currently in the implementation order.

## Recommended requirements amendments

Arising directly from the findings above, to be applied before implementation:

1. **R1.1**: acknowledge the single duplicate alias and require resolution to match
   Stratus.
2. **R1.4 and R1.5**: enumerate the tier 2 and tier 3 field lists explicitly.
3. **R2.13**: state where a provider clear-sky value is stored, or soften to
   availability.
4. **R3.4 to R3.6**: state that model validation is a hindcast driven by observed
   inputs, distinct from forecast verification, and give it its own page section.
5. **R4.11**: split into an always-available gust factor and an IEC turbulence
   intensity conditional on a speed standard deviation.
6. **R5.7 to R5.10**: rewrite around a `frost_type_basis` field with three values;
   make the claim about frost fans conditional on the inversion basis.
7. **New criterion under R5**: exactly one frost probability is presented, it is
   the ensemble one, and the heuristic assessment provides explanation only.
8. **New criterion under R8 or a new prerequisite task**: extend
   `conftest.make_toa5` to emit the tier 2 channels so the new products are
   testable.
