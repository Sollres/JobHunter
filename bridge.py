"""Pont entre l'API Node et jobhunter.py.

Chaque commande répond en JSON sur stdout (une ligne). La commande `run` émet un évènement JSON
par ligne (log / offer / done / error) pour que l'interface suive la progression en direct.
Usage : python bridge.py offers | offer <fp> | rescore <fp> | letter <fp> | save-letter | status <fp> <statut>
        | config-get | config-set | check | run --max N --days D
"""
import argparse
import json
import os
import sqlite3
import sys

CODE_DIR = os.path.dirname(os.path.abspath(__file__))
HOME_DIR = os.environ.get("JOBHUNTER_HOME") or CODE_DIR  # où vivent config.yaml, cv.txt, offers.db, .env
os.chdir(HOME_DIR)  # jobhunter.py lit ces fichiers en relatif
sys.path.insert(0, CODE_DIR)
OUT = sys.stdout
sys.stdout = sys.stderr  # tout print parasite part sur stderr et ne pollue pas le JSON

import yaml  # noqa: E402
import requests  # noqa: E402
from dotenv import load_dotenv, set_key  # noqa: E402

ENV_PATH = os.path.join(HOME_DIR, ".env")
load_dotenv(ENV_PATH, override=True)  # avant jobhunter, dont le load_dotenv() ne cherche pas ici
import jobhunter as jh  # noqa: E402

STATUTS = ["à voir", "à postuler", "postulé", "entretien", "refusé", "ignoré"]


def emit(obj):
    OUT.write(json.dumps(obj, ensure_ascii=False) + "\n")
    OUT.flush()


def split(text):
    return [x.strip() for x in (text or "").split(";") if x.strip()]


def public(o):
    return {"fp": o["fp"], "score": o["score"], "title": o["title"], "company": o["company"],
            "location": o["location"], "url": o["url"], "resume": o["resume"],
            "points_forts": o["points_forts"], "manques": o["manques"], "status": "à voir"}


LIGHT = ("fp, score, title, company, location, status, resume, points_forts, manques, url, seen_at, contract, salary, "
         "(COALESCE(letter,'')<>'') AS has_letter, (COALESCE(description,'')<>'') AS has_description")


def to_offer(r):
    d = dict(r)
    d.update(status=d.get("status") or "à voir", points_forts=split(d.get("points_forts")),
             manques=split(d.get("manques")))
    for k in ("has_letter", "has_description"):
        if k in d:
            d[k] = bool(d[k])
    return d


def get_offer(db, fp):
    r = db.execute(f"SELECT {LIGHT}, description, letter FROM offers WHERE fp=?", (fp,)).fetchone()
    if r is None:
        raise ValueError("Offre introuvable")
    return to_offer(r)


def open_db():
    db = jh.init_db()
    db.row_factory = sqlite3.Row
    return db


def llm_error(e):
    if isinstance(e, requests.ConnectionError):
        return "Impossible de joindre le modèle d'IA. Ollama est-il lancé ?"
    if isinstance(e, requests.Timeout):
        return "Le modèle d'IA met trop de temps à répondre"
    return str(e)


def cmd_offers(_):
    db = open_db()
    emit([to_offer(r) for r in db.execute(f"SELECT {LIGHT} FROM offers ORDER BY score DESC, seen_at DESC")])


def cmd_offer(a):
    emit(get_offer(open_db(), a.fp))


def cmd_rescore(a):
    """Refait noter une offre (par exemple après avoir modifié le CV ou les critères)."""
    db = open_db()
    o = get_offer(db, a.fp)
    if not o["description"]:
        raise ValueError("Description non conservée pour cette offre : impossible de la re-noter")
    try:
        res = jh.score_offer(o)
        score = int(float(res.get("score", 0)))
    except (requests.RequestException, RuntimeError) as e:
        raise ValueError(llm_error(e)) from e
    except (AttributeError, ValueError, TypeError) as e:
        raise ValueError("Le modèle a renvoyé une réponse illisible, réessaie") from e
    db.execute("UPDATE offers SET score=?, verdict=?, resume=?, points_forts=?, manques=? WHERE fp=?",
               (score, str(res.get("verdict", "")), str(res.get("resume", "")),
                "; ".join(jh.as_list(res.get("points_forts"))), "; ".join(jh.as_list(res.get("manques"))), a.fp))
    db.commit()
    emit(get_offer(db, a.fp))


def cmd_letter(a):
    """Rédige la lettre en flux (évènements delta / done / error) et l'enregistre quand elle est terminée."""
    try:
        notes = str(json.load(sys.stdin).get("notes", ""))[:2000]
        db = open_db()
        o = get_offer(db, a.fp)
        letter = jh.write_letter(o, notes, on_delta=lambda t: emit({"type": "delta", "text": t}))
        db.execute("UPDATE offers SET letter=? WHERE fp=?", (letter, a.fp))
        db.commit()
        emit({"type": "done", "letter": letter})
    except Exception as e:  # noqa: BLE001
        emit({"type": "error", "message": llm_error(e)})


def cmd_save_letter(_):
    p = json.load(sys.stdin)
    db = open_db()
    get_offer(db, p["fp"])
    db.execute("UPDATE offers SET letter=? WHERE fp=?", (str(p["letter"])[:20000], p["fp"]))
    db.commit()
    emit({"ok": True})


def cmd_status(a):
    if a.status not in STATUTS:
        raise ValueError(f"Statut inconnu : {a.status}")
    db = jh.init_db()
    cur = db.execute("UPDATE offers SET status=? WHERE fp=?", (a.status, a.fp))
    db.commit()
    if cur.rowcount == 0:
        raise ValueError("Offre introuvable")
    emit({"ok": True})


def config_view():
    c = jh.CFG
    return {"keywords": c.get("keywords", []), "departements": [str(d) for d in c.get("departements", [])],
            "contract_types": c.get("contract_types", []), "criteria": c.get("criteria", ""),
            "min_score": int(c.get("min_score", 7)), "model": c["llm"]["model"],
            "max_scored_per_run": int(c.get("max_scored_per_run", 60)),
            "max_age_days": int(c.get("max_age_days", 7)), "cv": jh.CV,
            "ft_client_id": os.getenv("FT_CLIENT_ID", ""), "ft_secret_set": bool(os.getenv("FT_CLIENT_SECRET")),
            "llm_key_set": bool(os.getenv("LLM_API_KEY")), "llm_base_url": c["llm"]["base_url"]}


def cmd_config_get(_):
    emit(config_view())


def save_env(values):
    """Écrit dans .env les clés fournies. Un secret vide = on garde l'ancien ; l'identifiant, lui, peut être vidé."""
    todo = {k: str(v).strip() for k, v in values.items()
            if v is not None and (str(v).strip() or k == "FT_CLIENT_ID")}
    if any("\n" in v or "\r" in v for v in todo.values()):
        raise ValueError("Une clé ne peut pas contenir de retour à la ligne")
    if not todo:
        return
    open(ENV_PATH, "a").close()  # set_key ne crée pas le fichier selon les versions
    for k, v in todo.items():
        set_key(ENV_PATH, k, v)
    try:
        os.chmod(ENV_PATH, 0o600)  # contient des secrets
    except OSError:
        pass
    load_dotenv(ENV_PATH, override=True)


def cmd_config_set(_):
    p = json.load(sys.stdin)
    cfg = yaml.safe_load(open("config.yaml", encoding="utf-8"))
    lst = lambda k: [str(x).strip() for x in p[k] if str(x).strip()]  # noqa: E731
    cfg.update(keywords=lst("keywords"), departements=lst("departements"), contract_types=lst("contract_types"),
               criteria=str(p["criteria"]), min_score=max(0, min(10, int(p["min_score"]))))
    cfg["llm"]["model"] = str(p["model"]).strip()
    save_env({"FT_CLIENT_ID": p.get("ft_client_id"), "FT_CLIENT_SECRET": p.get("ft_client_secret"),
              "LLM_API_KEY": p.get("llm_api_key")})
    yaml.safe_dump(cfg, open("config.yaml", "w", encoding="utf-8"), allow_unicode=True, sort_keys=False)
    open("cv.txt", "w", encoding="utf-8").write(str(p["cv"]))
    jh.load_settings()
    emit(config_view())


def check_ft():
    """Vérifie les identifiants France Travail (simple demande de jeton, aucune recherche)."""
    msgs = []
    try:
        headers = jh.ft_auth(msgs.append, timeout=8)
    except requests.RequestException:
        return {"state": "unknown", "message": "France Travail injoignable (pas de réseau ?)"}
    if headers:
        return {"state": "ok", "message": "Identifiants acceptés"}
    msg = msgs[0].replace("⚠️", "").strip() if msgs else "Identifiants refusés"
    if "introuvables" in msg:
        msg = "Identifiants manquants : renseigne-les dans Réglages"
    elif "refusée" in msg:
        msg = "Identifiants refusés par France Travail : vérifie l'identifiant et la clé secrète"
    return {"state": "bad", "message": msg}


def check_llm():
    """Vérifie que le service d'IA répond et que le modèle choisi existe."""
    llm = jh.CFG["llm"]
    base, model = llm["base_url"].rstrip("/"), llm["model"]
    local = "localhost" in base or "127.0.0.1" in base
    try:
        r = requests.get(f"{base}/models", headers={"Authorization": f"Bearer {os.getenv('LLM_API_KEY') or 'none'}"},
                         timeout=5)
    except requests.ConnectionError:
        return {"state": "bad", "message": "Ollama ne répond pas : est-il lancé ?" if local
                else "Le service d'IA ne répond pas"}
    except requests.RequestException:
        return {"state": "unknown", "message": "Le service d'IA met trop de temps à répondre"}
    if r.status_code in (401, 403):
        return {"state": "bad", "message": "Clé API du modèle refusée : vérifie-la dans Réglages"}
    if r.status_code != 200:
        return {"state": "unknown", "message": f"Impossible de vérifier le modèle (code {r.status_code})"}
    try:
        ids = [m.get("id", "") for m in r.json().get("data", [])]
    except ValueError:
        return {"state": "unknown", "message": "Réponse inattendue du service d'IA"}
    if any(i == model or i == f"{model}:latest" or i.endswith("/" + model) for i in ids):
        return {"state": "ok", "message": f"Modèle {model} prêt"}
    return {"state": "bad", "message": f"Modèle « {model} » introuvable" + (f" : ollama pull {model}" if local else "")}


def cmd_check(_):
    emit({"ft": check_ft(), "llm": check_llm()})


def cmd_run(a):
    jh.CFG["max_scored_per_run"] = a.max
    jh.CFG["max_age_days"] = a.days
    try:
        scored = jh.run(log=lambda m: emit({"type": "log", "message": str(m)}),
                        on_offer=lambda i, n, o: emit({"type": "offer", "i": i, "total": n, "offer": public(o)}))
        emit({"type": "done", "count": len(scored)})
    except Exception as e:  # noqa: BLE001
        emit({"type": "error", "message": str(e)})


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("offers").set_defaults(fn=cmd_offers)
    for name, fn in (("offer", cmd_offer), ("rescore", cmd_rescore), ("letter", cmd_letter)):
        sp = sub.add_parser(name)
        sp.add_argument("fp")
        sp.set_defaults(fn=fn)
    sub.add_parser("save-letter").set_defaults(fn=cmd_save_letter)
    s = sub.add_parser("status")
    s.add_argument("fp")
    s.add_argument("status")
    s.set_defaults(fn=cmd_status)
    sub.add_parser("config-get").set_defaults(fn=cmd_config_get)
    sub.add_parser("config-set").set_defaults(fn=cmd_config_set)
    sub.add_parser("check").set_defaults(fn=cmd_check)
    r = sub.add_parser("run")
    r.add_argument("--max", type=int, default=60)
    r.add_argument("--days", type=int, default=7)
    r.set_defaults(fn=cmd_run)
    a = ap.parse_args()
    try:
        a.fn(a)
    except Exception as e:  # noqa: BLE001
        print(str(e) if isinstance(e, ValueError) else f"{type(e).__name__}: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
