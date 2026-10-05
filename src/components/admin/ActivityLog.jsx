// /admin/log — every admin action, written by database triggers and the two
// admin Edge Functions (schema-update-52 and -62). Read-only: nobody,
// including admins, can edit or remove an entry.
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import {
  Empty, LoadError, Loading, PageHeader, Pager, Segmented, formatDate, useAdminQuery,
} from './AdminUI.jsx'
import { ACTION_TEXT, LOG_FILTERS, fetchActivity } from './adminApi.js'
import { timeAgo } from '../../utils.js'

const LOG_PAGE = 50

export default function ActivityLog() {
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const filter = LOG_FILTERS.some((f) => f.id === params.get('filter')) ? params.get('filter') : 'all'
  const page = Math.max(0, Number(params.get('page')) || 0)

  const q = useAdminQuery('log', `${filter}:${page}`, () => fetchActivity({ filter, page, pageSize: LOG_PAGE }))
  const rows = q.data?.rows || []

  function update(patch) {
    const next = new URLSearchParams(params)
    Object.entries(patch).forEach(([k, v]) => { if (v === null || v === undefined) next.delete(k); else next.set(k, String(v)) })
    setParams(next)
  }

  return (
    <div className="adm-page">
      <PageHeader title="Activity log" />
      <div className="adm-toolbar">
        <Segmented
          label="Filter activity"
          value={filter}
          onChange={(f) => update({ filter: f === 'all' ? null : f, page: null })}
          options={LOG_FILTERS.map((f) => ({ id: f.id, label: f.label }))}
        />
      </div>

      {q.error ? (
        <LoadError what="the activity log" error={q.error} onRetry={q.reload} />
      ) : q.loading && !q.data ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty>Nothing recorded{filter !== 'all' ? ' of this kind' : ''} yet.</Empty>
      ) : (
        <>
          <div className="adm-table-wrap">
            <table className="adm-table adm-log">
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Admin</th>
                  <th scope="col">Action</th>
                  <th scope="col">Target</th>
                  <th scope="col" className="adm-col-opt">Details</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id}>
                    <td className="adm-nowrap">
                      <time dateTime={a.created_at} title={formatDate(a.created_at, true)}>{timeAgo(a.created_at)}</time>
                    </td>
                    <td>{a.actor_name || 'An admin'}</td>
                    <td>{ACTION_TEXT[a.action] || a.action.replace(/_/g, ' ')}</td>
                    <td>
                      {a.target_type === 'member' && a.target_id && a.action !== 'delete_member'
                        ? <Link to={`/admin/members/${a.target_id}`} state={{ from: location.pathname + location.search }}>{a.target_label || 'Member'}</Link>
                        : (a.target_label || <span className="adm-muted">—</span>)}
                      {a.details && <span className="adm-sub adm-only-sm">{a.details}</span>}
                    </td>
                    <td className="adm-col-opt adm-muted">{a.details || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} pageSize={LOG_PAGE} total={q.data.total} shown={rows.length} onPage={(p) => update({ page: p || null })} label="entries" />
        </>
      )}
    </div>
  )
}
