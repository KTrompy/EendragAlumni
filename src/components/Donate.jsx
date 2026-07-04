import { Rings } from '../App.jsx'

// Placeholder — no payment integration yet. When you're ready to accept
// donations, hook up PayFast (SA-standard) or a Stripe Payment Link and
// swap the "Get in touch" button for a real donate button.
export default function Donate() {
  return (
    <div className="donate-panel">
      <div style={{ color: 'var(--orange)', display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
        <Rings size={46} />
      </div>
      <h2>Support the house</h2>
      <p>
        Eendrag has shaped Eendragters since 1961. If it shaped you, consider
        giving something back — every contribution keeps the house strong for
        the next intake.
      </p>

      <div className="pillars">
        <div className="donate-pillar">
          <strong>Bursaries</strong>
          <span>Help academically strong students who couldn't otherwise afford Stellenbosch call Eendrag home.</span>
        </div>
        <div className="donate-pillar">
          <strong>House projects</strong>
          <span>Renovations, sports gear, common-room upgrades — the small things that make the house what it is.</span>
        </div>
        <div className="donate-pillar">
          <strong>Reunions & events</strong>
          <span>Underwrite the get-togethers that keep the alumni network alive year on year.</span>
        </div>
      </div>

      <p>
        For now, contributions are arranged directly with the alumni committee.
        Reach out and we'll walk you through the options.
      </p>

      <a className="btn primary" href="mailto:alumni@eendrag.example.com?subject=Supporting Eendrag">
        Get in touch
      </a>

      <p style={{ marginTop: 24, fontSize: 12, color: 'var(--ink-soft)' }}>
        Karakter · Styl · Trots · sedert 1961
      </p>
    </div>
  )
}
