from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    APP_SECRET_KEY: str = "dev-only-change-me"
    DATABASE_URL: str = "sqlite:///./data/panel.db"
    ALERT_WEBHOOK_TOKEN: str = ""

    # Detector unit liveness. The Pi heartbeats hourly; we allow one missed
    # beat plus buffer before declaring the AS3935 unit INACTIVE.
    UNIT_ACTIVE_THRESHOLD_MIN: int = 130

    # How long to keep per-heartbeat telemetry samples. Must span at least the
    # two most recent calendar months so monthly reports are complete; 70 days
    # covers the current month plus a full prior month with margin. Hourly rows
    # over 70 days per station stay small.
    HEARTBEAT_RETENTION_DAYS: int = 70
    # Calibration events are rare (a few per day at most), so keep them long
    # enough for year-over-year audit history.
    CALIBRATION_RETENTION_DAYS: int = 400

    # Beacon (secondary indicator unit) thresholds.
    BEACON_LIGHTNING_KM: int = 10      # strikes within this distance arm the beacon
    BEACON_ALLCLEAR_MIN: int = 30      # minutes since last in-range strike => all clear

    # Security. Keep SECURE_COOKIES=true in production (HTTPS). Set it to
    # false only for plain-HTTP local testing, otherwise the session cookie
    # is never returned by the browser and login appears to fail.
    SECURE_COOKIES: bool = True
    SESSION_MAX_AGE: int = 28800          # 8 hours, then re-login required
    LOGIN_MAX_FAILURES: int = 8           # per client IP within the window
    LOGIN_FAILURE_WINDOW: int = 900       # 15 minutes

    # SMS gateway credentials.
    #
    # SMS_GATEWAY_* are the names to use. The older provider-specific names are
    # still read as a fallback so an existing deployment's .env keeps working
    # untouched - renaming a variable should never be the reason alerts stop.
    # The gateway's send endpoint. Configurable rather than compiled in, so the
    # supplier can be changed from .env without touching code.
    SMS_GATEWAY_URL: str = "https://platform.clickatell.com/v1/message"
    SMS_GATEWAY_API_KEY: str = ""
    # Shared secret expected on inbound delivery-receipt callbacks. Configure the
    # same value in the gateway's delivery-notification setup.
    SMS_GATEWAY_DLR_TOKEN: str = ""
    CLICKATELL_API_KEY: str = ""          # legacy alias, still honored
    CLICKATELL_DLR_TOKEN: str = ""        # legacy alias, still honored

    @property
    def sms_api_key(self) -> str:
        """The gateway API key, preferring the current variable name."""
        return self.SMS_GATEWAY_API_KEY or self.CLICKATELL_API_KEY

    @property
    def sms_dlr_token(self) -> str:
        """The delivery-receipt shared secret, preferring the current name."""
        return self.SMS_GATEWAY_DLR_TOKEN or self.CLICKATELL_DLR_TOKEN

    # Site name used in SMS alerts. Set SITE_NAME in the environment per
    # deployment; falls back to the station_id reported by the detector.
    # from the Pi if not set.
    SITE_NAME: str = "Lightning Detection Site"

    # Slug of the tenant that owns Stratus' own panel. Existing data is filed
    # under it on upgrade, and newly-seen detectors land there until assigned.
    PLATFORM_TENANT_SLUG: str = "stratus"

    INITIAL_ADMIN_EMAIL: str = "admin@example.com"
    INITIAL_ADMIN_PASSWORD: str = "ChangeMe!123"

    # Operator login (site user at the smelter). Full operational control of
    # recipients / parameters / alert on-off, but no admin (no users, no
    # gateway/API configuration).
    INITIAL_OPERATOR_EMAIL: str = "gw1@stratusweather.co.za"
    INITIAL_OPERATOR_PASSWORD: str = "ChangeMe!Gw1-2026"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


settings = Settings()
