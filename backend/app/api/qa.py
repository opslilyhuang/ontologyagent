"""智能问答应用 API 路由。"""
import uuid
import secrets
import logging

from fastapi import APIRouter, Depends, HTTPException, Header
from fastapi.responses import HTMLResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.database import get_db
from ..models.database import QASession
from ..models.schemas import QASessionCreate, QAChatRequest
from ..services.chat_service import answer_question

router = APIRouter(prefix="/api/v1/qa", tags=["智能问答应用"])
logger  = logging.getLogger(__name__)


# ── 创建会话 ──────────────────────────
@router.post("/sessions")
async def create_session(payload: QASessionCreate, db: AsyncSession = Depends(get_db)):
    session = QASession(
        id=str(uuid.uuid4()),
        name=payload.name,
        ontology_ids=payload.ontology_ids,
        api_key=secrets.token_urlsafe(32),
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return _session_resp(session)


# ── 列出会话 ──────────────────────────
@router.get("/sessions")
async def list_sessions(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(QASession).order_by(QASession.created_at.desc()))
    return [_session_resp(s) for s in result.scalars()]


# ── 获取单个会话 ──────────────────────
@router.get("/sessions/{session_id}")
async def get_session(session_id: str, db: AsyncSession = Depends(get_db)):
    session = await _get_or_404(db, session_id)
    return _session_resp(session)


# ── 更新会话 ──────────────────────────
@router.put("/sessions/{session_id}")
async def update_session(session_id: str, payload: QASessionCreate, db: AsyncSession = Depends(get_db)):
    session = await _get_or_404(db, session_id)
    session.name         = payload.name
    session.ontology_ids = payload.ontology_ids
    await db.commit()
    await db.refresh(session)
    return _session_resp(session)


# ── 删除会话 ──────────────────────────
@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str, db: AsyncSession = Depends(get_db)):
    session = await _get_or_404(db, session_id)
    await db.delete(session)
    await db.commit()
    return {"ok": True}


# ── 会话问答（支持内部 + API Key 外部调用） ──
@router.post("/sessions/{session_id}/chat")
async def session_chat(
    session_id: str,
    payload: QAChatRequest,
    x_api_key: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    session = await _get_or_404(db, session_id)

    # 外部调用需 API Key
    if x_api_key is not None and x_api_key != session.api_key:
        raise HTTPException(status_code=403, detail="Invalid API key")

    # 遍历所有挂载的本体，取第一个有回答的
    best_answer  = None
    best_sources: list = []
    best_ont_id  = None

    for ont_id in (session.ontology_ids or []):
        try:
            result = await answer_question(ont_id, payload.question, payload.history)
            answer = result.get("answer", "")
            if answer and not best_answer:
                best_answer   = answer
                best_sources  = result.get("sources", [])
                best_ont_id   = ont_id
        except Exception as e:
            logger.warning(f"本体 {ont_id} 问答失败: {e}")
            continue

    return {
        "answer":      best_answer or "抱歉，在已挂载的本体中未找到相关信息。",
        "sources":     best_sources,
        "ontology_id": best_ont_id,
    }


# ── 嵌入式 HTML 页面 ────────────────────
@router.get("/sessions/{session_id}/embed")
async def embed_page(session_id: str, db: AsyncSession = Depends(get_db)):
    """返回可用 iframe 嵌入的独立聊天页面。"""
    await _get_or_404(db, session_id)   # 确认存在

    html = f"""<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>智能问答</title>
<style>
  *         {{ box-sizing:border-box; margin:0; padding:0; }}
  body      {{ font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; height:100vh; display:flex; flex-direction:column; background:#f8fafc; }}
  .header   {{ background:#1e293b; color:#fff; padding:12px 16px; font-size:14px; font-weight:600; }}
  .msgs     {{ flex:1; overflow-y:auto; padding:16px; display:flex; flex-direction:column; gap:12px; }}
  .msg      {{ max-width:85%; }}
  .msg.user {{ align-self:flex-end; background:#eef2ff; padding:10px 14px; border-radius:16px 16px 4px 16px; font-size:14px; color:#312e81; }}
  .msg.bot  {{ align-self:flex-start; background:#fff; border:1px solid #e2e8f0; padding:10px 14px; border-radius:16px 16px 16px 4px; font-size:14px; color:#475569; box-shadow:0 1px 2px rgba(0,0,0,.05); }}
  .input-row{{ padding:12px; border-top:1px solid #e2e8f0; background:#fff; display:flex; gap:8px; }}
  input     {{ flex:1; border:1px solid #e2e8f0; border-radius:20px; padding:8px 16px; font-size:14px; outline:none; }}
  input:focus{{ border-color:#818cf8; box-shadow:0 0 0 2px rgba(129,140,248,.2); }}
  button    {{ background:#1e293b; color:#fff; border:none; border-radius:20px; padding:8px 18px; font-size:14px; cursor:pointer; }}
  button:hover{{ background:#0f172a; }}
  button:disabled{{ opacity:.4; cursor:not-allowed; }}
</style>
</head>
<body>
<div class="header">智能问答助手</div>
<div class="msgs" id="msgs">
  <div class="msg bot">你好！我是智能问答助手，请直接提问。</div>
</div>
<div class="input-row">
  <input id="inp" placeholder="输入问题…" onkeydown="if(event.key==='Enter')send()">
  <button id="btn" onclick="send()">发送</button>
</div>
<script>
const SID  = "{session_id}";
const hist = [];
async function send() {{
  const inp = document.getElementById('inp');
  const q   = inp.value.trim();
  if (!q) return;
  inp.value = '';
  document.getElementById('btn').disabled = true;
  const msgs = document.getElementById('msgs');
  msgs.innerHTML += '<div class="msg user">' + q + '</div>';
  const tip  = document.createElement('div');
  tip.className = 'msg bot';
  tip.id        = 'tip';
  tip.textContent = '正在思考…';
  msgs.appendChild(tip);
  msgs.scrollTop  = msgs.scrollHeight;
  hist.push({{role:'user', content:q}});
  try {{
    const r  = await fetch('/api/v1/qa/sessions/' + SID + '/chat', {{
      method:'POST',
      headers:{{'Content-Type':'application/json'}},
      body:JSON.stringify({{question:q, history:hist}})
    }});
    const d  = await r.json();
    document.getElementById('tip').remove();
    msgs.innerHTML += '<div class="msg bot">' + (d.answer || '未找到答案') + '</div>';
    hist.push({{role:'assistant', content:d.answer}});
  }} catch(e) {{
    document.getElementById('tip').remove();
    msgs.innerHTML += '<div class="msg bot">错误: ' + e.message + '</div>';
  }}
  msgs.scrollTop = msgs.scrollHeight;
  document.getElementById('btn').disabled = false;
  inp.focus();
}}
</script>
</body>
</html>"""
    return HTMLResponse(html)


# ── 辅助 ──────────────────────────────
async def _get_or_404(db: AsyncSession, session_id: str) -> QASession:
    result  = await db.execute(select(QASession).where(QASession.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="会话未找到")
    return session


def _session_resp(s: QASession) -> dict:
    return {
        "id":           s.id,
        "name":         s.name,
        "ontology_ids": s.ontology_ids or [],
        "api_key":      s.api_key,
        "embed_url":    f"/api/v1/qa/sessions/{s.id}/embed",
        "status":       s.status,
        "created_at":   s.created_at.isoformat() if s.created_at else None,
    }
