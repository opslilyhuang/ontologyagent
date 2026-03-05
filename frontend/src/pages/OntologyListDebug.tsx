import { useEffect, useState } from 'react'

export function OntologyListDebug() {
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState<string>('')

  useEffect(() => {
    console.log('OntologyListDebug mounted')

    fetch('/api/v1/ontologies/')
      .then(res => {
        console.log('Response status:', res.status)
        return res.json()
      })
      .then(data => {
        console.log('Data loaded:', data)
        setData(data)
      })
      .catch(err => {
        console.error('Error:', err)
        setError(err.message)
      })
  }, [])

  return (
    <div style={{ padding: '20px' }}>
      <h1>本体列表调试页面</h1>
      {error && <div style={{ color: 'red' }}>错误: {error}</div>}
      {!data && !error && <div>加载中...</div>}
      {data && (
        <div>
          <p><strong>本体数量: {data.length}</strong></p>
          {data.map((ont: any, i: number) => (
            <div key={i} style={{ border: '1px solid #ccc', padding: '10px', margin: '10px 0' }}>
              <h3>{ont.name}</h3>
              <p>状态: {ont.status}</p>
              <p>类: {ont.classes?.length || 0} 个</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
