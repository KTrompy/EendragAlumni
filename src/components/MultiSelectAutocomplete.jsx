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
  // When true, typing something that isn't in `options` shows an "Add"
  // entry (and Enter adds it directly) so people can note something not
  // on the list — used for Main areas of expertise's "Other".
  allowCustom = false,
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const blurTimeoutRef = useRef(null)

  function handleBlur() {
    blurTimeoutRef.current = setTimeout(() => setOpen(false), 150)
  }
  function handleFocus() {
    if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current)
    // Open the dropdown to show suggestions; if query is empty,
    // it will show all available options
    setOpen(true)
  }

  const needle = query.trim().toLowerCase()
  const available = options.filter((o) => !values.includes(o))
  const suggestions = needle
    ? available.filter((o) => o.toLowerCase().includes(needle))
    : available
  const hasExactMatch = options.some((o) => o.toLowerCase() === needle)
  const alreadyAdded = values.some((v) => v.toLowerCase() === needle)
  const showAddCustom = allowCustom && needle.length > 0 && !hasExactMatch && !alreadyAdded

  function pick(option) {
    if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current)
    if (!values.some((v) => v.toLowerCase() === option.toLowerCase())) onChange([...values, option])
    setQuery('') // cleared so the next pick starts from the full list again
    setOpen(false) // close dropdown after selection
  }

  function handleKeyDown(e) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const trimmed = query.trim()
    if (!trimmed) return
    // Prefer the option's canonical casing over whatever was typed.
    const canonical = options.find((o) => o.toLowerCase() === trimmed.toLowerCase())
    if (canonical) { pick(canonical); return }
    if (allowCustom) pick(trimmed)
  }

  function remove(option) {
    onChange(values.filter((v) => v !== option))
  }

  const showDropdown = open && (suggestions.length > 0 || showAddCustom)

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
          onChange={(e) => { setQuery(e.target.value) }}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
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
            {showAddCustom && (
              <li>
                <button
                  type="button"
                  className="city-suggestion-add"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(query.trim())}
                >
                  Add "{query.trim()}"
                </button>
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  )
}
