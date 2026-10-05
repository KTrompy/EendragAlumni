// Supabase Edge Function: send-contact-email
//
// Replaces the in-app chat. Every "Message" button on the site opens
// ContactModal.jsx, which calls this function; it relays ONE email to the
// recipient through Resend. Nothing is stored — no thread, no history, no
// message row. The conversation lives in the two people's own inboxes.
//
// Auth model:
//   The caller's own token proves who they are — a sender id in the request
//   body is never trusted — and the caller must be an approved member (the
//   same is_approved() gate every write in the app uses). The recipient must
//   be an approved profile who hasn't switched off "Who can email you through
//   the site" (profiles.privacy_messages, Settings → Privacy). The recipient's
//   email address is looked up here with the service-role key and never
//   reaches the sender's browser.
//
// Why Reply-To instead of a real "From":
//   Resend can only send from a domain this project has verified
//   (eendragalumni.org), not from someone's personal Gmail. So the email
//   arrives from no-reply@eendragalumni.org with the sender's name attached,
//   and Reply-To is the sender's real address, so "Reply" in any mail app goes
//   straight to them. The sender is told this in the compose box, because the
//   recipient will see their address when they reply.
//
// Extras on top of a plain relay:
//   - the email names the sender with their class year and work, and links to
//     their profile on the site
//   - optional copy to the sender ("Email me a copy"), because the site keeps
//     no history of what was sent
//   - a footer link to Settings → Privacy to switch these emails off
//
// Required secret (Project Settings → Edge Functions → Secrets):
//   RESEND_API_KEY
//
// Deploy: Supabase dashboard → Edge Functions → Deploy a new function → via
// editor, named exactly `send-contact-email`. (CORS is inlined, like
// send-member-email, so this is one self-contained file.)

import { createClient } from 'npm:@supabase/supabase-js@2'

// Keep ALLOWED_ORIGINS in step with the copy in _shared/accountCleanup.ts and
// send-member-email — the production domain MUST be listed, or the browser
// blocks the response and the email silently never sends.
const ALLOWED_ORIGINS = [
  'https://eendragalumni.org',
  'https://www.eendragalumni.org',
  'https://eendrag-alumni-six.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
]
const PREVIEW_ORIGIN_RE = /^https:\/\/eendrag-alumni[a-z0-9-]*\.vercel\.app$/

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') ?? ''
  const allowed = ALLOWED_ORIGINS.includes(origin) || PREVIEW_ORIGIN_RE.test(origin)
  return {
    'Access-Control-Allow-Origin': allowed ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
  })
}

const SITE_URL = 'https://www.eendragalumni.org'
const FROM_ADDRESS = 'no-reply@eendragalumni.org'
const MAX_SUBJECT = 150
const MAX_MESSAGE = 4000

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// A display name goes into an email header ("From: <name> <addr>") — strip
// anything that could break out of it (newlines, angle brackets, quotes)
// rather than trying to escape it correctly for every mail client.
function sanitizeHeaderName(s: string): string {
  return s.replace(/[\r\n"<>]/g, '').trim().slice(0, 100)
}

// Same idea for the subject line: one line, no header injection.
function sanitizeSubject(s: string): string {
  return s.replace(/[\r\n]+/g, ' ').trim().slice(0, MAX_SUBJECT)
}

// Same table-based shell as send-member-email and send-approval-email, so the
// site's emails read as one product. Inline styles only — Outlook throws away
// <style> blocks.
function shell(heading: string, bodyHtml: string, footerNote: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<body style="margin:0; padding:0; background:#FAF7F2; font-family:'Inter',Arial,sans-serif; color:#1A1A1A;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAF7F2; padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px; width:100%; background:#FFFFFF; border-radius:12px; overflow:hidden; box-shadow:0 2px 8px rgba(26,26,26,0.06);">
          <tr>
            <td style="background:#5A1A2B; padding:20px 32px;">
              <span style="font-family:Georgia,'Times New Roman',serif; font-size:20px; color:#FFFFFF; letter-spacing:0.02em;">Eendrag Alumni</span>
            </td>
          </tr>
          <tr>
            <td style="padding:36px 32px 28px;">
              <h1 style="margin:0 0 16px; font-family:Georgia,'Times New Roman',serif; font-size:22px; color:#5A1A2B;">${heading}</h1>
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px; border-top:1px solid #E8E1D5;">
              <p style="margin:0; font-size:12px; line-height:1.6; color:#5C5C5C;">
                Eendrag Alumni · <a href="${SITE_URL}" style="color:#5C5C5C;">eendragalumni.org</a><br>
                ${footerNote}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim()
}

const P = 'margin:0 0 16px; font-size:15px; line-height:1.6; color:#1A1A1A; white-space:pre-wrap;'

async function sendViaResend(apiKey: string, payload: Record<string, unknown>) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const detail = await res.text()
    console.error('Resend send failed:', res.status, detail)
  }
  return res.ok
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json(req, { error: 'Missing Authorization header' }, 401)

    let body: { recipient_id?: string; subject?: string; message?: string; send_copy?: boolean } = {}
    try {
      body = await req.json()
    } catch {
      return json(req, { error: 'Expected a JSON body' }, 400)
    }

    const recipientId = typeof body?.recipient_id === 'string' ? body.recipient_id.trim() : ''
    const message = typeof body?.message === 'string' ? body.message.trim() : ''
    const subjectInput = typeof body?.subject === 'string' ? body.subject : ''
    const sendCopy = body?.send_copy === true

    if (!recipientId) return json(req, { error: 'recipient_id is required' }, 400)
    if (!message) return json(req, { error: 'Please write a message.' }, 400)
    if (message.length > MAX_MESSAGE) {
      return json(req, { error: `Message is too long (max ${MAX_MESSAGE} characters).` }, 400)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const resendApiKey = Deno.env.get('RESEND_API_KEY')

    if (!resendApiKey) {
      console.error('RESEND_API_KEY is not set')
      return json(req, { error: 'Email sending is not configured yet' }, 500)
    }

    // Who's actually sending this — never trust a sender id from the body.
    const callerClient = createClient(supabaseUrl!, anonKey!, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: userData, error: userErr } = await callerClient.auth.getUser()
    if (userErr || !userData?.user) return json(req, { error: 'Invalid or expired session' }, 401)

    const senderId = userData.user.id
    const senderEmail = userData.user.email
    if (!senderEmail) return json(req, { error: 'Your account has no email on file' }, 400)

    if (recipientId === senderId) {
      return json(req, { error: "You can't email yourself." }, 400)
    }

    // Only approved members can send — the same gate every write in the app
    // respects.
    const { data: isApproved, error: approvedErr } = await callerClient.rpc('is_approved')
    if (approvedErr || isApproved !== true) {
      return json(req, { error: 'Your account must be approved before you can contact other members.' }, 403)
    }

    const adminClient = createClient(supabaseUrl!, serviceRoleKey!)

    const [{ data: senderProfile }, { data: recipientProfile }, { data: recipientAuthUser, error: recipientAuthErr }] =
      await Promise.all([
        adminClient.from('profiles')
          .select('full_name, first_name, grad_year, occupation, company')
          .eq('id', senderId).maybeSingle(),
        adminClient.from('profiles')
          .select('full_name, approved, privacy_messages')
          .eq('id', recipientId).maybeSingle(),
        adminClient.auth.admin.getUserById(recipientId),
      ])

    if (!recipientProfile || recipientProfile.approved !== true) {
      return json(req, { error: 'Could not find that member.' }, 404)
    }

    // "Who can email you through the site?" — Settings → Privacy. Anything
    // other than 'all' (including the retired 'mentoring' value) means no.
    if (recipientProfile.privacy_messages !== 'all') {
      return json(req, { error: 'This member is not accepting messages through the site right now.' }, 403)
    }

    const recipientEmail = recipientAuthUser?.user?.email
    if (recipientAuthErr || !recipientEmail) {
      return json(req, { error: 'Could not find an email address for that member.' }, 400)
    }

    const senderFullName = (senderProfile?.full_name ?? '').trim() || 'A fellow Eendragter'
    const senderFirstName =
      (senderProfile?.first_name ?? '').trim() || senderFullName.split(/\s+/)[0] || 'A fellow Eendragter'
    const recipientFullName = (recipientProfile.full_name ?? '').trim() || 'your fellow Eendragter'
    const recipientFirstName = recipientFullName.split(/\s+/)[0] || 'there'

    // One line of context so the recipient knows who this is before replying:
    // "Class of 2012 · Engineer at Acme". All fields are already visible to
    // every approved member on the site.
    const work = [senderProfile?.occupation, senderProfile?.company].map((x) => (x ?? '').trim()).filter(Boolean)
    const contextBits: string[] = []
    if (senderProfile?.grad_year) contextBits.push(`Class of ${senderProfile.grad_year}`)
    if (work.length === 2) contextBits.push(`${work[0]} at ${work[1]}`)
    else if (work.length === 1) contextBits.push(work[0])
    const contextLine = contextBits.join(' · ')

    const subject = sanitizeSubject(subjectInput) || sanitizeSubject(`Message from ${senderFullName} via Eendrag Alumni`)
    const fromName = sanitizeHeaderName(`${senderFullName} (via Eendrag Alumni)`) || 'Eendrag Alumni'
    const profileUrl = `${SITE_URL}/people/${senderId}`
    const settingsUrl = `${SITE_URL}/settings`

    const html = shell(
      `${escapeHtml(senderFirstName)} sent you a message`,
      `
      <p style="margin:0 0 20px; font-size:13px; line-height:1.5; color:#5C5C5C;">
        <strong style="color:#1A1A1A;">${escapeHtml(senderFullName)}</strong>${contextLine ? `<br>${escapeHtml(contextLine)}` : ''}
      </p>
      <p style="${P}">${escapeHtml(message)}</p>
      <p style="margin:24px 0 20px; font-size:14px; line-height:1.6; color:#1A1A1A;">
        Just hit reply &mdash; it goes straight to ${escapeHtml(senderFirstName)}, not to us.
      </p>
      <a href="${profileUrl}" style="display:inline-block; padding:10px 22px; font-size:14px; font-weight:600; color:#FFFFFF; background:#5A1A2B; border-radius:8px; text-decoration:none;">View ${escapeHtml(senderFirstName)}&rsquo;s profile</a>`,
      `You&rsquo;re receiving this because ${escapeHtml(senderFullName)} messaged you through eendragalumni.org. We pass it on and don&rsquo;t read or keep it.<br>
       Don&rsquo;t want these? Set &ldquo;Who can email you through the site?&rdquo; to Hide in <a href="${settingsUrl}" style="color:#5C5C5C;">Settings</a>.`,
    )
    const text =
      `${senderFullName}${contextLine ? ` (${contextLine})` : ''} sent you a message:\n\n${message}\n\n---\n` +
      `Just hit reply — it goes straight to ${senderFirstName}, not to us.\n` +
      `View their profile: ${profileUrl}\n` +
      `Don't want these emails? Set "Who can email you through the site?" to Hide in Settings: ${settingsUrl}`

    const delivered = await sendViaResend(resendApiKey, {
      from: `${fromName} <${FROM_ADDRESS}>`,
      to: [recipientEmail],
      reply_to: senderEmail,
      subject,
      html,
      text,
    })
    if (!delivered) return json(req, { error: 'Failed to send email' }, 502)

    // Optional copy to the sender. A failure here must not turn a delivered
    // message into an error — the message already went.
    let copySent = false
    if (sendCopy) {
      const copyHtml = shell(
        `Copy of your message to ${escapeHtml(recipientFirstName)}`,
        `
        <p style="margin:0 0 12px; font-size:13px; line-height:1.5; color:#5C5C5C;">You asked for a copy of this for your records. It was sent to ${escapeHtml(recipientFullName)}.</p>
        <p style="margin:0 0 6px; font-size:13px; color:#5C5C5C;">Subject: ${escapeHtml(subject)}</p>
        <p style="${P}">${escapeHtml(message)}</p>`,
        `Sent through eendragalumni.org. Their reply will come to this address.`,
      )
      copySent = await sendViaResend(resendApiKey, {
        from: `Eendrag Alumni <${FROM_ADDRESS}>`,
        to: [senderEmail],
        subject: sanitizeSubject(`Copy: ${subject}`),
        html: copyHtml,
        text: `You asked for a copy of this message. It was sent to ${recipientFullName}.\n\nSubject: ${subject}\n\n${message}`,
      })
    }

    return json(req, { success: true, recipient_first_name: recipientFirstName, copy_sent: copySent })
  } catch (e) {
    return json(req, { error: (e as Error).message ?? 'Unknown error' }, 500)
  }
})
