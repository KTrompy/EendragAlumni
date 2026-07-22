import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { Avatar } from './Directory.jsx'
import EmptyState from './EmptyState.jsx'
import LoadingState from './LoadingState.jsx'
import { buildIcebreaker } from '../icebreaker.js'
import { normalizeExpertise } from '../utils.js'

const POSTER_FIELDS =
  'id, full_name, avatar_url, grad_year, degree, industry, occupation, company, city, country, ' +
  'is_current_resident, linkedin_url, bio, expertise, services_offered, business_website, ' +
  'availability, geographic_focus, is_open_to_opportunities'

const TABS = [
  { id: 'find', label: 'Find a Mentor' },
  { id: 'settings', label: 'Settings' },
]

export default function Mentoring({ session, profile, onMessage }) {
  const [params, setParams] = useSearchParams()
  const tab = TABS.find((t) => t.id === params.get('tab'))?.id || 'find'
  const [mentors, setMentors] = useState([])
  const [loading, setLoading] = useState(true)
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
    const { data: mentorProfiles } = await supabase
      .from('profiles')
      .select(POSTER_FIELDS)
      .eq('is_open_to_opportunities', true)
      .neq('id', session.user.id)

    setMentors(mentorProfiles || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [session.user.id])

  return (
    <section className="panel">
      <h2 className="panel-title">Mentoring</h2>
      <p className="panel-sub">Flash mentoring — anyone open to mentoring shows up here, ready to connect.</p>

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
              mentors={mentors}
              onOpenProfile={goToProfile}
              onMessage={onMessage}
              profile={profile}
            />
          )}
          {tab === 'settings' && (
            <SettingsTab profile={profile} />
          )}
        </>
      )}
    </section>
  )
}

/* ============================================================
   Find a Mentor — with search, industry filter, card layout
   ============================================================ */
function FindMentorTab({ mentors, onOpenProfile, onMessage, profile }) {
  const [search, setSearch] = useState('')
  const [industryFilter, setIndustryFilter] = useState('')

  const mentorIndustries = useMemo(() => {
    const set = new Set()
    mentors.forEach((m) => { if (m.industry) set.add(m.industry) })
    return [...set].sort()
  }, [mentors])

  const filtered = useMemo(() => {
    let list = mentors
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter((p) => (
        (p.full_name || '').toLowerCase().includes(q) ||
        (p.occupation || '').toLowerCase().includes(q) ||
        (p.company || '').toLowerCase().includes(q) ||
        (p.industry || '').toLowerCase().includes(q) ||
        (normalizeExpertise(p.expertise) || []).some((e) => e.toLowerCase().includes(q)) ||
        (p.bio || '').toLowerCase().includes(q)
      ))
    }
    if (industryFilter) {
      list = list.filter((p) => p.industry === industryFilter)
    }
    return list
  }, [mentors, search, industryFilter])

  if (mentors.length === 0) {
    return <EmptyState icon="groups" message="No mentors available right now." subMessage='People show up here as soon as they toggle "Open to mentoring and other opportunities" on their profile.' />
  }

  return (
    <div className="mentoring-find">
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
        </div>
      </div>

      <p className="result-count">{filtered.length} {filtered.length === 1 ? 'mentor' : 'mentors'}{(search || industryFilter) ? ' found' : ' available'}</p>

      {filtered.length === 0 ? (
        <EmptyState icon="groups" message="No mentors match your filters." subMessage="Try broadening your search." />
      ) : (
        <div className="mentor-card-grid">
          {filtered.map((person) => {
            const expertise = normalizeExpertise(person.expertise)
            const roleLine = person.occupation && person.company ? `${person.occupation} @ ${person.company}` : (person.occupation || person.company || '')

            return (
              <div key={person.id} className="mentor-card" role="button" tabIndex={0} onClick={() => onOpenProfile(person)} onKeyDown={(e) => { if (e.key === 'Enter') onOpenProfile(person) }}>
                <div className="mentor-card-top">
                  <Avatar url={person.avatar_url} name={person.full_name} size={56} />
                  <div className="mentor-card-identity">
                    <span className="mentor-card-name">{person.full_name}</span>
                    {roleLine && <span className="mentor-card-role">{roleLine}</span>}
                    {person.industry && <span className="mentor-card-industry">{person.industry}</span>}
                  </div>
                </div>

                {person.bio && <p className="mentor-card-bio">{person.bio}</p>}

                {expertise.length > 0 && (
                  <div className="mentor-card-tags">
                    {expertise.slice(0, 4).map((e) => <span key={e} className="mentor-tag">{e}</span>)}
                    {expertise.length > 4 && <span className="mentor-tag mentor-tag-more">+{expertise.length - 4}</span>}
                  </div>
                )}

                {person.grad_year && <span className="mentor-card-grad">Class of {person.grad_year}</span>}

                <div className="mentor-card-footer">
                  <div className="mentor-card-actions" onClick={(e) => e.stopPropagation()}>
                    <button className="header-icon-btn mentor-message-btn" onClick={() => onMessage?.({ id: person.id, full_name: person.full_name }, buildIcebreaker(profile, person))} aria-label="Message" title="Message">
                      <MessageIcon />
                    </button>
                    {person.linkedin_url && (
                      <a href={person.linkedin_url} target="_blank" rel="noopener noreferrer" className="header-icon-btn mentor-linkedin-btn" aria-label="LinkedIn" title="LinkedIn">
                        <LinkedInIcon />
                      </a>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ---------- Settings ---------- */
function SettingsTab({ profile }) {
  const navigate = useNavigate()
  const canMentor = !!profile?.is_open_to_opportunities

  return (
    <div className="mentoring-settings">
      <div className="settings-card">
        <h3>Mentor availability</h3>
        <p>
          {canMentor
            ? 'Your profile is open to mentoring, so you show up under Find a Mentor.'
            : 'Your profile isn\'t showing up under Find a Mentor yet — set "Open to mentoring and other opportunities" to yes on your profile.'}
        </p>
        <button className="btn ghost small" onClick={() => navigate('/profile')}>Edit on your profile</button>
      </div>
    </div>
  )
}

/* ---------- Icons ---------- */
function SearchIcon() {
  return (
    <svg className="mentoring-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

function MessageIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}

function LinkedInIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="currentColor">
      <path d="M4.98 3.5C4.98 4.88 3.87 6 2.5 6S0 4.88 0 3.5 1.13 1 2.5 1s2.48 1.13 2.48 2.5zM.24 8h4.52v14H.24V8zm7.5 0h4.34v1.92h.06c.6-1.14 2.07-2.34 4.26-2.34 4.56 0 5.4 3 5.4 6.9V22h-4.52v-6.14c0-1.46-.02-3.34-2.04-3.34-2.04 0-2.36 1.6-2.36 3.24V22H7.74V8z"/>
    </svg>
  )
}
