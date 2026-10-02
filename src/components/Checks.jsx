const LABELS = { ft: 'France Travail', llm: 'IA locale' }

// État des connexions : vert = prêt, rouge = à corriger, orange = impossible de vérifier.
export default function Checks({ checks, loading, onRecheck }) {
  return (
    <div className="chk">
      <ul>
        {['ft', 'llm'].map((k) => {
          const c = checks?.[k]
          const wait = loading || !c
          return (
            <li key={k}>
              <i className={`dot ${wait ? 'wait' : c.state}`} aria-hidden="true" />
              <b>{LABELS[k]}</b>
              <span>{wait ? 'Vérification…' : c.message}</span>
            </li>
          )
        })}
      </ul>
      <button className="lnk" onClick={onRecheck} disabled={loading}>Revérifier</button>
    </div>
  )
}
