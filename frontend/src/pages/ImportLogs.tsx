import { useState, useEffect } from 'react'
import { CheckCircle2, XCircle, Loader2, Clock, AlertTriangle, Trash2, ChevronRight, Check, Edit2 } from 'lucide-react'
import { importLogApi } from '@/services/api'
import type { ImportLog, FailedRecord } from '@/types'

const STATUS_CONFIG = {
  running: { icon: Loader2, color: 'text-blue-600', bg: 'bg-blue-50', label: '进行中' },
  completed: { icon: CheckCircle2, color: 'text-green-600', bg: 'bg-green-50', label: '成功' },
  failed: { icon: XCircle, color: 'text-red-600', bg: 'bg-red-50', label: '失败' },
  partial: { icon: AlertTriangle, color: 'text-amber-600', bg: 'bg-amber-50', label: '部分失败' },
}

export function ImportLogsPage() {
  const [logs, setLogs] = useState<ImportLog[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedLog, setSelectedLog] = useState<ImportLog | null>(null)
  const [failedRecords, setFailedRecords] = useState<FailedRecord[]>([])
  const [failedPage, setFailedPage] = useState(1)
  const [failedTotal, setFailedTotal] = useState(0)
  const [editingRecord, setEditingRecord] = useState<number | null>(null)
  const [editedData, setEditedData] = useState<string>('')
  const [selectedRecords, setSelectedRecords] = useState<Set<number>>(new Set())
  const [retrying, setRetrying] = useState(false)

  useEffect(() => {
    loadLogs()
  }, [])

  const loadLogs = async () => {
    setLoading(true)
    try {
      const data = await importLogApi.list()
      setLogs(data)
    } catch (err) {
      console.error('Failed to load logs:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleViewDetails = async (log: ImportLog) => {
    setSelectedLog(log)
    if (log.failure_count > 0) {
      await loadFailedRecords(log.id, 1)
    }
  }

  const loadFailedRecords = async (logId: string, page: number) => {
    try {
      const data = await importLogApi.getFailedRecords(logId, page, 20)
      setFailedRecords(data.records)
      setFailedTotal(data.total)
      setFailedPage(page)
    } catch (err) {
      console.error('Failed to load failed records:', err)
    }
  }

  const handleDeleteLog = async (logId: string) => {
    if (!confirm('确定要删除此导入日志吗？')) return

    try {
      await importLogApi.delete(logId)
      setLogs((prev) => prev.filter((l) => l.id !== logId))
      if (selectedLog?.id === logId) {
        setSelectedLog(null)
      }
    } catch (err) {
      alert('删除失败: ' + (err as Error).message)
    }
  }

  const handleEditRecord = (index: number) => {
    const record = failedRecords[index]
    setEditingRecord(index)
    setEditedData(JSON.stringify(record.data, null, 2))
  }

  const handleSaveEdit = (index: number) => {
    try {
      const parsed = JSON.parse(editedData)
      setFailedRecords((prev) =>
        prev.map((r, i) => (i === index ? { ...r, data: parsed } : r))
      )
      setEditingRecord(null)
      setEditedData('')
    } catch (err) {
      alert('JSON 格式错误: ' + (err as Error).message)
    }
  }

  const handleCancelEdit = () => {
    setEditingRecord(null)
    setEditedData('')
  }

  const toggleRecordSelection = (index: number) => {
    setSelectedRecords((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(index)) {
        newSet.delete(index)
      } else {
        newSet.add(index)
      }
      return newSet
    })
  }

  const toggleSelectAll = () => {
    if (selectedRecords.size === failedRecords.length) {
      setSelectedRecords(new Set())
    } else {
      setSelectedRecords(new Set(failedRecords.map((_, i) => i)))
    }
  }

  const handleRetrySelected = async () => {
    if (!selectedLog || selectedRecords.size === 0) return

    if (!confirm(`确定要重新导入选中的 ${selectedRecords.size} 条记录吗？`)) return

    setRetrying(true)
    try {
      const recordsToRetry = failedRecords
        .filter((_, i) => selectedRecords.has(i))
        .map((r) => r.data)

      await importLogApi.retry(selectedLog.id, recordsToRetry, selectedLog.cleaning_config || { operators: [] })

      alert('重新导入成功！')
      // 重新加载日志
      await loadLogs()
      await loadFailedRecords(selectedLog.id, failedPage)
      setSelectedRecords(new Set())
    } catch (err) {
      alert('重新导入失败: ' + (err as Error).message)
    } finally {
      setRetrying(false)
    }
  }

  // 统计
  const stats = {
    total: logs.length,
    success: logs.filter((l) => l.status === 'completed').length,
    failed: logs.filter((l) => l.status === 'failed').length,
    running: logs.filter((l) => l.status === 'running').length,
  }

  return (
    <div className="p-8 fade-in">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-800">导入日志</h1>
          <p className="text-slate-400 text-sm mt-1">查看本体数据导入记录和统计信息</p>
        </div>

        {/* Statistics Cards */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center">
                <Clock size={20} className="text-slate-600" />
              </div>
              <div>
                <p className="text-xs text-slate-500 font-medium">总次数</p>
                <p className="text-2xl font-bold text-slate-800 mt-0.5">{stats.total}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                <CheckCircle2 size={20} className="text-green-600" />
              </div>
              <div>
                <p className="text-xs text-slate-500 font-medium">成功</p>
                <p className="text-2xl font-bold text-green-600 mt-0.5">{stats.success}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center">
                <XCircle size={20} className="text-red-600" />
              </div>
              <div>
                <p className="text-xs text-slate-500 font-medium">失败</p>
                <p className="text-2xl font-bold text-red-600 mt-0.5">{stats.failed}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                <Loader2 size={20} className="text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-slate-500 font-medium">进行中</p>
                <p className="text-2xl font-bold text-blue-600 mt-0.5">{stats.running}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Logs Table */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-700">导入记录</h2>
          </div>

          {loading ? (
            <div className="p-12 text-center">
              <Loader2 size={32} className="animate-spin text-slate-400 mx-auto" />
              <p className="text-sm text-slate-500 mt-3">加载中...</p>
            </div>
          ) : logs.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-sm text-slate-400">暂无导入记录</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {logs.map((log) => {
                const statusCfg = STATUS_CONFIG[log.status]
                const Icon = statusCfg.icon
                const isRunning = log.status === 'running'

                return (
                  <div
                    key={log.id}
                    className="px-6 py-4 hover:bg-slate-50 transition cursor-pointer"
                    onClick={() => handleViewDetails(log)}
                  >
                    <div className="flex items-center gap-4">
                      {/* Status Icon */}
                      <div className={`w-10 h-10 ${statusCfg.bg} rounded-lg flex items-center justify-center flex-shrink-0`}>
                        <Icon size={20} className={`${statusCfg.color} ${isRunning ? 'animate-spin' : ''}`} />
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusCfg.bg} ${statusCfg.color}`}>
                            {statusCfg.label}
                          </span>
                          <span className="text-xs text-slate-400">
                            {new Date(log.created_at).toLocaleString()}
                          </span>
                        </div>
                        <div className="flex items-center gap-4 mt-2">
                          <span className="text-sm text-slate-600">
                            总数: <span className="font-semibold text-slate-800">{log.total_records}</span>
                          </span>
                          <span className="text-sm text-green-600">
                            成功: <span className="font-semibold">{log.success_count}</span>
                          </span>
                          {log.failure_count > 0 && (
                            <span className="text-sm text-red-600">
                              失败: <span className="font-semibold">{log.failure_count}</span>
                            </span>
                          )}
                        </div>
                        {log.error_summary && (
                          <p className="text-xs text-red-500 mt-1 truncate">{log.error_summary}</p>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDeleteLog(log.id)
                          }}
                          className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition"
                        >
                          <Trash2 size={16} />
                        </button>
                        <ChevronRight size={20} className="text-slate-300" />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Details Modal */}
        {selectedLog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
                <div>
                  <h2 className="text-lg font-bold text-slate-800">导入日志详情</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {new Date(selectedLog.created_at).toLocaleString()}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedLog(null)}
                  className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition"
                >
                  <XCircle size={20} />
                </button>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
                {/* Statistics */}
                <div>
                  <h3 className="text-sm font-semibold text-slate-700 mb-3">导入统计</h3>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="bg-slate-50 rounded-lg px-4 py-3">
                      <p className="text-xs text-slate-500">总记录数</p>
                      <p className="text-xl font-bold text-slate-800 mt-1">{selectedLog.total_records}</p>
                    </div>
                    <div className="bg-green-50 rounded-lg px-4 py-3">
                      <p className="text-xs text-green-600">成功导入</p>
                      <p className="text-xl font-bold text-green-700 mt-1">{selectedLog.success_count}</p>
                    </div>
                    <div className="bg-red-50 rounded-lg px-4 py-3">
                      <p className="text-xs text-red-600">失败记录</p>
                      <p className="text-xl font-bold text-red-700 mt-1">{selectedLog.failure_count}</p>
                    </div>
                  </div>
                </div>

                {/* Cleaning Config */}
                <div>
                  <h3 className="text-sm font-semibold text-slate-700 mb-3">数据清洗配置</h3>
                  <div className="bg-slate-50 rounded-lg px-4 py-3">
                    {selectedLog.cleaning_config?.operators?.length > 0 ? (
                      <ul className="space-y-1">
                        {selectedLog.cleaning_config.operators.map((op, i) => (
                          <li key={i} className="text-sm text-slate-700">
                            • {op.name}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-slate-400">未配置清洗规则</p>
                    )}
                  </div>
                </div>

                {/* Failed Records */}
                {selectedLog.failure_count > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-semibold text-slate-700">
                        失败记录 ({failedTotal} 条)
                      </h3>
                      {selectedRecords.size > 0 && (
                        <button
                          onClick={handleRetrySelected}
                          disabled={retrying}
                          className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center gap-2"
                        >
                          {retrying ? (
                            <>
                              <Loader2 size={16} className="animate-spin" />
                              重新导入中...
                            </>
                          ) : (
                            <>重新导入选中 ({selectedRecords.size})</>
                          )}
                        </button>
                      )}
                    </div>
                    <div className="border border-slate-200 rounded-lg overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50">
                          <tr>
                            <th className="px-4 py-2 text-center w-12">
                              <input
                                type="checkbox"
                                checked={selectedRecords.size === failedRecords.length && failedRecords.length > 0}
                                onChange={toggleSelectAll}
                                className="w-4 h-4 text-indigo-600 bg-gray-100 border-gray-300 rounded focus:ring-indigo-500 focus:ring-2 cursor-pointer"
                              />
                            </th>
                            <th className="px-4 py-2 text-left text-xs font-semibold text-slate-600 w-20">#</th>
                            <th className="px-4 py-2 text-left text-xs font-semibold text-slate-600">原始数据</th>
                            <th className="px-4 py-2 text-left text-xs font-semibold text-slate-600">失败原因</th>
                            <th className="px-4 py-2 text-center text-xs font-semibold text-slate-600 w-24">操作</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {failedRecords.map((record, i) => (
                            <tr key={i} className="hover:bg-slate-50">
                              <td className="px-4 py-3 text-center">
                                <input
                                  type="checkbox"
                                  checked={selectedRecords.has(i)}
                                  onChange={() => toggleRecordSelection(i)}
                                  className="w-4 h-4 text-indigo-600 bg-gray-100 border-gray-300 rounded focus:ring-indigo-500 focus:ring-2 cursor-pointer"
                                />
                              </td>
                              <td className="px-4 py-3 text-slate-500">{record.row_index}</td>
                              <td className="px-4 py-3">
                                {editingRecord === i ? (
                                  <textarea
                                    value={editedData}
                                    onChange={(e) => setEditedData(e.target.value)}
                                    className="w-full min-h-[120px] border border-indigo-300 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-200"
                                  />
                                ) : (
                                  <div className="max-w-2xl overflow-x-auto">
                                    <table className="text-xs border-collapse">
                                      <tbody>
                                        {Object.entries(record.data).map(([key, value]) => (
                                          <tr key={key} className="border-b border-slate-100 last:border-0">
                                            <td className="py-1 pr-3 text-slate-500 font-semibold align-top">{key}:</td>
                                            <td className="py-1 text-slate-700">{String(value)}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-3 text-red-600 text-xs">{record.error}</td>
                              <td className="px-4 py-3 text-center">
                                {editingRecord === i ? (
                                  <div className="flex gap-1 justify-center">
                                    <button
                                      onClick={() => handleSaveEdit(i)}
                                      className="p-1 text-green-600 hover:bg-green-50 rounded transition"
                                      title="保存"
                                    >
                                      <Check size={16} />
                                    </button>
                                    <button
                                      onClick={handleCancelEdit}
                                      className="p-1 text-slate-400 hover:bg-slate-100 rounded transition"
                                      title="取消"
                                    >
                                      <XCircle size={16} />
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => handleEditRecord(i)}
                                    className="p-1 text-indigo-600 hover:bg-indigo-50 rounded transition"
                                    title="编辑"
                                  >
                                    <Edit2 size={16} />
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Pagination */}
                    {failedTotal > 20 && (
                      <div className="flex items-center justify-center gap-2 mt-4">
                        <button
                          onClick={() => loadFailedRecords(selectedLog.id, failedPage - 1)}
                          disabled={failedPage === 1}
                          className="px-3 py-1 text-sm text-slate-600 bg-slate-100 rounded hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition"
                        >
                          上一页
                        </button>
                        <span className="text-sm text-slate-600">
                          {failedPage} / {Math.ceil(failedTotal / 20)}
                        </span>
                        <button
                          onClick={() => loadFailedRecords(selectedLog.id, failedPage + 1)}
                          disabled={failedPage >= Math.ceil(failedTotal / 20)}
                          className="px-3 py-1 text-sm text-slate-600 bg-slate-100 rounded hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition"
                        >
                          下一页
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
