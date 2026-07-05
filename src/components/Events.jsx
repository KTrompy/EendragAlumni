import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { Avatar } from './Directory.jsx'
import EmptyState from './EmptyState.jsx'
import DateTimePicker from './DateTimePicker.jsx'

const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
const WEEKDAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso)) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return new Date(iso).toLocaleDateString()
}

export default function Events({ session, profile }) {
  const [events, setEvents] = useState([])
  const [myRsvps, setMyRsvps] = useState(new Set())
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
      .select(`
        id, title, description, event_date, location, created_by,
        profiles!events_created_by_fkey ( full_name ),
        rsvps:event_rsvps(count),
        comments:event_comments(count)
      `)
      .order('event_date', { ascending: true })
      .limit(500)
    setEvents(data || [])

    const { data: mine } = await supabase
      .from('event_rsvps')
      .select('event_id')
      .eq('user_id', session.user.id)
    setMyRsvps(new Set((mine || []).map((r) => r.event_id)))
  }

  useEffect(() => {
    load()
    const channel = supabase
      .channel('events')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_rsvps' }, load)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [])

  async function removeEvent(id) {
    if (!confirm('Remove this event?')) return
    await supabase.from('events').delete().eq('id', id)
  }

  async function toggleRsvp(eventId) {
    const going = myRsvps.has(eventId)
    setMyRsvps((prev) => {
      const next = new Set(prev)
      if (going) next.delete(eventId); else next.add(eventId)
      return next
    })
    setEvents((prev) => prev.map((e) => {
      if (e.id !== eventId) return e
      const cur = e.rsvps?.[0]?.count ?? 0
      return { ...e, rsvps: [{ count: cur + (going ? -1 : 1) }] }
    }))

    if (going) {
      await supabase.from('event_rsvps').delete()
        .match({ event_id: eventId, user_id: session.user.id })
    } else {
      const { error } = await supabase.from('event_rsvps')
        .insert({ event_id: eventId, user_id: session.user.id })
      if (error) {
        // Roll back on failure (e.g. not yet approved)
        setMyRsvps((prev) => { const n = new Set(prev); n.delete(eventId); return n })
        setEvents((prev) => prev.map((e) =>
          e.id === eventId ? { ...e, rsvps: [{ count: (e.rsvps?.[0]?.count ?? 1) - 1 }] } : e
        ))
      }
    }
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
              <EventCard
                key={e.id}
                e={e}
                session={session}
                profile={profile}
                iAmGoing={myRsvps.has(e.id)}
                onToggleRsvp={() => toggleRsvp(e.id)}
                onDelete={() => removeEvent(e.id)}
              />
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
          profile={profile}
          myRsvps={myRsvps}
          onToggleRsvp={toggleRsvp}
          onDelete={removeEvent}
        />
      )}
    </section>
  )
}

function EventCard({ e, session, profile, iAmGoing, onToggleRsvp, onDelete }) {
  const [showAttendees, setShowAttendees] = useState(false)
  const [showComments, setShowComments] = useState(false)
  const d = new Date(e.event_date)
  const isPast = d < new Date()
  const rsvpCount = e.rsvps?.[0]?.count ?? 0
  const commentCount = e.comments?.[0]?.count ?? 0
  const canInteract = profile?.approved

  return (
    <li className="event-card" style={isPast ? { opacity: 0.65 } : undefined}>
      <div className="event-date-block" style={isPast ? { background: 'var(--maroon)' } : undefined}>
        <div className="event-date-month">{MONTHS[d.getMonth()]}</div>
        <div className="event-date-day">{d.getDate()}</div>
        <div className="event-date-time">{d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
      </div>
      <div className="event-card-body">
        <h3 className="event-title">
          {e.title}
          {isPast && <span className="job-badge" style={{ background: 'var(--ink-soft)' }}>Past</span>}
        </h3>
        {e.location && <p className="event-location">📍 {e.location}</p>}
        {e.description && <p className="event-desc">{e.description}</p>}
        <p className="event-meta">Posted by {e.profiles?.full_name || 'a member'}</p>

        <div className="event-actions">
          <button
            className={iAmGoing ? 'post-action liked' : 'post-action'}
            onClick={onToggleRsvp}
            disabled={!canInteract}
            title={canInteract ? (iAmGoing ? "Cancel RSVP" : "RSVP — I'm going") : 'RSVP unlocks after approval'}
          >
            <CheckIcon /> {iAmGoing ? "You're going" : "I'm going"}
          </button>
          <button className="post-action" onClick={() => setShowAttendees((s) => !s)}>
            <PeopleIcon /> {rsvpCount} going
          </button>
          <button className="post-action" onClick={() => setShowComments((s) => !s)}>
            <CommentIcon /> {commentCount}
          </button>
        </div>

        {showAttendees && <AttendeeList eventId={e.id} />}
        {showComments && <EventComments eventId={e.id} session={session} profile={profile} />}
      </div>
      {e.created_by === session.user.id && (
        <button className="btn ghost small" onClick={onDelete}>Delete</button>
      )}
    </li>
  )
}

/* ---------- Who's going ---------- */
function AttendeeList({ eventId }) {
  const [attendees, setAttendees] = useState(null) // null = loading

  useEffect(() => {
    let cancelled = false
    supabase
      .from('event_rsvps')
      .select('user_id, profiles!event_rsvps_user_id_fkey ( full_name, avatar_url )')
      .eq('event_id', eventId)
      .then(({ data }) => { if (!cancelled) setAttendees(data || []) })
    return () => { cancelled = true }
  }, [eventId])

  return (
    <div className="attendee-list">
      {attendees === null && <p className="empty small">Loading…</p>}
      {attendees && attendees.length === 0 && <p className="empty small">No one's RSVP'd yet — be the first.</p>}
      {attendees && attendees.length > 0 && (
        <ul className="attendee-avatars">
          {attendees.map((a) => (
            <li key={a.user_id} className="attendee-chip" title={a.profiles?.full_name || 'Alumnus'}>
              <Avatar url={a.profiles?.avatar_url} name={a.profiles?.full_name} size={26} />
              <span>{a.profiles?.full_name || 'Alumnus'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/* ---------- Comments under an event ---------- */
function EventComments({ eventId, session, profile }) {
  const [items, setItems] = useState([])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState(null)
  const canPost = profile?.approved

  async function load() {
    const { data } = await supabase
      .from('event_comments')
      .select('id, content, created_at, author_id, profiles!event_comments_author_id_fkey ( full_name, avatar_url )')
      .eq('event_id', eventId)
      .order('created_at', { ascending: true })
    setItems(data || [])
  }

  useEffect(() => { load() }, [eventId])

  async function send() {
    if (!draft.trim()) return
    setError(null)
    const { error } = await supabase
      .from('event_comments')
      .insert({ event_id: eventId, author_id: session.user.id, content: draft.trim() })
    if (error) {
      setError(error.message.includes('policy')
        ? 'Commenting unlocks once your account is approved.'
        : error.message)
    } else {
      setDraft(''); load()
    }
  }

  async function remove(id) {
    await supabase.from('event_comments').delete().eq('id', id)
    load()
  }

  return (
    <div className="post-comments">
      {items.length === 0 && <p className="empty small">No comments yet.</p>}
      <ul className="comment-list">
        {items.map((c) => (
          <li className="comment" key={c.id}>
            <Avatar url={c.profiles?.avatar_url} name={c.profiles?.full_name} size={30} />
            <div className="comment-body">
              <span className="comment-author">{c.profiles?.full_name || 'Alumnus'}</span>
              <span className="comment-meta">{timeAgo(c.created_at)}</span>
              {c.author_id === session.user.id && (
                <button className="comment-delete" onClick={() => remove(c.id)}>Delete</button>
              )}
              <p className="comment-text">{c.content}</p>
            </div>
          </li>
        ))}
      </ul>
      <div className="comment-form">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder={canPost ? 'Write a comment…' : 'Commenting unlocks after approval'}
          disabled={!canPost}
          maxLength={2000}
        />
        <button className="btn primary small" onClick={send} disabled={!canPost || !draft.trim()}>
          Reply
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
    </div>
  )
}

/* ---------- Calendar grid view ---------- */
function CalendarView({ events, cursorMonth, setCursorMonth, selectedDay, setSelectedDay, session, profile, myRsvps, onToggleRsvp, onDelete }) {
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
              <EventCard
                key={e.id}
                e={e}
                session={session}
                profile={profile}
                iAmGoing={myRsvps.has(e.id)}
                onToggleRsvp={() => onToggleRsvp(e.id)}
                onDelete={() => onDelete(e.id)}
              />
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

/* ---------- Icons ---------- */
function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  )
}
function PeopleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}
function CommentIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  )
}
