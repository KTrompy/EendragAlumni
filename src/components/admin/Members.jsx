// /admin/members — every account as a table: filter, search, sort, page.
// Clicking a row opens the member drawer at /admin/members/:id (rendered
// through <Outlet />), where every other action lives. Only the queue's own
// actions (Approve/Decline, Resend link) sit on the row itself.
import { useEffect, useState } from 'react'
import { Link, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Avatar } from '../Directory.jsx'
import {
  Empty, LoadError, Loading, PageHeader, Pager, RowError, Segmented, Status,
  formatDate, useAdmin, useAdminQuery, useBusy, useRowErrors,
} from './AdminUI.jsx'
import { PAGE_SIZE, STATUS_LABEL, fetchMembersPage, memberStatus } from './adminApi.js'
import { DeclineDialog, ResendButton, memberName, useMemberActions } from './memberActions.jsx'
import GhostAccountModal from './GhostAccountModal.jsx'

const FILTERS = ['all', 'pending', 'unconfirmed', 'declined', 'admins', 'ghosts']
const SORTS = ['joined', 'name', 'class']

export default function Members() {
  const { myId, counts } = useAdmin()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()

  const filter = FILTERS.includes(params.get('filter')) ? params.get('filter') : 'all'
  const sort = SORTS.includes(params.get('sort')) ? params.get('sort') : 'joined'
  const desc = params.get('dir') ? params.get('dir') !== 'asc' : sort === 'joined'
  const page = Math.max(0, Number(params.get('page')) || 0)
  const search = params.get('q') || ''

  const [draft, setDraft] = useState(search)
  const [ghostOpen, setGhostOpen] = useState(false)

  // Keep the box in sync when Back/Forward changes the URL.
  useEffect(() => { setDraft(search) }, [search])

  // Debounced: the URL (and the query) follow the box 300ms after typing stops.
  useEffect(() => {
    if (draft === search) return undefined
    const t = setTimeout(() => update({ q: draft.trim() || null, page: null }), 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft])

  function update(patch) {
    const next = new URLSearchParams(params)
    Object.entries(patch).forEach(([k, v]) => {
      if (v === null || v === undefined || v === '') next.delete(k)
      else next.set(k, String(v))
    })
    setParams(next, { replace: 'q' in patch })
  }

  const q = useAdminQuery('members', `list:${filter}:${search}:${sort}:${desc}:${page}`,
    () => fetchMembersPage({ filter, search, sort, desc, page }))
  const rows = q.data?.rows || []

  function toggleSort(col) {
    if (sort === col) update({ dir: desc ? 'asc' : 'desc', page: null })
    else update({ sort: col === 'joined' ? null : col, dir: col === 'joined' ? null : 'asc', page: null })
  }

  const listPath = location.pathname.replace(/\/members\/.*$/, '/members') + location.search
  const openMember = (id) => navigate(`/admin/members/${id}${location.search}`, { state: { from: listPath } })

  const ariaSort = (col) => (sort === col ? (desc ? 'descending' : 'ascending') : 'none')
  const SortButton = ({ col, children }) => (
    <button type="button" className="adm-sort" onClick={() => toggleSort(col)}>
      {children}
      <span aria-hidden="true" className="adm-sort-icon">{sort === col ? (desc ? '↓' : '↑') : ''}</span>
    </button>
  )

  return (
    <div className="adm-page">
      <PageHeader title="Members">
        <button type="button" className="adm-btn" onClick={() => setGhostOpen(true)}>+ New ghost account</button>
      </PageHeader>

      <div className="adm-toolbar">
        <Segmented
          label="Filter members"
          value={filter}
          onChange={(f) => update({ filter: f === 'all' ? null : f, page: null })}
          options={[
            { id: 'all', label: 'All' },
            { id: 'pending', label: 'Pending', count: counts?.pending },
            { id: 'unconfirmed', label: 'Unconfirmed', count: counts?.unconfirmed },
            { id: 'declined', label: 'Declined' },
            { id: 'admins', label: 'Admins' },
            { id: 'ghosts', label: 'Ghosts' },
          ]}
        />
        <label className="adm-search">
          <span className="sr-only">Search members</span>
          <input
            type="search"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Search name, email, city, class"
          />
        </label>
      </div>

      {q.error ? (
        <LoadError what="members" error={q.error} onRetry={q.reload} />
      ) : q.loading && !q.data ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty>{search ? `No members match “${search}”.` : 'No members in this view.'}</Empty>
      ) : (
        <>
          <div className="adm-table-wrap">
            <table className="adm-table adm-members">
              <thead>
                <tr>
                  <th scope="col" aria-sort={ariaSort('name')}><SortButton col="name">Name</SortButton></th>
                  <th scope="col" className="adm-col-opt">Email</th>
                  <th scope="col" className="adm-col-opt" aria-sort={ariaSort('class')}><SortButton col="class">Class</SortButton></th>
                  <th scope="col">Status</th>
                  <th scope="col" className="adm-col-opt">Role</th>
                  <th scope="col" className="adm-col-opt" aria-sort={ariaSort('joined')}><SortButton col="joined">Joined</SortButton></th>
                  <th scope="col" className="adm-col-actions adm-col-opt"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <MemberRow key={m.id} member={m} isMe={m.id === myId} listPath={listPath} onOpen={() => openMember(m.id)} />
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} pageSize={PAGE_SIZE} total={q.data.total} shown={rows.length} onPage={(p) => update({ page: p || null })} label="members" />
        </>
      )}

      {ghostOpen && <GhostAccountModal onClose={() => setGhostOpen(false)} />}
      <Outlet />
    </div>
  )
}

function MemberRow({ member: m, isMe, listPath, onOpen }) {
  const status = memberStatus(m)
  const actions = useMemberActions()
  const { run, isBusy } = useBusy()
  const [errors, setError] = useRowErrors()
  const [declining, setDeclining] = useState(false)
  const busy = isBusy(m.id)

  async function approve(e) {
    e.stopPropagation()
    setError(m.id, null)
    const r = await run(m.id, () => actions.approve(m))
    if (r?.error) setError(m.id, r.error)
  }

  // The whole row opens the drawer for mouse users; the name is the real
  // link for keyboard and screen-reader users.
  function onRowClick(e) {
    // Clicks inside a portalled dialog still bubble here through React's
    // tree; only react to clicks that are really inside this row.
    if (!e.currentTarget.contains(e.target)) return
    if (e.target.closest('a, button, input, select, label')) return
    onOpen()
  }

  const role = m.is_admin ? 'Admin' : m.is_ghost ? 'Ghost' : 'Member'

  return (
    <tr className="adm-row-link" onClick={onRowClick}>
      <td>
        <div className="adm-cell-person">
          <Avatar url={m.avatar_url || null} name={m.full_name} size={28} />
          <div>
            <Link to={`/admin/members/${m.id}`} state={{ from: listPath }} className="adm-row-title">
              {memberName(m)}
            </Link>
            {isMe && <span className="adm-you">You</span>}
            <span className="adm-sub adm-only-sm">{m.email}{m.is_admin ? ' · Admin' : m.is_ghost ? ' · Ghost' : ''}</span>
            <RowError message={errors[m.id]} />
          </div>
        </div>
      </td>
      <td className="adm-col-opt adm-ellipsis" title={m.email}>{m.email}</td>
      <td className="adm-col-opt">{m.grad_year || <span className="adm-muted">—</span>}</td>
      <td><Status value={status}>{STATUS_LABEL[status]}</Status></td>
      <td className="adm-col-opt">{role}</td>
      <td className="adm-col-opt adm-nowrap">{formatDate(m.created_at)}</td>
      <td className="adm-col-actions adm-col-opt">
        {status === 'pending' && (
          <div className="adm-row-actions">
            <button type="button" className="adm-btn primary" onClick={approve} disabled={busy}>
              {busy ? 'Approving…' : 'Approve'}
            </button>
            <button type="button" className="adm-btn adm-hide-sm" onClick={(e) => { e.stopPropagation(); setDeclining(true) }} disabled={busy}>
              Decline
            </button>
          </div>
        )}
        {status === 'unconfirmed' && (
          <ResendButton member={m} onError={(err) => setError(m.id, err)} />
        )}
        {declining && <DeclineDialog member={m} onClose={() => setDeclining(false)} />}
      </td>
    </tr>
  )
}
