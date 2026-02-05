"""Pydantic 响应/请求 schemas。"""
from datetime import datetime
from typing import Any, Optional
from pydantic import BaseModel, Field


# ─── 数据源 ───────────────────────────────
class DataSourceCreate(BaseModel):
    name: str
    type: str  # database | file | api
    config: dict[str, Any] = {}


class DataSourceResponse(BaseModel):
    id: str
    name: str
    type: str
    status: str
    schema_info: Optional[dict] = None
    error_message: Optional[str] = None
    created_at: datetime
    updated_at: datetime


# ─── 本体 ─────────────────────────────────
class OntologyClassDef(BaseModel):
    name: str
    label: str = ""
    description: str = ""
    properties: list[dict[str, Any]] = []       # [{name, type, confidence, ...}]
    parent: Optional[str] = None                # 继承关系


class OntologyRelationDef(BaseModel):
    source_class: str
    target_class: str
    relation_name: str
    relation_type: str                          # one_to_one | one_to_many | many_to_one | many_to_many
    confidence: float = 0.0
    cardinality: str = ""
    metadata: dict[str, Any] = {}


class OntologyUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    classes: Optional[list[OntologyClassDef]] = None
    relations: Optional[list[OntologyRelationDef]] = None


class OntologyResponse(BaseModel):
    id: str
    name: str
    description: str
    status: str
    data_source_id: str
    classes: list[dict[str, Any]]
    relations: list[dict[str, Any]]
    instances_count: int
    created_at: datetime
    updated_at: datetime


# ─── 编排任务 ─────────────────────────────
class TaskResponse(BaseModel):
    id: str
    status: str
    current_stage: str
    progress: int
    error: Optional[str] = None
    created_at: datetime
    updated_at: datetime


# ─── 智能问答 ─────────────────────────────
class ChatRequest(BaseModel):
    question: str
    history: list[dict[str, str]] = []  # [{"role":"user","content":"..."}]


class ChatResponse(BaseModel):
    answer: str
    sources: list[dict[str, Any]] = []  # 检索到的依据
    cypher_query: Optional[str] = None  # 如果用到了图谱查询


# ─── 生成 API ─────────────────────────────
class GeneratedAPIResponse(BaseModel):
    id: str
    ontology_id: str
    path: str
    method: str
    description: str


# ─── 批量分析 ─────────────────────────
class BatchAnalyzeRequest(BaseModel):
    source_ids: list[str]


class ReanalyzeRequest(BaseModel):
    description: str
    class_name: Optional[str] = None   # 指定则只重新分析该类


# ─── 本体打包 ──────────────────────────
class OntologyPackageRequest(BaseModel):
    ontology_ids: list[str]


# ─── Q&A 会话 ──────────────────────────
class GenerateLabelRequest(BaseModel):
    name: str
    data_source_id: Optional[str] = None


class QASessionCreate(BaseModel):
    name: str
    ontology_ids: list[str]


class QAChatRequest(BaseModel):
    question: str
    history: list[dict[str, str]] = []
