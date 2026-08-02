import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import useModal from '../useModal.js'

// Eendrag legends — the photo mosaic on Home.
//
// Admin-curated (see the `legends` table in schema-update-54.sql), not derived
// from member profiles: the people here are mostly long gone and were never on
// the hub, so there's no account to hang any of it off.
//
// The whole design leans on the photography — full-bleed portrait, dark scrim,
// white type over it — which is why a photo is required by the Admin form. A
// tile with no image would be a hole in the grid, not a smaller tile.

// Labels and pill colours live here rather than in the database so the palette
// can't drift; the DB only stores the key, and legends_category_check keeps it
// to this list. `class` maps to a .legend-pill-* rule in styles.css.
export const LEGEND_CATEGORIES = [
  { key: 'sport', label: 'Sport' },
  { key: 'business', label: 'Business' },
  { key: 'politics', label: 'Politics' },
  { key: 'arts', label: 'Arts' },
  { key: 'academia', label: 'Academia' },
  { key: 'military', label: 'Military' },
  { key: 'medicine', label: 'Medicine' },
  { key: 'media', label: 'Media' },
  { key: 'service', label: 'Public service' },
  { key: 'other', label: 'Eendrag' },
]

const CATEGORY_LABEL = Object.fromEntries(LEGEND_CATEGORIES.map((c) => [c.key, c.label]))

// How many tiles the mosaic shows at once: one hero plus two stacked beside it.
const TILE_COUNT = 3

// Which three are featured this week.
//
// Deterministic from the date rather than random, so every member sees the same
// three people at the same time — that's what makes it feel like a weekly
// spotlight rather than a shuffle, and it means someone can mention "did you
// see who's up this week" and be understood.
//
// The epoch fell on a Thursday, so a plain week-count would roll over on
// Thursday mornings; the 4-day offset moves the boundary to Monday, which is
// when people actually come back to a site like this.
function weekNumber() {
  return Math.floor((Date.now() - 4 * 86400000) / 604800000)
}

export function legendMeta(l) {
  return [l.years, l.degree].filter(Boolean).join(' · ')
}

export default function LegendsBand() {
  const [legends, setLegends] = useState([])
  const [loading, setLoading] = useState(true)
  // Manual browsing offset, added on top of the weekly one. Starts at 0 so the
  // first thing you see is always this week's set.
  const [offset, setOffset] = useState(0)
  const [open, setOpen] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data, error } = await supabase
        .from('legends')
        .select('id, name, years, degree, category, headline, story, photo_url, link_url, link_label')
        .eq('active', true)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true })
        .limit(48)
      if (cancelled) return
      // No error state and no empty state on purpose — if this fails or there's
      // nothing curated yet, the band renders nothing at all rather than a
      // "no legends yet" box. It's an editorial extra on someone else's home
      // page; an empty frame for it would be worse than its absence.
      if (!error) setLegends(data || [])
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [])

  // Rotate the list, then take the first few — wrapping rather than slicing so
  // the mosaic is always full even when the window straddles the end of the
  // list. With fewer than TILE_COUNT entries this yields exactly what exists
  // (no duplicates), and the grid collapses to match.
  const featured = useMemo(() => {
    if (legends.length === 0) return []
    const start = ((weekNumber() + offset) * TILE_COUNT) % legends.length
    const out = []
    for (let i = 0; i < Math.min(TILE_COUNT, legends.length); i++) {
      out.push(legends[(start + i) % legends.length])
    }
    return out
  }, [legends, offset])

  if (loading || featured.length === 0) return null

  const [hero, ...rest] = featured

  return (
    <section className="legends-band" aria-labelledby="legends-heading">
      <div className="legends-head">
        <div className="legends-head-text">
          <h3 className="legends-title" id="legends-heading">Eendrag legends</h3>
          <p className="legends-sub">Old boys who left a mark</p>
        </div>
        {legends.length > TILE_COUNT && (
          <button type="button" className="legends-more" onClick={() => setOffset((o) => o + 1)}>
            Show others <ArrowRightIcon />
          </button>
        )}
      </div>

      <div className={rest.length > 0 ? 'legends-grid' : 'legends-grid legends-grid-single'}>
        <LegendTile legend={hero} hero onOpen={setOpen} />
        {/* legends-stack-one: with exactly two legends curated there's only one
            tile to stack, and a two-row grid would leave it floating in the top
            half with a hole underneath. */}
        {rest.length > 0 && (
          <div className={rest.length === 1 ? 'legends-stack legends-stack-one' : 'legends-stack'}>
            {rest.map((l) => <LegendTile key={l.id} legend={l} onOpen={setOpen} />)}
          </div>
        )}
      </div>

      {open && <LegendModal legend={open} onClose={() => setOpen(null)} />}
    </section>
  )
}

function LegendTile({ legend, hero = false, onOpen }) {
  const meta = legendMeta(legend)
  return (
    <article className={hero ? 'legend-tile legend-tile-hero' : 'legend-tile'}>
      {/* alt="" — the photo is decorative here in the strict sense: everything
          it conveys (who this is, what they did) is already in the text sitting
          on top of it, which a screen reader will read out anyway. Naming the
          portrait as well would just say the person's name twice. */}
      <img className="legend-tile-photo" src={legend.photo_url} alt="" loading="lazy" />
      <div className="legend-tile-scrim" aria-hidden="true" />
      <span className={`legend-pill legend-pill-${legend.category}`}>
        {CATEGORY_LABEL[legend.category] || 'Eendrag'}
      </span>
      <div className="legend-tile-body">
        <h4 className="legend-tile-name">{legend.name}</h4>
        <p className="legend-tile-headline">{legend.headline}</p>
        {meta && <p className="legend-tile-meta">{meta}</p>}
      </div>
      {/* A button, not a Link — this opens a modal on the page rather than
          navigating, so there's no URL for a link to point at. Same stretched
          fill as the card links elsewhere, so the whole tile is the hit area
          and the focus ring wraps the tile rather than a word inside it. */}
      <button type="button" className="stretched-link" onClick={() => onOpen(legend)}>
        <span className="sr-only">{`Read about ${legend.name}`}</span>
      </button>
    </article>
  )
}

function LegendModal({ legend, onClose }) {
  const ref = useModal({ onClose })
  const meta = legendMeta(legend)
  // Story is stored as plain text, so paragraph breaks are blank lines. Split
  // rather than white-space: pre-wrap so the spacing between paragraphs is the
  // stylesheet's decision, not the typist's.
  const paragraphs = (legend.story || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="legend-modal-title">
      <div className="modal legend-modal" ref={ref} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 id="legend-modal-title">{legend.name}</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          <div className="legend-modal-photo">
            <img src={legend.photo_url} alt={`Portrait of ${legend.name}`} />
          </div>
          <div className="legend-modal-meta">
            <span className={`legend-pill legend-pill-${legend.category}`}>
              {CATEGORY_LABEL[legend.category] || 'Eendrag'}
            </span>
            {meta && <span className="legend-modal-years">{meta}</span>}
          </div>
          <p className="legend-modal-headline">{legend.headline}</p>
          {paragraphs.map((p, i) => <p className="legend-modal-story" key={i}>{p}</p>)}
          {legend.link_url && (
            /* rel="noopener noreferrer" because this URL is typed in by an
               admin and points off-site — without it the destination gets a
               handle on our window via window.opener. */
            <a className="legend-modal-link" href={legend.link_url} target="_blank" rel="noopener noreferrer">
              {legend.link_label || 'Read more'} <ArrowRightIcon />
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

function ArrowRightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </svg>
  )
}
