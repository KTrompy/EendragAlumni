import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import { Avatar } from './Directory.jsx'
import { INDUSTRIES, SA_CITIES, EXPERTISE_OPTIONS, SERVICES_OFFERED, BUSINESS_CATEGORIES, AVAILABILITY_OPTIONS, GEOGRAPHIC_FOCUS } from '../constants.js'
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
  is_current_resident: false,
  expertise: '',
  services_offered: [],
  business_website: '',
  business_categories: [],
  is_open_to_opportunities: true,
  availability: '',
  geographic_focus: [],
  // keeping looking_to_connect for backward compatibility but not using in UI
  looking_to_connect: [],
}

export default function Profile({ session, profile, onSaved, onDirtyChange, saveRef, onNavigateHome }) {
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
  const [showBusinessProfile, setShowBusinessProfile] = useState(false)
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
        is_current_resident: !!profile.is_current_resident,
        expertise: profile.expertise || '',
        services_offered: Array.isArray(profile.services_offered) ? profile.services_offered : [],
        business_website: profile.business_website || '',
        business_categories: Array.isArray(profile.business_categories) ? profile.business_categories : [],
        is_open_to_opportunities: profile.is_open_to_opportunities !== false,
        availability: profile.availability || '',
        geographic_focus: Array.isArray(profile.geographic_focus) ? profile.geographic_focus : [],
        looking_to_connect: Array.isArray(profile.looking_to_connect) ? profile.looking_to_connect : [],
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

  function toggleTag(field, tag) {
    setForm((f) => {
      const arr = f[field] || []
      const newArr = arr.includes(tag) ? arr.filter(t => t !== tag) : [...arr, tag]
      return { ...f, [field]: newArr }
    })
    setSaved(false)
    setDirty(true)
  }

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
    <section className="panel narrow profile-page">
      {/* Header */}
      <div className="profile-header-with-back">
        <button className="profile-back-btn" onClick={onNavigateHome} aria-label="Back to home">
          ← Home
        </button>
        <div>
          <h2 className="panel-title">My profile</h2>
          <p className="panel-sub">
            Control how you appear in the directory and what other Eendragters see.
          </p>
        </div>
      </div>

      {/* Photo Section - Hero */}
      <div className="profile-photo-section">
        <div className="profile-photo-card">
          <Avatar url={profile?.avatar_url} name={form.full_name} size={120} />
          <div className="profile-photo-actions">
            <button
              className="btn primary small"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? 'Uploading…' : profile?.avatar_url ? 'Change' : 'Add photo'}
            </button>
            <p className="profile-photo-hint">JPG, PNG or WebP • Max 8MB</p>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            style={{ display: 'none' }}
            onChange={pickPhoto}
          />
        </div>
      </div>

      {/* Basic Info Section */}
      <div className="profile-section">
        <h3 className="profile-section-title">About you</h3>

        <label className="field"><span>Full name</span>
          <ClearableInput
            value={form.full_name}
            onChange={(e) => set('full_name', e.target.value)}
            onClear={() => set('full_name', '')}
          />
        </label>

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

        <div className="field-row">
          <label className="field"><span>Graduation year</span>
            <ClearableInput
              type="number"
              value={form.grad_year}
              onChange={(e) => set('grad_year', e.target.value)}
              onClear={() => set('grad_year', '')}
              placeholder="2024"
            />
          </label>
          <label className="field"><span>Degree</span>
            <ClearableInput
              value={form.degree}
              onChange={(e) => set('degree', e.target.value)}
              onClear={() => set('degree', '')}
              placeholder="e.g. BCom Accounting"
            />
          </label>
        </div>

        <div className="field">
          <span>Status</span>
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
              Still here
            </button>
          </div>
        </div>
      </div>

      {/* Career Section */}
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
          <label className="field"><span>Your industry</span>
            <ClearableInput
              value={customIndustry}
              onChange={(e) => { setCustomIndustry(e.target.value); setSaved(false); setDirty(true) }}
              onClear={() => { setCustomIndustry(''); setSaved(false); setDirty(true) }}
              placeholder="e.g. Technology, Healthcare, Finance"
            />
          </label>
        )}

        <div className="field-row">
          <label className="field"><span>Job title</span>
            <ClearableInput
              value={form.occupation}
              onChange={(e) => set('occupation', e.target.value)}
              onClear={() => set('occupation', '')}
              placeholder="e.g. Software Engineer"
            />
          </label>
          <label className="field"><span>Company</span>
            <ClearableInput
              value={form.company}
              onChange={(e) => set('company', e.target.value)}
              onClear={() => set('company', '')}
              placeholder="e.g. Naspers"
            />
          </label>
        </div>
      </div>

      {/* Location Section */}
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
          <span className="hint">Start typing and choose from suggestions</span>
        </label>
      </div>

      {/* Connect Section */}
      <div className="profile-section">
        <h3 className="profile-section-title">Connect</h3>

        <label className="field"><span>LinkedIn URL</span>
          <ClearableInput
            type="url"
            value={form.linkedin_url}
            onChange={(e) => set('linkedin_url', e.target.value)}
            onClear={() => set('linkedin_url', '')}
            placeholder="https://linkedin.com/in/yourname"
          />
        </label>
      </div>

      {/* Business Profile - Collapsible */}
      <div className="profile-section">
        <button
          className="profile-business-toggle"
          onClick={() => setShowBusinessProfile(!showBusinessProfile)}
        >
          <span className="profile-business-title">Business profile</span>
          <span className={`toggle-arrow ${showBusinessProfile ? 'open' : ''}`}>▼</span>
        </button>

        {showBusinessProfile && (
          <div className="profile-business-content">
            {/* Quick discovery toggles */}
            <div className="field">
              <span>Are you open to business opportunities?</span>
              <div className="onboarding-choice-row profile-choice-row">
                <button
                  type="button"
                  className={form.is_open_to_opportunities ? 'onboarding-choice on' : 'onboarding-choice'}
                  onClick={() => set('is_open_to_opportunities', true)}
                >
                  Yes, reach out
                </button>
                <button
                  type="button"
                  className={!form.is_open_to_opportunities ? 'onboarding-choice on' : 'onboarding-choice'}
                  onClick={() => set('is_open_to_opportunities', false)}
                >
                  Not right now
                </button>
              </div>
            </div>

            <div className="field-row">
              <label className="field"><span>Availability</span>
                <div className="select-wrap">
                  <select value={form.availability} onChange={(e) => set('availability', e.target.value)}>
                    <option value="">Select your availability</option>
                    {AVAILABILITY_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                </div>
              </label>

              <div className="field">
                <span>Geographic focus</span>
                <div className="tags-grid compact">
                  {GEOGRAPHIC_FOCUS.map((geo) => (
                    <button
                      key={geo}
                      type="button"
                      className={`tag-btn ${form.geographic_focus.includes(geo) ? 'selected' : ''}`}
                      onClick={() => toggleTag('geographic_focus', geo)}
                    >
                      {geo}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Main expertise */}
            <label className="field"><span>Main area of expertise</span>
              <div className="select-wrap">
                <select value={form.expertise} onChange={(e) => set('expertise', e.target.value)}>
                  <option value="">Select your expertise</option>
                  {EXPERTISE_OPTIONS.map((exp) => <option key={exp} value={exp}>{exp}</option>)}
                </select>
              </div>
            </label>

            {/* Services & opportunities offered */}
            <div className="field">
              <span>What can you offer to other Eendragters?</span>
              <div className="tags-grid compact">
                {SERVICES_OFFERED.map((service) => (
                  <button
                    key={service}
                    type="button"
                    className={`tag-btn ${form.services_offered.includes(service) ? 'selected' : ''}`}
                    onClick={() => toggleTag('services_offered', service)}
                  >
                    {service}
                  </button>
                ))}
              </div>
            </div>

            {/* Business website */}
            <label className="field"><span>Business website or portfolio (optional)</span>
              <ClearableInput
                type="url"
                value={form.business_website}
                onChange={(e) => set('business_website', e.target.value)}
                onClear={() => set('business_website', '')}
                placeholder="https://yourwebsite.com"
              />
            </label>
          </div>
        )}
      </div>

      {/* Status messages */}
      {error && <p className="form-error">{error}</p>}
      {geoWarning && (
        <p className="form-warning">
          Saved — but couldn't locate "{form.city}" for the Alumni Map. Double-check the spelling.
        </p>
      )}

      {/* Actions */}
      <div className="profile-actions">
        <button className="btn primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
        <button className="btn ghost" onClick={() => supabase.auth.signOut()} disabled={busy}>
          Sign out
        </button>
        <button className="btn ghost delete-danger" onClick={deleteProfile} disabled={busy}>
          Delete account
        </button>
        {saved && (
          <span className="profile-saved-chip">
            <span className="check">✓</span>
            Saved
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
