import { useEffect, useState } from 'react'
import { saveConfig } from '../api'
import Checks from '../components/Checks'

const liste = (t) => t.split(/[,\n]/).map((x) => x.trim()).filter(Boolean)

export default function Settings({ config, onSaved, notify, checks, checking, onRecheck }) {
  const [f, setF] = useState(null)
  const [kw, setKw] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (config) setF({ ...config, departements: config.departements.join(', '), contract_types: config.contract_types.join(', '), ft_client_secret: '', llm_api_key: '' })
  }, [config])

  if (!f) return <p className="sub">Chargement des réglages…</p>
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })

  async function save() {
    setSaving(true)
    try {
      const saved = await saveConfig({ ...f, departements: liste(f.departements), contract_types: liste(f.contract_types) })
      onSaved(saved); notify('Réglages enregistrés')
    } catch (e) { notify('Échec : ' + e.message) }
    setSaving(false)
  }

  return (
    <>
      <h1>Réglages</h1>
      <p className="sub">Ce que l'IA doit chercher et comment elle doit noter.</p>
      <div className="stack">
        <div className="panel">
          <h2>Connexions</h2>
          <div className="grid">
            <div>
              <label htmlFor="ftid">France Travail : identifiant (client_id)</label>
              <input id="ftid" value={f.ft_client_id} autoComplete="off" spellCheck="false" onChange={set('ft_client_id')} />
            </div>
            <div>
              <label htmlFor="fts">France Travail : clé secrète (client_secret)</label>
              <input id="fts" type="password" value={f.ft_client_secret} autoComplete="new-password" onChange={set('ft_client_secret')}
                placeholder={config.ft_secret_set ? 'Enregistrée, laisse vide pour la garder' : 'Colle ta clé secrète'} />
            </div>
          </div>
          <p className="hint">Clés à créer sur francetravail.io (API « Offres d'emploi »). Elles restent dans le fichier .env sur ton ordinateur et ne sont jamais réaffichées.</p>
          <div className="grid" style={{ marginTop: 14 }}>
            <div>
              <label htmlFor="llmk">Clé API du modèle (seulement pour un service distant : Groq, Gemini, Mistral…)</label>
              <input id="llmk" type="password" value={f.llm_api_key} autoComplete="new-password" onChange={set('llm_api_key')}
                placeholder={config.llm_key_set ? 'Enregistrée, laisse vide pour la garder' : 'Inutile avec Ollama'} />
            </div>
          </div>
          <p className="hint" style={{ marginBottom: 12 }}>Enregistre d'abord les réglages, puis vérifie les connexions :</p>
          <Checks checks={checks} loading={checking} onRecheck={onRecheck} />
        </div>
        <div className="panel">
          <label htmlFor="kwin">Mots-clés</label>
          <div className="kw">
            {f.keywords.map((k, i) => (
              <span key={k + i}>{k}<button aria-label={`Retirer ${k}`} onClick={() => setF({ ...f, keywords: f.keywords.filter((_, j) => j !== i) })}>×</button></span>
            ))}
          </div>
          <input id="kwin" value={kw} placeholder="Ajouter un mot-clé puis Entrée" onChange={(e) => setKw(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && kw.trim()) { setF({ ...f, keywords: [...f.keywords, kw.trim()] }); setKw('') } }} />
        </div>
        <div className="panel grid">
          <div><label htmlFor="dep">Départements</label><input id="dep" value={f.departements} onChange={set('departements')} /></div>
          <div><label htmlFor="ct">Types de contrat (vide = tous)</label><input id="ct" value={f.contract_types} onChange={set('contract_types')} /></div>
        </div>
        <div className="panel"><label htmlFor="crit">Critères donnés à l'IA</label><textarea id="crit" rows="9" value={f.criteria} onChange={set('criteria')} /></div>
        <div className="panel grid">
          <div>
            <label htmlFor="ms">Score minimum pour être mis en avant : <b>{f.min_score}</b></label>
            <input id="ms" type="range" min="0" max="10" value={f.min_score} onChange={(e) => setF({ ...f, min_score: Number(e.target.value) })} />
          </div>
          <div><label htmlFor="mod">Modèle Ollama</label><input id="mod" value={f.model} onChange={set('model')} /></div>
        </div>
        <div className="panel"><label htmlFor="cv">CV en texte brut (sans données personnelles)</label><textarea id="cv" rows="8" value={f.cv} onChange={set('cv')} /></div>
        <button className="btn" onClick={save} disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer les réglages'}</button>
      </div>
    </>
  )
}
