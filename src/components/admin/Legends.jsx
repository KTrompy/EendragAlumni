// /admin/legends — the home-page hall of fame: list, order, hide/show,
// and the editor at /admin/legends/new and /admin/legends/:legendId.
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase, deleteStorageFilesFromUrls } from '../../supabaseClient'
import { LEGEND_CATEGORIES } from '../Legends.jsx'
import { useToast } from '../Toast.jsx'
import { isSafeHttpUrl, truncate } from '../../utils.js'
import {
  AdminDialog, Empty, LoadError, Loading, PageHeader, RowError, Status,
  useAdmin, useAdminQuery, useDialogAction,
} from './AdminUI.jsx'
import { describeError, isMissingFunction } from './adminApi.js'

const MAX_PHOTO_SIZE = 5 * 1024 * 1024 // matches the legend-photos bucket limit (schema-update-54)
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const CATEGORY_LABEL = Object.fromEntries(LEGEND_CATEGORIES.map((c) => [c.key, c.label]))

const EMPTY = {
  name: '', years: '', degree: '', category: 'sport',
  headline: '', story: '', photo_url: '', link_url: '', link_label: '', active: true,
}

async function fetchLegends() {
  // No `active` filter: admins need the hidden ones too (RLS allows it).
  const { data, error } = await supabase
    .from('legends')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  return { rows: data || [], error }
}

// Saves a whole order in one call (schema-update-62). Before that migration
// is run, falls back to one UPDATE at a time — sequential, not parallel, so
// two batches can't interleave.
async function saveOrder(ids) {
  const { error } = await supabase.rpc('admin_reorder_legends', { p_ids: ids })
  if (!error) return { error: null }
  if (!isMissingFunction(error)) return { error }
  for (let i = 0; i < ids.length; i += 1) {
    const { error: e } = await supabase.from('legends').update({ sort_order: i }).eq('id', ids[i])
    if (e) return { error: e }
  }
  return { error: null }
}

export default function Legends() {
  const { bump } = useAdmin()
  const showToast = useToast()
  const q = useAdminQuery('legends', 'list', fetchLegends)
  const [order, setOrder] = useState(null) // optimistic order while a save is in flight
  const [saving, setSaving] = useState(false)
  const [rowError, setRowError] = useState({})
  const [deleting, setDeleting] = useState(null)

  const legends = order || q.data?.rows || []

  // One reorder at a time: the arrows are disabled while a save runs, and
  // the whole list is written in one statement.
  async function move(index, delta) {
    const target = index + delta
    if (saving || target < 0 || target >= legends.length) return
    const next = [...legends]
    ;[next[index], next[target]] = [next[target], next[index]]
    setOrder(next)
    setSaving(true)
    const { error } = await saveOrder(next.map((l) => l.id))
    setSaving(false)
    if (error) {
      setOrder(null)
      showToast(`Couldn't save the new order: ${describeError(error)}`, { type: 'error' })
      q.reload()
      return
    }
    bump('legends')
    setOrder(null)
  }

  async function toggleActive(l) {
    setRowError((e) => ({ ...e, [l.id]: null }))
    const { data, error } = await supabase.from('legends').update({ active: !l.active }).eq('id', l.id).select('id').maybeSingle()
    if (error || !data) {
      setRowError((e) => ({ ...e, [l.id]: error ? describeError(error) : "The change wasn't saved." }))
      return
    }
    bump('legends')
    showToast(l.active ? `${l.name} hidden from the home page` : `${l.name} is back on the home page`)
  }

  const remover = useDialogAction(() => {
    const l = deleting
    setDeleting(null)
    // Best-effort, and only once the row is gone: an orphaned photo is untidy,
    // a row pointing at a deleted photo is a broken tile.
    if (l?.photo_url) deleteStorageFilesFromUrls('legend-photos', l.photo_url)
    bump('legends')
    showToast(`${l?.name || 'Legend'} deleted`)
  })

  async function removeLegend(l) {
    const { data, error } = await supabase.from('legends').delete().eq('id', l.id).select('id')
    if (error) return { error: new Error(describeError(error)) }
    if (!data?.length) return { error: new Error('Nothing was deleted.') }
    return { error: null }
  }

  return (
    <div className="adm-page">
      <PageHeader title="Legends">
        <Link className="adm-btn primary" to="/admin/legends/new">+ Add legend</Link>
      </PageHeader>
      <p className="adm-lede">Three visible legends show on the home page at a time and rotate weekly, in this order.</p>

      {q.error ? (
        <LoadError what="legends" error={q.error} onRetry={q.reload} />
      ) : q.loading && !q.data ? (
        <Loading />
      ) : legends.length === 0 ? (
        <Empty>No legends yet. Until one is added, the home page shows none.</Empty>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table adm-legends">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col" className="adm-col-opt">Visibility</th>
                <th scope="col">Order</th>
                <th scope="col" className="adm-col-actions"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {legends.map((l, i) => (
                <tr key={l.id}>
                  <td>
                    <div className="adm-cell-person">
                      {l.photo_url
                        ? <img className="adm-legend-thumb" src={l.photo_url} alt="" />
                        : <span className="adm-legend-thumb" aria-hidden="true" />}
                      <div>
                        <Link className="adm-row-title" to={`/admin/legends/${l.id}`}>{l.name}</Link>
                        <span className="adm-sub">
                          {CATEGORY_LABEL[l.category] || l.category}{l.years ? ` · ${l.years}` : ''}
                          <span className="adm-col-opt-inline"> · {truncate(l.headline, 60)}</span>
                          {!l.active && <span className="adm-only-sm"> · Hidden</span>}
                        </span>
                        <RowError message={rowError[l.id]} />
                      </div>
                    </div>
                  </td>
                  <td className="adm-col-opt"><Status value={l.active ? 'visible' : 'hidden'}>{l.active ? 'Visible' : 'Hidden'}</Status></td>
                  <td>
                    <div className="adm-order">
                      <button type="button" className="adm-btn adm-icon-btn" onClick={() => move(i, -1)} disabled={saving || i === 0} aria-label={`Move ${l.name} up`}>↑</button>
                      <button type="button" className="adm-btn adm-icon-btn" onClick={() => move(i, 1)} disabled={saving || i === legends.length - 1} aria-label={`Move ${l.name} down`}>↓</button>
                    </div>
                  </td>
                  <td className="adm-col-actions">
                    <div className="adm-row-actions">
                      <Link className="adm-btn adm-hide-sm" to={`/admin/legends/${l.id}`}>Edit</Link>
                      <button type="button" className="adm-btn" onClick={() => toggleActive(l)}>{l.active ? 'Hide' : 'Show'}</button>
                      <button type="button" className="adm-btn danger" onClick={() => setDeleting(l)} aria-label={`Delete ${l.name}`}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {deleting && (
        <AdminDialog
          title={`Delete ${deleting.name}?`}
          confirmLabel="Delete"
          tone="danger"
          busy={remover.busy}
          error={remover.error}
          onCancel={() => { setDeleting(null); remover.reset() }}
          onConfirm={() => remover.run(() => removeLegend(deleting))}
        >
          <p>The write-up and photo are removed for good. Hide keeps them and takes the tile off the home page.</p>
        </AdminDialog>
      )}
    </div>
  )
}

/* ---------- Editor ---------- */

export function LegendEditor() {
  const { legendId } = useParams()
  const isNew = !legendId
  const q = useAdminQuery('legends', `one:${legendId || 'new'}`, async () => {
    if (isNew) return { legend: EMPTY }
    const { data, error } = await supabase.from('legends').select('*').eq('id', legendId).maybeSingle()
    return { legend: data, error }
  })

  return (
    <div className="adm-page">
      <p className="adm-back"><Link to="/admin/legends">← Legends</Link></p>
      <PageHeader title={isNew ? 'Add a legend' : 'Edit legend'} />
      {q.error ? (
        <LoadError what="this legend" error={q.error} onRetry={q.reload} />
      ) : q.loading && !q.data ? (
        <Loading />
      ) : !q.data?.legend ? (
        <Empty>That legend doesn&rsquo;t exist any more.</Empty>
      ) : (
        <LegendForm key={legendId || 'new'} initial={q.data.legend} />
      )}
    </div>
  )
}

function LegendForm({ initial }) {
  const { session, bump } = useAdmin()
  const navigate = useNavigate()
  const showToast = useToast()
  const [form, setForm] = useState(() => {
    const f = { ...EMPTY }
    Object.keys(EMPTY).forEach((k) => { if (initial[k] !== null && initial[k] !== undefined) f[k] = initial[k] })
    return f
  })
  const [photoFile, setPhotoFile] = useState(null)
  const [preview, setPreview] = useState(initial.photo_url || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const fileRef = useRef(null)
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  useEffect(() => {
    if (!photoFile) return undefined
    const url = URL.createObjectURL(photoFile)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [photoFile])

  function pickPhoto(e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (!PHOTO_TYPES.includes(f.type)) { setError('The photo must be a JPG, PNG or WebP.'); return }
    if (f.size > MAX_PHOTO_SIZE) { setError('The photo is over 5 MB.'); return }
    setError(null)
    setPhotoFile(f)
  }

  async function uploadPhoto() {
    const ext = (photoFile.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')
    const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext || 'jpg'}`
    const { error: upErr } = await supabase.storage
      .from('legend-photos')
      .upload(path, photoFile, { upsert: false, contentType: photoFile.type })
    if (upErr) throw upErr
    return supabase.storage.from('legend-photos').getPublicUrl(path).data.publicUrl
  }

  async function save(e) {
    e.preventDefault()
    if (saving) return
    if (!form.name.trim()) { setError('Give the person a name.'); return }
    if (!form.headline.trim()) { setError('Add the one-line claim to fame — it’s what the tile shows.'); return }
    if (!photoFile && !form.photo_url) { setError('A photo is required — the tile is built around it.'); return }
    const link = form.link_url.trim()
    if (link && (!isSafeHttpUrl(link) || !/^https?:\/\//i.test(link))) {
      setError('The read-more link must be a full web address starting with https://')
      return
    }

    setSaving(true)
    setError(null)
    const oldPhoto = initial.photo_url || null
    let newPhoto = null
    try {
      // 1. Upload the new photo (if any). The old one is untouched for now.
      if (photoFile) newPhoto = await uploadPhoto()

      const payload = {
        name: form.name.trim(),
        years: form.years.trim() || null,
        degree: form.degree.trim() || null,
        category: form.category,
        headline: form.headline.trim(),
        story: form.story.trim() || null,
        photo_url: newPhoto || form.photo_url,
        link_url: link || null,
        link_label: form.link_label.trim() || null,
        active: form.active,
      }

      // 2. Write the row.
      const { data, error: dbErr } = initial.id
        ? await supabase.from('legends').update(payload).eq('id', initial.id).select('id').maybeSingle()
        : await supabase.from('legends').insert({ ...payload, created_by: session.user.id }).select('id').maybeSingle()
      if (dbErr) throw dbErr
      if (!data) throw new Error("The legend wasn't saved.")

      // 3. Only now that the row points at the new photo, remove the old one.
      if (newPhoto && oldPhoto) deleteStorageFilesFromUrls('legend-photos', oldPhoto)

      bump('legends')
      showToast(initial.id ? 'Legend saved' : 'Legend added')
      navigate('/admin/legends')
    } catch (err) {
      // 4. The row wasn't saved: drop the photo we just uploaded and keep the
      // old one exactly as it was.
      if (newPhoto) deleteStorageFilesFromUrls('legend-photos', newPhoto)
      setError(describeError(err) || 'Something went wrong saving that.')
      setSaving(false)
    }
  }

  return (
    <form className="adm-form adm-legend-form" onSubmit={save} noValidate>
      <div className="adm-field-row">
        <label className="adm-field"><span>Full name</span>
          <input value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={80} placeholder="Jan van der Merwe" required />
        </label>
        <label className="adm-field"><span>Category</span>
          <select value={form.category} onChange={(e) => set('category', e.target.value)}>
            {LEGEND_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </label>
      </div>

      <div className="adm-field-row">
        <label className="adm-field"><span>Years in Eendrag <span className="adm-muted">(optional)</span></span>
          <input value={form.years} onChange={(e) => set('years', e.target.value)} maxLength={40} placeholder="1962–1966" />
        </label>
        <label className="adm-field"><span>Degree <span className="adm-muted">(optional)</span></span>
          <input value={form.degree} onChange={(e) => set('degree', e.target.value)} maxLength={60} placeholder="BSc Ingenieurswese" />
        </label>
      </div>

      <label className="adm-field"><span>Claim to fame</span>
        <input value={form.headline} onChange={(e) => set('headline', e.target.value)} maxLength={160} placeholder="Springbok lock with 34 caps who captained the side in 1971" required />
        <small>One sentence, shown on the tile under the name.</small>
      </label>

      <div className="adm-field">
        <span id="legend-photo-label">Photo</span>
        <div className="adm-photo-picker">
          {preview
            ? <img className="adm-legend-preview" src={preview} alt="Selected photo" />
            : <span className="adm-legend-preview empty" aria-hidden="true" />}
          <div>
            <button type="button" className="adm-btn" onClick={() => fileRef.current?.click()} aria-describedby="legend-photo-label">
              {preview ? 'Replace photo' : 'Upload photo'}
            </button>
            <small>Landscape works best. JPG, PNG or WebP, up to 5 MB.</small>
          </div>
        </div>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={pickPhoto} />
      </div>

      <label className="adm-field"><span>The story <span className="adm-muted">(optional)</span></span>
        <textarea rows={7} value={form.story} onChange={(e) => set('story', e.target.value)} placeholder="Shown when someone opens the tile. Leave a blank line between paragraphs." />
      </label>

      <div className="adm-field-row">
        <label className="adm-field"><span>Read-more link <span className="adm-muted">(optional)</span></span>
          <input type="url" value={form.link_url} onChange={(e) => set('link_url', e.target.value)} placeholder="https://en.wikipedia.org/wiki/…" />
        </label>
        <label className="adm-field"><span>Link wording</span>
          <input value={form.link_label} onChange={(e) => set('link_label', e.target.value)} maxLength={40} placeholder="Read his obituary" />
        </label>
      </div>

      <label className="adm-check">
        <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} />
        <span>Show on the home page</span>
      </label>

      {error && <p className="adm-row-error" role="alert">{error}</p>}

      <div className="adm-btn-row adm-form-actions">
        <Link className="adm-btn" to="/admin/legends">Cancel</Link>
        <button type="submit" className="adm-btn primary" disabled={saving}>
          {saving ? 'Saving…' : initial.id ? 'Save changes' : 'Add legend'}
        </button>
      </div>
    </form>
  )
}
