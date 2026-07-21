import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import {
  INDUSTRIES, EXPERTISE_OPTIONS, EXPERTISE_BY_INDUSTRY, SERVICES_OFFERED,
  AVAILABILITY_OPTIONS, GEOGRAPHIC_FOCUS,
} from '../constants.js'
import { geocodeCity } from '../geocode.js'
import { normalizeExpertise, isValidGradYear, isSafeHttpUrl } from '../utils.js'
import { Avatar } from './Directory.jsx'
import PhotoCropper from './PhotoCropper.jsx'
import CityAutocomplete from './CityAutocomplete.jsx'
import CountryAutocomplete from './CountryAutocomplete.jsx'
import MultiSelectAutocomplete from './MultiSelectAutocomplete.jsx'

// One question per screen, skip-friendly, saved in a single write at the
// end. Shown full-screen (like Auth) the first time a member logs in with
// no name on file yet — see App.jsx. Mirrors every question the Profile
// page can ask, including its collapsible "Mentoring" section
// (opportunities/availability/expertise/services/geography/website), so
// nothing is left for someone to discover only by opening My Profile later.
const QUESTION_KEYS = [
  'name', 'status', 'year', 'degree', 'industry', 'occupation',
  'company', 'country', 'city', 'linkedin', 'bio',
  'opportunities', 'availability', 'expertise', 'services', 'geography', 'website',
  'photo',
]
const STEPS = ['intro', ...QUESTION_KEYS, 'done']

// Closing the tab (or the phone locking) partway through used to lose
// every answer given so far, since the only write happened at the very end
// (see finishSave). Progress is now mirrored to localStorage as it's
// entered, and restored on mount if the person comes back before finishing
// — same idea as Feed's post-composer draft autosave.
function draftKeyFor(userId) { return `eendrag-onboarding-draft-${userId}` }

// Reads whatever draft (if any) was saved for this user, so both initial
// state values below can pull from the same parsed object without hitting
// localStorage/JSON.parse twice.
function loadDraft(userId) {
  try {
    return JSON.parse(localStorage.getItem(draftKeyFor(userId)) || 'null')
  } catch {
    return null
  }
}

export default function Onboarding({ session, profile, onDone }) {
  const draftKey = draftKeyFor(session.user.id)
  const draft = loadDraft(session.user.id)
  const [stepIndex, setStepIndex] = useState(() => (Number.isInteger(draft?.stepIndex) ? draft.stepIndex : 0))
  const [form, setForm] = useState(() => ({
    full_name: draft?.form?.full_name ?? (profile?.full_name || ''),
    is_current_resident: draft?.form?.is_current_resident ?? !!profile?.is_current_resident,
    grad_year: draft?.form?.grad_year ?? (profile?.grad_year || ''),
    degree: draft?.form?.degree ?? (profile?.degree || ''),
    industry: draft?.form?.industry ?? (INDUSTRIES.includes(profile?.industry) ? profile.industry : (profile?.industry ? 'Other' : '')),
    occupation: draft?.form?.occupation ?? (profile?.occupation || ''),
    company: draft?.form?.company ?? (profile?.company || ''),
    country: draft?.form?.country ?? (profile?.country || 'South Africa'),
    city: draft?.form?.city ?? (profile?.city || ''),
    linkedin_url: draft?.form?.linkedin_url ?? (profile?.linkedin_url || ''),
    bio: draft?.form?.bio ?? (profile?.bio || ''),
    is_open_to_opportunities: draft?.form?.is_open_to_opportunities ?? (profile?.is_open_to_opportunities !== false),
    availability: draft?.form?.availability ?? (profile?.availability || ''),
    expertise: draft?.form?.expertise ?? normalizeExpertise(profile?.expertise),
    services_offered: draft?.form?.services_offered ?? (Array.isArray(profile?.services_offered) ? profile.services_offered : []),
    geographic_focus: draft?.form?.geographic_focus ?? (Array.isArray(profile?.geographic_focus) ? profile.geographic_focus : []),
    business_website: draft?.form?.business_website ?? (profile?.business_website || ''),
  }))
  const [customIndustry, setCustomIndustry] = useState(
    draft?.customIndustry ?? (profile?.industry && !INDUSTRIES.includes(profile.industry) ? profile.industry : '')
  )
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url || null)
  // Saved alongside avatar_url so a later re-edit from the Profile page can
  // restore this exact zoom/position/rotation instead of resetting — see
  // the matching logic in Profile.jsx's editExistingPhoto/uploadCroppedPhoto.
  const [avatarCrop, setAvatarCrop] = useState(profile?.avatar_crop || null)
  const [cropFile, setCropFile] = useState(null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [savedProfile, setSavedProfile] = useState(null)
  const [emptyNotice, setEmptyNotice] = useState(false)
  const [cityCoords, setCityCoords] = useState(null) // set when a dropdown suggestion is picked
  const fileRef = useRef(null)

  const currentKey = STEPS[stepIndex]
  const questionIndex = QUESTION_KEYS.indexOf(currentKey)

  // Mirror answers to localStorage as they're entered (debounced), so
  // closing the tab or the phone locking mid-way doesn't throw away
  // everything answered so far — only avatarUrl/cropFile are left out,
  // same as Feed's draft autosave, since an image can't round-trip through
  // localStorage.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(draftKey, JSON.stringify({ stepIndex, form, customIndustry }))
      } catch {
        // storage full/unavailable — draft just won't persist this time
      }
    }, 400)
    return () => clearTimeout(t)
  }, [draftKey, stepIndex, form, customIndustry])

  function clearDraft() {
    try { localStorage.removeItem(draftKey) } catch { /* ignore */ }
  }

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); setEmptyNotice(false) }
  function onEnter(e) { if (e.key === 'Enter') handleContinue() }

  // Same toggle-a-tag-in-an-array behaviour as Profile's Mentoring
  // section (Services offered / Geographic focus tag grids).
  function toggleTag(field, tag) {
    setForm((f) => {
      const arr = f[field] || []
      const newArr = arr.includes(tag) ? arr.filter((t) => t !== tag) : [...arr, tag]
      return { ...f, [field]: newArr }
    })
    setEmptyNotice(false)
  }

  // Whether the current question has nothing in it — only meaningful for
  // free-text/select questions. Choice-style questions (status) and country
  // always have a default selected, so there's nothing to nudge.
  function isCurrentEmpty() {
    switch (currentKey) {
      case 'name': return !form.full_name.trim()
      case 'year': return !form.grad_year
      case 'degree': return !form.degree.trim()
      case 'industry': return !form.industry || (form.industry === 'Other' && !customIndustry.trim())
      case 'occupation': return !form.occupation.trim()
      case 'company': return !form.company.trim()
      case 'city': return !form.city.trim()
      case 'linkedin': return !form.linkedin_url.trim()
      case 'bio': return !form.bio.trim()
      case 'availability': return !form.availability
      case 'expertise': return form.expertise.length === 0
      case 'services': return form.services_offered.length === 0
      case 'geography': return form.geographic_focus.length === 0
      case 'website': return !form.business_website.trim()
      case 'photo': return !avatarUrl
      // "opportunities" is a choice with an always-on default (like
      // "status"), so there's never actually nothing selected to nudge.
      default: return false
    }
  }

  // Format problems (not just "empty") for the current question — a bad
  // grad year or a non-http(s) link shouldn't be allowed through just
  // because something was typed. Returns a message, or null if fine.
  function currentFormatError() {
    if (currentKey === 'year' && form.grad_year && !isValidGradYear(form.grad_year)) {
      return `Enter a year between 1961 and ${new Date().getFullYear() + 1}.`
    }
    if (currentKey === 'linkedin' && !isSafeHttpUrl(form.linkedin_url)) {
      return 'That should start with http:// or https://.'
    }
    if (currentKey === 'website' && !isSafeHttpUrl(form.business_website)) {
      return 'That should start with http:// or https://.'
    }
    return null
  }

  // "Continue" nudges you to fill the field in (or explicitly hit Skip)
  // instead of silently letting an empty answer slide through.
  function handleContinue() {
    if (questionIndex >= 0 && isCurrentEmpty()) {
      setEmptyNotice(true)
      return
    }
    const formatError = questionIndex >= 0 ? currentFormatError() : null
    if (formatError) {
      setError(formatError)
      return
    }
    setError(null)
    advance()
  }

  function pickPhoto(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > 8 * 1024 * 1024) { setError('Photo must be under 8MB.'); return }
    setError(null)
    setCropFile(file)
    // Stash the untouched original (best-effort) so a later re-edit from
    // the Profile page can start from the full photo again instead of the
    // already-cropped avatar — matches Profile.jsx's pickPhoto.
    supabase.storage.from('avatars')
      .upload(`${session.user.id}/original`, file, { upsert: true, contentType: file.type || 'image/jpeg' })
      .catch(() => {})
  }

  async function uploadCroppedPhoto(blob, cropMeta) {
    setCropFile(null)
    setUploadingPhoto(true)
    setError(null)
    // Unique filename per upload (see Profile.jsx's uploadCroppedPhoto for
    // why: reusing a fixed path like avatar.jpg can serve stale bytes from
    // Supabase's storage CDN for a long time even with a `?t=` cache-buster,
    // since edge caches key on the object path and largely ignore query
    // strings).
    const path = `${session.user.id}/avatar-${Date.now()}.jpg`
    const { error: upErr } = await supabase.storage
      .from('avatars')
      .upload(path, blob, { upsert: false, contentType: 'image/jpeg', cacheControl: '31536000' })
    if (upErr) { setError(upErr.message); setUploadingPhoto(false); return }
    const { data } = supabase.storage.from('avatars').getPublicUrl(path)
    setAvatarUrl(data.publicUrl)
    setAvatarCrop(cropMeta || null)
    setUploadingPhoto(false)
  }

  // One write to the database, right as the last question is left — not
  // after every single step.
  async function finishSave() {
    setBusy(true)
    setError(null)
    const industry = form.industry === 'Other' ? customIndustry.trim() : form.industry
    const payload = {
      full_name: form.full_name.trim(),
      is_current_resident: form.is_current_resident,
      grad_year: form.grad_year ? Number(form.grad_year) : null,
      degree: form.degree,
      industry,
      occupation: form.occupation,
      company: form.company,
      country: form.country,
      city: form.city,
      linkedin_url: form.linkedin_url.trim(),
      bio: form.bio,
      is_open_to_opportunities: form.is_open_to_opportunities,
      availability: form.availability,
      expertise: form.expertise,
      services_offered: form.services_offered,
      geographic_focus: form.geographic_focus,
      business_website: form.business_website.trim(),
    }
    if (avatarUrl) payload.avatar_url = avatarUrl
    if (avatarCrop) payload.avatar_crop = avatarCrop
    if (cityCoords) {
      // Picked straight from the suggestions dropdown — already a
      // confirmed, geocodable place, no need to look it up again.
      payload.lat = cityCoords.lat
      payload.lng = cityCoords.lng
    } else if (form.city.trim()) {
      const coords = await geocodeCity(form.city, form.country)
      payload.lat = coords?.lat ?? null
      payload.lng = coords?.lng ?? null
    }

    const { data, error } = await supabase
      .from('profiles')
      .update(payload)
      .eq('id', session.user.id)
      .select()
      .single()

    setBusy(false)
    if (error) { setError(error.message); return false }
    setSavedProfile(data)
    return true
  }

  async function advance() {
    setError(null)
    setEmptyNotice(false)
    if (currentKey === 'photo') {
      const ok = await finishSave()
      if (!ok) return
      setStepIndex((i) => i + 1)
      return
    }
    if (currentKey === 'done') {
      clearDraft()
      onDone(savedProfile || profile)
      return
    }
    setStepIndex((i) => Math.min(i + 1, STEPS.length - 1))
  }

  function skip() { setEmptyNotice(false); advance() }
  function back() { setEmptyNotice(false); setStepIndex((i) => Math.max(i - 1, 0)) }

  function renderStep() {
    switch (currentKey) {
      case 'intro':
        return (
          <div className="onboarding-intro">
            <h1>Let's set up your profile</h1>
            <p>A handful of quick questions about your Eendrag days and life since — skip anything you'd rather fill in later.</p>
          </div>
        )

      case 'name':
        return (
          <>
            <h2 className="onboarding-question">What's your full name?</h2>
            <input
              className="onboarding-input"
              autoFocus
              value={form.full_name}
              onChange={(e) => set('full_name', e.target.value)}
              onKeyDown={onEnter}
              placeholder="e.g. Pieter van der Merwe"
            />
          </>
        )

      case 'status':
        return (
          <>
            <h2 className="onboarding-question">Current Eendragter, or alumnus?</h2>
            <div className="onboarding-choice-row">
              <button
                className={!form.is_current_resident ? 'onboarding-choice on' : 'onboarding-choice'}
                onClick={() => set('is_current_resident', false)}
              >
                Alumnus
              </button>
              <button
                className={form.is_current_resident ? 'onboarding-choice on' : 'onboarding-choice'}
                onClick={() => set('is_current_resident', true)}
              >
                Still living in Eendrag
              </button>
            </div>
          </>
        )

      case 'year':
        return (
          <>
            <h2 className="onboarding-question">What year did you leave — or are you leaving — Eendrag?</h2>
            <input
              className="onboarding-input"
              type="number"
              value={form.grad_year}
              onChange={(e) => set('grad_year', e.target.value)}
              onKeyDown={onEnter}
              placeholder="e.g. 2018"
            />
          </>
        )

      case 'degree':
        return (
          <>
            <h2 className="onboarding-question">What did you study?</h2>
            <input
              className="onboarding-input"
              value={form.degree}
              onChange={(e) => set('degree', e.target.value)}
              onKeyDown={onEnter}
              placeholder="e.g. BCom Accounting, BEng Mechanical"
            />
          </>
        )

      case 'industry':
        return (
          <>
            <h2 className="onboarding-question">What industry are you in?</h2>
            <div className="select-wrap onboarding-select">
              <select value={form.industry} onChange={(e) => set('industry', e.target.value)}>
                <option value="">Select your industry</option>
                {INDUSTRIES.map((ind) => <option key={ind} value={ind}>{ind}</option>)}
                <option value="Other">Other (type your own)</option>
              </select>
            </div>
            {form.industry === 'Other' && (
              <input
                className="onboarding-input"
                style={{ marginTop: 12 }}
                value={customIndustry}
                onChange={(e) => setCustomIndustry(e.target.value)}
                placeholder="e.g. Technology, Healthcare, Finance"
              />
            )}
          </>
        )

      case 'occupation':
        return (
          <>
            <h2 className="onboarding-question">What's your job title or role?</h2>
            <input
              className="onboarding-input"
              value={form.occupation}
              onChange={(e) => set('occupation', e.target.value)}
              onKeyDown={onEnter}
              placeholder="e.g. Software Engineer, Director, Student"
            />
          </>
        )

      case 'company':
        return (
          <>
            <h2 className="onboarding-question">Where do you work?</h2>
            <input
              className="onboarding-input"
              value={form.company}
              onChange={(e) => set('company', e.target.value)}
              onKeyDown={onEnter}
              placeholder="e.g. Naspers"
            />
          </>
        )

      case 'country':
        return (
          <>
            <h2 className="onboarding-question">Which country are you in?</h2>
            <CountryAutocomplete
              value={form.country}
              onChange={(v) => set('country', v)}
              inputClassName="onboarding-input"
              placeholder="Start typing a country…"
            />
          </>
        )

      case 'city':
        return (
          <>
            <h2 className="onboarding-question">Which city or town?</h2>
            <p className="onboarding-hint">Start typing and choose a suggestion from the list</p>
            <CityAutocomplete
              value={form.city}
              country={form.country}
              onChange={(v) => set('city', v)}
              onSelectCoords={setCityCoords}
              inputClassName="onboarding-input"
              placeholder="e.g. Cape Town, London, New York"
            />
          </>
        )

      case 'linkedin':
        return (
          <>
            <h2 className="onboarding-question">Got a LinkedIn profile?</h2>
            <input
              className="onboarding-input"
              type="url"
              value={form.linkedin_url}
              onChange={(e) => set('linkedin_url', e.target.value)}
              onKeyDown={onEnter}
              placeholder="https://linkedin.com/in/yourname"
            />
          </>
        )

      case 'bio':
        return (
          <>
            <h2 className="onboarding-question">Anything you'd like other alumni to know?</h2>
            <textarea
              className="onboarding-input onboarding-textarea"
              rows={4}
              value={form.bio}
              onChange={(e) => set('bio', e.target.value)}
              placeholder="What you've been up to since Eendrag…"
            />
          </>
        )

      case 'opportunities':
        return (
          <>
            <h2 className="onboarding-question">Are you open to mentoring and other opportunities?</h2>
            <div className="onboarding-choice-row">
              <button
                className={form.is_open_to_opportunities ? 'onboarding-choice on' : 'onboarding-choice'}
                onClick={() => set('is_open_to_opportunities', true)}
              >
                Yes
              </button>
              <button
                className={!form.is_open_to_opportunities ? 'onboarding-choice on' : 'onboarding-choice'}
                onClick={() => set('is_open_to_opportunities', false)}
              >
                Not right now
              </button>
            </div>
          </>
        )

      case 'availability':
        return (
          <>
            <h2 className="onboarding-question">What's your current availability?</h2>
            <div className="select-wrap onboarding-select">
              <select value={form.availability} onChange={(e) => set('availability', e.target.value)}>
                <option value="">Select your availability</option>
                {AVAILABILITY_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
              </select>
            </div>
          </>
        )

      case 'expertise':
        return (
          <>
            <h2 className="onboarding-question">What are the main areas you could mentor others in?</h2>
            <p className="onboarding-hint">Pick as many as apply — or type your own</p>
            <MultiSelectAutocomplete
              values={form.expertise}
              onChange={(value) => set('expertise', value)}
              options={EXPERTISE_BY_INDUSTRY[form.industry] || EXPERTISE_OPTIONS}
              placeholder={form.industry ? 'Search your expertise, or type your own' : 'Pick an industry above to see relevant options'}
              allowCustom
              inputClassName="onboarding-input"
            />
          </>
        )

      case 'services':
        return (
          <>
            <h2 className="onboarding-question">What can you offer other Eendragters?</h2>
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
          </>
        )

      case 'geography':
        return (
          <>
            <h2 className="onboarding-question">What's your geographic focus?</h2>
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
          </>
        )

      case 'website':
        return (
          <>
            <h2 className="onboarding-question">Got a business website or portfolio?</h2>
            <input
              className="onboarding-input"
              type="url"
              value={form.business_website}
              onChange={(e) => set('business_website', e.target.value)}
              onKeyDown={onEnter}
              placeholder="https://yourwebsite.com"
            />
          </>
        )

      case 'photo':
        return (
          <>
            <h2 className="onboarding-question">Add a profile photo?</h2>
            <div className="onboarding-photo-row">
              <Avatar url={avatarUrl} name={form.full_name} size={96} />
              <div>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploadingPhoto}
                >
                  {uploadingPhoto ? 'Uploading…' : avatarUrl ? 'Change photo' : 'Add photo'}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  style={{ display: 'none' }}
                  onChange={pickPhoto}
                />
                <p className="hint">JPG, PNG or WebP, up to 8MB.</p>
              </div>
            </div>
          </>
        )

      case 'done':
        return (
          <div className="onboarding-intro">
            <div className="onboarding-check">✓</div>
            <h1>All set.</h1>
            <p>Your profile's ready — you can always fine-tune it from My Profile.</p>
          </div>
        )

      default:
        return null
    }
  }

  const isQuestion = questionIndex >= 0
  const continueLabel = busy
    ? 'Saving…'
    : currentKey === 'done' ? 'Go to my profile'
    : currentKey === 'intro' ? "Let's go"
    : currentKey === 'photo' ? 'Finish'
    : 'Continue'

  return (
    <div className="onboarding-page">
      <div className="onboarding-card">
        <img src="/eendrag-logo.png" alt="Eendrag logo" className="onboarding-logo" />

        {stepIndex > 0 && currentKey !== 'done' && (
          <button className="onboarding-back" onClick={back} type="button" aria-label="Previous question">
            ← Back
          </button>
        )}

        {isQuestion && (
          <div className="onboarding-progress">
            <div className="onboarding-progress-bar">
              <div
                className="onboarding-progress-fill"
                style={{ width: `${((questionIndex + 1) / QUESTION_KEYS.length) * 100}%` }}
              />
            </div>
            <span className="onboarding-progress-label">
              Question {questionIndex + 1} of {QUESTION_KEYS.length}
            </span>
          </div>
        )}

        <div className="onboarding-step" key={stepIndex}>
          {renderStep()}
        </div>

        {emptyNotice && (
          <p className="onboarding-nudge">You'll need to fill this in to continue — or tap Skip if you'd rather leave it for later.</p>
        )}
        {error && <p className="form-error">{error}</p>}

        <div className="onboarding-actions">
          {isQuestion && (
            <button className="onboarding-skip" onClick={skip} disabled={busy} type="button">
              Skip this question
            </button>
          )}
          <button className="btn primary onboarding-continue" onClick={handleContinue} disabled={busy} type="button">
            {continueLabel}
          </button>
        </div>
      </div>

      {cropFile && (
        <PhotoCropper file={cropFile} onCancel={() => setCropFile(null)} onSave={uploadCroppedPhoto} />
      )}
    </div>
  )
}
