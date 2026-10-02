import { STATUTS, tier } from '../constants'

export default function OfferCard({ offer: o, onStatus, onOpen }) {
  const link = o.url && <a href={o.url} target="_blank" rel="noopener noreferrer">Ouvrir l'offre</a>
  return (
    <article className="offer">
      <div className={`sc ${tier(o.score)}`}>{o.score}<small>/10</small></div>
      <div>
        <p className="t">{onOpen ? <button className="tbtn" onClick={() => onOpen(o.fp)}>{o.title}</button> : o.url ? <a href={o.url} target="_blank" rel="noopener noreferrer">{o.title}</a> : o.title}</p>
        <div className="meta">{[o.company, o.location, o.contract, o.salary].filter(Boolean).join(' · ')}</div>
        {o.resume && <p className="res">{o.resume}</p>}
        <div className="tags">
          {o.points_forts.map((t) => <span key={'p' + t} className="tag ok">{t}</span>)}
          {o.manques.map((t) => <span key={'m' + t} className="tag ko">{t}</span>)}
          {o.has_letter && <span className="tag let">Lettre prête</span>}
        </div>
      </div>
      <div className="side">
        {onStatus && (
          <select aria-label="Statut" value={o.status} onChange={(e) => onStatus(o.fp, e.target.value)}>
            {STATUTS.map((s) => <option key={s}>{s}</option>)}
          </select>
        )}
        {onOpen && <button className="lnk" onClick={() => onOpen(o.fp)}>Détails et lettre</button>}
        {link}
      </div>
    </article>
  )
}
