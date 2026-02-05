"""API 数据源适配器 — RESTful 接入。"""
from typing import Any, AsyncIterator

import httpx

from .base import DataAdapter, TableSchema, ColumnInfo, DataRecord


class APIAdapter(DataAdapter):

    def __init__(self, config: dict[str, Any]):
        super().__init__(config)
        self.base_url: str = config["base_url"].rstrip("/")
        self.headers: dict = config.get("headers", {})
        self.auth_token: str | None = config.get("auth_token")
        self.endpoints: list[dict] = config.get("endpoints", [])
        # endpoints: [{"path": "/users", "method": "GET", "name": "users"}]

        if self.auth_token:
            self.headers.setdefault("Authorization", f"Bearer {self.auth_token}")

    async def test_connection(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(self.base_url, headers=self.headers)
                return resp.status_code < 500
        except Exception:
            return False

    async def extract_schema(self) -> list[TableSchema]:
        """通过实际调用 endpoint 推断 schema。"""
        schemas = []
        async with httpx.AsyncClient(timeout=30) as client:
            for ep in self.endpoints:
                url = f"{self.base_url}{ep['path']}"
                resp = await client.request(ep.get("method", "GET"), url, headers=self.headers)
                data = resp.json()
                sample = data[0] if isinstance(data, list) and data else data if isinstance(data, dict) else {}
                columns = [ColumnInfo(name=k, original_type=type(v).__name__) for k, v in sample.items()]
                row_count = len(data) if isinstance(data, list) else 1
                schemas.append(TableSchema(
                    table_name=ep.get("name", ep["path"].strip("/").replace("/", "_")),
                    columns=columns,
                    row_count=row_count,
                ))
        return schemas

    async def sample_data(self, table: str, limit: int = 100) -> list[dict[str, Any]]:
        ep = next((e for e in self.endpoints if e.get("name", e["path"].strip("/")) == table), None)
        if not ep:
            return []
        async with httpx.AsyncClient(timeout=30) as client:
            url = f"{self.base_url}{ep['path']}"
            resp = await client.request(ep.get("method", "GET"), url, headers=self.headers)
            data = resp.json()
        if isinstance(data, list):
            return data[:limit]
        return [data]

    async def stream_records(self, table: str) -> AsyncIterator[DataRecord]:
        records = await self.sample_data(table, limit=10000)
        for row in records:
            yield DataRecord(table=table, data=row)
