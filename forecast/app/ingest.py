"""Read Campbell logger files and turn them into canonical observations.

THE FORMAT

  A TOA5 file has four header lines before any data:

    1  "TOA5","StationName","CR1000X","12345","OS","Program","Sig","TableName"
    2  "TIMESTAMP","RECORD","AirTC_Avg","RH","BP_mbar_Avg","WS_ms_Avg",...
    3  "TS","RN","Deg C","%","mbar","m/s",...
    4  "","","Avg","Smp","Avg","Avg",...
    5+ "2026-08-12 04:50:00","1","11.06","98.0","861.68","1.23",...

  Line 2 names the columns, line 3 gives their units and line 4 gives the
  aggregation the logger applied. All three matter: the name says what the
  quantity is, the unit says what scale it is on, and the aggregation is how we
  tell a mean wind from a gust when both are present.

WHY THIS IS DEFENSIVE

  Real logger files are not tidy. The header rows can disagree in length,
  because a program was edited and the table was not recreated: one file in
  this repository has 24 names and 32 units. Missing values arrive as the
  string "NAN". Timestamps may or may not have seconds. Station programmers
  rename columns freely, which is why the alias table below is long rather than
  clever.

  So the rule is: the names row is authoritative for how many columns there
  are, everything else is padded or truncated to match, and a row that cannot
  be understood is counted and skipped rather than allowed to abort the upload.
  Someone uploading a year of data should not lose the year because one line is
  malformed.

UNITS ARE CONVERTED HERE, NOWHERE ELSE

  The engine works in a single set of units (see providers/base.py). Loggers do
  not. Wind is almost always m/s in a Campbell file and the engine wants km/h,
  which is a factor of 3.6: getting it wrong turns a 15 km/h breeze into a
  54 km/h wind and every spray-window and frost product downstream is wrong.
  The conversion is driven by the units row, falling back to the column name.

PRESSURE IS STATION PRESSURE

  A Campbell barometer reports what it measures. At Potchefstroom that is about
  861 hPa, not the 1018 hPa a sea-level reduction would give. That is the
  correct thing to store, and it is the same convention the NWP adapters use,
  so a model background and an observation are directly comparable.
"""
from __future__ import annotations

import csv
import io
import math
import re
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field
from datetime import datetime

# Canonical names the engine blends. Kept in sync with engine.VARIABLE_RULES.
ENGINE_VARIABLES = (
    "temperature",
    "humidity",
    "dew_point",
    "pressure",
    "wind_speed",
    "wind_gust",
    "wind_direction",
    "solar_radiation",
    "rainfall",
)

# The rest of the parameter vocabulary is split into two further tiers.
#
# PRODUCT_VARIABLES (tier 2) are read by the sector products - frost typing, the
# photovoltaic model, soiling, turbulence - but are never blended by the engine.
# STORED_VARIABLES (tier 3) are kept so a station's record is complete and a
# future product needs no re-ingest, but nothing reads them yet.
#
# The boundary between tier 2 and tier 3 is a physical rule: a field is a
# product input when a product reads it as a physical quantity of the site. A
# calibration slope or a charger state code is a device's internal state, not a
# quantity of the site, so it is tier 3 however useful it is for diagnostics.
PRODUCT_VARIABLES = (
    "temperature8m",
    "deltaTemperature",
    "windDirStdDev",
    "windSpeedMin",
    "moduleTemperature",
    "panelTemperature",
    "mpptSolarPower",
    "mppt2SolarPower",
    "pm25",
    "pm10",
    "particulateCount",
    "solarMJTotal",
)

STORED_VARIABLES = (
    "soil_temperature",
    "soil_moisture",
    "battery_voltage",
    "batteryVoltage2",
    "lithiumBattery",
    "so2",
    "uv_index",
    "lightning",
    "lightningDistance",
    "lightningEnergy",
    "waterLevel",
    "chargerVoltage",
    "temperatureSwitch",
    "levelSwitch",
    "temperatureSwitchOutlet",
    "levelSwitchStatus",
    "sdi12WindVector",
    "pumpSelectWell",
    "pumpSelectBore",
    "portStatusC1",
    "portStatusC2",
    "visibility",
    "visibilityVolt",
    "lightningRaw",
    "mpptSolarVoltage",
    "mpptSolarCurrent",
    "mpptLoadVoltage",
    "mpptLoadCurrent",
    "mpptBatteryVoltage",
    "mpptChargerState",
    "mpptAbsiAvg",
    "mpptBoardTemp",
    "mpptMode",
    "mpptBulkFloatVoltage",
    "mpptFloatVoltage",
    "mpptCurrentLimit",
    "mpptAbsorbTimeLimit",
    "mpptAbsorbFullCurrent",
    "mpptVCalSlope",
    "mpptICalSlope",
    "mppt2SolarVoltage",
    "mppt2SolarCurrent",
    "mppt2LoadVoltage",
    "mppt2LoadCurrent",
    "mppt2BatteryVoltage",
    "mppt2ChargerState",
    "mppt2BoardTemp",
    "mppt2Mode",
    "mppt2BulkFloatVoltage",
    "mppt2FloatVoltage",
    "mppt2CurrentLimit",
    "mppt2AbsorbTimeLimit",
    "mppt2AbsorbFullCurrent",
    "mppt2VCalSlope",
    "mppt2ICalSlope",
)

ALL_VARIABLES = ENGINE_VARIABLES + PRODUCT_VARIABLES + STORED_VARIABLES

# Column name aliases, in priority order, mirroring the vocabulary the
# TypeScript Campbell parser in server/parsers/campbellScientific.ts already
# recognizes, so a file that imports into the main Stratus server imports here
# too and the two never disagree about what a column means. Parity is asserted
# by a test that reads the parser source, so the two cannot drift apart
# unnoticed.
#
# One alias, SolarCharger_BatteryVoltage_2_Avg, is claimed by both
# batteryVoltage2 and mppt2BatteryVoltage in the parser. It is mirrored that way
# here rather than fixed: diverging in the first field touched would defeat the
# parity this table exists to create, and the real fix belongs in the parser.
# build_column_map gives the shared column to whichever owner comes first, and
# the parity test accepts either.
ALIASES: dict[str, tuple[str, ...]] = {
    "temperature": (
        "AirTC", "AirTC_Avg", "Temp_C", "Temperature", "T_Avg", "Air_Temp", "Temp_Avg", "AirTemp_Avg", "AirTemp", "Temp", "Amb_Temp_Avg", "TEMP__2m_Avg", "TEMP_2m_Avg",
    ),
    "humidity": (
        "RH", "RH_Avg", "Humidity", "RelHumidity", "RH_pct", "RelHumidity_Avg",
    ),
    "pressure": (
        "BP_mbar", "BP_Avg", "Pressure", "BaroPres", "Baro_mbar", "Pressure_Avg", "BaroPressure_Avg", "BP_mbar_Avg", "BPress_Avg", "BPress", "Bar_Pressure_Avg",
    ),
    "wind_speed": (
        "WS_ms", "WS_Avg", "WindSpd", "Wind_Speed", "WS_kph", "Wind_Spd_S_WVT", "WindSpeed_Avg", "WS_ms_Avg", "WS_ms_S_WVT", "WSpd_1_Avg", "WSpd_Avg", "WSpd_1_S_WVT", "WSpd_2_Avg", "W_S_m_s_WVc(1)",
    ),
    "wind_direction": (
        "WD_Deg", "WD_Avg", "WindDir", "Wind_Dir", "Wind_Dir_D1_WVT", "WindDir_D1_WVT", "WindDir_Avg", "WD_Deg_Avg", "WDir_1_Avg", "WDir_Avg", "WDir_1_D1_WVT", "WDir_2_Avg", "W_S_m_s_WVc(2)",
    ),
    "wind_gust": (
        "WS_Max", "WindGust", "Gust_ms", "Wind_Spd_Max", "WindSpeed_Max", "WS_ms_Max", "Wind_Gust", "WSpd_1_Max", "WSpd_Max", "W_S_m_s_WVc(3)",
    ),
    "windSpeedMin": (
        "WSpd_1_Min", "WSpd_Min", "WS_ms_Min", "WindSpeed_Min", "WSpd_2_Min",
    ),
    "solar_radiation": (
        "SlrW", "SR_Avg", "Solar_W", "Radiation", "SlrkW", "Solar_Rad_Avg", "SolarRad_Avg", "SlrW_Avg", "Solar_Rad", "SR_W", "Sol_Rad_Avg",
    ),
    "solarMJTotal": (
        "SlrMJ_Tot", "SlrMJ", "Solar_MJ_Tot", "SolarMJ_Tot",
    ),
    "rainfall": (
        "Rain_mm", "Rain_Tot", "Precip", "Rain_mm_Tot", "Rain_Tot_Tot", "Rainfall", "Precip_Tot", "Rain_1_Tot", "Rain_Tot_1", "Rain_2_Tot",
    ),
    "dew_point": (
        "DewPt", "DewPoint", "Dew_C", "DewPoint_Avg", "DewPt_Avg", "DewPointTemp_Avg", "DewPointTemp",
    ),
    "soil_temperature": (
        "SoilTC", "Soil_Temp", "T_Soil", "SoilTemp_Avg", "SoilTC_Avg",
    ),
    "soil_moisture": (
        "VWC", "Soil_VWC", "VWC_Avg", "SoilMoist_Avg", "Soil_Moisture",
    ),
    "battery_voltage": (
        "BattV", "Batt_V", "Battery", "BattV_Avg", "BattV_Min", "Batt_volt_Min", "LoggerBattery_Avg", "LoggerBattery", "Batt_Volt_Avg", "BAT_VOLTS_Avg",
    ),
    "batteryVoltage2": (
        "BattV_2", "BattV2", "BattV_2_Avg", "BattV2_Avg", "Batt2_V", "Battery2_V", "Battery_2_V", "Batt_volt_2_Min", "Batt_Volt_2_Avg", "LoggerBattery2_Avg", "LoggerBattery2", "SolarCharger_BatteryVoltage_2_Avg",
    ),
    "lithiumBattery": (
        "LoggerLithiumBatt_Avg", "LoggerLithiumBatt", "LithiumBatt_Avg", "LithiumBatt",
    ),
    "panelTemperature": (
        "PTemp", "PTemp_C", "Panel_Temp", "PTemp_Avg", "PTemp_C_Avg", "LoggerTemp_Avg", "LoggerTemp",
    ),
    "pm25": (
        "PM2_5_Avg", "PM2_5", "PM25", "PM25_Avg",
    ),
    "pm10": (
        "PM10_Avg", "PM10", "PM_10_Avg",
    ),
    "particulateCount": (
        "partic_Avg", "partic", "Particulate_Avg", "Particulate_Count",
    ),
    "so2": (
        "SO2__Avg", "SO2_Avg", "SO2",
    ),
    "moduleTemperature": (
        "MOD_TEMP_Avg", "MOD_TEMP", "ModTemp_Avg", "Module_Temp_Avg",
    ),
    "uv_index": (
        "UV_Index_Avg", "UV_Index", "UVI", "UV_Avg",
    ),
    "lightning": (
        "Lightning_Tot", "Lightning_Count", "Lightning",
    ),
    "lightningDistance": (
        "LightningDist", "Lightning_Dist", "LightningDist_Avg", "Lightning_Distance",
    ),
    "lightningEnergy": (
        "LightningEnergy", "Lightning_Energy", "LightningEnergy_Avg",
    ),
    "waterLevel": (
        "Water_Level_Avg", "WaterLevel", "Water_Level",
    ),
    "chargerVoltage": (
        "DC_Chg_Volts", "ChgV_Avg", "Charger_V", "SolarCharger_V",
    ),
    "temperatureSwitch": (
        "Temp_Switch_Avg", "TempSwitch", "Temp_Switch",
    ),
    "levelSwitch": (
        "Level_Switch", "LevelSwitch", "Level_Switch_Avg",
    ),
    "temperatureSwitchOutlet": (
        "Temp_Switch_Outlet", "TempSwitchOutlet",
    ),
    "levelSwitchStatus": (
        "Level_Switch_Status", "LevelSwitchStatus",
    ),
    "windDirStdDev": (
        "Wind_Dir_SD1_WVT", "WindDir_SD1_WVT", "WDir_SD1_WVT", "WDir_1_Std", "WDir_Std", "WDir_2_Std",
    ),
    "sdi12WindVector": (
        "SDI12_WVc", "SDI12_WV", "SDI12_Wind",
    ),
    "pumpSelectWell": (
        "Pump_Select_Well", "PumpSelectWell", "Pump_Well",
    ),
    "pumpSelectBore": (
        "Pump_Select_Bore", "PumpSelectBore", "Pump_Bore",
    ),
    "portStatusC1": (
        "Port_Status_C1", "PortStatusC1", "Port_C1",
    ),
    "portStatusC2": (
        "Port_Status_C2", "PortStatusC2", "Port_C2",
    ),
    "temperature8m": (
        "Temp8m_Avg", "Temp_8m_Avg", "Temp8m", "AirTC_8m_Avg",
    ),
    "deltaTemperature": (
        "DeltaTemp_Avg", "Delta_Temp_Avg", "DeltaTemp", "Delta_T_Avg",
    ),
    "visibility": (
        "Visibility_km", "Visibility", "Vis_km", "Visibility_Avg",
    ),
    "visibilityVolt": (
        "Visibility_Volt", "Vis_Volt", "Visibility_V",
    ),
    "lightningRaw": (
        "Lightning_Raw", "LightningRaw", "Lightning_mA",
    ),
    "mpptSolarVoltage": (
        "MPPT_SolV_Avg", "MPPT_SolarVoltage", "Solar_Voltage", "SolV_Avg", "MPPT_Vsol", "Vsol_Avg", "SolarCharger_PanelVoltage_1_Avg",
    ),
    "mpptSolarCurrent": (
        "MPPT_SolI_Avg", "MPPT_SolarCurrent", "Solar_Current", "SolI_Avg", "MPPT_Isol", "Isol_Avg", "SolarCharger_PanelCurrent_1_Avg",
    ),
    "mpptSolarPower": (
        "MPPT_SolP_Avg", "MPPT_SolarPower", "Solar_Power", "SolP_Avg", "MPPT_Psol", "Psol_Avg", "SolarCharger_PanelPower_1_Avg",
    ),
    "mpptLoadVoltage": (
        "MPPT_LdV_Avg", "MPPT_LoadVoltage", "Load_Voltage", "LdV_Avg", "MPPT_Vload", "Vload_Avg", "SolarCharger_LoadVoltage_1_Avg",
    ),
    "mpptLoadCurrent": (
        "MPPT_LdI_Avg", "MPPT_LoadCurrent", "Load_Current", "LdI_Avg", "MPPT_Iload", "Iload_Avg", "SolarCharger_LoadCurrent_1_Avg",
    ),
    "mpptBatteryVoltage": (
        "MPPT_BatV_Avg", "MPPT_BatteryVoltage", "MPPT_Vbat", "Vbat_Avg", "SolarCharger_BatteryVoltage_1_Avg",
    ),
    "mpptChargerState": (
        "MPPT_ChgS", "MPPT_ChargerState", "Charger_State", "ChgState", "MPPT_State", "SolarCharger_State_1",
    ),
    "mpptAbsiAvg": (
        "MPPT_ABSI_Avg", "MPPT_ABSI", "ABSI_Avg",
    ),
    "mpptBoardTemp": (
        "SolarCharger_BoardTemp_1_Avg", "MPPT_BoardTemp", "MPPT_Temp",
    ),
    "mpptMode": (
        "SolarCharger_Mode_1", "MPPT_Mode",
    ),
    "mpptBulkFloatVoltage": (
        "SolarCharger_BulkFloatVoltage_1", "MPPT_BulkFloatVoltage",
    ),
    "mpptFloatVoltage": (
        "SolarCharger_FloatVoltage_1", "MPPT_FloatVoltage",
    ),
    "mpptCurrentLimit": (
        "SolarCharger_CurrentLimit_1", "MPPT_CurrentLimit",
    ),
    "mpptAbsorbTimeLimit": (
        "SolarCharger_AbsorbTimeLimit_1", "MPPT_AbsorbTimeLimit",
    ),
    "mpptAbsorbFullCurrent": (
        "SolarCharger_AbsorbFullCurrent_1", "MPPT_AbsorbFullCurrent",
    ),
    "mpptVCalSlope": (
        "SolarCharger_VCalSlope_1", "MPPT_VCalSlope",
    ),
    "mpptICalSlope": (
        "SolarCharger_ICalSlope_1", "MPPT_ICalSlope",
    ),
    "mppt2SolarVoltage": (
        "SolarCharger_PanelVoltage_2_Avg", "MPPT2_SolV_Avg", "MPPT2_SolarVoltage",
    ),
    "mppt2SolarCurrent": (
        "SolarCharger_PanelCurrent_2_Avg", "MPPT2_SolI_Avg", "MPPT2_SolarCurrent",
    ),
    "mppt2SolarPower": (
        "SolarCharger_PanelPower_2_Avg", "MPPT2_SolP_Avg", "MPPT2_SolarPower",
    ),
    "mppt2LoadVoltage": (
        "SolarCharger_LoadVoltage_2_Avg", "MPPT2_LdV_Avg", "MPPT2_LoadVoltage",
    ),
    "mppt2LoadCurrent": (
        "SolarCharger_LoadCurrent_2_Avg", "MPPT2_LdI_Avg", "MPPT2_LoadCurrent",
    ),
    "mppt2BatteryVoltage": (
        "SolarCharger_BatteryVoltage_2_Avg", "MPPT2_BatV_Avg", "MPPT2_BatteryVoltage",
    ),
    "mppt2ChargerState": (
        "SolarCharger_State_2", "MPPT2_ChgS", "MPPT2_ChargerState",
    ),
    "mppt2BoardTemp": (
        "SolarCharger_BoardTemp_2_Avg", "MPPT2_BoardTemp", "MPPT2_Temp",
    ),
    "mppt2Mode": (
        "SolarCharger_Mode_2", "MPPT2_Mode",
    ),
    "mppt2BulkFloatVoltage": (
        "SolarCharger_BulkFloatVoltage_2", "MPPT2_BulkFloatVoltage",
    ),
    "mppt2FloatVoltage": (
        "SolarCharger_FloatVoltage_2", "MPPT2_FloatVoltage",
    ),
    "mppt2CurrentLimit": (
        "SolarCharger_CurrentLimit_2", "MPPT2_CurrentLimit",
    ),
    "mppt2AbsorbTimeLimit": (
        "SolarCharger_AbsorbTimeLimit_2", "MPPT2_AbsorbTimeLimit",
    ),
    "mppt2AbsorbFullCurrent": (
        "SolarCharger_AbsorbFullCurrent_2", "MPPT2_AbsorbFullCurrent",
    ),
    "mppt2VCalSlope": (
        "SolarCharger_VCalSlope_2", "MPPT2_VCalSlope",
    ),
    "mppt2ICalSlope": (
        "SolarCharger_ICalSlope_2", "MPPT2_ICalSlope",
    ),
}


# Values a logger writes for "no reading".
NULL_TOKENS = {"nan", "NAN", "", "null", "NULL", "-99999", "-9999",
               "7999", "INF", "-INF", "inf", "-inf"}


@dataclass
class ColumnMap:
    """Which file column feeds which canonical variable."""

    variable: str
    column_index: int
    column_name: str
    unit: str
    aggregation: str
    #: Multiplier and offset applied to reach canonical units.
    scale: float = 1.0
    offset: float = 0.0

    def convert(self, raw: float) -> float:
        return raw * self.scale + self.offset


@dataclass
class IngestReport:
    """What the upload actually contained, for the operator to see.

    Shown rather than logged. Someone uploading a logger file needs to know
    which of their columns were understood, because a silently ignored wind
    column looks identical to a station with no wind sensor.
    """

    station_name: str = ""
    logger_model: str = ""
    table_name: str = ""
    file_format: str = ""
    rows_read: int = 0
    rows_kept: int = 0
    rows_skipped: int = 0
    first_timestamp: datetime | None = None
    last_timestamp: datetime | None = None
    mapped: dict[str, str] = field(default_factory=dict)
    conversions: list[str] = field(default_factory=list)
    unmapped_columns: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def variables_found(self) -> list[str]:
        return [v for v in ALL_VARIABLES if v in self.mapped]

    @property
    def engine_variables_found(self) -> list[str]:
        return [v for v in ENGINE_VARIABLES if v in self.mapped]


@dataclass
class Observation:
    """One timestamped record in canonical units."""

    observed_at: datetime
    values: dict[str, float] = field(default_factory=dict)


class IngestError(Exception):
    """The file could not be read at all."""


# ---------------------------------------------------------------------------
#  Unit handling
# ---------------------------------------------------------------------------

def _normalize_unit(unit: str) -> str:
    u = (unit or "").strip().strip('"').lower()
    u = u.replace("^", "").replace(" ", "").replace("_", "")
    u = u.replace("degrees", "deg").replace("degree", "deg")
    return u


# (canonical variable, normalised unit) -> (scale, offset, description)
# Only conversions that actually change the number are listed; anything absent
# is treated as already canonical.
_CONVERSIONS: dict[tuple[str, str], tuple[float, float, str]] = {}


def _register(variables, units, scale, offset, description) -> None:
    for v in variables:
        for u in units:
            _CONVERSIONS[(v, _normalize_unit(u))] = (scale, offset,
                                                     description)


# Absolute temperatures that share the screen-temperature conversions, so a
# file in Fahrenheit or kelvin converts these too. deltaTemperature is
# excluded on purpose: it is a temperature DIFFERENCE, and the -32 offset of a
# Fahrenheit conversion would be wrong for a difference.
_TEMPS = ("temperature", "dew_point", "soil_temperature",
          "temperature8m", "moduleTemperature", "panelTemperature")
_register(_TEMPS, ("degf", "f", "fahrenheit"), 5.0 / 9.0, -32.0 * 5.0 / 9.0,
          "degrees F to degrees C")
_register(_TEMPS, ("k", "kelvin"), 1.0, -273.15, "kelvin to degrees C")

_WINDS = ("wind_speed", "wind_gust")
_register(_WINDS, ("m/s", "ms", "meterspersecond", "mps"), 3.6, 0.0,
          "m/s to km/h")
_register(_WINDS, ("mph", "milesperhour"), 1.609344, 0.0, "mph to km/h")
_register(_WINDS, ("knots", "kts", "kt", "knot"), 1.852, 0.0, "knots to km/h")

_register(("pressure",), ("kpa",), 10.0, 0.0, "kPa to hPa")
_register(("pressure",), ("pa",), 0.01, 0.0, "Pa to hPa")
_register(("pressure",), ("inhg", "inches", "in"), 33.863886, 0.0,
          "inHg to hPa")

_register(("solar_radiation",), ("kw/m2", "kwm2"), 1000.0, 0.0,
          "kW/m2 to W/m2")

_register(("humidity",), ("frac", "fraction", "0-1"), 100.0, 0.0,
          "fraction to percent")

_register(("visibility",), ("m", "metres", "meters"), 0.001, 0.0, "m to km")

# Units that are already canonical. These have to be listed explicitly, not
# just left to fall through, or the column-name fallback below can override an
# explicit units row. A file whose units row says "kph" while the column is
# still called WS_ms_Avg is exactly that case: the header is authoritative and
# the stale name must not win, or the wind is multiplied by 3.6 twice over.
_CANONICAL_UNITS: dict[str, set[str]] = {}


def _register_canonical(variables, units) -> None:
    for v in variables:
        _CANONICAL_UNITS.setdefault(v, set()).update(
            _normalize_unit(u) for u in units)


# NOTE ON SPELLING IN THESE TUPLES
#
# These strings are not prose. They are matched against the units row of a file
# somebody else wrote, so both the British and the American spelling have to be
# present: a CR1000 programmed in South Africa may well say "metres". Dropping
# the British form here would silently stop a unit being recognized, and the
# reading would then be treated as already canonical and left unconverted.
_register_canonical(_TEMPS, ("degc", "c", "celsius", "degreec"))
_register_canonical(_WINDS, ("kph", "km/h", "kmh", "kilometresperhour",
                             "kilometersperhour"))
_register_canonical(("pressure",), ("hpa", "mbar", "mb", "millibar",
                                   "millibars"))
_register_canonical(("humidity",), ("%", "percent", "pct"))
_register_canonical(("solar_radiation",), ("w/m2", "wm2", "watt/m2",
                                          "wattspersquaremetre",
                                          "wattspersquaremeter"))
_register_canonical(("wind_direction",), ("deg", "degrees", "degree"))
_register_canonical(("visibility",), ("km", "kilometres", "kilometers"))


def _conversion_for(variable: str, unit: str,
                    column_name: str) -> tuple[float, float, str | None]:
    """Scale and offset to canonical units.

    The units row is trusted first, in both directions: if it names a unit that
    needs converting, convert; if it names one that is already canonical, stop
    there and do not let the column name second-guess it. Only when the units
    row is blank or unrecognized is the name consulted, because `WS_kph` and
    `WS_ms` are self-describing and an empty units row is common enough to
    handle.
    """
    normalized = _normalize_unit(unit)
    key = (variable, normalized)
    if key in _CONVERSIONS:
        s, o, d = _CONVERSIONS[key]
        return s, o, d
    if normalized and normalized in _CANONICAL_UNITS.get(variable, set()):
        return 1.0, 0.0, None

    name = column_name.lower()
    if variable in _WINDS:
        if "kph" in name or "km_h" in name or "kmh" in name:
            return 1.0, 0.0, None
        if "_ms" in name or "ms_" in name or "m_s" in name:
            return 3.6, 0.0, "m/s to km/h, inferred from the column name"
        if "mph" in name:
            return 1.609344, 0.0, "mph to km/h, inferred from the column name"
    if variable in _TEMPS and ("_f_" in name or name.endswith("_f")):
        return 5.0 / 9.0, -32.0 * 5.0 / 9.0, "degrees F, inferred from name"
    return 1.0, 0.0, None


# ---------------------------------------------------------------------------
#  Timestamps
# ---------------------------------------------------------------------------

_TS_FORMATS = (
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d %H:%M",
    "%Y/%m/%d %H:%M:%S",
    "%Y/%m/%d %H:%M",
    "%d/%m/%Y %H:%M:%S",
    "%d/%m/%Y %H:%M",
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%d",
)


def parse_timestamp(raw: str) -> datetime | None:
    """A logger timestamp, or None.

    Kept naive on purpose. A logger is programmed in local standard time and
    does not shift, so attaching a timezone here would imply a precision about
    offsets that the file does not carry. Everything downstream compares
    timestamps from the same station, so the comparison is consistent.
    """
    s = (raw or "").strip().strip('"')
    if not s:
        return None
    # Sub-second precision appears on some tables and adds nothing here.
    s = re.sub(r"\.\d+$", "", s)
    for fmt in _TS_FORMATS:
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(s)
    except ValueError:
        return None


def _to_float(raw: str) -> float | None:
    s = (raw or "").strip().strip('"')
    if s in NULL_TOKENS or s.lower() in NULL_TOKENS:
        return None
    try:
        v = float(s)
    except (TypeError, ValueError):
        return None
    if math.isnan(v) or math.isinf(v):
        return None
    return v


# ---------------------------------------------------------------------------
#  Header handling
# ---------------------------------------------------------------------------

def _split_csv_line(line: str) -> list[str]:
    try:
        return next(csv.reader([line]))
    except (csv.Error, StopIteration):
        return [c.strip().strip('"') for c in line.split(",")]


def _pad(row: list[str], n: int) -> list[str]:
    """Make a header row exactly n long.

    The names row decides the column count. A units or aggregation row that is
    longer is truncated and one that is shorter is padded, because a mismatch
    is a stale-table-definition artefact and not a reason to reject the file.
    """
    if len(row) >= n:
        return row[:n]
    return row + [""] * (n - len(row))


def build_column_map(names: list[str], units: list[str],
                     aggs: list[str]) -> tuple[dict[str, ColumnMap], list[str]]:
    """Choose one file column per canonical variable.

    Where several columns could serve one variable the earliest alias wins,
    since the alias tuples are written most-specific first. This is what keeps
    `WS_ms_Avg` as the mean wind while `WS_ms_Max` becomes the gust, instead of
    whichever happened to appear first in the file.
    """
    lower = {n.strip().lower(): i for i, n in enumerate(names)}
    chosen: dict[str, ColumnMap] = {}
    used: set[int] = set()

    for variable, aliases in ALIASES.items():
        for alias in aliases:
            idx = lower.get(alias.lower())
            if idx is None or idx in used:
                continue
            unit = units[idx] if idx < len(units) else ""
            agg = aggs[idx] if idx < len(aggs) else ""
            scale, offset, _desc = _conversion_for(variable, unit, names[idx])
            chosen[variable] = ColumnMap(
                variable=variable, column_index=idx,
                column_name=names[idx].strip(), unit=unit.strip(),
                aggregation=agg.strip(), scale=scale, offset=offset)
            used.add(idx)
            break

    unmapped = [n.strip() for i, n in enumerate(names)
                if i not in used
                and n.strip().upper() not in ("TIMESTAMP", "RECORD", "RN",
                                              "TS", "")]
    return chosen, unmapped


# ---------------------------------------------------------------------------
#  Entry point
# ---------------------------------------------------------------------------

# Physically-possible ranges, used only to flag (never drop) readings. A value
# outside its range is a calibration or mapping problem the operator should see.
_SANITY_LIMITS: dict[str, tuple[float, float, str]] = {
    "temperature": (-40.0, 60.0, "degrees C"),
    "humidity": (0.0, 100.5, "percent"),
    "dew_point": (-40.0, 40.0, "degrees C"),
    "pressure": (500.0, 1100.0, "hPa"),
    "wind_speed": (0.0, 200.0, "km/h"),
    "wind_gust": (0.0, 250.0, "km/h"),
    "wind_direction": (0.0, 360.0, "degrees"),
    "solar_radiation": (0.0, 1500.0, "W/m2"),
    "soil_temperature": (-20.0, 70.0, "degrees C"),
}

# The pressure-median heuristic only needs a representative sample, not every
# reading. Capping the sample keeps a multi-year file's sanity pass bounded in
# memory; for any normal upload the whole series fits well under this.
_PRESS_SAMPLE_MAX = 50_000


def _read_header(
    first: list[str],
    get_line,
    report: IngestReport,
) -> tuple[dict[str, "ColumnMap"], int]:
    """Read the header from the first line plus, for TOA5, three more.

    `first` is the already-split first line. `get_line` returns the next raw
    line or None when the file ends. Fills the report's format/mapping fields
    and returns (column map, timestamp column index). Raises IngestError when
    the file has no usable header or no forecastable column.
    """
    is_toa5 = bool(first) and first[0].strip().strip('"').upper() in (
        "TOA5", "TOACI1", "TOB1")

    if is_toa5:
        report.file_format = first[0].strip().strip('"').upper()
        report.station_name = first[1].strip() if len(first) > 1 else ""
        report.logger_model = first[2].strip() if len(first) > 2 else ""
        report.table_name = first[7].strip() if len(first) > 7 else ""
        names_line = get_line()
        units_line = get_line()
        aggs_line = get_line()
        if names_line is None or units_line is None or aggs_line is None:
            raise IngestError(
                f"A {report.file_format} file needs four header lines and at "
                f"least one data row; this one has too few lines.")
        names = _split_csv_line(names_line)
        n = len(names)
        raw_units = _split_csv_line(units_line)
        units = _pad(raw_units, n)
        aggs = _pad(_split_csv_line(aggs_line), n)
        if len(raw_units) != n:
            report.warnings.append(
                f"The header rows disagree: {n} column names but "
                f"{len(raw_units)} units. The names row "
                f"was used and the units row padded to match.")
    else:
        # A plain CSV with one header row. Common when a file has been through
        # a spreadsheet.
        report.file_format = "CSV"
        names = first
        n = len(names)
        units = [""] * n
        aggs = [""] * n
        report.warnings.append(
            "No TOA5 header found, so the first line was treated as column "
            "names and units were inferred from the names.")

    ts_index = 0
    for i, name in enumerate(names):
        if name.strip().strip('"').upper() == "TIMESTAMP":
            ts_index = i
            break

    columns, unmapped = build_column_map(names, units, aggs)
    report.unmapped_columns = unmapped
    report.mapped = {v: c.column_name for v, c in columns.items()}
    for v, c in sorted(columns.items()):
        _s, _o, desc = _conversion_for(v, c.unit, c.column_name)
        if desc:
            report.conversions.append(f"{c.column_name}: {desc}")

    forecastable = [v for v in columns
                    if v in ENGINE_VARIABLES or v in PRODUCT_VARIABLES]
    if not forecastable:
        raise IngestError(
            "No forecastable weather columns. Recognized diagnostic channels "
            "may be present, but nothing the forecast can use was found; "
            "looked for names such as AirTC_Avg, RH, BP_mbar_Avg, WS_ms_Avg "
            f"and SlrW_Avg. Found: {', '.join(names[:12])}")
    return columns, ts_index


def stream_parse(lines: Iterable[str], report: IngestReport, *,
                 dedup: bool = True) -> Iterator[Observation]:
    """Parse a logger file line by line, yielding one Observation per data row.

    This is the memory-bounded core: it never materializes the file, the line
    list or the full observation list. It consumes an iterable of already
    blank-stripped lines and yields observations, so a caller can feed the
    result straight into a batched, streaming database write. A multi-year
    Campbell export is millions of rows, and holding them all in memory (as the
    old list-building parser did) is what OOM-killed the 320 MB container in a
    restart loop.

    The report is filled as parsing proceeds: counters during the loop, and the
    first/last timestamp and sanity warnings once the last row has been yielded
    (the post-loop code runs when the consumer exhausts the generator).

    `dedup` keeps a set of seen timestamps so the first reading of a repeated
    timestamp wins. That set grows with the file, so the streaming database
    path passes dedup=False and relies instead on INSERT OR REPLACE keyed by
    (station, variable, timestamp), which corrects a repeated row in place
    without holding every timestamp in memory.

    Raises IngestError only when nothing usable can be found at all: an empty
    file, a header with no forecastable column, or a body with no valid row.
    """
    iterator = iter(lines)

    def get_line() -> str | None:
        return next(iterator, None)

    first_line = get_line()
    if first_line is None:
        raise IngestError("The file is empty.")

    columns, ts_index = _read_header(_split_csv_line(first_line), get_line,
                                     report)

    seen: set[datetime] | None = set() if dedup else None
    first_ts: datetime | None = None
    last_ts: datetime | None = None
    # Running per-variable aggregates for the sanity pass: [count, out, min, max].
    stats: dict[str, list] = {v: [0, 0, None, None] for v in _SANITY_LIMITS}
    press_sample: list[float] = []

    for line in iterator:
        report.rows_read += 1
        cells = _split_csv_line(line)
        if len(cells) <= ts_index:
            report.rows_skipped += 1
            continue
        when = parse_timestamp(cells[ts_index])
        if when is None:
            report.rows_skipped += 1
            continue
        values: dict[str, float] = {}
        for variable, cmap in columns.items():
            if cmap.column_index >= len(cells):
                continue
            raw = _to_float(cells[cmap.column_index])
            if raw is None:
                continue
            values[variable] = cmap.convert(raw)
        if not values:
            report.rows_skipped += 1
            continue
        if seen is not None:
            if when in seen:
                # A logger that has been restarted can repeat a timestamp. The
                # first reading is kept; overwriting would let a partial
                # duplicate blank out good values.
                report.rows_skipped += 1
                continue
            seen.add(when)

        if first_ts is None or when < first_ts:
            first_ts = when
        if last_ts is None or when > last_ts:
            last_ts = when
        for variable, (lo, hi, _unit) in _SANITY_LIMITS.items():
            v = values.get(variable)
            if v is None:
                continue
            st = stats[variable]
            st[0] += 1
            if v < lo or v > hi:
                st[1] += 1
            if st[2] is None or v < st[2]:
                st[2] = v
            if st[3] is None or v > st[3]:
                st[3] = v
        if "pressure" in values and len(press_sample) < _PRESS_SAMPLE_MAX:
            press_sample.append(values["pressure"])

        report.rows_kept += 1
        yield Observation(observed_at=when, values=values)

    if report.rows_kept == 0:
        raise IngestError(
            f"Read {report.rows_read} data rows but none had both a valid "
            f"timestamp and at least one reading.")

    report.first_timestamp = first_ts
    report.last_timestamp = last_ts
    _finalize_sanity(report, stats, press_sample)


def parse_dat(text: str) -> tuple[list[Observation], IngestReport]:
    """Parse a whole logger file held in memory into a sorted list + report.

    Kept for the upload path and the tests, which want the full list and the
    convenience of a single call. It is a thin wrapper over stream_parse: it
    collects the observations, then sorts them so a file whose rows are out of
    order still reads in time order. The continuous Dropbox feed does NOT use
    this: it streams stream_parse straight into the database (see
    dropbox_sync.poll_station) so a multi-year file never has to be resident.

    Raises IngestError only when nothing usable can be found at all, so the
    caller can show one clear message instead of a stack trace.
    """
    report = IngestReport()
    lines = (ln for ln in text.splitlines() if ln.strip())
    observations = list(stream_parse(lines, report, dedup=True))
    observations.sort(key=lambda o: o.observed_at)
    # first/last are the running min/max, which equal the sorted ends.
    return observations, report


def _finalize_sanity(report: IngestReport, stats: dict[str, list],
                     press_sample: list[float]) -> None:
    """Turn the running sanity aggregates into operator warnings.

    Shared by stream_parse (running aggregates) and _sanity_check (a whole
    list), so the two can never word a warning differently. Flagged, never
    dropped: a humidity of 105% is a calibration problem the operator should
    see, and quietly deleting it would hide a failing sensor.
    """
    for variable, (lo, hi, unit) in _SANITY_LIMITS.items():
        count, out, vmin, vmax = stats[variable]
        if not count:
            continue
        if out:
            report.warnings.append(
                f"{variable}: {out} of {count} readings fall outside "
                f"{lo} to {hi} {unit} (min {vmin:.1f}, "
                f"max {vmax:.1f}). Kept, but check the sensor or the "
                f"column mapping.")

    # A pressure near 1013 at an inland Highveld site usually means the column
    # is a sea-level reduction, which must not be blended against a model's
    # station pressure.
    if press_sample:
        median_p = sorted(press_sample)[len(press_sample) // 2]
        if median_p > 990.0:
            report.warnings.append(
                f"pressure has a median of {median_p:.0f} hPa, which looks "
                f"like a sea-level reduction rather than station pressure. "
                f"The forecast compares station pressure, so a reduced series "
                f"will show a large constant bias.")


def _sanity_check(observations: list[Observation],
                  report: IngestReport) -> None:
    """Flag physically impossible readings across a materialized list.

    Retained for any caller that already holds the whole list; it builds the
    same running aggregates stream_parse keeps and hands them to the shared
    _finalize_sanity, so both paths word warnings identically.
    """
    stats: dict[str, list] = {v: [0, 0, None, None] for v in _SANITY_LIMITS}
    press_sample: list[float] = []
    for o in observations:
        for variable, (lo, hi, _unit) in _SANITY_LIMITS.items():
            v = o.values.get(variable)
            if v is None:
                continue
            st = stats[variable]
            st[0] += 1
            if v < lo or v > hi:
                st[1] += 1
            if st[2] is None or v < st[2]:
                st[2] = v
            if st[3] is None or v > st[3]:
                st[3] = v
        if "pressure" in o.values:
            press_sample.append(o.values["pressure"])
    _finalize_sanity(report, stats, press_sample)
