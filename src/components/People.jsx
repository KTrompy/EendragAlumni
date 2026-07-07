import { useSearchParams } from 'react-router-dom'
import Directory from './Directory.jsx'
import AlumniMap from './AlumniMap.jsx'

// Directory and the alumni map both answer the same question — "find an
// Eendragter" — so they live under one nav item with a view toggle instead
// of splitting "search for a person" and "browse a map of people" into two
// separate places to check. The chosen view is kept in the URL (?view=map)
// so a link to it is shareable and survives a refresh.
export default function People({ session, onMessage, onGoToProfile }) {
  const [params, setParams] = useSearchParams()
  const view = params.get('view') === 'map' ? 'map' : 'list'

  function setView(next) {
    const p = new URLSearchParams(params)
    if (next === 'list') p.delete('view')
    else p.set('view', next)
    setParams(p, { replace: true })
  }

  return (
    <section className="panel">
      <div className="panel-header-row">
        <div>
          <h2 className="panel-title">Eendragters</h2>
          <p className="panel-sub">
            {view === 'list' ? 'The house, out in the world — and still in it.' : 'Where are we all now?'}
          </p>
        </div>
        <div className="view-switch" role="tablist" aria-label="Eendragters view">
          <button role="tab" aria-selected={view === 'list'} className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>
            List
          </button>
          <button role="tab" aria-selected={view === 'map'} className={view === 'map' ? 'on' : ''} onClick={() => setView('map')}>
            Map
          </button>
        </div>
      </div>

      {view === 'list'
        ? <Directory session={session} onMessage={onMessage} hideHeader />
        : <AlumniMap session={session} onMessage={onMessage} onGoToProfile={onGoToProfile} hideHeader />}
    </section>
  )
}
