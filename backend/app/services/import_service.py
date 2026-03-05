"""本体数据导入服务。"""
import asyncio
import logging
from typing import Any, Dict, List
from datetime import datetime, timezone

from sqlalchemy import select, update as sa_update
from sqlalchemy.ext.asyncio import AsyncSession
import pandas as pd

from ..models.database import ImportLog, ImportLogStatus, Ontology, DataSource
from ..engines.data_cleaning import DataCleaningEngine
from ..core.neo4j_client import get_neo4j_driver
from ..core.milvus_client import get_milvus_client, COLLECTION_NAME
from ..core.embedding import embed_text

logger = logging.getLogger(__name__)


class OntologyImportService:
    """本体数据导入服务"""

    def __init__(self):
        self.cleaning_engine = DataCleaningEngine()

    async def import_ontology_data(
        self,
        db: AsyncSession,
        ontology_id: str,
        cleaning_config: Dict[str, Any]
    ) -> str:
        """
        导入本体数据到 Neo4j/Milvus

        Args:
            db: 数据库会话
            ontology_id: 本体ID
            cleaning_config: 数据清洗配置

        Returns:
            import_log_id: 导入日志ID
        """
        # 1. 创建 ImportLog 记录（status=running）
        log = ImportLog(
            ontology_id=ontology_id,
            status=ImportLogStatus.RUNNING,
            cleaning_config=cleaning_config,
            total_records=0,
            success_count=0,
            failure_count=0,
            failed_records=[],
            error_summary="",
        )
        db.add(log)
        await db.commit()
        await db.refresh(log)

        # 2. 启动后台异步任务
        asyncio.create_task(self._run_import_task(ontology_id, log.id, cleaning_config))

        # 3. 返回 log_id
        return log.id

    async def _run_import_task(
        self,
        ontology_id: str,
        log_id: str,
        cleaning_config: Dict[str, Any]
    ):
        """后台导入任务"""
        from ..core.database import AsyncSessionLocal

        async with AsyncSessionLocal() as db:
            try:
                # 1. 加载本体数据
                result = await db.execute(select(Ontology).where(Ontology.id == ontology_id))
                ontology = result.scalar_one_or_none()
                if not ontology:
                    raise ValueError(f"Ontology {ontology_id} not found")

                # 2. 加载数据源
                result = await db.execute(select(DataSource).where(DataSource.id == ontology.data_source_id))
                data_source = result.scalar_one_or_none()
                if not data_source:
                    raise ValueError(f"Data source {ontology.data_source_id} not found")

                # 3. 加载原始数据
                df = await self._load_data_from_source(data_source)
                total_records = len(df)

                # 4. 应用数据清洗
                cleaned_df, failed_records = self.cleaning_engine.clean(df, cleaning_config)

                # 5. 写入 Neo4j/Milvus
                success_count = 0
                additional_failures = []

                try:
                    success_count = await self._write_to_graph_db(
                        ontology, cleaned_df, additional_failures
                    )
                except Exception as e:
                    logger.error(f"Error writing to graph DB: {e}", exc_info=True)
                    additional_failures.append({
                        "row_index": -1,
                        "data": {},
                        "error": f"Graph DB write error: {str(e)}"
                    })

                # 6. 合并失败记录
                all_failed = failed_records + additional_failures
                failure_count = len(all_failed)

                # 7. 更新 ImportLog 状态
                status = ImportLogStatus.COMPLETED
                if failure_count > 0 and success_count > 0:
                    status = ImportLogStatus.PARTIAL
                elif failure_count > 0 and success_count == 0:
                    status = ImportLogStatus.FAILED

                error_summary = self._generate_error_summary(all_failed)

                await db.execute(
                    sa_update(ImportLog)
                    .where(ImportLog.id == log_id)
                    .values(
                        status=status,
                        total_records=total_records,
                        success_count=success_count,
                        failure_count=failure_count,
                        failed_records=all_failed[:1000],  # Limit to 1000 records
                        error_summary=error_summary,
                        completed_at=datetime.now(timezone.utc),
                    )
                )
                await db.commit()

                logger.info(
                    f"Import completed for ontology {ontology_id}: "
                    f"{success_count} success, {failure_count} failed"
                )

            except Exception as e:
                logger.error(f"Import task {log_id} failed: {e}", exc_info=True)
                await db.execute(
                    sa_update(ImportLog)
                    .where(ImportLog.id == log_id)
                    .values(
                        status=ImportLogStatus.FAILED,
                        error_summary=str(e),
                        completed_at=datetime.now(timezone.utc),
                    )
                )
                await db.commit()

    async def _load_data_from_source(self, data_source: DataSource) -> pd.DataFrame:
        """从数据源加载数据"""
        config = data_source.config or {}

        if data_source.type.value == "file":
            file_path = config.get("file_path")
            if not file_path:
                raise ValueError("File path not found in data source config")

            # Detect file type and load
            if file_path.endswith('.csv'):
                return pd.read_csv(file_path)
            elif file_path.endswith('.xlsx') or file_path.endswith('.xls'):
                return pd.read_excel(file_path)
            elif file_path.endswith('.json'):
                return pd.read_json(file_path)
            else:
                raise ValueError(f"Unsupported file type: {file_path}")

        elif data_source.type.value == "database":
            # TODO: Implement database loading
            raise NotImplementedError("Database source loading not implemented")

        else:
            raise ValueError(f"Unsupported data source type: {data_source.type}")

    async def _write_to_graph_db(
        self,
        ontology: Ontology,
        df: pd.DataFrame,
        failures: List[Dict[str, Any]]
    ) -> int:
        """写入 Neo4j 和 Milvus"""
        success_count = 0
        driver = get_neo4j_driver()

        # Get ontology classes
        classes = ontology.classes or []
        if not classes:
            logger.warning(f"No classes defined in ontology {ontology.id}")
            return 0

        try:
            async with driver.session() as session:
                for idx, row in df.iterrows():
                    try:
                        # For each class, create a node
                        for cls in classes:
                            class_name = cls.get("name", "Entity")
                            properties = cls.get("properties", [])

                            # Build node properties
                            node_props = {
                                "_ontology_id": ontology.id,
                                "_id": f"{ontology.id}_{class_name}_{idx}",
                            }

                            # Map DataFrame columns to class properties
                            for prop in properties:
                                prop_name = prop.get("name")
                                if prop_name and prop_name in row.index:
                                    value = row[prop_name]
                                    if pd.notna(value):
                                        node_props[prop_name] = str(value)

                            # Create node in Neo4j
                            query = f"CREATE (n:{class_name} $props)"
                            await session.run(query, props=node_props)

                            # Index in Milvus for semantic search
                            try:
                                await self._index_in_milvus(
                                    ontology.id,
                                    node_props.get("_id"),
                                    class_name,
                                    node_props
                                )
                            except Exception as e:
                                logger.warning(f"Milvus indexing failed: {e}")

                        success_count += 1

                    except Exception as e:
                        logger.error(f"Error writing row {idx}: {e}")
                        failures.append({
                            "row_index": int(idx),
                            "data": row.to_dict(),
                            "error": str(e)
                        })

        except Exception as e:
            logger.error(f"Neo4j session error: {e}", exc_info=True)
            raise

        return success_count

    async def _index_in_milvus(
        self,
        ontology_id: str,
        entity_id: str,
        entity_type: str,
        properties: Dict[str, Any]
    ):
        """在 Milvus 中索引实体"""
        try:
            # Build content string for embedding
            content = " ".join([f"{k}: {v}" for k, v in properties.items() if k not in ["_id", "_ontology_id"]])

            # Generate embedding
            vector = await embed_text(content)

            # Insert into Milvus
            milvus = get_milvus_client()
            milvus.insert(
                collection_name=COLLECTION_NAME,
                data=[{
                    "id": entity_id,
                    "ontology_id": ontology_id,
                    "entity_type": entity_type,
                    "content": content,
                    "vector": vector,
                }]
            )
        except Exception as e:
            logger.error(f"Milvus indexing error: {e}")
            raise

    def _generate_error_summary(self, failed_records: List[Dict[str, Any]]) -> str:
        """生成错误摘要"""
        if not failed_records:
            return ""

        error_counts = {}
        for record in failed_records:
            error = record.get("error", "Unknown error")
            error_counts[error] = error_counts.get(error, 0) + 1

        summary_lines = [f"{error}: {count} records" for error, count in error_counts.items()]
        return "; ".join(summary_lines[:10])  # Limit to top 10 error types

    async def retry_failed_records(
        self,
        db: AsyncSession,
        log_id: str,
        records: List[Dict[str, Any]],
        cleaning_config: Dict[str, Any]
    ) -> Dict[str, Any]:
        """重新导入失败记录"""
        # Load the import log
        result = await db.execute(select(ImportLog).where(ImportLog.id == log_id))
        log = result.scalar_one_or_none()
        if not log:
            raise ValueError(f"Import log {log_id} not found")

        # Convert records to DataFrame
        df = pd.DataFrame(records)

        # Apply cleaning
        cleaned_df, failed_records = self.cleaning_engine.clean(df, cleaning_config)

        # Load ontology
        result = await db.execute(select(Ontology).where(Ontology.id == log.ontology_id))
        ontology = result.scalar_one_or_none()
        if not ontology:
            raise ValueError(f"Ontology {log.ontology_id} not found")

        # Write to graph DB
        success_count = 0
        additional_failures = []
        try:
            success_count = await self._write_to_graph_db(
                ontology, cleaned_df, additional_failures
            )
        except Exception as e:
            logger.error(f"Retry write error: {e}", exc_info=True)

        # Update log statistics
        new_success = log.success_count + success_count
        new_failed = failed_records + additional_failures
        new_failure_count = len(new_failed)

        await db.execute(
            sa_update(ImportLog)
            .where(ImportLog.id == log_id)
            .values(
                success_count=new_success,
                failure_count=new_failure_count,
                failed_records=new_failed[:1000],
            )
        )
        await db.commit()

        return {
            "success_count": success_count,
            "failure_count": len(additional_failures),
            "total_success": new_success,
            "total_failure": new_failure_count,
        }

    async def get_failed_records_page(
        self,
        db: AsyncSession,
        log_id: str,
        page: int,
        page_size: int
    ) -> Dict[str, Any]:
        """分页获取失败记录"""
        result = await db.execute(select(ImportLog).where(ImportLog.id == log_id))
        log = result.scalar_one_or_none()
        if not log:
            raise ValueError(f"Import log {log_id} not found")

        failed_records = log.failed_records or []
        total = len(failed_records)

        start = (page - 1) * page_size
        end = start + page_size
        page_records = failed_records[start:end]

        return {
            "records": page_records,
            "total": total,
            "page": page,
            "page_size": page_size,
        }
