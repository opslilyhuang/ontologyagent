from pymilvus import MilvusClient

from .config import settings

COLLECTION_NAME = "ontology_embeddings"
EMBEDDING_DIM = 384  # bge-small-zh-v1.5 输出维度; 若换模型需更新


_client: MilvusClient | None = None


def get_milvus_client() -> MilvusClient:
    global _client
    if _client is None:
        _client = MilvusClient(
            uri=f"http://{settings.milvus_host}:{settings.milvus_port}"
        )
    return _client


def ensure_collection():
    """创建 collection（幂等）。"""
    client = get_milvus_client()
    if not client.has_collection(COLLECTION_NAME):
        from pymilvus import CollectionSchema, FieldSchema, DataType

        fields = [
            FieldSchema(name="id", dtype=DataType.VARCHAR, is_primary=True, max_length=256),
            FieldSchema(name="ontology_id", dtype=DataType.VARCHAR, max_length=64),
            FieldSchema(name="content", dtype=DataType.VARCHAR, max_length=4096),
            FieldSchema(name="embedding", dtype=DataType.FLOAT_VECTOR, dim=EMBEDDING_DIM),
            FieldSchema(name="entity_type", dtype=DataType.VARCHAR, max_length=128),
            FieldSchema(name="source_id", dtype=DataType.VARCHAR, max_length=256),
            FieldSchema(name="created_at", dtype=DataType.INT64),  # epoch ms
        ]
        schema = CollectionSchema(fields=fields)
        client.create_collection(
            collection_name=COLLECTION_NAME,
            schema=schema,
        )
        # 构建向量索引
        client.create_index(
            collection_name=COLLECTION_NAME,
            field_name="embedding",
            index_params={"index_type": "HNSW", "metric_type": "COSINE", "params": {"M": 16, "efConstruction": 200}},
        )
