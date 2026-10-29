import importlib.util
import json
import socket
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'product_review_sentiment.py'
spec = importlib.util.spec_from_file_location('scraper', SCRIPT)
s = importlib.util.module_from_spec(spec)
spec.loader.exec_module(s)
PRODUCT = {'id': 'lens', 'name': 'Example Lens', 'aliases': ['Example Lens Daily'], 'urls': ['https://public.example/reviews']}
URL = PRODUCT['urls'][0]


def html(data):
    return '<script type="application/ld+json">' + json.dumps(data) + '</script>'


def review(**extra):
    return {'@type': 'Review', 'reviewBody': 'Comfortable', 'reviewRating': {'ratingValue': 4}, **extra}


def product(**extra):
    return {'@type': 'Product', 'name': PRODUCT['name'], 'review': review(), **extra}


class ExtractionTests(unittest.TestCase):
    def test_product_review_preserves_fields_not_author(self):
        node = product(review=review(name='Title', datePublished='2025-01-02', verifiedPurchase=True, author={'email': 'private@example.com'}))
        rows, _, matched, notes = s.extract(html(node), PRODUCT, URL)
        self.assertTrue(matched)
        self.assertFalse(notes)
        self.assertEqual(rows[0]['title'], 'Title')
        self.assertEqual(rows[0]['date'], '2025-01-02')
        self.assertTrue(rows[0]['verified_purchase'])
        self.assertNotIn('author', rows[0])

    def test_nested_graph_arrays_and_id_references(self):
        data = [{'@graph': [product(review={'@id': '#r'}), review(**{'@id': '#r', 'itemReviewed': {'@id': '#p'}}), {'@id': '#p', '@type': 'Product', 'name': PRODUCT['name']}]}]
        self.assertEqual(len(s.extract(html(data), PRODUCT, URL)[0]), 1)

    def test_standalone_jsonld_and_alias(self):
        rows = s.extract(json.dumps(product(name='EXAMPLE Lens Daily')), PRODUCT, URL)[0]
        self.assertEqual(len(rows), 1)

    def test_review_item_reviewed_product(self):
        self.assertEqual(len(s.extract(html(review(itemReviewed=product(review=[]))), PRODUCT, URL)[0]), 1)

    def test_service_and_aggregate_excluded(self):
        data = [{'@type': 'Organization', 'review': review(), 'aggregateRating': {'ratingValue': 5}}, review(itemReviewed={'@type': 'Service', 'name': PRODUCT['name']}), product(review=[], aggregateRating={'ratingValue': 5})]
        self.assertEqual(s.extract(html(data), PRODUCT, URL)[0], [])

    def test_mismatch_and_conflict(self):
        for node in [product(name='Other Lens'), product(review=review(itemReviewed=product(name='Other Lens')))]:
            self.assertFalse(s.extract(html(node), PRODUCT, URL)[0])

    def test_multiple_products_do_not_merge(self):
        rows = s.extract(html([product(), product(name='Other Lens')]), PRODUCT, URL)[0]
        self.assertEqual(len(rows), 1)

    def test_normalization(self):
        for args, expected in [((4, 1, 5), 'positive'), ((3, 1, 5), 'neutral'), ((2, 1, 5), 'negative'), ((8, 0, 10), 'positive'), ((5, 0, 10), 'neutral'), ((1, 0, 10), 'negative'), ((6, 1, 5), None), (('NaN', 1, 5), None), ((None, 1, 5), None), ((True, 1, 5), None), ((4, 5, 1), None)]:
            with self.subTest(args=args):
                self.assertEqual(s.score(*args)[1], expected)

    def test_unrated_keeps_text(self):
        rows = s.extract(html(product(review=review(reviewRating={}))), PRODUCT, URL)[0]
        self.assertIsNone(rows[0]['sentiment'])
        self.assertEqual(rows[0]['body'], 'Comfortable')

    def test_duplicates_provenance(self):
        a = s.extract(html(product()), PRODUCT, URL)[0][0]
        b = dict(a, source_urls=['https://public.example/reviews?page=2'])
        rows = s.deduplicate([a, b, a])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['duplicate_count'], 2)
        self.assertEqual(len(rows[0]['source_urls']), 2)

    def test_malformed_and_empty(self):
        for text in ['<script type="application/ld+json">{bad}</script>', '<html>JS required</html>']:
            rows, _, _, notes = s.extract(text, PRODUCT, URL)
            self.assertFalse(rows)
            self.assertTrue(notes)

    def test_summary_dates_are_chronological_not_lexical(self):
        rows = s.extract(html(product(review=[review(datePublished='01 Oct 2026'), review(datePublished='29 Sep 2026'), review(datePublished='unknown')])), PRODUCT, URL)[0]
        summary = s.summarize(rows, [])
        self.assertEqual(summary['date_min'], '2026-09-29')
        self.assertEqual(summary['date_max'], '2026-10-01')
        self.assertEqual(summary['unparsed_dates'], 1)

    def test_nonfinite_json_is_rejected(self):
        for value in ('NaN', 'Infinity', '-Infinity', '1e999'):
            text = json.dumps(product()).replace('"ratingValue": 4', '"ratingValue": ' + value)
            rows, _, _, notes = s.extract(text, PRODUCT, URL)
            self.assertEqual(rows, [])
            self.assertIn('malformed JSON-LD block', notes)

    def test_huge_rating_does_not_crash(self):
        self.assertEqual(s.score(10 ** 400, 1, 5), (None, None))

    def test_node_cap_does_not_expand_unvisited_reviews(self):
        rows, _, _, notes = s.extract(html(product(review=[review()] * 50)), PRODUCT, URL, max_nodes=1)
        self.assertEqual(rows, [])
        self.assertIn('structured-data node cap reached', notes)

    def test_node_limit(self):
        self.assertIn('structured-data node cap reached', s.extract(html([product()] * 10), PRODUCT, URL, max_nodes=2)[3])


class FakeNetwork:
    warnings = []

    def __init__(self, pages):
        self.pages = pages
        self.calls = []

    def fetch(self, url):
        self.calls.append(url)
        value = self.pages[url]
        if isinstance(value, Exception):
            raise value
        return value, url


class CrawlTests(unittest.TestCase):
    def test_bounded_crawl_and_crossproduct_offhost_skip(self):
        page = html(product()) + '<a rel="next" href="?page=2">Next</a><a rel="next" href="/other">Other</a><a rel="next" href="https://other.example/reviews">Offsite</a>'
        net = FakeNetwork({URL: page, URL + '?page=2': html(product(name='Other Lens'))})
        result = s.run({'products': [PRODUCT]}, net, crawl_depth=1)
        self.assertEqual(len(net.calls), 2)
        self.assertEqual(len(result['reviews']), 1)
        self.assertTrue(result['pages'][1]['warnings'])
        self.assertEqual(result['products']['lens']['pages_without_reviews'], 1)

    def test_page_cap(self):
        page = html(product()) + '<a rel="next" href="?page=2">Next</a>'
        net = FakeNetwork({URL: page})
        result = s.run({'products': [PRODUCT]}, net, max_pages=1, crawl_depth=1)
        self.assertEqual(len(net.calls), 1)
        self.assertTrue(result['warnings'])

    def test_default_no_crawl_and_empty_coverage(self):
        net = FakeNetwork({URL: '<html>Nothing</html>'})
        result = s.run({'products': [PRODUCT]}, net)
        self.assertIsNone(result['products']['lens']['scored_coverage'])
        self.assertTrue(result['pages'][0]['warnings'])

    def test_403_429_no_retry(self):
        for code in (403, 429):
            net = FakeNetwork({URL: urllib.error.HTTPError(URL, code, 'blocked', {}, None)})
            result = s.run({'products': [PRODUCT]}, net)
            self.assertEqual(net.calls, [URL])
            self.assertEqual(result['products']['lens']['fetch_failures'], 1)


class NetworkTests(unittest.TestCase):
    def setUp(self):
        self.validate = patch.object(s, 'validate_url', side_effect=lambda url: s.urllib.parse.urlsplit(url))
        self.validate.start()
        self.addCleanup(self.validate.stop)
        self.net = s.Network(delay=0)

    def test_robots_denied_no_page_fetch(self):
        with patch.object(self.net, 'raw', return_value=('User-agent: *\nDisallow: /', URL)) as raw:
            with self.assertRaises(s.ScrapeError):
                self.net.fetch(URL)
            self.assertEqual(raw.call_count, 1)
            self.assertTrue(raw.call_args.args[0].endswith('/robots.txt'))

    def test_robots_404(self):
        error = urllib.error.HTTPError(URL, 404, 'missing', {}, None)
        with patch.object(self.net, 'raw', side_effect=[error, ('ok', URL)]) as raw:
            self.assertEqual(self.net.fetch(URL)[0], 'ok')
            self.assertEqual(raw.call_count, 2)
            self.assertTrue(self.net.warnings)

    def test_robots_network_failure_and_unknown(self):
        for response in [OSError('offline'), ('<html>login</html>', URL)]:
            with self.subTest(response=response), patch.object(self.net, 'raw', side_effect=response if isinstance(response, Exception) else None, return_value=response) as raw:
                self.net.robots.clear()
                with self.assertRaises(s.ScrapeError):
                    self.net.fetch(URL)
                self.assertEqual(raw.call_count, 1)

    def test_robots_delay_and_rate(self):
        with patch.object(self.net, 'raw', return_value=('User-agent: *\nAllow: /\nCrawl-delay: 3\nRequest-rate: 1/8', URL)):
            self.assertEqual(self.net.policy(URL), 8)

    def test_robots_query_wildcards_preserve_clean_seed(self):
        policy = 'User-agent: *\nDisallow: /*?*\nAllow: /*?page=*'
        with patch.object(self.net, 'raw', return_value=(policy, URL)):
            self.assertEqual(self.net.policy(URL), 0)
            for query in ('?page=2', '?sort=helpful', '?q=2&page=1'):
                with self.subTest(query=query), self.assertRaisesRegex(s.ScrapeError, 'conservative policy'):
                    self.net.policy(URL + query)

    def test_robots_end_anchor_and_encoded_literals(self):
        policy = s.RobotsPolicy('User-agent: *\nDisallow: /*.json$\nDisallow: /literal%2A\nDisallow: /cash%24', self.net.agent)
        for path in ('/reviews.json', '/a/b.json', '/literal*', '/cash$'):
            with self.subTest(path=path), self.assertRaises(s.ScrapeError):
                policy.check('https://public.example' + path, 0)
        for path in ('/reviews.json?x=1', '/reviews.json/more', '/literal-other', '/cash-other'):
            self.assertEqual(policy.check('https://public.example' + path, 0), 0)

    def test_robots_allow_and_longest_exceptions_fail_closed(self):
        for rules in ('Disallow: /private\nAllow: /private/open', 'Allow: /private/open\nDisallow: /private', 'Disallow: /private/open\nAllow: /private/open'):
            policy = s.RobotsPolicy('User-agent: *\n' + rules, self.net.agent)
            with self.assertRaisesRegex(s.ScrapeError, 'ignores Allow exceptions/longest-rule'):
                policy.check('https://public.example/private/open', 0)
            self.assertEqual(policy.check(URL, 0), 0)

    def test_robots_specific_groups_merge_not_wildcard(self):
        policy = s.RobotsPolicy('User-agent: *\nDisallow: /\nCrawl-delay: 99\n'
                               'User-agent: Product\nDisallow: /reviews\n'
                               'User-agent: ProductReviewSentiment\nDisallow: /one\nCrawl-delay: 3\n'
                               'User-agent: OtherBot\nDisallow: /\n'
                               'User-agent: ProductReviewSentiment\nDisallow: /two\nRequest-rate: 1/8', self.net.agent)
        self.assertEqual(policy.check(URL, 0), 8)
        for path in ('/one', '/two'):
            with self.assertRaises(s.ScrapeError):
                policy.check('https://public.example' + path, 0)

    def test_robots_multiple_agents_and_invalid_extensions(self):
        policy = s.RobotsPolicy('User-agent: OtherBot\nUser-agent: ProductReviewSentiment\nDisallow: /reviews', self.net.agent)
        with self.assertRaises(s.ScrapeError):
            policy.check(URL, 0)
        for extension in ('Crawl-delay: NaN', 'Request-rate: 0/8', 'Request-rate: 1e-308/1e308'):
            with self.assertRaisesRegex(s.ScrapeError, 'ambiguous/invalid'):
                s.RobotsPolicy('User-agent: *\n' + extension, self.net.agent).check(URL, 0)

    def test_next_link_cannot_bypass_wildcard_robots(self):
        page = html(product()) + '<a rel="next" href="?page=2">Next</a>'
        with patch.object(self.net, 'raw', side_effect=[('User-agent: *\nDisallow: /*?*', URL), (page, URL)]) as raw:
            result = s.run({'products': [PRODUCT]}, self.net, crawl_depth=1)
        self.assertEqual(raw.call_count, 2)  # robots and clean seed only
        self.assertEqual(len(result['reviews']), 1)
        self.assertEqual(result['pages'][1]['status'], 'failed')
        self.assertIn('Disallow', result['pages'][1]['error'])

    def test_redirect_cannot_bypass_wildcard_robots(self):
        with patch.object(self.net, 'raw', return_value=('User-agent: *\nDisallow: /*?*', URL)):
            self.net.policy(URL)
        handler = s.Redirects('public.example', self.net.policy)
        with self.assertRaisesRegex(s.ScrapeError, 'Disallow'):
            handler.redirect_request(None, None, 302, '', {}, URL + '?page=2')

    def test_crosshost_redirect(self):
        handler = s.Redirects('public.example')
        with self.assertRaises(s.ScrapeError):
            handler.redirect_request(None, None, 302, '', {}, 'https://other.example/')

    def test_redirect_guard_and_limit(self):
        guard = lambda _: (_ for _ in ()).throw(s.ScrapeError('robots denied'))
        with self.assertRaises(s.ScrapeError):
            s.Redirects('public.example', guard).redirect_request(None, None, 302, '', {}, URL)
        handler = s.Redirects('public.example')
        handler.count = 5
        with self.assertRaises(s.ScrapeError):
            handler.redirect_request(None, None, 302, '', {}, URL)

    def test_max_bytes(self):
        from email.message import Message
        response = unittest.mock.MagicMock()
        response.__enter__.return_value = response
        response.read.return_value = b'x' * 11
        response.headers = Message()
        opener = unittest.mock.Mock()
        opener.open.return_value = response
        with patch.object(s.urllib.request, 'build_opener', return_value=opener):
            self.net.max_bytes = 10
            with self.assertRaisesRegex(s.ScrapeError, 'truncated'):
                self.net.raw(URL)


class SafetyConfigTests(unittest.TestCase):
    def test_private_loopback_linklocal_and_redirect(self):
        for address in ('127.0.0.1', '10.0.0.1', '169.254.1.1', '::1'):
            with self.subTest(address=address), patch.object(socket, 'getaddrinfo', return_value=[(2, 1, 6, '', (address, 80))]):
                with self.assertRaises(s.ScrapeError):
                    s.validate_url(URL)
                with self.assertRaises(s.ScrapeError):
                    s.Redirects('public.example').redirect_request(None, None, 302, '', {}, URL)

    def test_bad_scheme_credentials(self):
        for url in ('file:///tmp/test', 'http://user:pass@example.com', 'ftp://example.com'):
            with self.assertRaises(s.ScrapeError):
                s.validate_url(url)

    def test_config_validation(self):
        invalid = [{}, {'products': []}, {'products': [dict(PRODUCT, aliases='bad')]}, {'products': [dict(PRODUCT, urls=['file:///tmp/test'])]}, {'products': [PRODUCT, dict(PRODUCT, id='second')]}, {'products': [dict(PRODUCT, urls=[])]}]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'config.json'
            for value in invalid:
                path.write_text(json.dumps(value))
                with self.assertRaises(ValueError):
                    s.load_config(path)
            path.write_text(json.dumps({'products': [PRODUCT]}))
            self.assertEqual(s.load_config(path)['products'][0]['id'], 'lens')

    def test_cli_outputs_strict_json_and_retains_legitimate_unrated_review(self):
        malformed = html(product()).replace('"ratingValue": 4', '"ratingValue": NaN')
        valid = html(product(review=review(reviewRating={})))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'config.json'
            path.write_text(json.dumps({'products': [PRODUCT]}))
            net = FakeNetwork({URL: malformed + valid})
            with patch.object(s, 'Network', return_value=net):
                self.assertEqual(s.main(['--config', str(path), '--output', directory]), 1)
            def reject(value):
                self.fail('Nonstandard JSON constant: ' + value)
            report = json.loads((Path(directory) / 'report.json').read_text(), parse_constant=reject)
            records = [json.loads(line, parse_constant=reject) for line in (Path(directory) / 'reviews.jsonl').read_text().splitlines()]
            self.assertEqual(len(records), 1)
            self.assertIsNone(records[0]['rating'])
            self.assertIsNone(records[0]['sentiment'])
            self.assertEqual(records[0]['body'], 'Comfortable')
            self.assertIn('malformed JSON-LD block', report['pages'][0]['warnings'])

    def test_cli_output_and_partial_exit(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'config.json'
            path.write_text(json.dumps({'products': [PRODUCT]}))
            net = FakeNetwork({URL: '<html>unsupported</html>'})
            with patch.object(s, 'Network', return_value=net):
                self.assertEqual(s.main(['--config', str(path), '--output', directory]), 1)
            self.assertTrue((Path(directory) / 'report.json').exists())
            self.assertTrue((Path(directory) / 'reviews.jsonl').exists())


if __name__ == '__main__':
    unittest.main()
