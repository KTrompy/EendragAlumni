import { useEffect, useRef, useState } from 'react'

// A city input backed by live suggestions from OpenStreetMap's free
// Nominatim search — the same service geocode.js uses to place pins on the
// Alumni Map. Only picking a suggestion commits a value — free-typed text
// is held locally while you type and reverted the moment you click away
// without picking, so what's saved is always a real, geocodable place and
// always shows up correctly on the Alumni Map (no more silent typos).
export default function CityAutocomplete({
  value,
  country,
  onChange,
  onSelectCoords,
  placeholder,
  inputClassName,
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
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&q=${encodeURIComponent(q2)}`
      const res = await fetch(url, { headers: { Accept: 'application/json' } })
      if (!res.ok) return []
      return (await res.json()) || []
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

  // Nominatim often returns the same suburb multiple times, once per postal
  // code subdivision it's split into (that's the "two Milnertons" bug) — from
  // a "pick your general area" city field, those are indistinguishable and
  // just look like a broken duplicate. Drop the postcode segment and collapse
  // anything that becomes identical to one entry.
  function cleanLabel(row) {
    const postcode = row.address?.postcode
    const parts = row.display_name.split(',').map((p) => p.trim()).filter(Boolean)
    return (postcode ? parts.filter((p) => p !== postcode) : parts).join(', ')
  }

  function dedupe(rows) {
    const seen = new Set()
    const out = []
    for (const row of rows) {
      const label = cleanLabel(row)
      const key = label.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ ...row, display_name: label })
    }
    return out
  }

  function pick(row) {
    if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current)
    // Whatever the suggestion showed in the dropdown is exactly what lands
    // in the textbox — no silent swap to a shorter/different label.
    setText(row.display_name)
    setNeedsPick(false)
    onChange(row.display_name)
    onSelectCoords?.({ lat: parseFloat(row.lat), lng: parseFloat(row.lon) })
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
        onChange={(e) => { setText(e.target.value); setNeedsPick(false); setOpen(true) }}
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
            <li key={s.place_id}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(s)}>
                {s.display_name}
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
