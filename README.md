# Job Hunter

**Agent de veille d'offres d'emploi propulsé par un LLM** : il collecte les offres via l'API France Travail, les pré-filtre, puis demande à un modèle de langage de les **noter par rapport à ton CV et à tes critères**, avec un verdict, les points forts et les manques. Il peut ensuite **rédiger une lettre de motivation** personnalisée, en s'interdisant d'inventer quoi que ce soit.

Application de bureau (Electron) : interface React, API Node/Express, moteur Python. L'IA tourne **en local par défaut** (Ollama), sans clé ni coût, et peut être remplacée par n'importe quelle API compatible OpenAI.

> Projet personnel conçu pour démontrer des compétences de **AI Engineer / Data Scientist** : intégration de LLM en production, prompt engineering, sorties structurées, robustesse, tests et développement full-stack.

---

## Sommaire

- [Ce que fait l'application](#ce-que-fait-lapplication)
- [L'IA mise en place](#lia-mise-en-place)
- [Architecture](#architecture)
- [Stack technique](#stack-technique)
- [Installation](#installation)
- [Lancer l'application](#lancer-lapplication)
- [Configuration](#configuration)
- [Tests](#tests)
- [Sécurité et vie privée](#sécurité-et-vie-privée)
- [Limites et pistes d'amélioration](#limites-et-pistes-damélioration)
- [Structure du projet](#structure-du-projet)

---

## Ce que fait l'application

1. **Collecte** : interroge l'API *Offres d'emploi v2* de France Travail (par mots-clés, départements, type de contrat, ancienneté). Une source Adzuna est aussi supportée, en option.
2. **Pré-filtre gratuit** : dédoublonnage et exclusion de mots dans le titre (stage, alternance…), **avant** tout appel à l'IA, pour économiser du temps de calcul.
3. **Scoring par LLM** : chaque nouvelle offre reçoit une note de 0 à 10, un verdict (`postuler`, `peut-etre`, `ignorer`), des points forts, des manques et un résumé d'une phrase.
4. **Suivi** : les offres sont stockées en SQLite avec un statut (`à voir`, `à postuler`, `postulé`, `entretien`, `refusé`, `ignoré`).
5. **Re-notation** : après avoir modifié le CV ou les critères, une offre peut être re-notée à partir de sa description conservée.
6. **Lettre de motivation** : générée en direct (streaming), modifiable, enregistrée avec l'offre, exportable en `.txt`.

---

## L'IA mise en place

### Scoring : le LLM comme évaluateur (*LLM-as-a-judge*)

Le cœur du projet est `score_offer()` dans [`jobhunter.py`](jobhunter.py) :

- **Prompt structuré par balises XML** (`<cv>`, `<criteres>`, `<offre>`) : le modèle distingue clairement ce qui est donnée et ce qui est consigne.
- **Sortie JSON contrainte** (`score`, `verdict`, `points_forts`, `manques`, `resume`), extraite et validée côté code. Les types sont normalisés (`as_list`, conversion du score en entier) pour absorber les écarts de format des petits modèles.
- **`temperature = 0`** pour des notes reproductibles d'un run à l'autre.
- **Critères en texte libre** (`config.yaml`) : le modèle juge selon des préférences modifiables sans toucher au code (postes visés, localisation, salaire minimum, séniorité, technologies appréciées, profils à éviter).
- **Calibrage** : le prompt système impose d'être exigeant (« 7+ = vraiment à considérer »), pour éviter l'inflation de notes typique des LLM.

### Génération de lettres de motivation

`write_letter()` génère une lettre de 250 à 350 mots, avec des garde-fous contre les hallucinations :

- Le modèle doit utiliser **uniquement les faits présents dans le CV** : aucune expérience, aucun diplôme, aucun chiffre ni outil inventé.
- Les **manques détectés au scoring sont réinjectés** dans le prompt (« ne pas prétendre les avoir ») : le modèle met en avant des compétences proches réellement présentes plutôt que de bluffer.
- Les informations inconnues (nom, coordonnées) sont laissées **entre crochets** à compléter.
- **Consignes libres** du candidat possibles (« mets en avant mon projet RAG »).
- **Streaming SSE** du texte jusqu'à l'interface, avec gestion correcte de l'encodage UTF-8 du flux.
- `temperature = 0.6` : un peu de variété pour l'écriture, contrairement au scoring.

### Robustesse en conditions réelles

- **Défense contre l'injection de prompt** : le contenu des offres (non fiable) est déclaré comme donnée à analyser, jamais comme instruction à exécuter.
- **Backoff progressif sur les erreurs 429** (limites des offres gratuites) et pause configurable entre deux appels.
- **Tolérance aux pannes** : une offre dont le scoring échoue n'est pas marquée comme « vue » et sera retentée au prochain run. Si le modèle est injoignable, le run s'arrête proprement avec un message explicite.
- **Nettoyage des sorties** : suppression des balises `<think>…</think>` des modèles « raisonneurs » et des blocs markdown parasites.
- **Vérifications de santé** (`/api/check`) : l'interface affiche l'état de France Travail et du modèle d'IA (modèle présent ou non dans Ollama) et bloque le lancement si l'un est indisponible.

### Indépendance vis-à-vis du fournisseur

Le client LLM parle le protocole **OpenAI-compatible** (`/chat/completions`). On change de modèle en modifiant deux lignes de `config.yaml` :

| Option | Fournisseur | Coût |
|---|---|---|
| A (défaut) | **Ollama**, 100 % local (`qwen2.5:7b`) | Gratuit, sans clé, données sur ta machine |
| B | Groq (`llama-3.3-70b-versatile`) | Offre gratuite |
| C | Google Gemini (`gemini-2.5-flash`) | Offre gratuite |
| D | Mistral (`mistral-small-latest`) | Offre gratuite |

Avec Ollama, **ton CV ne quitte jamais ton ordinateur**.

---

## Architecture

```
Fenêtre Electron (React + Vite)
        │  HTTP, 127.0.0.1 uniquement
        ▼
API Express (server/index.js)
        │  processus enfant, échanges JSON
        ▼
bridge.py ──► jobhunter.py ──► API France Travail (collecte)
                  │          └─► LLM (Ollama / Groq / Gemini / Mistral)
                  ▼
              offers.db (SQLite)
```

- `bridge.py` expose le moteur Python sous forme de **commandes JSON**. La commande `run` émet un évènement par ligne (`log`, `offer`, `done`, `error`) pour que l'interface suive la progression **en direct**.
- Le moteur Python reste utilisable seul : `python jobhunter.py` (terminal) ou l'ancienne interface Streamlit.

---

## Stack technique

| Couche | Technologies |
|---|---|
| IA / data | Python 3.11, LLM via API OpenAI-compatible, Ollama, prompt engineering, sorties JSON structurées, streaming SSE |
| Données | SQLite (migrations de schéma automatiques), YAML, dédoublonnage par empreinte stable |
| Backend | Node.js 18+, Express |
| Frontend | React 18, Vite 6 |
| Desktop | Electron, electron-builder (`.dmg`, `.exe`, AppImage) |
| Qualité | `unittest` (23 tests) |

---

## Installation

### Prérequis

- **Conda** (Miniconda, Anaconda ou Miniforge)
- **Node.js 18+** (ou via conda : `conda install -c conda-forge nodejs`)
- **[Ollama](https://ollama.com)** pour l'IA locale
- Un compte développeur **[France Travail](https://francetravail.io)** (gratuit), pour obtenir un `client_id` et un `client_secret` avec accès à l'API *Offres d'emploi v2*

### Étapes

```bash
# 1. Récupérer le projet
git clone https://github.com/<ton-utilisateur>/JobHunter.git
cd JobHunter

# 2. Environnement Python
conda env create -f environment.yml
conda activate jobhunter

# 3. Modèle d'IA local (Ollama doit tourner en arrière-plan)
ollama pull qwen2.5:7b

# 4. Dépendances Node
npm install
```

---

## Lancer l'application

```bash
conda activate jobhunter
npm run app
```

Cette commande compile l'interface puis ouvre la fenêtre de l'application.

**Sur Mac**, double-clic possible : `chmod +x lancer-app.command` (une seule fois), puis ouvre `lancer-app.command`.

### Premier lancement

1. Ouvre l'onglet **Réglages › Connexions** et saisis ton `client_id` et ton `client_secret` France Travail. Ils sont écrits dans un fichier `.env` local (jamais commité, jamais réaffichés).
2. Remplace le contenu de **`cv.txt`** par ton propre CV en texte brut, et ajuste **`config.yaml`** (mots-clés, départements, critères).
3. Dans l'onglet **Recherche**, vérifie que France Travail et le modèle d'IA sont au vert, puis lance un run.

Les valeurs par défaut sont adaptées à un **premier test** (`min_score: 5`, `max_scored_per_run: 5`). En usage normal, passe-les à `7` et `60`.

### Autres modes

| Besoin | Commande |
|---|---|
| Mode navigateur avec rechargement à chaud | `npm run dev`, puis http://localhost:5173 |
| Serveur seul (une fois `npm run build` fait) | `npm start`, puis http://127.0.0.1:3001 |
| Terminal uniquement, sans interface | `python jobhunter.py` |
| Ancienne interface Streamlit | `streamlit run app.py` |
| App installable | `npm run dist` (résultat dans `release/`, à lancer sur le système visé) |

### Dépannage

- **« Impossible de lancer python3 »** : active l'environnement (`conda activate jobhunter`) ou indique ton Python avec `PYTHON_BIN=/chemin/vers/python npm run dev`. Pour l'app installée, écris ce chemin dans `python-path.txt` (menu *Job Hunter › Ouvrir le dossier de données*).
- **IA en rouge** : vérifie qu'Ollama tourne et que le modèle est téléchargé (`ollama list`).
- **France Travail en rouge** : vérifie tes identifiants dans Réglages et que ton application est abonnée à l'API *Offres d'emploi v2*.

---

## Configuration

Tout se règle dans `config.yaml` (ou depuis l'onglet Réglages) :

| Clé | Rôle |
|---|---|
| `keywords` | Mots-clés envoyés à l'API |
| `departements` | Zones de recherche (`72` = Sarthe, `75` = Paris…) |
| `contract_types` | `CDI`, `CDD`… (vide = tous) |
| `max_age_days` | Ancienneté maximale : 1, 3, 7, 14 ou 31 |
| `exclude_title_words` | Pré-filtre gratuit avant l'IA |
| `criteria` | Critères en texte libre donnés au LLM |
| `min_score` / `max_scored_per_run` | Seuil de notification / plafond d'offres notées par run |
| `llm` | `base_url`, `model`, `delay_seconds` : le fournisseur d'IA |

Clés optionnelles dans `.env` : `LLM_API_KEY` (Groq, Gemini, Mistral), `ADZUNA_APP_ID` / `ADZUNA_APP_KEY`, `TELEGRAM_TOKEN` / `TELEGRAM_CHAT_ID` (notification en mode terminal).

---

## Tests

```bash
conda activate jobhunter
python -m unittest discover -s tests
```

23 tests automatiques, sans appel réseau réel, qui couvrent :

- le **dédoublonnage** (même offre trouvée par deux mots-clés, offres homonymes, compatibilité avec l'ancienne empreinte) ;
- la **migration** d'une ancienne base SQLite ;
- la **conservation des descriptions** complètes ;
- le **nettoyage** des sorties de LLM (balises de réflexion, markdown) ;
- le **pont Python** : enregistrement des clés sans jamais les renvoyer, vérification d'Ollama (modèle absent, service éteint), re-notation, lettre en flux, édition manuelle.

---

## Sécurité et vie privée

- L'API n'écoute que sur **127.0.0.1** et **refuse toute requête adressée à un autre nom d'hôte** (protection contre le *DNS rebinding*), car elle expose ton CV sans authentification.
- Les secrets sont stockés dans `.env` (permissions `600`, exclu de git) et **jamais renvoyés à l'interface** : elle sait seulement qu'une clé est enregistrée.
- Les retours à la ligne dans les clés sont refusés (pas d'injection dans `.env`).
- Avec Ollama, aucune donnée personnelle n'est envoyée à un service tiers.
- `offers.db`, `resultats.csv` et `.env` sont ignorés par git.

---

## Limites et pistes d'amélioration

- Le scoring n'est pas encore **évalué quantitativement** : un jeu d'offres annotées à la main permettrait de mesurer la corrélation entre les notes du modèle et mon jugement, et de comparer les modèles (taille, fournisseur) ou les versions de prompt.
- Un **modèle de 7B paramètres** reste moins fiable qu'un grand modèle sur les nuances (séniorité, localisation). Passer à un modèle plus gros via Groq ou Gemini est un simple changement de configuration.
- Pistes : pré-sélection par **embeddings** avant le LLM pour réduire les coûts, **sorties structurées natives** (JSON schema) plutôt que l'extraction par expression régulière, nouvelles sources d'offres, suivi des candidatures avec relances.

---

## Structure du projet

```
├── jobhunter.py          Moteur : collecte, filtre, scoring IA, lettre de motivation
├── bridge.py             Pont JSON entre l'API Node et le moteur Python
├── server/index.js       API Express (routes /api/offers, /api/run, /api/letter…)
├── electron/main.cjs     Fenêtre de bureau, menu, détection du Python
├── src/                  Interface React (Recherche, Mes offres, Réglages)
├── tests/                Tests automatiques
├── config.yaml           Recherche, critères et fournisseur d'IA
├── cv.txt                Ton CV en texte brut (à remplacer)
├── app.py                Ancienne interface Streamlit
└── environment.yml       Environnement conda
```
