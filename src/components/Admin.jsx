import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, adminDeleteAccount } from '../supabaseClient'
import EmptyState from './EmptyState.jsx'
import LoadingState from './LoadingState.jsx'
import DeleteButton from './DeleteButton.jsx'
import ConfirmDialog from './ConfirmDialog.jsx'
import { Avatar } from './Directory.jsx'
import { useToast } from './Toast.jsx'
import AdminHandbook from './AdminHandbook.jsx'

// `help` is the one-line explainer rendered under the tab strip whenever that
// section is open. It exists because this page is meant to be handed to a
// committee member who has never seen it before: every tab should say what it
// is for and what the buttons on it will do, without them having to click one
// to find out. The Handbook tab is the long-form version of the same idea.
const SUBTABS = [
  {
    id: 'pending',
    label: 'Pending approval',
    help: "New signups waiting to be let in. Approving someone gives them full access — the directory, private messaging and posting. Only approve people you can actually place.",
  },
  {
    id: 'reports',
    label: 'Reports',
    help: "Things members have flagged. Use View to judge it yourself, then Mark reviewed once you've dealt with it, or Dismiss if there's nothing wrong. Neither button deletes anything.",
  },
  {
    id: 'members',
    label: 'Members',
    help: "Everyone with an account. Un-approve is the reversible one — it pauses access but keeps everything they've written. Delete account is permanent and has no undo.",
  },
  {
    id: 'posts',
    label: 'Posts',
    help: "Everything on the feed, newest first. Members can delete their own posts, so you only need this for something that shouldn't be up.",
  },
  {
    id: 'jobs',
    label: 'Jobs',
    help: "Job listings members have posted. Deleting one also removes any applications sent to it.",
  },
  {
    id: 'events',
    label: 'Events',
    help: "All events, newest first. Deleting an event also wipes everyone's RSVPs, so check with the organiser first.",
  },
  {
    id: 'businesses',
    label: 'Businesses',
    help: "Alumni businesses. Feature pins one to the top of the directory — harmless and reversible, but worth agreeing a rule for so it doesn't become a favour.",
  },
  {
    id: 'activity',
    label: 'Activity log',
    help: "A permanent record of every admin action — who approved, removed or deleted what, and when. Written by the database itself, so nobody can edit or erase it, including you.",
  },
  {
    id: 'handbook',
    label: 'Handbook',
    help: null, // it explains itself
  },
]

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso)) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return new Date(iso).toLocaleDateString()
}

// Strips HTML down to plain text for short previews in moderation lists —
// same trick Jobs.jsx uses for search, just reused here for post/job bodies.
// Parsed via DOMParser into a detached document rather than assigned to a
// live element's innerHTML — a detached document never loads its
// resources, so an untrusted payload like <img src=x onerror=alert(1)>
// can't fire its handler while we're just extracting text.
function plainText(html) {
  return new DOMParser().parseFromString(html || '', 'text/html').body.textContent || ''
}

function truncate(text, n = 140) {
  const t = text.trim()
  return t.length > n ? t.slice(0, n).trimEnd() + '…' : t
}

const COUNT_TABLES = [
  ['posts', 'posts'],
  ['jobs', 'jobs'],
  ['events', 'events'],
  ['businesses', 'businesses'],
]

export default function Admin({ session }) {
  const [subtab, setSubtab] = useState('pending')
  const [members, setMembers] = useState([])
  const [loadingMembers, setLoadingMembers] = useState(true)
  const [memberError, setMemberError] = useState(null)
  const [counts, setCounts] = useState({})
  const [openReportsCount, setOpenReportsCount] = useState(0)

  async function loadOpenReportsCount() {
    const { count } = await supabase.from('reports').select('id', { count: 'exact', head: true }).eq('status', 'open')
    setOpenReportsCount(count || 0)
  }

  async function loadMembers() {
    setLoadingMembers(true)
    const { data, error } = await supabase.rpc('admin_list_members')
    if (error) setMemberError(error.message)
    else { setMembers(data || []); setMemberError(null) }
    setLoadingMembers(false)
  }

  async function loadCounts() {
    const results = await Promise.all(
      COUNT_TABLES.map(([, table]) => supabase.from(table).select('*', { count: 'exact', head: true }))
    )
    const next = {}
    COUNT_TABLES.forEach(([key], i) => { next[key] = results[i].count })
    setCounts(next)
  }

  useEffect(() => {
    loadMembers()
    loadCounts()
    loadOpenReportsCount()
  }, [])

  // Optimistic toggle, rolled back (via a full reload) if the write fails —
  // e.g. the schema-update-8.sql migration hasn't been run yet, so the
  // is_admin column or RLS policy doesn't exist.
  // Every destructive/consequential member action runs through here: the
  // buttons had no busy state at all, so a double-click fired the write twice
  // and — worse — gave no feedback that anything was happening on a slow
  // connection, which is what invites the second click.
  const [busyIds, setBusyIds] = useState(() => new Set())
  async function withBusy(id, fn) {
    if (busyIds.has(id)) return
    setBusyIds((prev) => new Set(prev).add(id))
    try {
      await fn()
    } finally {
      setBusyIds((prev) => { const next = new Set(prev); next.delete(id); return next })
    }
  }

  async function setApproved(id, approved) {
    // Guard against approving a signup that hasn't finished FinishSignup.jsx
    // (or the Auth.jsx wizard) yet — e.g. someone who used "Continue with
    // Google" but closed the tab before submitting years/address/consent.
    // The RLS policy (schema-update-45) enforces this server-side too, but
    // checking here avoids the optimistic-update-then-rollback flicker and
    // gives a clearer message than the raw Postgres error.
    if (approved) {
      const target = members.find((m) => m.id === id)
      if (target && !target.consented_at) {
        setMemberError("This member hasn't finished signing up yet — they still need to complete their profile before you can approve them.")
        return
      }
    }
    setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, approved } : m)))
    const { error } = await supabase.from('profiles').update({ approved }).eq('id', id)
    if (error) { setMemberError(error.message); loadMembers() }
    // Fire-and-forget: a failed email must never block or roll back the
    // approval itself. The member can still find out via "Check my status"
    // on PendingVerification.jsx if this silently fails.
    if (approved && !error) {
      supabase.functions.invoke('send-approval-email', { body: { user_id: id } })
        .catch((e) => console.error('send-approval-email failed:', e))
    }
  }

  // Permanent removal — replaces the old "Revoke" (which only flipped
  // `approved` back to false and left the account and everything they'd
  // posted in place). Deleting the auth user cascades through every
  // person-owned table; see schema-update-44.sql.
  //
  // Goes through the delete-account Edge Function rather than the
  // admin_delete_member() RPC it used to call. Two reasons: the RPC did a raw
  // `delete from auth.users`, which the codebase's own comments elsewhere
  // claim hosted Supabase can silently no-op (the Admin API used by the Edge
  // Function is the documented, reliable route) — and the RPC did no storage
  // cleanup, so an admin-deleted member left their CV, avatar, business photos
  // and job attachments behind in public buckets. Self-deletion and admin
  // deletion now run the exact same code path.
  async function deleteMember(id) {
    const { error } = await adminDeleteAccount(id)
    if (error) { setMemberError(error.message); return }
    setMembers((prev) => prev.filter((m) => m.id !== id))
    loadCounts()
  }

  async function setAdmin(id, is_admin) {
    setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, is_admin } : m)))
    const { error } = await supabase.from('profiles').update({ is_admin }).eq('id', id)
    if (error) { setMemberError(error.message); loadMembers() }
  }

  const pending = useMemo(() => members.filter((m) => !m.approved), [members])
  // Split out because they mean different things to whoever's on duty: one is
  // a decision waiting to be made, the other is someone who wandered off
  // mid-signup and can't be approved yet no matter what you do.
  const readyToApprove = useMemo(() => pending.filter((m) => m.consented_at), [pending])
  const unfinished = pending.length - readyToApprove.length
  const adminCount = useMemo(() => members.filter((m) => m.is_admin).length, [members])
  const needsSetup = !!memberError && (memberError.includes('does not exist') || memberError.includes('function'))

  const activeTab = SUBTABS.find((t) => t.id === subtab)

  return (
    <section className="panel">
      <h2 className="panel-title">Admin</h2>
      <p className="panel-sub">
        Everything needed to run this site. New to the job? Start with the{' '}
        <button type="button" className="linklike" onClick={() => setSubtab('handbook')}>Handbook</button> tab —
        it's the whole role written down.
      </p>

      {/* The point of this strip: someone opening this page should be able to
          tell in one glance whether they need to do anything, without reading
          seven tabs to find out. When there's nothing outstanding it says so
          explicitly rather than showing a row of zeroes that still looks like
          homework. */}
      <AttentionPanel
        loading={loadingMembers}
        readyToApprove={readyToApprove.length}
        unfinished={unfinished}
        openReports={openReportsCount}
        adminCount={adminCount}
        onGo={setSubtab}
      />

      <div className="admin-stats-row">
        <StatCard label="Members" value={members.length} hint="Everyone with an account, approved or not." />
        <StatCard label="Pending" value={pending.length} highlight={pending.length > 0} hint="Signed up but not yet let in." />
        <StatCard label="Open reports" value={openReportsCount} highlight={openReportsCount > 0} hint="Flags from members you haven't ruled on." />
        <StatCard label="Posts" value={counts.posts} hint="Total posts on the feed." />
        <StatCard label="Jobs" value={counts.jobs} hint="Job listings, open and closed." />
        <StatCard label="Events" value={counts.events} hint="Events, past and upcoming." />
        <StatCard label="Businesses" value={counts.businesses} hint="Alumni businesses listed." />
      </div>

      <div className="admin-subtabs" role="tablist" aria-label="Admin sections">
        {SUBTABS.map((t) => (
          <button type="button"
            key={t.id}
            role="tab"
            aria-selected={subtab === t.id}
            className={[
              subtab === t.id ? 'on' : '',
              t.id === 'handbook' ? 'admin-subtab-guide' : '',
            ].filter(Boolean).join(' ')}
            onClick={() => setSubtab(t.id)}
          >
            {t.label}
            {t.id === 'pending' && readyToApprove.length > 0 && (
              <span className="admin-subtab-badge">{readyToApprove.length}</span>
            )}
            {t.id === 'reports' && openReportsCount > 0 && (
              <span className="admin-subtab-badge">{openReportsCount}</span>
            )}
          </button>
        ))}
      </div>

      {activeTab?.help && <p className="admin-tab-help">{activeTab.help}</p>}

      {needsSetup ? (
        <div className="admin-setup-banner">
          <strong>One-time setup needed</strong>
          <p>
            The admin tools (approving members, granting admin access) rely on a database migration
            that hasn't been run yet. Open the Supabase dashboard for this project, go to the
            <strong> SQL Editor</strong>, and run <code>schema-update-8.sql</code> from the project
            folder — it's safe to re-run if you're not sure whether it already went through.
          </p>
          <p className="admin-setup-banner-detail">Error detail: {memberError}</p>
        </div>
      ) : memberError && (
        <p className="form-error">{memberError}</p>
      )}

      {subtab === 'pending' && (
        <PendingList
          loading={loadingMembers}
          pending={pending}
          busyIds={busyIds}
          onApprove={(id) => withBusy(id, () => setApproved(id, true))}
        />
      )}
      {subtab === 'reports' && <ReportsModeration onCountChange={setOpenReportsCount} />}
      {subtab === 'members' && (
        <MembersTable
          loading={loadingMembers}
          members={members}
          myId={session.user.id}
          busyIds={busyIds}
          onSetApproved={(id, approved) => withBusy(id, () => setApproved(id, approved))}
          onSetAdmin={(id, isAdmin) => withBusy(id, () => setAdmin(id, isAdmin))}
          onDeleteMember={(id) => withBusy(id, () => deleteMember(id))}
        />
      )}
      {subtab === 'posts' && <PostsModeration />}
      {subtab === 'jobs' && <JobsModeration />}
      {subtab === 'events' && <EventsModeration />}
      {subtab === 'businesses' && <BusinessesModeration />}
      {subtab === 'activity' && <ActivityLog />}
      {subtab === 'handbook' && <AdminHandbook />}
    </section>
  )
}

/* ---------- "Does anything need me?" ---------- */
function AttentionPanel({ loading, readyToApprove, unfinished, openReports, adminCount, onGo }) {
  if (loading) return null

  const items = []
  if (readyToApprove > 0) {
    items.push({
      key: 'approve',
      text: readyToApprove === 1 ? '1 person is waiting to be approved' : `${readyToApprove} people are waiting to be approved`,
      action: 'Review them',
      tab: 'pending',
    })
  }
  if (openReports > 0) {
    items.push({
      key: 'reports',
      text: openReports === 1 ? '1 report needs a decision' : `${openReports} reports need a decision`,
      action: 'Open reports',
      tab: 'reports',
    })
  }
  // Not urgent, but the thing most likely to end the site: a single admin who
  // loses their phone takes the admin tools with them. Says so once there's
  // someone to promote, rather than nagging on an empty site.
  if (adminCount === 1) {
    items.push({
      key: 'soloadmin',
      text: "You're the only admin — if you lose access, nobody can approve members",
      action: 'Add a second',
      tab: 'members',
      tone: 'soft',
    })
  }

  if (items.length === 0) {
    return (
      <div className="admin-attention clear">
        <span className="admin-attention-icon" aria-hidden="true">✓</span>
        <div>
          <strong>Nothing needs you right now.</strong>
          <p>
            No one's waiting on approval and there are no open reports.
            {unfinished > 0 && ` (${unfinished} ${unfinished === 1 ? 'person has' : 'people have'} started signing up but not finished — nothing to do until they come back.)`}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="admin-attention">
      <strong className="admin-attention-title">Needs your attention</strong>
      <ul>
        {items.map((it) => (
          <li key={it.key} className={it.tone === 'soft' ? 'soft' : undefined}>
            <span>{it.text}</span>
            <button type="button" className="btn ghost small" onClick={() => onGo(it.tab)}>{it.action}</button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ---------- Stat card ---------- */
function StatCard({ label, value, highlight, hint }) {
  return (
    <div className={highlight ? 'admin-stat-card highlight' : 'admin-stat-card'} title={hint}>
      <span className="admin-stat-value">{value === null || value === undefined ? '–' : value}</span>
      <span className="admin-stat-label">{label}</span>
      {hint && <span className="admin-stat-hint">{hint}</span>}
    </div>
  )
}

/* ---------- Pending approvals ---------- */
function PendingList({ loading, pending, onApprove, busyIds }) {
  if (loading) return <LoadingState message="Loading pending signups…" />
  if (pending.length === 0) {
    return (
      <EmptyState
        icon="feed"
        message="No one's waiting on approval."
        subMessage="New signups will show up here as soon as they create an account."
      />
    )
  }

  // Two very different situations sharing one list made it look like half the
  // queue was stuck. Split them: the top group is a decision you can make now,
  // the bottom group is nothing you can act on at all.
  const ready = pending.filter((m) => m.consented_at)
  const unfinished = pending.filter((m) => !m.consented_at)

  return (
    <>
      <div className="admin-guidance">
        <strong>Before you approve someone</strong>
        <p>
          Approving lets them read every member's profile, message anyone privately and post to the
          feed. If you can't place the name, leave them here and ask a classmate first — waiting
          costs them nothing, and there's no way to un-send access to the directory.
        </p>
        <p className="admin-guidance-note">
          They aren't emailed when you approve them, so drop them a message. They can also press
          “Check my status” on the waiting screen themselves.
        </p>
      </div>

      {ready.length > 0 && <h3 className="admin-list-heading">Waiting on your decision</h3>}
      {ready.length > 0 && <PendingRows rows={ready} onApprove={onApprove} busyIds={busyIds} />}

      {unfinished.length > 0 && (
        <>
          <h3 className="admin-list-heading">Started but didn't finish signing up</h3>
          <p className="admin-tab-footnote" style={{ marginTop: 0, marginBottom: 10 }}>
            Nothing to do here — these accounts have no profile yet, usually because someone used
            the Google button and closed the tab. They move up automatically when the person
            returns and finishes.
          </p>
          <PendingRows rows={unfinished} onApprove={onApprove} busyIds={busyIds} />
        </>
      )}
    </>
  )
}

function PendingRows({ rows, onApprove, busyIds }) {
  return (
    <ul className="admin-list">
      {rows.map((m) => (
        <li className="admin-row" key={m.id}>
          <Avatar url={null} name={m.full_name} size={40} />
          <div className="admin-row-info">
            <span className="admin-row-name">{m.full_name || 'Name not set yet'}</span>
            <span className="admin-row-meta">
              {m.email}
              {m.grad_year ? ` · Class of '${String(m.grad_year).slice(-2)}` : ''}
              {m.city ? ` · ${m.city}` : ''}
            </span>
            <span className="admin-row-meta">Signed up {timeAgo(m.created_at)}</span>
          </div>
          {/* consented_at is only set once someone finishes FinishSignup.jsx
              (Google) or the last step of the signup wizard (email) — a
              Google signup can land here with nothing but an email address.
              No point offering Approve until they've actually filled the
              rest of their profile in. */}
          {m.consented_at ? (
            <button type="button" className="btn primary small" onClick={() => onApprove(m.id)} disabled={busyIds?.has(m.id)}>
              {busyIds?.has(m.id) ? 'Approving…' : 'Approve'}
            </button>
          ) : (
            <span className="admin-row-meta admin-row-note">Hasn&rsquo;t finished signing up</span>
          )}
        </li>
      ))}
    </ul>
  )
}

/* ---------- Reports (member-filed flags on posts/jobs/businesses/profiles) ---------- */
const REPORT_ENTITY_LABELS = { post: 'Feed post', job: 'Job listing', business: 'Business listing', profile: 'Member profile' }
const REPORT_ENTITY_PATH = {
  post: (id) => `/feed/${id}`,
  job: (id) => `/jobs/${id}`,
  business: (id) => `/businesses/${id}`,
  profile: (id) => `/people/${id}`,
}
const REPORT_REASON_LABELS = { spam: 'Spam or misleading', harassment: 'Harassment or abuse', inappropriate: 'Inappropriate content', scam: 'Scam or fraud', other: 'Something else' }

function ReportsModeration({ onCountChange }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()
  const showToast = useToast()

  async function load() {
    const { data } = await supabase
      .from('reports')
      .select('id, entity_type, entity_id, reason, details, status, created_at, reporter:profiles!reports_reporter_id_fkey ( full_name )')
      .order('created_at', { ascending: false })
      .limit(200)
    setItems(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function setStatus(id, status) {
    const { error } = await supabase.from('reports').update({ status }).eq('id', id)
    if (error) {
      // Reloading the list on failure made a failed action look like it had
      // worked, right up until the report visibly reappeared. Say so instead.
      showToast("Couldn't update that report — please try again.", { type: 'error' })
      load()
      return
    }
    setItems((prev) => {
      const next = prev.map((r) => (r.id === id ? { ...r, status } : r))
      onCountChange?.(next.filter((r) => r.status === 'open').length)
      return next
    })
  }

  if (loading) return <LoadingState message="Loading reports…" />
  if (items.length === 0) {
    return (
      <EmptyState
        icon="feed"
        message="No reports filed."
        subMessage="When a member flags a post, job, business or profile it lands here. An empty list is a good sign, not a broken page."
      />
    )
  }

  const open = items.filter((r) => r.status === 'open')
  const resolved = items.filter((r) => r.status !== 'open')

  return (
    <>
      {open.length > 0 && (
        <>
          <h3 className="admin-list-heading">Needs review</h3>
          <ReportList items={open} onSetStatus={setStatus} navigate={navigate} />
        </>
      )}
      {resolved.length > 0 && (
        <>
          <h3 className="admin-list-heading">Resolved</h3>
          <ReportList items={resolved} onSetStatus={setStatus} navigate={navigate} />
        </>
      )}
    </>
  )
}

function ReportList({ items, onSetStatus, navigate }) {
  return (
    <ul className="admin-list">
      {items.map((r) => {
        const path = REPORT_ENTITY_PATH[r.entity_type]?.(r.entity_id)
        return (
          <li className="admin-row" key={r.id}>
            <div className="admin-row-info">
              <span className="admin-row-name">
                {REPORT_ENTITY_LABELS[r.entity_type] || r.entity_type}
                <span
                  className={r.status === 'open' ? 'admin-badge pending' : r.status === 'dismissed' ? 'admin-badge' : 'admin-badge approved'}
                  style={{ marginLeft: 8 }}
                >
                  {r.status === 'open' ? 'Open' : r.status === 'dismissed' ? 'Dismissed' : 'Reviewed'}
                </span>
              </span>
              <span className="admin-row-meta">
                {REPORT_REASON_LABELS[r.reason] || r.reason} · Reported by {r.reporter?.full_name || 'a member'} · {timeAgo(r.created_at)}
              </span>
              {r.details && <p className="admin-row-preview">{truncate(r.details)}</p>}
            </div>
            <div className="admin-row-actions">
              {path && (
                <button type="button" className="btn ghost small" onClick={() => navigate(path)} title="Go and look at what was reported">
                  View
                </button>
              )}
              {r.status !== 'reviewed' && (
                <button type="button"
                  className="btn ghost small"
                  onClick={() => onSetStatus(r.id, 'reviewed')}
                  title="You've looked at it and dealt with it. Doesn't delete anything."
                >
                  Mark reviewed
                </button>
              )}
              {r.status !== 'dismissed' && (
                <button type="button"
                  className="btn ghost small"
                  onClick={() => onSetStatus(r.id, 'dismissed')}
                  title="You've looked at it and there's nothing wrong. Doesn't delete anything."
                >
                  Dismiss
                </button>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/* ---------- Members table ---------- */
function MembersTable({ loading, members, myId, onSetApproved, onSetAdmin, onDeleteMember, busyIds }) {
  const [confirmTarget, setConfirmTarget] = useState(null) // { member, action: 'delete' | 'promote' | 'demote' | 'unapprove' }
  const [q, setQ] = useState('')

  if (loading) return <LoadingState message="Loading members…" />

  const needle = q.trim().toLowerCase()
  const shown = members.filter((m) => {
    if (!needle) return true
    return [m.full_name, m.email, m.city].filter(Boolean).join(' ').toLowerCase().includes(needle)
  })

  function askDelete(m) { setConfirmTarget({ member: m, action: 'delete' }) }
  function askPromote(m) { setConfirmTarget({ member: m, action: 'promote' }) }
  function askDemote(m) { setConfirmTarget({ member: m, action: 'demote' }) }
  function askUnapprove(m) { setConfirmTarget({ member: m, action: 'unapprove' }) }

  function runConfirmed() {
    const { member, action } = confirmTarget
    if (action === 'delete') onDeleteMember(member.id)
    if (action === 'promote') onSetAdmin(member.id, true)
    if (action === 'demote') onSetAdmin(member.id, false)
    if (action === 'unapprove') onSetApproved(member.id, false)
    setConfirmTarget(null)
  }

  return (
    <>
      <div className="admin-guidance">
        <strong>Un-approve, or delete?</strong>
        <p>
          <strong>Un-approve</strong> is almost always the right one. It pauses someone's access —
          they see the “waiting to be verified” screen — but keeps their profile, posts and
          messages, and you can let them back in with one click.
        </p>
        <p>
          <strong>Delete account</strong> erases them and everything they've ever posted, for good.
          There is no undo and no backup. Keep it for spam accounts and for people who've asked to
          be removed.
        </p>
        <p className="admin-guidance-note">
          Every action on this tab is recorded in the Activity log with your name against it.
        </p>
      </div>
      <input
        className="search"
        style={{ marginBottom: 14 }}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by name, email, city…"
      />
      {shown.length === 0 ? (
        <EmptyState icon="search" message="No matching members." />
      ) : (
        <ul className="admin-list">
          {shown.map((m) => {
            const isMe = m.id === myId
            const busy = !!busyIds?.has(m.id)
            return (
              <li className="admin-row" key={m.id}>
                <Avatar url={null} name={m.full_name} size={40} />
                <div className="admin-row-info">
                  <span className="admin-row-name">
                    {m.full_name || 'Name not set yet'}
                    {isMe && <span className="person-name-you">You</span>}
                  </span>
                  <span className="admin-row-meta">
                    {m.email}
                    {m.grad_year ? ` · Class of '${String(m.grad_year).slice(-2)}` : ''}
                    {m.city ? ` · ${m.city}` : ''}
                  </span>
                  <span className="admin-row-badges">
                    <span className={m.approved ? 'admin-badge approved' : 'admin-badge pending'}>
                      {m.approved ? 'Approved' : 'Pending'}
                    </span>
                    {m.is_admin && <span className="admin-badge admin">Admin</span>}
                  </span>
                </div>
                <div className="admin-row-actions">
                  {!m.approved ? (
                    m.consented_at ? (
                      <button type="button" className="btn primary small" onClick={() => onSetApproved(m.id, true)} disabled={busy}>
                        {busy ? 'Working…' : 'Approve'}
                      </button>
                    ) : (
                      <button type="button" className="btn primary small" disabled title="Hasn't finished signing up yet">Approve</button>
                    )
                  ) : (
                    // Approving the wrong person used to be irreversible from
                    // here: the only remedy on offer was permanently deleting
                    // their account and everything they'd posted. This puts
                    // them back to Pending instead — they land on the
                    // verification screen, keep their data, and can be
                    // approved again once it's sorted out.
                    <button type="button"
                      className="btn ghost small"
                      onClick={() => askUnapprove(m)}
                      disabled={isMe || busy}
                      title={isMe ? "You can't un-approve yourself" : 'Move back to pending verification'}
                    >
                      Un-approve
                    </button>
                  )}
                  {m.is_admin ? (
                    <button type="button" className="btn ghost small" onClick={() => askDemote(m)} disabled={isMe || busy} title={isMe ? "Can't remove your own admin rights" : undefined}>
                      Remove admin
                    </button>
                  ) : (
                    <button type="button" className="btn ghost small" onClick={() => askPromote(m)} disabled={busy}>Make admin</button>
                  )}
                  {/* Permanent, and there's no undo — the confirm dialog
                      spells out what goes with it. Blocked on your own row;
                      admin_delete_member refuses it server-side too. */}
                  <button type="button"
                    className="btn danger small"
                    onClick={() => askDelete(m)}
                    disabled={isMe || busy}
                    title={isMe ? "Use Settings to delete your own account" : undefined}
                  >
                    {busy ? 'Working…' : 'Delete account'}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {confirmTarget && (
        <ConfirmDialog
          title={
            confirmTarget.action === 'delete' ? 'Delete this account?'
              : confirmTarget.action === 'promote' ? 'Grant admin access?'
              : confirmTarget.action === 'unapprove' ? 'Move back to pending?'
              : 'Remove admin access?'
          }
          message={
            confirmTarget.action === 'delete'
              ? `${confirmTarget.member.full_name || 'This member'} will be removed from the site entirely — their login, profile, posts, comments, job listings, events, RSVPs, business listings and messages all go with it. This can't be undone, and they'd have to sign up and be approved again from scratch.`
              : confirmTarget.action === 'promote'
              ? `${confirmTarget.member.full_name || 'This member'} will be able to approve members and moderate posts, jobs and events — the same access you have.`
              : confirmTarget.action === 'unapprove'
              ? `${confirmTarget.member.full_name || 'This member'} will lose access to the site and go back to the "waiting to be verified" screen. Nothing they've posted is deleted, and you can approve them again at any time.`
              : `${confirmTarget.member.full_name || 'This member'} will lose admin access.`
          }
          confirmLabel={
            confirmTarget.action === 'delete' ? 'Delete account'
              : confirmTarget.action === 'promote' ? 'Make admin'
              : confirmTarget.action === 'unapprove' ? 'Move to pending'
              : 'Remove admin'
          }
          onConfirm={runConfirmed}
          onCancel={() => setConfirmTarget(null)}
        />
      )}
    </>
  )
}

/* ---------- Activity log ---------- */
// Read-only by design. The rows are written by database triggers
// (schema-update-52.sql), never by this component — so the log records what
// actually happened to the data, including changes made straight from the
// Supabase dashboard, and can't be quietly skipped by a bug up here.
const ACTION_TEXT = {
  approve_member:    { verb: 'approved',                 tone: 'good' },
  unapprove_member:  { verb: 'moved back to pending',    tone: 'warn' },
  grant_admin:       { verb: 'made an admin',            tone: 'warn' },
  revoke_admin:      { verb: 'removed admin access from', tone: 'warn' },
  delete_member:     { verb: 'permanently deleted the account of', tone: 'bad' },
  delete_post:       { verb: 'deleted the post',         tone: 'bad' },
  delete_job:        { verb: 'deleted the job listing',  tone: 'bad' },
  delete_event:      { verb: 'deleted the event',        tone: 'bad' },
  delete_business:   { verb: 'deleted the business',     tone: 'bad' },
  feature_business:  { verb: 'featured',                 tone: 'good' },
  unfeature_business:{ verb: 'unfeatured',               tone: 'good' },
  resolve_report:    { verb: 'marked reviewed:',         tone: 'good' },
  dismiss_report:    { verb: 'dismissed:',               tone: 'good' },
  reopen_report:     { verb: 'reopened:',                tone: 'warn' },
}

const ACTIVITY_FILTERS = [
  { id: 'all', label: 'Everything' },
  { id: 'members', label: 'Members', match: (a) => a.target_type === 'member' },
  { id: 'content', label: 'Content removed', match: (a) => a.action.startsWith('delete_') && a.target_type !== 'member' },
  { id: 'reports', label: 'Reports', match: (a) => a.target_type === 'report' },
]

function ActivityLog() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data, error } = await supabase
        .from('admin_actions')
        .select('id, actor_name, action, target_type, target_id, target_label, details, created_at')
        .order('created_at', { ascending: false })
        .limit(300)
      if (!alive) return
      if (error) setError(error.message)
      else setItems(data || [])
      setLoading(false)
    })()
    return () => { alive = false }
  }, [])

  if (loading) return <LoadingState message="Loading the activity log…" />

  // Same reasoning as the setup banner above: a bare error string tells a
  // non-technical admin nothing they can act on.
  if (error) {
    return (
      <div className="admin-setup-banner">
        <strong>The activity log isn't set up yet</strong>
        <p>
          It needs one database update that hasn't been run — <code>schema-update-52.sql</code>,
          in the project folder. Everything else on this page works fine without it; you just
          won't have a record of who did what until it's run.
        </p>
        <p className="admin-setup-banner-detail">Error detail: {error}</p>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon="feed"
        message="Nothing recorded yet."
        subMessage="Approvals, removals and deletions will appear here from now on, with who did them."
      />
    )
  }

  const active = ACTIVITY_FILTERS.find((f) => f.id === filter)
  const shown = active?.match ? items.filter(active.match) : items

  return (
    <>
      <div className="admin-filter-row">
        {ACTIVITY_FILTERS.map((f) => (
          <button type="button"
            key={f.id}
            className={filter === f.id ? 'admin-filter on' : 'admin-filter'}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <EmptyState icon="search" message="Nothing of that kind has happened yet." />
      ) : (
        <ul className="admin-list">
          {shown.map((a) => {
            const meta = ACTION_TEXT[a.action] || { verb: a.action.replace(/_/g, ' '), tone: 'warn' }
            return (
              <li className="admin-row admin-activity-row" key={a.id}>
                <span className={`admin-activity-dot ${meta.tone}`} aria-hidden="true" />
                <div className="admin-row-info">
                  <span className="admin-row-name">
                    <strong>{a.actor_name || 'An admin'}</strong> {meta.verb}{' '}
                    <strong>{a.target_label || 'something'}</strong>
                  </span>
                  <span className="admin-row-meta">
                    {new Date(a.created_at).toLocaleString()} · {timeAgo(a.created_at)}
                  </span>
                  {a.details && <p className="admin-row-preview">{a.details}</p>}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <p className="admin-tab-footnote">
        Showing the {items.length} most recent entries. Nothing here can be edited or removed.
      </p>
    </>
  )
}

/* ---------- Posts moderation ---------- */
function PostsModeration() {
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const showToast = useToast()

  async function load() {
    const { data } = await supabase
      .from('posts')
      .select('id, title, content, created_at, author_id, profiles!posts_author_id_fkey ( full_name )')
      .order('created_at', { ascending: false })
      .limit(100)
    setPosts(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function remove(id) {
    const { error } = await supabase.from('posts').delete().eq('id', id)
    if (error) { showToast('Could not delete post.', { type: 'error' }); return }
    setPosts((prev) => prev.filter((p) => p.id !== id))
  }

  if (loading) return <LoadingState message="Loading posts…" />
  if (posts.length === 0) {
    return (
      <EmptyState
        icon="feed"
        message="Nothing's been posted yet."
        subMessage="Every feed post will appear here, newest first, so you can remove one without hunting for it."
      />
    )
  }

  return (
    <ul className="admin-list">
      {posts.map((p) => (
        <li className="admin-row" key={p.id}>
          <div className="admin-row-info">
            <span className="admin-row-name">{p.title || 'Untitled post'}</span>
            <span className="admin-row-meta">By {p.profiles?.full_name || 'a member'} · {timeAgo(p.created_at)}</span>
            {p.content && p.content !== '(no text)' && (
              <p className="admin-row-preview">{truncate(plainText(p.content))}</p>
            )}
          </div>
          <DeleteButton onConfirm={() => remove(p.id)} label="Delete post" message="This removes the post for everyone. This can't be undone." />
        </li>
      ))}
    </ul>
  )
}

/* ---------- Jobs moderation ---------- */
function JobsModeration() {
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const showToast = useToast()

  async function load() {
    const { data } = await supabase
      .from('jobs')
      .select('id, title, company, location, created_at, posted_by, profiles!jobs_posted_by_fkey ( full_name )')
      .order('created_at', { ascending: false })
      .limit(100)
    setJobs(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function remove(id) {
    const { error } = await supabase.from('jobs').delete().eq('id', id)
    if (error) { showToast('Could not delete job listing.', { type: 'error' }); return }
    setJobs((prev) => prev.filter((j) => j.id !== id))
  }

  if (loading) return <LoadingState message="Loading job listings…" />
  if (jobs.length === 0) {
    return (
      <EmptyState
        icon="jobs"
        message="No job listings yet."
        subMessage="Anything members post to the Jobs board shows up here for removal if it's not genuine."
      />
    )
  }

  return (
    <ul className="admin-list">
      {jobs.map((j) => (
        <li className="admin-row" key={j.id}>
          <div className="admin-row-info">
            <span className="admin-row-name">{j.title} — {j.company}</span>
            <span className="admin-row-meta">
              Posted by {j.profiles?.full_name || 'a member'} · {timeAgo(j.created_at)}
              {j.location ? ` · ${j.location}` : ''}
            </span>
          </div>
          <DeleteButton onConfirm={() => remove(j.id)} label="Delete listing" message="This removes the job listing. This can't be undone." />
        </li>
      ))}
    </ul>
  )
}

/* ---------- Events moderation ---------- */
function EventsModeration() {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const showToast = useToast()

  async function load() {
    const { data } = await supabase
      .from('events')
      .select('id, title, event_date, location, created_by, profiles!events_created_by_fkey ( full_name )')
      .order('event_date', { ascending: false })
      .limit(100)
    setEvents(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function remove(id) {
    const { error } = await supabase.from('events').delete().eq('id', id)
    if (error) { showToast('Could not delete event.', { type: 'error' }); return }
    setEvents((prev) => prev.filter((e) => e.id !== id))
  }

  if (loading) return <LoadingState message="Loading events…" />
  if (events.length === 0) {
    return (
      <EmptyState
        icon="events"
        message="No events yet."
        subMessage="Reunions, socials and anything else members schedule will be listed here."
      />
    )
  }

  return (
    <ul className="admin-list">
      {events.map((e) => (
        <li className="admin-row" key={e.id}>
          <div className="admin-row-info">
            <span className="admin-row-name">{e.title}</span>
            <span className="admin-row-meta">
              {new Date(e.event_date).toLocaleString()} · Posted by {e.profiles?.full_name || 'a member'}
              {e.location ? ` · ${e.location}` : ''}
            </span>
          </div>
          <DeleteButton onConfirm={() => remove(e.id)} label="Delete event" message="This removes the event and everyone's RSVPs. This can't be undone." />
        </li>
      ))}
    </ul>
  )
}

/* ---------- Businesses moderation ---------- */
function BusinessesModeration() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const showToast = useToast()

  async function load() {
    const { data } = await supabase
      .from('businesses')
      .select('id, name, category, city, country, promoted, created_at, profiles!businesses_owner_id_fkey ( full_name )')
      .order('created_at', { ascending: false })
      .limit(200)
    setItems(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function remove(id) {
    const { error } = await supabase.from('businesses').delete().eq('id', id)
    if (error) { showToast('Could not delete business listing.', { type: 'error' }); return }
    setItems((prev) => prev.filter((b) => b.id !== id))
  }

  async function togglePromote(b) {
    const next = !b.promoted
    setItems((prev) => prev.map((x) => (x.id === b.id ? { ...x, promoted: next } : x)))
    const { error } = await supabase.from('businesses').update({ promoted: next }).eq('id', b.id)
    if (error) setItems((prev) => prev.map((x) => (x.id === b.id ? { ...x, promoted: !next } : x)))
  }

  if (loading) return <LoadingState message="Loading businesses…" />
  if (items.length === 0) {
    return (
      <EmptyState
        icon="business"
        message="No businesses listed yet."
        subMessage="Alumni businesses appear here. Featuring one pins it to the top of the public directory."
      />
    )
  }

  return (
    <ul className="admin-list">
      {items.map((b) => (
        <li className="admin-row" key={b.id}>
          <div className="admin-row-info">
            <span className="admin-row-name">
              {b.name}
              {b.promoted && <span className="admin-badge admin" style={{ marginLeft: 8 }}>Featured</span>}
            </span>
            <span className="admin-row-meta">
              {b.category} · Listed by {b.profiles?.full_name || 'a member'}
              {(b.city || b.country) ? ` · ${[b.city, b.country].filter(Boolean).join(', ')}` : ''}
              {' · '}{timeAgo(b.created_at)}
            </span>
          </div>
          <div className="admin-row-actions">
            <button type="button"
              className="btn ghost small"
              onClick={() => togglePromote(b)}
              title={b.promoted ? 'Stop pinning this to the top of the directory' : 'Pin this to the top of the business directory'}
            >
              {b.promoted ? 'Unfeature' : 'Feature'}
            </button>
            <DeleteButton onConfirm={() => remove(b.id)} label="Delete business" message="This removes the business listing. This can't be undone." />
          </div>
        </li>
      ))}
    </ul>
  )
}


