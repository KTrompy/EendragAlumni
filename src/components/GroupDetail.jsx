import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { Avatar } from './Directory.jsx'
import { GroupPlaceholderIcon } from './Groups.jsx'
import RichTextEditor from './RichTextEditor.jsx'
import EmptyState from './EmptyState.jsx'
import LoadingState from './LoadingState.jsx'
import DeleteButton from './DeleteButton.jsx'
import ConfirmDialog from './ConfirmDialog.jsx'
import { useToast } from './Toast.jsx'
import { sanitizeHtml } from '../sanitizeHtml.js'

const POSTER_FIELDS =
  'id, full_name, avatar_url, grad_year, degree, industry, occupation, company, city, country, ' +
  'is_current_resident, linkedin_url, bio, expertise, services_offered, business_website, ' +
  'business_categories, availability, geographic_focus, is_open_to_opportunities'

const GROUP_POSTS_SELECT = `
  id, title, content, image_urls, pinned, created_at, author_id,
  profiles!group_posts_author_id_fkey ( ${POSTER_FIELDS} ),
  likes:group_post_likes(count),
  comments:group_post_comments(count)
`

const MAX_IMAGES = 4
const MAX_IMAGE_SIZE = 5 * 1024 * 1024

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso)) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return new Date(iso).toLocaleDateString()
}
function hasText(html) {
  const div = document.createElement('div')
  div.innerHTML = html || ''
  return div.textContent.trim().length > 0
}

const TABS = [
  { id: 'feed', label: 'Feed' },
  { id: 'members', label: 'Members' },
]

export default function GroupDetail({ session, profile, onMessage }) {
  const { groupId } = useParams()
  const navigate = useNavigate()
  const showToast = useToast()
  const [group, setGroup] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('feed')
  const [myRole, setMyRole] = useState(null) // null = not a member, 'member' | 'admin'
  const [memberCount, setMemberCount] = useState(0)
  const [editingGroup, setEditingGroup] = useState(false)
  const [leavingConfirm, setLeavingConfirm] = useState(false)
  const isSiteAdmin = !!profile?.is_admin

  // Clicking a member/author/commenter anywhere on this page goes to their
  // standalone profile page rather than popping a modal over the group.
  function goToProfile(person) {
    if (person?.id) navigate(`/people/${person.id}`)
  }

  async function loadGroup() {
    setLoading(true)
    const { data: g } = await supabase
      .from('groups')
      .select('id, name, description, cover_image_url, created_by, members:group_members(count)')
      .eq('id', groupId)
      .single()
    setGroup(g || null)
    setMemberCount(g?.members?.[0]?.count ?? 0)
    if (g) {
      const { data: mine } = await supabase
        .from('group_members')
        .select('role')
        .eq('group_id', groupId)
        .eq('user_id', session.user.id)
        .maybeSingle()
      setMyRole(mine?.role || null)
    }
    setLoading(false)
  }

  useEffect(() => { loadGroup() }, [groupId])

  async function join() {
    setMyRole('member')
    setMemberCount((c) => c + 1)
    const { error } = await supabase.from('group_members').insert({ group_id: groupId, user_id: session.user.id })
    if (error) {
      setMyRole(null)
      setMemberCount((c) => c - 1)
      showToast(error.message.includes('policy') ? 'Joining unlocks once your account is approved.' : 'Could not join group.', { type: 'error' })
    }
  }

  async function leave() {
    setLeavingConfirm(false)
    setMyRole(null)
    setMemberCount((c) => Math.max(0, c - 1))
    await supabase.from('group_members').delete().match({ group_id: groupId, user_id: session.user.id })
    showToast('Left group')
  }

  const isMember = !!myRole
  const isGroupAdmin = myRole === 'admin' || isSiteAdmin

  if (loading) return <section className="panel"><LoadingState message="Loading group…" /></section>
  if (!group) {
    return (
      <section className="panel">
        <EmptyState icon="groups" message="Group not found." subMessage="It may have been removed." actionLabel="Back to Groups" onAction={() => navigate('/groups')} />
      </section>
    )
  }

  return (
    <section className="panel group-detail-page">
      <button className="profile-back-btn" onClick={() => navigate('/groups')}>‹ All groups</button>

      <div className="group-hero">
        <div className="group-hero-cover">
          {group.cover_image_url ? <img src={group.cover_image_url} alt="" /> : <GroupPlaceholderIcon />}
        </div>
        <div className="group-hero-body">
          <div>
            <h2 className="group-hero-name">{group.name}</h2>
            {group.description && <p className="group-hero-desc">{group.description}</p>}
            <span className="group-hero-meta">{memberCount} {memberCount === 1 ? 'member' : 'members'}</span>
          </div>
          <div className="group-hero-actions">
            {isMember ? (
              <button className="btn ghost" onClick={() => setLeavingConfirm(true)}>Joined ✓</button>
            ) : (
              <button className="btn primary" onClick={join}>Join group</button>
            )}
            {isGroupAdmin && (
              <button className="header-icon-btn group-hero-settings" onClick={() => setEditingGroup(true)} aria-label="Edit group" title="Edit group">
                <GearIcon />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="group-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'group-tab on' : 'group-tab'} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'feed' && (
        <GroupFeedTab
          groupId={groupId}
          session={session}
          profile={profile}
          isMember={isMember}
          isGroupAdmin={isGroupAdmin}
          onOpenProfile={goToProfile}
          onMessage={onMessage}
        />
      )}
      {tab === 'members' && (
        <GroupMembersTab
          groupId={groupId}
          session={session}
          isGroupAdmin={isGroupAdmin}
          onOpenProfile={goToProfile}
        />
      )}

      {editingGroup && (
        <EditGroupModal
          group={group}
          onClose={() => setEditingGroup(false)}
          onSaved={(updated) => { setGroup((g) => ({ ...g, ...updated })); setEditingGroup(false) }}
        />
      )}

      {leavingConfirm && (
        <ConfirmDialog
          title="Leave group?"
          message="You can always rejoin later."
          confirmLabel="Leave"
          onConfirm={leave}
          onCancel={() => setLeavingConfirm(false)}
        />
      )}

    </section>
  )
}

/* ---------- Edit group modal ---------- */
function EditGroupModal({ group, onClose, onSaved }) {
  const [name, setName] = useState(group.name)
  const [description, setDescription] = useState(group.description || '')
  const [coverImagePreview, setCoverImagePreview] = useState(group.cover_image_url || null)
  const [coverImageFile, setCoverImageFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const fileRef = useRef(null)

  function handlePhotoChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) { setError('Photo must be under 5MB.'); return }
    setCoverImageFile(file)
    setCoverImagePreview(URL.createObjectURL(file))
    setError(null)
  }

  async function submit() {
    if (!name.trim()) { setError('Give the group a name.'); return }
    setBusy(true); setError(null)
    try {
      let cover_image_url = group.cover_image_url

      // Upload new cover image if selected
      if (coverImageFile) {
        const ext = coverImageFile.name.split('.').pop().toLowerCase()
        const path = `${group.id}/${Date.now()}.${ext}`
        const { error: upErr } = await supabase.storage.from('group-covers').upload(path, coverImageFile, { contentType: coverImageFile.type, upsert: true })
        if (upErr) throw upErr
        cover_image_url = supabase.storage.from('group-covers').getPublicUrl(path).data.publicUrl
      }

      const { error: err } = await supabase
        .from('groups')
        .update({ name: name.trim(), description: description.trim(), cover_image_url })
        .eq('id', group.id)
      if (err) throw err
      onSaved({ name: name.trim(), description: description.trim(), cover_image_url })
    } catch (e) {
      setError(e.message || 'Could not save changes.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="Edit group">
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <h2>Edit group</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          <label className="field"><span>Cover photo</span>
            <div className="group-cover-upload">
              <div className="group-cover-preview">
                {coverImagePreview ? (
                  <img src={coverImagePreview} alt="Group cover preview" />
                ) : (
                  <GroupPlaceholderIcon />
                )}
              </div>
              <button type="button" className="btn primary small" onClick={() => fileRef.current?.click()}>
                Change photo
              </button>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} onChange={handlePhotoChange} />
            </div>
          </label>
          <label className="field"><span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </label>
          <label className="field"><span>Description</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={400} />
          </label>
          {error && <p className="form-error">{error}</p>}
        </div>
        <div className="modal-footer">
          <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn primary" onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
        </div>
      </div>
    </div>
  )
}

/* ---------- Feed tab ---------- */
function GroupFeedTab({ groupId, session, profile, isMember, isGroupAdmin, onOpenProfile, onMessage }) {
  const [posts, setPosts] = useState([])
  const [pinnedPosts, setPinnedPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [myLikes, setMyLikes] = useState(new Set())
  const [lightbox, setLightbox] = useState(null)
  const showToast = useToast()

  async function load() {
    setLoading(true)
    const [{ data: regular }, { data: pinned }, { data: mine }] = await Promise.all([
      supabase.from('group_posts').select(GROUP_POSTS_SELECT).eq('group_id', groupId).eq('pinned', false).order('created_at', { ascending: false }),
      supabase.from('group_posts').select(GROUP_POSTS_SELECT).eq('group_id', groupId).eq('pinned', true).order('created_at', { ascending: false }),
      supabase.from('group_post_likes').select('post_id').eq('user_id', session.user.id),
    ])
    setPosts(regular || [])
    setPinnedPosts(pinned || [])
    setMyLikes(new Set((mine || []).map((r) => r.post_id)))
    setLoading(false)
  }

  useEffect(() => {
    load()
    const channel = supabase
      .channel(`group-feed-${groupId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'group_posts', filter: `group_id=eq.${groupId}` }, load)
      .subscribe()
    return () => supabase.removeChannel(channel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId])

  async function removePost(id) {
    const { error } = await supabase.from('group_posts').delete().eq('id', id)
    if (error) { showToast('Could not delete post.', { type: 'error' }); return }
    setPosts((prev) => prev.filter((p) => p.id !== id))
    setPinnedPosts((prev) => prev.filter((p) => p.id !== id))
    showToast('Post deleted')
  }

  async function editPost(id, { title, content }) {
    const updated_at = new Date().toISOString()
    const { error } = await supabase.from('group_posts').update({ title, content, updated_at }).eq('id', id)
    if (!error) load()
    return error
  }

  async function togglePin(id, next) {
    const { error } = await supabase.from('group_posts').update({ pinned: next }).eq('id', id)
    if (error) { showToast('Could not update pinned post.', { type: 'error' }); return }
    load()
    showToast(next ? 'Post pinned' : 'Post unpinned')
  }

  async function toggleLike(postId) {
    const liked = myLikes.has(postId)
    setMyLikes((prev) => { const n = new Set(prev); if (liked) n.delete(postId); else n.add(postId); return n })
    if (liked) {
      await supabase.from('group_post_likes').delete().match({ post_id: postId, user_id: session.user.id })
    } else {
      await supabase.from('group_post_likes').insert({ post_id: postId, user_id: session.user.id })
    }
    load()
  }

  function itemProps(p) {
    return {
      post: p,
      session,
      isAdmin: isGroupAdmin,
      liked: myLikes.has(p.id),
      onLike: () => toggleLike(p.id),
      onDelete: () => removePost(p.id),
      onEdit: (fields) => editPost(p.id, fields),
      onTogglePin: () => togglePin(p.id, !p.pinned),
      onImageClick: (src) => setLightbox(src),
      onMessage: () => onMessage?.({ id: p.author_id, full_name: p.profiles?.full_name }, 'Hi! I saw your post in the group and wanted to reach out.'),
      onOpenProfile,
    }
  }

  return (
    <div className="group-feed-tab">
      {isMember ? (
        <GroupComposer groupId={groupId} session={session} profile={profile} onPosted={load} />
      ) : (
        <p className="empty small">Join this group to post and comment.</p>
      )}

      {!loading && pinnedPosts.length > 0 && (
        <div className="pinned-posts-section">
          <h3 className="feed-section-label"><PinIcon /> Pinned {pinnedPosts.length === 1 ? 'Post' : 'Posts'}</h3>
          <ul className="post-list">{pinnedPosts.map((p) => <GroupPostItem key={p.id} {...itemProps(p)} />)}</ul>
        </div>
      )}

      {loading ? (
        <LoadingState message="Loading posts…" />
      ) : posts.length === 0 && pinnedPosts.length === 0 && (
        <EmptyState icon="feed" message="No posts yet." subMessage={isMember ? 'Be the first to post in this group.' : 'Nothing shared here yet.'} />
      )}

      <ul className="post-list">
        {posts.map((p) => <GroupPostItem key={p.id} {...itemProps(p)} />)}
      </ul>

      {lightbox && (
        <div className="lightbox-backdrop" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" />
        </div>
      )}
    </div>
  )
}

function GroupComposer({ groupId, session, profile, onPosted }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [files, setFiles] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const fileRef = useRef(null)
  const canPost = profile?.approved
  const canSubmit = canPost && (hasText(body) || files.length > 0)

  function pickFiles(e) {
    const chosen = Array.from(e.target.files || [])
    if (chosen.length === 0) return
    for (const f of chosen) {
      if (f.size > MAX_IMAGE_SIZE) { setError(`"${f.name}" is over 5MB.`); return }
    }
    setFiles((prev) => [...prev, ...chosen].slice(0, MAX_IMAGES))
    setError(null)
    e.target.value = ''
  }

  async function publish() {
    if (!canSubmit) return
    setBusy(true); setError(null)
    try {
      const image_urls = []
      for (let i = 0; i < files.length; i++) {
        const f = files[i]
        const ext = f.name.split('.').pop().toLowerCase()
        const path = `${session.user.id}/${Date.now()}-${i}.${ext}`
        const { error: upErr } = await supabase.storage.from('group-post-images').upload(path, f, { contentType: f.type })
        if (upErr) throw upErr
        image_urls.push(supabase.storage.from('group-post-images').getPublicUrl(path).data.publicUrl)
      }
      const { error: insErr } = await supabase.from('group_posts').insert({
        group_id: groupId,
        author_id: session.user.id,
        title: title.trim(),
        content: hasText(body) ? sanitizeHtml(body) : '(no text)',
        image_urls,
      })
      if (insErr) throw insErr
      setTitle(''); setBody(''); setFiles([]); setOpen(false)
      onPosted?.()
    } catch (e) {
      setError(e.message || 'Could not post.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="composer-card">
      <div className="composer-prompt" onClick={() => canPost && setOpen(true)}>
        <Avatar url={profile?.avatar_url} name={profile?.full_name} size={44} />
        <button className="composer-prompt-input" disabled={!canPost}>
          {canPost ? 'Share something with the group' : 'Posting unlocks after approval'}
        </button>
      </div>

      {open && (
        <div className="composer-overlay" onClick={(e) => { if (e.target === e.currentTarget && !busy) setOpen(false) }}>
          <div className="composer-modal">
            <div className="composer-modal-header">
              <div className="composer-modal-user">
                <Avatar url={profile?.avatar_url} name={profile?.full_name} size={44} />
                <span className="composer-modal-name">{profile?.full_name || 'Alumnus'}</span>
              </div>
              <button className="composer-modal-close" onClick={() => !busy && setOpen(false)} aria-label="Close">×</button>
            </div>
            <input
              className="composer-modal-title"
              placeholder="Post title (optional)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
            />
            <div className="composer-modal-body">
              <RichTextEditor
                value={body}
                onChange={setBody}
                placeholder="What do you want to share with the group?"
                toolbarExtra={(
                  <>
                    <button type="button" className="composer-photo-btn" onClick={() => fileRef.current?.click()} disabled={files.length >= MAX_IMAGES} title="Add photo">
                      <PhotoIcon />
                      {files.length > 0 && <span className="composer-photo-count">{files.length}/{MAX_IMAGES}</span>}
                    </button>
                    <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple style={{ display: 'none' }} onChange={pickFiles} />
                  </>
                )}
              />
            </div>
            {files.length > 0 && (
              <div className="composer-previews">
                {files.map((f, i) => (
                  <div className="composer-preview" key={i}>
                    <img src={URL.createObjectURL(f)} alt="" />
                    <button onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))} aria-label="Remove image">×</button>
                  </div>
                ))}
              </div>
            )}
            {error && <p className="form-error" style={{ margin: '8px 20px' }}>{error}</p>}
            <div className="composer-modal-footer">
              <button className="btn primary" onClick={publish} disabled={busy || !canSubmit}>{busy ? 'Posting…' : 'Post'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function GroupPostItem({ post: p, session, isAdmin, liked, onLike, onDelete, onEdit, onTogglePin, onImageClick, onMessage, onOpenProfile }) {
  const [showComments, setShowComments] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState(p.title || '')
  const [editBody, setEditBody] = useState(p.content === '(no text)' ? '' : (p.content || ''))
  const [editBusy, setEditBusy] = useState(false)
  const [editError, setEditError] = useState(null)
  const likeCount = p.likes?.[0]?.count ?? 0
  const commentCount = p.comments?.[0]?.count ?? 0
  const images = p.image_urls || []
  const isMine = p.author_id === session.user.id

  async function saveEdit() {
    if (!hasText(editBody) && images.length === 0) { setEditError('A post needs some text.'); return }
    setEditBusy(true); setEditError(null)
    const error = await onEdit?.({ title: editTitle.trim(), content: hasText(editBody) ? sanitizeHtml(editBody) : '(no text)' })
    setEditBusy(false)
    if (error) setEditError(error.message || 'Could not save changes.')
    else setEditing(false)
  }

  const headline = [
    p.profiles?.occupation,
    p.profiles?.grad_year ? "Class of '" + String(p.profiles.grad_year).slice(-2) : '',
  ].filter(Boolean).join(' · ')

  return (
    <li className={p.pinned ? 'post post-pinned' : 'post'}>
      {p.pinned && <span className="post-pinned-tag"><PinIcon /> Pinned Post</span>}
      <div className="post-head">
        <button type="button" className="post-author-link" onClick={() => onOpenProfile?.(p.profiles)} aria-label={`Open profile for ${p.profiles?.full_name || 'this alumnus'}`}>
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
            <button type="button" className="icon-btn-delete post-delete-btn" onClick={onTogglePin} aria-label={p.pinned ? 'Unpin post' : 'Pin post'} title={p.pinned ? 'Unpin post' : 'Pin post to top'}>
              <PinIcon />
            </button>
          )}
          {isMine && !editing && (
            <button type="button" className="icon-btn-delete post-delete-btn" onClick={() => setEditing(true)} aria-label="Edit post" title="Edit post">
              <EditIcon />
            </button>
          )}
          {(isMine || isAdmin) && !editing && (
            <DeleteButton onConfirm={onDelete} label="Delete post" message="This can't be undone." className="icon-btn-delete post-delete-btn delete-danger" />
          )}
        </div>
      </div>

      {editing ? (
        <div className="post-edit-form">
          <input className="composer-modal-title" style={{ padding: '10px 0' }} placeholder="Post title (optional)" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} maxLength={200} />
          <RichTextEditor value={editBody} onChange={setEditBody} placeholder="What do you want to share?" />
          {editError && <p className="form-error">{editError}</p>}
          <div className="btn-row" style={{ padding: '10px 0 0' }}>
            <button className="btn ghost" onClick={() => setEditing(false)} disabled={editBusy}>Cancel</button>
            <button className="btn primary" onClick={saveEdit} disabled={editBusy}>{editBusy ? 'Saving…' : 'Save changes'}</button>
          </div>
        </div>
      ) : (
        <>
          {p.title && <h3 className="post-title">{p.title}{p.updated_at && <span className="edited-tag">edited</span>}</h3>}
          {p.content && p.content !== '(no text)' && (
            <div className="post-body-wrap">
              <div className="post-body rendered-html" dangerouslySetInnerHTML={{ __html: sanitizeHtml(p.content) }} />
            </div>
          )}
        </>
      )}

      {images.length > 0 && (
        <div className={`post-images count-${Math.min(images.length, 4)}`}>
          {images.slice(0, 4).map((src, i) => <img key={i} src={src} alt="" loading="lazy" onClick={() => onImageClick(src)} />)}
        </div>
      )}

      {(likeCount > 0 || commentCount > 0) && (
        <div className="post-stats">
          {likeCount > 0 && <span className="post-stat-item"><span className="post-stat-dot like" />{likeCount} {likeCount === 1 ? 'like' : 'likes'}</span>}
          {commentCount > 0 && <span className="post-stat-item" onClick={() => setShowComments(true)} style={{ cursor: 'pointer' }}>{commentCount} {commentCount === 1 ? 'comment' : 'comments'}</span>}
        </div>
      )}

      <div className="post-actions">
        <button className={liked ? 'post-action liked' : 'post-action'} onClick={onLike}>
          <HeartIcon filled={liked} /> Like
        </button>
        <button className="post-action" onClick={() => setShowComments((s) => !s)}>
          <CommentIcon /> Comment
        </button>
        {p.author_id !== session.user.id && (
          <button className="post-action" onClick={onMessage}>
            <MessageIcon /> Message
          </button>
        )}
      </div>

      {showComments && <GroupComments postId={p.id} session={session} onOpenProfile={onOpenProfile} />}
    </li>
  )
}

function GroupComments({ postId, session, onOpenProfile }) {
  const [items, setItems] = useState([])
  const [draft, setDraft] = useState('')

  async function load() {
    const { data } = await supabase
      .from('group_post_comments')
      .select(`id, content, created_at, author_id, profiles!group_post_comments_author_id_fkey ( ${POSTER_FIELDS} )`)
      .eq('post_id', postId)
      .order('created_at', { ascending: true })
    setItems(data || [])
  }

  useEffect(() => { load() }, [postId])

  async function send() {
    if (!draft.trim()) return
    const { error } = await supabase.from('group_post_comments').insert({ post_id: postId, author_id: session.user.id, content: draft.trim() })
    if (!error) { setDraft(''); load() }
  }

  async function remove(id) {
    await supabase.from('group_post_comments').delete().eq('id', id)
    load()
  }

  return (
    <div className="post-comments">
      {items.length === 0 && <p className="empty small">No comments yet.</p>}
      <ul className="comment-list">
        {items.map((c) => (
          <li className="comment" key={c.id}>
            <button type="button" className="comment-avatar-link" onClick={() => onOpenProfile?.(c.profiles)} aria-label={`Open profile for ${c.profiles?.full_name || 'this alumnus'}`}>
              <Avatar url={c.profiles?.avatar_url} name={c.profiles?.full_name} size={30} />
            </button>
            <div className="comment-body">
              <button type="button" className="comment-author" onClick={() => onOpenProfile?.(c.profiles)}>{c.profiles?.full_name || 'Alumnus'}</button>
              <span className="comment-meta">{timeAgo(c.created_at)}</span>
              {c.author_id === session.user.id && (
                <DeleteButton onConfirm={() => remove(c.id)} label="Delete comment" message="This can't be undone." className="icon-btn-delete small delete-danger" />
              )}
              <p className="comment-text">{c.content}</p>
            </div>
          </li>
        ))}
      </ul>
      <div className="comment-form">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder="Write a comment…" maxLength={2000} />
        <button className="btn primary small" onClick={send} disabled={!draft.trim()}>Reply</button>
      </div>
    </div>
  )
}

/* ---------- Members tab ---------- */
function GroupMembersTab({ groupId, session, isGroupAdmin, onOpenProfile }) {
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('alpha')
  const showToast = useToast()

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('group_members')
      .select(`role, joined_at, profiles!group_members_user_id_fkey ( ${POSTER_FIELDS}, created_at )`)
      .eq('group_id', groupId)
    setMembers(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [groupId])

  async function removeMember(userId) {
    const { error } = await supabase.from('group_members').delete().match({ group_id: groupId, user_id: userId })
    if (error) { showToast('Could not remove member.', { type: 'error' }); return }
    setMembers((prev) => prev.filter((m) => m.profiles?.id !== userId))
    showToast('Member removed')
  }

  async function setRole(userId, role) {
    const { error } = await supabase.from('group_members').update({ role }).match({ group_id: groupId, user_id: userId })
    if (error) { showToast('Could not update role.', { type: 'error' }); return }
    setMembers((prev) => prev.map((m) => m.profiles?.id === userId ? { ...m, role } : m))
  }

  const needle = q.trim().toLowerCase()
  const filtered = members.filter((m) => !needle || (m.profiles?.full_name || '').toLowerCase().includes(needle))
  const sorted = [...filtered].sort((a, b) => {
    if (sort === 'alpha') return (a.profiles?.full_name || '').localeCompare(b.profiles?.full_name || '')
    return new Date(b.joined_at) - new Date(a.joined_at)
  })

  return (
    <div className="group-members-tab">
      <div className="directory-toolbar">
        <div className="search-wrap">
          <input className="search directory-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people…" />
          {q && <button className="search-clear" onClick={() => setQ('')} aria-label="Clear search">×</button>}
        </div>
      </div>
      <div className="directory-result-row">
        <p className="result-count">{sorted.length} results</p>
        <div className="sort-switch">
          <button className={sort === 'alpha' ? 'on' : ''} onClick={() => setSort('alpha')}>Alphabetically</button>
          <button className={sort === 'recent' ? 'on' : ''} onClick={() => setSort('recent')}>Recently joined</button>
        </div>
      </div>

      {loading ? <LoadingState message="Loading members…" /> : sorted.length === 0 && (
        <EmptyState icon="search" message="No members found." />
      )}

      <ul className="person-row-list">
        {sorted.map((m) => {
          const p = m.profiles
          if (!p) return null
          const willingToHelp = (p.services_offered || []).length > 0
          const roleLine = p.occupation && p.company ? `${p.occupation} @ ${p.company}` : (p.occupation || p.company || '')
          return (
            <li key={p.id}>
              <div className="person-row" role="button" tabIndex={0} onClick={() => onOpenProfile?.(p)} onKeyDown={(e) => { if (e.key === 'Enter') onOpenProfile?.(p) }}>
                {willingToHelp && <span className="person-row-ribbon">Willing to help!</span>}
                <Avatar url={p.avatar_url} name={p.full_name} size={48} />
                <div className="person-row-info">
                  <div className="person-row-name-line">
                    <span className="person-row-name">{p.full_name || 'Alumnus'}</span>
                    {p.id === session.user.id && <span className="person-name-you">You</span>}
                    <span className="person-row-affiliation">{m.role === 'admin' ? 'Group admin' : 'Member'}</span>
                  </div>
                  <p className="person-row-meta">{[roleLine, p.industry].filter(Boolean).join(' · ') || ' '}</p>
                </div>
                {isGroupAdmin && p.id !== session.user.id && (
                  <div className="person-row-actions" onClick={(e) => e.stopPropagation()}>
                    <button className="person-action" onClick={() => setRole(p.id, m.role === 'admin' ? 'member' : 'admin')} title={m.role === 'admin' ? 'Remove as admin' : 'Make group admin'}>
                      <StarIcon filled={m.role === 'admin'} />
                    </button>
                    <DeleteButton onConfirm={() => removeMember(p.id)} label="Remove from group" message="They can rejoin later if they want." className="icon-btn-delete post-delete-btn delete-danger" />
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ul>
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
function PinIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l1.5 5.5L19 9l-4 3.5L16 18l-4-3-4 3 1-5.5-4-3.5 5.5-1.5z" />
    </svg>
  )
}
function GearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}
function StarIcon({ filled }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  )
}
