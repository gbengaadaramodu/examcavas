/**
 * CanvasPage — a single answer-sheet page.
 *
 * Self-contained: owns its own signature_pad instance, resize logic,
 * and eraser pointer-event handling.
 *
 * Exposes { isEmpty, getStrokes, clearPage } to the parent via a
 * forwarded ref (useImperativeHandle).
 */

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import SignaturePad from 'signature_pad'

const ERASER_RADIUS = 18 // CSS px

const CanvasPage = forwardRef(function CanvasPage(
  { pageNumber, isActive, tool, onFirstStroke, onClick },
  ref
) {
  const canvasRef        = useRef(null)
  const padRef           = useRef(null)
  const eraserCleanupRef = useRef(null)
  const [localEmpty, setLocalEmpty] = useState(true)

  // ── Resize: keep buffer = CSS size × DPR ──────────────────────────────────
  const resizeCanvas = () => {
    const canvas = canvasRef.current
    const pad    = padRef.current
    if (!canvas || !pad) return
    const data  = pad.toData()
    const ratio = window.devicePixelRatio || 1
    canvas.width  = Math.round(canvas.offsetWidth  * ratio)
    canvas.height = Math.round(canvas.offsetHeight * ratio)
    canvas.getContext('2d').scale(ratio, ratio)
    pad.fromData(data)
  }

  // ── signature_pad initialisation ───────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // Initial size before pad creation so first render is correct
    const ratio = window.devicePixelRatio || 1
    canvas.width  = Math.round(canvas.offsetWidth  * ratio)
    canvas.height = Math.round(canvas.offsetHeight * ratio)
    canvas.getContext('2d').scale(ratio, ratio)

    const pad = new SignaturePad(canvas, {
      backgroundColor:      'rgba(0,0,0,0)', // transparent — CSS bg shows through
      penColor:             '#818cf8',
      minWidth:             1.5,
      maxWidth:             6,
      velocityFilterWeight: 0.7,
      throttle:             0,
    })
    padRef.current = pad

    const handleEnd = () => {
      setLocalEmpty(false)
      onFirstStroke?.()
    }
    pad.addEventListener('endStroke', handleEnd)

    const observer = new ResizeObserver(resizeCanvas)
    observer.observe(canvas)

    return () => {
      observer.disconnect()
      pad.removeEventListener('endStroke', handleEnd)
      pad.off()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Tool switching: pen ↔ eraser ──────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    const pad    = padRef.current
    if (!canvas || !pad) return

    // Tear down previous eraser listeners before switching
    eraserCleanupRef.current?.()
    eraserCleanupRef.current = null

    if (tool === 'eraser') {
      pad.off() // hand event control to our eraser logic

      const ctx = canvas.getContext('2d')
      let drawing = false

      const pos = (e) => {
        const r = canvas.getBoundingClientRect()
        return [e.clientX - r.left, e.clientY - r.top]
      }

      const erase = (e) => {
        if (!drawing) return
        const [x, y] = pos(e)
        ctx.save()
        ctx.globalCompositeOperation = 'destination-out'
        ctx.beginPath()
        ctx.arc(x, y, ERASER_RADIUS, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }

      const onDown = (e) => {
        canvas.setPointerCapture(e.pointerId)
        drawing = true
        erase(e)
      }
      const onMove   = (e) => erase(e)
      const onUp     = ()  => { drawing = false }

      canvas.addEventListener('pointerdown',   onDown)
      canvas.addEventListener('pointermove',   onMove)
      canvas.addEventListener('pointerup',     onUp)
      canvas.addEventListener('pointercancel', onUp)

      eraserCleanupRef.current = () => {
        canvas.removeEventListener('pointerdown',   onDown)
        canvas.removeEventListener('pointermove',   onMove)
        canvas.removeEventListener('pointerup',     onUp)
        canvas.removeEventListener('pointercancel', onUp)
        pad.on() // return control to signature_pad
      }
    } else {
      // pen mode — signature_pad already owns events (pad.on called in cleanup)
      pad.on()
    }

    return () => {
      eraserCleanupRef.current?.()
      eraserCleanupRef.current = null
    }
  }, [tool])

  // ── Public API via forwarded ref ───────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    isEmpty:    () => padRef.current?.isEmpty() ?? true,
    getStrokes: () => padRef.current?.toData()  ?? [],
    clearPage:  () => {
      padRef.current?.clear()
      setLocalEmpty(true)
    },
  }), [])

  return (
    <div
      className={`page-wrapper${isActive ? ' page-active' : ''}`}
      onClick={onClick}
    >
      {/* Page label + clear button */}
      <div className="page-meta">
        <span className="page-label">Page {pageNumber}</span>
        {!localEmpty && (
          <button
            className="clear-page-btn"
            title="Clear this page"
            onClick={(e) => {
              e.stopPropagation()
              padRef.current?.clear()
              setLocalEmpty(true)
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14H6L5 6"/>
              <path d="M10 11v6M14 11v6"/>
              <path d="M9 6V4h6v2"/>
            </svg>
            Clear page
          </button>
        )}
      </div>

      {/* Paper surface */}
      <div className={`page-surface${tool === 'eraser' ? ' eraser-cursor' : ''}`}>
        {localEmpty && (
          <div className="page-empty-hint" aria-hidden="true">
            {pageNumber === 1
              ? 'Write your answer here…'
              : `Page ${pageNumber} — continue writing…`}
          </div>
        )}
        <canvas
          ref={canvasRef}
          className="page-canvas"
          aria-label={`Answer page ${pageNumber}`}
          style={{ touchAction: 'none' }}
        />
      </div>
    </div>
  )
})

export default CanvasPage
