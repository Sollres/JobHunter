"""Dédoublonnage des offres. Lancer depuis la racine : python -m unittest discover -s tests"""
import os
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)  # jobhunter.py lit config.yaml au chargement
sys.path.insert(0, ROOT)
import jobhunter as jh  # noqa: E402


def offer(i=None, title="Data Scientist F/H", company="", url="", source="france_travail"):
    o = {"source": source, "title": title, "company": company, "location": "75", "contract": "CDI",
         "salary": "", "url": url, "description": ""}
    if i is not None:
        o["id"] = str(i)
    return o


class Dedupe(unittest.TestCase):
    def setUp(self):
        self.tmp, self.cwd = tempfile.TemporaryDirectory(), os.getcwd()
        os.chdir(self.tmp.name)  # base offers.db jetable
        self.db = jh.init_db()

    def tearDown(self):
        self.db.close()
        os.chdir(self.cwd)
        self.tmp.cleanup()

    def store(self, fp, url=""):
        self.db.execute("INSERT INTO offers (fp, title, company, location, url, score, verdict, resume, seen_at) "
                        "VALUES (?,?,?,?,?,?,?,?,?)", (fp, "t", "c", "l", url, 5, "", "", ""))
        self.db.commit()

    def test_meme_titre_sans_entreprise_mais_ids_differents(self):
        kept = jh.prefilter([offer(1), offer(2)], self.db)
        self.assertEqual(len(kept), 2)  # avant : la 2e offre était perdue

    def test_meme_offre_trouvee_par_deux_mots_cles(self):
        self.assertEqual(len(jh.prefilter([offer(1), offer(1)], self.db)), 1)

    def test_offre_deja_en_base(self):
        self.store("france_travail:1")
        kept = jh.prefilter([offer(1), offer(2)], self.db)
        self.assertEqual([o["id"] for o in kept], ["2"])

    def test_ancienne_empreinte_reconnue_par_url(self):
        self.store("data scientist f h|acme", url="https://x.fr/offre/9")
        kept = jh.prefilter([offer(9, company="Acme", url="https://x.fr/offre/9")], self.db)
        self.assertEqual(kept, [])  # déjà scorée avant la migration : pas de re-scoring

    def test_ancienne_empreinte_meme_titre_autre_url_pas_fusionnee(self):
        self.store("data scientist f h|acme", url="https://x.fr/offre/9")
        kept = jh.prefilter([offer(10, company="Acme", url="https://x.fr/offre/10")], self.db)
        self.assertEqual(len(kept), 1)

    def test_sans_id_retour_au_titre_et_entreprise(self):
        kept = jh.prefilter([offer(title="Data Scientist", company="ACME"),
                             offer(title="data  scientist", company="Acme")], self.db)
        self.assertEqual(len(kept), 1)

    def test_empreinte_par_source(self):
        self.assertNotEqual(jh.fingerprint(offer(1)), jh.fingerprint(offer(1, source="adzuna")))


class Stockage(unittest.TestCase):
    def setUp(self):
        self.tmp, self.cwd = tempfile.TemporaryDirectory(), os.getcwd()
        os.chdir(self.tmp.name)

    def tearDown(self):
        os.chdir(self.cwd)
        self.tmp.cleanup()

    def test_migration_ajoute_les_colonnes_a_une_ancienne_base(self):
        import sqlite3
        old = sqlite3.connect("offers.db")
        old.execute("CREATE TABLE offers (fp TEXT PRIMARY KEY, title TEXT, company TEXT, location TEXT, url TEXT, "
                    "score INTEGER, verdict TEXT, resume TEXT, seen_at TEXT)")
        old.execute("INSERT INTO offers (fp, title) VALUES ('a|b', 'Ancienne offre')")
        old.commit()
        old.close()
        db = jh.init_db()
        cols = {c[1] for c in db.execute("PRAGMA table_info(offers)")}
        self.assertTrue({"description", "contract", "salary", "letter"} <= cols)
        self.assertEqual(db.execute("SELECT title FROM offers").fetchone()[0], "Ancienne offre")  # rien de perdu
        db.close()

    def test_run_conserve_la_description_complete(self):
        o = offer(7, title="Data Scientist F/H", company="ACME", url="https://x.fr/7")
        o.update(description="Texte complet de l'offre. " * 300, salary="45 k€")
        res = {"score": 8, "verdict": "postuler", "points_forts": ["Python"], "manques": [], "resume": "ok"}
        saved = (jh.fetch_france_travail, jh.fetch_adzuna, jh.score_offer)
        jh.fetch_france_travail, jh.fetch_adzuna, jh.score_offer = (lambda log=print: [o]), (lambda: []), (lambda x: res)
        try:
            jh.CFG["llm"]["delay_seconds"] = 0
            jh.run(log=lambda m: None)
        finally:
            jh.fetch_france_travail, jh.fetch_adzuna, jh.score_offer = saved
        db = jh.init_db()
        desc, contract, salary = db.execute("SELECT description, contract, salary FROM offers").fetchone()
        self.assertEqual(desc, o["description"])  # complète, pas tronquée à 3500 caractères
        self.assertEqual((contract, salary), ("CDI", "45 k€"))


class Lettre(unittest.TestCase):
    def test_nettoyage_balises_de_reflexion_et_markdown(self):
        brut = "<think>je réfléchis</think>\n```text\nObjet : Candidature\n\nMadame, Monsieur,\n```"
        self.assertEqual(jh.clean_letter(brut), "Objet : Candidature\n\nMadame, Monsieur,")


if __name__ == "__main__":
    unittest.main()
