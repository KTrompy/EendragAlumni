import { useEffect, useMemo, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { supabase } from '../supabaseClient'
import { PhotoBlock } from './Directory.jsx'
import ProfileModal from './ProfileModal.jsx'
import EmptyState from './EmptyState.jsx'

const PROFILE_FIELDS =
  'id, full_name, grad_year, degree, occupation, industry, company, city, country, ' +
  'is_current_resident, bio, avatar_url, linkedin_url, available_for_mentorship, ' +
  'mentorship_description, approved, lat, lng'

// People who geocode to (roughly) the same spot share one pin, so a city
// with 40 Eendragters doesn't paint 40 overlapping markers on top of
// each other. ~0.01deg is on the order of a city block.
function clusterKey(lat, lng) {
  return `${lat.toFixed(2)},${lng.toFixed(2)}`
}

function pinIcon(count) {
  return L.divIcon({
    className: 'alumni-pin-wrap',
    html: `<div class="alumni-pin">${count}</div>`,
    iconSize: [count > 9 ? 36 : 30, count > 9 ? 36 : 30],
    iconAnchor: [count > 9 ? 18 : 15, count > 9 ? 18 : 15],
    popupAnchor: [0, -14],
  })
}

// Re-fits the view to show every pin whenever the set of clusters changes
// (first load, or a filter you might add later).
function FitToMarkers({ points }) {
  const map = useMap()
  const fingerprint = points.map((p) => p.key).join('|')

  useEffect(() => {
    if (!points.length) return
    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lng], 8)
      return
    }
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng]))
    map.fitBounds(bounds, { padding: [36, 36], maxZoom: 9 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fingerprint])

  return null
}

export default function AlumniMap({ session, onMessage }) {
  const [people, setPeople] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [openProfile, setOpenProfile] = useState(null)

  useEffect(() => {
    supabase
      .from('profiles')
      .select(PROFILE_FIELDS)
      .then(({ data }) => { setPeople(data || []); setLoaded(true) })
  }, [])

  const pinned = useMemo(
    () => people.filter((p) => typeof p.lat === 'number' && typeof p.lng === 'number'),
    [people]
  )

  const clusters = useMemo(() => {
    const map = new Map()
    for (const p of pinned) {
      const key = clusterKey(p.lat, p.lng)
      if (!map.has(key)) map.set(key, { key, lat: p.lat, lng: p.lng, people: [] })
      map.get(key).people.push(p)
    }
    return [...map.values()]
  }, [pinned])

  const placeCount = useMemo(
    () => new Set(pinned.map((p) => `${(p.city || '').toLowerCase()}|${(p.country || '').toLowerCase()}`)).size,
    [pinned]
  )

  return (
    <section className="panel">
      <h2 className="panel-title">Alumni map</h2>
      <p className="panel-sub">Where are we all now?</p>

      {pinned.length > 0 && (
        <p className="result-count">
          {pinned.length} Eendragters pinned across {placeCount} {placeCount === 1 ? 'place' : 'places'}
        </p>
      )}

      {loaded && pinned.length === 0 && (
        <EmptyState
          icon="search"
          message="No one's on the map yet."
          subMessage="A pin appears automatically once an alumnus saves a city on their profile."
        />
      )}

      {pinned.length > 0 && (
        <div className="map-shell">
          <MapContainer center={[20, 10]} zoom={2} scrollWheelZoom className="alumni-map">
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <FitToMarkers points={clusters} />
            {clusters.map((c) => {
              const place = [c.people[0].city, c.people[0].country].filter(Boolean).join(', ')
              return (
                <Marker key={c.key} position={[c.lat, c.lng]} icon={pinIcon(c.people.length)}>
                  <Popup maxWidth={280} minWidth={220}>
                    <div className="map-popup">
                      <div className="map-popup-title">{place || 'Unknown location'}</div>
                      <ul className="map-popup-list">
                        {c.people.map((p) => (
                          <li key={p.id}>
                            <button className="map-popup-person" onClick={() => setOpenProfile(p)}>
                              <PhotoBlock url={p.avatar_url} name={p.full_name} className="map-popup-photo" />
                              <span className="map-popup-info">
                                <strong>
                                  {p.full_name || 'Alumnus'}
                                  {p.id === session.user.id && <span className="person-name-you">You</span>}
                                </strong>
                                <span className="map-popup-meta">
                                  {p.grad_year ? `Class of ${p.grad_year}` : ''}
                                  {p.grad_year && (p.occupation || p.company) ? ' · ' : ''}
                                  {[p.occupation, p.company].filter(Boolean).join(' @ ')}
                                </span>
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </Popup>
                </Marker>
              )
            })}
          </MapContainer>
          <p className="map-hint">Tap a pin to see who's there, view their profile, or send a message.</p>
        </div>
      )}

      {openProfile && (
        <ProfileModal
          person={openProfile}
          isMe={openProfile.id === session.user.id}
          onClose={() => setOpenProfile(null)}
          onMessage={() => { const p = openProfile; setOpenProfile(null); onMessage(p) }}
        />
      )}
    </section>
  )
}
