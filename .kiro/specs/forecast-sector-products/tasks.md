# Implementation Plan

Derived from `design.md` and `requirements.md` in this directory, with the
findings in `prework.md` already folded into both. Read `prework.md` before
starting any task that touches frost, turbulence intensity, clear sky, or the
solar validation path, because each of those had a resolved conflict and the
resolution is not obvious from the code.

## How to work this plan

Every task is code, and every task ends green. The order is the dependency
order, not the market priority order, so a task never waits on a later one.

After each task:

```
cd forecast; python -m pytest tests -q -p no:cacheprovider
python .\backups\_style_verify.py
```

The style verifier must exit 0. It scans authored files for em dashes, British
and South African spellings, and stale phrasing. If it hangs, run
`Get-Process python | Stop-Process -Force` and run it again.

Do not deploy until task 10 passes. Deployment is the last step, not a step
after each module.

Rules that apply to every task, restated because they are the ones most easily
broken in passing:

- Pure Python standard library. No numpy, pandas, scipy, or pvlib.
- No demo data, no sample data, no seeded stations. Fixtures are generated in
  `conftest.py` and stay there.
- Schema changes are additive only, through the `wanted` dict in
  `Database._migrate`, and a fresh database must end up identical to an
  upgraded one.
- A missing sensor returns `None` or a `None`-filled structure. It never
  raises, and no page 500s because a station lacks a channel.
- Every formula carries its citation in the docstring.
- Southern hemisphere. A fixed array faces north, surface azimuth 0, derived
  from the sign of the latitude and never hard coded.

## Dependency graph

```
  1 vocabulary parity  ──┬─────────────┬──────────────┬────────────────┐
       (R1)              │             │              │                │
                         │             │              │                │
  2 test fixtures  ──────┴──┐          │              │                │
       (R9)                 │          │              │                │
                            v          v              v                v
                        3 solar.py   4 wind.py   5 products.py    7 verification
                           (R2)        (R4)      extensions (R5)   extensions (R7)
                            │           │              │                │
                            └─────┬─────┘              │                │
                                  │                    │                │
                                  v                    │                │
                            6 agrivoltaics.py <────────┘                │
                                 (R3, R6)                               │
                                     │                                  │
                                     └──────────┬───────────────────────┘
                                                v
                                    8 sector config and reports
                                                (R8)
                                                v
                                    9 charts and templates
                                                (R8)
                                                v
                                    10 full verification and deploy
```

`thermo.py` and `probabilistic.py` are already built and tested, so nothing
here waits on them. Task 3 and task 4 are independent of each other and can be
done in either order. Task 5 is independent of both. Task 6 is the only one
with two upstream dependencies, which is why it sits where it does.

---

- [ ] 1. Bring forecast ingest to full parameter parity with Stratus

  The prerequisite for four later tasks. Frost typing needs `temperature8m` and
  `deltaTemperature`, the gust factor work needs `windSpeedMin`, soiling needs
  the particulate channels, and the solar hindcast needs `moduleTemperature` and
  `mpptSolarPower`. None of them can be written, let alone tested, until ingest
  recognizes the columns. It is also the cheapest task in the plan: a table
  extension and a test, no new physics.

- [ ] 1.1 Extend the canonical field and alias tables in `forecast/app/ingest.py`
  - Port every canonical field and every column alias from
    `server/parsers/campbellScientific.ts`. The measured gap at the time of
    writing is 76 canonical fields in the parser against 14 in ingest, and 343
    alias strings of which 342 are unique.
  - Mirror the one duplicate, `SolarCharger_BatteryVoltage_2_Avg`, which Stratus
    maps to both `batteryVoltage2` and `mppt2BatteryVoltage`. Resolve it the way
    Stratus does. Do not fix it here. Diverging in the first field touched would
    defeat the parity this task exists to create, and the real fix belongs in the
    Stratus parser.
  - Keep the tier 1 forecast variables exactly as they are. This task adds
    recognition and storage, it does not add forecast variables.
  - _Requirements: R1.1, R1.1a, R1.2, R1.3_

- [ ] 1.2 Implement the three-tier storage split
  - Tier 1 stays the 9 engine variables, unchanged.
  - Tier 2 is exactly the 13 product inputs named in R1.4: `temperature8m`,
    `deltaTemperature`, `windDirStdDev`, `windSpeedMin`, `moduleTemperature`,
    `panelTemperature`, `mpptSolarPower`, `mppt2SolarPower`, `pm25`, `pm10`,
    `particulateCount`, `solarMJTotal`, and `rainfall` which already exists.
  - Tier 3 is everything else, stored so the record is complete and a future
    product needs no re-ingest.
  - Apply the boundary rule from R1.5a when a new field appears: a field is a
    product input when a product reads it as a physical quantity of the site. A
    calibration slope or a charger state code is not a physical quantity.
  - Keep unit conversion driven by the TOA5 units row first, with the column name
    only as a fallback, preserving existing behavior. Widening the vocabulary
    multiplies the number of columns whose units are guessed from the name, so
    this ordering matters more after this task than before it.
  - _Requirements: R1.4, R1.5, R1.5a, R1.6, R1.8_

- [ ] 1.3 Write the parity test in `forecast/tests/test_ingest.py`
  - The test reads `server/parsers/campbellScientific.ts` from disk, extracts the
    canonical fields and aliases, and asserts the forecast ingest recognizes
    every one. This is what stops the two from drifting apart unnoticed, and it
    is why the design chose a duplicated table plus a parity test over
    build-time codegen, which would add a build step to a deliberately
    build-free container, and over a shared JSON file, which would change the
    main Stratus server and is out of scope.
  - Accept either documented owner for the duplicate alias.
  - Skip with a clear message, rather than fail, if the parser file is absent,
    so the forecast test suite still runs standalone.
  - Assert an unknown column is ignored without raising.
  - _Requirements: R1.1, R1.1a, R1.2, R1.7_
  - _Properties: P17, P15_

- [ ] 2. Extend the test fixture to emit the new channels

  Written immediately after task 1 and before any product, because without it
  R3, R4.11a and R5.7a are untestable. `conftest.make_toa5` currently emits none
  of the channels the new products consume.

- [ ] 2.1 Add opt-in channel groups to `conftest.make_toa5`
  - Emit `temperature8m` and `deltaTemperature` on request.
  - Emit `moduleTemperature` and `mpptSolarPower` on request.
  - Emit `pm25` and `pm10` on request.
  - Every group is opt-in per call so existing tests that assume the current
    column set keep passing unchanged. This is the constraint that makes the
    task safe to do early.
  - _Requirements: R9.1, R9.2, R9.3, R9.5_

- [ ] 2.2 Make both frost regimes reachable
  - The fixture must be able to produce a genuine nocturnal inversion, where the
    8 m temperature exceeds the screen temperature overnight, and a well-mixed
    night where it does not.
  - Without both, only one branch of the frost typing in task 5 can ever be
    exercised, and the branch that stays untested is the one that tells a farmer
    whether to spend money on frost fans.
  - _Requirements: R9.4_

- [ ] 2.3 Confirm fixtures stay generated
  - No `.dat` or `.csv` sample file is added to the repository. Assert the
    fixture directory contains no committed data files.
  - _Requirements: R9.6_

- [ ] 3. Build `forecast/app/solar.py`

  First of the physics modules because nothing else depends on the sun's
  position and agrivoltaics cannot start without it. This file does not exist
  yet.

- [ ] 3.1 Solar position
  - Solar declination, equation of time, hour angle, solar zenith, solar
    elevation and solar azimuth, in naive local standard time with no daylight
    saving adjustment, using the station `utc_offset_hours`.
  - Azimuth measured clockwise from north.
  - Cite the source for each formula in the docstring.
  - _Requirements: R2.1, R2.2_

- [ ] 3.2 Clear-sky irradiance with stated provenance
  - Haurwitz (1945) as the fallback clear-sky model. It was chosen over Ineichen
    and Bird because those need Linke turbidity or aerosol optical depth, which a
    weather station cannot measure, so the result would be a climatological guess
    presented as a site-specific value.
  - Prefer a provider clear-sky value for the hour when one exists.
  - Report which source was used, because the two differ in accuracy.
  - _Requirements: R2.13, R2.13b_
  - _Properties: P20_

- [ ] 3.3 Persist the provider clear-sky series
  - Add a small table keyed by station and valid time, through the additive
    `wanted` dict pattern in `Database._migrate`.
  - Needed because the provider carries `solradClearSkyWM2` in
    `NwpPoint.extras`, which `forecast_points` does not store, so the value is
    gone by render time and a historical solar view would otherwise have to
    re-fetch and spend API budget.
  - _Requirements: R2.13a, R8.9_

- [ ] 3.4 Decompose GHI into DNI and DHI
  - Split measured or forecast global horizontal irradiance into direct normal
    and diffuse horizontal components. Cite the correlation used.
  - Test the closure property: DHI plus the horizontal projection of DNI equals
    GHI within tolerance for every daylight hour.
  - _Requirements: R2.3, R2.4_
  - _Properties: P2_

- [ ] 3.5 Handle night explicitly
  - With the sun below the horizon every irradiance quantity is zero, not
    `None`. Zero is a measurement. `None` means the sensor is absent, and
    conflating the two would make a working station look broken every night.
  - _Requirements: R2.5, R2.6_
  - _Properties: P4_

- [ ] 3.6 Transpose to plane of array
  - Hay-Davies transposition onto a tilted surface, with ground reflection.
  - Derive the default surface azimuth from the sign of the station latitude. A
    southern site yields 0, facing north.
  - Test that plane-of-array irradiance never exceeds extraterrestrial normal
    irradiance, and equals GHI exactly when tilt is zero.
  - _Requirements: R2.7, R2.8, R2.9, R2.10, R2.11, R2.12_
  - _Properties: P1, P3_

- [ ] 3.7 Return `None` for stations without a pyranometer
  - Every entry point returns `None` or a `None`-filled structure when
    irradiance or position data is missing.
  - _Requirements: R2.14, R2.15_
  - _Properties: P15_

- [ ] 3.8 Write `forecast/tests/test_solar.py`
  - Cover P1, P2, P3, P4 and P15 as explicit named tests, plus a solar noon
    sanity check against a known site and date.

- [ ] 4. Build `forecast/app/wind.py`

  Independent of solar. Depends only on `thermo.py`, which is built and has
  `wind_power_density`, `mean_wind_power_density`, `air_density` and
  `density_corrected_speed` already tested.

- [ ] 4.1 Wind shear with provenance
  - Extrapolate speed to hub height with the power law.
  - Compute the shear exponent from measurement when two heights exist, and flag
    it `measured`. Otherwise use an assumed exponent and flag it `assumed`.
  - Expect the assumed path to be the normal one. The Stratus vocabulary has
    `temperature8m` but no second wind height, so the measured branch will rarely
    fire. Write it anyway, keep it tested, and label the output honestly.
  - _Requirements: R4.1, R4.2, R4.3, R4.4_
  - _Properties: P7_

- [ ] 4.2 Wind power density, cubed before averaging
  - Mean power density is the mean of the cubes, never the cube of the mean.
    Test that a varying series yields more than its mean speed would.
  - Apply the air density correction from `thermo.py` and test that power density
    falls as density falls at fixed speed.
  - _Requirements: R4.5, R4.6, R4.7, R4.8, R4.9_
  - _Properties: P5, P6_

- [ ] 4.3 Gust factor, and turbulence intensity only when it is real
  - Always report the gust factor, gust over mean speed, and label it a gust
    factor.
  - Compute turbulence intensity and the IEC 61400-1 class only from a true wind
    speed standard deviation. Report both as not available otherwise.
  - Do not compute turbulence intensity from `windDirStdDev`. That field is
    direction scatter, a different quantity, and naming it turbulence intensity
    would be a mislabeling that an engineer would act on.
  - _Requirements: R4.11, R4.11a, R4.11b_
  - _Properties: P20_

- [ ] 4.4 Directional statistics with circular arithmetic
  - Wind rose and prevailing direction computed with vector arithmetic, never by
    averaging degrees. Any direction output lies in 0 to 360.
  - Test the wraparound case explicitly, where a naive mean of 350 and 10 gives
    180 instead of 0.
  - _Requirements: R4.12, R4.13_
  - _Properties: P14_

- [ ] 4.5 Exceedance levels for the wind resource
  - Use `probabilistic.exceedance_level`. P90 is the level exceeded 90 percent
    of the time, which is the 10th percentile, which is the pessimistic case.
  - Test that P90 is at or below P50, which is at or below P10.
  - _Requirements: R4.10_
  - _Properties: P8_

- [ ] 4.6 Return `None` for stations without an anemometer
  - _Requirements: R4.14_
  - _Properties: P15_

- [ ] 4.7 Write `forecast/tests/test_wind.py`
  - Cover P5, P6, P7, P8, P14, P15 and P20 as explicit named tests.

- [ ] 5. Extend `forecast/app/products.py` for agriculture

  Independent of tasks 3 and 4. The highest-value single item for the
  agricultural market, and the one with both prework conflicts in it, so read
  the frost sections of `prework.md` first.

- [ ] 5.1 Add the frost type basis field
  - `FrostAssessment` gains `frost_type_basis` with values `inversion`,
    `wind_proxy` or `undetermined`.
  - Set `inversion` when two temperature heights exist, and compute inversion
    strength from them.
  - Set `wind_proxy` when only wind data supports the inference. Keep the
    existing wind-based inference rather than deleting it. Mixing genuinely does
    suppress surface decoupling, so wind is a real physical signal, it is simply
    not a measurement of inversion strength.
  - Set `undetermined` and report no type when neither is available.
  - _Requirements: R5.7, R5.7a, R5.7b, R5.7c_
  - _Properties: P13_

- [ ] 5.2 Gate the frost fan recommendation on a measured inversion
  - Only a basis of `inversion` may state whether frost fans will help.
  - With basis `wind_proxy`, say nothing about frost fans. That recommendation
    costs a grower real money and it needs a measured inversion behind it.
  - _Requirements: R5.8, R5.9, R5.10_
  - _Properties: P13_

- [ ] 5.3 Collapse to one frost probability
  - Rename `FrostAssessment.probability` to `heuristic_score` and stop rendering
    it as a probability. Its own docstring already says it is not calibrated.
  - The single presented probability is the empirical ensemble figure from
    `probabilistic.frost_risk`, because that is the one a reliability diagram in
    task 7 can actually verify.
  - `assess_frost` keeps contributing the risk band, the reasoning, the timing
    and the type.
  - Update every existing caller and template that reads the old attribute.
  - _Requirements: R5.10a, R5.10b_
  - _Properties: P19, P9_

- [ ] 5.4 Build leaf wetness on the existing dew assessment
  - Extend `assess_dew`, which already computes `duration_hours` and
    `disease_pressure`, rather than adding a parallel leaf wetness function
    beside it.
  - Label a derived duration as derived, never as measured.
  - _Requirements: R5.3, R5.4, R5.5, R5.6_
  - _Properties: P20_

- [ ] 5.5 Add the chill models
  - Report chill portions from the Dynamic model and Utah chill units alongside
    the existing `chill_hours`, together rather than in isolation, since they
    disagree by design in warm winters.
  - _Requirements: R5.11, R5.12_

- [ ] 5.6 Complete the remaining agricultural criteria
  - Growing degree day and spray window extensions per R5.1, R5.2, R5.13 and
    R5.14, reusing `growing_degree_days` and `find_spray_windows`.
  - _Requirements: R5.1, R5.2, R5.13, R5.14_

- [ ] 5.7 Extend `forecast/tests/test_products.py`
  - Both frost bases, using the inversion and well-mixed fixtures from task 2.
  - Assert exactly one frost probability reaches the caller.
  - Assert no frost fan claim appears when the basis is `wind_proxy`.

- [ ] 6. Build `forecast/app/agrivoltaics.py`

  The only module with two upstream dependencies. Needs task 3 for irradiance
  and task 5 for evapotranspiration, which is why it sits here.

- [ ] 6.1 PAR and daily light integral
  - Convert plane-of-array and horizontal irradiance to photosynthetically
    active radiation and integrate to a daily light integral.
  - Cite the conversion factor and state it as an assumption, since it varies
    with sky condition.
  - _Requirements: R6.1, R6.2, R6.3, R6.4_
  - _Properties: P1, P4_

- [ ] 6.2 The shading tradeoff
  - Model light reaching the crop under a panel array, and the resulting
    tradeoff between panel yield and crop light.
  - _Requirements: R6.6, R6.7, R6.8_
  - _Properties: P3_

- [ ] 6.3 Evapotranspiration avoided
  - Compute it by calling `et0_penman_monteith` twice with different radiation
    inputs, once for the open field and once for the shaded crop.
  - Do not invent a shading factor applied to a single result. The physics
    already handles the radiation change, and a factor would be an unsourced
    fudge on top of a sourced model.
  - _Requirements: R6.5_

- [ ] 6.4 Photovoltaic yield and the cell temperature model
  - Faiman cell temperature and a DC yield model driven by plane-of-array
    irradiance, air temperature and wind speed.
  - Apply the air density correction where it belongs and cite every constant.
  - _Requirements: R3.1, R3.2, R3.3_
  - _Properties: P3, P6_

- [ ] 6.5 Return `None` without the required sensors
  - _Requirements: R6.9, R6.10, R3.7_
  - _Properties: P15_

- [ ] 6.6 Write `forecast/tests/test_agrivoltaics.py`
  - Cover P1, P3, P4 and P15, plus a test that evapotranspiration avoided is
    positive under shade and zero at zero shade.

- [ ] 7. Extend `forecast/app/verification.py` so improvement is measurable

  Sequenced after the products so the improvement loop measures a stable set.
  This is the task that answers the user's actual request, that the system
  evaluate itself against real data and improve.

- [ ] 7.1 Continuous ranked probability score
  - Compute CRPS from the stored ensemble members, which
    `forecast_points.members` already holds and `Database.decode_members`
    already decodes.
  - Test that CRPS equals the absolute error for a single-member ensemble. That
    reduction is the check that the implementation is right.
  - _Requirements: R7.1, R7.2, R7.3_
  - _Properties: P10_

- [ ] 7.2 Rank histogram with a stated tie-breaking rule
  - State the tie-breaking rule in the docstring and implement it explicitly.
  - Test that ranks sum to the number of scored pairs, and use distinct values
    in tests so they stay deterministic.
  - _Requirements: R7.4, R7.5, R7.6_
  - _Properties: P11_

- [ ] 7.3 Reliability diagram
  - Bin forecast probabilities against observed frequencies.
  - Test that a perfectly calibrated synthetic set puts observed frequency equal
    to forecast probability in every populated bin.
  - This is what makes the single frost probability from task 5.3 verifiable,
    and the reason the ensemble figure was chosen as authoritative.
  - _Requirements: R7.7, R7.8, R7.9, R7.10_
  - _Properties: P12_

- [ ] 7.4 Method version on every run
  - Add `method_version` to `forecast_runs` through the additive `wanted` dict.
  - Compute it by hashing an explicit tuple of named engine constants:
    `VARIABLE_RULES`, `ANALOG_WEIGHTS`, `ANALOG_TRAJECTORY_HOURS`,
    `NWP_MAX_WEIGHT`, `ANALOG_MAX_WEIGHT_WITH_NWP`,
    `ANALOG_MAX_WEIGHT_NO_NWP`, `DEFAULT_HISTORY_DAYS`,
    `MIN_HOURS_FOR_CLIMATOLOGY`, `MIN_HOURS_FOR_ANALOGS`.
  - Do not hash the source files. A comment change would invalidate every
    historical comparison, which would destroy the trend the version exists to
    protect.
  - Add a test that fails when a new module-level constant appears in
    `engine.py` without being considered for the tuple.
  - _Requirements: R7.11, R7.12, R7.13_
  - _Properties: P16_

- [ ] 7.5 Solar model validation as a hindcast
  - Compute modeled module temperature and DC yield from observed irradiance,
    temperature and wind for past hours, and score them against measured
    `moduleTemperature` and `mpptSolarPower`.
  - Keep this separate from forecast verification. The separation is the point.
    It isolates PV model error from weather forecast error, so a wrong solar page
    can be attributed to one or the other.
  - Do not make modeled cell temperature or DC yield forecast variables. The
    engine is out of scope, and `db.matched_pairs` joins on variable, which is
    why the hindcast framing was chosen instead.
  - _Requirements: R3.4, R3.5, R3.5a, R3.5b_
  - _Properties: P18_

- [ ] 7.6 Report the residuals in their own section
  - Present validation residuals with their sample size, labeled as a model
    hindcast, in a section separate from the weather-variable scores.
  - _Requirements: R3.6, R7.14, R7.15_

- [ ] 7.7 Extend `forecast/tests/test_verification.py`
  - Cover P10, P11, P12, P16 and P18 as explicit named tests.

- [ ] 8. Add sector configuration and the report layer

- [ ] 8.1 Create the `sector_config` table
  - Additive migration through the `wanted` dict pattern. Per-station sector
    selection and the parameters each sector needs, such as tilt, azimuth, hub
    height and crop.
  - Store nothing that can be recomputed.
  - _Requirements: R8.1, R8.2, R8.3, R8.9_

- [ ] 8.2 Build `forecast/app/sector_report.py`
  - Assemble a per-sector report from the modules built in tasks 3 to 7. This is
    the only module allowed to depend on all of them, which keeps the dependency
    graph one-way.
  - Each of the four markets gets the one question it asks answered first.
  - _Requirements: R8.4, R8.5_

- [ ] 8.3 Degrade cleanly for a station missing sensors
  - A sector page for a station without the sensors renders, states what is
    missing and why, and does not 500.
  - _Requirements: R8.6_
  - _Properties: P15_

- [ ] 9. Presentation, server rendered only

- [ ] 9.1 Extend `forecast/app/charts.py`
  - Inline SVG for the wind rose, the irradiance and plane-of-array day curve,
    the reliability diagram and the rank histogram, following the existing
    `series_chart` and `error_chart` conventions and the existing palette.
  - Add units and labels for every new quantity to `UNITS` and `LABELS`.
  - _Requirements: R8.7_

- [ ] 9.2 Add the sector templates and routes
  - Server-rendered, working with scripting off. No client-side charting
    library, consistent with the 320 MB container cap and the build-free
    container.
  - Add the routes to `main.py` alongside the existing FastAPI handlers.
  - Fingerprint any new static asset with `?v=<hash>` and keep `no-store` on
    pages. A bare asset URL with only an ETag was the root cause of an earlier
    round of changes appearing not to be live.
  - _Requirements: R8.7, R8.8_

- [ ] 9.3 Extend `forecast/tests/test_web.py`
  - Assert every new route returns 200 for a station with sensors and 200 with
    an explanation for a station without them.
  - Assert no page raises when a station has only the 9 base variables.

- [ ] 10. Full verification, then deploy

- [ ] 10.1 Run the whole suite and the style verifier
  - `cd forecast; python -m pytest tests -q -p no:cacheprovider` all green. The
    baseline before this plan was 265 passing.
  - `python .\backups\_style_verify.py` exits 0.
  - Confirm every one of P1 through P20 has at least one named test. Reuse
    `backups\_xcheck.py` to confirm the spec cross-references still hold if
    either spec file was touched during implementation.

- [ ] 10.2 Confirm the migration is genuinely additive
  - Build a fresh database and upgrade an old one, then compare schemas. They
    must be identical.
  - _Requirements: R8.9_

- [ ] 10.3 Deploy
  - `python .\deploy\deploy_forecast_site.py` with `DEPLOY_PW`,
    `FORECAST_PASSWORD` and the `XWEATHER_*` and `DROPBOX_*` values loaded from
    `.env` into the process environment.
  - Verify against the live site, not against the deploy script's exit code.
  - Leave the live site empty of stations. The operator creates real stations
    and feeds real logger files. No demo data.

---

## Out of scope, restated

Soil water balance is excluded at the user's explicit instruction. No task here
computes soil moisture, field capacity, or a water deficit.

No task changes the forecast engine. The engine's blend weights and variable
rules are read by task 7.4 to compute a version hash, never modified.

Security items are tracked in `SECURITY_ROADMAP.md` at the repository root, not
here. The forecast service currently has no CSRF protection and no security
headers, which is recorded there as items 9 through 12.
