import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import Auth from './components/Auth.jsx'
import Feed from './components/Feed.jsx'
import Directory from './components/Directory.jsx'
import Messages from './components/Messages.jsx'
import Profile from './components/Profile.jsx'

// The three interlinked rings from the Eendrag crest — unity, and the three
// qualities: Karakter, Styl, Trots.
export function Rings({ size = 28 }) {
  return (
    <svg width={size} height={size * 0.62} viewBox="0 0 100 62" fill="none" aria-hidden="true">
      <circle cx="26" cy="31" r="22" stroke="currentColor" strokeWidth="6" />
      <circle cx="50" cy="31" r="22" stroke="currentColor" strokeWidth="6" />
      <circle cx="74" cy="31" r="22" stroke="currentColor" strokeWidth="6" />
    </svg>
  )
}

const TABS = [
  { id: 'feed', label: 'Feed' },
  { id: 'directory', label: 'Directory' },
  { id: 'messages', label: 'Messages' },
  { id: 'profile', label: 'My profile' },
]

export default function App() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [tab, setTab] = useState('feed')
  const [dmTarget, setDmTarget] = useState(null) // profile to open a DM with
  const [loading, setLoading] = useState(true)

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

  function openMessage(targetProfile) {
    setDmTarget(targetProfile)
    setTab('messages')
  }

  if (loading) return <div className="center-page">Loading…</div>
  if (!session) return <Auth />

  return (
    <div className="app">
      <header className="masthead">
        <div className="masthead-inner">
          <div className="brand">
            <span className="brand-rings"><Rings size={34} /></span>
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
        {tab === 'feed' && <Feed session={session} profile={profile} />}
        {tab === 'directory' && (
          <Directory session={session} onMessage={openMessage} />
        )}
        {tab === 'messages' && (
          <Messages session={session} profile={profile} initialTarget={dmTarget} onTargetConsumed={() => setDmTarget(null)} />
        )}
        {tab === 'profile' && (
          <Profile session={session} profile={profile} onSaved={setProfile} />
        )}
      </main>

      <footer className="footer">
        <Rings size={22} />
        <span>Eendrag Alumni Hub — unofficial community site run by alumni, for alumni.</span>
      </footer>
    </div>
  )
}
