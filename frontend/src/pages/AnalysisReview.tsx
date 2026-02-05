import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Loader2, Check, RotateCcw, ChevronDown, ChevronUp, ArrowLeft } from 'lucide-react'
import { dataSources, ontologyApi } from '@/services/api'
import type { AnalysisBatch, Ontology } from '@/types'
import { useT } from '@/i18n'

const STAGE_LABEL_KEYS = ['review.stage.understand', 'review.stage.entity', 'review.stage.relation', 'review.stage.generate']
const STAGE_DESC_KEYS  = ['review.stage.desc.understand', 'review.stage.desc.entity', 'review.stage.desc.relation', 'review.stage.desc.generate']
// Keep Chinese labels for stage matching against backend current_stage string
const STAGE_LABELS_ZH  = ['数据理解', '实体识别', '关系发现', '本体生成']
const PROP_TYPES       = ['string','integer','float','boolean','date','datetime','email','url','uuid','text','json','enum','varchar','ip']

export function AnalysisReviewPage() {
  const { t } = useT()
  const { batchId } = useParams<{ batchId: string }>()!
  const navigate    = useNavigate()

  const [batch,      setBatch]      = useState<AnalysisBatch | null>(null)
  const [ontologies, setOntologies] = useState<Ontology[]>([])
  const [edited,     setEdited]     = useState<Record<string, Ontology>>({})
  const [selected,   setSelected]   = useState<Record<string, Set<string>>>({})
  const [expanded,   setExpanded]   = useState<string | null>(null)
  const [reanalyzeTarget, setReanalyzeTarget] = useState<{ ontId: string; cls?: string } | null>(null)
  const [reanalyzeText,   setReanalyzeText]   = useState('')
  const [reanalyzing,     setReanalyzing]     = useState(false)
  const [saving,          setSaving]          = useState(false)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── 轮询批次状态 ──
  useEffect(() => {
    if (!batchId) return
    const poll = async () => {
      try {
        const b = await dataSources.getBatch(batchId)
        setBatch(b)
        if (b.status === 'completed' && b.ontology_ids?.length > 0) {
          clearInterval(pollRef.current!)
          const onts: Ontology[] = []
          for (const oid of b.ontology_ids) {
            onts.push(await ontologyApi.get(oid))
          }
          setOntologies(onts)
          const e: Record<string, Ontology>       = {}
          const s: Record<string, Set<string>> = {}
          onts.forEach(o => {
            e[o.id] = { ...o, classes: o.classes.map(c => ({ ...c, properties: [...c.properties] })) }
            s[o.id] = new Set(o.classes.map(c => c.name))
          })
          setEdited(e)
          setSelected(s)
          setExpanded(onts[0]?.id ?? null)
        } else if (b.status === 'failed') {
          clearInterval(pollRef.current!)
        }
      } catch {
        clearInterval(pollRef.current!)
      }
    }
    poll()
    pollRef.current = setInterval(poll, 2000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [batchId])

  // ── 阶段状态推断 ──
  const getStageStatus = (idx: number): 'pending' | 'running' | 'completed' => {
    if (!batch) return 'pending'
    if (batch.status === 'completed') return 'completed'
    if (batch.status === 'failed')    return 'pending'
    const cur = batch.current_stage || ''
    const curIdx = STAGE_LABELS_ZH.findIndex(l => cur.includes(l))
    if (curIdx === -1) return idx === 0 ? 'running' : 'pending'
    if (idx < curIdx)  return 'completed'
    if (idx === curIdx) return 'running'
    return 'pending'
  }

  // ── class 选择 ──
  const toggleClass = (ontId: string, name: string) => {
    setSelected(prev => {
      const s = new Set(prev[ontId])
      s.has(name) ? s.delete(name) : s.add(name)
      return { ...prev, [ontId]: s }
    })
  }
  const selectAllClasses = (ontId: string, on: boolean) => {
    const ont = edited[ontId]
    setSelected(prev => ({
      ...prev,
      [ontId]: on ? new Set(ont?.classes.map(c => c.name)) : new Set(),
    }))
  }

  // ── 属性类型编辑 ──
  const editPropType = (ontId: string, clsName: string, propName: string, newType: string) => {
    setEdited(prev => {
      const ont = prev[ontId]
      if (!ont) return prev
      return {
        ...prev,
        [ontId]: {
          ...ont,
          classes: ont.classes.map(c =>
            c.name === clsName
              ? { ...c, properties: c.properties.map(p => p.name === propName ? { ...p, type: newType } : p) }
              : c
          ),
        },
      }
    })
  }

  // ── 属性开关 ──
  const toggleProp = (ontId: string, clsName: string, propName: string) => {
    setEdited(prev => {
      const ont = prev[ontId]
      if (!ont) return prev
      return {
        ...prev,
        [ontId]: {
          ...ont,
          classes: ont.classes.map(c =>
            c.name === clsName
              ? { ...c, properties: c.properties.filter(p => p.name !== propName) }
              : c
          ),
        },
      }
    })
  }

  // ── 重新分析 ──
  const handleReanalyze = async () => {
    if (!reanalyzeTarget || !reanalyzeText.trim()) return
    setReanalyzing(true)
    try {
      const updated = await ontologyApi.reanalyze(reanalyzeTarget.ontId, reanalyzeText, reanalyzeTarget.cls)
      setEdited(prev => ({ ...prev, [updated.id]: updated }))
      setSelected(prev => ({ ...prev, [updated.id]: new Set(updated.classes.map(c => c.name)) }))
      setReanalyzeTarget(null)
      setReanalyzeText('')
    } catch (err) {
      alert(t('review.err.reanalyze') + (err as Error).message)
    } finally {
      setReanalyzing(false)
    }
  }

  // ── 确认保存 ──
  const handleSave = async () => {
    setSaving(true)
    try {
      for (const ont of ontologies) {
        const e = edited[ont.id]
        if (!e) continue
        const sel = selected[ont.id]
        const finalClasses = e.classes.filter(c => sel?.has(c.name))
        await ontologyApi.update(ont.id, { classes: finalClasses })
      }
      navigate('/ontologies')
    } catch (err) {
      alert(t('review.err.save') + (err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  // ─────────────────────────────────────────
  // RENDER — 分析中
  // ─────────────────────────────────────────
  if (!batch || batch.status !== 'completed') {
    return (
      <div className="p-8 fade-in">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center gap-2 mb-6">
            <button onClick={() => navigate('/ingest')} className="text-slate-400 hover:text-slate-600 transition">
              <ArrowLeft size={18} />
            </button>
            <div>
              <h1 className="text-xl font-bold text-slate-800">{t('review.analyzing.title')}</h1>
              <p className="text-slate-400 text-xs mt-0.5">{t('review.analyzing.sub')}</p>
            </div>
          </div>

          {/* 总体进度 */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 mb-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-slate-700">{t('review.progress.title')}</span>
              <span className="text-xs font-medium text-indigo-500">{batch?.progress ?? 0}%</span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-2">
              <div className="bg-indigo-500 h-2 rounded-full transition-all duration-500" style={{ width: `${batch?.progress ?? 0}%` }} />
            </div>
            <p className="text-xs text-slate-400 mt-2">{batch?.current_stage || t('review.progress.preparing')}</p>
            {batch?.status === 'failed' && <p className="text-xs text-red-500 mt-1">{t('review.progress.error')}{batch.error}</p>}
          </div>

          {/* 思考时间线 */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-5">{t('review.flow.title')}</p>
            <div className="space-y-0">
              {STAGE_LABEL_KEYS.map((labelKey, i) => {
                const st = getStageStatus(i)
                return (
                  <div key={i} className="flex gap-3">
                    {/* 线 + 点 */}
                    <div className="flex flex-col items-center">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${
                        st === 'completed' ? 'bg-emerald-500' : st === 'running' ? 'bg-indigo-500' : 'bg-slate-200'
                      }`}>
                        {st === 'completed' ? <Check size={16} className="text-white" />
                       : st === 'running'   ? <Loader2 size={16} className="text-white animate-spin" />
                       : <div className="w-2 h-2 rounded-full bg-slate-400" />}
                      </div>
                      {i < STAGE_LABEL_KEYS.length - 1 && (
                        <div className={`w-0.5 h-6 ${st === 'completed' ? 'bg-emerald-300' : 'bg-slate-200'}`} />
                      )}
                    </div>
                    {/* 文本 */}
                    <div className="pb-5 pt-0.5">
                      <p className={`text-sm font-semibold ${
                        st === 'completed' ? 'text-slate-700' : st === 'running' ? 'text-indigo-600' : 'text-slate-400'
                      }`}>
                        {t(labelKey)}
                        {st === 'running'   && <span className="ml-2 text-xs font-normal">{t('review.stage.running')}</span>}
                        {st === 'completed' && <span className="ml-2 text-xs font-normal text-emerald-500">{t('review.stage.done')}</span>}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">{t(STAGE_DESC_KEYS[i])}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ─────────────────────────────────────────
  // RENDER — 分析完成，确认页
  // ─────────────────────────────────────────
  return (
    <div className="p-8 fade-in">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-2 mb-6">
          <button onClick={() => navigate('/ingest')} className="text-slate-400 hover:text-slate-600 transition">
            <ArrowLeft size={18} />
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-slate-800">{t('review.done.title')}</h1>
            <p className="text-slate-400 text-xs mt-0.5">{t('review.done.sub')}</p>
          </div>
          <button onClick={handleSave} disabled={saving}
            className="bg-indigo-600 text-white px-5 py-2 rounded-xl text-xs font-semibold hover:bg-indigo-700 disabled:opacity-40 transition">
            {saving ? t('review.saving') : t('review.save')}
          </button>
        </div>

        {/* 分析结果汇总 */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 mb-5 flex items-center gap-4">
          <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center flex-shrink-0">
            <Check size={20} className="text-emerald-500" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-700">{t('review.done.summary')}</p>
            <p className="text-xs text-slate-400">
              {t('review.done.summary.detail', {
                ontologies: ontologies.length,
                classes: ontologies.reduce((s, o) => s + o.classes.length, 0),
                relations: ontologies.reduce((s, o) => s + o.relations.length, 0),
              })}
            </p>
          </div>
        </div>

        {/* 本体卡片列表 */}
        {ontologies.map(ont => {
          const e   = edited[ont.id]   || ont
          const sel = selected[ont.id] || new Set()
          const isOpen = expanded === ont.id
          const allSel = e.classes.length > 0 && sel.size === e.classes.length

          return (
            <div key={ont.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm mb-4 overflow-hidden">
              {/* 卡片头 */}
              <div className="p-5 cursor-pointer select-none" onClick={() => setExpanded(isOpen ? null : ont.id)}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <input type="checkbox" checked={allSel} indeterminate={sel.size > 0 && !allSel}
                      onChange={e2 => { e2.stopPropagation(); selectAllClasses(ont.id, e2.target.checked) }}
                      className="w-4 h-4 rounded border-slate-300 accent-indigo-600 cursor-pointer"
                      onClick={ev => ev.stopPropagation()} />
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{ont.name}</p>
                      <p className="text-xs text-slate-400">{e.classes.length} 类 · {ont.relations.length} 关系</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={ev => { ev.stopPropagation(); setReanalyzeTarget({ ontId: ont.id }); setReanalyzeText('') }}
                      className="text-xs text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1 rounded-lg flex items-center gap-1 transition">
                      <RotateCcw size={11} /> {t('review.reanalyze')}
                    </button>
                    {isOpen ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
                  </div>
                </div>
              </div>

              {/* 重新分析弹框 — 本体级别 */}
              {reanalyzeTarget?.ontId === ont.id && !reanalyzeTarget.cls && (
                <div className="px-5 pb-4">
                  <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4">
                    <p className="text-xs font-medium text-indigo-700 mb-2">{t('review.reanalyze.hint')}</p>
                    <textarea value={reanalyzeText} onChange={ev => setReanalyzeText(ev.target.value)}
                      placeholder={t('review.reanalyze.placeholder')}
                      className="w-full border border-indigo-200 rounded-lg px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 resize-none h-20" />
                    <div className="flex gap-2 mt-2">
                      <button onClick={handleReanalyze} disabled={reanalyzing || !reanalyzeText.trim()}
                        className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-40 flex items-center gap-1 transition">
                        {reanalyzing ? <><Loader2 size={11} className="animate-spin" /> {t('review.reanalyze.running')}</> : t('review.reanalyze.confirm')}
                      </button>
                      <button onClick={() => setReanalyzeTarget(null)}
                        className="text-xs text-slate-500 hover:text-slate-700 px-3 py-1.5 transition">{t('review.reanalyze.cancel')}</button>
                    </div>
                  </div>
                </div>
              )}

              {/* 展开：类列表 */}
              {isOpen && (
                <div className="px-5 pb-5 border-t border-slate-100 pt-4">
                  {/* 关系预览 */}
                  {ont.relations.length > 0 && (
                    <div className="mb-4">
                      <p className="text-xs font-medium text-slate-500 mb-2">{t('review.relations')}</p>
                      <div className="flex flex-wrap gap-2">
                        {ont.relations.map((r, i) => (
                          <div key={i} className="flex items-center gap-1.5 text-xs bg-slate-50 border border-slate-100 rounded-lg px-2.5 py-1">
                            <span className="text-indigo-700 font-semibold">{r.source_class}</span>
                            <span className="text-slate-400">→ {r.relation_name} →</span>
                            <span className="text-violet-700 font-semibold">{r.target_class}</span>
                            <span className="text-slate-300 ml-1">{r.cardinality}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 类卡片 */}
                  <p className="text-xs font-medium text-slate-500 mb-2">{t('review.classes.hint')}</p>
                  <div className="space-y-3">
                    {e.classes.map(cls => {
                      const isSel = sel.has(cls.name)
                      const isReThis = reanalyzeTarget?.ontId === ont.id && reanalyzeTarget.cls === cls.name

                      return (
                        <div key={cls.name} className={`border rounded-xl p-4 transition ${isSel ? 'border-indigo-200 bg-indigo-50' : 'border-slate-100'}`}>
                          {/* 类头 */}
                          <div className="flex items-center justify-between mb-2.5">
                            <div className="flex items-center gap-2.5">
                              <input type="checkbox" checked={isSel} onChange={() => toggleClass(ont.id, cls.name)}
                                className="w-4 h-4 rounded border-slate-300 accent-indigo-600" />
                              <span className="text-sm font-semibold text-slate-800">{cls.name}</span>
                              {cls.label && cls.label !== cls.name && <span className="text-xs text-slate-400">({cls.label})</span>}
                              {cls.parent && <span className="text-xs bg-violet-50 text-violet-600 px-2 py-0.5 rounded-full">extends {cls.parent}</span>}
                            </div>
                            <button onClick={() => { setReanalyzeTarget({ ontId: ont.id, cls: cls.name }); setReanalyzeText('') }}
                              className="text-xs text-slate-400 hover:text-indigo-600 flex items-center gap-1 transition">
                              <RotateCcw size={10} /> {t('review.reanalyze.cls')}
                            </button>
                          </div>
                          {cls.description && <p className="text-xs text-slate-400 mb-2">{cls.description}</p>}

                          {/* 单类重新分析 */}
                          {isReThis && (
                            <div className="bg-white border border-indigo-100 rounded-lg p-3 mb-2.5">
                              <p className="text-xs font-medium text-indigo-700 mb-1.5">{t('review.reanalyze.cls.hint')}</p>
                              <textarea value={reanalyzeText} onChange={ev => setReanalyzeText(ev.target.value)}
                                placeholder={t('review.reanalyze.cls.placeholder')}
                                className="w-full border border-indigo-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 resize-none h-16" />
                              <div className="flex gap-2 mt-1.5">
                                <button onClick={handleReanalyze} disabled={reanalyzing || !reanalyzeText.trim()}
                                  className="text-xs bg-indigo-600 text-white px-2.5 py-1 rounded-lg hover:bg-indigo-700 disabled:opacity-40 flex items-center gap-1 transition">
                                  {reanalyzing ? <><Loader2 size={10} className="animate-spin" /> …</> : t('review.reanalyze.cls.confirm')}
                                </button>
                                <button onClick={() => setReanalyzeTarget(null)}
                                  className="text-xs text-slate-500 hover:text-slate-700 transition">{t('review.reanalyze.cancel')}</button>
                              </div>
                            </div>
                          )}

                          {/* 属性列表 */}
                          <div className="flex flex-wrap gap-1.5">
                            {cls.properties.map(p => (
                              <div key={p.name} className="flex items-center gap-1.5 text-xs bg-white border border-slate-100 rounded-lg px-2 py-1">
                                <span className="text-slate-600 font-medium">{p.name}</span>
                                <span className="text-slate-300">:</span>
                                {/* 类型下拉 */}
                                <select value={p.type} onChange={ev => editPropType(ont.id, cls.name, p.name, ev.target.value)}
                                  className="text-indigo-600 font-semibold bg-transparent border-none outline-none cursor-pointer text-xs">
                                  {PROP_TYPES.map(tp => <option key={tp} value={tp}>{tp}</option>)}
                                  {!PROP_TYPES.includes(p.type) && <option value={p.type}>{p.type}</option>}
                                </select>
                                {p.confidence != null && (
                                  <span className="text-slate-300 text-[10px]">({(p.confidence * 100).toFixed(0)}%)</span>
                                )}
                                {/* 删除属性按钮 */}
                                <button onClick={() => toggleProp(ont.id, cls.name, p.name)}
                                  className="text-slate-300 hover:text-red-500 transition ml-0.5">×</button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )
        })}

        {/* 底部确认按钮 */}
        <div className="mt-4 flex justify-end">
          <button onClick={handleSave} disabled={saving}
            className="bg-indigo-600 text-white px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40 transition">
            {saving ? t('review.saving') : t('review.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
