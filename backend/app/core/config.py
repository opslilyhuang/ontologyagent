from pydantic import Field
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # ── App ──
    app_title: str = "Ontology Data Agent"
    app_version: str = "0.1.0"
    debug: bool = True

    # ── DeepSeek (OpenAI-compatible) ──
    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com/v1"
    deepseek_model: str = "deepseek-chat"

    # ── Embedding ──
    embedding_model: str = "BAAI/bge-small-zh-v1.5"

    # ── PostgreSQL ──
    pg_user: str = "ontology"
    pg_password: str = "ontology123"
    pg_db: str = "ontology_meta"
    pg_host: str = "postgres"
    pg_port: int = 5432

    @property
    def pg_async_url(self) -> str:
        return f"postgresql+asyncpg://{self.pg_user}:{self.pg_password}@{self.pg_host}:{self.pg_port}/{self.pg_db}"

    @property
    def pg_sync_url(self) -> str:
        return f"postgresql://{self.pg_user}:{self.pg_password}@{self.pg_host}:{self.pg_port}/{self.pg_db}"

    # ── Neo4j ──
    neo4j_uri: str = "bolt://neo4j:7687"
    neo4j_user: str = "neo4j"
    neo4j_password: str = "neo4j123"

    # ── Milvus ──
    milvus_host: str = "milvus"
    milvus_port: int = 19530

    # ── Redis ──
    redis_url: str = "redis://redis:6379/0"

    # ── Upload ──
    upload_dir: str = "/app/uploads"
    max_upload_size_mb: int = 500

    # ── Celery ──
    celery_broker_url: str = "redis://redis:6379/1"
    celery_result_backend: str = "redis://redis:6379/2"

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
