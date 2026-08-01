import { useRef, useState } from 'react'
import DropdownPortal from './DropdownPortal.jsx'

// Generic type-to-filter text box backed by a static list of options —
// used anywhere we want "start typing, pick from suggestions" instead of a
// stock <select> (Country, Industry, both as profile fields and as
// directory filters). Free typing is always allowed; picking a suggestion
// just fills in the exact text you clicked.
export default function ListAutocomplete({
  value,
  onChange,
  options,
  placeholder,
  inputClassName,
  clearable = false,
}) {
  const [open, setOpen] = useState(false)
  const blurTimeoutRef = useRef(null)
  // The suggestion list renders in a portal on <body> (see DropdownPortal)
  // so it can never be painted over by a card further down the page — this
  // is what it anchors to.
  const anchorRef = useRef(null)

  // Same delayed-close trick as CityAutocomplete — without it, a tap on a
  // suggestion can lose to the input's blur event, especially on mobile.
  function handleBlur() {
    blurTimeoutRef.current = setTimeout(() => setOpen(false), 150)
  }
  function handleFocus() {
    if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current)
    setOpen(true)
  }

  const needle = value.trim().toLowerCase()
  const suggestions = needle
    ? options.filter((o) => o.toLowerCase().includes(needle))
    : options

  function pick(option) {
    if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current)
    onChange(option)
    setOpen(false)
  }

  const showDropdown = open && suggestions.length > 0

  return (
    <div className={clearable ? 'city-autocomplete has-clear' : 'city-autocomplete'} ref={anchorRef}>
      <input
        className={inputClassName}
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true) }}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder={placeholder}
        autoComplete="off"
      />
      {clearable && value && (
        <button
          type="button"
          className="search-clear"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onChange('')}
          aria-label="Clear"
        >×</button>
      )}
      <DropdownPortal anchorRef={anchorRef} open={showDropdown}>
        <ul className="city-suggestions">
          {suggestions.map((option) => (
            <li key={option}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(option)}>
                {option}
              </button>
            </li>
          ))}
        </ul>
      </DropdownPortal>
    </div>
  )
}
