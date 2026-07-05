import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import EmptyState from './EmptyState.jsx'
import DateTimePicker from './DateTimePicker.jsx'

const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
const WEEKDAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export default function Events({ session, profile }) {
  const [events, setEvents] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [view, setView] = useState('list') // 'list' | 'calendar'
  const [cursorMonth, setCursorMonth] = useState(() => {
    const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d
  })
  const [selectedDay, setSelectedDay] = useState(null)

  async function load() {
    // Fetch a generous window so the calendar view has enough to browse.
    const { data } = await supabase
      .from('events')
      .select('id, title, description, event_date, location, created_by, profiles!events_created_by_fkey ( full_name )')
      .order('event_date', { ascending: true })
      .limit(500)
    setEvents(data || [])
  }

  useEffect(() => {
    load()
    const channel = supabase
      .channel('events')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, load)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [])

  async function removeEvent(id) {
    if (!confirm('Remove this event?')) return
    await supabase.from('events').delete().eq('id', id)
  }

  const canPost = profile?.approved
  const now = new Date()
  const upcoming = events.filter((e) => new Date(e.event_date) >= now)
  const past = events.filter((e) => new Date(e.event_date) < now).reverse()
  const listItems = [...upcoming, ...past]

  return (
    <section className="panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 className="panel-title">Events</h2>
          <p className="panel-sub">Reunions, golf days, house drinks. See you there.</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div className="filter-radio-row" style={{ margin: 0 }}>
            <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>List</button>
            <button className={view === 'calendar' ? 'on' : ''} onClick={() => setView('calendar')}>Calendar</button>
          </div>
          {canPost && !showForm && (
            <button className="btn primary" onClick={() => setShowForm(true)}>Add event</button>
          )}
        </div>
      </div>

      {showForm && (
        <EventForm
          session={session}
          onCancel={() => setShowForm(false)}
          onCreated={() => { setShowForm(false); load() }}
        />
      )}

      {view === 'list' ? (
        <>
          {listItems.length === 0 && (
            <EmptyState icon="events" message="No events on the calendar yet." subMessage="Post one above to get the first reunion rolling." />
          )}
          <ul className="event-list">
            {listItems.map((e) => (
              <EventCard key={e.id} e={e} session={session} onDelete={() => removeEvent(e.id)} />
            ))}
          </ul>
        </>
      ) : (
        <CalendarView
          events={events}
          cursorMonth={cursorMonth}
          setCursorMonth={setCursorMonth}
          selectedDay={selectedDay}
          setSelectedDay={setSelectedDay}
          session={session}
          onDelete={removeEvent}
        />
      )}
    </section>
  )
}

function EventCard({ e, session, onDelete }) {
  const d = new Date(e.event_date)
  const isPast = d < new Date()
  return (
    <li className="event-card" style={isPast ? { opacity: 0.65 } : undefined}>
      <div className="event-date-block" style={isPast ? { background: 'var(--maroon)' } : undefined}>
        <div className="event-date-month">{MONTHS[d.getMonth()]}</div>
        <div className="event-date-day">{d.getDate()}</div>
        <div className="event-date-time">{d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
      </div>
      <div>
        <h3 className="event-title">
          {e.title}
          {isPast && <span className="job-badge" style={{ background: 'var(--ink-soft)' }}>Past</span>}
        </h3>
        {e.location && <p className="event-location">📍 {e.location}</p>}
        {e.description && <p className="event-desc">{e.description}</p>}
        <p className="event-meta">Posted by {e.profiles?.full_name || 'a member'}</p>
      </div>
      {e.created_by === session.user.id && (
        <button className="btn ghost small" onClick={onDelete}>Delete</button>
      )}
    </li>
  )
}

/* ---------- Calendar grid view ---------- */
function CalendarView({ events, cursorMonth, setCursorMonth, selectedDay, setSelectedDay, session, onDelete }) {
  const year = cursorMonth.getFullYear()
  const month = cursorMonth.getMonth()

  const cells = useMemo(() => {
    const firstOfMonth = new Date(year, month, 1)
    const startWeekday = firstOfMonth.getDay() // 0=Sun
    const daysInMonth = new Date(year, month + 1, 0).getDate()

    const list = []
    for (let i = 0; i < startWeekday; i++) list.push(null)
    for (let d = 1; d <= daysInMonth; d++) list.push(new Date(year, month, d))
    return list
  }, [year, month])

  function eventsOn(date) {
    if (!date) return []
    return events.filter((e) => sameDay(new Date(e.event_date), date))
  }

  function prevMonth() { setCursorMonth(new Date(year, month - 1, 1)); setSelectedDay(null) }
  function nextMonth() { setCursorMonth(new Date(year, month + 1, 1)); setSelectedDay(null) }

  const today = new Date()
  const selectedEvents = selectedDay ? eventsOn(selectedDay) : []

  return (
    <div>
      <div className="calendar-header">
        <button className="btn ghost small" onClick={prevMonth} aria-label="Previous month">‹</button>
        <span className="calendar-month-label">{MONTH_NAMES[month]} {year}</span>
        <button className="btn ghost small" onClick={nextMonth} aria-label="Next month">›</button>
      </div>

      <div className="calendar-weekdays">
        {WEEKDAYS.map((w) => <div key={w}>{w}</div>)}
      </div>

      <div className="calendar-grid">
        {cells.map((date, i) => {
          if (!date) return <div className="calendar-cell empty" key={i} />
          const dayEvents = eventsOn(date)
          const isToday = sameDay(date, today)
          const isSelected = selectedDay && sameDay(date, selectedDay)
          return (
            <button
              key={i}
              className={[
                'calendar-cell',
                isToday ? 'today' : '',
                isSelected ? 'selected' : '',
                dayEvents.length ? 'has-event' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => setSelectedDay(date)}
            >
              <span className="calendar-day-num">{date.getDate()}</span>
              {dayEvents.length > 0 && <span className="calendar-dot" />}
            </button>
          )
        })}
      </div>

      <div className="calendar-selected-events">
        {!selectedDay && <p className="empty small">Click a day to see what's happening.</p>}
        {selectedDay && selectedEvents.length === 0 && (
          <p className="empty small">Nothing on {selectedDay.toLocaleDateString()}.</p>
        )}
        {selectedEvents.length > 0 && (
          <ul className="event-list">
            {selectedEvents.map((e) => (
              <EventCard key={e.id} e={e} session={session} onDelete={() => onDelete(e.id)} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function EventForm({ session, onCancel, onCreated }) {
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(null)
  const [location, setLocation] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function submit() {
    if (!title.trim() || !date) { setError('Title and date are required.'); return }
    setBusy(true); setError(null)
    const { error } = await supabase.from('events').insert({
      title: title.trim(),
      event_date: date.toISOString(),
      location: location.trim(),
      description: description.trim(),
      created_by: session.user.id,
    })
    if (error) {
      setError(error.message.includes('policy')
        ? 'Creating events unlocks once your account is approved.'
        : error.message)
      setBusy(false)
    } else {
      onCreated()
    }
  }

  return (
    <div className="create-panel">
      <h3>Add an event</h3>
      <label className="field"><span>Title</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="60-year reunion braai" />
      </label>
      <div className="field-row">
        <label className="field"><span>Date & time</span>
          <DateTimePicker value={date} onChange={setDate} placeholder="Pick a date & time" />
        </label>
        <label className="field"><span>Location</span>
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Eendrag, Stellenbosch" />
        </label>
      </div>
      <label className="field"><span>Description</span>
        <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What's happening, RSVP details, cost…" style={{ resize: 'none' }} />
      </label>
      {error && <p className="form-error">{error}</p>}
      <div className="btn-row">
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
        <button className="btn primary" onClick={submit} disabled={busy}>
          {busy ? 'Posting…' : 'Post event'}
        </button>
      </div>
    </div>
  )
}
