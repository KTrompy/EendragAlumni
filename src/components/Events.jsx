import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'

const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']

export default function Events({ session, profile }) {
  const [events, setEvents] = useState([])
  const [showForm, setShowForm] = useState(false)

  async function load() {
    // Upcoming first, then most recent past
    const nowIso = new Date().toISOString()
    const { data: upcoming } = await supabase
      .from('events')
      .select('id, title, description, event_date, location, created_by, profiles ( full_name )')
      .gte('event_date', nowIso)
      .order('event_date', { ascending: true })
    const { data: past } = await supabase
      .from('events')
      .select('id, title, description, event_date, location, created_by, profiles ( full_name )')
      .lt('event_date', nowIso)
      .order('event_date', { ascending: false })
      .limit(20)
    setEvents([...(upcoming || []), ...(past || [])])
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

  return (
    <section className="panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 className="panel-title">Events</h2>
          <p className="panel-sub">Reunions, golf days, house drinks. See you there.</p>
        </div>
        {canPost && !showForm && (
          <button className="btn primary" onClick={() => setShowForm(true)}>Add event</button>
        )}
      </div>

      {showForm && (
        <EventForm
          session={session}
          onCancel={() => setShowForm(false)}
          onCreated={() => { setShowForm(false); load() }}
        />
      )}

      {events.length === 0 && (
        <p className="empty">No events on the calendar yet.</p>
      )}

      <ul className="event-list">
        {events.map((e) => {
          const d = new Date(e.event_date)
          const isPast = d < new Date()
          return (
            <li className="event-card" key={e.id} style={isPast ? { opacity: 0.65 } : undefined}>
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
                <button className="btn ghost small" onClick={() => removeEvent(e.id)}>Delete</button>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function EventForm({ session, onCancel, onCreated }) {
  const [title, setTitle] = useState('')
  const [date, setDate] = useState('')
  const [location, setLocation] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function submit() {
    if (!title.trim() || !date) { setError('Title and date are required.'); return }
    setBusy(true); setError(null)
    const { error } = await supabase.from('events').insert({
      title: title.trim(),
      event_date: new Date(date).toISOString(),
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
          <input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="field"><span>Location</span>
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Eendrag, Stellenbosch" />
        </label>
      </div>
      <label className="field"><span>Description</span>
        <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What's happening, RSVP details, cost…" />
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
