// ── 数据源 ─────────────────────────────
export interface DataSource {
  id: string
  name: string
  type: 'database' | 'file' | 'api'
  status: 'created' | 'analyzing' | 'analyzed' | 'error'
  schema_info?: Record<string, unknown> | null
  error_message?: string | null
  created_at: string
  updated_at: string
}

export interface CreateDataSourcePayload {
  name: string
  type: string
  config: Record<string, unknown>
}

// ── 编排任务 ──────────────────────────
export interface OrchestrationTask {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  current_stage: string
  progress: number
  error?: string | null
  created_at: string
  updated_at: string
}

// ── 本体 ──────────────────────────────
export interface OntologyProperty {
  name: string
  label?: string
  type: string
  description?: string
  confidence?: number
  storage_type?: string
  is_primary_key?: boolean
  source?: string
}

export interface OntologyClass {
  name: string
  label: string
  description: string
  properties: OntologyProperty[]
  parent?: string | null
}

export interface OntologyRelation {
  source_class: string
  target_class: string
  relation_name: string
  relation_type: 'one_to_one' | 'one_to_many' | 'many_to_one' | 'many_to_many'
  confidence: number
  cardinality: string
  source_field?: string
  target_field?: string
  metadata?: Record<string, unknown>
}

export interface Ontology {
  id: string
  name: string
  description: string
  status: 'draft' | 'pending' | 'published' | 'archived'
  data_source_id: string
  batch_id?: string | null
  classes: OntologyClass[]
  relations: OntologyRelation[]
  instances_count: number
  created_at: string
  updated_at: string
}

// ── 图可视化 ──────────────────────────
export interface GraphNode {
  id: string
  label: string
  data?: Record<string, unknown>
}

export interface GraphEdge {
  source: string
  target: string
  label: string
}

// ── 问答 ──────────────────────────────
export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  sources?: Array<{ type: string; content: string; entity_type?: string }>
  cypher_query?: string | null
}

// ── 生成 API ──────────────────────────
export interface GeneratedAPI {
  id: string
  path: string
  method: string
  description: string
}

// ── 分析批次 ──────────────────────
export interface AnalysisBatch {
  batch_id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  progress: number
  current_stage: string
  source_ids: string[]
  ontology_ids: string[]
  error?: string | null
}

export interface BatchInfo {
  batch_id: string
  status: string
  source_count: number
  created_at: string
}

// ── 数据源字段 ────────────────────
export interface SourceField {
  name: string
  table: string
  source: string
  sample_values?: unknown[]
}

// ── Q&A 会话 ─────────────────────
export interface QASession {
  id: string
  name: string
  ontology_ids: string[]
  api_key: string
  embed_url: string
  status: string
  created_at: string
}
