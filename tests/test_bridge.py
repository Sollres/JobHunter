"""Pont Python : enregistrement des clés et vérification des connexions (faux serveur Ollama local)."""
import json
import os
import shutil
import subprocess
import sqlite3
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELES = {"data": [{"id": "qwen2.5:7b"}, {"id": "llama3.2:latest"}]}


class FakeOllama(BaseHTTPRequestHandler):
    def do_GET(self):
        body = json.dumps(MODELES).encode()
        self.send_response(200 if self.path == "/v1/models" else 404)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        FakeOllama.requests.append(body)
        self.send_response(200)
        if body.get("stream"):  # lettre : flux SSE, un mot à la fois (avec des accents pour tester l'encodage)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            for w in FakeOllama.LETTRE:
                self.wfile.write(("data: " + json.dumps({"choices": [{"delta": {"content": w}}]}) + "\n\n").encode())
            self.wfile.write(b"data: [DONE]\n\n")
        else:  # notation
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            note = {"score": 9, "verdict": "postuler", "points_forts": ["RAG"], "manques": ["Azure"], "resume": "Re-noté"}
            self.wfile.write(json.dumps({"choices": [{"message": {"content": json.dumps(note)}}]}).encode())

    requests = []
    LETTRE = ["Objet : ", "Candidature ", "à un poste ", "d'ingénieur ", "IA.\n\n", "Madame, ", "Monsieur, ", "[Prénom NOM]"]

    def log_message(self, *a):
        pass


class Bridge(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = HTTPServer(("127.0.0.1", 0), FakeOllama)
        cls.port = cls.srv.server_address[1]
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()

    def setUp(self):
        self.home = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.home)
        shutil.copy(os.path.join(ROOT, "cv.txt"), self.home)
        self.set_llm(f"http://127.0.0.1:{self.port}/v1", "qwen2.5:7b")

    def set_llm(self, base, model):
        import yaml
        with open(os.path.join(ROOT, "config.yaml"), encoding="utf-8") as f:
            cfg = yaml.safe_load(f)
        cfg["llm"].update(base_url=base, model=model)
        with open(os.path.join(self.home, "config.yaml"), "w", encoding="utf-8") as f:
            yaml.safe_dump(cfg, f, allow_unicode=True)

    def bridge(self, *args, stdin=None):
        env = {k: v for k, v in os.environ.items() if not k.startswith(("FT_", "LLM_API"))}
        env["JOBHUNTER_HOME"] = self.home
        r = subprocess.run([sys.executable, os.path.join(ROOT, "bridge.py"), *args], input=stdin, text=True,
                           capture_output=True, env=env, cwd=self.home)
        self.assertEqual(r.returncode, 0, r.stderr)
        return r.stdout, json.loads(r.stdout)

    def env_text(self):
        with open(os.path.join(self.home, ".env")) as f:
            return f.read()

    def bridge_lines(self, *args, stdin=None):
        """Commande en flux : une ligne JSON par évènement."""
        raw, _ = self.bridge_raw(*args, stdin=stdin)
        return [json.loads(line) for line in raw.strip().splitlines()]

    def bridge_raw(self, *args, stdin=None):
        env = {k: v for k, v in os.environ.items() if not k.startswith(("FT_", "LLM_API"))}
        env["JOBHUNTER_HOME"] = self.home
        r = subprocess.run([sys.executable, os.path.join(ROOT, "bridge.py"), *args], input=stdin, text=True,
                           capture_output=True, env=env, cwd=self.home, encoding="utf-8")
        return r.stdout, r

    def seed(self, fp="france_travail:1", description="Mission : développer des agents RAG. " * 40, **kw):
        self.bridge("offers")  # crée la base (schéma à jour)
        db = sqlite3.connect(os.path.join(self.home, "offers.db"))
        db.execute("INSERT INTO offers (fp, title, company, location, url, score, verdict, resume, seen_at, "
                   "points_forts, manques, status, description, contract, salary) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                   (fp, "Ingénieur IA", "ACME", "72 - Le Mans", "https://x.fr/1", 6, "peut-etre", "Résumé initial",
                    "2026-10-01", "Python; LLM", "Docker", "à voir", description, "CDI", "45 k€"))
        db.commit()
        db.close()

    def save(self, **extra):
        _, cfg = self.bridge("config-get")
        payload = {k: cfg[k] for k in ("keywords", "departements", "contract_types", "criteria", "min_score",
                                         "model", "cv")}
        return self.bridge("config-set", stdin=json.dumps({**payload, **extra}))

    def test_cles_enregistrees_sans_jamais_etre_renvoyees(self):
        raw, cfg = self.save(ft_client_id="mon-id", ft_client_secret="s3cret-xyz", llm_api_key="gsk-abc")
        self.assertEqual(cfg["ft_client_id"], "mon-id")
        self.assertTrue(cfg["ft_secret_set"] and cfg["llm_key_set"])
        for secret in ("s3cret-xyz", "gsk-abc"):
            self.assertNotIn(secret, raw)
            self.assertNotIn(secret, self.bridge("config-get")[0])
        self.assertIn("s3cret-xyz", self.env_text())
        if os.name == "posix":
            self.assertEqual(os.stat(os.path.join(self.home, ".env")).st_mode & 0o077, 0)

    def test_secret_vide_conserve_l_ancien(self):
        self.save(ft_client_id="a", ft_client_secret="garde-moi")
        _, cfg = self.save(ft_client_id="b", ft_client_secret="")
        self.assertEqual(cfg["ft_client_id"], "b")
        self.assertTrue(cfg["ft_secret_set"])
        self.assertIn("garde-moi", self.env_text())

    def test_retour_a_la_ligne_refuse(self):
        r = subprocess.run([sys.executable, os.path.join(ROOT, "bridge.py"), "config-set"], capture_output=True,
                           text=True, cwd=self.home, env={**os.environ, "JOBHUNTER_HOME": self.home},
                           input=json.dumps({"keywords": [], "departements": [], "contract_types": [], "criteria": "",
                                             "min_score": 5, "model": "m", "cv": "", "ft_client_secret": "a\nb"}))
        self.assertNotEqual(r.returncode, 0)

    def test_check_ia_ok_et_ft_sans_cles(self):
        _, c = self.bridge("check")
        self.assertEqual(c["llm"]["state"], "ok")
        self.assertEqual(c["ft"]["state"], "bad")
        self.assertIn("manquants", c["ft"]["message"])

    def test_check_modele_introuvable(self):
        self.set_llm(f"http://127.0.0.1:{self.port}/v1", "inconnu:1b")
        _, c = self.bridge("check")
        self.assertEqual(c["llm"]["state"], "bad")
        self.assertIn("ollama pull inconnu:1b", c["llm"]["message"])

    def test_check_service_eteint(self):
        self.set_llm("http://127.0.0.1:9/v1", "qwen2.5:7b")
        _, c = self.bridge("check")
        self.assertEqual(c["llm"]["state"], "bad")
        self.assertIn("Ollama ne répond pas", c["llm"]["message"])


    # ---- description complète, re-notation, lettre

    def test_liste_legere_et_detail_complet(self):
        self.seed()
        _, liste = self.bridge("offers")
        self.assertNotIn("description", liste[0])  # la liste reste légère
        self.assertTrue(liste[0]["has_description"])
        self.assertFalse(liste[0]["has_letter"])
        _, d = self.bridge("offer", "france_travail:1")
        self.assertEqual((d["contract"], d["salary"]), ("CDI", "45 k€"))
        self.assertGreater(len(d["description"]), 1000)
        self.assertEqual(d["points_forts"], ["Python", "LLM"])

    def test_offre_inconnue(self):
        self.seed()
        _, r = self.bridge_raw("offer", "nimporte:quoi")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("introuvable", r.stderr)

    def test_re_notation_met_a_jour_note_et_analyse_sans_toucher_au_statut(self):
        self.seed()
        self.bridge("status", "france_travail:1", "postulé")
        _, d = self.bridge("rescore", "france_travail:1")
        self.assertEqual((d["score"], d["resume"], d["points_forts"], d["manques"]), (9, "Re-noté", ["RAG"], ["Azure"]))
        self.assertEqual(d["status"], "postulé")
        self.assertIn("Mission", FakeOllama.requests[-1]["messages"][1]["content"])  # la description est bien envoyée

    def test_re_notation_impossible_sans_description(self):
        self.seed(description="")
        _, r = self.bridge_raw("rescore", "france_travail:1")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("Description non conservée", r.stderr)

    def test_lettre_en_flux_puis_enregistree(self):
        self.seed()
        ev = self.bridge_lines("letter", "france_travail:1", stdin=json.dumps({"notes": "Insiste sur le RAG"}))
        deltas = [e["text"] for e in ev if e["type"] == "delta"]
        self.assertEqual(deltas, FakeOllama.LETTRE)  # un évènement par morceau, accents intacts
        self.assertEqual(ev[-1]["type"], "done")
        self.assertEqual(ev[-1]["letter"], "".join(FakeOllama.LETTRE).strip())
        prompt = FakeOllama.requests[-1]["messages"][1]["content"]
        self.assertIn("Insiste sur le RAG", prompt)
        self.assertIn("Docker", prompt)  # les manques sont transmis pour ne pas être revendiqués
        self.assertIn("agents RAG", prompt)  # description complète
        _, d = self.bridge("offer", "france_travail:1")
        self.assertEqual(d["letter"], ev[-1]["letter"])
        self.assertTrue(self.bridge("offers")[1][0]["has_letter"])

    def test_lettre_erreur_si_ia_eteinte(self):
        self.seed()
        self.set_llm("http://127.0.0.1:9/v1", "qwen2.5:7b")
        ev = self.bridge_lines("letter", "france_travail:1", stdin="{}")
        self.assertEqual(ev[-1]["type"], "error")
        self.assertIn("Ollama", ev[-1]["message"])
        self.assertEqual(self.bridge("offer", "france_travail:1")[1]["letter"] or "", "")

    def test_modification_manuelle_de_la_lettre(self):
        self.seed()
        self.bridge("save-letter", stdin=json.dumps({"fp": "france_travail:1", "letter": "Ma version à moi ✍️"}))
        self.assertEqual(self.bridge("offer", "france_travail:1")[1]["letter"], "Ma version à moi ✍️")


if __name__ == "__main__":
    unittest.main()
