import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { Avatar } from './Directory.jsx'

function plainText(html) {
  const div = document.createElement('div')
  div.innerHTML = html || ''
  return div.textContent || ''
}

function truncate(text, max = 80) {
  const t = (text || '').trim()
  return t.length > max ? t.slice(0, max).trim() + '…' : t
}

// Every section (Directory, Feed, Jobs, Business Directory) already has its
// own local search box, but there was no single "search everything" —
// this is that: one header button, four small parallel queries (5 rows
// each, cheap enough to re-run on every keystroke via the debounce below),
// grouped results, click-through straight to the person/post/job/business.
// `,()` are stripped from the query before building the ilike pattern so a
// stray one in what someone types can't break the .or() filter syntax.
export default function GlobalSearch({ open, onClose }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState({ people: [], posts: [], jobs: [], businesses: [] })
  const [loading, setLoading] = useState(false)
  const inputRef = useRef(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (!open) return
    setQ('')
    setResults({ people: [], posts: [], jobs: [], businesses: [] })
    const t = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(t)
  }, [open])

  useEffect(() => {
    if (!open) return
    const needle = q.trim()
    if (needle.length < 2) {
      setResults({ people: [], posts: [], jobs: [], businesses: [] })
      setLoading(false)
      return
    }
    setLoading(true)
    const timer = setTimeout(async () => {
      const safe = needle.replace(/[,()%]/g, ' ').trim()
      const like = `%${safe}%`
      const [{ data: people }, { data: posts }, { data: jobs }, { data: businesses }] = await Promise.all([
        supabase.from('profiles').select('id, full_name, avatar_url, occupation, company')
          .or(`full_name.ilike.${like},occupation.ilike.${like},company.ilike.${like}`)
          .limit(5),
        supabase.from('posts').select('id, content, profiles!posts_author_id_fkey ( full_name )')
          .ilike('content', like).limit(5),
        supabase.from('jobs').select('id, title, company')
          .or(`title.ilike.${like},company.ilike.${like}`).limit(5),
        supabase.from('businesses').select('id, name, description')
          .or(`name.ilike.${like},description.ilike.${like}`).limit(5),
      ])
      setResults({ people: people || [], posts: posts || [], jobs: jobs || [], businesses: businesses || [] })
      setLoading(false)
    }, 300)
    return () => clearTimeout(timer)
  }, [q, open])

  useEffect(() => {
    if (!open) return
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const hasAny = results.people.length || results.posts.length || results.jobs.length || results.businesses.length
  const go = (path) => { onClose(); navigate(path) }

  return (
    <div className="modal-backdrop global-search-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="Search">
      <div className="modal global-search-modal" onClick={(e) => e.stopPropagation()}>
        <div className="global-search-input-wrap">
          <SearchIcon />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search Eendragters, Feed, Jobs, Business Directory…"
            className="global-search-input"
          />
          <button className="modal-close" onClick={onClose} aria-label="Close search">×</button>
        </div>

        <div className="global-search-results">
          {q.trim().length < 2 ? (
            <p className="empty small">Start typing to search across the whole site.</p>
          ) : loading ? (
            <p className="empty small">Searching…</p>
          ) : !hasAny ? (
            <p className="empty small">No results for "{q.trim()}".</p>
          ) : (
            <>
              {results.people.length > 0 && (
                <div className="global-search-group">
                  <h4>Eendragters</h4>
                  {results.people.map((p) => (
                    <button key={p.id} className="global-search-result" onClick={() => go(`/people/${p.id}`)}>
                      <Avatar url={p.avatar_url} name={p.full_name} size={32} />
                      <span>
                        <strong>{p.full_name || 'Alumnus'}</strong>
                        {(p.occupation || p.company) && <em>{[p.occupation, p.company].filter(Boolean).join(' @ ')}</em>}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {results.posts.length > 0 && (
                <div className="global-search-group">
                  <h4>Feed</h4>
                  {results.posts.map((p) => (
                    <button key={p.id} className="global-search-result" onClick={() => go(`/feed/${p.id}`)}>
                      <span>
                        <strong>{p.profiles?.full_name || 'Alumnus'}</strong>
                        <em>{truncate(plainText(p.content))}</em>
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {results.jobs.length > 0 && (
                <div className="global-search-group">
                  <h4>Jobs</h4>
                  {results.jobs.map((j) => (
                    <button key={j.id} className="global-search-result" onClick={() => go(`/jobs/${j.id}`)}>
                      <span>
                        <strong>{j.title}</strong>
                        {j.company && <em>{j.company}</em>}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {results.businesses.length > 0 && (
                <div className="global-search-group">
                  <h4>Business Directory</h4>
                  {results.businesses.map((b) => (
                    <button key={b.id} className="global-search-result" onClick={() => go(`/businesses/${b.id}`)}>
                      <span>
                        <strong>{b.name}</strong>
                        {b.description && <em>{truncate(plainText(b.description), 60)}</em>}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  )
}
