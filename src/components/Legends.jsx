import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'

// Eendrag legends — the photo mosaic on Home, plus the standalone "Hoek van
// Helde" section it opens onto (LegendsHall.jsx for the full list,
// LegendProfile.jsx for one person's page).
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

export const CATEGORY_LABEL = Object.fromEntries(LEGEND_CATEGORIES.map((c) => [c.key, c.label]))

// Fields both the Home band and the Hall/Profile pages need. Shared so a
// column added to one never quietly goes missing from the other.
export const LEGEND_FIELDS = 'id, name, years, degree, category, headline, story, photo_url, link_url, link_label'

// How many tiles the mosaic shows at once: one hero plus two stacked beside it.
const TILE_COUNT = 3

// Which three are featured this week.
//
// Deterministic from the date rather than random, so every member sees the
// same three people at the same time — that's what makes it feel like a
// weekly spotlight rather than a shuffle, and it means someone can mention
// "did you see who's up this week" and be understood. This same set doubles
// as the mobile carousel's slides (see LegendsBand below) — it's still a
// spotlight there, just paged through one at a time instead of a mosaic.
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

  // Mobile-only "one person at a time" carousel — same scroll-snap-strip +
  // dot-indicator pattern as Home's Recent posts / Businesses near me
  // carousels (see postsScrollRef/postIndex in Home.jsx). Desktop never
  // renders this; it keeps the hero+stack mosaic below instead (see
  // .legends-carousel's display:none base rule in styles.css).
  const carouselRef = useRef(null)
  const [slideIndex, setSlideIndex] = useState(0)
  const updateSlideIndex = () => {
    const el = carouselRef.current
    if (!el || el.clientWidth === 0) return
    setSlideIndex(Math.round(el.scrollLeft / el.clientWidth))
  }
  const scrollToSlide = (idx) => {
    const el = carouselRef.current
    if (!el) return
    el.scrollTo({ left: idx * el.clientWidth, behavior: 'smooth' })
  }
  useLayoutEffect(() => { setSlideIndex(0) }, [legends])

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data, error } = await supabase
        .from('legends')
        .select(LEGEND_FIELDS)
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

  // This week's three, wrapping rather than slicing so the mosaic/carousel is
  // always full even when the window straddles the end of the list. With
  // fewer than TILE_COUNT entries this yields exactly what exists (no
  // duplicates), and both layouts collapse to match.
  const featured = useMemo(() => {
    if (legends.length === 0) return []
    const start = (weekNumber() * TILE_COUNT) % legends.length
    const out = []
    for (let i = 0; i < Math.min(TILE_COUNT, legends.length); i++) {
      out.push(legends[(start + i) % legends.length])
    }
    return out
  }, [legends])

  if (loading || featured.length === 0) return null

  const [hero, ...rest] = featured

  return (
    <section className="legends-band" aria-labelledby="legends-heading">
      <div className="legends-head">
        <div className="legends-head-text">
          <h3 className="legends-title" id="legends-heading">Hoek van Helde</h3>
        </div>
        {/* Opens the full Hoek van Helde page rather than cycling to another
            three in place — everyone curated lives there, not just the next
            batch this widget happens to rotate to. */}
        {legends.length > TILE_COUNT && (
          <Link className="legends-more" to="/legends">
            See others <ArrowRightIcon />
          </Link>
        )}
      </div>

      {/* Desktop/tablet: hero + stacked mosaic. Hidden on mobile in favour
          of the carousel below (see the max-width:760px rule). */}
      <div className={rest.length > 0 ? 'legends-grid' : 'legends-grid legends-grid-single'}>
        <LegendTile legend={hero} hero />
        {/* legends-stack-one: with exactly two legends curated there's only one
            tile to stack, and a two-row grid would leave it floating in the top
            half with a hole underneath. */}
        {rest.length > 0 && (
          <div className={rest.length === 1 ? 'legends-stack legends-stack-one' : 'legends-stack'}>
            {rest.map((l) => <LegendTile key={l.id} legend={l} />)}
          </div>
        )}
      </div>

      {/* Mobile: one full-bleed tile per screen, swipe (or tap a dot) to see
          the next — same "featured" three the mosaic above shows, just paged
          through instead of tiled. */}
      <div className="legends-carousel" ref={carouselRef} onScroll={updateSlideIndex}>
        {featured.map((l) => (
          <div className="legends-carousel-slide" key={l.id}>
            <LegendTile legend={l} hero />
          </div>
        ))}
      </div>
      {featured.length > 1 && (
        <div className="home-carousel-dots legends-carousel-dots" role="tablist" aria-label="Hoek van Helde">
          {featured.map((l, i) => (
            <button
              key={l.id}
              type="button"
              className={i === slideIndex ? 'home-carousel-dot active' : 'home-carousel-dot'}
              role="tab"
              aria-selected={i === slideIndex}
              aria-label={`${l.name}, ${i + 1} of ${featured.length}`}
              onClick={() => scrollToSlide(i)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

// A single photo tile — used by the Home mosaic/carousel above and by
// LegendsHall's full grid. Always a link to that person's own page
// (/legends/:id) rather than a modal: it's shareable, and it gets a real
// "back" the browser already understands.
export function LegendTile({ legend, hero = false }) {
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
      <Link className="stretched-link" to={`/legends/${legend.id}`}>
        <span className="sr-only">{`Read about ${legend.name}`}</span>
      </Link>
    </article>
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
