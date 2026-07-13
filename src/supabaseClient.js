import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  console.error(
    'Missing Supabase config. Copy .env.example to .env and fill in your project URL and anon key.'
  )
}

export const supabase = createClient(url, key)

// Single source of truth for self-service account deletion. There used to
// be two separate implementations — Profile.jsx called the delete-account
// Edge Function while Settings.jsx called the delete_own_account() DB RPC.
// The RPC approach is documented in schema-update-3.sql as SUPERSEDED:
// hosted Supabase silently no-ops a plain SQL DELETE against auth.users
// even from a SECURITY DEFINER function, so that path looked like it
// worked (no error) but never actually removed the account. The Edge
// Function uses the Admin API (auth.admin.deleteUser) with the
// service-role key, which is the only reliable way to do this — see
// supabase/functions/delete-account/index.ts. Both UI paths now call this
// one function so they can't drift again.
export async function deleteOwnAccount() {
  return supabase.functions.invoke('delete-account')
}

// Distinguishes "your JWT/session is no good" from an ordinary network
// blip or a genuine "no rows" result. Postgrest returns 401s as a JWT-shaped
// message/code, and a network failure (offline, DNS, CORS) never reaches
// Postgrest at all so it carries no `code`/`status` — checking for either
// shape here means callers can react to "you're not really signed in
// anymore" without mistaking it for "the network hiccupped" or "that row
// doesn't exist".
export function isAuthError(error) {
  if (!error) return false
  if (error.code === 'PGRST301' || error.status === 401) return true
  const msg = (error.message || '').toLowerCase()
  return msg.includes('jwt') || msg.includes('refresh_token') || msg.includes('invalid_grant')
}

// True for a fetch/network-level failure (offline, DNS, CORS, Mapbox/
// Supabase unreachable) as opposed to a real error response from the
// server — no `code`, no `status`, just "the request never completed".
export function isNetworkError(error) {
  return !!error && !error.code && !error.status
}

// Best-effort cleanup for storage files whose owning row (a post, a group,
// a business listing, a merch item, a photo, …) has just been deleted.
// Every upload flow in this app (post-images, post-videos, avatars,
// group-covers, business-logos/covers, merch-images, photos) writes to a
// public bucket and saves the resulting public URL on the row — but
// nothing removed the underlying file once that row went away, so deleted
// posts/listings/albums left their images and videos behind in storage
// forever. This takes one or more of those public URLs, works out each
// one's storage path, and removes them from `bucket`.
//
// Deliberately swallows errors and never throws: cleanup here is a nice-to-
// have, not something that should turn "delete this post" into a visible
// failure for the person doing it just because a storage call hiccupped.
export async function deleteStorageFilesFromUrls(bucket, urls) {
  const list = (Array.isArray(urls) ? urls : [urls]).filter(Boolean)
  if (list.length === 0) return
  const marker = `/storage/v1/object/public/${bucket}/`
  const paths = list
    .map((url) => {
      const idx = url.indexOf(marker)
      if (idx === -1) return null
      // Strip the marker prefix and any `?t=...`/query string cache-buster
      // some upload flows append to the public URL.
      return decodeURIComponent(url.slice(idx + marker.length).split('?')[0])
    })
    .filter(Boolean)
  if (paths.length === 0) return
  try {
    await supabase.storage.from(bucket).remove(paths)
  } catch {
    // Best-effort — see comment above.
  }
}
