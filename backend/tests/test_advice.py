"""Pure corpus validation and conservative deterministic matching tests."""
import copy
import json
from pathlib import Path
import tempfile
import unittest

from backend import advice


class AdviceTests(unittest.TestCase):
    def setUp(self):
        self.data = advice.load_catalogue()

    def match(self, text):
        return advice.answer_message(self.data, text)

    def test_complete_corpus_and_privacy(self):
        advice.validate(self.data)
        entries = self.data["questions"]
        self.assertGreaterEqual(len(entries), 12)
        self.assertLessEqual(len(entries), 16)
        ids = {entry["id"] for entry in entries}
        self.assertEqual(len(ids), len(entries))
        for entry in entries:
            self.assertLessEqual(set(entry["related_question_ids"]), ids)
            self.assertTrue(entry["sources"])
            answer = advice.answer_id(self.data, entry["id"])
            self.assertEqual(answer["id"], entry["id"])
            self.assertTrue(answer["matched"])
            self.assertNotIn("rules", answer)
            self.assertNotIn("priority", answer)
        catalog = advice.catalogue(self.data)
        self.assertNotIn("paragraphs", json.dumps(catalog))
        self.assertNotIn("rules", json.dumps(catalog))
        answer = advice.answer_id(self.data, "red_eyes")
        answer["paragraphs"].clear()
        self.assertTrue(advice.answer_id(self.data, "red_eyes")["paragraphs"])

    def test_invalid_catalogue_fails_wholly(self):
        def bad(change):
            data = copy.deepcopy(self.data)
            change(data)
            with self.assertRaises(advice.CatalogueError):
                advice.validate(data)
        bad(lambda d: d.update(version=True))
        bad(lambda d: d.update(questions=[]))
        bad(lambda d: d["questions"].append(copy.deepcopy(d["questions"][0])))
        bad(lambda d: d["questions"][0].update(related_question_ids=["missing"]))
        bad(lambda d: d["questions"][0].update(paragraphs=[]))
        bad(lambda d: d["questions"][0].update(urgency="safe"))
        bad(lambda d: d["questions"][0].update(rules=[[""]]))
        bad(lambda d: d["questions"][0].update(priority=10))
        bad(lambda d: d["questions"][0]["sources"][0].update(url="https://www.nhs.uk.evil.test/x"))
        bad(lambda d: d["questions"][0]["sources"][0].update(url="http://www.nhs.uk/x"))
        bad(lambda d: d["questions"][0].update(extra="hidden"))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "bad.json"
            for raw in ('{', '{"version":1,"version":1}', 'null', '[]'):
                path.write_text(raw)
                with self.assertRaises(advice.CatalogueError):
                    advice.load_catalogue(path)

    def test_optional_presentation_validation_and_deep_copy(self):
        legacy = copy.deepcopy(self.data)
        del legacy["presentation"]
        advice.validate(legacy)
        self.assertNotIn("presentation", advice.catalogue(legacy))
        serialized = advice.catalogue(self.data)
        serialized["presentation"]["triage"][0]["text"] = "changed"
        self.assertNotEqual(serialized["presentation"], self.data["presentation"])
        invalid = [
            {"summary": ""}, {"lens_action": "x" * 501}, {"caution": ""},
            {"triage": []}, {"triage": [self.data["presentation"]["triage"][0]] * 2},
            {"topics": []}, {"topics": [{"id": "missing", "label": "Missing"}]},
            {"topics": [self.data["presentation"]["topics"][0]] * 2},
            {"topics": self.data["presentation"]["topics"] * 2},
            {"topics": [{"id": "red_eyes", "label": "x" * 81}]},
        ]
        for patch in invalid:
            data = copy.deepcopy(self.data)
            data["presentation"].update(patch)
            with self.subTest(patch=patch), self.assertRaises(advice.CatalogueError):
                advice.validate(data)

    def test_presentation_preserves_critical_conditions_and_priority(self):
        presentation = self.data["presentation"]
        emergency, urgent = presentation["triage"]
        self.assertEqual(emergency["level"], "emergency")
        self.assertEqual(urgent["level"], "urgent")
        self.assertIn("Severe pain or sudden vision loss", emergency["text"])
        self.assertIn("red eyes with changed vision or light sensitivity", emergency["text"])
        self.assertIn("emergency care now", emergency["text"])
        self.assertIn("Red eyes, pain, light sensitivity or blurred vision", urgent["text"])
        self.assertIn("urgent same-day professional assessment", urgent["text"])
        self.assertEqual(presentation["lens_action"], "With these symptoms, remove contact lenses and do not reinsert them.")
        self.assertIn("Do not delay care", presentation["caution"])
        for message in ("red eyes and changed vision", "red and light sensitivity", "severe pain", "sudden vision loss"):
            self.assertEqual(self.match("cleaning " + message)["urgency"], "emergency")

    def test_normalization_and_boundaries(self):
        self.assertEqual(advice.normalize("  RED—Eyes!! Ａ  "), "red eyes a")
        self.assertEqual(self.match("  RED—eyes!!! ")["id"], "red_eyes")
        self.assertEqual(self.match("CAN I SLEEP IN CONTACTS?")["id"], "sleeping")
        self.assertEqual(self.match("My lens WON’T come out.")["id"], "stuck_lens")
        for message in ("hundred", "credit", "redwood", "vision", "television", "painstaking",
                        "replacement schedule and cleaning", "what is my prescription", "hello", "",
                        "what causes headaches", "can i use antibiotic drops", "is swimming safe for my surgery"):
            with self.subTest(message=message):
                result = self.match(message)
                self.assertFalse(result["matched"])
                self.assertIsNone(result["id"])
                self.assertEqual(result["urgency"], "unknown")
                self.assertIn("cannot diagnose", " ".join(result["paragraphs"]))

    def test_common_lay_symptoms_never_receive_routine_reassurance(self):
        for text in ("my eye hurts", "pink eye", "red and sore", "light hurts my eyes", "blurry vision"):
            for prefix in ("", "can i sleep in contacts? ", "cleaning and "):
                with self.subTest(text=prefix + text):
                    result = self.match(prefix + text)
                    self.assertTrue(result["matched"])
                    self.assertEqual(result["urgency"], "urgent")
                    self.assertIn("Remove your contact lenses", " ".join(result["paragraphs"]))
        for text in ("can't see", "severe pain", "sudden vision loss", "red and light hurts my eyes"):
            self.assertEqual(self.match("cleaning and " + text)["urgency"], "emergency")
        # Negation is not interpreted: it must not produce a reassuring routine match.
        for text in ("no my eye hurts", "not pink eye", "no blurry vision"):
            self.assertNotEqual(self.match(text)["urgency"], "routine")
        self.assertIn("not meaning, negation or context", self.data["disclaimer"])

    def test_symptoms_outrank_routine(self):
        for text in ("cleaning and red eyes", "sleep in contacts but redness", "replacement schedule pain",
                     "swimming and blurred vision", "can i sleep in contacts? light sensitivity"):
            self.assertEqual(self.match(text)["urgency"], "urgent", text)
        for text in ("cleaning and severe eye pain", "sleep in contacts sudden vision loss", "unbearable pain",
                     "extreme eye pain after showering", "red eye and blurry vision", "red with photophobia",
                     "I can't see", "I CANNOT SEE", "red eyes hurts to look at light"):
            self.assertEqual(self.match(text)["urgency"], "emergency", text)
        # Deliberately does not pretend to understand negation or historical context.
        self.assertEqual(self.match("no severe pain")["urgency"], "emergency")
        self.assertEqual(self.match("yesterday my eye was red")["urgency"], "urgent")
        self.assertEqual(self.match("no redness")["urgency"], "urgent")
        self.assertEqual(self.match("my vision is normal")["urgency"], "unknown")
        for entry in self.data["questions"]:
            self.assertEqual(advice.answer_id(self.data, entry["id"])["id"], entry["id"])


if __name__ == "__main__":
    unittest.main()
