// API locale : relaie les requêtes de l'interface vers bridge.py (qui appelle jobhunter.py).
// Utilisable seule (npm run dev:api / npm start) ou démarrée par Electron (electron/main.cjs).
import express from 'express'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const STATUTS = ['à voir', 'à postuler', 'postulé', 'entretien', 'refusé', 'ignoré']
const JOURS = [1, 3, 7, 14, 31]
const lastLine = (t) => t.trim().split('\n').filter(Boolean).pop() || ''

export function startServer({
  root = ROOT,                                  // code : bridge.py, jobhunter.py, dist/
  dataDir = root,                               // données : config.yaml, cv.txt, offers.db, .env
  python = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3'),
  port = Number(process.env.PORT || 3001),      // 0 = port libre choisi par le système
} = {}) {
  const bridge = path.join(root, 'bridge.py')
  const spawnPy = (args) =>
    spawn(python, ['-u', bridge, ...args], { cwd: dataDir, env: { ...process.env, JOBHUNTER_HOME: dataDir } })

  const explain = (err, code) => {
    const msg = lastLine(err) || `bridge.py a échoué (code ${code})`
    return /ModuleNotFoundError|No module named/.test(err)
      ? `${msg} : ce n'est pas le bon Python. Lance l'app depuis l'env conda « jobhunter » ou définis PYTHON_BIN.`
      : msg
  }

  // Commande courte : renvoie le JSON affiché par bridge.py
  const py = (args, input) => new Promise((resolve, reject) => {
    const p = spawnPy(args)
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (err += d))
    p.on('error', (e) => reject(new Error(`Impossible de lancer « ${python} » : ${e.message}`)))
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(explain(err, code)))
      try { resolve(JSON.parse(out)) } catch { reject(new Error('Réponse Python illisible')) }
    })
    p.stdin.end(input === undefined ? '' : JSON.stringify(input))
  })

  const wrap = (fn) => (req, res) => fn(req, res).catch((e) => res.status(500).json({ error: e.message }))
  const app = express()
  // Seules les requêtes adressées à localhost / 127.0.0.1 sont acceptées (protège contre le « DNS rebinding » :
  // une page web malveillante ne peut pas faire parler ton navigateur à cette API sous un autre nom de domaine).
  app.use((req, res, next) => {
    const host = (req.headers.host || '').replace(/:\d+$/, '')
    return host === '127.0.0.1' || host === 'localhost' ? next() : res.status(403).json({ error: 'Hôte non autorisé' })
  })
  app.use(express.json({ limit: '1mb' }))

  app.get('/api/offers', wrap(async (_req, res) => res.json(await py(['offers']))))
  const fpOf = (v) => (typeof v === 'string' && v && v.length < 500 ? v : null)

  app.get('/api/offer', wrap(async (req, res) => {
    const fp = fpOf(req.query.fp)
    if (!fp) return res.status(400).json({ error: 'Requête invalide' })
    res.json(await py(['offer', fp]))
  }))
  app.post('/api/offer/rescore', wrap(async (req, res) => {
    const fp = fpOf(req.body?.fp)
    if (!fp) return res.status(400).json({ error: 'Requête invalide' })
    res.json(await py(['rescore', fp]))
  }))
  app.put('/api/letter', wrap(async (req, res) => {
    const fp = fpOf(req.body?.fp)
    const letter = req.body?.letter
    if (!fp || typeof letter !== 'string' || letter.length > 20000) return res.status(400).json({ error: 'Requête invalide' })
    res.json(await py(['save-letter'], { fp, letter }))
  }))
  app.get('/api/check', wrap(async (_req, res) => res.json(await py(['check']))))
  app.get('/api/config', wrap(async (_req, res) => res.json(await py(['config-get']))))
  app.put('/api/config', wrap(async (req, res) => res.json(await py(['config-set'], req.body))))

  app.post('/api/offers/status', wrap(async (req, res) => {
    const { fp, status } = req.body || {}
    if (typeof fp !== 'string' || !STATUTS.includes(status)) return res.status(400).json({ error: 'Requête invalide' })
    res.json(await py(['status', fp, status]))
  }))

  // Travaux longs : flux NDJSON (une ligne JSON par évènement). Un seul de chaque type à la fois.
  const busy = { run: null, letter: null }
  const BUSY_MSG = { run: 'Une recherche est déjà en cours.', letter: 'Une lettre est déjà en cours de rédaction.' }
  function stream(res, kind, args, input) {
    if (busy[kind]) return res.status(409).json({ error: BUSY_MSG[kind] })
    res.set({ 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache' })
    res.flushHeaders()
    const p = spawnPy(args)
    busy[kind] = p
    let buf = ''
    let err = ''
    p.stdout.on('data', (d) => {
      buf += d
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (line.startsWith('{') && !res.destroyed) res.write(line + '\n')
      }
    })
    p.stderr.on('data', (d) => (err += d))
    const fail = (message) => { if (!res.destroyed) res.write(JSON.stringify({ type: 'error', message }) + '\n') }
    p.on('error', (e) => { busy[kind] = null; fail(`Impossible de lancer « ${python} » : ${e.message}`); res.end() })
    p.on('close', (code, signal) => {
      busy[kind] = null
      if (code !== 0 && !signal) fail(explain(err, code))
      res.end()
    })
    p.stdin.end(input === undefined ? '' : JSON.stringify(input))
    res.on('close', () => { if (busy[kind] === p) p.kill() }) // l'utilisateur a arrêté ou fermé la fenêtre
  }

  app.post('/api/run', (req, res) => {
    const max = Math.min(300, Math.max(1, parseInt(req.body?.max, 10) || 60))
    const days = JOURS.includes(Number(req.body?.days)) ? Number(req.body.days) : 7
    stream(res, 'run', ['run', '--max', String(max), '--days', String(days)])
  })

  app.post('/api/letter', (req, res) => {
    const fp = fpOf(req.body?.fp)
    if (!fp) return res.status(400).json({ error: 'Requête invalide' })
    stream(res, 'letter', ['letter', fp], { notes: String(req.body?.notes || '').slice(0, 2000) })
  })

  const dist = path.join(root, 'dist')
  if (fs.existsSync(dist)) {
    app.use(express.static(dist))
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')))
  }

  // 127.0.0.1 uniquement : l'API n'a pas d'authentification et expose ton CV.
  return new Promise((resolve, reject) => {
    const server = app.listen(port, '127.0.0.1', () => resolve({
      port: server.address().port,
      stop: () => { Object.values(busy).forEach((p) => p?.kill()); server.close() },
    }))
    server.on('error', reject)
  })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer().then(({ port }) => console.log(`API Job Hunter : http://127.0.0.1:${port}`))
}
