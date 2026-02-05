import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Layers, MessageSquare, Download, FileText, Loader2 } from 'lucide-react'
import { ontologyApi, dataSources } from '@/services/api'
import type { Ontology, BatchInfo } from '@/types'
import { useT } from '@/i18n'

export function OntologyListPage() {
  const { t } = useT()
  const [ontologies, setOntologies] = useState<Ontology[]>([])
  const [batches,    setBatches]    = useState<BatchInfo[]>([])
  const [filterBatch, setFilterBatch] = useState<string>('all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showPkgModal, setShowPkgModal] = useState(false)
  const [apiSpec,      setApiSpec]      = useState<Record<string, unknown> | null>(null)
  const [downloading,  setDownloading]  = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    ontologyApi.list().then(setOntologies).catch(() => {})
    dataSources.listBatches().then(setBatches).catch(() => {})
  }, [])

  useEffect(() => {
    if (filterBatch === 'all') {
      ontologyApi.list().then(setOntologies).catch(() => {})
    } else {
      ontologyApi.list(filterBatch).then(setOntologies).catch(() => {})
    }
    setSelectedIds(new Set())
  }, [filterBatch])

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }
  const allSelected  = ontologies.length > 0 && selectedIds.size === ontologies.length
  const selectAll    = () => setSelectedIds(new Set(ontologies.map(o => o.id)))
  const clearAll     = () => setSelectedIds(new Set())

  const openPackageModal = async () => {
    setShowPkgModal(true)
    setApiSpec(null)
    try {
      const res = await ontologyApi.getPackageSpec(Array.from(selectedIds))
      setApiSpec(res.spec)
    } catch { /* ignore */ }
  }

  const handleDownloadZip = async () => {
    setDownloading(true)
    try {
      await ontologyApi.downloadPackage(Array.from(selectedIds))
    } catch (err) {
      alert(t('ontologyList.err.download') + (err as Error).message)
    } finally {
      setDownloading(false)
    }
  }

  const handleDownloadSpec = () => {
    if (!apiSpec) return
    const blob = new Blob([JSON.stringify(apiSpec, null, 2)], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = 'openapi_spec.json'; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="p-8 fade-in">
      <div className="max-w-4xl mx-auto">

        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">{t('ontologyList.title')}</h1>
            <p className="text-slate-400 text-sm mt-1">{t('ontologyList.title.sub')}</p>
          </div>
        </div>

        {/* 筛选 + 操作栏 */}
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 font-medium">{t('ontologyList.filter')}</span>
            <select value={filterBatch} onChange={e => setFilterBatch(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200 cursor-pointer">
              <option value="all">{t('ontologyList.filter.all')}</option>
              {batches.map(b => (
                <option key={b.batch_id} value={b.batch_id}>
                  {t('ontologyList.filter.task', {
                    date: b.created_at ? new Date(b.created_at).toLocaleDateString() : b.batch_id.slice(0, 8),
                    n: b.source_count,
                  })}
                </option>
              ))}
            </select>
          </div>

          {/* 选择控制 */}
          {ontologies.length > 0 && (
            <div className="flex items-center gap-2 ml-4">
              <button onClick={() => allSelected ? clearAll() : selectAll()}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-medium transition">
                {allSelected ? t('ontologyList.unselectall') : t('ontologyList.selectall')}
              </button>
              {selectedIds.size > 0 && (
                <span className="text-xs text-slate-400">{t('ontologyList.selected', { n: selectedIds.size })}</span>
              )}
            </div>
          )}

          {/* 打包按钮 */}
          {selectedIds.size > 0 && (
            <button onClick={openPackageModal}
              className="ml-auto flex items-center gap-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 px-3.5 py-1.5 rounded-lg transition">
              <Download size={13} /> {t('ontologyList.pack')}
            </button>
          )}
        </div>

        {/* 本体列表 */}
        {ontologies.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-16 text-center">
            <div className="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Layers size={24} className="text-slate-300" />
            </div>
            <p className="text-sm font-medium text-slate-600">{t('ontologyList.empty')}</p>
            <p className="text-xs text-slate-400 mt-1">{t('ontologyList.empty.sub')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {ontologies.map(o => {
              const isSel = selectedIds.has(o.id)
              return (
                <div key={o.id} className={`bg-white rounded-2xl border shadow-sm transition-all p-5 flex items-start gap-4 ${
                  isSel ? 'border-indigo-300 ring-2 ring-indigo-100' : 'border-slate-100 hover:shadow-md'
                }`}>
                  {/* Checkbox */}
                  <div className="pt-0.5 flex-shrink-0">
                    <input type="checkbox" checked={isSel} onChange={() => toggleSelect(o.id)}
                      className="w-4 h-4 rounded border-slate-300 accent-indigo-600 cursor-pointer" />
                  </div>

                  {/* Icon */}
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: 'linear-gradient(135deg, #e0e7ff, #ede9fe)' }}>
                    <Layers size={18} className="text-indigo-500" />
                  </div>

                  {/* Info — clickable */}
                  <div className="flex-1 min-w-0 cursor-pointer" onClick={() => navigate(`/ontologies/${o.id}`)}>
                    <p className="text-sm font-semibold text-slate-800">{o.name}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{o.description || t('ontologyList.noDesc')}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-xs text-slate-400">{t('ontologyList.classes', { n: o.classes.length })}</span>
                      <span className="text-slate-200">·</span>
                      <span className="text-xs text-slate-400">{t('ontologyList.relations', { n: o.relations.length })}</span>
                      <span className="text-slate-200">·</span>
                      <span className="text-xs text-slate-400">{t('ontologyList.instances', { n: o.instances_count })}</span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${
                      o.status === 'published' ? 'bg-emerald-50 text-emerald-600' :
                      o.status === 'pending'   ? 'bg-amber-50  text-amber-600'   :
                                                 'bg-slate-100 text-slate-500'
                    }`}>{o.status}</span>

                    {o.status === 'published' && (
                      <button onClick={e => { e.stopPropagation(); navigate(`/ontologies/${o.id}/chat`) }}
                        className="flex items-center gap-1 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1 rounded-lg transition">
                        <MessageSquare size={11} /> {t('ontologyList.qa')}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── 打包导出 Modal ── */}
      {showPkgModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 overflow-hidden">
            {/* Modal Header */}
            <div className="px-6 pt-6 pb-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-emerald-50 rounded-xl flex items-center justify-center">
                  <Download size={17} className="text-emerald-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">{t('ontologyList.modal.title')}</p>
                  <p className="text-xs text-slate-400">{t('ontologyList.modal.sub', { n: selectedIds.size })}</p>
                </div>
              </div>
              <button onClick={() => setShowPkgModal(false)} className="text-slate-400 hover:text-slate-600 transition text-lg leading-none">×</button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-4">
              {/* 选中本体列表 */}
              <div>
                <p className="text-xs font-medium text-slate-500 mb-2">{t('ontologyList.modal.include')}</p>
                <div className="flex flex-wrap gap-1.5">
                  {ontologies.filter(o => selectedIds.has(o.id)).map(o => (
                    <span key={o.id} className="text-xs bg-slate-50 border border-slate-100 px-2.5 py-1 rounded-lg flex items-center gap-1.5">
                      <FileText size={11} className="text-slate-400" /> {o.name}
                    </span>
                  ))}
                </div>
              </div>

              {/* 选项 1: 下载 API 文档 */}
              <div className="border border-slate-100 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-700">{t('ontologyList.modal.api')}</p>
                    <p className="text-xs text-slate-400">{t('ontologyList.modal.api.sub')}</p>
                  </div>
                  <button onClick={handleDownloadSpec} disabled={!apiSpec}
                    className="text-xs font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-40 px-3 py-1.5 rounded-lg flex items-center gap-1 transition">
                    <Download size={11} /> {t('ontologyList.modal.dlJson')}
                  </button>
                </div>
                {apiSpec && (
                  <div className="mt-2 bg-slate-50 rounded-lg p-3 max-h-32 overflow-y-auto">
                    <code className="text-[10px] text-slate-500 whitespace-pre-wrap font-mono">
                      {JSON.stringify(apiSpec, null, 2).slice(0, 600)}{JSON.stringify(apiSpec, null, 2).length > 600 ? '\n…' : ''}
                    </code>
                  </div>
                )}
              </div>

              {/* 选项 2: 下载本体包 ZIP */}
              <div className="border border-slate-100 rounded-xl p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-700">{t('ontologyList.modal.pkg')}</p>
                  <p className="text-xs text-slate-400">{t('ontologyList.modal.pkg.sub')}</p>
                </div>
                <button onClick={handleDownloadZip} disabled={downloading}
                  className="text-xs font-semibold text-emerald-600 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-40 px-3 py-1.5 rounded-lg flex items-center gap-1 transition">
                  {downloading ? <><Loader2 size={11} className="animate-spin" /> {t('ontologyList.downloading')}</> : <><Download size={11} /> {t('ontologyList.modal.dlZip')}</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
