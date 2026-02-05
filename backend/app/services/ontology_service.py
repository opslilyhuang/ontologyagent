"""本体 CRUD + 发布服务。"""
import uuid
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.database import Ontology, OntologyStatus, GeneratedAPI
from ..models.schemas import OntologyUpdate


async def create_ontology(
    db: AsyncSession,
    data_source_id: str,
    name: str,
    classes: list[dict],
    relations: list[dict],
) -> Ontology:
    ont = Ontology(
        id=str(uuid.uuid4()),
        name=name,
        status=OntologyStatus.PENDING,
        data_source_id=data_source_id,
        classes=classes,
        relations=relations,
    )
    db.add(ont)
    await db.commit()
    await db.refresh(ont)
    return ont


async def get_ontology(db: AsyncSession, ontology_id: str) -> Ontology | None:
    result = await db.execute(select(Ontology).where(Ontology.id == ontology_id))
    return result.scalar_one_or_none()


async def list_ontologies(db: AsyncSession, batch_id: str | None = None) -> list[Ontology]:
    query = select(Ontology).order_by(Ontology.created_at.desc())
    if batch_id:
        query = query.where(Ontology.batch_id == batch_id)
    result = await db.execute(query)
    return list(result.scalars())


async def update_ontology(db: AsyncSession, ontology_id: str, payload: OntologyUpdate) -> Ontology | None:
    ont = await get_ontology(db, ontology_id)
    if not ont:
        return None
    if payload.name is not None:
        ont.name = payload.name
    if payload.description is not None:
        ont.description = payload.description
    if payload.classes is not None:
        ont.classes = [c.model_dump() if hasattr(c, "model_dump") else c for c in payload.classes]
    if payload.relations is not None:
        ont.relations = [r.model_dump() if hasattr(r, "model_dump") else r for r in payload.relations]
    await db.commit()
    await db.refresh(ont)
    return ont


async def publish_ontology(db: AsyncSession, ontology_id: str) -> Ontology | None:
    """发布本体 + 自动生成 API 端点。"""
    from datetime import datetime, timezone

    ont = await get_ontology(db, ontology_id)
    if not ont:
        return None
    ont.status = OntologyStatus.PUBLISHED
    ont.published_at = datetime.now(timezone.utc)
    await db.commit()

    # 自动生成 RESTful API 定义
    await _generate_apis(db, ont)

    await db.refresh(ont)
    return ont


async def _generate_apis(db: AsyncSession, ont: Ontology):
    """根据本体类自动生成 API 端点记录。"""
    base = f"/api/v1/ontologies/{ont.id}"

    # 通用端点
    apis = [
        {"path": f"{base}/entities", "method": "GET", "description": "查询所有实体（支持 class 过滤）"},
        {"path": f"{base}/entities/{{class_name}}", "method": "GET", "description": "按类查询实体"},
        {"path": f"{base}/search", "method": "POST", "description": "语义搜索（向量检索）"},
        {"path": f"{base}/graph-query", "method": "POST", "description": "图谱查询（Cypher）"},
        {"path": f"{base}/graph", "method": "GET", "description": "获取图拓扑可视化数据"},
    ]

    # 每个类生成 CRUD
    for cls in (ont.classes or []):
        class_name = cls.get("name", "")
        if class_name:
            apis.append({"path": f"{base}/entities/{class_name}", "method": "GET", "description": f"查询 {class_name} 实体"})
            apis.append({"path": f"{base}/entities/{class_name}", "method": "POST", "description": f"创建 {class_name} 实体"})

    for api_def in apis:
        api = GeneratedAPI(
            id=str(uuid.uuid4()),
            ontology_id=ont.id,
            path=api_def["path"],
            method=api_def["method"],
            description=api_def["description"],
        )
        db.add(api)
    await db.commit()


async def get_generated_apis(db: AsyncSession, ontology_id: str) -> list[GeneratedAPI]:
    result = await db.execute(select(GeneratedAPI).where(GeneratedAPI.ontology_id == ontology_id))
    return list(result.scalars())
