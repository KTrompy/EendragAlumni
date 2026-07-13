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
