import { useState, useEffect, useRef } from 'react'
import { Loader2, Send, Plus, Trash2, Copy, Check } from 'lucide-react'
import { qaApi, ontologyApi } from '@/services/api'
import type { QASession, Ontology } from '@/types'
import { useT } from '@/i18n'

export function QAAppPage() {
  const { t } = useT()
  const [sessions,   setSessions]   = useState<QASession[]>([])
  const [ontologies, setOntologies] = useState<Ontology[]>([])
  const [active,     setActive]     = useState<QASession | null>(null)

  const [creating,       setCreating]       = useState(false)
  const [newName,        setNewName]        = useState('')
  const [newOntologyIds, setNewOntologyIds] = useState<Set<string>>(new Set())

  const [editing,       setEditing]       = useState(false)
  const [editName,      setEditName]      = useState('')
  const [editOntIds,    setEditOntIds]    = useState<Set<string>>(new Set())

  const [messages, setMessages] = useState<{ role: string; content: string; ontology_id?: string }[]>([])
  const [input,    setInput]    = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const scrollRef  = useRef<HTMLDivElement>(null)
  const inputRef   = useRef<HTMLInputElement>(null)

  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    qaApi.listSessions().then(setSessions).catch(() => {})
    ontologyApi.list().then(setOntologies).catch(() => {})
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, chatLoading])

  const selectSession = (s: QASession) => {
    setActive(s)
    setEditing(false)
    setMessages([{ role: 'assistant', content: t('qa.greeting') }])
    setInput('')
  }

  // ── 创建 ──
  const handleCreate = async () => {
    if (!newName.trim() || newOntologyIds.size === 0) return
    setCreating(true)
    try {
      const s = await qaApi.createSession({ name: newName, ontology_ids: Array.from(newOntologyIds) })
      setSessions(prev => [s, ...prev])
      setNewName('')
      setNewOntologyIds(new Set())
      selectSession(s)
    } catch (err) {
      alert(t('qa.err.create') + (err as Error).message)
    } finally {
      setCreating(false)
    }
  }

  // ── 删除 ──
  const handleDelete = async (id: string) => {
    try {
      await qaApi.deleteSession(id)
      setSessions(prev => prev.filter(s => s.id !== id))
      if (active?.id === id) setActive(null)
    } catch (err) {
      alert(t('qa.err.delete') + (err as Error).message)
    }
  }

  // ── 编辑保存 ──
  const handleEditSave = async () => {
    if (!active) return
    try {
      const updated = await qaApi.updateSession(active.id, { name: editName, ontology_ids: Array.from(editOntIds) })
      setSessions(prev => prev.map(s => s.id === active.id ? updated : s))
      setActive(updated)
      setEditing(false)
    } catch (err) {
      alert(t('qa.err.update') + (err as Error).message)
    }
  }

  // ── 发送消息 ──
  const sendMessage = async (text?: string) => {
    const q = (text || input).trim()
    if (!q || chatLoading || !active) return
    setInput('')
    setChatLoading(true)
    setMessages(prev => [...prev, { role: 'user', content: q }])
    try {
      const history = messages.map(m => ({ role: m.role, content: m.content }))
      const result  = await qaApi.chat(active.id, q, history)
      setMessages(prev => [...prev, { role: 'assistant', content: result.answer, ontology_id: result.ontology_id }])
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: `${t('qa.err.chat')}${(err as Error).message}` }])
    } finally {
      setChatLoading(false)
      setTimeout(() => inputRef.current?.focus(), 80)
    }
  }

  const copyText = (text: string, key: string) => {
    navigator.clipboard.writeText(text).catch(() => {})
    setCopied(key)
    setTimeout(() => setCopied(null), 1500)
  }

  // ─────────────────────────────
  // RENDER
  // ─────────────────────────────
  return (
    <div className="flex h-full" style={{ height: 'calc(100vh - 56px)' }}>

      {/* ── 左侧栏：会话管理 ── */}
      <aside className="w-72 flex-shrink-0 border-r border-slate-100 bg-white flex flex-col">
        {/* 标题 + 新建按钮 */}
        <div className="px-4 py-4 border-b border-slate-100">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-800">{t('qa.title')}</h2>
            <button onClick={() => { setCreating(c => !c); setActive(null) }}
              className="w-7 h-7 rounded-lg bg-indigo-50 hover:bg-indigo-100 flex items-center justify-center transition">
              <Plus size={15} className="text-indigo-600" />
            </button>
          </div>
        </div>

        {/* 创建表单 */}
        {creating && (
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 space-y-2">
            <div>
              <label className="block text-[10px] text-slate-500 font-medium mb-1">会话名称 *</label>
              <input type="text" value={newName} onChange={e => setNewName(e.target.value)} placeholder="例如：物流数据问答"
                className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-200" />
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 font-medium mb-1">选择本体 * ({newOntologyIds.size} 个已选)</label>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {ontologies.length === 0 ? (
                  <p className="text-xs text-slate-400 italic py-2">暂无可用本体</p>
                ) : (
                  ontologies.map(o => (
                    <label key={o.id} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer hover:bg-white rounded px-1 py-0.5 transition">
                      <input type="checkbox" checked={newOntologyIds.has(o.id)}
                        onChange={() => {
                          setNewOntologyIds(prev => {
                            const n = new Set(prev); n.has(o.id) ? n.delete(o.id) : n.add(o.id); return n
                          })
                        }}
                        className="w-3.5 h-3.5 accent-indigo-600" />
                      <span className="truncate">{o.name}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
            {/* 调试信息 */}
            <div className="text-[10px] text-slate-500 space-y-0.5">
              <div>名称: {newName ? '✓ 已填写' : '✗ 未填写'}</div>
              <div>本体: {newOntologyIds.size > 0 ? `✓ 已选 ${newOntologyIds.size} 个` : '✗ 未选择'}</div>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={handleCreate}
                disabled={!newName.trim() || newOntologyIds.size === 0}
                className="text-xs bg-indigo-600 text-white px-3 py-1 rounded-lg hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
                title={!newName.trim() ? '请填写会话名称' : newOntologyIds.size === 0 ? '请至少选择一个本体' : '可以创建了'}
              >
                创建会话
              </button>
              <button onClick={() => setCreating(false)}
                className="text-xs text-slate-500 hover:text-slate-700 transition">取消</button>
            </div>
          </div>
        )}

        {/* 会话列表 */}
        <div className="flex-1 overflow-y-auto py-2 px-2">
          {sessions.length === 0 && (
            <p className="text-xs text-slate-400 text-center mt-8">{t('qa.empty')}</p>
          )}
          {sessions.map(s => (
            <div key={s.id} onClick={() => selectSession(s)}
              className={`flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer transition ${
                active?.id === s.id ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50'
              }`}>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold truncate">{s.name}</p>
                <p className="text-[10px] text-slate-400">{t('qa.sessions.ontologies', { n: s.ontology_ids.length })}</p>
              </div>
              <button onClick={e => { e.stopPropagation(); handleDelete(s.id) }}
                className="text-slate-300 hover:text-red-500 transition opacity-0 group-hover:opacity-100"
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = '1'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = '0'}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* ── 右侧主区 ── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* 未选会话 */}
        {!active ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Send size={24} className="text-slate-300" />
              </div>
              <p className="text-sm font-medium text-slate-600">{t('qa.nochosen.title')}</p>
              <p className="text-xs text-slate-400 mt-1">{t('qa.nochosen.sub')}</p>
            </div>
          </div>
        ) : (
          <>
            {/* ── 会话头 ── */}
            <div className="flex-shrink-0 border-b border-slate-100 bg-white px-5 py-3">
              {!editing ? (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{active.name}</p>
                    <p className="text-xs text-slate-400">
                      {t('qa.mounted')}{active.ontology_ids.map(id => ontologies.find(o => o.id === id)?.name || id.slice(0, 8)).join(' · ')}
                    </p>
                  </div>
                  <button onClick={() => { setEditing(true); setEditName(active.name); setEditOntIds(new Set(active.ontology_ids)) }}
                    className="text-xs text-slate-500 hover:text-indigo-600 transition">{t('qa.edit')}</button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <input type="text" value={editName} onChange={e => setEditName(e.target.value)}
                      className="flex-1 border border-slate-200 rounded-lg px-2.5 py-1 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-200" />
                    <button onClick={handleEditSave}
                      className="text-xs bg-indigo-600 text-white px-3 py-1 rounded-lg hover:bg-indigo-700 transition">{t('qa.edit.save')}</button>
                    <button onClick={() => setEditing(false)}
                      className="text-xs text-slate-500 hover:text-slate-700 transition">{t('qa.edit.cancel')}</button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {ontologies.map(o => (
                      <label key={o.id} className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                        <input type="checkbox" checked={editOntIds.has(o.id)}
                          onChange={() => {
                            setEditOntIds(prev => {
                              const n = new Set(prev); n.has(o.id) ? n.delete(o.id) : n.add(o.id); return n
                            })
                          }}
                          className="w-3.5 h-3.5 accent-indigo-600" />
                        <span>{o.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* ── 中间：对话区 ── */}
            <div className="flex-1 overflow-y-auto px-4 py-4 min-h-0">
              <div className="max-w-2xl mx-auto space-y-4">
                {messages.map((msg, i) => (
                  <div key={i} className={`flex gap-2.5 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                    <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-0.5 ${
                      msg.role === 'user' ? 'bg-indigo-500' : 'bg-slate-200'
                    }`}>
                      <span className={`text-xs font-bold ${msg.role === 'user' ? 'text-white' : 'text-slate-500'}`}>
                        {msg.role === 'user' ? 'U' : 'A'}
                      </span>
                    </div>
                    <div className={`max-w-[80%] ${msg.role === 'user' ? 'items-end' : 'items-start'} flex flex-col`}>
                      <div className={`px-4 py-2.5 text-sm ${
                        msg.role === 'user'
                          ? 'bg-indigo-50 text-indigo-900 rounded-2xl rounded-tr-sm'
                          : 'bg-white border border-slate-200 shadow-sm rounded-2xl rounded-tl-sm text-slate-700'
                      }`}>
                        {msg.content}
                      </div>
                      {msg.ontology_id && (
                        <p className="text-[10px] text-slate-400 mt-1 ml-1">
                          {t('qa.source')}{ontologies.find(o => o.id === msg.ontology_id)?.name || msg.ontology_id}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
                {chatLoading && (
                  <div className="flex gap-2.5">
                    <div className="w-7 h-7 rounded-full bg-slate-200 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-xs text-slate-500">A</span>
                    </div>
                    <div className="bg-white border border-slate-200 shadow-sm rounded-2xl rounded-tl-sm px-4 py-3">
                      <div className="flex items-center gap-1">
                        <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                        <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0.15s' }}></span>
                        <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0.3s' }}></span>
                      </div>
                    </div>
                  </div>
                )}
                <div ref={scrollRef} />
              </div>
            </div>

            {/* ── 输入栏 ── */}
            <div className="flex-shrink-0 border-t border-slate-100 bg-white px-4 py-3">
              <div className="max-w-2xl mx-auto flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-2xl px-4 py-2
                focus-within:ring-2 focus-within:ring-indigo-200 focus-within:border-transparent transition">
                <input ref={inputRef} type="text" value={input} onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && sendMessage()}
                  placeholder={t('qa.placeholder')}
                  className="flex-1 bg-transparent text-sm text-slate-800 placeholder-slate-400 focus:outline-none" />
                <button onClick={() => sendMessage()} disabled={chatLoading || !input.trim()}
                  className="bg-slate-900 text-white w-8 h-8 rounded-xl flex items-center justify-center hover:bg-slate-800 disabled:opacity-30 transition flex-shrink-0">
                  {chatLoading ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                </button>
              </div>
            </div>

            {/* ── 底部：接入方式信息 ── */}
            <div className="flex-shrink-0 border-t border-slate-100 bg-slate-50 px-5 py-4">
              <p className="text-xs font-semibold text-slate-500 mb-2.5">{t('qa.integration.title')}</p>
              <div className="grid grid-cols-2 gap-3">
                {/* REST API */}
                <div className="bg-white border border-slate-100 rounded-xl p-3 space-y-2">
                  <p className="text-xs font-semibold text-slate-700">{t('qa.integration.rest')}</p>
                  <div>
                    <p className="text-[10px] text-slate-400 mb-0.5">{t('qa.integration.endpoint')}</p>
                    <div className="flex items-center gap-1.5">
                      <code className="text-[10px] text-slate-600 font-mono truncate flex-1">POST /api/v1/qa/sessions/{active.id}/chat</code>
                      <button onClick={() => copyText(`POST /api/v1/qa/sessions/${active.id}/chat`, 'endpoint')}
                        className="text-slate-300 hover:text-indigo-600 transition flex-shrink-0">
                        {copied === 'endpoint' ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-400 mb-0.5">{t('qa.integration.apikey')}</p>
                    <div className="flex items-center gap-1.5">
                      <code className="text-[10px] text-slate-600 font-mono truncate flex-1">
                        {active.api_key.slice(0, 12)}{'*'.repeat(Math.max(0, active.api_key.length - 16))}{active.api_key.slice(-4)}
                      </code>
                      <button onClick={() => copyText(active.api_key, 'apikey')}
                        className="text-slate-300 hover:text-indigo-600 transition flex-shrink-0">
                        {copied === 'apikey' ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} />}
                      </button>
                    </div>
                  </div>
                </div>

                {/* 嵌入式 */}
                <div className="bg-white border border-slate-100 rounded-xl p-3 space-y-2">
                  <p className="text-xs font-semibold text-slate-700">{t('qa.integration.embed')}</p>
                  <div>
                    <p className="text-[10px] text-slate-400 mb-0.5">{t('qa.integration.embedurl')}</p>
                    <div className="flex items-center gap-1.5">
                      <code className="text-[10px] text-slate-600 font-mono truncate flex-1">{active.embed_url}</code>
                      <button onClick={() => copyText(active.embed_url, 'embedurl')}
                        className="text-slate-300 hover:text-indigo-600 transition flex-shrink-0">
                        {copied === 'embedurl' ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-400 mb-0.5">{t('qa.integration.iframecode')}</p>
                    <div className="flex items-center gap-1.5">
                      <code className={`text-[10px] text-slate-600 font-mono truncate flex-1`}>
                        {'<iframe src="'}{active.embed_url}{'" ...>'}{' '}
                      </code>
                      <button onClick={() => copyText(`<iframe src="${window.location.origin}${active.embed_url}" width="400" height="600" style="border:none;border-radius:12px" frameborder="0"></iframe>`, 'iframe')}
                        className="text-slate-300 hover:text-indigo-600 transition flex-shrink-0">
                        {copied === 'iframe' ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
