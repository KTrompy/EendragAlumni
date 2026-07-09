import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { Avatar } from './Directory.jsx'
import EmptyState from './EmptyState.jsx'
import LoadingState from './LoadingState.jsx'
import DeleteButton from './DeleteButton.jsx'
import DateTimePicker from './DateTimePicker.jsx'
import { useToast } from './Toast.jsx'
import { eventIcebreaker } from '../icebreaker.js'

const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
const WEEKDAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
const PAGE_SIZE = 20

const EVENTS_SELECT = `
  id, title, description, event_date, location, created_by,
  profiles!events_created_by_fkey ( full_name ),
  rsvps:event_rsvps(count),
  comments:event_comments(count)
`

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

function eventMatches(e, needle) {
  return (
    (e.title || '').toLowerCase().includes(needle)
    || (e.description || '').toLowerCase().includes(needle)
    || (e.location || '').toLowerCase().includes(needle)
    || (e.profiles?.full_name || '').toLowerCase().includes(needle)
  )
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
  const [hasMoreUpcoming, setHasMoreUpcoming] = useState(true)
  const [hasMorePast, setHasMorePast] = useState(true)
  const [loadingMoreUpcoming, setLoadingMoreUpcoming] = useState(false)
  const [loadingMorePast, setLoadingMorePast] = useState(false)
  const [query, setQuery] = useState('')
  const [savedIds, setSavedIds] = useState(new Set())
  const [savedOnly, setSavedOnly] = useState(false)
  const [savedEvents, setSavedEvents] = useState([])
  const [savedLoading, setSavedLoading] = useState(false)
  const scrolledRef = useRef(false)
  const showToast = useToast()
  // How many upcoming/past rows we've fetched so far — tracked separately
  // from `events.length` so a realtime insert from someone else (which
  // splices into the merged array) can't throw off the next page's offset.
  const upcomingOffsetRef = useRef(0)
  const pastOffsetRef = useRef(0)

  async function loadSavedIds() {
    const { data } = await supabase.from('saved_events').select('event_id').eq('user_id', session.user.id)
    setSavedIds(new Set((data || []).map((r) => r.event_id)))
  }

  // Same reasoning as Jobs' "Saved" tab — a direct query against whatever's
  // bookmarked, not a filter over whatever page happens to be loaded.
  useEffect(() => {
    if (!savedOnly) return
    if (savedIds.size === 0) { setSavedEvents([]); return }
    let cancelled = false
    setSavedLoading(true)
    supabase
      .from('events')
      .select(EVENTS_SELECT)
      .in('id', [...savedIds])
      .order('event_date', { ascending: true })
      .then(({ data }) => { if (!cancelled) { setSavedEvents(data || []); setSavedLoading(false) } })
    return () => { cancelled = true }
  }, [savedOnly, savedIds])

  async function toggleSaveEvent(eventId) {
    const isSaved = savedIds.has(eventId)
    setSavedIds((prev) => {
      const next = new Set(prev)
      if (isSaved) next.delete(eventId); else next.add(eventId)
      return next
    })
    const { error } = isSaved
      ? await supabase.from('saved_events').delete().match({ event_id: eventId, user_id: session.user.id })
      : await supabase.from('saved_events').insert({ event_id: eventId, user_id: session.user.id })
    if (error) {
      setSavedIds((prev) => {
        const next = new Set(prev)
        if (isSaved) next.add(eventId); else next.delete(eventId)
        return next
      })
      showToast('Could not update saved events.', { type: 'error' })
    } else {
      showToast(isSaved ? 'Removed from saved' : 'Event saved')
    }
  }

  // Two independent, real paginated feeds — upcoming events ordered soonest
  // first, past events ordered most-recent-first — merged into one `events`
  // array for rendering/RSVP bookkeeping. The old version fetched a single
  // .limit(500) batch ordered oldest-first, which meant a chapter with
  // enough history could quietly push future events out of the fetch
  // entirely; this fixes that as a side effect of adding real pagination.
  async function loadInitial() {
    setLoading(true)
    const nowIso = new Date().toISOString()
    const [{ data: up, error: e1 }, { data: pa, error: e2 }] = await Promise.all([
      supabase.from('events').select(EVENTS_SELECT)
        .gte('event_date', nowIso).order('event_date', { ascending: true }).range(0, PAGE_SIZE - 1),
      supabase.from('events').select(EVENTS_SELECT)
        .lt('event_date', nowIso).order('event_date', { ascending: false }).range(0, PAGE_SIZE - 1),
    ])
    if (e1 || e2) { console.error(e1 || e2); setLoading(false); return }
    upcomingOffsetRef.current = (up || []).length
    pastOffsetRef.current = (pa || []).length
    setEvents([...(up || []), ...(pa || [])])
    setHasMoreUpcoming((up || []).length === PAGE_SIZE)
    setHasMorePast((pa || []).length === PAGE_SIZE)
    setLoading(false)

    const { data: mine } = await supabase
      .from('event_rsvps')
      .select('event_id')
      .eq('user_id', session.user.id)
    setMyRsvps(new Set((mine || []).map((r) => r.event_id)))
  }

  async function loadMoreUpcoming() {
    setLoadingMoreUpcoming(true)
    const nowIso = new Date().toISOString()
    const offset = upcomingOffsetRef.current
    const { data } = await supabase.from('events').select(EVENTS_SELECT)
      .gte('event_date', nowIso).order('event_date', { ascending: true }).range(offset, offset + PAGE_SIZE - 1)
    upcomingOffsetRef.current += (data || []).length
    setEvents((prev) => [...prev, ...(data || [])])
    setHasMoreUpcoming((data || []).length === PAGE_SIZE)
    setLoadingMoreUpcoming(false)
  }

  async function loadMorePast() {
    setLoadingMorePast(true)
    const nowIso = new Date().toISOString()
    const offset = pastOffsetRef.current
    const { data } = await supabase.from('events').select(EVENTS_SELECT)
      .lt('event_date', nowIso).order('event_date', { ascending: false }).range(offset, offset + PAGE_SIZE - 1)
    pastOffsetRef.current += (data || []).length
    setEvents((prev) => [...prev, ...(data || [])])
    setHasMorePast((data || []).length === PAGE_SIZE)
    setLoadingMorePast(false)
  }

  useEffect(() => {
    loadInitial()
    loadSavedIds()
    const channel = supabase
      .channel('events')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, loadInitial)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_rsvps' }, (payload) => {
        // Our own RSVP toggles are already reflected optimistically the
        // instant you click — reloading here too would re-fetch mid-flight
        // and can momentarily stomp your latest click with stale data
        // (the classic "only updates after I leave and come back" bug).
        // Only reload when the change belongs to someone else, so the
        // "X going" counts stay live without fighting your own clicks.
        const affectedUser = payload.new?.user_id || payload.old?.user_id
        if (affectedUser === session.user.id) return
        loadInitial()
      })
      .subscribe()
    return () => supabase.removeChannel(channel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function removeEvent(id) {
    const { error } = await supabase.from('events').delete().eq('id', id)
    if (error) {
      showToast('Could not delete event.', { type: 'error' })
      return
    }
    setEvents((prev) => prev.filter((e) => e.id !== id))
    showToast('Event deleted')
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
          showToast(target ? "Couldn't RSVP." : "Couldn't remove RSVP.", { type: 'error' })
          break
        }
        if (rsvpDesiredRef.current[eventId] === target) {
          // No new clicks arrived while this was in flight — the database
          // now matches the final state, so this is the one moment to
          // confirm it (not on every intermediate click of a fast toggle).
          showToast(target ? "You're going!" : 'RSVP removed')
          break
        }
      }
    } finally {
      rsvpFlightRef.current[eventId] = false
    }
  }

  const canPost = profile?.approved
  const now = new Date()
  const upcoming = events.filter((e) => new Date(e.event_date) >= now)
  const past = events.filter((e) => new Date(e.event_date) < now).reverse()
  const needle = query.trim().toLowerCase()

  // "Saved" replaces the upcoming/past list entirely with a direct query
  // over bookmarked events — see the effect above.
  const allListItems = savedOnly ? savedEvents : [...upcoming, ...past]
  const listItems = needle
    ? allListItems.filter((e) => eventMatches(e, needle))
    : allListItems

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
            {!savedOnly && (
              <button
                role="tab"
                aria-selected={view === 'calendar'}
                className={view === 'calendar' ? 'on' : ''}
                onClick={() => setView('calendar')}
              >
                Calendar
              </button>
            )}
          </div>
          <button
            className={savedOnly ? 'filters-toggle-btn on' : 'filters-toggle-btn'}
            onClick={() => { setSavedOnly((s) => !s); setView('list') }}
            aria-pressed={savedOnly}
          >
            <BookmarkIcon filled={savedOnly} />
            Saved
            {savedIds.size > 0 && <span className="filters-toggle-badge">{savedIds.size}</span>}
          </button>
          {canPost && !showForm && (
            <button className="btn primary" onClick={() => setShowForm(true)}>Add event</button>
          )}
        </div>
      </div>

      {showForm && (
        <EventForm
          session={session}
          onCancel={() => setShowForm(false)}
          onCreated={() => { setShowForm(false); loadInitial(); showToast('Event created') }}
        />
      ) || null}

      {view === 'list' && (events.length > 0 || savedOnly) && (
        <div className="search-wrap events-search-wrap">
          <input
            className="search directory-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search events…"
          />
          {query && (
            <button className="search-clear" onClick={() => setQuery('')} aria-label="Clear search">×</button>
          )}
        </div>
      )}

      {view === 'list' ? (
        <>
          {(loading || (savedOnly && savedLoading)) ? (
            <LoadingState message="Loading events…" />
          ) : allListItems.length === 0 && (
            savedOnly ? (
              <p className="empty small">You haven't saved any events yet — tap the bookmark on one to keep it handy.</p>
            ) : (
              <EmptyState
                icon="events"
                message="No events on the calendar yet."
                subMessage="Post one to get the first reunion rolling."
                actionLabel={canPost && !showForm ? 'Add event' : undefined}
                onAction={() => setShowForm(true)}
              />
            )
          )}

          {!loading && allListItems.length > 0 && listItems.length === 0 && (
            <p className="empty small">No events match "{query}".</p>
          )}

          <ul className="event-list">
            {listItems.map((e) => (
              <EventCard
                key={e.id}
                e={e}
                session={session}
                profile={profile}
                iAmGoing={myRsvps.has(e.id)}
                isSaved={savedIds.has(e.id)}
                onToggleSave={() => toggleSaveEvent(e.id)}
                onToggleRsvp={() => toggleRsvp(e.id)}
                onDelete={() => removeEvent(e.id)}
                onSaved={loadInitial}
                onMessage={onMessage}
                highlighted={String(e.id) === eventId}
              />
            ))}
          </ul>

          {/* Search only filters what's already loaded — hide the pagers
              while searching, same reasoning as Feed/Jobs. Saved is its
              own complete query, so it never has "more" to page in. */}
          {!needle && !savedOnly && (hasMoreUpcoming || hasMorePast) && (
            <div className="load-more-row events-load-more-row">
              {hasMoreUpcoming && (
                <button className="btn ghost" onClick={loadMoreUpcoming} disabled={loadingMoreUpcoming}>
                  {loadingMoreUpcoming ? 'Loading…' : 'Load more upcoming'}
                </button>
              )}
              {hasMorePast && (
                <button className="btn ghost" onClick={loadMorePast} disabled={loadingMorePast}>
                  {loadingMorePast ? 'Loading…' : 'Load more past events'}
                </button>
              )}
            </div>
          )}
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
          savedIds={savedIds}
          onToggleSaveEvent={toggleSaveEvent}
          onToggleRsvp={toggleRsvp}
          onDelete={removeEvent}
          onSaved={loadInitial}
          onMessage={onMessage}
        />
      )}
    </section>
  )
}

function EventCard({ e, session, profile, iAmGoing, isSaved, onToggleSave, onToggleRsvp, onDelete, onSaved, onMessage, highlighted }) {
  const [showAttendees, setShowAttendees] = useState(false)
  const [showComments, setShowComments] = useState(false)
  const [editing, setEditing] = useState(false)
  const [copied, setCopied] = useState(false)
  const showToast = useToast()
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
          onCreated={() => { setEditing(false); onSaved?.(); showToast('Event updated') }}
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
      {onToggleSave && (
        <button
          type="button"
          className={isSaved ? 'event-save-btn saved' : 'event-save-btn'}
          onClick={onToggleSave}
          aria-pressed={isSaved}
          aria-label={isSaved ? 'Remove from saved' : 'Save this event'}
          title={isSaved ? 'Remove from saved' : 'Save this event'}
        >
          <BookmarkIcon filled={isSaved} />
        </button>
      )}
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
          {isMine && (
            <DeleteButton
              onConfirm={onDelete}
              label="Delete event"
              message="This removes the event and everyone's RSVPs. This can't be undone."
              className="post-action delete-danger"
            >
              Delete
            </DeleteButton>
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
                  className="icon-btn-delete small delete-danger"
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
function CalendarView({ events, cursorMonth, setCursorMonth, selectedDay, setSelectedDay, session, profile, myRsvps, savedIds, onToggleSaveEvent, onToggleRsvp, onDelete, onSaved, onMessage }) {
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
                isSaved={savedIds?.has(e.id)}
                onToggleSave={onToggleSaveEvent ? () => onToggleSaveEvent(e.id) : undefined}
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

  // Lock body scroll while the "Add an event" panel floats over its
  // backdrop — same fix as Jobs' "Post a role" panel. Skipped for inline
  // edits, which aren't a floating overlay in the first place.
  useEffect(() => {
    if (isEdit) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prevOverflow }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
function BookmarkIcon({ filled = false }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  )
}
