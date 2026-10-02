import { useEffect, useMemo, useState } from 'react'
import { getOffers, setStatus } from '../api'
import { STATUTS } from '../constants'
import OfferCard from '../components/OfferCard'

export default function Offers({ active, notify, onOpen, version }) {
  const [offers, setOffers] = useState(null)
  const [error, setError] = useState('')
  const [min, setMin] = useState(5)
  const [sel, setSel] = useState(() => new Set(STATUTS))

  useEffect(() => { // recharge à chaque fois qu'on ouvre l'onglet (une recherche a pu ajouter des offres)
    if (!active) return
    getOffers().then((o) => { setOffers(o); setError('') }).catch((e) => setError(e.message))
  }, [active, version])

  const counts = useMemo(() => {
    const c = Object.fromEntries(STATUTS.map((s) => [s, 0]))
    offers?.forEach((o) => { c[o.status] = (c[o.status] || 0) + 1 })
    return c
  }, [offers])

  const toggle = (s) => setSel((p) => { const n = new Set(p); n.has(s) ? n.delete(s) : n.add(s); return n })

  async function change(fp, status) {
    const prev = offers
    setOffers((o) => o.map((x) => (x.fp === fp ? { ...x, status } : x)))
    try { await setStatus(fp, status); notify('Statut mis à jour') }
    catch (e) { setOffers(prev); notify('Échec : ' + e.message) }
  }

  const view = (offers || []).filter((o) => o.score >= min && sel.has(o.status))
  return (
    <>
      <h1>Mes offres</h1>
      <p className="sub">{offers ? `${offers.length} offres analysées depuis le début` : 'Chargement…'}</p>
      {error && <div className="err" role="alert">{error}</div>}
      <div className="chips">
        {STATUTS.map((s) => (
          <button key={s} className="chip" aria-pressed={sel.has(s)} onClick={() => toggle(s)}>{s}<b>{counts[s]}</b></button>
        ))}
      </div>
      <div className="filt">
        <span>Score minimum <b>{min}</b></span>
        <input type="range" min="0" max="10" value={min} aria-label="Score minimum" onChange={(e) => setMin(Number(e.target.value))} />
      </div>
      {offers && offers.length === 0 && <div className="empty">Aucune offre pour l'instant. Lance une recherche dans l'onglet Recherche.</div>}
      {offers && offers.length > 0 && view.length === 0 && <div className="empty">Aucune offre avec ces filtres. Baisse le score minimum ou réactive un statut.</div>}
      {view.map((o) => <OfferCard key={o.fp} offer={o} onStatus={change} onOpen={onOpen} />)}
    </>
  )
}
