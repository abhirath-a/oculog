"""Explicit local-launcher configuration; importing the API never loads secrets.

Literal dotenv values only, no shell execution or variable interpolation.
Existing process environment wins over a local development file.
"""
import os
from pathlib import Path
import re


DEFAULT_ENV = Path(__file__).resolve().parents[1] / '.env'


def load_environment(path=DEFAULT_ENV, environ=None):
    target = os.environ if environ is None else environ
    path = Path(path)
    if not path.is_file():
        return
    parsed = {}
    for number, raw in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith('#'):
            continue
        if line.startswith('export '):
            line = line[7:].strip()
        if '=' not in line:
            raise ValueError(f'Invalid environment assignment on line {number}')
        name, value = line.split('=', 1)
        name, value = name.strip(), value.strip()
        if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', name):
            raise ValueError(f'Invalid environment name on line {number}')
        if value.startswith(('"', "'")):
            quote = value[0]
            # Do not interpret escapes, substitutions, or executable expressions.
            end = value.find(quote, 1)
            if end < 0 or (value[end + 1:].strip() and not value[end + 1:].lstrip().startswith('#')):
                raise ValueError(f'Invalid quoted environment value on line {number}')
            value = value[1:end]
        else:
            value = re.split(r'\s+#', value, maxsplit=1)[0].rstrip()
        if '\x00' in value:
            raise ValueError(f'Invalid environment value on line {number}')
        parsed[name] = value
    # Apply only after the whole file validates; never log the contents.
    for name, value in parsed.items():
        target.setdefault(name, value)
