// Supabase Edge Function: admin-delete-member
//
// An admin permanently removing another member's account (Admin → Members →
// Delete account).
//
// Replaces the admin_delete_member() Postgres RPC, for two reasons:
//
//   1. That RPC did a raw `delete from auth.users`. The codebase's own
//      comments elsewhere state that hosted Supabase can silently no-op such a
//      delete even from a SECURITY DEFINER function — which is exactly why
//      delete_own_account() was abandoned. The Admin API used here is the
//      documented, reliable route, and the two paths no longer rest on
//      different mechanisms.
//   2. The RPC did no storage cleanup, so an admin-deleted member left their
//      CV, avatar, business photos and job attachments sitting in public
//      buckets forever — the same erasure gap self-deletion had.
//
// Deliberately its own function rather than a parameter on delete-account:
// during the window between shipping the frontend and deploying, an
// un-deployed function 404s and nothing happens, whereas a new parameter on
// the existing function would have been silently ignored by the old
// deployment — which deletes *the caller*. An admin clicking "Delete account"
// on a member would have deleted their own admin account.
//
// The admin check is done server-side against the caller's own token. The
// client never gets to assert who it is, only who it wants removed.
//
// Deploy with the Supabase CLI:
//   supabase functions deploy admin-delete-member

import { createClient } from 'npm:@supabase/supabase-js@2'
import { getCorsHeaders, json, purgeAndDeleteUser } from '../_shared/accountCleanup.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json(req, { error: 'Missing Authorization header' }, 401)

    let body: { target_user_id?: string } = {}
    try {
      body = await req.json()
    } catch {
      return json(req, { error: 'Expected a JSON body with target_user_id' }, 400)
    }

    const targetUserId = body?.target_user_id
    if (!targetUserId) return json(req, { error: 'target_user_id is required' }, 400)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    // Client scoped to the caller's own token — used to establish who they
    // really are and whether they're actually an admin.
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: userData, error: userErr } = await callerClient.auth.getUser()
    if (userErr || !userData?.user) return json(req, { error: 'Invalid or expired session' }, 401)

    const callerId = userData.user.id

    // is_admin() reads profiles.is_admin for auth.uid() — evaluated against
    // the caller's own JWT, so a non-admin can't talk their way past it.
    const { data: isAdmin, error: adminCheckErr } = await callerClient.rpc('is_admin')
    if (adminCheckErr || isAdmin !== true) return json(req, { error: 'Only admins can delete accounts.' }, 403)

    // Deleting yourself from the admin screen skips the "are you sure" copy
    // written for self-deletion and, if you're the last admin, locks everyone
    // out of the admin tools permanently. Settings → Delete account is the
    // route for that.
    if (targetUserId === callerId) {
      return json(req, { error: "You can't delete your own account here — use Settings instead" }, 400)
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey)

    // Capture who this is BEFORE deleting — the profile row and the auth user
    // (where the email lives; `profiles` has no email column) are both gone
    // afterwards. The log_member_deletion trigger in schema-update-52.sql
    // can't cover this path: it keys off auth.uid(), which is null under the
    // service-role client used here, so this function writes its own entry.
    const [{ data: actor }, { data: target }, { data: targetAuth, error: targetAuthErr }] = await Promise.all([
      adminClient.from('profiles').select('full_name').eq('id', callerId).maybeSingle(),
      adminClient.from('profiles').select('full_name').eq('id', targetUserId).maybeSingle(),
      adminClient.auth.admin.getUserById(targetUserId),
    ])
    if (targetAuthErr || !targetAuth?.user) {
      return json(req, { error: 'That account no longer exists — it may already have been deleted.' }, 404)
    }
    const targetEmail = targetAuth.user.email ?? null
    const targetName = (target?.full_name ?? '').trim()

    const { error: deleteErr } = await purgeAndDeleteUser(adminClient, targetUserId)
    if (deleteErr) return json(req, { error: `The account could not be deleted: ${deleteErr.message}` }, 400)

    // Only now that the delete has succeeded. A failed delete must never show
    // up in the log as a deletion. A failure to *log* must never be reported
    // as a failed delete either, so the result is checked but not returned.
    const { error: logErr } = await adminClient.from('admin_actions').insert({
      actor_id: callerId,
      actor_name: actor?.full_name ?? 'an admin',
      action: 'delete_member',
      target_type: 'member',
      target_id: targetUserId,
      target_label: targetName || targetEmail || 'a member',
      details: targetName && targetEmail
        ? `${targetEmail} — account and all their content permanently removed`
        : 'Account and all their content permanently removed',
    })
    if (logErr) console.error('admin-delete-member: activity log insert failed', logErr)

    return json(req, { success: true, deleted_user_id: targetUserId })
  } catch (e) {
    return json(req, { error: e.message ?? 'Unknown error' }, 500)
  }
})
