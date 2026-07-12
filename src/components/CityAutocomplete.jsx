import { useEffect, useRef, useState } from 'react'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN

// A location input backed by live suggestions from Mapbox's geocoding
// search — the same service geocode.js uses to place pins on the maps
// throughout the site. Suggestions range from full street addresses (house
// number + street) down to city/region/country, so typing "30 Palm Street"
// and typing just "Cape Town" both work — whatever's precise enough for the
// field it's in. Only picking a suggestion commits a value — free-typed
// text is held locally while you type and reverted the moment you click
// away without picking, so what's saved is always a real, geocodable place
// and always shows up correctly on the maps (no more silent typos).
export default function CityAutocomplete({
  value,
  country,
  onChange,
  onSelectCoords,
  placeholder,
  inputClassName,
  // Strict mode (the default, and what every city/town field wants) only
  // ever commits a value the person actually picked from the dropdown — see
  // the class comment above. Some fields hold more than just a place name
  // though (a job's "Location" is often "Cape Town / Remote", or just
  // "Remote", neither of which Nominatim will ever suggest) — pass
  // `strict={false}` there so free-typed text is kept as-is on blur, with
  // the live suggestions still offered as a convenience, not a requirement.
  strict = true,
}) {
  const [text, setText] = useState(value || '')
  const [suggestions, setSuggestions] = useState([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [needsPick, setNeedsPick] = useState(false)
  const debounceRef = useRef(null)
  const blurTimeoutRef = useRef(null)

  // Stay in sync with the confirmed value from outside (profile loading,
  // form reset) — but not while the person is actively typing/picking.
  useEffect(() => { setText(value || '') }, [value])

  // Closing on blur has to be delayed — on mobile especially, the input's
  // blur can land a beat before a tap on a suggestion is registered as a
  // click, which unmounts the dropdown out from under the tap and makes it
  // look like nothing happened. Give the tap time to land first.
  function handleBlur() {
    blurTimeoutRef.current = setTimeout(() => {
      setOpen(false)
      if (!strict) return // free-typed text already committed via onChange as it was typed
      // Only a picked suggestion is allowed to become the real value. If
      // someone typed something and clicked/tabbed away without picking,
      // discard it and fall back to whatever was last confirmed.
      if (text.trim() !== (value || '').trim()) {
        setNeedsPick(Boolean(text.trim()))
        setText(value || '')
      }
    }, 150)
  }
  function handleFocus() {
    if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current)
    setOpen(true)
  }

  useEffect(() => () => { if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current) }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const q = text.trim()
    if (q.length < 2) { setSuggestions([]); setLoading(false); return }

    async function search(q2) {
      if (!MAPBOX_TOKEN) return []
      const url =
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q2)}.json` +
        `?access_token=${MAPBOX_TOKEN}&autocomplete=true&limit=6` +
        `&types=address,poi,neighborhood,place,locality,region,country`
      const res = await fetch(url, { headers: { Accept: 'application/json' } })
      if (!res.ok) return []
      const data = await res.json()
      return data?.features || []
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        // Bias toward the selected country first (helps disambiguate common
        // names like "Paris" or "Springfield"), but this is a hint, not a
        // restriction — if narrowing by country turns up nothing (a country
        // name Nominatim doesn't match cleanly, or someone just hasn't set
        // country yet), fall back to a plain worldwide search so any
        // city/town anywhere still resolves.
        let rows = await search([q, country].filter(Boolean).join(', '))
        if (rows.length === 0 && country) {
          rows = await search(q)
        }
        setSuggestions(dedupe(rows))
      } catch {
        // offline or blocked — no suggestions to pick from; the field will
        // revert on blur same as any other unconfirmed text.
      } finally {
        setLoading(false)
      }
    }, 400)

    return () => clearTimeout(debounceRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, country])

  // Mapbox occasionally returns near-duplicate labels for the same place
  // (a suburb under two slightly different name variants). Collapse
  // anything that becomes identical once lowercased.
  function dedupe(rows) {
    const seen = new Set()
    const out = []
    for (const row of rows) {
      const key = row.place_name.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(row)
    }
    return out
  }

  function pick(row) {
    if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current)
    // Whatever the suggestion showed in the dropdown is exactly what lands
    // in the textbox — no silent swap to a shorter/different label.
    setText(row.place_name)
    setNeedsPick(false)
    onChange(row.place_name)
    // `label` lets a non-strict caller (e.g. a job's "Location" field) tell
    // whether the text still matches this pick, or has since been edited —
    // existing strict callers just ignore the extra field.
    // Mapbox returns coordinates as [lng, lat] — the opposite order from
    // the {lat,lng} shape every caller here expects.
    onSelectCoords?.({ lat: row.center[1], lng: row.center[0], label: row.place_name })
    setSuggestions([])
    setOpen(false)
  }

  const showDropdown = open && text.trim().length >= 2 && (loading || suggestions.length > 0)

  function clear() {
    setText('')
    setNeedsPick(false)
    onChange('')
    onSelectCoords?.(null)
  }

  return (
    <div className="city-autocomplete has-clear">
      <input
        className={inputClassName}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setNeedsPick(false)
          setOpen(true)
          // Strict mode only commits a picked suggestion (see class
          // comment); non-strict fields commit free-typed text live, same
          // as a plain controlled input, with suggestions just offered
          // alongside.
          if (!strict) onChange(e.target.value)
        }}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder={placeholder}
        autoComplete="off"
      />
      {text && (
        <button type="button" className="search-clear" onMouseDown={(e) => e.preventDefault()} onClick={clear} aria-label="Clear">×</button>
      )}
      {showDropdown && (
        <ul className="city-suggestions">
          {loading && <li className="city-suggestion-loading">Searching…</li>}
          {!loading && suggestions.map((s) => (
            <li key={s.id}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(s)}>
                {s.place_name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {needsPick && !showDropdown && (
        <p className="form-warning">Please choose a suggestion from the list — that typed text wasn't saved.</p>
      )}
    </div>
  )
}
