import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import Messages from './Messages.jsx'

// A LinkedIn-style messaging widget: a floating bubble (bottom-right) with
// an unread badge, which expands into a compact chat panel anchored to the
// same corner. Mounted once at the top level of the app so it floats above
// whatever tab you're on, and "Send a message" buttons anywhere in the app
// can pop it open via `initialTarget`.
export default function FloatingMessages({
  session,
  profile,
  open,
  onOpenChange,
  initialTarget,
  initialDraft,
  onTargetConsumed,
  onBrowseDirectory,
}) {
  const [unread, setUnread] = useState(0)
  const panelRef = useRef(null)

  async function refreshUnread() {
    const { data, error } = await supabase.rpc('unread_message_count')
    if (!error) setUnread(data || 0)
  }

  useEffect(() => {
    refreshUnread()
    // Broad subscription (not scoped to a single conversation) so the badge
    // updates the moment any new message lands, even for threads that
    // aren't currently open.
    const channel = supabase
      .channel('unread-messages-badge')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, refreshUnread)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [])

  // "Send a message" elsewhere in the app hands us a target profile — pop
  // the panel open to receive it.
  useEffect(() => {
    if (initialTarget) onOpenChange(true)
  }, [initialTarget, onOpenChange])

  // Close the panel when clicking anywhere outside it.
  useEffect(() => {
    if (!open) return
    function handleClickOutside(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        onOpenChange(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open, onOpenChange])

  // On mobile the panel goes full-screen (see .chat-panel in styles.css) —
  // without this, the page underneath stayed scrollable, so it still felt
  // like a box floating over the page rather than an actual full-screen
  // view. Desktop's panel is a small floating widget, so the page behind
  // it is left scrollable there.
  useEffect(() => {
    if (!open) return
    const mq = window.matchMedia('(max-width: 720px)')
    if (!mq.matches) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prevOverflow }
  }, [open])

  return (
    <>
      {!open && (
        <button className="chat-fab" onClick={() => onOpenChange(true)} aria-label="Open messages">
          <ChatIcon />
          {unread > 0 && (
            <span className="chat-fab-badge">{unread > 99 ? '99+' : unread}</span>
          )}
        </button>
      )}

      {open && (
        <div className="chat-panel" role="dialog" aria-label="Messages" ref={panelRef}>
          <div className="chat-panel-header">
            <span>Messages</span>
            <button className="modal-close" onClick={() => onOpenChange(false)} aria-label="Close messages">×</button>
          </div>
          <div className="chat-panel-body">
            <Messages
              session={session}
              profile={profile}
              initialTarget={initialTarget}
              initialDraft={initialDraft}
              onTargetConsumed={onTargetConsumed}
              onRead={refreshUnread}
              onBrowseDirectory={onBrowseDirectory}
              hideTitle
            />
          </div>
        </div>
      )}
    </>
  )
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  )
}
