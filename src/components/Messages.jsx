import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'

export default function Messages({ session, profile, initialTarget, onTargetConsumed }) {
  const [threads, setThreads] = useState([]) // [{conversation_id, other: profile}]
  const [activeId, setActiveId] = useState(null)
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState(null)
  const bottomRef = useRef(null)
  const me = session.user.id

  async function loadThreads() {
    // conversations I'm in
    const { data: mine } = await supabase
      .from('conversation_participants')
      .select('conversation_id')
      .eq('user_id', me)
    const ids = (mine || []).map((r) => r.conversation_id)
    if (ids.length === 0) { setThreads([]); return }

    // other participants in those conversations
    const { data: others } = await supabase
      .from('conversation_participants')
      .select('conversation_id, profiles ( id, full_name, grad_year )')
      .in('conversation_id', ids)
      .neq('user_id', me)

    setThreads(
      (others || []).map((r) => ({ conversation_id: r.conversation_id, other: r.profiles }))
    )
  }

  useEffect(() => { loadThreads() }, [])

  // If the user clicked "Message" in the directory, open/create that thread
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
          loadThreads()
        }
        onTargetConsumed()
      })
  }, [initialTarget])

  // Load + subscribe to messages for the active thread
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
        (payload) => setMessages((m) => [...m, payload.new])
      )
      .subscribe()

    return () => { cancelled = true; supabase.removeChannel(channel) }
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

  return (
    <section className="panel messages-panel">
      <h2 className="panel-title">Messages</h2>
      {error && <p className="form-error">{error}</p>}
      <div className="messages-layout">
        <aside className="thread-list">
          {threads.length === 0 && (
            <p className="empty small">
              No conversations yet. Find someone in the directory and hit Message.
            </p>
          )}
          {threads.map((t) => (
            <button
              key={t.conversation_id}
              className={t.conversation_id === activeId ? 'thread active' : 'thread'}
              onClick={() => setActiveId(t.conversation_id)}
            >
              {t.other?.full_name || 'Alumnus'}
              {t.other?.grad_year ? ` ’${String(t.other.grad_year).slice(-2)}` : ''}
            </button>
          ))}
        </aside>

        <div className="chat">
          {!activeId ? (
            <p className="empty">Select a conversation.</p>
          ) : (
            <>
              <div className="chat-header">{active?.other?.full_name || 'Conversation'}</div>
              <div className="chat-scroll">
                {messages.map((m) => (
                  <div key={m.id} className={m.sender_id === me ? 'bubble mine' : 'bubble'}>
                    {m.content}
                  </div>
                ))}
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
                <button className="btn primary" onClick={send} disabled={!profile?.approved || !draft.trim()}>
                  Send
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
