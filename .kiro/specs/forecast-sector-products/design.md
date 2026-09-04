# Design: forecast sector products

## Purpose

The nano-climate forecast service predicts nine weather variables 1, 3 and 5
days ahead from a station's own uploaded logger record. That is the raw
capability. This feature adds the layer that turns those variables into the
quantities four specific markets buy, and the verification needed to show the
forecasts are getting better rather than merely existing.

The four markets, and the single question each one actually asks:

| Market | The question | The quantity that answers it |
|---|---|---|
| Renewable energy | What will this plant earn, and what will the bank lend against | Plane-of-array irradiance, hub-height wind, P50 and P90 yield |
| Research | Can I reproduce and cite this | Versioned method, calibrated ensemble, CRPS |
| Agriculture | Do I act tonight | Probability of frost, and whether frost fans will help |
| Agrivoltaics | Tilt for power or tilt for the crop | kWh sacrificed against crop light gained |

Nothing here changes how the forecast is produced. Every module in this feature
consumes forecast output and turns it into a sector quantity.

## What already exists and is not redesigned

All of `forecast/app/` is pure standard library. There is no numpy, pandas, scipy
or pvlib, and there will not be: the container is capped at 320 MB on a 951 MB
host that also runs the alert panel, the main Stratus app, Postgres, Traefik and
two static sites.

| Module | Responsibility |
|---|---|
| `ingest.py` | Campbell TOA5 parsing, canonical variable mapping, unit conversion, range and pressure-convention warnings |
| `db.py` | SQLite schema and access. `forecast_points` carries value, p10, p90, persistence, climatology and the ensemble `members` |
| `engine.py` | Harmonic climatology, damped anomaly on a measured e-folding time, analog ensemble, `blend_forecast` |
| `forecasting.py` | Drives the engine over 24, 72 and 120 hour horizons; stores baselines and members; backfills past runs |
| `verification.py` | MAE, bias, RMSE, skill against persistence and climatology, interval coverage |
| `products.py` | Psychrometrics and agronomic products: frost, dew, heat, ET0, spray windows, growing degree days, chill hours |
| `thermo.py` | Moist-air density and the quantities that depend on it, including wind power density |
| `probabilistic.py` | Empirical threshold probabilities and exceedance levels, counted from stored ensemble members |
| `providers/` | Optional Vaisala Xweather model background, opt-in per station and per variable |
| `charts.py` | Server-rendered inline SVG. No client-side charting library |

## Shared conventions

These are not stylistic preferences. Each one is a place where a plausible
implementation is silently wrong, and each is stated here so that five modules
cannot disagree about it.

### Units, fixed everywhere

    temperature, dew point    degrees Celsius
    humidity                  percent
    pressure                  hPa, and STATION pressure, never sea-level reduced
    wind speed                km/h
    irradiance                W/m2
    rainfall                  mm
    angles                    degrees in and out, radians only inside a function

Unit conversion happens in exactly one place per boundary: `ingest.py` for logger
data, the provider adapter for model data. No sector module converts units on the
way in.

### Azimuth is degrees clockwise from true north

0 north, 90 east, 180 south, 270 west. This matches the existing wind-direction
convention, so there is one convention in the system rather than two.

### The southern hemisphere is the default, and it inverts the array

A fixed photovoltaic array below the equator faces NORTH. Its surface azimuth is
0, not 180. Every site this service currently serves is southern.

This is called out at design level because the failure mode is not a rounding
error. Code adapted from a northern-hemisphere worked example points the array at
the wrong half of the sky and roughly halves the predicted yield, while still
producing a plausible-looking daily curve. Orientation is therefore always
derived from the sign of the latitude by a single function, and never accepted as
a hand-entered constant.

### P90 is pessimistic

In renewable-energy finance P90 is the value exceeded in 90 percent of cases,
which is the 10th percentile of the distribution. P50 is the median. P10 is
optimistic. This is already implemented correctly in `probabilistic.py` and must
not be inverted by a caller.

### Timestamps are naive local standard time

A Campbell logger is programmed in local standard time and does not shift for
daylight saving. `Station.utc_offset_hours` records the offset and defaults to
2.0 for South African Standard Time. Model data arrives timezone-aware in UTC and
is converted at the provider boundary. Solar geometry needs true solar time,
which is derived from the offset, the longitude and the equation of time.

### Wind power is cubed before it is averaged

Power density goes as the cube of speed, so the mean of the cubes is not the cube
of the mean. For a typical Weibull shape the difference is close to a factor of
two. `thermo.mean_wind_power_density` exists specifically so this order cannot be
got wrong, and wind resource work must go through it.

### Circular variables use vector arithmetic

Wind direction is averaged as unit vectors and differenced with
`engine.signed_angular_difference`. Linear arithmetic on a wrapped axis averages
350 and 10 degrees to 180, pointing the wind the opposite way.

### Failure is a return value, not an exception

Every public function returns None, or a dataclass with None fields, when an
input is missing or unusable. A forecast page must render for a station that has
no pyranometer, and it must not 500 because one sector quantity could not be
computed.

### Every formula names its reference

An unattributed coefficient cannot be checked and cannot be defended when a
customer disputes a number. Docstrings carry the citation.

## Architecture

### Dependency direction

Strictly one way. A lower layer never imports a higher one, so each layer stays
testable on its own and a sector module cannot quietly become a dependency of the
engine.

    ingest -> db -> forecasting -> engine
                                     |
                     +---------------+----------------+
                     |               |                |
                  thermo        probabilistic     providers
                     |               |
        +------------+------+        |
        |            |      |        |
      solar        wind   products   |
        |            |      |        |
        +-----+------+------+--------+
              |
         agrivoltaics
              |
        sector_report  (assembly for the UI)
              |
           charts -> templates

`agrivoltaics` sits at the top because it is the only module that needs three
others at once: solar geometry for the shading, `products` for evapotranspiration
and heat stress, and `thermo` for air density. Placing it anywhere lower would
force a circular import.

`sector_report` is a thin assembly module. It exists so `main.py` does not grow a
large block of per-sector orchestration, and so the same assembled structure
feeds both the HTML view and any future export.

### New modules

| Module | Contains | Depends on |
|---|---|---|
| `solar.py` | Solar position, clear sky, decomposition, transposition, cell temperature, DC yield, tracking | `math` only |
| `wind.py` | Shear extrapolation, Weibull, sector statistics, AEP, turbulence, extreme wind, ramps | `thermo`, `engine` |
| `agrivoltaics.py` | PAR, DLI, array shading, microclimate, the tracker tradeoff | `solar`, `products`, `thermo` |
| `sector_report.py` | Assembles one sector view from a forecast run | all of the above, `db`, `probabilistic` |

### Extended modules

| Module | Additions |
|---|---|
| `products.py` | ETc with crop coefficients, leaf wetness duration, disease models, frost typing by inversion strength, chill portions, livestock THI, spray inversion detection |
| `verification.py` | CRPS, rank histogram, reliability diagram, Brier score and its decomposition, ROC, method version tracking |
| `db.py` | `forecast_runs.method_version`, and a `sector_config` table |
| `charts.py` | Reliability diagram, rank histogram, wind rose, DLI comparison, tracker tradeoff curve |

## Module designs

### solar.py

Three stages, because global horizontal irradiance is not what a plant is paid
for and the gap between the two is neither small nor constant.

**Stage 1, position.** Spencer (1971) declination and equation of time,
Kasten and Young (1989) relative air mass. Azimuth by `atan2`, not `acos`,
because the `acos` form is ambiguous either side of solar noon.

**Stage 2, decomposition.** Clearness index kt from measured GHI over
extraterrestrial horizontal irradiance, then Erbs, Klein and Duffie (1982) for
the diffuse fraction, giving DNI and DHI.

Clear-sky reference is Haurwitz (1945). This is a deliberate choice over Ineichen
or Bird: those are more accurate but need Linke turbidity or aerosol optical
depth, which a weather station does not measure. Using them would mean
substituting a climatological guess and then presenting the result as
site-specific. Where a station has the Xweather background enabled, the provider's
own clear-sky figure is preferred and Haurwitz is the fallback.

Below about three degrees of solar elevation the division by the cosine of the
zenith angle diverges and DNI stops meaning anything. The design attributes
everything to diffuse in that band rather than reporting an enormous beam.

**Stage 3, transposition and yield.** Beam onto the plane by geometry, diffuse by
Hay and Davies (1980) with the Liu and Jordan (1963) isotropic form as a
documented fallback, plus a ground-reflected term from an albedo table. ASHRAE
incidence angle modifier for reflection off the glass, which matters most in the
morning and evening shoulders, exactly where a tracker earns its return. Faiman
(2008) module temperature, then a temperature derate at about -0.0035 per degree
Celsius for crystalline silicon.

Tracking: single-axis with a configurable axis tilt and azimuth, true tracking
plus backtracking so that at low sun the array flattens instead of shading the
row behind it. Ground cover ratio drives the backtracking limit.

**Structures.** `SolarPosition`, `Components` for the GHI split, `PlaneOfArray`
for the transposed result with its beam, diffuse and reflected parts kept
separate, and `PVYield` for the temperature-derated output. Each part is kept
separately rather than summed early because a developer disputing a number needs
to see which term is responsible.

### wind.py

**Shear.** Measurements are at 2 to 10 m; turbines are at 80 to 120 m. Power law
with an exponent measured from two heights where the station has them, falling
back to a documented surface-roughness default where it does not. The fallback is
labeled as an assumption in the output, because an assumed exponent applied over
a factor-of-ten height ratio is the largest single uncertainty in the whole wind
estimate and must not be presented as a measurement.

**Distribution.** Weibull shape and scale by the method of moments, fitted
overall and per direction sector. Sector count is configurable with 12 as the
default, matching wind-rose convention.

**Resource.** Wind power density through `thermo.mean_wind_power_density`, so the
density correction and the cube-then-average order are both inherited rather than
reimplemented. Annual energy production against a supplied power curve, with P50
and P90 taken from the ensemble by way of `probabilistic.exceedance_level`.

**Quality and extremes.** Turbulence intensity and the resulting IEC 61400-1
class where a wind standard deviation column exists. Extreme wind by Gumbel fit
for a 50-year return. Ramp detection for grid and storage sizing.

### agrivoltaics.py

**Light.** GHI to photosynthetically active radiation at about 2.02 micromoles
per joule, integrated to a daily light integral in moles per square meter per
day. DLI is the metric crop science actually uses and almost no weather service
reports it.

**Shading.** Given row pitch, module dimensions, tilt, tracking mode and ground
cover ratio, the fraction of PAR reaching the crop through the day and the
season, and therefore DLI under the array against DLI in the open.

**The tradeoff, which is the actual product.** For each hour, the array can be
tilted for maximum energy or tilted to shade the crop. Both branches are
evaluated:

- energy branch: plane-of-array irradiance and DC yield from `solar`
- crop branch: PAR transmitted, DLI accumulated, evapotranspiration avoided from
  `products`, heat-stress hours avoided from the existing heat assessment

The output is an hourly schedule with the kWh given up and the crop benefit
gained, so an operator can see the exchange rate rather than being handed a
single opaque recommendation. A weighting is offered, but the unweighted
quantities are always shown.

**Microclimate.** Reduced evapotranspiration under the array by applying the
shading fraction to ET0, reduced wind, dew retention, and a water-use-efficiency
figure. Bifacial gain from the albedo table, with the caveat that crop albedo
changes through the growth stage.

### products.py extensions

**Crop water demand.** ETc = ET0 x Kc, with Kc from a crop calendar keyed by crop
and days after planting, following FAO-56 single-coefficient practice. The soil
water balance is deliberately excluded from this feature at the operator's
instruction, so the output stops at crop demand and does not attempt an
irrigation recommendation.

**Leaf wetness duration.** Derived rather than measured, because few of these
stations carry a wetness sensor. Hours are counted wet when relative humidity is
above a threshold, or the dew point is at the air temperature, or rain fell in the
hour, with a drying allowance driven by vapor pressure deficit and wind. The
output states plainly that it is derived, since disease models are sensitive to it
and a derived duration carries more uncertainty than a measured one.

**Disease models.** Leaf wetness duration and temperature drive the risk models,
each of which is a published relationship rather than a rule invented here. The
initial set is chosen for South African relevance: Fusarium head blight on small
grains, downy mildew and botrytis on grapes, citrus black spot, and potato late
blight. Each returns a risk level with the inputs that produced it, so a grower
can see why.

**Frost typing, which is the differentiator.** The existing `assess_frost`
answers whether frost is likely. It does not answer the question that decides
whether money is spent: will frost fans or sprinklers help.

Radiative frost forms under clear calm skies with a strong surface inversion, and
mixing warmer air down does help. Advective frost is a cold air mass moving
through with no inversion, and fans achieve nothing. The distinction comes from
inversion strength, which needs two measurement heights. The Campbell alias table
already recognizes `temperature8m` and `deltaTemperature`, so stations that have
the sensors can be typed and stations that do not are told the type is
undetermined rather than being given a guess.

**Chill accumulation.** Chill hours already exists and is the crudest of the
three models. It fails in warm winters, which is most of South Africa, because
warm daytime hours do not undo accumulated chill in the simple model but do in
reality. The Dynamic model, reported in chill portions, is added alongside, with
Utah chill units as the intermediate. All three are shown together so a grower
using an established chill-hour target is not stranded.

**Livestock and spray.** Temperature humidity index for dairy, beef and poultry,
each with its own thresholds. Spray inversion detection from the two-height
temperatures, because a surface inversion traps drift, which is a separate hazard
from the existing delta-T guidance on droplet survival.

### verification.py extensions

The existing metrics score a single value. The forecast produces an ensemble, so
the current page measures only part of what is being claimed.

**CRPS** becomes the headline metric. It is the proper scoring rule for an
ensemble forecast, it reduces to mean absolute error for a single-member
forecast, and it therefore lets the ensemble and the baselines be compared on one
scale. Computed empirically from the stored members.

**Rank histogram** answers whether the ensemble spread is honest. A flat
histogram means the observation is equally likely to fall anywhere in the
ensemble, which is what a calibrated ensemble looks like. A U shape means the
spread is too narrow, a dome means too wide. This is the diagnostic that tells us
whether the analog ensemble is worth trusting, and there is currently nothing
that measures it.

**Reliability diagram and Brier score** for threshold events, frost being the
obvious one. When the system says 70 percent chance of frost, frost should follow
on about 70 percent of those occasions. Brier decomposition into reliability,
resolution and uncertainty says whether a poor score is miscalibration or a
genuine lack of signal, which are different problems with different fixes.

**ROC** for the same events, because a user choosing an action threshold needs the
hit-rate against false-alarm-rate trade, not a single score.

**Method versioning.** A hash over the engine constants and the blend weights,
stored on each run. Without it, changing a weight silently reinterprets every
historical score, and the improvement loop this feature is supposed to enable
becomes unmeasurable. Scores are grouped by method version so a change is visible
as a step rather than smeared across the record.

## Data model changes

Additive only, following the established migration pattern in `db.py`: SQLite can
only add nullable or defaulted columns, so a fresh database and an upgraded one
must end up identical.

    forecast_runs
      + method_version   TEXT NOT NULL DEFAULT ''

    sector_config                       new table, one row per station
        station_id       INTEGER PRIMARY KEY REFERENCES stations(id)
        sectors_enabled  TEXT   JSON array: solar, wind, agri, agrivoltaics
        latitude/longitude/elevation are already on stations
        pv_tilt, pv_azimuth, pv_tracking, pv_gcr, pv_capacity_kw
        albedo_surface   TEXT   key into solar.ALBEDO
        hub_height_m, measurement_height_m, shear_exponent
        crop, planting_date, row_pitch_m, module_width_m
        livestock_type

Nothing is stored that can be recomputed cheaply from a forecast run. Sector
quantities are derived on demand, because they are pure functions of stored
forecast points and the configuration, and caching them would create a second
source of truth that could disagree with the forecast it came from.

The exception is the method version, which must be captured at issue time because
it describes the code that produced the run and cannot be recovered afterwards.

## Presentation

One new page per enabled sector, reached from the station page, plus additions to
the verification page.

- Solar: POA against GHI, the beam, diffuse and reflected split, module
  temperature, DC yield, and the P50/P90 daily energy table
- Wind: wind rose by sector, Weibull fit, power density, hub-height profile with
  the shear exponent and whether it was measured or assumed, AEP with P50/P90
- Agriculture: frost probability by night with the radiative or advective type,
  ETc, leaf wetness, disease risk, chill accumulation, spray and THI windows
- Agrivoltaics: DLI under array against open, the hourly tracker tradeoff curve,
  water saved, and the exchange rate between kWh and crop benefit
- Verification: CRPS beside the existing MAE, the rank histogram, and a
  reliability diagram per threshold event

Charts stay server-rendered inline SVG in `charts.py`. A sector page must render
with scripting disabled, and must degrade to a table when a station lacks the
sensor a chart needs.

## Correctness properties

Stated here so the requirements phase can attach acceptance criteria to each, and
so the implementation has an explicit list of what the tests must prove.

Each property names the acceptance criteria that hold it, so a test can be traced
to a requirement and an orphaned property is visible.

- **P1 Hemisphere.** Fixed-array orientation is derived from the sign of the
  latitude. A southern site yields surface azimuth 0. *(R2.12, R6.3)*
- **P2 Energy conservation in decomposition.** DHI plus the horizontal projection
  of DNI equals GHI, within tolerance, for every daylight hour. *(R2.3, R2.4)*
- **P3 Transposition sanity.** Plane-of-array irradiance never exceeds the
  extraterrestrial normal irradiance, and equals GHI when tilt is zero.
  *(R2.7, R2.8, R2.9)*
- **P4 Night is zero, not missing.** With the sun below the horizon every
  irradiance quantity is zero rather than None. *(R2.5, R2.6)*
- **P5 Cube before average.** Mean wind power density from a varying series
  exceeds the power density of the mean speed. *(R4.5, R4.6)*
- **P6 Density monotonicity.** Wind power density falls as air density falls, at
  fixed speed. *(R4.7, R3.3)*
- **P7 Shear provenance.** An assumed shear exponent is flagged as assumed in the
  output; a measured one is flagged as measured. *(R4.2, R4.3, R4.4)*
- **P8 P90 is pessimistic.** For any non-degenerate ensemble, P90 is at or below
  P50, which is at or below P10. *(R4.10, R7 preamble)*
- **P9 Member consistency.** Joint probabilities across hours are counted per
  ensemble member, never multiplied per hour. *(R5.10a, R7.1)*
- **P10 CRPS reduces to MAE.** For a single-member ensemble, CRPS equals the
  absolute error. *(R7.1, R7.2)*
- **P11 Rank histogram completeness.** Ranks sum to the number of scored pairs.
  A tie-breaking rule is stated in the implementation and tests use distinct
  values so they stay deterministic. *(R7.4, R7.5)*
- **P12 Reliability monotonicity.** For a perfectly calibrated synthetic set,
  observed frequency equals forecast probability in every populated bin.
  *(R7.7, R7.8)*
- **P13 Frost typing provenance.** A frost type always carries a basis of
  `inversion`, `wind_proxy` or `undetermined`, and only the `inversion` basis may
  state whether frost fans will help. Revised from "never guessed" after prework
  found `assess_frost` already inferring the type from wind: the inference is
  retained because mixing genuinely suppresses decoupling, but it is labeled.
  *(R5.7, R5.7a, R5.7b, R5.7c, R5.8, R5.9, R5.10)*
- **P14 Circular safety.** Any direction-valued output lies in 0 to 360 and is
  computed with vector arithmetic. *(R4.13)*
- **P15 Graceful absence.** Every sector function returns None or a None-filled
  structure for a station missing the required sensor, and no page raises.
  *(R1.7, R2.15, R3.7, R4.14, R6.10, R8.6)*
- **P16 Method version stability.** The same engine constants produce the same
  method version; changing a blend weight changes it. *(R7.11, R7.12, R7.13)*
- **P17 Vocabulary parity.** Every canonical field and every alias recognized by
  `server/parsers/campbellScientific.ts` is recognized by
  `forecast/app/ingest.py`, asserted by a test that reads the parser source so the
  two cannot drift apart unnoticed. Where Stratus maps one alias to two canonical
  fields the ambiguity is mirrored rather than fixed.
  *(R1.1, R1.1a, R1.2, R9.1, R9.2, R9.3)*
- **P18 Model validation against measurement.** Where a station reports
  `moduleTemperature` or `mpptSolarPower`, the modeled equivalent is computed from
  observed inputs, scored against the measured value, and the residual reported as
  a hindcast distinct from forecast verification.
  *(R3.4, R3.5, R3.5a, R3.5b, R3.6)*
- **P19 One probability per question.** Where two derivations of the same
  probability exist, exactly one is presented, and it is the one a reliability
  diagram can verify. Arose from prework finding a heuristic frost score and an
  empirical ensemble probability that would have appeared side by side disagreeing.
  *(R5.10a, R5.10b)*
- **P20 Named quantities are the quantity named.** A gust factor is not called
  turbulence intensity, a derived leaf wetness duration is not called measured, and
  a Haurwitz clear sky is not presented as a provider value. Arose from prework
  finding that the vocabulary carries direction scatter rather than the speed sigma
  that turbulence intensity requires.
  *(R2.13b, R4.11, R4.11a, R4.11b, R5.4)*

## Implementation order

Driven by the dependency graph, not by market priority.

0. **Parameter vocabulary parity.** Extend `ingest.py` to the full 76-field
   Stratus vocabulary and add the parity test. First because it is a prerequisite
   for frost typing, turbulence, soiling and the solar validation path, and
   because it is the cheapest item here: a table extension and a test, no new
   physics.
1. `solar.py`. Nothing else depends on the sun's position, and agrivoltaics
   cannot start without it.
2. `wind.py`. Independent of solar, depends only on `thermo`, which is built.
   Turbulence intensity needs step 0.
3. `products.py` extensions. Independent of both. Frost typing is the
   highest-value single item for the agricultural market and needs step 0.
4. `agrivoltaics.py`. Needs 1 and 3.
5. `verification.py` extensions, including the measured-PV validation path from
   step 0. Independent of 1 to 4 in principle, but sequenced after them so the
   improvement loop measures a stable set of products.
6. `sector_config`, `sector_report.py`, charts and templates. The presentation
   layer, once there is something to present.

## Out of scope

- **Soil water balance.** Excluded at the operator's instruction. Crop water
  demand stops at ETc.
- **Any change to the forecast engine itself.** The blend, the analog search and
  the climatology fit are untouched. If verification shows a calibration problem,
  fixing it is separate work informed by this feature's measurements.
- **Demo or sample data.** Test fixtures are generated in `conftest.py`. An empty
  station list stays a first-class state.
- **The security roadmap.** Tracked separately in `SECURITY_ROADMAP.md`, which
  already carries a measured audit and a prioritized list.

## Risks

**Sensor availability is the binding constraint, not the modeling.** Frost
typing needs two temperature heights. Turbulence intensity needs a wind standard
deviation column. Bifacial gain needs an albedo the station does not measure.
Every one of these must degrade to a stated "not available at this station"
rather than a silent default, or the product will quietly report assumptions as
measurements. This is the single largest risk in the feature.

**Short records limit the ensemble.** The analog ensemble needs roughly ten days
of history before it contributes, and the probabilistic products are built on it.
A newly commissioned station will show wide or absent probabilities, and the UI
must say why rather than appearing broken.

**Verification needs time.** CRPS and reliability diagrams need scored pairs
accumulated across many runs. Backfill produces some immediately, but calibration
conclusions drawn from a handful of days will be noise. The pages should show the
sample size next to every score.

## Parameter vocabulary: the forecast must read everything Stratus reads

### The problem

`server/parsers/campbellScientific.ts` recognizes **76 canonical fields**, each
with a list of Campbell column-name aliases built up from real logger programs in
the field. `forecast/app/ingest.py` currently recognizes **14**. So 62 fields that
the main Stratus server understands are silently dropped by the forecast
ingest.

Silently is the operative word. An unrecognized column is reported in
`IngestReport.unmapped_columns`, but a user reading that list has no way to tell
"this station has no such sensor" from "the forecast does not know this column
name". The same export imports fully into Stratus and partially here, which is
indefensible.

### Why this is a design issue and not a chore

Three of the missing groups are direct inputs to products in this feature, so the
design does not work without them:

| Missing fields | Feature that needs them |
|---|---|
| `temperature8m`, `deltaTemperature` | Frost typing. Inversion strength needs two heights. Without these, property P13 forces every station to report the type as undetermined, and the highest-value agricultural differentiator does not exist |
| `windDirStdDev`, `windSpeedMin` | Turbulence intensity and the IEC 61400-1 class |
| `pm25`, `pm10`, `particulateCount` | The soiling-loss model, which is the distinctly South African part of the solar offering |

A fourth group changes the design rather than merely feeding it.

### Measured PV output is ground truth, and it was being discarded

`moduleTemperature` is a measured module back-surface temperature.
`mpptSolarPower`, `mpptSolarVoltage` and `mpptSolarCurrent` are measured DC output
from a real charge regulator, and `mppt2*` is a second one.

That means some stations already measure the two quantities the solar chain
predicts. The Faiman cell-temperature model and the Hay-Davies transposition do
not have to be trusted on the strength of their citations: on any station with a
regulator and a module sensor they can be **verified against measurement**, and
the residual becomes a site-specific correction.

This is a materially stronger position than modeling blind, and it was invisible
while those columns were being dropped. The design therefore adds a solar
validation path: where `moduleTemperature` exists, score modeled cell temperature
against it; where `mpptSolarPower` exists, score modeled DC yield against it, and
report both on the verification page alongside the weather-variable scores.

### Three tiers of variable

The 76 fields do not all play the same role, and conflating them would put
charger calibration slopes into the forecast engine.

**Tier 1, forecast variables (9).** Blended by the engine, scored by
verification, and listed in `engine.VARIABLE_RULES`. Unchanged by this feature:
temperature, humidity, dew point, pressure, wind speed, wind gust, wind
direction, solar radiation, soil temperature.

**Tier 2, product inputs.** Not forecast, but read by a sector product for the
current or historical state. This is where the frost, turbulence, air quality and
measured-PV groups belong. They must be stored as observations and be available to
`products`, `wind`, `solar` and the validation path.

**Tier 3, stored only.** Everything else, including the 33 MPPT configuration and
calibration fields, the switch and port states, and the pump selectors. Stored so
the record is complete and so a station's file round-trips, but not interpreted.
Storing them costs almost nothing in the long-format observations table and means
a future product does not need a re-ingest of historical files.

### Preventing the two tables from drifting apart

Two alias tables in two languages will diverge, and the divergence will be
discovered by a customer rather than by us.

Rejected: generating the Python table from the TypeScript at build time. It adds a
build step to a container that deliberately has none, and it would make the
forecast unable to start if the main repo moved.

Rejected: a shared JSON file read by both. Cleaner, but it changes the main
Stratus server, which is out of scope for this feature and carries its own
deployment risk.

**Chosen: duplicate the table, and add a parity test that reads
`server/parsers/campbellScientific.ts`, extracts its `fieldMappings`, and asserts
that every canonical field and every alias is recognized by
`forecast/app/ingest.py`.** The test fails loudly the moment either side gains a
field. It costs nothing at runtime, keeps the forecast independently deployable,
and puts the drift check where drift is introduced. The parity test is a
first-class acceptance criterion, not a nicety.

### Consequences for existing properties

- **P13 Frost typing honesty** becomes reachable. Stations with the 8 m sensor get
  a real radiative-or-advective determination; stations without still report
  undetermined.
- **P15 Graceful absence** now covers 76 fields rather than 14, and the "not
  available at this station" message must name the sensor, not the internal field.
- Two new properties are required, declared in the Correctness properties section
  above: P17 vocabulary parity, and P18 model validation against measurement.

### Implementation ordering effect

This moves to the front. The full vocabulary is a prerequisite for frost typing,
turbulence, soiling and the solar validation path, so it precedes `solar.py` in
the implementation order. It is also the cheapest item on the list: a table
extension plus a parity test, with no new physics.
