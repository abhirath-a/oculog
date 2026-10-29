"""Versioned public-source text, not answers. No network access at load time."""
from __future__ import annotations

from datetime import date, datetime, timezone
import hashlib
import json
from pathlib import Path
import re
from urllib.parse import urlsplit

EXTRACTOR_VERSION = "official-body-blocks-v1"
DEFAULT_PATH = Path(__file__).with_name("data") / "corpus.json"
# Exact seed URLs; changes require a code review, not a user-supplied URL.
SEEDS = {
    "cdc-care": ("CDC", "en", "https://www.cdc.gov/contact-lenses/about/index.html"),
    "cdc-prevent": ("CDC", "en", "https://www.cdc.gov/contact-lenses/prevention/index.html"),
    "cdc-clean": ("CDC", "en", "https://www.cdc.gov/contact-lenses/about/about-cleaning-disinfecting-and-storing-contact-lenses.html"),
    "fda-lenses": ("FDA", "en", "https://www.fda.gov/medical-devices/consumer-products/contact-lenses"),
    "fda-solutions": ("FDA", "en", "https://www.fda.gov/medical-devices/contact-lenses/contact-lens-solutions-and-products"),
    "fda-peroxide": ("FDA", "en", "https://www.fda.gov/medical-devices/contact-lenses/hydrogen-peroxide-solution"),
    "nei-healthy": ("NEI", "en", "https://www.nei.nih.gov/eye-health-information/healthy-vision/how-eyes-work/keep-your-eyes-healthy"),
    "nei-contacts": ("NEI", "en", "https://www.nei.nih.gov/eye-health-information/healthy-vision/contact-lenses"),
    "nei-exam": ("NEI", "en", "https://www.nei.nih.gov/eye-health-information/healthy-vision/finding-eye-doctor/get-dilated-eye-exam"),
    "cdc-prevent-es": ("CDC", "es", "https://www.cdc.gov/contact-lenses/es/prevention/prevencion-de-infecciones-de-los-ojos-al-usar-lentes-de-contacto.html"),
    "nei-contacts-es": ("NEI", "es", "https://www.nei.nih.gov/espanol/informacion-sobre-la-salud-ocular/vision-saludable/lentes-de-contacto"),
}


class CorpusError(ValueError):
    """The entire snapshot is unusable; do not serve partial evidence."""


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def canonical(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def revision_for(data: dict) -> str:
    # Fetch time and raw markup may change without changing canonical evidence.
    material = {k: v for k, v in data.items() if k != "revision"}
    for key in ("documents", "chunks"):
        material[key] = [{k: v for k, v in row.items()
                          if k not in {"fetched_at", "raw_sha256"}}
                         for row in data[key]]
    return sha256(canonical(material))


def chunk_id(document_id: str, text: str) -> str:
    return document_id + ":" + sha256(text)[:24]


def valid_url(url: str, document_id: str) -> bool:
    if not isinstance(url, str) or document_id not in SEEDS:
        return False
    try:
        parsed = urlsplit(url)
        return (url == SEEDS[document_id][2] and parsed.scheme == "https"
                and not parsed.username and not parsed.password
                and parsed.port in (None, 443) and not parsed.fragment)
    except ValueError:
        return False


def _text(value, maximum=200000):
    return (isinstance(value, str) and 0 < len(value) <= maximum
            and not any(ord(c) < 32 and c != "\n" for c in value)
            and not any(127 <= ord(c) <= 159 for c in value))


def _digest(value):
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value)


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise CorpusError("Duplicate JSON key")
        result[key] = value
    return result


def validate_corpus(data: dict) -> None:
    try:
        if not isinstance(data, dict) or data["extractor_version"] != EXTRACTOR_VERSION:
            raise CorpusError("Unsupported corpus")
        if data["scope"] != "adult-general-eye-care-education" or data["review_status"] != "scope-reviewed-not-clinically-reviewed":
            raise CorpusError("Snapshot requires explicit scope review")
        if set(data) != {"revision", "extractor_version", "scope", "review_status", "documents", "chunks"}:
            raise CorpusError("Unknown corpus fields")
        documents, chunks = data["documents"], data["chunks"]
        if not isinstance(documents, list) or not 1 <= len(documents) <= 11 or not isinstance(chunks, list) or not 1 <= len(chunks) <= 500:
            raise CorpusError("Empty or oversized corpus")
        docs, ids = {}, set()
        for doc in documents:
            if set(doc) != {"id", "title", "url", "authority", "language", "main_text", "content_sha256", "raw_sha256", "fetched_at", "source_modified_at", "rights_review"}:
                raise CorpusError("Unknown document fields")
            did = doc["id"]
            if did in docs or did not in SEEDS:
                raise CorpusError("Invalid document identity")
            if not valid_url(doc["url"], did) or (doc["authority"], doc["language"]) != SEEDS[did][:2]:
                raise CorpusError("Untrusted source")
            for field in ("title", "main_text", "rights_review"):
                if not _text(doc[field]):
                    raise CorpusError("Invalid document text")
            if sha256(doc["main_text"]) != doc["content_sha256"] or not _digest(doc["raw_sha256"]):
                raise CorpusError("Document hash mismatch")
            if not isinstance(doc["fetched_at"], str) or not re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|\+00:00)", doc["fetched_at"]):
                raise CorpusError("Invalid UTC fetch timestamp")
            if datetime.fromisoformat(doc["fetched_at"].replace("Z", "+00:00")).utcoffset() != timezone.utc.utcoffset(None):
                raise CorpusError("Fetch timestamp must be UTC")
            modified = doc["source_modified_at"]
            if modified is not None and (not isinstance(modified, str) or not re.fullmatch(r"\d{4}-\d\d-\d\d", modified)):
                raise CorpusError("Invalid displayed revision")
            if modified is not None:
                date.fromisoformat(modified)
            docs[did] = doc
        covered = set()
        for chunk in chunks:
            if set(chunk) != {"id", "document_id", "title", "url", "authority", "language", "text", "content_sha256", "fetched_at", "source_modified_at"}:
                raise CorpusError("Unknown chunk fields")
            doc = docs[chunk["document_id"]]
            text, cid = chunk["text"], chunk["id"]
            if not _text(text, 1800) or text not in doc["main_text"]:
                raise CorpusError("Chunk is not an exact source span")
            if cid in ids or cid != chunk_id(doc["id"], text) or len(cid) >= 128 or chunk["content_sha256"] != sha256(text):
                raise CorpusError("Invalid chunk identity or hash")
            for field in ("title", "url", "authority", "language", "fetched_at", "source_modified_at"):
                if chunk[field] != doc[field]:
                    raise CorpusError("Chunk provenance mismatch")
            ids.add(cid)
            covered.add(doc["id"])
        if covered != set(docs) or data["revision"] != revision_for(data):
            raise CorpusError("Incomplete corpus or revision mismatch")
    except (KeyError, TypeError, AttributeError, ValueError) as exc:
        if isinstance(exc, CorpusError):
            raise
        raise CorpusError("Malformed corpus") from exc


def load_corpus(path=None) -> dict:
    try:
        path = Path(path) if path is not None else DEFAULT_PATH
        if path.stat().st_size > 2_000_000:
            raise CorpusError("Oversized corpus")
        data = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=_pairs)
        validate_corpus(data)
        return data
    except (OSError, UnicodeError, ValueError, RecursionError) as exc:
        if isinstance(exc, CorpusError):
            raise
        raise CorpusError("Cannot load approved corpus") from exc
