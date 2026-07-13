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
  const [quantity, setQuantity] = useState(1)
  const [liked, setLiked] = useState(false)
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

  // Wishlist heart used to be local component state only — toggling it
  // never wrote anywhere, so it silently reset to unfilled on every reload
  // even though the button implied it was saving a preference. Backed by
  // merch_wishlist now (see schema-update-31.sql) so it actually persists
  // per person, per item.
  useEffect(() => {
    let cancelled = false
    supabase
      .from('merch_wishlist')
      .select('item_id')
      .eq('user_id', session.user.id)
      .eq('item_id', itemId)
      .maybeSingle()
      .then(({ data }) => { if (!cancelled) setLiked(!!data) })
    return () => { cancelled = true }
  }, [itemId, session.user.id])

  async function toggleWishlist() {
    const next = !liked
    setLiked(next) // optimistic — flip back on failure below
    const { error } = next
      ? await supabase.from('merch_wishlist').upsert({ user_id: session.user.id, item_id: itemId })
      : await supabase.from('merch_wishlist').delete().match({ user_id: session.user.id, item_id: itemId })
    if (error) {
      setLiked(!next)
      showToast('Could not update wishlist.', { type: 'error' })
    }
  }

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
    // Quantity used to be picked in the UI but never actually made it into
    // the order message — the seller only ever heard about size/colour, so
    // someone who selected 3 would still just get asked about "the item"
    // with no indication more than one was wanted.
    bits.push(`Qty: ${quantity}`)
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
    <section className="panel merch-detail-page">
      <button className="profile-back-btn" onClick={() => navigate('/merch')}>‹ Merchandise</button>

      <div className="merch-detail-container">
        <div className="merch-detail-image">
          {item.image_url ? (
            <img src={item.image_url} alt={item.name} />
          ) : (
            <div className="merch-image-fallback-large" aria-hidden="true"><ShirtIcon /></div>
          )}
        </div>

        <div className="merch-detail-content">
          <div>
            <h2 className="merch-detail-name">
              {item.name}
              {!item.is_available && <span className="job-badge merch-soldout-tag">Sold out</span>}
            </h2>
            <p className="merch-detail-meta">
              {[item.category, formatPrice(item.price)].filter(Boolean).join(' · ')}
            </p>
            {item.description && <p className="merch-detail-desc">{item.description}</p>}
          </div>

          <div className="merch-detail-options">
            {item.colors?.length > 0 && (
              <div className="merch-option-group">
                <label className="merch-option-label">COLOUR: {color}</label>
                <div className="merch-color-options">
                  {item.colors.map((c) => (
                    <button
                      key={c}
                      className={`merch-color-btn ${color === c ? 'active' : ''}`}
                      onClick={() => setColor(c)}
                      title={c}
                      style={{ backgroundImage: `url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" fill="${encodeURIComponent(c)}" /></svg>')` }}
                      aria-label={`Color: ${c}`}
                    >
                      {c === 'NAVY' || c === 'navy' ? <NavyPreview /> : c === 'WHITE' || c === 'white' ? <WhitePreview /> : null}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {item.sizes?.length > 0 && (
              <div className="merch-option-group">
                <label className="merch-option-label">SIZE:</label>
                <div className="merch-size-options">
                  {item.sizes.map((s) => (
                    <button
                      key={s}
                      className={`merch-size-btn ${size === s ? 'active' : ''}`}
                      onClick={() => setSize(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="merch-option-group">
              <label className="merch-option-label">QUANTITY:</label>
              <div className="merch-quantity-picker">
                <button onClick={() => setQuantity(Math.max(1, quantity - 1))}>−</button>
                <span>{quantity}</span>
                <button onClick={() => setQuantity(quantity + 1)}>+</button>
              </div>
            </div>
          </div>

          <div className="merch-detail-actions">
            <button className="btn primary merch-add-btn" disabled={!item.is_available} onClick={order}>
              {item.is_available ? 'ADD TO BAG' : 'Sold out'}
            </button>
            <button className="merch-wishlist-btn" onClick={toggleWishlist} aria-label={liked ? 'Remove from wishlist' : 'Add to wishlist'}>
              <HeartIcon filled={liked} />
            </button>
          </div>

          {isAdmin && (
            <div className="merch-admin-actions">
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
            </div>
          )}

          {poster?.id && (
            <div className="merch-detail-seller">
              <p className="merch-seller-label">Listed by</p>
              <button className="merch-seller-card" onClick={() => navigate(`/people/${poster.id}`)}>
                <Avatar url={poster.avatar_url} name={poster.full_name} size={32} />
                <span>{poster.full_name || 'a member'}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function HeartIcon({ filled }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  )
}

function NavyPreview() {
  return (
    <svg width="36" height="36" viewBox="0 0 36 36">
      <circle cx="18" cy="18" r="14" fill="#001f3f" stroke="#999" strokeWidth="1" />
    </svg>
  )
}

function WhitePreview() {
  return (
    <svg width="36" height="36" viewBox="0 0 36 36">
      <circle cx="18" cy="18" r="14" fill="white" stroke="#999" strokeWidth="1" />
    </svg>
  )
}
