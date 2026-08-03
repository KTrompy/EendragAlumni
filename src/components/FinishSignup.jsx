import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import CountryAutocomplete from './CountryAutocomplete.jsx'
import CityAutocomplete from './CityAutocomplete.jsx'
import { MAX_RESIDENCE_YEARS } from '../constants.js'
import { friendlyAuthError } from '../authErrors.js'
import { PrivacyPolicyModal } from './PrivacyPolicy.jsx'

// Shown (full-screen, before anything else) to anyone signed in whose
// profile has no consented_at yet — in practice that's people who joined
// via a social provider (Google/Facebook/LinkedIn) and so never went
// through the signup form, plus the rare email signup whose post-signup
// profile update failed. Collects the same essentials the form does:
// name, years in Eendrag, and the consent choices. Once saved, App.jsx
// falls through to the pending-verification screen.
const FOUNDING_YEAR = 1961
const THIS_YEAR = new Date().getFullYear()
const START_YEARS = []
for (let y = THIS_YEAR; y >= FOUNDING_YEAR; y--) START_YEARS.push(y)
const END_YEARS = []
for (let y = THIS_YEAR + 7; y >= FOUNDING_YEAR; y--) END_YEARS.push(y)

// Eleven fields and the only way off this screen was "Sign out" — a refresh
// or a stray back-gesture mid-fill threw away everything typed. Same
// localStorage draft approach JobForm uses. `dataConsent` is deliberately
// left out: a consent tick is an affirmation someone has to make
// deliberately, not something to silently restore on their behalf.
const DRAFT_FIELDS = [
  'firstName', 'preferredName', 'lastName', 'startYear', 'endYear', 'newsOptIn',
  'address1', 'address2', 'address3', 'province', 'city', 'postCode', 'country',
]

// Drafts expire. Without this they were kept forever: a half-typed home
// address sitting in localStorage on a shared or family computer indefinitely,
// and — more confusingly — a stale draft from months ago silently overriding
// the name a social provider hands back today. A week is comfortably longer
// than "I'll finish this tonight" and shorter than "why is this filled in?".
const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

function readDraft(key) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    // Drafts written before this change have no savedAt — treat them as
    // expired rather than trusting an unknown age.
    if (!parsed?.savedAt || Date.now() - parsed.savedAt > DRAFT_MAX_AGE_MS) {
      localStorage.removeItem(key)
      return null
    }
    return parsed.values || null
  } catch {
    return null
  }
}

export default function FinishSignup({ session, profile, onDone }) {
  const meta = session.user.user_metadata || {}
  const draftKey = `eendrag-finish-signup-${session.user.id}`
  const [draft] = useState(() => readDraft(draftKey) || {})
  // Social providers hand back given_name/family_name (Google/LinkedIn) or
  // just a full name (Facebook) — prefill whatever's available.
  const [firstName, setFirstName] = useState(
    draft.firstName ?? (meta.first_name || meta.given_name || (meta.full_name || meta.name || '').split(' ')[0] || '')
  )
  const [preferredName, setPreferredName] = useState(draft.preferredName ?? (meta.preferred_name || ''))
  const [lastName, setLastName] = useState(
    draft.lastName ?? (meta.last_name || meta.family_name || (meta.full_name || meta.name || '').split(' ').slice(1).join(' ') || '')
  )
  const [startYear, setStartYear] = useState(draft.startYear ?? (meta.start_year || ''))
  const [endYear, setEndYear] = useState(draft.endYear ?? (meta.grad_year || ''))
  const [newsOptIn, setNewsOptIn] = useState(
    draft.newsOptIn ?? (typeof meta.email_news_opt_in === 'boolean' ? meta.email_news_opt_in : null)
  )
  const [address1, setAddress1] = useState(draft.address1 ?? '')
  const [address2, setAddress2] = useState(draft.address2 ?? '')
  const [address3, setAddress3] = useState(draft.address3 ?? '')
  const [province, setProvince] = useState(draft.province ?? '')
  const [city, setCity] = useState(draft.city ?? (profile?.city || ''))
  // Set when a City suggestion is picked — see Auth.jsx for the rationale.
  // Not part of the draft: coordinates are only trustworthy alongside the
  // exact city label they came from, so a restored draft re-picks or
  // re-geocodes rather than reusing a stale pin.
  const [cityCoords, setCityCoords] = useState(null)
  const [postCode, setPostCode] = useState(draft.postCode ?? '')
  const [country, setCountry] = useState(draft.country ?? (profile?.country || 'South Africa'))
  const [dataConsent, setDataConsent] = useState(false)
  const [privacyOpen, setPrivacyOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const values = {
    firstName, preferredName, lastName, startYear, endYear, newsOptIn,
    address1, address2, address3, province, city, postCode, country,
  }
  useEffect(() => {
    try {
      localStorage.setItem(draftKey, JSON.stringify({
        savedAt: Date.now(),
        values: Object.fromEntries(DRAFT_FIELDS.map((k) => [k, values[k]])),
      }))
    } catch { /* private mode / quota — the form still works, just not resumable */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, DRAFT_FIELDS.map((k) => values[k]))

  function validate() {
    if (!firstName.trim()) return 'Enter your first name.'
    if (!lastName.trim()) return 'Enter your last name.'
    if (!startYear) return 'Select the year you arrived at Eendrag.'
    if (!endYear) return 'Select your final year (or expected final year).'
    if (Number(endYear) < Number(startYear)) return 'Your final year can’t be before your first year.'
    // Same sanity check as the signup wizard — see Auth.jsx.
    if (Number(endYear) - Number(startYear) > MAX_RESIDENCE_YEARS) {
      return `That's more than ${MAX_RESIDENCE_YEARS} years in Eendrag — check the years are right.`
    }
    if (!city.trim()) return 'Enter your city or town.'
    if (!country.trim()) return 'Enter your country.'
    if (newsOptIn === null) return 'Choose whether you’d like news and events by email.'
    if (!dataConsent) return 'You’ll need to consent to your data being held to join.'
    return null
  }

  async function save(e) {
    e.preventDefault()
    const problem = validate()
    if (problem) { setError(problem); return }
    setBusy(true); setError(null)
    const fullName = `${(preferredName.trim() || firstName.trim())} ${lastName.trim()}`.trim()
    const { data, error: err } = await supabase
      .from('profiles')
      .update({
        full_name: fullName,
        start_year: Number(startYear),
        grad_year: Number(endYear),
        email_news_opt_in: newsOptIn === true,
        address_line1: address1.trim(),
        address_line2: address2.trim(),
        address_line3: address3.trim(),
        province: province.trim(),
        city: city.trim(),
        postal_code: postCode.trim(),
        country: country.trim(),
        ...(cityCoords ? { lat: cityCoords.lat, lng: cityCoords.lng } : {}),
        consented_at: new Date().toISOString(),
      })
      .eq('id', session.user.id)
      .select()
      .single()
    setBusy(false)
    if (err) { setError(friendlyAuthError(err, "Couldn't save your details — please try again.")); return }
    try { localStorage.removeItem(draftKey) } catch { /* ignore */ }
    onDone(data)
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <img src="/eendrag-logo.png" alt="Eendrag logo" className="auth-logo" />
        <h1 className="auth-title">Nearly done</h1>
        <p className="auth-sub">A few details to finish joining Eendrag Alumni</p>

        <form onSubmit={save} noValidate>
          <div className="auth-field-row">
            <label className="field">
              <span>First name *</span>
              <input value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" />
            </label>
            <label className="field">
              <span>Last name *</span>
              <input value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" />
            </label>
          </div>
          <label className="field">
            <span>Preferred first name</span>
            <input
              value={preferredName}
              onChange={(e) => setPreferredName(e.target.value)}
              placeholder="If different — e.g. JP, Wikus"
            />
          </label>

          <div className="auth-field-row">
            <label className="field">
              <span>In Eendrag from *</span>
              <div className="select-wrap">
                <select value={startYear} onChange={(e) => setStartYear(e.target.value)}>
                  <option value="">Year</option>
                  {START_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            </label>
            <label className="field">
              <span>To *</span>
              <div className="select-wrap">
                <select value={endYear} onChange={(e) => setEndYear(e.target.value)}>
                  <option value="">Year</option>
                  {END_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            </label>
          </div>

          {/* Says why before it asks. An unexplained "give us your home
              address" block in the middle of a signup form is the single
              biggest reason people abandon one — especially optional fields,
              where the natural read is "why do they want this?" */}
          <p className="hint" style={{ marginTop: 14 }}>
            Your address is optional. It&rsquo;s used to place you on the alumni map
            and to post you reunion invitations, and it isn&rsquo;t displayed on your
            profile.
          </p>
          <label className="field">
            <span>Address line 1</span>
            <input value={address1} onChange={(e) => setAddress1(e.target.value)} autoComplete="address-line1" />
          </label>
          <label className="field">
            <span>Address line 2</span>
            <input value={address2} onChange={(e) => setAddress2(e.target.value)} autoComplete="address-line2" />
          </label>
          <label className="field">
            <span>Address line 3</span>
            <input value={address3} onChange={(e) => setAddress3(e.target.value)} autoComplete="address-line3" />
          </label>
          <div className="auth-field-row">
            <label className="field">
              <span>Province</span>
              <input value={province} onChange={(e) => setProvince(e.target.value)} autoComplete="address-level1" />
            </label>
            <label className="field">
              <span>City *</span>
              <CityAutocomplete
                value={city}
                country={country}
                onChange={setCity}
                onSelectCoords={setCityCoords}
                placeholder="Start typing…"
              />
            </label>
          </div>
          <div className="auth-field-row">
            <label className="field">
              {/* Optional and non-numeric — see the note in Auth.jsx. */}
              <span>Post code</span>
              <input value={postCode} onChange={(e) => setPostCode(e.target.value)} autoComplete="postal-code" />
            </label>
            <label className="field">
              <span>Country *</span>
              <CountryAutocomplete value={country} onChange={setCountry} placeholder="Start typing…" />
            </label>
          </div>

          <fieldset className="auth-consent-group">
            <legend>I&rsquo;m happy to hear about news and events by email. *</legend>
            <div className="auth-consent-row">
              <button
                type="button"
                className={newsOptIn === true ? 'onboarding-choice on' : 'onboarding-choice'}
                onClick={() => setNewsOptIn(true)}
              >
                Yes, email me
              </button>
              <button
                type="button"
                className={newsOptIn === false ? 'onboarding-choice on' : 'onboarding-choice'}
                onClick={() => setNewsOptIn(false)}
              >
                No, don&rsquo;t email me
              </button>
            </div>
          </fieldset>
          <label className="auth-consent-check">
            <input type="checkbox" checked={dataConsent} onChange={(e) => setDataConsent(e.target.checked)} />
            <span>
              I consent to my personal data being held on the Eendrag Alumni
              database and used to run this community, and to receiving
              occasional system emails about my profile. *
            </span>
          </label>
          <p className="hint auth-privacy-link">
            <button type="button" className="link-btn" onClick={() => setPrivacyOpen(true)}>
              Read our Privacy Policy
            </button>
          </p>
          {privacyOpen && <PrivacyPolicyModal onClose={() => setPrivacyOpen(false)} />}

          {/* Live region: this form is eleven fields long and validate()
              returns one message at a time, so without an announcement a
              screen-reader user submitting it gets no feedback at all. */}
          {error && <p className="form-error" role="alert">{error}</p>}

          <button type="submit" className="btn primary wide" disabled={busy}>
            {busy ? 'Saving…' : 'Finish joining'}
          </button>
        </form>

        <button type="button"
          className="link-btn"
          onClick={() => { try { localStorage.removeItem(draftKey) } catch { /* ignore */ } supabase.auth.signOut() }}
        >
          Sign out
        </button>
      </div>
    </div>
  )
}
