#!/usr/bin/env python3
"""Stage public seed text for human scope/rights review. Never publish by default.

No LLMs, dependencies, arbitrary URLs, runtime fetching, or automatic approval.
A reviewer must remove unsuitable candidate chunks, recompute revision_for(), and
explicitly acknowledge the resulting revision to publish. Hashes prove integrity,
not correctness, clinical review, or government endorsement.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import http.client
import time
from html.parser import HTMLParser
import ipaddress
import json
from pathlib import Path
import socket
import signal
import threading
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.education.corpus import (DEFAULT_PATH, EXTRACTOR_VERSION, SEEDS,
    _pairs, chunk_id, revision_for, sha256, valid_url, validate_corpus)

MAX_BYTES = 2_000_000
OFFLINE_REQUEST_URLS = {
    "nei-healthy": "https://www.nei.nih.gov/learn-about-eye-health/healthy-vision/keep-your-eyes-healthy",
    "nei-contacts": "https://www.nei.nih.gov/learn-about-eye-health/healthy-vision/contact-lenses",
    "nei-exam": "https://www.nei.nih.gov/learn-about-eye-health/healthy-vision/get-dilated-eye-exam",
}
RIGHTS = ("Official public government educational text; page may contain third-party "
          "material. Text-only selected article spans; no images or linked third-party "
          "content licensed here. Rights review remains an operator responsibility. "
          "Scope-reviewed selection is not independent clinical review.")


class UpdateError(ValueError):
    pass


class BodyParser(HTMLParser):
    """Bounded, non-executing extraction of known article containers only."""
    VOID = {"br", "hr", "img", "input", "meta", "link", "source", "wbr", "area", "base", "embed", "param", "track", "col"}
    SKIP = {"script", "style", "nav", "header", "footer", "form", "aside", "noscript", "template", "svg", "button"}

    def __init__(self, authority):
        super().__init__(convert_charrefs=True)
        self.authority = authority
        self.stack = []
        self.root = None
        self.block = None
        self.blocks = []
        self.title = []
        self.in_title = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in {"p", "div", "ul", "ol", "h2", "h3", "section"} and "p" in self.stack:
            self.handle_endtag("p")
        if tag == "title":
            self.in_title = True
        if tag in self.VOID:
            if self.block is not None and tag == "br":
                self.block[1].append(" ")
            return
        self.stack.append(tag)
        if len(self.stack) > 160:
            raise UpdateError("HTML nesting exceeds extraction bound")
        classes = attrs.get("class", "").split()
        if self.root is None and (
            (self.authority == "CDC" and "cdc-dfe-body__center" in classes)
            or (self.authority == "FDA" and tag == "div" and attrs.get("role") == "main")
            or (self.authority == "NEI" and tag == "article")
        ):
            self.root = len(self.stack)
        blocked = any(t in self.SKIP for t in self.stack)
        if self.root is not None and not blocked and self.block is None and tag in {"p", "li", "h2", "h3"}:
            self.block = (len(self.stack), [])

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False
        if tag not in self.stack:
            return
        # Recover ordinary optional closing tags conservatively; unexpected page
        # structure yields a candidate, never automatic approved medical text.
        depth = len(self.stack) - self.stack[::-1].index(tag)
        if self.block is not None and depth <= self.block[0]:
            text = " ".join("".join(self.block[1]).split())
            if text:
                self.blocks.append(text)
            self.block = None
        if self.root is not None and depth <= self.root:
            self.root = None
        del self.stack[depth - 1:]

    def handle_data(self, text):
        if self.in_title:
            self.title.append(text)
        if self.block is not None and not any(t in self.SKIP for t in self.stack):
            self.block[1].append(text)


def extract_body(raw: bytes, authority: str):
    if len(raw) > MAX_BYTES:
        raise UpdateError("Source exceeds size bound")
    parser = BodyParser(authority)
    parser.feed(raw.decode("utf-8", errors="strict"))
    parser.close()
    if not 3 <= len(parser.blocks) <= 1000:
        raise UpdateError("Article body not found or extraction exceeds bound")
    title = " ".join("".join(parser.title).split())
    return title, parser.blocks


def check_public_seed(url, document_id):
    if not valid_url(url, document_id):
        raise UpdateError("URL is not the exact HTTPS manifest seed")
    # Resolve only the fixed government hostname; reject private/mixed answers.
    from urllib.parse import urlsplit
    host = urlsplit(url).hostname
    try:
        addresses = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    except OSError as exc:
        raise UpdateError("Seed DNS failed") from exc
    if not addresses or any(not ipaddress.ip_address(row[4][0]).is_global for row in addresses):
        raise UpdateError("Seed did not resolve exclusively to public addresses")
    return addresses[0][4][0]


def read_bounded(response):
    length = response.headers.get("Content-Length")
    if length is not None and (not length.isdigit() or int(length) > MAX_BYTES):
        raise UpdateError("Oversized or invalid content length")
    parts, size = [], 0
    deadline = time.monotonic() + 30
    while True:
        if time.monotonic() > deadline:
            raise UpdateError("Source read exceeded time bound")
        part = response.read1(min(65536, MAX_BYTES + 1 - size))
        if not part:
            return b"".join(parts)
        size += len(part)
        if size > MAX_BYTES:
            raise UpdateError("Source exceeds size bound")
        parts.append(part)


@contextmanager
def fetch_deadline(seconds=45):
    """Bound even DNS on the Linux operator CLI; not a server-thread API."""
    if threading.current_thread() is not threading.main_thread():
        raise UpdateError("Operator fetching must run on the main CLI thread")
    def expired(signum, frame):
        raise UpdateError("Seed fetch exceeded total time bound")
    previous = signal.signal(signal.SIGALRM, expired)
    signal.setitimer(signal.ITIMER_REAL, seconds)
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)


def fetch_seed(document_id):
    url = SEEDS[document_id][2]
    address = check_public_seed(url, document_id)
    from urllib.parse import urlsplit
    parsed = urlsplit(url)

    class PinnedHTTPS(http.client.HTTPSConnection):
        def connect(self):
            # Connect to the already checked IP, while verifying the certificate
            # against the official hostname. No second DNS lookup/rebinding.
            sock = socket.create_connection((address, 443), timeout=self.timeout)
            try:
                self.sock = self._context.wrap_socket(sock, server_hostname=self.host)
            except Exception:
                sock.close()
                raise

    connection = PinnedHTTPS(parsed.hostname, timeout=15)
    try:
        connection.request("GET", parsed.path, headers={"User-Agent": "Oculog-Corpus-Review/1", "Accept": "text/html", "Accept-Encoding": "identity"})
        response = connection.getresponse()
        if 300 <= response.status <= 399:
            raise UpdateError("All redirects refused; review exact seed URL")
        if response.status != 200 or response.headers.get_content_type() != "text/html":
            raise UpdateError("Expected successful HTML response")
        if response.headers.get("Content-Encoding", "identity").lower() != "identity":
            raise UpdateError("Compressed response refused")
        return read_bounded(response)
    finally:
        connection.close()


def make_document(document_id, raw, fetched_at, source_modified_at=None):
    authority, language, url = SEEDS[document_id]
    title, blocks = extract_body(raw, authority)
    main_text = "\n".join(blocks)
    return {"id": document_id, "title": title, "url": url, "authority": authority,
            "language": language, "main_text": main_text, "content_sha256": sha256(main_text),
            "raw_sha256": hashlib.sha256(raw).hexdigest(), "fetched_at": fetched_at,
            "source_modified_at": source_modified_at, "rights_review": RIGHTS}, blocks


def make_chunk(doc, text):
    return {"id": chunk_id(doc["id"], text), "document_id": doc["id"],
            **{k: doc[k] for k in ("title", "url", "authority", "language", "fetched_at", "source_modified_at")},
            "text": text, "content_sha256": sha256(text)}


def publish(candidate_path, revision, destination=DEFAULT_PATH):
    # No fetching on publish: reviewer approves this exact local candidate.
    candidate_path = Path(candidate_path)
    if candidate_path.stat().st_size > MAX_BYTES:
        raise UpdateError("Oversized candidate")
    data = json.loads(candidate_path.read_text(encoding="utf-8"), object_pairs_hook=_pairs)
    if not revision or data.get("revision") != revision or revision_for(data) != revision:
        raise UpdateError("Reviewed revision does not match candidate")
    data["review_status"] = "scope-reviewed-not-clinically-reviewed"
    data["revision"] = revision_for(data)
    validate_corpus(data)
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(".reviewed.tmp")
    with temporary.open("x", encoding="utf-8") as stream:
        stream.write(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    temporary.replace(destination)
    return data["revision"]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage", type=Path, help="New candidate path (must not exist)")
    parser.add_argument("--offline-dir", type=Path, help="Previously saved seed .html/.json artifacts")
    parser.add_argument("--review-publish", type=Path, help="Explicitly publish reviewed local candidate")
    parser.add_argument("--reviewed-revision", help="Exact candidate revision acknowledged by operator")
    args = parser.parse_args(argv)
    if args.review_publish:
        if args.stage or args.offline_dir or not args.reviewed_revision:
            parser.error("publish requires reviewed revision and cannot fetch or stage")
        print(publish(args.review_publish, args.reviewed_revision))
        return
    if not args.stage or args.reviewed_revision:
        parser.error("use --stage NEW_PATH; publishing is a separate explicit operation")
    if args.stage.resolve() == DEFAULT_PATH.resolve():
        parser.error("cannot stage over approved snapshot")
    documents, chunks = [], []
    for did in SEEDS:
        if args.offline_dir:
            source = args.offline_dir / (did + ".html")
            if source.stat().st_size > MAX_BYTES:
                raise UpdateError("Oversized offline source")
            raw = source.read_bytes()
            provenance = json.loads((args.offline_dir / (did + ".json")).read_text())
            if provenance["url"] not in {SEEDS[did][2], OFFLINE_REQUEST_URLS.get(did)} or provenance["final_url"] != SEEDS[did][2] or provenance["sha256"] != hashlib.sha256(raw).hexdigest():
                raise UpdateError("Offline provenance mismatch")
            fetched = provenance["retrieved"]
        else:
            with fetch_deadline():
                raw = fetch_seed(did)
            fetched = datetime.now(timezone.utc).isoformat()
        # Displayed revisions must be independently checked by the reviewer;
        # never copy an English revision onto its Spanish counterpart.
        doc, blocks = make_document(did, raw, fetched)
        documents.append(doc)
        seen = set()
        for block in blocks:
            if 50 <= len(block) <= 1800 and block not in seen:
                chunks.append(make_chunk(doc, block))
                seen.add(block)
    data = {"extractor_version": EXTRACTOR_VERSION, "scope": "adult-general-eye-care-education",
            "review_status": "unreviewed", "documents": documents, "chunks": chunks}
    data["revision"] = revision_for(data)
    args.stage.parent.mkdir(parents=True, exist_ok=True)
    with args.stage.open("x", encoding="utf-8") as stream:
        stream.write(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    print("Staged UNREVIEWED candidate", data["revision"], "at", args.stage)


if __name__ == "__main__":
    main()
