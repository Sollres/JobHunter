const JSON_HEADERS = { 'Content-Type': 'application/json' }
const NO_API = "L'API ne répond pas (le serveur Node est-il lancé ?)"

async function call(url, opts) {
  let r
  try { r = await fetch(url, opts) } catch { throw new Error(NO_API) }
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `Erreur ${r.status}`)
  return data
}
const send = (method, url, body) => call(url, { method, headers: JSON_HEADERS, body: JSON.stringify(body) })

export const getOffers = () => call('/api/offers')
export const getOffer = (fp) => call('/api/offer?fp=' + encodeURIComponent(fp))
export const rescoreOffer = (fp) => send('POST', '/api/offer/rescore', { fp })
export const getConfig = () => call('/api/config')
export const getChecks = () => call('/api/check')
export const saveConfig = (cfg) => send('PUT', '/api/config', cfg)
export const setStatus = (fp, status) => send('POST', '/api/offers/status', { fp, status })
export const saveLetter = (fp, letter) => send('PUT', '/api/letter', { fp, letter })

// Travaux longs : l'API renvoie une ligne JSON par évènement, transmise à onEvent au fil de l'eau.
async function stream(url, body, { signal, onEvent }) {
  let r
  try {
    r = await fetch(url, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body), signal })
  } catch (e) {
    if (e.name === 'AbortError') throw e
    throw new Error(NO_API)
  }
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Erreur ${r.status}`)
  const reader = r.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (line) onEvent(JSON.parse(line))
    }
  }
}
export const runSearch = ({ max, days, signal, onEvent }) => stream('/api/run', { max, days }, { signal, onEvent })
export const streamLetter = ({ fp, notes, signal, onEvent }) => stream('/api/letter', { fp, notes }, { signal, onEvent })
