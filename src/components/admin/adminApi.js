// Data access for the admin area. Every write here is still enforced by the
// database (RLS, the prevent_* / require_* triggers on profiles, the Edge
// Functions re-checking is_admin against the caller's token). Nothing in this
// file is a security boundary; it is the one place the admin UI talks to
// Supabase, so error handling and fallbacks live in one spot.
import { supabase, invokeFunction, adminDeleteAccount, deleteStorageFilesFromUrls } from '../../supabaseClient'
import { authRedirectTo } from '../../authRedirect.js'
import { friendlyAuthError } from '../../authErrors.js'

export const PAGE_SIZE = 25

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

// PostgREST: function not in the schema cache / Postgres: undefined function.
// Used to fall back to the pre-schema-update-62 path until it has been run.
export function isMissingFunction(error) {
  if (!error) return false
  return error.code === 'PGRST202' || error.code === '42883'
    || /could not find the function/i.test(error.message || '')
}

// Turns a Supabase/Postgres error into one sentence an admin can act on.
export function describeError(error) {
  if (!error) return ''
  const msg = error.message || String(error)
  if (/failed to fetch|networkerror|load failed/i.test(msg)) return "Couldn't reach the server. Check your connection and try again."
  if (/jwt|refresh_token|invalid_grant/i.test(msg)) return 'Your session has expired. Sign in again and retry.'
  if (/row-level security|permission denied/i.test(msg)) return "The database refused this — your account doesn't have permission."
  if (/only admins?|admins only/i.test(msg)) return 'Only admins can do this.'
  return friendlyAuthError(error) || msg
}

/* ------------------------------------------------------------------ */
/* Members                                                             */
/* ------------------------------------------------------------------ */

// What a member's row means, in one word. Shared by every list so "Pending"
// always means the same thing (the old page used it for two different counts).
export function memberStatus(m) {
  if (!m) return 'pending'
  if (m.approved) return 'approved'
  if (m.declined_at) return 'declined'
  if (!m.consented_at) return 'incomplete'
  if (!m.email_confirmed_at) return 'unconfirmed'
  return 'pending'
}

// "2015–2018", or just the final year for accounts from before start_year
// was asked for (and before schema-update-65 returns it).
export function memberYears(m) {
  if (!m) return ''
  if (m.start_year && m.grad_year) return `${m.start_year}–${m.grad_year}`
  return m.grad_year ? String(m.grad_year) : ''
}

// What's still missing from an application, in the words an admin would use.
// Email and Google signups are meant to produce the same record; this is how
// an admin spots one that didn't (e.g. a Google joiner from before city and
// country were asked for).
export function applicationGaps(m) {
  if (!m) return []
  const gaps = []
  if (!m.consented_at) gaps.push('signup form not finished')
  if (!(m.first_name || '').trim() || !(m.last_name || '').trim()) gaps.push('name')
  if ('start_year' in m && !m.start_year) gaps.push('first year')
  if (!m.grad_year) gaps.push('final year')
  if (!(m.city || '').trim()) gaps.push('city')
  if (!(m.country || '').trim()) gaps.push('country')
  return gaps
}

export const STATUS_LABEL = {
  approved: 'Approved',
  pending: 'Pending',
  unconfirmed: 'Unconfirmed',
  incomplete: 'Signup incomplete',
  declined: 'Declined',
}

// Pre-62 fallback: the old RPC returns everybody at once. Cached briefly so
// paging through the fallback doesn't refetch the whole list every click.
let legacy = null
async function legacyMembers() {
  if (legacy && Date.now() - legacy.at < 30_000) return { data: legacy.rows, error: null }
  const { data, error } = await supabase.rpc('admin_list_members')
  if (error) return { data: null, error }
  legacy = { at: Date.now(), rows: data || [] }
  return { data: legacy.rows, error: null }
}
export function forgetLegacyMembers() { legacy = null }

const FILTER_TEST = {
  all: () => true,
  pending: (m) => memberStatus(m) === 'pending',
  unconfirmed: (m) => !m.approved && !m.declined_at && !m.email_confirmed_at,
  incomplete: (m) => memberStatus(m) === 'incomplete',
  declined: (m) => !!m.declined_at,
  admins: (m) => m.is_admin,
}

export async function fetchMemberCounts() {
  const { data, error } = await supabase.rpc('admin_member_counts')
  if (!error) {
    const row = Array.isArray(data) ? data[0] : data
    const n = (k) => Number(row?.[k] || 0)
    return {
      data: {
        total: n('total'), pending: n('pending'), unconfirmed: n('unconfirmed'),
        incomplete: n('incomplete'), declined: n('declined'), admins: n('admins'),
      },
      error: null,
    }
  }
  if (!isMissingFunction(error)) return { data: null, error }
  const { data: rows, error: e2 } = await legacyMembers()
  if (e2) return { data: null, error: e2 }
  const count = (f) => rows.filter(FILTER_TEST[f]).length
  return {
    data: {
      total: rows.length, pending: count('pending'), unconfirmed: count('unconfirmed'),
      incomplete: count('incomplete'), declined: count('declined'), admins: count('admins'),
    },
    error: null,
  }
}

export async function fetchMembersPage({ filter = 'all', search = '', sort = 'joined', desc = true, page = 0, pageSize = PAGE_SIZE }) {
  const { data, error } = await supabase.rpc('admin_members_page', {
    p_filter: filter, p_search: search || null, p_sort: sort, p_desc: desc,
    p_limit: pageSize, p_offset: page * pageSize,
  })
  if (!error) {
    const rows = data || []
    return { rows, total: rows.length ? Number(rows[0].total_count) : (page === 0 ? 0 : null), error: null }
  }
  if (!isMissingFunction(error)) return { rows: [], total: 0, error }

  const { data: all, error: e2 } = await legacyMembers()
  if (e2) return { rows: [], total: 0, error: e2 }
  const needle = search.trim().toLowerCase()
  let rows = all.filter(FILTER_TEST[filter] || FILTER_TEST.all)
  if (needle) {
    rows = rows.filter((m) => [m.full_name, m.first_name, m.preferred_name, m.last_name, m.email, m.city, m.grad_year]
      .filter(Boolean).join(' ').toLowerCase().includes(needle))
  }
  const dir = desc ? -1 : 1
  const key = sort === 'name' ? (m) => (m.full_name || '').toLowerCase()
    : sort === 'class' ? (m) => m.grad_year ?? (desc ? -Infinity : Infinity)
    : (m) => m.created_at
  rows = [...rows].sort((a, b) => (key(a) > key(b) ? dir : key(a) < key(b) ? -dir : 0))
  return { rows: rows.slice(page * pageSize, (page + 1) * pageSize), total: rows.length, error: null }
}

export async function fetchMember(id) {
  if (!UUID_RE.test(id || '')) return { data: null, error: null }
  const { data, error } = await supabase.rpc('admin_get_member', { p_id: id })
  if (!error) return { data: (Array.isArray(data) ? data[0] : data) || null, error: null }
  if (!isMissingFunction(error)) return { data: null, error }
  forgetLegacyMembers()
  const { data: all, error: e2 } = await legacyMembers()
  if (e2) return { data: null, error: e2 }
  return { data: all.find((m) => m.id === id) || null, error: null }
}

// Activity on or by one member, for the member drawer.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function fetchMemberActivity(id, limit = 12) {
  // The id comes from the URL and is interpolated into an or= filter, so it
  // must be a plain uuid and nothing else.
  if (!UUID_RE.test(id)) return { data: [], error: null }
  return supabase
    .from('admin_actions')
    .select('id, actor_id, actor_name, action, target_type, target_id, target_label, details, created_at')
    .or(`target_id.eq.${id},actor_id.eq.${id}`)
    .order('created_at', { ascending: false })
    .limit(limit)
}

// Every profile write below asks for the row back. RLS and the triggers on
// profiles can turn a refused UPDATE into "0 rows, no error"; without the
// select a refused change would look like a successful one.
async function updateProfile(id, patch) {
  forgetLegacyMembers()
  const { data, error } = await supabase.from('profiles').update(patch).eq('id', id).select('id').maybeSingle()
  if (error) return { error: new Error(describeError(error)) }
  if (!data) return { error: new Error("The change wasn't saved — the account may no longer exist.") }
  return { error: null }
}

// Approve, then send the "you're verified" email. The email never rolls back
// the approval; its outcome is reported separately so the toast can say so.
export async function approveMember(id) {
  const { error } = await updateProfile(id, { approved: true })
  if (error) return { error }
  const { error: mailError } = await invokeFunction('send-approval-email', { user_id: id })
  if (mailError) console.error('send-approval-email failed:', mailError)
  return { error: null, emailSent: !mailError, emailError: mailError }
}

export async function unapproveMember(id) {
  return updateProfile(id, { approved: false })
}

export async function declineMember(id, reason) {
  const { error } = await updateProfile(id, { declined_at: new Date().toISOString(), declined_reason: reason || '' })
  if (error) return { error }
  const { error: mailError } = await invokeFunction('send-member-email', { kind: 'declined', user_id: id, reason: reason || '' })
  if (mailError) console.error('send-member-email (declined) failed:', mailError)
  return { error: null, emailSent: !mailError, emailError: mailError }
}

export async function undoDecline(id) {
  return updateProfile(id, { declined_at: null, declined_reason: '' })
}

export async function setMemberAdmin(id, isAdmin) {
  return updateProfile(id, { is_admin: isAdmin })
}

export async function deleteMember(id) {
  forgetLegacyMembers()
  const { error } = await adminDeleteAccount(id)
  return { error: error ? new Error(error.message) : null }
}

// Supabase's own confirmation email, through the member-facing /resend
// endpoint. If Turnstile is switched on for the project, GoTrue requires a
// captcha token here exactly as it does on signup — the caller collects one.
export async function resendConfirmation(email, captchaToken) {
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: authRedirectTo(), ...(captchaToken ? { captchaToken } : {}) },
  })
  return { error: error ? new Error(friendlyAuthError(error)) : null }
}

/* ------------------------------------------------------------------ */
/* Content (posts, jobs, events, businesses)                          */
/* ------------------------------------------------------------------ */

export const CONTENT_TYPES = {
  post: {
    label: 'Post', plural: 'Posts', table: 'posts',
    select: 'id, title, content, image_urls, video_url, created_at, author_id, author:profiles!posts_author_id_fkey ( full_name )',
    searchCols: ['title', 'content'],
    path: (id) => `/feed/${id}`,
  },
  job: {
    label: 'Job', plural: 'Jobs', table: 'jobs',
    select: 'id, title, company, location, closing_date, logo_url, attachment_url, created_at, posted_by, author:profiles!jobs_posted_by_fkey ( full_name )',
    searchCols: ['title', 'company'],
    path: (id) => `/jobs/${id}`,
  },
  event: {
    label: 'Event', plural: 'Events', table: 'events',
    select: 'id, title, event_date, location, image_url, created_at, created_by, author:profiles!events_created_by_fkey ( full_name )',
    searchCols: ['title', 'location'],
    path: (id) => `/events/${id}`,
  },
  business: {
    label: 'Business', plural: 'Businesses', table: 'businesses',
    select: 'id, name, category, city, country, promoted, logo_url, cover_image_url, created_at, owner_id, author:profiles!businesses_owner_id_fkey ( full_name )',
    searchCols: ['name', 'category'],
    path: (id) => `/businesses/${id}`,
  },
}

export function contentTitle(type, row) {
  if (!row) return ''
  if (type === 'post') return row.title?.trim() || 'Untitled post'
  if (type === 'job') return [row.title, row.company].filter(Boolean).join(' — ')
  if (type === 'business') return row.name
  return row.title
}

export function contentStatus(type, row) {
  if (type === 'business') return row.promoted ? { key: 'featured', label: 'Featured' } : { key: 'listed', label: 'Listed' }
  if (type === 'event') return new Date(row.event_date) < new Date() ? { key: 'past', label: 'Past' } : { key: 'upcoming', label: 'Upcoming' }
  if (type === 'job') {
    const closed = row.closing_date && new Date(`${row.closing_date}T23:59:59`) < new Date()
    return closed ? { key: 'closed', label: 'Closed' } : { key: 'open', label: 'Open' }
  }
  return { key: 'live', label: 'Published' }
}

// PostgREST's or= filter uses , ( ) as syntax; strip them from the needle
// rather than trying to quote them.
function orIlike(cols, needle) {
  const safe = needle.replace(/[,()*\\%_]/g, ' ').trim()
  if (!safe) return null
  return cols.map((c) => `${c}.ilike.*${safe}*`).join(',')
}

function baseContentQuery(type, { search, head = false }) {
  const def = CONTENT_TYPES[type]
  let q = supabase.from(def.table).select(head ? 'id' : def.select, { count: 'exact', head })
  const or = search ? orIlike(def.searchCols, search) : null
  if (or) q = q.or(or)
  return q
}

// One page of content. For a single type this is a plain ranged query. For
// "all", the newest (page+1)*size rows of each type are merged and the page
// sliced out of that — exact, and cheap at this site's size.
export async function fetchContentPage({ type = 'all', search = '', page = 0, pageSize = PAGE_SIZE }) {
  const types = type === 'all' ? Object.keys(CONTENT_TYPES) : [type]
  const from = type === 'all' ? 0 : page * pageSize
  const to = (page + 1) * pageSize - 1
  const results = await Promise.all(types.map((t) =>
    baseContentQuery(t, { search }).order('created_at', { ascending: false }).range(from, to)
  ))
  const failed = results.find((r) => r.error)
  if (failed) return { rows: [], total: 0, error: failed.error }
  let rows = []
  results.forEach((r, i) => { rows.push(...(r.data || []).map((row) => ({ ...row, _type: types[i] }))) })
  const total = results.reduce((n, r) => n + (r.count || 0), 0)
  if (type === 'all') {
    rows.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
    rows = rows.slice(page * pageSize, (page + 1) * pageSize)
  }
  return { rows, total, error: null }
}

// Removes a piece of content, then (best-effort) the files that belonged to
// it. `.select('id')` turns a silently refused delete into an error.
export async function deleteContent(type, row) {
  const def = CONTENT_TYPES[type]
  if (!def) return { error: new Error('That kind of item can’t be removed from here.') }
  const { data, error } = await supabase.from(def.table).delete().eq('id', row.id).select('id')
  if (error) return { error: new Error(describeError(error)) }
  if (!data || data.length === 0) return { error: new Error('Nothing was removed — it may already have been deleted.') }
  if (type === 'post') {
    if (row.image_urls?.length) deleteStorageFilesFromUrls('post-images', row.image_urls)
    if (row.video_url) deleteStorageFilesFromUrls('post-videos', row.video_url)
  } else if (type === 'event') {
    if (row.image_url) deleteStorageFilesFromUrls('event-images', row.image_url)
  } else if (type === 'business') {
    if (row.logo_url) deleteStorageFilesFromUrls('business-logos', row.logo_url)
    if (row.cover_image_url) deleteStorageFilesFromUrls('business-covers', row.cover_image_url)
  } else if (type === 'job') {
    if (row.logo_url) deleteStorageFilesFromUrls('job-logos', row.logo_url)
    if (row.attachment_url) deleteStorageFilesFromUrls('job-attachments', row.attachment_url)
  }
  return { error: null }
}

export async function setBusinessFeatured(id, promoted) {
  const { data, error } = await supabase.from('businesses').update({ promoted }).eq('id', id).select('id, promoted').maybeSingle()
  if (error) return { error: new Error(describeError(error)) }
  if (!data) return { error: new Error("The change wasn't saved.") }
  return { error: null }
}

/* ------------------------------------------------------------------ */
/* Reports                                                             */
/* ------------------------------------------------------------------ */

export const REPORT_REASON = {
  spam: 'Spam or misleading',
  harassment: 'Harassment or abuse',
  inappropriate: 'Inappropriate content',
  scam: 'Scam or fraud',
  other: 'Something else',
}

export const REPORT_TYPE_LABEL = {
  post: 'Post', job: 'Job listing', business: 'Business', profile: 'Member profile', group_post: 'Group post',
}

const REPORT_SELECT = 'id, entity_type, entity_id, reason, details, status, created_at, reporter:profiles!reports_reporter_id_fkey ( id, full_name )'

export async function fetchReports({ status = 'open', page = 0, pageSize = PAGE_SIZE }) {
  let q = supabase.from('reports').select(REPORT_SELECT, { count: 'exact' })
  q = status === 'open' ? q.eq('status', 'open') : q.neq('status', 'open')
  const { data, error, count } = await q
    .order('created_at', { ascending: false })
    .range(page * pageSize, (page + 1) * pageSize - 1)
  if (error) return { rows: [], total: 0, error }
  const rows = await attachReportTargets(data || [])
  return { rows, total: count || 0, error: null }
}

// Loads what each report points at, so the admin can judge it in place
// instead of leaving the page. One query per type, not one per report.
// A missing target means it has already been removed.
export async function attachReportTargets(reports) {
  const byType = {}
  reports.forEach((r) => { (byType[r.entity_type] ||= new Set()).add(r.entity_id) })
  const found = {}
  await Promise.all(Object.entries(byType).map(async ([type, ids]) => {
    const list = [...ids]
    let res
    if (type === 'profile') {
      res = await supabase.from('profiles').select('id, full_name, avatar_url, grad_year').in('id', list)
    } else if (CONTENT_TYPES[type]) {
      const numeric = list.filter((x) => /^\d+$/.test(x))
      if (numeric.length === 0) return
      res = await supabase.from(CONTENT_TYPES[type].table).select(CONTENT_TYPES[type].select).in('id', numeric)
    } else {
      return
    }
    if (res.error) { found[type] = { error: res.error }; return }
    found[type] = Object.fromEntries((res.data || []).map((row) => [String(row.id), row]))
  }))
  return reports.map((r) => {
    const bucket = found[r.entity_type]
    if (!bucket) return { ...r, target: null, targetError: null }
    if (bucket.error) return { ...r, target: null, targetError: bucket.error }
    return { ...r, target: bucket[String(r.entity_id)] || null, targetError: null }
  })
}

export async function setReportStatus(id, status) {
  const { data, error } = await supabase.from('reports').update({ status }).eq('id', id).select('id').maybeSingle()
  if (error) return { error: new Error(describeError(error)) }
  if (!data) return { error: new Error("The report wasn't updated.") }
  return { error: null }
}

// Remove the reported content and close the report — plus any other open
// reports on the same item, since they're all answered by the removal. The
// report is only resolved once the content is really gone.
export async function removeAndResolve(report) {
  if (report.target) {
    const { error } = await deleteContent(report.entity_type, report.target)
    if (error) return { error }
  }
  const { error } = await supabase.from('reports')
    .update({ status: 'reviewed' })
    .eq('entity_type', report.entity_type)
    .eq('entity_id', report.entity_id)
    .eq('status', 'open')
  if (error) return { error: new Error(`The content was removed, but the report couldn't be closed: ${describeError(error)}`) }
  return { error: null }
}

export async function fetchOpenReportCount() {
  const { count, error } = await supabase.from('reports').select('id', { count: 'exact', head: true }).eq('status', 'open')
  return { count: count || 0, error }
}

/* ------------------------------------------------------------------ */
/* Activity log                                                        */
/* ------------------------------------------------------------------ */

export const ACTION_TEXT = {
  approve_member: 'Approved',
  unapprove_member: 'Moved back to pending',
  decline_member: 'Declined',
  undo_decline: 'Undid decline',
  grant_admin: 'Made admin',
  revoke_admin: 'Removed admin',
  delete_member: 'Deleted account',
  delete_post: 'Deleted post',
  delete_job: 'Deleted job listing',
  delete_event: 'Deleted event',
  delete_business: 'Deleted business',
  feature_business: 'Featured business',
  unfeature_business: 'Unfeatured business',
  resolve_report: 'Resolved report',
  dismiss_report: 'Dismissed report',
  reopen_report: 'Reopened report',
  create_legend: 'Added legend',
  edit_legend: 'Edited legend',
  hide_legend: 'Hid legend',
  show_legend: 'Showed legend',
  delete_legend: 'Deleted legend',
}

export const LOG_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'members', label: 'Members', actions: ['approve_member', 'unapprove_member', 'decline_member', 'undo_decline', 'grant_admin', 'revoke_admin', 'delete_member'] },
  { id: 'content', label: 'Content', actions: ['delete_post', 'delete_job', 'delete_event', 'delete_business', 'feature_business', 'unfeature_business'] },
  { id: 'reports', label: 'Reports', actions: ['resolve_report', 'dismiss_report', 'reopen_report'] },
  { id: 'legends', label: 'Legends', actions: ['create_legend', 'edit_legend', 'hide_legend', 'show_legend', 'delete_legend'] },
]

export async function fetchActivity({ filter = 'all', page = 0, pageSize = 50 }) {
  let q = supabase
    .from('admin_actions')
    .select('id, actor_id, actor_name, action, target_type, target_id, target_label, details, created_at', { count: 'exact' })
  const f = LOG_FILTERS.find((x) => x.id === filter)
  if (f?.actions) q = q.in('action', f.actions)
  const { data, error, count } = await q
    .order('created_at', { ascending: false })
    .range(page * pageSize, (page + 1) * pageSize - 1)
  return { rows: data || [], total: count || 0, error }
}
