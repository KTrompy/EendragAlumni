import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso)) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return new Date(iso).toLocaleDateString()
}

// Where a notification should take you when clicked — matches the tabs
// this app already has (see App.jsx TABS).
const ENTITY_TAB = { post: 'feed', event: 'events', conversation: null, mentoring_match: 'mentoring' }

// Bell + dropdown in the header. Polls once on mount, then stays live via
// Supabase realtime (new row insert) so a badge appears without a refresh —
// this is the app's only cross-feature "something happened" signal, so it
// intentionally covers likes/comments/RSVPs/messages/mentoring match
// requests in one place instead of each feature inventing its own alert.
export default function NotificationBell({ session, onNavigate }) {
  const [items, setItems] = useState([])
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  async function load() {
    const { data } = await supabase
      .from('notifications')
      .select('id, type, entity_type, entity_id, message, read, created_at')
      .order('created_at', { ascending: false })
      .limit(30)
    setItems(data || [])
  }

  useEffect(() => {
    load()
    const channel = supabase
      .channel('notifications:' + session.user.id)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'notifications',
        filter: `user_id=eq.${session.user.id}`,
      }, (payload) => setItems((prev) => [payload.new, ...prev]))
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [session.user.id])

  useEffect(() => {
    if (!open) return
    function onClick(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    function onKey(e) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const unreadCount = items.filter((n) => !n.read).length

  async function markAllRead() {
    const unreadIds = items.filter((n) => !n.read).map((n) => n.id)
    if (unreadIds.length === 0) return
    setItems((prev) => prev.map((n) => ({ ...n, read: true })))
    await supabase.from('notifications').update({ read: true }).in('id', unreadIds)
  }

  async function openNotification(n) {
    if (!n.read) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)))
      supabase.from('notifications').update({ read: true }).eq('id', n.id)
    }
    setOpen(false)
    const tab = ENTITY_TAB[n.entity_type]
    // Pass the entity id along too, so the caller can deep-link straight to
    // the specific post/event this notification is about (e.g. /feed/:id)
    // instead of just landing generically on that tab's top.
    if (tab) onNavigate?.(tab, n.entity_type, n.entity_id)
    else onNavigate?.('messages')
  }

  return (
    <div className="notif-wrap" ref={wrapRef}>
      <button
        className="notif-bell-btn"
        onClick={() => setOpen((o) => !o)}
        aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'}
        aria-expanded={open}
      >
        <BellIcon />
        {unreadCount > 0 && <span className="notif-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
      </button>

      {open && (
        <div className="notif-dropdown" role="dialog" aria-label="Notifications">
          <div className="notif-dropdown-header">
            <h3>Notifications</h3>
            {unreadCount > 0 && (
              <button className="link-btn" onClick={markAllRead}>Mark all read</button>
            )}
          </div>
          <div className="notif-list">
            {items.length === 0 && <p className="empty small">Nothing yet — likes, comments, RSVPs and messages will show up here.</p>}
            {items.map((n) => (
              <button
                key={n.id}
                className={n.read ? 'notif-item' : 'notif-item unread'}
                onClick={() => openNotification(n)}
              >
                <span className="notif-dot" aria-hidden="true" />
                <span className="notif-item-body">
                  <span className="notif-item-message">{n.message}</span>
                  <span className="notif-item-time">{timeAgo(n.created_at)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function BellIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  )
}
