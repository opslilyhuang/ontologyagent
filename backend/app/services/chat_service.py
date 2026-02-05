"""智能问答服务 — NL→Cypher + 向量混合检索。"""
from typing import Any

from ..core.llm import llm_chat, llm_chat_json
from ..core.neo4j_client import get_neo4j_driver
from ..core.milvus_client import get_milvus_client, COLLECTION_NAME
from ..core.embedding import embed_text


async def answer_question(ontology_id: str, question: str, history: list[dict[str, str]] | None = None) -> dict[str, Any]:
    """
    混合检索策略:
      1. 向量检索 → 找到语义相似的实体/文档
      2. LLM 判断是否需要图谱查询 → 生成 Cypher
      3. 合并结果 → LLM 生成答案
    """
    # ── Step 1: 向量检索 ──
    vector_results = await _vector_search(ontology_id, question, top_k=5)

    # ── Step 2: LLM 判断 + 生成 Cypher ──
    cypher_query = None
    graph_results: list[dict] = []

    # 获取本体 schema 用于 Cypher 生成
    from sqlalchemy.ext.asyncio import AsyncSession
    # 简化：直接用 LLM 生成 Cypher
    schema_summary = await _get_ontology_schema_summary(ontology_id)

    if schema_summary:
        cypher_query = await _generate_cypher(question, schema_summary, ontology_id)
        if cypher_query:
            graph_results = await _run_cypher(cypher_query, ontology_id)

    # ── Step 3: 合并 + 生成答案 ──
    answer = await _generate_answer(question, vector_results, graph_results, history)

    sources = []
    for vr in vector_results:
        sources.append({"type": "vector", "content": vr.get("content", "")[:200], "entity_type": vr.get("entity_type", "")})
    for gr in graph_results[:3]:
        sources.append({"type": "graph", "content": str(gr)[:200]})

    return {
        "answer": answer,
        "sources": sources,
        "cypher_query": cypher_query,
    }


# ── 向量检索 ─────────────────────────────────
async def _vector_search(ontology_id: str, query: str, top_k: int = 5) -> list[dict[str, Any]]:
    try:
        query_vector = await embed_text(query)
        milvus = get_milvus_client()
        results = milvus.search(
            collection_name=COLLECTION_NAME,
            data=[query_vector],
            limit=top_k,
            filter=f'ontology_id == "{ontology_id}"',
            output_fields=["content", "entity_type", "source_id"],
        )
        hits = []
        if results and results[0]:
            for hit in results[0]:
                hits.append({
                    "id": hit["id"],
                    "content": hit.get("entity", {}).get("content", ""),
                    "entity_type": hit.get("entity", {}).get("entity_type", ""),
                    "score": hit.get("distance", 0),
                })
        return hits
    except Exception as e:
        # Milvus 可能未就绪
        return []


# ── 图谱查询 ──────────────────────────────────
async def _get_ontology_schema_summary(ontology_id: str) -> str:
    """从 Neo4j 获取本体的标签和关系类型概述。"""
    try:
        driver = get_neo4j_driver()
        async with driver.session() as session:
            # 获取所有节点 label
            result = await session.run(
                "MATCH (n) WHERE n._ontology_id = $oid RETURN DISTINCT labels(n) AS labels LIMIT 20",
                {"oid": ontology_id}
            )
            records = await result.data()
            labels = set()
            for r in records:
                for label_list in r.get("labels", []):
                    if isinstance(label_list, list):
                        labels.update(label_list)
                    else:
                        labels.add(label_list)
            labels.discard("_meta")

            # 获取关系类型
            result2 = await session.run(
                "MATCH ()-[r]->() WHERE r._ontology_id = $oid RETURN DISTINCT type(r) AS rel_type LIMIT 20",
                {"oid": ontology_id}
            )
            rel_records = await result2.data()
            rel_types = [r["rel_type"] for r in rel_records]

        return f"节点类型: {list(labels)}\n关系类型: {rel_types}"
    except Exception:
        return ""


async def _generate_cypher(question: str, schema_summary: str, ontology_id: str) -> str | None:
    """用 LLM 生成 Cypher 查询。"""
    prompt = f"""根据用户问题和图谱 schema，生成 Cypher 查询语句。
如果问题不适合用图谱查询，直接返回 "NO_QUERY"。

图谱 Schema:
{schema_summary}

所有节点都有属性 _ontology_id = "{ontology_id}"，查询时必须加此过滤。

用户问题: {question}

只返回 Cypher 语句本身，不加任何解释。如果不需要图查询返回 NO_QUERY。"""

    try:
        cypher = await llm_chat(prompt, temperature=0.1)
        cypher = cypher.strip().strip("```").strip("cypher").strip()
        if cypher.upper() == "NO_QUERY" or not cypher:
            return None
        return cypher
    except Exception:
        return None


async def _run_cypher(cypher: str, ontology_id: str) -> list[dict]:
    """执行 Cypher 查询。"""
    try:
        driver = get_neo4j_driver()
        async with driver.session() as session:
            result = await session.run(cypher)
            records = await result.data()
            return records[:20]  # 限制返回数量
    except Exception as e:
        return [{"error": str(e)}]


# ── 生成答案 ─────────────────────────────────
async def _generate_answer(
    question: str,
    vector_results: list[dict],
    graph_results: list[dict],
    history: list[dict[str, str]] | None = None,
) -> str:
    context_parts = []
    if vector_results:
        context_parts.append("向量检索结果:\n" + "\n".join(
            f"  - [{r.get('entity_type', '')}] {r.get('content', '')}" for r in vector_results
        ))
    if graph_results:
        context_parts.append("图谱查询结果:\n" + "\n".join(
            f"  - {r}" for r in graph_results[:5]
        ))

    context = "\n".join(context_parts) if context_parts else "未找到相关信息。"

    # 构建对话历史
    history_text = ""
    if history:
        history_text = "\n".join(f"{m['role']}: {m['content']}" for m in history[-4:])
        history_text = f"\n历史对话:\n{history_text}\n"

    prompt = f"""你是一个知识本体智能助手。根据以下检索到的信息回答用户问题。
如果信息不足，请诚实说明。回答要简洁准确。

检索信息:
{context}
{history_text}
用户问题: {question}
"""
    return await llm_chat(prompt, system="你是一个知识图谱智能问答助手，回答要准确简洁。")
