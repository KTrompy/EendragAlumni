// The admin area. Mounted by App.jsx at /admin/* for admins only — the real
// protection is in the database (is_admin() in RLS and in every admin RPC and
// Edge Function); this component never decides who is allowed to do what.
//
// Every section is a real route, so Back/Forward, refresh, deep links and
// notification links all land where they should:
//
//   /admin                 Overview — the queue of things that need a decision
//   /admin/members[/:id]   Members table, with the member drawer on :id
//   /admin/reports         Reports (open / resolved)
//   /admin/content         Posts, jobs, events and businesses in one table
//   /admin/legends[/…]     Home-page legends and their editor
//   /admin/log             Activity log
//   /admin/help            Help
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { AdminContext } from './AdminUI.jsx'
import { fetchMemberCounts, fetchOpenReportCount } from './adminApi.js'
import Overview from './Overview.jsx'
import Members from './Members.jsx'
import MemberDrawer from './MemberDrawer.jsx'
import Reports from './Reports.jsx'
import Content from './Content.jsx'
import Legends, { LegendEditor } from './Legends.jsx'
import ActivityLog from './ActivityLog.jsx'
import AdminHelp from './AdminHelp.jsx'

const NAV = [
  { to: '/admin', label: 'Overview', end: true },
  { group: 'People', items: [{ to: '/admin/members', label: 'Members', badge: 'pending' }] },
  {
    group: 'Moderation',
    items: [
      { to: '/admin/reports', label: 'Reports', badge: 'reports' },
      { to: '/admin/content', label: 'Content' },
    ],
  },
  { group: 'Site', items: [{ to: '/admin/legends', label: 'Legends' }] },
  { to: '/admin/log', label: 'Activity log' },
  { to: '/admin/help', label: 'Help' },
]

const FLAT = NAV.flatMap((n) => (n.items ? n.items.map((i) => ({ ...i, group: n.group })) : [n]))

function activeItem(pathname) {
  // Longest matching prefix wins, so /admin/members/123 → Members.
  const path = pathname.replace(/\/+$/, '') || '/'
  let best = FLAT[0]
  for (const item of FLAT) {
    if (item.end) continue
    if ((path === item.to || path.startsWith(`${item.to}/`)) && item.to.length > (best.end ? 0 : best.to.length)) {
      best = item
    }
  }
  return best
}

export default function AdminShell({ session }) {
  const myId = session.user.id
  const cache = useRef(new Map())
  const [versions, setVersions] = useState({})
  const [counts, setCounts] = useState(null)
  const [countsError, setCountsError] = useState(null)
  const [openReports, setOpenReports] = useState(null)

  const bump = useCallback((ns) => {
    setVersions((v) => ({ ...v, [ns]: (v[ns] || 0) + 1 }))
  }, [])

  const refreshCounts = useCallback(async () => {
    const [c, r] = await Promise.all([fetchMemberCounts(), fetchOpenReportCount()])
    if (c.error) setCountsError(c.error)
    else { setCounts(c.data); setCountsError(null) }
    if (!r.error) setOpenReports(r.count)
  }, [])

  useEffect(() => { refreshCounts() }, [refreshCounts])

  const ctx = useMemo(() => ({
    session, myId, cache, versions, bump, counts, countsError, openReports, setOpenReports, refreshCounts,
  }), [session, myId, versions, bump, counts, countsError, openReports, refreshCounts])

  const badges = { pending: counts?.pending || 0, reports: openReports || 0 }

  return (
    <AdminContext.Provider value={ctx}>
      <section className="adm">
        <AdminNav badges={badges} />
        <div className="adm-main">
          <Routes>
            <Route index element={<Overview />} />
            <Route path="members" element={<Members />}>
              <Route path=":memberId" element={<MemberDrawer />} />
            </Route>
            <Route path="reports" element={<Reports />} />
            <Route path="content" element={<Content />} />
            <Route path="legends" element={<Legends />} />
            <Route path="legends/new" element={<LegendEditor />} />
            <Route path="legends/:legendId" element={<LegendEditor />} />
            <Route path="log" element={<ActivityLog />} />
            <Route path="help" element={<AdminHelp />} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Routes>
        </div>
      </section>
    </AdminContext.Provider>
  )
}

function AdminNav({ badges }) {
  const location = useLocation()
  const navigate = useNavigate()
  const current = activeItem(location.pathname)

  const badge = (key) => (key && badges[key] > 0 ? badges[key] : 0)

  return (
    <>
      {/* Desktop: a narrow grouped list of links. */}
      <nav className="adm-nav" aria-label="Admin">
        <p className="adm-nav-title">Admin</p>
        <ul>
          {NAV.map((n) => (n.items ? (
            <li key={n.group} className="adm-nav-group">
              <span className="adm-nav-group-label" id={`adm-nav-${n.group}`}>{n.group}</span>
              <ul aria-labelledby={`adm-nav-${n.group}`}>
                {n.items.map((i) => (
                  <li key={i.to}>
                    <NavLink to={i.to} className="adm-nav-link">
                      <span>{i.label}</span>
                      {badge(i.badge) > 0 && (
                        <span className="adm-nav-badge" aria-label={`${badge(i.badge)} need attention`}>{badge(i.badge)}</span>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </li>
          ) : (
            <li key={n.to} className={n.to === '/admin/help' ? 'adm-nav-help' : undefined}>
              <NavLink to={n.to} end={n.end} className="adm-nav-link"><span>{n.label}</span></NavLink>
            </li>
          )))}
        </ul>
      </nav>

      {/* Mobile: one native select. Compact, keyboard- and screen-reader-
          friendly, and the current section is always the visible value. */}
      <div className="adm-mobile-nav">
        <label htmlFor="adm-section-select" className="adm-mobile-nav-label">Admin</label>
        <select
          id="adm-section-select"
          value={current.to}
          onChange={(e) => navigate(e.target.value)}
        >
          {NAV.map((n) => (n.items ? (
            <optgroup key={n.group} label={n.group}>
              {n.items.map((i) => (
                <option key={i.to} value={i.to}>
                  {i.label}{badge(i.badge) ? ` (${badge(i.badge)})` : ''}
                </option>
              ))}
            </optgroup>
          ) : (
            <option key={n.to} value={n.to}>{n.label}</option>
          )))}
        </select>
      </div>
    </>
  )
}
