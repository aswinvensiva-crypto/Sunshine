import os
from functools import lru_cache
from typing import List
from dotenv import load_dotenv

load_dotenv()

try:
    from pydantic_settings import BaseSettings, SettingsConfigDict

    class Settings(BaseSettings):
        model_config = SettingsConfigDict(
            env_file=".env",
            env_file_encoding="utf-8",
            extra="ignore",
            case_sensitive=False,
        )

        database_url: str = os.getenv(
            "DATABASE_URL_APP",
            os.getenv("DATABASE_URL", "postgresql://sunshine_app:sunshine_app@localhost:5432/sunshine"),
        )
        service_token_secret: str = os.getenv("SERVICE_TOKEN_SECRET", "change-me-in-production")
        embedding_model: str = os.getenv(
            "EMBEDDING_MODEL", "sentence-transformers/paraphrase-multilingual-mpnet-base-v2"
        )
        llm_provider: str = os.getenv("LLM_PROVIDER", "gemini")
        llm_api_key: str = os.getenv("LLM_API_KEY", "")
        artifact_root: str = os.getenv("ARTIFACT_ROOT", "artifacts/models")
        min_history_days: int = int(os.getenv("MIN_HISTORY_DAYS", "30"))
        risk_timeout_ms: int = int(os.getenv("RISK_TIMEOUT_MS", "5000"))
        forecast_timeout_ms: int = int(os.getenv("FORECAST_TIMEOUT_MS", "30000"))
        chunk_size: int = int(os.getenv("CHUNK_SIZE", "512"))
        chunk_overlap: int = int(os.getenv("CHUNK_OVERLAP", "64"))
        retrieval_top_k: int = int(os.getenv("RETRIEVAL_TOP_K", "5"))
        confidence_threshold: float = float(os.getenv("CONFIDENCE_THRESHOLD", "0.35"))
        forecast_model: str = os.getenv("FORECAST_MODEL", "timesfm")
        allowed_origins: str = os.getenv("ALLOWED_ORIGINS", "http://localhost:5000")

        def __init__(self, **values):
            if "database_url" not in values:
                val = os.getenv("DATABASE_URL_APP") or os.getenv("DATABASE_URL")
                if val:
                    values["database_url"] = val
            if "service_token_secret" not in values:
                val = os.getenv("SERVICE_TOKEN_SECRET")
                if val:
                    values["service_token_secret"] = val
            if "llm_api_key" not in values:
                val = os.getenv("LLM_API_KEY")
                if val:
                    values["llm_api_key"] = val
            if "embedding_model" not in values:
                val = os.getenv("EMBEDDING_MODEL")
                if val:
                    values["embedding_model"] = val
            if "artifact_root" not in values:
                val = os.getenv("ARTIFACT_ROOT")
                if val:
                    values["artifact_root"] = val
            super().__init__(**values)

        @property
        def cors_origins_list(self) -> List[str]:
            return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]

except ImportError:
    from pydantic import BaseModel

    class Settings(BaseModel):
        database_url: str = os.getenv(
            "DATABASE_URL_APP",
            os.getenv("DATABASE_URL", "postgresql://sunshine_app:sunshine_app@localhost:5432/sunshine"),
        )
        service_token_secret: str = os.getenv("SERVICE_TOKEN_SECRET", "change-me-in-production")
        embedding_model: str = os.getenv(
            "EMBEDDING_MODEL", "sentence-transformers/paraphrase-multilingual-mpnet-base-v2"
        )
        llm_provider: str = os.getenv("LLM_PROVIDER", "gemini")
        llm_api_key: str = os.getenv("LLM_API_KEY", "")
        artifact_root: str = os.getenv("ARTIFACT_ROOT", "artifacts/models")
        min_history_days: int = int(os.getenv("MIN_HISTORY_DAYS", "30"))
        risk_timeout_ms: int = int(os.getenv("RISK_TIMEOUT_MS", "5000"))
        forecast_timeout_ms: int = int(os.getenv("FORECAST_TIMEOUT_MS", "30000"))
        chunk_size: int = int(os.getenv("CHUNK_SIZE", "512"))
        chunk_overlap: int = int(os.getenv("CHUNK_OVERLAP", "64"))
        retrieval_top_k: int = int(os.getenv("RETRIEVAL_TOP_K", "5"))
        confidence_threshold: float = float(os.getenv("CONFIDENCE_THRESHOLD", "0.35"))
        forecast_model: str = os.getenv("FORECAST_MODEL", "timesfm")
        allowed_origins: str = os.getenv("ALLOWED_ORIGINS", "http://localhost:5000")

        @property
        def cors_origins_list(self) -> List[str]:
            return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]


@lru_cache()
def get_settings() -> Settings:
    return Settings()
