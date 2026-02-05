"""数据库适配器 — 支持 PostgreSQL / MySQL。"""
from typing import Any, AsyncIterator

from .base import DataAdapter, TableSchema, ColumnInfo, DataRecord


class DatabaseAdapter(DataAdapter):

    def __init__(self, config: dict[str, Any]):
        super().__init__(config)
        self.db_type = config.get("db_type", "postgresql")  # postgresql | mysql
        self.host = config["host"]
        self.port = config.get("port", 5432)
        self.database = config["database"]
        self.username = config["username"]
        self.password = config.get("password", "")

    def _connection_url(self) -> str:
        if self.db_type == "mysql":
            return f"mysql+aiomysql://{self.username}:{self.password}@{self.host}:{self.port}/{self.database}"
        return f"postgresql+asyncpg://{self.username}:{self.password}@{self.host}:{self.port}/{self.database}"

    async def _get_engine(self):
        from sqlalchemy.ext.asyncio import create_async_engine

        return create_async_engine(self._connection_url(), pool_pre_ping=True)

    async def test_connection(self) -> bool:
        try:
            engine = await self._get_engine()
            async with engine.connect() as conn:
                from sqlalchemy import text

                await conn.execute(text("SELECT 1"))
            await engine.dispose()
            return True
        except Exception:
            return False

    # ── Schema ────────────────────────────
    async def extract_schema(self) -> list[TableSchema]:
        engine = await self._get_engine()
        schemas: list[TableSchema] = []

        async with engine.connect() as conn:
            from sqlalchemy import text

            if self.db_type == "postgresql":
                schemas = await self._pg_schema(conn)
            else:
                schemas = await self._mysql_schema(conn)

        await engine.dispose()
        return schemas

    async def _pg_schema(self, conn) -> list[TableSchema]:
        from sqlalchemy import text

        # 获取表列表
        result = await conn.execute(text(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema='public' AND table_type='BASE TABLE'"
        ))
        tables = [row[0] for row in result.fetchall()]

        schemas = []
        for table in tables:
            # 列信息
            cols_result = await conn.execute(text(
                "SELECT column_name, data_type, is_nullable, "
                "(column_name = ANY(array_agg(ccu.column_name) FILTER (WHERE tc.constraint_type='PRIMARY KEY') "
                "OVER (PARTITION BY c.table_name))) as is_pk "
                "FROM information_schema.columns c "
                "LEFT JOIN information_schema.table_constraints tc "
                "  ON tc.table_name = c.table_name AND tc.table_schema = c.table_schema "
                "LEFT JOIN information_schema.constraint_column_usage ccu "
                "  ON ccu.constraint_name = tc.constraint_name "
                "WHERE c.table_name = :table AND c.table_schema = 'public'"
            ), {"table": table})

            # 简化：直接查列
            cols_result2 = await conn.execute(text(
                "SELECT column_name, data_type, is_nullable FROM information_schema.columns "
                "WHERE table_name = :table AND table_schema = 'public' ORDER BY ordinal_position"
            ), {"table": table})
            columns = []
            for row in cols_result2.fetchall():
                columns.append(ColumnInfo(name=row[0], original_type=row[1], nullable=(row[2] == "YES")))

            # 主键
            pk_result = await conn.execute(text(
                "SELECT a.attname FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid "
                "AND a.attnum = ANY(c.conkey) "
                "JOIN pg_class cl ON cl.oid = c.conrelid "
                "WHERE cl.relname = :table AND c.contype = 'p'"
            ), {"table": table})
            primary_keys = [row[0] for row in pk_result.fetchall()]

            # 外键
            fk_result = await conn.execute(text(
                "SELECT a.attname AS column, cf.relname AS ref_table, af.attname AS ref_column "
                "FROM pg_constraint c "
                "JOIN pg_class cl ON cl.oid = c.conrelid "
                "JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey) "
                "JOIN pg_class cf ON cf.oid = c.confrelid "
                "JOIN pg_attribute af ON af.attrelid = c.confrelid AND af.attnum = ANY(c.confkey) "
                "WHERE cl.relname = :table AND c.contype = 'f'"
            ), {"table": table})
            foreign_keys = [{"column": r[0], "references_table": r[1], "references_column": r[2]} for r in fk_result.fetchall()]

            # 行数
            cnt = await conn.execute(text(f'SELECT COUNT(*) FROM "{table}"'))
            row_count = cnt.scalar()

            schemas.append(TableSchema(
                table_name=table,
                columns=columns,
                primary_keys=primary_keys,
                foreign_keys=foreign_keys,
                row_count=row_count,
            ))

        return schemas

    async def _mysql_schema(self, conn) -> list[TableSchema]:
        # MySQL schema 提取简化版
        from sqlalchemy import text

        result = await conn.execute(text(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = :db"
        ), {"db": self.database})
        tables = [row[0] for row in result.fetchall()]

        schemas = []
        for table in tables:
            cols = await conn.execute(text(
                "SELECT column_name, column_type, is_nullable, column_key "
                "FROM information_schema.columns WHERE table_schema = :db AND table_name = :table"
            ), {"db": self.database, "table": table})
            columns = []
            pks = []
            for row in cols.fetchall():
                columns.append(ColumnInfo(name=row[0], original_type=row[1], nullable=(row[2] == "YES")))
                if row[3] == "PRI":
                    pks.append(row[0])
            schemas.append(TableSchema(table_name=table, columns=columns, primary_keys=pks))

        return schemas

    # ── 采样 ─────────────────────────────
    async def sample_data(self, table: str, limit: int = 100) -> list[dict[str, Any]]:
        from sqlalchemy import text

        engine = await self._get_engine()
        async with engine.connect() as conn:
            result = await conn.execute(text(f'SELECT * FROM "{table}" LIMIT :limit'), {"limit": limit})
            keys = list(result.keys())
            rows = result.fetchall()
        await engine.dispose()
        return [dict(zip(keys, row)) for row in rows]

    # ── 流式读取 ──────────────────────────
    async def stream_records(self, table: str) -> AsyncIterator[DataRecord]:
        from sqlalchemy import text

        engine = await self._get_engine()
        async with engine.connect() as conn:
            result = await conn.execute(text(f'SELECT * FROM "{table}"'))
            keys = list(result.keys())
            for row in result.fetchall():
                yield DataRecord(table=table, data=dict(zip(keys, row)))
        await engine.dispose()
