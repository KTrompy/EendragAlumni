import { useRef, useState } from 'react'

// Same "type to filter, pick from suggestions" behaviour as ListAutocomplete,
// but lets you pick more than one value — each pick adds a removable chip
// instead of replacing whatever was chosen before, so filtering the
// directory by industry can mean "Accounting & Finance OR Banking,
// Insurance & Actuarial Science" instead of only ever one at a time.
export default function MultiSelectAutocomplete({
  values,
  onChange,
  options,
  placeholder,
  limit = 8,
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const blurTimeoutRef = useRef(null)

  function handleBlur() {
    blurTimeoutRef.current = setTimeout(() => setOpen(false), 150)
  }
  function handleFocus() {
    if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current)
    setOpen(true)
  }

  const needle = query.trim().toLowerCase()
  const available = options.filter((o) => !values.includes(o))
  const suggestions = (needle
    ? available.filter((o) => o.toLowerCase().includes(needle))
    : available
  ).slice(0, limit)

  function pick(option) {
    if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current)
    onChange([...values, option])
    setQuery('') // cleared so the next pick starts from the full list again
  }

  function remove(option) {
    onChange(values.filter((v) => v !== option))
  }

  const showDropdown = open && suggestions.length > 0

  return (
    <div className="multi-select-autocomplete">
      {values.length > 0 && (
        <ul className="multi-select-chips">
          {values.map((v) => (
            <li key={v} className="multi-select-chip">
              <span>{v}</span>
              <button type="button" onClick={() => remove(v)} aria-label={`Remove ${v}`}>×</button>
            </li>
          ))}
        </ul>
      )}
      <div className="city-autocomplete">
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={values.length ? 'Add another…' : placeholder}
          autoComplete="off"
        />
        {showDropdown && (
          <ul className="city-suggestions">
            {suggestions.map((option) => (
              <li key={option}>
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(option)}>
                  {option}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
