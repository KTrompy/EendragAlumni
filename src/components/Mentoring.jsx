import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { Avatar } from './Directory.jsx'
import EmptyState from './EmptyState.jsx'
import LoadingState from './LoadingState.jsx'
import DeleteButton from './DeleteButton.jsx'
import ProfileModal from './ProfileModal.jsx'
import { useToast } from './Toast.jsx'
import { buildIcebreaker } from '../icebreaker.js'

const POSTER_FIELDS =
  'id, full_name, avatar_url, grad_year, degree, industry, occupation, company, city, country, ' +
  'is_current_resident, linkedin_url, bio, expertise, services_offered, business_website, ' +
  'business_categories, availability, geographic_focus, is_open_to_opportunities'

const TABS = [
  { id: 'find', label: 'Find a Mentor' },
  { id: 'relationships', label: 'Mentoring Relationships' },
  { id: 'programs', label: 'Programs' },
  { id: 'settings', label: 'Settings' },
]

function formatDate(d) {
  if (!d) return null
  return new Date(d + 'T00:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

export default function Mentoring({ session, profile, onMessage }) {
  const [params, setParams] = useSearchParams()
  const tab = TABS.find((t) => t.id === params.get('tab'))?.id || 'find'
  const [programs, setPrograms] = useState([])
  const [participants, setParticipants] = useState([]) // every program's participants (role is public info)
  const [myMatches, setMyMatches] = useState([]) // matches where I'm mentor or mentee
  const [loading, setLoading] = useState(true)
  const [openProfile, setOpenProfile] = useState(null)
  const [creatingProgram, setCreatingProgram] = useState(false)
  const showToast = useToast()

  function setTab(id) {
    const p = new URLSearchParams(params)
    if (id === 'find') p.delete('tab')
    else p.set('tab', id)
    setParams(p, { replace: true })
  }

  async function load() {
    setLoading(true)
    const [{ data: progs }, { data: parts }, { data: matches }] = await Promise.all([
      supabase
        .from('mentoring_programs')
        .select(`id, title, description, owner_id, start_date, end_date, status, owner:profiles!mentoring_programs_owner_id_fkey ( full_name )`)
        .order('start_date', { ascending: false }),
      supabase.from('mentoring_participants').select(`program_id, user_id, role, capacity, notes, profiles!mentoring_participants_user_id_fkey ( ${POSTER_FIELDS} )`),
      supabase.from('mentoring_matches').select('id, program_id, mentor_id, mentee_id, status, requested_by, created_at')
        .or(`mentor_id.eq.${session.user.id},mentee_id.eq.${session.user.id}`),
    ])

    const withCounts = await Promise.all((progs || []).map(async (p) => {
      const { data: count } = await supabase.rpc('mentoring_match_count', { pid: p.id })
      return { ...p, matchCount: count ?? 0 }
    }))

    setPrograms(withCounts)
    setParticipants(parts || [])
    setMyMatches(matches || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [session.user.id])

  const myParticipation = useMemo(
    () => participants.filter((p) => p.user_id === session.user.id),
    [participants, session.user.id]
  )

  function isParticipating(programId, role) {
    return myParticipation.some((p) => p.program_id === programId && p.role === role)
  }

  async function joinProgram(programId, role) {
    const { error } = await supabase.from('mentoring_participants').insert({ program_id: programId, user_id: session.user.id, role })
    if (error) {
      showToast(error.message.includes('policy') ? 'Joining unlocks once your account is approved.' : 'Could not join program.', { type: 'error' })
      return
    }
    showToast(`Joined as a ${role}`)
    load()
  }

  async function leaveProgram(programId, role) {
    const { error } = await supabase.from('mentoring_participants').delete().match({ program_id: programId, user_id: session.user.id, role })
    if (error) { showToast('Could not leave program.', { type: 'error' }); return }
    showToast('Left the program')
    load()
  }

  async function requestMentor(programId, mentorId) {
    const { error } = await supabase.from('mentoring_matches').insert({
      program_id: programId, mentor_id: mentorId, mentee_id: session.user.id, requested_by: session.user.id, status: 'pending',
    })
    if (error) {
      showToast(error.message.includes('duplicate') ? 'You already requested this mentor.' : (error.message.includes('policy') ? "You'll need to join this program as a mentee first." : 'Could not send request.'), { type: 'error' })
      return
    }
    showToast('Mentorship requested')
    load()
  }

  async function respondToMatch(matchId, status) {
    const { error } = await supabase.from('mentoring_matches').update({ status, responded_at: new Date().toISOString() }).eq('id', matchId)
    if (error) { showToast('Could not update request.', { type: 'error' }); return }
    load()
  }

  async function removeMatch(matchId) {
    await supabase.from('mentoring_matches').delete().eq('id', matchId)
    load()
  }

  function messageAbout(person, context) {
    onMessage?.({ id: person.id, full_name: person.full_name }, buildIcebreaker(profile, person) || `Hi! Reaching out about ${context}.`)
  }

  return (
    <section className="panel">
      <h2 className="panel-title">Mentoring</h2>
      <p className="panel-sub">Flash mentoring and structured programs — set alumni and students up for career success.</p>

      <div className="group-tabs mentoring-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'group-tab on' : 'group-tab'} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? <LoadingState message="Loading mentoring…" /> : (
        <>
          {tab === 'find' && (
            <FindMentorTab
              session={session}
              programs={programs.filter((p) => p.status === 'active')}
              participants={participants}
              myMatches={myMatches}
              onRequest={requestMentor}
              onOpenProfile={setOpenProfile}
              onJoinAsMentee={(programId) => joinProgram(programId, 'mentee')}
            />
          )}
          {tab === 'relationships' && (
            <RelationshipsTab
              session={session}
              programs={programs}
              matches={myMatches}
              participants={participants}
              onRespond={respondToMatch}
              onRemove={removeMatch}
              onOpenProfile={setOpenProfile}
              onMessage={messageAbout}
            />
          )}
          {tab === 'programs' && (
            <ProgramsTab
              programs={programs}
              participants={participants}
              isParticipating={isParticipating}
              onJoin={joinProgram}
              onLeave={leaveProgram}
              onCreate={() => setCreatingProgram(true)}
              onOpenProfile={setOpenProfile}
            />
          )}
          {tab === 'settings' && (
            <SettingsTab
              profile={profile}
              myParticipation={myParticipation}
              programs={programs}
              onLeave={leaveProgram}
            />
          )}
        </>
      )}

      {creatingProgram && (
        <CreateProgramModal session={session} onClose={() => setCreatingProgram(false)} onCreated={() => { setCreatingProgram(false); load() }} />
      )}

      {openProfile && (
        <ProfileModal
          person={openProfile}
          isMe={openProfile.id === session.user.id}
          onClose={() => setOpenProfile(null)}
          onMessage={() => { const p = openProfile; setOpenProfile(null); messageAbout(p, 'mentoring') }}
        />
      )}
    </section>
  )
}

/* ---------- Find a Mentor ---------- */
function FindMentorTab({ session, programs, participants, myMatches, onRequest, onOpenProfile, onJoinAsMentee }) {
  const mentors = participants.filter((p) => p.role === 'mentor' && programs.some((prog) => prog.id === p.program_id) && p.user_id !== session.user.id)

  if (mentors.length === 0) {
    return <EmptyState icon="groups" message="No mentors available right now." subMessage="Check back once a program has mentors signed up." />
  }

  return (
    <ul className="person-row-list">
      {mentors.map((m) => {
        const person = m.profiles
        if (!person) return null
        const program = programs.find((p) => p.id === m.program_id)
        const existing = myMatches.find((match) => match.mentor_id === person.id && match.program_id === m.program_id && match.mentee_id === session.user.id)
        const amMentee = participants.some((p) => p.program_id === m.program_id && p.user_id === session.user.id && p.role === 'mentee')
        const roleLine = person.occupation && person.company ? `${person.occupation} @ ${person.company}` : (person.occupation || person.company || '')

        return (
          <li key={`${m.program_id}-${m.user_id}`}>
            <div className="person-row" role="button" tabIndex={0} onClick={() => onOpenProfile(person)} onKeyDown={(e) => { if (e.key === 'Enter') onOpenProfile(person) }}>
              <Avatar url={person.avatar_url} name={person.full_name} size={48} />
              <div className="person-row-info">
                <div className="person-row-name-line">
                  <span className="person-row-name">{person.full_name}</span>
                  <span className="person-row-affiliation">{program?.title}</span>
                </div>
                <p className="person-row-meta">{[roleLine, person.industry].filter(Boolean).join(' · ') || ' '}</p>
              </div>
              <div className="person-row-actions" onClick={(e) => e.stopPropagation()}>
                {existing ? (
                  <span className={`mentoring-status-pill ${existing.status}`}>{statusLabel(existing.status)}</span>
                ) : amMentee ? (
                  <button className="btn primary small" onClick={() => onRequest(m.program_id, person.id)}>Request mentorship</button>
                ) : (
                  <button className="btn ghost small" onClick={() => onJoinAsMentee(m.program_id)}>Join as mentee to request</button>
                )}
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function statusLabel(s) {
  return { pending: 'Requested', active: 'Connected', declined: 'Declined', completed: 'Completed' }[s] || s
}

/* ---------- My Relationships ---------- */
function RelationshipsTab({ session, programs, matches, participants, onRespond, onRemove, onOpenProfile, onMessage }) {
  const asMentor = matches.filter((m) => m.mentor_id === session.user.id)
  const asMentee = matches.filter((m) => m.mentee_id === session.user.id)

  function personFor(id) {
    return participants.find((p) => p.user_id === id)?.profiles
  }
  function programTitle(id) { return programs.find((p) => p.id === id)?.title || 'Program' }

  return (
    <div className="mentoring-relationships">
      <div className="groups-section">
        <h3 className="feed-section-label">Requests for you to mentor</h3>
        {asMentor.length === 0 ? <p className="empty small">No mentee requests yet.</p> : (
          <ul className="person-row-list">
            {asMentor.map((m) => {
              const person = personFor(m.mentee_id)
              if (!person) return null
              return (
                <li key={m.id}>
                  <div className="person-row" role="button" tabIndex={0} onClick={() => onOpenProfile(person)} onKeyDown={(e) => { if (e.key === 'Enter') onOpenProfile(person) }}>
                    <Avatar url={person.avatar_url} name={person.full_name} size={48} />
                    <div className="person-row-info">
                      <div className="person-row-name-line">
                        <span className="person-row-name">{person.full_name}</span>
                        <span className="person-row-affiliation">{programTitle(m.program_id)}</span>
                        <span className={`mentoring-status-pill ${m.status}`}>{statusLabel(m.status)}</span>
                      </div>
                      <p className="person-row-meta">Wants you as their mentor</p>
                    </div>
                    <div className="person-row-actions" onClick={(e) => e.stopPropagation()}>
                      {m.status === 'pending' && (
                        <>
                          <button className="btn primary small" onClick={() => onRespond(m.id, 'active')}>Accept</button>
                          <button className="btn ghost small" onClick={() => onRespond(m.id, 'declined')}>Decline</button>
                        </>
                      )}
                      {m.status === 'active' && (
                        <button className="btn ghost small" onClick={() => onMessage(person, 'mentoring')}>Message</button>
                      )}
                      {(m.status === 'declined' || m.status === 'completed') && (
                        <DeleteButton onConfirm={() => onRemove(m.id)} label="Remove" message="This can't be undone." className="icon-btn-delete post-delete-btn delete-danger" />
                      )}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="groups-section">
        <h3 className="feed-section-label">Your mentors</h3>
        {asMentee.length === 0 ? <p className="empty small">You haven't requested a mentor yet — try "Find a Mentor".</p> : (
          <ul className="person-row-list">
            {asMentee.map((m) => {
              const person = personFor(m.mentor_id)
              if (!person) return null
              return (
                <li key={m.id}>
                  <div className="person-row" role="button" tabIndex={0} onClick={() => onOpenProfile(person)} onKeyDown={(e) => { if (e.key === 'Enter') onOpenProfile(person) }}>
                    <Avatar url={person.avatar_url} name={person.full_name} size={48} />
                    <div className="person-row-info">
                      <div className="person-row-name-line">
                        <span className="person-row-name">{person.full_name}</span>
                        <span className="person-row-affiliation">{programTitle(m.program_id)}</span>
                        <span className={`mentoring-status-pill ${m.status}`}>{statusLabel(m.status)}</span>
                      </div>
                      <p className="person-row-meta">{m.status === 'pending' ? 'Waiting for them to accept' : 'Your mentor'}</p>
                    </div>
                    <div className="person-row-actions" onClick={(e) => e.stopPropagation()}>
                      {m.status === 'active' && (
                        <button className="btn ghost small" onClick={() => onMessage(person, 'mentoring')}>Message</button>
                      )}
                      <DeleteButton onConfirm={() => onRemove(m.id)} label={m.status === 'pending' ? 'Cancel request' : 'Remove'} message="This can't be undone." className="icon-btn-delete post-delete-btn delete-danger" />
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

/* ---------- Programs ---------- */
function ProgramsTab({ programs, participants, isParticipating, onJoin, onLeave, onCreate, onOpenProfile }) {
  const [expanded, setExpanded] = useState(null)

  return (
    <div className="mentoring-programs">
      <div className="panel-header-row" style={{ marginBottom: 14 }}>
        <p className="result-count" style={{ margin: 0 }}>{programs.length} {programs.length === 1 ? 'program' : 'programs'}</p>
        <button className="btn primary" onClick={onCreate}>+ New program</button>
      </div>

      {programs.length === 0 && (
        <EmptyState icon="groups" message="No mentoring programs yet." subMessage="Create the first one to get mentors and mentees signed up." actionLabel="Create a program" onAction={onCreate} />
      )}

      <ul className="program-list">
        {programs.map((p) => {
          const mentorCount = participants.filter((x) => x.program_id === p.id && x.role === 'mentor').length
          const menteeCount = participants.filter((x) => x.program_id === p.id && x.role === 'mentee').length
          const isOpen = expanded === p.id
          const amMentor = isParticipating(p.id, 'mentor')
          const amMentee = isParticipating(p.id, 'mentee')

          return (
            <li key={p.id} className="program-card">
              <button className="program-card-head" onClick={() => setExpanded(isOpen ? null : p.id)}>
                <div>
                  <span className="program-card-title">{p.title}{p.status === 'closed' && <span className="program-closed-tag">Closed</span>}</span>
                  <span className="program-card-owner">Owner: {p.owner?.full_name || 'Unknown'}</span>
                  <span className="program-card-stats">{mentorCount} Mentors · {menteeCount} Mentees · {p.matchCount} Matches</span>
                  {(p.start_date || p.end_date) && (
                    <span className="program-card-dates">
                      Start: {formatDate(p.start_date) || '—'} · End: {formatDate(p.end_date) || '—'}
                    </span>
                  )}
                </div>
                <ChevronDownIcon flipped={isOpen} />
              </button>

              {isOpen && (
                <div className="program-card-body">
                  {p.description && <p className="program-card-desc">{p.description}</p>}
                  <div className="btn-row" style={{ marginBottom: 12 }}>
                    <button className={amMentor ? 'btn ghost small' : 'btn primary small'} onClick={() => (amMentor ? onLeave(p.id, 'mentor') : onJoin(p.id, 'mentor'))} disabled={p.status === 'closed' && !amMentor}>
                      {amMentor ? 'Leave as mentor' : 'Join as mentor'}
                    </button>
                    <button className={amMentee ? 'btn ghost small' : 'btn primary small'} onClick={() => (amMentee ? onLeave(p.id, 'mentee') : onJoin(p.id, 'mentee'))} disabled={p.status === 'closed' && !amMentee}>
                      {amMentee ? 'Leave as mentee' : 'Join as mentee'}
                    </button>
                  </div>
                  <div className="program-participant-columns">
                    <div>
                      <h4>Mentors ({mentorCount})</h4>
                      <MiniPeopleList participants={participants.filter((x) => x.program_id === p.id && x.role === 'mentor')} onOpenProfile={onOpenProfile} />
                    </div>
                    <div>
                      <h4>Mentees ({menteeCount})</h4>
                      <MiniPeopleList participants={participants.filter((x) => x.program_id === p.id && x.role === 'mentee')} onOpenProfile={onOpenProfile} />
                    </div>
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function MiniPeopleList({ participants, onOpenProfile }) {
  if (participants.length === 0) return <p className="empty small">None yet.</p>
  return (
    <ul className="mini-people-list">
      {participants.map((p) => p.profiles && (
        <li key={p.user_id}>
          <button className="mini-people-row" onClick={() => onOpenProfile(p.profiles)}>
            <Avatar url={p.profiles.avatar_url} name={p.profiles.full_name} size={28} />
            <span>{p.profiles.full_name}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function CreateProgramModal({ session, onClose, onCreated }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function submit() {
    if (!title.trim()) { setError('Give the program a name.'); return }
    setBusy(true); setError(null)
    const { error: err } = await supabase.from('mentoring_programs').insert({
      title: title.trim(),
      description: description.trim(),
      owner_id: session.user.id,
      start_date: startDate || null,
      end_date: endDate || null,
    })
    setBusy(false)
    if (err) { setError(err.message.includes('policy') ? 'Creating a program unlocks once your account is approved.' : err.message); return }
    onCreated()
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="Create mentoring program">
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <h2>New mentoring program</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          <label className="field"><span>Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Spring 2026 Mentoring Program" maxLength={100} />
          </label>
          <label className="field"><span>Description</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={500} />
          </label>
          <div className="field-row">
            <label className="field"><span>Start date</span>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </label>
            <label className="field"><span>End date</span>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </label>
          </div>
          {error && <p className="form-error">{error}</p>}
        </div>
        <div className="modal-footer">
          <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn primary" onClick={submit} disabled={busy}>{busy ? 'Creating…' : 'Create program'}</button>
        </div>
      </div>
    </div>
  )
}

/* ---------- Settings ---------- */
function SettingsTab({ profile, myParticipation, programs, onLeave }) {
  const navigate = useNavigate()
  const canMentor = (profile?.services_offered || []).includes('Mentoring/Coaching')

  return (
    <div className="mentoring-settings">
      <div className="settings-card">
        <h3>Mentor availability</h3>
        <p>
          {canMentor
            ? 'Your profile lists "Mentoring/Coaching" under services offered, so you show up as available to mentor.'
            : "Your profile doesn't list mentoring as a service you offer yet — add it so people can find you as a potential mentor."}
        </p>
        <button className="btn ghost small" onClick={() => navigate('/profile')}>Edit on your profile</button>
      </div>

      <div className="groups-section">
        <h3 className="feed-section-label">Your programs</h3>
        {myParticipation.length === 0 ? (
          <p className="empty small">You're not part of any mentoring program yet — see the Programs tab.</p>
        ) : (
          <ul className="mentoring-settings-list">
            {myParticipation.map((p) => {
              const program = programs.find((prog) => prog.id === p.program_id)
              return (
                <li key={`${p.program_id}-${p.role}`} className="mentoring-settings-row">
                  <span><strong>{program?.title || 'Program'}</strong> — {p.role === 'mentor' ? 'Mentor' : 'Mentee'}</span>
                  <button className="btn ghost small" onClick={() => onLeave(p.program_id, p.role)}>Leave</button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

function ChevronDownIcon({ flipped }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: flipped ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s ease', flexShrink: 0 }}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}
