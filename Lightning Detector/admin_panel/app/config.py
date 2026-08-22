from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    APP_SECRET_KEY: str = "dev-only-change-me"
    DATABASE_URL: str = "sqlite:///./data/panel.db"
    ALERT_WEBHOOK_TOKEN: str = ""

    # Detector unit liveness. The Pi heartbeats hourly; we allow one missed
    # beat plus buffer before declaring the AS3935 unit INACTIVE.
    UNIT_ACTIVE_THRESHOLD_MIN: int = 130

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

    # Clickatell One API
    CLICKATELL_API_KEY: str = ""
    # Shared secret expected on inbound delivery-receipt callbacks
    # (configure the same value in the Clickatell One API setup).
    CLICKATELL_DLR_TOKEN: str = ""

    # Site name in SMS alerts, e.g. GLENCORE WONDERKOP. Falls back to station_id
    # from the Pi if not set.
    SITE_NAME: str = "GLENCORE WONDERKOP"

    INITIAL_ADMIN_EMAIL: str = "admin@example.com"
    INITIAL_ADMIN_PASSWORD: str = "ChangeMe!123"

    # Operator login (site user at the smelter). Full operational control of
    # recipients / parameters / alert on-off, but no admin (no users, no
    # gateway/API configuration).
    INITIAL_OPERATOR_EMAIL: str = "gw1@stratusweather.co.za"
    INITIAL_OPERATOR_PASSWORD: str = "ChangeMe!Gw1-2026"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


settings = Settings()
