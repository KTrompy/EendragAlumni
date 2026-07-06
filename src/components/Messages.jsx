import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import { Avatar } from './Directory.jsx'
import EmptyState from './EmptyState.jsx'

const GROUP_GAP_MS = 5 * 60 * 1000 // new avatar/gap if >5 min since the same sender's last message

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso)) / 1000)
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return new Date(iso).toLocaleDateString()
}

export default function Messages({ session, profile, initialTarget, initialDraft, onTargetConsumed, onRead, onBrowseDirectory, hideTitle }) {
  const [threads, setThreads] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState(null)
  const [threadQuery, setThreadQuery] = useState('')
  const bottomRef = useRef(null)
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

    const { data: recent } = await supabase
      .from('messages')
      .select('conversation_id, content, created_at, sender_id')
      .in('conversation_id', ids)
      .order('created_at', { ascending: false })

    const lastByConv = {}
    for (const m of recent || []) {
      if (!lastByConv[m.conversation_id]) lastByConv[m.conversation_id] = m
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

  useEffect(() => {
    if (!activeId) { setMessages([]); return }
    let cancelled = false

    supabase
      .from('messages')
      .select('id, sender_id, content, created_at')
      .eq('conversation_id', activeId)
      .order('created_at')
      .then(({ data }) => { if (!cancelled) setMessages(data || []) })

    const channel = supabase
      .channel(`conv-${activeId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${activeId}` },
        (payload) => {
          setMessages((m) => [...m, payload.new])
          loadThreads()
          // A message arriving while this thread is the open one counts as
          // read immediately — re-stamp so it doesn't linger in the badge.
          markRead(activeId)
        }
      )
      .subscribe()

    return () => { cancelled = true; supabase.removeChannel(channel) }
  }, [activeId])

  // Opening a thread clears its unread count.
  function markRead(conversationId) {
    supabase.rpc('mark_conversation_read', { conv_id: conversationId }).then(() => onRead?.())
  }
  useEffect(() => {
    if (activeId) markRead(activeId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function send() {
    if (!draft.trim() || !activeId) return
    setError(null)
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
                      ? `${t.lastMessage.sender_id === me ? 'You: ' : ''}${t.lastMessage.content}`
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
                  {active?.other?.grad_year && (
                    <span className="chat-header-sub">Class of {active.other.grad_year}</span>
                  )}
                </div>
              </div>
              <div className="chat-scroll">
                {messages.map((m, i) => {
                  const mine = m.sender_id === me
                  const prev = messages[i - 1]
                  const isGroupStart = !prev
                    || prev.sender_id !== m.sender_id
                    || (new Date(m.created_at) - new Date(prev.created_at)) > GROUP_GAP_MS

                  return (
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
                      <div className={mine ? 'bubble mine' : 'bubble'}>
                        {m.content}
                        <span className="message-time">{timeAgo(m.created_at)}</span>
                      </div>
                    </div>
                  )
                })}
                <div ref={bottomRef} />
              </div>
              <div className="chat-input">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
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
