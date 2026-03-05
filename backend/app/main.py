"""FastAPI 主入口。"""
import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .core.config import settings
from .core.database import init_db
from .core.neo4j_client import close_neo4j_driver
from .api import data_sources, ontologies, qa, import_logs

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator:
    # ── 启动 ──
    logging.info("初始化数据库表...")
    await init_db()
    logging.info("应用启动完成")
    yield
    # ── 关闭 ──
    await close_neo4j_driver()
    logging.info("应用已关闭")


app = FastAPI(
    title=settings.app_title,
    version=settings.app_version,
    description="多模态本体编排智能代理平台",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 路由
app.include_router(data_sources.router)
app.include_router(ontologies.router)
app.include_router(qa.router)
app.include_router(import_logs.router)


# 健康检查
@app.get("/health")
async def health():
    return {"status": "ok", "version": settings.app_version}


@app.get("/")
async def root():
    return {"message": "Ontology Data Agent API", "docs": "/docs"}
