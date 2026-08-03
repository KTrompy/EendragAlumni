import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { LEGEND_FIELDS, LegendTile } from './Legends.jsx'
import LoadingState from './LoadingState.jsx'
import EmptyState from './EmptyState.jsx'

// The full "Hoek van Helde" page — everyone an admin has curated, not just
// this week's three. Reached from the Home band's "See others" link (and
// bookmarkable/shareable on its own, unlike the old in-place cycling it
// replaced).
export default function LegendsHall() {
  const navigate = useNavigate()
  const [legends, setLegends] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const { data, error } = await supabase
        .from('legends')
        .select(LEGEND_FIELDS)
        .eq('active', true)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true })
      if (cancelled) return
      if (error) console.error(error)
      setLegends(data || [])
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [])

  return (
    <section className="panel legends-hall-page">
      <button type="button" className="profile-back-btn" onClick={() => navigate('/home')}>‹ Home</button>

      <div className="legends-hall-head">
        <h2 className="legends-hall-title">Hoek van Helde</h2>
        <p className="legends-hall-sub">Eendragters who've made their mark — on the field, in business, in public life, and beyond.</p>
      </div>

      {loading ? (
        <LoadingState message="Loading Hoek van Helde…" />
      ) : legends.length === 0 ? (
        <EmptyState icon="search" message="No legends curated yet." subMessage="Check back soon." />
      ) : (
        <div className="legends-hall-grid">
          {legends.map((l) => <LegendTile key={l.id} legend={l} />)}
        </div>
      )}
    </section>
  )
}
