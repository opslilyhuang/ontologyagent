import { Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from '@/components/Layout/Layout'
import { Dashboard } from '@/pages/Dashboard'
import { DataIngestionPage } from '@/pages/DataIngestion'
import { AnalysisReviewPage } from '@/pages/AnalysisReview'
import { OntologyListSimple } from '@/pages/OntologyListSimple'
import { OntologyDetailPage } from '@/pages/OntologyDetail'
import { ChatPage } from '@/pages/Chat'
import { QAAppPage } from '@/pages/QAApp'
import { ImportLogsPage } from '@/pages/ImportLogs'

export function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/"                          element={<Dashboard />} />
        <Route path="/ingest"                    element={<DataIngestionPage />} />
        <Route path="/ingest/review/:batchId"    element={<AnalysisReviewPage />} />
        <Route path="/ontologies"                element={<OntologyListSimple />} />
        <Route path="/ontologies/:id"            element={<OntologyDetailPage />} />
        <Route path="/ontologies/:id/chat"       element={<ChatPage />} />
        <Route path="/qa"                        element={<QAAppPage />} />
        <Route path="/import-logs"               element={<ImportLogsPage />} />
        <Route path="*"                          element={<Navigate to="/" />} />
      </Routes>
    </Layout>
  )
}
