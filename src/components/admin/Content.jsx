// /admin/content — posts, jobs, events and businesses in one table, with a
// type filter, search and real pagination (the old tabs stopped at the newest
// 100–200 with no way to reach anything older).
import { useEffect, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { useToast } from '../Toast.jsx'
import {
  AdminDialog, Empty, LoadError, Loading, PageHeader, Pager, RowError, Segmented, Status,
  formatDate, useAdmin, useAdminQuery, useDialogAction,
} from './AdminUI.jsx'
import {
  CONTENT_TYPES, PAGE_SIZE, contentStatus, contentTitle, deleteContent, fetchContentPage, setBusinessFeatured,
} from './adminApi.js'

const TYPES = ['all', 'post', 'job', 'event', 'business']

const DELETE_NOTE = {
  post: 'The post, its comments and its photos are removed for everyone.',
  job: 'The listing and any applications sent to it are removed.',
  event: 'The event and everyone’s RSVPs are removed.',
  business: 'The listing and its logo and cover photo are removed.',
}

export default function Content() {
  const [params, setParams] = useSearchParams()
  const type = TYPES.includes(params.get('type')) ? params.get('type') : 'all'
  const page = Math.max(0, Number(params.get('page')) || 0)
  const search = params.get('q') || ''
  const [draft, setDraft] = useState(search)

  useEffect(() => { setDraft(search) }, [search])
  useEffect(() => {
    if (draft === search) return undefined
    const t = setTimeout(() => update({ q: draft.trim() || null, page: null }, true), 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft])

  function update(patch, replace = false) {
    const next = new URLSearchParams(params)
    Object.entries(patch).forEach(([k, v]) => {
      if (v === null || v === undefined || v === '') next.delete(k)
      else next.set(k, String(v))
    })
    setParams(next, { replace })
  }

  const q = useAdminQuery('content', `${type}:${search}:${page}`, () => fetchContentPage({ type, search, page }))
  const rows = q.data?.rows || []

  return (
    <div className="adm-page">
      <PageHeader title="Content" />
      <div className="adm-toolbar">
        <Segmented
          label="Content type"
          value={type}
          onChange={(t) => update({ type: t === 'all' ? null : t, page: null })}
          options={[
            { id: 'all', label: 'All' },
            { id: 'post', label: 'Posts' },
            { id: 'job', label: 'Jobs' },
            { id: 'event', label: 'Events' },
            { id: 'business', label: 'Businesses' },
          ]}
        />
        <label className="adm-search">
          <span className="sr-only">Search content</span>
          <input type="search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Search titles" />
        </label>
      </div>

      {q.error ? (
        <LoadError what="content" error={q.error} onRetry={q.reload} />
      ) : q.loading && !q.data ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty>{search ? `Nothing matches “${search}”.` : 'Nothing here yet.'}</Empty>
      ) : (
        <>
          <div className="adm-table-wrap">
            <table className="adm-table adm-content">
              <thead>
                <tr>
                  <th scope="col" className="adm-col-opt">Type</th>
                  <th scope="col">Title</th>
                  <th scope="col" className="adm-col-opt">Author</th>
                  <th scope="col" className="adm-col-opt">Created</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="adm-col-actions"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => <ContentRow key={`${row._type}-${row.id}`} row={row} />)}
              </tbody>
            </table>
          </div>
          <Pager page={page} pageSize={PAGE_SIZE} total={q.data.total} shown={rows.length} onPage={(p) => update({ page: p || null })} label="items" />
        </>
      )}
    </div>
  )
}

function ContentRow({ row }) {
  const type = row._type
  const def = CONTENT_TYPES[type]
  const location = useLocation()
  const showToast = useToast()
  const { bump } = useAdmin()
  const [confirming, setConfirming] = useState(false)
  const [featuring, setFeaturing] = useState(false)
  const [error, setError] = useState(null)
  const status = contentStatus(type, row)
  const title = contentTitle(type, row)

  const remover = useDialogAction(() => {
    setConfirming(false)
    bump('content')
    bump('reports')
    showToast(`${def.label} deleted`)
  })

  async function toggleFeature() {
    setFeaturing(true)
    setError(null)
    const { error: err } = await setBusinessFeatured(row.id, !row.promoted)
    setFeaturing(false)
    if (err) { setError(err.message); return }
    bump('content')
    showToast(row.promoted ? `${row.name} unfeatured` : `${row.name} featured`)
  }

  const created = type === 'event'
    ? `${formatDate(row.created_at)}`
    : formatDate(row.created_at)

  return (
    <tr>
      <td className="adm-col-opt">{def.label}</td>
      <td>
        <span className="adm-row-title-text">{title}</span>
        <span className="adm-sub">
          <span className="adm-only-sm">{def.label} · </span>
          {type === 'event' && `On ${formatDate(row.event_date)}`}
          {type === 'job' && row.location}
          {type === 'business' && [row.category, row.city].filter(Boolean).join(' · ')}
          <span className="adm-only-sm">{type === 'post' ? '' : ' · '}by {row.author?.full_name || 'a member'}</span>
        </span>
        <RowError message={error} />
      </td>
      <td className="adm-col-opt">{row.author?.full_name || <span className="adm-muted">—</span>}</td>
      <td className="adm-col-opt adm-nowrap">{created}</td>
      <td><Status value={status.key}>{status.label}</Status></td>
      <td className="adm-col-actions">
        <div className="adm-row-actions">
          <Link className="adm-btn" to={def.path(row.id)} state={{ from: location.pathname + location.search }}>Open</Link>
          {type === 'business' && (
            <button type="button" className="adm-btn adm-hide-sm" onClick={toggleFeature} disabled={featuring}>
              {featuring ? 'Saving…' : row.promoted ? 'Unfeature' : 'Feature'}
            </button>
          )}
          <button type="button" className="adm-btn danger" onClick={() => setConfirming(true)} aria-label={`Delete ${def.label.toLowerCase()}: ${title}`}>
            Delete
          </button>
        </div>
      </td>
      {confirming && (
        <AdminDialog
          title={`Delete this ${def.label.toLowerCase()}?`}
          confirmLabel="Delete"
          tone="danger"
          busy={remover.busy}
          error={remover.error}
          onCancel={() => { setConfirming(false); remover.reset() }}
          onConfirm={() => remover.run(() => deleteContent(type, row))}
        >
          <p><strong>{title}</strong></p>
          <p>{DELETE_NOTE[type]} This can&rsquo;t be undone.</p>
        </AdminDialog>
      )}
    </tr>
  )
}
