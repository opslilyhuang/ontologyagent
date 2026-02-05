import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Database, Upload, Layers, MessageSquare, ArrowRight, CheckCircle2 } from 'lucide-react'
import { dataSources, ontologyApi } from '@/services/api'
import type { DataSource, Ontology } from '@/types'
import { useT } from '@/i18n'

const FLOW_KEYS = [
  { key: 'dashboard.flow.ingest',     bg: 'bg-slate-500' },
  { key: 'dashboard.flow.understand', bg: 'bg-indigo-400' },
  { key: 'dashboard.flow.entity',     bg: 'bg-violet-400' },
  { key: 'dashboard.flow.relation',   bg: 'bg-purple-400' },
  { key: 'dashboard.flow.generate',   bg: 'bg-fuchsia-400' },
  { key: 'dashboard.flow.instance',   bg: 'bg-emerald-400' },
  { key: 'dashboard.flow.qa',         bg: 'bg-teal-400' },
]

export function Dashboard() {
  const { t } = useT()
  const [sources, setSources]       = useState<DataSource[]>([])
  const [ontologies, setOntologies] = useState<Ontology[]>([])
  const navigate = useNavigate()

  useEffect(() => {
    dataSources.list().then(setSources).catch(() => {})
    ontologyApi.list().then(setOntologies).catch(() => {})
  }, [])

  const stats = [
    { key: 'dashboard.stats.sources',    value: sources.length,                                                          Icon: Database,      bg: 'bg-indigo-50',  color: 'text-indigo-500' },
    { key: 'dashboard.stats.ontologies', value: ontologies.length,                                                      Icon: Layers,        bg: 'bg-violet-50',  color: 'text-violet-500' },
    { key: 'dashboard.stats.published',  value: ontologies.filter(o => o.status === 'published').length,               Icon: CheckCircle2,  bg: 'bg-emerald-50', color: 'text-emerald-500' },
    { key: 'dashboard.stats.entities',   value: ontologies.reduce((s, o) => s + (o.instances_count || 0), 0),         Icon: MessageSquare, bg: 'bg-amber-50',   color: 'text-amber-500' },
  ]

  return (
    <div className="p-8 fade-in">
      <div className="max-w-5xl mx-auto">

        {/* Greeting */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-800">{t('dashboard.greeting')}</h1>
          <p className="text-slate-400 text-sm mt-1">{t('dashboard.greeting.sub')}</p>
        </div>

        {/* ── Stats ── */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          {stats.map(({ key, value, Icon, bg, color }) => (
            <div key={key} className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm hover:shadow-md transition-shadow">
              <div className={`w-10 h-10 ${bg} rounded-xl flex items-center justify-center mb-3`}>
                <Icon size={20} className={color} />
              </div>
              <p className="text-2xl font-bold text-slate-800">{value}</p>
              <p className="text-xs text-slate-400 mt-0.5 font-medium">{t(key)}</p>
            </div>
          ))}
        </div>

        {/* ── Quick actions + Recent ── */}
        <div className="grid grid-cols-5 gap-4 mb-6">

          {/* Quick actions */}
          <div className="col-span-2 bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-700 mb-4">{t('dashboard.quick')}</h2>
            <div className="space-y-2">
              {/* 上传文件 */}
              <button onClick={() => navigate('/ingest')}
                className="group w-full flex items-center gap-3 p-3 rounded-xl border border-slate-100 hover:border-indigo-200 hover:bg-indigo-50 transition-all">
                <div className="w-9 h-9 bg-indigo-50 group-hover:bg-indigo-100 rounded-lg flex items-center justify-center transition">
                  <Upload size={17} className="text-indigo-500" />
                </div>
                <div className="text-left">
                  <p className="text-sm font-medium text-slate-700">{t('dashboard.upload')}</p>
                  <p className="text-xs text-slate-400">{t('dashboard.upload.sub')}</p>
                </div>
                <ArrowRight size={15} className="ml-auto text-slate-300 group-hover:text-indigo-400 transition" />
              </button>

              {/* 连接数据库 */}
              <button onClick={() => navigate('/ingest')}
                className="group w-full flex items-center gap-3 p-3 rounded-xl border border-slate-100 hover:border-violet-200 hover:bg-violet-50 transition-all">
                <div className="w-9 h-9 bg-violet-50 group-hover:bg-violet-100 rounded-lg flex items-center justify-center transition">
                  <Database size={17} className="text-violet-500" />
                </div>
                <div className="text-left">
                  <p className="text-sm font-medium text-slate-700">{t('dashboard.connectdb')}</p>
                  <p className="text-xs text-slate-400">{t('dashboard.connectdb.sub')}</p>
                </div>
                <ArrowRight size={15} className="ml-auto text-slate-300 group-hover:text-violet-400 transition" />
              </button>
            </div>
          </div>

          {/* Recent ontologies */}
          <div className="col-span-3 bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-slate-700">{t('dashboard.recent')}</h2>
              <button onClick={() => navigate('/ontologies')} className="text-xs text-indigo-500 hover:text-indigo-600 font-medium">{t('dashboard.recent.viewall')}</button>
            </div>
            {ontologies.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8">
                <Layers size={28} className="text-slate-200 mb-2" />
                <p className="text-slate-400 text-sm">{t('dashboard.recent.empty')}</p>
              </div>
            ) : (
              <div className="space-y-1">
                {ontologies.slice(0, 4).map(o => (
                  <div key={o.id} onClick={() => navigate(`/ontologies/${o.id}`)}
                    className="group flex items-center gap-3 p-2.5 rounded-xl hover:bg-slate-50 cursor-pointer transition">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#e0e7ff,#ede9fe)' }}>
                      <Layers size={15} className="text-indigo-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-700 truncate group-hover:text-indigo-600 transition">{o.name}</p>
                      <p className="text-xs text-slate-400">{t('dashboard.recent.classes', { n: o.classes.length })} · {t('dashboard.recent.rels', { n: o.relations.length })}</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${o.status === 'published' ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>{o.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Pipeline Flow ── */}
        <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-700 mb-5">{t('dashboard.flow.title')}</h2>
          <div className="flex items-start justify-center">
            {FLOW_KEYS.map((step, i) => (
              <div key={step.key} className="flex items-start">
                <div className="flex flex-col items-center" style={{ width: '68px' }}>
                  <div className={`w-9 h-9 ${step.bg} rounded-full flex items-center justify-center shadow-sm`}>
                    <span className="text-white text-xs font-bold">{i + 1}</span>
                  </div>
                  <span className="text-xs text-slate-500 font-medium text-center mt-2 leading-tight">{t(step.key)}</span>
                </div>
                {i < FLOW_KEYS.length - 1 && (
                  <div className="flex items-center mt-4">
                    <div className="w-3 h-px bg-slate-200"></div>
                    <ArrowRight size={10} className="text-slate-300" />
                    <div className="w-3 h-px bg-slate-200"></div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
