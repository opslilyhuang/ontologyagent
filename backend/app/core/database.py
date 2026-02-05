from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker, DeclarativeBase

from .config import settings


class Base(DeclarativeBase):
    pass


async_engine = create_async_engine(
    settings.pg_async_url,
    pool_pre_ping=True,
    echo=settings.debug,
)

AsyncSessionLocal = sessionmaker(async_engine, class_=AsyncSession, expire_on_commit=False)


async def get_db() -> AsyncSession:
    """FastAPI dependency — yields an async session."""
    async with AsyncSessionLocal() as session:
        yield session


async def init_db():
    """Drop & recreate all tables (dev only)."""
    async with async_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
