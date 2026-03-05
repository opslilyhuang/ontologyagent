"""SQLAlchemy ORM 模型 — PostgreSQL 元数据库。"""
import uuid
from datetime import datetime, timezone
from enum import Enum as PyEnum

from sqlalchemy import Column, String, Integer, DateTime, Text, Enum, ForeignKey, JSON
from sqlalchemy.dialects.postgresql import JSONB, UUID

from ..core.database import Base


def _now():
    return datetime.now(timezone.utc)


def _uuid():
    return str(uuid.uuid4())


# ─────────────────────── 数据源 ──────────────────────
class DataSourceType(PyEnum):
    DATABASE = "database"
    FILE = "file"
    API = "api"


class DataSourceStatus(PyEnum):
    CREATED = "created"
    ANALYZING = "analyzing"
    ANALYZED = "analyzed"
    ERROR = "error"


class DataSource(Base):
    __tablename__ = "data_sources"

    id = Column(String(64), primary_key=True, default=_uuid)
    name = Column(String(256), nullable=False)
    type = Column(Enum(DataSourceType), nullable=False)
    status = Column(Enum(DataSourceStatus), default=DataSourceStatus.CREATED)
    config = Column(JSONB, default=dict)       # 连接配置 / 上传文件路径 / API URL 等
    schema_info = Column(JSONB, nullable=True) # 分析后缓存的 schema
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now)
    updated_at = Column(DateTime(timezone=True), default=_now, onupdate=_now)


# ─────────────────────── 本体 ──────────────────────
class OntologyStatus(PyEnum):
    DRAFT = "draft"           # 候选生成中
    PENDING = "pending"       # 等用户确认
    PUBLISHED = "published"   # 发布后 active
    ARCHIVED = "archived"


class Ontology(Base):
    __tablename__ = "ontologies"

    id = Column(String(64), primary_key=True, default=_uuid)
    name = Column(String(256), nullable=False)
    description = Column(Text, default="")
    status = Column(Enum(OntologyStatus), default=OntologyStatus.DRAFT)
    data_source_id = Column(String(64), ForeignKey("data_sources.id"), nullable=False)
    batch_id = Column(String(64), nullable=True)

    # 核心结构用 JSONB 存储 (类、属性、关系定义)
    classes = Column(JSONB, default=list)       # [OntologyClass, ...]
    relations = Column(JSONB, default=list)     # [OntologyRelation, ...]
    instances_count = Column(Integer, default=0)

    # 新增字段：支持多次转换和自定义名称
    display_name = Column(String(256), nullable=True)  # 用户自定义名称，优先显示
    conversion_config = Column(JSONB, default=dict)    # 本次转换的配置（选择的表/字段）

    created_at = Column(DateTime(timezone=True), default=_now)
    updated_at = Column(DateTime(timezone=True), default=_now, onupdate=_now)
    published_at = Column(DateTime(timezone=True), nullable=True)


# ─────────────────────── 数据映射 ──────────────────
class DataMapping(Base):
    __tablename__ = "data_mappings"

    id = Column(String(64), primary_key=True, default=_uuid)
    ontology_id = Column(String(64), ForeignKey("ontologies.id"), nullable=False)
    data_source_id = Column(String(64), ForeignKey("data_sources.id"), nullable=False)
    mapping_config = Column(JSONB, default=dict)  # 源字段 → 本体属性的映射规则
    created_at = Column(DateTime(timezone=True), default=_now)


# ─────────────────────── 编排任务 ──────────────────
class TaskStatus(PyEnum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class OrchestrationTask(Base):
    __tablename__ = "orchestration_tasks"

    id = Column(String(64), primary_key=True, default=_uuid)
    data_source_id = Column(String(64), ForeignKey("data_sources.id"), nullable=False)
    ontology_id = Column(String(64), ForeignKey("ontologies.id"), nullable=True)
    batch_id = Column(String(64), nullable=True)
    status = Column(Enum(TaskStatus), default=TaskStatus.PENDING)
    current_stage = Column(String(64), default="")        # 当前阶段名
    progress = Column(Integer, default=0)                  # 0-100
    result = Column(JSONB, nullable=True)                  # 阶段结果
    error = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now)
    updated_at = Column(DateTime(timezone=True), default=_now, onupdate=_now)


# ─────────────────────── 对话历史 ──────────────────
class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(String(64), primary_key=True, default=_uuid)
    ontology_id = Column(String(64), ForeignKey("ontologies.id"), nullable=False)
    role = Column(String(16), nullable=False)   # user / assistant
    content = Column(Text, nullable=False)
    message_metadata = Column(JSONB, default=dict)      # 用于存储检索到的图片/实体等
    created_at = Column(DateTime(timezone=True), default=_now)


# ─────────────────────── 生成的 API 端点 ──────────
class GeneratedAPI(Base):
    __tablename__ = "generated_apis"

    id = Column(String(64), primary_key=True, default=_uuid)
    ontology_id = Column(String(64), ForeignKey("ontologies.id"), nullable=False)
    path = Column(String(512), nullable=False)
    method = Column(String(8), default="GET")
    description = Column(Text, default="")
    response_schema = Column(JSONB, default=dict)
    created_at = Column(DateTime(timezone=True), default=_now)


# ─────────────────────── 分析批次 ──────────────────────
class AnalysisBatch(Base):
    __tablename__ = "analysis_batches"

    id            = Column(String(64), primary_key=True, default=_uuid)
    source_ids    = Column(JSONB, default=list)
    status        = Column(String(32), default="pending")   # pending | running | completed | failed
    progress      = Column(Integer, default=0)
    current_stage = Column(String(64), default="")
    ontology_ids  = Column(JSONB, default=list)
    error         = Column(Text, nullable=True)
    created_at    = Column(DateTime(timezone=True), default=_now)
    updated_at    = Column(DateTime(timezone=True), default=_now, onupdate=_now)


# ─────────────────────── Q&A 会话 ─────────────────────
class QASession(Base):
    __tablename__ = "qa_sessions"

    id           = Column(String(64), primary_key=True, default=_uuid)
    name         = Column(String(256), nullable=False)
    ontology_ids = Column(JSONB, default=list)
    api_key      = Column(String(128), nullable=False)
    status       = Column(String(32), default="active")
    created_at   = Column(DateTime(timezone=True), default=_now)
    updated_at   = Column(DateTime(timezone=True), default=_now, onupdate=_now)


# ─────────────────────── 本体数据源映射 ───────────────────
class OntologySourceMapping(Base):
    """支持一个数据源多次转换成不同本体的关联关系。"""
    __tablename__ = "ontology_source_mappings"

    id = Column(String(64), primary_key=True, default=_uuid)
    ontology_id = Column(String(64), ForeignKey("ontologies.id"), nullable=False)
    data_source_id = Column(String(64), ForeignKey("data_sources.id"), nullable=False)
    batch_id = Column(String(64), nullable=True)
    display_name = Column(String(256), nullable=False)  # 用户自定义的本体名称
    description = Column(Text, default="")              # 本次转换说明
    created_at = Column(DateTime(timezone=True), default=_now)


# ─────────────────────── 导入日志 ─────────────────────
class ImportLogStatus(PyEnum):
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    PARTIAL = "partial"  # 部分成功


class ImportLog(Base):
    """记录每次导入本体管理的日志，包括成功/失败统计。"""
    __tablename__ = "import_logs"

    id = Column(String(64), primary_key=True, default=_uuid)
    ontology_id = Column(String(64), ForeignKey("ontologies.id"), nullable=False)
    batch_id = Column(String(64), nullable=True)
    status = Column(Enum(ImportLogStatus), default=ImportLogStatus.RUNNING)

    # 统计数据
    total_records = Column(Integer, default=0)
    success_count = Column(Integer, default=0)
    failure_count = Column(Integer, default=0)

    # 配置和结果
    cleaning_config = Column(JSONB, default=dict)  # 使用的数据清洗配置
    failed_records = Column(JSONB, default=list)   # 失败记录详情（分页展示）
    error_summary = Column(Text, default="")       # 错误摘要

    # 时间信息
    created_at = Column(DateTime(timezone=True), default=_now)
    updated_at = Column(DateTime(timezone=True), default=_now, onupdate=_now)
    completed_at = Column(DateTime(timezone=True), nullable=True)
