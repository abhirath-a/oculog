"""Local lexical retrieval using real SQLite FTS5/BM25; no semantic claims.

Queries are never persisted. Each call owns and closes its in-memory connection,
including when called concurrently from an API thread pool.
"""
from __future__ import annotations

import math
import re
import sqlite3
import unicodedata

from .corpus import load_corpus, validate_corpus


class RetrievalUnavailable(RuntimeError):
    """FTS5 is unavailable; callers must fail closed, not substitute canned text."""


_STOP = set("""a an the and or but to of for in on at by with from is are was were be
been do does did can could should would will may i me my we our you your it its this
that these those what which when where why how about tell please explain know
have has contact contacts lens lenses eye eyes care general information advice
use uses used using safe safety health healthy not no never any all more help get
el la los las un una unos unas de del al y o en con por para es son que qué como
cómo cual cuál cuando cuándo donde dónde mi mis tu tus su sus se me yo lentes
lente contacto contactos ojo ojos cuidado información favor sobre puedo puede""".split())


def _tokens(query: str) -> list[str]:
    if not isinstance(query, str) or len(query) > 2000 or any(unicodedata.category(c).startswith("C") for c in query):
        raise ValueError("Query must be bounded text without control characters")
    tokens = re.findall(r"[^\W_]+", unicodedata.normalize("NFKC", query).casefold(), re.UNICODE)
    return list(dict.fromkeys(t for t in tokens if 2 <= len(t) <= 64 and t not in _STOP))[:24]


def retrieve(query: str, *, language="en", limit=4, corpus=None, language_before_limit=False) -> list[dict]:
    if language not in ("en", "es"):
        raise ValueError("Only en and es are supported")
    if type(limit) is not int or not 1 <= limit <= 10:
        raise ValueError("limit must be an integer from 1 through 10")
    terms = _tokens(query)
    data = load_corpus() if corpus is None else corpus
    validate_corpus(data)
    if not terms:
        return []
    # Tokens are alphanumeric and additionally quoted: FTS operators and SQL
    # syntax from a query cannot become executable query structure.
    match = " OR ".join('"' + token + '"' for token in terms)
    connection = sqlite3.connect(":memory:")
    try:
        try:
            connection.execute("CREATE VIRTUAL TABLE evidence USING fts5(id UNINDEXED, title, text, tokenize='porter unicode61 remove_diacritics 2')")
        except sqlite3.OperationalError as exc:
            raise RetrievalUnavailable("SQLite FTS5 is required") from exc
        connection.executemany("INSERT INTO evidence(id,title,text) VALUES (?,?,?)",
                               ((c["id"], c["title"], c["text"]) for c in data["chunks"]
                                if not language_before_limit or c["language"] == language))
        rows = connection.execute(
            "SELECT id, bm25(evidence,0.0,0.25,1.0) AS rank FROM evidence "
            "WHERE evidence MATCH ? ORDER BY rank ASC, id ASC LIMIT ?",
            (match, limit)).fetchall()
        by_id = {c["id"]: c for c in data["chunks"]}
        result = []
        for cid, rank in rows:
            score = -float(rank)
            if math.isfinite(score) and score > 0:
                result.append({**by_id[cid], "score": score})
        return result
    finally:
        connection.close()
