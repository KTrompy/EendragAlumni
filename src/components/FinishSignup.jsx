import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import { friendlyAuthError } from '../authErrors.js'
import {
  Field, fieldA11y, YearsFields, LocationFields, NewsPreference, DataConsent, ApplicationProgress,
} from './SignupFields.jsx'
import {
  DEFAULT_COUNTRY, composeFullName, coordsForCity, nameErrors, yearErrors, locationErrors, consentErrors,
  readDraft, writeDraft, clearDraft, focusFirstInvalid,
} from '../signup.js'

// "Complete your application" — shown (full-screen, before anything else) to
// anyone signed in whose profile has no consented_at yet. In practice that's
// people who joined with Google, plus the rare email signup whose profile
// details didn't get written.
//
// Google has already given us a verified email address and usually a name,
// so there's no password and no confirmation email here. Everything else is
// the same as the email wizard — names, Eendrag years, city and country, the
// news preference and the required consent — using the same components, so
// both routes produce the same member record for the committee to check.
// (This screen used to skip city/country entirely, so Google joiners reached
// the admin queue with no location and never appeared on the alumni map.)
const DRAFT_FIELDS = [
  'firstName', 'preferredName', 'lastName', 'startYear', 'endYear', 'newsOptIn',
  'city', 'cityCoords', 'country',
]

function providerValues(meta, profile) {
  const fullName = meta.full_name || meta.name || ''
  return {
    firstName: meta.first_name || meta.given_name || fullName.split(' ')[0] || '',
    preferredName: meta.preferred_name || '',
    lastName: meta.last_name || meta.family_name || fullName.split(' ').slice(1).join(' ') || '',
    startYear: meta.start_year ? String(meta.start_year) : '',
    endYear: meta.grad_year ? String(meta.grad_year) : '',
    newsOptIn: typeof meta.email_news_opt_in === 'boolean' ? meta.email_news_opt_in : null,
    city: profile?.city || meta.city || '',
    cityCoords: profile?.city && typeof profile?.lat === 'number' && typeof profile?.lng === 'number'
      ? { lat: profile.lat, lng: profile.lng, label: profile.city }
      : null,
    country: profile?.country || meta.country || DEFAULT_COUNTRY,
  }
}

export default function FinishSignup({ session, profile, onDone }) {
  const meta = session.user.user_metadata || {}
  const draftKey = `eendrag-finish-signup-${session.user.id}`
  const [defaults] = useState(() => providerValues(meta, profile))
  const [values, setValues] = useState(() => ({ ...defaults, ...readDraft(draftKey, DRAFT_FIELDS) }))
  const [dataConsent, setDataConsent] = useState(false)
  const [touched, setTouched] = useState({})
  const [attempted, setAttempted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const formRef = useRef(null)
  const viaGoogle = session.user.app_metadata?.provider === 'google'

  const setField = (k, v) => setValues((s) => ({ ...s, [k]: v }))
  const touch = (k) => setTouched((t) => (t[k] ? t : { ...t, [k]: true }))
  const touchIfFilled = (k) => { if (String(values[k] ?? '').trim()) touch(k) }

  // Only saved once it differs from what Google handed back. Saving the
  // prefilled values would pin them over a corrected name from the provider
  // on the next visit, and refresh the expiry on every open.
  const worthSaving = DRAFT_FIELDS.some((k) => JSON.stringify(values[k] ?? null) !== JSON.stringify(defaults[k] ?? null))
  useEffect(() => {
    if (worthSaving) writeDraft(draftKey, DRAFT_FIELDS, values)
  }, [worthSaving, values, draftKey])

  const allErrors = {
    ...nameErrors(values),
    ...yearErrors(values),
    ...locationErrors(values),
    ...consentErrors({ newsOptIn: values.newsOptIn, dataConsent }),
  }
  const shown = Object.fromEntries(Object.entries(allErrors).filter(([k]) => attempted || touched[k]))
  const shownCount = Object.keys(shown).length

  async function save(e) {
    e.preventDefault()
    if (busy) return
    if (Object.keys(allErrors).length > 0) {
      setAttempted(true)
      focusFirstInvalid(formRef.current)
      return
    }
    setBusy(true); setError(null)
    const coords = coordsForCity(values.city, values.cityCoords)
    const { data, error: err } = await supabase
      .from('profiles')
      .update({
        full_name: composeFullName(values.firstName, values.preferredName, values.lastName),
        first_name: values.firstName.trim(),
        preferred_name: values.preferredName.trim(),
        last_name: values.lastName.trim(),
        start_year: Number(values.startYear),
        grad_year: Number(values.endYear),
        city: values.city.trim(),
        country: values.country.trim(),
        ...(coords || {}),
        email_news_opt_in: values.newsOptIn === true,
        consented_at: new Date().toISOString(),
      })
      .eq('id', session.user.id)
      .select()
      .single()
    setBusy(false)
    if (err) { setError(friendlyAuthError(err, 'Couldn’t save your details — please try again.')); return }
    clearDraft(draftKey)
    // PendingVerification, which App.jsx shows next, sends the "we've
    // received your application" email.
    onDone(data)
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <img src="/eendrag-logo.png" alt="Eendrag logo" className="auth-logo small" />
        <h1 className="su-title">Complete your application</h1>
        <p className="su-signed-in">Signed in as <strong>{session.user.email}</strong></p>

        <ApplicationProgress
          steps={[
            { label: viaGoogle ? 'Signed in with Google' : 'Account created', state: 'done' },
            { label: 'Your details', state: 'current', detail: 'What the committee needs to verify you.' },
            { label: 'Eendrag verification', state: 'todo' },
            { label: 'Approved', state: 'todo' },
          ]}
        />

        <form ref={formRef} onSubmit={save} noValidate>
          <p className="su-small su-required-note">All fields are required unless marked optional.</p>
          <div className="auth-field-row">
            <Field id="fs-first" label="First name" error={shown.firstName}>
              <input
                {...fieldA11y('fs-first', { error: shown.firstName })}
                value={values.firstName}
                onChange={(e) => setField('firstName', e.target.value)}
                onBlur={() => touchIfFilled('firstName')}
                autoComplete="given-name"
              />
            </Field>
            <Field id="fs-last" label="Last name" error={shown.lastName}>
              <input
                {...fieldA11y('fs-last', { error: shown.lastName })}
                value={values.lastName}
                onChange={(e) => setField('lastName', e.target.value)}
                onBlur={() => touchIfFilled('lastName')}
                autoComplete="family-name"
              />
            </Field>
          </div>
          <Field id="fs-preferred" label="Preferred first name" optional hint="This is the name other alumni will see — e.g. JP or Wikus.">
            <input
              {...fieldA11y('fs-preferred', { hint: true })}
              value={values.preferredName}
              onChange={(e) => setField('preferredName', e.target.value)}
              autoComplete="nickname"
            />
          </Field>

          <h2 className="su-subheading">Your time in Eendrag</h2>
          <p className="su-small">The committee checks your years against residence records.</p>
          <YearsFields
            idPrefix="fs"
            startYear={values.startYear}
            endYear={values.endYear}
            onStartYear={(v) => { setField('startYear', v); touch('startYear') }}
            onEndYear={(v) => { setField('endYear', v); touch('endYear') }}
            errors={shown}
          />

          <h2 className="su-subheading">Where you live now</h2>
          <p className="su-small">Your city and country put you on the alumni map.</p>
          <LocationFields
            idPrefix="fs"
            city={values.city}
            country={values.country}
            cityCoords={values.cityCoords}
            onCity={(v) => setField('city', v)}
            onCityCoords={(c) => setField('cityCoords', c)}
            onCountry={(v) => setField('country', v)}
            errors={shown}
            onBlur={touchIfFilled}
          />

          <h2 className="su-subheading">Privacy and emails</h2>
          <NewsPreference idPrefix="fs" value={values.newsOptIn} onChange={(v) => setField('newsOptIn', v)} error={shown.newsOptIn} />
          <DataConsent idPrefix="fs" checked={dataConsent} onChange={setDataConsent} error={shown.dataConsent} />

          {shownCount > 0 && (
            <p className="su-summary" role="alert">
              {shownCount === 1 ? 'Please fix the highlighted field.' : `Please fix the ${shownCount} highlighted fields.`}
            </p>
          )}
          {error && <p className="form-error" role="alert">{error}</p>}

          <button type="submit" className="btn primary wide su-gap" disabled={busy} aria-busy={busy}>
            {busy ? 'Submitting your application…' : 'Submit application'}
          </button>
        </form>

        <button
          type="button"
          className="link-btn"
          onClick={() => { clearDraft(draftKey); supabase.auth.signOut() }}
        >
          Not you? Sign out
        </button>
      </div>
    </div>
  )
}
