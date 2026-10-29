"""V2 routes on a disposable test server; never the actual application service."""
import unittest
from backend.tests import test_api as baseline


class EducationHTTPTests(unittest.TestCase):
    def setUp(self):
        self.http = baseline.HTTPTests(methodName='runTest')
        self.addCleanup(self.http.doCleanups)
        self.http.setUp()

    def test_routes_auth_consent_local_and_fixed_safety(self):
        call = self.http.call
        root = '/api/oculog/v2/education'
        self.assertEqual(call('GET', root)[0], 401)
        status, body, _, _ = call('GET', root, token=self.http.token)
        self.assertEqual(status, 200)
        self.assertEqual(body['version'], 2)
        self.assertGreater(body['corpus']['chunk_count'], 0)
        self.assertEqual(body['languages'], ['en', 'es'])
        disclosure = body['disclosure']['version']
        status, body, _, _ = call('PUT', root + '/consent', {'disclosure_version': disclosure, 'granted': True, 'adult_ack': True}, token=self.http.token)
        self.assertEqual(status, 200)
        self.assertEqual(body['epoch'], 1)
        status, body, _, _ = call('POST', root + '/answer', {'topic_id': 'cleaning'}, token=self.http.token)
        self.assertEqual(status, 200)
        self.assertEqual(body['mode'], 'local_retrieval')
        self.assertTrue(all(paragraph['citations'] for paragraph in body['paragraphs']))
        status, body, _, _ = call('POST', root + '/answer', {'message': 'limpieza', 'language': 'es'}, token=self.http.token)
        self.assertEqual(status, 200)
        self.assertEqual(body['mode'], 'local_retrieval')
        self.assertTrue(all(source['language'] == 'es' for source in body['sources']))
        status, body, _, _ = call('POST', root + '/answer', {'question_id': 'emergency', 'language': 'es'}, token=self.http.token)
        self.assertEqual(status, 200)
        self.assertEqual(body['mode'], 'safety')
        self.assertEqual(body['language'], 'en')
        self.assertIsNone(body['provenance']['model'])

    def test_cors_put_and_body_rejection(self):
        call = self.http.call
        root = '/api/oculog/v2/education'
        status, _, headers, _ = call('OPTIONS', root + '/consent', headers={
            'Origin': 'http://localhost:8081', 'Access-Control-Request-Method': 'PUT',
            'Access-Control-Request-Headers': 'authorization,content-type'})
        self.assertEqual(status, 200)
        self.assertIn('PUT', headers['access-control-allow-methods'])
        for body in ({'topic_id': 'cleaning', 'message': 'water'}, {'topic_id': 'cleaning', 'use_ai': True}):
            self.assertEqual(call('POST', root + '/answer', body, token=self.http.token)[0], 400)
