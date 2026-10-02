import { useCallback, useEffect, useRef, useState } from 'react'
import { getChecks, getConfig } from './api'
import Run from './views/Run'
import Offers from './views/Offers'
import Settings from './views/Settings'
import OfferDrawer from './components/OfferDrawer'

const TABS = [['run', 'Recherche'], ['offers', 'Mes offres'], ['cfg', 'Réglages']]

export default function App() {
  const [view, setView] = useState('run')
  const [config, setConfig] = useState(null)
  const [error, setError] = useState('')
  const [checks, setChecks] = useState(null)
  const [checking, setChecking] = useState(false)
  const [detail, setDetail] = useState(null)   // fp de l'offre ouverte dans le panneau
  const [version, setVersion] = useState(0)     // +1 quand le panneau modifie une offre : la liste se recharge
  const [toast, setToast] = useState('')
  const timer = useRef()

  const notify = useCallback((msg) => {
    setToast(msg)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setToast(''), 2400)
  }, [])

  const checksRef = useRef(null)
  checksRef.current = checks
  const refreshChecks = useCallback(() => {
    setChecking(true)
    getChecks()
      .then(setChecks)
      .catch((e) => { const c = { state: 'unknown', message: e.message }; setChecks({ ft: c, llm: c }) })
      .finally(() => setChecking(false))
  }, [])

  useEffect(() => { getConfig().then(setConfig).catch((e) => setError(e.message)); refreshChecks() }, [refreshChecks])

  // On lance souvent Ollama après l'app : quand la fenêtre reprend le focus, on revérifie si un voyant n'est pas vert.
  useEffect(() => {
    const onFocus = () => {
      const c = checksRef.current
      if (c && (c.ft.state !== 'ok' || c.llm.state !== 'ok')) refreshChecks()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refreshChecks])
  const saved = (cfg) => { setConfig(cfg); refreshChecks() }

  // Toutes les vues restent montées : une recherche en cours n'est pas coupée quand on change d'onglet.
  return (
    <>
      <header>
        <div className="bar">
          <div className="brand"><i />Job Hunter</div>
          <nav role="tablist">
            {TABS.map(([id, label]) => (
              <button key={id} role="tab" aria-selected={view === id} onClick={() => setView(id)}>{label}</button>
            ))}
          </nav>
        </div>
      </header>
      <main>
        {error && <div className="err" role="alert">{error}</div>}
        <section hidden={view !== 'run'}><Run config={config} checks={checks} checking={checking} onRecheck={refreshChecks} goSettings={() => setView('cfg')} onOpen={setDetail} /></section>
        <section hidden={view !== 'offers'}><Offers active={view === 'offers'} notify={notify} onOpen={setDetail} version={version} /></section>
        <section hidden={view !== 'cfg'}><Settings config={config} onSaved={saved} notify={notify} checks={checks} checking={checking} onRecheck={refreshChecks} /></section>
      </main>
      {detail && (
        <OfferDrawer key={detail} fp={detail} onClose={() => setDetail(null)} notify={notify}
          onChanged={() => setVersion((v) => v + 1)} llmDown={checks?.llm.state === 'bad'} onRecheck={refreshChecks} />
      )}
      <div id="toast" className={toast ? 'on' : ''} role="status">{toast}</div>
    </>
  )
}
