/**
 * StudentCanvas — React component for handwritten exam input.
 *
 * Uses the `signature_pad` library (v5) for canvas drawing.
 * signature_pad handles DPR scaling and coordinate normalisation
 * internally, which eliminates the alignment issues present in a
 * raw HTML5 Canvas implementation.
 *
 * Data contract: stroke data is exported as an array of stroke arrays,
 * each point containing { canvasX, canvasY, pressure, timestamp },
 * preserving full compatibility with the .NET backend /api/grade endpoint.
 */

import { useRef, useEffect, useCallback, useState } from 'react'
import SignaturePad from 'signature_pad'

// ─── Constants ────────────────────────────────────────────────────────────────
const API_BASE = 'https://localhost:50949'
const PEN_COLOR = '#818cf8'
const CANVAS_BG = 'rgba(0,0,0,0)' // transparent so CSS bg shows through

// ─── Custom hook: signature_pad lifecycle ─────────────────────────────────────
function useSignaturePad() {
  const canvasRef = useRef(null)
  const padRef    = useRef(null)
  const [isEmpty, setIsEmpty] = useState(true)
  const [strokeCount, setStrokeCount] = useState(0)
  const [pointCount,  setPointCount]  = useState(0)

  /**
   * Resize the canvas buffer to match its CSS display size × DPR.
   *
   * This is the KEY fix for alignment. signature_pad internally computes
   * pointer coordinates as:
   *   x = (clientX - rect.left) / (rect.width / canvas.width)
   * which correctly maps CSS pixels → buffer pixels regardless of DPR or
   * browser zoom. Setting canvas.width = offsetWidth * ratio then scaling
   * the context by the same ratio means drawing calls and pointer events
   * are always in the same coordinate space.
   *
   * We use ResizeObserver (below) to call this whenever the element resizes.
   */
  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !padRef.current) return

    // Save current drawing data before resizing (resize clears the buffer)
    const data = padRef.current.toData()

    const ratio  = window.devicePixelRatio || 1
    // Use offsetWidth/Height (CSS layout size) — DO NOT use getBoundingClientRect
    // here because rounding differences between the two can offset coordinates.
    canvas.width  = Math.round(canvas.offsetWidth  * ratio)
    canvas.height = Math.round(canvas.offsetHeight * ratio)

    // Scale the context so 1 drawing unit = 1 CSS pixel.
    // Changing canvas.width resets the context to identity, so this is safe.
    const ctx = canvas.getContext('2d')
    ctx.scale(ratio, ratio)

    // Re-instate previous drawing (signature_pad redraws from its internal data)
    padRef.current.fromData(data)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // Perform initial size before creating the pad so first render is correct
    const ratio = window.devicePixelRatio || 1
    canvas.width  = Math.round(canvas.offsetWidth  * ratio)
    canvas.height = Math.round(canvas.offsetHeight * ratio)
    canvas.getContext('2d').scale(ratio, ratio)

    // Create signature_pad instance
    padRef.current = new SignaturePad(canvas, {
      backgroundColor:      CANVAS_BG,
      penColor:             PEN_COLOR,
      minWidth:             1.5,   // minimum stroke width in CSS px
      maxWidth:             6,     // maximum stroke width in CSS px
      velocityFilterWeight: 0.7,   // smoothing (0 = max smooth, 1 = raw)
      throttle:             0,     // no time throttle — use all pointer events
    })

    // Update React state when a stroke ends
    const handleEndStroke = () => {
      const data = padRef.current.toData()
      setIsEmpty(padRef.current.isEmpty())
      setStrokeCount(data.length)
      setPointCount(data.reduce((s, g) => s + g.points.length, 0))
    }
    padRef.current.addEventListener('endStroke', handleEndStroke)

    // Watch the canvas parent for size changes (window resize, layout shift)
    const observer = new ResizeObserver(() => {
      resizeCanvas()
    })
    observer.observe(canvas.parentElement)

    return () => {
      observer.disconnect()
      padRef.current?.removeEventListener('endStroke', handleEndStroke)
      padRef.current?.off()
    }
  }, [resizeCanvas])

  /** Convert signature_pad's internal data to the backend-compatible format. */
  const getStrokePayload = useCallback(() => {
    if (!padRef.current) return []
    return padRef.current.toData().map(group =>
      group.points.map(p => ({
        canvasX:   parseFloat(p.x.toFixed(2)),
        canvasY:   parseFloat(p.y.toFixed(2)),
        pressure:  parseFloat(((p.pressure ?? 0) > 0 ? p.pressure : 0.5).toFixed(4)),
        timestamp: p.time ?? Date.now(),
      }))
    )
  }, [])

  const clear = useCallback(() => {
    padRef.current?.clear()
    setIsEmpty(true)
    setStrokeCount(0)
    setPointCount(0)
  }, [])

  return { canvasRef, padRef, isEmpty, strokeCount, pointCount, getStrokePayload, clear }
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function StudentCanvas() {
  const { canvasRef, isEmpty, strokeCount, pointCount, getStrokePayload, clear } =
    useSignaturePad()

  const [toast,   setToast]   = useState(null)   // { message, type }
  const [preview, setPreview] = useState('// Start writing to capture strokes…')
  const [submitting, setSubmitting] = useState(false)
  const previewTimer = useRef(null)

  // ── Toast helper ────────────────────────────────────────────────────────────
  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }, [])

  // ── Update JSON preview (throttled) ─────────────────────────────────────────
  const schedulePreview = useCallback(() => {
    if (previewTimer.current) return
    previewTimer.current = setTimeout(() => {
      previewTimer.current = null
      const strokes = getStrokePayload()
      if (strokes.length > 0) {
        const last3 = strokes.slice(-3)
        setPreview(
          `// Showing last ${last3.length} of ${strokes.length} strokes\n` +
          JSON.stringify(last3, null, 2)
        )
      }
    }, 300)
  }, [getStrokePayload])

  // Trigger preview update whenever stroke/point counts change
  useEffect(() => {
    if (strokeCount > 0) schedulePreview()
  }, [strokeCount, pointCount, schedulePreview])

  // ── Submit ──────────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (isEmpty) { showToast('Canvas is empty!', 'error'); return }
    setSubmitting(true)
    try {
      const payload = {
        questionText:    '[Submitted from React Canvas Client]',
        totalMarks:      100,
        rubricSchema:    '[Rubric not configured]',
        studentResponse: JSON.stringify(getStrokePayload()),
      }
      const res = await fetch(`${API_BASE}/api/grade`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      })
      res.ok
        ? showToast('Submitted to grading pipeline!')
        : showToast(`Server error: ${res.status}`, 'error')
    } catch {
      showToast('Backend offline — save locally first', 'warning')
    } finally {
      setSubmitting(false)
    }
  }, [isEmpty, getStrokePayload, showToast])

  // ── Clear ───────────────────────────────────────────────────────────────────
  const handleClear = useCallback(() => {
    clear()
    setPreview('// Drawing board cleared.')
  }, [clear])

  return (
    <div className="app">
      {/* ── Header ── */}
      <header className="app-header">
        <div className="logo">
          <div className="logo-badge">E</div>
          <span className="logo-title">ExamCanvas Client</span>
          <span className="logo-sub">— React Edition</span>
        </div>
        <div className="header-right">
          <div className={`status-dot ${isEmpty ? 'idle' : 'active'}`} />
          <span className="status-text">{isEmpty ? 'Ready' : 'Drawing'}</span>
        </div>
      </header>

      {/* ── Main layout ── */}
      <div className="main-layout">

        {/* ── Canvas panel ── */}
        <div className="canvas-panel">
          <div className="panel-header">
            <span className="panel-title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>
              </svg>
              Handwritten Answer
            </span>
            <div className="controls">
              <button className="btn-ghost" onClick={handleClear}>Clear</button>
              <button
                className="btn-primary"
                onClick={handleSubmit}
                disabled={submitting || isEmpty}
              >
                {submitting ? 'Submitting…' : 'Submit'}
              </button>
            </div>
          </div>

          {/* The canvas wrapper — signature_pad attaches to the <canvas> element */}
          <div className="canvas-wrap">
            {isEmpty && (
              <div className="canvas-hint" aria-hidden="true">
                Write your answer here…
              </div>
            )}
            <canvas
              ref={canvasRef}
              id="drawingCanvas"
              className="drawing-canvas"
              aria-label="Handwriting canvas"
            />
          </div>
        </div>

        {/* ── Telemetry sidebar ── */}
        <div className="sidebar">
          {/* Stats */}
          <div className="stats-card">
            <h3 className="card-title">Stroke Telemetry</h3>
            <div className="stats-grid">
              <div className="stat">
                <div className="stat-value">{strokeCount}</div>
                <div className="stat-label">Strokes</div>
              </div>
              <div className="stat">
                <div className="stat-value">{pointCount}</div>
                <div className="stat-label">Points</div>
              </div>
              <div className="stat">
                <div className="stat-value">{(window.devicePixelRatio || 1).toFixed(2)}×</div>
                <div className="stat-label">DPR</div>
              </div>
              <div className="stat">
                <div className={`stat-value status-badge ${isEmpty ? 'idle' : 'live'}`}>
                  {isEmpty ? 'Empty' : 'Live'}
                </div>
                <div className="stat-label">Canvas</div>
              </div>
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

          {/* Info box */}
          <div className="info-card">
            <h3 className="card-title">Powered By</h3>
            <ul className="info-list">
              <li><span className="dot green"/>React 19 + Vite</li>
              <li><span className="dot indigo"/>signature_pad v5 — DPR-aware alignment</li>
              <li><span className="dot purple"/>Velocity-smoothed Bézier curves</li>
              <li><span className="dot blue"/>.NET 8 / Semantic Kernel backend</li>
            </ul>
          </div>
        </div>
      </div>

      {/* ── Toast ── */}
      {toast && (
        <div className={`toast toast-${toast.type}`}>
          {toast.message}
        </div>
      )}
    </div>
  )
}
