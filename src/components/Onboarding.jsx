import { useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import { COUNTRIES, INDUSTRIES } from '../constants.js'
import { geocodeCity } from '../geocode.js'
import { Avatar } from './Directory.jsx'
import PhotoCropper from './PhotoCropper.jsx'

// One question per screen, skip-friendly, saved in a single write at the
// end. Shown full-screen (like Auth) the first time a member logs in with
// no name on file yet — see App.jsx.
const QUESTION_KEYS = [
  'name', 'status', 'year', 'degree', 'industry', 'occupation',
  'company', 'country', 'city', 'linkedin', 'mentorship', 'bio', 'photo',
]
const STEPS = ['intro', ...QUESTION_KEYS, 'done']

export default function Onboarding({ session, profile, onDone }) {
  const [stepIndex, setStepIndex] = useState(0)
  const [form, setForm] = useState({
    full_name: profile?.full_name || '',
    is_current_resident: !!profile?.is_current_resident,
    grad_year: profile?.grad_year || '',
    degree: profile?.degree || '',
    industry: INDUSTRIES.includes(profile?.industry) ? profile.industry : (profile?.industry ? 'Other' : ''),
    occupation: profile?.occupation || '',
    company: profile?.company || '',
    country: profile?.country || 'South Africa',
    city: profile?.city || '',
    linkedin_url: profile?.linkedin_url || '',
    available_for_mentorship: !!profile?.available_for_mentorship,
    mentorship_description: profile?.mentorship_description || '',
    bio: profile?.bio || '',
  })
  const [customIndustry, setCustomIndustry] = useState(
    profile?.industry && !INDUSTRIES.includes(profile.industry) ? profile.industry : ''
  )
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url || null)
  const [cropFile, setCropFile] = useState(null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [savedProfile, setSavedProfile] = useState(null)
  const [emptyNotice, setEmptyNotice] = useState(false)
  const fileRef = useRef(null)

  const currentKey = STEPS[stepIndex]
  const questionIndex = QUESTION_KEYS.indexOf(currentKey)

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); setEmptyNotice(false) }
  function onEnter(e) { if (e.key === 'Enter') handleContinue() }

  // Whether the current question has nothing in it — only meaningful for
  // free-text/select questions. Choice-style questions (status, mentorship)
  // and country always have a default selected, so there's nothing to nudge.
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
      case 'photo': return !avatarUrl
      default: return false
    }
  }

  // "Continue" nudges you to fill the field in (or explicitly hit Skip)
  // instead of silently letting an empty answer slide through.
  function handleContinue() {
    if (questionIndex >= 0 && isCurrentEmpty()) {
      setEmptyNotice(true)
      return
    }
    advance()
  }

  function pickPhoto(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > 8 * 1024 * 1024) { setError('Photo must be under 8MB.'); return }
    setError(null)
    setCropFile(file)
  }

  async function uploadCroppedPhoto(blob) {
    setCropFile(null)
    setUploadingPhoto(true)
    setError(null)
    const path = `${session.user.id}/avatar.jpg`
    const { error: upErr } = await supabase.storage
      .from('avatars')
      .upload(path, blob, { upsert: true, contentType: 'image/jpeg' })
    if (upErr) { setError(upErr.message); setUploadingPhoto(false); return }
    const { data } = supabase.storage.from('avatars').getPublicUrl(path)
    setAvatarUrl(`${data.publicUrl}?t=${Date.now()}`)
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
      available_for_mentorship: form.available_for_mentorship,
      mentorship_description: form.mentorship_description,
      bio: form.bio,
    }
    if (avatarUrl) payload.avatar_url = avatarUrl
    if (form.city.trim()) {
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
            <div className="select-wrap onboarding-select">
              <select value={form.country} onChange={(e) => set('country', e.target.value)}>
                {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </>
        )

      case 'city':
        return (
          <>
            <h2 className="onboarding-question">Which city or town?</h2>
            <p className="onboarding-hint">This is what powers the Alumni Map — "where are we all now".</p>
            <input
              className="onboarding-input"
              value={form.city}
              onChange={(e) => set('city', e.target.value)}
              onKeyDown={onEnter}
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

      case 'mentorship':
        return (
          <>
            <h2 className="onboarding-question">Open to mentoring other Eendragters?</h2>
            <div className="onboarding-choice-row">
              <button
                className={!form.available_for_mentorship ? 'onboarding-choice on' : 'onboarding-choice'}
                onClick={() => set('available_for_mentorship', false)}
              >
                Not right now
              </button>
              <button
                className={form.available_for_mentorship ? 'onboarding-choice on' : 'onboarding-choice'}
                onClick={() => set('available_for_mentorship', true)}
              >
                🤝 Yes, happy to help
              </button>
            </div>
            {form.available_for_mentorship && (
              <input
                className="onboarding-input"
                style={{ marginTop: 12 }}
                value={form.mentorship_description}
                onChange={(e) => set('mentorship_description', e.target.value)}
                placeholder="e.g. Anybody in the tech space"
              />
            )}
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
