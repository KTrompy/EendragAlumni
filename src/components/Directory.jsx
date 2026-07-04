import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'

export function Avatar({ url, name, size = 72 }) {
  const initials = (name || 'A')
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
  return url ? (
    <img className="avatar" src={url} alt={name || 'Alumnus'} style={{ width: size, height: size }} loading="lazy" />
  ) : (
    <div className="avatar avatar-fallback" style={{ width: size, height: size, fontSize: size * 0.36 }}>
      {initials}
    </div>
  )
}

export default function Directory({ session, onMessage }) {
  const [people, setPeople] = useState([])
  const [q, setQ] = useState('')

  useEffect(() => {
    supabase
      .from('profiles')
      .select('id, full_name, grad_year, section, occupation, company, city, bio, avatar_url, approved')
      .order('grad_year', { ascending: false, nullsFirst: false })
      .then(({ data }) => setPeople(data || []))
  }, [])

  const needle = q.trim().toLowerCase()
  const shown = people.filter((p) => {
    if (!needle) return true
    return [p.full_name, p.occupation, p.company, p.city, p.section, String(p.grad_year || '')]
      .join(' ')
      .toLowerCase()
      .includes(needle)
  })

  function roleLine(p) {
    if (p.occupation && p.company) return `${p.occupation} @ ${p.company}`
    return p.occupation || p.company || ''
  }

  return (
    <section className="panel">
      <h2 className="panel-title">Eendragters</h2>
      <p className="panel-sub">The house, out in the world.</p>
      <input
        className="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by name, year, city, company or occupation…"
      />

      {shown.length === 0 && <p className="empty">No matching Eendragters found.</p>}

      <ul className="card-grid">
        {shown.map((p) => {
          const isMe = p.id === session.user.id
          return (
            <li key={p.id} className="person-card">
              <div className="person-top">
                <Avatar url={p.avatar_url} name={p.full_name} />
                <div>
                  <div className="person-head">
                    <span className="person-name">
                      {p.full_name || 'Alumnus'}{isMe ? ' (you)' : ''}
                    </span>
                    {p.grad_year && (
                      <span className="person-year">’{String(p.grad_year).slice(-2)}</span>
                    )}
                  </div>
                  {roleLine(p) && <div className="person-role">{roleLine(p)}</div>}
                  {p.city && <div className="person-city">{p.city}</div>}
                </div>
              </div>
              {p.bio && <p className="person-bio">{p.bio}</p>}
              {!isMe && (
                <button className="btn ghost" onClick={() => onMessage(p)}>
                  Message
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
