import { useEffect } from 'react'
import { Avatar } from './Directory.jsx'
import DeleteButton from './DeleteButton.jsx'
import { sanitizeHtml, trimTrailingHtml } from '../sanitizeHtml.js'

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso)) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return new Date(iso).toLocaleDateString()
}

// Same company/role logo block as the card — duplicated here (rather than
// imported from Jobs.jsx) to avoid a circular import, since Jobs.jsx is
// what renders this modal.
function JobLogo({ url, company }) {
  const initial = (company || '?').trim().charAt(0).toUpperCase()
  return url ? (
    <img className="job-logo" src={url} alt={company ? `${company} logo` : 'Company logo'} loading="lazy" />
  ) : (
    <div className="job-logo job-logo-fallback" aria-hidden="true">{initial}</div>
  )
}

function BookmarkIcon({ filled = false }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  )
}

// The full-detail popup for a job card — same information the card
// already shows (nothing hidden there is truncated), just laid out like
// Directory's ProfileModal so tapping a listing reads as "open this for a
// proper look" rather than a dead end. Opens on a click anywhere on the
// card that isn't one of the card's own buttons/links.
export default function JobModal({
  entry, isSaved, onToggleSave, onOpenPoster, onApplyEmail, onMessage,
  onShare, copied, onEdit, onDelete, onClose,
}) {
  const { job: j, isMine, isNew, reason } = entry

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose])

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="job-modal-title">
      <div className="modal profile-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 id="job-modal-title">{j.title}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="modal-body">
          <div className="profile-card-header">
            <JobLogo url={j.logo_url} company={j.company} />
            <div className="profile-card-heading">
              <p className="profile-card-role">
                <strong>{j.company}</strong>
                {j.location && ` · ${j.location}`}
              </p>
              <div className="job-modal-badges">
                {isNew && <span className="job-badge job-badge-new">New</span>}
                {j.employment_type && <span className="job-badge">{j.employment_type}</span>}
                {j.updated_at && <span className="edited-tag">edited</span>}
              </div>
            </div>
          </div>

          <div className="job-poster-row">
            <button className="job-poster" onClick={onOpenPoster}>
              <Avatar url={j.profiles?.avatar_url} name={j.profiles?.full_name} size={22} />
              <span>Posted by {j.profiles?.full_name || 'a member'} · {timeAgo(j.created_at)}</span>
            </button>
            {reason && (
              <span className="job-match-badge" title="Something you have in common with the poster">
                {reason}
              </span>
            )}
          </div>

          <div className="profile-card-section">
            <h3 className="profile-card-section-title">Description</h3>
            <div
              className="job-desc rendered-html"
              dangerouslySetInnerHTML={{ __html: trimTrailingHtml(sanitizeHtml(j.description)) }}
            />
          </div>
        </div>

        <div className="modal-footer">
          {/* Same save toggle as the card, but as a labeled pill button
              here instead of the card's absolutely-positioned icon-only
              circle, which wouldn't sit right inline with the other
              footer actions. */}
          <button
            type="button"
            className={isSaved ? 'btn ghost small job-modal-save on' : 'btn ghost small job-modal-save'}
            onClick={onToggleSave}
            aria-pressed={isSaved}
          >
            <BookmarkIcon filled={isSaved} /> {isSaved ? 'Saved' : 'Save'}
          </button>
          {j.apply_url && (
            <a className="btn primary small" href={j.apply_url} target="_blank" rel="noopener noreferrer">
              Apply now
            </a>
          )}
          {j.contact_email && (
            <button className="btn primary small" onClick={onApplyEmail}>
              Apply via email
            </button>
          )}
          {!isMine && (
            <button className="btn ghost small" onClick={onMessage}>
              Message about this role
            </button>
          )}
          <button className="btn ghost small" onClick={onShare}>
            {copied ? 'Copied!' : 'Share'}
          </button>
          {isMine && (
            <button className="btn ghost small" onClick={onEdit}>
              Edit
            </button>
          )}
          {isMine && (
            <DeleteButton
              onConfirm={onDelete}
              label="Delete listing"
              message="This removes the job listing. This can't be undone."
              className="btn ghost small delete-danger"
            >
              Delete
            </DeleteButton>
          )}
        </div>
      </div>
    </div>
  )
}
