"""数据源 CRUD + 分析触发服务。"""
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.database import DataSource, DataSourceType, DataSourceStatus, OrchestrationTask, TaskStatus
from ..models.schemas import DataSourceCreate, DataSourceResponse
from ..adapters import FileAdapter, DatabaseAdapter, APIAdapter
from ..engines.orchestration import build_adapter

import uuid
from datetime import datetime, timezone


async def create_data_source(db: AsyncSession, payload: DataSourceCreate) -> DataSource:
    ds = DataSource(
        id=str(uuid.uuid4()),
        name=payload.name,
        type=DataSourceType(payload.type),
        status=DataSourceStatus.CREATED,
        config=payload.config,
    )
    db.add(ds)
    await db.commit()
    await db.refresh(ds)
    return ds


async def get_data_source(db: AsyncSession, source_id: str) -> DataSource | None:
    result = await db.execute(select(DataSource).where(DataSource.id == source_id))
    return result.scalar_one_or_none()


async def list_data_sources(db: AsyncSession) -> list[DataSource]:
    result = await db.execute(select(DataSource).order_by(DataSource.created_at.desc()))
    return list(result.scalars())


async def test_data_source_connection(db: AsyncSession, source_id: str) -> dict[str, Any]:
    ds = await get_data_source(db, source_id)
    if not ds:
        return {"ok": False, "error": "Data source not found"}
    adapter = build_adapter({**ds.config, "type": ds.type.value})
    ok = await adapter.test_connection()
    return {"ok": ok, "error": None if ok else "Connection failed"}


async def create_orchestration_task(db: AsyncSession, data_source_id: str) -> OrchestrationTask:
    task = OrchestrationTask(
        id=str(uuid.uuid4()),
        data_source_id=data_source_id,
        status=TaskStatus.PENDING,
        current_stage="pending",
        progress=0,
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)
    return task


async def update_task_status(db: AsyncSession, task_id: str, status: TaskStatus, stage: str = "", progress: int = 0, error: str | None = None, result: dict | None = None):
    await db.execute(
        update(OrchestrationTask)
        .where(OrchestrationTask.id == task_id)
        .values(status=status, current_stage=stage, progress=progress, error=error, result=result)
    )
    await db.commit()


async def get_orchestration_task(db: AsyncSession, task_id: str) -> OrchestrationTask | None:
    result = await db.execute(select(OrchestrationTask).where(OrchestrationTask.id == task_id))
    return result.scalar_one_or_none()
