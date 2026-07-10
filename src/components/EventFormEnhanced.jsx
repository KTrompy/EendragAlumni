import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import { geocodeCity } from '../geocode.js'
import { useToast } from './Toast.jsx'
import DateTimePicker from './DateTimePicker.jsx'
import RichTextToolbarExtended from './RichTextToolbarExtended.jsx'
import { renderRichTextExtended } from '../richTextExtended.jsx'

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB

export default function EventFormEnhanced({ session, onCancel, onCreated, initial = null }) {
  const isEdit = !!initial
  const [title, setTitle] = useState(initial?.title || '')
  const [startDate, setStartDate] = useState(initial?.event_start_time ? new Date(initial.event_start_time) : null)
  const [endDate, setEndDate] = useState(initial?.event_end_time ? new Date(initial.event_end_time) : null)
  const [location, setLocation] = useState(initial?.location || '')
  const [eventUrl, setEventUrl] = useState(initial?.event_url || '')
  const [description, setDescription] = useState(initial?.description || '')
  const [registrationLimit, setRegistrationLimit] = useState(initial?.max_registrations === null ? 'unlimited' : 'limited')
  const [registrationCount, setRegistrationCount] = useState(initial?.max_registrations || '')
  const [imageFile, setImageFile] = useState(null)
  const [imagePreview, setImagePreview] = useState(initial?.image_url || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [isClosing, setIsClosing] = useState(false)
  const textareaRef = useRef(null)
  const fileInputRef = useRef(null)
  const showToast = useToast()

  useEffect(() => {
    if (isEdit) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prevOverflow }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleCancel() {
    setIsClosing(true)
    setTimeout(onCancel, 200)
  }

  function handleImageSelect(e) {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.size > MAX_FILE_SIZE) {
      setError('Image must be under 5MB')
      return
    }

    setImageFile(file)
    const reader = new FileReader()
    reader.onload = (evt) => setImagePreview(evt.target?.result)
    reader.readAsDataURL(file)
  }

  function clearImage() {
    setImageFile(null)
    setImagePreview('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function uploadImage(eventId) {
    if (!imageFile) return null

    const filename = `${session.user.id}/${Date.now()}-${imageFile.name}`
    const { data, error: uploadError } = await supabase.storage
      .from('event-images')
      .upload(filename, imageFile)

    if (uploadError) {
      console.error('Image upload error:', uploadError)
      return null
    }

    const { data: urlData } = supabase.storage.from('event-images').getPublicUrl(filename)
    return urlData?.publicUrl || null
  }

  async function submit() {
    if (!title.trim() || !startDate) {
      setError('Title and start date are required.')
      return
    }

    if (endDate && startDate > endDate) {
      setError('End date must be after start date.')
      return
    }

    if (registrationLimit === 'limited' && (!registrationCount || parseInt(registrationCount) < 1)) {
      setError('Registration limit must be at least 1.')
      return
    }

    setBusy(true)
    setError(null)

    try {
      // Geocode location if it changed
      const trimmedLocation = location.trim()
      let coords = { lat: initial?.lat ?? null, lng: initial?.lng ?? null }
      const locationChanged = !isEdit || trimmedLocation !== (initial?.location || '')

      if (locationChanged && trimmedLocation) {
        const geo = await geocodeCity(trimmedLocation, '')
        coords = { lat: geo?.lat ?? null, lng: geo?.lng ?? null }
      } else if (locationChanged && !trimmedLocation) {
        coords = { lat: null, lng: null }
      }

      // Handle image upload
      let imageUrl = initial?.image_url || ''
      if (imageFile) {
        imageUrl = await uploadImage(initial?.id) || ''
      }

      const payload = {
        title: title.trim(),
        event_start_time: startDate.toISOString(),
        event_end_time: endDate?.toISOString() || null,
        location: trimmedLocation,
        description: description.trim(),
        event_url: eventUrl.trim(),
        image_url: imageUrl,
        max_registrations: registrationLimit === 'unlimited' ? null : parseInt(registrationCount),
        ...coords,
      }

      const { error: dbError } = isEdit
        ? await supabase.from('events').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', initial.id)
        : await supabase.from('events').insert({ ...payload, created_by: session.user.id })

      if (dbError) {
        setError(
          dbError.message.includes('policy')
            ? 'Creating events unlocks once your account is approved.'
            : dbError.message
        )
      } else {
        onCreated()
      }
    } catch (err) {
      setError(err.message || 'An error occurred.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={isEdit ? '' : `create-panel-backdrop ${isClosing ? 'closing' : ''}`}
      onClick={isEdit ? undefined : (e) => e.target === e.currentTarget && handleCancel()}
    >
      <div className={isEdit ? 'create-panel inline' : `create-panel ${isClosing ? 'closing' : ''}`}>
        <h3>{isEdit ? 'Edit event' : 'Add an event'}</h3>
        <div className="create-panel-content event-form-enhanced">
          {/* Basic info */}
          <label className="field">
            <span>Title</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="60-year reunion braai"
            />
          </label>

          {/* Date & Time */}
          <div className="field-row">
            <label className="field">
              <span>Start date & time</span>
              <DateTimePicker
                value={startDate}
                onChange={setStartDate}
                placeholder="Pick a start date & time"
              />
            </label>
            <label className="field">
              <span>End date & time (optional)</span>
              <DateTimePicker
                value={endDate}
                onChange={setEndDate}
                placeholder="Pick an end date & time"
              />
            </label>
          </div>

          {/* Location & URL */}
          <div className="field-row">
            <label className="field">
              <span>Location</span>
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Eendrag, Stellenbosch"
              />
            </label>
            <label className="field">
              <span>Event URL (optional)</span>
              <input
                value={eventUrl}
                onChange={(e) => setEventUrl(e.target.value)}
                type="url"
                placeholder="https://example.com"
              />
            </label>
          </div>

          {/* Image upload */}
          <label className="field">
            <span>Event image (optional)</span>
            <div className="image-upload-box">
              {imagePreview ? (
                <div className="image-preview">
                  <img src={imagePreview} alt="Event" />
                  <button
                    type="button"
                    className="btn-clear-image"
                    onClick={clearImage}
                    aria-label="Remove image"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="btn ghost wide"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Choose image
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageSelect}
                style={{ display: 'none' }}
              />
            </div>
            <p className="field-hint">Max 5MB</p>
          </label>

          {/* Rich text description */}
          <label className="field">
            <span>Description</span>
            <RichTextToolbarExtended
              textareaRef={textareaRef}
              value={description}
              onChange={setDescription}
            />
            <textarea
              ref={textareaRef}
              rows={5}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What's happening, RSVP details, what to bring, cost…"
              style={{ resize: 'vertical' }}
              className="rte-textarea"
            />
            {description && (
              <div className="rte-preview">
                <strong>Preview:</strong>
                <div className="rte-preview-content">
                  {renderRichTextExtended(description)}
                </div>
              </div>
            )}
          </label>

          {/* Registration limit */}
          <div className="field">
            <span>Registration limit</span>
            <div className="registration-limit-group">
              <label className="radio-label">
                <input
                  type="radio"
                  value="unlimited"
                  checked={registrationLimit === 'unlimited'}
                  onChange={(e) => setRegistrationLimit(e.target.value)}
                />
                <span>Unlimited registrations</span>
              </label>
              <label className="radio-label">
                <input
                  type="radio"
                  value="limited"
                  checked={registrationLimit === 'limited'}
                  onChange={(e) => setRegistrationLimit(e.target.value)}
                />
                <span>Limit to</span>
                <input
                  type="number"
                  min="1"
                  value={registrationCount}
                  onChange={(e) => setRegistrationCount(e.target.value)}
                  placeholder="50"
                  disabled={registrationLimit === 'unlimited'}
                  className="registration-input"
                />
                <span>people</span>
              </label>
            </div>
          </div>

          {error && <p className="form-error">{error}</p>}
        </div>

        <div className="btn-row">
          <button className="btn ghost" onClick={handleCancel} disabled={isClosing || busy}>
            Cancel
          </button>
          <button className="btn primary" onClick={submit} disabled={busy}>
            {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Post event'}
          </button>
        </div>
      </div>
    </div>
  )
}
