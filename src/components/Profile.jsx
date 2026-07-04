import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'

export default function Profile({ session, profile, onSaved }) {
  const [form, setForm] = useState({
    full_name: '', grad_year: '', section: '', occupation: '', city: '', bio: '',
  })
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (profile) {
      setForm({
        full_name: profile.full_name || '',
        grad_year: profile.grad_year || '',
        section: profile.section || '',
        occupation: profile.occupation || '',
        city: profile.city || '',
        bio: profile.bio || '',
      })
    }
  }, [profile])

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); setSaved(false) }

  async function save() {
    setBusy(true); setError(null)
    const payload = { ...form, grad_year: form.grad_year ? Number(form.grad_year) : null }
    const { data, error } = await supabase
      .from('profiles')
      .update(payload)
      .eq('id', session.user.id)
      .select()
      .single()
    if (error) setError(error.message)
    else { onSaved(data); setSaved(true) }
    setBusy(false)
  }

  return (
    <section className="panel narrow">
      <h2 className="panel-title">My profile</h2>
      <p className="panel-sub">
        This is what other alumni see in the directory.
      </p>

      <label className="field"><span>Full name</span>
        <input value={form.full_name} onChange={(e) => set('full_name', e.target.value)} />
      </label>
      <div className="field-row">
        <label className="field"><span>Year left Eendrag</span>
          <input type="number" value={form.grad_year} onChange={(e) => set('grad_year', e.target.value)} placeholder="2024" />
        </label>
        <label className="field"><span>Section</span>
          <input value={form.section} onChange={(e) => set('section', e.target.value)} />
        </label>
      </div>
      <div className="field-row">
        <label className="field"><span>Occupation</span>
          <input value={form.occupation} onChange={(e) => set('occupation', e.target.value)} placeholder="Software engineer" />
        </label>
        <label className="field"><span>City</span>
          <input value={form.city} onChange={(e) => set('city', e.target.value)} placeholder="Cape Town" />
        </label>
      </div>
      <label className="field"><span>Bio</span>
        <textarea rows={3} value={form.bio} onChange={(e) => set('bio', e.target.value)} placeholder="What you've been up to since Eendrag…" />
      </label>

      {error && <p className="form-error">{error}</p>}
      {saved && <p className="form-notice">Profile saved.</p>}

      <button className="btn primary" onClick={save} disabled={busy}>
        {busy ? 'Saving…' : 'Save changes'}
      </button>
    </section>
  )
}
