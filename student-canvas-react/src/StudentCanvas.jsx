/**
 * StudentCanvas — multi-page answer sheet manager.
 *
 * Renders an array of CanvasPage components inside a scrollable area,
 * providing Add Page (with blank-page guard), pen/eraser tool toggle,
 * per-page clear, and Submit (bundles all pages' stroke data).
 */

import { useRef, useState, useCallback, useEffect } from 'react'
import CanvasPage from './CanvasPage'

const API_BASE = 'https://localhost:50949'

// ─── Helper: map signature_pad PointGroup[] → backend format ──────────────────
function toBackendStrokes(pointGroups) {
  return pointGroups.map(group =>
    group.points.map(p => ({
      canvasX:   parseFloat(p.x.toFixed(2)),
      canvasY:   parseFloat(p.y.toFixed(2)),
      pressure:  parseFloat(((p.pressure ?? 0) > 0 ? p.pressure : 0.5).toFixed(4)),
      timestamp: p.time ?? Date.now(),
    }))
  )
}

export default function StudentCanvas() {
  // ── Page state ─────────────────────────────────────────────────────────────
  const [pages,         setPages]         = useState([{ id: 1 }])
  const [activePage,    setActivePage]    = useState(0)   // 0-indexed
  const [lastPageEmpty, setLastPageEmpty] = useState(true) // guards Add Page
  const pageRefs = useRef([])                              // ref per page

  // ── Tool + UI state ────────────────────────────────────────────────────────
  const [tool,       setTool]       = useState('pen')      // 'pen' | 'eraser'
  const [toast,      setToast]      = useState(null)
  const [preview,    setPreview]    = useState('// Start writing to capture strokes…')
  const [submitting, setSubmitting] = useState(false)
  const [totalStrokes, setTotalStrokes] = useState(0)
  const [totalPoints,  setTotalPoints]  = useState(0)

  const previewTimer   = useRef(null)
  const pagesEndRef    = useRef(null)  // scroll anchor

  // ── Toast ──────────────────────────────────────────────────────────────────
  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }, [])

  // ── Telemetry preview (throttled 300 ms) ───────────────────────────────────
  const schedulePreview = useCallback(() => {
    if (previewTimer.current) return
    previewTimer.current = setTimeout(() => {
      previewTimer.current = null
      let strokes = 0, points = 0
      const allPages = pageRefs.current.map((pr, i) => {
        const groups = pr?.getStrokes() ?? []
        strokes += groups.length
        points  += groups.reduce((s, g) => s + g.points.length, 0)
        return { page: i + 1, strokes: toBackendStrokes(groups) }
      })
      setTotalStrokes(strokes)
      setTotalPoints(points)

      const filled = allPages.filter(p => p.strokes.length > 0)
      if (filled.length > 0) {
        const last = filled.slice(-2)
        setPreview(
          `// Pages with content: ${filled.length} / ${pages.length}\n` +
          JSON.stringify(last, null, 2)
        )
      }
    }, 300)
  }, [pages.length])

  // ── Called by each page on first stroke ───────────────────────────────────
  const handleFirstStroke = useCallback((pageIdx) => {
    // Only the LAST page's first stroke unblocks Add Page
    setPages(prev => {
      if (pageIdx === prev.length - 1) setLastPageEmpty(false)
      return prev
    })
    schedulePreview()
  }, [schedulePreview])

  // Trigger preview when stroke counts change
  useEffect(() => {
    schedulePreview()
  }, [totalStrokes, schedulePreview])

  // ── Add page ───────────────────────────────────────────────────────────────
  const addPage = useCallback(() => {
    if (lastPageEmpty) {
      showToast('Current page is empty — write something first!', 'warning')
      return
    }
    setPages(prev => [...prev, { id: Date.now() }])
    setLastPageEmpty(true)
    setActivePage(prev => prev + 1)

    // Scroll to new page after React renders it
    setTimeout(() => {
      pagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 80)
  }, [lastPageEmpty, showToast])

  // ── Submit all pages ───────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    const allData = pageRefs.current.map((pr, i) => ({
      page:    i + 1,
      strokes: toBackendStrokes(pr?.getStrokes() ?? []),
    })).filter(p => p.strokes.length > 0)

    if (allData.length === 0) {
      showToast('No strokes to submit — write something first!', 'error')
      return
    }

    setSubmitting(true)
    try {
      const payload = {
        questionText:    '[Multi-page submission from React Canvas Client]',
        totalMarks:      100,
        rubricSchema:    '[Rubric not configured]',
        studentResponse: JSON.stringify(allData),
      }
      const res = await fetch(`${API_BASE}/api/grade`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      })
      res.ok
        ? showToast(`Submitted ${allData.length} page(s) to grading pipeline!`)
        : showToast(`Server error: ${res.status}`, 'error')
    } catch {
      showToast('Backend offline — check your server', 'warning')
    } finally {
      setSubmitting(false)
    }
  }, [showToast])

  return (
    <div className="app">

      {/* ── Header ── */}
      <header className="app-header">
        <div className="logo">
          <div className="logo-badge">E</div>
          <span className="logo-title">ExamCanvas</span>
          <span className="logo-sub">— Answer Sheet</span>
        </div>
        <div className="header-right">
          <div className={`status-dot ${lastPageEmpty && totalStrokes === 0 ? 'idle' : 'active'}`} />
          <span className="status-text">
            {pages.length} page{pages.length !== 1 ? 's' : ''} · {totalStrokes} stroke{totalStrokes !== 1 ? 's' : ''}
          </span>
        </div>
      </header>

      {/* ── Main layout ── */}
      <div className="main-layout">

        {/* ── Answer sheet panel ── */}
        <div className="canvas-panel">

          {/* Toolbar */}
          <div className="panel-header">
            <div className="toolbar-left">
              <span className="panel-title">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="16" y1="13" x2="8" y2="13"/>
                  <line x1="16" y1="17" x2="8" y2="17"/>
                  <polyline points="10 9 9 9 8 9"/>
                </svg>
                Answer Sheet
              </span>
            </div>

            {/* Tool toggle */}
            <div className="tool-toggle" role="group" aria-label="Drawing tool">
              <button
                className={`tool-btn${tool === 'pen' ? ' active' : ''}`}
                onClick={() => setTool('pen')}
                title="Pen"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M12 20h9"/>
                  <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>
                </svg>
                Pen
              </button>
              <button
                className={`tool-btn${tool === 'eraser' ? ' active eraser-active' : ''}`}
                onClick={() => setTool('eraser')}
                title="Eraser"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M20 20H7L3 16l11-11 7 7-2 2"/>
                  <path d="M6.0 11.0 l7 7"/>
                </svg>
                Eraser
              </button>
            </div>

            {/* Right actions */}
            <div className="controls">
              <button
                className="btn-ghost"
                onClick={addPage}
                disabled={lastPageEmpty}
                title={lastPageEmpty ? 'Write on the current page before adding a new one' : 'Add a new page'}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19"/>
                  <line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                Add Page
              </button>
              <button
                className="btn-primary"
                onClick={handleSubmit}
                disabled={submitting || totalStrokes === 0}
              >
                {submitting ? 'Submitting…' : 'Submit'}
              </button>
            </div>
          </div>

          {/* Pages scroll area */}
          <div className="pages-scroll-area">
            {pages.map((page, idx) => (
              <CanvasPage
                key={page.id}
                ref={el => { pageRefs.current[idx] = el }}
                pageNumber={idx + 1}
                isActive={activePage === idx}
                tool={tool}
                onFirstStroke={() => handleFirstStroke(idx)}
                onClick={() => setActivePage(idx)}
              />
            ))}
            {/* Scroll anchor for new page */}
            <div ref={pagesEndRef} style={{ height: 1 }} />
          </div>
        </div>

        {/* ── Telemetry sidebar ── */}
        <div className="sidebar">

          {/* Stats */}
          <div className="stats-card">
            <h3 className="card-title">Session Telemetry</h3>
            <div className="stats-grid">
              <div className="stat">
                <div className="stat-value">{pages.length}</div>
                <div className="stat-label">Pages</div>
              </div>
              <div className="stat">
                <div className="stat-value">{totalStrokes}</div>
                <div className="stat-label">Strokes</div>
              </div>
              <div className="stat">
                <div className="stat-value">{totalPoints}</div>
                <div className="stat-label">Points</div>
              </div>
              <div className="stat">
                <div className={`stat-value tool-indicator ${tool}`}>{tool}</div>
                <div className="stat-label">Tool</div>
              </div>
            </div>
          </div>

          {/* Page map */}
          <div className="stats-card">
            <h3 className="card-title">Page Map</h3>
            <div className="page-map">
              {pages.map((page, idx) => {
                const hasContent = (pageRefs.current[idx]?.getStrokes()?.length ?? 0) > 0
                return (
                  <button
                    key={page.id}
                    className={`page-map-item${activePage === idx ? ' active' : ''}${hasContent ? ' has-content' : ''}`}
                    onClick={() => {
                      setActivePage(idx)
                      document.querySelectorAll('.page-wrapper')[idx]
                        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                    }}
                    title={`Go to Page ${idx + 1}${hasContent ? ' (has content)' : ' (empty)'}`}
                  >
                    <span className="page-map-num">{idx + 1}</span>
                    {hasContent && <span className="page-map-dot" />}
                  </button>
                )
              })}
            </div>
          </div>

          {/* JSON preview */}
          <div className="json-card">
            <div className="json-card-header">
              <h3 className="card-title">Vector Payload Preview</h3>
              <span className="json-badge">JSON</span>
            </div>
            <pre className="json-output">{preview}</pre>
          </div>

          {/* Info */}
          <div className="info-card">
            <h3 className="card-title">Controls</h3>
            <ul className="info-list">
              <li><span className="dot indigo"/>Switch tool: Pen or Eraser in toolbar</li>
              <li><span className="dot green"/>Add Page: only when current page has writing</li>
              <li><span className="dot red"/>Clear Page: trash button on each page</li>
              <li><span className="dot purple"/>Submit: sends all pages to backend</li>
            </ul>
          </div>
        </div>
      </div>

      {/* ── Toast ── */}
      {toast && (
        <div className={`toast toast-${toast.type}`}>{toast.message}</div>
      )}
    </div>
  )
}
