import { useState } from 'react'
import { supabase } from '../supabaseClient'
import CountryAutocomplete from './CountryAutocomplete.jsx'
import CityAutocomplete from './CityAutocomplete.jsx'
import { MAX_RESIDENCE_YEARS } from '../constants.js'

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

export default function FinishSignup({ session, profile, onDone }) {
  const meta = session.user.user_metadata || {}
  // Social providers hand back given_name/family_name (Google/LinkedIn) or
  // just a full name (Facebook) — prefill whatever's available.
  const [firstName, setFirstName] = useState(
    meta.first_name || meta.given_name || (meta.full_name || meta.name || '').split(' ')[0] || ''
  )
  const [preferredName, setPreferredName] = useState(meta.preferred_name || '')
  const [lastName, setLastName] = useState(
    meta.last_name || meta.family_name || (meta.full_name || meta.name || '').split(' ').slice(1).join(' ') || ''
  )
  const [startYear, setStartYear] = useState(meta.start_year || '')
  const [endYear, setEndYear] = useState(meta.grad_year || '')
  const [newsOptIn, setNewsOptIn] = useState(
    typeof meta.email_news_opt_in === 'boolean' ? meta.email_news_opt_in : null
  )
  const [address1, setAddress1] = useState('')
  const [address2, setAddress2] = useState('')
  const [address3, setAddress3] = useState('')
  const [province, setProvince] = useState('')
  const [city, setCity] = useState(profile?.city || '')
  // Set when a City suggestion is picked — see Auth.jsx for the rationale.
  const [cityCoords, setCityCoords] = useState(null)
  const [postCode, setPostCode] = useState('')
  const [country, setCountry] = useState(profile?.country || 'South Africa')
  const [dataConsent, setDataConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

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
    if (err) { setError(err.message); return }
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
                Opt in
              </button>
              <button
                type="button"
                className={newsOptIn === false ? 'onboarding-choice on' : 'onboarding-choice'}
                onClick={() => setNewsOptIn(false)}
              >
                Opt out
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

          {error && <p className="form-error">{error}</p>}

          <button type="submit" className="btn primary wide" disabled={busy}>
            {busy ? 'Saving…' : 'Finish joining'}
          </button>
        </form>

        <button className="link-btn" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </div>
    </div>
  )
}
