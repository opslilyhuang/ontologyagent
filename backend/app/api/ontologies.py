"""本体管理 API 路由。"""
import json, zipfile, io
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.database import get_db
from ..models.schemas import OntologyResponse, OntologyUpdate, ChatRequest, ChatResponse, ReanalyzeRequest, OntologyPackageRequest, GenerateLabelRequest
from ..services.ontology_service import (
    get_ontology, list_ontologies, update_ontology, publish_ontology, get_generated_apis,
)
from ..services.chat_service import answer_question

router = APIRouter(prefix="/api/v1/ontologies", tags=["本体管理"])


# ── 列出本体 ───────────────────────────────
@router.get("/", response_model=list[OntologyResponse])
async def list_all(batch_id: str | None = None, db: AsyncSession = Depends(get_db)):
    ontologies = await list_ontologies(db, batch_id=batch_id)
    return [_ont_to_response(o) for o in ontologies]




# ── 本体打包：API 接口文档 ──────────────
@router.post("/package/spec")
async def get_package_spec(payload: OntologyPackageRequest, db: AsyncSession = Depends(get_db)):
    """生成选中本体的 OpenAPI 接口文档。"""
    ontologies = []
    for oid in payload.ontology_ids:
        ont = await get_ontology(db, oid)
        if ont:
            ontologies.append(ont)
    if not ontologies:
        raise HTTPException(status_code=400, detail="无有效本体")
    spec = _generate_openapi_spec(ontologies)
    return {"spec": spec}


# ── 本体打包：下载 ZIP ────────────────
@router.post("/package/download")
async def download_package(payload: OntologyPackageRequest, db: AsyncSession = Depends(get_db)):
    """下载本体定义压缩包（ZIP），包含 JSON 定义和 OpenAPI spec。"""
    ontologies = []
    for oid in payload.ontology_ids:
        ont = await get_ontology(db, oid)
        if ont:
            ontologies.append(ont)
    if not ontologies:
        raise HTTPException(status_code=400, detail="无有效本体")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for ont in ontologies:
            ont_data = {
                "@context": "http://schema.org/",
                "@type":    "OntologyDefinition",
                "id":       ont.id,
                "name":     ont.name,
                "description": ont.description or "",
                "classes":  ont.classes or [],
                "relations": ont.relations or [],
                "status":   ont.status.value if hasattr(ont.status, "value") else str(ont.status),
            }
            zf.writestr(f"{ont.name}.json", json.dumps(ont_data, ensure_ascii=False, indent=2))
        # OpenAPI spec
        spec = _generate_openapi_spec(ontologies)
        zf.writestr("openapi_spec.json", json.dumps(spec, ensure_ascii=False, indent=2))
        # README
        readme_lines = ["# 本体包\n"]
        for ont in ontologies:
            readme_lines.append(f"## {ont.name}\n- 类数: {len(ont.classes or [])}\n- 关系数: {len(ont.relations or [])}\n")
        readme_lines.append("## 使用方式\n- 每个 JSON 文件为单个本体定义\n- openapi_spec.json 为对应的 REST API 接口文档\n")
        zf.writestr("README.md", "\n".join(readme_lines))
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=ontology_package.zip"},
    )


# ── 获取单个本体 ─────────────────────────
@router.get("/{ontology_id}", response_model=OntologyResponse)
async def get_one(ontology_id: str, db: AsyncSession = Depends(get_db)):
    ont = await get_ontology(db, ontology_id)
    if not ont:
        raise HTTPException(status_code=404, detail="Ontology not found")
    return _ont_to_response(ont)


# ── 更新本体 ───────────────────────────────
@router.put("/{ontology_id}", response_model=OntologyResponse)
async def update_one(ontology_id: str, payload: OntologyUpdate, db: AsyncSession = Depends(get_db)):
    ont = await update_ontology(db, ontology_id, payload)
    if not ont:
        raise HTTPException(status_code=404, detail="Ontology not found")
    return _ont_to_response(ont)


# ── 发布本体 ───────────────────────────────
@router.post("/{ontology_id}/publish", response_model=OntologyResponse)
async def publish(ontology_id: str, db: AsyncSession = Depends(get_db)):
    ont = await publish_ontology(db, ontology_id)
    if not ont:
        raise HTTPException(status_code=404, detail="Ontology not found")
    return _ont_to_response(ont)




# ── 重新分析本体 ────────────────────────
@router.post("/{ontology_id}/reanalyze", response_model=OntologyResponse)
async def reanalyze(ontology_id: str, payload: ReanalyzeRequest, db: AsyncSession = Depends(get_db)):
    """用自然语言重新分析本体。可选 class_name 指定单一类。"""
    ont = await get_ontology(db, ontology_id)
    if not ont:
        raise HTTPException(status_code=404, detail="Ontology not found")

    from ..core.llm import llm_chat_json

    current_classes = ont.classes or []

    if payload.class_name:
        # 仅重新分析指定类
        target = next((c for c in current_classes if c.get("name") == payload.class_name), None)
        prompt = (
            f"根据用户描述，重新生成指定本体类的定义。\n"
            f"当前类定义: {json.dumps(target, ensure_ascii=False)}\n"
            f"用户描述: {payload.description}\n\n"
            f"返回更新后的单个类定义JSON对象:\n"
            f'{{"name": "...", "label": "...", "description": "...", "properties": [{{"name": "...", "type": "...", "confidence": 0.9}}], "parent": null}}'
        )
        try:
            new_class = await llm_chat_json(prompt)
            if isinstance(new_class, dict) and "name" in new_class:
                ont.classes = [new_class if c.get("name") == payload.class_name else c for c in current_classes]
                await db.commit()
                await db.refresh(ont)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"重新分析失败: {e}")
    else:
        # 重新分析整个本体
        table_desc = "\n".join(
            [f"  类 {c.get('name', '')}: {[p.get('name','') for p in c.get('properties',[])]}" for c in current_classes]
        )
        prompt = (
            f"根据用户描述，重新生成本体类定义。\n"
            f"当前本体类:\n{table_desc}\n"
            f"用户描述: {payload.description}\n\n"
            f"返回重新生成的类定义JSON数组:\n"
            f'[{{"name": "ClassName", "label": "中文标签", "description": "描述", "properties": [{{"name": "prop", "type": "type", "confidence": 0.9}}], "parent": null}}]'
        )
        try:
            new_classes = await llm_chat_json(prompt)
            if isinstance(new_classes, list):
                ont.classes = new_classes
                await db.commit()
                await db.refresh(ont)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"重新分析失败: {e}")

    return _ont_to_response(ont)

# ── 生成中文名称和描述 ─────────────────────
@router.post("/{ontology_id}/generate-label")
async def generate_label(ontology_id: str, payload: GenerateLabelRequest):
    """根据英文属性名称，调用大模型生成中文名称和描述。"""
    from ..core.llm import llm_chat_json

    prompt = (
        f"根据英文字段名称，生成合适的中文名称和描述。\n"
        f"英文名称: {payload.name}\n\n"
        f"要求:\n"
        f"- 中文名称: 简短，2-4个字，准确反映字段含义\n"
        f"- 描述: 简要说明该字段的业务含义，不超过30字\n\n"
        f'只返回JSON: {{"label": "中文名称", "description": "描述"}}'
    )
    try:
        result = await llm_chat_json(prompt)
        return {"label": result.get("label", payload.name), "description": result.get("description", "")}
    except Exception:
        return {"label": payload.name, "description": ""}


# ── 智能问答 ───────────────────────────────
@router.post("/{ontology_id}/chat", response_model=ChatResponse)
async def chat(ontology_id: str, payload: ChatRequest):
    ont_check_needed = True  # 简化：直接调用
    result = await answer_question(ontology_id, payload.question, payload.history)
    return ChatResponse(**result)


# ── 获取生成的 API 列表 ────────────────────
@router.get("/{ontology_id}/apis")
async def get_apis(ontology_id: str, db: AsyncSession = Depends(get_db)):
    apis = await get_generated_apis(db, ontology_id)
    return [{"id": a.id, "path": a.path, "method": a.method, "description": a.description} for a in apis]


# ── 动态实体查询 ──────────────────────────
@router.get("/{ontology_id}/entities")
async def query_entities(ontology_id: str, class_name: str | None = None, limit: int = 50):
    """从 Neo4j 查询实体。"""
    from ..core.neo4j_client import get_neo4j_driver

    driver = get_neo4j_driver()
    try:
        async with driver.session() as session:
            if class_name:
                query = f"MATCH (n:{class_name} {{_ontology_id: $oid}}) RETURN n LIMIT $limit"
            else:
                query = "MATCH (n {_ontology_id: $oid}) RETURN n LIMIT $limit"
            result = await session.run(query, {"oid": ontology_id, "limit": limit})
            records = await result.data()
            entities = []
            for r in records:
                node = r.get("n", {})
                entities.append(dict(node))
            return {"entities": entities, "count": len(entities)}
    except Exception as e:
        return {"entities": [], "count": 0, "error": str(e)}


# ── 语义搜索 ──────────────────────────────
@router.post("/{ontology_id}/search")
async def semantic_search(ontology_id: str, payload: dict):
    """向量语义搜索。"""
    from ..core.milvus_client import get_milvus_client, COLLECTION_NAME
    from ..core.embedding import embed_text

    query = payload.get("query", "")
    top_k = payload.get("top_k", 5)
    try:
        vec = await embed_text(query)
        milvus = get_milvus_client()
        results = milvus.search(
            collection_name=COLLECTION_NAME,
            data=[vec],
            limit=top_k,
            filter=f'ontology_id == "{ontology_id}"',
            output_fields=["content", "entity_type"],
        )
        hits = []
        if results and results[0]:
            for hit in results[0]:
                hits.append({"id": hit["id"], "score": hit.get("distance", 0), **hit.get("entity", {})})
        return {"results": hits}
    except Exception as e:
        return {"results": [], "error": str(e)}


# ── 图谱查询 ──────────────────────────────
@router.post("/{ontology_id}/graph-query")
async def graph_query(ontology_id: str, payload: dict):
    """执行 Cypher 查询。"""
    from ..core.neo4j_client import get_neo4j_driver

    cypher = payload.get("cypher", "")
    if not cypher:
        return {"error": "cypher is required"}
    driver = get_neo4j_driver()
    try:
        async with driver.session() as session:
            result = await session.run(cypher, {"oid": ontology_id})
            data = await result.data()
            return {"results": data[:50]}
    except Exception as e:
        return {"error": str(e)}


# ── 图拓扑数据（前端可视化） ───────────────
@router.get("/{ontology_id}/graph")
async def get_graph(ontology_id: str):
    """返回图可视化所需的 nodes + edges。"""
    from ..core.neo4j_client import get_neo4j_driver

    driver = get_neo4j_driver()
    try:
        nodes, edges = [], []
        async with driver.session() as session:
            # 节点
            result = await session.run(
                "MATCH (n {_ontology_id: $oid}) RETURN n, labels(n) AS labels LIMIT 100",
                {"oid": ontology_id}
            )
            node_records = await result.data()
            node_ids = set()
            for r in node_records:
                node = dict(r["n"])
                nid = node.get("_id", str(id(r)))
                if nid not in node_ids:
                    node_ids.add(nid)
                    labels = [l for l in r.get("labels", []) if not l.startswith("_")]
                    nodes.append({"id": nid, "label": labels[0] if labels else "Node", "data": node})

            # 关系
            result2 = await session.run(
                "MATCH (a {_ontology_id: $oid})-[r]->(b {_ontology_id: $oid}) "
                "RETURN a._id AS src, b._id AS tgt, type(r) AS rel LIMIT 200",
                {"oid": ontology_id}
            )
            edge_records = await result2.data()
            for r in edge_records:
                edges.append({"source": r["src"], "target": r["tgt"], "label": r["rel"]})

        return {"nodes": nodes, "edges": edges}
    except Exception as e:
        return {"nodes": [], "edges": [], "error": str(e)}



def _generate_openapi_spec(ontologies: list) -> dict:
    """根据本体列表生成 OpenAPI 3.0 接口文档。"""
    paths: dict = {}
    for ont in ontologies:
        base     = f"/ontologies/{ont.id}"
        ont_name = ont.name

        paths[f"{base}/entities"] = {
            "get": {
                "tags": [ont_name],
                "summary": f"查询 {ont_name} 的实体",
                "parameters": [
                    {"name": "class_name", "in": "query", "required": False, "schema": {"type": "string"}, "description": "按实体类过滤"},
                    {"name": "limit",      "in": "query", "required": False, "schema": {"type": "integer", "default": 50}},
                ],
                "responses": {"200": {"description": "实体列表"}},
            }
        }
        paths[f"{base}/search"] = {
            "post": {
                "tags": [ont_name],
                "summary": f"语义搜索 {ont_name}",
                "requestBody": {"content": {"application/json": {"schema": {
                    "type": "object",
                    "properties": {"query": {"type": "string"}, "top_k": {"type": "integer", "default": 5}},
                }}}},
                "responses": {"200": {"description": "搜索结果"}},
            }
        }
        paths[f"{base}/graph-query"] = {
            "post": {
                "tags": [ont_name],
                "summary": f"Cypher 图谱查询 {ont_name}",
                "requestBody": {"content": {"application/json": {"schema": {
                    "type": "object",
                    "properties": {"cypher": {"type": "string"}},
                }}}},
                "responses": {"200": {"description": "查询结果"}},
            }
        }
        paths[f"{base}/graph"] = {
            "get": {
                "tags": [ont_name],
                "summary": f"获取 {ont_name} 图拓扑数据",
                "responses": {"200": {"description": "节点和边"}},
            }
        }
        paths[f"{base}/chat"] = {
            "post": {
                "tags": [ont_name],
                "summary": f"智能问答 - {ont_name}",
                "requestBody": {"content": {"application/json": {"schema": {
                    "type": "object",
                    "properties": {"question": {"type": "string"}, "history": {"type": "array", "items": {"type": "object"}}},
                }}}},
                "responses": {"200": {"description": "回答内容"}},
            }
        }
        for cls in (ont.classes or []):
            class_name = cls.get("name", "")
            if class_name:
                paths[f"{base}/entities/{class_name}"] = {
                    "get": {
                        "tags": [ont_name],
                        "summary": f"查询 {class_name} 实体",
                        "responses": {"200": {"description": f"{class_name} 实体列表"}},
                    }
                }

    # Q&A session 端点
    paths["/qa/sessions/{session_id}/chat"] = {
        "post": {
            "tags": ["智能问答应用"],
            "summary": "Q&A 会话问答（需 X-API-Key header 认证）",
            "parameters": [{"name": "session_id", "in": "path", "required": True, "schema": {"type": "string"}}],
            "requestBody": {"content": {"application/json": {"schema": {
                "type": "object",
                "properties": {"question": {"type": "string"}, "history": {"type": "array"}},
            }}}},
            "responses": {"200": {"description": "回答内容"}},
        }
    }

    return {
        "openapi": "3.0.3",
        "info": {
            "title":       "Ontology Agent - 本体查询 API",
            "version":     "1.0.0",
            "description": "多模态本体编排平台自动生成的接口文档",
        },
        "servers": [{"url": "/api/v1", "description": "本地服务"}],
        "paths": paths,
    }


# ── 序列化 ────────────────────────────────
def _ont_to_response(ont) -> OntologyResponse:
    return OntologyResponse(
        id=ont.id, name=ont.name, description=ont.description or "",
        status=ont.status.value, data_source_id=ont.data_source_id,
        classes=ont.classes or [], relations=ont.relations or [],
        instances_count=ont.instances_count or 0,
        created_at=ont.created_at, updated_at=ont.updated_at,
    )
