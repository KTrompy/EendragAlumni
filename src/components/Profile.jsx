import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import { Avatar } from './Directory.jsx'
import { COUNTRIES, INDUSTRIES } from '../constants.js'

const EMPTY = {
  full_name: '', grad_year: '', section: '',
  industry: '', occupation: '', occupation_description: '',
  company: '', city: '', province: '', country: 'South Africa',
  bio: '',
  linkedin_url: '',
  is_current_resident: false,
}

export default function Profile({ session, profile, onSaved }) {
  const [form, setForm] = useState(EMPTY)
  const [customIndustry, setCustomIndustry] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)
  const fileRef = useRef(null)

  useEffect(() => {
    if (profile) {
      const isKnown = INDUSTRIES.includes(profile.industry)
      setForm({
        full_name: profile.full_name || '',
        grad_year: profile.grad_year || '',
        section: profile.section || '',
        industry: isKnown ? profile.industry : (profile.industry ? 'Other' : ''),
        occupation: profile.occupation || '',
        occupation_description: profile.occupation_description || '',
        company: profile.company || '',
        city: profile.city || '',
        province: profile.province || '',
        country: profile.country || 'South Africa',
        bio: profile.bio || '',
        linkedin_url: profile.linkedin_url || '',
        is_current_resident: !!profile.is_current_resident,
      })
      if (!isKnown && profile.industry) setCustomIndustry(profile.industry)
    }
  }, [profile])

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); setSaved(false) }

  async function uploadPhoto(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 3 * 1024 * 1024) {
      setError('Photo must be under 3MB.')
      return
    }
    setUploading(true); setError(null)
    const ext = file.name.split('.').pop().toLowerCase()
    const path = `${session.user.id}/avatar.${ext}`

    const { error: upErr } = await supabase.storage
      .from('avatars')
      .upload(path, file, { upsert: true })

    if (upErr) {
      setError(upErr.message)
      setUploading(false)
      return
    }

    const { data } = supabase.storage.from('avatars').getPublicUrl(path)
    const url = `${data.publicUrl}?t=${Date.now()}`

    const { data: updated, error: dbErr } = await supabase
      .from('profiles')
      .update({ avatar_url: url })
      .eq('id', session.user.id)
      .select()
      .single()

    if (dbErr) setError(dbErr.message)
    else onSaved(updated)
    setUploading(false)
  }

  async function save() {
    setBusy(true); setError(null)
    const industry = form.industry === 'Other' ? customIndustry.trim() : form.industry
    const payload = {
      ...form,
      industry,
      grad_year: form.grad_year ? Number(form.grad_year) : null,
      linkedin_url: form.linkedin_url.trim(),
    }
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
        This is what other Eendragters see on the wall and in the directory.
      </p>

      <div className="avatar-editor">
        <Avatar url={profile?.avatar_url} name={form.full_name} size={88} />
        <div>
          <button
            className="btn ghost"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? 'Uploading…' : profile?.avatar_url ? 'Change photo' : 'Add photo'}
          </button>
          <p className="hint">JPG or PNG, up to 3MB. Square or portrait crops best.</p>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            style={{ display: 'none' }}
            onChange={uploadPhoto}
          />
        </div>
      </div>

      <label className="field"><span>Full name</span>
        <input value={form.full_name} onChange={(e) => set('full_name', e.target.value)} />
      </label>

      <div className="checkbox-row">
        <input
          id="current-resident"
          type="checkbox"
          checked={form.is_current_resident}
          onChange={(e) => set('is_current_resident', e.target.checked)}
        />
        <label htmlFor="current-resident">
          I currently live in Eendrag (tick if you're still a resident, not yet an alumnus)
        </label>
      </div>

      <div className="field-row">
        <label className="field"><span>Year left / leaving Eendrag</span>
          <input type="number" value={form.grad_year} onChange={(e) => set('grad_year', e.target.value)} placeholder="2024" />
        </label>
        <label className="field"><span>Section</span>
          <input value={form.section} onChange={(e) => set('section', e.target.value)} />
        </label>
      </div>

      <label className="field"><span>Industry</span>
        <select value={form.industry} onChange={(e) => set('industry', e.target.value)}>
          <option value="">Select your industry</option>
          {INDUSTRIES.map((ind) => <option key={ind} value={ind}>{ind}</option>)}
          <option value="Other">Other (type your own)</option>
        </select>
      </label>
      {form.industry === 'Other' && (
        <div className="industry-other-row">
          <input
            value={customIndustry}
            onChange={(e) => { setCustomIndustry(e.target.value); setSaved(false) }}
            placeholder="Type your industry…"
          />
        </div>
      )}

      <div className="field-row">
        <label className="field"><span>Job title / Position</span>
          <input value={form.occupation} onChange={(e) => set('occupation', e.target.value)} placeholder="e.g. Software Engineer, Director, Student" />
        </label>
        <label className="field"><span>Seniority / Role level</span>
          <input value={form.occupation_description} onChange={(e) => set('occupation_description', e.target.value)} placeholder="e.g. Senior, Executive, Junior" />
        </label>
      </div>

      <label className="field"><span>Company / Organisation</span>
        <input value={form.company} onChange={(e) => set('company', e.target.value)} placeholder="Naspers" />
      </label>

      <div className="field-row">
        <label className="field"><span>City</span>
          <input value={form.city} onChange={(e) => set('city', e.target.value)} placeholder="Cape Town" />
        </label>
        <label className="field"><span>Province</span>
          <select value={form.province} onChange={(e) => set('province', e.target.value)}>
            <option value="">Select a province</option>
            <option>Western Cape</option>
            <option>Gauteng</option>
            <option>KwaZulu-Natal</option>
            <option>Eastern Cape</option>
            <option>Free State</option>
            <option>Limpopo</option>
            <option>Mpumalanga</option>
            <option>North West</option>
            <option>Northern Cape</option>
            <option>N/A (outside SA)</option>
          </select>
        </label>
      </div>

      <label className="field"><span>Country</span>
        <input
          list="country-list"
          value={form.country}
          onChange={(e) => set('country', e.target.value)}
          placeholder="Start typing…"
        />
        <datalist id="country-list">
          {COUNTRIES.map((c) => <option key={c} value={c} />)}
        </datalist>
      </label>

      <label className="field"><span>LinkedIn URL</span>
        <input
          type="url"
          value={form.linkedin_url}
          onChange={(e) => set('linkedin_url', e.target.value)}
          placeholder="https://linkedin.com/in/yourname"
        />
      </label>

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
