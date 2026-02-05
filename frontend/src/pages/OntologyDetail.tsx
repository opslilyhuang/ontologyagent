import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, MessageSquare, Layers } from 'lucide-react'
import { ontologyApi } from '@/services/api'
import type { Ontology, GraphNode, GraphEdge } from '@/types'
import { GraphEditor } from '@/components/OntologyEditor/GraphEditor'
import { useT } from '@/i18n'

type DetailTab = 'graph' | 'classes' | 'relations' | 'apis'

const TAB_KEYS: Record<DetailTab, string> = {
  graph: 'ontologyDetail.tab.graph', classes: 'ontologyDetail.tab.classes', relations: 'ontologyDetail.tab.rels', apis: 'ontologyDetail.tab.apis',
}

export function OntologyDetailPage() {
  const { t } = useT()
  const { id }     = useParams<{ id: string }>()!
  const navigate   = useNavigate()
  const [ontology, setOntology]       = useState<Ontology | null>(null)
  const [graph, setGraph]             = useState<{ nodes: GraphNode[]; edges: GraphEdge[] }>({ nodes: [], edges: [] })
  const [tab, setTab]                 = useState<DetailTab>('graph')
  const [publishing, setPublishing]   = useState(false)
  const [apis, setApis]               = useState<{ path: string; method: string; description: string }[]>([])

  useEffect(() => {
    if (!id) return
    ontologyApi.get(id).then(setOntology).catch(() => {})
    ontologyApi.getGraph(id).then(setGraph).catch(() => {})
  }, [id])

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
          {(['graph', 'classes', 'relations', 'apis'] as DetailTab[]).map(tabKey => (
            <button key={tabKey}
              onClick={() => { setTab(tabKey); if (tabKey === 'apis') ontologyApi.getApis(id!).then(setApis).catch(() => {}) }}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                tab === tabKey ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'
              }`}>
              {t(TAB_KEYS[tabKey])}
            </button>
          ))}
        </div>

        {/* ── Content ── */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">

          {/* Graph */}
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

          {/* Classes */}
          {tab === 'classes' && (
            <div className="space-y-3">
              {ontology.classes.map((cls, i) => (
                <div key={i} className="border border-slate-100 rounded-xl p-4">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-slate-800">{cls.name}</span>
                    {cls.label && cls.label !== cls.name && (
                      <span className="text-xs text-slate-400">({cls.label})</span>
                    )}
                    {cls.parent && (
                      <span className="text-xs bg-violet-50 text-violet-600 px-2 py-0.5 rounded-full">extends {cls.parent}</span>
                    )}
                  </div>
                  {cls.description && <p className="text-xs text-slate-400 mt-1">{cls.description}</p>}
                  <div className="flex flex-wrap gap-1.5 mt-2.5">
                    {cls.properties.map((p, j) => (
                      <span key={j} className="text-xs bg-slate-50 border border-slate-100 px-2.5 py-1 rounded-lg">
                        <span className="text-slate-600">{p.name}</span>
                        <span className="text-slate-300 mx-1">:</span>
                        <span className="text-indigo-500 font-medium">{p.type}</span>
                        {p.confidence && (
                          <span className="text-slate-400 ml-1.5">({(p.confidence * 100).toFixed(0)}%)</span>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Relations */}
          {tab === 'relations' && (
            <div className="space-y-2">
              {ontology.relations.length === 0 && <p className="text-sm text-slate-400">{t('ontologyDetail.rels.empty')}</p>}
              {ontology.relations.map((r, i) => (
                <div key={i} className="border border-slate-100 rounded-xl p-3.5 flex items-center gap-3">
                  <span className="text-xs font-semibold bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-lg">{r.source_class}</span>
                  <div className="flex-1 text-center">
                    <p className="text-xs text-slate-600 font-medium">{r.relation_name}</p>
                    <p className="text-xs text-slate-300">{r.cardinality}</p>
                  </div>
                  <span className="text-xs font-semibold bg-violet-50 text-violet-700 px-2.5 py-1 rounded-lg">{r.target_class}</span>
                  <span className="text-xs text-slate-400 ml-auto">{(r.confidence * 100).toFixed(0)}%</span>
                </div>
              ))}
            </div>
          )}

          {/* APIs */}
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
