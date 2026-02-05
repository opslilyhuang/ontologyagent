import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Loader2, Check, RotateCcw, ArrowLeft, Plus, X } from 'lucide-react'
import { dataSources, ontologyApi } from '@/services/api'
import type { AnalysisBatch, Ontology, OntologyProperty, SourceField } from '@/types'
import { useT } from '@/i18n'

// ── constants ──────────────────────────────────────
const STAGE_LABEL_KEYS = ['review.stage.understand', 'review.stage.entity', 'review.stage.relation', 'review.stage.generate']
const STAGE_DESC_KEYS  = ['review.stage.desc.understand', 'review.stage.desc.entity', 'review.stage.desc.relation', 'review.stage.desc.generate']
const STAGE_LABELS_ZH  = ['数据理解', '实体识别', '关系发现', '本体生成']
const PROP_TYPES       = ['varchar','string','integer','int32','float','float64','boolean','date','datetime','email','url','uuid','text','json','enum','ip']
const CARD_KEYS: Record<string, string> = { 'n:1': 'review.card.n1', '1:n': 'review.card.1n', '1:1': 'review.card.11', 'n:m': 'review.card.nm' }

export function AnalysisReviewPage() {
  const { t }      = useT()
  const { batchId } = useParams<{ batchId: string }>()!
  const navigate    = useNavigate()

  // ── state ──
  const [batch,            setBatch]            = useState<AnalysisBatch | null>(null)
  const [ontologies,       setOntologies]       = useState<Ontology[]>([])
  const [edited,           setEdited]           = useState<Record<string, Ontology>>({})
  const [expanded,         setExpanded]         = useState<string | null>(null)
  const [sourceFields,     setSourceFields]     = useState<Record<string, SourceField[]>>({})
  const [addingProp,       setAddingProp]       = useState<{ ontId: string; clsName: string } | null>(null)
  const [selectedField,    setSelectedField]    = useState('')
  const [generatingLabel,  setGeneratingLabel]  = useState<Set<string>>(new Set())
  const [reanalyzeTarget,  setReanalyzeTarget]  = useState<{ ontId: string; cls?: string } | null>(null)
  const [reanalyzeText,    setReanalyzeText]    = useState('')
  const [reanalyzing,      setReanalyzing]      = useState(false)
  const [saving,           setSaving]           = useState(false)

  const pollRef     = useRef<ReturnType<typeof setInterval> | null>(null)
  const prevNameRef = useRef<Record<string, string>>({}) // key: ontId:clsName:pIdx → name on focus

  // ── poll batch ──
  useEffect(() => {
    if (!batchId) return
    const poll = async () => {
      try {
        const b = await dataSources.getBatch(batchId)
        setBatch(b)
        if (b.status === 'completed' && b.ontology_ids?.length > 0) {
          clearInterval(pollRef.current!)
          const onts: Ontology[] = []
          for (const oid of b.ontology_ids) onts.push(await ontologyApi.get(oid))
          setOntologies(onts)
          const e: Record<string, Ontology> = {}
          onts.forEach(o => {
            e[o.id] = { ...o, classes: o.classes.map(c => ({ ...c, properties: c.properties.map(p => ({ ...p })) })) }
          })
          setEdited(e)
          setExpanded(onts[0]?.id ?? null)
          // fetch source fields
          const cache: Record<string, SourceField[]> = {}
          for (const o of onts) {
            if (!cache[o.data_source_id]) {
              try { cache[o.data_source_id] = (await dataSources.getFields(o.data_source_id)).fields }
              catch { cache[o.data_source_id] = [] }
            }
          }
          setSourceFields(cache)
        } else if (b.status === 'failed') {
          clearInterval(pollRef.current!)
        }
      } catch { clearInterval(pollRef.current!) }
    }
    poll()
    pollRef.current = setInterval(poll, 2000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [batchId])

  // ── stage status (progress view) ──
  const getStageStatus = (idx: number): 'pending' | 'running' | 'completed' => {
    if (!batch) return 'pending'
    if (batch.status === 'completed') return 'completed'
    if (batch.status === 'failed')    return 'pending'
    const cur    = batch.current_stage || ''
    const curIdx = STAGE_LABELS_ZH.findIndex(l => cur.includes(l))
    if (curIdx === -1) return idx === 0 ? 'running' : 'pending'
    if (idx < curIdx)  return 'completed'
    if (idx === curIdx) return 'running'
    return 'pending'
  }

  // ── helpers: edit property ──
  const mutateProps = (ontId: string, clsName: string, fn: (props: OntologyProperty[]) => OntologyProperty[]) => {
    setEdited(prev => {
      const ont = prev[ontId]; if (!ont) return prev
      return { ...prev, [ontId]: { ...ont, classes: ont.classes.map(c => c.name === clsName ? { ...c, properties: fn(c.properties) } : c) } }
    })
  }

  const editPropName = (ontId: string, clsName: string, pIdx: number, val: string) => {
    mutateProps(ontId, clsName, props => props.map((p, i) => i === pIdx ? { ...p, name: val } : p))
  }
  const editPropType = (ontId: string, clsName: string, pIdx: number, val: string) => {
    mutateProps(ontId, clsName, props => props.map((p, i) => i === pIdx ? { ...p, type: val } : p))
  }
  const deleteProp = (ontId: string, clsName: string, pIdx: number) => {
    mutateProps(ontId, clsName, props => props.filter((_, i) => i !== pIdx))
  }

  // ── name blur → generate label ──
  const onPropNameBlur = async (ontId: string, clsName: string, pIdx: number, currentName: string) => {
    const refKey  = `${ontId}:${clsName}:${pIdx}`
    const oldName = prevNameRef.current[refKey]
    if (!oldName || oldName === currentName || !currentName.trim()) return
    const dsId    = ontologies.find(o => o.id === ontId)?.data_source_id || ''
    const lKey    = `${ontId}:${clsName}:${pIdx}`
    setGeneratingLabel(prev => new Set([...prev, lKey]))
    try {
      const res = await ontologyApi.generateLabel(ontId, currentName, dsId)
      setEdited(prev => {
        const ont = prev[ontId]; if (!ont) return prev
        return { ...prev, [ontId]: { ...ont, classes: ont.classes.map(c =>
          c.name === clsName ? { ...c, properties: c.properties.map((p, i) => i === pIdx ? { ...p, label: res.label, description: res.description } : p) } : c
        ) } }
      })
    } catch { /* ignore */ }
    setGeneratingLabel(prev => { const n = new Set(prev); n.delete(lKey); return n })
  }

  // ── add property ──
  const handleAddProp = async (ontId: string, clsName: string) => {
    const dsId = ontologies.find(o => o.id === ontId)?.data_source_id || ''
    const field = (sourceFields[dsId] || []).find(f => f.name === selectedField)
    if (!field) return
    const newProp: OntologyProperty = { name: field.name, type: 'varchar', source: field.source, is_primary_key: false }
    mutateProps(ontId, clsName, props => [...props, newProp])
    setAddingProp(null); setSelectedField('')
    // auto-generate label
    const ont = edited[ontId]; if (!ont) return
    const pIdx = (ont.classes.find(c => c.name === clsName)?.properties.length ?? 0) // index of the just-added prop
    const lKey = `${ontId}:${clsName}:${pIdx}`
    setGeneratingLabel(prev => new Set([...prev, lKey]))
    try {
      const res = await ontologyApi.generateLabel(ontId, field.name, dsId)
      setEdited(prev => {
        const o = prev[ontId]; if (!o) return prev
        return { ...prev, [ontId]: { ...o, classes: o.classes.map(c =>
          c.name === clsName ? { ...c, properties: c.properties.map(p => p.name === field.name && !p.label ? { ...p, label: res.label, description: res.description } : p) } : c
        ) } }
      })
    } catch { /* ignore */ }
    setGeneratingLabel(prev => { const n = new Set(prev); n.delete(lKey); return n })
  }

  // ── reanalyze ──
  const handleReanalyze = async () => {
    if (!reanalyzeTarget || !reanalyzeText.trim()) return
    setReanalyzing(true)
    try {
      const updated = await ontologyApi.reanalyze(reanalyzeTarget.ontId, reanalyzeText, reanalyzeTarget.cls)
      setEdited(prev => ({ ...prev, [updated.id]: updated }))
      setReanalyzeTarget(null); setReanalyzeText('')
    } catch (err) { alert(t('review.err.reanalyze') + (err as Error).message) }
    finally { setReanalyzing(false) }
  }

  // ── save ──
  const handleSave = async () => {
    setSaving(true)
    try {
      for (const ont of ontologies) {
        const e = edited[ont.id]; if (!e) continue
        await ontologyApi.update(ont.id, { classes: e.classes })
      }
      navigate('/ontologies')
    } catch (err) { alert(t('review.err.save') + (err as Error).message) }
    finally { setSaving(false) }
  }

  // ── available fields for "add property" ──
  const getAvailableFields = (ontId: string, clsName: string): SourceField[] => {
    const ont  = edited[ontId]; if (!ont) return []
    const dsId = ontologies.find(o => o.id === ontId)?.data_source_id || ''
    const cls  = ont.classes.find(c => c.name === clsName)
    const have = new Set(cls?.properties.map(p => p.name) || [])
    return (sourceFields[dsId] || []).filter(f => !have.has(f.name))
  }

  // ────────────────────────────────
  // RENDER — analyzing (progress)
  // ────────────────────────────────
  if (!batch || batch.status !== 'completed') {
    return (
      <div className="p-8 fade-in">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center gap-2 mb-6">
            <button onClick={() => navigate('/ingest')} className="text-slate-400 hover:text-slate-600 transition"><ArrowLeft size={18} /></button>
            <div>
              <h1 className="text-xl font-bold text-slate-800">{t('review.analyzing.title')}</h1>
              <p className="text-slate-400 text-xs mt-0.5">{t('review.analyzing.sub')}</p>
            </div>
          </div>
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
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-5">{t('review.flow.title')}</p>
            {STAGE_LABEL_KEYS.map((labelKey, i) => {
              const st = getStageStatus(i)
              return (
                <div key={i} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${st === 'completed' ? 'bg-emerald-500' : st === 'running' ? 'bg-indigo-500' : 'bg-slate-200'}`}>
                      {st === 'completed'  ? <Check size={16} className="text-white" />
                     : st === 'running'    ? <Loader2 size={16} className="text-white animate-spin" />
                     : <div className="w-2 h-2 rounded-full bg-slate-400" />}
                    </div>
                    {i < STAGE_LABEL_KEYS.length - 1 && <div className={`w-0.5 h-6 ${st === 'completed' ? 'bg-emerald-300' : 'bg-slate-200'}`} />}
                  </div>
                  <div className="pb-5 pt-0.5">
                    <p className={`text-sm font-semibold ${st === 'completed' ? 'text-slate-700' : st === 'running' ? 'text-indigo-600' : 'text-slate-400'}`}>
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
    )
  }

  // ────────────────────────────────
  // RENDER — review (completed)
  // ────────────────────────────────
  return (
    <div className="p-8 fade-in">
      <div className="max-w-5xl mx-auto">

        {/* header */}
        <div className="flex items-center gap-2 mb-6">
          <button onClick={() => navigate('/ingest')} className="text-slate-400 hover:text-slate-600 transition"><ArrowLeft size={18} /></button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-slate-800">{t('review.done.title')}</h1>
            <p className="text-slate-400 text-xs mt-0.5">{t('review.done.sub')}</p>
          </div>
        </div>

        {/* summary banner */}
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

        {/* ontology cards */}
        {ontologies.map(ont => {
          const e      = edited[ont.id] || ont
          const isOpen = expanded === ont.id

          return (
            <div key={ont.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm mb-4 overflow-hidden">

              {/* card header (collapsible) */}
              <div className="p-4 cursor-pointer select-none flex items-center justify-between" onClick={() => setExpanded(isOpen ? null : ont.id)}>
                <div>
                  <p className="text-sm font-semibold text-slate-800">{ont.name}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{t('review.ontology.source')}{ont.data_source_id}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-400">{e.classes.length} {t('review.classes.count')}</span>
                  <span className="text-slate-300">·</span>
                  <span className="text-xs text-slate-400">{ont.relations.length} {t('review.relations.count')}</span>
                </div>
              </div>

              {/* ── expanded body ── */}
              {isOpen && (
                <div className="border-t border-slate-100">

                  {/* ── Relations table ── */}
                  <div className="p-5 border-b border-slate-100">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('review.rel.title')}</p>
                    </div>
                    {ont.relations.length === 0 ? (
                      <p className="text-xs text-slate-400 italic">{t('review.rel.empty')}</p>
                    ) : (
                      <div className="overflow-x-auto rounded-xl border border-slate-100">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-slate-50">
                            <tr className="text-slate-500">
                              <th className="px-3 py-2 font-semibold">{t('review.rel.source')}</th>
                              <th className="px-3 py-2 font-semibold">{t('review.rel.target')}</th>
                              <th className="px-3 py-2 font-semibold">{t('review.rel.name')}</th>
                              <th className="px-3 py-2 font-semibold">{t('review.rel.srcField')}</th>
                              <th className="px-3 py-2 font-semibold">{t('review.rel.tgtField')}</th>
                              <th className="px-3 py-2 font-semibold">{t('review.rel.type')}</th>
                              <th className="px-3 py-2 font-semibold">{t('review.rel.confidence')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {ont.relations.map((r, i) => (
                              <tr key={i} className="border-t border-slate-100">
                                <td className="px-3 py-2"><span className="bg-indigo-50 text-indigo-700 font-semibold px-2 py-0.5 rounded-lg">{r.source_class}</span></td>
                                <td className="px-3 py-2"><span className="bg-violet-50 text-violet-700 font-semibold px-2 py-0.5 rounded-lg">{r.target_class}</span></td>
                                <td className="px-3 py-2 text-slate-600 font-medium">{r.relation_name}</td>
                                <td className="px-3 py-2 text-slate-500 font-mono">{r.source_field || '—'}</td>
                                <td className="px-3 py-2 text-slate-500 font-mono">{r.target_field || '—'}</td>
                                <td className="px-3 py-2"><span className="bg-slate-50 text-slate-600 px-2 py-0.5 rounded-lg font-medium">{t(CARD_KEYS[r.cardinality] || 'review.card.n1')}</span></td>
                                <td className="px-3 py-2 text-slate-400">{(r.confidence * 100).toFixed(0)}%</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* ── Classes ── */}
                  <div className="p-5 space-y-5">

                    {/* ontology-level reanalyze panel */}
                    {reanalyzeTarget?.ontId === ont.id && !reanalyzeTarget.cls && (
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
                          <button onClick={() => setReanalyzeTarget(null)} className="text-xs text-slate-500 hover:text-slate-700 transition">{t('review.reanalyze.cancel')}</button>
                        </div>
                      </div>
                    )}

                    {e.classes.map((cls, clsIdx) => {
                      const isAddingThis = addingProp?.ontId === ont.id && addingProp.clsName === cls.name
                      const avail        = isAddingThis ? getAvailableFields(ont.id, cls.name) : []

                      return (
                        <div key={clsIdx} className="border border-slate-100 rounded-xl overflow-hidden">

                          {/* class header */}
                          <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50">
                            <div className="flex items-center gap-2.5">
                              <span className="text-sm font-semibold text-slate-800">{cls.name}</span>
                              {cls.label && cls.label !== cls.name && <span className="text-xs text-slate-400">({cls.label})</span>}
                              {cls.parent && <span className="text-xs bg-violet-50 text-violet-600 px-2 py-0.5 rounded-full">extends {cls.parent}</span>}
                            </div>
                            <button onClick={() => { setReanalyzeTarget({ ontId: ont.id, cls: cls.name }); setReanalyzeText('') }}
                              className="text-xs text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1 rounded-lg flex items-center gap-1 transition">
                              <RotateCcw size={11} /> {t('review.reanalyze')}
                            </button>
                          </div>

                          {/* class-level reanalyze panel */}
                          {reanalyzeTarget?.ontId === ont.id && reanalyzeTarget.cls === cls.name && (
                            <div className="px-4 py-3 bg-indigo-50 border-b border-indigo-100">
                              <p className="text-xs font-medium text-indigo-700 mb-1.5">{t('review.reanalyze.cls.hint')}</p>
                              <textarea value={reanalyzeText} onChange={ev => setReanalyzeText(ev.target.value)}
                                placeholder={t('review.reanalyze.cls.placeholder')}
                                className="w-full border border-indigo-200 rounded-lg px-3 py-2 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 resize-none h-16" />
                              <div className="flex gap-2 mt-1.5">
                                <button onClick={handleReanalyze} disabled={reanalyzing || !reanalyzeText.trim()}
                                  className="text-xs bg-indigo-600 text-white px-2.5 py-1 rounded-lg hover:bg-indigo-700 disabled:opacity-40 flex items-center gap-1 transition">
                                  {reanalyzing ? <><Loader2 size={10} className="animate-spin" /> …</> : t('review.reanalyze.cls.confirm')}
                                </button>
                                <button onClick={() => setReanalyzeTarget(null)} className="text-xs text-slate-500 hover:text-slate-700 transition">{t('review.reanalyze.cancel')}</button>
                              </div>
                            </div>
                          )}

                          {/* properties table */}
                          <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs">
                              <thead>
                                <tr className="text-slate-400 border-b border-slate-100 bg-slate-50/60">
                                  <th className="px-3 py-2 font-semibold">{t('review.prop.engname')}</th>
                                  <th className="px-3 py-2 font-semibold">{t('review.prop.label')}</th>
                                  <th className="px-3 py-2 font-semibold">{t('review.prop.type')}</th>
                                  <th className="px-3 py-2 font-semibold">{t('review.prop.source')}</th>
                                  <th className="px-3 py-2 font-semibold text-center w-12">{t('review.prop.pk')}</th>
                                  <th className="px-3 py-2 w-10"></th>
                                </tr>
                              </thead>
                              <tbody>
                                {cls.properties.map((p, pIdx) => {
                                  const lKey         = `${ont.id}:${cls.name}:${pIdx}`
                                  const isGenerating = generatingLabel.has(lKey)
                                  return (
                                    <tr key={pIdx} className="border-t border-slate-100 hover:bg-slate-50/40 transition-colors">
                                      {/* editable english name */}
                                      <td className="px-3 py-2">
                                        <input
                                          type="text"
                                          value={p.name}
                                          onFocus={() => { prevNameRef.current[lKey] = p.name }}
                                          onChange={e => editPropName(ont.id, cls.name, pIdx, e.target.value)}
                                          onBlur={() => onPropNameBlur(ont.id, cls.name, pIdx, p.name)}
                                          className="w-full min-w-[100px] border border-slate-200 rounded-lg px-2 py-1 text-slate-800 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-transparent"
                                        />
                                      </td>
                                      {/* label + description (auto-generated) */}
                                      <td className="px-3 py-2">
                                        {isGenerating ? (
                                          <span className="text-slate-400 flex items-center gap-1 text-xs">
                                            <Loader2 size={10} className="animate-spin" /> {t('review.prop.generating')}
                                          </span>
                                        ) : (
                                          <div>
                                            <p className="text-slate-700 font-medium">{p.label || '—'}</p>
                                            {p.description && <p className="text-slate-400 mt-0.5 leading-tight">{p.description}</p>}
                                          </div>
                                        )}
                                      </td>
                                      {/* type dropdown */}
                                      <td className="px-3 py-2">
                                        <select value={p.type} onChange={e => editPropType(ont.id, cls.name, pIdx, e.target.value)}
                                          className="border border-slate-200 rounded-lg px-2 py-1 text-indigo-600 font-semibold bg-transparent focus:outline-none focus:ring-2 focus:ring-indigo-200 cursor-pointer">
                                          {PROP_TYPES.map(tp => <option key={tp} value={tp}>{tp}</option>)}
                                          {!PROP_TYPES.includes(p.type) && <option value={p.type}>{p.type}</option>}
                                        </select>
                                      </td>
                                      {/* source field */}
                                      <td className="px-3 py-2">
                                        <span className="text-slate-500 font-mono text-[11px]">{p.source || '—'}</span>
                                      </td>
                                      {/* primary key badge */}
                                      <td className="px-3 py-2 text-center">
                                        {p.is_primary_key
                                          ? <span className="inline-block bg-amber-50 text-amber-700 font-bold text-[10px] px-1.5 py-0.5 rounded border border-amber-200">PK</span>
                                          : <span className="text-slate-300">—</span>}
                                      </td>
                                      {/* delete btn */}
                                      <td className="px-3 py-2">
                                        <button onClick={() => deleteProp(ont.id, cls.name, pIdx)}
                                          className="text-slate-300 hover:text-red-500 transition"><X size={14} /></button>
                                      </td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>

                          {/* add property row */}
                          <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50/30">
                            {!isAddingThis ? (
                              <button onClick={() => { setAddingProp({ ontId: ont.id, clsName: cls.name }); setSelectedField('') }}
                                className="text-xs text-indigo-600 hover:text-indigo-700 flex items-center gap-1 transition">
                                <Plus size={12} /> {t('review.addProp.btn')}
                              </button>
                            ) : (
                              <div className="flex items-center gap-2">
                                {avail.length === 0 ? (
                                  <span className="text-xs text-slate-400 italic">{t('review.addProp.empty')}</span>
                                ) : (
                                  <>
                                    <select value={selectedField} onChange={e => setSelectedField(e.target.value)}
                                      className="flex-1 border border-slate-200 rounded-lg px-2.5 py-1 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-200">
                                      <option value="">{t('review.addProp.select')}</option>
                                      {avail.map(f => <option key={f.name} value={f.name}>{f.name} — {f.source}</option>)}
                                    </select>
                                    <button onClick={() => handleAddProp(ont.id, cls.name)} disabled={!selectedField}
                                      className="text-xs bg-indigo-600 text-white px-3 py-1 rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition">
                                      {t('review.addProp.add')}
                                    </button>
                                  </>
                                )}
                                <button onClick={() => setAddingProp(null)} className="text-xs text-slate-400 hover:text-slate-600 transition">{t('review.addProp.cancel')}</button>
                              </div>
                            )}
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

        {/* confirm button */}
        <div className="mt-6 flex justify-end">
          <button onClick={handleSave} disabled={saving}
            className="bg-indigo-600 text-white px-8 py-2.5 rounded-xl text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40 transition">
            {saving ? t('review.saving') : t('review.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
