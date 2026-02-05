"""DataAdapter 抽象基类 — 所有数据源适配器需继承。"""
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, AsyncIterator


@dataclass
class ColumnInfo:
    name: str
    original_type: str
    nullable: bool = True
    is_primary_key: bool = False
    foreign_key: str | None = None  # "referenced_table.column"


@dataclass
class TableSchema:
    table_name: str
    columns: list[ColumnInfo] = field(default_factory=list)
    primary_keys: list[str] = field(default_factory=list)
    foreign_keys: list[dict[str, str]] = field(default_factory=list)
    # foreign_keys: [{"column": "user_id", "references_table": "users", "references_column": "id"}]
    row_count: int = 0


@dataclass
class DataRecord:
    """单条记录。"""
    table: str
    data: dict[str, Any]


class DataAdapter(ABC):
    """统一数据适配器接口。"""

    def __init__(self, config: dict[str, Any]):
        self.config = config

    @abstractmethod
    async def test_connection(self) -> bool:
        """测试连接是否可行。"""
        ...

    @abstractmethod
    async def extract_schema(self) -> list[TableSchema]:
        """提取数据源的 Schema 信息。"""
        ...

    @abstractmethod
    async def sample_data(self, table: str, limit: int = 100) -> list[dict[str, Any]]:
        """采样记录用于类型推断。"""
        ...

    @abstractmethod
    async def stream_records(self, table: str) -> AsyncIterator[DataRecord]:
        """流式读取所有记录。"""
        ...
