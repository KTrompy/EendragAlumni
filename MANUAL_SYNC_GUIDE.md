# Manual Sync Guide — Cloud Changes to Local Repo

The files have been modified in the cloud session but need to be manually synced to your local repository. Here's what to do:

## Files That Need to Be Updated/Created

### 1. **NEW FILE: `src/components/EventFormEnhanced.jsx`**
Copy the complete file from the cloud session. This is the new enhanced event form with all features.

### 2. **NEW FILE: `src/components/RichTextToolbarExtended.jsx`**
Copy this new toolbar component with 6 formatting buttons.

### 3. **NEW FILE: `src/richTextExtended.jsx`**
Copy this new utility file with extended markdown functions.

### 4. **NEW FILE: `schema-update-24.sql`**
Database migration to add new event columns and storage bucket.

### 5. **MODIFIED: `src/components/Directory.jsx`**
Key changes:
- Line 15: Add import → `import EventFormEnhanced from './EventFormEnhanced'`
- Line 96-106: Change `<ul className="person-row-list">` to `<ul className="card-grid">`
- Change `PersonRow` component to `PersonCard` component
- Remove old `PersonRow` function (was at lines 880-976 in Events.jsx for comparison)
- Replace with new `PersonCard` function

### 6. **MODIFIED: `src/components/Events.jsx`**
Key changes:
- Line 15: Add import → `import EventFormEnhanced from './EventFormEnhanced'`
- Line 365: Change `<EventForm` to `<EventFormEnhanced`
- Line 553: Change `<EventForm` to `<EventFormEnhanced`
- Remove old `EventForm` function (lines 880-976)

### 7. **MODIFIED: `src/styles.css`**
Add these sections:

**a) Update `.card-grid` (replace existing)**
```css
.card-grid {
  list-style: none; margin: 0; padding: 0;
  display: grid; gap: 24px;
  grid-template-columns: 1fr;
}
@media (min-width: 640px) {
  .card-grid { gap: 20px; grid-template-columns: repeat(2, 1fr); }
}
@media (min-width: 1024px) {
  .card-grid { gap: 32px; grid-template-columns: repeat(3, 1fr); }
}
```

**b) Add Person Card CSS** (after existing `.person-action:disabled:hover` rule, before Profile Modal section)
```css
/* Person card footer sections */
.person-card-photo { ... }
.person-card-overlay { ... }
.person-card-footer { ... }
.person-card-info { ... }
.person-card-name { ... }
.person-card-you { ... }
.person-card-meta { ... }
.person-card-role { ... }
.person-card-location { ... }
.person-card-actions { ... }
.person-card-ribbon { ... }
```

**c) Add Enhanced Event Form CSS** (at the very end of file, before closing)
```css
/* ---------- Enhanced event form ---------- */
.event-form-enhanced { ... }
.image-upload-box { ... }
.btn-clear-image { ... }
.rte-toolbar { ... }
.rte-btn { ... }
.rte-preview { ... }
/* ... plus 40+ more rules for form styling ... */
```

## Quick Copy-Paste Reference

### Directory.jsx Changes

**BEFORE (line 96-106):**
```jsx
<ul className="person-row-list">
  {shown.map((p) => (
    <PersonRow
      key={p.id}
      person={p}
      isMe={p.id === session.user.id}
      onOpen={() => setOpenProfile(p)}
      onMessage={() => messageWithIcebreaker(p)}
    />
  ))}
</ul>
```

**AFTER:**
```jsx
<ul className="card-grid">
  {shown.map((p) => (
    <PersonCard
      key={p.id}
      person={p}
      isMe={p.id === session.user.id}
      onOpen={() => setOpenProfile(p)}
      onMessage={() => messageWithIcebreaker(p)}
    />
  ))}
</ul>
```

### Events.jsx Changes

**BEFORE (line 15):**
```jsx
import { eventIcebreaker } from '../icebreaker.js'
```

**AFTER:**
```jsx
import { eventIcebreaker } from '../icebreaker.js'
import EventFormEnhanced from './EventFormEnhanced'
```

**BEFORE (line 365):**
```jsx
<EventForm
  session={session}
  onCancel={() => setShowForm(false)}
  onCreated={() => { setShowForm(false); loadInitial(); showToast('Event created') }}
/>
```

**AFTER:**
```jsx
<EventFormEnhanced
  session={session}
  onCancel={() => setShowForm(false)}
  onCreated={() => { setShowForm(false); loadInitial(); showToast('Event created') }}
/>
```

**BEFORE (line 553):**
```jsx
<EventForm
  session={session}
  initial={e}
  onCancel={() => setEditing(false)}
  onCreated={() => { setEditing(false); onSaved?.(); showToast('Event updated') }}
/>
```

**AFTER:**
```jsx
<EventFormEnhanced
  session={session}
  initial={e}
  onCancel={() => setEditing(false)}
  onCreated={() => { setEditing(false); onSaved?.(); showToast('Event updated') }}
/>
```

## Steps to Sync

1. **Copy new files** from cloud to local:
   - `EventFormEnhanced.jsx` → `src/components/`
   - `RichTextToolbarExtended.jsx` → `src/components/`
   - `richTextExtended.jsx` → `src/`
   - `schema-update-24.sql` → root folder

2. **Edit existing files** with the changes above:
   - `src/components/Directory.jsx`
   - `src/components/Events.jsx`
   - `src/styles.css`

3. **Commit and push:**
```bash
cd ~/Downloads/eendrag-hub-update1/eendrag-hub
git add .
git commit -m "Add enhanced event editor and card grid layout for Eendragers"
git push
```

4. **Run database migration** in Supabase SQL Editor:
```sql
-- Copy content from schema-update-24.sql and run in Supabase
```

## Files Available in Cloud Session

All complete, ready-to-copy files are in:
`/sessions/amazing-admiring-turing/mnt/eendrag-hub/`

You can view them and copy the content to your local files.
