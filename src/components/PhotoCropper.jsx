import { useEffect, useRef, useState } from 'react'

// LinkedIn-style image editor: large photo area with circular crop overlay
// on the left, control panel (Crop / Filter / Adjust tabs) on the right.
const OUTPUT_SIZE = 640

export default function PhotoCropper({ file, onCancel, onSave }) {
  const viewportRef = useRef(null)
  const imgRef = useRef(null)
  const [imgUrl, setImgUrl] = useState(null)
  const [natural, setNatural] = useState(null) // { w, h }
  const [viewSize, setViewSize] = useState(400) // square viewport side
  const [minScale, setMinScale] = useState(1)
  const [zoomMult, setZoomMult] = useState(1) // 1..3
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [rotate, setRotate] = useState(0) // degrees, -180..180
  const [flipH, setFlipH] = useState(false)
  const [flipV, setFlipV] = useState(false)
  const [activeTab, setActiveTab] = useState('crop')
  // Filter & adjust (visual only — applied via CSS filters on the image)
  const [brightness, setBrightness] = useState(100)
  const [contrast, setContrast] = useState(100)
  const [saturate, setSaturate] = useState(100)
  const [activeFilter, setActiveFilter] = useState('none')
  const dragRef = useRef(null)

  useEffect(() => {
    const url = URL.createObjectURL(file)
    setImgUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  useEffect(() => {
    if (viewportRef.current) {
      const rect = viewportRef.current.getBoundingClientRect()
      const side = Math.min(rect.width, rect.height)
      setViewSize(side)
    }
  }, [])

  function recalcScale(natW, natH, side) {
    // The image must cover the circle (diameter = side) regardless of rotation.
    // For simplicity we cover the square viewport.
    const scale = Math.max(side / natW, side / natH)
    return scale
  }

  function handleImgLoad(e) {
    const w = e.target.naturalWidth
    const h = e.target.naturalHeight
    setNatural({ w, h })
    const side = viewSize
    const scale = recalcScale(w, h, side)
    setMinScale(scale)
    setZoomMult(1)
    setOffset({
      x: (side - w * scale) / 2,
      y: (side - h * scale) / 2,
    })
  }

  function clamp(pos, za) {
    if (!natural) return pos
    const sw = natural.w * za
    const sh = natural.h * za
    return {
      x: Math.min(0, Math.max(viewSize - sw, pos.x)),
      y: Math.min(0, Math.max(viewSize - sh, pos.y)),
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
    setOffset(clamp({ x: dragRef.current.startOffset.x + dx, y: dragRef.current.startOffset.y + dy }, zoomActual))
  }
  function onPointerUp() { dragRef.current = null }

  function onWheel(e) {
    e.preventDefault()
    const delta = e.deltaY > 0 ? -0.05 : 0.05
    setZoomMult(prev => {
      const next = Math.min(3, Math.max(1, prev + delta))
      setOffset(o => clamp(o, minScale * next))
      return next
    })
  }

  function rotateBy(deg) {
    setRotate(r => {
      let next = r + deg
      if (next > 180) next -= 360
      if (next < -180) next += 360
      return next
    })
  }

  const FILTERS = {
    none: '',
    grayscale: 'grayscale(100%)',
    sepia: 'sepia(80%)',
    warm: 'sepia(30%) saturate(140%)',
    cool: 'hue-rotate(20deg) saturate(110%)',
    vivid: 'saturate(180%) contrast(110%)',
  }

  function getFilterStyle() {
    const base = FILTERS[activeFilter] || ''
    const adjustments = []
    if (brightness !== 100) adjustments.push(`brightness(${brightness}%)`)
    if (contrast !== 100) adjustments.push(`contrast(${contrast}%)`)
    if (saturate !== 100) adjustments.push(`saturate(${saturate}%)`)
    return [base, ...adjustments].filter(Boolean).join(' ') || 'none'
  }

  function handleSave() {
    if (!natural) return

    const canvas = document.createElement('canvas')
    canvas.width = OUTPUT_SIZE
    canvas.height = OUTPUT_SIZE
    const ctx = canvas.getContext('2d')

    // Apply filter + adjustments
    ctx.filter = getFilterStyle()

    // Apply rotation + flip
    ctx.translate(OUTPUT_SIZE / 2, OUTPUT_SIZE / 2)
    ctx.rotate((rotate * Math.PI) / 180)
    ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1)
    ctx.translate(-OUTPUT_SIZE / 2, -OUTPUT_SIZE / 2)

    // Map viewport coords to source
    const sourceX = -offset.x / zoomActual
    const sourceY = -offset.y / zoomActual
    const sourceW = viewSize / zoomActual
    const sourceH = viewSize / zoomActual

    ctx.drawImage(
      imgRef.current,
      sourceX, sourceY, sourceW, sourceH,
      0, 0, OUTPUT_SIZE, OUTPUT_SIZE
    )

    canvas.toBlob(blob => onSave(blob), 'image/jpeg', 0.9)
  }

  const imgTransform = [
    `rotate(${rotate}deg)`,
    `scaleX(${flipH ? -1 : 1})`,
    `scaleY(${flipV ? -1 : 1})`,
  ].join(' ')

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="cropper-editor" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="cropper-editor-header">
          <h2>Edit image</h2>
          <button className="modal-close" onClick={onCancel} aria-label="Close">×</button>
        </div>

        {/* Main content: photo area + side panel */}
        <div className="cropper-editor-content">
          {/* Photo area */}
          <div className="cropper-editor-photo-area">
            <div
              ref={viewportRef}
              className="cropper-editor-viewport"
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
                    transform: imgTransform,
                    transformOrigin: 'center center',
                    filter: getFilterStyle(),
                  } : { opacity: 0 }}
                />
              )}
              {/* Circular crop overlay */}
              <div className="cropper-circle-overlay" />
            </div>
          </div>

          {/* Side panel */}
          <div className="cropper-editor-panel">
            <div className="cropper-panel-tabs">
              <button
                className={`cropper-panel-tab ${activeTab === 'crop' ? 'active' : ''}`}
                onClick={() => setActiveTab('crop')}
              >Crop</button>
              <button
                className={`cropper-panel-tab ${activeTab === 'filter' ? 'active' : ''}`}
                onClick={() => setActiveTab('filter')}
              >Filter</button>
              <button
                className={`cropper-panel-tab ${activeTab === 'adjust' ? 'active' : ''}`}
                onClick={() => setActiveTab('adjust')}
              >Adjust</button>
            </div>

            <div className="cropper-panel-body">
              {activeTab === 'crop' && (
                <>
                  {/* Rotate/flip buttons */}
                  <div className="cropper-transform-btns">
                    <button type="button" onClick={() => rotateBy(-90)} title="Rotate left" aria-label="Rotate left">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 2v6h6"/><path d="M2.5 8a10 10 0 1 1 3 7"/></svg>
                    </button>
                    <button type="button" onClick={() => rotateBy(90)} title="Rotate right" aria-label="Rotate right">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.5 2v6h-6"/><path d="M21.5 8A10 10 0 1 0 18.5 15"/></svg>
                    </button>
                    <button type="button" onClick={() => setFlipH(f => !f)} title="Flip horizontal" aria-label="Flip horizontal" className={flipH ? 'active' : ''}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3"/><path d="M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3"/><line x1="12" y1="20" x2="12" y2="4"/></svg>
                    </button>
                    <button type="button" onClick={() => setFlipV(f => !f)} title="Flip vertical" aria-label="Flip vertical" className={flipV ? 'active' : ''}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3"/><path d="M3 16v3a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3"/><line x1="4" y1="12" x2="20" y2="12"/></svg>
                    </button>
                  </div>

                  <div className="cropper-slider-group">
                    <span className="cropper-slider-label">Zoom</span>
                    <input
                      type="range" min="1" max="3" step="0.01"
                      value={zoomMult}
                      onChange={e => {
                        const m = Number(e.target.value)
                        setZoomMult(m)
                        setOffset(prev => clamp(prev, minScale * m))
                      }}
                      disabled={!natural}
                    />
                  </div>

                  <div className="cropper-slider-group">
                    <div className="cropper-slider-label-row">
                      <span className="cropper-slider-label">Rotate</span>
                      <span className="cropper-slider-value">{rotate}°</span>
                    </div>
                    <input
                      type="range" min="-180" max="180" step="1"
                      value={rotate}
                      onChange={e => setRotate(Number(e.target.value))}
                    />
                  </div>
                </>
              )}

              {activeTab === 'filter' && (
                <div className="cropper-filter-grid">
                  {Object.keys(FILTERS).map(key => (
                    <button
                      key={key}
                      type="button"
                      className={`cropper-filter-btn ${activeFilter === key ? 'active' : ''}`}
                      onClick={() => setActiveFilter(key)}
                    >
                      {imgUrl && (
                        <div className="cropper-filter-thumb">
                          <img src={imgUrl} alt="" style={{ filter: FILTERS[key] || 'none' }} />
                        </div>
                      )}
                      <span>{key.charAt(0).toUpperCase() + key.slice(1)}</span>
                    </button>
                  ))}
                </div>
              )}

              {activeTab === 'adjust' && (
                <>
                  <div className="cropper-slider-group">
                    <div className="cropper-slider-label-row">
                      <span className="cropper-slider-label">Brightness</span>
                      <span className="cropper-slider-value">{brightness - 100}</span>
                    </div>
                    <input type="range" min="50" max="150" step="1" value={brightness}
                      onChange={e => setBrightness(Number(e.target.value))} />
                  </div>
                  <div className="cropper-slider-group">
                    <div className="cropper-slider-label-row">
                      <span className="cropper-slider-label">Contrast</span>
                      <span className="cropper-slider-value">{contrast - 100}</span>
                    </div>
                    <input type="range" min="50" max="150" step="1" value={contrast}
                      onChange={e => setContrast(Number(e.target.value))} />
                  </div>
                  <div className="cropper-slider-group">
                    <div className="cropper-slider-label-row">
                      <span className="cropper-slider-label">Saturation</span>
                      <span className="cropper-slider-value">{saturate - 100}</span>
                    </div>
                    <input type="range" min="0" max="200" step="1" value={saturate}
                      onChange={e => setSaturate(Number(e.target.value))} />
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="cropper-editor-footer">
          <button className="btn primary" onClick={handleSave} disabled={!natural}>Save changes</button>
        </div>
      </div>
    </div>
  )
}
