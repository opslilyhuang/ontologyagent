"""关系推断引擎 — 从外键约束、命名约定和数据分布推断本体关系。"""
import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from ..adapters.base import TableSchema


class RelationType(str, Enum):
    ONE_TO_ONE = "one_to_one"
    ONE_TO_MANY = "one_to_many"
    MANY_TO_ONE = "many_to_one"
    MANY_TO_MANY = "many_to_many"


@dataclass
class OntologyRelation:
    source_class: str
    target_class: str
    relation_name: str
    relation_type: RelationType
    source_property: str
    target_property: str
    inferred_from: str          # foreign_key | naming | distribution | junction_table
    confidence: float
    cardinality: str            # "1..1" | "1..n" | "n..1" | "n..n"
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "source_class": self.source_class,
            "target_class": self.target_class,
            "relation_name": self.relation_name,
            "relation_type": self.relation_type.value,
            "source_property": self.source_property,
            "target_property": self.target_property,
            "inferred_from": self.inferred_from,
            "confidence": self.confidence,
            "cardinality": self.cardinality,
            "metadata": self.metadata,
        }


# 命名约定正则
_ID_SUFFIXES = re.compile(r"^(.+?)_?(?:id|Id|ID)$")
_ID_PREFIXES = re.compile(r"^(?:id_|Id_|ID_)(.+)$")

# 多对多关联表特征词
_M2M_KEYWORDS = ("_to_", "_2_", "_map", "_link", "_relation", "_pivot", "_junction")


def _table_name_to_class(name: str) -> str:
    """snake_case 表名 → PascalCase 类名。"""
    return "".join(word.capitalize() for word in name.split("_"))


class RelationInferenceEngine:

    def __init__(self, tables: list[TableSchema]):
        self.tables = tables
        self._table_map: dict[str, TableSchema] = {t.table_name: t for t in tables}

    def infer_all(self) -> list[OntologyRelation]:
        relations: list[OntologyRelation] = []

        for table in self.tables:
            # 1. 外键约束推断 (置信度最高)
            relations.extend(self._infer_from_foreign_keys(table))

            # 2. 命名约定推断
            relations.extend(self._infer_from_naming(table))

        # 3. 多对多关联表检测
        relations.extend(self._detect_many_to_many())

        # 4. 去重
        return self._deduplicate(relations)

    # ── 1. 外键推断 ────────────────────────
    def _infer_from_foreign_keys(self, table: TableSchema) -> list[OntologyRelation]:
        results = []
        pk_set = set(table.primary_keys)

        for fk in table.foreign_keys:
            col = fk["column"]
            ref_table = fk["references_table"]
            ref_col = fk["references_column"]

            if ref_table not in self._table_map:
                continue

            ref_schema = self._table_map[ref_table]

            # 判断关系类型
            fk_is_unique = col in pk_set  # 外键列是否为主键（近似唯一约束）
            ref_is_pk = ref_col in set(ref_schema.primary_keys)

            if fk_is_unique and ref_is_pk:
                rel_type = RelationType.ONE_TO_ONE
                card = "1..1"
            else:
                rel_type = RelationType.MANY_TO_ONE
                card = "n..1"

            # 关系名：target + 动词
            verb = "belongs_to" if rel_type == RelationType.MANY_TO_ONE else "has"
            relation_name = f"{verb}_{ref_table}"

            results.append(OntologyRelation(
                source_class=_table_name_to_class(table.table_name),
                target_class=_table_name_to_class(ref_table),
                relation_name=relation_name,
                relation_type=rel_type,
                source_property=col,
                target_property=ref_col,
                inferred_from="foreign_key",
                confidence=0.95,
                cardinality=card,
            ))
        return results

    # ── 2. 命名约定推断 ────────────────────
    def _infer_from_naming(self, table: TableSchema) -> list[OntologyRelation]:
        results = []
        for col_info in table.columns:
            col = col_info.name
            # 跳过已由外键覆盖的列
            if any(fk["column"] == col for fk in table.foreign_keys):
                continue

            # 匹配 xxx_id 或 id_xxx
            match = _ID_SUFFIXES.match(col) or _ID_PREFIXES.match(col)
            if not match:
                continue
            candidate_table = match.group(1).lower()

            # 在表列表中查找
            target = None
            for t in self.tables:
                if t.table_name.lower() in (candidate_table, candidate_table + "s", candidate_table.rstrip("s")):
                    target = t
                    break
            if target is None or target.table_name == table.table_name:
                continue

            results.append(OntologyRelation(
                source_class=_table_name_to_class(table.table_name),
                target_class=_table_name_to_class(target.table_name),
                relation_name=f"belongs_to_{target.table_name}",
                relation_type=RelationType.MANY_TO_ONE,
                source_property=col,
                target_property=target.primary_keys[0] if target.primary_keys else "id",
                inferred_from="naming",
                confidence=0.7,
                cardinality="n..1",
            ))
        return results

    # ── 3. 多对多关联表检测 ─────────────────
    def _detect_many_to_many(self) -> list[OntologyRelation]:
        results = []
        for table in self.tables:
            name_lower = table.table_name.lower()

            # 特征1: 表名包含关联词
            has_keyword = any(kw in name_lower for kw in _M2M_KEYWORDS)

            # 特征2: 恰好两个外键
            fks = table.foreign_keys
            has_two_fks = len(fks) == 2

            # 特征3: 外键组成联合主键 (近似判断)
            fk_cols = {fk["column"] for fk in fks}
            is_composite_pk = fk_cols == set(table.primary_keys) if table.primary_keys else False

            if has_two_fks and (has_keyword or is_composite_pk):
                fk_a, fk_b = fks[0], fks[1]
                ref_a, ref_b = fk_a["references_table"], fk_b["references_table"]
                if ref_a not in self._table_map or ref_b not in self._table_map:
                    continue

                # 额外属性（非外键列）
                extra_props = [c.name for c in table.columns if c.name not in fk_cols]

                confidence = 0.9 if (has_keyword and is_composite_pk) else 0.75

                results.append(OntologyRelation(
                    source_class=_table_name_to_class(ref_a),
                    target_class=_table_name_to_class(ref_b),
                    relation_name=f"related_to_{ref_b}",
                    relation_type=RelationType.MANY_TO_MANY,
                    source_property=fk_a["column"],
                    target_property=fk_b["column"],
                    inferred_from="junction_table",
                    confidence=confidence,
                    cardinality="n..n",
                    metadata={
                        "junction_table": table.table_name,
                        "is_composite_pk": is_composite_pk,
                        "extra_properties": extra_props,
                        "has_extra_properties": len(extra_props) > 0,
                    },
                ))
        return results

    # ── 去重 ─────────────────────────────
    def _deduplicate(self, relations: list[OntologyRelation]) -> list[OntologyRelation]:
        """按 (source, target, source_property) 去重，保留置信度最高的。"""
        seen: dict[tuple, OntologyRelation] = {}
        for rel in relations:
            key = (rel.source_class, rel.target_class, rel.source_property)
            if key not in seen or rel.confidence > seen[key].confidence:
                seen[key] = rel
        return list(seen.values())
