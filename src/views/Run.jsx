import { useEffect, useRef, useState } from 'react'
import { runSearch } from '../api'
import { JOURS } from '../constants'
import OfferCard from '../components/OfferCard'
import Checks from '../components/Checks'

export default function Run({ config, checks, checking, onRecheck, goSettings, onOpen }) {
  const [max, setMax] = useState(60)
  const [days, setDays] = useState(7)
  const [state, setState] = useState('idle') // idle | running | done | stopped | error
  const [log, setLog] = useState('')
  const [progress, setProgress] = useState(null)
  const [found, setFound] = useState([])
  const [count, setCount] = useState(0)
  const [error, setError] = useState('')
  const abort = useRef(null)
  const seuil = config?.min_score ?? 7

  useEffect(() => {
    if (!config) return
    setMax(config.max_scored_per_run)
    setDays(JOURS.includes(config.max_age_days) ? config.max_age_days : 7)
  }, [config])

  async function start() {
    abort.current = new AbortController()
    setState('running'); setLog('Récupération des offres…'); setProgress(null); setFound([]); setError('')
    const onEvent = (ev) => {
      if (ev.type === 'log') setLog(ev.message)
      else if (ev.type === 'offer') {
        setProgress({ i: ev.i, total: ev.total })
        setLog(`Analyse ${ev.i}/${ev.total} : ${ev.offer.title.slice(0, 60)}`)
        if (ev.offer.score >= seuil) setFound((f) => [...f, ev.offer])
      } else if (ev.type === 'done') { setCount(ev.count); setState('done') }
      else if (ev.type === 'error') { setError(ev.message); setState('error') }
    }
    try {
      await runSearch({ max, days, signal: abort.current.signal, onEvent })
      setState((s) => (s === 'running' ? 'done' : s))
    } catch (e) {
      if (e.name === 'AbortError') setState('stopped')
      else { setError(e.message); setState('error') }
    }
  }

  const running = state === 'running'
  const blocked = checks && (checks.ft.state === 'bad' || checks.llm.state === 'bad')
  return (
    <>
      <h1>Lancer une recherche</h1>
      <p className="sub">Récupère les nouvelles offres France Travail, puis l'IA les note selon ton CV et tes critères.</p>
      <div className="panel">
        <div className="row">
          <div className="f">
            <label htmlFor="nmax">Offres max à analyser</label>
            <input id="nmax" type="number" min="1" max="300" value={max} disabled={running}
              onChange={(e) => setMax(Number(e.target.value))} />
          </div>
          <div className="f">
            <label htmlFor="days">Publiées depuis</label>
            <select id="days" value={days} disabled={running} onChange={(e) => setDays(Number(e.target.value))}>
              {JOURS.map((d) => <option key={d} value={d}>{d} jour{d > 1 ? 's' : ''}</option>)}
            </select>
          </div>
          {running
            ? <button className="btn ghost" onClick={() => abort.current?.abort()}>Arrêter</button>
            : <button className="btn" onClick={start} disabled={!config || blocked}>Lancer la recherche</button>}
        </div>
        {!running && (
          <div className="pre">
            <Checks checks={checks} loading={checking} onRecheck={onRecheck} />
            {blocked && <p className="hint">Corrige les points en rouge pour lancer une recherche. <button className="lnk" onClick={goSettings}>Ouvrir les Réglages</button></p>}
          </div>
        )}
        {running && (
          <>
            <div className={`prog ${progress ? '' : 'indet'}`}>
              <b style={progress ? { width: `${(progress.i / progress.total) * 100}%` } : undefined} />
            </div>
            <div className="log">{log}</div>
          </>
        )}
      </div>
      {state === 'error' && <div className="err" role="alert">{error}</div>}
      {state === 'stopped' && <p className="sub" style={{ marginTop: 16 }}>Recherche arrêtée. Les offres déjà analysées sont dans « Mes offres ».</p>}
      {state === 'done' && (
        <p className="sub" style={{ marginTop: 16 }}>
          <b>Terminé :</b> {count} offre(s) analysée(s), dont {found.length} à {seuil}/10 ou plus.
          Tout l'historique est dans « Mes offres ».
        </p>
      )}
      {found.map((o) => <OfferCard key={o.fp} offer={o} onOpen={onOpen} />)}
    </>
  )
}
