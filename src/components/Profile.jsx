import { useEffect, useRef, useState } from 'react'
import { supabase, deleteOwnAccount } from '../supabaseClient'
import { Avatar } from './Directory.jsx'
import { INDUSTRIES, SA_CITIES, EXPERTISE_OPTIONS, EXPERTISE_BY_INDUSTRY, SERVICES_OFFERED, BUSINESS_CATEGORIES, AVAILABILITY_OPTIONS, GEOGRAPHIC_FOCUS } from '../constants.js'
import PhotoCropper from './PhotoCropper.jsx'
import { geocodeCity } from '../geocode.js'
import CityAutocomplete from './CityAutocomplete.jsx'
import CountryAutocomplete from './CountryAutocomplete.jsx'
import ListAutocomplete from './ListAutocomplete.jsx'
import MultiSelectAutocomplete from './MultiSelectAutocomplete.jsx'
import ClearableInput from './ClearableInput.jsx'
import PhoneInput from './PhoneInput.jsx'
import DeleteButton from './DeleteButton.jsx'
import { normalizeExpertise, formatExperienceRange, formatExperienceDuration } from '../utils.js'

const EMPTY = {
  full_name: '', grad_year: '', degree: '',
  industry: '', occupation: '',
  company: '', city: '', country: 'South Africa',
  bio: '',
  linkedin_url: '', phone: '',
  is_current_resident: false,
  expertise: [],
  services_offered: [],
  business_website: '',
  business_categories: [],
  is_open_to_opportunities: true,
  availability: '',
  geographic_focus: [],
  experience: [],
  // keeping looking_to_connect for backward compatibility but not using in UI
  looking_to_connect: [],
}

const EMPTY_EXPERIENCE_ENTRY = { title: '', company: '', industry: '', from: '', to: '' }

// Client-only identity for an experience entry — the DB just stores a plain
// jsonb array with no ids, but the editor needs something stable to key
// list items and track which card is expanded by, that survives entries
// being added/removed/reordered. Stripped back out before saving.
function makeExperienceKey() {
  return (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `exp-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function monthNow() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
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
  // Which experience cards are showing the full edit form rather than the
  // collapsed LinkedIn-style summary. Tracked by each entry's client-only
  // _key rather than array index, so it doesn't get scrambled when entries
  // are added, removed or reordered.
  const [expandedExperience, setExpandedExperience] = useState(() => new Set())
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
        phone: profile.phone || '',
        is_current_resident: !!profile.is_current_resident,
        expertise: normalizeExpertise(profile.expertise),
        services_offered: Array.isArray(profile.services_offered) ? profile.services_offered : [],
        business_website: profile.business_website || '',
        business_categories: Array.isArray(profile.business_categories) ? profile.business_categories : [],
        is_open_to_opportunities: profile.is_open_to_opportunities !== false,
        availability: profile.availability || '',
        geographic_focus: Array.isArray(profile.geographic_focus) ? profile.geographic_focus : [],
        experience: (Array.isArray(profile.experience) ? profile.experience : [])
          .map((entry) => ({ ...entry, _key: makeExperienceKey() })),
        looking_to_connect: Array.isArray(profile.looking_to_connect) ? profile.looking_to_connect : [],
      })
      if (!isKnownIndustry && profile.industry) setCustomIndustry(profile.industry)
      setCityCoords(null)
      setDirty(false)
      // Existing entries load collapsed as summary cards; only newly-added
      // ones (via addExperience) start expanded.
      setExpandedExperience(new Set())
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

  // Changing industry also drops any picked expertise tags that came from
  // the old industry's list but don't belong to the new one, so switching
  // from e.g. "Legal" to "Software Engineering & Development" doesn't leave
  // "Litigation" behind. Free-typed ("Other") tags aren't tied to any
  // industry's list, so they're always kept.
  function setIndustry(value) {
    setForm((f) => {
      const prevOptions = EXPERTISE_BY_INDUSTRY[f.industry] || EXPERTISE_OPTIONS
      const nextOptions = EXPERTISE_BY_INDUSTRY[value] || EXPERTISE_OPTIONS
      return {
        ...f,
        industry: value,
        expertise: f.expertise.filter((e) => nextOptions.includes(e) || !prevOptions.includes(e)),
      }
    })
    setSaved(false)
    setDirty(true)
  }

  function toggleTag(field, tag) {
    setForm((f) => {
      const arr = f[field] || []
      const newArr = arr.includes(tag) ? arr.filter(t => t !== tag) : [...arr, tag]
      return { ...f, [field]: newArr }
    })
    setSaved(false)
    setDirty(true)
  }

  // Experience: a free-form, add/remove list of past roles rather than a
  // single job title/company — most alumni have more than one. Kept
  // separate from the single "current role" fields above (which drive the
  // directory card and quick filters) so this can grow without touching
  // those.
  function addExperience() {
    const entryKey = makeExperienceKey()
    setForm((f) => ({ ...f, experience: [...f.experience, { ...EMPTY_EXPERIENCE_ENTRY, _key: entryKey }] }))
    setExpandedExperience((s) => new Set(s).add(entryKey))
    setSaved(false)
    setDirty(true)
  }
  function removeExperience(entryKey) {
    setForm((f) => ({ ...f, experience: f.experience.filter((e) => e._key !== entryKey) }))
    setExpandedExperience((s) => {
      if (!s.has(entryKey)) return s
      const next = new Set(s)
      next.delete(entryKey)
      return next
    })
    setSaved(false)
    setDirty(true)
  }
  function setExperienceField(entryKey, key, value) {
    setForm((f) => ({
      ...f,
      experience: f.experience.map((entry) => (entry._key === entryKey ? { ...entry, [key]: value } : entry)),
    }))
    setSaved(false)
    setDirty(true)
  }
  function toggleExperienceExpanded(entryKey) {
    setExpandedExperience((s) => {
      const next = new Set(s)
      if (next.has(entryKey)) next.delete(entryKey)
      else next.add(entryKey)
      return next
    })
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

    // Drop fully-blank experience rows (e.g. an "+ Add" that was never
    // filled in), but any row with something in it needs at least a
    // company name to be worth keeping.
    const cleanedExperience = form.experience
      .filter((e) => e.title.trim() || e.company.trim() || e.industry.trim() || e.from.trim() || e.to.trim())
    if (cleanedExperience.some((e) => !e.company.trim())) {
      setError('Please add a company name for each experience entry, or remove the incomplete one.')
      return false
    }

    // Reorder most-recent-first (current roles, then past roles by end
    // date) — like LinkedIn, so entries don't just sit in whatever order
    // they were added, and so the read-only profile timeline reads as a
    // sensible career history without needing its own sort. `_key` is a
    // client-only id for tracking which card is expanded in this editor;
    // strip it before it ever reaches the database.
    const sortableTo = (e) => (e.to ? e.to : '9999-99') // blank `to` = current, sorts first
    const sortedExperience = [...cleanedExperience].sort((a, b) => {
      const byEnd = sortableTo(b).localeCompare(sortableTo(a))
      if (byEnd !== 0) return byEnd
      return (b.from || '').localeCompare(a.from || '')
    })
    const finalExperience = sortedExperience.map(({ _key, ...entry }) => entry)

    setBusy(true)
    const industry = form.industry === 'Other' ? customIndustry.trim() : form.industry

    const payload = {
      ...form,
      industry,
      experience: finalExperience,
      grad_year: form.grad_year ? Number(form.grad_year) : null,
      // linkedin_url/phone used to be the only two fields trimmed here —
      // everything else (name, degree, occupation, company, city, bio,
      // business website) saved with whatever leading/trailing whitespace
      // someone typed or pasted in, inconsistent with Onboarding.jsx, which
      // does trim full_name. Trimming the same free-text fields here keeps
      // the directory/search and this profile's own display from showing
      // stray whitespace depending on which flow last touched the row.
      full_name: form.full_name.trim(),
      degree: form.degree.trim(),
      occupation: form.occupation.trim(),
      company: form.company.trim(),
      city: form.city.trim(),
      bio: form.bio.trim(),
      linkedin_url: form.linkedin_url.trim(),
      phone: form.phone.trim(),
      business_website: form.business_website.trim(),
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

    // Calls a server-side Edge Function (using the Admin API) to actually
    // remove the auth user — not just the profile row. Deleting the auth
    // user cascades to delete all of the account's data. Once it's gone,
    // signing in again with the same email requires signing up from
    // scratch. See deleteOwnAccount() in supabaseClient.js — Settings.jsx
    // uses this same helper so the two "Delete account" entry points in
    // the app can't drift out of sync again.
    const { error } = await deleteOwnAccount()

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
      <div className="profile-section profile-section-career">
        <h3 className="profile-section-title">Career</h3>

        <label className="field"><span>Industry</span>
          <ListAutocomplete
            value={form.industry}
            onChange={setIndustry}
            options={INDUSTRIES}
            placeholder="Search or type your industry"
            clearable
          />
        </label>

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

      {/* Experience Section — collapsed, LinkedIn-style summary cards that
          expand into the edit form one at a time, rather than every entry's
          full form sitting open at once. */}
      <div className="profile-section profile-section-experience">
        <h3 className="profile-section-title"><ExperienceIcon /> Experience</h3>

        {form.experience.length === 0 && (
          <p className="experience-empty">
            Add the roles you've held since Eendrag — they'll show up as a career timeline on your profile.
          </p>
        )}

        {form.experience.map((entry) => {
          const showCompanyError = !entry.company.trim() && (entry.title.trim() || entry.industry.trim() || entry.from.trim() || entry.to.trim())
          // An invalid entry (missing the required company name) always
          // shows expanded so the inline error stays visible — collapsing
          // it would hide the one thing the person needs to fix.
          const isExpanded = expandedExperience.has(entry._key) || showCompanyError
          const isCurrent = !entry.to

          if (!isExpanded) {
            const range = formatExperienceRange(entry.from, entry.to)
            const duration = formatExperienceDuration(entry.from, entry.to)
            return (
              <div className="experience-summary-card" key={entry._key}>
                <span className="experience-summary-icon" aria-hidden="true"><ExperienceIcon /></span>
                <button
                  type="button"
                  className="experience-summary-body"
                  onClick={() => toggleExperienceExpanded(entry._key)}
                >
                  <span className="experience-timeline-title">{entry.title || entry.company || 'Untitled role'}</span>
                  {entry.title && entry.company && <span className="experience-timeline-company">{entry.company}</span>}
                  <span className="experience-timeline-meta">
                    {range && <span className="experience-timeline-range">{range}{duration && ` · ${duration}`}</span>}
                    {entry.industry && <span className="experience-timeline-industry">{entry.industry}</span>}
                  </span>
                </button>
                <div className="experience-summary-actions">
                  <button
                    type="button"
                    className="icon-btn-edit"
                    onClick={() => toggleExperienceExpanded(entry._key)}
                    aria-label="Edit experience"
                    title="Edit"
                  >
                    <PencilIcon />
                  </button>
                  <DeleteButton
                    onConfirm={() => removeExperience(entry._key)}
                    label="Delete experience"
                    title="Delete this experience entry?"
                    message="This will remove it from your profile. This can't be undone."
                    className="icon-btn-delete"
                  />
                </div>
              </div>
            )
          }

          return (
            <div className="experience-entry" key={entry._key}>
              <div className="field-row">
                <label className="field"><span>Title</span>
                  <ClearableInput
                    value={entry.title}
                    onChange={(e) => setExperienceField(entry._key, 'title', e.target.value)}
                    onClear={() => setExperienceField(entry._key, 'title', '')}
                    placeholder="e.g. Marketing Manager"
                  />
                </label>
                <label className="field"><span>Company name</span>
                  <ClearableInput
                    value={entry.company}
                    onChange={(e) => setExperienceField(entry._key, 'company', e.target.value)}
                    onClear={() => setExperienceField(entry._key, 'company', '')}
                    placeholder="e.g. Naspers"
                    className={showCompanyError ? 'input-error' : ''}
                  />
                  {showCompanyError && <span className="field-error">Company name is required</span>}
                </label>
              </div>

              <label className="field"><span>Industry</span>
                <ListAutocomplete
                  value={entry.industry}
                  onChange={(v) => setExperienceField(entry._key, 'industry', v)}
                  options={INDUSTRIES}
                  placeholder="Search or type an industry"
                  clearable
                />
              </label>

              <div className="field-row">
                <label className="field"><span>From</span>
                  <input
                    type="month"
                    className="experience-date"
                    value={entry.from}
                    onChange={(e) => setExperienceField(entry._key, 'from', e.target.value)}
                  />
                </label>
                <label className="field"><span>To</span>
                  {isCurrent ? (
                    <div className="experience-present-chip">Present</div>
                  ) : (
                    <input
                      type="month"
                      className="experience-date"
                      value={entry.to}
                      onChange={(e) => setExperienceField(entry._key, 'to', e.target.value)}
                    />
                  )}
                </label>
              </div>

              <label className="experience-current-check">
                <input
                  type="checkbox"
                  checked={isCurrent}
                  onChange={(e) => setExperienceField(entry._key, 'to', e.target.checked ? '' : monthNow())}
                />
                <span>I currently work here</span>
              </label>

              <div className="experience-entry-actions">
                <button type="button" className="experience-remove" onClick={() => removeExperience(entry._key)}>
                  Remove
                </button>
                <button type="button" className="experience-done" onClick={() => toggleExperienceExpanded(entry._key)}>
                  Done
                </button>
              </div>
            </div>
          )
        })}

        <button type="button" className="experience-add" onClick={addExperience}>
          <PlusIcon /> Add position
        </button>
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
      <div className="profile-section profile-section-connect">
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

        <label className="field"><span>Phone number</span>
          <PhoneInput value={form.phone} onChange={(v) => set('phone', v)} />
          <span className="hint">Who can see this is controlled in Settings → Privacy.</span>
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
                <ListAutocomplete
                  value={form.availability}
                  onChange={(value) => set('availability', value)}
                  options={AVAILABILITY_OPTIONS}
                  placeholder="Search your availability"
                  clearable
                />
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

            {/* Main expertise — options are scoped to whichever industry is selected above */}
            <label className="field"><span>Main areas of expertise</span>
              <MultiSelectAutocomplete
                values={form.expertise}
                onChange={(value) => set('expertise', value)}
                options={EXPERTISE_BY_INDUSTRY[form.industry] || EXPERTISE_OPTIONS}
                placeholder={form.industry ? 'Search your expertise, or type your own' : 'Pick an industry above to see relevant options'}
                allowCustom
              />
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

function ExperienceIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
      <path d="M2 13h20" />
    </svg>
  )
}

function PencilIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}
