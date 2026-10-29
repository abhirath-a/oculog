"""Local launcher config never executes .env contents or exposes secrets."""
from pathlib import Path
import tempfile
import unittest

from backend.config import load_environment


class EnvironmentTests(unittest.TestCase):
    def load(self, text, target=None):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / '.env'
            path.write_text(text)
            result = {} if target is None else target
            load_environment(path, result)
            return result

    def test_literal_quotes_comments_and_explicit_environment_wins(self):
        result = self.load('export OCULOG_GEMINI_ENABLED=true\nKEY="test#literal" # comment\nOTHER=value # comment\n', {'OCULOG_GEMINI_ENABLED': 'false'})
        self.assertEqual(result, {'OCULOG_GEMINI_ENABLED': 'false', 'KEY': 'test#literal', 'OTHER': 'value'})

    def test_no_shell_expansion_or_execution(self):
        self.assertEqual(self.load('KEY=$(do-not-execute)\nHOME_COPY=${HOME}\n'),
                         {'KEY': '$(do-not-execute)', 'HOME_COPY': '${HOME}'})

    def test_validation_is_atomic_and_errors_do_not_include_secret_values(self):
        target = {}
        with self.assertRaises(ValueError) as caught:
            self.load('GOOD=first\nKEY="synthetic-secret\n', target)
        self.assertEqual(target, {})
        self.assertNotIn('synthetic-secret', str(caught.exception))
        self.assertIn('line 2', str(caught.exception))

    def test_absent_file_is_optional(self):
        with tempfile.TemporaryDirectory() as directory:
            values = {}
            load_environment(Path(directory) / 'absent', values)
            self.assertEqual(values, {})
