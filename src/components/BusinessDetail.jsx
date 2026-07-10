import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { Avatar } from './Directory.jsx'
import ProfileModal from './ProfileModal.jsx'
import EmptyState from './EmptyState.jsx'
import LoadingState from './LoadingState.jsx'
import DeleteButton from './DeleteButton.jsx'
import { useToast } from './Toast.jsx'
import { buildIcebreaker } from '../icebreaker.js'
import { sanitizeBusinessHtml } from '../sanitizeHtml.js'
import { BusinessLogo, BusinessForm } from './BusinessDirectory.jsx'

const POSTER_FIELDS =
  'id, full_name, avatar_url, grad_year, degree, industry, occupation, company, city, country, ' +
  'is_current_resident, linkedin_url, bio, expertise, services_offered, business_website, ' +
  'business_categories, availability, geographic_focus, is_open_to_opportunities'

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso)) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return new Date(iso).toLocaleDateString()
}

// The standalone listing page — replaces the old floating "read more" modal.
// A card on the directory list only ever shows a brief excerpt + "Read
// more"; clicking through lands here with a full-width cover photo above
// the heading (same "big hero banner" treatment GroupDetail uses for
// group covers) and the full formatted description.
export default function BusinessDetail({ session, profile, onMessage }) {
  const { businessId } = useParams()
  const navigate = useNavigate()
  const showToast = useToast()
  const [business, setBusiness] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [openOwner, setOpenOwner] = useState(null)
  const isAdmin = !!profile?.is_admin

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('businesses')
      .select(`*, profiles!businesses_owner_id_fkey ( ${POSTER_FIELDS} )`)
      .eq('id', businessId)
      .maybeSingle()
    if (error) console.error(error)
    setBusiness(data || null)
    setLoading(false)
  }

  useEffect(() => { load() }, [businessId])

  async function remove() {
    const { error } = await supabase.from('businesses').delete().eq('id', business.id)
    if (error) { showToast('Could not delete listing.', { type: 'error' }); return }
    showToast('Listing deleted')
    navigate('/businesses')
  }

  async function togglePromote() {
    const next = !business.promoted
    setBusiness((b) => ({ ...b, promoted: next }))
    const { error } = await supabase.from('businesses').update({ promoted: next }).eq('id', business.id)
    if (error) {
      setBusiness((b) => ({ ...b, promoted: !next }))
      showToast('Could not update featured status.', { type: 'error' })
    } else {
      showToast(next ? 'Business featured' : 'Business unfeatured')
    }
  }

  function messageOwner() {
    onMessage(
      { id: business.owner_id, full_name: business.profiles?.full_name },
      `Hi! I saw "${business.name}" on the Eendrag Business Directory and wanted to reach out.`
    )
  }

  if (loading) return <section className="panel"><LoadingState message="Loading listing…" /></section>

  if (!business) {
    return (
      <section className="panel">
        <button className="profile-back-btn" onClick={() => navigate('/businesses')}>‹ Business Directory</button>
        <EmptyState icon="business" message="Listing not found." subMessage="It may have been removed." actionLabel="Back to Business Directory" onAction={() => navigate('/businesses')} />
      </section>
    )
  }

  const isMine = business.owner_id === session.user.id
  const website = business.website
    ? (/^https?:\/\//.test(business.website) ? business.website : `https://${business.website}`)
    : null

  if (editing) {
    return (
      <section className="panel business-detail-page">
        <button className="profile-back-btn" onClick={() => setEditing(false)}>‹ Cancel edit</button>
        <BusinessForm
          session={session}
          initial={business}
          onCancel={() => setEditing(false)}
          onCreated={() => { setEditing(false); load(); showToast('Listing updated') }}
        />
      </section>
    )
  }

  return (
    <section className="panel business-detail-page">
      <button className="profile-back-btn" onClick={() => navigate('/businesses')}>‹ Business Directory</button>

      <div className="business-hero">
        <div className="business-hero-cover">
          {business.cover_image_url ? <img src={business.cover_image_url} alt="" /> : <BusinessCoverFallback />}
        </div>
        <div className="business-hero-body">
          <div className="business-hero-identity">
            <BusinessLogo url={business.logo_url} name={business.name} />
            <div>
              <h2 className="business-hero-name">
                {business.name}
                {business.promoted && <span className="job-badge business-featured-tag">Featured</span>}
                {business.category && <span className="job-badge">{business.category}</span>}
              </h2>
              <p className="business-hero-location">
                {[business.city, business.country].filter(Boolean).join(', ') || 'Location not set'}
              </p>
              {business.tagline && <p className="business-hero-tagline">{business.tagline}</p>}
            </div>
          </div>
          <div className="business-hero-actions">
            {website && (
              <a className="btn primary" href={website} target="_blank" rel="noopener noreferrer">Visit website</a>
            )}
            {!isMine && <button className="btn ghost" onClick={messageOwner}>Message about this business</button>}
          </div>
        </div>
      </div>

      <div className="job-poster-row" style={{ marginBottom: 18 }}>
        <button className="job-poster" onClick={() => setOpenOwner(business.profiles)}>
          <Avatar url={business.profiles?.avatar_url} name={business.profiles?.full_name} size={26} />
          <span>Run by {business.profiles?.full_name || 'a member'} · {timeAgo(business.created_at)}</span>
        </button>
        <div className="business-hero-owner-actions">
          {isAdmin && (
            <button className="btn ghost small" onClick={togglePromote}>
              {business.promoted ? 'Remove from Featured' : 'Feature this business'}
            </button>
          )}
          {isMine && <button className="btn ghost small" onClick={() => setEditing(true)}>Edit</button>}
          {(isMine || isAdmin) && (
            <DeleteButton
              onConfirm={remove}
              label="Delete listing"
              message="This removes the business listing. This can't be undone."
              className="btn ghost small delete-danger"
            >
              Delete
            </DeleteButton>
          )}
        </div>
      </div>

      {business.description && (
        <div className="profile-card-section">
          <h3 className="profile-card-section-title">About</h3>
          <div
            className="business-rich-content"
            dangerouslySetInnerHTML={{ __html: sanitizeBusinessHtml(business.description) }}
          />
        </div>
      )}

      {(business.website || business.contact_email || business.phone) && (
        <div className="profile-card-section">
          <h3 className="profile-card-section-title">Contact</h3>
          {website && <p><a href={website} target="_blank" rel="noopener noreferrer">{business.website}</a></p>}
          {business.contact_email && <p>{business.contact_email}</p>}
          {business.phone && <p>{business.phone}</p>}
        </div>
      )}

      {openOwner && (
        <ProfileModal
          person={openOwner}
          isMe={openOwner.id === session.user.id}
          onClose={() => setOpenOwner(null)}
          onMessage={() => {
            const p = openOwner
            setOpenOwner(null)
            onMessage({ id: p.id, full_name: p.full_name }, buildIcebreaker(profile, p))
          }}
        />
      )}
    </section>
  )
}

function BusinessCoverFallback() {
  return (
    <div className="business-hero-cover-fallback" aria-hidden="true">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="7" width="18" height="13" rx="2" />
        <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        <line x1="3" y1="12" x2="21" y2="12" />
      </svg>
    </div>
  )
}
