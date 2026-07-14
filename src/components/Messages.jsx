import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import { Avatar } from './Directory.jsx'
import EmptyState from './EmptyState.jsx'
import ConfirmDialog from './ConfirmDialog.jsx'

const GROUP_GAP_MS = 5 * 60 * 1000 // new avatar/gap if >5 min since the same sender's last message
const PAGE_SIZE = 40 // messages loaded per page — see the load/loadOlder split below
const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏']
// How long a "typing…" indicator stays up after the last keystroke
// broadcast — long enough to survive normal typing pauses, short enough
// that it clears itself if the other person just closes the tab (there's
// no explicit "stopped typing" event, just this expiry).
const TYPING_TIMEOUT_MS = 3000
// Minimum gap between our own outgoing "typing" broadcasts — no need to
// send one on every keystroke.
const TYPING_BROADCAST_THROTTLE_MS = 2000

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso)) / 1000)
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return new Date(iso).toLocaleDateString()
}

// The CSS on .thread-preview already clips overflow with an ellipsis, but
// that only holds while the row stays a well-behaved flex item — a very
// long, space-less run of characters (e.g. a pasted URL) can still push a
// nowrap line wider than its container in some mobile browsers. Truncating
// the string itself guarantees the row never overflows regardless of layout
// context, the same belt-and-braces approach GlobalSearch.jsx uses for its
// preview snippets.
function truncatePreview(text, max = 60) {
  const t = (text || '').trim()
  return t.length > max ? t.slice(0, max).trim() + '…' : t
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
}

// Small "Today / Yesterday / Jul 3" pill shown whenever the conversation
// crosses a calendar day — gives longer threads a modern, scannable rhythm
// instead of one unbroken column of bubbles.
function daySeparatorLabel(iso) {
  const d = new Date(iso)
  const now = new Date()
  if (sameDay(d, now)) return 'Today'
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (sameDay(d, yesterday)) return 'Yesterday'
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  })
}

export default function Messages({ session, profile, initialTarget, initialDraft, onTargetConsumed, onRead, onBrowseDirectory, hideTitle }) {
  const [threads, setThreads] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState(null)
  const [threadQuery, setThreadQuery] = useState('')
  const [hasMoreOlder, setHasMoreOlder] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  // message_id -> [{ user_id, emoji }] — kept as a separate map rather than
  // embedded on each message object, since reactions change independently
  // of the message list itself (no need to re-fetch/re-render every
  // message just because one got a new 👍).
  const [reactionsByMessage, setReactionsByMessage] = useState({})
  const [reactionPickerFor, setReactionPickerFor] = useState(null) // message id, or null
  const [editingId, setEditingId] = useState(null)
  const [editDraft, setEditDraft] = useState('')
  const [deletingId, setDeletingId] = useState(null) // message id pending confirmation
  const [typingOther, setTypingOther] = useState(false)
  const [otherLastReadAt, setOtherLastReadAt] = useState(null)
  const typingTimeoutRef = useRef(null)
  const lastTypingSentRef = useRef(0)
  const channelRef = useRef(null)
  const bottomRef = useRef(null)
  const chatScrollRef = useRef(null)
  // Whether the next `messages` update should auto-scroll to the bottom.
  // True on opening a thread or sending/receiving while already near the
  // bottom; explicitly false when prepending older history, so scrolling up
  // to read past messages doesn't get yanked back down by someone else's
  // new message elsewhere in the thread.
  const shouldAutoScrollRef = useRef(true)
  const me = session.user.id

  async function loadThreads() {
    const { data: mine } = await supabase
      .from('conversation_participants')
      .select('conversation_id')
      .eq('user_id', me)
    const ids = (mine || []).map((r) => r.conversation_id)
    if (ids.length === 0) { setThreads([]); return }

    const { data: others } = await supabase
      .from('conversation_participants')
      .select('conversation_id, profiles!conversation_participants_user_id_fkey ( id, full_name, grad_year, avatar_url )')
      .in('conversation_id', ids)
      .neq('user_id', me)

    // Server-side "one row per conversation" via last_messages_for_conversations
    // (see schema-update-29.sql) — the old version fetched every message in
    // every one of the user's conversations with no .limit() just to find
    // the latest per thread client-side; a user with 20 conversations of
    // 500 messages each was pulling 10,000 rows to render 20 preview lines.
    const { data: recent } = await supabase.rpc('last_messages_for_conversations', { conv_ids: ids })

    const lastByConv = {}
    for (const m of recent || []) {
      lastByConv[m.conversation_id] = m
    }

    const built = (others || []).map((r) => ({
      conversation_id: r.conversation_id,
      other: r.profiles,
      lastMessage: lastByConv[r.conversation_id] || null,
    }))
    built.sort((a, b) => {
      const ta = a.lastMessage ? new Date(a.lastMessage.created_at).getTime() : 0
      const tb = b.lastMessage ? new Date(b.lastMessage.created_at).getTime() : 0
      return tb - ta
    })
    setThreads(built)
  }

  useEffect(() => { loadThreads() }, [])

  useEffect(() => {
    if (!initialTarget) return
    supabase
      .rpc('get_or_create_conversation', { other_user: initialTarget.id })
      .then(({ data, error }) => {
        if (error) {
          setError(
            error.message.includes('approved')
              ? 'Messaging unlocks once your account is approved.'
              : error.message
          )
        } else {
          setActiveId(data)
          if (initialDraft) setDraft(initialDraft)
          loadThreads()
        }
        onTargetConsumed()
      })
  }, [initialTarget])

  async function loadReactionsFor(messageIds) {
    if (!messageIds.length) return
    const { data } = await supabase
      .from('message_reactions')
      .select('message_id, user_id, emoji')
      .in('message_id', messageIds)
    const byMessage = {}
    for (const r of data || []) {
      (byMessage[r.message_id] ||= []).push(r)
    }
    setReactionsByMessage(byMessage)
  }

  useEffect(() => {
    if (!activeId) { setMessages([]); setHasMoreOlder(false); return }
    let cancelled = false
    shouldAutoScrollRef.current = true // always land at the bottom when opening a thread
    setReactionsByMessage({})
    setTypingOther(false)
    setOtherLastReadAt(null)
    setEditingId(null)
    setReactionPickerFor(null)

    // Only the most recent PAGE_SIZE messages load up front — see loadOlder
    // for how earlier history is fetched on demand. Previously this loaded
    // every message in the conversation with no limit at all, so a
    // years-old, thousand-message thread pulled its entire history just to
    // open the panel.
    supabase
      .from('messages')
      .select('id, sender_id, content, created_at, edited_at, deleted_at')
      .eq('conversation_id', activeId)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE)
      .then(({ data }) => {
        if (cancelled) return
        const page = (data || []).slice().reverse()
        setMessages(page)
        setHasMoreOlder((data || []).length === PAGE_SIZE)
        loadReactionsFor(page.map((m) => m.id))
      })

    // The other participant's current last_read_at, to power the "Seen"
    // receipt under our last outgoing message — kept live below via the
    // conversation_participants UPDATE subscription.
    supabase
      .from('conversation_participants')
      .select('last_read_at')
      .eq('conversation_id', activeId)
      .neq('user_id', me)
      .maybeSingle()
      .then(({ data }) => { if (!cancelled && data) setOtherLastReadAt(data.last_read_at) })

    const channel = supabase
      .channel(`conv-${activeId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${activeId}` },
        (payload) => {
          // Auto-scroll for a new message only if we were already near the
          // bottom, or it's our own outgoing message — otherwise someone
          // scrolled up to read earlier messages would get pulled back down
          // every time anyone in the conversation sends something.
          const el = chatScrollRef.current
          const nearBottom = !el || (el.scrollHeight - el.scrollTop - el.clientHeight < 120)
          shouldAutoScrollRef.current = nearBottom || payload.new.sender_id === me
          setMessages((m) => [...m, payload.new])
          loadThreads()
          // A message arriving while this thread is the open one counts as
          // read immediately — re-stamp so it doesn't linger in the badge.
          markRead(activeId)
          // A new message from the other person means they've stopped
          // typing it — clear the indicator immediately rather than
          // waiting out the timeout.
          if (payload.new.sender_id !== me) {
            clearTimeout(typingTimeoutRef.current)
            setTypingOther(false)
          }
        }
      )
      .on(
        // Edits and soft-deletes both land here as an UPDATE — the row's
        // content/edited_at/deleted_at simply get replaced in place.
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${activeId}` },
        (payload) => {
          setMessages((prev) => prev.map((m) => (m.id === payload.new.id ? payload.new : m)))
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'message_reactions' },
        (payload) => {
          setReactionsByMessage((prev) => {
            const existing = prev[payload.new.message_id] || []
            // Guard against double-adding — our own reactions are already
            // applied optimistically in toggleReaction below.
            if (existing.some((r) => r.user_id === payload.new.user_id && r.emoji === payload.new.emoji)) return prev
            return { ...prev, [payload.new.message_id]: [...existing, payload.new] }
          })
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'message_reactions' },
        (payload) => {
          setReactionsByMessage((prev) => {
            const existing = prev[payload.old.message_id]
            if (!existing) return prev
            return {
              ...prev,
              [payload.old.message_id]: existing.filter(
                (r) => !(r.user_id === payload.old.user_id && r.emoji === payload.old.emoji)
              ),
            }
          })
        }
      )
      .on(
        // Fires when the other participant's last_read_at moves forward —
        // i.e. they just opened/scrolled this conversation — so "Seen"
        // appears live instead of only after a refresh.
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'conversation_participants', filter: `conversation_id=eq.${activeId}` },
        (payload) => {
          if (payload.new.user_id === me) return
          setOtherLastReadAt(payload.new.last_read_at)
        }
      )
      .on('broadcast', { event: 'typing' }, (payload) => {
        if (payload.payload?.user_id === me) return
        setTypingOther(true)
        clearTimeout(typingTimeoutRef.current)
        typingTimeoutRef.current = setTimeout(() => setTypingOther(false), TYPING_TIMEOUT_MS)
      })
      .subscribe()

    channelRef.current = channel

    return () => {
      cancelled = true
      clearTimeout(typingTimeoutRef.current)
      channelRef.current = null
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

  // Fetches the next page of earlier history above what's currently loaded,
  // preserving the reader's visual scroll position (rather than jumping)
  // by measuring the scroll container's height before/after prepending.
  async function loadOlder() {
    if (!activeId || messages.length === 0 || loadingOlder) return
    setLoadingOlder(true)
    const el = chatScrollRef.current
    const prevScrollTop = el?.scrollTop ?? 0
    const prevScrollHeight = el?.scrollHeight ?? 0
    const oldestCreatedAt = messages[0].created_at
    const { data } = await supabase
      .from('messages')
      .select('id, sender_id, content, created_at, edited_at, deleted_at')
      .eq('conversation_id', activeId)
      .lt('created_at', oldestCreatedAt)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE)
    const older = (data || []).slice().reverse()
    shouldAutoScrollRef.current = false
    setMessages((m) => [...older, ...m])
    setHasMoreOlder((data || []).length === PAGE_SIZE)
    setLoadingOlder(false)
    requestAnimationFrame(() => {
      if (el) el.scrollTop = prevScrollTop + (el.scrollHeight - prevScrollHeight)
    })
  }

  // Opening a thread clears its unread count.
  function markRead(conversationId) {
    supabase.rpc('mark_conversation_read', { conv_id: conversationId }).then(() => onRead?.())
  }
  useEffect(() => {
    if (activeId) markRead(activeId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

  useEffect(() => {
    if (!shouldAutoScrollRef.current) return
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function send() {
    if (!draft.trim() || !activeId) return
    setError(null)
    clearTimeout(typingTimeoutRef.current)
    const { error } = await supabase
      .from('messages')
      .insert({ conversation_id: activeId, sender_id: me, content: draft.trim() })
    if (error) {
      setError(
        error.message.includes('policy')
          ? 'Messaging unlocks once your account is approved.'
          : error.message
      )
    } else {
      setDraft('')
    }
  }

  // Broadcasts a "typing" ping to the other participant, throttled so it
  // fires at most once every TYPING_BROADCAST_THROTTLE_MS regardless of how
  // fast someone types — there's no value (and real cost, at scale) in a
  // broadcast per keystroke when the receiving end only needs to know
  // "still typing" every couple of seconds.
  function handleTyping() {
    const now = Date.now()
    if (now - lastTypingSentRef.current < TYPING_BROADCAST_THROTTLE_MS) return
    lastTypingSentRef.current = now
    channelRef.current?.send({ type: 'broadcast', event: 'typing', payload: { user_id: me } })
  }

  // Optimistic toggle, same pattern as Feed.jsx's toggleLike — flip the
  // local state immediately, roll back only if the request fails, rather
  // than waiting on a round-trip before a reaction appears to "take."
  async function toggleReaction(messageId, emoji) {
    const mine = (reactionsByMessage[messageId] || []).some((r) => r.user_id === me && r.emoji === emoji)
    setReactionPickerFor(null)
    setReactionsByMessage((prev) => {
      const existing = prev[messageId] || []
      return {
        ...prev,
        [messageId]: mine
          ? existing.filter((r) => !(r.user_id === me && r.emoji === emoji))
          : [...existing, { message_id: messageId, user_id: me, emoji }],
      }
    })
    const { error } = mine
      ? await supabase.from('message_reactions').delete().match({ message_id: messageId, user_id: me, emoji })
      : await supabase.from('message_reactions').insert({ message_id: messageId, user_id: me, emoji })
    if (error) {
      // Roll back on failure (e.g. the message was deleted out from under us).
      setReactionsByMessage((prev) => {
        const existing = prev[messageId] || []
        return {
          ...prev,
          [messageId]: mine
            ? [...existing, { message_id: messageId, user_id: me, emoji }]
            : existing.filter((r) => !(r.user_id === me && r.emoji === emoji)),
        }
      })
    }
  }

  function startEdit(m) {
    setEditingId(m.id)
    setEditDraft(m.content)
    setReactionPickerFor(null)
  }
  function cancelEdit() {
    setEditingId(null)
    setEditDraft('')
  }
  async function saveEdit() {
    if (!editDraft.trim()) return
    const { error } = await supabase.rpc('edit_message', { msg_id: editingId, new_content: editDraft.trim() })
    if (error) {
      setError(error.message)
    } else {
      setEditingId(null)
      setEditDraft('')
    }
  }

  async function doDeleteMessage(id) {
    setDeletingId(null)
    const { error } = await supabase.rpc('delete_message', { msg_id: id })
    if (error) setError(error.message)
  }

  // Closes an open reaction picker on an outside click — same pattern as
  // NotificationBell's dropdown.
  useEffect(() => {
    if (!reactionPickerFor) return
    function onClick(e) {
      if (!e.target.closest('.reaction-picker') && !e.target.closest('.message-hover-actions')) {
        setReactionPickerFor(null)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [reactionPickerFor])

  // Groups a message's flat reaction rows into one pill per emoji (with a
  // count and whether *I* reacted with it), rather than rendering one pill
  // per person — five 👍s should read as one "👍 5" pill, not five icons.
  function summarizeReactions(messageId) {
    const map = new Map()
    for (const r of reactionsByMessage[messageId] || []) {
      const cur = map.get(r.emoji) || { emoji: r.emoji, count: 0, mine: false }
      cur.count += 1
      if (r.user_id === me) cur.mine = true
      map.set(r.emoji, cur)
    }
    return [...map.values()]
  }

  // The most recent message I sent, across the whole loaded window — the
  // one "Seen" (if applicable) renders under, same as most DM apps only
  // marking the latest message rather than every prior one individually.
  const lastMineId = [...messages].reverse().find((m) => m.sender_id === me)?.id
  const lastMineMsg = messages.find((m) => m.id === lastMineId)
  const seenLastMine = !!(lastMineMsg && otherLastReadAt && new Date(otherLastReadAt) >= new Date(lastMineMsg.created_at))

  const active = threads.find((t) => t.conversation_id === activeId)
  const needle = threadQuery.trim().toLowerCase()
  const filteredThreads = needle
    ? threads.filter((t) => (t.other?.full_name || '').toLowerCase().includes(needle))
    : threads

  // On mobile the panel shows either the list or the conversation, not
  // both. `activeId` also flips the view; the back button clears it.
  const view = activeId ? 'chat' : 'list'

  return (
    <section className="panel messages-panel" data-view={view}>
      {!hideTitle && <h2 className="panel-title">Messages</h2>}
      {error && <p className="form-error">{error}</p>}
      <div className="messages-layout">
        <aside className="thread-list">
          <div className="thread-list-header">Chats</div>
          {threads.length > 0 && (
            <div className="thread-search-wrap">
              <span className="thread-search-icon" aria-hidden="true">
                <SearchIcon />
              </span>
              <input
                className="thread-search"
                value={threadQuery}
                onChange={(e) => setThreadQuery(e.target.value)}
                placeholder="Search conversations…"
              />
            </div>
          )}

          <div className="thread-list-scroll">
            {threads.length === 0 && (
              <EmptyState
                icon="feed"
                message="No conversations yet."
                subMessage="Find someone in the directory and hit Message."
                actionLabel={onBrowseDirectory ? 'Browse the directory' : undefined}
                onAction={onBrowseDirectory}
              />
            )}

            {threads.length > 0 && filteredThreads.length === 0 && (
              <p className="empty small">No conversations match "{threadQuery}".</p>
            )}

            {filteredThreads.map((t) => (
              <button
                key={t.conversation_id}
                className={t.conversation_id === activeId ? 'thread active' : 'thread'}
                onClick={() => setActiveId(t.conversation_id)}
              >
                <Avatar url={t.other?.avatar_url} name={t.other?.full_name} size={44} />
                <div className="thread-text">
                  <div className="thread-row-1">
                    <span className="thread-name">
                      {t.other?.full_name || 'Alumnus'}
                      {t.other?.grad_year && <span className="thread-year"> ’{String(t.other.grad_year).slice(-2)}</span>}
                    </span>
                    {t.lastMessage && <span className="thread-time">{timeAgo(t.lastMessage.created_at)}</span>}
                  </div>
                  <div className="thread-preview">
                    {t.lastMessage
                      ? `${t.lastMessage.sender_id === me ? 'You: ' : ''}${truncatePreview(t.lastMessage.content)}`
                      : 'Say hello 👋'}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </aside>

        <div className="chat">
          {!activeId ? (
            <div className="chat-empty-centered">
              <EmptyState
                icon="feed"
                message="Select a conversation to start chatting."
                subMessage="Or browse the directory to start a new one."
                actionLabel={onBrowseDirectory ? 'Browse the directory' : undefined}
                onAction={onBrowseDirectory}
              />
            </div>
          ) : (
            <>
              <div className="chat-header">
                <button
                  className="chat-back"
                  onClick={() => setActiveId(null)}
                  aria-label="Back to conversations"
                >
                  <BackIcon />
                </button>
                <Avatar url={active?.other?.avatar_url} name={active?.other?.full_name} size={38} />
                <div className="chat-header-text">
                  <span className="chat-header-name">{active?.other?.full_name || 'Conversation'}</span>
                  {typingOther ? (
                    <span className="chat-header-sub chat-header-typing">typing…</span>
                  ) : active?.other?.grad_year && (
                    <span className="chat-header-sub">Class of {active.other.grad_year}</span>
                  )}
                </div>
              </div>
              <div className="chat-scroll" ref={chatScrollRef}>
                {hasMoreOlder && (
                  <div className="load-more-row">
                    <button className="btn ghost small" onClick={loadOlder} disabled={loadingOlder}>
                      {loadingOlder ? 'Loading…' : 'Load older messages'}
                    </button>
                  </div>
                )}
                {messages.map((m, i) => {
                  const mine = m.sender_id === me
                  const prev = messages[i - 1]
                  const isNewDay = !prev || !sameDay(new Date(m.created_at), new Date(prev.created_at))
                  const isGroupStart = isNewDay
                    || prev.sender_id !== m.sender_id
                    || (new Date(m.created_at) - new Date(prev.created_at)) > GROUP_GAP_MS

                  return [
                    isNewDay && (
                      <div key={`sep-${m.id}`} className="date-separator">
                        <span>{daySeparatorLabel(m.created_at)}</span>
                      </div>
                    ),
                    <div
                      key={m.id}
                      className={[
                        'message-row',
                        mine ? 'mine' : '',
                        isGroupStart ? 'group-start' : '',
                      ].filter(Boolean).join(' ')}
                    >
                      {isGroupStart ? (
                        <Avatar
                          url={mine ? profile?.avatar_url : active?.other?.avatar_url}
                          name={mine ? profile?.full_name : active?.other?.full_name}
                          size={26}
                        />
                      ) : (
                        <span className="avatar-spacer" style={{ width: 26 }} />
                      )}
                      <div className="message-content">
                        {editingId === m.id ? (
                          <div className="message-edit-form">
                            <input
                              className="message-edit-input"
                              value={editDraft}
                              onChange={(e) => setEditDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') saveEdit()
                                if (e.key === 'Escape') cancelEdit()
                              }}
                              maxLength={4000}
                              autoFocus
                            />
                            <div className="message-edit-actions">
                              <button className="btn ghost small" onClick={cancelEdit}>Cancel</button>
                              <button className="btn primary small" onClick={saveEdit} disabled={!editDraft.trim()}>Save</button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className={mine ? 'bubble mine' : 'bubble'}>
                              {m.deleted_at ? (
                                <span className="message-deleted">
                                  {mine ? 'You deleted this message' : 'This message was deleted'}
                                </span>
                              ) : (
                                <>
                                  {m.content}
                                  {/* Invisible twin of the timestamp, inline instead of absolute —
                                      it reserves real layout space so the bubble's auto-width
                                      always fits the timestamp, even on very short messages where
                                      the visible (absolutely-positioned) one would otherwise spill
                                      outside the bubble. */}
                                  <span className="message-time-spacer" aria-hidden="true">
                                    {m.edited_at ? 'edited ' : ''}{timeAgo(m.created_at)}
                                  </span>
                                  <span className="message-time">
                                    {m.edited_at && <span className="message-edited-tag">edited</span>}
                                    {timeAgo(m.created_at)}
                                  </span>
                                </>
                              )}

                              {!m.deleted_at && (
                                <div className="message-hover-actions">
                                  <button
                                    className="message-hover-btn"
                                    onClick={() => setReactionPickerFor(reactionPickerFor === m.id ? null : m.id)}
                                    aria-label="React to this message"
                                    title="React"
                                  >
                                    <ReactIcon />
                                  </button>
                                  {mine && (
                                    <button className="message-hover-btn" onClick={() => startEdit(m)} aria-label="Edit message" title="Edit">
                                      <PencilIcon />
                                    </button>
                                  )}
                                  {mine && (
                                    <button className="message-hover-btn" onClick={() => setDeletingId(m.id)} aria-label="Delete message" title="Delete">
                                      <TrashIcon />
                                    </button>
                                  )}
                                </div>
                              )}

                              {reactionPickerFor === m.id && (
                                <div className={mine ? 'reaction-picker mine' : 'reaction-picker'}>
                                  {QUICK_REACTIONS.map((emoji) => (
                                    <button key={emoji} onClick={() => toggleReaction(m.id, emoji)}>{emoji}</button>
                                  ))}
                                </div>
                              )}
                            </div>

                            {summarizeReactions(m.id).length > 0 && (
                              <div className={mine ? 'message-reactions mine' : 'message-reactions'}>
                                {summarizeReactions(m.id).map(({ emoji, count, mine: iReacted }) => (
                                  <button
                                    key={emoji}
                                    className={iReacted ? 'reaction-pill mine' : 'reaction-pill'}
                                    onClick={() => toggleReaction(m.id, emoji)}
                                    title={iReacted ? 'Remove your reaction' : 'React'}
                                  >
                                    {emoji}{count > 1 ? ` ${count}` : ''}
                                  </button>
                                ))}
                              </div>
                            )}

                            {m.id === lastMineId && seenLastMine && (
                              <div className="message-seen">Seen</div>
                            )}
                          </>
                        )}
                      </div>
                    </div>,
                  ]
                })}
                <div ref={bottomRef} />
              </div>
              <div className="chat-input">
                <input
                  value={draft}
                  onChange={(e) => { setDraft(e.target.value); handleTyping() }}
                  onKeyDown={(e) => e.key === 'Enter' && send()}
                  placeholder={profile?.approved ? 'Type a message…' : 'Messaging unlocks after approval'}
                  disabled={!profile?.approved}
                  maxLength={4000}
                />
                <button
                  className="chat-send"
                  onClick={send}
                  disabled={!profile?.approved || !draft.trim()}
                  aria-label="Send message"
                >
                  <SendIcon />
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {deletingId && (
        <ConfirmDialog
          title="Delete this message?"
          message="This can't be undone."
          confirmLabel="Delete"
          onConfirm={() => doDeleteMessage(deletingId)}
          onCancel={() => setDeletingId(null)}
        />
      )}
    </section>
  )
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

function BackIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  )
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M2.5 21l19-9-19-9v7l13 2-13 2v7z" />
    </svg>
  )
}

function ReactIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M8 14s1.5 2 4 2 4-2 4-2" />
      <line x1="9" y1="9" x2="9.01" y2="9" />
      <line x1="15" y1="9" x2="15.01" y2="9" />
    </svg>
  )
}

function PencilIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  )
}
