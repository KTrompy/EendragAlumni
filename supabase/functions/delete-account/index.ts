// Supabase Edge Function: delete-account
//
// Why this exists: a plain Postgres function running as SECURITY DEFINER
// cannot reliably delete rows from auth.users on hosted Supabase — Supabase
// protects that table so it can only be removed through the Admin API,
// which requires the service-role key. That key must never be shipped to
// the browser, so the delete has to happen here, server-side.
//
// Flow:
//   1. Read the caller's access token from the Authorization header.
//   2. Verify it against Supabase Auth to find out who is actually calling
//      (never trust a user id sent from the client).
//   3. Use the service-role client to permanently delete that auth user.
//      Deleting the auth user cascades (via "on delete cascade" foreign
//      keys) through public.profiles and everything that references it —
//      posts, messages, jobs, events, likes, comments.
//   4. Clean up storage objects (avatar + post images), which aren't
//      covered by the database cascade.
//
// Deploy with the Supabase CLI:
//   supabase functions deploy delete-account
//
// No extra secrets need to be set — SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are provided automatically to every Edge
// Function by the Supabase platform.

import { createClient } from 'npm:@supabase/supabase-js@2'

// Only allow requests from the actual site origin(s).
// Add your production domain(s) here; localhost is included for local dev.
const ALLOWED_ORIGINS = [
  'https://eendrag-alumni-six.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
]

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') ?? ''
  // Also allow Vercel preview deploys (*.vercel.app)
  const allowed = ALLOWED_ORIGINS.includes(origin)
    || origin.endsWith('.vercel.app')
  return {
    'Access-Control-Allow-Origin': allowed ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Vary': 'Origin',
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    // Client scoped to the caller's own token, used only to identify them
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: userData, error: userErr } = await callerClient.auth.getUser()
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Invalid or expired session' }), {
        status: 401,
        headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
      })
    }

    const userId = userData.user.id

    // Admin client, only ever used inside this server-side function
    const adminClient = createClient(supabaseUrl, serviceRoleKey)

    // Clean up storage objects not covered by FK cascade
    await adminClient.storage
      .from('avatars')
      .remove([`${userId}/avatar.jpg`])
      .catch(() => {})

    const { data: postImages } = await adminClient.storage
      .from('post-images')
      .list(userId)
    if (postImages?.length) {
      await adminClient.storage
        .from('post-images')
        .remove(postImages.map((f) => `${userId}/${f.name}`))
    }

    // The actual account deletion — cascades through all owned data
    const { error: deleteErr } = await adminClient.auth.admin.deleteUser(userId)
    if (deleteErr) {
      return new Response(JSON.stringify({ error: deleteErr.message }), {
        status: 400,
        headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message ?? 'Unknown error' }), {
      status: 500,
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
    })
  }
})
