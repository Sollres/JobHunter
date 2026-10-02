"""Interface locale de Job Hunter. Lancer avec : streamlit run app.py"""
import re
import sqlite3

import streamlit as st
import yaml
import pandas as pd

import jobhunter as jh

STATUTS = ["à voir", "à postuler", "postulé", "entretien", "refusé", "ignoré"]

st.set_page_config(page_title="Job Hunter", page_icon="🎯", layout="wide")
st.title("🎯 Job Hunter")
tab_run, tab_offers, tab_settings = st.tabs(["🔎 Recherche", "📋 Mes offres", "⚙️ Réglages"])


def card(o):
    with st.container(border=True):
        titre = f"[{o['title']}]({o['url']})" if o["url"] else o["title"]
        st.markdown(f"**{o['score']}/10 · {titre}**  \n{o['company']} · {o['location']}")
        st.caption(o["resume"])
        if o["points_forts"]:
            st.markdown("✅ " + " · ".join(o["points_forts"]))
        if o["manques"]:
            st.markdown("⚠️ " + " · ".join(o["manques"]))


def liste(texte):
    return [x.strip() for x in re.split(r"[,\n]", texte) if x.strip()]


# ---------- Recherche ----------
with tab_run:
    c1, c2 = st.columns(2)
    n_max = c1.number_input("Offres max à analyser", 1, 300, int(jh.CFG.get("max_scored_per_run", 60)))
    jours = [1, 3, 7, 14, 31]
    cur = jh.CFG.get("max_age_days", 7)
    days = c2.selectbox("Publiées depuis (jours)", jours, index=jours.index(cur) if cur in jours else 2)

    if st.button("🚀 Lancer la recherche", type="primary", key="run"):
        jh.CFG["max_scored_per_run"] = int(n_max)
        jh.CFG["max_age_days"] = days
        seuil = jh.CFG.get("min_score", 7)
        bar = st.progress(0.0, text="Récupération des offres…")
        shown = st.container()
        found = []

        def on_offer(i, total, o):
            bar.progress(i / total, text=f"Analyse {i}/{total} : {o['title'][:60]}")
            if o["score"] >= seuil:
                found.append(o)
                with shown:
                    card(o)

        try:
            jh.run(log=st.caption, on_offer=on_offer)
        except Exception as e:
            st.error(f"Erreur : {e}")
        bar.empty()
        st.success(f"Terminé : {len(found)} offre(s) à {seuil}/10 ou plus. "
                   "Tout l'historique est dans l'onglet « Mes offres ».")

# ---------- Mes offres ----------
with tab_offers:
    db = jh.init_db()
    df = pd.read_sql(
        "SELECT fp, score, title, company, location, status, resume, points_forts, manques, url, seen_at "
        "FROM offers ORDER BY score DESC, seen_at DESC", db)
    if df.empty:
        st.info("Aucune offre pour l'instant. Lance une recherche dans le premier onglet.")
    else:
        df["status"] = df["status"].fillna("à voir")
        f1, f2 = st.columns(2)
        min_s = f1.slider("Score minimum", 0, 10, 5)
        choix = f2.multiselect("Statuts", STATUTS, default=STATUTS)
        view = df[(df["score"] >= min_s) & (df["status"].isin(choix))].set_index("fp")
        edited = st.data_editor(
            view.drop(columns=["seen_at"]),
            hide_index=True,
            disabled=[c for c in view.columns if c not in ("status",)],
            column_config={
                "score": "Score", "title": "Poste", "company": "Entreprise", "location": "Lieu",
                "status": st.column_config.SelectboxColumn("Statut", options=STATUTS),
                "resume": "Résumé", "points_forts": "Points forts", "manques": "Manques",
                "url": st.column_config.LinkColumn("Lien", display_text="Ouvrir"),
            },
            key="editor",
        )
        if st.button("💾 Enregistrer les statuts", key="save_status"):
            for fp, row in edited.iterrows():
                db.execute("UPDATE offers SET status=? WHERE fp=?", (row["status"], fp))
            db.commit()
            st.success("Statuts enregistrés.")

# ---------- Réglages ----------
with tab_settings:
    cfg = yaml.safe_load(open("config.yaml", encoding="utf-8"))
    kw = st.text_area("Mots-clés (un par ligne)", "\n".join(cfg["keywords"]), height=150)
    d1, d2 = st.columns(2)
    dep = d1.text_input("Départements (séparés par des virgules)", ", ".join(cfg.get("departements", [])))
    contrat = d2.text_input("Types de contrat (vide = tous)", ", ".join(cfg.get("contract_types", [])))
    crit = st.text_area("Critères donnés à l'IA", cfg["criteria"], height=220)
    s1, s2 = st.columns(2)
    min_score = s1.slider("Score minimum pour être mis en avant", 0, 10, int(cfg.get("min_score", 7)))
    modele = s2.text_input("Modèle Ollama", cfg["llm"]["model"])
    cv = st.text_area("CV en texte brut (sans données personnelles)", open("cv.txt", encoding="utf-8").read(),
                      height=300)
    if st.button("💾 Enregistrer les réglages", key="save_cfg"):
        cfg.update(keywords=liste(kw), departements=liste(dep), contract_types=liste(contrat),
                   criteria=crit, min_score=min_score)
        cfg["llm"]["model"] = modele
        yaml.safe_dump(cfg, open("config.yaml", "w", encoding="utf-8"), allow_unicode=True, sort_keys=False)
        open("cv.txt", "w", encoding="utf-8").write(cv)
        jh.load_settings()
        st.success("Réglages enregistrés.")
