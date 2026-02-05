import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, MessageSquare, Layers } from 'lucide-react'
import { ontologyApi } from '@/services/api'
import type { Ontology, GraphNode, GraphEdge } from '@/types'
import { GraphEditor } from '@/components/OntologyEditor/GraphEditor'
import { useT } from '@/i18n'

type DetailTab = 'graph' | 'classes' | 'relations' | 'objects' | 'apis'

const TAB_ORDER: DetailTab[] = ['graph', 'classes', 'relations', 'objects', 'apis']

const TAB_KEYS: Record<DetailTab, string> = {
  graph:     'ontologyDetail.tab.graph',
  classes:   'ontologyDetail.tab.classes',
  relations: 'ontologyDetail.tab.rels',
  objects:   'ontologyDetail.tab.objects',
  apis:      'ontologyDetail.tab.apis',
}

// ── cardinality badge helpers ──
const CARD_KEY: Record<string, string> = {
  'n:1':  'review.card.n1',
  '1:n':  'review.card.1n',
  '1:1':  'review.card.11',
  'n:m':  'review.card.nm',
}
const CARD_COLOR: Record<string, string> = {
  'n:1':  'bg-amber-50 text-amber-700',
  '1:n':  'bg-sky-50 text-sky-700',
  '1:1':  'bg-emerald-50 text-emerald-700',
  'n:m':  'bg-rose-50 text-rose-700',
}

export function OntologyDetailPage() {
  const { t } = useT()
  const { id }   = useParams<{ id: string }>()!
  const navigate = useNavigate()

  const [ontology, setOntology]     = useState<Ontology | null>(null)
  const [graph, setGraph]           = useState<{ nodes: GraphNode[]; edges: GraphEdge[] }>({ nodes: [], edges: [] })
  const [tab, setTab]               = useState<DetailTab>('graph')
  const [publishing, setPublishing] = useState(false)
  const [apis, setApis]             = useState<{ path: string; method: string; description: string }[]>([])

  // ── objects tab state ──
  const [entities, setEntities]         = useState<Record<string, unknown>[]>([])
  const [objectsLoading, setObjectsLoading] = useState(false)
  const [classFilter, setClassFilter]   = useState<string>('')   // '' = all

  useEffect(() => {
    if (!id) return
    ontologyApi.get(id).then(setOntology).catch(() => {})
    ontologyApi.getGraph(id).then(setGraph).catch(() => {})
  }, [id])

  // fetch entities when objects tab is active or filter changes
  useEffect(() => {
    if (tab !== 'objects' || !id) return
    setObjectsLoading(true)
    ontologyApi.entities(id, classFilter || undefined)
      .then(res => { setEntities(res.entities as Record<string, unknown>[]); setObjectsLoading(false) })
      .catch(() => { setEntities([]); setObjectsLoading(false) })
  }, [tab, id, classFilter])

  const handlePublish = async () => {
    if (!id) return
    setPublishing(true)
    try {
      const updated = await ontologyApi.publish(id)
      setOntology(updated)
      const generatedApis = await ontologyApi.getApis(id)
      setApis(generatedApis)
      setTab('apis')
    } catch (err) {
      alert(t('ontologyDetail.err.publish') + (err as Error).message)
    } finally {
      setPublishing(false)
    }
  }

  const handleTabSwitch = (next: DetailTab) => {
    setTab(next)
    if (next === 'apis') ontologyApi.getApis(id!).then(setApis).catch(() => {})
    if (next === 'objects') setClassFilter('')  // reset filter on entry
  }

  if (!ontology) {
    return (
      <div className="p-8 fade-in">
        <div className="max-w-5xl mx-auto">
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-16 text-center">
            <p className="text-sm text-slate-400">{t('ontologyDetail.loading')}</p>
          </div>
        </div>
      </div>
    )
  }

  // ── derive entity table columns (exclude _id) ──
  const entityCols: string[] = entities.length
    ? Object.keys(entities[0]).filter(k => k !== '_id')
    : []

  return (
    <div className="p-8 fade-in">
      <div className="max-w-5xl mx-auto">

        {/* Back nav */}
        <button onClick={() => navigate('/ontologies')}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 transition mb-4">
          <ArrowLeft size={13} /> {t('ontologyDetail.back')}
        </button>

        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div className="flex items-start gap-4">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #e0e7ff, #ede9fe)' }}>
              <Layers size={18} className="text-indigo-500" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-800">{ontology.name}</h1>
              <p className="text-xs text-slate-400 mt-0.5">{ontology.description || t('ontologyDetail.noDesc')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${
              ontology.status === 'published' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
            }`}>{ontology.status}</span>

            {ontology.status === 'pending' && (
              <button onClick={handlePublish} disabled={publishing}
                className="bg-emerald-500 text-white px-4 py-1.5 rounded-xl text-xs font-semibold hover:bg-emerald-600 disabled:opacity-40 transition">
                {publishing ? t('ontologyDetail.publishing') : t('ontologyDetail.publish')}
              </button>
            )}
            {ontology.status === 'published' && (
              <button onClick={() => navigate(`/ontologies/${id}/chat`)}
                className="flex items-center gap-1.5 bg-slate-900 text-white px-4 py-1.5 rounded-xl text-xs font-semibold hover:bg-slate-800 transition">
                <MessageSquare size={13} /> {t('ontologyDetail.qa')}
              </button>
            )}
          </div>
        </div>

        {/* Pill Tabs */}
        <div className="bg-slate-100 rounded-xl p-1 flex gap-0.5 w-fit mb-5">
          {TAB_ORDER.map(tabKey => (
            <button key={tabKey}
              onClick={() => handleTabSwitch(tabKey)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                tab === tabKey ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'
              }`}>
              {t(TAB_KEYS[tabKey])}
            </button>
          ))}
        </div>

        {/* ── Content ── */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">

          {/* ── Graph ── */}
          {tab === 'graph' && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-slate-400">{t('ontologyDetail.graph.desc')}</p>
                <div className="flex gap-3">
                  <span className="text-xs text-slate-400">{t('ontologyDetail.graph.nodes', { n: graph.nodes.length })}</span>
                  <span className="text-xs text-slate-400">{t('ontologyDetail.graph.edges', { n: graph.edges.length })}</span>
                </div>
              </div>
              <GraphEditor nodes={graph.nodes} edges={graph.edges} />
            </div>
          )}

          {/* ── Classes (enhanced table) ── */}
          {tab === 'classes' && (
            <div className="space-y-4">
              {ontology.classes.map((cls, i) => (
                <div key={i} className="border border-slate-100 rounded-xl overflow-hidden">
                  {/* class header */}
                  <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 flex-wrap">
                    <span className="text-sm font-semibold text-slate-800">{cls.name}</span>
                    {cls.label && cls.label !== cls.name && (
                      <span className="text-xs text-slate-400">({cls.label})</span>
                    )}
                    {cls.parent && (
                      <span className="text-xs bg-violet-50 text-violet-600 px-2 py-0.5 rounded-full">extends {cls.parent}</span>
                    )}
                    <span className="text-xs text-slate-400 ml-auto">{cls.properties.length} {t('review.classes.count')}</span>
                  </div>
                  {cls.description && (
                    <p className="text-xs text-slate-400 px-4 pt-2">{cls.description}</p>
                  )}

                  {/* properties table */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-left" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
                      <thead>
                        <tr className="bg-slate-50 border-t border-slate-100">
                          <th className="text-xs font-semibold text-slate-400 px-4 py-2">{t('review.prop.engname')}</th>
                          <th className="text-xs font-semibold text-slate-400 px-3 py-2">{t('review.prop.label')}</th>
                          <th className="text-xs font-semibold text-slate-400 px-3 py-2">{t('review.prop.type')}</th>
                          <th className="text-xs font-semibold text-slate-400 px-3 py-2">{t('review.prop.source')}</th>
                          <th className="text-xs font-semibold text-slate-400 px-3 py-2 text-center w-12">{t('review.prop.pk')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cls.properties.map((p, j) => (
                          <tr key={j} className="border-t border-slate-50 hover:bg-slate-50/40 transition">
                            <td className="px-4 py-2">
                              <span className="text-xs font-medium text-slate-700">{p.name}</span>
                            </td>
                            <td className="px-3 py-2">
                              <span className="text-xs text-slate-500">{p.label || '—'}</span>
                              {p.description && (
                                <p className="text-[10px] text-slate-400 mt-0.5 leading-tight">{p.description}</p>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <span className="text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-lg font-medium">{p.type}</span>
                            </td>
                            <td className="px-3 py-2">
                              <span className="text-xs font-mono text-slate-400">{p.source || '—'}</span>
                            </td>
                            <td className="px-3 py-2 text-center">
                              {p.is_primary_key && (
                                <span className="text-[10px] font-bold bg-emerald-50 text-emerald-600 px-1.5 py-0.5 rounded">PK</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Relations (enhanced table) ── */}
          {tab === 'relations' && (
            <div>
              {ontology.relations.length === 0 ? (
                <p className="text-sm text-slate-400">{t('ontologyDetail.rels.empty')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-100">
                        <th className="text-xs font-semibold text-slate-400 px-4 py-2.5">{t('review.rel.source')}</th>
                        <th className="text-xs font-semibold text-slate-400 px-3 py-2.5">{t('review.rel.target')}</th>
                        <th className="text-xs font-semibold text-slate-400 px-3 py-2.5">{t('review.rel.name')}</th>
                        <th className="text-xs font-semibold text-slate-400 px-3 py-2.5">{t('review.rel.srcField')}</th>
                        <th className="text-xs font-semibold text-slate-400 px-3 py-2.5">{t('review.rel.tgtField')}</th>
                        <th className="text-xs font-semibold text-slate-400 px-3 py-2.5">{t('review.rel.type')}</th>
                        <th className="text-xs font-semibold text-slate-400 px-3 py-2.5 text-right">{t('review.rel.confidence')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ontology.relations.map((r, i) => (
                        <tr key={i} className={`border-t border-slate-50 hover:bg-slate-50/40 transition ${i % 2 === 1 ? 'bg-slate-50/20' : ''}`}>
                          <td className="px-4 py-2.5">
                            <span className="text-xs font-semibold bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-lg">{r.source_class}</span>
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="text-xs font-semibold bg-violet-50 text-violet-700 px-2 py-0.5 rounded-lg">{r.target_class}</span>
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="text-xs font-medium text-slate-700">{r.relation_name}</span>
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="text-xs font-mono text-slate-500">{r.source_field || '—'}</span>
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="text-xs font-mono text-slate-500">{r.target_field || '—'}</span>
                          </td>
                          <td className="px-3 py-2.5">
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-lg ${CARD_COLOR[r.cardinality] || 'bg-slate-50 text-slate-600'}`}>
                              {t(CARD_KEY[r.cardinality] || r.cardinality)}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <span className="text-xs text-slate-500">{(r.confidence * 100).toFixed(0)}%</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── Objects (entity instances) ── */}
          {tab === 'objects' && (
            <div>
              {/* class filter dropdown */}
              <div className="flex items-center gap-3 mb-4">
                <select value={classFilter} onChange={e => setClassFilter(e.target.value)}
                  className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 text-slate-600 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300">
                  <option value="">{t('ontologyDetail.objects.all')}</option>
                  {ontology.classes.map((cls, i) => (
                    <option key={i} value={cls.name}>{cls.name}{cls.label && cls.label !== cls.name ? ` (${cls.label})` : ''}</option>
                  ))}
                </select>
                {entities.length > 0 && (
                  <span className="text-xs text-slate-400">{t('ontologyDetail.objects.count', { n: entities.length })}</span>
                )}
              </div>

              {/* loading / empty / table */}
              {objectsLoading ? (
                <p className="text-sm text-slate-400 py-6 text-center">{t('ontologyDetail.objects.loading')}</p>
              ) : entities.length === 0 ? (
                <p className="text-sm text-slate-400 py-6 text-center">{t('ontologyDetail.objects.empty')}</p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-100">
                  <table className="w-full text-left" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
                    <thead>
                      <tr className="bg-slate-50">
                        {entityCols.map(col => (
                          <th key={col} className="text-xs font-semibold text-slate-500 px-4 py-2.5 border-b border-slate-100 whitespace-nowrap">{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {entities.map((row, i) => (
                        <tr key={i} className={`border-t border-slate-50 hover:bg-indigo-50/30 transition ${i % 2 === 1 ? 'bg-slate-50/30' : ''}`}>
                          {entityCols.map(col => (
                            <td key={col} className="px-4 py-2 text-xs text-slate-600 whitespace-nowrap">
                              {row[col] != null ? String(row[col]) : '—'}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── APIs ── */}
          {tab === 'apis' && (
            <div>
              {apis.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-sm text-slate-400">{t('ontologyDetail.apis.empty')}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {apis.map((a, i) => (
                    <div key={i} className="flex items-center gap-3 p-3 border border-slate-100 rounded-xl">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-lg ${
                        a.method === 'GET' ? 'bg-emerald-50 text-emerald-700' : 'bg-indigo-50 text-indigo-700'
                      }`}>{a.method}</span>
                      <code className="text-xs font-mono text-slate-700 flex-1">{a.path}</code>
                      <span className="text-xs text-slate-400">{a.description}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
