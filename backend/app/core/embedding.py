"""Embedding 服务 — 默认使用本地 sentence-transformers。"""
from __future__ import annotations

from functools import lru_cache
from typing import List

# 延迟导入，避免启动时加载模型
_model = None


@lru_cache(maxsize=1)
def _get_model():
    from sentence_transformers import SentenceTransformer
    from .config import settings

    global _model
    _model = SentenceTransformer(settings.embedding_model)
    return _model


async def embed_texts(texts: List[str]) -> List[List[float]]:
    """批量 embedding，返回 float 向量列表。"""
    if not texts:
        return []
    model = _get_model()
    # sentence-transformers encode 是同步的，用 asyncio 包裹不会 block event loop 太久
    import asyncio

    vectors: List[List[float]] = await asyncio.get_event_loop().run_in_executor(
        None, lambda: model.encode(texts, show_progress_bar=False).tolist()
    )
    return vectors


async def embed_text(text: str) -> List[float]:
    vecs = await embed_texts([text])
    return vecs[0]
