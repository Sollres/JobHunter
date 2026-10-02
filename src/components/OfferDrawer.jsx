import { useCallback, useEffect, useRef, useState } from 'react'
import { getOffer, rescoreOffer, saveLetter, setStatus, streamLetter } from '../api'
import { STATUTS, tier } from '../constants'

const slug = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)

// Panneau de détail d'une offre : description complète, re-notation, lettre de motivation.
export default function OfferDrawer({ fp, onClose, onChanged, notify, llmDown, onRecheck }) {
  const [o, setO] = useState(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('desc')
  const [rescoring, setRescoring] = useState(false)
  const [draft, setDraft] = useState('')      // contenu de la zone de texte de la lettre
  const [notes, setNotes] = useState('')      // consignes facultatives pour la rédaction
  const [gen, setGen] = useState(null)        // null, ou { text } pendant la rédaction
  const [form, setForm] = useState(false)     // formulaire de (re)génération affiché
  const [letterErr, setLetterErr] = useState('')
  const abort = useRef(null)
  const panel = useRef(null)

  useEffect(() => {
    let live = true
    getOffer(fp).then((d) => { if (live) { setO(d); setDraft(d.letter || '') } }).catch((e) => live && setError(e.message))
    panel.current?.focus()
    return () => { live = false; abort.current?.abort() }
  }, [fp])

  const dirty = !!o && !gen && draft !== (o.letter || '')
  const close = () => {
    if (dirty && !window.confirm('Ta lettre a des modifications non enregistrées. Fermer quand même ?')) return
    onClose()
  }
  const closeRef = useRef(close)
  closeRef.current = close
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') closeRef.current() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  async function changeStatus(status) {
    const prev = o.status
    setO({ ...o, status })
    try { await setStatus(o.fp, status); onChanged(); notify('Statut mis à jour') }
    catch (e) { setO((x) => ({ ...x, status: prev })); notify('Échec : ' + e.message) }
  }

  async function rescore() {
    setRescoring(true)
    try {
      const d = await rescoreOffer(o.fp)
      setO((x) => ({ ...x, ...d, letter: x.letter }))
      onChanged(); notify(`Nouvelle note : ${d.score}/10`)
    } catch (e) { notify('Échec : ' + e.message) }
    setRescoring(false)
  }

  async function generate() {
    abort.current = new AbortController()
    setGen({ text: '' }); setLetterErr('')
    try {
      await streamLetter({
        fp: o.fp, notes, signal: abort.current.signal,
        onEvent: (ev) => {
          if (ev.type === 'delta') setGen((g) => g && { text: g.text + ev.text })
          else if (ev.type === 'done') { setO((x) => ({ ...x, letter: ev.letter })); setDraft(ev.letter); setForm(false); onChanged() }
          else if (ev.type === 'error') setLetterErr(ev.message)
        },
      })
    } catch (e) { if (e.name !== 'AbortError') setLetterErr(e.message) }
    setGen(null)
  }

  async function save() {
    try { await saveLetter(o.fp, draft); setO({ ...o, letter: draft }); onChanged(); notify('Lettre enregistrée') }
    catch (e) { notify('Échec : ' + e.message) }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(draft); notify('Lettre copiée') }
    catch { notify('Copie impossible : sélectionne le texte à la main') }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([draft], { type: 'text/plain;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `lettre-${slug([o.company, o.title].filter(Boolean).join(' ')) || 'offre'}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const hasLetter = !!(o?.letter || draft)
  const showForm = !gen && (!hasLetter || form)
  return (
    <div className="ov" onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <aside className="dr" role="dialog" aria-modal="true" aria-label="Détail de l'offre" ref={panel} tabIndex={-1}>
        {error && <div className="dr-b"><div className="err" role="alert">{error}</div><button className="btn ghost" onClick={onClose}>Fermer</button></div>}
        {!o && !error && <p className="sub dr-b">Chargement…</p>}
        {o && (
          <>
            <header className="dr-h">
              <div className={`sc ${tier(o.score)}`}>{o.score}<small>/10</small></div>
              <div className="dr-t">
                <h2>{o.title}</h2>
                <div className="meta">{[o.company, o.location, o.contract, o.salary].filter(Boolean).join(' · ')}</div>
              </div>
              <button className="x" onClick={close} aria-label="Fermer">×</button>
            </header>
            <div className="dr-b">
              <div className="row dr-act">
                <select aria-label="Statut" value={o.status} onChange={(e) => changeStatus(e.target.value)} style={{ width: 'auto' }}>
                  {STATUTS.map((s) => <option key={s}>{s}</option>)}
                </select>
                {o.url && <a className="lnk" href={o.url} target="_blank" rel="noopener noreferrer">Ouvrir l'offre</a>}
                <button className="btn ghost sm" onClick={rescore} disabled={rescoring || !o.description || llmDown}
                  title={!o.description ? 'Description non conservée pour cette offre' : llmDown ? "L'IA ne répond pas" : 'Refaire noter cette offre avec ton CV et tes critères actuels'}>
                  {rescoring ? 'Analyse…' : 'Re-noter'}
                </button>
              </div>
              {o.resume && <p className="res">{o.resume}</p>}
              <div className="tags">
                {o.points_forts.map((t) => <span key={'p' + t} className="tag ok">{t}</span>)}
                {o.manques.map((t) => <span key={'m' + t} className="tag ko">{t}</span>)}
              </div>

              <div className="tabs" role="tablist">
                <button role="tab" aria-selected={tab === 'desc'} onClick={() => setTab('desc')}>Description</button>
                <button role="tab" aria-selected={tab === 'letter'} onClick={() => setTab('letter')}>Lettre de motivation{o.letter ? ' ✓' : ''}</button>
              </div>

              {tab === 'desc' && (o.description
                ? <div className="desc">{o.description}</div>
                : <p className="hint">La description complète n'a pas été conservée pour cette offre (analysée avant cette mise à jour). Elle est enregistrée pour toutes les nouvelles recherches.</p>)}

              {tab === 'letter' && (
                <div className="letter">
                  {letterErr && <div className="err" role="alert">{letterErr}</div>}
                  {gen && (
                    <>
                      <textarea readOnly rows="16" value={gen.text} aria-label="Lettre en cours de rédaction" />
                      <div className="row"><span className="log">Rédaction en cours…</span><button className="btn ghost sm" onClick={() => abort.current?.abort()}>Arrêter</button></div>
                    </>
                  )}
                  {!gen && hasLetter && (
                    <>
                      <textarea rows="18" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Lettre de motivation" />
                      <p className="hint">Relis et complète les passages entre crochets (nom, coordonnées). L'IA ne connaît que ton CV : vérifie chaque affirmation avant d'envoyer.</p>
                      <div className="row">
                        <button className="btn" onClick={save} disabled={!dirty}>{dirty ? 'Enregistrer' : 'Enregistrée'}</button>
                        <button className="btn ghost" onClick={copy}>Copier</button>
                        <button className="btn ghost" onClick={download}>Télécharger (.txt)</button>
                        {!form && <button className="lnk" onClick={() => setForm(true)} disabled={dirty} title={dirty ? 'Enregistre d\'abord tes modifications' : ''}>Régénérer…</button>}
                      </div>
                    </>
                  )}
                  {showForm && (
                    <div className={hasLetter ? 'regen' : ''}>
                      {!hasLetter && <p className="sub" style={{ marginBottom: 12 }}>L'IA rédige une lettre à partir de ton CV et de cette offre, en s'appuyant sur les points forts repérés.</p>}
                      <label htmlFor="notes">Consignes (facultatif)</label>
                      <textarea id="notes" rows="3" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex. : mets en avant mon projet RAG, ton direct, mentionne ma disponibilité immédiate" />
                      {!o.description && <p className="hint">Description non conservée : la lettre sera moins précise.</p>}
                      <div className="row" style={{ marginTop: 12 }}>
                        <button className="btn" onClick={generate} disabled={llmDown}>{hasLetter ? 'Générer une nouvelle lettre' : 'Générer la lettre'}</button>
                        {hasLetter && <button className="btn ghost" onClick={() => setForm(false)}>Annuler</button>}
                        {llmDown && <><span className="hint">L'IA ne répond pas : vérifie qu'Ollama est lancé.</span><button className="lnk" onClick={onRecheck}>Revérifier</button></>}
                      </div>
                      {hasLetter && <p className="hint">La lettre actuelle sera remplacée quand la nouvelle sera terminée.</p>}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </aside>
    </div>
  )
}
