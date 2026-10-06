// Building blocks shared by the email signup wizard (Auth.jsx) and the
// Google "complete your application" screen (FinishSignup.jsx), so both paths
// ask the same questions in the same words and produce the same member
// record. Validation rules live in ../signup.js; these only render.
import { useState } from 'react'
import CityAutocomplete from './CityAutocomplete.jsx'
import CountryAutocomplete from './CountryAutocomplete.jsx'
import { PrivacyPolicyModal } from './PrivacyPolicy.jsx'
import { START_YEARS, END_YEARS, coordsForCity } from '../signup.js'
import { COUNTRIES } from '../constants.js'

/* ---------- Field shell ----------
   Label above, input, then (at most) one line underneath: the error if there
   is one, otherwise the hint. The input is tied to both with
   aria-describedby, and aria-invalid flags it for screen readers and for
   focusFirstInvalid(). */
export function Field({ id, label, optional = false, hint, error, valid, children, className = '' }) {
  return (
    <div className={`field su-field ${error ? 'is-invalid' : ''} ${className}`}>
      <label htmlFor={id} className="su-label">
        {label}
        {optional && <span className="su-optional">Optional</span>}
      </label>
      {children}
      {error ? (
        <p id={`${id}-msg`} className="su-msg su-error">{error}</p>
      ) : valid ? (
        <p id={`${id}-msg`} className="su-msg su-valid">{valid}</p>
      ) : hint ? (
        <p id={`${id}-msg`} className="su-msg su-hint">{hint}</p>
      ) : null}
    </div>
  )
}

// The aria wiring every input inside a <Field> needs.
export function fieldA11y(id, { error, hint, valid } = {}) {
  return {
    id,
    'aria-invalid': error ? 'true' : undefined,
    'aria-describedby': error || hint || valid ? `${id}-msg` : undefined,
  }
}

/* ---------- Eendrag years ---------- */
export function YearsFields({ idPrefix, startYear, endYear, onStartYear, onEndYear, errors = {}, onBlur }) {
  const startId = `${idPrefix}-start`
  const endId = `${idPrefix}-end`
  return (
    <div className="auth-field-row">
      <Field id={startId} label="From" error={errors.startYear} hint="The year you moved in.">
        <div className="select-wrap">
          <select
            {...fieldA11y(startId, { error: errors.startYear, hint: true })}
            value={startYear}
            onChange={(e) => onStartYear(e.target.value)}
            onBlur={() => onBlur?.('startYear')}
          >
            <option value="">Select year</option>
            {START_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </Field>
      <Field
        id={endId}
        label="To"
        error={errors.endYear}
        hint="The year you left, or your expected final year if you live here now."
      >
        <div className="select-wrap">
          <select
            {...fieldA11y(endId, { error: errors.endYear, hint: true })}
            value={endYear}
            onChange={(e) => onEndYear(e.target.value)}
            onBlur={() => onBlur?.('endYear')}
          >
            <option value="">Select year</option>
            {END_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </Field>
    </div>
  )
}

/* ---------- City + country ----------
   City suggestions come from Mapbox, but they're a convenience, not a gate:
   typed text is kept as typed (and matched to a suggestion on blur when it's
   an exact hit), and if the lookup is down the field says so and carries on.
   A picked suggestion brings coordinates, which put the member on the alumni
   map immediately; without them the profile page geocodes the city later. */
export function LocationFields({ idPrefix, city, country, cityCoords, onCity, onCityCoords, onCountry, errors = {}, onBlur }) {
  const cityId = `${idPrefix}-city`
  const countryId = `${idPrefix}-country`
  const pinned = coordsForCity(city, cityCoords)
  const [lookupFailed, setLookupFailed] = useState(false)
  const cityValid = !errors.city && city.trim()
    ? (pinned ? `✓ ${city.trim()}` : null)
    : null
  const cityHint = lookupFailed
    ? null
    : city.trim() && !pinned
      ? 'Saved as typed. Picking a suggestion places you on the alumni map.'
      : 'Start typing to see suggestions.'

  // Tidy an exact country match ("south africa") to the canonical spelling so
  // the directory's country filter groups everyone together.
  function normaliseCountry() {
    const typed = country.trim().toLowerCase()
    const match = typed && COUNTRIES.find((c) => c.toLowerCase() === typed)
    if (match && match !== country) onCountry(match)
    onBlur?.('country')
  }

  return (
    <>
      <Field id={cityId} label="City or town" error={errors.city} valid={cityValid} hint={cityHint}>
        <CityAutocomplete
          value={city}
          country={country}
          onChange={onCity}
          onSelectCoords={onCityCoords}
          strict={false}
          matchOnBlur
          placeholder="e.g. Cape Town"
          onInputBlur={() => onBlur?.('city')}
          unavailableMessage="City suggestions are temporarily unavailable. You can enter your city manually."
          onLookupFailedChange={setLookupFailed}
          inputProps={{ ...fieldA11y(cityId, { error: errors.city, hint: !!cityHint || !!cityValid }), autoComplete: 'address-level2' }}
        />
      </Field>
      <Field id={countryId} label="Country" error={errors.country}>
        <CountryAutocomplete
          value={country}
          onChange={onCountry}
          placeholder="Start typing…"
          onInputBlur={normaliseCountry}
          inputProps={{ ...fieldA11y(countryId, { error: errors.country }), autoComplete: 'country-name' }}
        />
      </Field>
    </>
  )
}

/* ---------- News & events preference ----------
   Optional marketing, so it sits apart from the required consent below and is
   never pre-selected: the person has to make a choice either way. Real radio
   inputs, so arrow keys and screen readers work as expected. */
export function NewsPreference({ idPrefix, value, onChange, error }) {
  const name = `${idPrefix}-news`
  return (
    <fieldset className={`su-choice-group ${error ? 'is-invalid' : ''}`} aria-describedby={`${name}-msg`}>
      <legend>Would you like Eendrag Alumni news and event emails?</legend>
      <div className="su-choice-row">
        {[
          { v: true, label: 'Yes, email me' },
          { v: false, label: 'No, don’t email me' },
        ].map((opt, i) => (
          <label key={String(opt.v)} className={`su-choice ${value === opt.v ? 'on' : ''}`}>
            <input
              type="radio"
              name={name}
              checked={value === opt.v}
              onChange={() => onChange(opt.v)}
              aria-invalid={error && i === 0 ? 'true' : undefined}
            />
            <span>{opt.label}</span>
          </label>
        ))}
      </div>
      <p id={`${name}-msg`} className={`su-msg ${error ? 'su-error' : 'su-hint'}`}>
        {error || 'You can change this any time in Settings.'}
      </p>
    </fieldset>
  )
}

/* ---------- Required data consent ---------- */
export function DataConsent({ idPrefix, checked, onChange, error }) {
  const [privacyOpen, setPrivacyOpen] = useState(false)
  const id = `${idPrefix}-consent`
  return (
    <div className={`su-consent ${error ? 'is-invalid' : ''}`}>
      <span className="su-required-tag">Required</span>
      <div className="su-consent-row">
        <input
          type="checkbox"
          {...fieldA11y(id, { error, hint: true })}
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <label htmlFor={id}>
          I agree to the Eendrag Alumni Privacy Policy and understand how my information is used.
        </label>
      </div>
      <p id={`${id}-msg`} className={`su-msg ${error ? 'su-error' : 'su-hint'}`}>
        {error || (
          <>
            Your details are used to verify you and run the alumni community — never sold.{' '}
            <button type="button" className="su-inline-link" onClick={() => setPrivacyOpen(true)}>
              Read the Privacy Policy
            </button>
          </>
        )}
      </p>
      {error && (
        <button type="button" className="su-inline-link su-policy-link" onClick={() => setPrivacyOpen(true)}>
          Read the Privacy Policy
        </button>
      )}
      {privacyOpen && <PrivacyPolicyModal onClose={() => setPrivacyOpen(false)} />}
    </div>
  )
}

/* ---------- Application progress ----------
   The whole journey in one glance, used on every screen between "create
   account" and "approved" so a person always knows what they've done, where
   they are and what happens next.
   Each step: { label, state: 'done' | 'current' | 'todo' | 'stopped', detail? } */
export function ApplicationProgress({ steps, label = 'Your application' }) {
  return (
    <ol className="su-progress" aria-label={label}>
      {steps.map((s) => (
        <li key={s.label} className={`su-progress-step is-${s.state}`} aria-current={s.state === 'current' ? 'step' : undefined}>
          <span className="su-progress-mark" aria-hidden="true">
            {s.state === 'done' ? '✓' : s.state === 'stopped' ? '!' : ''}
          </span>
          <span className="su-progress-text">
            <span className="su-progress-label">
              {s.label}
              <span className="sr-only">
                {s.state === 'done' ? ' — done' : s.state === 'current' ? ' — in progress' : s.state === 'stopped' ? ' — needs attention' : ' — not yet'}
              </span>
            </span>
            {s.detail && <span className="su-progress-detail">{s.detail}</span>}
          </span>
        </li>
      ))}
    </ol>
  )
}
