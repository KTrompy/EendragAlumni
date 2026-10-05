// /admin/reports — member-filed reports, with the reported item shown inline
// so it can be judged without leaving the page, and "Remove & resolve" doing
// the removal and the resolution as one step.
import { useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { useToast } from '../Toast.jsx'
import { Avatar } from '../Directory.jsx'
import { plainText, timeAgo, truncate } from '../../utils.js'
import {
  AdminDialog, Empty, LoadError, Loading, PageHeader, Pager, RowError, Segmented, Status,
  useAdmin, useAdminQuery, useDialogAction,
} from './AdminUI.jsx'
import {
  CONTENT_TYPES, PAGE_SIZE, REPORT_REASON, REPORT_TYPE_LABEL, contentTitle, fetchReports,
  removeAndResolve, setReportStatus,
} from './adminApi.js'

export default function Reports() {
  const [params, setParams] = useSearchParams()
  const view = params.get('view') === 'resolved' ? 'resolved' : 'open'
  const page = Math.max(0, Number(params.get('page')) || 0)
  const { openReports } = useAdmin()

  const q = useAdminQuery('reports', `${view}:${page}`, () => fetchReports({ status: view, page }))
  const rows = q.data?.rows || []

  function setView(v) {
    const next = new URLSearchParams()
    if (v === 'resolved') next.set('view', 'resolved')
    setParams(next)
  }
  function setPage(p) {
    const next = new URLSearchParams(params)
    if (p > 0) next.set('page', String(p)); else next.delete('page')
    setParams(next)
  }

  return (
    <div className="adm-page">
      <PageHeader title="Reports" />
      <div className="adm-toolbar">
        <Segmented
          label="Show reports"
          value={view}
          onChange={setView}
          options={[
            { id: 'open', label: 'Open', count: openReports || 0 },
            { id: 'resolved', label: 'Resolved' },
          ]}
        />
      </div>

      {q.error ? (
        <LoadError what="reports" error={q.error} onRetry={q.reload} />
      ) : q.loading && !q.data ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty>{view === 'open' ? 'No open reports.' : 'No resolved reports yet.'}</Empty>
      ) : (
        <>
          <ul className={view === 'open' ? 'adm-list' : 'adm-list adm-list-muted'}>
            {rows.map((r) => <ReportItem key={r.id} report={r} />)}
          </ul>
          <Pager page={page} pageSize={PAGE_SIZE} total={q.data.total} shown={rows.length} onPage={setPage} label="reports" />
        </>
      )}
    </div>
  )
}

// One report: what was reported (preview), why and by whom, and the actions.
// Used here and on the Overview.
export function ReportItem({ report: r }) {
  const location = useLocation()
  const showToast = useToast()
  const { bump, refreshCounts } = useAdmin()
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [confirming, setConfirming] = useState(false)

  const isOpen = r.status === 'open'
  const isContent = !!CONTENT_TYPES[r.entity_type]
  const gone = !r.target && !r.targetError && r.entity_type !== 'group_post'
  const typeLabel = REPORT_TYPE_LABEL[r.entity_type] || r.entity_type

  const openHref = r.entity_type === 'profile'
    ? (r.target ? `/admin/members/${r.entity_id}` : null)
    : (r.target && CONTENT_TYPES[r.entity_type] ? CONTENT_TYPES[r.entity_type].path(r.entity_id) : null)

  function changed() {
    bump('reports')
    refreshCounts()
  }

  async function setStatus(status, toastText) {
    setBusy(status)
    setError(null)
    const { error: err } = await setReportStatus(r.id, status)
    setBusy(null)
    if (err) { setError(err.message); return }
    changed()
    showToast(toastText)
  }

  const remover = useDialogAction(() => {
    setConfirming(false)
    changed()
    bump('content')
    showToast(`${typeLabel} removed and report resolved`)
  })

  return (
    <li className={isOpen ? 'adm-item adm-report' : 'adm-item adm-report resolved'}>
      <div className="adm-item-main">
        <p className="adm-report-head">
          <span className="adm-report-type">{typeLabel}</span>
          <span className="adm-muted"> · {REPORT_REASON[r.reason] || r.reason} · reported by {r.reporter?.full_name || 'a member'} · {timeAgo(r.created_at)}</span>
        </p>

        <ReportPreview report={r} gone={gone} />

        {r.details && <p className="adm-report-note">&ldquo;{truncate(r.details, 240)}&rdquo;</p>}
        {!isOpen && <p className="adm-item-meta"><Status value={r.status}>{r.status === 'dismissed' ? 'Dismissed' : 'Resolved'}</Status></p>}
        <RowError message={error} />
      </div>

      <div className="adm-item-actions">
        {openHref && (
          <Link className="adm-btn" to={openHref} state={{ from: location.pathname + location.search }}>Open</Link>
        )}
        {isOpen && isContent && r.target && (
          <button type="button" className="adm-btn danger" onClick={() => setConfirming(true)} disabled={!!busy}>
            Remove &amp; resolve
          </button>
        )}
        {isOpen && (!isContent || !r.target) && (
          <button type="button" className="adm-btn" onClick={() => setStatus('reviewed', 'Report resolved')} disabled={!!busy}>
            {busy === 'reviewed' ? 'Saving…' : 'Resolve'}
          </button>
        )}
        {isOpen && (
          <button type="button" className="adm-btn" onClick={() => setStatus('dismissed', 'Report dismissed')} disabled={!!busy}>
            {busy === 'dismissed' ? 'Saving…' : 'Dismiss'}
          </button>
        )}
        {!isOpen && (
          <button type="button" className="adm-btn quiet" onClick={() => setStatus('open', 'Report reopened')} disabled={!!busy}>
            {busy === 'open' ? 'Saving…' : 'Reopen'}
          </button>
        )}
      </div>

      {confirming && (
        <AdminDialog
          title={`Remove this ${typeLabel.toLowerCase()}?`}
          confirmLabel="Remove & resolve"
          tone="danger"
          busy={remover.busy}
          error={remover.error}
          onCancel={() => { setConfirming(false); remover.reset() }}
          onConfirm={() => remover.run(() => removeAndResolve(r))}
        >
          <p>
            <strong>{contentTitle(r.entity_type, r.target)}</strong> will be deleted for everyone
            {r.entity_type === 'job' ? ', along with any applications to it' : ''}. This can&rsquo;t be undone.
            Any other open reports on it are resolved too.
          </p>
        </AdminDialog>
      )}
    </li>
  )
}

function ReportPreview({ report: r, gone }) {
  if (r.targetError) return <p className="adm-report-preview adm-muted">Couldn&rsquo;t load the reported item.</p>
  if (r.entity_type === 'group_post') return <p className="adm-report-preview adm-muted">A group post (groups have been removed from the site).</p>
  if (gone) return <p className="adm-report-preview adm-muted">Already removed.</p>
  const t = r.target

  if (r.entity_type === 'profile') {
    return (
      <div className="adm-report-preview adm-report-person">
        <Avatar url={t.avatar_url || null} name={t.full_name} size={28} />
        <span>{t.full_name || 'Unnamed member'}{t.grad_year ? ` · Class of ${t.grad_year}` : ''}</span>
      </div>
    )
  }

  const body = r.entity_type === 'post'
    ? truncate(plainText(t.content === '(no text)' ? '' : t.content), 200)
    : r.entity_type === 'job' ? [t.location].filter(Boolean).join('')
    : r.entity_type === 'business' ? [t.category, [t.city, t.country].filter(Boolean).join(', ')].filter(Boolean).join(' · ')
    : ''

  return (
    <div className="adm-report-preview">
      <p className="adm-report-title">{contentTitle(r.entity_type, t)}</p>
      {body && <p className="adm-report-body">{body}</p>}
      <p className="adm-item-meta">By {t.author?.full_name || 'a member'} · {timeAgo(t.created_at)}</p>
    </div>
  )
}
