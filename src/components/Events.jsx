import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { Avatar } from './Directory.jsx'
import EmptyState from './EmptyState.jsx'
import LoadingState from './LoadingState.jsx'
import DeleteButton from './DeleteButton.jsx'
import DateTimePicker from './DateTimePicker.jsx'
import { eventIcebreaker } from '../icebreaker.js'

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

export default function Events({ session, profile, onMessage }) {
  const { eventId } = useParams() // set when someone opens a shared /events/:eventId link
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [myRsvps, setMyRsvps] = useState(new Set())
  const [showForm, setShowForm] = useState(false)
  const [view, setView] = useState('list') // 'list' | 'calendar'
  const [cursorMonth, setCursorMonth] = useState(() => {
    const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d
  })
  const [selectedDay, setSelectedDay] = useState(null)
  const scrolledRef = useRef(false)

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
    setLoading(false)

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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_rsvps' }, (payload) => {
        // Our own RSVP toggles are already reflected optimistically the
        // instant you click — reloading here too would re-fetch mid-flight
        // and can momentarily stomp your latest click with stale data
        // (the classic "only updates after I leave and come back" bug).
        // Only reload when the change belongs to someone else, so the
        // "X going" counts stay live without fighting your own clicks.
        const affectedUser = payload.new?.user_id || payload.old?.user_id
        if (affectedUser === session.user.id) return
        load()
      })
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [])

  async function removeEvent(id) {
    await supabase.from('events').delete().eq('id', id)
  }

  // Tracks, per event, whether an insert/delete request is currently in
  // flight and what the most recently clicked state should end up as.
  // Without this, mashing the button fast (going → not going → going)
  // could fire a delete before the insert it's undoing had even committed,
  // so the delete would silently no-op and the RSVP would come back once
  // the insert finally landed — exactly the "only fixes itself after I
  // leave and come back" symptom. Serializing per-event guarantees the
  // database always ends up matching your last click.
  const rsvpFlightRef = useRef({}) // eventId -> boolean (request in flight?)
  const rsvpDesiredRef = useRef({}) // eventId -> boolean (latest known/desired "going" state)

  function applyRsvpUi(eventId, wantGoing, prevGoing) {
    setMyRsvps((prev) => {
      const next = new Set(prev)
      if (wantGoing) next.add(eventId); else next.delete(eventId)
      return next
    })
    if (wantGoing === prevGoing) return
    setEvents((prev) => prev.map((e) => {
      if (e.id !== eventId) return e
      const cur = e.rsvps?.[0]?.count ?? 0
      return { ...e, rsvps: [{ count: Math.max(0, cur + (wantGoing ? 1 : -1)) }] }
    }))
  }

  async function toggleRsvp(eventId) {
    // Once we've started tracking this event's toggle, trust our own ref
    // over the (possibly not-yet-re-rendered) React state — otherwise two
    // clicks in the same tick can both read the same stale "am I going"
    // value and compute the wrong next state.
    const knownGoing = eventId in rsvpDesiredRef.current ? rsvpDesiredRef.current[eventId] : myRsvps.has(eventId)
    const desired = !knownGoing
    applyRsvpUi(eventId, desired, knownGoing) // instant feedback, every single click
    rsvpDesiredRef.current[eventId] = desired

    if (rsvpFlightRef.current[eventId]) return // a request's already running; it'll pick up this new desired state when it finishes
    rsvpFlightRef.current[eventId] = true

    try {
      // Keep sending requests until the database matches whatever the
      // user's most recent click asked for. Without this loop, mashing the
      // button fast (going → not going → going) could fire a delete before
      // the insert it's undoing had even committed — the delete would
      // silently no-op, and the RSVP would reappear once the insert finally
      // landed, which looked like "it only updates after I leave and come
      // back."
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const target = rsvpDesiredRef.current[eventId]
        const { error } = target
          ? await supabase.from('event_rsvps').insert({ event_id: eventId, user_id: session.user.id })
          : await supabase.from('event_rsvps').delete().match({ event_id: eventId, user_id: session.user.id })

        if (error) {
          // Roll back to whatever the server actually has (e.g. not yet approved)
          applyRsvpUi(eventId, !target, target)
          rsvpDesiredRef.current[eventId] = !target
          break
        }
        if (rsvpDesiredRef.current[eventId] === target) break // no new clicks arrived while this was in flight
      }
    } finally {
      rsvpFlightRef.current[eventId] = false
    }
  }

  const canPost = profile?.approved
  const now = new Date()
  const upcoming = events.filter((e) => new Date(e.event_date) >= now)
  const past = events.filter((e) => new Date(e.event_date) < now).reverse()
  const listItems = [...upcoming, ...past]

  // A shared /events/:id link should land you on that event, scrolled into
  // view, rather than the top of a long list — otherwise a bookmarkable URL
  // wouldn't actually save anyone the scrolling it's meant to save.
  useEffect(() => {
    if (!eventId || loading || scrolledRef.current) return
    const el = document.getElementById(`event-${eventId}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      scrolledRef.current = true
    }
  }, [eventId, loading, events])

  return (
    <section className="panel">
      <div className="panel-header-row">
        <div>
          <h2 className="panel-title">Events</h2>
          <p className="panel-sub">Reunions, golf days, house drinks. See you there.</p>
        </div>
        <div className="events-header-actions">
          <div className="view-switch" role="tablist" aria-label="Events view">
            <button
              role="tab"
              aria-selected={view === 'list'}
              className={view === 'list' ? 'on' : ''}
              onClick={() => setView('list')}
            >
              List
            </button>
            <button
              role="tab"
              aria-selected={view === 'calendar'}
              className={view === 'calendar' ? 'on' : ''}
              onClick={() => setView('calendar')}
            >
              Calendar
            </button>
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
      ) || null}

      {view === 'list' ? (
        <>
          {loading ? (
            <LoadingState message="Loading events…" />
          ) : listItems.length === 0 && (
            <EmptyState
              icon="events"
              message="No events on the calendar yet."
              subMessage="Post one to get the first reunion rolling."
              actionLabel={canPost && !showForm ? 'Add event' : undefined}
              onAction={() => setShowForm(true)}
            />
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
                onSaved={load}
                onMessage={onMessage}
                highlighted={String(e.id) === eventId}
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
          onSaved={load}
          onMessage={onMessage}
        />
      )}
    </section>
  )
}

function EventCard({ e, session, profile, iAmGoing, onToggleRsvp, onDelete, onSaved, onMessage, highlighted }) {
  const [showAttendees, setShowAttendees] = useState(false)
  const [showComments, setShowComments] = useState(false)
  const [editing, setEditing] = useState(false)
  const [copied, setCopied] = useState(false)
  const d = new Date(e.event_date)
  const isPast = d < new Date()
  const rsvpCount = e.rsvps?.[0]?.count ?? 0
  const commentCount = e.comments?.[0]?.count ?? 0
  const canInteract = profile?.approved
  const isMine = e.created_by === session.user.id

  // The moment you RSVP "I'm going", show who else is — turning a passive
  // RSVP into an actual connection point instead of something you'd only
  // see if you happened to tap "N going" afterward.
  const wasGoingRef = useRef(iAmGoing)
  useEffect(() => {
    if (!wasGoingRef.current && iAmGoing) setShowAttendees(true)
    wasGoingRef.current = iAmGoing
  }, [iAmGoing])

  async function copyLink() {
    const url = `${window.location.origin}/events/${e.id}`
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard API unavailable — button just won't confirm.
    }
  }

  if (editing) {
    return (
      <li className="event-card" id={`event-${e.id}`}>
        <EventForm
          session={session}
          initial={e}
          onCancel={() => setEditing(false)}
          onCreated={() => { setEditing(false); onSaved?.() }}
        />
      </li>
    )
  }

  return (
    <li
      className={highlighted ? 'event-card event-card-highlighted' : 'event-card'}
      id={`event-${e.id}`}
      style={isPast ? { opacity: 0.65 } : undefined}
    >
      <div className="event-date-block" style={isPast ? { background: 'var(--maroon)' } : undefined}>
        <div className="event-date-month">{MONTHS[d.getMonth()]}</div>
        <div className="event-date-day">{d.getDate()}</div>
        <div className="event-date-time">{d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
      </div>
      <div className="event-card-body">
        <h3 className="event-title">
          {e.title}
          {isPast && <span className="job-badge" style={{ background: 'var(--ink-soft)' }}>Past</span>}
          {e.updated_at && <span className="edited-tag">edited</span>}
        </h3>
        {e.location && <p className="event-location">📍 {e.location}</p>}
        {e.description && <p className="event-desc">{e.description.trimEnd()}</p>}
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
          <button className="post-action" onClick={copyLink} title="Copy a link to this event">
            <LinkIcon /> {copied ? 'Copied!' : 'Share'}
          </button>
          {isMine && (
            <button className="post-action" onClick={() => setEditing(true)} title="Edit event">
              <EditIcon /> Edit
            </button>
          )}
        </div>

        {showAttendees && (
          <AttendeeList
            eventId={e.id}
            eventTitle={e.title}
            session={session}
            profile={profile}
            iAmGoing={iAmGoing}
            onMessage={onMessage}
          />
        )}
        {showComments && <EventComments eventId={e.id} session={session} profile={profile} />}
      </div>
      {isMine && (
        <DeleteButton
          onConfirm={onDelete}
          label="Delete event"
          message="This removes the event and everyone's RSVPs. This can't be undone."
        />
      )}
    </li>
  )
}

/* ---------- Who's going ---------- */
function AttendeeList({ eventId, eventTitle, session, profile, iAmGoing, onMessage }) {
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

  // Keep this list in sync with your own "I'm going" toggle the instant you
  // click it — this list is fetched once when you open it, so without this
  // it would only catch up the next time you closed and reopened it.
  useEffect(() => {
    setAttendees((prev) => {
      if (prev === null) return prev // initial fetch hasn't landed yet
      const alreadyListed = prev.some((a) => a.user_id === session.user.id)
      if (iAmGoing && !alreadyListed) {
        return [...prev, {
          user_id: session.user.id,
          profiles: { full_name: profile?.full_name, avatar_url: profile?.avatar_url },
        }]
      }
      if (!iAmGoing && alreadyListed) {
        return prev.filter((a) => a.user_id !== session.user.id)
      }
      return prev
    })
  }, [iAmGoing, session.user.id, profile?.full_name, profile?.avatar_url])

  const others = (attendees || []).filter((a) => a.user_id !== session.user.id)

  return (
    <div className="attendee-list">
      {attendees === null && <p className="empty small">Loading…</p>}
      {attendees && attendees.length === 0 && <p className="empty small">No one's RSVP'd yet — be the first.</p>}
      {/* Turns the RSVP from a passive checkbox into a reason to say hi —
          surfaced right where you just saw who else is going. */}
      {iAmGoing && others.length > 0 && (
        <p className="attendee-going-note">
          {others.length} other{others.length === 1 ? '' : 's'} going too — say hi below.
        </p>
      )}
      {attendees && attendees.length > 0 && (
        <ul className="attendee-avatars">
          {attendees.map((a) => {
            const isMe = a.user_id === session.user.id
            return (
              <li key={a.user_id} className="attendee-chip" title={a.profiles?.full_name || 'Alumnus'}>
                <Avatar url={a.profiles?.avatar_url} name={a.profiles?.full_name} size={26} />
                <span>{isMe ? 'You' : (a.profiles?.full_name || 'Alumnus')}</span>
                {!isMe && onMessage && (
                  <button
                    className="attendee-message"
                    onClick={() => onMessage(
                      { id: a.user_id, full_name: a.profiles?.full_name },
                      eventIcebreaker(a.profiles, eventTitle)
                    )}
                    aria-label={`Message ${a.profiles?.full_name || 'this Eendragter'}`}
                    title="See you there!"
                  >
                    <EnvelopeIcon />
                  </button>
                )}
              </li>
            )
          })}
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
                <DeleteButton
                  onConfirm={() => remove(c.id)}
                  label="Delete comment"
                  message="This can't be undone."
                  className="icon-btn-delete small"
                />
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
function CalendarView({ events, cursorMonth, setCursorMonth, selectedDay, setSelectedDay, session, profile, myRsvps, onToggleRsvp, onDelete, onSaved, onMessage }) {
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
      <div className="calendar-shell">
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
                onSaved={onSaved}
                onMessage={onMessage}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function EventForm({ session, onCancel, onCreated, initial = null }) {
  const isEdit = !!initial
  const [title, setTitle] = useState(initial?.title || '')
  const [date, setDate] = useState(initial ? new Date(initial.event_date) : null)
  const [location, setLocation] = useState(initial?.location || '')
  const [description, setDescription] = useState(initial?.description || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [isClosing, setIsClosing] = useState(false)

  function handleCancel() {
    setIsClosing(true)
    setTimeout(onCancel, 200)
  }

  async function submit() {
    if (!title.trim() || !date) { setError('Title and date are required.'); return }
    setBusy(true); setError(null)
    const payload = {
      title: title.trim(),
      event_date: date.toISOString(),
      location: location.trim(),
      description: description.trim(),
    }
    const { error } = isEdit
      ? await supabase.from('events').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', initial.id)
      : await supabase.from('events').insert({ ...payload, created_by: session.user.id })
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
    <div className={isEdit ? '' : `create-panel-backdrop ${isClosing ? 'closing' : ''}`} onClick={isEdit ? undefined : (e) => e.target === e.currentTarget && handleCancel()}>
      <div className={isEdit ? 'create-panel inline' : `create-panel ${isClosing ? 'closing' : ''}`}>
        <h3>{isEdit ? 'Edit event' : 'Add an event'}</h3>
        <div className="create-panel-content">
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
        </div>
        <div className="btn-row">
          <button className="btn ghost" onClick={handleCancel} disabled={isClosing}>Cancel</button>
          <button className="btn primary" onClick={submit} disabled={busy}>
            {busy ? 'Saving…' : (isEdit ? 'Save changes' : 'Post event')}
          </button>
        </div>
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
function EnvelopeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </svg>
  )
}
function LinkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  )
}
function EditIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  )
}
