import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Loader2, Check, RotateCcw, ArrowLeft, Plus, X, Trash2, Edit2, Settings } from 'lucide-react'
import { dataSources, ontologyApi } from '@/services/api'
import type { AnalysisBatch, Ontology, OntologyProperty, SourceField, OntologyRelation, DataCleaningConfig } from '@/types'
import { useT } from '@/i18n'
import { DataCleaningDialog } from '@/components/DataCleaningDialog'

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
  const [cleaningDialogVisible, setCleaningDialogVisible] = useState(false)
  const [importLoading,    setImportLoading]    = useState(false)
  const [addingRelation,   setAddingRelation]   = useState<string | null>(null) // ontology ID
  const [editingRelation,  setEditingRelation]  = useState<{ ontId: string; relIdx: number } | null>(null)
  const [newRelation,      setNewRelation]      = useState<Partial<OntologyRelation>>({
    source_class: '',
    target_class: '',
    relation_name: 'references',
    cardinality: 'n:1',
    confidence: 0.85,
    source_field: '',
    target_field: ''
  })

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
  const editPropDisplayName = (ontId: string, clsName: string, pIdx: number, val: string) => {
    mutateProps(ontId, clsName, props => props.map((p, i) => i === pIdx ? { ...p, display_name: val } : p))
  }
  const togglePrimaryKey = (ontId: string, clsName: string, pIdx: number) => {
    mutateProps(ontId, clsName, props => props.map((p, i) => i === pIdx ? { ...p, is_primary_key: !p.is_primary_key } : p))
  }
  const deleteProp = (ontId: string, clsName: string, pIdx: number) => {
    mutateProps(ontId, clsName, props => props.filter((_, i) => i !== pIdx))
  }

  // ── name blur → generate label and display_name ──
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
          c.name === clsName ? { ...c, properties: c.properties.map((p, i) =>
            i === pIdx ? { ...p, label: res.label, description: res.description, display_name: p.display_name || res.label } : p
          ) } : c
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
    const newProp: OntologyProperty = { name: field.name, type: 'varchar', source: field.source, is_primary_key: false, display_name: '' }
    mutateProps(ontId, clsName, props => [...props, newProp])
    setAddingProp(null); setSelectedField('')
    // auto-generate label and display_name
    const ont = edited[ontId]; if (!ont) return
    const pIdx = (ont.classes.find(c => c.name === clsName)?.properties.length ?? 0) // index of the just-added prop
    const lKey = `${ontId}:${clsName}:${pIdx}`
    setGeneratingLabel(prev => new Set([...prev, lKey]))
    try {
      const res = await ontologyApi.generateLabel(ontId, field.name, dsId)
      setEdited(prev => {
        const o = prev[ontId]; if (!o) return prev
        return { ...prev, [ontId]: { ...o, classes: o.classes.map(c =>
          c.name === clsName ? { ...c, properties: c.properties.map(p =>
            p.name === field.name && !p.label ? { ...p, label: res.label, description: res.description, display_name: res.label } : p
          ) } : c
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

  // ── 关系管理 ──
  const deleteRelation = (ontId: string, relIdx: number) => {
    if (!confirm('确定要删除这个关系吗？')) return
    setEdited(prev => {
      const ont = prev[ontId]
      if (!ont) return prev
      const newRelations = ont.relations.filter((_, i) => i !== relIdx)
      return { ...prev, [ontId]: { ...ont, relations: newRelations } }
    })
  }

  const startAddRelation = (ontId: string) => {
    const ont = edited[ontId]
    if (!ont || ont.classes.length === 0) return
    // 获取所有可用的类名
    const allClasses = ontologies.flatMap(o => o.classes.map(c => c.name))
    setNewRelation({
      source_class: ont.classes[0].name,
      target_class: allClasses.find(c => c !== ont.classes[0].name) || '',
      relation_name: 'references',
      cardinality: 'n:1',
      confidence: 0.85,
      source_field: '',
      target_field: ''
    })
    setAddingRelation(ontId)
  }

  const addRelation = (ontId: string) => {
    if (!newRelation.source_class || !newRelation.target_class) {
      alert('请填写源类和目标类')
      return
    }
    setEdited(prev => {
      const ont = prev[ontId]
      if (!ont) return prev
      const relation: OntologyRelation = {
        source_class: newRelation.source_class!,
        target_class: newRelation.target_class!,
        relation_name: newRelation.relation_name || 'references',
        relation_type: 'many_to_one',
        confidence: newRelation.confidence || 0.85,
        cardinality: newRelation.cardinality || 'n:1',
        source_field: newRelation.source_field,
        target_field: newRelation.target_field,
        inferred_from: 'manual',
        metadata: {}
      }
      return { ...prev, [ontId]: { ...ont, relations: [...ont.relations, relation] } }
    })
    setAddingRelation(null)
  }

  // ── save ──
  const handleSave = async () => {
    setSaving(true)
    try {
      for (const ont of ontologies) {
        const e = edited[ont.id]; if (!e) continue
        await ontologyApi.update(ont.id, { classes: e.classes, relations: e.relations })
      }
      navigate('/ontologies')
    } catch (err) { alert(t('review.err.save') + (err as Error).message) }
    finally { setSaving(false) }
  }

  // ── import with data cleaning ──
  const handleImport = async (cleaningConfig: DataCleaningConfig) => {
    setCleaningDialogVisible(false)
    setImportLoading(true)

    try {
      // 保存本体更新
      for (const ont of ontologies) {
        const e = edited[ont.id]
        if (e) {
          await ontologyApi.update(ont.id, { classes: e.classes, relations: e.relations })
        }
      }

      // 创建导入任务
      const importPromises = ontologies.map(ont =>
        ontologyApi.import(ont.id, cleaningConfig)
      )
      await Promise.all(importPromises)

      alert('导入任务已创建，正在处理中...')
      navigate('/import-logs')
    } catch (err) {
      alert('导入失败: ' + (err as Error).message)
    } finally {
      setImportLoading(false)
    }
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
                      <button
                        onClick={() => startAddRelation(ont.id)}
                        className="text-xs bg-indigo-50 text-indigo-600 hover:bg-indigo-100 px-2.5 py-1 rounded-lg flex items-center gap-1 transition"
                      >
                        <Plus size={12} /> 添加关系
                      </button>
                    </div>

                    {/* 添加关系表单 */}
                    {addingRelation === ont.id && (
                      <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 mb-3">
                        <p className="text-xs font-medium text-indigo-700 mb-3">添加新关系</p>
                        <div className="grid grid-cols-2 gap-3 mb-3">
                          <div>
                            <label className="block text-xs text-slate-600 mb-1">源类</label>
                            <select
                              value={newRelation.source_class}
                              onChange={e => setNewRelation(prev => ({ ...prev, source_class: e.target.value }))}
                              className="w-full border border-indigo-200 rounded-lg px-2 py-1.5 text-xs"
                            >
                              {ontologies.flatMap(o => o.classes.map(c => (
                                <option key={c.name} value={c.name}>{c.name}</option>
                              )))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs text-slate-600 mb-1">目标类</label>
                            <select
                              value={newRelation.target_class}
                              onChange={e => setNewRelation(prev => ({ ...prev, target_class: e.target.value }))}
                              className="w-full border border-indigo-200 rounded-lg px-2 py-1.5 text-xs"
                            >
                              {ontologies.flatMap(o => o.classes.map(c => (
                                <option key={c.name} value={c.name}>{c.name}</option>
                              )))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs text-slate-600 mb-1">源字段</label>
                            <input
                              type="text"
                              value={newRelation.source_field}
                              onChange={e => setNewRelation(prev => ({ ...prev, source_field: e.target.value }))}
                              placeholder="例如: 司机ID"
                              className="w-full border border-indigo-200 rounded-lg px-2 py-1.5 text-xs"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-slate-600 mb-1">目标字段</label>
                            <input
                              type="text"
                              value={newRelation.target_field}
                              onChange={e => setNewRelation(prev => ({ ...prev, target_field: e.target.value }))}
                              placeholder="例如: 司机ID"
                              className="w-full border border-indigo-200 rounded-lg px-2 py-1.5 text-xs"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-slate-600 mb-1">关系类型</label>
                            <select
                              value={newRelation.cardinality}
                              onChange={e => setNewRelation(prev => ({ ...prev, cardinality: e.target.value as any }))}
                              className="w-full border border-indigo-200 rounded-lg px-2 py-1.5 text-xs"
                            >
                              <option value="n:1">多对一 (n:1)</option>
                              <option value="1:n">一对多 (1:n)</option>
                              <option value="1:1">一对一 (1:1)</option>
                              <option value="n:m">多对多 (n:m)</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs text-slate-600 mb-1">关系名称</label>
                            <input
                              type="text"
                              value={newRelation.relation_name}
                              onChange={e => setNewRelation(prev => ({ ...prev, relation_name: e.target.value }))}
                              placeholder="references"
                              className="w-full border border-indigo-200 rounded-lg px-2 py-1.5 text-xs"
                            />
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => addRelation(ont.id)}
                            className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 transition"
                          >
                            确认添加
                          </button>
                          <button
                            onClick={() => setAddingRelation(null)}
                            className="text-xs text-slate-500 hover:text-slate-700 transition"
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    )}

                    {e.relations.length === 0 ? (
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
                              <th className="px-3 py-2 font-semibold">操作</th>
                            </tr>
                          </thead>
                          <tbody>
                            {e.relations.map((r, i) => (
                              <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
                                <td className="px-3 py-2"><span className="bg-indigo-50 text-indigo-700 font-semibold px-2 py-0.5 rounded-lg">{r.source_class}</span></td>
                                <td className="px-3 py-2"><span className="bg-violet-50 text-violet-700 font-semibold px-2 py-0.5 rounded-lg">{r.target_class}</span></td>
                                <td className="px-3 py-2 text-slate-600 font-medium">{r.relation_name}</td>
                                <td className="px-3 py-2 text-slate-500 font-mono text-[10px]">{r.source_field || '—'}</td>
                                <td className="px-3 py-2 text-slate-500 font-mono text-[10px]">{r.target_field || '—'}</td>
                                <td className="px-3 py-2"><span className="bg-slate-50 text-slate-600 px-2 py-0.5 rounded-lg font-medium">{t(CARD_KEYS[r.cardinality] || 'review.card.n1')}</span></td>
                                <td className="px-3 py-2 text-slate-400">{(r.confidence * 100).toFixed(0)}%</td>
                                <td className="px-3 py-2">
                                  <button
                                    onClick={() => deleteRelation(ont.id, i)}
                                    className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition"
                                    title="删除关系"
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                </td>
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
                                  <th className="px-3 py-2 font-semibold text-center w-16">{t('review.prop.pk')}</th>
                                  <th className="px-3 py-2 font-semibold">展示名称</th>
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
                                      {/* primary key checkbox */}
                                      <td className="px-3 py-2 text-center">
                                        <input
                                          type="checkbox"
                                          checked={p.is_primary_key || false}
                                          onChange={() => togglePrimaryKey(ont.id, cls.name, pIdx)}
                                          className="w-4 h-4 text-amber-600 bg-gray-100 border-gray-300 rounded focus:ring-amber-500 focus:ring-2 cursor-pointer"
                                          title="设置为主键"
                                        />
                                      </td>
                                      {/* display name */}
                                      <td className="px-3 py-2">
                                        <input
                                          type="text"
                                          value={p.display_name || ''}
                                          onChange={e => editPropDisplayName(ont.id, cls.name, pIdx, e.target.value)}
                                          placeholder="展示名称"
                                          className="w-full min-w-[100px] border border-slate-200 rounded-lg px-2 py-1 text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-transparent"
                                        />
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
        <div className="mt-6 flex items-center justify-between gap-4">
          <button
            onClick={() => navigate('/ingest')}
            className="text-slate-600 hover:text-slate-800 px-4 py-2.5 rounded-xl text-sm font-medium transition"
          >
            取消
          </button>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setCleaningDialogVisible(true)}
              className="flex items-center gap-2 bg-slate-100 text-slate-700 px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-slate-200 transition"
            >
              <Settings size={16} />
              数据清洗设置
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="bg-slate-600 text-white px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-slate-700 disabled:opacity-40 transition"
            >
              {saving ? t('review.saving') : '保存'}
            </button>
            <button
              onClick={() => setCleaningDialogVisible(true)}
              disabled={importLoading}
              className="bg-indigo-600 text-white px-8 py-2.5 rounded-xl text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40 transition"
            >
              {importLoading ? '导入中...' : '导入本体管理'}
            </button>
          </div>
        </div>

        {/* Data Cleaning Dialog */}
        <DataCleaningDialog
          visible={cleaningDialogVisible}
          onClose={() => setCleaningDialogVisible(false)}
          onConfirm={handleImport}
        />
      </div>
    </div>
  )
}
