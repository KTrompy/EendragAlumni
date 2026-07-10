# Enhanced Event Editor Guide

## Overview

Your event editing system now includes comprehensive features for creating and editing events with rich formatting, time management, image uploads, and registration limits.

## Features

### 1. **Event Dates & Times**
- **Start Date & Time**: Required. When the event begins.
- **End Date & Time**: Optional. When the event ends. If set, must be after the start time.

Both fields use the same date/time picker component already in your app.

### 2. **Event URL**
- Optional field for linking to external event pages, ticketing sites, or more information.
- Accepts any URL format.

### 3. **Event Image**
- Upload a single image to represent the event (braai photo, reunion flyer, etc.)
- **Max file size**: 5MB
- Image stored in Supabase `event-images` bucket
- Public URL generated and saved in the database
- User can remove the image and re-upload a different one

### 4. **Rich Text Description**
Full markdown-style formatting toolbar with:
- **Bold** (`**text**`)
- *Italic* (`*text*` or `_text_`)
- ~~Strikethrough~~ (`~~text~~`)
- **Headers** (`## text`)
- Bullet lists (`- item`)
- **Links** (`[text](url)`) via a prompt dialog

Live preview shows how the description will render.

### 5. **Registration Limit**
- **Unlimited** (default): Anyone can RSVP without restriction
- **Limited**: Cap registrations to a specific number (e.g., 50 people)

Set via radio buttons. When "Limited" is selected, a number input appears.

## Database Schema

**New columns added to `events` table (schema-update-24.sql):**

```sql
event_start_time timestamptz       -- Start date and time
event_end_time timestamptz         -- End date and time (nullable)
event_url text                     -- External URL
image_url text                     -- Public URL to event image
max_registrations integer          -- Registration cap (null = unlimited)
```

**Note**: The original `event_date` column remains for backward compatibility with existing events.

## Storage

**New storage bucket**: `event-images`
- Public bucket for event images
- Files stored per-user folder: `{user_id}/{timestamp}-{filename}`
- Auto-cleanup handled by Supabase object expiry policies (if configured)

## Component Files

### Core Components

1. **`EventFormEnhanced.jsx`** ← New component
   - Replaces the basic `EventForm` in the Events list
   - Handles all form state and validation
   - Image upload and preview
   - Calls `uploadImage()` before saving to DB
   - Real-time preview of rich text formatting

2. **`RichTextToolbarExtended.jsx`** ← New component
   - Extended toolbar with 6 buttons (vs. the original 3)
   - Bold, Italic, Strikethrough, Headers, Bullets, Links
   - Link button opens a prompt for URL

3. **`richTextExtended.jsx`** ← New utilities
   - `toggleStrikethrough()` - toggles ~~text~~ syntax
   - `toggleHeaders()` - toggles ## text syntax
   - `insertLink()` - inserts [text](url) with prompt
   - `renderRichTextExtended()` - renders all markdown styles into React components
   - Extends the original `richText.jsx` without replacing it

### Usage in Events.jsx

Replace this line in `Events.jsx` (around line 364):
```jsx
<EventForm
  session={session}
  onCancel={() => setShowForm(false)}
  onCreated={() => { setShowForm(false); loadInitial(); showToast('Event created') }}
/>
```

With:
```jsx
<EventFormEnhanced
  session={session}
  onCancel={() => setShowForm(false)}
  onCreated={() => { setShowForm(false); loadInitial(); showToast('Event created') }}
/>
```

Also update the inline edit (around line 552):
```jsx
return (
  <li className="event-card event-card-editing" id={`event-${e.id}`}>
    <EventFormEnhanced
      session={session}
      initial={e}
      onCancel={() => setEditing(false)}
      onCreated={() => { setEditing(false); onSaved?.(); showToast('Event updated') }}
    />
  </li>
)
```

## Styling

**New CSS classes** (added to `styles.css`):

- `.event-form-enhanced` - Main form container
- `.image-upload-box`, `.image-preview`, `.btn-clear-image` - Image upload UI
- `.rte-toolbar`, `.rte-btn`, `.rte-textarea` - Rich text editor
- `.rte-preview`, `.rte-preview-content` - Live preview
- `.registration-limit-group`, `.radio-label`, `.registration-input` - Registration limit controls

All styled to match the existing Eendrag design system (colors, spacing, typography, etc.).

## Form Validation

The form validates:
1. **Title** is required and non-empty
2. **Start date** is required
3. **End date** (if set) must be after start date
4. **Registration limit** (if limited) must be at least 1
5. **Image file** must be under 5MB

Errors display inline with helpful messages.

## Implementation Checklist

- [ ] Run `schema-update-24.sql` in Supabase SQL Editor
- [ ] Add `EventFormEnhanced.jsx` to `/src/components/`
- [ ] Add `RichTextToolbarExtended.jsx` to `/src/components/`
- [ ] Add `richTextExtended.jsx` to `/src/`
- [ ] Update `Events.jsx` to import and use `EventFormEnhanced`
- [ ] Add CSS from this package to `styles.css`
- [ ] Test form submission with all fields
- [ ] Test image upload and preview
- [ ] Test rich text formatting and preview
- [ ] Test registration limit options
- [ ] Test editing existing events

## API Data Flow

### Create New Event
```
Form Submission
  ↓
Validate form fields
  ↓
Upload image (if selected) → get public URL
  ↓
Geocode location → get lat/lng
  ↓
INSERT into events table with all fields
  ↓
Realtime subscription fires → reload events
  ↓
Show success toast
```

### Edit Existing Event
```
Form Submission
  ↓
Validate form fields
  ↓
Upload new image if changed (or keep existing URL)
  ↓
Geocode location if changed
  ↓
UPDATE events table (only changed fields)
  ↓
Realtime subscription fires → reload events
  ↓
Show success toast
```

## Notes

- The original `event_date` column is kept for backward compatibility; existing events still reference it
- Consider a migration script to backfill `event_start_time` from `event_date` if needed
- Image uploads use Supabase Storage with per-user folders for security
- RLS policies enforce that only approved members can upload/delete images
- The extended rich text utilities can be reused in other forms (posts, jobs, etc.)
- Link markdown opens in new tabs with security headers (`target="_blank" rel="noopener noreferrer"`)

## Troubleshooting

**Images not uploading?**
- Check Supabase Storage bucket `event-images` exists and is public
- Verify RLS policies are set (included in schema-update-24.sql)
- Ensure user is approved

**Rich text preview not showing?**
- Check that `renderRichTextExtended` is imported correctly
- Verify CSS for `.rte-preview-content` is loaded

**Dates not saving?**
- Ensure `DateTimePicker` component handles timezone correctly
- Check that dates are being serialized to ISO strings before sending

## Future Enhancements

Potential additions:
- Event tags/categories
- Recurring events
- Event cancellation flag
- Attendee check-in QR codes
- Email notifications for registrations
- Event time zone support
