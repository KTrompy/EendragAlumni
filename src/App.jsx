import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import Auth from './components/Auth.jsx'
import Feed from './components/Feed.jsx'
import Directory from './components/Directory.jsx'
import Messages from './components/Messages.jsx'
import Profile from './components/Profile.jsx'
import Events from './components/Events.jsx'
import Jobs from './components/Jobs.jsx'
import Donate from './components/Donate.jsx'

const TABS = [
  { id: 'directory', label: 'Alumni' },
  { id: 'feed', label: 'Feed' },
  { id: 'events', label: 'Events' },
  { id: 'jobs', label: 'Jobs' },
  { id: 'messages', label: 'Messages' },
  { id: 'donate', label: 'Support' },
  { id: 'profile', label: 'My profile' },
]

export default function App() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [tab, setTab] = useState('directory')
  const [dmTarget, setDmTarget] = useState(null) // profile to open a DM with
  const [dmDraft, setDmDraft] = useState('') // optional prefilled first message
  const [loading, setLoading] = useState(true)
  const [checkedFirstRun, setCheckedFirstRun] = useState(false)

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

  // First time a brand-new profile loads (no name filled in yet), send the
  // person straight to My Profile so they set themselves up. Only checked
  // once per session so it doesn't yank people back there on every visit.
  useEffect(() => {
    if (!profile || checkedFirstRun) return
    if (!profile.full_name?.trim()) setTab('profile')
    setCheckedFirstRun(true)
  }, [profile, checkedFirstRun])

  function openMessage(targetProfile, draftText = '') {
    setDmTarget(targetProfile)
    setDmDraft(draftText)
    setTab('messages')
  }

  if (loading) return <div className="center-page">Loading…</div>
  if (!session) return <Auth />

  return (
    <div className="app">
      <header className="masthead">
        <div className="masthead-inner">
          <div className="brand">
            <img src="/eendrag-logo.png" alt="Eendrag logo" className="brand-logo" />
            <div>
              <span className="brand-name">Eendrag Alumni</span>
              <span className="brand-motto">Karakter · Styl · Trots · sedert 1961</span>
            </div>
          </div>
          <nav className="tabs" aria-label="Main">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={tab === t.id ? 'tab active' : 'tab'}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
            <button className="tab signout" onClick={() => supabase.auth.signOut()}>
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
        {tab === 'events' && <Events session={session} profile={profile} />}
        {tab === 'jobs' && <Jobs session={session} profile={profile} onMessage={openMessage} />}
        {tab === 'messages' && (
          <Messages
            session={session}
            profile={profile}
            initialTarget={dmTarget}
            initialDraft={dmDraft}
            onTargetConsumed={() => { setDmTarget(null); setDmDraft('') }}
          />
        )}
        {tab === 'donate' && <Donate />}
        {tab === 'profile' && (
          <Profile session={session} profile={profile} onSaved={setProfile} />
        )}
      </main>

      <footer className="footer">
        <img src="/eendrag-logo.png" alt="Eendrag logo" className="footer-logo" />
        <span>
          Eendrag Alumni Hub — unofficial community site run by alumni, for alumni.
          {' '}Designed by Kyle Trompeter —{' '}
          <a className="footer-link" href="mailto:kyletrompeter0@gmail.com">get in touch</a>.
        </span>
      </footer>
    </div>
  )
}
