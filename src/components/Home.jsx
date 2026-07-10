import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { Avatar } from './Directory.jsx'
import { GroupPlaceholderIcon } from './Groups.jsx'
import LoadingState from './LoadingState.jsx'

// Fields checked for the profile-completion bar — the ones that actually
// make a profile useful to other Eendragters (who you are, what you do,
// where you are, how to reach you), not every column on the table.
const COMPLETION_FIELDS = [
  'avatar_url', 'bio', 'occupation', 'company', 'city', 'country',
  'grad_year', 'degree', 'industry', 'linkedin_url',
]

// The mobile-only pill tabs above the two-column layout — same sections
// that sit side-by-side on desktop, just switched one-at-a-time on a small
// screen. Purely a CSS concern (see .home-mobile-tabs / [data-active-mobile-tab]
// in styles.css) — desktop ignores `mobileTab` entirely and shows every
// section at once.
const MOBILE_TABS = [
  { id: 'posts', label: 'Recent feed posts' },
  { id: 'community', label: 'My Community' },
  { id: 'groups', label: 'My Groups' },
  { id: 'events', label: 'Upcoming events' },
]

function completionPercent(profile) {
  if (!profile) return 0
  const filled = COMPLETION_FIELDS.filter((f) => {
    const v = profile[f]
    return v !== null && v !== undefined && String(v).trim() !== ''
  }).length
  return Math.round((filled / COMPLETION_FIELDS.length) * 100)
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

function plainText(html) {
  const div = document.createElement('div')
  div.innerHTML = html || ''
  return div.textContent || ''
}

function truncate(text, max = 140) {
  const t = text.trim()
  return t.length > max ? t.slice(0, max).trim() + '…' : t
}

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso)) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return new Date(iso).toLocaleDateString()
}

function formatEventDate(iso) {
  const d = new Date(iso)
  return {
    month: d.toLocaleDateString(undefined, { month: 'short' }).toUpperCase(),
    day: d.getDate(),
    full: d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
  }
}

export default function Home({ session, profile }) {
  const [recentPosts, setRecentPosts] = useState([])
  const [myGroups, setMyGroups] = useState([])
  const [upcomingEvent, setUpcomingEvent] = useState(null)
  const [badges, setBadges] = useState([])
  const [earnedKeys, setEarnedKeys] = useState(new Set())
  const [community, setCommunity] = useState([])
  const [showBadges, setShowBadges] = useState(false)
  const [mobileTab, setMobileTab] = useState('posts')
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()
  const pct = completionPercent(profile)
  const firstName = (profile?.full_name || '').trim().split(' ')[0] || 'there'

  useEffect(() => {
    async function load() {
      setLoading(true)
      const uid = session.user.id

      // Suggested connections for "My Community — Strengthen Your Network":
      // other approved members who share a grad year, industry or city with
      // this profile. Falls back to recently-joined members if the profile
      // doesn't have enough filled in to match on, so the widget is never
      // empty for a sparse profile.
      const communityFilters = []
      if (profile?.grad_year) communityFilters.push(`grad_year.eq.${profile.grad_year}`)
      if (profile?.industry) communityFilters.push(`industry.eq.${profile.industry}`)
      if (profile?.city) communityFilters.push(`city.eq.${profile.city}`)

      const [
        { data: posts },
        { data: memberships },
        { data: events },
        { data: badgeDefs },
        { count: postsCount },
        { count: rsvpCount },
        { count: photosCount },
        { count: mentoringCount },
        { data: matchedCommunity },
      ] = await Promise.all([
        supabase
          .from('posts')
          .select('id, title, content, image_urls, pinned, created_at, profiles!posts_author_id_fkey ( full_name, avatar_url )')
          .order('created_at', { ascending: false })
          .limit(3),
        supabase
          .from('group_members')
          .select('groups ( id, name, cover_image_url )')
          .eq('user_id', uid)
          .order('joined_at', { ascending: false })
          .limit(6),
        supabase
          .from('events')
          .select('id, title, event_date, location')
          .gte('event_date', new Date().toISOString())
          .order('event_date', { ascending: true })
          .limit(1),
        supabase.from('badges').select('id, key, name, description').order('sort_order', { ascending: true }),
        supabase.from('posts').select('id', { count: 'exact', head: true }).eq('author_id', uid),
        supabase.from('event_rsvps').select('event_id', { count: 'exact', head: true }).eq('user_id', uid),
        supabase.from('photos').select('id', { count: 'exact', head: true }).eq('uploaded_by', uid),
        supabase.from('mentoring_participants').select('user_id', { count: 'exact', head: true }).eq('user_id', uid),
        communityFilters.length
          ? supabase
              .from('profiles')
              .select('id, full_name, avatar_url, occupation, company')
              .eq('approved', true)
              .neq('id', uid)
              .or(communityFilters.join(','))
              .limit(6)
          : Promise.resolve({ data: [] }),
      ])

      setRecentPosts(posts || [])
      setUpcomingEvent(events?.[0] || null)
      setBadges(badgeDefs || [])

      const groups = (memberships || []).map((m) => m.groups).filter(Boolean)
      const withLatestPost = await Promise.all(groups.map(async (g) => {
        const { data: latest } = await supabase
          .from('group_posts')
          .select('title, content, created_at')
          .eq('group_id', g.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        return { ...g, latestPost: latest || null }
      }))
      setMyGroups(withLatestPost)

      const earned = new Set()
      if (pct === 100) earned.add('profile_complete')
      if ((postsCount || 0) > 0) earned.add('first_post')
      if (groups.length > 0) earned.add('joined_group')
      if ((rsvpCount || 0) > 0) earned.add('event_goer')
      if ((photosCount || 0) > 0) earned.add('photo_sharer')
      if ((mentoringCount || 0) > 0) earned.add('mentor_connect')
      setEarnedKeys(earned)

      let communityList = matchedCommunity || []
      if (communityList.length === 0) {
        const { data: fallback } = await supabase
          .from('profiles')
          .select('id, full_name, avatar_url, occupation, company')
          .eq('approved', true)
          .neq('id', uid)
          .order('created_at', { ascending: false })
          .limit(6)
        communityList = fallback || []
      }
      setCommunity(communityList)

      setLoading(false)
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.user.id])

  if (loading) return <section className="panel"><LoadingState message="Loading your home…" /></section>

  const earnedCount = badges.filter((b) => earnedKeys.has(b.key)).length

  return (
    <section className="panel">
      <div className="home-banner">
        <ProgressRing pct={pct} size={64}>
          <Avatar url={profile?.avatar_url} name={profile?.full_name} size={54} />
        </ProgressRing>
        <div className="home-banner-body">
          <span className="home-banner-pill">{pct}% complete</span>
          <h2 className="home-banner-title">{greeting()}, {firstName}</h2>
        </div>
        <div className="home-banner-actions">
          <div className="home-banner-action">
            <RefreshIcon />
            <span>Complete your missing profile information so other members can easily find you</span>
            <button className="home-banner-link" onClick={() => navigate('/profile')}>UPDATE PROFILE ›</button>
          </div>
          {badges.length > 0 && (
            <div className="home-banner-action">
              <ShieldIcon />
              <span>{earnedCount}/{badges.length} Badges achieved!</span>
              <button className="home-banner-link" onClick={() => setShowBadges(true)}>SEE ALL</button>
            </div>
          )}
          <div className="home-banner-action">
            <ShareIcon />
            <span>Share something!</span>
            <button className="home-banner-link" onClick={() => navigate('/feed', { state: { openComposer: true } })}>Start sharing</button>
          </div>
        </div>
      </div>

      <div className="home-mobile-tabs" role="tablist" aria-label="Home sections">
        {MOBILE_TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={mobileTab === t.id}
            className={mobileTab === t.id ? 'home-mobile-tab active' : 'home-mobile-tab'}
            onClick={() => setMobileTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="feed-layout" data-active-mobile-tab={mobileTab}>
        <div className="feed-main">
          <div className="home-tabsection" data-tab="posts">
            <div className="home-section-head">
              <h3 className="feed-section-label">Recent feed posts</h3>
              <button className="feed-widget-viewall home-more-link" onClick={() => navigate('/feed')}>More posts</button>
            </div>

            {recentPosts.length === 0 ? (
              <p className="empty small">No posts yet — be the first to share something.</p>
            ) : (
              <ul className="home-post-preview-list">
                {recentPosts.map((p) => {
                  const text = p.content && p.content !== '(no text)' ? truncate(plainText(p.content)) : ''
                  const hasMedia = p.image_urls?.length > 0
                  return (
                    <li key={p.id} className="home-post-preview">
                      <Avatar url={p.profiles?.avatar_url} name={p.profiles?.full_name} size={48} />
                      <div className="home-post-preview-body">
                        <div className="home-post-preview-header">
                          <div>
                            <span className="home-post-preview-head">
                              {p.pinned && <PinIcon />}
                              <strong>{p.profiles?.full_name || 'Alumnus'}</strong>
                            </span>
                            <p className="home-post-preview-occupation">{p.profiles?.occupation || 'Member'}</p>
                          </div>
                        </div>
                        {hasMedia && (
                          <button className="home-post-media-row" onClick={() => navigate('/feed')}>
                            <ImageIcon />
                            <span>See all media posted</span>
                            <span className="home-post-media-arrow">›</span>
                          </button>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <div className="home-tabsection" data-tab="groups">
            <div className="home-section-head" style={{ marginTop: 16 }}>
              <h3 className="feed-section-label">My Groups</h3>
              <button className="feed-widget-viewall home-more-link" onClick={() => navigate('/groups')}>See all groups</button>
            </div>

            {myGroups.length === 0 ? (
              <p className="empty small">You haven't joined any groups yet. <button className="home-post-preview-more" onClick={() => navigate('/groups')}>Browse groups</button></p>
            ) : (
              <ul className="home-group-preview-list">
                {myGroups.map((g) => (
                  <li key={g.id} className="home-group-preview" onClick={() => navigate(`/groups/${g.id}`)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/groups/${g.id}`) }}>
                    <div className="group-row-cover home-group-preview-cover">
                      {g.cover_image_url ? <img src={g.cover_image_url} alt="" /> : <GroupPlaceholderIcon />}
                    </div>
                    <div className="home-group-preview-body">
                      <strong>{g.name}</strong>
                      <span>
                        {g.latestPost
                          ? `Recent post: ${truncate(plainText(g.latestPost.content) || g.latestPost.title || '', 80)}`
                          : 'No posts yet'}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <aside className="feed-sidebar">
          <div className="home-tabsection" data-tab="community">
            <div className="feed-widget home-community-widget">
              <div className="home-section-head" style={{ marginBottom: 4 }}>
                <h3 className="feed-section-label" style={{ margin: 0 }}>My Community</h3>
                <button className="feed-widget-viewall home-more-link" onClick={() => navigate('/directory')}>All members</button>
              </div>
              <p className="home-community-sub">Strengthen your network</p>
              {community.length === 0 ? (
                <p className="empty small">No suggestions yet.</p>
              ) : (
                <div className="home-community-grid">
                  {community.map((m) => (
                    <button key={m.id} className="home-community-card" onClick={() => navigate('/directory')} title={[m.occupation, m.company].filter(Boolean).join(' @ ')}>
                      <Avatar url={m.avatar_url} name={m.full_name} size={48} />
                      <span>{(m.full_name || 'Alumnus').split(' ')[0]}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="home-tabsection" data-tab="events">
            {upcomingEvent && (
              <div className="feed-widget home-event-widget" onClick={() => navigate('/events')} role="button" tabIndex={0}>
                <div className="home-event-date">
                  <span>{formatEventDate(upcomingEvent.event_date).month}</span>
                  <strong>{formatEventDate(upcomingEvent.event_date).day}</strong>
                </div>
                <div className="feed-widget-row-text">
                  <span className="feed-section-label" style={{ margin: 0 }}>Upcoming Event</span>
                  <strong>{upcomingEvent.title}</strong>
                  <span>{formatEventDate(upcomingEvent.event_date).full}{upcomingEvent.location ? ` · ${upcomingEvent.location}` : ''}</span>
                </div>
              </div>
            )}
          </div>

          <div className="feed-widget home-donate-card">
            <h3>Lions Help Lions</h3>
            <p>Big or small, make a gift to the cause that resonates with you. Every contribution keeps the house strong.</p>
            <button className="btn primary wide" onClick={() => navigate('/donate')}>Give now</button>
          </div>
        </aside>
      </div>

      {showBadges && (
        <div className="modal-backdrop" onClick={() => setShowBadges(false)} role="dialog" aria-modal="true" aria-labelledby="badges-modal-title">
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 id="badges-modal-title">Your badges — {earnedCount}/{badges.length} achieved</h2>
              <button className="modal-close" onClick={() => setShowBadges(false)} aria-label="Close">×</button>
            </div>
            <div className="modal-body">
              <ul className="badges-grid">
                {badges.map((b) => {
                  const earned = earnedKeys.has(b.key)
                  return (
                    <li key={b.id} className={earned ? 'badge-card earned' : 'badge-card'}>
                      <BadgeIcon earned={earned} />
                      <strong>{b.name}</strong>
                      <span>{b.description}</span>
                    </li>
                  )
                })}
              </ul>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

// Circular completion ring drawn around the avatar (SVG stroke-dasharray),
// in Eendrag's own orange/maroon rather than the reference screenshot's
// green — Kyle chose to keep brand colors here, matching everything else
// (ring shape/position, pill, layout) exactly.
function ProgressRing({ pct, size = 64, strokeWidth = 3, children }) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - Math.min(100, Math.max(0, pct)) / 100)
  const center = size / 2
  return (
    <div className="home-progress-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={center} cy={center} r={radius} fill="none" stroke="var(--line-strong)" strokeWidth={strokeWidth} />
        <circle
          cx={center} cy={center} r={radius} fill="none"
          stroke="var(--orange)" strokeWidth={strokeWidth}
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round" transform={`rotate(-90 ${center} ${center})`}
          style={{ transition: 'stroke-dashoffset 0.4s ease' }}
        />
      </svg>
      <div className="home-progress-ring-inner">{children}</div>
    </div>
  )
}
function RefreshIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--orange-dark)' }}>
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  )
}
function ShieldIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--orange-dark)' }}>
      <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
    </svg>
  )
}
function ShareIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--orange-dark)' }}>
      <path d="M12 16V4" />
      <path d="M8 8l4-4 4 4" />
      <path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
    </svg>
  )
}
function PinIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--orange)' }}>
      <path d="M12 2l1.5 5.5L19 9l-4 3.5L16 18l-4-3-4 3 1-5.5-4-3.5 5.5-1.5z" />
    </svg>
  )
}
function ImageIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--ink-soft)', flexShrink: 0 }}>
      <path d="M4 8a2 2 0 0 1 2-2h1.5l1-1.5h7l1 1.5H18a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  )
}
function BadgeIcon({ earned }) {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill={earned ? 'var(--orange-soft)' : 'none'} stroke={earned ? 'var(--orange-dark)' : 'var(--ink-soft)'} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l2.6 1.5 3-.3.5 3 2.4 1.8-1.3 2.8.9 2.9-2.8 1.3-1.5 2.6-3-.4-2.7 1.5-1.8-2.4-3-.5-.3-3L2.6 11l1.5-2.6L3.7 5.4l3-.5L8.5 2.3z" />
      <circle cx="12" cy="11" r="3" />
    </svg>
  )
}
