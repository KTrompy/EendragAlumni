// /admin/help — the handover manual. Replaces AdminHandbook.jsx, which was
// out of date (it said approvals weren't emailed and that there was no
// domain, and never mentioned Decline, Resend or legends).
//
// Written for the next committee member, not a developer. Keep it short and
// keep it true: when the site changes, change this.
const SECTIONS = [
  ['routine', 'The weekly routine'],
  ['signups', 'New signups'],
  ['members', 'Managing members'],
  ['reports', 'Reports and content'],
  ['legends', 'Legends'],
  ['log', 'Activity log'],
  ['broken', 'When something breaks'],
  ['handover', 'Handing over'],
  ['technical', 'For a developer'],
]

export default function AdminHelp() {
  return (
    <div className="adm-page adm-help">
      <header className="adm-head">
        <h1 className="adm-title">Help</h1>
      </header>
      <p className="adm-lede">How to run Eendrag Alumni at <strong>eendragalumni.org</strong>. Read the first three sections now; the rest when you need them.</p>

      <nav className="adm-help-toc" aria-label="On this page">
        <ol>
          {SECTIONS.map(([id, label]) => <li key={id}><a href={`#help-${id}`}>{label}</a></li>)}
        </ol>
      </nav>

      <section id="help-routine">
        <h2 className="adm-h2">The weekly routine</h2>
        <ol>
          <li>Open <strong>Overview</strong>. If it says <em>All caught up</em>, you&rsquo;re done.</li>
          <li>Approve or decline the people waiting. Only approve someone you can place as an Eendragter — ask a classmate if you&rsquo;re unsure. Waiting costs them nothing.</li>
          <li>Deal with any open reports.</li>
        </ol>
        <p>Admins get a notification (the bell) when someone finishes signing up and when something is reported.</p>
      </section>

      <section id="help-signups">
        <h2 className="adm-h2">New signups</h2>
        <dl className="adm-help-dl">
          <dt>Email confirmation</dt>
          <dd>Every new account must click the link in their confirmation email before they can sign in. Until they do, they show as <strong>Unconfirmed</strong> and can&rsquo;t be approved — the database refuses it.</dd>
          <dt>Resend confirmation</dt>
          <dd>Sends a fresh link to an Unconfirmed member (Members → the person → Resend confirmation). Tell them to check spam. Supabase limits how often one address can be sent a link, so wait a minute between tries.</dd>
          <dt>Signup incomplete</dt>
          <dd>Usually someone who used the Google button and closed the tab before the short form. Nothing to approve yet; they move to Pending by themselves when they come back.</dd>
          <dt>Approve</dt>
          <dd>Gives full access: the directory, messaging and posting. They&rsquo;re emailed automatically (&ldquo;you&rsquo;re verified&rdquo;). If that email fails, you&rsquo;ll see an error and should tell them yourself. Undo straight after moves them back to pending.</dd>
          <dt>Decline</dt>
          <dd>For someone who isn&rsquo;t an Eendragter. They&rsquo;re emailed that we couldn&rsquo;t match them to residence records, with your optional reason, and see the same message if they sign in. Nothing is deleted, and <strong>Undo decline</strong> puts them back in the queue.</dd>
        </dl>
      </section>

      <section id="help-members">
        <h2 className="adm-h2">Managing members</h2>
        <dl className="adm-help-dl">
          <dt>Move back to pending</dt>
          <dd>Pauses someone&rsquo;s access without losing anything. The right tool for &ldquo;I approved the wrong person&rdquo; or anything you need time to sort out.</dd>
          <dt>Make admin / Remove admin</dt>
          <dd>An admin has exactly your powers, including deleting accounts and removing other admins. The site won&rsquo;t let you change your own role, remove the last admin, or make an admin of someone who hasn&rsquo;t finished signing up. Keep at least two admins.</dd>
          <dt>Delete account</dt>
          <dd><strong>Permanent, with no backup.</strong> Removes their login, profile, posts, comments, listings, events, RSVPs and uploaded files. Use it for spam and for people who ask to be removed (they can also do it themselves in Settings). Deleting another admin asks you to type their name first.</dd>
        </dl>
      </section>

      <section id="help-reports">
        <h2 className="adm-h2">Reports and content</h2>
        <dl className="adm-help-dl">
          <dt>Remove &amp; resolve</dt>
          <dd>Deletes the reported post, job or business for everyone and closes the report (and any other open reports on the same item).</dd>
          <dt>Resolve</dt>
          <dd>Closes a report without deleting anything — for reported profiles, or when the item is already gone.</dd>
          <dt>Dismiss</dt>
          <dd>Nothing wrong. Closes the report. Resolved reports can be reopened.</dd>
          <dt>Content</dt>
          <dd>Every post, job, event and business, newest first, with search. Delete is permanent; deleting an event also removes its RSVPs, and deleting a job removes its applications. Members can delete their own things, so you only need this for content that shouldn&rsquo;t be up.</dd>
          <dt>Feature a business</dt>
          <dd>Pins it to the top of the business directory. Only admins can do this — the database refuses anyone else. Agree a rule with the committee (sponsors only, say) so it doesn&rsquo;t become a favour.</dd>
        </dl>
      </section>

      <section id="help-legends">
        <h2 className="adm-h2">Legends</h2>
        <p>Notable old boys shown on the home page. Three visible legends show at a time and the set rotates every week, in the order on the Legends page, so add at least six before it repeats. A photo, a name and a one-line claim to fame are required; landscape photos crop best.</p>
        <p><strong>Hide</strong> takes someone off the home page and keeps the write-up. <strong>Delete</strong> removes it and the photo for good. Read-more links must start with <code>https://</code>.</p>
      </section>

      <section id="help-log">
        <h2 className="adm-h2">Activity log</h2>
        <p>Records who approved, declined, deleted, featured or changed what, and when — including legend edits and report decisions. It&rsquo;s written by the database, so nobody (including you) can edit or erase it.</p>
      </section>

      <section id="help-broken">
        <h2 className="adm-h2">When something breaks</h2>
        <ol>
          <li>Refresh. Then sign out and back in.</li>
          <li>Try another browser or your phone.</li>
          <li>If a page says <em>Couldn&rsquo;t load…</em>, press Retry. If it keeps failing, note the message underneath — it says what went wrong.</li>
          <li>&ldquo;The … server function isn&rsquo;t deployed yet&rdquo; means a technical person needs to deploy it. Nothing was changed.</li>
        </ol>
        <p><strong>Stop and call someone technical</strong> if members see other people&rsquo;s data, the site is down for hours, or anyone asks you to paste something into an &ldquo;SQL editor&rdquo;.</p>
        <p>Never share the hosting or database logins outside the committee, and never take the member list off this site.</p>
      </section>

      <section id="help-handover">
        <h2 className="adm-h2">Handing over</h2>
        <table className="adm-table adm-help-table">
          <thead><tr><th scope="col">Service</th><th scope="col">What it does</th></tr></thead>
          <tbody>
            <tr><td>Vercel</td><td>Serves the website. Rebuilds automatically from GitHub.</td></tr>
            <tr><td>Supabase</td><td>The database, logins, file storage and the server functions. The data lives here and nowhere else.</td></tr>
            <tr><td>Resend</td><td>Sends the approval and decline emails.</td></tr>
            <tr><td>Mapbox</td><td>The alumni map. If it lapses, only the map breaks.</td></tr>
            <tr><td>Cloudflare Turnstile</td><td>The &ldquo;are you human&rdquo; check on signup.</td></tr>
            <tr><td>Domain</td><td>eendragalumni.org. <span className="adm-todo">To fill in: registrar and renewal date.</span></td></tr>
          </tbody>
        </table>
        <ol>
          <li>Move every service above to a shared committee email address, not a personal one.</li>
          <li>Keep the passwords in a shared password manager.</li>
          <li>Make the incoming person an admin and watch them approve someone once.</li>
          <li>Export a database backup from Supabase and give the committee a copy. The free plan keeps no automatic backups.</li>
          <li>Make sure the committee controls the GitHub repository.</li>
        </ol>
      </section>

      <section id="help-technical">
        <h2 className="adm-h2">For a developer</h2>
        <ul>
          <li>React 18 + Vite SPA talking straight to Supabase. Row-level security and triggers do the real enforcement; the admin UI only hides what would fail.</li>
          <li>Database changes are numbered <code>schema-update-N.sql</code> files, run in order in the Supabase SQL Editor.</li>
          <li>Edge Functions: <code>admin-delete-member</code>, <code>delete-account</code>, <code>send-contact-email</code> (member-to-member email, nothing stored), <code>send-approval-email</code>, <code>send-member-email</code>. Deploy with <code>supabase functions deploy &lt;name&gt;</code>.</li>
          <li>Admin code lives in <code>src/components/admin/</code>; data access is in <code>adminApi.js</code>.</li>
        </ul>
      </section>
    </div>
  )
}
