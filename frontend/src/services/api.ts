import axios from 'axios'
import type { DataSource, CreateDataSourcePayload, OrchestrationTask, Ontology, ChatMessage, GraphNode, GraphEdge, GeneratedAPI, AnalysisBatch, BatchInfo, QASession } from '@/types'

const BASE = '/api/v1'

const client = axios.create({ baseURL: BASE, timeout: 60_000 })

// ── 数据源 ─────────────────────────────────
export const dataSources = {
  create: (payload: CreateDataSourcePayload) => client.post<DataSource>('/data-sources/', payload).then(r => r.data),

  upload: (file: File, name?: string) => {
    const form = new FormData()
    form.append('file', file)
    if (name) form.append('name', name)
    return client.post<DataSource>('/data-sources/upload', form).then(r => r.data)
  },

  uploadBatch: (files: File[]) => {
    const form = new FormData()
    files.forEach(f => form.append('files', f))
    return client.post<DataSource[]>('/data-sources/upload/batch', form).then(r => r.data)
  },

  list: () => client.get<DataSource[]>('/data-sources/').then(r => r.data),
  get: (id: string) => client.get<DataSource>(`/data-sources/${id}`).then(r => r.data),

  testConnection: (id: string) => client.post<{ ok: boolean; error?: string }>(`/data-sources/${id}/test-connection`).then(r => r.data),
  analyze:        (id: string) => client.post<OrchestrationTask>(`/data-sources/${id}/analyze`).then(r => r.data),
  getTask:        (sourceId: string, taskId: string) => client.get<OrchestrationTask>(`/data-sources/${sourceId}/task/${taskId}`).then(r => r.data),

  // ── 批量分析 ──
  batchAnalyze: (sourceIds: string[]) =>
    client.post<{ batch_id: string; status: string; source_count: number }>('/data-sources/batch-analyze', { source_ids: sourceIds }).then(r => r.data),
  getBatch:     (batchId: string) => client.get<AnalysisBatch>(`/data-sources/batch/${batchId}`).then(r => r.data),
  listBatches:  () => client.get<BatchInfo[]>('/data-sources/batches').then(r => r.data),
}

// ── 本体 ────────────────────────────────────
export const ontologyApi = {
  list:    (batchId?: string) => client.get<Ontology[]>('/ontologies/', { params: batchId ? { batch_id: batchId } : {} }).then(r => r.data),
  get:     (id: string) => client.get<Ontology>(`/ontologies/${id}`).then(r => r.data),
  update:  (id: string, payload: Partial<Ontology>) => client.put<Ontology>(`/ontologies/${id}`, payload).then(r => r.data),
  publish: (id: string) => client.post<Ontology>(`/ontologies/${id}/publish`).then(r => r.data),
  getApis: (id: string) => client.get<GeneratedAPI[]>(`/ontologies/${id}/apis`).then(r => r.data),
  getGraph: (id: string) => client.get<{ nodes: GraphNode[]; edges: GraphEdge[] }>(`/ontologies/${id}/graph`).then(r => r.data),
  chat: (id: string, question: string, history: { role: string; content: string }[]) =>
    client.post<{ answer: string; sources: ChatMessage['sources']; cypher_query?: string | null }>(
      `/ontologies/${id}/chat`,
      { question, history }
    ).then(r => r.data),
  search: (id: string, query: string, topK = 5) =>
    client.post<{ results: unknown[] }>(`/ontologies/${id}/search`, { query, top_k: topK }).then(r => r.data),
  entities: (id: string, className?: string) =>
    client.get<{ entities: Record<string, unknown>[]; count: number }>(`/ontologies/${id}/entities`, { params: className ? { class_name: className } : {} }).then(r => r.data),

  // ── 重新分析 ──
  reanalyze: (id: string, description: string, className?: string) =>
    client.post<Ontology>(`/ontologies/${id}/reanalyze`, { description, class_name: className || null }).then(r => r.data),

  // ── 打包 ──
  getPackageSpec: (ontologyIds: string[]) =>
    client.post<{ spec: Record<string, unknown> }>('/ontologies/package/spec', { ontology_ids: ontologyIds }).then(r => r.data),
  downloadPackage: async (ontologyIds: string[]) => {
    const r = await client.post('/ontologies/package/download', { ontology_ids: ontologyIds }, { responseType: 'blob' })
    const url = URL.createObjectURL(r.data as Blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'ontology_package.zip'; a.click()
    URL.revokeObjectURL(url)
  },
}

// ── 智能问答应用 ────────────────────────────
export const qaApi = {
  createSession: (payload: { name: string; ontology_ids: string[] }) =>
    client.post<QASession>('/qa/sessions', payload).then(r => r.data),
  listSessions:  () => client.get<QASession[]>('/qa/sessions').then(r => r.data),
  getSession:    (id: string) => client.get<QASession>(`/qa/sessions/${id}`).then(r => r.data),
  updateSession: (id: string, payload: { name: string; ontology_ids: string[] }) =>
    client.put<QASession>(`/qa/sessions/${id}`, payload).then(r => r.data),
  deleteSession: (id: string) => client.delete(`/qa/sessions/${id}`).then(r => r.data),
  chat: (sessionId: string, question: string, history: { role: string; content: string }[]) =>
    client.post<{ answer: string; sources: { type: string; content: string }[]; ontology_id?: string }>(
      `/qa/sessions/${sessionId}/chat`,
      { question, history }
    ).then(r => r.data),
}

// ── 健康检查 ────────────────────────────────
export const health = () => axios.get('/health').then(r => r.data)
