import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Send, Loader2, ArrowLeft } from 'lucide-react'
import { ontologyApi } from '@/services/api'
import type { ChatMessage } from '@/types'
import ReactMarkdown from 'react-markdown'
import { useT } from '@/i18n'

const SUGGESTION_KEYS = [
  'chat.suggestion.1',
  'chat.suggestion.2',
  'chat.suggestion.3',
  'chat.suggestion.4',
]

export function ChatPage() {
  const { t } = useT()
  const { id }     = useParams<{ id: string }>()!
  const navigate   = useNavigate()
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: t('chat.greeting') }
  ])
  const [input, setInput]     = useState('')
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef  = useRef<HTMLInputElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const sendMessage = async (text?: string) => {
    const q = (text || input).trim()
    if (!q || loading) return
    setInput('')
    setLoading(true)

    setMessages(prev => [...prev, { role: 'user', content: q }])

    try {
      const history = messages.map(m => ({ role: m.role, content: m.content }))
      const result  = await ontologyApi.chat(id!, q, history)
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: result.answer,
        sources: result.sources,
        cypher_query: result.cypher_query,
      }])
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: `${t('chat.err')}${(err as Error).message}` }])
    } finally {
      setLoading(false)
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 56px)' }}>

      {/* ── Top Bar ── */}
      <div className="flex-shrink-0 border-b border-slate-100 bg-white px-6 py-3 flex items-center gap-3">
        <button onClick={() => navigate(`/ontologies/${id}`)}
          className="text-slate-400 hover:text-slate-600 transition">
          <ArrowLeft size={18} />
        </button>
        <div className="w-7 h-7 rounded-lg bg-slate-900 flex items-center justify-center">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-800">{t('chat.title')}</p>
          <p className="text-xs text-slate-400">{t('chat.title.sub')}</p>
        </div>
      </div>

      {/* ── Messages ── */}
      <div className="flex-1 overflow-y-auto scrollbar-custom px-4 py-5">
        <div className="max-w-3xl mx-auto space-y-6">
          {messages.map((msg, i) => (
            <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
              {/* Avatar */}
              <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-0.5 ${
                msg.role === 'user' ? 'bg-indigo-500' : 'bg-slate-200'
              }`}>
                {msg.role === 'user' ? (
                  <span className="text-white text-xs font-bold">U</span>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                    <line x1="9" y1="9" x2="9.01" y2="9" />
                    <line x1="15" y1="9" x2="15.01" y2="9" />
                  </svg>
                )}
              </div>

              {/* Bubble */}
              <div className={`max-w-[80%] flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                <div className={`px-4 py-3 text-sm ${
                  msg.role === 'user'
                    ? 'bg-indigo-50 text-indigo-900 rounded-2xl rounded-tr-sm'
                    : 'bg-white border border-slate-200 shadow-sm rounded-2xl rounded-tl-sm text-slate-700'
                }`}>
                  {msg.role === 'assistant' ? (
                    <ReactMarkdown className="md-content">{msg.content}</ReactMarkdown>
                  ) : (
                    <p>{msg.content}</p>
                  )}

                  {/* Sources */}
                  {msg.sources && msg.sources.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-slate-100 space-y-1.5">
                      <p className="text-xs text-slate-400 font-medium">{t('chat.sources')}</p>
                      {msg.sources.map((s, j) => (
                        <div key={j} className="flex items-start gap-1.5 bg-slate-50 rounded-lg px-2.5 py-1.5">
                          <span className="text-xs font-medium text-slate-400 flex-shrink-0">[{s.type}]</span>
                          <span className="text-xs text-slate-500 leading-relaxed">{s.content}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Cypher */}
                  {msg.cypher_query && (
                    <div className="mt-3 pt-3 border-t border-slate-100">
                      <p className="text-xs text-slate-400 font-medium mb-1">{t('chat.cypher')}</p>
                      <code className="text-xs bg-slate-50 border border-slate-100 rounded-lg px-2.5 py-1.5 block text-slate-600 font-mono">
                        {msg.cypher_query}
                      </code>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}

          {/* Typing indicator */}
          {loading && (
            <div className="flex gap-3">
              <div className="w-7 h-7 rounded-full bg-slate-200 flex items-center justify-center mt-0.5 flex-shrink-0">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                  <line x1="9" y1="9" x2="9.01" y2="9" />
                  <line x1="15" y1="9" x2="15.01" y2="9" />
                </svg>
              </div>
              <div className="bg-white border border-slate-200 shadow-sm rounded-2xl rounded-tl-sm px-4 py-3.5">
                <div className="flex items-center gap-1">
                  <span className="typing-dot w-1.5 h-1.5 bg-slate-400 rounded-full" style={{ animationDelay: '0ms' }}></span>
                  <span className="typing-dot w-1.5 h-1.5 bg-slate-400 rounded-full" style={{ animationDelay: '0.2s' }}></span>
                  <span className="typing-dot w-1.5 h-1.5 bg-slate-400 rounded-full" style={{ animationDelay: '0.4s' }}></span>
                </div>
              </div>
            </div>
          )}

          <div ref={scrollRef} />
        </div>
      </div>

      {/* ── Bottom Input ── */}
      <div className="flex-shrink-0 border-t border-slate-100 bg-white px-4 py-3">
        <div className="max-w-3xl mx-auto">

          {/* Suggestion pills — only on first screen */}
          {messages.length === 1 && !loading && (
            <div className="flex flex-wrap gap-2 mb-3">
              {SUGGESTION_KEYS.map(key => (
                <button key={key} onClick={() => sendMessage(t(key))}
                  className="text-xs text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 px-3 py-1 rounded-full transition">
                  {t(key)}
                </button>
              ))}
            </div>
          )}

          {/* Input bar */}
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-2xl px-4 py-2 focus-within:ring-2 focus-within:ring-indigo-200 focus-within:border-transparent transition">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendMessage()}
              placeholder={t('chat.placeholder')}
              className="flex-1 bg-transparent text-sm text-slate-800 placeholder-slate-400 focus:outline-none"
            />
            <button
              onClick={() => sendMessage()}
              disabled={loading || !input.trim()}
              className="bg-slate-900 text-white w-8 h-8 rounded-xl flex items-center justify-center hover:bg-slate-800 disabled:opacity-30 transition flex-shrink-0">
              {loading ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
