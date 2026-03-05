import { useState } from 'react'
import { X, Settings } from 'lucide-react'
import type { DataCleaningConfig } from '@/types'

interface DataCleaningDialogProps {
  visible: boolean
  onClose: () => void
  onConfirm: (config: DataCleaningConfig) => void
}

interface OperatorOption {
  value: string
  label: string
  description: string
  hasParams?: boolean
}

const OPERATOR_GROUPS: Record<string, OperatorOption[]> = {
  '基础清洗': [
    { value: 'remove_nulls', label: '去除空值行', description: '删除包含空值的数据行' },
    { value: 'remove_duplicates', label: '去除重复数据', description: '删除重复的记录' },
    { value: 'fill_missing', label: '填充缺失值', description: '使用指定策略填充缺失值', hasParams: true },
  ],
  '数据规范化': [
    { value: 'trim_whitespace', label: 'Trim 前后空格', description: '去除文本字段前后的空格' },
    { value: 'normalize_case', label: '统一大小写', description: '将文本统一转换为大写/小写', hasParams: true },
    { value: 'standardize_date', label: '日期格式标准化', description: '统一日期格式', hasParams: true },
  ],
  '数据验证': [
    { value: 'validate_email', label: '邮箱格式校验', description: '验证邮箱地址格式是否正确' },
    { value: 'validate_phone', label: '电话号码格式校验', description: '验证手机号码格式（中国）' },
  ],
  '高级处理': [
    { value: 'detect_outliers', label: '异常值检测', description: '检测并标记数值异常值', hasParams: true },
    { value: 'mask_sensitive', label: '数据脱敏', description: '对敏感数据进行脱敏处理', hasParams: true },
  ],
}

export function DataCleaningDialog({ visible, onClose, onConfirm }: DataCleaningDialogProps) {
  const [selectedOperators, setSelectedOperators] = useState<string[]>([
    'remove_nulls',
    'remove_duplicates',
    'trim_whitespace',
    'validate_email',
  ])

  if (!visible) return null

  const handleToggle = (value: string) => {
    setSelectedOperators((prev) =>
      prev.includes(value)
        ? prev.filter((v) => v !== value)
        : [...prev, value]
    )
  }

  const handleConfirm = () => {
    const config: DataCleaningConfig = {
      operators: selectedOperators.map((name) => ({ name })),
    }
    onConfirm(config)
  }

  const handleClear = () => {
    setSelectedOperators([])
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center">
              <Settings size={20} className="text-indigo-600" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">数据清洗设置</h2>
              <p className="text-xs text-slate-500 mt-0.5">选择需要应用的数据处理算子</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body - Scrollable */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {Object.entries(OPERATOR_GROUPS).map(([group, operators]) => (
            <div key={group} className="mb-6 last:mb-0">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">{group}</h3>
              <div className="space-y-2">
                {operators.map((op) => (
                  <label
                    key={op.value}
                    className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition ${
                      selectedOperators.includes(op.value)
                        ? 'border-indigo-300 bg-indigo-50'
                        : 'border-slate-100 hover:border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedOperators.includes(op.value)}
                      onChange={() => handleToggle(op.value)}
                      className="mt-0.5 w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-200 cursor-pointer accent-indigo-600"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-700">{op.label}</span>
                        {op.hasParams && (
                          <span className="text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
                            需配置
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 mt-1">{op.description}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={handleClear}
              className="text-sm text-slate-500 hover:text-slate-700 font-medium transition"
            >
              清空选择
            </button>
            <span className="text-sm text-slate-400">
              已选择 {selectedOperators.length} 个算子
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition"
            >
              取消
            </button>
            <button
              onClick={handleConfirm}
              className="px-5 py-2 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 transition"
            >
              确认并导入
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
