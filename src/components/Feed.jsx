import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso)) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return new Date(iso).toLocaleDateString()
}

export default function Feed({ session, profile }) {
  const [posts, setPosts] = useState([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function load() {
    const { data, error } = await supabase
      .from('posts')
      .select('id, content, created_at, author_id, profiles ( full_name, grad_year, occupation )')
      .order('created_at', { ascending: false })
      .limit(50)
    if (!error) setPosts(data)
  }

  useEffect(() => {
    load()
    const channel = supabase
      .channel('feed')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, load)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'posts' }, load)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [])

  async function publish() {
    if (!draft.trim()) return
    setBusy(true); setError(null)
    const { error } = await supabase
      .from('posts')
      .insert({ author_id: session.user.id, content: draft.trim() })
    if (error) {
      setError(
        error.message.includes('policy')
          ? 'Posting unlocks once your account is approved.'
          : error.message
      )
    } else {
      setDraft('')
    }
    setBusy(false)
  }

  async function remove(id) {
    await supabase.from('posts').delete().eq('id', id)
  }

  const canPost = profile?.approved

  return (
    <section className="panel">
      <h2 className="panel-title">House feed</h2>

      <div className="composer">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={canPost ? 'Share news with the house…' : 'Posting unlocks after approval'}
          rows={3}
          disabled={!canPost}
          maxLength={4000}
        />
        <div className="composer-row">
          {error && <span className="form-error">{error}</span>}
          <button className="btn primary" onClick={publish} disabled={busy || !canPost || !draft.trim()}>
            Post
          </button>
        </div>
      </div>

      {posts.length === 0 && (
        <p className="empty">No posts yet. Be the first Eendragter to break the silence.</p>
      )}

      <ul className="post-list">
        {posts.map((p) => (
          <li key={p.id} className="post">
            <div className="post-head">
              <span className="post-author">{p.profiles?.full_name || 'Alumnus'}</span>
              <span className="post-meta">
                {p.profiles?.grad_year ? `’${String(p.profiles.grad_year).slice(-2)}` : ''}
                {p.profiles?.occupation ? ` · ${p.profiles.occupation}` : ''}
                {' · '}{timeAgo(p.created_at)}
              </span>
              {p.author_id === session.user.id && (
                <button className="link-btn small" onClick={() => remove(p.id)}>Delete</button>
              )}
            </div>
            <p className="post-body">{p.content}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}
