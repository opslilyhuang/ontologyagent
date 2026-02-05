"""
Mock Backend — 内存存储，模拟完整编排流程
运行: python3 mock_backend.py  →  http://localhost:8000
"""
import uuid, time, asyncio, shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional, List, Dict

from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ─── 内存存储 ─────────────────────────────────────
_data_sources: dict[str, dict] = {}
_ontologies:   dict[str, dict] = {}
_tasks:        dict[str, dict] = {}
_batches:      dict[str, dict] = {}
_qa_sessions:  dict[str, dict] = {}
_chat_history: dict[str, list] = {}   # ontology_id → [msg, ...]

UPLOAD_DIR = Path(__file__).parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

app = FastAPI(title="Ontology Agent Mock", version="0.1.0-mock")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ─── helpers ──────────────────────────────────────
def _now() -> str:
    return datetime.now(timezone.utc).isoformat()

def _uid() -> str:
    return str(uuid.uuid4())

# ─── 预置示例数据（开启时自动生成） ──────────────
MOCK_CLASSES = [
    {
        "name": "Employee",
        "label": "员工",
        "description": "企业员工信息，包含基本信息及组织归属。核心业务实体，与部门存在归属关系，与自身存在汇报层级关系。",
        "properties": [
            {"name": "employee_id",   "label": "员工编号",    "type": "int32",    "confidence": 0.97, "storage_type": "INTEGER",       "is_primary_key": True,  "description": "唯一标识每位员工的系统编号",                    "source": "employees.xlsx → employee_id"},
            {"name": "name",          "label": "姓名",        "type": "varchar",  "confidence": 0.90, "storage_type": "VARCHAR(255)",  "is_primary_key": False, "description": "员工的全名",                                    "source": "employees.xlsx → name"},
            {"name": "email",         "label": "工作邮箱",    "type": "email",    "confidence": 0.98, "storage_type": "VARCHAR(320)",  "is_primary_key": False, "description": "员工的企业邮箱地址，用于系统通知和身份认证",        "source": "employees.xlsx → email"},
            {"name": "salary",        "label": "月薪",       "type": "float64",  "confidence": 0.96, "storage_type": "DECIMAL(38,2)", "is_primary_key": False, "description": "员工当前月薪金额，单位：元",                    "source": "employees.xlsx → salary"},
            {"name": "hire_date",     "label": "入职日期",    "type": "date",     "confidence": 0.99, "storage_type": "DATE",         "is_primary_key": False, "description": "员工正式入公司的日期",                            "source": "employees.xlsx → hire_date"},
            {"name": "status",        "label": "在职状态",    "type": "enum",     "confidence": 0.95, "storage_type": "VARCHAR(100)", "is_primary_key": False, "description": "员工当前在职状态，枚举值：active / resigned",     "source": "employees.xlsx → status"},
            {"name": "department_id", "label": "所属部门",    "type": "int32",    "confidence": 0.94, "storage_type": "INTEGER",       "is_primary_key": False, "description": "外键 → Department.department_id，标识员工所属部门", "source": "employees.xlsx → department_id"},
            {"name": "manager_id",    "label": "直属上级",    "type": "int32",    "confidence": 0.72, "storage_type": "INTEGER",       "is_primary_key": False, "description": "外键（自引用）→ Employee.employee_id，直属汇报上级", "source": "employees.xlsx → manager_id"},
        ],
        "parent": None,
    },
    {
        "name": "Department",
        "label": "部门",
        "description": "企业部门信息，是组织架构的基本单元。包含预算和地点信息，供财务和行政管理使用。",
        "properties": [
            {"name": "department_id",   "label": "部门编号",   "type": "int32",    "confidence": 0.97, "storage_type": "INTEGER",       "is_primary_key": True,  "description": "唯一标识每个部门的系统编号",           "source": "departments.xlsx → department_id"},
            {"name": "department_name", "label": "部门名称",   "type": "varchar",  "confidence": 0.88, "storage_type": "VARCHAR(255)",  "is_primary_key": False, "description": "部门的正式名称，如：工程部",            "source": "departments.xlsx → department_name"},
            {"name": "budget",          "label": "年度预算",   "type": "float64",  "confidence": 0.95, "storage_type": "DECIMAL(38,2)", "is_primary_key": False, "description": "部门当前年度预算金额，单位：元",        "source": "departments.xlsx → budget"},
            {"name": "location",        "label": "办公地点",   "type": "varchar",  "confidence": 0.85, "storage_type": "VARCHAR(255)",  "is_primary_key": False, "description": "部门主要办公所在城市",                  "source": "departments.xlsx → location"},
        ],
        "parent": None,
    },
    {
        "name": "Order",
        "label": "订单",
        "description": "客户订单记录，包含订单详情和当前流程状态。与客户表和员工表分别存在关联关系，是核心交易实体。",
        "properties": [
            {"name": "order_id",      "label": "订单编号",   "type": "varchar",  "confidence": 0.92, "storage_type": "VARCHAR(255)",  "is_primary_key": True,  "description": "唯一标识每条订单的编号，如 ORD-001",     "source": "orders.xlsx → order_id"},
            {"name": "customer_name", "label": "客户名称",   "type": "varchar",  "confidence": 0.88, "storage_type": "VARCHAR(255)",  "is_primary_key": False, "description": "外键 → Customer.name，关联客户实体",     "source": "orders.xlsx → customer_name"},
            {"name": "product",       "label": "产品名称",   "type": "varchar",  "confidence": 0.87, "storage_type": "VARCHAR(255)",  "is_primary_key": False, "description": "本订单包含的产品名称",                    "source": "orders.xlsx → product"},
            {"name": "amount",        "label": "订单金额",   "type": "float64",  "confidence": 0.96, "storage_type": "DECIMAL(38,2)", "is_primary_key": False, "description": "订单总金额，单位：元",                      "source": "orders.xlsx → amount"},
            {"name": "order_date",    "label": "创建日期",   "type": "date",     "confidence": 0.99, "storage_type": "DATE",         "is_primary_key": False, "description": "订单创建（下单）的日期",                    "source": "orders.xlsx → order_date"},
            {"name": "status",        "label": "订单状态",   "type": "enum",     "confidence": 0.95, "storage_type": "VARCHAR(100)", "is_primary_key": False, "description": "订单流程状态：pending / completed / negotiating", "source": "orders.xlsx → status"},
            {"name": "notes",         "label": "备注",       "type": "text",     "confidence": 0.82, "storage_type": "TEXT",         "is_primary_key": False, "description": "订单附加备注信息，可选",                    "source": "orders.xlsx → notes"},
            {"name": "employee_id",   "label": "负责人",     "type": "int32",    "confidence": 0.91, "storage_type": "INTEGER",       "is_primary_key": False, "description": "外键 → Employee.employee_id，负责处理此订单的员工", "source": "orders.xlsx → employee_id"},
        ],
        "parent": None,
    },
    {
        "name": "Customer",
        "label": "客户",
        "description": "客户信息实体，由订单数据汇聚识别生成。与订单表存在一对多关系，是收入来源的核心维度。",
        "properties": [
            {"name": "customer_id",  "label": "客户编号",  "type": "varchar", "confidence": 0.85, "storage_type": "VARCHAR(255)", "is_primary_key": True,  "description": "唯一标识客户的编号，由系统汇聚生成",      "source": "orders.xlsx → customer_name (汇聚去重)"},
            {"name": "name",         "label": "客户名称",  "type": "varchar", "confidence": 0.88, "storage_type": "VARCHAR(255)", "is_primary_key": False, "description": "客户的名称",                            "source": "orders.xlsx → customer_name"},
            {"name": "total_orders", "label": "订单总数",  "type": "int32",   "confidence": 0.90, "storage_type": "INTEGER",      "is_primary_key": False, "description": "该客户名下的历史订单总数（统计汇聚）", "source": "orders.xlsx → COUNT(*) 汇聚"},
        ],
        "parent": None,
    },
]

MOCK_RELATIONS = [
    {
        "source_class": "Employee",
        "target_class": "Department",
        "relation_name": "belongs_to",
        "relation_type": "many_to_one",
        "confidence": 0.95,
        "cardinality": "n:1",
        "source_field": "department_id",
        "target_field": "department_id",
        "inferred_from": "foreign_key",
        "metadata": {},
    },
    {
        "source_class": "Employee",
        "target_class": "Employee",
        "relation_name": "reports_to",
        "relation_type": "many_to_one",
        "confidence": 0.70,
        "cardinality": "n:1",
        "source_field": "manager_id",
        "target_field": "employee_id",
        "inferred_from": "naming",
        "metadata": {"note": "自引用关系"},
    },
    {
        "source_class": "Order",
        "target_class": "Employee",
        "relation_name": "handled_by",
        "relation_type": "many_to_one",
        "confidence": 0.95,
        "cardinality": "n:1",
        "source_field": "employee_id",
        "target_field": "employee_id",
        "inferred_from": "foreign_key",
        "metadata": {},
    },
    {
        "source_class": "Order",
        "target_class": "Customer",
        "relation_name": "belongs_to",
        "relation_type": "many_to_one",
        "confidence": 0.88,
        "cardinality": "n:1",
        "source_field": "customer_name",
        "target_field": "name",
        "inferred_from": "naming",
        "metadata": {},
    },
]

MOCK_GRAPH_NODES = [
    {"id": "emp1", "label": "张三",   "data": {"name": "张三",   "department": "工程部", "salary": "85000"}},
    {"id": "emp2", "label": "李四",   "data": {"name": "李四",   "department": "工程部", "salary": "72000"}},
    {"id": "emp3", "label": "王五",   "data": {"name": "王五",   "department": "产品部", "salary": "92000"}},
    {"id": "emp4", "label": "赵六",   "data": {"name": "赵六",   "department": "产品部", "salary": "68000"}},
    {"id": "emp5", "label": "刘八",   "data": {"name": "刘八",   "department": "销售部", "salary": "95000"}},
    {"id": "dept1","label": "工程部", "data": {"name": "工程部", "budget": "500000",    "location": "北京"}},
    {"id": "dept2","label": "产品部", "data": {"name": "产品部", "budget": "300000",    "location": "上海"}},
    {"id": "dept3","label": "销售部", "data": {"name": "销售部", "budget": "400000",    "location": "深圳"}},
    {"id": "ord1", "label": "ORD-001","data": {"order_id": "ORD-001", "customer": "客户甲", "amount": "12000", "status": "completed"}},
    {"id": "ord2", "label": "ORD-002","data": {"order_id": "ORD-002", "customer": "客户乙", "amount": "8500",  "status": "pending"}},
    {"id": "ord3", "label": "ORD-005","data": {"order_id": "ORD-005", "customer": "客户丁", "amount": "25000", "status": "negotiating"}},
    {"id": "cust1","label": "客户甲", "data": {"name": "客户甲", "total_orders": "2"}},
    {"id": "cust2","label": "客户乙", "data": {"name": "客户乙", "total_orders": "1"}},
    {"id": "cust3","label": "客户丁", "data": {"name": "客户丁", "total_orders": "1"}},
]

MOCK_GRAPH_EDGES = [
    {"source": "emp1", "target": "dept1", "label": "BELONGS_TO"},
    {"source": "emp2", "target": "dept1", "label": "BELONGS_TO"},
    {"source": "emp3", "target": "dept2", "label": "BELONGS_TO"},
    {"source": "emp4", "target": "dept2", "label": "BELONGS_TO"},
    {"source": "emp5", "target": "dept3", "label": "BELONGS_TO"},
    {"source": "emp2", "target": "emp1",  "label": "REPORTS_TO"},
    {"source": "emp4", "target": "emp3",  "label": "REPORTS_TO"},
    {"source": "ord1", "target": "emp1",  "label": "HANDLED_BY"},
    {"source": "ord2", "target": "emp4",  "label": "HANDLED_BY"},
    {"source": "ord3", "target": "emp1",  "label": "HANDLED_BY"},
    {"source": "ord1", "target": "cust1", "label": "BELONGS_TO_CUSTOMER"},
    {"source": "ord2", "target": "cust2", "label": "BELONGS_TO_CUSTOMER"},
    {"source": "ord3", "target": "cust3", "label": "BELONGS_TO_CUSTOMER"},
]

MOCK_ENTITIES = [
    {"_id": "emp1", "name": "张三",   "email": "zhang3@company.com", "department_id": "10", "salary": "85000", "status": "active"},
    {"_id": "emp2", "name": "李四",   "email": "li4@company.com",    "department_id": "10", "salary": "72000", "status": "active"},
    {"_id": "emp3", "name": "王五",   "email": "wang5@company.com",  "department_id": "20", "salary": "92000", "status": "active"},
    {"_id": "dept1","department_name": "工程部", "budget": "500000", "location": "北京"},
    {"_id": "dept2","department_name": "产品部", "budget": "300000", "location": "上海"},
    {"_id": "ord1", "order_id": "ORD-001", "customer_name": "客户甲", "amount": "12000", "status": "completed"},
]

# ─── Mock 问答 ────────────────────────────────────
MOCK_QA: list[tuple[str, str, list]] = [
    ("工程部", "工程部共有 2 名员工：**张三**（薪资 85,000）和 **李四**（薪资 72,000）。李四 直接汇报给 张三。",
     [{"type": "graph", "content": "Employee(张三) -BELONGS_TO-> Department(工程部)", "entity_type": "Employee"},
      {"type": "graph", "content": "Employee(李四) -BELONGS_TO-> Department(工程部)", "entity_type": "Employee"}]),
    ("薪资最高", "薪资最高的员工是**刘八**（销售部），薪资为 **95,000 元**。",
     [{"type": "vector", "content": "刘八 | 销售部 | salary=95000", "entity_type": "Employee"}]),
    ("订单", "当前共 3 条订单：\n- **ORD-001**：客户甲，12,000 元，已完成\n- **ORD-002**：客户乙，8,500 元，待处理\n- **ORD-005**：客户丁，25,000 元，谈判中\n\n总金额 **45,500 元**。",
     [{"type": "vector", "content": "ORD-001 | 客户甲 | 12000 | completed", "entity_type": "Order"},
      {"type": "vector", "content": "ORD-002 | 客户乙 | 8500  | pending",   "entity_type": "Order"}]),
    ("部门", "目前有 3 个部门：**工程部**（北京，预算 50W）、**产品部**（上海，预算 30W）、**销售部**（深圳，预算 40W）。",
     [{"type": "graph", "content": "Department(工程部) budget=500000 location=北京", "entity_type": "Department"}]),
    ("客户甲", "**客户甲** 共有 2 条订单（ORD-001、续约记录），均已完成，总金额 24,000 元，属于高价值客户。",
     [{"type": "vector", "content": "客户甲 | total_orders=2", "entity_type": "Customer"}]),
]

# ─── 数据源字段（用于审核页 "添加属性"） ──────────────
_MOCK_FIELDS: list[dict] = []
_seen_fields: set[str] = set()
for _c in MOCK_CLASSES:
    for _p in _c["properties"]:
        _src = _p.get("source", "")
        if "→" in _src:
            _tbl, _fld = [s.strip() for s in _src.split("→")]
            if _fld not in _seen_fields:
                _seen_fields.add(_fld)
                _MOCK_FIELDS.append({"name": _fld, "table": _tbl, "source": _src, "sample_values": []})
# 额外字段（模拟未被自动选中的字段，供用户手动添加）
_MOCK_FIELDS.extend([
    {"name": "phone",      "table": "employees.xlsx", "source": "employees.xlsx → phone",      "sample_values": ["138-0000-0001", "139-0000-0002"]},
    {"name": "address",    "table": "employees.xlsx", "source": "employees.xlsx → address",    "sample_values": ["北京市海淀区", "上海市浦东新区"]},
    {"name": "created_at", "table": "employees.xlsx", "source": "employees.xlsx → created_at", "sample_values": ["2023-01-15", "2023-03-20"]},
    {"name": "tax_id",     "table": "employees.xlsx", "source": "employees.xlsx → tax_id",     "sample_values": ["91350000MA5W3Y6K0Y", "91440300MA5N6JK7B8"]},
])

# ─── 属性标签映射（模拟大模型翻译） ────────────────────
_FIELD_LABEL_MAP: dict[str, tuple[str, str]] = {
    "employee_id":     ("员工编号",   "唯一标识每位员工的系统编号"),
    "name":            ("姓名",       "人员的全名信息"),
    "email":           ("工作邮箱",   "员工的企业邮箱地址，用于通知和身份认证"),
    "salary":          ("月薪",      "员工当前的月薪金额（元）"),
    "hire_date":       ("入职日期",   "员工正式入公司的日期"),
    "status":          ("状态",      "当前状态枚举值"),
    "department_id":   ("部门编号",   "所属部门的唯一编号，外键关联 Department"),
    "manager_id":      ("直属上级",   "直接汇报上级的员工编号，自引用外键"),
    "department_name": ("部门名称",   "部门的正式名称"),
    "budget":          ("年度预算",   "部门当前年度预算金额（元）"),
    "location":        ("办公地点",   "部门主要办公所在城市"),
    "order_id":        ("订单编号",   "唯一标识每条订单的编号"),
    "customer_name":   ("客户名称",   "关联客户实体的名称，外键"),
    "product":         ("产品名称",   "本订单包含的产品名称"),
    "amount":          ("订单金额",   "订单总金额（元）"),
    "order_date":      ("创建日期",   "订单创建（下单）的日期"),
    "notes":           ("备注",      "附加备注信息，可选填写"),
    "customer_id":     ("客户编号",   "唯一标识客户的编号"),
    "total_orders":    ("订单总数",   "该客户名下的历史订单总数"),
    "phone":           ("手机号码",   "员工的个人手机号码"),
    "address":         ("住宅地址",   "员工的住宅地址信息"),
    "created_at":      ("创建时间",   "记录在系统中的创建时间戳"),
    "tax_id":          ("税务编号",   "企业或个人的税务识别编号"),
}


def _mock_answer(question: str) -> dict[str, Any]:
    q = question.lower()
    for keyword, answer, sources in MOCK_QA:
        if keyword in q:
            return {"answer": answer, "sources": sources, "cypher_query": f"MATCH (n {{_ontology_id: '...'}}) WHERE n.name CONTAINS '{keyword}' RETURN n LIMIT 10"}
    # 默认回答
    return {
        "answer": f"关于「{question}」：根据当前本体数据，我没有找到精确匹配的信息。你可以尝试问：**哪些员工在工程部？薪资最高的是谁？当前有哪些订单？**",
        "sources": [],
        "cypher_query": None,
    }

# ═══════════════════════════════════════════════════
# 路由
# ═══════════════════════════════════════════════════

# ── 健康 ──────────────────────────────────────────
@app.get("/health")
async def health():
    return {"status": "ok", "version": "0.1.0-mock"}

@app.get("/")
async def root():
    return {"message": "Ontology Agent Mock API", "docs": "/docs"}


# ── 数据源 CRUD ────────────────────────────────────
class _DSCreate(BaseModel):
    name: str
    type: str
    config: dict[str, Any] = {}

@app.post("/api/v1/data-sources/")
async def ds_create(payload: _DSCreate):
    ds = {
        "id": _uid(), "name": payload.name, "type": payload.type,
        "status": "created", "config": payload.config,
        "schema_info": None, "error_message": None,
        "created_at": _now(), "updated_at": _now(),
    }
    _data_sources[ds["id"]] = ds
    return ds

@app.post("/api/v1/data-sources/upload")
async def ds_upload(file: UploadFile = File(...), name: str = Form(default="")):
    dest = UPLOAD_DIR / (file.filename or "upload")
    with open(dest, "wb") as f:
        shutil.copyfileobj(file.file, f)
    ds = {
        "id": _uid(), "name": name or file.filename or "upload", "type": "file",
        "status": "created", "config": {"file_path": str(dest), "original_name": file.filename},
        "schema_info": None, "error_message": None,
        "created_at": _now(), "updated_at": _now(),
    }
    _data_sources[ds["id"]] = ds
    return ds

@app.post("/api/v1/data-sources/upload/batch")
async def ds_upload_batch(files: list[UploadFile] = File(...)):
    results = []
    for file in files:
        dest = UPLOAD_DIR / (file.filename or "upload")
        with open(dest, "wb") as f:
            shutil.copyfileobj(file.file, f)
        ds = {
            "id": _uid(), "name": file.filename or "upload", "type": "file",
            "status": "created", "config": {"file_path": str(dest), "original_name": file.filename},
            "schema_info": None, "error_message": None,
            "created_at": _now(), "updated_at": _now(),
        }
        _data_sources[ds["id"]] = ds
        results.append(ds)
    return results

@app.get("/api/v1/data-sources/")
async def ds_list():
    return list(_data_sources.values())

@app.get("/api/v1/data-sources/{source_id}")
async def ds_get(source_id: str):
    return _data_sources.get(source_id, {"error": "not found"})

@app.post("/api/v1/data-sources/{source_id}/test-connection")
async def ds_test(source_id: str):
    return {"ok": True, "error": None}

@app.get("/api/v1/data-sources/{source_id}/fields")
async def ds_fields(source_id: str):
    """返回数据源可用字段列表（审核页用于添加属性）。"""
    return {"fields": _MOCK_FIELDS}


# ── 触发分析 + 模拟进度 ───────────────────────────
@app.post("/api/v1/data-sources/{source_id}/analyze")
async def ds_analyze(source_id: str):
    task_id = _uid()
    _tasks[task_id] = {
        "id": task_id, "status": "running", "current_stage": "data_understanding",
        "progress": 5, "error": None, "created_at": _now(), "updated_at": _now(),
        "_source_id": source_id, "_started": time.time(),
    }
    # 后台模拟进度
    asyncio.create_task(_simulate_progress(task_id, source_id))
    return _tasks[task_id]

@app.get("/api/v1/data-sources/{source_id}/task/{task_id}")
async def ds_task(source_id: str, task_id: str):
    return _tasks.get(task_id, {"id": task_id, "status": "failed", "current_stage": "error", "progress": 0, "error": "Task not found", "created_at": _now(), "updated_at": _now()})


async def _simulate_progress(task_id: str, source_id: str):
    """模拟编排五阶段，每阶段停留 1.5s。"""
    stages = [
        ("data_understanding",   15, "数据理解"),
        ("entity_recognition",   35, "实体识别"),
        ("relation_discovery",   55, "关系发现"),
        ("ontology_generation",  75, "本体生成"),
        ("data_instantiation",   95, "数据实例化"),
    ]
    for stage_name, progress, _label in stages:
        await asyncio.sleep(1.5)
        _tasks[task_id].update(status="running", current_stage=stage_name, progress=progress, updated_at=_now())

    # 完成 → 创建本体
    await asyncio.sleep(1)
    ont_id = _uid()
    ds_name = _data_sources.get(source_id, {}).get("name", "Unknown")
    _ontologies[ont_id] = {
        "id": ont_id,
        "name": f"Ontology from {ds_name}",
        "description": f"自动编排生成 — 数据源: {ds_name}",
        "status": "pending",
        "data_source_id": source_id,
        "classes": MOCK_CLASSES,
        "relations": MOCK_RELATIONS,
        "instances_count": len(MOCK_ENTITIES),
        "created_at": _now(),
        "updated_at": _now(),
    }
    _data_sources[source_id]["status"] = "analyzed"
    _tasks[task_id].update(
        status="completed", current_stage="completed", progress=100, updated_at=_now(),
        result={"ontology_id": ont_id},
    )


# ── 批量分析 ──────────────────────────────────────
class _BatchAnalyzeReq(BaseModel):
    source_ids: list[str]

@app.post("/api/v1/data-sources/batch-analyze")
async def ds_batch_analyze(payload: _BatchAnalyzeReq):
    batch_id = _uid()
    _batches[batch_id] = {
        "batch_id": batch_id, "status": "running", "progress": 0,
        "current_stage": "准备中", "source_ids": payload.source_ids,
        "ontology_ids": [], "error": None,
    }
    asyncio.create_task(_simulate_batch(batch_id, payload.source_ids))
    return {"batch_id": batch_id, "status": "running", "source_count": len(payload.source_ids)}

@app.get("/api/v1/data-sources/batches")
async def ds_list_batches():
    return [
        {"batch_id": b["batch_id"], "status": b["status"],
         "source_count": len(b.get("source_ids") or []),
         "created_at": _now()}
        for b in _batches.values()
    ]

@app.get("/api/v1/data-sources/batch/{batch_id}")
async def ds_get_batch(batch_id: str):
    b = _batches.get(batch_id)
    if not b:
        return {"batch_id": batch_id, "status": "failed", "progress": 0,
                "current_stage": "未找到", "source_ids": [], "ontology_ids": [], "error": "Batch not found"}
    return b

async def _simulate_batch(batch_id: str, source_ids: list[str]):
    """模拟批量分析进度。"""
    stages = ["准备中", "数据理解", "实体识别", "关系发现", "本体生成"]
    total = len(source_ids)
    for i, sid in enumerate(source_ids):
        ds_name = _data_sources.get(sid, {}).get("name", "Unknown")
        base = int((i / total) * 80)
        for j, stage in enumerate(stages):
            await asyncio.sleep(0.6)
            _batches[batch_id].update(status="running", progress=base + j * 4, current_stage=f"[{ds_name}] {stage}")
        # 为每个数据源生成本体
        ont_id = _uid()
        _ontologies[ont_id] = {
            "id": ont_id,
            "name": f"Ontology from {ds_name}",
            "description": f"自动编排生成 — 数据源: {ds_name}",
            "status": "pending",
            "data_source_id": sid,
            "batch_id": batch_id,
            "classes": MOCK_CLASSES,
            "relations": MOCK_RELATIONS,
            "instances_count": len(MOCK_ENTITIES),
            "created_at": _now(),
            "updated_at": _now(),
        }
        _batches[batch_id]["ontology_ids"].append(ont_id)
        _data_sources[sid]["status"] = "analyzed"
    # 全部完成
    _batches[batch_id].update(status="completed", progress=100, current_stage="分析完成")


# ── 本体 CRUD ─────────────────────────────────────
@app.get("/api/v1/ontologies/")
async def ont_list(batch_id: Optional[str] = None):
    onts = list(_ontologies.values())
    if batch_id:
        onts = [o for o in onts if o.get("batch_id") == batch_id]
    return onts

@app.get("/api/v1/ontologies/{ontology_id}")
async def ont_get(ontology_id: str):
    return _ontologies.get(ontology_id, {"error": "not found"})

class _OntUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    classes: Optional[list] = None
    relations: Optional[list] = None

@app.put("/api/v1/ontologies/{ontology_id}")
async def ont_update(ontology_id: str, payload: _OntUpdate):
    ont = _ontologies.get(ontology_id)
    if not ont:
        return {"error": "not found"}
    if payload.name is not None:        ont["name"] = payload.name
    if payload.description is not None: ont["description"] = payload.description
    if payload.classes is not None:     ont["classes"] = payload.classes
    if payload.relations is not None:   ont["relations"] = payload.relations
    ont["updated_at"] = _now()
    return ont

@app.post("/api/v1/ontologies/{ontology_id}/publish")
async def ont_publish(ontology_id: str):
    ont = _ontologies.get(ontology_id)
    if not ont:
        return {"error": "not found"}
    ont["status"] = "published"
    ont["updated_at"] = _now()
    return ont


# ── 生成的 API 列表 ───────────────────────────────
@app.get("/api/v1/ontologies/{ontology_id}/apis")
async def ont_apis(ontology_id: str):
    base = f"/api/v1/ontologies/{ontology_id}"
    apis = [
        {"id": _uid(), "path": f"{base}/entities",          "method": "GET",  "description": "查询所有实体（支持 class 过滤）"},
        {"id": _uid(), "path": f"{base}/entities/Employee", "method": "GET",  "description": "查询 Employee 实体"},
        {"id": _uid(), "path": f"{base}/entities/Employee", "method": "POST", "description": "创建 Employee 实体"},
        {"id": _uid(), "path": f"{base}/entities/Department","method":"GET",  "description": "查询 Department 实体"},
        {"id": _uid(), "path": f"{base}/entities/Order",    "method": "GET",  "description": "查询 Order 实体"},
        {"id": _uid(), "path": f"{base}/entities/Order",    "method": "POST", "description": "创建 Order 实体"},
        {"id": _uid(), "path": f"{base}/entities/Customer", "method": "GET",  "description": "查询 Customer 实体"},
        {"id": _uid(), "path": f"{base}/search",            "method": "POST", "description": "语义搜索（向量检索）"},
        {"id": _uid(), "path": f"{base}/graph-query",       "method": "POST", "description": "图谱查询（Cypher）"},
        {"id": _uid(), "path": f"{base}/graph",             "method": "GET",  "description": "获取图拓扑可视化数据"},
    ]
    return apis


# ── 图拓扑 ────────────────────────────────────────
@app.get("/api/v1/ontologies/{ontology_id}/graph")
async def ont_graph(ontology_id: str):
    return {"nodes": MOCK_GRAPH_NODES, "edges": MOCK_GRAPH_EDGES}


# ── 实体查询 ──────────────────────────────────────
@app.get("/api/v1/ontologies/{ontology_id}/entities")
async def ont_entities(ontology_id: str, class_name: Optional[str] = None):
    filtered = MOCK_ENTITIES
    # 简单 mock filter
    if class_name == "Employee":
        filtered = [e for e in MOCK_ENTITIES if "email" in e]
    elif class_name == "Department":
        filtered = [e for e in MOCK_ENTITIES if "department_name" in e]
    elif class_name == "Order":
        filtered = [e for e in MOCK_ENTITIES if "order_id" in e]
    return {"entities": filtered, "count": len(filtered)}


# ── 语义搜索 ──────────────────────────────────────
class _SearchReq(BaseModel):
    query: str = ""
    top_k: int = 5

@app.post("/api/v1/ontologies/{ontology_id}/search")
async def ont_search(ontology_id: str, payload: _SearchReq):
    q = payload.query.lower()
    results = []
    for e in MOCK_ENTITIES:
        if any(q in str(v).lower() for v in e.values()):
            results.append({"id": e["_id"], "score": 0.92, "content": " | ".join(f"{k}={v}" for k, v in e.items() if k != "_id"), "entity_type": "Unknown"})
    return {"results": results[:payload.top_k] or [{"id": "mock", "score": 0.5, "content": "无精确匹配，建议尝试其他关键词", "entity_type": "Info"}]}


# ── 图谱查询 ──────────────────────────────────────
class _CypherReq(BaseModel):
    cypher: str = ""

@app.post("/api/v1/ontologies/{ontology_id}/graph-query")
async def ont_graph_query(ontology_id: str, payload: _CypherReq):
    # mock 返回
    return {"results": [{"n": {"name": "张三", "department": "工程部"}}, {"n": {"name": "李四", "department": "工程部"}}]}


# ── 智能问答 ──────────────────────────────────────
class _ChatReq(BaseModel):
    question: str
    history: list[dict[str, str]] = []

@app.post("/api/v1/ontologies/{ontology_id}/chat")
async def ont_chat(ontology_id: str, payload: _ChatReq):
    # 模拟 0.8s 延迟
    await asyncio.sleep(0.8)
    return _mock_answer(payload.question)


# ── 重新分析 ──────────────────────────────────────
class _ReanalyzeReq(BaseModel):
    description: str
    class_name: Optional[str] = None

class _GenerateLabelReq(BaseModel):
    name: str
    data_source_id: Optional[str] = None

@app.post("/api/v1/ontologies/{ontology_id}/generate-label")
async def ont_generate_label(ontology_id: str, payload: _GenerateLabelReq):
    """模拟大模型：根据英文字段名生成中文名称和描述。"""
    await asyncio.sleep(0.6)
    label, desc = _FIELD_LABEL_MAP.get(payload.name, (payload.name, f"字段 {payload.name} 的数据信息"))
    return {"label": label, "description": desc}


@app.post("/api/v1/ontologies/{ontology_id}/reanalyze")
async def ont_reanalyze(ontology_id: str, payload: _ReanalyzeReq):
    ont = _ontologies.get(ontology_id)
    if not ont:
        return {"error": "not found"}
    # mock: 返回原本体不变（演示用）
    await asyncio.sleep(1.0)
    ont["updated_at"] = _now()
    return ont


# ── 打包 ──────────────────────────────────────────
class _PackageReq(BaseModel):
    ontology_ids: list[str]

@app.post("/api/v1/ontologies/package/spec")
async def ont_package_spec(payload: _PackageReq):
    spec = {
        "openapi": "3.0.0",
        "info": {"title": "Ontology Agent API", "version": "1.0.0"},
        "paths": {
            f"/api/v1/ontologies/{oid}/entities": {
                "get": {"summary": f"Query entities from {oid}", "responses": {"200": {"description": "OK"}}}
            }
            for oid in payload.ontology_ids
        },
    }
    return {"spec": spec}

@app.post("/api/v1/ontologies/package/download")
async def ont_package_download(payload: _PackageReq):
    import io, zipfile
    from fastapi.responses import StreamingResponse
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for oid in payload.ontology_ids:
            ont = _ontologies.get(oid, {"id": oid})
            import json
            zf.writestr(f"{oid}.json", json.dumps(ont, ensure_ascii=False, indent=2))
        zf.writestr("README.md", "# Ontology Package\nGenerated by Ontology Agent (mock).\n")
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/zip", headers={"Content-Disposition": "attachment; filename=ontology_package.zip"})


# ── 智能问答应用 (QA Sessions) ────────────────────
class _QASessionCreate(BaseModel):
    name: str
    ontology_ids: list[str]

class _QASessionUpdate(BaseModel):
    name: str
    ontology_ids: list[str]

def _make_session(name: str, ontology_ids: list[str]) -> dict:
    sid = _uid()
    return {
        "id": sid, "name": name, "ontology_ids": ontology_ids,
        "api_key": f"sk-mock-{sid[:16]}",
        "embed_url": f"/api/v1/qa/sessions/{sid}/embed",
        "status": "active",
        "created_at": _now(), "updated_at": _now(),
    }

@app.post("/api/v1/qa/sessions")
async def qa_create(payload: _QASessionCreate):
    s = _make_session(payload.name, payload.ontology_ids)
    _qa_sessions[s["id"]] = s
    return s

@app.get("/api/v1/qa/sessions")
async def qa_list():
    return list(_qa_sessions.values())

@app.get("/api/v1/qa/sessions/{session_id}")
async def qa_get(session_id: str):
    return _qa_sessions.get(session_id, {"error": "not found"})

@app.put("/api/v1/qa/sessions/{session_id}")
async def qa_update(session_id: str, payload: _QASessionUpdate):
    s = _qa_sessions.get(session_id)
    if not s:
        return {"error": "not found"}
    s["name"] = payload.name
    s["ontology_ids"] = payload.ontology_ids
    s["updated_at"] = _now()
    return s

@app.delete("/api/v1/qa/sessions/{session_id}")
async def qa_delete(session_id: str):
    _qa_sessions.pop(session_id, None)
    return {"ok": True}

class _QAChatReq(BaseModel):
    question: str
    history: list[dict[str, str]] = []

@app.post("/api/v1/qa/sessions/{session_id}/chat")
async def qa_chat(session_id: str, payload: _QAChatReq):
    await asyncio.sleep(0.8)
    result = _mock_answer(payload.question)
    # 附加来源本体 id
    s = _qa_sessions.get(session_id, {})
    ont_ids = s.get("ontology_ids", [])
    result["ontology_id"] = ont_ids[0] if ont_ids else None
    return result


# ═══════════════════════════════════════════════════
if __name__ == "__main__":
    import uvicorn
    print("\n╔══════════════════════════════════════════╗")
    print("║   Ontology Agent — Mock Backend          ║")
    print("║   http://localhost:8001                   ║")
    print("║   Swagger: http://localhost:8001/docs     ║")
    print("╚══════════════════════════════════════════╝\n")
    uvicorn.run(app, host="0.0.0.0", port=8001)
