/**
 * D3 力布局图编辑器
 * 展示 Neo4j 实例图（nodes + edges）
 * 支持拖拽、缩放；低饱和度柔和色板
 */
import { useEffect, useRef } from 'react'
import * as d3 from 'd3'
import type { GraphNode, GraphEdge } from '@/types'

interface SimNode extends d3.SimulationNodeDatum, GraphNode {}
interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  label: string
  source: SimNode
  target: SimNode
}

const PASTELS = [
  '#818cf8', // indigo-400
  '#a78bfa', // violet-400
  '#67e8f9', // cyan-300
  '#86efac', // green-300
  '#fcd34d', // yellow-300
  '#fca5a5', // red-300
  '#c4b5fd', // violet-300
  '#6ee7b7', // emerald-300
  '#93c5fd', // blue-300
  '#fdba74', // orange-300
]
const COLOR_SCALE = d3.scaleOrdinal(PASTELS)

export function GraphEditor({ nodes, edges }: { nodes: GraphNode[]; edges: GraphEdge[] }) {
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (!svgRef.current) return
    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    const width  = svgRef.current.clientWidth  || 800
    const height = svgRef.current.clientHeight || 480

    // ── Empty state ──
    if (nodes.length === 0) {
      svg.append('text')
        .attr('x', width / 2).attr('y', height / 2 - 12)
        .attr('text-anchor', 'middle')
        .attr('fill', '#cbd5e1').attr('font-size', '13px').attr('font-weight', '500')
        .text('暂无图数据')
      svg.append('text')
        .attr('x', width / 2).attr('y', height / 2 + 10)
        .attr('text-anchor', 'middle')
        .attr('fill', '#e2e8f0').attr('font-size', '11px')
        .text('上传数据并完成分析后将自动生成')
      return
    }

    // ── Zoom group ──
    const g = svg.append('g')
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 10])
      .on('zoom', (event) => { g.attr('transform', event.transform) })
    svg.call(zoom)
    svg.call(zoom.transform, d3.zoomIdentity.translate(width / 2, height / 2).scale(0.8))

    // ── Data prep ──
    const simNodes: SimNode[] = nodes.map(n => ({ ...n }))
    const nodeMap = new Map(simNodes.map(n => [n.id, n]))
    const simLinks: SimLink[] = edges
      .filter(e => nodeMap.has(e.source) && nodeMap.has(e.target))
      .map(e => ({ source: nodeMap.get(e.source)!, target: nodeMap.get(e.target)!, label: e.label }))

    // ── Simulation ──
    const sim = d3.forceSimulation(simNodes)
      .force('link',      d3.forceLink(simLinks).id((d: SimNode) => d.id).distance(130))
      .force('charge',    d3.forceManyBody().strength(-220))
      .force('center',    d3.forceCenter(0, 0))
      .force('collision', d3.forceCollide(44))

    // ── Defs: arrow marker + drop-shadow filter ──
    const defs = svg.append('defs')

    defs.append('marker')
      .attr('id', 'arrow')
      .attr('viewBox', '0 0 10 10')
      .attr('refX', 22).attr('refY', 5)
      .attr('markerWidth', 6).attr('markerHeight', 6)
      .attr('orient', 'auto-start-reverse')
      .append('path').attr('d', 'M 0 0 L 10 5 L 0 10 z').attr('fill', '#cbd5e1')

    const filter = defs.append('filter').attr('id', 'shadow')
      .attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%')
    filter.append('feDropShadow')
      .attr('dx', 0).attr('dy', 2).attr('stdDeviation', 3)
      .attr('flood-color', '#94a3b8').attr('flood-opacity', 0.2)

    // ── Links ──
    const link = g.append('g').selectAll<SVGLineElement, SimLink>('line')
      .data(simLinks).enter().append('line')
      .attr('stroke', '#e2e8f0').attr('stroke-width', 1.5)
      .attr('marker-end', 'url(#arrow)')

    // ── Link labels ──
    const linkLabel = g.append('g').selectAll<SVGTextElement, SimLink>('text')
      .data(simLinks).enter().append('text')
      .attr('fill', '#94a3b8').attr('font-size', '9px')
      .attr('text-anchor', 'middle')
      .text(d => d.label)

    // ── Nodes ──
    const node = g.append('g').selectAll<SVGCircleElement, SimNode>('circle')
      .data(simNodes).enter().append('circle')
      .attr('r', 20)
      .attr('fill', d => COLOR_SCALE(d.label))
      .attr('stroke', '#fff').attr('stroke-width', 2.5)
      .attr('filter', 'url(#shadow)')
      .call(d3.drag<SVGCircleElement, SimNode>()
        .on('start', (_event, d) => { if (!_event.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y })
        .on('drag',  (_event, d) => { d.fx = _event.x; d.fy = _event.y })
        .on('end',   (_event, d) => { if (!_event.active) sim.alphaTarget(0); d.fx = null; d.fy = null })
      )

    // ── Node labels ──
    const nodeLabel = g.append('g').selectAll<SVGTextElement, SimNode>('text')
      .data(simNodes).enter().append('text')
      .attr('text-anchor', 'middle').attr('dy', 38)
      .attr('font-size', '10px').attr('fill', '#64748b').attr('font-weight', '500')
      .text(d => d.label.length > 12 ? d.label.slice(0, 10) + '…' : d.label)

    // ── Tick ──
    sim.on('tick', () => {
      link
        .attr('x1', d => d.source.x!).attr('y1', d => d.source.y!)
        .attr('x2', d => d.target.x!).attr('y2', d => d.target.y!)
      linkLabel
        .attr('x', d => (d.source.x! + d.target.x!) / 2)
        .attr('y', d => (d.source.y! + d.target.y!) / 2)
      node
        .attr('cx', d => d.x!).attr('cy', d => d.y!)
      nodeLabel
        .attr('x', d => d.x!).attr('y', d => d.y!)
    })

    return () => sim.stop()
  }, [nodes, edges])

  return (
    <svg ref={svgRef} className="w-full rounded-xl bg-slate-50 border border-slate-100" style={{ height: '480px' }} />
  )
}
