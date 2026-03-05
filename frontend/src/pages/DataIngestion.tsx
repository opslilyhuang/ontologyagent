import { useState, useRef, useEffect } from 'react'
import { Upload, Database, Globe, Loader2, FileText, Trash2, CheckCircle2 } from 'lucide-react'
import { dataSources } from '@/services/api'
import type { DataSource, OntologySourceMapping } from '@/types'
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

// ── ViewOntologyButton Component ──
function ViewOntologyButton({ source }: { source: DataSource }) {
  const [ontologies, setOntologies] = useState<OntologySourceMapping[]>([])
  const [loading, setLoading] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    if (source.status === 'analyzed') {
      loadOntologies()
    }
  }, [source.id, source.status])

  const loadOntologies = async () => {
    setLoading(true)
    try {
      const data = await dataSources.getOntologies(source.id)
      setOntologies(data)
    } catch (err) {
      console.error('Failed to load ontologies:', err)
    } finally {
      setLoading(false)
    }
  }

  if (source.status !== 'analyzed' || loading) {
    return null
  }

  if (ontologies.length === 0) {
    return null
  }

  if (ontologies.length === 1) {
    return (
      <button
        onClick={() => navigate(`/ontologies/${ontologies[0].ontology_id}`)}
        className="text-xs font-medium text-violet-600 bg-violet-50 hover:bg-violet-100 px-2.5 py-1 rounded-lg transition"
      >
        查看本体
      </button>
    )
  }

  // Multiple ontologies - show dropdown
  return (
    <div className="relative">
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className="text-xs font-medium text-violet-600 bg-violet-50 hover:bg-violet-100 px-2.5 py-1 rounded-lg transition"
      >
        查看本体 ({ontologies.length})
      </button>
      {showDropdown && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setShowDropdown(false)}
          />
          <div className="absolute right-0 mt-1 w-64 bg-white border border-slate-200 rounded-lg shadow-lg z-20 py-1">
            {ontologies.map((ont) => (
              <button
                key={ont.id}
                onClick={() => {
                  navigate(`/ontologies/${ont.ontology_id}`)
                  setShowDropdown(false)
                }}
                className="w-full text-left px-3 py-2 hover:bg-slate-50 transition"
              >
                <p className="text-sm font-medium text-slate-700">{ont.display_name}</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {new Date(ont.created_at).toLocaleString()}
                </p>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

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
  const [uploadSuccess, setUploadSuccess] = useState<number | null>(null)
  const [newlyUploadedIds, setNewlyUploadedIds] = useState<Set<string>>(new Set())
  const fileRef  = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    dataSources.list().then(data => {
      // 倒序排列：最新的在前
      setSources(data.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()))
    }).catch(() => {})
  }, [])

  const refresh = () => dataSources.list().then(data => {
    // 倒序排列：最新的在前
    setSources(data.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()))
  }).catch(() => {})

  // ── 批量上传 ──
  const handleFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files)
    if (arr.length === 0) return
    setUploading(true)
    try {
      const results = await dataSources.uploadBatch(arr)

      // 记录新上传的ID
      const newIds = new Set(results.map(r => r.id))
      setNewlyUploadedIds(newIds)

      await refresh()

      // 显示成功提示
      setUploadSuccess(results.length)
      setTimeout(() => setUploadSuccess(null), 3000)

      // 5秒后清除"新上传"标记
      setTimeout(() => setNewlyUploadedIds(new Set()), 5000)
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
      const result = await dataSources.create({ name: `DB: ${dbConfig.database}`, type: 'database', config: dbConfig })

      // 记录新创建的ID
      setNewlyUploadedIds(new Set([result.id]))

      await refresh()

      // 5秒后清除"新上传"标记
      setTimeout(() => setNewlyUploadedIds(new Set()), 5000)
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
      const result = await dataSources.create({ name: `API: ${apiConfig.base_url}`, type: 'api', config: { ...apiConfig, endpoints } })

      // 记录新创建的ID
      setNewlyUploadedIds(new Set([result.id]))

      await refresh()

      // 5秒后清除"新上传"标记
      setTimeout(() => setNewlyUploadedIds(new Set()), 5000)
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

  // ── 删除单个数据源 ──
  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`确定要删除数据源 "${name}" 吗？`)) return
    try {
      await dataSources.delete(id)
      await refresh()
      setSelectedIds(prev => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    } catch (err) {
      alert('删除失败: ' + (err as Error).message)
    }
  }

  // ── 批量删除数据源 ──
  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return
    if (!confirm(`确定要删除选中的 ${selectedIds.size} 个数据源吗？`)) return
    try {
      await dataSources.batchDelete(Array.from(selectedIds))
      await refresh()
      setSelectedIds(new Set())
    } catch (err) {
      alert('批量删除失败: ' + (err as Error).message)
    }
  }

  return (
    <div className="p-8 fade-in">
      <div className="max-w-4xl mx-auto">

        {/* 上传成功提示 */}
        {uploadSuccess !== null && (
          <div className="fixed top-4 right-4 bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center gap-3 shadow-lg animate-in fade-in slide-in-from-top-2 z-50">
            <CheckCircle2 size={20} className="text-green-600" />
            <p className="text-sm font-medium text-green-800">
              成功接入 {uploadSuccess} 个文件
            </p>
          </div>
        )}

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
                  const isNewlyUploaded = newlyUploadedIds.has(s.id)

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
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-slate-700 truncate">{s.name}</p>
                          {isNewlyUploaded && (
                            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-300 animate-pulse">
                              ✓ 新上传
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5">{new Date(s.created_at).toLocaleString()}</p>
                      </div>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusBg} ${statusColor}`}>{s.status}</span>
                      <ViewOntologyButton source={s} />
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDelete(s.id, s.name)
                        }}
                        className="flex-shrink-0 p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition"
                        title="删除"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── 开始分析 / 批量删除 ── */}
        {selectedIds.size > 0 && (
          <div className="mt-4 flex gap-3">
            <button onClick={handleAnalyze} disabled={analyzing}
              className="flex-1 bg-indigo-600 text-white rounded-2xl px-4 py-3 text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40 transition flex items-center justify-center gap-2">
              {analyzing
                ? <><Loader2 size={16} className="animate-spin" /> {t('ingest.analyzing')}</>
                : t('ingest.analyzeBtn', { n: selectedIds.size })}
            </button>
            <button onClick={handleBatchDelete}
              className="flex-shrink-0 bg-red-50 text-red-600 hover:bg-red-100 rounded-2xl px-4 py-3 text-sm font-semibold transition flex items-center gap-2">
              <Trash2 size={16} /> 删除 ({selectedIds.size})
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
