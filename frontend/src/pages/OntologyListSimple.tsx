import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Layers, MessageSquare } from 'lucide-react'
import { ontologyApi } from '@/services/api'
import type { Ontology } from '@/types'

export function OntologyListSimple() {
  const [ontologies, setOntologies] = useState<Ontology[]>([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    ontologyApi.list()
      .then(data => {
        setOntologies(data)
        setLoading(false)
      })
      .catch(err => {
        console.error('加载本体失败:', err)
        setLoading(false)
      })
  }, [])

  if (loading) {
    return (
      <div className="p-8">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-2xl font-bold text-slate-800 mb-6">本体管理</h1>
          <p className="text-slate-500">加载中...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8 fade-in">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-800">本体管理</h1>
          <p className="text-slate-400 text-sm mt-1">查看、筛选和管理已生成的知识本体</p>
        </div>

        {/* 本体列表 */}
        {ontologies.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-16 text-center">
            <div className="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Layers size={24} className="text-slate-300" />
            </div>
            <p className="text-sm font-medium text-slate-600">暂无本体</p>
            <p className="text-xs text-slate-400 mt-1">先在「数据接入」页上传数据并触发分析</p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-slate-500 mb-4">共 {ontologies.length} 个本体</p>

            {ontologies.map(o => (
              <div
                key={o.id}
                className="bg-white rounded-2xl border border-slate-100 hover:shadow-md shadow-sm transition-all p-5 flex items-start gap-4 cursor-pointer"
                onClick={() => navigate(`/ontologies/${o.id}`)}
              >
                {/* Icon */}
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: 'linear-gradient(135deg, #e0e7ff, #ede9fe)' }}
                >
                  <Layers size={18} className="text-indigo-500" />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800">{o.name}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{o.description || '无描述'}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-xs text-slate-400">{o.classes.length} 类</span>
                    <span className="text-slate-200">·</span>
                    <span className="text-xs text-slate-400">{o.relations.length} 关系</span>
                    <span className="text-slate-200">·</span>
                    <span className="text-xs text-slate-400">{o.instances_count} 实例</span>
                  </div>
                </div>

                {/* Status */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${
                    o.status === 'published' ? 'bg-emerald-50 text-emerald-600' :
                    o.status === 'pending'   ? 'bg-amber-50  text-amber-600'   :
                                               'bg-slate-100 text-slate-500'
                  }`}>
                    {o.status}
                  </span>

                  {o.status === 'published' && (
                    <button
                      onClick={e => {
                        e.stopPropagation()
                        navigate(`/ontologies/${o.id}/chat`)
                      }}
                      className="flex items-center gap-1 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1 rounded-lg transition"
                    >
                      <MessageSquare size={11} /> 问答
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
