import { useEffect, useRef, useState } from 'react'

// A city input backed by live suggestions from OpenStreetMap's free
// Nominatim search — the same service geocode.js uses to place pins on the
// Alumni Map. Picking a suggestion (instead of free-typing) means the text
// is guaranteed to be a real, geocodable place, so a typo like "Cape Townx"
// can't quietly fail to show up on the map later.
//
// Free typing still works — if someone ignores the dropdown, geocode.js's
// best-effort lookup at save time is the fallback, same as before.
export default function CityAutocomplete({
  value,
  country,
  onChange,
  onSelectCoords,
  placeholder,
  inputClassName,
}) {
  const [suggestions, setSuggestions] = useState([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const debounceRef = useRef(null)
  const blurTimeoutRef = useRef(null)

  // Closing on blur has to be delayed — on mobile especially, the input's
  // blur can land a beat before a tap on a suggestion is registered as a
  // click, which unmounts the dropdown out from under the tap and makes it
  // look like nothing happened. Give the tap time to land first.
  function handleBlur() {
    blurTimeoutRef.current = setTimeout(() => setOpen(false), 150)
  }
  function handleFocus() {
    if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current)
    setOpen(true)
  }

  useEffect(() => () => { if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current) }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const q = value.trim()
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
        setSuggestions(rows)
      } catch {
        // offline or blocked — just show no suggestions, free text still works
      } finally {
        setLoading(false)
      }
    }, 400)

    return () => clearTimeout(debounceRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, country])

  function pick(row) {
    if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current)
    // Whatever the suggestion showed in the dropdown is exactly what lands
    // in the textbox — no silent swap to a shorter/different label.
    onChange(row.display_name)
    onSelectCoords?.({ lat: parseFloat(row.lat), lng: parseFloat(row.lon) })
    setSuggestions([])
    setOpen(false)
  }

  const showDropdown = open && value.trim().length >= 2 && (loading || suggestions.length > 0)

  return (
    <div className="city-autocomplete">
      <input
        className={inputClassName}
        value={value}
        onChange={(e) => { onChange(e.target.value); onSelectCoords?.(null); setOpen(true) }}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder={placeholder}
        autoComplete="off"
      />
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
    </div>
  )
}
