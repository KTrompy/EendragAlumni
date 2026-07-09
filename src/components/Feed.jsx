import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { Avatar } from './Directory.jsx'
import RichTextEditor from './RichTextEditor.jsx'
import EmptyState from './EmptyState.jsx'
import LoadingState from './LoadingState.jsx'
import DeleteButton from './DeleteButton.jsx'
import ProfileModal from './ProfileModal.jsx'
import { useToast } from './Toast.jsx'
import { sanitizeHtml } from '../sanitizeHtml.js'

// Full profile shape needed for the "click a name → open their profile"
// modal — same fields Directory/Jobs pull for the same purpose, so a post
// author or commenter's popup looks exactly as complete as it does
// everywhere else in the app, not a stripped-down version.
const POSTER_FIELDS =
  'id, full_name, avatar_url, grad_year, degree, industry, occupation, company, city, country, ' +
  'is_current_resident, linkedin_url, bio, expertise, services_offered, business_website, ' +
  'business_categories, availability, geographic_focus, is_open_to_opportunities'

const MAX_IMAGES = 4
const MAX_IMAGE_SIZE = 5 * 1024 * 1024
const MAX_VIDEO_SIZE = 100 * 1024 * 1024
const PAGE_SIZE = 10

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso)) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return new Date(iso).toLocaleDateString()
}

// Does the HTML contain anything besides whitespace/empty tags? Used so an
// empty WYSIWYG editor (e.g. "<div><br></div>") doesn't count as content.
function hasText(html) {
  const div = document.createElement('div')
  div.innerHTML = html || ''
  return div.textContent.trim().length > 0
}

// Strips tags for search matching — post content is stored as sanitized
// HTML, so a plain substring match needs the text content, not the markup.
function plainText(html) {
  const div = document.createElement('div')
  div.innerHTML = html || ''
  return div.textContent || ''
}

function postMatches(p, needle) {
  return (
    (p.title || '').toLowerCase().includes(needle)
    || plainText(p.content).toLowerCase().includes(needle)
    || (p.profiles?.full_name || '').toLowerCase().includes(needle)
  )
}

// Turns a pasted YouTube/Vimeo link into an embeddable player URL, or null
// if it isn't one — used both for the composer's live preview and for
// rendering the video in a published post.
function videoEmbedUrl(raw) {
  if (!raw) return null
  let url
  try { url = new URL(raw.trim()) } catch { return null }

  if (url.hostname.includes('youtu')) {
    let id = ''
    if (url.hostname.includes('youtu.be')) id = url.pathname.slice(1)
    else if (url.pathname.startsWith('/embed/')) id = url.pathname.split('/embed/')[1]
    else if (url.pathname.startsWith('/shorts/')) id = url.pathname.split('/shorts/')[1]
    else id = url.searchParams.get('v') || ''
    id = id.split('/')[0]
    return id ? `https://www.youtube.com/embed/${id}` : null
  }
  if (url.hostname.includes('vimeo.com')) {
    const id = url.pathname.split('/').filter(Boolean)[0]
    return id && /^\d+$/.test(id) ? `https://player.vimeo.com/video/${id}` : null
  }
  return null
}

const POSTS_SELECT = `
  id, title, content, image_urls, video_url, created_at, author_id, pinned,
  profiles!posts_author_id_fkey ( ${POSTER_FIELDS} ),
  likes:post_likes(count),
  comments:post_comments(count)
`

export default function Feed({ session, profile, onMessage }) {
  const [posts, setPosts] = useState([])
  const [pinnedPosts, setPinnedPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [myLikes, setMyLikes] = useState(new Set())
  const [lightbox, setLightbox] = useState(null)
  const [query, setQuery] = useState('')
  const [openProfile, setOpenProfile] = useState(null)
  const composerOpenRef = useRef(null)
  const showToast = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const isAdmin = !!profile?.is_admin

  // Home's "Start sharing" button deep-links here with { openComposer: true }
  // in nav state, so landing on Feed from there opens the composer straight
  // away instead of making someone click "Start a post" a second time.
  // Cleared from history state immediately so navigating back to Feed later
  // (or refreshing) doesn't keep re-popping it open.
  useEffect(() => {
    if (location.state?.openComposer) {
      composerOpenRef.current?.()
      navigate(location.pathname, { replace: true, state: {} })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state])

  // Fetches one PAGE_SIZE page of posts, replacing the list (first load, or
  // a realtime insert/delete elsewhere resetting to the top) or appending to
  // it ("Load more"). Real server-side paging — not just revealing more of
  // an already-capped batch — so the feed no longer has a hard ceiling on
  // how far back you can scroll. Pinned posts are excluded here (and shown
  // in their own section above, see loadPinned) so a pinned post doesn't
  // also take up a slot in the regular chronological stream.
  async function loadPage({ replace = false } = {}) {
    const offset = replace ? 0 : posts.length
    const { data, error } = await supabase
      .from('posts')
      .select(POSTS_SELECT)
      .eq('pinned', false)
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1)
    if (error) { console.error(error); return }
    setPosts((prev) => (replace ? (data || []) : [...prev, ...(data || [])]))
    setHasMore((data || []).length === PAGE_SIZE)
  }

  // Pinned posts are rare and never paginated — fetched once, independent
  // of whatever page of the regular stream is loaded, so a pinned post from
  // months ago still shows up top without needing "Load more" clicked all
  // the way back to it.
  async function loadPinned() {
    const { data, error } = await supabase
      .from('posts')
      .select(POSTS_SELECT)
      .eq('pinned', true)
      .order('created_at', { ascending: false })
    if (error) { console.error(error); return }
    setPinnedPosts(data || [])
  }

  async function loadFirstPage() {
    setLoading(true)
    await Promise.all([loadPage({ replace: true }), loadPinned()])
    const { data: mine } = await supabase
      .from('post_likes')
      .select('post_id')
      .eq('user_id', session.user.id)
    setMyLikes(new Set((mine || []).map((r) => r.post_id)))
    setLoading(false)
  }

  useEffect(() => {
    loadFirstPage()
    // A realtime insert/delete from elsewhere resets back to the freshest
    // page rather than trying to splice into whatever page you'd scrolled
    // to — simplest way to stay consistent without refetching every page.
    const channel = supabase
      .channel('feed')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, () => { loadPage({ replace: true }); loadPinned() })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'posts' }, () => { loadPage({ replace: true }); loadPinned() })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'posts' }, () => loadPinned())
      .subscribe()
    return () => supabase.removeChannel(channel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadMore() {
    setLoadingMore(true)
    await loadPage()
    setLoadingMore(false)
  }

  // Admin-only: pin a post to the top of the feed (or unpin it). Both
  // `posts` and `pinnedPosts` need to reshuffle together since pinning
  // moves a post between the two lists.
  async function togglePin(id, next) {
    const { error } = await supabase.from('posts').update({ pinned: next }).eq('id', id)
    if (error) {
      showToast('Could not update pinned post.', { type: 'error' })
      return
    }
    if (next) {
      setPosts((prev) => prev.filter((p) => p.id !== id))
    } else {
      loadPage({ replace: true })
    }
    loadPinned()
    showToast(next ? 'Post pinned' : 'Post unpinned')
  }

  async function removePost(id) {
    const { error } = await supabase.from('posts').delete().eq('id', id)
    if (error) {
      showToast('Could not delete post.', { type: 'error' })
      return
    }
    setPosts((prev) => prev.filter((p) => p.id !== id))
    showToast('Post deleted')
  }

  async function editPost(id, { title, content }) {
    const updated_at = new Date().toISOString()
    const { error } = await supabase
      .from('posts')
      .update({ title, content, updated_at })
      .eq('id', id)
    if (!error) {
      setPosts((prev) => prev.map((p) => (p.id === id ? { ...p, title, content, updated_at } : p)))
      showToast('Post updated')
    }
    return error
  }

  async function toggleLike(postId) {
    const liked = myLikes.has(postId)
    setMyLikes((prev) => {
      const next = new Set(prev)
      if (liked) next.delete(postId); else next.add(postId)
      return next
    })
    setPosts((prev) => prev.map((p) => {
      if (p.id !== postId) return p
      const cur = p.likes?.[0]?.count ?? 0
      return { ...p, likes: [{ count: cur + (liked ? -1 : 1) }] }
    }))

    if (liked) {
      await supabase.from('post_likes').delete()
        .match({ post_id: postId, user_id: session.user.id })
    } else {
      const { error } = await supabase.from('post_likes')
        .insert({ post_id: postId, user_id: session.user.id })
      if (error) {
        setMyLikes((prev) => { const n = new Set(prev); n.delete(postId); return n })
        setPosts((prev) => prev.map((p) =>
          p.id === postId ? { ...p, likes: [{ count: (p.likes?.[0]?.count ?? 1) - 1 }] } : p
        ))
      }
    }
  }

  const needle = query.trim().toLowerCase()
  const shown = needle
    ? posts.filter((p) => postMatches(p, needle))
    : posts

  // "Who's online" and "Recent members" only fetch a handful of light
  // fields for their own rendering (see WhosOnline/RecentMembersWidget) —
  // clicking through still opens the same full profile modal as everywhere
  // else in the app (author names, comment authors), so this re-fetches the
  // complete POSTER_FIELDS set by id rather than passing the trimmed row
  // straight into ProfileModal.
  async function openMemberProfile(id) {
    const { data } = await supabase.from('profiles').select(POSTER_FIELDS).eq('id', id).single()
    if (data) setOpenProfile(data)
  }

  function postItemProps(p) {
    return {
      post: p,
      session,
      profile,
      isAdmin,
      liked: myLikes.has(p.id),
      onLike: () => toggleLike(p.id),
      onDelete: () => removePost(p.id),
      onEdit: (fields) => editPost(p.id, fields),
      onTogglePin: () => togglePin(p.id, !p.pinned),
      onImageClick: (src) => setLightbox(src),
      onMessage: () => onMessage?.(
        { id: p.author_id, full_name: p.profiles?.full_name },
        'Hi! I saw your post on the feed and wanted to reach out.'
      ),
      onOpenProfile: setOpenProfile,
    }
  }

  return (
    <section className="panel">
      <h2 className="panel-title">Feed</h2>
      <p className="panel-sub">Photos, updates, shoutouts — what the house is up to.</p>

      <div className="feed-layout">
        <div className="feed-main">
          <Composer session={session} profile={profile} onPosted={() => { loadFirstPage(); showToast('Post created') }} openRef={composerOpenRef} />

          <WhosOnline session={session} onOpenProfile={openMemberProfile} />

          {(posts.length > 0 || pinnedPosts.length > 0) && (
            <div className="search-wrap feed-search-wrap">
              <input
                className="search directory-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search posts…"
              />
              {query && (
                <button className="search-clear" onClick={() => setQuery('')} aria-label="Clear search">×</button>
              )}
            </div>
          )}

          {!needle && !loading && pinnedPosts.length > 0 && (
            <div className="pinned-posts-section">
              <h3 className="feed-section-label"><PinIcon /> Pinned {pinnedPosts.length === 1 ? 'Post' : 'Posts'}</h3>
              <ul className="post-list">
                {pinnedPosts.map((p) => <PostItem key={p.id} {...postItemProps(p)} />)}
              </ul>
            </div>
          )}

          {loading ? (
            <LoadingState message="Loading feed…" />
          ) : posts.length === 0 && pinnedPosts.length === 0 && (
            <EmptyState
              icon="feed"
              message="No posts yet."
              subMessage="Be the first Eendragter to break the silence."
              actionLabel={profile?.approved ? 'Write the first post' : undefined}
              onAction={() => composerOpenRef.current?.()}
            />
          )}

          {!loading && posts.length > 0 && shown.length === 0 && (
            <p className="empty small">No posts match "{query}".</p>
          )}

          <ul className="post-list">
            {shown.map((p) => <PostItem key={p.id} {...postItemProps(p)} />)}
          </ul>

          {/* Search only filters what's already loaded — hide the pager while
              searching rather than implying "load more" would surface more
              matches (it fetches by date, not by relevance to the query). */}
          {!needle && hasMore && (
            <div className="load-more-row">
              <button className="btn ghost" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </div>

        <aside className="feed-sidebar">
          <TopJobsWidget onViewAll={() => navigate('/jobs')} />
          <RecentMembersWidget onOpenProfile={openMemberProfile} onViewAll={() => navigate('/directory')} />
        </aside>
      </div>

      {lightbox && (
        <div className="lightbox-backdrop" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" />
        </div>
      )}

      {openProfile && (
        <ProfileModal
          person={openProfile}
          isMe={openProfile.id === session.user.id}
          onClose={() => setOpenProfile(null)}
          onMessage={() => {
            const p = openProfile
            setOpenProfile(null)
            onMessage?.({ id: p.id, full_name: p.full_name }, 'Hi! I saw your post on the feed and wanted to reach out.')
          }}
        />
      )}
    </section>
  )
}

/* ---------- Composer ---------- */
function Composer({ session, profile, onPosted, openRef }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [files, setFiles] = useState([])
  const [videoFile, setVideoFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const fileRef = useRef(null)
  const videoFileRef = useRef(null)
  const showToast = useToast()
  // Text-only draft autosave — closing the modal or a phone locking mid-post
  // used to just lose whatever was typed. Attached photos/video can't
  // round-trip through localStorage, so only title/body are persisted.
  const draftKey = `eendrag-feed-draft-${session.user.id}`
  const draftRestoredRef = useRef(false)

  useEffect(() => {
    if (!open || draftRestoredRef.current) return
    draftRestoredRef.current = true
    try {
      const raw = localStorage.getItem(draftKey)
      if (!raw) return
      const saved = JSON.parse(raw)
      if ((saved.title || '').trim() || hasText(saved.body || '')) {
        setTitle(saved.title || '')
        setBody(saved.body || '')
        showToast('Draft restored')
      }
    } catch {
      // corrupt/unavailable storage — nothing to restore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => {
      try {
        if (!title.trim() && !hasText(body)) {
          localStorage.removeItem(draftKey)
        } else {
          localStorage.setItem(draftKey, JSON.stringify({ title, body }))
        }
      } catch {
        // storage full/unavailable — draft just won't persist this time
      }
    }, 500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, body, open])
  const titleRef = useRef(null)

  const canPost = profile?.approved
  const canSubmit = canPost && (hasText(body) || files.length > 0 || videoFile)

  function openModal() {
    if (!canPost) return
    setOpen(true)
    setTimeout(() => titleRef.current?.focus(), 50)
  }

  function closeModal() {
    if (busy) return
    setOpen(false)
    setTitle(''); setBody(''); setFiles([]); setError(null)
    setVideoFile(null)
  }

  // Lets a CTA outside this component (the Feed empty state) trigger the
  // same "start a post" flow as clicking the prompt.
  if (openRef) openRef.current = () => openModal()

  function pickFiles(e) {
    const chosen = Array.from(e.target.files || [])
    if (chosen.length === 0) return
    for (const f of chosen) {
      if (f.size > MAX_IMAGE_SIZE) {
        setError(`"${f.name}" is over 5MB.`)
        return
      }
    }
    setFiles((prev) => [...prev, ...chosen].slice(0, MAX_IMAGES))
    setError(null)
    e.target.value = ''
  }

  function pickVideo(e) {
    const chosen = e.target.files?.[0]
    if (!chosen) return
    if (chosen.size > MAX_VIDEO_SIZE) {
      setError(`Video is over 100MB.`)
      e.target.value = ''
      return
    }
    setVideoFile(chosen)
    setError(null)
    e.target.value = ''
  }

  function removeFile(idx) {
    setFiles((prev) => prev.filter((_, i) => i !== idx))
  }

  function removeVideo() {
    setVideoFile(null)
  }

  async function uploadAll() {
    const urls = []
    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      const ext = f.name.split('.').pop().toLowerCase()
      const path = `${session.user.id}/${Date.now()}-${i}.${ext}`
      const { error: upErr } = await supabase.storage
        .from('post-images')
        .upload(path, f, { upsert: false, contentType: f.type })
      if (upErr) throw upErr
      const { data } = supabase.storage.from('post-images').getPublicUrl(path)
      urls.push(data.publicUrl)
    }
    return urls
  }

  async function uploadVideo() {
    if (!videoFile) return null
    const ext = videoFile.name.split('.').pop().toLowerCase()
    const path = `${session.user.id}/${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage
      .from('post-videos')
      .upload(path, videoFile, { upsert: false, contentType: videoFile.type })
    if (upErr) throw upErr
    const { data } = supabase.storage.from('post-videos').getPublicUrl(path)
    return data.publicUrl
  }

  async function publish() {
    if (!canSubmit) return
    setBusy(true); setError(null)
    try {
      const image_urls = files.length ? await uploadAll() : []
      const video_url = videoFile ? await uploadVideo() : null
      const { error } = await supabase
        .from('posts')
        .insert({
          author_id: session.user.id,
          title: title.trim(),
          content: hasText(body) ? sanitizeHtml(body) : '(no text)',
          image_urls,
          video_url,
        })
      if (error) {
        setError(error.message.includes('policy')
          ? 'Posting unlocks once your account is approved.'
          : error.message)
      } else {
        setTitle(''); setBody(''); setFiles([])
        setVideoFile(null)
        setOpen(false)
        try { localStorage.removeItem(draftKey) } catch { /* ignore */ }
        onPosted?.()
      }
    } catch (e) {
      setError(e.message || 'Upload failed.')
    } finally {
      setBusy(false)
    }
  }

  /* ---- Collapsed prompt (always visible) ---- */
  const prompt = (
    <div className="composer-prompt" onClick={openModal}>
      <Avatar url={profile?.avatar_url} name={profile?.full_name} size={44} />
      <button className="composer-prompt-input" disabled={!canPost}>
        {canPost ? 'Start a post' : 'Posting unlocks after approval'}
      </button>
    </div>
  )

  function openModalWithPhoto() {
    openModal()
    setTimeout(() => fileRef.current?.click(), 50)
  }

  function openModalWithVideo() {
    openModal()
    setTimeout(() => videoFileRef.current?.click(), 50)
  }

  /* ---- Quick-action buttons below the prompt ---- */
  const quickActions = (
    <div className="composer-quick-actions">
      <button className="composer-quick-btn" onClick={openModalWithPhoto} disabled={!canPost}>
        <PhotoIcon /> Photo
      </button>
      <button className="composer-quick-btn" onClick={openModalWithVideo} disabled={!canPost}>
        <VideoIcon /> Video
      </button>
    </div>
  )

  /* ---- Toolbar inside the modal editor ---- */
  const mediaButtons = (
    <>
      <button
        type="button"
        className="composer-photo-btn"
        onClick={() => fileRef.current?.click()}
        disabled={!canPost || files.length >= MAX_IMAGES}
        title="Add photo"
      >
        <PhotoIcon />
        {files.length > 0 && <span className="composer-photo-count">{files.length}/{MAX_IMAGES}</span>}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        style={{ display: 'none' }}
        onChange={pickFiles}
      />
      <button
        type="button"
        className="composer-photo-btn"
        onClick={() => videoFileRef.current?.click()}
        disabled={!canPost || !!videoFile}
        title="Add video"
      >
        <VideoIcon />
      </button>
      <input
        ref={videoFileRef}
        type="file"
        accept="video/mp4,video/webm,video/quicktime"
        style={{ display: 'none' }}
        onChange={pickVideo}
      />
    </>
  )

  return (
    <>
      <div className="composer-card">
        {prompt}
        {quickActions}
      </div>

      {open && (
        <div className="composer-overlay" onClick={(e) => { if (e.target === e.currentTarget) closeModal() }}>
          <div className="composer-modal">
            {/* Header */}
            <div className="composer-modal-header">
              <div className="composer-modal-user">
                <Avatar url={profile?.avatar_url} name={profile?.full_name} size={44} />
                <span className="composer-modal-name">{profile?.full_name || 'Alumnus'}</span>
              </div>
              <button className="composer-modal-close" onClick={closeModal} aria-label="Close">×</button>
            </div>

            {/* Title */}
            <input
              ref={titleRef}
              className="composer-modal-title"
              placeholder="Post title (optional)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
            />

            {/* Body */}
            <div className="composer-modal-body">
              <RichTextEditor
                value={body}
                onChange={setBody}
                placeholder="What do you want to talk about?"
                toolbarExtra={mediaButtons}
              />
            </div>

            {/* Video preview */}
            {videoFile && (
              <div className="composer-video-row">
                <div className="composer-video-preview-wrap">
                  <video controls width="100%">
                    <source src={URL.createObjectURL(videoFile)} />
                    Your browser doesn't support video playback
                  </video>
                  <button
                    type="button"
                    className="search-clear"
                    onClick={removeVideo}
                    aria-label="Remove video"
                  >×</button>
                </div>
              </div>
            )}

            {/* Image previews */}
            {files.length > 0 && (
              <div className="composer-previews">
                {files.map((f, i) => (
                  <div className="composer-preview" key={i}>
                    <img src={URL.createObjectURL(f)} alt="" />
                    <button onClick={() => removeFile(i)} aria-label="Remove image">×</button>
                  </div>
                ))}
              </div>
            )}

            {error && <p className="form-error" style={{ margin: '8px 20px' }}>{error}</p>}

            {/* Footer */}
            <div className="composer-modal-footer">
              <button className="btn primary" onClick={publish} disabled={busy || !canSubmit}>
                {busy ? 'Posting…' : 'Post'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/* ---------- Post item ---------- */
function PostItem({ post: p, session, profile, isAdmin, liked, onLike, onDelete, onEdit, onTogglePin, onImageClick, onMessage, onOpenProfile }) {
  const [showComments, setShowComments] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState(p.title || '')
  const [editBody, setEditBody] = useState(p.content === '(no text)' ? '' : (p.content || ''))
  const [editBusy, setEditBusy] = useState(false)
  const [editError, setEditError] = useState(null)
  const bodyRef = useRef(null)
  const [needsTruncation, setNeedsTruncation] = useState(false)
  const likeCount = p.likes?.[0]?.count ?? 0
  const commentCount = p.comments?.[0]?.count ?? 0
  const canInteract = profile?.approved
  const images = p.image_urls || []
  const isMine = p.author_id === session.user.id

  function startEdit() {
    setEditTitle(p.title || '')
    setEditBody(p.content === '(no text)' ? '' : (p.content || ''))
    setEditError(null)
    setEditing(true)
  }

  async function saveEdit() {
    if (!hasText(editBody) && images.length === 0 && !p.video_url) {
      setEditError('A post needs some text.')
      return
    }
    setEditBusy(true); setEditError(null)
    const error = await onEdit?.({
      title: editTitle.trim(),
      content: hasText(editBody) ? sanitizeHtml(editBody) : '(no text)',
    })
    setEditBusy(false)
    if (error) setEditError(error.message || 'Could not save changes.')
    else setEditing(false)
  }

  useEffect(() => {
    if (bodyRef.current) {
      setNeedsTruncation(bodyRef.current.scrollHeight > 120)
    }
  }, [p.content])

  const headline = [
    p.profiles?.occupation,
    p.profiles?.grad_year ? "Class of '" + String(p.profiles.grad_year).slice(-2) : '',
  ].filter(Boolean).join(' · ')

  return (
    <li className={p.pinned ? 'post post-pinned' : 'post'}>
      {p.pinned && <span className="post-pinned-tag"><PinIcon /> Pinned Post</span>}
      <div className="post-head">
        <button
          type="button"
          className="post-author-link"
          onClick={() => onOpenProfile?.(p.profiles)}
          aria-label={`Open profile for ${p.profiles?.full_name || 'this alumnus'}`}
        >
          <Avatar url={p.profiles?.avatar_url} name={p.profiles?.full_name} size={48} />
          <div className="post-head-info">
            <span className="post-author">{p.profiles?.full_name || 'Alumnus'}</span>
            <span className="post-meta-line">
              {headline && <span className="post-headline">{headline}</span>}
              {headline && <span className="post-meta-dot">·</span>}
              <span className="post-time">{timeAgo(p.created_at)}</span>
            </span>
          </div>
        </button>
        <div className="post-owner-actions">
          {isAdmin && !editing && (
            <button
              type="button"
              className="icon-btn-delete post-delete-btn"
              onClick={onTogglePin}
              aria-label={p.pinned ? 'Unpin post' : 'Pin post'}
              title={p.pinned ? 'Unpin post' : 'Pin post to top of feed'}
            >
              <PinIcon />
            </button>
          )}
          {isMine && !editing && (
            <>
              <button type="button" className="icon-btn-delete post-delete-btn" onClick={startEdit} aria-label="Edit post" title="Edit post">
                <EditIcon />
              </button>
              <DeleteButton
                onConfirm={onDelete}
                label="Delete post"
                message="This can't be undone."
                className="icon-btn-delete post-delete-btn delete-danger"
              />
            </>
          )}
        </div>
      </div>

      {editing ? (
        <div className="post-edit-form">
          <input
            className="composer-modal-title"
            style={{ padding: '10px 0' }}
            placeholder="Post title (optional)"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            maxLength={200}
          />
          <RichTextEditor value={editBody} onChange={setEditBody} placeholder="What do you want to talk about?" />
          {editError && <p className="form-error">{editError}</p>}
          <div className="btn-row" style={{ padding: '10px 0 0' }}>
            <button className="btn ghost" onClick={() => setEditing(false)} disabled={editBusy}>Cancel</button>
            <button className="btn primary" onClick={saveEdit} disabled={editBusy}>
              {editBusy ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      ) : (
        <>
          {p.title && <h3 className="post-title">{p.title}{p.updated_at && <span className="edited-tag">edited</span>}</h3>}
          {p.content && p.content !== '(no text)' && (
            <div className="post-body-wrap">
              <div
                ref={bodyRef}
                className={`post-body rendered-html${!expanded && needsTruncation ? ' truncated' : ''}`}
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(p.content) }}
              />
              {needsTruncation && !expanded && (
                <button className="post-see-more" onClick={() => setExpanded(true)}>…see more</button>
              )}
            </div>
          )}
        </>
      )}

      {p.video_url && (
        <div className="post-video">
          <video controls>
            <source src={p.video_url} />
            Your browser doesn't support video playback
          </video>
        </div>
      )}

      {images.length > 0 && (
        <div className={`post-images count-${Math.min(images.length, 4)}`}>
          {images.slice(0, 4).map((src, i) => (
            <img key={i} src={src} alt="" loading="lazy" onClick={() => onImageClick(src)} />
          ))}
        </div>
      )}

      {(likeCount > 0 || commentCount > 0) && (
        <div className="post-stats">
          {likeCount > 0 && (
            <span className="post-stat-item">
              <span className="post-stat-dot like" />
              {likeCount} {likeCount === 1 ? 'like' : 'likes'}
            </span>
          )}
          {commentCount > 0 && (
            <span className="post-stat-item" onClick={() => setShowComments(true)} style={{ cursor: 'pointer' }}>
              {commentCount} {commentCount === 1 ? 'comment' : 'comments'}
            </span>
          )}
        </div>
      )}

      <div className="post-actions">
        <button
          className={liked ? 'post-action liked' : 'post-action'}
          onClick={onLike}
          disabled={!canInteract}
          title={canInteract ? (liked ? 'Unlike' : 'Like') : 'Liking unlocks after approval'}
        >
          <HeartIcon filled={liked} /> Like
        </button>
        <button
          className="post-action"
          onClick={() => setShowComments((s) => !s)}
        >
          <CommentIcon /> Comment
        </button>
        {p.author_id !== session.user.id && (
          <button
            className="post-action"
            onClick={onMessage}
            disabled={!canInteract}
            title={canInteract ? 'Message the author' : 'Messaging unlocks after approval'}
          >
            <MessageIcon /> Message
          </button>
        )}
      </div>

      {showComments && (
        <Comments postId={p.id} session={session} profile={profile} onOpenProfile={onOpenProfile} />
      )}
    </li>
  )
}

/* ---------- Comments ---------- */
function Comments({ postId, session, profile, onOpenProfile }) {
  const [items, setItems] = useState([])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState(null)
  const canPost = profile?.approved

  async function load() {
    const { data } = await supabase
      .from('post_comments')
      .select(`id, content, created_at, author_id, profiles!post_comments_author_id_fkey ( ${POSTER_FIELDS} )`)
      .eq('post_id', postId)
      .order('created_at', { ascending: true })
    setItems(data || [])
  }

  useEffect(() => { load() }, [postId])

  async function send() {
    if (!draft.trim()) return
    setError(null)
    const { error } = await supabase
      .from('post_comments')
      .insert({ post_id: postId, author_id: session.user.id, content: draft.trim() })
    if (error) {
      setError(error.message.includes('policy')
        ? 'Commenting unlocks once your account is approved.'
        : error.message)
    } else {
      setDraft(''); load()
    }
  }

  async function remove(id) {
    await supabase.from('post_comments').delete().eq('id', id)
    load()
  }

  return (
    <div className="post-comments">
      {items.length === 0 && <p className="empty small">No comments yet.</p>}
      <ul className="comment-list">
        {items.map((c) => (
          <li className="comment" key={c.id}>
            <button
              type="button"
              className="comment-avatar-link"
              onClick={() => onOpenProfile?.(c.profiles)}
              aria-label={`Open profile for ${c.profiles?.full_name || 'this alumnus'}`}
            >
              <Avatar url={c.profiles?.avatar_url} name={c.profiles?.full_name} size={30} />
            </button>
            <div className="comment-body">
              <button
                type="button"
                className="comment-author"
                onClick={() => onOpenProfile?.(c.profiles)}
              >
                {c.profiles?.full_name || 'Alumnus'}
              </button>
              <span className="comment-meta">{timeAgo(c.created_at)}</span>
              {c.author_id === session.user.id && (
                <DeleteButton
                  onConfirm={() => remove(c.id)}
                  label="Delete comment"
                  message="This can't be undone."
                  className="icon-btn-delete small delete-danger"
                />
              )}
              <p className="comment-text">{c.content}</p>
            </div>
          </li>
        ))}
      </ul>
      <div className="comment-form">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder={canPost ? 'Write a comment…' : 'Commenting unlocks after approval'}
          disabled={!canPost}
          maxLength={2000}
        />
        <button className="btn primary small" onClick={send} disabled={!canPost || !draft.trim()}>
          Reply
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
    </div>
  )
}

/* ---------- Who's online ---------- */
// Live presence strip using Supabase Realtime Presence — tracked only while
// the Feed page is mounted (joining/leaving the shared "online-members"
// channel), so "online" here means "currently on the Feed", not "logged in
// somewhere in the app". Simpler to reason about than app-wide presence,
// and it's the page this actually shows on in the reference.
function WhosOnline({ session, onOpenProfile }) {
  const [members, setMembers] = useState([])
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function join() {
      const { data: me } = await supabase
        .from('profiles')
        .select('id, full_name, avatar_url')
        .eq('id', session.user.id)
        .single()
      if (cancelled) return

      const channel = supabase.channel('online-members', {
        config: { presence: { key: session.user.id } },
      })
      channel
        .on('presence', { event: 'sync' }, () => {
          const state = channel.presenceState()
          const list = Object.values(state)
            .map((entries) => entries[0])
            .filter(Boolean)
          setMembers(list)
        })
        .subscribe(async (status) => {
          if (status === 'SUBSCRIBED') {
            await channel.track({
              id: session.user.id,
              full_name: me?.full_name || 'Alumnus',
              avatar_url: me?.avatar_url || null,
              online_at: new Date().toISOString(),
            })
          }
        })

      return () => supabase.removeChannel(channel)
    }
    const cleanupPromise = join()
    return () => { cancelled = true; cleanupPromise.then((fn) => fn?.()) }
  }, [session.user.id])

  if (members.length === 0) return null

  const others = members.filter((m) => m.id !== session.user.id)
  const shown = members.slice(0, 9)

  return (
    <div className="whos-online">
      <div className="whos-online-head">
        <span className="whos-online-title">
          <span className="whos-online-dot" /> Who's online · See who's been online recently
        </span>
        {members.length > shown.length && (
          <button className="whos-online-seeall" onClick={() => setShowAll(true)}>See all live members ›</button>
        )}
      </div>
      <div className="whos-online-strip">
        {shown.map((m) => (
          <button
            key={m.id}
            className="whos-online-avatar"
            onClick={() => onOpenProfile?.(m.id)}
            title={m.full_name}
            aria-label={`Open profile for ${m.full_name}`}
          >
            <Avatar url={m.avatar_url} name={m.full_name} size={44} />
          </button>
        ))}
      </div>

      {showAll && (
        <div className="modal-backdrop" onClick={() => setShowAll(false)} role="dialog" aria-modal="true" aria-label="Live members">
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div className="modal-header">
              <h2>Live members ({members.length})</h2>
              <button className="modal-close" onClick={() => setShowAll(false)} aria-label="Close">×</button>
            </div>
            <div className="modal-body">
              <ul className="whos-online-list">
                {members.map((m) => (
                  <li key={m.id}>
                    <button className="whos-online-list-row" onClick={() => { setShowAll(false); onOpenProfile?.(m.id) }}>
                      <Avatar url={m.avatar_url} name={m.full_name} size={36} />
                      <span>{m.full_name}{m.id === session.user.id ? ' (you)' : ''}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ---------- Feed sidebar widgets ---------- */
function TopJobsWidget({ onViewAll }) {
  const [jobs, setJobs] = useState([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    supabase
      .from('jobs')
      .select('id, title, company, location, logo_url')
      .order('created_at', { ascending: false })
      .limit(4)
      .then(({ data }) => { setJobs(data || []); setLoaded(true) })
  }, [])

  if (loaded && jobs.length === 0) return null

  return (
    <div className="feed-widget">
      <div className="feed-widget-head">
        <h3>Top jobs for you</h3>
      </div>
      <ul className="feed-widget-list">
        {jobs.map((j) => (
          <li key={j.id}>
            <button className="feed-widget-row" onClick={onViewAll}>
              {j.logo_url
                ? <img className="feed-widget-logo" src={j.logo_url} alt="" />
                : <span className="feed-widget-logo feed-widget-logo-fallback">{(j.company || '?')[0]}</span>}
              <span className="feed-widget-row-text">
                <strong>{j.title}</strong>
                <span>{j.company}{j.location ? ` · ${j.location}` : ''}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <button className="feed-widget-viewall" onClick={onViewAll}>View jobs</button>
    </div>
  )
}

function RecentMembersWidget({ onOpenProfile, onViewAll }) {
  const [members, setMembers] = useState([])

  useEffect(() => {
    supabase
      .from('profiles')
      .select('id, full_name, avatar_url, occupation, company, approved')
      .eq('approved', true)
      .order('created_at', { ascending: false })
      .limit(5)
      .then(({ data }) => setMembers(data || []))
  }, [])

  if (members.length === 0) return null

  return (
    <div className="feed-widget">
      <div className="feed-widget-head">
        <h3>Recent members</h3>
      </div>
      <ul className="feed-widget-list">
        {members.map((m) => (
          <li key={m.id}>
            <button className="feed-widget-row" onClick={() => onOpenProfile?.(m.id)}>
              <Avatar url={m.avatar_url} name={m.full_name} size={32} />
              <span className="feed-widget-row-text">
                <strong>{m.full_name || 'Alumnus'}</strong>
                {(m.occupation || m.company) && <span>{[m.occupation, m.company].filter(Boolean).join(' @ ')}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <button className="feed-widget-viewall" onClick={onViewAll}>View directory</button>
    </div>
  )
}

/* ---------- Icons ---------- */
function HeartIcon({ filled }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
    </svg>
  )
}
function CommentIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  )
}
function MessageIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </svg>
  )
}
function PhotoIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8a2 2 0 0 1 2-2h1.5l1-1.5h7l1 1.5H18a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  )
}
function EditIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  )
}
function VideoIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="6" width="14" height="12" rx="2" />
      <path d="M16.5 10.5l5-3v9l-5-3z" />
    </svg>
  )
}
function PinIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l1.5 5.5L19 9l-4 3.5L16 18l-4-3-4 3 1-5.5-4-3.5 5.5-1.5z" />
    </svg>
  )
}
