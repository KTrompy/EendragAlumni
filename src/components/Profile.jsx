import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import { Avatar } from './Directory.jsx'
import { INDUSTRIES, SA_CITIES } from '../constants.js'
import PhotoCropper from './PhotoCropper.jsx'
import { geocodeCity } from '../geocode.js'
import CityAutocomplete from './CityAutocomplete.jsx'
import CountryAutocomplete from './CountryAutocomplete.jsx'
import ClearableInput from './ClearableInput.jsx'

const EMPTY = {
  full_name: '', grad_year: '', degree: '',
  industry: '', occupation: '',
  company: '', city: '', country: 'South Africa',
  bio: '',
  linkedin_url: '',
  available_for_mentorship: false,
  mentorship_description: '',
  is_current_resident: false,
}

export default function Profile({ session, profile, onSaved, onDirtyChange, saveRef }) {
  const [form, setForm] = useState(EMPTY)
  const [customIndustry, setCustomIndustry] = useState('')
  const [customCity, setCustomCity] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [cropFile, setCropFile] = useState(null)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)
  const [geoWarning, setGeoWarning] = useState(false)
  const [cityCoords, setCityCoords] = useState(null) // set when a dropdown suggestion is picked
  const [dirty, setDirty] = useState(false)
  const fileRef = useRef(null)

  useEffect(() => {
    if (profile) {
      const isKnownIndustry = INDUSTRIES.includes(profile.industry)
      setForm({
        full_name: profile.full_name || '',
        grad_year: profile.grad_year || '',
        degree: profile.degree || '',
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
      setCityCoords(null)
      setDirty(false)
    }
  }, [profile])

  // Let the parent (App) know whenever there are unsaved edits, so it can
  // warn before letting someone navigate away and lose them.
  useEffect(() => { onDirtyChange?.(dirty) }, [dirty]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the parent's ref pointing at the latest save() closure, so App can
  // trigger a save (e.g. from the "leave without saving?" prompt) without
  // this component needing to know anything about navigation.
  useEffect(() => { if (saveRef) saveRef.current = save }) // eslint-disable-line react-hooks/exhaustive-deps

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); setSaved(false); setDirty(true) }

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

  // Returns true/false so callers (including App's "leave without saving?"
  // prompt) can tell whether it's safe to navigate away afterward.
  async function save() {
    setError(null)
    setGeoWarning(false)

    if (!form.city.trim()) {
      setError('Please enter your city or town.')
      return false
    }

    setBusy(true)
    const industry = form.industry === 'Other' ? customIndustry.trim() : form.industry

    const payload = {
      ...form,
      industry,
      grad_year: form.grad_year ? Number(form.grad_year) : null,
      linkedin_url: form.linkedin_url.trim(),
    }

    // Re-geocode when the city/country changed, or when this profile simply
    // doesn't have coordinates yet (e.g. the city was set before the map
    // feature existed). Skips the network call on unrelated edits — like
    // tweaking a bio — once a pin is already in place. Powers the Alumni
    // Map "where are we all now" view; if it fails (offline, no match) we
    // just save without a pin instead of blocking the save.
    const cityMoved = form.city.trim() !== (profile?.city || '').trim()
      || form.country.trim() !== (profile?.country || '').trim()
    const missingCoords = profile?.lat == null || profile?.lng == null
    if (cityCoords) {
      // Picked straight from the suggestions dropdown — already a
      // confirmed, geocodable place, no need to look it up again.
      payload.lat = cityCoords.lat
      payload.lng = cityCoords.lng
    } else if (cityMoved || missingCoords) {
      const coords = await geocodeCity(form.city, form.country)
      payload.lat = coords?.lat ?? null
      payload.lng = coords?.lng ?? null
      if (!coords) setGeoWarning(true)
    }

    const { data, error } = await supabase
      .from('profiles')
      .update(payload)
      .eq('id', session.user.id)
      .select()
      .single()
    setBusy(false)
    if (error) { setError(error.message); return false }
    onSaved(data)
    setSaved(true)
    setDirty(false)
    return true
  }

  async function deleteProfile() {
    if (!window.confirm('Are you sure you want to delete your account? This will permanently remove your profile, posts, messages and photos, and cannot be undone.')) {
      return
    }

    setBusy(true)
    setError(null)

    // This calls a server-side Edge Function (using the Admin API) to
    // actually remove the auth user — not just the profile row. Deleting
    // the auth user cascades to delete all of the account's data. Once
    // it's gone, signing in again with the same email requires signing
    // up from scratch.
    const { error } = await supabase.functions.invoke('delete-account')

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

      <div className="profile-section">
        <h3 className="profile-section-title">Basic info</h3>
        <label className="field"><span>Full name</span>
          <ClearableInput
            value={form.full_name}
            onChange={(e) => set('full_name', e.target.value)}
            onClear={() => set('full_name', '')}
          />
        </label>

        <div className="field-row">
          <label className="field"><span>Year left / leaving Eendrag</span>
            <ClearableInput
              type="number"
              value={form.grad_year}
              onChange={(e) => set('grad_year', e.target.value)}
              onClear={() => set('grad_year', '')}
              placeholder="2024"
            />
          </label>
          <label className="field"><span>Degree studied</span>
            <ClearableInput
              value={form.degree}
              onChange={(e) => set('degree', e.target.value)}
              onClear={() => set('degree', '')}
              placeholder="e.g. BCom Accounting, BEng Mechanical"
            />
          </label>
        </div>

        <div className="field">
          <span>Current status</span>
          <div className="onboarding-choice-row profile-choice-row">
            <button
              type="button"
              className={!form.is_current_resident ? 'onboarding-choice on' : 'onboarding-choice'}
              onClick={() => set('is_current_resident', false)}
            >
              Alumnus
            </button>
            <button
              type="button"
              className={form.is_current_resident ? 'onboarding-choice on' : 'onboarding-choice'}
              onClick={() => set('is_current_resident', true)}
            >
              Still living in Eendrag
            </button>
          </div>
        </div>
      </div>

      <div className="profile-section">
        <h3 className="profile-section-title">Career</h3>
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
            <ClearableInput
              value={customIndustry}
              onChange={(e) => { setCustomIndustry(e.target.value); setSaved(false); setDirty(true) }}
              onClear={() => { setCustomIndustry(''); setSaved(false); setDirty(true) }}
              placeholder="e.g. Technology, Healthcare, Finance"
            />
          </label>
        )}

        <label className="field"><span>Job title / Position</span>
          <ClearableInput
            value={form.occupation}
            onChange={(e) => set('occupation', e.target.value)}
            onClear={() => set('occupation', '')}
            placeholder="e.g. Software Engineer, Director, Student"
          />
        </label>

        <label className="field"><span>Company</span>
          <ClearableInput
            value={form.company}
            onChange={(e) => set('company', e.target.value)}
            onClear={() => set('company', '')}
            placeholder="Naspers"
          />
        </label>
      </div>

      <div className="profile-section profile-section-location">
        <h3 className="profile-section-title">Location</h3>
        <label className="field"><span>Country</span>
          <CountryAutocomplete
            value={form.country}
            onChange={(v) => set('country', v)}
            placeholder="Start typing a country…"
            clearable
          />
        </label>

        <label className="field"><span>City / Town</span>
          <CityAutocomplete
            value={form.city}
            country={form.country}
            onChange={(v) => set('city', v)}
            onSelectCoords={setCityCoords}
            placeholder="e.g. Cape Town, London, New York"
          />
          <span className="hint">Start typing and choose a suggestion from the list — this field only accepts real places, so you'll always show up correctly on the Alumni Map.</span>
        </label>
      </div>

      <div className="profile-section">
        <h3 className="profile-section-title">Online &amp; mentorship</h3>
        <label className="field"><span>LinkedIn URL</span>
          <ClearableInput
            type="url"
            value={form.linkedin_url}
            onChange={(e) => set('linkedin_url', e.target.value)}
            onClear={() => set('linkedin_url', '')}
            placeholder="https://linkedin.com/in/yourname"
          />
        </label>

        <div className="field">
          <span>Open to mentoring other Eendragters?</span>
          <div className="onboarding-choice-row profile-choice-row">
            <button
              type="button"
              className={!form.available_for_mentorship ? 'onboarding-choice on' : 'onboarding-choice'}
              onClick={() => set('available_for_mentorship', false)}
            >
              Not right now
            </button>
            <button
              type="button"
              className={form.available_for_mentorship ? 'onboarding-choice on' : 'onboarding-choice'}
              onClick={() => set('available_for_mentorship', true)}
            >
              🤝 Yes, happy to help
            </button>
          </div>
        </div>
        {form.available_for_mentorship && (
          <label className="field"><span>What kind of mentorship?</span>
            <ClearableInput
              value={form.mentorship_description}
              onChange={(e) => set('mentorship_description', e.target.value)}
              onClear={() => set('mentorship_description', '')}
              placeholder="e.g. Anybody in the tech space"
            />
          </label>
        )}
      </div>

      <div className="profile-section">
        <h3 className="profile-section-title">Bio</h3>
        <label className="field"><span>Bio</span>
          <ClearableInput
            as="textarea"
            rows={3}
            value={form.bio}
            onChange={(e) => set('bio', e.target.value)}
            onClear={() => set('bio', '')}
            placeholder="What you've been up to since Eendrag…"
          />
        </label>
      </div>

      {error && <p className="form-error">{error}</p>}
      {geoWarning && (
        <p className="form-warning">
          Saved — but we couldn't find "{form.city}" to place you on the Alumni Map. Double-check the spelling, or pick a suggestion from the dropdown next time.
        </p>
      )}

      <div className="profile-actions">
        <button className="btn primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
        <button className="btn ghost" onClick={deleteProfile} disabled={busy} style={{ color: 'var(--error)' }}>
          Delete profile
        </button>
        {saved && (
          <span className="profile-saved-chip">
            <span className="check">✓</span>
            Profile saved
          </span>
        )}
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
