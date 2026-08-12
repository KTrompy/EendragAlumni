// Supabase Edge Function: admin-create-ghost
//
// An admin creating a "ghost" account (Admin → Members → Add ghost account):
// a browse-only, invisible member with its own separate email and password.
// See schema-update-58.sql for what "ghost" means and how it's enforced.
//
// Why an Edge Function rather than an RPC: creating an auth user needs the
// service-role key. schema-update-3 records that hosted Supabase silently
// no-ops raw writes to auth.users even from a SECURITY DEFINER function —
// that's why delete_own_account() was abandoned in favour of the Admin API,
// and the same argument applies in reverse here. auth.admin.createUser() is
// the documented route.
//
// The admin check runs server-side against the caller's own token. The client
// says what it wants created, never who it is.
//
// Deploy with the Supabase CLI:
//   supabase functions deploy admin-create-ghost

import { createClient } from 'npm:@supabase/supabase-js@2'
import { getCorsHeaders, json } from '../_shared/accountCleanup.ts'

// Matches passwordProblem() in src/passwordRules.jsx, which is what the
// signup form enforces. A ghost's password is typed by an admin into the
// same kind of field and protects the same kind of account, so it gets the
// same floor — this is the server-side half of that check, since the client
// one is only a courtesy.
function passwordProblem(pw: string): string | null {
  if (!pw || pw.length < 8) return 'Password must be at least 8 characters'
  if (!/[a-z]/.test(pw)) return 'Password must contain a lowercase letter'
  if (!/[A-Z]/.test(pw)) return 'Password must contain an uppercase letter'
  if (!/[0-9]/.test(pw)) return 'Password must contain a number'
  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json(req, { error: 'Missing Authorization header' }, 401)

    let body: { email?: string; password?: string; label?: string } = {}
    try {
      body = await req.json()
    } catch {
      return json(req, { error: 'Expected a JSON body' }, 400)
    }

    const email = (body?.email ?? '').trim().toLowerCase()
    const password = body?.password ?? ''
    // Shown only in Admin → Members, so an admin can tell one ghost from
    // another. No other member can ever read it — the profiles SELECT policy
    // won't hand them the row.
    const label = (body?.label ?? '').trim() || 'Ghost account'

    if (!email || !email.includes('@')) return json(req, { error: 'A valid email address is required' }, 400)
    const pwProblem = passwordProblem(password)
    if (pwProblem) return json(req, { error: pwProblem }, 400)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    // Scoped to the caller's own token — establishes who they really are.
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: userData, error: userErr } = await callerClient.auth.getUser()
    if (userErr || !userData?.user) return json(req, { error: 'Invalid or expired session' }, 401)
    const callerId = userData.user.id

    const { data: isAdmin, error: adminCheckErr } = await callerClient.rpc('is_admin')
    if (adminCheckErr || isAdmin !== true) return json(req, { error: 'Admins only' }, 403)

    const adminClient = createClient(supabaseUrl, serviceRoleKey)

    // email_confirm: true because nobody is going to click a link in this
    // mailbox — it may not even be a real one. It also has to be set for the
    // account to be approvable at all: require_confirmed_email_for_approval
    // (schema-update-53) refuses to flip approved on an unconfirmed address,
    // and a ghost is created already-approved.
    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (createErr || !created?.user) {
      const msg = createErr?.message ?? 'Could not create the account'
      // Supabase phrases this as "already been registered"; say which address,
      // because an admin creating several of these in a row won't remember.
      const friendly = /already/i.test(msg)
        ? `An account already exists for ${email}`
        : msg
      return json(req, { error: friendly }, 400)
    }

    const ghostId = created.user.id

    // handle_new_user has already inserted the profiles row by now. Update
    // rather than insert so this doesn't race it: consented_at and approved
    // are set here because a ghost never goes through FinishSignup or the
    // committee's verification queue — App.jsx would otherwise park them on
    // one of those screens forever.
    //
    // Sent through the CALLER's client, not adminClient, and that is not
    // incidental. profiles carries three BEFORE UPDATE triggers that gate
    // exactly the columns being written here — prevent_self_privilege_escalation
    // (approved, is_ghost), prevent_ghost_admin and
    // require_confirmed_email_for_approval — and the first of those decides
    // via public.is_admin(), which resolves auth.uid(). Under the service-role
    // client auth.uid() is null, is_admin() comes back false, and the update
    // dies on "Only an admin can change approval status." The admin's own
    // token satisfies both the trigger and the "Admins can update any profile"
    // policy, and has the side benefit that log_profile_admin_change attributes
    // the change to a real person instead of nobody.
    const { data: updated, error: profileErr } = await callerClient
      .from('profiles')
      .update({
        full_name: label,
        is_ghost: true,
        approved: true,
        consented_at: new Date().toISOString(),
        // Nothing reads these for a ghost, but leaving the "complete your
        // profile" nudge fields empty is what CompleteProfilePrompt reacts to.
        privacy_email: 'hide',
        privacy_phone: 'hide',
        privacy_location: 'hide',
        privacy_messages: 'hide',
      })
      .eq('id', ghostId)
      // Without this the call reports success on zero rows matched, which is
      // what a lost race against handle_new_user would look like — an auth
      // user with no profile row and no ghost flag.
      .select('id, is_ghost')
      .maybeSingle()

    if (profileErr || !updated?.is_ghost) {
      // A half-made ghost is worse than none: the auth user would exist, be
      // able to sign in, and NOT be flagged — an ordinary unapproved member
      // sitting in the committee's queue under a fake name. Roll it back.
      await adminClient.auth.admin.deleteUser(ghostId)
      const why = profileErr?.message ?? 'the profile row was not there to update'
      return json(req, { error: `Account created but could not be set up as a ghost, so it was removed again: ${why}` }, 400)
    }

    // Same reasoning as admin-delete-member: the log_profile_admin_change
    // trigger keys off auth.uid(), which is null under the service-role
    // client, so this path has to write its own entry. A logging failure must
    // never be reported as a failure to create the account.
    const { data: actor } = await adminClient
      .from('profiles').select('full_name').eq('id', callerId).maybeSingle()
    await adminClient.from('admin_actions').insert({
      actor_id: callerId,
      actor_name: actor?.full_name ?? 'an admin',
      action: 'create_ghost',
      target_type: 'member',
      target_id: ghostId,
      target_label: label,
      details: `Browse-only invisible account created for ${email}`,
    })

    return json(req, { success: true, user_id: ghostId, email })
  } catch (e) {
    return json(req, { error: e.message ?? 'Unknown error' }, 500)
  }
})
