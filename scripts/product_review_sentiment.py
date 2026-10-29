#!/usr/bin/env python3
"""Collect explicitly attributed structured product reviews; no text-tone inference."""
import argparse
import datetime
import hashlib
import ipaddress
import json
import math
import re
import socket
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path


class ScrapeError(Exception):
    pass


def normalized(value):
    return ' '.join(re.findall(r'\w+', unicodedata.normalize('NFKC', str(value)).casefold()))


def validate_url(url):
    """Reject unsafe destinations at resolution time (not a DNS-rebinding sandbox)."""
    try:
        parsed = urllib.parse.urlsplit(url)
        if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError('requires HTTP(S), hostname, and no credentials')
        port = parsed.port or (443 if parsed.scheme == 'https' else 80)
        addresses = socket.getaddrinfo(parsed.hostname, port, type=socket.SOCK_STREAM)
        if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
            raise ValueError('non-public address')
    except (ValueError, OSError) as exc:
        raise ScrapeError(f'unsafe/unresolvable URL: {url}: {exc}') from exc
    return parsed


class Redirects(urllib.request.HTTPRedirectHandler):
    def __init__(self, origin, guard=None):
        self.origin = origin
        self.guard = guard
        self.count = 0

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        self.count += 1
        parsed = validate_url(newurl)
        if parsed.netloc.lower() != self.origin.lower() or self.count > 5:
            raise ScrapeError('cross-host or excessive redirect blocked')
        if self.guard:
            self.guard(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class RobotsPolicy:
    """Conservative common robots syntax, not a full RFC 9309 implementation.

    Merge equally specific agent groups; wildcard groups apply only as fallback.
    Any matching Disallow wins, even over a longer Allow. This intentionally
    overblocks exceptions rather than accidentally granting pagination access.
    """
    def __init__(self, text, agent):
        groups, agents, directives = [], [], []
        for line in text.splitlines():
            line = line.split('#', 1)[0].strip()
            if ':' not in line:
                continue
            key, value = (part.strip() for part in line.split(':', 1))
            key = key.lower()
            if key == 'user-agent':
                if directives:
                    groups.append((agents, directives))
                    agents, directives = [], []
                agents.append(value.lower())
            elif agents:
                directives.append((key, value))
        if agents:
            groups.append((agents, directives))
        token = agent.split('/', 1)[0].lower()
        ranked = [(max((len(a) if a != '*' else 0 for a in names
                        if a and (a == '*' or a in token)), default=-1), rules)
                  for names, rules in groups]
        best = max((rank for rank, _ in ranked), default=-1)
        self.rules = [rule for rank, rules in ranked if rank == best and rank >= 0 for rule in rules]

    def check(self, url, default_delay):
        parsed = urllib.parse.urlsplit(url)
        target = parsed.path or '/'
        if parsed.query:
            target += '?' + parsed.query
        delay = default_delay
        try:
            targets = (target, urllib.parse.unquote(target, errors='strict'))
            for key, value in self.rules:
                if key == 'disallow' and value:
                    # Decode literals separately: encoded '*'/'$' are not operators.
                    anchored = value.endswith('$')
                    body = value[:-1] if anchored else value
                    patterns = [body.split('*'), [urllib.parse.unquote(p, errors='strict') for p in body.split('*')]]
                    for parts in patterns:
                        pattern = '^' + '.*'.join(re.escape(p) for p in parts) + ('$' if anchored else '')
                        if any(re.search(pattern, t) for t in targets):
                            raise ScrapeError(f'robots Disallow matched {value!r}; conservative policy ignores Allow exceptions/longest-rule overrides')
                elif key == 'crawl-delay':
                    seconds = float(value)
                    if not math.isfinite(seconds) or seconds < 0:
                        raise ValueError('invalid crawl-delay')
                    delay = max(delay, seconds)
                elif key == 'request-rate':
                    requests, seconds = (float(p) for p in value.split('/'))
                    if not all(math.isfinite(v) and v > 0 for v in (requests, seconds)):
                        raise ValueError('invalid request-rate')
                    delay = max(delay, seconds / requests)
                    if not math.isfinite(delay):
                        raise ValueError('request-rate interval overflow')
        except (ValueError, UnicodeError, OverflowError) as exc:
            raise ScrapeError('robots policy ambiguous/invalid; conservative failure closed') from exc
        return delay


class Network:
    def __init__(self, delay=2, timeout=10, max_bytes=2 * 1024 * 1024):
        self.delay = delay
        self.timeout = timeout
        self.max_bytes = max_bytes
        self.agent = 'ProductReviewSentiment/1.0 (local research CLI; robots respected)'
        self.robots = {}
        self.last = {}
        self.warnings = []

    def pace(self, origin, delay):
        remaining = self.last.get(origin, 0) + delay - time.monotonic()
        if remaining > 0:
            time.sleep(remaining)
        self.last[origin] = time.monotonic()

    def raw(self, url, guard=None, delay=None):
        parsed = validate_url(url)
        origin = parsed.netloc.lower()
        self.pace(origin, self.delay if delay is None else delay)
        opener = urllib.request.build_opener(Redirects(origin, guard))
        request = urllib.request.Request(url, headers={'User-Agent': self.agent, 'Accept': 'text/html, application/ld+json, application/json, text/plain'})
        with opener.open(request, timeout=self.timeout) as response:
            data = response.read(self.max_bytes + 1)
            if len(data) > self.max_bytes:
                raise ScrapeError('max_bytes exceeded; response truncated and not parsed')
            return data.decode(response.headers.get_content_charset() or 'utf-8', errors='replace'), response.geturl()

    def policy(self, url):
        parsed = validate_url(url)
        origin = f'{parsed.scheme}://{parsed.netloc}'
        if origin not in self.robots:
            try:
                text, _ = self.raw(origin + '/robots.txt')
                # A login page or other non-robots response is not permission.
                if not re.search(r'^\s*user-agent\s*:', text, re.I | re.M):
                    raise ScrapeError('unknown robots policy (no User-agent directive)')
                self.robots[origin] = RobotsPolicy(text, self.agent)
            except urllib.error.HTTPError as exc:
                exc.close()
                if exc.code == 404:
                    self.warnings.append(f'{origin}: robots.txt 404; allowed by standard convention')
                    self.robots[origin] = None
                else:
                    self.robots[origin] = False
            except (OSError, ValueError, LookupError, ScrapeError):
                self.robots[origin] = False
        robot = self.robots[origin]
        if robot is False:
            raise ScrapeError('robots denied or unavailable; failed closed')
        return robot.check(url, self.delay) if robot is not None else self.delay

    def fetch(self, url):
        delay = self.policy(url)
        def guard(target):
            target_delay = self.policy(target)
            self.pace(urllib.parse.urlsplit(target).netloc.lower(), target_delay)
        return self.raw(url, guard=guard, delay=delay)


class Page(HTMLParser):
    def __init__(self, html):
        super().__init__(convert_charrefs=True)
        self.blocks = []
        self.next_links = []
        self.current = None
        self.feed(html)
        self.close()

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'script' and attrs.get('type', '').split(';')[0].strip().lower() == 'application/ld+json':
            self.current = []
        if tag in ('a', 'link') and 'next' in attrs.get('rel', '').lower().split() and attrs.get('href'):
            self.next_links.append(attrs['href'])

    def handle_data(self, data):
        if self.current is not None:
            self.current.append(data)

    def handle_endtag(self, tag):
        if tag == 'script' and self.current is not None:
            self.blocks.append(''.join(self.current))
            self.current = None


def typed(node, kind):
    values = node.get('@type', [])
    return any(str(v).rstrip('/').split('/')[-1].split(':')[-1] == kind for v in (values if isinstance(values, list) else [values]))


def identity(node, product):
    return isinstance(node, dict) and typed(node, 'Product') and normalized(node.get('name', '')) in {normalized(product['name']), *(normalized(a) for a in product.get('aliases', []))}


def score(rating, minimum, maximum):
    if rating is None or any(isinstance(value, bool) for value in (rating, minimum, maximum)):
        return None, None
    try:
        value, low, high = float(rating), float(minimum), float(maximum)
        if not all(math.isfinite(x) for x in (value, low, high)) or high <= low or not low <= value <= high:
            return None, None
        five = 1 + 4 * (value - low) / (high - low)
        return five, 'positive' if five >= 4 else 'negative' if five <= 2 else 'neutral'
    except (TypeError, ValueError, OverflowError):
        return None, None


def json_number(value):
    number = float(value)
    if not math.isfinite(number):
        raise ValueError('nonfinite JSON number')
    return number


def extract(html, product, url, max_nodes=10000):
    page = Page(html)
    warnings, roots = [], []
    blocks = page.blocks
    if not blocks and html.lstrip().startswith(('{', '[')):
        blocks = [html]
    for block in blocks:
        try:
            roots.append(json.loads(block, parse_float=json_number, parse_constant=json_number))
        except (ValueError, RecursionError):
            warnings.append('malformed JSON-LD block')
    if not blocks:
        warnings.append('no JSON-LD: unsupported/JS-only page possible; absence is not negative sentiment')
    # Index local @id references; never retrieve remote JSON-LD contexts/references.
    nodes, stack = [], [(root, 0) for root in roots]
    while stack and len(nodes) < max_nodes:
        node, depth = stack.pop()
        nodes.append(node)
        if depth >= 40:
            warnings.append('structured-data depth cap reached')
            continue
        if isinstance(node, dict):
            stack.extend((v, depth + 1) for v in node.values())
        elif isinstance(node, list):
            stack.extend((v, depth + 1) for v in node)
    if stack:
        warnings.append('structured-data node cap reached')
    index = {n['@id']: n for n in nodes if isinstance(n, dict) and isinstance(n.get('@id'), str) and len(n) > 1}
    def resolve(n):
        return index.get(n.get('@id'), n) if isinstance(n, dict) and set(n) == {'@id'} else n
    candidates = []
    traversed = {id(n) for n in nodes}
    matched = False
    for node in nodes:
        if not isinstance(node, dict):
            continue
        if typed(node, 'Product'):
            if identity(node, product):
                matched = True
                reviews = node.get('review', [])
                for review in reviews if isinstance(reviews, list) else [reviews]:
                    review = resolve(review)
                    if id(review) in traversed and isinstance(review, dict) and typed(review, 'Review'):
                        item = resolve(review.get('itemReviewed'))
                        if item is not None and not identity(item, product):
                            warnings.append('conflicting review product attribution skipped')
                        else:
                            candidates.append(review)
            elif node.get('review'):
                warnings.append('mismatched product reviews skipped')
        if typed(node, 'Review') and identity(resolve(node.get('itemReviewed')), product):
            matched = True
            candidates.append(node)
    results, seen = [], set()
    for review in candidates:
        # The same JSON node reached via Product.review and itemReviewed is not a duplicate observation.
        if id(review) in seen:
            continue
        seen.add(id(review))
        rating = review.get('reviewRating', {})
        rating = rating if isinstance(rating, dict) else {}
        value = rating.get('ratingValue')
        low, high = rating.get('worstRating', 1), rating.get('bestRating', 5)
        five, sentiment = score(value, low, high)
        text = lambda key: review.get(key) if isinstance(review.get(key), str) else None
        row = {'product_id': product['id'], 'product_name': product['name'], 'body': text('reviewBody'), 'title': text('name'), 'date': text('datePublished'), 'rating': value if isinstance(value, (str, int, float)) else None, 'rating_min': low, 'rating_max': high, 'normalized_rating': five, 'sentiment': sentiment, 'verified_purchase': review.get('verifiedPurchase') if isinstance(review.get('verifiedPurchase'), bool) else None, 'source_urls': [url], 'duplicate_count': 0}
        results.append(row)
    if not results:
        warnings.append('no supported attributed individual product reviews found; coverage unknown')
    return results, page.next_links, matched, sorted(set(warnings))


def deduplicate(rows):
    unique = {}
    for row in rows:
        # Exact content only, not author identity. Identical short reviews can be distinct people.
        keys = ('product_id', 'body', 'title', 'date', 'rating', 'rating_min', 'rating_max', 'verified_purchase')
        fingerprint = hashlib.sha256(json.dumps([row[k] for k in keys], sort_keys=True).encode()).hexdigest()
        if fingerprint in unique:
            prior = unique[fingerprint]
            prior['duplicate_count'] += 1
            prior['source_urls'] = sorted(set(prior['source_urls'] + row['source_urls']))
        else:
            unique[fingerprint] = dict(row, source_urls=list(row['source_urls']))
    return list(unique.values())


def load_config(path):
    with open(path, encoding='utf-8') as file:
        config = json.load(file)
    if not isinstance(config, dict) or set(config) != {'products'} or not isinstance(config['products'], list) or not config['products']:
        raise ValueError('config must contain a nonempty products array only')
    ids, names = set(), set()
    for product in config['products']:
        if not isinstance(product, dict) or set(product) - {'id', 'name', 'aliases', 'urls'}:
            raise ValueError('invalid product fields')
        if any(not isinstance(product.get(k), str) or not product[k].strip() for k in ('id', 'name')):
            raise ValueError('product id/name required')
        aliases = product.get('aliases', [])
        if not isinstance(aliases, list) or any(not isinstance(a, str) or not normalized(a) for a in aliases):
            raise ValueError('aliases must be nonempty strings')
        product_names = {normalized(product['name']), *(normalized(a) for a in aliases)}
        if product['id'] in ids or not normalized(product['name']) or names & product_names:
            raise ValueError('duplicate id or ambiguous product names/aliases')
        ids.add(product['id'])
        names.update(product_names)
        urls = product.get('urls')
        if not isinstance(urls, list) or not urls or len(urls) > 20:
            raise ValueError('each product needs 1–20 seed URLs')
        for url in urls:
            if not isinstance(url, str):
                raise ValueError('URL must be a string')
            parsed = urllib.parse.urlsplit(url)
            if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password:
                raise ValueError('seed URL requires HTTP(S), hostname, no credentials')
            _ = parsed.port
    return config


def parsed_date(value):
    if not value:
        return None
    try:
        return datetime.datetime.fromisoformat(value.replace('Z', '+00:00')).date().isoformat()
    except ValueError:
        for pattern in ('%d %b %Y', '%d %B %Y'):
            try:
                return datetime.datetime.strptime(value, pattern).date().isoformat()
            except ValueError:
                pass
    return None


def summarize(rows, pages):
    counts = Counter(row['sentiment'] or 'unscored' for row in rows)
    dates = sorted(date for row in rows if (date := parsed_date(row['date'])))
    return {'unique_reviews': len(rows), 'counts': {k: counts[k] for k in ('positive', 'neutral', 'negative', 'unscored')}, 'scored_coverage': (len(rows) - counts['unscored']) / len(rows) if rows else None, 'duplicates': sum(r['duplicate_count'] for r in rows), 'pages_attempted': len(pages), 'fetch_failures': sum(p['status'] == 'failed' for p in pages), 'pages_without_reviews': sum(p.get('review_count') == 0 for p in pages), 'date_min': dates[0] if dates else None, 'date_max': dates[-1] if dates else None, 'unparsed_dates': sum(bool(row['date']) and parsed_date(row['date']) is None for row in rows)}


def run(config, network, max_pages=10, crawl_depth=0):
    rows, pages, warnings = [], [], []
    for product in config['products']:
        queue = [(u, 0) for u in product['urls']]
        visited = set()
        while queue and len(pages) < max_pages:
            url, depth = queue.pop(0)
            url = urllib.parse.urldefrag(url)[0]
            if url in visited:
                continue
            visited.add(url)
            entry = {'product_id': product['id'], 'url': url, 'depth': depth}
            pages.append(entry)
            try:
                html, final = network.fetch(url)
                reviews, links, matched, notes = extract(html, product, final)
                for row in reviews:
                    row['source_urls'] = sorted({url, final})
                rows.extend(reviews)
                entry.update(status='ok', final_url=final, review_count=len(reviews), warnings=notes)
                if matched and depth < crawl_depth:
                    for link in links:
                        target = urllib.parse.urljoin(final, link)
                        a, b = urllib.parse.urlsplit(final), urllib.parse.urlsplit(target)
                        # Conservative same-product pagination: same path only, query may vary.
                        if a.netloc.lower() == b.netloc.lower() and a.path == b.path and b.scheme in ('http', 'https'):
                            if len(queue) < max_pages:
                                queue.append((target, depth + 1))
                            else:
                                entry.setdefault('warnings', []).append('pagination queue cap reached')
                        else:
                            entry.setdefault('warnings', []).append('off-host or different-product-path pagination skipped')
            except (OSError, ValueError, LookupError, ScrapeError, RecursionError) as exc:
                if isinstance(exc, urllib.error.HTTPError):
                    exc.close()
                entry.update(status='failed', error=str(exc))
        if queue:
            warnings.append(f'{product["id"]}: global max_pages reached; queued pages truncated')
    unique = deduplicate(rows)
    products, sources = {}, {}
    for product in config['products']:
        pid = product['id']
        products[pid] = summarize([r for r in unique if r['product_id'] == pid], [p for p in pages if p['product_id'] == pid])
        if not products[pid]['pages_attempted']:
            warnings.append(f'{pid}: no pages attempted due to global page cap')
        for url in sorted({p['url'] for p in pages if p['product_id'] == pid}):
            # Source counts use observations at this URL, then deduplicate within that source.
            sources[f'{pid} | {url}'] = summarize(deduplicate([r for r in rows if r['product_id'] == pid and url in r['source_urls']]), [p for p in pages if p['product_id'] == pid and p['url'] == url])
    return {'generated_at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'method': 'Explicit schema.org individual product reviews; rating proxy, not text tone or unbiased sampling.', 'reviews': unique, 'products': products, 'sources': sources, 'pages': pages, 'warnings': warnings + network.warnings}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True, help='JSON product identities and seed review URLs')
    parser.add_argument('--output', required=True, help='output directory (report.json and reviews.jsonl)')
    parser.add_argument('--crawl-depth', type=int, default=0, help='rel=next depth, 0–3 (default 0)')
    parser.add_argument('--max-pages', type=int, default=10, help='global page cap, 1–100 (default 10)')
    args = parser.parse_args(argv)
    if not 0 <= args.crawl_depth <= 3 or not 1 <= args.max_pages <= 100:
        parser.error('crawl-depth must be 0–3 and max-pages 1–100')
    try:
        config = load_config(args.config)
        report = run(config, Network(), args.max_pages, args.crawl_depth)
        output = Path(args.output)
        output.mkdir(parents=True, exist_ok=True)
        (output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')
        (output / 'reviews.jsonl').write_text(''.join(json.dumps(row, ensure_ascii=False, allow_nan=False) + '\n' for row in report['reviews']), encoding='utf-8')
    except (OSError, ValueError, RecursionError) as exc:
        print(f'error: {exc}', file=sys.stderr)
        return 2
    partial = bool(report['warnings']) or any(p['status'] == 'failed' or p.get('warnings') for p in report['pages'])
    print(f'{len(report["reviews"])} unique reviews; {len(report["pages"])} pages; report: {output / "report.json"}')
    return 1 if partial else 0


if __name__ == '__main__':
    sys.exit(main())
