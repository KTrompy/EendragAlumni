# Integration Steps: Enhanced Event Editor

## Quick Summary

You're adding 4 new files to your project:
1. `schema-update-24.sql` — Database schema changes
2. `src/richTextExtended.jsx` — Extended markdown utilities
3. `src/components/RichTextToolbarExtended.jsx` — Toolbar with 6 formatting buttons
4. `src/components/EventFormEnhanced.jsx` — New event creation/editing form

Plus updates to:
- `src/styles.css` — New CSS for the form
- `src/components/Events.jsx` — Two import/usage changes

## Step 1: Run Database Migration

Open your Supabase dashboard (SQL Editor) and run:

```sql
-- From schema-update-24.sql
alter table public.events add column if not exists event_start_time timestamptz;
alter table public.events add column if not exists event_end_time timestamptz;
alter table public.events add column if not exists event_url text default '';
alter table public.events add column if not exists image_url text default '';
alter table public.events add column if not exists max_registrations integer;

insert into storage.buckets (id, name, public)
values ('event-images', 'event-images', true)
on conflict (id) do nothing;

drop policy if exists "Approved members can upload event images" on storage.objects;
create policy "Approved members can upload event images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'event-images'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_approved()
  );

drop policy if exists "Anyone can view event images" on storage.objects;
create policy "Anyone can view event images"
  on storage.objects for select
  using (bucket_id = 'event-images');

drop policy if exists "Users can delete own event images" on storage.objects;
create policy "Users can delete own event images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'event-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
```

✅ Verify: Check Supabase → Storage → Buckets. You should see `event-images`.

## Step 2: Add New Utility File

Copy `src/richTextExtended.jsx` to your project at that path.

This provides:
- `toggleStrikethrough()`
- `toggleHeaders()`
- `insertLink()`
- `renderRichTextExtended()`

## Step 3: Add Extended Toolbar Component

Copy `src/components/RichTextToolbarExtended.jsx` to your project.

This component has 6 buttons: Bold, Italic, Strikethrough, Header, Bullets, Links.

## Step 4: Add Enhanced Event Form Component

Copy `src/components/EventFormEnhanced.jsx` to your project.

This is your new event creation/editing form with:
- Start/end date pickers
- Event URL input
- Image upload with preview
- Rich text description with toolbar and live preview
- Registration limit (unlimited or capped)

## Step 5: Update CSS

Add the new CSS from the bottom of `src/styles.css` to your own `styles.css`.

Search for this in your `styles.css`:
```css
/* Enhanced event form ---------- */
```

If it's not there, append everything from `src/styles.css` starting with `/* Enhanced event form ---------- */` to the end of your file.

## Step 6: Update Events.jsx

### Change 1: Import the new component

Find this line (around line 1 of the imports):
```jsx
import { supabase } from '../supabaseClient'
```

Add after it:
```jsx
import EventFormEnhanced from './EventFormEnhanced'
```

### Change 2: Replace EventForm with EventFormEnhanced in two places

**First usage** (around line 363–369):
```jsx
{showForm && (
  <EventForm
    session={session}
    onCancel={() => setShowForm(false)}
    onCreated={() => { setShowForm(false); loadInitial(); showToast('Event created') }}
  />
) || null}
```

Change to:
```jsx
{showForm && (
  <EventFormEnhanced
    session={session}
    onCancel={() => setShowForm(false)}
    onCreated={() => { setShowForm(false); loadInitial(); showToast('Event created') }}
  />
) || null}
```

**Second usage** (around line 549–559):
```jsx
if (editing) {
  return (
    <li className="event-card event-card-editing" id={`event-${e.id}`}>
      <EventForm
        session={session}
        initial={e}
        onCancel={() => setEditing(false)}
        onCreated={() => { setEditing(false); onSaved?.(); showToast('Event updated') }}
      />
    </li>
  )
}
```

Change to:
```jsx
if (editing) {
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
}
```

**Optional**: You can remove the old `EventForm` function if it's no longer used elsewhere.

## Step 7: Test

1. **Create a new event**
   - Fill in title and start date (required)
   - Add an end date to verify validation
   - Upload an image (or skip)
   - Try the toolbar buttons: **bold**, *italic*, ~~strike~~, ## headers, bullets, and link
   - Watch the preview update live
   - Set registration limit to unlimited or capped
   - Click "Post event"

2. **Edit an existing event**
   - Click edit on any event card
   - Modify any field
   - Verify the form pre-fills with existing data
   - Test image replacement
   - Click "Save changes"

3. **Verify data**
   - Open Supabase → `events` table
   - Check that new columns have values:
     - `event_start_time` and `event_end_time` (ISO timestamps)
     - `event_url` (if provided)
     - `image_url` (if image uploaded)
     - `max_registrations` (number or null)

## Troubleshooting

### Form doesn't appear
- Ensure `EventFormEnhanced` is imported in `Events.jsx`
- Check browser console for import errors

### Image upload fails
- Verify `event-images` bucket exists in Supabase Storage
- Check RLS policies were created (run schema-update-24.sql again)
- Ensure user is approved (required by RLS policy)
- Check browser console for upload errors

### Rich text preview missing
- Verify `richTextExtended.jsx` is in `src/` folder
- Ensure CSS for `.rte-preview` is in `styles.css`
- Check that `renderRichTextExtended` is imported in `EventFormEnhanced.jsx`

### Styling looks wrong
- Copy all CSS starting with `/* Enhanced event form */` to your `styles.css`
- Check that CSS variables (--orange, --maroon, etc.) are defined in `:root`
- Verify no conflicting CSS classes

## File Locations (Your Project)

```
eendrag-hub/
├── schema-update-24.sql                   ← Run this in Supabase SQL Editor
├── src/
│   ├── richTextExtended.jsx               ← NEW
│   ├── styles.css                         ← UPDATED (add CSS at end)
│   └── components/
│       ├── Events.jsx                     ← UPDATED (2 import changes)
│       ├── RichTextToolbarExtended.jsx    ← NEW
│       └── EventFormEnhanced.jsx          ← NEW
```

## File Locations (What You Receive)

All files are included in the project folder you selected. Just copy them to the paths above.

## Next Steps

After integration:

1. Test thoroughly with various event scenarios
2. Consider backfilling `event_start_time` from `event_date` for existing events (optional)
3. Update event display cards to show end time if available
4. Add event image to the event card preview (optional)
5. Display registration count vs. limit on event cards (optional)

## Questions or Issues?

Refer to `EVENT_EDITOR_GUIDE.md` for detailed feature documentation.
