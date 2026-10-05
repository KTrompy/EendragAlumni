// /admin — an inbox, not a dashboard. It answers one question: what needs a
// decision right now? People waiting for approval and open reports, each with
// its action inline. Totals get one quiet line at the bottom.
import { Link, useLocation } from 'react-router-dom'
import { useState } from 'react'
import { Avatar } from '../Directory.jsx'
import { timeAgo } from '../../utils.js'
import {
  PageHeader, LoadError, Loading, RowError, useAdmin, useAdminQuery, useBusy, useRowErrors,
} from './AdminUI.jsx'
import { fetchMembersPage, fetchReports } from './adminApi.js'
import { DeclineDialog, memberName, useMemberActions } from './memberActions.jsx'
import { ReportItem } from './Reports.jsx'

const QUEUE_SIZE = 10
const REPORT_PREVIEW = 3

export default function Overview() {
  const { counts, countsError, refreshCounts } = useAdmin()
  const ready = useAdminQuery('members', 'overview-ready', () =>
    fetchMembersPage({ filter: 'pending', sort: 'joined', desc: false, pageSize: QUEUE_SIZE }))
  const reports = useAdminQuery('reports', 'overview-open', () =>
    fetchReports({ status: 'open', pageSize: REPORT_PREVIEW }))

  const readyRows = ready.data?.rows || []
  const readyTotal = ready.data?.total ?? 0
  const reportRows = reports.data?.rows || []
  const reportTotal = reports.data?.total ?? 0
  const unconfirmed = counts?.unconfirmed || 0

  const firstLoad = (ready.loading && !ready.data) || (reports.loading && !reports.data)
  const nothingToDo = !firstLoad && !ready.error && !reports.error
    && readyTotal === 0 && reportTotal === 0 && unconfirmed === 0

  return (
    <div className="adm-page">
      <PageHeader title="Overview" />

      {firstLoad && <Loading />}

      {nothingToDo && <p className="adm-caught-up">All caught up.</p>}

      {!firstLoad && (ready.error || readyTotal > 0) && (
        <section className="adm-section" aria-labelledby="ov-approvals">
          <h2 className="adm-h2" id="ov-approvals">
            Waiting for approval {readyTotal > 0 && <span className="adm-count">{readyTotal}</span>}
          </h2>
          {ready.error ? (
            <LoadError what="the approval queue" error={ready.error} onRetry={ready.reload} />
          ) : (
            <>
              <ul className="adm-list">
                {readyRows.map((m) => <QueueRow key={m.id} member={m} />)}
              </ul>
              {readyTotal > readyRows.length && (
                <p className="adm-more">
                  <Link to="/admin/members?filter=pending">View all {readyTotal} waiting</Link>
                </p>
              )}
            </>
          )}
        </section>
      )}

      {!firstLoad && unconfirmed > 0 && (
        <p className="adm-note-line">
          {unconfirmed === 1 ? '1 person hasn’t' : `${unconfirmed} people haven’t`} confirmed their email yet, so they can&rsquo;t be approved.{' '}
          <Link to="/admin/members?filter=unconfirmed">View</Link>
        </p>
      )}

      {!firstLoad && (reports.error || reportTotal > 0) && (
        <section className="adm-section" aria-labelledby="ov-reports">
          <h2 className="adm-h2" id="ov-reports">
            Open reports <span className="adm-count">{reportTotal}</span>
          </h2>
          {reports.error ? (
            <LoadError what="reports" error={reports.error} onRetry={reports.reload} />
          ) : (
            <>
              <ul className="adm-list">
                {reportRows.map((r) => <ReportItem key={r.id} report={r} />)}
              </ul>
              {reportTotal > reportRows.length && (
                <p className="adm-more"><Link to="/admin/reports">View all {reportTotal} reports</Link></p>
              )}
            </>
          )}
        </section>
      )}

      {countsError && (
        <LoadError what="member totals" error={countsError} onRetry={refreshCounts} />
      )}

      {counts && counts.admins === 1 && (
        <p className="adm-note-line">
          You&rsquo;re the only admin. If you lose access, nobody can approve members.{' '}
          <Link to="/admin/members">Add another admin</Link>
        </p>
      )}

      {counts && (
        <p className="adm-totals">
          {counts.total} {counts.total === 1 ? 'member' : 'members'} · {counts.admins} {counts.admins === 1 ? 'admin' : 'admins'}
          {counts.ghosts > 0 && ` · ${counts.ghosts} ghost${counts.ghosts === 1 ? '' : 's'}`}
          {counts.incomplete > 0 && ` · ${counts.incomplete} unfinished signup${counts.incomplete === 1 ? '' : 's'}`}
        </p>
      )}
    </div>
  )
}

// One person in the approval queue: who they are, and Approve / Decline.
function QueueRow({ member: m }) {
  const location = useLocation()
  const actions = useMemberActions()
  const { run, isBusy } = useBusy()
  const [errors, setError] = useRowErrors()
  const [declining, setDeclining] = useState(false)
  const busy = isBusy(m.id)

  async function approve() {
    setError(m.id, null)
    const r = await run(m.id, () => actions.approve(m))
    if (r?.error) setError(m.id, r.error)
  }

  const recordsName = m.first_name && m.preferred_name && m.preferred_name !== m.first_name
    ? `${m.first_name} ${m.last_name}`.trim() : null

  return (
    <li className="adm-item">
      <Avatar url={m.avatar_url} name={m.full_name} size={36} />
      <div className="adm-item-main">
        <Link className="adm-item-title" to={`/admin/members/${m.id}`} state={{ from: location.pathname + location.search }}>
          {memberName(m)}
        </Link>
        <p className="adm-item-meta">
          {recordsName && <>On records: {recordsName} · </>}
          {m.grad_year ? `Class of ${m.grad_year} · ` : ''}
          {m.email} · signed up {timeAgo(m.created_at)}
        </p>
        <RowError message={errors[m.id]} />
      </div>
      <div className="adm-item-actions">
        <button type="button" className="adm-btn primary" onClick={approve} disabled={busy}>
          {busy ? 'Approving…' : 'Approve'}
        </button>
        <button type="button" className="adm-btn" onClick={() => setDeclining(true)} disabled={busy}>
          Decline
        </button>
      </div>
      {declining && <DeclineDialog member={m} onClose={() => setDeclining(false)} />}
    </li>
  )
}
