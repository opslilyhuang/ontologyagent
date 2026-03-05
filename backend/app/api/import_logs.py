"""导入日志 API 路由。"""
import logging
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, delete as sa_delete
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.database import get_db
from ..models.database import ImportLog
from ..services.import_service import OntologyImportService

router = APIRouter(prefix="/api/v1/import-logs", tags=["导入日志"])
logger = logging.getLogger(__name__)

import_service = OntologyImportService()


# ── 创建导入任务 ────────────────────────────
@router.post("/")
async def create_import_log(payload: dict, db: AsyncSession = Depends(get_db)):
    """创建导入任务"""
    ontology_id = payload.get("ontology_id")
    cleaning_config = payload.get("cleaning_config", {"operators": []})

    if not ontology_id:
        raise HTTPException(status_code=400, detail="ontology_id is required")

    log_id = await import_service.import_ontology_data(db, ontology_id, cleaning_config)

    return {"import_log_id": log_id, "status": "running"}


# ── 获取所有导入日志列表 ────────────────────
@router.get("/")
async def list_import_logs(db: AsyncSession = Depends(get_db)):
    """获取所有导入日志列表"""
    result = await db.execute(select(ImportLog).order_by(ImportLog.created_at.desc()))
    logs = list(result.scalars())

    return [_log_to_dict(log) for log in logs]


# ── 获取单个导入日志详情 ────────────────────
@router.get("/{log_id}")
async def get_import_log(log_id: str, db: AsyncSession = Depends(get_db)):
    """获取单个导入日志详情"""
    result = await db.execute(select(ImportLog).where(ImportLog.id == log_id))
    log = result.scalar_one_or_none()

    if not log:
        raise HTTPException(status_code=404, detail="Import log not found")

    return _log_to_dict(log)


# ── 分页获取失败记录 ────────────────────────
@router.get("/{log_id}/failed-records")
async def get_failed_records(
    log_id: str,
    page: int = 1,
    page_size: int = 20,
    db: AsyncSession = Depends(get_db)
):
    """分页获取失败记录"""
    try:
        page_data = await import_service.get_failed_records_page(
            db, log_id, page, page_size
        )
        return page_data
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ── 重新导入失败记录 ────────────────────────
@router.post("/{log_id}/retry")
async def retry_failed_records(
    log_id: str,
    payload: dict,
    db: AsyncSession = Depends(get_db)
):
    """重新导入失败记录"""
    records = payload.get("records", [])
    cleaning_config = payload.get("cleaning_config", {"operators": []})

    if not records:
        raise HTTPException(status_code=400, detail="records is required")

    try:
        result = await import_service.retry_failed_records(
            db, log_id, records, cleaning_config
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Retry failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ── 删除导入日志 ────────────────────────────
@router.delete("/{log_id}")
async def delete_import_log(log_id: str, db: AsyncSession = Depends(get_db)):
    """删除导入日志"""
    result = await db.execute(select(ImportLog).where(ImportLog.id == log_id))
    log = result.scalar_one_or_none()

    if not log:
        raise HTTPException(status_code=404, detail="Import log not found")

    await db.execute(sa_delete(ImportLog).where(ImportLog.id == log_id))
    await db.commit()

    return {"ok": True, "message": f"Import log {log_id} deleted"}


# ── 辅助函数 ────────────────────────────────
def _log_to_dict(log: ImportLog) -> Dict[str, Any]:
    """将 ImportLog 转换为字典"""
    return {
        "id": log.id,
        "ontology_id": log.ontology_id,
        "batch_id": log.batch_id,
        "status": log.status.value if hasattr(log.status, 'value') else str(log.status),
        "total_records": log.total_records,
        "success_count": log.success_count,
        "failure_count": log.failure_count,
        "cleaning_config": log.cleaning_config or {},
        "failed_records": log.failed_records or [],
        "error_summary": log.error_summary or "",
        "created_at": log.created_at.isoformat() if log.created_at else None,
        "updated_at": log.updated_at.isoformat() if log.updated_at else None,
        "completed_at": log.completed_at.isoformat() if log.completed_at else None,
    }
