"""智能类型推断引擎 — 基于采样数据推断列真实类型。"""
import re
import math
from dataclasses import dataclass, field
from typing import Any


SAMPLING_RATIO = 0.1
MIN_SAMPLE_SIZE = 100
MAX_SAMPLE_SIZE = 10000

TYPE_TO_STORAGE: dict[str, str] = {
    "boolean":  "BOOLEAN",
    "int32":    "INTEGER",
    "int64":    "BIGINT",
    "float64":  "DOUBLE PRECISION",
    "decimal":  "DECIMAL(38,{decimals})",
    "date":     "DATE",
    "datetime": "TIMESTAMP",
    "uuid":     "UUID",
    "email":    "VARCHAR(320)",
    "url":      "TEXT",
    "ip_address": "VARCHAR(45)",
    "json":     "JSONB",
    "enum":     "VARCHAR(100)",
    "varchar":  "VARCHAR(255)",
    "text":     "TEXT",
    "longtext": "TEXT",
}

# 正则
_RE_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
_RE_EMAIL = re.compile(r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$")
_RE_URL = re.compile(r"^https?://[^\s<>\"]+$", re.I)
_RE_IP = re.compile(r"^(\d{1,3}\.){3}\d{1,3}$")
_RE_INT = re.compile(r"^-?\d+$")
_RE_FLOAT = re.compile(r"^-?\d+\.\d+$")
_BOOL_VALUES = {"true", "false", "1", "0", "yes", "no", "y", "n", "是", "否"}

_DATE_FORMATS = [
    r"^\d{4}-\d{2}-\d{2}$",
    r"^\d{4}/\d{2}/\d{2}$",
    r"^\d{2}/\d{2}/\d{4}$",
    r"^\d{2}-\d{2}-\d{4}$",
]
_DATETIME_FORMATS = [
    r"^\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}(:\d{2})?",
    r"^\d{4}/\d{2}/\d{2}[\sT]\d{2}:\d{2}(:\d{2})?",
]


@dataclass
class TypeInferenceResult:
    column_name: str
    inferred_type: str
    confidence: float
    original_type: str
    storage_type: str
    metadata: dict[str, Any] = field(default_factory=dict)


def calculate_sample_size(total_rows: int) -> int:
    n = max(MIN_SAMPLE_SIZE, int(total_rows * SAMPLING_RATIO))
    return min(n, MAX_SAMPLE_SIZE)


def _match_ratio(values: list[str], pattern) -> float:
    """计算匹配率。"""
    if not values:
        return 0.0
    matched = sum(1 for v in values if pattern(v))
    return matched / len(values)


def _is_bool(v: str) -> bool:
    return v.strip().lower() in _BOOL_VALUES


def _is_uuid(v: str) -> bool:
    return bool(_RE_UUID.match(v.strip()))


def _is_email(v: str) -> bool:
    return bool(_RE_EMAIL.match(v.strip()))


def _is_url(v: str) -> bool:
    return bool(_RE_URL.match(v.strip()))


def _is_ip(v: str) -> bool:
    v = v.strip()
    if not _RE_IP.match(v):
        return False
    parts = v.split(".")
    return all(0 <= int(p) <= 255 for p in parts)


def _is_json(v: str) -> bool:
    import json

    try:
        parsed = json.loads(v.strip())
        return isinstance(parsed, (dict, list))
    except (json.JSONDecodeError, ValueError):
        return False


def _is_datetime(v: str) -> bool:
    return any(re.match(p, v.strip()) for p in _DATETIME_FORMATS)


def _is_date(v: str) -> bool:
    return any(re.match(p, v.strip()) for p in _DATE_FORMATS)


def _is_integer(v: str) -> bool:
    return bool(_RE_INT.match(v.strip()))


def _is_float(v: str) -> bool:
    return bool(_RE_FLOAT.match(v.strip())) or bool(_RE_INT.match(v.strip()))


def infer_column_type(column_name: str, values: list[Any], original_type: str = "varchar") -> TypeInferenceResult:
    """对单列数据进行类型推断。"""
    # 过滤空值
    str_values = [str(v) for v in values if v is not None and str(v).strip()]
    if not str_values:
        return TypeInferenceResult(
            column_name=column_name,
            inferred_type="varchar",
            confidence=0.5,
            original_type=original_type,
            storage_type="VARCHAR(255)",
        )

    total = len(str_values)

    # 按优先级依次检测
    checks = [
        ("boolean", _is_bool),
        ("uuid", _is_uuid),
        ("email", _is_email),
        ("url", _is_url),
        ("ip_address", _is_ip),
        ("json", _is_json),
        ("datetime", _is_datetime),
        ("date", _is_date),
    ]

    for type_name, checker in checks:
        ratio = _match_ratio(str_values, checker)
        if ratio > 0.95:
            storage = TYPE_TO_STORAGE[type_name]
            return TypeInferenceResult(
                column_name=column_name,
                inferred_type=type_name,
                confidence=round(ratio, 3),
                original_type=original_type,
                storage_type=storage,
                metadata={"sample_values": str_values[:3]},
            )

    # 整数检测
    int_ratio = _match_ratio(str_values, _is_integer)
    if int_ratio > 0.95:
        # 区分 int32 / int64
        max_val = max((abs(int(v)) for v in str_values if _RE_INT.match(v.strip())), default=0)
        int_type = "int32" if max_val < 2**31 else "int64"
        return TypeInferenceResult(
            column_name=column_name,
            inferred_type=int_type,
            confidence=round(int_ratio, 3),
            original_type=original_type,
            storage_type=TYPE_TO_STORAGE[int_type],
            metadata={"max_value": max_val, "sample_values": str_values[:3]},
        )

    # 浮点检测
    float_ratio = _match_ratio(str_values, _is_float)
    if float_ratio > 0.95:
        decimals_list = []
        for v in str_values:
            if "." in v:
                decimals_list.append(len(v.split(".")[1]))
        max_dec = max(decimals_list) if decimals_list else 2
        storage = TYPE_TO_STORAGE["decimal"].format(decimals=max_dec)
        return TypeInferenceResult(
            column_name=column_name,
            inferred_type="float64",
            confidence=round(float_ratio, 3),
            original_type=original_type,
            storage_type=storage,
            metadata={"max_decimal_places": max_dec, "sample_values": str_values[:3]},
        )

    # 枚举检测：唯一值 < 20 且占比 < 10%
    unique_values = list(set(str_values))
    if len(unique_values) < 20 and (len(unique_values) / total) < 0.1:
        return TypeInferenceResult(
            column_name=column_name,
            inferred_type="enum",
            confidence=0.95,
            original_type=original_type,
            storage_type="VARCHAR(100)",
            metadata={"possible_values": unique_values, "cardinality_ratio": round(len(unique_values) / total, 4)},
        )

    # 文本长度分类
    avg_len = sum(len(v) for v in str_values) / total
    if avg_len <= 255:
        return TypeInferenceResult(
            column_name=column_name,
            inferred_type="varchar",
            confidence=0.8,
            original_type=original_type,
            storage_type="VARCHAR(255)",
            metadata={"avg_length": round(avg_len, 1)},
        )
    elif avg_len <= 5000:
        return TypeInferenceResult(
            column_name=column_name,
            inferred_type="text",
            confidence=0.8,
            original_type=original_type,
            storage_type="TEXT",
            metadata={"avg_length": round(avg_len, 1)},
        )
    else:
        return TypeInferenceResult(
            column_name=column_name,
            inferred_type="longtext",
            confidence=0.8,
            original_type=original_type,
            storage_type="TEXT",
            metadata={"avg_length": round(avg_len, 1)},
        )


def infer_all_columns(
    table_name: str,
    sample_rows: list[dict[str, Any]],
    original_columns: list[dict[str, str]] | None = None,
) -> list[dict[str, Any]]:
    """对一张表的所有列执行推断，返回序列化结果列表。"""
    if not sample_rows:
        return []

    all_keys = list(sample_rows[0].keys())
    results = []
    for col in all_keys:
        values = [row.get(col) for row in sample_rows]
        orig_type = "varchar"
        if original_columns:
            match = next((c for c in original_columns if c.get("name") == col), None)
            if match:
                orig_type = match.get("original_type", "varchar")
        result = infer_column_type(col, values, orig_type)
        results.append({
            "column_name": result.column_name,
            "inferred_type": result.inferred_type,
            "confidence": result.confidence,
            "original_type": result.original_type,
            "storage_type": result.storage_type,
            "metadata": result.metadata,
        })
    return results
