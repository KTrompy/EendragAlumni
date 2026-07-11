import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { Avatar } from './Directory.jsx'
import EmptyState from './EmptyState.jsx'
import LoadingState from './LoadingState.jsx'
import DeleteButton from './DeleteButton.jsx'
import { useToast } from './Toast.jsx'
import { MerchForm, ShirtIcon } from './Merchandise.jsx'

const MERCH_SELECT =
  'id, name, description, price, category, sizes, colors, image_url, is_available, created_by, created_at, ' +
  'profiles!merchandise_created_by_fkey ( id, full_name, avatar_url )'

const FALLBACK_CONTACT_EMAIL = 'alumni@eendrag.example.com'

function formatPrice(price) {
  const n = Number(price)
  return `R${n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// Standalone listing page, reached from a store card's photo/name — same
// "own route instead of a floating modal" shape as BusinessDetail.jsx/
// JobDetail.jsx. Variant pickers + Order button live here too so a linked
// item still works as a complete page on its own.
export default function MerchDetail({ session, profile, onMessage }) {
  const { itemId } = useParams()
  const navigate = useNavigate()
  const showToast = useToast()
  const [item, setItem] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [size, setSize] = useState('')
  const [color, setColor] = useState('')
  const isAdmin = !!profile?.is_admin

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('merchandise')
      .select(MERCH_SELECT)
      .eq('id', itemId)
      .maybeSingle()
    if (error) console.error(error)
    setItem(data || null)
    setSize(data?.sizes?.[0] || '')
    setColor(data?.colors?.[0] || '')
    setLoading(false)
  }

  useEffect(() => { load() }, [itemId])

  async function remove() {
    const { error } = await supabase.from('merchandise').delete().eq('id', item.id)
    if (error) { showToast('Could not delete item.', { type: 'error' }); return }
    showToast('Item deleted')
    navigate('/merch')
  }

  async function toggleAvailable() {
    const next = !item.is_available
    setItem((i) => ({ ...i, is_available: next }))
    const { error } = await supabase.from('merchandise').update({ is_available: next }).eq('id', item.id)
    if (error) {
      setItem((i) => ({ ...i, is_available: !next }))
      showToast('Could not update availability.', { type: 'error' })
    } else {
      showToast(next ? 'Marked available' : 'Marked sold out')
    }
  }

  function order() {
    const bits = []
    if (item.sizes?.length) bits.push(`Size: ${size}`)
    if (item.colors?.length) bits.push(`Colour: ${color}`)
    const variantText = bits.length ? ` (${bits.join(', ')})` : ''
    const poster = item.profiles
    if (!poster?.id) {
      window.location.href = `mailto:${FALLBACK_CONTACT_EMAIL}?subject=${encodeURIComponent(`Order: ${item.name}`)}`
      return
    }
    onMessage(
      { id: poster.id, full_name: poster.full_name },
      `Hi! I'd like to order "${item.name}"${variantText} from the Eendrag store.`
    )
  }

  if (loading) return <section className="panel"><LoadingState message="Loading item…" /></section>

  if (!item) {
    return (
      <section className="panel">
        <button className="profile-back-btn" onClick={() => navigate('/merch')}>‹ Merchandise</button>
        <EmptyState icon="merch" message="Item not found." subMessage="It may have been removed." actionLabel="Back to Merchandise" onAction={() => navigate('/merch')} />
      </section>
    )
  }

  const poster = item.profiles

  if (editing) {
    return (
      <section className="panel business-detail-page">
        <button className="profile-back-btn" onClick={() => setEditing(false)}>‹ Cancel edit</button>
        <MerchForm
          session={session}
          initial={item}
          onCancel={() => setEditing(false)}
          onCreated={() => { setEditing(false); load(); showToast('Item updated') }}
        />
      </section>
    )
  }

  return (
    <section className="panel business-detail-page">
      <button className="profile-back-btn" onClick={() => navigate('/merch')}>‹ Merchandise</button>

      <div className="business-detail-layout">
        <div className="business-detail-main">
          <div className="business-detail-card">
            <div className="business-detail-card-head">
              <h2 className="business-detail-name">
                {item.name}
                {!item.is_available && <span className="job-badge merch-soldout-tag">Sold out</span>}
              </h2>
              <p className="business-detail-meta">
                {[item.category, formatPrice(item.price)].filter(Boolean).join(' · ')}
              </p>
            </div>

            {item.image_url ? (
              <div className="business-detail-cover">
                <img src={item.image_url} alt="" />
              </div>
            ) : (
              <div className="business-detail-cover merch-image-fallback-large" aria-hidden="true"><ShirtIcon /></div>
            )}

            {item.description && <p style={{ marginTop: 14 }}>{item.description}</p>}

            {(item.sizes?.length > 0 || item.colors?.length > 0) && (
              <div className="merch-variant-row" style={{ marginTop: 16 }}>
                {item.sizes?.length > 0 && (
                  <div className="select-wrap">
                    <select value={size} onChange={(e) => setSize(e.target.value)} aria-label="Size">
                      {item.sizes.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                )}
                {item.colors?.length > 0 && (
                  <div className="select-wrap">
                    <select value={color} onChange={(e) => setColor(e.target.value)} aria-label="Colour">
                      {item.colors.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                )}
              </div>
            )}

            <div className="business-detail-manage-row">
              <button className="btn primary" disabled={!item.is_available} onClick={order}>
                {item.is_available ? 'Order' : 'Sold out'}
              </button>
              {isAdmin && (
                <>
                  <button className="btn ghost small" onClick={toggleAvailable}>
                    {item.is_available ? 'Mark sold out' : 'Mark available'}
                  </button>
                  <button className="btn ghost small" onClick={() => setEditing(true)}>Edit</button>
                  <DeleteButton
                    onConfirm={remove}
                    label="Delete item"
                    message="This removes the item from the store. This can't be undone."
                    className="btn ghost small delete-danger"
                  >
                    Delete
                  </DeleteButton>
                </>
              )}
            </div>
          </div>
        </div>

        <aside className="business-detail-sidebar">
          {poster?.id && (
            <div className="feed-widget">
              <p style={{ marginTop: 0, marginBottom: 10, fontSize: 13, color: 'var(--ink-soft)' }}>Listed by</p>
              <button className="business-detail-poster" onClick={() => navigate(`/people/${poster.id}`)}>
                <Avatar url={poster.avatar_url} name={poster.full_name} size={40} />
                <span className="business-detail-poster-text"><strong>{poster.full_name || 'a member'}</strong></span>
              </button>
            </div>
          )}
          <div className="feed-widget business-promote-card">
            <p>Ideas for what the store should stock next?</p>
            <button className="btn ghost wide" onClick={() => navigate('/merch')}>Back to Merchandise</button>
          </div>
        </aside>
      </div>
    </section>
  )
}
