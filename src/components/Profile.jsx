import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import { Avatar } from './Directory.jsx'
import { COUNTRIES, INDUSTRIES, SA_CITIES } from '../constants.js'
import PhotoCropper from './PhotoCropper.jsx'

const EMPTY = {
  full_name: '', grad_year: '', section: '',
  industry: '', occupation: '',
  company: '', city: '', country: 'South Africa',
  bio: '',
  linkedin_url: '',
  available_for_mentorship: false,
  mentorship_description: '',
  is_current_resident: false,
}

export default function Profile({ session, profile, onSaved }) {
  const [form, setForm] = useState(EMPTY)
  const [customIndustry, setCustomIndustry] = useState('')
  const [customCity, setCustomCity] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [cropFile, setCropFile] = useState(null)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)
  const fileRef = useRef(null)

  useEffect(() => {
    if (profile) {
      const isKnownIndustry = INDUSTRIES.includes(profile.industry)
      setForm({
        full_name: profile.full_name || '',
        grad_year: profile.grad_year || '',
        section: profile.section || '',
        industry: isKnownIndustry ? profile.industry : (profile.industry ? 'Other' : ''),
        occupation: profile.occupation || '',
        company: profile.company || '',
        city: profile.city || '',
        country: profile.country || 'South Africa',
        bio: profile.bio || '',
        linkedin_url: profile.linkedin_url || '',
        available_for_mentorship: !!profile.available_for_mentorship,
        mentorship_description: profile.mentorship_description || '',
        is_current_resident: !!profile.is_current_resident,
      })
      if (!isKnownIndustry && profile.industry) setCustomIndustry(profile.industry)
    }
  }, [profile])

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); setSaved(false) }

  const isSA = form.country === 'South Africa'

  // Migrate city values when country changes
  useEffect(() => {
    if (!isSA) {
      if (form.city && !SA_CITIES.includes(form.city)) {
        setCustomCity(form.city)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSA])

  function pickPhoto(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file later (e.g. after cancel)
    if (!file) return
    if (file.size > 8 * 1024 * 1024) {
      setError('Photo must be under 8MB.')
      return
    }
    setError(null)
    setCropFile(file)
  }

  async function uploadCroppedPhoto(blob) {
    setCropFile(null)
    setUploading(true); setError(null)
    const path = `${session.user.id}/avatar.jpg`

    const { error: upErr } = await supabase.storage
      .from('avatars')
      .upload(path, blob, { upsert: true, contentType: 'image/jpeg' })

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
    setError(null)

    if (!form.city.trim()) {
      setError('Please enter your city or town.')
      return
    }

    setBusy(true)
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

  async function deleteProfile() {
    if (!window.confirm('Are you sure you want to delete your account? This will permanently remove your profile, posts, messages and photos, and cannot be undone.')) {
      return
    }

    setBusy(true)
    setError(null)

    // This removes the underlying auth user (not just the profile row),
    // which cascades to delete all of the account's data. Once it's gone,
    // signing in again with the same email requires signing up from scratch.
    const { error } = await supabase.rpc('delete_own_account')

    if (error) {
      setError(error.message)
      setBusy(false)
    } else {
      await supabase.auth.signOut()
      window.location.reload()
    }
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
          <p className="hint">JPG, PNG or WebP, up to 8MB. You'll be able to reposition it next.</p>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            style={{ display: 'none' }}
            onChange={pickPhoto}
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
        <div className="select-wrap">
          <select value={form.industry} onChange={(e) => set('industry', e.target.value)}>
            <option value="">Select your industry</option>
            {INDUSTRIES.map((ind) => <option key={ind} value={ind}>{ind}</option>)}
            <option value="Other">Other (type your own)</option>
          </select>
        </div>
      </label>
      {form.industry === 'Other' && (
        <label className="field"><span>Type your industry</span>
          <input
            value={customIndustry}
            onChange={(e) => { setCustomIndustry(e.target.value); setSaved(false) }}
            placeholder="e.g. Technology, Healthcare, Finance"
          />
        </label>
      )}

      <label className="field"><span>Job title / Position</span>
        <input value={form.occupation} onChange={(e) => set('occupation', e.target.value)} placeholder="e.g. Software Engineer, Director, Student" />
      </label>

      <label className="field"><span>Company</span>
        <input value={form.company} onChange={(e) => set('company', e.target.value)} placeholder="Naspers" />
      </label>

      <label className="field"><span>Country</span>
        <div className="select-wrap">
          <select value={form.country} onChange={(e) => set('country', e.target.value)}>
            {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </label>

      <label className="field"><span>City / Town</span>
        <input value={form.city} onChange={(e) => set('city', e.target.value)} placeholder="e.g. Cape Town, London, New York" />
      </label>

      <label className="field"><span>LinkedIn URL</span>
        <input
          type="url"
          value={form.linkedin_url}
          onChange={(e) => set('linkedin_url', e.target.value)}
          placeholder="https://linkedin.com/in/yourname"
        />
      </label>

      <div className="checkbox-row">
        <input
          id="mentor-toggle"
          type="checkbox"
          checked={form.available_for_mentorship}
          onChange={(e) => set('available_for_mentorship', e.target.checked)}
        />
        <label htmlFor="mentor-toggle">Open to mentoring other Eendragters</label>
      </div>
      {form.available_for_mentorship && (
        <label className="field"><span>What kind of mentorship?</span>
          <input
            value={form.mentorship_description}
            onChange={(e) => set('mentorship_description', e.target.value)}
            placeholder="e.g. Anybody in the tech space"
          />
        </label>
      )}

      <label className="field"><span>Bio</span>
        <textarea rows={3} value={form.bio} onChange={(e) => set('bio', e.target.value)} placeholder="What you've been up to since Eendrag…" />
      </label>

      {error && <p className="form-error">{error}</p>}
      {saved && <p className="form-notice">Profile saved.</p>}

      <div style={{ display: 'flex', gap: '12px' }}>
        <button className="btn primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
        <button className="btn ghost" onClick={deleteProfile} disabled={busy} style={{ color: 'var(--error)' }}>
          Delete profile
        </button>
      </div>

      {cropFile && (
        <PhotoCropper
          file={cropFile}
          onCancel={() => setCropFile(null)}
          onSave={uploadCroppedPhoto}
        />
      )}
    </section>
  )
}
