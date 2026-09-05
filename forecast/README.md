# Stratus Nano-Climate Forecast

A site-specific weather forecast for a single weather station, built from that
station's own measurement history and, optionally, a commercial model background.
It runs as its own service at
[forecast.stratusweather.co.za](https://forecast.stratusweather.co.za) and keeps
its own database, separate from the main Stratus server.

---

## Which forecast models does this use?

This question deserves a precise answer, because the honest one is narrower than
the marketing version.

**One provider is implemented: Xweather.** That is it. In the code,
`forecast/app/providers/registry.py` declares
`ALL_PROVIDER_NAMES = ("xweather",)` and `build_providers()` returns a single
`XweatherProvider`.

**Xweather is Vaisala's weather API.** So yes, Vaisala is involved, but
indirectly: this does not talk to Vaisala instruments or to a Vaisala on-premise
model. It calls Vaisala's commercial forecast API, which was called AerisWeather
before the rebrand. The old host (`api.aerisapi.com`) is still kept as a fallback
because a rebrand is exactly the kind of thing that retires a hostname without
much warning.

**About atmo.ai.** Vaisala acquired Atmo, Inc. in June 2026, so Atmo's AI
forecasting technology now sits inside Vaisala and therefore behind Xweather.
There is no separate atmo.ai adapter in this codebase and no direct call to it:
anything Atmo contributes arrives, if at all, inside the Xweather response. The
API does not tell the caller which model produced a given value, so this service
does not claim one. Saying "powered by Atmo" on a page here would be an
assumption, not a fact we can verify per reading.

Two further points that matter when reading the output:

- **Xweather is a fused product, not a raw single model.** It runs its own
  numerical prediction and blends several sources behind the API. So there is no
  meaningful answer to "is this GFS or ECMWF or WRF?" for the Xweather
  background: it is their blend.
- **The effective grid spacing is deliberately left blank.** Vaisala does not
  publish one for the point forecast, so the code stores `resolution_km = None`
  rather than printing a plausible-sounding number like "13 km" next to a real
  one. An invented figure on a page next to a measured one is worse than no
  figure.

### The default is your own station, not a model

This is the most important thing to understand about the system, and it is the
opposite of how most forecast products work.

By default a station is forecast **from its own history only**: no external model
is called at all. A model background is used for a station only when an operator
switches it on, and even then only for the specific variables they selected. That
opt-in is per station **and** per variable, for three reasons written into the
code:

- **Cost.** Every call spends the account's access budget (the developer tier is
  15,000 accesses a month across all services).
- **Trust.** A model background helps temperature and pressure a great deal,
  helps wind less, and at a sheltered site can actively make wind worse. All or
  nothing would push someone to switch the whole thing off because one variable
  looked wrong.
- **Honesty.** The page states which variables are model-backed. That statement
  only means something if it can differ per variable.

So if the page says a variable is not model-backed, that is not a fault. It means
the forecast for that variable is derived purely from what your sensor has
actually recorded at that spot.

---

## How to read the forecast

### The forecast line and its spread

Each variable is shown as a line into the future with a shaded band around it.

- **The line** is the single best estimate.
- **The band** is the uncertainty. A narrow band means the recent record for this
  hour of the day has been consistent, so the forecast is confident. A wide band
  means the site has been variable and the number should be treated loosely.

Read the band, not just the line. A temperature of 24 degrees with a band of plus
or minus 1 is a usable number. The same 24 with a band of plus or minus 7 is
telling you it does not really know.

### Horizons

Forecasts are produced for several horizons (how far ahead they reach). A shorter
horizon is almost always better, because the station's recent behavior is a
stronger clue about the next few hours than about next week. If a short-horizon
and a long-horizon forecast disagree about tomorrow, trust the shorter one.

### Station pressure, not sea level

Pressure is reported as **station pressure**: what the barometer at the site
actually measures. At 1350 m that reads roughly 143 hPa lower than the sea-level
figure an airport or a phone app would quote. This is deliberate and consistent
across Stratus, so a measurement and a forecast can be compared directly. It is
not a broken barometer.

### Wind is in km/h

Campbell loggers almost always record wind in m/s and the engine works in km/h,
so the ingest converts it. If a wind figure ever looks like it is out by a factor
of 3.6, that conversion is the first place to look.

---

## How to read the accuracy numbers

The forecast scores itself against what actually happened. This is the part worth
trusting most, because it is measured rather than claimed.

- **Skill** compares the forecast against a naive baseline (roughly: "tomorrow
  will be like today"). Above zero means the forecast is beating that baseline.
  Near zero means it is not adding anything yet, usually because the station does
  not have much history. Skill is shown as a small bar so it can be read at a
  glance.
- **Error over time** shows how wrong the forecast has been at each lead time.
  It should grow with distance into the future. If it does not, be suspicious.
- **The reliability diagram** answers "when it says 70% chance, does it rain 70%
  of the time?" Points on the diagonal mean the probabilities are honest. Points
  below the line mean it is overconfident.
- **The rank histogram** checks whether the uncertainty band is the right width.
  Flat is good. A U shape means the band is too narrow (reality keeps falling
  outside it). A hump in the middle means the band is too wide.

A new station will have poor scores for a while. That is expected: it has nothing
to learn from yet.

---

## Sector products

If a station is configured for one, extra pages translate the raw forecast into a
specific decision:

- **Solar.** Plane-of-array irradiance for the configured tilt and azimuth,
  clear-sky comparison, and soiling.
- **Wind.** Wind at hub height rather than sensor height, plus turbulence.
- **Agriculture.** Evapotranspiration, growing degree days, frost risk, and
  spray windows.
- **Agrivoltaics.** The tradeoff between panel shading and crop light, including
  the daily light integral against a crop's requirement.

These are all recomputed on demand from the stored forecast and the site
configuration, so a sector page can never disagree with the forecast it came
from.

---

## Honest limitations

- A forecast for a site with a short record is weak, and the skill number will
  say so.
- Rainfall is the hardest variable and the least reliable, everywhere, always.
- The model background is a point forecast interpolated to the site. It does not
  know about a hill or a building 50 m away. Correcting for that is exactly what
  the station history contributes.
- Timestamps are the logger's local standard time and do not shift for daylight
  saving, because a logger does not.

---

## Running it

```bash
cd forecast
pip install -r requirements.txt
pytest tests -q                 # 428 tests
uvicorn app.main:app --reload
```

Deployment is a container behind the shared Traefik proxy, with a 320 MB memory
limit. Logger files are ingested by streaming them to disk and parsing line by
line, so a multi-year export never has to fit in memory.
