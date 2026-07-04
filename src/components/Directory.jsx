import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'

export default function Directory({ session, onMessage }) {
  const [people, setPeople] = useState([])
  const [q, setQ] = useState('')

  useEffect(() => {
    supabase
      .from('profiles')
      .select('id, full_name, grad_year, section, occupation, city, bio, approved')
      .order('grad_year', { ascending: false, nullsFirst: false })
      .then(({ data }) => setPeople(data || []))
  }, [])

  const needle = q.trim().toLowerCase()
  const shown = people.filter((p) => {
    if (p.id === session.user.id) return false
    if (!needle) return true
    return [p.full_name, p.occupation, p.city, p.section, String(p.grad_year || '')]
      .join(' ')
      .toLowerCase()
      .includes(needle)
  })

  return (
    <section className="panel">
      <h2 className="panel-title">Alumni directory</h2>
      <input
        className="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by name, year, city, section or occupation…"
      />

      {shown.length === 0 && <p className="empty">No matching Eendragters found.</p>}

      <ul className="card-grid">
        {shown.map((p) => (
          <li key={p.id} className="person-card">
            <div className="person-head">
              <span className="person-name">{p.full_name || 'Alumnus'}</span>
              {p.grad_year && <span className="person-year">’{String(p.grad_year).slice(-2)}</span>}
            </div>
            <div className="person-meta">
              {[p.occupation, p.city, p.section && `Section ${p.section}`]
                .filter(Boolean)
                .join(' · ') || '—'}
            </div>
            {p.bio && <p className="person-bio">{p.bio}</p>}
            <button className="btn ghost" onClick={() => onMessage(p)}>
              Message
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
