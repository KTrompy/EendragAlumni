// Supabase Edge Function: send-approval-email
//
// Fires when an admin approves a pending member in Admin.jsx (setApproved).
// Sends a "you're verified — come sign in" email via Resend.
//
// Mirrors the auth pattern in admin-delete-member: the caller's own token is
// used to verify they're actually an admin server-side, never trusting a
// role claim from the client. The service-role client is only used to look
// up the target member's email (profiles has no email column — that lives
// on auth.users) and to send the mail.
//
// Required secret (Project Settings → Edge Functions → Secrets, or
// `supabase secrets set RESEND_API_KEY=...`):
//   RESEND_API_KEY
//
// Deploy with the Supabase CLI:
//   supabase functions deploy send-approval-email
//
// Wire-up: in Admin.jsx's setApproved, after a successful approve:
//   if (approved && !error) {
//     supabase.functions.invoke('send-approval-email', { body: { user_id: id } })
//   }
// Deliberately fire-and-forget from the client — a failed email must never
// block or roll back the approval itself.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { getCorsHeaders, json } from '../_shared/accountCleanup.ts'

const SITE_URL = 'https://www.eendragalumni.org'
const FROM_ADDRESS = 'Eendrag Alumni <no-reply@eendragalumni.org>'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json(req, { error: 'Missing Authorization header' }, 401)

    let body: { user_id?: string } = {}
    try {
      body = await req.json()
    } catch {
      return json(req, { error: 'Expected a JSON body with user_id' }, 400)
    }

    const targetUserId = body?.user_id
    if (!targetUserId) return json(req, { error: 'user_id is required' }, 400)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const resendApiKey = Deno.env.get('RESEND_API_KEY')

    if (!resendApiKey) {
      // Fail loudly in logs but don't break the approval flow for the admin.
      console.error('RESEND_API_KEY is not set')
      return json(req, { error: 'Email sending is not configured yet' }, 500)
    }

    // Client scoped to the caller's own token — establishes who they really
    // are and whether they're actually an admin, same as admin-delete-member.
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: userData, error: userErr } = await callerClient.auth.getUser()
    if (userErr || !userData?.user) return json(req, { error: 'Invalid or expired session' }, 401)

    const { data: isAdmin, error: adminCheckErr } = await callerClient.rpc('is_admin')
    if (adminCheckErr || isAdmin !== true) return json(req, { error: 'Admins only' }, 403)

    const adminClient = createClient(supabaseUrl, serviceRoleKey)

    // Name comes from profiles; email only exists on auth.users.
    const [{ data: profile }, { data: authUser, error: authUserErr }] = await Promise.all([
      adminClient.from('profiles').select('full_name').eq('id', targetUserId).maybeSingle(),
      adminClient.auth.admin.getUserById(targetUserId),
    ])

    const email = authUser?.user?.email
    if (authUserErr || !email) {
      return json(req, { error: 'Could not find an email address for that member' }, 400)
    }

    const firstName = (profile?.full_name ?? '').trim().split(/\s+/)[0] || 'there'

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [email],
        subject: "You're verified — welcome to Eendrag Alumni",
        html: `
          <p>Hi ${firstName},</p>
          <p>Good news — your Eendrag Alumni account has been verified by an admin. You can sign in now:</p>
          <p><a href="${SITE_URL}">${SITE_URL}</a></p>
          <p>See you there.</p>
        `,
      }),
    })

    if (!resendRes.ok) {
      const detail = await resendRes.text()
      console.error('Resend send failed:', resendRes.status, detail)
      return json(req, { error: 'Failed to send approval email' }, 502)
    }

    return json(req, { success: true })
  } catch (e) {
    return json(req, { error: e.message ?? 'Unknown error' }, 500)
  }
})
