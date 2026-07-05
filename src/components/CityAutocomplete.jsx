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

    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const query = [q, country].filter(Boolean).join(', ')
        const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&q=${encodeURIComponent(query)}`
        const res = await fetch(url, { headers: { Accept: 'application/json' } })
        if (res.ok) {
          const rows = await res.json()
          setSuggestions(rows || [])
        }
      } catch {
        // offline or blocked — just show no suggestions, free text still works
      } finally {
        setLoading(false)
      }
    }, 400)

    return () => clearTimeout(debounceRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, country])

  function label(row) {
    const a = row.address || {}
    return a.city || a.town || a.village || a.municipality || a.county || row.display_name.split(',')[0]
  }

  function pick(row) {
    if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current)
    onChange(label(row))
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
