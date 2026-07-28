import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../supabaseClient'
import { useToast } from './Toast.jsx'
import { PdfIcon } from './Jobs.jsx'

const MAX_COVER_LETTER = 300
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB
const ACCEPTED_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]
const ACCEPTED_EXT = '.pdf,.doc,.docx'

function UploadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  )
}

export default function ApplyModal({ job, session, profile, onClose, onApplied }) {
  const showToast = useToast()
  const [coverLetter, setCoverLetter] = useState('')
  const [cvFile, setCvFile] = useState(null)
  const [coverFile, setCoverFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const cvRef = useRef(null)
  const coverRef = useRef(null)

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  function pickFile(e, setter) {
    const f = e.target.files?.[0]
    if (!f) return
    if (!ACCEPTED_TYPES.includes(f.type)) {
      setError('Please upload a PDF or Word document.')
      e.target.value = ''
      return
    }
    if (f.size > MAX_FILE_SIZE) {
      setError('File is over 10 MB.')
      e.target.value = ''
      return
    }
    setter(f)
    setError(null)
    e.target.value = ''
  }

  async function uploadFile(file, label) {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const path = `${session.user.id}/${Date.now()}-${label}-${safeName}`
    const { error: upErr } = await supabase.storage
      .from('job-application-files')
      .upload(path, file, { upsert: false, contentType: file.type })
    if (upErr) throw upErr
    // Private bucket — return the path; we'll generate signed URLs when viewing
    return path
  }

  async function submit() {
    if (!coverLetter.trim()) {
      setError('Please add a short cover message.')
      return
    }
    if (!cvFile) {
      setError('Please upload your CV.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const cvPath = await uploadFile(cvFile, 'cv')
      let coverPath = null
      if (coverFile) {
        coverPath = await uploadFile(coverFile, 'cover')
      }

      const { error: insertErr } = await supabase.from('job_applications').insert({
        job_id: job.id,
        applicant_id: session.user.id,
        cover_letter: coverLetter.trim(),
        cv_url: cvPath,
        cv_name: cvFile.name,
        cover_letter_url: coverPath,
        cover_letter_name: coverFile?.name || null,
      })

      if (insertErr) {
        if (insertErr.message.includes('duplicate') || insertErr.code === '23505') {
          setError('You have already applied to this role.')
        } else if (insertErr.message.includes('policy')) {
          setError('Your account must be approved before you can apply.')
        } else {
          setError(insertErr.message)
        }
        setBusy(false)
        return
      }

      // Notify the poster
      await supabase.from('notifications').insert({
        user_id: job.posted_by,
        actor_id: session.user.id,
        type: 'job_application',
        entity_type: 'job',
        entity_id: job.id,
        message: `${profile?.full_name || 'Someone'} applied to your "${job.title}" listing.`,
      }).catch(() => {}) // non-critical

      showToast('Application sent!')
      onApplied?.()
      onClose()
    } catch (e) {
      setError(e.message || 'Upload failed — please try again.')
      setBusy(false)
    }
  }

  return createPortal(
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="apply-modal-title">
      <div className="modal modal-apply" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 id="apply-modal-title">Apply for {job.title}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="modal-body">
          <p className="apply-modal-subtitle">
            <strong>{job.company}</strong>
            {job.location && ` · ${job.location}`}
          </p>

          <p className="apply-modal-hint">
            Add a short cover message and upload your CV in Word or PDF format before sending.
          </p>

          <label className="field">
            <span>Cover message</span>
            <textarea
              className="apply-modal-textarea"
              value={coverLetter}
              onChange={(e) => setCoverLetter(e.target.value.slice(0, MAX_COVER_LETTER))}
              placeholder="A few words about yourself and why you're right for this role"
              rows={4}
            />
            <span className="apply-modal-counter">{coverLetter.length} / {MAX_COVER_LETTER}</span>
          </label>

          <div className="apply-modal-uploads">
            <div className="apply-modal-upload-row">
              <button type="button" className="btn ghost small" onClick={() => cvRef.current?.click()}>
                <UploadIcon /> {cvFile ? 'Replace CV' : 'Upload CV *'}
              </button>
              {cvFile && (
                <span className="apply-modal-file-chip">
                  <PdfIcon /> {cvFile.name}
                  <button className="apply-modal-file-remove" onClick={() => setCvFile(null)} aria-label="Remove CV">×</button>
                </span>
              )}
              <input ref={cvRef} type="file" accept={ACCEPTED_EXT} style={{ display: 'none' }} onChange={(e) => pickFile(e, setCvFile)} />
            </div>

            <div className="apply-modal-upload-row">
              <button type="button" className="btn ghost small" onClick={() => coverRef.current?.click()}>
                <UploadIcon /> {coverFile ? 'Replace cover letter' : 'Upload cover letter'}
              </button>
              {coverFile && (
                <span className="apply-modal-file-chip">
                  <PdfIcon /> {coverFile.name}
                  <button className="apply-modal-file-remove" onClick={() => setCoverFile(null)} aria-label="Remove cover letter">×</button>
                </span>
              )}
              <input ref={coverRef} type="file" accept={ACCEPTED_EXT} style={{ display: 'none' }} onChange={(e) => pickFile(e, setCoverFile)} />
            </div>
          </div>

          {error && <p className="form-error">{error}</p>}
        </div>

        <div className="modal-footer">
          <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn primary" onClick={submit} disabled={busy}>
            {busy ? 'Sending…' : 'Apply'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
