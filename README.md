# Ontology Agent — 多模态本体编排智能代理平台

将异构多模态数据自动化转化为可查询的知识本体，并提供智能问答和动态 API 服务。

---

## 架构总图

```
┌─────────────────────────────────────────────────────┐
│                  前端 React/TS                        │
│  仪表板 · 数据接入 · 本体图编辑 · 智能问答 · API文档  │
└────────────────────┬────────────────────────────────┘
                     │  HTTP/WebSocket
┌────────────────────▼────────────────────────────────┐
│              后端 FastAPI (Python)                    │
│  ├─ 数据接入层      DataAdapter (File/DB/API)        │
│  ├─ 编排引擎        五阶段 Pipeline                  │
│  │   ├─ Stage1 数据理解    (Schema提取+采样)         │
│  │   ├─ Stage2 实体识别    (类型推断+NER)            │
│  │   ├─ Stage3 关系发现    (外键/命名/分布推断)      │
│  │   ├─ Stage4 本体生成    (LLM辅助+规则回退)       │
│  │   └─ Stage5 数据实例化  (Neo4j建图+Milvus向量化) │
│  ├─ 智能问答        混合检索 (向量+图谱+LLM)        │
│  └─ API服务         动态RESTful生成                  │
└────────────────────┬────────────────────────────────┘
                     │
     ┌───────────────┼───────────────┐
     ▼               ▼               ▼
┌─────────┐  ┌──────────┐  ┌──────────┐
│PostgreSQL│  │  Neo4j   │  │  Milvus  │
│ 元数据   │  │ 知识图谱 │  │ 向量索引 │
└─────────┘  └──────────┘  └──────────┘
```

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 18 + TypeScript + Vite + D3.js (图可视化) + Lucide Icons |
| 后端 | Python 3.11 + FastAPI + SQLAlchemy (async) |
| LLM  | DeepSeek API (OpenAI-compatible SDK) |
| 向量 | sentence-transformers (bge-small-zh-v1.5) |
| 元数据 | PostgreSQL 16 (+ pgvector) |
| 图库 | Neo4j 5 |
| 向量库 | Milvus 2.4 |
| 异步 | Redis + Celery |

## 项目结构

```
ontology-agent/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI 入口
│   │   ├── core/                # 配置/DB连接/LLM/Embedding
│   │   │   ├── config.py        # Pydantic Settings
│   │   │   ├── database.py      # SQLAlchemy async
│   │   │   ├── neo4j_client.py  # Neo4j driver
│   │   │   ├── milvus_client.py # Milvus client
│   │   │   ├── llm.py           # DeepSeek封装
│   │   │   └── embedding.py     # 本地embedding
│   │   ├── models/              # ORM + Pydantic schemas
│   │   ├── adapters/            # DataAdapter 适配器
│   │   │   ├── base.py          # 抽象基类
│   │   │   ├── file_adapter.py  # CSV/Excel/JSON/PDF/Word
│   │   │   ├── database_adapter.py  # PG/MySQL
│   │   │   └── api_adapter.py   # RESTful API接入
│   │   ├── engines/             # 编排引擎
│   │   │   ├── type_inference.py    # 智能类型推断
│   │   │   ├── relation_inference.py # 关系推断
│   │   │   └── orchestration.py     # 五阶段编排流程
│   │   ├── services/            # 业务逻辑
│   │   │   ├── data_source_service.py
│   │   │   ├── ontology_service.py
│   │   │   └── chat_service.py  # 混合检索问答
│   │   └── api/                 # FastAPI路由
│   │       ├── data_sources.py
│   │       └── ontologies.py
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx              # 路由配置
│   │   ├── types/               # TypeScript 类型定义
│   │   ├── services/api.ts      # Axios API client
│   │   ├── pages/               # 页面组件
│   │   │   ├── Dashboard.tsx
│   │   │   ├── DataIngestion.tsx
│   │   │   ├── OntologyList.tsx
│   │   │   ├── OntologyDetail.tsx
│   │   │   └── Chat.tsx
│   │   └── components/
│   │       ├── Layout/          # 侧栏导航布局
│   │       └── OntologyEditor/  # D3图编辑器
│   ├── package.json
│   ├── vite.config.ts
│   └── Dockerfile
├── docker-compose.yml           # 一键启动所有服务
├── .env.example                 # 环境变量模板
└── docs/
    └── sample_data/             # 示例数据
        ├── employees.csv
        ├── departments.csv
        └── orders.json
```

## 快速上手

### 1. 环境准备

```bash
# 复制环境变量
cp .env.example .env

# 填入你的 DeepSeek API Key
# DEEPSEEK_API_KEY=sk-xxxxx
```

### 2. Docker 启动（推荐）

```bash
# 启动所有基础服务 (PG, Neo4j, Milvus, Redis)
docker compose up -d postgres neo4j etcd minio milvus redis

# 等待数据库就绪后启动后端
docker compose up -d backend

# 启动前端 (开发模式)
cd frontend
npm install
npm run dev   # → http://localhost:3000
```

### 3. 本地开发（不用 Docker 的数据库）

后端需要 Python 3.11+：

```bash
cd backend
pip install -r requirements.txt

# 确保有本地 PG/Neo4j/Milvus, 修改 .env 中连接信息
uvicorn app.main:app --reload  # → http://localhost:8000
```

前端：

```bash
cd frontend
npm install
npm run dev  # → http://localhost:3000 (自动 proxy 到 :8000)
```

### 4. 演示流程

1. 打开 `http://localhost:3000`
2. 点 **数据接入 → 上传文件**，上传 `docs/sample_data/employees.csv`
3. 点 **分析** 按钮，等待编排完成（进度条）
4. 进入 **本体管理**，查看自动生成的类/关系
5. 点 **确认发布** → 自动生成 RESTful API
6. 点 **智能问答**，试问："哪些员工在工程部？薪资最高的是谁？"

## 核心设计说明

### 类型推断引擎 (`engines/type_inference.py`)

基于采样数据按优先级依次检测 15+ 种数据类型：
`boolean → uuid → email → url → ip → json → datetime → date → integer → float → enum → varchar/text`

每种类型有置信度阈值（>95%），支持用户手动覆盖自动推断结果。

### 关系推断引擎 (`engines/relation_inference.py`)

三种推断策略（置信度从高到低）：
1. **外键约束** (0.95) — 最可靠，直接从 DB 约束读取
2. **数据分布** (0.8-0.95) — 列值与其他表 PK 重叠度分析
3. **命名约定** (0.7) — 识别 `xxx_id` / `id_xxx` 模式

自动检测多对多关联表（联合主键 + 仅两个外键列）。

### 混合检索问答 (`services/chat_service.py`)

1. 向量检索 → Milvus 语义相似搜索
2. LLM 判断是否需要图谱查询 → 生成 Cypher
3. 合并两路结果 → LLM 生成最终答案

### 多模态处理路径

| 数据类型 | 处理流程 |
|---------|---------|
| 结构化表 | Schema提取 → 类型推断 → 关系推断 → 本体类生成 |
| 文本(PDF/Word/TXT) | 内容提取 → NER(LLM) → Embedding |
| 音频 | Whisper ASR → 文本流程 (P2) |
| 视频 | FFmpeg关键帧 + ASR + OCR (P2) |
| 图像 | OCR + Caption → Embedding (P2) |

## API 参考

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/data-sources/` | 创建数据源 |
| POST | `/api/v1/data-sources/upload` | 上传文件 |
| POST | `/api/v1/data-sources/{id}/analyze` | 触发编排分析 |
| GET  | `/api/v1/ontologies/` | 列出本体 |
| PUT  | `/api/v1/ontologies/{id}` | 编辑本体 |
| POST | `/api/v1/ontologies/{id}/publish` | 发布本体 |
| POST | `/api/v1/ontologies/{id}/chat` | 智能问答 |
| GET  | `/api/v1/ontologies/{id}/entities` | 查询实体 |
| POST | `/api/v1/ontologies/{id}/search` | 语义搜索 |
| POST | `/api/v1/ontologies/{id}/graph-query` | Cypher 查询 |
| GET  | `/api/v1/ontologies/{id}/graph` | 图拓扑数据 |

## 后续扩展 (Roadmap)

- [ ] **P1** Celery 异步任务队列（当前用 asyncio.create_task）
- [ ] **P1** 多模态 Embedding 统一接口
- [ ] **P2** 音频 Whisper ASR 接入
- [ ] **P2** 视频 FFmpeg 关键帧 + OCR
- [ ] **P2** 图像 OCR + 视觉 Caption
- [ ] **P3** SPARQL / GraphQL 查询接口
- [ ] **P3** 本体版本管理
- [ ] **P3** 数据分析报告生成 (PDF)
