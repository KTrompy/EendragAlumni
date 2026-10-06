// /admin/members/:memberId — one member, in a side drawer over the table.
// Everything that can be done to an account lives here; the irreversible one
// sits on its own under "Danger zone".
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import useModal from '../../useModal.js'
import { Avatar } from '../Directory.jsx'
import { timeAgo } from '../../utils.js'
import { formatLocation } from '../../signup.js'
import {
  AdminDialog, LoadError, Loading, RowError, Status, formatDate, useAdmin, useAdminQuery, useDialogAction,
} from './AdminUI.jsx'
import { ACTION_TEXT, STATUS_LABEL, applicationGaps, fetchMember, fetchMemberActivity, memberStatus, memberYears } from './adminApi.js'
import { DeclineDialog, ResendButton, memberName, useMemberActions } from './memberActions.jsx'

export default function MemberDrawer() {
  const { memberId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()

  const close = () => navigate(location.state?.from || `/admin/members${location.search}`)
  const ref = useModal({ onClose: close, history: false })

  const q = useAdminQuery('members', `detail:${memberId}`, async () => {
    const [m, a] = await Promise.all([fetchMember(memberId), fetchMemberActivity(memberId)])
    if (m.error) return { error: m.error }
    return { member: m.data, activity: a.data || [], activityError: a.error || null }
  })

  // Portalled to <body> so no transformed ancestor can trap the fixed panel.
  return createPortal(
    <div className="adm-drawer-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <aside className="adm-drawer" role="dialog" aria-modal="true" aria-labelledby="adm-drawer-title" ref={ref}>
        <div className="adm-drawer-top">
          <button type="button" className="adm-btn quiet adm-drawer-close" onClick={close} aria-label="Close member details">
            ✕
          </button>
        </div>
        {q.error ? (
          <>
            <h2 id="adm-drawer-title" className="sr-only">Member</h2>
            <LoadError what="this member" error={q.error} onRetry={q.reload} />
          </>
        ) : q.loading && !q.data ? (
          <>
            <h2 id="adm-drawer-title" className="sr-only">Member</h2>
            <Loading />
          </>
        ) : !q.data?.member ? (
          <>
            <h2 id="adm-drawer-title" className="adm-drawer-name">Not found</h2>
            <p className="adm-muted">This account doesn&rsquo;t exist any more.</p>
          </>
        ) : (
          <MemberDetail data={q.data} onDeleted={close} />
        )}
      </aside>
    </div>,
    document.body
  )
}

function MemberDetail({ data, onDeleted }) {
  const { member: m, activity, activityError } = data
  const { myId } = useAdmin()
  const actions = useMemberActions()
  const [confirm, setConfirm] = useState(null) // 'unapprove' | 'promote' | 'demote' | 'delete'
  const [declining, setDeclining] = useState(false)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)

  const isMe = m.id === myId
  const status = memberStatus(m)
  const name = memberName(m)
  const recordsName = [m.first_name, m.last_name].filter(Boolean).join(' ')
  const gaps = applicationGaps(m).filter((g) => g !== 'signup form not finished')

  async function direct(key, fn) {
    if (busy) return
    setBusy(key)
    setError(null)
    const r = await fn()
    setBusy(null)
    if (r?.error) setError(r.error.message || String(r.error))
  }

  const dialog = useDialogAction((r) => {
    const was = confirm
    setConfirm(null)
    if (was === 'delete' && !r?.error) onDeleted()
  })

  const CONFIRM = {
    unapprove: {
      title: `Move ${name} back to pending?`,
      body: 'They lose access and see the “waiting to be verified” screen. Nothing they’ve posted is deleted, and you can approve them again at any time.',
      label: 'Move to pending', tone: 'primary', run: () => actions.unapprove(m),
    },
    promote: {
      title: `Make ${name} an admin?`,
      body: 'They get the same access you have: approving and deleting members, moderating content and managing other admins.',
      label: 'Make admin', tone: 'primary', run: () => actions.setAdmin(m, true),
    },
    demote: {
      title: `Remove ${name}'s admin access?`,
      body: 'They become an ordinary member again. The site won’t let you remove the last admin.',
      label: 'Remove admin', tone: 'danger', run: () => actions.setAdmin(m, false),
    },
    delete: {
      title: `Delete ${name}'s account?`,
      body: 'Their login, profile, posts, comments, job listings, events, RSVPs, business listings and uploaded files are all removed. This can’t be undone.',
      label: 'Delete account', tone: 'danger', run: () => actions.remove(m),
      requireText: m.is_admin ? ((m.full_name || '').trim() || m.email) : null,
    },
  }
  const c = confirm ? CONFIRM[confirm] : null

  const canBeAdmin = !!m.consented_at

  return (
    <>
      <header className="adm-drawer-head">
        <Avatar url={m.avatar_url || null} name={m.full_name} size={56} />
        <div>
          <h2 id="adm-drawer-title" className="adm-drawer-name">
            {name}{isMe && <span className="adm-you">You</span>}
          </h2>
          <p className="adm-item-meta">
            <Status value={status}>{STATUS_LABEL[status]}</Status>
            <span> · {m.is_admin ? 'Admin' : 'Member'}</span>
          </p>
        </div>
      </header>

      <dl className="adm-dl">
        <dt>Email</dt>
        <dd><a href={`mailto:${m.email}`}>{m.email}</a></dd>
        {recordsName && recordsName !== m.full_name && (<><dt>Name on records</dt><dd>{recordsName}</dd></>)}
        {m.preferred_name && (<><dt>Preferred name</dt><dd>{m.preferred_name}</dd></>)}
        <dt>Eendrag years</dt>
        <dd>{memberYears(m) || <span className="adm-muted">Not given</span>}</dd>
        <dt>Location</dt>
        <dd>{formatLocation(m.city, m.country) || <span className="adm-muted">Not given</span>}</dd>
        <dt>Signed up</dt>
        <dd>{formatDate(m.created_at, true)}</dd>
        <dt>Application</dt>
        <dd>
          {m.consented_at ? `Submitted ${formatDate(m.consented_at)}` : <span className="adm-muted">Not finished</span>}
          {gaps.length > 0 && <span className="adm-sub adm-warn-text">Missing: {gaps.join(', ')}</span>}
        </dd>
        <dt>Email confirmed</dt>
        <dd>{m.email_confirmed_at ? formatDate(m.email_confirmed_at) : <span className="adm-warn-text">Not confirmed</span>}</dd>
        {'last_sign_in_at' in m && (<><dt>Last sign-in</dt><dd>{m.last_sign_in_at ? timeAgo(m.last_sign_in_at) : <span className="adm-muted">Never</span>}</dd></>)}
        {m.declined_at && (
          <>
            <dt>Declined</dt>
            <dd>{formatDate(m.declined_at)}{m.declined_reason ? ` · “${m.declined_reason}”` : ''}</dd>
          </>
        )}
      </dl>

      <section className="adm-drawer-section" aria-labelledby="adm-d-access">
        <h3 className="adm-h3" id="adm-d-access">Access</h3>
        <div className="adm-btn-row">
          {status === 'pending' && (
            <>
              <button type="button" className="adm-btn primary" disabled={!!busy}
                onClick={() => direct('approve', () => actions.approve(m))}>
                {busy === 'approve' ? 'Approving…' : 'Approve'}
              </button>
              <button type="button" className="adm-btn" disabled={!!busy} onClick={() => setDeclining(true)}>Decline</button>
            </>
          )}
          {status === 'unconfirmed' && (
            <>
              <ResendButton member={m} label="Resend confirmation" onError={(e) => setError(e ? e.message : null)} />
              <button type="button" className="adm-btn" disabled={!!busy} onClick={() => setDeclining(true)}>Decline</button>
            </>
          )}
          {status === 'incomplete' && (
            <p className="adm-muted adm-inline-note">They haven&rsquo;t finished the signup form, so there&rsquo;s nothing to approve yet.</p>
          )}
          {status === 'approved' && !isMe && (
            <button type="button" className="adm-btn" disabled={!!busy} onClick={() => setConfirm('unapprove')}>Move back to pending</button>
          )}
          {status === 'declined' && (
            <button type="button" className="adm-btn" disabled={!!busy}
              onClick={() => direct('restore', () => actions.restore(m))}>
              {busy === 'restore' ? 'Saving…' : 'Undo decline'}
            </button>
          )}
        </div>
      </section>

      {!isMe && (
        <section className="adm-drawer-section" aria-labelledby="adm-d-role">
          <h3 className="adm-h3" id="adm-d-role">Role</h3>
          <div className="adm-btn-row">
            {m.is_admin ? (
              <button type="button" className="adm-btn" onClick={() => setConfirm('demote')}>Remove admin</button>
            ) : canBeAdmin ? (
              <button type="button" className="adm-btn" onClick={() => setConfirm('promote')}>Make admin</button>
            ) : null}
          </div>
          {!m.is_admin && !canBeAdmin && (
            <p className="adm-inline-note adm-muted">
              They can be made an admin once they’ve finished signing up.
            </p>
          )}
        </section>
      )}

      <RowError message={error} />

      <section className="adm-drawer-section" aria-labelledby="adm-d-activity">
        <h3 className="adm-h3" id="adm-d-activity">Recent admin activity</h3>
        {activityError ? (
          <p className="adm-muted">Couldn&rsquo;t load the activity log.</p>
        ) : activity.length === 0 ? (
          <p className="adm-muted">Nothing recorded.</p>
        ) : (
          <ul className="adm-mini-log">
            {activity.map((a) => {
              const verb = ACTION_TEXT[a.action] || a.action.replace(/_/g, ' ')
              const onThem = a.target_id === m.id
              return (
                <li key={a.id}>
                  <span>{onThem ? `${verb} by ${a.actor_name || 'an admin'}` : `${verb}: ${a.target_label || '—'}`}</span>
                  <time className="adm-muted" dateTime={a.created_at} title={formatDate(a.created_at, true)}>{timeAgo(a.created_at)}</time>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {!isMe && (
        <section className="adm-danger" aria-labelledby="adm-d-danger">
          <h3 className="adm-h3" id="adm-d-danger">Danger zone</h3>
          <p className="adm-muted">Permanently deletes the account and everything they&rsquo;ve posted. To pause someone&rsquo;s access instead, move them back to pending.</p>
          <button type="button" className="adm-btn danger" onClick={() => setConfirm('delete')}>Delete account</button>
        </section>
      )}

      {c && (
        <AdminDialog
          title={c.title}
          confirmLabel={c.label}
          tone={c.tone}
          busy={dialog.busy}
          error={dialog.error}
          requireText={c.requireText || null}
          onCancel={() => { setConfirm(null); dialog.reset() }}
          onConfirm={() => dialog.run(c.run)}
        >
          <p>{c.body}</p>
          {confirm === 'delete' && m.is_admin && <p><strong>{name} is an admin.</strong></p>}
        </AdminDialog>
      )}
      {declining && <DeclineDialog member={m} onClose={() => setDeclining(false)} />}
    </>
  )
}
