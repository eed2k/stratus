# Stratus demo data

Two Campbell Scientific TOA5 files for demonstrating a dashboard to a client,
plus the generator that produced them.

| File | What it is |
|------|-----------|
| `potchefstroom_full_demo.dat` | Complete station: 30 measured channels, every parameter the dashboard can display, including AS3935 lightning |
| `as3935_lightning_demo.dat` | Lightning only: `Lightning_Tot`, `LightningDist`, `LightningEnergy` |
| `generate_potchefstroom_demo.py` | Regenerates both files |
| `verify_demo.ts` | Validates both files through the real Stratus parser |
| `verify_report_site_line.ts` | Checks the latitude/longitude/altitude line added to reports |

## Site

Potchefstroom, North West, South Africa.

| | |
|---|---|
| Latitude | `-26.7145` |
| Longitude | `27.0977` |
| Altitude | `1350` m AMSL |

Set these three values on the station record before importing. Reference ETo is
a function of latitude and altitude, and the new site line on the report reads
the same three columns, so both stay blank until they are filled in.

At 1350 m the station barometric pressure sits near **861 hPa**, not sea-level
1013 hPa. That is correct for the altitude, not a calibration fault.

## Importing

1. Create the station and set its latitude, longitude and altitude.
2. Open the station, then **Data Import** in the sidebar.
3. Upload the `.dat` file and wait for the record count to confirm.
4. Set the dashboard date range to **7 days** or wider. The record ends at the
   time the file was generated and runs 14 days back.

## What is in the full file

Both files are 14 days at a 10-minute interval, 2016 records each.

Temperature, humidity, dew point, barometric pressure, wind speed / gust / min /
direction / direction standard deviation, solar radiation, solar energy total,
UV index, rainfall, soil temperature, soil moisture, visibility, PM2.5, PM10,
lightning strikes / distance / intensity, battery voltage, panel temperature,
and MPPT charger panel voltage / current / power, battery voltage, load voltage /
current and board temperature.

Roughly 28 mm of rain across 4 thunderstorm days, 430 lightning strikes, closest
strike 5 km, peak intensity about 1.92 million.

## Data conventions

These match what the Stratus back end expects. Changing them will produce wrong
totals.

- **`Lightning_Tot` is a cumulative counter.** The report counts strikes as the
  sum of positive differences between consecutive readings, so a per-interval
  count would be read incorrectly.
- **`Rain_mm_Tot` is a per-interval increment.** The back end sums increments
  when the maximum is 50 or less, and switches to differences above that.
- **`LightningDist` and `LightningEnergy` are `NAN` when no strike occurred.**
  The distance and intensity statistics ignore values of zero or below, so `NAN`
  keeps the averages honest instead of dragging them toward zero.

## AS3935 limits reproduced here

The AS3935 cannot report an arbitrary distance. It returns one of 14 steps:

```
1, 5, 6, 8, 10, 12, 14, 17, 20, 24, 27, 31, 34, 37, 40 km   (+/- 4 km rated)
```

Energy is a **21-bit relative, dimensionless** value from 0 to 2,097,151. It is
not joules and not watts, and it cannot be compared between two different
installations. Higher means a stronger received signal.

## Two things to be aware of

**Season.** The timestamps land in August, which on the Highveld is late winter:
normally cold and dry with no thunderstorms. The file deliberately models a warm,
wet, convective spell so that the rainfall and lightning cards populate for the
demonstration. Temperatures run about 5 to 29 degC. The solar peak of roughly
700 W/m2 *is* correct for the season and latitude, and is lower than a summer
peak for that reason.

**Lightning on the 7-day-and-wider chart.** The daily aggregation in the
dashboard sums the lightning channel, but that channel is a cumulative counter,
so the daily "Lightning Strikes" bars read far too high on ranges of 7 days and
above. This is existing dashboard behavior rather than something the demo data
introduces. The report total, the current-conditions strike count, and the
shorter chart ranges are all correct.

## Regenerating

```bash
python generate_potchefstroom_demo.py --days 14 --interval 10
```

`--days` accepts 7 or more. `--seed` makes the output reproducible.

Then validate against the real parser:

```bash
npx tsx demo/verify_demo.ts
```
