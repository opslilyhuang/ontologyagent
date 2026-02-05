import { useState, useRef, useEffect } from 'react'
import { Upload, Database, Globe, Loader2, FileText } from 'lucide-react'
import { dataSources } from '@/services/api'
import type { DataSource } from '@/types'
import { useNavigate } from 'react-router-dom'
import { useT } from '@/i18n'

type Tab = 'file' | 'database' | 'api'

const TAB_KEYS: { key: Tab; labelKey: string; Icon: typeof Upload }[] = [
  { key: 'file',     labelKey: 'ingest.tab.file',     Icon: Upload   },
  { key: 'database', labelKey: 'ingest.tab.database', Icon: Database },
  { key: 'api',      labelKey: 'ingest.tab.api',      Icon: Globe    },
]

const TYPE_ICONS: Record<string, typeof Upload> = { file: FileText, database: Database, api: Globe }

const LABEL = 'block text-xs font-medium text-slate-500 mb-1'
const INPUT = 'w-full border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-transparent transition'

export function DataIngestionPage() {
  const { t } = useT()
  const [tab, setTab]             = useState<Tab>('file')
  const [sources, setSources]     = useState<DataSource[]>([])
  const [uploading, setUploading] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [dragOver, setDragOver]   = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [dbConfig, setDbConfig]   = useState({ host: '', port: '5432', database: '', username: '', password: '', db_type: 'postgresql' })
  const [apiConfig, setApiConfig] = useState({ base_url: '', auth_token: '', endpoints: '[{"path":"/data","method":"GET","name":"data"}]' })
  const fileRef  = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    dataSources.list().then(setSources).catch(() => {})
  }, [])

  const refresh = () => dataSources.list().then(setSources).catch(() => {})

  // ── 批量上传 ──
  const handleFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files)
    if (arr.length === 0) return
    setUploading(true)
    try {
      await dataSources.uploadBatch(arr)
      await refresh()
    } catch (err) {
      alert(t('ingest.err.upload') + (err as Error).message)
    } finally {
      setUploading(false)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) handleFiles(e.target.files)
    e.target.value = ''
  }

  // Drag & Drop
  const onDragOver  = (e: React.DragEvent) => { e.preventDefault(); setDragOver(true)  }
  const onDragLeave = (e: React.DragEvent) => { e.preventDefault(); setDragOver(false) }
  const onDrop      = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false)
    if (e.dataTransfer.files) handleFiles(e.dataTransfer.files)
  }

  // ── 连接数据库 ──
  const handleDBConnect = async () => {
    setUploading(true)
    try {
      await dataSources.create({ name: `DB: ${dbConfig.database}`, type: 'database', config: dbConfig })
      await refresh()
    } catch (err) {
      alert(t('ingest.err.connect') + (err as Error).message)
    } finally {
      setUploading(false)
    }
  }

  // ── API 接入 ──
  const handleAPIConnect = async () => {
    setUploading(true)
    try {
      let endpoints
      try { endpoints = JSON.parse(apiConfig.endpoints) } catch { endpoints = [] }
      await dataSources.create({ name: `API: ${apiConfig.base_url}`, type: 'api', config: { ...apiConfig, endpoints } })
      await refresh()
    } catch (err) {
      alert(t('ingest.err.api') + (err as Error).message)
    } finally {
      setUploading(false)
    }
  }

  // ── 选择控制 ──
  const canSelectSources = sources.filter(s => s.status === 'created')
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }
  const selectAll  = () => setSelectedIds(new Set(canSelectSources.map(s => s.id)))
  const clearAll   = () => setSelectedIds(new Set())
  const allSelected = canSelectSources.length > 0 && selectedIds.size === canSelectSources.length

  // ── 开始批量分析 ──
  const handleAnalyze = async () => {
    if (selectedIds.size === 0) return
    setAnalyzing(true)
    try {
      const result = await dataSources.batchAnalyze(Array.from(selectedIds))
      navigate(`/ingest/review/${result.batch_id}`)
    } catch (err) {
      alert(t('ingest.err.analyze') + (err as Error).message)
    } finally {
      setAnalyzing(false)
    }
  }

  return (
    <div className="p-8 fade-in">
      <div className="max-w-4xl mx-auto">

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-800">{t('ingest.title')}</h1>
          <p className="text-slate-400 text-sm mt-1">{t('ingest.title.sub')}</p>
        </div>

        {/* Pill Tabs */}
        <div className="bg-slate-100 rounded-xl p-1 flex gap-0.5 w-fit mb-5">
          {TAB_KEYS.map(({ key, labelKey, Icon }) => (
            <button key={key} onClick={() => setTab(key)}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                tab === key ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'
              }`}>
              <Icon size={14} />{t(labelKey)}
            </button>
          ))}
        </div>

        {/* ── Form Card ── */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 mb-5">

          {/* File Upload */}
          {tab === 'file' && (
            <div>
              <div
                onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
                onClick={() => fileRef.current?.click()}
                className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all ${
                  dragOver
                    ? 'border-indigo-400 bg-indigo-50'
                    : 'border-slate-200 hover:border-indigo-300 hover:bg-indigo-50'
                }`}>
                <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center mx-auto mb-3">
                  <Upload size={22} className="text-slate-400" />
                </div>
                <p className="text-sm font-medium text-slate-700">{t('ingest.upload.hint')}</p>
                <p className="text-xs text-slate-400 mt-1">{t('ingest.upload.formats')}</p>
              </div>
              <input ref={fileRef} type="file" className="hidden" multiple onChange={handleFileChange}
                accept=".csv,.xlsx,.xls,.json,.pdf,.docx,.txt,.png,.jpg,.jpeg" />
              {uploading && (
                <div className="flex items-center gap-2 mt-3 text-sm text-indigo-500">
                  <Loader2 size={15} className="animate-spin" /> {t('ingest.uploading')}
                </div>
              )}
            </div>
          )}

          {/* Database */}
          {tab === 'database' && (
            <div className="max-w-sm space-y-3">
              <div>
                <label className={LABEL}>{t('ingest.db.type')}</label>
                <select value={dbConfig.db_type} onChange={e => setDbConfig(p => ({ ...p, db_type: e.target.value }))}
                  className={INPUT}>
                  <option value="postgresql">PostgreSQL</option>
                  <option value="mysql">MySQL</option>
                </select>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className={LABEL}>{t('ingest.db.host')}</label>
                  <input type="text" placeholder="localhost" value={dbConfig.host}
                    onChange={e => setDbConfig(p => ({ ...p, host: e.target.value }))} className={INPUT} />
                </div>
                <div>
                  <label className={LABEL}>{t('ingest.db.port')}</label>
                  <input type="text" placeholder="5432" value={dbConfig.port}
                    onChange={e => setDbConfig(p => ({ ...p, port: e.target.value }))} className={INPUT} />
                </div>
              </div>
              <div>
                <label className={LABEL}>{t('ingest.db.name')}</label>
                <input type="text" placeholder="mydb" value={dbConfig.database}
                  onChange={e => setDbConfig(p => ({ ...p, database: e.target.value }))} className={INPUT} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={LABEL}>{t('ingest.db.user')}</label>
                  <input type="text" placeholder="user" value={dbConfig.username}
                    onChange={e => setDbConfig(p => ({ ...p, username: e.target.value }))} className={INPUT} />
                </div>
                <div>
                  <label className={LABEL}>{t('ingest.db.pass')}</label>
                  <input type="password" placeholder="••••••••" value={dbConfig.password}
                    onChange={e => setDbConfig(p => ({ ...p, password: e.target.value }))} className={INPUT} />
                </div>
              </div>
              <button onClick={handleDBConnect} disabled={uploading}
                className="w-full bg-slate-900 text-white rounded-xl px-4 py-2 text-sm font-medium hover:bg-slate-800 disabled:opacity-40 transition">
                {uploading ? t('ingest.db.connecting') : t('ingest.db.connect')}
              </button>
            </div>
          )}

          {/* API */}
          {tab === 'api' && (
            <div className="max-w-sm space-y-3">
              <div>
                <label className={LABEL}>{t('ingest.api.baseurl')}</label>
                <input type="text" placeholder="https://api.example.com" value={apiConfig.base_url}
                  onChange={e => setApiConfig(p => ({ ...p, base_url: e.target.value }))} className={INPUT} />
              </div>
              <div>
                <label className={LABEL}>{t('ingest.api.token')}</label>
                <input type="text" placeholder="sk-xxxxx…" value={apiConfig.auth_token}
                  onChange={e => setApiConfig(p => ({ ...p, auth_token: e.target.value }))} className={INPUT} />
              </div>
              <div>
                <label className={LABEL}>{t('ingest.api.endpoints')}</label>
                <textarea placeholder={'[{"path":"/users","method":"GET","name":"users"}]'} value={apiConfig.endpoints}
                  onChange={e => setApiConfig(p => ({ ...p, endpoints: e.target.value }))}
                  className={INPUT + ' h-20 resize-none font-mono text-xs'} />
              </div>
              <button onClick={handleAPIConnect} disabled={uploading}
                className="w-full bg-slate-900 text-white rounded-xl px-4 py-2 text-sm font-medium hover:bg-slate-800 disabled:opacity-40 transition">
                {uploading ? t('ingest.api.connecting') : t('ingest.api.connect')}
              </button>
            </div>
          )}
        </div>

        {/* ── Source List ── */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm">
          <div className="px-5 pt-5 pb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">{t('ingest.sources.title')}</h2>
            <span className="text-xs text-slate-400">{t('ingest.sources.count', { n: sources.length })}</span>
          </div>

          {sources.length === 0 ? (
            <div className="px-5 pb-5">
              <div className="border border-dashed border-slate-200 rounded-xl p-6 text-center">
                <p className="text-xs text-slate-400">{t('ingest.sources.empty')}</p>
              </div>
            </div>
          ) : (
            <div className="px-5 pb-5">
              {/* 选择控制栏 */}
              {canSelectSources.length > 0 && (
                <div className="flex items-center gap-3 mb-3 pb-3 border-b border-slate-100">
                  <button onClick={() => allSelected ? clearAll() : selectAll()}
                    className="text-xs text-indigo-600 hover:text-indigo-800 font-medium transition">
                    {allSelected ? t('ingest.sources.unselectall') : t('ingest.sources.selectall')}
                  </button>
                  {selectedIds.size > 0 && (
                    <span className="text-xs text-slate-400">{t('ingest.sources.selected', { n: selectedIds.size })}</span>
                  )}
                </div>
              )}

              <div className="space-y-2">
                {sources.map(s => {
                  const Icon = TYPE_ICONS[s.type] || FileText
                  const statusBg    = s.status === 'analyzed' ? 'bg-emerald-50'  : s.status === 'error' ? 'bg-red-50'   : 'bg-slate-100'
                  const statusColor = s.status === 'analyzed' ? 'text-emerald-600' : s.status === 'error' ? 'text-red-500' : 'text-slate-500'
                  const canSelect   = s.status === 'created'
                  const isSelected  = selectedIds.has(s.id)

                  return (
                    <div key={s.id} className={`flex items-center gap-3 p-3 rounded-xl border transition ${
                      isSelected ? 'border-indigo-300 bg-indigo-50' : 'border-slate-100 hover:border-slate-200'
                    }`}>
                      {/* Checkbox */}
                      <div className="w-4 flex-shrink-0">
                        {canSelect ? (
                          <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(s.id)}
                            className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-200 cursor-pointer accent-indigo-600" />
                        ) : <div className="w-4" />}
                      </div>

                      <div className="w-9 h-9 bg-slate-50 rounded-lg flex items-center justify-center flex-shrink-0">
                        <Icon size={17} className="text-slate-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-700 truncate">{s.name}</p>
                        <p className="text-xs text-slate-400 mt-0.5">{new Date(s.created_at).toLocaleDateString()}</p>
                      </div>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusBg} ${statusColor}`}>{s.status}</span>
                      {s.status === 'analyzed' && (
                        <button onClick={() => navigate('/ontologies')}
                          className="text-xs font-medium text-violet-600 bg-violet-50 hover:bg-violet-100 px-2.5 py-1 rounded-lg transition">{t('ingest.sources.viewont')}</button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── 开始分析 ── */}
        {selectedIds.size > 0 && (
          <div className="mt-4">
            <button onClick={handleAnalyze} disabled={analyzing}
              className="w-full bg-indigo-600 text-white rounded-2xl px-4 py-3 text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40 transition flex items-center justify-center gap-2">
              {analyzing
                ? <><Loader2 size={16} className="animate-spin" /> {t('ingest.analyzing')}</>
                : t('ingest.analyzeBtn', { n: selectedIds.size })}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
