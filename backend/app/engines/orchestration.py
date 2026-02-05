"""
核心编排引擎 — 五阶段流程：
  Stage 1: 数据理解   (Schema 提取 + 采样)
  Stage 2: 实体识别   (类型推断 + NER)
  Stage 3: 关系发现   (外键/命名/分布推断)
  Stage 4: 本体生成   (类层次 + 属性 + 关系 → JSON-LD)
  Stage 5: 数据实例化  (Neo4j 建图 + Milvus 向量化)
"""
from __future__ import annotations

import logging
import time
from typing import Any

from ..adapters.base import DataAdapter, TableSchema
from ..adapters.file_adapter import FileAdapter
from ..adapters.database_adapter import DatabaseAdapter
from ..adapters.api_adapter import APIAdapter
from .type_inference import infer_all_columns, calculate_sample_size
from .relation_inference import RelationInferenceEngine

logger = logging.getLogger(__name__)

STAGES = ["data_understanding", "entity_recognition", "relation_discovery", "ontology_generation", "data_instantiation"]


def build_adapter(source_config: dict[str, Any]) -> DataAdapter:
    """根据数据源 config 构建适配器。"""
    src_type = source_config.get("type", "file")
    if src_type == "database":
        return DatabaseAdapter(source_config)
    elif src_type == "api":
        return APIAdapter(source_config)
    return FileAdapter(source_config)


class OrchestrationEngine:
    """编排引擎 — 可异步调用每个阶段。"""

    def __init__(self, data_source_id: str, config: dict[str, Any]):
        self.data_source_id = data_source_id
        self.config = config
        self.adapter: DataAdapter = build_adapter(config)
        self.state: dict[str, Any] = {}  # 贯穿各阶段的共享状态

    # ─────────────────────────────────────────
    # Stage 1: 数据理解
    # ─────────────────────────────────────────
    async def stage_data_understanding(self) -> dict[str, Any]:
        logger.info("Stage 1: 数据理解 — 提取 Schema & 采样")
        schemas: list[TableSchema] = await self.adapter.extract_schema()

        tables_info = []
        for schema in schemas:
            sample_size = calculate_sample_size(max(schema.row_count, 1))
            samples = await self.adapter.sample_data(schema.table_name, limit=sample_size)
            tables_info.append({
                "table_name": schema.table_name,
                "columns": [{"name": c.name, "original_type": c.original_type, "nullable": c.nullable, "is_pk": c.is_primary_key} for c in schema.columns],
                "primary_keys": schema.primary_keys,
                "foreign_keys": schema.foreign_keys,
                "row_count": schema.row_count,
                "samples": samples,
            })

        self.state["tables_info"] = tables_info
        self.state["schemas"] = schemas
        logger.info(f"Stage 1 完成: {len(tables_info)} 张表")
        return {"tables_count": len(tables_info), "tables": [t["table_name"] for t in tables_info]}

    # ─────────────────────────────────────────
    # Stage 2: 实体识别（类型推断）
    # ─────────────────────────────────────────
    async def stage_entity_recognition(self) -> dict[str, Any]:
        logger.info("Stage 2: 实体识别 — 智能类型推断")
        tables_info = self.state["tables_info"]
        inferred_tables = []

        for table in tables_info:
            type_results = infer_all_columns(
                table_name=table["table_name"],
                sample_rows=table["samples"],
                original_columns=table["columns"],
            )
            inferred_tables.append({
                "table_name": table["table_name"],
                "type_inference": type_results,
                "primary_keys": table["primary_keys"],
                "foreign_keys": table["foreign_keys"],
                "row_count": table["row_count"],
            })

        self.state["inferred_tables"] = inferred_tables

        # 对非结构化文本尝试 LLM 实体提取
        text_tables = [t for t in inferred_tables if any(
            col["inferred_type"] in ("text", "longtext") for col in t["type_inference"]
        )]
        ner_entities: list[dict] = []
        if text_tables:
            ner_entities = await self._extract_entities_llm(tables_info, text_tables)

        self.state["ner_entities"] = ner_entities
        logger.info(f"Stage 2 完成: {len(inferred_tables)} 表推断, {len(ner_entities)} 实体提取")
        return {"inferred_tables_count": len(inferred_tables), "ner_entities_count": len(ner_entities)}

    async def _extract_entities_llm(self, tables_info: list, text_tables: list) -> list[dict]:
        """用 LLM 从文本列中提取命名实体。"""
        from ..core.llm import llm_chat_json

        # 取前3个文本列的样本作为输入
        sample_texts = []
        for t in text_tables[:3]:
            tbl_samples = next((ti["samples"] for ti in tables_info if ti["table_name"] == t["table_name"]), [])
            for col_info in t["type_inference"]:
                if col_info["inferred_type"] in ("text", "longtext"):
                    for row in tbl_samples[:2]:
                        val = str(row.get(col_info["column_name"], ""))
                        if val and len(val) > 20:
                            sample_texts.append(val[:500])

        if not sample_texts:
            return []

        prompt = f"""从以下文本中提取命名实体，返回JSON数组格式：
[{{"entity": "实体名", "type": "实体类型(Person/Organization/Location/Product/Event/Other)", "context": "出现上下文"}}]

文本：
{chr(10).join(sample_texts[:5])}
"""
        try:
            entities = await llm_chat_json(prompt)
            return entities if isinstance(entities, list) else []
        except Exception as e:
            logger.warning(f"NER LLM 调用失败: {e}")
            return []

    # ─────────────────────────────────────────
    # Stage 3: 关系发现
    # ─────────────────────────────────────────
    async def stage_relation_discovery(self) -> dict[str, Any]:
        logger.info("Stage 3: 关系发现")
        schemas = self.state["schemas"]
        engine = RelationInferenceEngine(schemas)
        relations = engine.infer_all()
        self.state["relations"] = relations
        logger.info(f"Stage 3 完成: {len(relations)} 条关系")
        return {"relations_count": len(relations), "relations": [r.to_dict() for r in relations]}

    # ─────────────────────────────────────────
    # Stage 4: 本体生成
    # ─────────────────────────────────────────
    async def stage_ontology_generation(self) -> dict[str, Any]:
        logger.info("Stage 4: 本体生成")
        inferred_tables = self.state["inferred_tables"]
        relations = self.state["relations"]
        ner_entities = self.state.get("ner_entities", [])

        # 用 LLM 辅助生成本体类层次
        classes = await self._generate_ontology_classes(inferred_tables, ner_entities)
        ontology = {
            "classes": classes,
            "relations": [r.to_dict() for r in relations],
            "ner_entities": ner_entities,
        }
        self.state["ontology"] = ontology
        logger.info(f"Stage 4 完成: {len(classes)} 类, {len(relations)} 关系")
        return ontology

    async def _generate_ontology_classes(self, inferred_tables: list, ner_entities: list) -> list[dict]:
        """生成本体类定义。"""
        from ..core.llm import llm_chat_json

        # 构建表描述
        table_desc = []
        for t in inferred_tables:
            cols = [f"{c['column_name']}({c['inferred_type']})" for c in t["type_inference"]]
            table_desc.append(f"  表 {t['table_name']}: {', '.join(cols)}")

        # 实体类型描述
        entity_types = list(set(e.get("type", "Other") for e in ner_entities)) if ner_entities else []

        prompt = f"""根据以下数据库表结构和实体信息，生成本体类定义。
返回JSON数组，每个元素包含: name(PascalCase类名), label(中文标签), description(描述), properties(属性数组), parent(父类或null)。

数据库表:
{chr(10).join(table_desc)}

已识别实体类型: {entity_types}

要求:
1. 每个表对应一个类
2. 实体类型如果有意义也生成类
3. properties 保留类型推断的信息
4. 建立合理的类层次关系

返回格式示例:
[{{"name": "User", "label": "用户", "description": "系统用户", "properties": [{{"name": "email", "type": "email"}}], "parent": null}}]
"""
        try:
            classes = await llm_chat_json(prompt)
            # 如果 LLM 返回不满意，回退到基本生成
            if not isinstance(classes, list):
                classes = []
        except Exception as e:
            logger.warning(f"LLM 本体生成失败: {e}，回退到规则生成")
            classes = []

        # 回退/补充：确保每个表至少有一个类
        existing_names = {c.get("name", "") for c in classes}
        for t in inferred_tables:
            from .relation_inference import _table_name_to_class
            class_name = _table_name_to_class(t["table_name"])
            if class_name not in existing_names:
                properties = []
                for col in t["type_inference"]:
                    properties.append({
                        "name": col["column_name"],
                        "type": col["inferred_type"],
                        "confidence": col["confidence"],
                        "storage_type": col["storage_type"],
                    })
                classes.append({
                    "name": class_name,
                    "label": t["table_name"],
                    "description": f"来源表: {t['table_name']}",
                    "properties": properties,
                    "parent": None,
                })
        return classes

    # ─────────────────────────────────────────
    # Stage 5: 数据实例化
    # ─────────────────────────────────────────
    async def stage_data_instantiation(self, ontology_id: str) -> dict[str, Any]:
        """将数据写入 Neo4j + Milvus。"""
        logger.info("Stage 5: 数据实例化")
        ontology = self.state["ontology"]
        tables_info = self.state["tables_info"]
        classes = ontology["classes"]
        relations = ontology["relations"]

        from ..core.neo4j_client import get_neo4j_driver
        from ..core.milvus_client import get_milvus_client, ensure_collection, COLLECTION_NAME
        from ..core.embedding import embed_texts

        driver = get_neo4j_driver()
        ensure_collection()
        milvus = get_milvus_client()

        total_nodes = 0
        total_edges = 0
        embedding_records: list[dict] = []
        texts_to_embed: list[str] = []
        record_meta: list[dict] = []  # 对应 texts_to_embed

        # ── 建 Neo4j 节点 & 收集 embedding ──
        for table_info in tables_info:
            table_name = table_info["table_name"]
            # 找对应类
            from .relation_inference import _table_name_to_class
            class_name = _table_name_to_class(table_name)
            class_def = next((c for c in classes if c["name"] == class_name), None)
            if not class_def:
                continue

            samples = table_info["samples"]
            import uuid as _uuid

            # 批量写入 Neo4j
            async with driver.session() as session:
                for row in samples:
                    node_id = str(_uuid.uuid4())
                    props = {k: str(v) if v is not None else "" for k, v in row.items()}
                    props["_id"] = node_id
                    props["_ontology_id"] = ontology_id

                    query = f"CREATE (n:{class_name} {{_id: $id, _ontology_id: $oid"
                    for key in props:
                        if key not in ("_id", "_ontology_id"):
                            query += f", `{key}`: ${key}"
                    query += "})"
                    await session.run(query, {"id": node_id, "oid": ontology_id, **props})
                    total_nodes += 1

                    # 用于 embedding 的文本
                    text_repr = " ".join(f"{k}={v}" for k, v in row.items() if v)
                    texts_to_embed.append(text_repr)
                    record_meta.append({"id": node_id, "ontology_id": ontology_id, "entity_type": class_name, "content": text_repr})

            # ── 建关系 ──
            # 简化：对样本数据用外键列匹配建边
            for rel in relations:
                if rel["source_class"] != class_name:
                    continue
                src_prop = rel["source_property"]
                tgt_class = rel["target_class"]
                tgt_prop = rel["target_property"]
                rel_name = rel["relation_name"].upper().replace(" ", "_")

                async with driver.session() as session:
                    for row in samples:
                        fk_val = str(row.get(src_prop, ""))
                        if not fk_val:
                            continue
                        cypher = (
                            f"MATCH (a:{class_name} {{`{src_prop}`: $fk_val, _ontology_id: $oid}}) "
                            f"MATCH (b:{tgt_class} {{`{tgt_prop}`: $fk_val, _ontology_id: $oid}}) "
                            f"MERGE (a)-[r:{rel_name}]->(b)"
                        )
                        await session.run(cypher, {"fk_val": fk_val, "oid": ontology_id})
                        total_edges += 1

        # ── Milvus embedding ──
        if texts_to_embed:
            # 分批 embed
            BATCH = 64
            import time as _time
            for i in range(0, len(texts_to_embed), BATCH):
                batch_texts = texts_to_embed[i:i + BATCH]
                batch_meta = record_meta[i:i + BATCH]
                vectors = await embed_texts(batch_texts)

                milvus_data = []
                for meta, vec in zip(batch_meta, vectors):
                    milvus_data.append({
                        "id": meta["id"],
                        "ontology_id": meta["ontology_id"],
                        "content": meta["content"][:4096],
                        "embedding": vec,
                        "entity_type": meta["entity_type"],
                        "source_id": self.data_source_id,
                        "created_at": int(_time.time() * 1000),
                    })
                milvus.insert(collection_name=COLLECTION_NAME, data=milvus_data)

        logger.info(f"Stage 5 完成: {total_nodes} 节点, {total_edges} 边")
        return {"nodes": total_nodes, "edges": total_edges, "embeddings": len(texts_to_embed)}

    # ─────────────────────────────────────────
    # 全流程执行
    # ─────────────────────────────────────────
    async def run_full_pipeline(self, ontology_id: str) -> dict[str, Any]:
        """执行完整编排流程，返回各阶段结果。"""
        results: dict[str, Any] = {}
        for stage_name in STAGES:
            logger.info(f">>> 开始阶段: {stage_name}")
            start = time.time()
            try:
                if stage_name == "data_understanding":
                    results[stage_name] = await self.stage_data_understanding()
                elif stage_name == "entity_recognition":
                    results[stage_name] = await self.stage_entity_recognition()
                elif stage_name == "relation_discovery":
                    results[stage_name] = await self.stage_relation_discovery()
                elif stage_name == "ontology_generation":
                    results[stage_name] = await self.stage_ontology_generation()
                elif stage_name == "data_instantiation":
                    results[stage_name] = await self.stage_data_instantiation(ontology_id)
                elapsed = time.time() - start
                logger.info(f"<<< 阶段 {stage_name} 完成 ({elapsed:.2f}s)")
            except Exception as e:
                logger.error(f"阶段 {stage_name} 失败: {e}", exc_info=True)
                results[stage_name] = {"error": str(e)}
                raise
        return results
