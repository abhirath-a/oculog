"""Offline stdlib tests. Retrieval tests execute real SQLite FTS5, never mocks."""
import copy
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from email.message import Message
import hashlib
import io
import json
from pathlib import Path
import sqlite3
import ssl
import tempfile
import unittest
from unittest.mock import patch

from backend.education import corpus as sources
from backend.education.retrieval import retrieve
from scripts import update_education_corpus as update


class CorpusTests(unittest.TestCase):
    def setUp(self):
        self.data = sources.load_corpus()

    def invalid(self, change):
        data = copy.deepcopy(self.data)
        change(data)
        with self.assertRaises(sources.CorpusError):
            sources.validate_corpus(data)

    def test_snapshot_and_real_fts5(self):
        sources.validate_corpus(self.data)
        self.assertEqual(len(self.data["documents"]), 11)
        self.assertEqual(len(self.data["chunks"]), 53)
        with closing(sqlite3.connect(":memory:")) as connection:
            connection.execute("CREATE VIRTUAL TABLE actual USING fts5(text)")
            connection.execute("INSERT INTO actual VALUES ('peroxide neutralization')")
            self.assertTrue(connection.execute("SELECT bm25(actual) FROM actual WHERE actual MATCH ?", ('"peroxide"',)).fetchall())

    def test_exact_source_spans_and_ids(self):
        docs = {d["id"]: d for d in self.data["documents"]}
        for chunk in self.data["chunks"]:
            self.assertIn(chunk["text"], docs[chunk["document_id"]]["main_text"])
            self.assertEqual(chunk["content_sha256"], sources.sha256(chunk["text"]))
            self.assertEqual(chunk["id"], sources.chunk_id(chunk["document_id"], chunk["text"]))
            self.assertLess(len(chunk["id"]), 128)
            self.assertLessEqual(len(chunk["text"]), 1800)
        self.assertNotIn("questions", self.data)

    def test_reproducible_revision_ignores_transport_time(self):
        other = copy.deepcopy(self.data)
        for doc in other["documents"]:
            doc["fetched_at"] = "2027-01-01T00:00:00Z"
            doc["raw_sha256"] = "0" * 64
        for chunk in other["chunks"]:
            chunk["fetched_at"] = "2027-01-01T00:00:00Z"
        self.assertEqual(sources.revision_for(other), self.data["revision"])
        sources.validate_corpus(other)
        other["chunks"][0]["text"] += " changed"
        self.assertNotEqual(sources.revision_for(other), self.data["revision"])

    def test_separate_spanish_revisions(self):
        docs = {d["id"]: d for d in self.data["documents"]}
        self.assertEqual(docs["cdc-prevent-es"]["source_modified_at"], "2025-04-07")
        self.assertEqual(docs["nei-contacts-es"]["source_modified_at"], "2025-01-02")
        self.assertNotEqual(docs["nei-contacts-es"]["source_modified_at"], docs["nei-contacts"]["source_modified_at"])

    def test_invalid_hashes_fail_wholly(self):
        self.invalid(lambda d: d["chunks"][0].update(content_sha256="0" * 64))
        self.invalid(lambda d: d["documents"][0].update(content_sha256="0" * 64))
        self.invalid(lambda d: d.update(revision="0" * 64))
        self.invalid(lambda d: d["documents"][0].update(raw_sha256="not-a-hash"))

    def test_invalid_ids_and_missing_evidence(self):
        self.invalid(lambda d: d["chunks"].append(d["chunks"][0]))
        self.invalid(lambda d: d["documents"].append(d["documents"][0]))
        self.invalid(lambda d: d["chunks"][0].update(document_id="missing"))
        self.invalid(lambda d: d["chunks"][0].update(id="unstable"))
        self.invalid(lambda d: d.update(chunks=[]))
        self.invalid(lambda d: d.update(documents=[]))

    def test_untrusted_urls(self):
        for url in ("http://www.cdc.gov/contact-lenses/about/index.html",
                    "https://www.cdc.gov.evil.test/contact-lenses/about/index.html",
                    "https://www.cdc.gov@evil.test/", "https://www.cdc.gov:444/",
                    sources.SEEDS["cdc-care"][2] + "#fragment",
                    sources.SEEDS["cdc-care"][2] + "?query=untrusted",
                    "https://127.0.0.1/", "https://www.cdc.gov/other"):
            with self.subTest(url=url):
                self.invalid(lambda d: d["documents"][0].update(url=url))

    def test_malformed_fields_and_controls(self):
        self.invalid(lambda d: d.update(extra="hidden"))
        self.invalid(lambda d: d["documents"][0].update(title="bad\x00title"))
        self.invalid(lambda d: d["documents"][0].update(main_text="bad\x1btext"))
        self.invalid(lambda d: d["documents"][0].update(fetched_at="2026-99-99T00:00:00Z"))
        self.invalid(lambda d: d["documents"][0].update(fetched_at="2026-01-01T00:00:00+01:00"))
        self.invalid(lambda d: d["documents"][0].update(source_modified_at="2026-02-31"))
        self.invalid(lambda d: d["chunks"][0].update(text="x" * 1801))
        self.invalid(lambda d: d["chunks"][0].update(language="es"))

    def test_unreviewed_snapshot_cannot_load(self):
        self.invalid(lambda d: d.update(review_status="unreviewed"))

    def test_malformed_json_and_missing_files(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "corpus.json"
            with self.assertRaises(sources.CorpusError):
                sources.load_corpus(path)
            for raw in ('{', 'null', '[]', '{"revision":1,"revision":2}', '"value"'):
                path.write_text(raw)
                with self.assertRaises(sources.CorpusError):
                    sources.load_corpus(path)
            path.write_bytes(b"\xff")
            with self.assertRaises(sources.CorpusError):
                sources.load_corpus(path)

    def test_load_returns_independent_data(self):
        self.data["chunks"].clear()
        self.assertEqual(len(sources.load_corpus()["chunks"]), 53)


class RetrievalTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.corpus = sources.load_corpus()

    def search(self, query, **kwargs):
        return retrieve(query, corpus=self.corpus, **kwargs)

    def test_ranked_peroxide(self):
        result = self.search("hydrogen peroxide neutralization")
        self.assertEqual(result[0]["document_id"], "fda-peroxide")
        self.assertIn("neutralized", result[0]["text"])
        self.assertEqual([r["score"] for r in result], sorted((r["score"] for r in result), reverse=True))
        self.assertTrue(all(0 < r["score"] < float("inf") for r in result))

    def test_english_hand_hygiene(self):
        result = self.search("wash hands soap")
        self.assertEqual(result[0]["document_id"], "cdc-prevent")
        self.assertIn("Dry hands completely", result[0]["text"])

    def test_spanish_real_text(self):
        result = self.search("agua manos jabón", language="es")
        self.assertEqual(result[0]["document_id"], "cdc-prevent-es")
        self.assertIn("Lávese", result[0]["text"])
        self.assertTrue(self.search("jabon", language="es"))

    def test_both_languages_searchable(self):
        self.assertEqual(self.search("dormir", language="en")[0]["language"], "es")
        self.assertEqual(self.search("peroxide", language="es")[0]["language"], "en")

    def test_v3_language_eligibility_precedes_candidate_limit_opt_in_only(self):
        # Exact ties: an EN document sorts first, before eligible ES evidence.
        data = copy.deepcopy(self.corpus)
        chunks = []
        for doc in data['documents']:
            doc['title'] = 'Equal title'
            doc['main_text'] = 'Uniquequasar equal public evidence.'
            doc['content_sha256'] = sources.sha256(doc['main_text'])
            chunks.append(update.make_chunk(doc, doc['main_text']))
        data['chunks'] = chunks
        data['revision'] = sources.revision_for(data)
        legacy = retrieve('uniquequasar', language='es', limit=1, corpus=data)
        self.assertEqual(legacy[0]['language'], 'en')
        eligible = retrieve('uniquequasar', language='es', limit=1, corpus=data, language_before_limit=True)
        self.assertEqual(len(eligible), 1)
        self.assertEqual(eligible[0]['language'], 'es')
        self.assertEqual(retrieve('uniquequasar', language='es', limit=1, corpus=data), legacy)

    def test_limits(self):
        for limit in (1, 2, 4, 10):
            self.assertLessEqual(len(self.search("water clean disinfect case", limit=limit)), limit)
        for limit in (0, -1, 11, True, 1.5, "4"):
            with self.assertRaises(ValueError):
                self.search("water", limit=limit)

    def test_language_validation(self):
        for language in ("fr", "EN", "", None):
            with self.assertRaises(ValueError):
                self.search("water", language=language)

    def test_unknown_and_generic_no_confidence(self):
        for query in ("", " ", "contact lens", "eye care information", "lentes de contacto",
                      "contact lens qzxvbnmasdf", "qzxvbnmasdf", "quantum carburetor fluxcapacitor"):
            self.assertEqual(self.search(query), [], query)

    def test_controls_and_bounds_rejected(self):
        for query in (None, 7, "water\x00", "water\n", "water\x1b", "water\u200b", "a" * 2001):
            with self.assertRaises(ValueError):
                self.search(query)

    def test_quoted_sql_and_fts_operators_are_data(self):
        for query, literal in (('"peroxide" OR NEAR(*)', "peroxide near"),
                               ('peroxide\"; --', "peroxide"),
                               ('peroxide ((( )))', "peroxide")):
            self.assertEqual([r["id"] for r in self.search(query)],
                             [r["id"] for r in self.search(literal)])
        self.assertTrue(self.search("water"))

    def test_deterministic_ties(self):
        # Identical evidence from distinct documents gives exact BM25 ties.
        data = copy.deepcopy(self.corpus)
        docs = data["documents"][:2]
        chunks = []
        for doc in docs:
            doc["title"] = "Identical title"
            doc["main_text"] = "Uniquequasar equal evidence."
            doc["content_sha256"] = sources.sha256(doc["main_text"])
            chunks.append(update.make_chunk(doc, doc["main_text"]))
        data["documents"], data["chunks"] = docs, chunks
        data["revision"] = sources.revision_for(data)
        result = retrieve("uniquequasar", corpus=data)
        self.assertEqual(result[0]["score"], result[1]["score"])
        self.assertEqual([r["id"] for r in result], sorted(r["id"] for r in result))

    def test_thread_pool_connections(self):
        queries = ["peroxide", "soap", "agua", "dilated exam", "expiration"] * 10
        expected = [[r["id"] for r in self.search(q)] for q in queries]
        with ThreadPoolExecutor(max_workers=8) as pool:
            actual = list(pool.map(lambda q: [r["id"] for r in self.search(q)], queries))
        self.assertEqual(actual, expected)

    def test_mutating_result_does_not_change_snapshot(self):
        self.search("soap")[0]["text"] = "mutated"
        self.assertIn("soap", self.search("soap")[0]["text"])

    def test_bad_corpus_never_returns_partial_evidence(self):
        data = copy.deepcopy(self.corpus)
        data["chunks"][-1]["content_sha256"] = "0" * 64
        with self.assertRaises(sources.CorpusError):
            retrieve("soap", corpus=data)
        with self.assertRaises(sources.CorpusError):
            retrieve("", corpus=data)

    def test_required_educational_topics(self):
        cases = {"sleep": "sleeping", "expiration": "expiration",
                 "single use": "single-use", "visual field": "visual field",
                 "medical devices": "medical devices", "saline disinfect": "disinfect",
                 "case upside down": "case", "water swimming": "water"}
        for query, span in cases.items():
            self.assertTrue(any(span in r["text"].lower() for r in self.search(query)), query)


class UpdateTests(unittest.TestCase):
    def response(self, raw=b"test", length=None):
        response = io.BytesIO(raw)
        response.headers = Message()
        if length is not None:
            response.headers["Content-Length"] = length
        return response

    def test_size_bounds_with_and_without_length(self):
        self.assertEqual(update.read_bounded(self.response()), b"test")
        for response in (self.response(length=str(update.MAX_BYTES + 1)),
                         self.response(length="invalid"),
                         self.response(b"x" * (update.MAX_BYTES + 1))):
            with self.assertRaises(update.UpdateError):
                update.read_bounded(response)

    def test_time_bound(self):
        with patch.object(update.time, "monotonic", side_effect=[0, 31]):
            with self.assertRaises(update.UpdateError):
                update.read_bounded(self.response())

    def test_network_allowlist_before_dns(self):
        for url in ("https://evil.test/", "https://www.cdc.gov:444/", "https://user:pw@www.cdc.gov/", "http://www.cdc.gov/", "https://127.0.0.1/", sources.SEEDS["cdc-care"][2] + "#fragment"):
            with patch.object(update.socket, "getaddrinfo") as dns:
                with self.assertRaises(update.UpdateError):
                    update.check_public_seed(url, "cdc-care")
                dns.assert_not_called()

    def test_private_and_mixed_dns_fail_closed(self):
        public = (2, 1, 6, "", ("8.8.8.8", 443))
        for ip in ("127.0.0.1", "10.0.0.1", "169.254.169.254", "::1", "::ffff:127.0.0.1"):
            private = (2, 1, 6, "", (ip, 443))
            with patch.object(update.socket, "getaddrinfo", return_value=[public, private]):
                with self.assertRaises(update.UpdateError):
                    update.check_public_seed(sources.SEEDS["cdc-care"][2], "cdc-care")
        with patch.object(update.socket, "getaddrinfo", return_value=[public]):
            self.assertEqual(update.check_public_seed(sources.SEEDS["cdc-care"][2], "cdc-care"), "8.8.8.8")

    def test_all_redirects_fail_closed(self):
        for status in (301, 302, 303, 307, 308):
            response = self.response()
            response.status = status
            response.headers["Location"] = "http://127.0.0.1/private"
            with patch.object(update, "check_public_seed", return_value="8.8.8.8"), patch.object(update.http.client.HTTPSConnection, "request"), patch.object(update.http.client.HTTPSConnection, "getresponse", return_value=response):
                with self.assertRaisesRegex(update.UpdateError, "redirects refused"):
                    update.fetch_seed("cdc-care")

    def test_connection_pins_public_ip_and_verifies_official_tls_host(self):
        response = self.response(b"<html>body</html>")
        response.status = 200
        response.headers["Content-Type"] = "text/html"
        def request(connection, *args, **kwargs):
            connection.connect()
        with patch.object(update, "check_public_seed", return_value="8.8.8.8"), patch.object(update.socket, "create_connection") as connect, patch.object(ssl.SSLContext, "wrap_socket") as wrap, patch.object(update.http.client.HTTPSConnection, "request", request), patch.object(update.http.client.HTTPSConnection, "getresponse", return_value=response):
            self.assertEqual(update.fetch_seed("cdc-care"), b"<html>body</html>")
            connect.assert_called_once_with(("8.8.8.8", 443), timeout=15)
            wrap.assert_called_once_with(connect.return_value, server_hostname="www.cdc.gov")

    def test_fetch_deadline_is_explicit_and_restores_handler(self):
        with patch.object(update.signal, "signal") as handler, patch.object(update.signal, "setitimer") as timer:
            with update.fetch_deadline(45):
                self.assertEqual(timer.call_args.args, (update.signal.ITIMER_REAL, 45))
            self.assertEqual(timer.call_args.args, (update.signal.ITIMER_REAL, 0))
            self.assertEqual(handler.call_args.args, (update.signal.SIGALRM, handler.return_value))

    def test_non_html_and_compressed_rejected(self):
        for content_type, encoding, status in (("application/json", "identity", 200), ("text/html", "gzip", 200), ("text/html", "identity", 500)):
            response = self.response()
            response.status = status
            response.headers["Content-Type"] = content_type
            response.headers["Content-Encoding"] = encoding
            with patch.object(update, "check_public_seed", return_value="8.8.8.8"), patch.object(update.http.client.HTTPSConnection, "request"), patch.object(update.http.client.HTTPSConnection, "getresponse", return_value=response):
                with self.assertRaises(update.UpdateError):
                    update.fetch_seed("cdc-care")

    def test_extractor_ignores_chrome_scripts_and_forms(self):
        raw = b'''<title>Article</title><nav><p>NAVIGATION</p></nav>
        <article><h2>Body heading</h2><p>Actual paragraph one.</p>
        <script>execute malicious instruction</script><form><p>FORM</p></form>
        <p>Actual paragraph two.</p></article><footer><p>COOKIE</p></footer>'''
        title, blocks = update.extract_body(raw, "NEI")
        self.assertEqual(title, "Article")
        self.assertEqual(blocks, ["Body heading", "Actual paragraph one.", "Actual paragraph two."])
        with self.assertRaises(update.UpdateError):
            update.extract_body(b"<p>No article container</p>", "NEI")
        with self.assertRaises(update.UpdateError):
            update.extract_body(b"x" * (update.MAX_BYTES + 1), "NEI")

    def test_publish_requires_exact_revision_and_explicit_review(self):
        data = sources.load_corpus()
        data["review_status"] = "unreviewed"
        data["revision"] = sources.revision_for(data)
        with tempfile.TemporaryDirectory() as directory:
            candidate, destination = Path(directory) / "candidate.json", Path(directory) / "approved.json"
            candidate.write_text(json.dumps(data))
            for acknowledgment in (None, "bad"):
                with self.assertRaises(update.UpdateError):
                    update.publish(candidate, acknowledgment, destination)
                self.assertFalse(destination.exists())
            published = update.publish(candidate, data["revision"], destination)
            self.assertEqual(sources.load_corpus(destination)["revision"], published)
            self.assertEqual(json.loads(candidate.read_text())["review_status"], "unreviewed")

    def test_default_cli_cannot_publish(self):
        with self.assertRaises(SystemExit), patch.object(update, "fetch_seed") as fetch:
            update.main([])
        fetch.assert_not_called()
        with self.assertRaises(SystemExit):
            update.main(["--stage", str(sources.DEFAULT_PATH)])

    def test_offline_stage_never_publishes_or_overwrites(self):
        before = sources.DEFAULT_PATH.read_bytes()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for did, (authority, _, url) in sources.SEEDS.items():
                opening = {"CDC": '<div class="cdc-dfe-body__center">', "FDA": '<div role="main">', "NEI": '<article>'}[authority]
                closing = "</article>" if authority == "NEI" else "</div>"
                raw = ('<title>Candidate</title>' + opening + '<h2>Candidate heading</h2>' + '<p>This is a sufficiently long body paragraph to stage for review only.</p>' * 2 + closing).encode()
                (root / (did + ".html")).write_bytes(raw)
                (root / (did + ".json")).write_text(json.dumps({"url": url, "final_url": url, "sha256": hashlib.sha256(raw).hexdigest(), "retrieved": "2026-10-23T00:00:00Z"}))
            candidate = root / "candidate.json"
            with patch("sys.stdout", new=io.StringIO()):
                update.main(["--stage", str(candidate), "--offline-dir", directory])
            self.assertEqual(json.loads(candidate.read_text())["review_status"], "unreviewed")
            with self.assertRaises(sources.CorpusError):
                sources.load_corpus(candidate)
            with self.assertRaises(FileExistsError):
                update.main(["--stage", str(candidate), "--offline-dir", directory])
        self.assertEqual(sources.DEFAULT_PATH.read_bytes(), before)

    def test_publish_rejects_duplicate_json_keys(self):
        with tempfile.TemporaryDirectory() as directory:
            candidate = Path(directory) / "candidate.json"
            candidate.write_text('{"revision":"a","revision":"b"}')
            with self.assertRaises(sources.CorpusError):
                update.publish(candidate, "b", Path(directory) / "approved.json")

    def test_malformed_offline_provenance_cannot_stage(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "cdc-care.html").write_text("<article>untrusted</article>")
            (root / "cdc-care.json").write_text(json.dumps({"url": "https://evil.test/", "final_url": "https://evil.test/", "sha256": "0" * 64}))
            candidate = root / "candidate.json"
            with self.assertRaises(update.UpdateError):
                update.main(["--stage", str(candidate), "--offline-dir", directory])
            self.assertFalse(candidate.exists())


if __name__ == "__main__":
    unittest.main()
