# Requirements Document

## Introduction

The nano-climate forecast service at `forecast/`, live at
https://forecast.stratusweather.co.za, forecasts nine weather variables 1, 3 and
5 days ahead from a station's own uploaded Campbell logger record. It works, it is
verified against persistence and climatology, and it is currently a general
weather forecast.

This feature adds the layer that turns those variables into the specific
quantities four markets buy, and the verification needed to demonstrate the
forecasts are improving rather than merely running.

The four markets and the question each one actually asks:

| Market | The question | The answering quantity |
|---|---|---|
| Renewable energy | What will this plant earn, and what will a bank lend against it | Plane-of-array irradiance, hub-height wind, P50 and P90 yield |
| Research | Can I reproduce and cite this | Versioned method, calibrated ensemble, CRPS |
| Agriculture | Do I act tonight | Frost probability, and whether frost fans will help |
| Agrivoltaics | Tilt for power or tilt for the crop | kWh sacrificed against crop light gained |

Nothing in this feature changes how the forecast is produced. The blend, the
analog search and the climatology fit are untouched. Every module here consumes
forecast output.

Two findings during design shaped the scope:

- **The forecast ingest reads 14 canonical logger fields; the main Stratus server
  reads 76.** Sixty-two fields the main product understands are silently dropped
  here, including the two temperature heights that frost typing needs, the wind
  standard deviation that turbulence intensity needs, and the particulate
  channels the soiling model needs.
- **Some stations already measure module temperature and DC power** through
  `moduleTemperature` and the MPPT channels. That is ground truth for the solar
  chain, so the cell-temperature and transposition models can be validated
  against measurement instead of trusted on citation alone. This was invisible
  while those columns were being discarded.

## Constraints

These are properties of the deployed environment, not preferences, and every
requirement below is subject to them.

1. **Pure Python standard library.** No numpy, pandas, scipy or pvlib. The
   container is capped at 320 MB on a 951 MB VPS that also runs the alert panel,
   the main Stratus app, Postgres, Traefik and two static sites.
2. **Server-rendered charts.** Inline SVG through `charts.py`. No client-side
   charting library, and every page must render with scripting disabled.
3. **No demo or sample data anywhere.** Test fixtures are generated in
   `conftest.py`. An empty station list is a first-class state.
4. **Additive schema changes only.** SQLite can add nullable or defaulted columns
   only, so a fresh database and an upgraded one must end up identical.
5. **American English, no em dashes or en dashes.** Enforced by
   `backups/_style_verify.py` across the repository.
6. **The forecast engine is out of scope.** If verification reveals a calibration
   problem, fixing it is separate work informed by these measurements.
7. **No soil water balance.** Excluded at the operator's instruction. Crop water
   demand stops at ETc.

## Shared conventions

Each of these is a place where a plausible implementation is silently wrong. They
are stated once here and apply to every requirement.

1. **Units are fixed**: temperature degrees Celsius, humidity percent, pressure
   hPa and station pressure never sea-level reduced, wind km/h, irradiance W/m2,
   rainfall mm, angles degrees. Conversion happens only at an ingest boundary.
2. **Azimuth is degrees clockwise from true north**: 0 north, 90 east, 180 south,
   270 west, matching the existing wind-direction convention.
3. **The southern hemisphere inverts the array.** A fixed photovoltaic array
   below the equator faces north, surface azimuth 0, not 180. Orientation is
   derived from the sign of the latitude, never hand-entered.
4. **P90 is pessimistic**: the value exceeded in 90 percent of cases, which is
   the 10th percentile.
5. **Timestamps are naive local standard time.** `Station.utc_offset_hours`
   defaults to 2.0 for SAST. Model data arrives aware in UTC and is converted at
   the provider boundary.
6. **Wind power is cubed before it is averaged.**
7. **Circular variables use vector arithmetic**, never linear.
8. **Failure is a return value.** Public functions return None or a None-filled
   structure rather than raising.
9. **Every formula names its reference** in its docstring.

## Glossary

- **GHI, DNI, DHI**: global horizontal, direct normal and diffuse horizontal
  irradiance, W/m2.
- **POA**: plane-of-array irradiance, what actually lands on a tilted module.
- **kt**: clearness index, measured GHI over extraterrestrial horizontal
  irradiance.
- **IAM**: incidence angle modifier, reflection loss off module glass.
- **GCR**: ground cover ratio, module area over land area.
- **AEP**: annual energy production.
- **P50 / P90**: values exceeded in 50 and 90 percent of cases. P90 is
  pessimistic.
- **TI**: turbulence intensity, wind standard deviation over mean wind.
- **PAR**: photosynthetically active radiation, 400 to 700 nm.
- **DLI**: daily light integral, mol/m2/day, the crop light metric.
- **ET0 / ETc**: reference and crop evapotranspiration, mm/day.
- **LWD**: leaf wetness duration, hours.
- **THI**: temperature humidity index, livestock heat load.
- **CRPS**: continuous ranked probability score, the proper scoring rule for an
  ensemble.
- **Rank histogram**: diagnostic of whether ensemble spread is honest.
- **Radiative frost**: forms under clear calm skies with a surface inversion;
  frost fans help. **Advective frost**: a cold air mass moving through with no
  inversion; fans achieve nothing.
- **Ensemble member**: one analog day's trajectory, stored per forecast point.

## Requirements

### Requirement 1: Full parameter vocabulary parity with Stratus

**User Story:** As an operator who already runs Stratus, I want the forecast to
understand every logger column Stratus understands, so that one export behaves
the same in both products and I am never left guessing whether a missing variable
means a missing sensor or an unrecognized column name.

Design properties: P15, P17.

#### Acceptance Criteria

1. WHEN a logger file is ingested THEN the system SHALL recognize every canonical
   field and every column alias recognized by
   `server/parsers/campbellScientific.ts`.
1a. WHERE Stratus maps one alias to two canonical fields THEN the forecast SHALL
   resolve it the same way Stratus does, and the parity test SHALL accept either
   documented owner. There is exactly one such case,
   `SolarCharger_BatteryVoltage_2_Avg`, claimed by both `batteryVoltage2` and
   `mppt2BatteryVoltage`. Diverging here would break the parity this requirement
   exists to guarantee, so the ambiguity is mirrored rather than fixed, and fixing
   it properly belongs in the Stratus parser.
2. WHEN the test suite runs THEN a parity test SHALL read the `fieldMappings`
   block from `server/parsers/campbellScientific.ts` and SHALL fail if any
   canonical field or alias is not recognized by `forecast/app/ingest.py`.
3. WHERE a recognized field is one of the nine engine variables THEN it SHALL be
   forecast and verified exactly as today, with no change to
   `engine.VARIABLE_RULES`.
4. WHERE a recognized field is a product input but not an engine variable THEN it
   SHALL be stored as an observation and SHALL be available to the sector
   modules. The product inputs are exactly: `temperature8m`, `deltaTemperature`,
   `windDirStdDev`, `windSpeedMin`, `moduleTemperature`, `panelTemperature`,
   `mpptSolarPower`, `mppt2SolarPower`, `pm25`, `pm10`, `particulateCount`,
   `solarMJTotal`, and `rainfall` which is already present.
5. WHERE a recognized field is neither THEN it SHALL still be stored so the
   record is complete and a future product needs no re-ingest. This covers the
   remaining fields, dominated by the MPPT configuration and calibration
   channels, the switch and port states, and the pump selectors.
5a. WHEN the tier of a field is decided THEN the boundary SHALL be that a field is
   a product input when a product reads it as a physical quantity of the site. A
   calibration slope or a charger state code is not a physical quantity.
6. WHEN a column is not recognized THEN it SHALL be reported in
   `IngestReport.unmapped_columns` as it is today.
7. WHEN the ingest report is shown THEN it SHALL distinguish a field the station
   does not measure from a field the forecast cannot interpret.
8. WHEN a unit conversion is applied THEN it SHALL be driven by the units row
   first and the column name only as a fallback, preserving existing behavior.

### Requirement 2: Solar irradiance decomposition and plane-of-array

**User Story:** As a solar developer, I want plane-of-array irradiance rather than
global horizontal, so that the figures refer to what my modules actually receive
and I can compare them against a yield model.

Design properties: P1, P2, P3, P4, P15.

#### Acceptance Criteria

1. WHEN a timestamp, latitude, longitude and UTC offset are supplied THEN the
   system SHALL compute solar elevation, azimuth, zenith, declination, hour angle
   and air mass.
2. WHEN solar azimuth is reported THEN it SHALL be degrees clockwise from true
   north in the range 0 to 360.
3. WHEN measured GHI and a solar position are supplied THEN the system SHALL
   decompose GHI into DNI and DHI using the Erbs et al. (1982) diffuse fraction.
4. WHEN decomposition completes for a daylight hour THEN DHI plus the horizontal
   projection of DNI SHALL equal GHI within a stated tolerance.
5. WHEN the sun is below the horizon THEN every irradiance quantity SHALL be zero
   rather than None.
6. WHEN solar elevation is below three degrees THEN the system SHALL attribute
   all irradiance to diffuse rather than report a diverging beam component.
7. WHEN a surface tilt and azimuth are supplied THEN the system SHALL transpose to
   plane-of-array using Hay and Davies (1980), keeping the beam, diffuse and
   ground-reflected components separately available.
8. WHEN tilt is zero THEN plane-of-array irradiance SHALL equal GHI.
9. WHEN plane-of-array irradiance is computed THEN it SHALL never exceed
   extraterrestrial normal irradiance.
10. WHEN the beam strikes the plane THEN an ASHRAE incidence angle modifier SHALL
    be applied.
11. WHEN a ground albedo is needed THEN it SHALL be selected from a named surface
    table with a documented default.
12. WHEN an optimal fixed orientation is requested THEN the surface azimuth SHALL
    be derived from the sign of the latitude, giving 0 for a southern site.
13. WHEN a clear-sky reference is needed AND a provider clear-sky value is
    available for that hour THEN it SHALL be preferred, and Haurwitz (1945) SHALL
    be the fallback.
13a. WHERE a provider clear-sky value is fetched THEN it SHALL be persisted keyed
    by station and valid time, because the provider carries it in
    `NwpPoint.extras` which `forecast_points` does not store, so it would
    otherwise be unavailable when a historical solar view is rendered.
13b. WHEN a clear-sky value is presented THEN the output SHALL state whether it
    came from the provider or from Haurwitz, since the two differ in accuracy.
14. WHEN single-axis tracking is configured THEN the system SHALL compute the
    tracker angle including backtracking limited by ground cover ratio.
15. IF a station reports no solar radiation THEN every solar quantity SHALL be
    None and no page SHALL raise.

### Requirement 3: Photovoltaic yield and validation against measurement

**User Story:** As a solar developer, I want modeled module temperature and DC
yield checked against what the plant actually measured, so that I can trust the
model at sites without instrumentation.

Design properties: P3, P15, P18.

#### Acceptance Criteria

1. WHEN plane-of-array irradiance, air temperature and wind speed are supplied
   THEN the system SHALL compute module temperature using Faiman (2008).
2. WHEN module temperature is known THEN DC yield SHALL be derated from standard
   test conditions using a configurable power temperature coefficient defaulting
   to -0.0035 per degree Celsius.
3. WHEN air density is needed by the yield chain THEN it SHALL come from
   `thermo.air_density` using station pressure.
4. WHERE a station reports `moduleTemperature` THEN the system SHALL compute
   modeled module temperature from OBSERVED irradiance, temperature and wind for
   past hours, SHALL score it against the measured value, and SHALL report the
   residual.
5. WHERE a station reports `mpptSolarPower` THEN the system SHALL compute modeled
   DC yield from observed inputs for past hours, SHALL score it against the
   measured value, and SHALL report the residual.
5a. WHEN model validation is performed THEN it SHALL be a hindcast driven by
   observed inputs, and SHALL be distinct from forecast verification. This
   separation is the point: it isolates PV model error from weather forecast
   error, so that a wrong solar page can be attributed to one or the other.
5b. WHEN model validation is performed THEN it SHALL NOT require modeled cell
   temperature or DC yield to become forecast variables, because the forecast
   engine is out of scope.
6. WHEN a validation residual is reported THEN it SHALL appear in its own section
   of the verification page, separate from the weather-variable scores, with its
   sample size and labeled as a model hindcast.
7. IF a station reports neither measured channel THEN the solar page SHALL state
   that the model is unvalidated at this site rather than implying it was checked.

### Requirement 4: Wind resource assessment

**User Story:** As a wind developer, I want hub-height wind statistics from a
mast measurement, so that I can estimate energy production and know how much of
the estimate rests on assumption.

Design properties: P5, P6, P7, P8, P14, P15.

#### Acceptance Criteria

1. WHEN a measurement height and a hub height are supplied THEN the system SHALL
   extrapolate wind speed using a power law.
2. WHERE a station reports wind at two heights THEN the shear exponent SHALL be
   measured from the data and labeled as measured.
3. WHERE only one height exists THEN a documented surface-roughness default SHALL
   be used and labeled as assumed.
4. WHEN an extrapolated wind speed is presented THEN the output SHALL state
   whether the shear exponent was measured or assumed.
5. WHEN wind power density is computed THEN it SHALL use
   `thermo.mean_wind_power_density` so that the cube-then-average order and the
   air density correction are both inherited.
6. WHEN a series of varying wind speeds is supplied THEN mean wind power density
   SHALL exceed the power density computed from the mean speed.
7. WHEN air density falls at fixed wind speed THEN wind power density SHALL fall.
8. WHEN a wind series is supplied THEN the system SHALL fit Weibull shape and
   scale parameters by the method of moments.
9. WHEN direction data exists THEN Weibull parameters and energy contribution
   SHALL be computed per direction sector, defaulting to 12 sectors.
10. WHEN a power curve is supplied THEN the system SHALL compute annual energy
    production with P50 and P90 taken from the ensemble.
11. WHEN wind speed and gust are both available THEN the system SHALL compute a
    gust factor as gust over mean speed, and SHALL label it a gust factor and not
    turbulence intensity.
11a. WHERE a station reports a wind SPEED standard deviation THEN the system SHALL
    compute turbulence intensity as sigma_u over mean u and SHALL report the
    resulting IEC 61400-1 class.
11b. WHERE no wind speed standard deviation exists THEN turbulence intensity and
    the IEC class SHALL be reported as not available, and the gust factor SHALL be
    shown instead. The Stratus vocabulary carries `windDirStdDev`, which is
    direction scatter and a different quantity, so calling it turbulence intensity
    would be a mislabeling.
12. WHEN sufficient history exists THEN the system SHALL estimate the 50-year
    extreme wind by Gumbel fit and SHALL state the record length it used.
13. WHEN any direction-valued output is produced THEN it SHALL lie in 0 to 360
    and SHALL be computed with vector arithmetic.
14. IF a station reports no wind data THEN every wind quantity SHALL be None and
    no page SHALL raise.

### Requirement 5: Agricultural products, extended

**User Story:** As a grower, I want to know not just whether frost is coming but
whether my frost fans will do anything about it, so that I do not spend a night
running equipment that cannot help.

Design properties: P13, P15.

#### Acceptance Criteria

1. WHEN a crop and a planting date are configured THEN the system SHALL compute
   ETc as ET0 multiplied by a crop coefficient from a documented crop calendar.
2. WHEN ETc is presented THEN the system SHALL NOT present an irrigation
   recommendation, because the soil water balance is out of scope.
3. WHEN humidity, dew point and rainfall are available THEN the system SHALL
   derive leaf wetness duration in hours, with a drying allowance driven by vapor
   pressure deficit and wind.
4. WHEN leaf wetness duration is presented THEN it SHALL be labeled as derived
   rather than measured.
5. WHEN leaf wetness duration and temperature are available THEN the system SHALL
   evaluate published disease risk models for Fusarium head blight on small
   grains, grape downy mildew and botrytis, citrus black spot, and potato late
   blight.
6. WHEN a disease risk is reported THEN it SHALL name the model and show the
   inputs that produced the risk level.
7. WHEN a frost type is reported THEN it SHALL carry a basis of `inversion`,
   `wind_proxy` or `undetermined`, so that a determination from measurement is
   never presented with the same confidence as an inference.
7a. WHERE a station reports temperature at two heights THEN the system SHALL
   compute inversion strength, SHALL classify frost as radiative or advective, and
   SHALL set the basis to `inversion`.
7b. WHERE only one temperature height exists but wind data does THEN the system MAY
   infer a type from wind speed and SHALL set the basis to `wind_proxy`. Mixing
   genuinely does suppress surface decoupling, so wind is a real physical proxy and
   discarding it would lose information; it is simply not a measurement of
   inversion strength.
7c. IF neither two heights nor wind data exist THEN the basis SHALL be
   `undetermined` and no type SHALL be reported.
8. WHEN the basis is `inversion` AND the type is radiative THEN the output SHALL
   state that mixing warmer air down is expected to help.
9. WHEN the basis is `inversion` AND the type is advective THEN the output SHALL
   state that frost fans are not expected to help.
10. WHEN the basis is `wind_proxy` THEN the output SHALL NOT state whether frost
    fans will help, because that is the claim that costs money and it requires a
    measured inversion.
10a. WHEN a frost probability is presented THEN exactly one number SHALL be shown,
    and it SHALL be the empirical ensemble probability from
    `probabilistic.frost_risk`, because that is the one a reliability diagram can
    verify.
10b. WHEN the heuristic frost assessment is used THEN it SHALL contribute the risk
    band, the reasoning, the timing and the type only, and its internal score
    SHALL NOT be rendered as a probability. Two differently derived percentages for
    the same night on the same page cannot be reconciled by a reader.
11. WHEN chill accumulation is presented THEN the system SHALL report chill
    portions from the Dynamic model, Utah chill units, and the existing chill
    hours together.
12. WHEN chill hours is presented THEN the output SHALL note that it
    underestimates accumulation in warm winters.
13. WHEN a livestock type is configured THEN the system SHALL compute the
    temperature humidity index with thresholds appropriate to that species.
14. WHERE two temperature heights exist THEN the system SHALL detect a surface
    inversion and SHALL flag elevated spray drift hazard independently of the
    existing delta-T guidance.

### Requirement 6: PAR, daily light integral and the agrivoltaic tradeoff

**User Story:** As an agrivoltaic operator, I want to see what tilting for the
crop costs me in kWh and gains me in crop light and water, so that I can choose
rather than guess.

Design properties: P1, P3, P4, P15.

#### Acceptance Criteria

1. WHEN GHI is available THEN the system SHALL convert it to photosynthetically
   active radiation using a documented conversion factor.
2. WHEN PAR is available over a day THEN the system SHALL integrate it to a daily
   light integral in mol/m2/day.
3. WHEN array geometry is configured THEN the system SHALL compute the fraction of
   PAR reaching the crop, accounting for row pitch, module dimensions, tilt,
   tracking mode and ground cover ratio.
4. WHEN a shading fraction is known THEN the system SHALL report daily light
   integral under the array and in the open, and the difference.
5. WHEN the tracker tradeoff is evaluated for an hour THEN the system SHALL
   compute both branches: an energy branch giving plane-of-array irradiance and
   DC yield, and a crop branch giving transmitted PAR, accumulated DLI,
   evapotranspiration avoided and heat-stress hours avoided.
6. WHEN the tradeoff is presented THEN the unweighted quantities SHALL always be
   shown, so the exchange rate is visible rather than hidden inside a single
   recommendation.
7. WHERE a weighting between energy and crop benefit is supplied THEN a preferred
   schedule MAY be presented, but it SHALL be shown alongside the unweighted
   quantities.
8. WHEN microclimate under the array is presented THEN the system SHALL report
   reduced evapotranspiration derived by applying the shading fraction to ET0,
   and SHALL report a water-use-efficiency figure.
9. WHEN bifacial gain is presented THEN it SHALL use the albedo table and SHALL
   state that crop albedo changes through the growth stage.
10. IF array geometry is not configured THEN agrivoltaic quantities SHALL be None
    and the page SHALL invite configuration rather than showing zeros.

### Requirement 7: Ensemble verification that shows whether the forecast improves

**User Story:** As a researcher and as the operator, I want proper ensemble
scoring, so that I can tell whether a change to the method actually improved the
forecast and whether the confidence bands can be trusted.

Design properties: P8, P9, P10, P11, P12, P16.

#### Acceptance Criteria

1. WHEN scored pairs exist THEN the system SHALL compute the continuous ranked
   probability score empirically from the stored ensemble members.
2. WHEN CRPS is computed for a single-member ensemble THEN it SHALL equal the
   absolute error.
3. WHEN CRPS is presented THEN it SHALL appear alongside the existing mean
   absolute error, bias, RMSE and skill scores.
4. WHEN scored pairs exist THEN the system SHALL produce a rank histogram of where
   each observation fell within its ensemble.
5. WHEN a rank histogram is produced THEN the rank counts SHALL sum to the number
   of scored pairs.
6. WHEN a rank histogram is presented THEN the page SHALL explain that a flat
   histogram means honest spread, a U shape means spread that is too narrow, and a
   dome means spread that is too wide.
7. WHEN a threshold event is scored THEN the system SHALL produce a reliability
   diagram binning forecast probability against observed frequency.
8. WHEN a perfectly calibrated synthetic set is scored THEN observed frequency
   SHALL equal forecast probability in every populated bin.
9. WHEN a threshold event is scored THEN the system SHALL compute the Brier score
   and SHALL decompose it into reliability, resolution and uncertainty.
10. WHEN a threshold event is scored THEN the system SHALL compute a ROC curve so
    a user can choose an action threshold from hit rate against false alarm rate.
11. WHEN a forecast run is issued THEN the system SHALL store a method version
    derived from the engine constants and blend weights.
12. WHEN engine constants are unchanged THEN the method version SHALL be
    unchanged, and WHEN a blend weight changes THEN the method version SHALL
    change.
13. WHEN verification results are presented THEN they SHALL be grouped by method
    version so a method change appears as a step rather than being smeared across
    the record.
14. WHEN any score is presented THEN its sample size SHALL be shown next to it.
15. WHEN a score is computed from fewer pairs than a stated minimum THEN it SHALL
    be marked as provisional.

### Requirement 8: Sector configuration and presentation

**User Story:** As an operator, I want to switch on only the sectors that apply to
a site and see each one on its own page, so that a livestock farm is not shown
photovoltaic tracking and a solar plant is not shown chill portions.

Design properties: P15.

#### Acceptance Criteria

1. WHEN a station is configured THEN the operator SHALL be able to enable any
   combination of the solar, wind, agriculture and agrivoltaics sectors.
2. WHEN no sector is enabled THEN the station page SHALL show the existing
   forecast and verification views unchanged.
3. WHEN a sector is enabled THEN a page for that sector SHALL be reachable from
   the station page.
4. WHEN sector configuration is saved THEN it SHALL be validated and SHALL reject
   values outside physical ranges.
5. WHEN a sector page is rendered THEN it SHALL render with scripting disabled.
6. WHEN a chart cannot be drawn because a station lacks the sensor THEN the page
   SHALL degrade to a table or a stated absence, and SHALL name the missing
   sensor rather than an internal field name.
7. WHEN a sector quantity is derived THEN it SHALL be computed on demand from
   stored forecast points and configuration rather than cached, so it cannot
   disagree with the forecast it came from.
8. WHEN the method version is stored THEN it SHALL be the only sector-related
   value captured at issue time, because it describes code that cannot be
   recovered later.
9. WHEN a schema change is applied THEN it SHALL be additive only, and a fresh
   database SHALL end up identical to an upgraded one.

### Requirement 9: Test fixtures for the new sensor channels

**User Story:** As a developer, I want the synthetic logger fixture to emit the
channels the new products consume, so that the products can be tested at all
without shipping sample data.

Design properties: P15, P17.

#### Acceptance Criteria

1. WHEN the test fixture generates a logger file THEN it SHALL be able to emit
   `temperature8m` and `deltaTemperature` so frost typing by inversion can be
   tested.
2. WHEN the test fixture generates a logger file THEN it SHALL be able to emit
   `moduleTemperature` and `mpptSolarPower` so the solar model validation hindcast
   can be tested.
3. WHEN the test fixture generates a logger file THEN it SHALL be able to emit
   `pm25` and `pm10` so soiling work has an input.
4. WHEN the fixture emits a second temperature height THEN it SHALL be able to
   produce both a genuine nocturnal inversion and a well-mixed night, so that both
   frost types are reachable in tests.
5. WHEN the fixture emits optional channels THEN they SHALL be opt-in per call, so
   existing tests that assume the current column set keep passing unchanged.
6. WHEN fixtures are generated THEN they SHALL remain generated in `conftest.py`
   and SHALL NOT be committed as sample data files.
