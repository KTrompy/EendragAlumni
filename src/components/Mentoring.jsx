import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { Avatar } from './Directory.jsx'
import EmptyState from './EmptyState.jsx'
import LoadingState from './LoadingState.jsx'
import DeleteButton from './DeleteButton.jsx'
import { useToast } from './Toast.jsx'
import { buildIcebreaker } from '../icebreaker.js'
import { normalizeExpertise } from '../utils.js'
import { INDUSTRIES } from '../constants.js'

const POSTER_FIELDS =
  'id, full_name, avatar_url, grad_year, degree, industry, occupation, company, city, country, ' +
  'is_current_resident, linkedin_url, bio, expertise, services_offered, business_website, ' +
  'business_categories, availability, geographic_focus, is_open_to_opportunities'

const TABS = [
  { id: 'find', label: 'Find a Mentor' },
  { id: 'relationships', label: 'My Relationships' },
  { id: 'programs', label: 'Programs' },
  { id: 'settings', label: 'Settings' },
]

function formatDate(d) {
  if (!d) return null
  return new Date(d + 'T00:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

function formatShort(d) {
  if (!d) return ''
  return new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function timeAgo(iso) {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return formatShort(iso.slice(0, 10))
}

function daysSince(iso) {
  if (!iso) return 0
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
}

export default function Mentoring({ session, profile, onMessage }) {
  const [params, setParams] = useSearchParams()
  const tab = TABS.find((t) => t.id === params.get('tab'))?.id || 'find'
  const [programs, setPrograms] = useState([])
  const [participants, setParticipants] = useState([])
  const [myMatches, setMyMatches] = useState([])
  const [goals, setGoals] = useState([])
  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [creatingProgram, setCreatingProgram] = useState(false)
  const showToast = useToast()
  const navigate = useNavigate()

  function goToProfile(person) {
    if (person?.id) navigate(`/people/${person.id}`)
  }

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
      supabase.from('mentoring_participants').select(`program_id, user_id, role, capacity, notes, mentor_bio, profiles!mentoring_participants_user_id_fkey ( ${POSTER_FIELDS} )`),
      supabase.from('mentoring_matches').select('id, program_id, mentor_id, mentee_id, status, requested_by, created_at, responded_at, completion_note')
        .or(`mentor_id.eq.${session.user.id},mentee_id.eq.${session.user.id}`),
    ])

    // Batched match counts
    const programIds = (progs || []).map((p) => p.id)
    let countByProgram = {}
    if (programIds.length > 0) {
      const { data: counts, error: countsErr } = await supabase.rpc('mentoring_match_counts', { pids: programIds })
      if (!countsErr) {
        countByProgram = Object.fromEntries((counts || []).map((c) => [c.program_id, c.cnt]))
      } else {
        const fallback = await Promise.all(programIds.map(async (pid) => {
          const { data: count } = await supabase.rpc('mentoring_match_count', { pid })
          return [pid, count ?? 0]
        }))
        countByProgram = Object.fromEntries(fallback)
      }
    }
    const withCounts = (progs || []).map((p) => ({ ...p, matchCount: countByProgram[p.id] ?? 0 }))

    setPrograms(withCounts)
    setParticipants(parts || [])
    setMyMatches(matches || [])

    // Load goals & notes for my active/completed matches
    const matchIds = (matches || []).map((m) => m.id)
    if (matchIds.length > 0) {
      const [{ data: g }, { data: n }] = await Promise.all([
        supabase.from('mentoring_goals').select('*').in('match_id', matchIds).order('created_at'),
        supabase.from('mentoring_notes').select('*, author:profiles!mentoring_notes_author_id_fkey ( full_name, avatar_url )').in('match_id', matchIds).order('created_at', { ascending: false }),
      ])
      setGoals(g || [])
      setNotes(n || [])
    } else {
      setGoals([])
      setNotes([])
    }

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

  async function joinProgram(programId, role, mentorBio) {
    const row = { program_id: programId, user_id: session.user.id, role }
    if (role === 'mentor' && mentorBio) row.mentor_bio = mentorBio
    const { error } = await supabase.from('mentoring_participants').insert(row)
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

  async function completeMatch(matchId, note) {
    const { error } = await supabase.from('mentoring_matches').update({ status: 'completed', completion_note: note || '', responded_at: new Date().toISOString() }).eq('id', matchId)
    if (error) { showToast('Could not complete relationship.', { type: 'error' }); return }
    showToast('Mentoring relationship completed')
    load()
  }

  async function removeMatch(matchId) {
    await supabase.from('mentoring_matches').delete().eq('id', matchId)
    load()
  }

  // Goals CRUD
  async function addGoal(matchId, title) {
    const { error } = await supabase.from('mentoring_goals').insert({ match_id: matchId, title })
    if (error) { showToast('Could not add goal.', { type: 'error' }); return }
    load()
  }
  async function toggleGoal(goalId, done) {
    await supabase.from('mentoring_goals').update({ done }).eq('id', goalId)
    setGoals((prev) => prev.map((g) => g.id === goalId ? { ...g, done } : g))
  }
  async function deleteGoal(goalId) {
    await supabase.from('mentoring_goals').delete().eq('id', goalId)
    setGoals((prev) => prev.filter((g) => g.id !== goalId))
  }

  // Notes CRUD
  async function addNote(matchId, content, sessionDate) {
    const { error } = await supabase.from('mentoring_notes').insert({ match_id: matchId, author_id: session.user.id, content, session_date: sessionDate || null })
    if (error) { showToast('Could not add note.', { type: 'error' }); return }
    load()
  }
  async function deleteNote(noteId) {
    await supabase.from('mentoring_notes').delete().eq('id', noteId)
    setNotes((prev) => prev.filter((n) => n.id !== noteId))
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
              onOpenProfile={goToProfile}
              onJoinAsMentee={(programId) => joinProgram(programId, 'mentee')}
            />
          )}
          {tab === 'relationships' && (
            <RelationshipsTab
              session={session}
              profile={profile}
              programs={programs}
              matches={myMatches}
              participants={participants}
              goals={goals}
              notes={notes}
              onRespond={respondToMatch}
              onComplete={completeMatch}
              onRemove={removeMatch}
              onOpenProfile={goToProfile}
              onMessage={messageAbout}
              onAddGoal={addGoal}
              onToggleGoal={toggleGoal}
              onDeleteGoal={deleteGoal}
              onAddNote={addNote}
              onDeleteNote={deleteNote}
            />
          )}
          {tab === 'programs' && (
            <ProgramsTab
              session={session}
              programs={programs}
              participants={participants}
              isParticipating={isParticipating}
              onJoin={joinProgram}
              onLeave={leaveProgram}
              onCreate={() => setCreatingProgram(true)}
              onOpenProfile={goToProfile}
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
    </section>
  )
}

/* ============================================================
   Find a Mentor — with search, industry filter, card layout
   ============================================================ */
function FindMentorTab({ session, programs, participants, myMatches, onRequest, onOpenProfile, onJoinAsMentee }) {
  const [search, setSearch] = useState('')
  const [industryFilter, setIndustryFilter] = useState('')
  const [programFilter, setProgramFilter] = useState('')

  const allMentors = useMemo(
    () => participants.filter((p) => p.role === 'mentor' && programs.some((prog) => prog.id === p.program_id) && p.user_id !== session.user.id),
    [participants, programs, session.user.id]
  )

  // Unique industries from mentor profiles
  const mentorIndustries = useMemo(() => {
    const set = new Set()
    allMentors.forEach((m) => { if (m.profiles?.industry) set.add(m.profiles.industry) })
    return [...set].sort()
  }, [allMentors])

  const filtered = useMemo(() => {
    let list = allMentors
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter((m) => {
        const p = m.profiles
        if (!p) return false
        return (
          (p.full_name || '').toLowerCase().includes(q) ||
          (p.occupation || '').toLowerCase().includes(q) ||
          (p.company || '').toLowerCase().includes(q) ||
          (p.industry || '').toLowerCase().includes(q) ||
          (normalizeExpertise(p.expertise) || []).some((e) => e.toLowerCase().includes(q)) ||
          (m.mentor_bio || '').toLowerCase().includes(q)
        )
      })
    }
    if (industryFilter) {
      list = list.filter((m) => m.profiles?.industry === industryFilter)
    }
    if (programFilter) {
      list = list.filter((m) => String(m.program_id) === programFilter)
    }
    return list
  }, [allMentors, search, industryFilter, programFilter])

  if (allMentors.length === 0) {
    return <EmptyState icon="groups" message="No mentors available right now." subMessage="Check back once a program has mentors signed up." />
  }

  return (
    <div className="mentoring-find">
      {/* Search and filter bar */}
      <div className="mentoring-filter-bar">
        <div className="mentoring-search-wrap">
          <SearchIcon />
          <input
            type="text"
            placeholder="Search mentors by name, role, expertise…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="mentoring-search"
          />
          {search && <button className="mentoring-search-clear" onClick={() => setSearch('')} aria-label="Clear search">×</button>}
        </div>
        <div className="mentoring-filter-selects">
          {mentorIndustries.length > 1 && (
            <select value={industryFilter} onChange={(e) => setIndustryFilter(e.target.value)} className="mentoring-filter-select">
              <option value="">All industries</option>
              {mentorIndustries.map((ind) => <option key={ind} value={ind}>{ind}</option>)}
            </select>
          )}
          {programs.length > 1 && (
            <select value={programFilter} onChange={(e) => setProgramFilter(e.target.value)} className="mentoring-filter-select">
              <option value="">All programs</option>
              {programs.map((p) => <option key={p.id} value={String(p.id)}>{p.title}</option>)}
            </select>
          )}
        </div>
      </div>

      <p className="result-count">{filtered.length} {filtered.length === 1 ? 'mentor' : 'mentors'}{(search || industryFilter || programFilter) ? ' found' : ' available'}</p>

      {filtered.length === 0 ? (
        <EmptyState icon="groups" message="No mentors match your filters." subMessage="Try broadening your search." />
      ) : (
        <div className="mentor-card-grid">
          {filtered.map((m) => {
            const person = m.profiles
            if (!person) return null
            const program = programs.find((p) => p.id === m.program_id)
            const existing = myMatches.find((match) => match.mentor_id === person.id && match.program_id === m.program_id && match.mentee_id === session.user.id)
            const amMentee = participants.some((p) => p.program_id === m.program_id && p.user_id === session.user.id && p.role === 'mentee')
            const expertise = normalizeExpertise(person.expertise)
            const roleLine = person.occupation && person.company ? `${person.occupation} @ ${person.company}` : (person.occupation || person.company || '')

            return (
              <div key={`${m.program_id}-${m.user_id}`} className="mentor-card">
                <div className="mentor-card-top" role="button" tabIndex={0} onClick={() => onOpenProfile(person)} onKeyDown={(e) => { if (e.key === 'Enter') onOpenProfile(person) }}>
                  <Avatar url={person.avatar_url} name={person.full_name} size={56} />
                  <div className="mentor-card-identity">
                    <span className="mentor-card-name">{person.full_name}</span>
                    {roleLine && <span className="mentor-card-role">{roleLine}</span>}
                    {person.industry && <span className="mentor-card-industry">{person.industry}</span>}
                  </div>
                </div>

                {m.mentor_bio && <p className="mentor-card-bio">{m.mentor_bio}</p>}

                {expertise.length > 0 && (
                  <div className="mentor-card-tags">
                    {expertise.slice(0, 4).map((e) => <span key={e} className="mentor-tag">{e}</span>)}
                    {expertise.length > 4 && <span className="mentor-tag mentor-tag-more">+{expertise.length - 4}</span>}
                  </div>
                )}

                {person.grad_year && <span className="mentor-card-grad">Class of {person.grad_year}</span>}

                <div className="mentor-card-footer">
                  <span className="mentor-card-program">{program?.title}</span>
                  {existing ? (
                    <span className={`mentoring-status-pill ${existing.status}`}>{statusLabel(existing.status)}</span>
                  ) : amMentee ? (
                    <button className="btn primary small" onClick={(e) => { e.stopPropagation(); onRequest(m.program_id, person.id) }}>Request</button>
                  ) : (
                    <button className="btn ghost small" onClick={(e) => { e.stopPropagation(); onJoinAsMentee(m.program_id) }}>Join to request</button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function statusLabel(s) {
  return { pending: 'Requested', active: 'Connected', declined: 'Declined', completed: 'Completed' }[s] || s
}

/* ============================================================
   Relationships — expandable cards with goals, notes, completion
   ============================================================ */
function RelationshipsTab({ session, profile, programs, matches, participants, goals, notes, onRespond, onComplete, onRemove, onOpenProfile, onMessage, onAddGoal, onToggleGoal, onDeleteGoal, onAddNote, onDeleteNote }) {
  const asMentor = matches.filter((m) => m.mentor_id === session.user.id)
  const asMentee = matches.filter((m) => m.mentee_id === session.user.id)
  const [expanded, setExpanded] = useState(null)
  const [completing, setCompleting] = useState(null) // matchId currently in complete modal

  function personFor(id) {
    return participants.find((p) => p.user_id === id)?.profiles
  }
  function programTitle(id) { return programs.find((p) => p.id === id)?.title || 'Program' }

  function renderRelationship(m, otherRole) {
    const otherId = otherRole === 'mentor' ? m.mentor_id : m.mentee_id
    const person = personFor(otherId)
    if (!person) return null
    const isOpen = expanded === m.id
    const matchGoals = goals.filter((g) => g.match_id === m.id)
    const matchNotes = notes.filter((n) => n.match_id === m.id)
    const daysActive = m.status === 'active' ? daysSince(m.responded_at || m.created_at) : null
    const roleLine = person.occupation && person.company ? `${person.occupation} @ ${person.company}` : (person.occupation || person.company || '')

    return (
      <li key={m.id} className="relationship-card">
        <div className="relationship-card-head">
          <div className="relationship-card-left" role="button" tabIndex={0} onClick={() => onOpenProfile(person)} onKeyDown={(e) => { if (e.key === 'Enter') onOpenProfile(person) }}>
            <Avatar url={person.avatar_url} name={person.full_name} size={48} />
            <div className="relationship-card-info">
              <div className="relationship-card-name-line">
                <span className="person-row-name">{person.full_name}</span>
                <span className={`mentoring-status-pill ${m.status}`}>{statusLabel(m.status)}</span>
              </div>
              <p className="person-row-meta">
                {otherRole === 'mentor' ? 'Your mentor' : 'Your mentee'}
                {roleLine ? ` · ${roleLine}` : ''}
                {daysActive != null ? ` · ${daysActive} days` : ''}
              </p>
              <span className="person-row-affiliation">{programTitle(m.program_id)}</span>
            </div>
          </div>
          <div className="relationship-card-actions" onClick={(e) => e.stopPropagation()}>
            {m.status === 'pending' && otherRole === 'mentee' && (
              <>
                <button className="btn primary small" onClick={() => onRespond(m.id, 'active')}>Accept</button>
                <button className="btn ghost small" onClick={() => onRespond(m.id, 'declined')}>Decline</button>
              </>
            )}
            {m.status === 'pending' && otherRole === 'mentor' && (
              <span className="hint" style={{ fontSize: 12 }}>Waiting for response</span>
            )}
            {m.status === 'active' && (
              <>
                <button className="btn ghost small" onClick={() => onMessage(person, 'mentoring')}>Message</button>
                <button className="btn ghost small" onClick={() => setExpanded(isOpen ? null : m.id)}>{isOpen ? 'Collapse' : 'Details'}</button>
                <button className="btn ghost small" onClick={() => setCompleting(m.id)}>Complete</button>
              </>
            )}
            {m.status === 'completed' && (
              <>
                <button className="btn ghost small" onClick={() => setExpanded(isOpen ? null : m.id)}>Details</button>
                <DeleteButton onConfirm={() => onRemove(m.id)} label="Remove" message="This can't be undone." className="icon-btn-delete post-delete-btn delete-danger" />
              </>
            )}
            {m.status === 'declined' && (
              <DeleteButton onConfirm={() => onRemove(m.id)} label="Remove" message="This can't be undone." className="icon-btn-delete post-delete-btn delete-danger" />
            )}
          </div>
        </div>

        {isOpen && (m.status === 'active' || m.status === 'completed') && (
          <div className="relationship-card-body">
            {m.completion_note && (
              <div className="relationship-completion-note">
                <strong>Completion note:</strong> {m.completion_note}
              </div>
            )}
            <GoalsSection matchId={m.id} goals={matchGoals} isActive={m.status === 'active'} onAdd={onAddGoal} onToggle={onToggleGoal} onDelete={onDeleteGoal} />
            <NotesSection matchId={m.id} notes={matchNotes} isActive={m.status === 'active'} session={session} onAdd={onAddNote} onDelete={onDeleteNote} />
          </div>
        )}
      </li>
    )
  }

  return (
    <div className="mentoring-relationships">
      {/* Pending requests section */}
      {asMentor.filter((m) => m.status === 'pending').length > 0 && (
        <div className="groups-section">
          <h3 className="feed-section-label">Pending requests for you to mentor</h3>
          <ul className="relationship-list">
            {asMentor.filter((m) => m.status === 'pending').map((m) => renderRelationship(m, 'mentee'))}
          </ul>
        </div>
      )}

      {/* Active relationships */}
      <div className="groups-section">
        <h3 className="feed-section-label">Active relationships</h3>
        {(() => {
          const active = [...asMentor, ...asMentee].filter((m) => m.status === 'active')
          if (active.length === 0) return <p className="empty small">No active mentoring relationships yet — find a mentor or wait for requests.</p>
          return (
            <ul className="relationship-list">
              {active.map((m) => renderRelationship(m, m.mentor_id === session.user.id ? 'mentee' : 'mentor'))}
            </ul>
          )
        })()}
      </div>

      {/* Pending outgoing */}
      {asMentee.filter((m) => m.status === 'pending').length > 0 && (
        <div className="groups-section">
          <h3 className="feed-section-label">Your pending requests</h3>
          <ul className="relationship-list">
            {asMentee.filter((m) => m.status === 'pending').map((m) => renderRelationship(m, 'mentor'))}
          </ul>
        </div>
      )}

      {/* Completed */}
      {(() => {
        const completed = [...asMentor, ...asMentee].filter((m) => m.status === 'completed')
        if (completed.length === 0) return null
        return (
          <div className="groups-section">
            <h3 className="feed-section-label">Completed</h3>
            <ul className="relationship-list">
              {completed.map((m) => renderRelationship(m, m.mentor_id === session.user.id ? 'mentee' : 'mentor'))}
            </ul>
          </div>
        )
      })()}

      {/* Declined */}
      {(() => {
        const declined = [...asMentor, ...asMentee].filter((m) => m.status === 'declined')
        if (declined.length === 0) return null
        return (
          <div className="groups-section">
            <h3 className="feed-section-label">Declined</h3>
            <ul className="relationship-list">
              {declined.map((m) => renderRelationship(m, m.mentor_id === session.user.id ? 'mentee' : 'mentor'))}
            </ul>
          </div>
        )
      })()}

      {completing && (
        <CompleteModal matchId={completing} onClose={() => setCompleting(null)} onComplete={onComplete} />
      )}
    </div>
  )
}

/* ---------- Goals section ---------- */
function GoalsSection({ matchId, goals, isActive, onAdd, onToggle, onDelete }) {
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const doneCount = goals.filter((g) => g.done).length
  const progress = goals.length > 0 ? Math.round((doneCount / goals.length) * 100) : 0

  function submit() {
    if (!title.trim()) return
    onAdd(matchId, title.trim())
    setTitle('')
    setAdding(false)
  }

  return (
    <div className="mentoring-goals-section">
      <div className="mentoring-section-header">
        <h4>Goals</h4>
        {goals.length > 0 && (
          <span className="mentoring-progress-label">{doneCount}/{goals.length} done ({progress}%)</span>
        )}
        {isActive && <button className="btn ghost small" onClick={() => setAdding(!adding)}>+ Add</button>}
      </div>

      {goals.length > 0 && (
        <div className="mentoring-progress-bar">
          <div className="mentoring-progress-fill" style={{ width: `${progress}%` }} />
        </div>
      )}

      {adding && (
        <div className="mentoring-inline-form">
          <input
            type="text"
            placeholder="e.g. Prepare CV for review"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
            maxLength={200}
            autoFocus
          />
          <button className="btn primary small" onClick={submit} disabled={!title.trim()}>Add</button>
          <button className="btn ghost small" onClick={() => { setAdding(false); setTitle('') }}>Cancel</button>
        </div>
      )}

      {goals.length === 0 && !adding && (
        <p className="empty small">No goals set yet.{isActive ? ' Add one to track progress together.' : ''}</p>
      )}

      <ul className="mentoring-goal-list">
        {goals.map((g) => (
          <li key={g.id} className={`mentoring-goal-item${g.done ? ' done' : ''}`}>
            <label className="mentoring-goal-check">
              <input type="checkbox" checked={g.done} onChange={() => onToggle(g.id, !g.done)} disabled={!isActive} />
              <span>{g.title}</span>
            </label>
            {isActive && (
              <button className="mentoring-goal-delete" onClick={() => onDelete(g.id)} aria-label="Delete goal">×</button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ---------- Notes/session log section ---------- */
function NotesSection({ matchId, notes, isActive, session, onAdd, onDelete }) {
  const [adding, setAdding] = useState(false)
  const [content, setContent] = useState('')
  const [sessionDate, setSessionDate] = useState('')

  function submit() {
    if (!content.trim()) return
    onAdd(matchId, content.trim(), sessionDate || null)
    setContent('')
    setSessionDate('')
    setAdding(false)
  }

  return (
    <div className="mentoring-notes-section">
      <div className="mentoring-section-header">
        <h4>Session notes</h4>
        <span className="mentoring-progress-label">{notes.length} {notes.length === 1 ? 'entry' : 'entries'}</span>
        {isActive && <button className="btn ghost small" onClick={() => setAdding(!adding)}>+ Add note</button>}
      </div>

      {adding && (
        <div className="mentoring-note-form">
          <textarea
            placeholder="What did you discuss? Any action items?"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={3}
            maxLength={2000}
            autoFocus
          />
          <div className="mentoring-note-form-row">
            <label className="field-inline"><span>Session date</span>
              <input type="date" value={sessionDate} onChange={(e) => setSessionDate(e.target.value)} />
            </label>
            <div className="btn-row">
              <button className="btn primary small" onClick={submit} disabled={!content.trim()}>Save</button>
              <button className="btn ghost small" onClick={() => { setAdding(false); setContent(''); setSessionDate('') }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {notes.length === 0 && !adding && (
        <p className="empty small">No session notes yet.{isActive ? ' Log your meetings and discussions.' : ''}</p>
      )}

      <ul className="mentoring-note-list">
        {notes.map((n) => (
          <li key={n.id} className="mentoring-note-item">
            <div className="mentoring-note-head">
              <Avatar url={n.author?.avatar_url} name={n.author?.full_name || 'Unknown'} size={24} />
              <span className="mentoring-note-author">{n.author?.full_name || 'Unknown'}</span>
              {n.session_date && <span className="mentoring-note-date">{formatShort(n.session_date)}</span>}
              <span className="mentoring-note-time">{timeAgo(n.created_at)}</span>
              {n.author_id === session.user.id && (
                <button className="mentoring-goal-delete" onClick={() => onDelete(n.id)} aria-label="Delete note">×</button>
              )}
            </div>
            <p className="mentoring-note-content">{n.content}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ---------- Complete modal ---------- */
function CompleteModal({ matchId, onClose, onComplete }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    await onComplete(matchId, note.trim())
    setBusy(false)
    onClose()
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="Complete mentoring relationship">
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <h2>Complete this relationship</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          <p style={{ margin: '0 0 12px', color: 'var(--ink-soft)', fontSize: '13.5px' }}>
            Mark this mentoring relationship as completed. You can leave a note about what you achieved or learned together.
          </p>
          <label className="field"><span>Completion note (optional)</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={500} placeholder="What did you get out of this mentoring relationship?" />
          </label>
        </div>
        <div className="modal-footer">
          <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn primary" onClick={submit} disabled={busy}>{busy ? 'Completing…' : 'Mark complete'}</button>
        </div>
      </div>
    </div>
  )
}

/* ============================================================
   Programs — with mentor bio on join
   ============================================================ */
function ProgramsTab({ session, programs, participants, isParticipating, onJoin, onLeave, onCreate, onOpenProfile }) {
  const [expanded, setExpanded] = useState(null)
  const [joiningMentor, setJoiningMentor] = useState(null) // programId — show bio modal

  function handleJoinMentor(programId) {
    setJoiningMentor(programId)
  }

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
                    <button className={amMentor ? 'btn ghost small' : 'btn primary small'} onClick={() => (amMentor ? onLeave(p.id, 'mentor') : handleJoinMentor(p.id))} disabled={p.status === 'closed' && !amMentor}>
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

      {joiningMentor && (
        <JoinAsMentorModal
          programId={joiningMentor}
          onClose={() => setJoiningMentor(null)}
          onJoin={(bio) => { onJoin(joiningMentor, 'mentor', bio); setJoiningMentor(null) }}
        />
      )}
    </div>
  )
}

function JoinAsMentorModal({ programId, onClose, onJoin }) {
  const [bio, setBio] = useState('')

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="Join as mentor">
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <h2>Join as a mentor</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          <p style={{ margin: '0 0 12px', color: 'var(--ink-soft)', fontSize: '13.5px' }}>
            Tell potential mentees what you can help with. This shows on your mentor card so they can find the right fit.
          </p>
          <label className="field"><span>Mentor intro (optional)</span>
            <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={3} maxLength={300} placeholder="e.g. I can help with career transitions into tech, CV reviews, and interview prep." />
          </label>
        </div>
        <div className="modal-footer">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={() => onJoin(bio.trim())}>Join program</button>
        </div>
      </div>
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

/* ---------- Icons ---------- */
function ChevronDownIcon({ flipped }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: flipped ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s ease', flexShrink: 0 }}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg className="mentoring-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}
