import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import ClearableInput from './ClearableInput.jsx'
import PasswordInput from './PasswordInput.jsx'
import Turnstile, { TURNSTILE_SITE_KEY } from './Turnstile.jsx'
import {
  Field, fieldA11y, YearsFields, LocationFields, NewsPreference, DataConsent, ApplicationProgress,
} from './SignupFields.jsx'
import { PasswordGuidance } from '../passwordRules.jsx'
import { authRedirectTo } from '../authRedirect.js'
import { friendlyAuthError } from '../authErrors.js'
import { SIGNUP_COLLECT_ADDRESS } from '../constants.js'
import {
  DEFAULT_COUNTRY, EMAIL_RE, cleanEmail, composeFullName, coordsForCity,
  nameErrors, credentialErrors, yearErrors, locationErrors, consentErrors,
  readDraft, writeDraft, clearDraft, focusFirstInvalid,
} from '../signup.js'

// The sign-in page, and the whole "join" journey up to the point where a
// session exists (after which App.jsx takes over with FinishSignup /
// PendingVerification).
//
// Joining is presented as an application, not a form:
//   1. Create your account   (this wizard — or Google, then FinishSignup)
//   2. Confirm your email    (email signups only; Google has already done it)
//   3. Eendrag verifies your membership   (PendingVerification)
//   4. Approved → welcome    (App.jsx → Profile)
// Every screen along the way says which of those you're on.

// Google only — Facebook/LinkedIn were dropped (each needs its own dev-app
// + review process for little extra coverage). Configured in the Supabase
// dashboard: Authentication → Providers → Google.
async function startGoogle(onError) {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: authRedirectTo() },
  })
  if (error) onError(friendlyAuthError(error))
}

function GoogleButton({ children, onError }) {
  return (
    <button type="button" className="auth-social-btn provider-google" onClick={() => startGoogle(onError)}>
      <GoogleIcon />
      {children}
    </button>
  )
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.5-.3-2.2H12v4.1h6.5c-.1 1.1-.8 2.7-2.4 3.8l3.6 2.8c2.2-2 3.8-5 3.8-8.5z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1 .7-2.4 1.2-4.1 1.2-3.1 0-5.8-2.1-6.8-5l-4 3.1C3.3 21.4 7.3 24 12 24z" />
      <path fill="#FBBC05" d="M5.2 14.3c-.2-.7-.4-1.5-.4-2.3s.1-1.6.4-2.3l-4-3.1C.4 8.3 0 10.1 0 12s.4 3.7 1.2 5.4l4-3.1z" />
      <path fill="#EA4335" d="M12 4.8c2.2 0 3.7.9 4.5 1.7l3.4-3.3C17.9 1.2 15.2 0 12 0 7.3 0 3.3 2.6 1.2 6.6l4 3.1c1-2.9 3.7-4.9 6.8-4.9z" />
    </svg>
  )
}

/* ---------- Signup draft ----------
   See readDraft in ../signup.js. Passwords and the consent tick are never
   saved, so a restored draft always reopens at step 1 where the password has
   to be typed again. */
const SIGNUP_DRAFT_KEY = 'eendrag-signup-draft'
const SIGNUP_DRAFT_FIELDS = [
  'firstName', 'preferredName', 'lastName', 'signupEmail', 'confirmEmail',
  'startYear', 'endYear', 'newsOptIn', 'city', 'cityCoords', 'country',
  'address1', 'address2', 'address3', 'province', 'postCode',
]
const EMPTY_SIGNUP = {
  firstName: '', preferredName: '', lastName: '', signupEmail: '', confirmEmail: '',
  startYear: '', endYear: '', newsOptIn: null,
  city: '', cityCoords: null, country: DEFAULT_COUNTRY,
  address1: '', address2: '', address3: '', province: '', postCode: '',
}
function draftHasContent(values) {
  return SIGNUP_DRAFT_FIELDS.some((k) => {
    const v = values[k]
    if (v === '' || v === null || v === undefined) return false
    return !(k === 'country' && v === DEFAULT_COUNTRY)
  })
}

const STEP_TITLES = { 1: 'Create your account', 2: 'Your time in Eendrag', 3: 'Privacy and emails' }
const STEP_SHORT = { 1: 'Your details', 2: 'Eendrag years', 3: 'Privacy' }
const LAST_STEP = 3

// `initialError` carries a message App.jsx pulled off an OAuth / email-link
// redirect (a cancelled Google consent screen, an expired link).
// `initialMode` lets App.jsx open a specific view — 'forgot' for an expired
// link, since that screen offers both a reset and a confirmation resend.
export default function Auth({ initialError = null, initialMode = null }) {
  const navigate = useNavigate()
  const location = useLocation()

  const [mode, setMode] = useState(initialMode || 'signin') // 'signin' | 'signup' | 'forgot'
  // App.jsx resolves these in an effect, which can land after mount.
  useEffect(() => { if (initialMode) setMode(initialMode) }, [initialMode])

  /* ---------- Sign-in / forgot state ---------- */
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const [error, setError] = useState(initialError)
  useEffect(() => { if (initialError) setError(initialError) }, [initialError])
  // Set when a sign-in fails with "Email not confirmed" — confirmation links
  // expire, and without a resend reachable from here that person could never
  // get in: signing up again says "already registered", signing in says
  // "not confirmed".
  const [signinUnconfirmed, setSigninUnconfirmed] = useState(false)

  /* ---------- Signup state ---------- */
  const [draft] = useState(() => readDraft(SIGNUP_DRAFT_KEY, SIGNUP_DRAFT_FIELDS))
  const [draftRestored, setDraftRestored] = useState(() => Object.keys(draft).length > 0)
  const [values, setValues] = useState(() => ({ ...EMPTY_SIGNUP, ...draft }))
  // Never in `values`, so they can't end up in the draft by accident.
  const [signupPassword, setSignupPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [dataConsent, setDataConsent] = useState(false)
  // 0 = choose Google or email, 1–3 = the email wizard. A restored draft
  // means they already chose email, so it reopens at step 1.
  const [signupStep, setSignupStep] = useState(() => (Object.keys(draft).length > 0 ? 1 : 0))
  // Field-level error display: a field's message shows once it's been left
  // with something in it, or once Continue has been pressed on its step.
  const [touched, setTouched] = useState({})
  const [attempted, setAttempted] = useState({})
  const [signupBusy, setSignupBusy] = useState(false)
  const submittingRef = useRef(false)
  const [signupError, setSignupError] = useState(null)
  // null | 'confirm' (check your inbox) | 'pending' (signed straight in) |
  // 'exists' (address may already be registered) | 'created' (sign in to continue)
  const [signupResult, setSignupResult] = useState(null)
  const wizardRef = useRef(null)
  const stepHeadingRef = useRef(null)

  /* ---------- Captcha + resend ---------- */
  const [captchaToken, setCaptchaToken] = useState(null)
  // Bumped after every auth call: Turnstile tokens are single-use.
  const [captchaReset, setCaptchaReset] = useState(0)
  const bumpCaptcha = () => setCaptchaReset((n) => n + 1)
  const [resend, setResend] = useState({ busy: false, msg: null, waitingFor: null })
  // The "check your email" screen only shows a security check once someone
  // actually asks for another email — there's nothing to verify before that.
  const [resendCaptchaShown, setResendCaptchaShown] = useState(false)

  const setField = (key, value) => setValues((v) => ({ ...v, [key]: value }))
  const touch = (key) => setTouched((t) => (t[key] ? t : { ...t, [key]: true }))
  // Leaving an empty field you never typed in isn't a mistake yet — only
  // flag it once there's something in it (or Continue was pressed).
  const touchIfFilled = (key, value) => { if (String(value ?? '').trim()) touch(key) }

  /* ---------- Validation (recomputed every render, so never stale) ---------- */
  const stepErrors = {
    1: {
      ...nameErrors(values),
      ...credentialErrors({
        email: values.signupEmail,
        confirmEmail: values.confirmEmail,
        password: signupPassword,
        confirmPassword,
      }),
    },
    2: { ...yearErrors(values), ...locationErrors(values) },
    3: {
      ...consentErrors({ newsOptIn: values.newsOptIn, dataConsent }),
      ...(TURNSTILE_SITE_KEY && !captchaToken ? { captcha: 'Complete the security check to continue.' } : {}),
    },
  }
  function shownErrors(step) {
    const all = stepErrors[step]
    const out = {}
    for (const [k, msg] of Object.entries(all)) {
      if (attempted[step] || touched[k]) out[k] = msg
    }
    return out
  }
  const e1 = shownErrors(1)
  const e2 = shownErrors(2)
  const e3 = shownErrors(3)
  const firstInvalidStep = [1, 2, 3].find((s) => Object.keys(stepErrors[s]).length > 0) || null

  /* ---------- Step navigation + browser history ----------
     Each wizard step is its own history entry, so the phone back-gesture
     goes back a step instead of leaving the site. Steps can't be skipped:
     a history entry pointing past a step that's no longer valid (e.g. after
     a refresh, which never restores passwords) lands on that step instead. */
  function clampStep(n) {
    for (let s = 1; s < n; s++) {
      if (Object.keys(stepErrors[s]).filter((k) => k !== 'captcha').length > 0) return s
    }
    return n
  }
  function goToStep(n, { replace = false } = {}) {
    setSignupStep(n)
    navigate(location.pathname + location.search, {
      replace,
      state: { ...(location.state || {}), signupStep: n, prevStep: replace ? location.state?.prevStep : signupStep },
    })
  }
  function stepBack() {
    const prev = signupStep - 1
    // If the entry before this one is the previous step, use real history so
    // the browser's own Back/Forward stay in step with the buttons.
    if (location.state?.signupStep === signupStep && location.state?.prevStep === prev) navigate(-1)
    else goToStep(prev, { replace: true })
  }
  const historyStep = location.state?.signupStep
  useEffect(() => {
    if (mode !== 'signup' || signupResult) return
    if (typeof historyStep === 'number') setSignupStep(clampStep(historyStep))
    else if (signupStep > 0 && !draftRestored) setSignupStep(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key])
  // A restored draft opens at step 1 without the choice screen before it, so
  // anchor that entry in history too.
  useEffect(() => {
    if (mode === 'signup' && signupStep === 1 && typeof historyStep !== 'number') {
      navigate(location.pathname + location.search, { replace: true, state: { ...(location.state || {}), signupStep: 1 } })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  // Move focus to the new step's heading (and the top of the card into
  // view) so keyboard and screen-reader users start at the top of the step,
  // and phone users aren't left looking at the bottom of a page that changed.
  const firstStepRender = useRef(true)
  useEffect(() => {
    if (firstStepRender.current) { firstStepRender.current = false; return }
    if (mode !== 'signup' || signupStep === 0) return
    const h = stepHeadingRef.current
    if (h) {
      h.focus({ preventScroll: true })
      h.closest('.auth-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [signupStep, mode])

  /* ---------- Draft persistence ---------- */
  const hasContent = draftHasContent(values)
  useEffect(() => {
    if (mode !== 'signup' || signupResult || !hasContent) return
    writeDraft(SIGNUP_DRAFT_KEY, SIGNUP_DRAFT_FIELDS, values)
  }, [mode, signupResult, hasContent, values])

  // The draft covers everything except the passwords. Closing the tab
  // mid-wizard asks first rather than silently binning the form.
  useEffect(() => {
    if (mode !== 'signup' || signupResult) return undefined
    if (!hasContent && !signupPassword) return undefined
    function handler(e) { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [mode, signupResult, hasContent, signupPassword])

  function startFresh() {
    clearDraft(SIGNUP_DRAFT_KEY)
    setDraftRestored(false)
    setValues(EMPTY_SIGNUP)
    setSignupPassword('')
    setConfirmPassword('')
    setDataConsent(false)
    setTouched({})
    setAttempted({})
    setSignupError(null)
    goToStep(1, { replace: true })
  }

  function resetSignupForm() {
    setValues(EMPTY_SIGNUP)
    setSignupPassword('')
    setConfirmPassword('')
    setDataConsent(false)
    setTouched({})
    setAttempted({})
    setDraftRestored(false)
  }

  function switchMode(next) {
    setMode(next)
    setError(null)
    setNotice(null)
    setSignupError(null)
    setSigninUnconfirmed(false)
    setResend({ busy: false, msg: null, waitingFor: null })
    setResendCaptchaShown(false)
    if (next === 'signup') setSignupStep(draftRestored ? 1 : 0)
  }

  // Recovery from "this email may already have an account". Carries the
  // email across — never the password: it was typed for a different purpose,
  // and silently moving a plaintext password between forms is exactly the
  // kind of thing a member can't see and shouldn't have to trust.
  function goToSignIn(withEmail = values.signupEmail) {
    setEmail(cleanEmail(withEmail))
    setPassword('')
    setSignupResult(null)
    switchMode('signin')
  }
  function goToForgot(withEmail = values.signupEmail) {
    setEmail(cleanEmail(withEmail))
    setSignupResult(null)
    switchMode('forgot')
  }

  /* ---------- Sign in / forgot ---------- */
  function validateSignin() {
    const addr = cleanEmail(email)
    if (!addr) return 'Enter your email address.'
    if (!EMAIL_RE.test(addr)) return 'Enter a valid email address, like name@example.com.'
    if (mode === 'signin' && !password) return 'Enter your password.'
    if (TURNSTILE_SITE_KEY && !captchaToken) return 'Please complete the security check.'
    return null
  }

  async function handleSigninSubmit(e) {
    e.preventDefault()
    if (busy) return
    const problem = validateSignin()
    if (problem) { setError(problem); setNotice(null); return }
    // A pasted address with a trailing space used to pass validation and then
    // fail as "invalid login credentials", which reads as a wrong password.
    const addr = cleanEmail(email)
    if (addr !== email) setEmail(addr)
    setBusy(true); setError(null); setNotice(null); setSigninUnconfirmed(false)
    setResend({ busy: false, msg: null, waitingFor: null })
    try {
      if (mode === 'forgot') {
        // The emailed link signs the browser into a recovery session and
        // fires PASSWORD_RECOVERY — App.jsx swaps in ResetPassword.jsx.
        const { error: err } = await supabase.auth.resetPasswordForEmail(addr, {
          redirectTo: authRedirectTo(),
          captchaToken,
        })
        if (err) throw err
        setNotice('If that email is registered, a reset link is on its way. Check your inbox and spam folder.')
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email: addr, password, options: { captchaToken } })
        if (err) throw err
      }
    } catch (e2) {
      setError(friendlyAuthError(e2))
      if (mode === 'signin' && /email not confirmed|email_not_confirmed/i.test(e2?.message || '')) {
        setSigninUnconfirmed(true)
      }
    } finally {
      setBusy(false)
      bumpCaptcha()
    }
  }

  /* ---------- Resend confirmation ----------
     Used by the "check your email" screen, the sign-in form's "not
     confirmed" recovery and the forgot-password screen. GoTrue validates a
     captcha token on /resend exactly as it does on /signup, so where CAPTCHA
     is on, a resend waits for the security check and then sends by itself —
     the person doesn't have to click twice. */
  async function sendResend(addr) {
    setResend({ busy: true, msg: null, waitingFor: null })
    let err = null
    try {
      const res = await supabase.auth.resend({
        type: 'signup',
        email: addr,
        options: { emailRedirectTo: authRedirectTo(), ...(captchaToken ? { captchaToken } : {}) },
      })
      err = res.error
    } catch (e2) {
      err = e2
    }
    bumpCaptcha()
    setResend({
      busy: false,
      waitingFor: null,
      msg: err
        ? { type: 'error', text: friendlyAuthError(err) }
        : { type: 'ok', text: `Confirmation email sent to ${addr}. It can take a minute or two to arrive — check your spam folder too.` },
    })
  }
  function requestResend(rawAddr) {
    if (resend.busy) return
    const addr = cleanEmail(rawAddr)
    if (!addr) { setResend({ busy: false, waitingFor: null, msg: { type: 'error', text: 'Enter the email address you signed up with first.' } }); return }
    if (!EMAIL_RE.test(addr)) { setResend({ busy: false, waitingFor: null, msg: { type: 'error', text: 'That email address doesn’t look right — check it for typos.' } }); return }
    if (TURNSTILE_SITE_KEY && !captchaToken) {
      setResendCaptchaShown(true)
      setResend({ busy: false, waitingFor: addr, msg: { type: 'info', text: 'Please verify you’re human before resending — the email will send as soon as the security check is complete.' } })
      return
    }
    sendResend(addr)
  }
  useEffect(() => {
    if (captchaToken && resend.waitingFor && !resend.busy) sendResend(resend.waitingFor)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captchaToken])

  /* ---------- Wizard ---------- */
  function errorCount(step) {
    return Object.keys(stepErrors[step]).length
  }

  function nextStep() {
    if (errorCount(signupStep) > 0) {
      setAttempted((a) => ({ ...a, [signupStep]: true }))
      focusFirstInvalid(wizardRef.current)
      return
    }
    goToStep(signupStep + 1)
  }

  function onWizardSubmit(e) {
    e.preventDefault()
    if (signupStep < LAST_STEP) nextStep()
    else submitSignup()
  }

  async function submitSignup() {
    if (submittingRef.current) return // double-click / double-Enter
    // Earlier steps are re-checked too: they can't normally be invalid here,
    // but a history jump or a browser autofill after the fact could make them so.
    if (firstInvalidStep && firstInvalidStep < LAST_STEP) {
      setAttempted((a) => ({ ...a, [firstInvalidStep]: true }))
      goToStep(firstInvalidStep)
      return
    }
    if (errorCount(LAST_STEP) > 0) {
      setAttempted((a) => ({ ...a, [LAST_STEP]: true }))
      focusFirstInvalid(wizardRef.current)
      return
    }

    submittingRef.current = true
    setSignupBusy(true)
    setSignupError(null)

    const coords = coordsForCity(values.city, values.cityCoords)
    const signupEmail = cleanEmail(values.signupEmail)
    const details = {
      full_name: composeFullName(values.firstName, values.preferredName, values.lastName),
      first_name: values.firstName.trim(),
      preferred_name: values.preferredName.trim(),
      last_name: values.lastName.trim(),
      start_year: Number(values.startYear),
      grad_year: Number(values.endYear),
      email_news_opt_in: values.newsOptIn === true,
      address_line1: values.address1.trim(),
      address_line2: values.address2.trim(),
      address_line3: values.address3.trim(),
      province: values.province.trim(),
      city: values.city.trim(),
      postal_code: values.postCode.trim(),
      country: values.country.trim(),
      // handle_new_user (schema-update-46/57) reads this and stamps
      // consented_at server-side the moment the auth user is created.
      data_consent: true,
      // Only when the city was matched to a map location — a null pair would
      // wipe coordinates the profile might already have.
      ...(coords || {}),
    }

    try {
      const { data, error: err } = await supabase.auth.signUp({
        email: signupEmail,
        password: signupPassword,
        // The details ride along as user_metadata so handle_new_user can write
        // the profile even when there's no session yet (email confirmation on).
        options: { captchaToken, data: details, emailRedirectTo: authRedirectTo() },
      })
      if (err) throw err

      // Already registered, the quiet way. With "Confirm email" on, Supabase
      // returns a fake success (a user with no identities) rather than
      // revealing the address exists. Our wording keeps that property.
      if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        setSignupResult('exists')
        return
      }

      // No session at signup means the address must be confirmed first.
      if (!data?.session) {
        clearDraft(SIGNUP_DRAFT_KEY)
        setSignupResult(data?.user && !data.user.email_confirmed_at ? 'confirm' : 'created')
        return
      }

      // Signed straight in ("Confirm email" off). handle_new_user has already
      // written everything; this update is a safety net for anything the
      // trigger couldn't apply.
      const { error: profErr } = await supabase
        .from('profiles')
        .update({
          full_name: details.full_name,
          first_name: details.first_name,
          preferred_name: details.preferred_name,
          last_name: details.last_name,
          start_year: details.start_year,
          grad_year: details.grad_year,
          email_news_opt_in: details.email_news_opt_in,
          address_line1: details.address_line1,
          address_line2: details.address_line2,
          address_line3: details.address_line3,
          province: details.province,
          city: details.city,
          postal_code: details.postal_code,
          country: details.country,
          ...(coords || {}),
          consented_at: new Date().toISOString(),
        })
        .eq('id', data.session.user.id)
      if (profErr) console.warn('Profile update after signup failed:', profErr.message)
      clearDraft(SIGNUP_DRAFT_KEY)
      // App.jsx's auth listener swaps this screen for PendingVerification,
      // which also sends the "we've received your application" email.
      setSignupResult('pending')
    } catch (e2) {
      if (/already registered|already exists|user_already_exists/i.test(e2?.message || '')) {
        setSignupResult('exists')
      } else {
        setSignupError(friendlyAuthError(e2))
      }
    } finally {
      submittingRef.current = false
      setSignupBusy(false)
      bumpCaptcha()
    }
  }

  /* ---------- Render ---------- */
  const firstName = values.preferredName.trim() || values.firstName.trim()

  if (signupResult === 'confirm' || signupResult === 'pending') {
    const confirming = signupResult === 'confirm'
    return (
      <div className="auth-page">
        <div className="auth-card su-done">
          <img src="/eendrag-logo.png" alt="Eendrag logo" className="auth-logo small" />
          <h1 className="su-title">{confirming ? 'You’re almost in' : 'Application received'}</h1>
          <p className="su-lead">
            {firstName ? `Thanks, ${firstName}. ` : ''}We&rsquo;ve created your Eendrag Alumni application.
          </p>

          <ApplicationProgress
            steps={[
              { label: 'Account created', state: 'done' },
              confirming
                ? { label: 'Confirm your email', state: 'current', detail: <>We sent a confirmation link to <strong className="su-email">{cleanEmail(values.signupEmail)}</strong></> }
                : { label: 'Email confirmed', state: 'done' },
              { label: 'Eendrag verification', state: confirming ? 'todo' : 'current', detail: 'Once your email is confirmed, the committee checks your details against residence records.' },
              { label: 'Approved', state: 'todo', detail: 'We’ll email you as soon as your account is approved.' },
            ]}
          />

          {confirming ? (
            <>
              <div className="su-callout">
                <p><strong>Next: open the email and click the link.</strong> That confirms the address is yours and signs you in, where you can follow your application.</p>
                <p className="su-muted">Nothing after a few minutes? Check your spam or junk folder. Links expire after a while — you can always ask for a new one.</p>
              </div>

              {resend.msg && (
                <p className={resend.msg.type === 'ok' ? 'form-notice' : resend.msg.type === 'info' ? 'su-msg su-hint su-center' : 'form-error'} role="status">
                  {resend.msg.text}
                </p>
              )}
              {resendCaptchaShown && (
                <Turnstile onToken={setCaptchaToken} resetSignal={captchaReset} />
              )}
              <button
                type="button"
                className="btn ghost wide"
                onClick={() => requestResend(values.signupEmail)}
                disabled={resend.busy || !!resend.waitingFor}
              >
                {resend.busy ? 'Sending…' : 'Resend confirmation email'}
              </button>
              <button
                type="button"
                className="btn primary wide su-gap"
                onClick={() => { const addr = values.signupEmail; resetSignupForm(); goToSignIn(addr) }}
              >
                Return to sign in
              </button>
              <p className="su-small">
                Typed the wrong address?{' '}
                <button
                  type="button"
                  className="su-inline-link"
                  onClick={() => {
                    setSignupResult(null)
                    setValues((v) => ({ ...v, signupEmail: '', confirmEmail: '' }))
                    setSignupPassword(''); setConfirmPassword(''); setDataConsent(false)
                    setTouched({}); setAttempted({})
                    setResend({ busy: false, msg: null, waitingFor: null })
                    setResendCaptchaShown(false)
                    goToStep(1, { replace: true })
                  }}
                >
                  Sign up again with the right one
                </button>
              </p>
            </>
          ) : (
            <p className="su-small" role="status">Opening your application status…</p>
          )}
        </div>
      </div>
    )
  }

  const inWizard = mode === 'signup' && signupStep > 0

  return (
    <div className="auth-page">
      <div className={inWizard ? 'auth-card auth-card-wizard' : 'auth-card'}>
        <img src="/eendrag-logo.png" alt="Eendrag logo" className={inWizard ? 'auth-logo small' : 'auth-logo'} />
        <h1 className="auth-title">Eendrag Alumni</h1>
        {!inWizard && <p className="auth-sub">Character · Style · Pride · Since 1961</p>}

        {mode !== 'forgot' && !inWizard && !signupResult && (
          // Two buttons with aria-pressed, deliberately not role="tablist":
          // there are no tabpanels or arrow-key behaviour to back that up.
          <div className="auth-tabs">
            <button type="button" aria-pressed={mode === 'signin'} className={mode === 'signin' ? 'auth-tab on' : 'auth-tab'} onClick={() => switchMode('signin')}>
              Sign in
            </button>
            <button type="button" aria-pressed={mode === 'signup'} className={mode === 'signup' ? 'auth-tab on' : 'auth-tab'} onClick={() => switchMode('signup')}>
              Join
            </button>
          </div>
        )}

        {mode !== 'signup' && renderSigninForm()}

        {mode === 'forgot' && (
          <button type="button" className="link-btn" onClick={() => switchMode('signin')}>
            Back to sign in
          </button>
        )}

        {mode === 'signup' && (
          signupResult === 'exists' || signupResult === 'created'
            ? renderAccountExists()
            : signupStep === 0 ? renderChoice() : renderWizard()
        )}

        {mode === 'signin' && (
          <p className="auth-note">
            New accounts are verified against Eendrag residence records &mdash; we&rsquo;ll
            email you as soon as yours is approved.
          </p>
        )}
      </div>
    </div>
  )

  /* ---------- Render pieces ---------- */

  function renderResendBlock(addr, label = 'Resend confirmation email') {
    return (
      <div className="su-resend">
        {resend.msg && (
          <p className={resend.msg.type === 'ok' ? 'form-notice' : resend.msg.type === 'info' ? 'su-msg su-hint' : 'form-error'} role="status">
            {resend.msg.text}
          </p>
        )}
        <button type="button" className="btn ghost wide" onClick={() => requestResend(addr)} disabled={resend.busy || busy}>
          {resend.busy ? 'Sending…' : label}
        </button>
      </div>
    )
  }

  function renderSigninForm() {
    return (
      <form onSubmit={handleSigninSubmit} noValidate>
        {mode === 'signin' && (
          <>
            <GoogleButton onError={setError}>Continue with Google</GoogleButton>
            <div className="auth-divider"><span>or sign in with email</span></div>
          </>
        )}
        {mode === 'forgot' && (
          <>
            <h2 className="su-step-title">Reset your password</h2>
            <p className="su-step-sub">Enter the email you joined with and we&rsquo;ll send you a link to choose a new password.</p>
          </>
        )}
        <label className="field">
          <span>Email</span>
          <ClearableInput
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onClear={() => setEmail('')}
            placeholder="you@example.com"
            autoComplete="email"
            inputMode="email"
          />
        </label>
        {mode === 'signin' && (
          <>
            <label className="field">
              <span>Password</span>
              <PasswordInput
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Your password"
                autoComplete="current-password"
              />
            </label>
            <button type="button" className="link-btn auth-forgot-link" onClick={() => switchMode('forgot')}>
              Forgot password?
            </button>
          </>
        )}

        <Turnstile onToken={setCaptchaToken} resetSignal={captchaReset} />

        {error && <p className="form-error" role="alert">{error}</p>}
        {notice && <p className="form-notice" role="status">{notice}</p>}

        {signinUnconfirmed && renderResendBlock(email)}

        <button type="submit" className="btn primary wide" disabled={busy}>
          {busy ? (mode === 'forgot' ? 'Sending…' : 'Signing in…') : mode === 'forgot' ? 'Send reset link' : 'Sign in'}
        </button>

        {/* An expired link comes back from Supabase identically whether it
            was a password-reset link or a signup-confirmation one, and App.jsx
            lands both here — so this screen offers both remedies. */}
        {mode === 'forgot' && (
          <div className="su-alt-action">
            <p className="su-small">Never confirmed your email when you joined? A reset link won&rsquo;t help &mdash; ask for a new confirmation link instead.</p>
            {renderResendBlock(email, 'Resend my confirmation email')}
          </div>
        )}
      </form>
    )
  }

  function renderChoice() {
    return (
      <div className="su-choice-screen">
        <h2 className="su-step-title">Join Eendrag Alumni</h2>
        <p className="su-step-sub">For everyone who lived in Eendrag. It takes about two minutes.</p>
        <ol className="su-journey">
          <li><span>1</span>Create your account</li>
          <li><span>2</span>Confirm your email</li>
          <li><span>3</span>The committee verifies you lived in Eendrag</li>
        </ol>
        <p className="su-small su-journey-after">We&rsquo;ll email you as soon as you&rsquo;re approved.</p>

        <GoogleButton onError={setSignupError}>Continue with Google</GoogleButton>
        <div className="auth-divider"><span>or</span></div>
        <button type="button" className="btn primary wide" onClick={() => goToStep(1)}>
          Continue with email
        </button>
        {signupError && <p className="form-error" role="alert">{signupError}</p>}
        <p className="su-small su-center">With Google you skip the password and the confirmation email.</p>
      </div>
    )
  }

  function renderAccountExists() {
    const addr = cleanEmail(values.signupEmail)
    const exists = signupResult === 'exists'
    return (
      <div className="su-panel" role="status">
        <h2 className="su-step-title">{exists ? 'You may already have an account' : 'Your account was created'}</h2>
        {exists ? (
          <p className="su-step-sub">
            This email may already be associated with an Eendrag Alumni account.
            We&rsquo;ve sent instructions to your inbox if action is required.
          </p>
        ) : (
          <p className="su-step-sub">Sign in to continue your application.</p>
        )}
        {addr && <p className="su-email-box">{addr}</p>}
        <button type="button" className="btn primary wide" onClick={() => goToSignIn(addr)}>Go to sign in</button>
        {exists && (
          <button type="button" className="btn ghost wide su-gap" onClick={() => goToForgot(addr)}>Forgot password?</button>
        )}
        {exists && (
          <button
            type="button"
            className="link-btn"
            onClick={() => { setSignupResult(null); setValues((v) => ({ ...v, signupEmail: '', confirmEmail: '' })); goToStep(1, { replace: true }) }}
          >
            Use a different email address
          </button>
        )}
      </div>
    )
  }

  function renderWizard() {
    const step = signupStep
    const pwId = 'su-password'
    const visibleCount = Object.keys(shownErrors(step)).length
    return (
      <form ref={wizardRef} onSubmit={onWizardSubmit} noValidate className="su-wizard">
        <div className="su-steps">
          <p className="su-steps-count">Step {step} of {LAST_STEP} <span aria-hidden="true">·</span> {STEP_SHORT[step]}</p>
          <ol className="su-steps-bar" aria-hidden="true">
            {[1, 2, 3].map((n) => (
              <li key={n} className={n < step ? 'is-done' : n === step ? 'is-current' : ''} />
            ))}
          </ol>
        </div>
        <h2 className="su-step-title" tabIndex={-1} ref={stepHeadingRef}>{STEP_TITLES[step]}</h2>

        {draftRestored && (
          <div className="su-restored" role="status">
            <p>
              We&rsquo;ve restored what you entered.
              {step === 1 && ' Your password isn’t saved, so please type it again.'}
            </p>
            <button type="button" className="su-inline-link" onClick={startFresh}>Start fresh instead</button>
          </div>
        )}

        {/* Step 1 is hidden, not unmounted: password managers decide whether
            to offer "save this password?" by inspecting the form at submit,
            and that happens on step 3. */}
        <div hidden={step !== 1} style={step === 1 ? undefined : { display: 'none' }}>
          <p className="su-small su-required-note">All fields are required unless marked optional.</p>
          <div className="auth-field-row">
            <Field id="su-first" label="First name" error={e1.firstName}>
              <input
                {...fieldA11y('su-first', { error: e1.firstName })}
                value={values.firstName}
                onChange={(e) => setField('firstName', e.target.value)}
                onBlur={(e) => touchIfFilled('firstName', e.target.value)}
                autoComplete="given-name"
              />
            </Field>
            <Field id="su-last" label="Last name" error={e1.lastName}>
              <input
                {...fieldA11y('su-last', { error: e1.lastName })}
                value={values.lastName}
                onChange={(e) => setField('lastName', e.target.value)}
                onBlur={(e) => touchIfFilled('lastName', e.target.value)}
                autoComplete="family-name"
              />
            </Field>
          </div>
          <Field id="su-preferred" label="Preferred first name" optional hint="This is the name other alumni will see — e.g. JP or Wikus.">
            <input
              {...fieldA11y('su-preferred', { hint: true })}
              value={values.preferredName}
              onChange={(e) => setField('preferredName', e.target.value)}
              autoComplete="nickname"
            />
          </Field>
          <Field id="su-email" label="Email" error={e1.email}>
            {/* `username`: this is the field password managers pair with the
                new-password fields below when saving the login. */}
            <input
              type="email"
              inputMode="email"
              {...fieldA11y('su-email', { error: e1.email })}
              value={values.signupEmail}
              onChange={(e) => setField('signupEmail', e.target.value)}
              onBlur={(e) => { touchIfFilled('email', e.target.value); if (e.target.value !== cleanEmail(e.target.value)) setField('signupEmail', cleanEmail(e.target.value)) }}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
            />
          </Field>
          <Field
            id="su-email2"
            label="Confirm email"
            error={e1.confirmEmail}
            valid={!stepErrors[1].confirmEmail && !stepErrors[1].email ? '✓ Email addresses match' : null}
          >
            <input
              type="email"
              inputMode="email"
              {...fieldA11y('su-email2', { error: e1.confirmEmail, valid: !stepErrors[1].confirmEmail && !stepErrors[1].email })}
              value={values.confirmEmail}
              onChange={(e) => setField('confirmEmail', e.target.value)}
              onBlur={(e) => { touchIfFilled('confirmEmail', e.target.value); if (e.target.value !== cleanEmail(e.target.value)) setField('confirmEmail', cleanEmail(e.target.value)) }}
              onPaste={() => touch('confirmEmail')}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
            />
          </Field>
          <Field id={pwId} label="Password" error={e1.password}>
            <PasswordInput
              {...fieldA11y(pwId, { error: e1.password })}
              aria-describedby={`${e1.password ? `${pwId}-msg ` : ''}${pwId}-guide`}
              value={signupPassword}
              onChange={(e) => setSignupPassword(e.target.value)}
              onBlur={(e) => touchIfFilled('password', e.target.value)}
              autoComplete="new-password"
            />
          </Field>
          <PasswordGuidance password={signupPassword} id={`${pwId}-guide`} />
          <Field
            id="su-password2"
            label="Confirm password"
            error={e1.confirmPassword}
            valid={confirmPassword && !stepErrors[1].confirmPassword ? '✓ Passwords match' : null}
          >
            <PasswordInput
              {...fieldA11y('su-password2', { error: e1.confirmPassword, valid: confirmPassword && !stepErrors[1].confirmPassword })}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              onBlur={(e) => touchIfFilled('confirmPassword', e.target.value)}
              autoComplete="new-password"
            />
          </Field>
        </div>

        {step === 2 && (
          <>
            <p className="su-step-sub">The committee checks your years against residence records.</p>
            <YearsFields
              idPrefix="su"
              startYear={values.startYear}
              endYear={values.endYear}
              onStartYear={(v) => { setField('startYear', v); touch('startYear') }}
              onEndYear={(v) => { setField('endYear', v); touch('endYear') }}
              errors={e2}
            />
            <h3 className="su-subheading">Where you live now</h3>
            <p className="su-small">Your city and country put you on the alumni map.</p>
            <LocationFields
              idPrefix="su"
              city={values.city}
              country={values.country}
              cityCoords={values.cityCoords}
              onCity={(v) => setField('city', v)}
              onCityCoords={(c) => setField('cityCoords', c)}
              onCountry={(v) => setField('country', v)}
              errors={e2}
              onBlur={(k) => touchIfFilled(k, values[k])}
            />
            {/* TEMPORARY (Sept 2026 intake): SIGNUP_COLLECT_ADDRESS in
                constants.js decides whether the wizard also asks for a postal
                address. It's optional either way and never used for
                verification; Profile.jsx collects it for everyone else. */}
            {SIGNUP_COLLECT_ADDRESS && renderAddressBlock()}
          </>
        )}

        {step === 3 && (
          <>
            <NewsPreference
              idPrefix="su"
              value={values.newsOptIn}
              onChange={(v) => setField('newsOptIn', v)}
              error={e3.newsOptIn}
            />
            <DataConsent
              idPrefix="su"
              checked={dataConsent}
              onChange={setDataConsent}
              error={e3.dataConsent}
            />
            {TURNSTILE_SITE_KEY && (
              <div className="su-captcha">
                <p className="su-small su-center">Quick security check</p>
                <Turnstile onToken={setCaptchaToken} resetSignal={captchaReset} />
                {e3.captcha && <p className="su-msg su-error su-center">{e3.captcha}</p>}
              </div>
            )}
          </>
        )}

        {visibleCount > 0 && (
          <p className="su-summary" role="alert">
            {visibleCount === 1 ? 'Please fix the highlighted field.' : `Please fix the ${visibleCount} highlighted fields.`}
          </p>
        )}
        {signupError && <p className="form-error" role="alert">{signupError}</p>}

        <div className="auth-wizard-actions">
          <button type="button" className="btn ghost" onClick={stepBack} disabled={signupBusy}>
            Back
          </button>
          {step < LAST_STEP ? (
            <button type="submit" className="btn primary">Continue</button>
          ) : (
            <button type="submit" className="btn primary" disabled={signupBusy} aria-busy={signupBusy}>
              {signupBusy ? 'Creating your account…' : 'Create account'}
            </button>
          )}
        </div>
      </form>
    )
  }

  function renderAddressBlock() {
    return (
      <>
        <h3 className="su-subheading">Postal address <span className="su-optional">Optional</span></h3>
        <p className="su-small">Used only to post you reunion invitations. It isn&rsquo;t shown on your profile.</p>
        <Field id="su-addr1" label="Address line 1">
          <input id="su-addr1" value={values.address1} onChange={(e) => setField('address1', e.target.value)} autoComplete="address-line1" />
        </Field>
        <Field id="su-addr2" label="Address line 2">
          <input id="su-addr2" value={values.address2} onChange={(e) => setField('address2', e.target.value)} autoComplete="address-line2" />
        </Field>
        <Field id="su-addr3" label="Address line 3">
          <input id="su-addr3" value={values.address3} onChange={(e) => setField('address3', e.target.value)} autoComplete="address-line3" />
        </Field>
        <div className="auth-field-row">
          <Field id="su-province" label="Province / state">
            <input id="su-province" value={values.province} onChange={(e) => setField('province', e.target.value)} autoComplete="address-level1" />
          </Field>
          <Field id="su-postcode" label="Post code">
            <input id="su-postcode" value={values.postCode} onChange={(e) => setField('postCode', e.target.value)} autoComplete="postal-code" />
          </Field>
        </div>
      </>
    )
  }
}
