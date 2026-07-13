import { useCallback, useEffect, useRef, useState } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { supabase, isAuthError } from './supabaseClient'
import Auth from './components/Auth.jsx'
import ResetPassword from './components/ResetPassword.jsx'
import GlobalSearch from './components/GlobalSearch.jsx'
import Onboarding from './components/Onboarding.jsx'
import Home from './components/Home.jsx'
import Feed from './components/Feed.jsx'
import Groups from './components/Groups.jsx'
import GroupDetail from './components/GroupDetail.jsx'
import Photos from './components/Photos.jsx'
import AlbumDetail from './components/AlbumDetail.jsx'
import Mentoring from './components/Mentoring.jsx'
import People from './components/People.jsx'
import { Avatar } from './components/Directory.jsx'
import FloatingMessages from './components/FloatingMessages.jsx'
import Profile from './components/Profile.jsx'
import PersonProfile from './components/PersonProfile.jsx'
import Events from './components/Events.jsx'
import Jobs from './components/Jobs.jsx'
import JobDetail from './components/JobDetail.jsx'
import BusinessDirectory from './components/BusinessDirectory.jsx'
import BusinessDetail from './components/BusinessDetail.jsx'
import Merchandise from './components/Merchandise.jsx'
import MerchDetail from './components/MerchDetail.jsx'
import Donate from './components/Donate.jsx'
import Admin from './components/Admin.jsx'
import NotificationBell from './components/NotificationBell.jsx'
import ConfirmDialog from './components/ConfirmDialog.jsx'
import Settings from './components/Settings.jsx'
import NotFound from './components/NotFound.jsx'

// Eendragters (directory) now includes the alumni map as a view toggle
// (see People.jsx) instead of splitting "find a person" across two nav
// items. Support/Donate isn't a top-level tab while it's still a stub with
// no real payment flow — it's reachable from the footer link instead.
// My profile isn't in this list either — it lives as an avatar icon in the
// top-right of the header (see .header-avatar-btn) on every screen size,
// not in the sidebar/hamburger nav.
//
// Each tab carries its own sidebar icon now that navigation lives in the
// left sidebar (see .sidebar in styles.css) rather than the old inline
// header tab strip.
const TABS = [
  { id: 'home', label: 'Home', path: '/home', icon: HomeIcon },
  { id: 'directory', label: 'Eendragters', path: '/directory', icon: PeopleIcon },
  { id: 'jobs', label: 'Jobs', path: '/jobs', icon: JobsIcon },
  { id: 'feed', label: 'Feed', path: '/feed', icon: FeedIcon },
  { id: 'mentoring', label: 'Mentoring', path: '/mentoring', icon: MentoringIcon },
  { id: 'events', label: 'Events', path: '/events', icon: EventsIcon },
  { id: 'groups', label: 'Groups', path: '/groups', icon: GroupsIcon },
  { id: 'photos', label: 'Photos', path: '/photos', icon: PhotosIcon },
  { id: 'merch', label: 'Merchandise', path: '/merch', icon: MerchIcon },
  { id: 'businesses', label: 'Business Directory', path: '/businesses', icon: BusinessIcon },
]

// Admin-only, appended to the nav when the signed-in profile has is_admin
// set — kept out of the base TABS list so it never flashes for regular
// members before the profile loads.
const ADMIN_TAB = { id: 'admin', label: 'Admin', path: '/admin', icon: AdminIcon }

// Desktop sidebar's five "always visible" tabs — the rest of TABS (and
// Admin, when present) live behind the sidebar's "More" toggle instead.
const PRIMARY_TAB_IDS = ['directory', 'home', 'jobs', 'feed', 'businesses']

// The mobile bottom tab bar — a smaller subset of TABS (My profile and Sign
// out move to the mobile header/avatar instead, so the bar stays to four
// core sections now that Map lives inside Eendragters).
const MOBILE_TABS = [
  { id: 'directory', label: 'Eendragters', path: '/directory', icon: PeopleIcon },
  { id: 'home', label: 'Home', path: '/home', icon: HomeIcon },
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
  const [searchOpen, setSearchOpen] = useState(false) // header site-wide search modal
  // True the instant Supabase fires PASSWORD_RECOVERY (someone clicked the
  // reset-password link from Auth.jsx's "Forgot password?" flow) — that
  // event carries a real session, so without this flag the check below
  // would just drop them straight into the normal signed-in app instead of
  // letting them set a new password first.
  const [recoveryMode, setRecoveryMode] = useState(false)
  // Desktop sidebar "More" section. null = no manual choice yet (falls back
  // to auto-expanding whenever the active page is one of the secondary
  // tabs); true/false = the person explicitly clicked More/Less, which
  // wins over the auto-expand — e.g. clicking "Less" while on Mentoring
  // collapses the list even though Mentoring's own link is inside it.
  // Reset to null on every navigation so the next page starts from the
  // same auto-expand default rather than staying manually stuck open/shut.
  const [moreNavOverride, setMoreNavOverride] = useState(null)
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
  const [directoryRefetchTrigger, setDirectoryRefetchTrigger] = useState(0) // increment to trigger refetch
  const [profileMenuOpen, setProfileMenuOpen] = useState(false) // header avatar dropdown (Settings/Edit profile/Sign out)
  const profileMenuRef = useRef(null)
  const sidebarRef = useRef(null)
  // Tracks whether the <aside ref={attachSidebarRef}> node actually exists
  // in the DOM yet — see attachSidebarRef below for why this (rather than
  // just [location.pathname]) is what the repositioning effect depends on.
  const [sidebarMounted, setSidebarMounted] = useState(false)
  // Always-current pathname, readable from repositionSidebar without
  // putting location.pathname in a dependency array — see the note there.
  const pathnameRef = useRef(location.pathname)
  pathnameRef.current = location.pathname

  // Clear any manual More/Less click on navigation, so the sidebar's
  // "More" section goes back to auto-expand-if-relevant for whatever page
  // you land on next, rather than staying manually forced open/shut.
  useEffect(() => {
    setMoreNavOverride(null)
  }, [location.pathname])

  // Person-profile page only: shift the sidebar to sit flush against the
  // profile card's left edge instead of its usual fixed spot at the page's
  // far-left. That card's own horizontal position is computed to center on
  // the full window (see .person-profile-page in styles.css), so it lands
  // somewhere different at every window width — measuring it here in JS
  // (rather than hardcoding the same math again in CSS) is what keeps the
  // nav correctly hugging it at any width instead of drifting off by a few
  // pixels or breaking at in-between sizes.
  const repositionSidebar = useCallback(() => {
    const sidebarEl = sidebarRef.current
    if (!sidebarEl) return
    const isProfileRoute = /^\/people\/[^/]+$/.test(pathnameRef.current)
    if (!isProfileRoute) { sidebarEl.style.transform = ''; return }

    const panelEl = document.querySelector('.person-profile-page')
    if (!panelEl) { sidebarEl.style.transform = ''; return }
    // Reset before measuring so the sidebar's own rect reflects its
    // natural (untransformed) position, not whatever shift was applied on
    // the previous measurement.
    sidebarEl.style.transform = ''
    const sidebarRect = sidebarEl.getBoundingClientRect()
    const panelRect = panelEl.getBoundingClientRect()
    const GAP = 20 // matches .app-body's own sidebar/content gap
    const shift = (panelRect.left - GAP) - sidebarRect.right
    // Only ever move it rightward, toward the content — if this ever comes
    // out negative (content lands further left than the nav already sits,
    // e.g. some in-between window width) leave the nav at its normal spot
    // rather than overlapping the card.
    if (shift > 0) sidebarEl.style.transform = `translateX(${shift}px)`
  }, [])

  // Callback ref (rather than a plain useRef passed straight to the aside)
  // so repositioning fires the instant the sidebar node actually mounts —
  // not only when location.pathname changes. That distinction matters on a
  // hard refresh landing directly on a profile URL: this component renders
  // its "Loading…" gate first (see `if (loading) return …` below), so the
  // very first time an effect keyed on location.pathname would've fired,
  // the sidebar didn't exist in the DOM yet and there was nothing left to
  // re-trigger it once loading finished, since the pathname itself never
  // changes again. Tracking real mount/unmount via sidebarMounted state
  // instead sidesteps that gap regardless of *why* the sidebar was slow to
  // appear (auth check, onboarding, anything else upstream of it).
  const attachSidebarRef = useCallback((node) => {
    sidebarRef.current = node
    setSidebarMounted(!!node)
  }, [])

  useEffect(() => {
    if (!sidebarMounted) return undefined
    repositionSidebar()

    // Throttled to at most once per animation frame — on pages with heavy
    // DOM churn (e.g. Feed's infinite scroll appending posts), an
    // unthrottled MutationObserver callback fires repositionSidebar (which
    // forces a synchronous layout reflow via getBoundingClientRect) on
    // every single mutation, hundreds of times a second. Collapsing any
    // number of mutations/resizes within a frame down to one reposition
    // keeps this cheap regardless of how chatty the observed subtree gets.
    let rafId = null
    function scheduleReposition() {
      if (rafId != null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        repositionSidebar()
      })
    }

    // Covers the other ways the card's position can change once the
    // sidebar is up: window resize, the content column itself resizing
    // (ResizeObserver), and the profile fetch's loading → loaded swap,
    // which mounts a fresh .person-profile-page node rather than resizing
    // anything already being observed (MutationObserver).
    const contentEl = document.querySelector('.content')
    const ro = new ResizeObserver(scheduleReposition)
    if (contentEl) ro.observe(contentEl)
    const mo = new MutationObserver(scheduleReposition)
    if (contentEl) mo.observe(contentEl, { childList: true, subtree: true })
    window.addEventListener('resize', scheduleReposition)

    return () => {
      if (rafId != null) cancelAnimationFrame(rafId)
      ro.disconnect()
      mo.disconnect()
      window.removeEventListener('resize', scheduleReposition)
    }
  }, [location.pathname, sidebarMounted, repositionSidebar])

  // Lock body scroll while the mobile nav drawer is open, and let Escape
  // close it — same pattern as the filter drawers (DirectoryFilters.jsx,
  // Jobs.jsx, BusinessDirectory.jsx).
  useEffect(() => {
    if (!navOpen) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKey(e) { if (e.key === 'Escape') setNavOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      document.removeEventListener('keydown', onKey)
    }
  }, [navOpen])

  // Header avatar dropdown — same outside-click/Escape pattern as
  // NotificationBell's dropdown.
  useEffect(() => {
    if (!profileMenuOpen) return
    function onClick(e) { if (profileMenuRef.current && !profileMenuRef.current.contains(e.target)) setProfileMenuOpen(false) }
    function onKey(e) { if (e.key === 'Escape') setProfileMenuOpen(false) }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [profileMenuOpen])

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
    let ok = false
    try {
      ok = await profileSaveRef.current?.()
    } catch (e) {
      // Without this, a thrown save() (rather than one that just returns
      // false) left leaveBusy stuck true forever — "Save & leave" would
      // stay disabled for the rest of the session.
      setLeaveError(e?.message || "Couldn't save — check the profile page for what needs fixing.")
      return
    } finally {
      setLeaveBusy(false)
    }
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
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'PASSWORD_RECOVERY') setRecoveryMode(true)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) { setProfile(null); return }
    let cancelled = false

    // Same auth-not-settled race documented in Home.jsx's dashboard load:
    // this effect fires the instant `session` changes (including on
    // TOKEN_REFRESHED / re-focus, not just initial sign-in), which can
    // race the underlying supabase-js client's auth header still being
    // attached to outgoing requests. When that happens the `to
    // authenticated` RLS policy on profiles silently matches nothing,
    // .single() comes back as a "no rows" error, and setProfile(null)
    // makes the whole app render as a blank/0%-complete profile (see
    // Home's "Good afternoon, there" banner) until a manual refresh gives
    // the client time to settle. Awaiting getSession() first, plus one
    // retry on error, closes that window instead.
    async function load(isRetry = false) {
      await supabase.auth.getSession()
      if (cancelled) return
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single()
      if (cancelled) return
      if (error && !isRetry) {
        await new Promise((r) => setTimeout(r, 600))
        if (!cancelled) await load(true)
        return
      }
      // Still failing after the retry, and it looks like an auth problem
      // rather than a transient blip (e.g. a revoked/expired refresh token
      // that didn't trigger a clean SIGNED_OUT event) — a stale JWT reads
      // as "authenticated" to this component but every Supabase call keeps
      // failing, leaving someone stuck looking at a signed-in app where
      // nothing works. Forcing a real sign-out drops them back to the
      // login screen instead of a silently broken one.
      if (error && isRetry && isAuthError(error)) {
        await supabase.auth.signOut()
        return
      }
      setProfile(data || null)
    }
    load()
    return () => { cancelled = true }
  }, [session])

  // Heartbeat: writes last_seen every few minutes while the app is open (and
  // once immediately on load/tab-refocus) — this is what powers the
  // "Recently online" sort and the green dot in the Eendragters directory.
  // Deliberately not realtime presence (that only knows who's connected
  // *right now* and forgets everyone the instant they close the tab) — a
  // persisted timestamp is what lets "recently online" mean something for
  // someone who was here 10 minutes ago too.
  useEffect(() => {
    if (!session) return
    function beat() {
      supabase.from('profiles').update({ last_seen: new Date().toISOString() }).eq('id', session.user.id).then(() => {})
    }
    beat()
    const interval = setInterval(beat, 2 * 60 * 1000)
    function onVisible() { if (document.visibilityState === 'visible') beat() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
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
  // notification was about — deep-linking to the specific post/event when
  // one is available (matching NotificationBell's ENTITY_TAB mapping),
  // rather than just landing generically at the top of that tab.
  function handleNotificationNavigate(target, entityType, entityId) {
    if (target === 'messages') { setMessagesOpen(true); return }
    if (entityId && entityType === 'post') { goTo(`/feed/${entityId}`); return }
    if (entityId && entityType === 'event') { goTo(`/events/${entityId}`); return }
    const tab = TABS.find((t) => t.id === target)
    if (tab) goTo(tab.path)
  }

  if (loading) return <div className="center-page">Loading…</div>
  if (recoveryMode) return <ResetPassword onDone={() => setRecoveryMode(false)} />
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
  // Desktop sidebar shows five core sections up front; everything else
  // (Mentoring/Events/Groups/Photos/Merchandise, plus Admin) collapses
  // behind a "More" toggle so the rail doesn't run long. Filtering
  // navTabs (rather than listing IDs in this order) keeps whatever order
  // TABS already defines.
  const primaryNavTabs = navTabs.filter((t) => PRIMARY_TAB_IDS.includes(t.id))
  const secondaryNavTabs = navTabs.filter((t) => !PRIMARY_TAB_IDS.includes(t.id))
  const isSecondaryActive = secondaryNavTabs.some((t) => t.id === activeTabId)
  // A manual More/Less click always wins; absent one, it auto-expands
  // whenever you're already on a page that lives inside "More".
  const moreNavVisible = moreNavOverride !== null ? moreNavOverride : isSecondaryActive

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
            <button
              className="header-icon-btn"
              onClick={() => setSearchOpen(true)}
              aria-label="Search"
              title="Search"
            >
              <HeaderSearchIcon />
            </button>

            <button
              className="header-icon-btn"
              onClick={() => setMessagesOpen((o) => !o)}
              aria-label="Messages"
              title="Messages"
            >
              <MessagesIcon />
            </button>

            <NotificationBell session={session} onNavigate={handleNotificationNavigate} />

            {/* My profile lives here — top-right of the header — on every
                screen size now, instead of as a sidebar/hamburger entry.
                Clicking the avatar opens a small dropdown (Settings / Edit
                profile / Sign out) rather than navigating straight to the
                profile page. */}
            <div className="profile-menu-wrap" ref={profileMenuRef}>
              <button
                className="header-avatar-btn"
                onClick={() => setProfileMenuOpen((o) => !o)}
                aria-label="Account menu"
                aria-expanded={profileMenuOpen}
              >
                <Avatar url={profile?.avatar_url} name={profile?.full_name} size={36} />
                <ChevronDownIcon />
              </button>

              {profileMenuOpen && (
                <div className="profile-menu-dropdown" role="menu">
                  <button role="menuitem" onClick={() => { setProfileMenuOpen(false); goTo('/settings') }}>
                    <SettingsIcon /> Settings
                  </button>
                  <button role="menuitem" onClick={() => { setProfileMenuOpen(false); goTo('/profile') }}>
                    <EditIcon /> Edit profile
                  </button>
                  <button
                    role="menuitem"
                    className="profile-menu-signout"
                    onClick={() => { setProfileMenuOpen(false); attemptNavigate(() => { setNavOpen(false); setConfirmingSignOut(true) }) }}
                  >
                    <SignOutIcon /> Sign out
                  </button>
                </div>
              )}
            </div>

            <button
              className="nav-toggle"
              onClick={() => setNavOpen((o) => !o)}
              aria-label={navOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={navOpen}
            >
              {navOpen ? <CloseIcon /> : <BurgerIcon />}
            </button>
          </div>
        </div>
      </header>

      {profile && !profile.approved && (
        <div className="pending-banner">
          Your account is awaiting approval by the alumni committee. You can browse,
          but posting and messaging unlock once you're verified as an Eendragter.
        </div>
      )}

      {/* Full-width photo banner, sitting above the sidebar/content row so
          the sidebar no longer runs flush from the header all the way down
          the page — same idea as the Lions Connect reference layout. Image
          lives at /courtyard1.png in public/. No text overlay (matches the
          reference exactly — just the photo; brand name/motto already live
          in the header next to the logo). */}
      <div className="hero-banner">
        <img src="/courtyard1.png" alt="" className="hero-banner-img" />
        <div className="hero-banner-overlay" />
      </div>

      <div className="app-body">
        {/* Persistent left sidebar on desktop (see .sidebar in styles.css).
            Hidden on mobile in favour of the existing bottom tab bar —
            navOpen/hamburger are currently unused on mobile (kept as-is
            from before this rework, harmless if never toggled there). */}
        <aside className="sidebar" aria-label="Main" ref={attachSidebarRef}>
          <nav className="sidebar-nav">
            {primaryNavTabs.map((t) => {
              const Icon = t.icon
              return (
                <button
                  key={t.id}
                  className={activeTabId === t.id ? 'sidebar-link active' : 'sidebar-link'}
                  onClick={() => goTo(t.path)}
                >
                  <Icon /> {t.label}
                </button>
              )
            })}

            <button
              // Highlighted only when it's standing in for the active page —
              // i.e. collapsed, so Events/Mentoring/etc. isn't itself visible
              // in the list. Once expanded, the real link below carries the
              // "active" state instead, so only one thing is highlighted at
              // a time.
              className={isSecondaryActive && !moreNavVisible ? 'sidebar-link sidebar-more-toggle active' : 'sidebar-link sidebar-more-toggle'}
              onClick={() => setMoreNavOverride(!moreNavVisible)}
              aria-expanded={moreNavVisible}
            >
              <MoreIcon />
              {moreNavVisible ? 'Less' : 'More'}
              <ChevronDownIcon className={moreNavVisible ? 'sidebar-more-chevron open' : 'sidebar-more-chevron'} />
            </button>

            {moreNavVisible && (
              <div className="sidebar-more-list">
                {secondaryNavTabs.map((t) => {
                  const Icon = t.icon
                  return (
                    <button
                      key={t.id}
                      className={activeTabId === t.id ? 'sidebar-link active' : 'sidebar-link'}
                      onClick={() => goTo(t.path)}
                    >
                      <Icon /> {t.label}
                    </button>
                  )
                })}
              </div>
            )}
          </nav>
          <div className="sidebar-footer">
            <button
              className="sidebar-link signout"
              onClick={() => attemptNavigate(() => { setNavOpen(false); setConfirmingSignOut(true) })}
            >
              <SignOutIcon /> Sign out
            </button>
          </div>
        </aside>

        <div className="app-main">
          <main className="content">
            <Routes>
              <Route path="/" element={<Navigate to="/home" replace />} />
              <Route path="/home" element={<Home session={session} profile={profile} onMessage={openMessage} />} />
              <Route path="/directory" element={<People session={session} onMessage={openMessage} onGoToProfile={() => goTo('/profile')} refetchTrigger={directoryRefetchTrigger} />} />
              <Route path="/feed" element={<Feed session={session} profile={profile} onMessage={openMessage} />} />
              <Route path="/feed/:postId" element={<Feed session={session} profile={profile} onMessage={openMessage} />} />
              <Route path="/groups" element={<Groups session={session} />} />
              <Route path="/groups/:groupId" element={<GroupDetail session={session} profile={profile} onMessage={openMessage} />} />
              <Route path="/photos" element={<Photos session={session} />} />
              <Route path="/photos/:albumId" element={<AlbumDetail session={session} profile={profile} />} />
              <Route path="/mentoring" element={<Mentoring session={session} profile={profile} onMessage={openMessage} />} />
              <Route path="/events" element={<Events session={session} profile={profile} onMessage={openMessage} />} />
              <Route path="/events/:eventId" element={<Events session={session} profile={profile} onMessage={openMessage} />} />
              <Route path="/jobs" element={<Jobs session={session} profile={profile} onMessage={openMessage} />} />
              <Route path="/jobs/:jobId" element={<JobDetail session={session} profile={profile} onMessage={openMessage} />} />
              <Route path="/businesses" element={<BusinessDirectory session={session} profile={profile} onMessage={openMessage} />} />
              <Route path="/businesses/:businessId" element={<BusinessDetail session={session} profile={profile} onMessage={openMessage} />} />
              <Route path="/merch" element={<Merchandise session={session} profile={profile} onMessage={openMessage} />} />
              <Route path="/merch/:itemId" element={<MerchDetail session={session} profile={profile} onMessage={openMessage} />} />
              <Route path="/donate" element={<Donate />} />
              <Route
                path="/admin"
                element={profile?.is_admin ? <Admin session={session} /> : <Navigate to="/home" replace />}
              />
              <Route
                path="/profile"
                element={
                  <Profile
                    session={session}
                    profile={profile}
                    onSaved={(updated) => {
                      setProfile(updated)
                      setDirectoryRefetchTrigger((t) => t + 1)
                    }}
                    onDirtyChange={setProfileDirty}
                    saveRef={profileSaveRef}
                    onNavigateHome={() => goTo('/home')}
                  />
                }
              />
              <Route
                path="/settings"
                element={<Settings session={session} profile={profile} onSaved={setProfile} />}
              />
              <Route
                path="/people/:personId"
                element={<PersonProfile session={session} me={profile} onMessage={openMessage} />}
              />
              <Route path="*" element={<NotFound />} />
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
        </div>
      </div>

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

      {/* Mobile-only "everything else" menu — the bottom tab bar only has
          room for five core sections, so Groups/Mentoring/Photos/Business
          Directory (and Admin, when relevant) live behind the header
          hamburger instead. Same navTabs/activeTabId/goTo the desktop
          sidebar uses, just in a slide-in drawer (see .mobile-nav-panel). */}
      {navOpen && (
        <>
          <div className="mobile-nav-backdrop" onClick={() => setNavOpen(false)} />
          <aside className="mobile-nav-panel" aria-label="Main menu">
            <div className="mobile-nav-panel-header">
              <h3>Menu</h3>
              <button className="modal-close" onClick={() => setNavOpen(false)} aria-label="Close menu">×</button>
            </div>
            <nav className="sidebar-nav">
              {navTabs.map((t) => {
                const Icon = t.icon
                return (
                  <button
                    key={t.id}
                    className={activeTabId === t.id ? 'sidebar-link active' : 'sidebar-link'}
                    onClick={() => goTo(t.path)}
                  >
                    <Icon /> {t.label}
                  </button>
                )
              })}
            </nav>
            <div className="sidebar-footer">
              <button
                className="sidebar-link signout"
                onClick={() => attemptNavigate(() => { setNavOpen(false); setConfirmingSignOut(true) })}
              >
                <SignOutIcon /> Sign out
              </button>
            </div>
          </aside>
        </>
      )}

      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />

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

/* ---------- Sidebar-only icons ---------- */
function HomeIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 11.5L12 4l9 7.5" />
      <path d="M5.5 10v9a1 1 0 0 0 1 1H9a1 1 0 0 0 1-1v-4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v4a1 1 0 0 0 1 1h2.5a1 1 0 0 0 1-1v-9" />
    </svg>
  )
}
function MentoringIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 10a5 5 0 1 1 3.5 4.77L8 17v-2.5H6a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2h2" />
      <path d="M14 14a5 5 0 0 0 4.9-4H21a2 2 0 0 1 2 2v2.5a2 2 0 0 1-2 2h-1v2.5l-3-2.34" />
    </svg>
  )
}
function GroupsIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="8" r="3" />
      <path d="M2.5 20c0-3.5 2.9-6 6.5-6s6.5 2.5 6.5 6" />
      <circle cx="17" cy="8.5" r="2.4" />
      <path d="M15.7 14c2.6.4 4.3 2.3 4.3 6" />
    </svg>
  )
}
function PhotosIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8a2 2 0 0 1 2-2h1.5l1-1.5h7l1 1.5H18a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  )
}
function BusinessIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 21V9.5l8-5 8 5V21" />
      <path d="M4 21h16" />
      <path d="M9.5 21v-6a2.5 2.5 0 0 1 5 0v6" />
      <path d="M8 12.5h.01M16 12.5h.01" />
    </svg>
  )
}
function MerchIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3.5L4 6.5l2 3-1.5 1.5v9.5a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-9.5L18 9.5l2-3-4-3-1.5 2h-5z" />
    </svg>
  )
}
function AdminIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l7 3v5c0 4.6-3 8.4-7 10-4-1.6-7-5.4-7-10V6z" />
      <path d="M9.5 12l1.8 1.8L15 10" />
    </svg>
  )
}
function SignOutIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  )
}
function HeaderSearchIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  )
}
function MessagesIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}
function ChevronDownIcon({ className }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}
function MoreIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  )
}
function SettingsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 13.5a1.8 1.8 0 0 0 .36 1.98l.07.07a2.16 2.16 0 1 1-3.06 3.06l-.07-.07a1.8 1.8 0 0 0-1.98-.36 1.8 1.8 0 0 0-1.1 1.65v.2a2.16 2.16 0 1 1-4.32 0v-.1a1.8 1.8 0 0 0-1.17-1.65 1.8 1.8 0 0 0-1.98.36l-.07.07a2.16 2.16 0 1 1-3.06-3.06l.07-.07a1.8 1.8 0 0 0 .36-1.98 1.8 1.8 0 0 0-1.65-1.1h-.2a2.16 2.16 0 1 1 0-4.32h.1a1.8 1.8 0 0 0 1.65-1.17 1.8 1.8 0 0 0-.36-1.98l-.07-.07a2.16 2.16 0 1 1 3.06-3.06l.07.07a1.8 1.8 0 0 0 1.98.36h.09a1.8 1.8 0 0 0 1.1-1.65v-.2a2.16 2.16 0 1 1 4.32 0v.1a1.8 1.8 0 0 0 1.1 1.65h.09a1.8 1.8 0 0 0 1.98-.36l.07-.07a2.16 2.16 0 1 1 3.06 3.06l-.07.07a1.8 1.8 0 0 0-.36 1.98v.09a1.8 1.8 0 0 0 1.65 1.1h.2a2.16 2.16 0 1 1 0 4.32h-.1a1.8 1.8 0 0 0-1.65 1.1z" />
    </svg>
  )
}
function EditIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  )
}
