# Job Hunter

Application de bureau (Electron) : interface React + Vite, API Node (Express), moteur Python (`jobhunter.py`).

    fenêtre Electron ─► Express (port local libre) ─► bridge.py ─► jobhunter.py ─► offers.db

## Installation (une seule fois)
    conda activate jobhunter          # l'env qui contient requests, pyyaml, python-dotenv
    npm install

Node 18 ou plus. Ollama doit tourner en arrière-plan.
Les clés France Travail se saisissent dans **Réglages › Connexions** (écrites dans `.env`, jamais réaffichées).
L'onglet Recherche affiche l'état de France Travail et d'Ollama, et bloque le lancement si l'un est en rouge.

## Description, re-notation et lettre de motivation
Clique sur le titre d'une offre (ou « Détails et lettre ») pour ouvrir son panneau :
- **Description** : le texte complet de l'offre, conservé à chaque analyse (contrat et salaire aussi).
- **Re-noter** : refait noter l'offre avec ton CV et tes critères actuels (utile après avoir modifié le CV).
- **Lettre de motivation** : l'IA rédige une lettre à partir de ton CV, de l'offre et des points forts repérés ;
  tu peux ajouter des consignes (« mets en avant mon projet RAG »). Elle s'écrit en direct, reste modifiable,
  puis s'enregistre avec l'offre. Boutons Copier et Télécharger (.txt).
  L'IA n'invente rien d'après le CV, mais **relis tout** : les passages `[entre crochets]` (nom, coordonnées)
  sont à compléter, et chaque affirmation est à vérifier avant d'envoyer.

Les offres analysées avant cette version n'ont pas de description conservée : elles restent consultables et
modifiables, mais ne peuvent pas être re-notées, et leur lettre sera moins précise.

### Reprendre l'historique d'une ancienne version
Copie `offers.db`, `config.yaml`, `cv.txt` et `.env` dans ce dossier. Les offres déjà analysées sont
reconnues (par leur URL) et ne sont pas re-scorées malgré le nouvel identifiant d'offre.

## Ouvrir l'application
    conda activate jobhunter
    npm run app                       # compile l'interface puis ouvre la fenêtre
ou sur Mac : `chmod +x lancer-app.command` (une fois), puis double-clic.

## Créer une vraie app installable (.dmg / .exe / AppImage)
    npm run dist                      # résultat dans release/
À lancer sur le système visé (le .dmg se construit sur un Mac).
L'app installée range ses données dans le dossier utilisateur (menu « Job Hunter › Ouvrir le dossier de données ») :
`config.yaml`, `cv.txt`, `offers.db` et `.env` (rempli par l'écran Réglages).
Elle cherche seule l'env conda « jobhunter » ; sinon, écris le chemin de ton python dans `python-path.txt`
dans ce même dossier, ou définis `PYTHON_BIN`.

## Mode navigateur (développement)
    npm run dev                       # http://localhost:5173 (rechargement à chaud)

## Tests
    conda activate jobhunter
    python -m unittest discover -s tests

Ils couvrent le dédoublonnage, la conservation des descriptions, la migration de l'ancienne base, le pont Python
(clés, vérification d'Ollama, re-notation, lettre en flux).

## Fichiers
- `electron/main.cjs` : fenêtre, menu, démarrage de l'API, recherche du Python
- `server/index.js` : routes `/api/offers`, `/api/offer`, `/api/offer/rescore`, `/api/letter`, `/api/config`, `/api/check`, `/api/run`
- `bridge.py` : commandes JSON appelées par l'API (offers, status, config, run en flux)
- `src/` : interface (Recherche, Mes offres, Réglages)
- `tests/` : tests automatiques
- `app.py` : ancienne interface Streamlit, toujours utilisable (sans l'écran de clés)

L'API n'écoute que sur 127.0.0.1 et refuse toute requête adressée à un autre nom d'hôte (pas d'authentification, elle expose ton CV).
