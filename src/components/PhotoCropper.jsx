import { useEffect, useRef, useState } from 'react'

// A minimal, dependency-free crop tool: drag the photo to reposition it,
// use the slider to zoom, then export exactly what's inside the frame.
// No guessing at object-position afterwards — what you see here is what
// gets saved.
const OUTPUT_WIDTH = 640
const ASPECT = 4 / 5 // width / height — matches the card + modal photo shape
const PREVIEW_CIRCLE = 72 // px — matches how the photo is shown as a round avatar elsewhere

export default function PhotoCropper({ file, onCancel, onSave }) {
  const viewportRef = useRef(null)
  const imgRef = useRef(null)
  const [imgUrl, setImgUrl] = useState(null)
  const [natural, setNatural] = useState(null) // { w, h }
  const [viewport, setViewport] = useState({ w: 320, h: 320 / ASPECT })
  const [minScale, setMinScale] = useState(1)
  const [zoomMult, setZoomMult] = useState(1) // 1..3, multiplies minScale
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const dragRef = useRef(null) // { startX, startY, startOffset }

  useEffect(() => {
    const url = URL.createObjectURL(file)
    setImgUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  // Measure the actual rendered viewport once mounted (CSS controls its
  // width; height follows from ASPECT), before the image reports its
  // natural size so we can compute the starting scale + centering.
  useEffect(() => {
    if (viewportRef.current) {
      const w = viewportRef.current.offsetWidth
      setViewport({ w, h: w / ASPECT })
    }
  }, [])

  function handleImgLoad(e) {
    const w = e.target.naturalWidth
    const h = e.target.naturalHeight
    setNatural({ w, h })
    const vw = viewport.w, vh = viewport.h
    const scale = Math.max(vw / w, vh / h)
    setMinScale(scale)
    setZoomMult(1)
    setOffset({
      x: (vw - w * scale) / 2,
      y: (vh - h * scale) / 2,
    })
  }

  function clamp(pos, zoomActual) {
    if (!natural) return pos
    const scaledW = natural.w * zoomActual
    const scaledH = natural.h * zoomActual
    const minX = viewport.w - scaledW
    const minY = viewport.h - scaledH
    return {
      x: Math.min(0, Math.max(minX, pos.x)),
      y: Math.min(0, Math.max(minY, pos.y)),
    }
  }

  const zoomActual = minScale * zoomMult

  function onPointerDown(e) {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { startX: e.clientX, startY: e.clientY, startOffset: offset }
  }
  function onPointerMove(e) {
    if (!dragRef.current) return
    const dx = e.clientX - dragRef.current.startX
    const dy = e.clientY - dragRef.current.startY
    const next = {
      x: dragRef.current.startOffset.x + dx,
      y: dragRef.current.startOffset.y + dy,
    }
    setOffset(clamp(next, zoomActual))
  }
  function onPointerUp() {
    dragRef.current = null
  }

  function onZoomChange(e) {
    const mult = Number(e.target.value)
    setZoomMult(mult)
    setOffset((prev) => clamp(prev, minScale * mult))
  }

  function onWheel(e) {
    e.preventDefault()
    const delta = e.deltaY > 0 ? -0.05 : 0.05
    setZoomMult((prev) => {
      const next = Math.min(3, Math.max(1, prev + delta))
      setOffset((o) => clamp(o, minScale * next))
      return next
    })
  }

  function handleSave() {
    if (!natural) return
    const sourceX = -offset.x / zoomActual
    const sourceY = -offset.y / zoomActual
    const sourceW = viewport.w / zoomActual
    const sourceH = viewport.h / zoomActual

    const canvas = document.createElement('canvas')
    canvas.width = OUTPUT_WIDTH
    canvas.height = OUTPUT_WIDTH / ASPECT
    const ctx = canvas.getContext('2d')
    ctx.drawImage(
      imgRef.current,
      sourceX, sourceY, sourceW, sourceH,
      0, 0, canvas.width, canvas.height
    )
    canvas.toBlob((blob) => onSave(blob), 'image/jpeg', 0.9)
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal cropper-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Position your photo</h2>
          <button className="modal-close" onClick={onCancel} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          <div
            ref={viewportRef}
            className="cropper-viewport"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
            onWheel={onWheel}
          >
            {imgUrl && (
              <img
                ref={imgRef}
                src={imgUrl}
                alt=""
                draggable={false}
                onLoad={handleImgLoad}
                style={natural ? {
                  position: 'absolute',
                  left: offset.x,
                  top: offset.y,
                  width: natural.w * zoomActual,
                  height: natural.h * zoomActual,
                } : { opacity: 0 }}
              />
            )}
          </div>
          <div className="cropper-controls">
            <span className="cropper-zoom-label">Zoom</span>
            <input
              type="range"
              min="1" max="3" step="0.01"
              value={zoomMult}
              onChange={onZoomChange}
              disabled={!natural}
            />
          </div>
          <p className="hint">Drag the photo to reposition it, or scroll to zoom.</p>

          {natural && imgUrl && (
            <div className="cropper-preview-row">
              <span className="cropper-preview-label">Your avatar</span>
              <RoundPreview
                imgUrl={imgUrl}
                natural={natural}
                offset={offset}
                zoomActual={zoomActual}
                viewportW={viewport.w}
              />
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn ghost" onClick={onCancel}>Cancel</button>
          <button className="btn primary" onClick={handleSave} disabled={!natural}>Use this photo</button>
        </div>
      </div>
    </div>
  )
}

// Shows the exact same rectangle crop the way it's actually rendered
// elsewhere in the app: as a round avatar with object-fit: cover. Mirrors
// the crop math above at a smaller scale so what the user sees here is
// truly what they'll get after saving — no separate render path to drift
// out of sync.
function RoundPreview({ imgUrl, natural, offset, zoomActual, viewportW }) {
  const scale = PREVIEW_CIRCLE / viewportW
  const rectH = PREVIEW_CIRCLE / ASPECT // height of the full 4:5 crop at preview scale
  const rectTop = -(rectH - PREVIEW_CIRCLE) / 2 // center the square avatar window within the taller rectangle

  return (
    <div className="cropper-preview-circle">
      <div style={{ position: 'absolute', left: 0, top: rectTop, width: PREVIEW_CIRCLE, height: rectH, overflow: 'hidden' }}>
        <img
          src={imgUrl}
          alt=""
          draggable={false}
          style={{
            left: offset.x * scale,
            top: offset.y * scale,
            width: natural.w * zoomActual * scale,
            height: natural.h * zoomActual * scale,
          }}
        />
      </div>
    </div>
  )
}
