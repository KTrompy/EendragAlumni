import { useEffect, useRef, useState } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { supabase } from './supabaseClient'
import Auth from './components/Auth.jsx'
import Onboarding from './components/Onboarding.jsx'
import Feed from './components/Feed.jsx'
import People from './components/People.jsx'
import { Avatar } from './components/Directory.jsx'
import FloatingMessages from './components/FloatingMessages.jsx'
import Profile from './components/Profile.jsx'
import Events from './components/Events.jsx'
import Jobs from './components/Jobs.jsx'
import Donate from './components/Donate.jsx'
import Admin from './components/Admin.jsx'
import NotificationBell from './components/NotificationBell.jsx'
import ConfirmDialog from './components/ConfirmDialog.jsx'

// Eendragters (directory) now includes the alumni map as a view toggle
// (see People.jsx) instead of splitting "find a person" across two nav
// items. Support/Donate isn't a top-level tab while it's still a stub with
// no real payment flow — it's reachable from the footer link instead.
const TABS = [
  { id: 'directory', label: 'Eendragters', path: '/directory' },
  { id: 'feed', label: 'Feed', path: '/feed' },
  { id: 'events', label: 'Events', path: '/events' },
  { id: 'jobs', label: 'Jobs', path: '/jobs' },
  { id: 'profile', label: 'My profile', path: '/profile' },
]

// Admin-only, appended to the nav when the signed-in profile has is_admin
// set — kept out of the base TABS list so it never flashes for regular
// members before the profile loads.
const ADMIN_TAB = { id: 'admin', label: 'Admin', path: '/admin' }

// The mobile bottom tab bar — a smaller subset of TABS (My profile and Sign
// out move to the mobile header/avatar instead, so the bar stays to four
// core sections now that Map lives inside Eendragters).
const MOBILE_TABS = [
  { id: 'directory', label: 'Eendragters', path: '/directory', icon: PeopleIcon },
  { id: 'feed', label: 'Feed', path: '/feed', icon: FeedIcon },
  { id: 'events', label: 'Events', path: '/events', icon: EventsIcon },
  { id: 'jobs', label: 'Jobs', path: '/jobs', icon: JobsIcon },
]

export default function App() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [dmTarget, setDmTarget] = useState(null) // profile to open a DM with
  const [dmDraft, setDmDraft] = useState('') // optional prefilled first message
  const [messagesOpen, setMessagesOpen] = useState(false)
  const [navOpen, setNavOpen] = useState(false) // mobile hamburger menu
  const [loading, setLoading] = useState(true)
  const [checkedFirstRun, setCheckedFirstRun] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)

  const navigate = useNavigate()
  const location = useLocation()

  // Guards against losing unsaved profile edits. `profileDirty` mirrors
  // whether the profile form currently has unsaved changes; `profileSaveRef`
  // lets us trigger that form's save() from up here (e.g. from the "leave
  // without saving?" prompt) without Profile needing to know about
  // navigation at all. `pendingNav`, when set, means someone tried to
  // navigate away while dirty and we're waiting on their answer.
  const [profileDirty, setProfileDirty] = useState(false)
  const profileSaveRef = useRef(null)
  const [pendingNav, setPendingNav] = useState(null)
  const [leaveBusy, setLeaveBusy] = useState(false)
  const [leaveError, setLeaveError] = useState(null)
  const [confirmingSignOut, setConfirmingSignOut] = useState(false)

  // Warn on an actual browser navigation/refresh/close too, not just
  // switching tabs inside the app.
  useEffect(() => {
    function handler(e) {
      if (!profileDirty) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [profileDirty])

  // Runs `action` immediately unless the profile page currently has unsaved
  // changes, in which case it's stashed and the confirm prompt takes over.
  function attemptNavigate(action) {
    if (location.pathname.startsWith('/profile') && profileDirty) {
      setLeaveError(null)
      setPendingNav(() => action)
    } else {
      action()
    }
  }

  function goTo(path) {
    attemptNavigate(() => { navigate(path); setNavOpen(false) })
  }

  async function confirmSaveAndLeave() {
    setLeaveBusy(true)
    setLeaveError(null)
    const ok = await profileSaveRef.current?.()
    setLeaveBusy(false)
    if (!ok) { setLeaveError("Couldn't save — check the profile page for what needs fixing."); return }
    pendingNav?.()
    setPendingNav(null)
  }

  function confirmDiscardAndLeave() {
    setProfileDirty(false) // Profile is about to unmount — nothing left to warn about
    pendingNav?.()
    setPendingNav(null)
  }

  function keepEditing() {
    setPendingNav(null)
    setLeaveError(null)
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) { setProfile(null); return }
    supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => setProfile(data))
  }, [session])

  // First time a brand-new profile loads (no name filled in yet), walk them
  // through the onboarding wizard question-by-question. Only checked once
  // per session so it doesn't yank people back into it on every visit.
  useEffect(() => {
    if (!profile || checkedFirstRun) return
    if (!profile.full_name?.trim()) setShowOnboarding(true)
    setCheckedFirstRun(true)
  }, [profile, checkedFirstRun])

  function openMessage(targetProfile, draftText = '') {
    setDmTarget(targetProfile)
    setDmDraft(draftText)
    setMessagesOpen(true)
  }

  // Used by the notification bell to jump straight to whatever the
  // notification was about.
  function handleNotificationNavigate(target) {
    if (target === 'messages') { setMessagesOpen(true); return }
    const tab = TABS.find((t) => t.id === target)
    if (tab) goTo(tab.path)
  }

  if (loading) return <div className="center-page">Loading…</div>
  if (!session) return <Auth />

  if (showOnboarding) {
    return (
      <Onboarding
        session={session}
        profile={profile}
        onDone={(updatedProfile) => {
          setProfile(updatedProfile)
          setShowOnboarding(false)
          navigate('/profile')
        }}
      />
    )
  }

  const navTabs = profile?.is_admin ? [...TABS, ADMIN_TAB] : TABS
  const activeTabId = navTabs.find((t) => location.pathname.startsWith(t.path))?.id

  return (
    <div className="app">
      <header className="masthead">
        <div className="masthead-inner">
          <div className="brand">
            <img src="/eendrag-logo.png" alt="Eendrag logo" className="brand-logo" />
            <div>
              <span className="brand-name">Eendrag Alumni</span>
              <span className="brand-motto">Character · Style · Pride · Since 1961</span>
            </div>
          </div>

          <div className="masthead-actions">
            <NotificationBell session={session} onNavigate={handleNotificationNavigate} />

            <button
              className="mobile-avatar-btn"
              onClick={() => goTo('/profile')}
              aria-label="My profile (click to open)"
              title="Click to open your profile"
            >
              <Avatar url={profile?.avatar_url} name={profile?.full_name} size={36} />
            </button>

            <button
              className="nav-toggle"
              onClick={() => setNavOpen((o) => !o)}
              aria-label={navOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={navOpen}
            >
              {navOpen ? <CloseIcon /> : <BurgerIcon />}
            </button>
          </div>

          <nav className={navOpen ? 'tabs open' : 'tabs'} aria-label="Main">
            {navTabs.map((t) => (
              <button
                key={t.id}
                className={activeTabId === t.id ? 'tab active' : 'tab'}
                onClick={() => goTo(t.path)}
              >
                {t.label}
              </button>
            ))}
            <button
              className="tab signout"
              onClick={() => attemptNavigate(() => { setNavOpen(false); setConfirmingSignOut(true) })}
            >
              Sign out
            </button>
          </nav>
        </div>
      </header>

      {profile && !profile.approved && (
        <div className="pending-banner">
          Your account is awaiting approval by the alumni committee. You can browse,
          but posting and messaging unlock once you're verified as an Eendragter.
        </div>
      )}

      <main className="content">
        <Routes>
          <Route path="/" element={<Navigate to="/directory" replace />} />
          <Route path="/directory" element={<People session={session} onMessage={openMessage} onGoToProfile={() => goTo('/profile')} />} />
          <Route path="/feed" element={<Feed session={session} profile={profile} onMessage={openMessage} />} />
          <Route path="/events" element={<Events session={session} profile={profile} onMessage={openMessage} />} />
          <Route path="/events/:eventId" element={<Events session={session} profile={profile} onMessage={openMessage} />} />
          <Route path="/jobs" element={<Jobs session={session} profile={profile} onMessage={openMessage} />} />
          <Route path="/donate" element={<Donate />} />
          <Route
            path="/admin"
            element={profile?.is_admin ? <Admin session={session} /> : <Navigate to="/directory" replace />}
          />
          <Route
            path="/profile"
            element={
              <Profile
                session={session}
                profile={profile}
                onSaved={setProfile}
                onDirtyChange={setProfileDirty}
                saveRef={profileSaveRef}
                onNavigateHome={() => goTo('/directory')}
              />
            }
          />
          <Route path="*" element={<Navigate to="/directory" replace />} />
        </Routes>
      </main>

      <footer className="footer">
        <img src="/eendrag-logo.png" alt="Eendrag logo" className="footer-logo" />
        <div className="footer-text">
          <span>Eendrag Alumni Hub — unofficial community site run by alumni, for alumni.</span>
          <span className="footer-credit">
            Initiated and built by Kyle Trompeter —{' '}
            <a className="footer-link" href="mailto:kyletrompeter0@gmail.com">get in touch</a>
            {' · '}
            <button className="footer-link footer-link-btn" onClick={() => goTo('/donate')}>Support the house</button>.
          </span>
        </div>
      </footer>

      <nav className="mobile-tabbar" aria-label="Main">
        {MOBILE_TABS.map((t) => {
          const Icon = t.icon
          return (
            <button
              key={t.id}
              className={activeTabId === t.id ? 'mobile-tab active' : 'mobile-tab'}
              onClick={() => goTo(t.path)}
            >
              <Icon />
              <span>{t.label}</span>
            </button>
          )
        })}
      </nav>

      <FloatingMessages
        session={session}
        profile={profile}
        open={messagesOpen}
        onOpenChange={setMessagesOpen}
        initialTarget={dmTarget}
        initialDraft={dmDraft}
        onTargetConsumed={() => { setDmTarget(null); setDmDraft('') }}
        onBrowseDirectory={() => {
          setMessagesOpen(false)
          goTo('/directory')
        }}
      />

      {confirmingSignOut && (
        <ConfirmDialog
          title="Sign out?"
          message="You'll need to sign back in to post, message, or view your profile."
          confirmLabel="Sign out"
          onConfirm={() => { setConfirmingSignOut(false); supabase.auth.signOut() }}
          onCancel={() => setConfirmingSignOut(false)}
        />
      )}

      {pendingNav && (
        <div
          className="modal-backdrop"
          onClick={keepEditing}
          role="dialog"
          aria-modal="true"
          aria-label="Unsaved changes"
        >
          <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Unsaved changes</h2>
              <button className="modal-close" onClick={keepEditing} aria-label="Keep editing">×</button>
            </div>
            <div className="modal-body">
              <p>You've made changes to your profile that haven't been saved yet. Save them before you go?</p>
              {leaveError && <p className="form-error">{leaveError}</p>}
            </div>
            <div className="modal-footer">
              <button className="btn ghost" onClick={keepEditing} disabled={leaveBusy}>Keep editing</button>
              <button className="btn ghost" onClick={confirmDiscardAndLeave} disabled={leaveBusy} style={{ color: 'var(--error)' }}>
                Discard changes
              </button>
              <button className="btn primary" onClick={confirmSaveAndLeave} disabled={leaveBusy}>
                {leaveBusy ? 'Saving…' : 'Save & leave'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ---------- Mobile nav icons ---------- */
function BurgerIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  )
}
function CloseIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

/* ---------- Mobile bottom tab bar icons ---------- */
function PeopleIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8.5" cy="8" r="3.2" />
      <path d="M2.5 19.5c0-3.3 2.7-5.7 6-5.7s6 2.4 6 5.7" />
      <circle cx="17" cy="8.5" r="2.6" />
      <path d="M15.6 13.9c2.6.3 4.4 2.3 4.4 5" />
    </svg>
  )
}
function JobsIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="7.5" width="18" height="12" rx="2" />
      <path d="M8.5 7.5V6a2.5 2.5 0 0 1 2.5-2.5h2A2.5 2.5 0 0 1 15 6v1.5" />
      <path d="M3 12.5h18" />
    </svg>
  )
}
function FeedIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9.5h18" />
      <path d="M7.5 13.5h4M7.5 16.5h9" />
    </svg>
  )
}
function EventsIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18" />
      <path d="M8 3v4M16 3v4" />
      <circle cx="8.3" cy="14.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="14.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="15.7" cy="14.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}
