import { useEffect, useRef, useState } from 'react'

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
const WEEKDAYS = ['Su','Mo','Tu','We','Th','Fr','Sa']

function sameDay(a, b) {
  return a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}
function pad(n) { return String(n).padStart(2, '0') }

function formatDisplay(date) {
  if (!date) return ''
  const day = date.getDate()
  const month = MONTH_NAMES[date.getMonth()].slice(0, 3)
  const year = date.getFullYear()
  const hh = pad(date.getHours())
  const mm = pad(date.getMinutes())
  return `${day} ${month} ${year}, ${hh}:${mm}`
}

// Controlled: value is a Date or null, onChange receives a Date.
export default function DateTimePicker({ value, onChange, placeholder = 'Pick a date & time' }) {
  const [open, setOpen] = useState(false)
  const [viewMonth, setViewMonth] = useState(() => {
    const d = value ? new Date(value) : new Date()
    d.setDate(1); d.setHours(0, 0, 0, 0)
    return d
  })
  const wrapRef = useRef(null)

  useEffect(() => {
    function onDocClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const hour = value ? value.getHours() : 9
  const minute = value ? value.getMinutes() : 0

  function selectDay(day) {
    const next = new Date(day)
    next.setHours(hour, minute, 0, 0)
    onChange(next)
  }
  function setHour(h) {
    const next = value ? new Date(value) : new Date()
    next.setHours(Number(h))
    onChange(next)
  }
  function setMinute(m) {
    const next = value ? new Date(value) : new Date()
    next.setMinutes(Number(m))
    onChange(next)
  }

  const year = viewMonth.getFullYear()
  const month = viewMonth.getMonth()
  const firstWeekday = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < firstWeekday; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d))

  const today = new Date()

  return (
    <div className="dtp-wrap" ref={wrapRef}>
      <button
        type="button"
        className="dtp-trigger"
        onClick={() => setOpen((o) => !o)}
      >
        {value ? formatDisplay(value) : <span className="dtp-placeholder">{placeholder}</span>}
        <span className="dtp-trigger-icon">📅</span>
      </button>

      {open && (
        <div className="dtp-popover">
          <div className="dtp-cal-header">
            <button type="button" className="btn ghost small" onClick={() => setViewMonth(new Date(year, month - 1, 1))} aria-label="Previous month">‹</button>
            <span className="dtp-cal-label">{MONTH_NAMES[month]} {year}</span>
            <button type="button" className="btn ghost small" onClick={() => setViewMonth(new Date(year, month + 1, 1))} aria-label="Next month">›</button>
          </div>

          <div className="dtp-weekdays">
            {WEEKDAYS.map((w) => <div key={w}>{w}</div>)}
          </div>

          <div className="dtp-grid">
            {cells.map((d, i) => {
              if (!d) return <div className="dtp-cell empty" key={i} />
              const isSelected = value && sameDay(d, value)
              const isToday = sameDay(d, today)
              return (
                <button
                  type="button"
                  key={i}
                  className={[
                    'dtp-cell',
                    isSelected ? 'selected' : '',
                    isToday ? 'today' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => selectDay(d)}
                >
                  {d.getDate()}
                </button>
              )
            })}
          </div>

          <div className="dtp-time-row">
            <span className="dtp-time-label">Time</span>
            <div className="select-wrap dtp-time-select">
              <select value={hour} onChange={(e) => setHour(e.target.value)}>
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>{pad(h)}</option>
                ))}
              </select>
            </div>
            <span>:</span>
            <div className="select-wrap dtp-time-select">
              <select value={minute} onChange={(e) => setMinute(e.target.value)}>
                {[0, 15, 30, 45].map((m) => (
                  <option key={m} value={m}>{pad(m)}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="dtp-footer">
            <button type="button" className="btn primary small" onClick={() => setOpen(false)}>Done</button>
          </div>
        </div>
      )}
    </div>
  )
}
