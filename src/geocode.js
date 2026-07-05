// Turns a free-text city/country into approximate coordinates, so the
// Alumni Map has something to plot. Uses OpenStreetMap's Nominatim — free,
// no API key, no account needed. We only ever call this once per person,
// right when they save a new city/country on their profile (not on every
// page view), which keeps it well within Nominatim's fair-use limits.
//
// Results are cached in localStorage so re-saving the same city (by anyone
// on this device) doesn't hit the network again.

const CACHE_KEY = 'eendrag_geocode_cache_v1'

function loadCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}
  } catch {
    return {}
  }
}

function saveCache(cache) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch {
    // storage full or unavailable — fine, caching is just an optimization
  }
}

/**
 * @param {string} city
 * @param {string} country
 * @returns {Promise<{ lat: number, lng: number } | null>} null if it can't
 *   find a match or the lookup fails — callers should treat that as "no pin
 *   for this person" rather than an error worth surfacing.
 */
export async function geocodeCity(city, country) {
  const cleanCity = (city || '').trim()
  const cleanCountry = (country || '').trim()
  if (!cleanCity) return null

  const key = `${cleanCity.toLowerCase()}|${cleanCountry.toLowerCase()}`
  const cache = loadCache()
  if (key in cache) return cache[key]

  const query = [cleanCity, cleanCountry].filter(Boolean).join(', ')
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`

  let result = null
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
    })
    if (res.ok) {
      const rows = await res.json()
      if (rows && rows[0]) {
        result = { lat: parseFloat(rows[0].lat), lng: parseFloat(rows[0].lon) }
      }
    }
  } catch {
    result = null // offline, blocked, or Nominatim is down — just skip the pin
  }

  cache[key] = result
  saveCache(cache)
  return result
}
