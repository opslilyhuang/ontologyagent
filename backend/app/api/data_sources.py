"""数据源相关 API 路由。"""
import asyncio
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.database import get_db
from ..models.schemas import DataSourceCreate, DataSourceResponse, TaskResponse, BatchAnalyzeRequest
from ..models.database import DataSourceStatus, TaskStatus, Ontology, OntologyStatus, OrchestrationTask, AnalysisBatch, DataSource
from ..services.data_source_service import (
    create_data_source, get_data_source, list_data_sources,
    test_data_source_connection, create_orchestration_task,
    update_task_status, get_orchestration_task,
)
from ..engines.orchestration import OrchestrationEngine

import uuid, shutil
from pathlib import Path
from ..core.config import settings

router = APIRouter(prefix="/api/v1/data-sources", tags=["数据源"])
logger = logging.getLogger(__name__)


# ── 创建数据源 ──────────────────────────────
@router.post("/", response_model=DataSourceResponse)
async def create_source(payload: DataSourceCreate, db: AsyncSession = Depends(get_db)):
    ds = await create_data_source(db, payload)
    return _ds_to_response(ds)


# ── 上传文件创建数据源 ─────────────────────
@router.post("/upload", response_model=DataSourceResponse)
async def upload_file(
    file: UploadFile = File(...),
    name: str = Form(default=""),
    db: AsyncSession = Depends(get_db),
):
    # 保存上传文件
    upload_dir = Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)
    file_id = str(uuid.uuid4())
    suffix = Path(file.filename or "file").suffix
    file_path = upload_dir / f"{file_id}{suffix}"

    with open(file_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    payload = DataSourceCreate(
        name=name or file.filename or "upload",
        type="file",
        config={"file_path": str(file_path), "original_name": file.filename},
    )
    ds = await create_data_source(db, payload)
    return _ds_to_response(ds)




# ── 批量上传文件 ──────────────────────
@router.post("/upload/batch", response_model=list[DataSourceResponse])
async def upload_files_batch(
    files: list[UploadFile],
    db: AsyncSession = Depends(get_db),
):
    """一次上传多个文件，每个文件创建一个数据源。"""
    results = []
    upload_dir = Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)

    for file in files:
        file_id = str(uuid.uuid4())
        suffix  = Path(file.filename or "file").suffix
        file_path = upload_dir / f"{file_id}{suffix}"
        with open(file_path, "wb") as f:
            shutil.copyfileobj(file.file, f)
        payload = DataSourceCreate(
            name=file.filename or "upload",
            type="file",
            config={"file_path": str(file_path), "original_name": file.filename},
        )
        ds = await create_data_source(db, payload)
        results.append(_ds_to_response(ds))
    return results


# ── 列出数据源 ──────────────────────────────
@router.get("/", response_model=list[DataSourceResponse])
async def list_sources(db: AsyncSession = Depends(get_db)):
    sources = await list_data_sources(db)
    return [_ds_to_response(s) for s in sources]


# ── 列出所有分析批次 ───────────────────────
@router.get("/batches")
async def list_batches(db: AsyncSession = Depends(get_db)):
    """列出所有分析批次。"""
    result = await db.execute(select(AnalysisBatch).order_by(AnalysisBatch.created_at.desc()))
    batches = list(result.scalars())
    return [
        {
            "batch_id":    b.id,
            "status":      b.status,
            "source_count": len(b.source_ids or []),
            "created_at":  b.created_at.isoformat() if b.created_at else None,
        }
        for b in batches
    ]


# ── 获取单个数据源 ─────────────────────────
@router.get("/{source_id}", response_model=DataSourceResponse)
async def get_source(source_id: str, db: AsyncSession = Depends(get_db)):
    ds = await get_data_source(db, source_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Data source not found")
    return _ds_to_response(ds)


# ── 测试连接 ───────────────────────────────
@router.post("/{source_id}/test-connection")
async def test_connection(source_id: str, db: AsyncSession = Depends(get_db)):
    return await test_data_source_connection(db, source_id)


# ── 获取数据源字段列表 ─────────────────────
@router.get("/{source_id}/fields")
async def get_fields(source_id: str, db: AsyncSession = Depends(get_db)):
    """获取数据源可用字段列表（审核页用于添加属性）。"""
    ds = await get_data_source(db, source_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Data source not found")
    fields: list[dict] = []
    schema = ds.schema_info or {}
    for table_name, table_info in (schema.get("tables") or {}).items():
        for col in (table_info.get("columns") or []):
            fields.append({
                "name":          col.get("name", ""),
                "table":         table_name,
                "source":        f"{table_name} → {col.get('name', '')}",
                "sample_values": col.get("samples", []),
            })
    return {"fields": fields}


# ── 触发分析（异步编排） ──────────────────
@router.post("/{source_id}/analyze", response_model=TaskResponse)
async def analyze_source(source_id: str, db: AsyncSession = Depends(get_db)):
    ds = await get_data_source(db, source_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Data source not found")

    # 创建编排任务
    task = await create_orchestration_task(db, source_id)

    # 异步启动编排
    asyncio.create_task(_run_orchestration(db, ds, task.id))

    return _task_to_response(task)


# ── 获取任务状态 ──────────────────────────
@router.get("/{source_id}/task/{task_id}", response_model=TaskResponse)
async def get_task(source_id: str, task_id: str, db: AsyncSession = Depends(get_db)):
    task = await get_orchestration_task(db, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return _task_to_response(task)




# ── 批量分析 ──────────────────────────
@router.post("/batch-analyze")
async def batch_analyze(payload: BatchAnalyzeRequest, db: AsyncSession = Depends(get_db)):
    """批量分析多个数据源，创建分析批次并异步执行。"""
    sources = []
    for sid in payload.source_ids:
        ds = await get_data_source(db, sid)
        if not ds:
            raise HTTPException(status_code=404, detail=f"数据源 {sid} 未找到")
        sources.append(ds)

    batch = AnalysisBatch(
        id=str(uuid.uuid4()),
        source_ids=payload.source_ids,
        status="running",
        progress=0,
        current_stage="准备中",
    )
    db.add(batch)
    await db.commit()
    await db.refresh(batch)

    asyncio.create_task(_run_batch_orchestration(db, sources, batch.id))
    return {"batch_id": batch.id, "status": "running", "source_count": len(sources)}


@router.get("/batch/{batch_id}")
async def get_batch(batch_id: str, db: AsyncSession = Depends(get_db)):
    """获取分析批次状态。"""
    result = await db.execute(select(AnalysisBatch).where(AnalysisBatch.id == batch_id))
    batch = result.scalar_one_or_none()
    if not batch:
        raise HTTPException(status_code=404, detail="批次未找到")
    return {
        "batch_id":      batch.id,
        "status":        batch.status,
        "progress":      batch.progress,
        "current_stage": batch.current_stage,
        "source_ids":    batch.source_ids or [],
        "ontology_ids":  batch.ontology_ids or [],
        "error":         batch.error,
    }


# ── 异步编排执行 ────────────────────────────
async def _run_orchestration(db: AsyncSession, ds, task_id: str):
    """后台执行编排流程。"""
    from ..services.ontology_service import create_ontology

    try:
        await update_task_status(db, task_id, TaskStatus.RUNNING, "data_understanding", 10)

        engine = OrchestrationEngine(
            data_source_id=ds.id,
            config={**ds.config, "type": ds.type.value},
        )

        # Stage 1-3 先执行（不依赖 ontology_id）
        await engine.stage_data_understanding()
        await update_task_status(db, task_id, TaskStatus.RUNNING, "entity_recognition", 30)

        await engine.stage_entity_recognition()
        await update_task_status(db, task_id, TaskStatus.RUNNING, "relation_discovery", 50)

        await engine.stage_relation_discovery()
        await update_task_status(db, task_id, TaskStatus.RUNNING, "ontology_generation", 70)

        # Stage 4: 生成本体
        ontology_result = await engine.stage_ontology_generation()
        ontology = engine.state["ontology"]

        # 创建本体记录
        ont = await create_ontology(
            db,
            data_source_id=ds.id,
            name=f"Ontology from {ds.name}",
            classes=ontology["classes"],
            relations=ontology["relations"],
        )

        # 更新任务关联
        from ..models.database import OrchestrationTask
        from sqlalchemy import update as sa_update
        await db.execute(
            sa_update(OrchestrationTask).where(OrchestrationTask.id == task_id).values(ontology_id=ont.id)
        )
        await db.commit()

        await update_task_status(db, task_id, TaskStatus.RUNNING, "data_instantiation", 85)

        # Stage 5: 数据实例化 (可能 Neo4j/Milvus 未就绪，做 try/except)
        try:
            await engine.stage_data_instantiation(ont.id)
        except Exception as e:
            logger.warning(f"数据实例化部分失败(可能 Neo4j/Milvus 未就绪): {e}")

        # 完成
        await update_task_status(
            db, task_id, TaskStatus.COMPLETED, "completed", 100,
            result={"ontology_id": ont.id, "classes": len(ontology["classes"]), "relations": len(ontology["relations"])}
        )
        # 更新数据源状态
        from sqlalchemy import update as sa_update2
        from ..models.database import DataSource
        await db.execute(sa_update2(DataSource).where(DataSource.id == ds.id).values(status=DataSourceStatus.ANALYZED))
        await db.commit()

    except Exception as e:
        logger.error(f"编排任务 {task_id} 失败: {e}", exc_info=True)
        await update_task_status(db, task_id, TaskStatus.FAILED, "error", 0, error=str(e))
        from sqlalchemy import update as sa_update3
        from ..models.database import DataSource
        await db.execute(sa_update3(DataSource).where(DataSource.id == ds.id).values(status=DataSourceStatus.ERROR, error_message=str(e)))
        await db.commit()




# ── 批量编排执行 ────────────────────────
async def _run_batch_orchestration(db: AsyncSession, sources: list, batch_id: str):
    """后台执行批量编排流程。"""
    from ..services.ontology_service import create_ontology
    from ..models.database import Ontology as OntModel
    from sqlalchemy import update as _upd

    ontology_ids: list[str] = []
    total = len(sources)

    for i, ds in enumerate(sources):
        base_progress = int((i / total) * 80)
        try:
            # 创建任务并关联 batch
            task = await create_orchestration_task(db, ds.id)
            await db.execute(
                _upd(OrchestrationTask).where(OrchestrationTask.id == task.id).values(batch_id=batch_id)
            )
            await db.commit()

            engine = OrchestrationEngine(
                data_source_id=ds.id,
                config={**ds.config, "type": ds.type.value},
            )

            # Stage 1
            await _upd_batch(db, batch_id, "running", base_progress + 2, f"[{ds.name}] 数据理解")
            await engine.stage_data_understanding()

            # Stage 2
            await _upd_batch(db, batch_id, "running", base_progress + 8, f"[{ds.name}] 实体识别")
            await engine.stage_entity_recognition()

            # Stage 3
            await _upd_batch(db, batch_id, "running", base_progress + 14, f"[{ds.name}] 关系发现")
            await engine.stage_relation_discovery()

            # Stage 4
            await _upd_batch(db, batch_id, "running", base_progress + 18, f"[{ds.name}] 本体生成")
            ontology_result = await engine.stage_ontology_generation()
            ontology = engine.state["ontology"]

            # 创建本体并关联 batch
            ont = await create_ontology(
                db,
                data_source_id=ds.id,
                name=f"Ontology from {ds.name}",
                classes=ontology["classes"],
                relations=ontology["relations"],
            )
            await db.execute(
                _upd(OntModel).where(OntModel.id == ont.id).values(batch_id=batch_id)
            )
            await db.commit()
            ontology_ids.append(ont.id)

            # 更新 task 和 data source 状态
            await update_task_status(
                db, task.id, TaskStatus.COMPLETED, "completed", 100,
                result={"ontology_id": ont.id, "classes": len(ontology["classes"]), "relations": len(ontology["relations"])}
            )
            await db.execute(
                _upd(DataSource).where(DataSource.id == ds.id).values(status=DataSourceStatus.ANALYZED)
            )
            await db.commit()

            # Stage 5: 数据实例化（可能失败）
            try:
                await engine.stage_data_instantiation(ont.id)
            except Exception as e:
                logger.warning(f"实例化部分失败(可能 Neo4j/Milvus 未就绪): {e}")

        except Exception as e:
            logger.error(f"批量分析源 {ds.id} 失败: {e}", exc_info=True)
            await _upd_batch(db, batch_id, "failed", 0, f"错误: {ds.name}", error=str(e))
            from sqlalchemy import update as _u2
            await db.execute(_u2(DataSource).where(DataSource.id == ds.id).values(status=DataSourceStatus.ERROR, error_message=str(e)))
            await db.commit()
            return

    # 全部完成
    await _upd_batch(db, batch_id, "completed", 100, "分析完成", ontology_ids=ontology_ids)


async def _upd_batch(
    db: AsyncSession, batch_id: str, status: str, progress: int, stage: str,
    error: str | None = None, ontology_ids: list | None = None,
):
    from sqlalchemy import update as _upd
    vals: dict = {"status": status, "progress": progress, "current_stage": stage}
    if error is not None:
        vals["error"] = error
    if ontology_ids is not None:
        vals["ontology_ids"] = ontology_ids
    await db.execute(_upd(AnalysisBatch).where(AnalysisBatch.id == batch_id).values(**vals))
    await db.commit()


# ── 删除单个数据源 ──────────────────────────
@router.delete("/{source_id}")
async def delete_source(source_id: str, db: AsyncSession = Depends(get_db)):
    """删除数据源（包括关联的文件）"""
    ds = await get_data_source(db, source_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Data source not found")

    # 删除关联的上传文件
    if ds.type.value == "file":
        config = ds.config or {}
        file_path = config.get("file_path")
        if file_path:
            try:
                import os
                if os.path.exists(file_path):
                    os.remove(file_path)
                    logger.info(f"Deleted file: {file_path}")
            except Exception as e:
                logger.warning(f"Failed to delete file {file_path}: {e}")

    # 删除数据库记录
    from sqlalchemy import delete as sa_delete
    await db.execute(sa_delete(DataSource).where(DataSource.id == source_id))
    await db.commit()

    return {"ok": True, "message": f"Data source {source_id} deleted"}


# ── 批量删除数据源 ──────────────────────────
@router.post("/batch-delete")
async def batch_delete_sources(
    payload: dict,
    db: AsyncSession = Depends(get_db)
):
    """批量删除数据源"""
    source_ids = payload.get("source_ids", [])
    if not source_ids:
        raise HTTPException(status_code=400, detail="source_ids is required")

    deleted_ids = []
    for source_id in source_ids:
        try:
            ds = await get_data_source(db, source_id)
            if ds:
                # 删除关联文件
                if ds.type.value == "file":
                    config = ds.config or {}
                    file_path = config.get("file_path")
                    if file_path:
                        try:
                            import os
                            if os.path.exists(file_path):
                                os.remove(file_path)
                        except Exception as e:
                            logger.warning(f"Failed to delete file {file_path}: {e}")

                # 删除数据库记录
                from sqlalchemy import delete as sa_delete
                await db.execute(sa_delete(DataSource).where(DataSource.id == source_id))
                deleted_ids.append(source_id)
        except Exception as e:
            logger.error(f"Failed to delete source {source_id}: {e}")

    await db.commit()
    return {"ok": True, "deleted_count": len(deleted_ids), "deleted_ids": deleted_ids}


# ── 获取数据源的所有本体 ─────────────────────
@router.get("/{source_id}/ontologies")
async def get_source_ontologies(source_id: str, db: AsyncSession = Depends(get_db)):
    """获取数据源关联的所有本体（支持多次转换）"""
    from ..models.database import OntologySourceMapping
    from sqlalchemy import select as _select

    # 先查询映射表
    result = await db.execute(
        _select(OntologySourceMapping)
        .where(OntologySourceMapping.data_source_id == source_id)
        .order_by(OntologySourceMapping.created_at.desc())
    )
    mappings = list(result.scalars())

    if mappings:
        # 使用映射表（支持多次转换）
        return [
            {
                "id": m.id,
                "ontology_id": m.ontology_id,
                "data_source_id": m.data_source_id,
                "batch_id": m.batch_id,
                "display_name": m.display_name,
                "description": m.description,
                "created_at": m.created_at.isoformat() if m.created_at else None,
            }
            for m in mappings
        ]
    else:
        # 兼容旧版本：直接查询本体表
        result = await db.execute(
            _select(Ontology)
            .where(Ontology.data_source_id == source_id)
            .order_by(Ontology.created_at.desc())
        )
        ontologies = list(result.scalars())

        return [
            {
                "id": o.id,  # mapping id = ontology id
                "ontology_id": o.id,
                "data_source_id": o.data_source_id,
                "batch_id": o.batch_id,
                "display_name": o.display_name or o.name,
                "description": o.description,
                "created_at": o.created_at.isoformat() if o.created_at else None,
            }
            for o in ontologies
        ]


# ── 序列化 ───────────────────────────────────
def _ds_to_response(ds) -> DataSourceResponse:
    return DataSourceResponse(
        id=ds.id, name=ds.name, type=ds.type.value, status=ds.status.value,
        schema_info=ds.schema_info, error_message=ds.error_message,
        created_at=ds.created_at, updated_at=ds.updated_at,
    )


def _task_to_response(task) -> TaskResponse:
    return TaskResponse(
        id=task.id, status=task.status.value, current_stage=task.current_stage,
        progress=task.progress, error=task.error,
        created_at=task.created_at, updated_at=task.updated_at,
    )
