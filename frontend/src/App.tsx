import { Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from '@/components/Layout/Layout'
import { Dashboard } from '@/pages/Dashboard'
import { DataIngestionPage } from '@/pages/DataIngestion'
import { AnalysisReviewPage } from '@/pages/AnalysisReview'
import { OntologyListPage } from '@/pages/OntologyList'
import { OntologyDetailPage } from '@/pages/OntologyDetail'
import { ChatPage } from '@/pages/Chat'
import { QAAppPage } from '@/pages/QAApp'

export function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/"                          element={<Dashboard />} />
        <Route path="/ingest"                    element={<DataIngestionPage />} />
        <Route path="/ingest/review/:batchId"    element={<AnalysisReviewPage />} />
        <Route path="/ontologies"                element={<OntologyListPage />} />
        <Route path="/ontologies/:id"            element={<OntologyDetailPage />} />
        <Route path="/ontologies/:id/chat"       element={<ChatPage />} />
        <Route path="/qa"                        element={<QAAppPage />} />
        <Route path="*"                          element={<Navigate to="/" />} />
      </Routes>
    </Layout>
  )
}
