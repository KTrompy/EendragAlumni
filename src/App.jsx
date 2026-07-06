import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabaseClient'
import Auth from './components/Auth.jsx'
import Onboarding from './components/Onboarding.jsx'
import Feed from './components/Feed.jsx'
import Directory, { Avatar } from './components/Directory.jsx'
import FloatingMessages from './components/FloatingMessages.jsx'
import Profile from './components/Profile.jsx'
import Events from './components/Events.jsx'
import Jobs from './components/Jobs.jsx'
import Donate from './components/Donate.jsx'
import AlumniMap from './components/AlumniMap.jsx'

const TABS = [
  { id: 'directory', label: 'Eendragters' },
  { id: 'map', label: 'Map' },
  { id: 'feed', label: 'Feed' },
  { id: 'events', label: 'Events' },
  { id: 'jobs', label: 'Jobs' },
  { id: 'donate', label: 'Support' },
  { id: 'profile', label: 'My profile' },
]

// The mobile bottom tab bar — a smaller, reordered subset of TABS (Support,
// My profile and Sign out move to the mobile header/avatar instead, so the
// bar itself stays to five core sections).
const MOBILE_TABS = [
  { id: 'directory', label: 'Eendragters', icon: PeopleIcon },
  { id: 'jobs', label: 'Jobs', icon: JobsIcon },
  { id: 'map', label: 'Map', icon: MapIcon },
  { id: 'feed', label: 'Feed', icon: FeedIcon },
  { id: 'events', label: 'Events', icon: EventsIcon },
]

export default function App() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [tab, setTab] = useState('directory')
  const [dmTarget, setDmTarget] = useState(null) // profile to open a DM with
  const [dmDraft, setDmDraft] = useState('') // optional prefilled first message
  const [messagesOpen, setMessagesOpen] = useState(false)
  const [navOpen, setNavOpen] = useState(false) // mobile hamburger menu
  const [loading, setLoading] = useState(true)
  const [checkedFirstRun, setCheckedFirstRun] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)

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
    if (tab === 'profile' && profileDirty) {
      setLeaveError(null)
      setPendingNav(() => action)
    } else {
      action()
    }
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
          setTab('profile')
        }}
      />
    )
  }

  return (
    <div className="app">
      <header className="masthead">
        <div className="masthead-inner">
          <button
            className="mobile-support-btn"
            onClick={() => attemptNavigate(() => setTab('donate'))}
          >
            <SupportIcon />
            Support
          </button>

          <div className="brand">
            <img src="/eendrag-logo.png" alt="Eendrag logo" className="brand-logo" />
            <div>
              <span className="brand-name">Eendrag Alumni</span>
              <span className="brand-motto">Character · Style · Pride · Since 1961</span>
            </div>
          </div>

          <button
            className="mobile-avatar-btn"
            onClick={() => attemptNavigate(() => setTab('profile'))}
            aria-label="My profile"
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
          <nav className={navOpen ? 'tabs open' : 'tabs'} aria-label="Main">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={tab === t.id ? 'tab active' : 'tab'}
                onClick={() => attemptNavigate(() => { setTab(t.id); setNavOpen(false) })}
              >
                {t.label}
              </button>
            ))}
            <button
              className="tab signout"
              onClick={() => attemptNavigate(() => { setNavOpen(false); supabase.auth.signOut() })}
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
        {tab === 'feed' && <Feed session={session} profile={profile} onMessage={openMessage} />}
        {tab === 'directory' && (
          <Directory session={session} onMessage={openMessage} />
        )}
        {tab === 'map' && (
          <AlumniMap
            session={session}
            onMessage={openMessage}
            onGoToProfile={() => attemptNavigate(() => setTab('profile'))}
          />
        )}
        {tab === 'events' && <Events session={session} profile={profile} onMessage={openMessage} />}
        {tab === 'jobs' && <Jobs session={session} profile={profile} onMessage={openMessage} />}
        {tab === 'donate' && <Donate />}
        {tab === 'profile' && (
          <Profile
            session={session}
            profile={profile}
            onSaved={setProfile}
            onDirtyChange={setProfileDirty}
            saveRef={profileSaveRef}
          />
        )}
      </main>

      <footer className="footer">
        <img src="/eendrag-logo.png" alt="Eendrag logo" className="footer-logo" />
        <div className="footer-text">
          <span>Eendrag Alumni Hub — unofficial community site run by alumni, for alumni.</span>
          <span className="footer-credit">
            Initiated and built by Kyle Trompeter —{' '}
            <a className="footer-link" href="mailto:kyletrompeter0@gmail.com">get in touch</a>.
          </span>
        </div>
      </footer>

      <nav className="mobile-tabbar" aria-label="Main">
        {MOBILE_TABS.map((t) => {
          const Icon = t.icon
          return (
            <button
              key={t.id}
              className={tab === t.id ? 'mobile-tab active' : 'mobile-tab'}
              onClick={() => attemptNavigate(() => setTab(t.id))}
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
          attemptNavigate(() => setTab('directory'))
        }}
      />

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
function SupportIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3.5" />
      <path d="M5.6 5.6l3.1 3.1M18.4 5.6l-3.1 3.1M18.4 18.4l-3.1-3.1M5.6 18.4l3.1-3.1" />
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
function MapIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 21s-7-6.2-7-11.2A7 7 0 0 1 19 9.8C19 14.8 12 21 12 21z" />
      <circle cx="12" cy="9.6" r="2.4" />
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
