from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    database_url: str = "sqlite+aiosqlite:///./jobghost.db"
    jobghost_env: str = "development"
    dry_run: bool = True
    max_applications_per_day: int = 20
    application_cooldown_seconds: int = 30
    hh_client_id: str = ""
    hh_client_secret: str = ""
    backend_host: str = "127.0.0.1"
    backend_port: int = 8765
    companion_enabled: bool = True
    data_dir: Path = Path(".jobghost")


@lru_cache
def get_settings() -> Settings:
    return Settings()
