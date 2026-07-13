import { useRef, useState } from 'react'
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import EmptyState from './EmptyState.jsx'
import LoadingState from './LoadingState.jsx'
import DeleteButton from './DeleteButton.jsx'
import MultiSelectAutocomplete from './MultiSelectAutocomplete.jsx'
import { useToast } from './Toast.jsx'

const MAX_IMAGE_SIZE = 3 * 1024 * 1024

// How recent counts as "New" on a card — longer window than Jobs' 48h
// since the store won't turn over nearly as often.
const NEW_WINDOW_MS = 14 * 24 * 60 * 60 * 1000

// Official, admin-curated store — hoodies, mugs, caps, that sort of thing —
// not a peer marketplace like Jobs/Business Directory, so there's no
// "owner" concept: only admins create/edit/remove listings, everyone else
// just browses and orders. See schema-update-27.sql for why writes are
// gated on public.is_admin() with no owner-OR-admin half at all.
export const MERCH_CATEGORIES = ['Apparel', 'Drinkware', 'Accessories', 'Stationery', 'Other']

// Starting suggestions only — Sizes uses allowCustom so an admin can still
// type something not on this list (e.g. a shoe size or "XS/S" combined).
const SIZE_SUGGESTIONS = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'One size']

// Fallback contact when a listing's creator account no longer exists (rare —
// only happens if an admin who posted an item is later removed). Same
// placeholder address Donate.jsx uses for the "no real payment flow yet"
// contact-the-committee path, kept consistent rather than inventing a
// second one.
const FALLBACK_CONTACT_EMAIL = 'alumni@eendrag.example.com'

const MERCH_SELECT =
  'id, name, description, price, category, sizes, colors, image_url, is_available, created_by, created_at, ' +
  'profiles!merchandise_created_by_fkey ( id, full_name, avatar_url )'

const EMPTY_FILTERS = { category: '' }

// Parsed via DOMParser into a detached document rather than assigned to a
// live element's innerHTML — a detached document never loads its
// resources, so an untrusted payload like <img src=x onerror=alert(1)>
// can't fire its handler while we're just extracting text.
function plainText(html) {
  return new DOMParser().parseFromString(html || '', 'text/html').body.textContent || ''
}

function formatPrice(price) {
  const n = Number(price)
  return `R${n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function Merchandise({ session, profile, onMessage }) {
  const navigate = useNavigate()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const showToast = useToast()
  const isAdmin = !!profile?.is_admin

  async function loadItems() {
    setLoading(true)
    const { data, error } = await supabase
      .from('merchandise')
      .select(MERCH_SELECT)
      .order('is_available', { ascending: false })
      .order('created_at', { ascending: false })
    if (error) { console.error(error); setLoading(false); return }
    setItems(data || [])
    setLoading(false)
  }

  useEffect(() => {
    loadItems()
    const channel = supabase
      .channel('merchandise')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'merchandise' }, () => loadItems())
      .subscribe()
    return () => supabase.removeChannel(channel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function removeItem(id) {
    const { error } = await supabase.from('merchandise').delete().eq('id', id)
    if (error) { showToast('Could not delete item.', { type: 'error' }); return }
    setItems((prev) => prev.filter((i) => i.id !== id))
    showToast('Item deleted')
  }

  async function toggleAvailable(item) {
    const next = !item.is_available
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, is_available: next } : i)))
    const { error } = await supabase.from('merchandise').update({ is_available: next }).eq('id', item.id)
    if (error) {
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, is_available: !next } : i)))
      showToast('Could not update availability.', { type: 'error' })
    } else {
      showToast(next ? 'Marked available' : 'Marked sold out')
    }
  }

  function orderItem(item, variantText) {
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

  const needle = q.trim().toLowerCase()
  const shown = items.filter((i) => {
    if (needle) {
      const hay = [i.name, i.category, plainText(i.description)].join(' ').toLowerCase()
      if (!hay.includes(needle)) return false
    }
    if (filters.category && i.category !== filters.category) return false
    return true
  })

  const activeFilterCount = Object.values(filters).filter(Boolean).length
  function clearFilters() { setFilters(EMPTY_FILTERS); setQ('') }

  return (
    <section className="panel">
      <div className="panel-header-row">
        <div>
          <h2 className="panel-title">Merchandise</h2>
          <p className="panel-sub">Official Eendrag gear — order a piece to show your colours.</p>
        </div>
        {isAdmin && !showForm && (
          <button className="btn primary" onClick={() => setShowForm(true)}>Add item</button>
        )}
      </div>

      {showForm && (
        <MerchForm
          session={session}
          onCancel={() => setShowForm(false)}
          onCreated={() => { setShowForm(false); loadItems(); showToast('Item added') }}
        />
      )}

      <div className="directory-toolbar">
        <div className="search-wrap">
          <input
            className="search directory-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or category…"
          />
          {q && <button className="search-clear" onClick={() => setQ('')} aria-label="Clear search">×</button>}
        </div>
      </div>

      <div className="filter-radio-row" style={{ marginBottom: 16 }}>
        <button
          className={filters.category === '' ? 'on' : ''}
          onClick={() => setFilters((f) => ({ ...f, category: '' }))}
        >
          All
        </button>
        {MERCH_CATEGORIES.map((c) => (
          <button
            key={c}
            className={filters.category === c ? 'on' : ''}
            onClick={() => setFilters((f) => ({ ...f, category: f.category === c ? '' : c }))}
          >
            {c}
          </button>
        ))}
      </div>

      <p className="result-count">
        Showing {shown.length} of {items.length} {items.length === 1 ? 'item' : 'items'}
      </p>

      {loading ? (
        <LoadingState message="Loading merchandise…" />
      ) : shown.length === 0 ? (
        <EmptyState
          icon="merch"
          message={items.length === 0 ? 'No merchandise listed yet.' : 'No matching items found.'}
          subMessage={items.length === 0
            ? (isAdmin ? 'Add the first item to get the store started.' : 'Check back soon.')
            : 'Try widening a filter or clearing them all.'}
          actionLabel={items.length === 0 ? (isAdmin ? 'Add item' : undefined) : (activeFilterCount || needle) ? 'Clear filters' : undefined}
          onAction={items.length === 0 ? () => setShowForm(true) : clearFilters}
        />
      ) : (
        <ul className="card-grid merch-grid">
          {shown.map((item) => (
            <li key={item.id}>
              {editingId === item.id ? (
                <MerchForm
                  session={session}
                  initial={item}
                  onCancel={() => setEditingId(null)}
                  onCreated={() => { setEditingId(null); loadItems(); showToast('Item updated') }}
                />
              ) : (
                <MerchCard
                  item={item}
                  isAdmin={isAdmin}
                  onOpen={() => navigate(`/merch/${item.id}`)}
                  onOrder={(variantText) => orderItem(item, variantText)}
                  onEdit={() => setEditingId(item.id)}
                  onDelete={() => removeItem(item.id)}
                  onToggleAvailable={() => toggleAvailable(item)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/* ---------- One merch card — product tile: full photo, NEW/+ADD overlays,
   title + price underneath. Variant pickers live on the detail page, not
   here, so "+ Add" opens that page for anything with sizes/colours and only
   orders directly for one-size items. ---------- */
export function MerchCard({ item, isAdmin, onOpen, onOrder, onEdit, onDelete, onToggleAvailable }) {
  const isNew = Date.now() - new Date(item.created_at).getTime() < NEW_WINDOW_MS
  const hasVariants = (item.sizes?.length > 0) || (item.colors?.length > 0)

  function handleAdd(e) {
    e.stopPropagation()
    if (hasVariants) { onOpen(); return }
    onOrder('')
  }

  return (
    <div className="merch-card">
      <button
        type="button"
        className="merch-card-photo"
        onClick={onOpen}
        aria-label={`Open details for ${item.name}`}
      >
        {item.image_url ? (
          <img src={item.image_url} alt="" loading="lazy" />
        ) : (
          <div className="merch-card-photo-fallback" aria-hidden="true"><ShirtIcon /></div>
        )}
        {!item.is_available ? (
          <span className="merch-card-badge soldout">Sold out</span>
        ) : isNew ? (
          <span className="merch-card-badge new">New</span>
        ) : null}
        {item.is_available && (
          <span
            className="merch-add-btn"
            role="button"
            tabIndex={0}
            onClick={handleAdd}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleAdd(e) } }}
          >
            + Add
          </span>
        )}
      </button>

      <div className="merch-card-info">
        <button type="button" className="merch-card-title" onClick={onOpen}>{item.name}</button>
        <p className="merch-card-price">{formatPrice(item.price)}</p>
      </div>

      {isAdmin && (
        <div className="merch-card-admin-row">
          <button className="btn ghost small" onClick={onToggleAvailable}>
            {item.is_available ? 'Mark sold out' : 'Mark available'}
          </button>
          <button className="btn ghost small" onClick={onEdit}>Edit</button>
          <DeleteButton
            onConfirm={onDelete}
            label="Delete item"
            message="This removes the item from the store. This can't be undone."
            className="btn ghost small delete-danger"
          >
            Delete
          </DeleteButton>
        </div>
      )}
    </div>
  )
}

/* ---------- Admin create/edit form ---------- */
export function MerchForm({ session, onCancel, onCreated, initial = null }) {
  const isEdit = !!initial
  const [form, setForm] = useState({
    name: initial?.name || '',
    description: initial?.description || '',
    price: initial?.price != null ? String(initial.price) : '',
    category: initial?.category || MERCH_CATEGORIES[0],
    sizes: initial?.sizes || [],
    colors: initial?.colors || [],
  })
  const [imageFile, setImageFile] = useState(null)
  const [imageUrl, setImageUrl] = useState(initial?.image_url || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const imageRef = useRef(null)

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })) }

  function pickImage(e) {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > MAX_IMAGE_SIZE) { setError('Image is over 3MB.'); e.target.value = ''; return }
    setImageFile(f)
    setError(null)
    e.target.value = ''
  }

  function removeImage() { setImageFile(null); setImageUrl('') }

  async function uploadImage() {
    const ext = imageFile.name.split('.').pop().toLowerCase()
    const path = `${session.user.id}/${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage
      .from('merch-images')
      .upload(path, imageFile, { upsert: false, contentType: imageFile.type })
    if (upErr) throw upErr
    const { data } = supabase.storage.from('merch-images').getPublicUrl(path)
    return data.publicUrl
  }

  async function submit() {
    if (!form.name.trim() || !form.price.trim() || Number.isNaN(Number(form.price))) {
      setError('Name and a valid price are required.'); return
    }
    setBusy(true); setError(null)
    try {
      const finalImageUrl = imageFile ? await uploadImage() : imageUrl
      const payload = {
        name: form.name.trim(),
        description: form.description.trim(),
        price: Number(form.price),
        category: form.category,
        sizes: form.sizes,
        colors: form.colors,
        image_url: finalImageUrl,
      }
      const { error } = isEdit
        ? await supabase.from('merchandise').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', initial.id)
        : await supabase.from('merchandise').insert({ ...payload, created_by: session.user.id })
      if (error) {
        setError(error.message.includes('policy') ? 'Only admins can manage the store.' : error.message)
        setBusy(false)
      } else {
        onCreated()
      }
    } catch (e) {
      setError(e.message || 'Image upload failed.')
      setBusy(false)
    }
  }

  const imagePreview = imageFile ? URL.createObjectURL(imageFile) : imageUrl

  return (
    <div className={isEdit ? '' : 'create-panel-backdrop'} onClick={isEdit ? undefined : (e) => e.target === e.currentTarget && onCancel()}>
      <div className={isEdit ? 'create-panel inline' : 'create-panel'}>
        <h3>{isEdit ? 'Edit item' : 'Add merchandise'}</h3>
        <div className="create-panel-content">
          <div className="field-row">
            <label className="field"><span>Item name *</span>
              <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Eendrag hoodie" />
            </label>
            <label className="field"><span>Category *</span>
              <div className="select-wrap">
                <select value={form.category} onChange={(e) => set('category', e.target.value)}>
                  {MERCH_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
            </label>
          </div>

          <label className="field"><span>Price (ZAR) *</span>
            <input type="number" min="0" step="0.01" value={form.price} onChange={(e) => set('price', e.target.value)} placeholder="450.00" />
          </label>

          <label className="field"><span>Photo (optional)</span></label>
          <div className="job-logo-picker business-cover-picker">
            {imagePreview ? (
              <img className="business-cover-preview" src={imagePreview} alt="Item preview" />
            ) : (
              <div className="business-cover-preview business-cover-fallback" aria-hidden="true"><ShirtIcon /></div>
            )}
            <div className="job-logo-picker-actions">
              <button type="button" className="btn ghost small" onClick={() => imageRef.current?.click()}>
                {imagePreview ? 'Replace image' : 'Upload image'}
              </button>
              {imagePreview && <button type="button" className="btn ghost small" onClick={removeImage}>Remove</button>}
            </div>
            <input ref={imageRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} onChange={pickImage} />
          </div>

          <label className="field"><span>Description</span>
            <textarea
              rows={3}
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="Fabric, fit, what makes it worth ordering…"
            />
          </label>

          <label className="field"><span>Sizes (optional — leave empty for one-size items)</span></label>
          <MultiSelectAutocomplete
            values={form.sizes}
            onChange={(v) => set('sizes', v)}
            options={SIZE_SUGGESTIONS}
            placeholder="Search or add a size"
            allowCustom
          />

          <label className="field" style={{ marginTop: 14 }}><span>Colours (optional)</span></label>
          <MultiSelectAutocomplete
            values={form.colors}
            onChange={(v) => set('colors', v)}
            options={[]}
            placeholder="Add a colour"
            allowCustom
          />

          {error && <p className="form-error">{error}</p>}
        </div>
        <div className="btn-row">
          <button className="btn ghost" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="btn primary" onClick={submit} disabled={busy}>
            {busy ? 'Saving…' : (isEdit ? 'Save changes' : 'Add item')}
          </button>
        </div>
      </div>
    </div>
  )
}

export function ShirtIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3L4 6l2 3-1.5 1.5V20a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1V10.5L18 9l2-3-4-3-1.5 2h-5z" />
    </svg>
  )
}
