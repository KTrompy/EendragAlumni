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
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()
  const pct = completionPercent(profile)
  const firstName = (profile?.full_name || '').trim().split(' ')[0] || 'there'

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [{ data: posts }, { data: memberships }, { data: events }] = await Promise.all([
        supabase
          .from('posts')
          .select('id, title, content, image_urls, pinned, created_at, profiles!posts_author_id_fkey ( full_name, avatar_url )')
          .order('created_at', { ascending: false })
          .limit(3),
        supabase
          .from('group_members')
          .select('groups ( id, name, cover_image_url )')
          .eq('user_id', session.user.id)
          .order('joined_at', { ascending: false })
          .limit(6),
        supabase
          .from('events')
          .select('id, title, event_date, location')
          .gte('event_date', new Date().toISOString())
          .order('event_date', { ascending: true })
          .limit(1),
      ])
      setRecentPosts(posts || [])
      setUpcomingEvent(events?.[0] || null)

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
      setLoading(false)
    }
    load()
  }, [session.user.id])

  if (loading) return <section className="panel"><LoadingState message="Loading your home…" /></section>

  return (
    <section className="panel">
      <div className="home-banner">
        <Avatar url={profile?.avatar_url} name={profile?.full_name} size={56} />
        <div className="home-banner-body">
          <div className="home-banner-progress">
            <span className="home-banner-pct">{pct}% complete</span>
            <div className="home-progress-track"><div className="home-progress-fill" style={{ width: `${pct}%` }} /></div>
          </div>
          <h2 className="home-banner-title">{greeting()}, {firstName}</h2>
        </div>
        <div className="home-banner-actions">
          <div className="home-banner-action">
            <span>Complete your missing profile information so other members can easily find you</span>
            <button className="home-banner-link" onClick={() => navigate('/profile')}>Update profile ›</button>
          </div>
          <div className="home-banner-action">
            <span>Share something with the house</span>
            <button className="home-banner-link" onClick={() => navigate('/feed', { state: { openComposer: true } })}>Start sharing ›</button>
          </div>
        </div>
      </div>

      <div className="feed-layout">
        <div className="feed-main">
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
                return (
                  <li key={p.id} className="home-post-preview">
                    <Avatar url={p.profiles?.avatar_url} name={p.profiles?.full_name} size={36} />
                    <div className="home-post-preview-body">
                      <span className="home-post-preview-head">
                        {p.pinned && <PinIcon />}
                        <strong>{p.profiles?.full_name || 'Alumnus'}</strong>
                        <span className="post-meta-dot">·</span>
                        <span className="post-time">{timeAgo(p.created_at)}</span>
                      </span>
                      <p className="home-post-preview-text">
                        {p.title && <strong>{p.title}: </strong>}
                        {text || (p.image_urls?.length > 0 ? 'Shared a photo.' : '')}
                        <button className="home-post-preview-more" onClick={() => navigate('/feed')}>Read more</button>
                      </p>
                    </div>
                    {p.image_urls?.length > 0 && <ImageIcon />}
                  </li>
                )
              })}
            </ul>
          )}

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

        <aside className="feed-sidebar">
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

          <div className="feed-widget home-donate-card">
            <h3>Lions Help Lions</h3>
            <p>Big or small, make a gift to the cause that resonates with you. Every contribution keeps the house strong.</p>
            <button className="btn primary wide" onClick={() => navigate('/donate')}>Give now</button>
          </div>
        </aside>
      </div>
    </section>
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
