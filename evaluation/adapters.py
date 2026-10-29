"""Gateway-only adapter logic; importing this module does not import RAGAS/SDKs."""
from contextlib import closing
from decimal import Decimal
from pathlib import Path
import sqlite3
import threading


class RunBudgetExceeded(RuntimeError):
    pass


class MeteredRun:
    """Additional conservative per-run bound. Never replaces the shared global ledger.

    Atomically bound settled actual cost + outstanding quotes + unknown holds.
    Release slack only after verifying the completed cost against the shared ledger.
    """
    def __init__(self, gateway, max_run_usd='1.00', validate_path=lambda: None):
        self.gateway = gateway
        self.limit = Decimal(str(max_run_usd))
        if not self.limit.is_finite() or self.limit <= 0:
            raise ValueError('Run limit must be finite and positive')
        self.validate_path = validate_path
        self.reserved = Decimal(0)
        self.cumulative_quotes = Decimal(0)
        self.settled = Decimal(0)
        self.outstanding = Decimal(0)
        self.unknown = Decimal(0)
        self.lock = threading.Lock()
        self.operation_ids = []
        self.settled_operation_ids = set()
        reserve = gateway.budget.reserve
        def tracked_reserve(operation, amount, purpose):
            if purpose != 'evaluation':
                raise ValueError('All candidate, judge, repair and embedding calls must be evaluation operations')
            reserve(operation, amount, purpose)
            with self.lock:
                self.operation_ids.append(operation)
        # Instrument only this private gateway instance, never the application class.
        gateway.budget.reserve = tracked_reserve

    def _allow(self, units):
        self.validate_path()
        amount = Decimal(units) / 1_000_000_000
        if not amount.is_finite() or amount <= 0:
            raise ValueError('Reservation quote must be finite and positive')
        with self.lock:
            if self.reserved + amount > self.limit:
                raise RunBudgetExceeded('Conservative per-run reservation ceiling reached')
            self.reserved += amount
            self.cumulative_quotes += amount
            self.outstanding += amount
        return amount

    def _finish(self, quote, actual=None):
        with self.lock:
            self.outstanding -= quote
            if actual is None:
                self.unknown += quote
            else:
                self.settled += actual
                self.reserved -= quote - actual

    def _verified_cost(self, result, quote):
        self.validate_path()  # Recheck identity after provider dispatch, before releasing slack.
        # A returned decimal alone is not evidence: match this gateway's actual
        # operation, model, reservation and settled charge in the shared ledger.
        cost = result.get('cost')
        if not isinstance(cost, str):
            raise ValueError('Gateway cost must be a decimal string')
        actual = Decimal(cost)
        if not actual.is_finite() or not 0 <= actual <= quote:
            raise ValueError('Gateway cost outside reservation')
        operation = result.get('operation_id')
        with self.lock:
            known = operation in self.operation_ids
        with self.gateway.budget.db() as db:
            row = db.execute('SELECT purpose,reserved,charged,state FROM education_budget_operations WHERE operation_id=?', (operation,)).fetchone()
        if (not known or result.get('model') != self.gateway.price['model'] or not row
                or tuple(row) != ('evaluation', int(quote * 1_000_000_000), actual * 1_000_000_000, 'settled')):
            raise ValueError('Gateway cost does not match shared settled operation')
        with self.lock:
            if operation in self.settled_operation_ids:
                raise ValueError('Gateway operation already settled in this run')
            self.settled_operation_ids.add(operation)
        return actual

    def complete(self, prompt, **kwargs):
        return self._complete(prompt, 'evaluation', **kwargs)

    def complete_answer(self, prompt, **kwargs):
        """Education wire profile, but the same evaluation budget and settlement."""
        return self._complete(prompt, 'evaluation_answer', **kwargs)

    def _complete(self, prompt, purpose, **kwargs):
        output = kwargs.get('max_output_tokens', 512)
        quote = self._allow(self.gateway.reservation(output))
        actual = None
        try:
            result = self.gateway.complete(prompt, purpose=purpose, authorize=lambda db=None: self.validate_path(), **kwargs)
            actual = self._verified_cost(result, quote)
            return result
        finally:
            # Exceptions, invalid costs and uncertain delivery retain the FULL quote.
            self._finish(quote, actual)

    def embedding(self, text):
        from backend.education.budget import money_units
        price = self.gateway.price
        units = money_units(Decimal(price['embedding_input_limit']) * Decimal(price['embedding_usd_per_million']) / 1_000_000)
        quote = self._allow(units)
        try:
            return self.gateway.embedding(text, purpose='evaluation')
        finally:
            self._finish(quote)  # Embedding has no verified actual usage.

    def ledger_report(self):
        operations = []
        with self.gateway.budget.db() as db:
            for operation in self.operation_ids:
                row = db.execute('SELECT operation_id, month, purpose, reserved, charged, state FROM education_budget_operations WHERE operation_id=?', (operation,)).fetchone()
                if row:
                    operations.append(dict(zip(('operation_id', 'month', 'purpose', 'reserved_nano_usd', 'charged_nano_usd', 'state'), row)))
        return {'max_run_usd': str(self.limit), 'cumulative_authorized_reservation_usd': str(self.cumulative_quotes),
                'run_liability_usd': str(self.reserved), 'run_settled_actual_usd': str(self.settled),
                'run_outstanding_quotes_usd': str(self.outstanding), 'run_unknown_holds_usd': str(self.unknown),
                'operations': operations,
                'settled_cost_usd': str(Decimal(sum(o['charged_nano_usd'] for o in operations if o['state'] == 'settled')) / 1_000_000_000),
                'unknown_reservations_usd': str(Decimal(sum(o['charged_nano_usd'] for o in operations if o['state'] in ('reserved', 'dispatched'))) / 1_000_000_000)}


def validate_shared_ledger(path, environ):
    """Require existing app configuration, not a fresh evaluation ledger."""
    configured = environ.get('OCULOG_DB_PATH')
    if not configured:
        raise ValueError('Explicit application OCULOG_DB_PATH is required; no default or temporary paid ledger')
    app = Path(configured).expanduser().resolve(strict=True)
    requested = Path(path).expanduser().resolve(strict=True)
    if app != requested or not app.is_file():
        raise ValueError('Paid ledger must be the existing configured application SQLite database')
    identity = (app.stat().st_dev, app.stat().st_ino)
    def check():
        if Path(environ['OCULOG_DB_PATH']).expanduser().resolve(strict=True) != app or (app.stat().st_dev, app.stat().st_ino) != identity:
            raise ValueError('Shared ledger path changed during evaluation')
        with closing(sqlite3.connect(app.as_uri() + '?mode=ro', uri=True)) as db:
            tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if not {'accounts', 'sessions', 'education_budget_operations', 'education_provider_disabled'} <= tables:
                raise ValueError('Shared application budget/auth schema is unavailable')
            db.execute('SELECT operation_id,month,purpose,reserved,charged,state FROM education_budget_operations LIMIT 0')
    check()
    return app, check


class GatewayLLMLogic:
    """Shared method implementation; the real subclass is built only in paid mode."""
    def generate_text(self, prompt, n=1, temperature=0.01, stop=None, callbacks=None):
        if type(n) is not int or n < 1:
            raise ValueError('n must be positive')
        if stop:
            raise ValueError('Gateway does not support stop sequences; never silently truncate a judge')
        text = prompt.to_string()
        results = []
        for _ in range(n):
            result = self.gateway.complete(text, max_output_tokens=self.max_output_tokens)
            results.append(result['text'])
        return self.make_result(results)

    async def agenerate_text(self, prompt, n=1, temperature=0.01, stop=None, callbacks=None):
        # Sequential by design; avoid concurrent full-input reservations.
        return self.generate_text(prompt, n, temperature, stop, callbacks)

    def is_finished(self, response):
        return bool(response.generations) and all(
            g.generation_info and g.generation_info.get('finish_reason') == 'completed'
            for group in response.generations for g in group)


class GatewayEmbeddingLogic:
    def embed_query(self, text):
        return self.gateway.embedding('task: search result | query: ' + text)

    def embed_documents(self, texts):
        return [self.gateway.embedding('title: evaluation | text: ' + text) for text in texts]

    async def aembed_query(self, text):
        return self.embed_query(text)

    async def aembed_documents(self, texts):
        return self.embed_documents(texts)


def ragas_adapters(gateway, max_output_tokens=512):
    """Actual RAGAS 0.4.3 bases + LangChain LLMResult, never client factories."""
    import importlib.metadata
    if importlib.metadata.version('ragas') != '0.4.3':
        raise ValueError('Only pinned ragas==0.4.3 is supported')
    from ragas.llms.base import BaseRagasLLM
    from ragas.embeddings.base import BaseRagasEmbeddings
    from ragas.run_config import RunConfig
    from langchain_core.outputs import Generation, LLMResult
    config = RunConfig(max_retries=1, max_workers=1, seed=0)
    class GatewayLLM(GatewayLLMLogic, BaseRagasLLM):
        def __init__(self):
            super().__init__(run_config=config)
            self.gateway, self.max_output_tokens = gateway, max_output_tokens

        @staticmethod
        def make_result(texts):
            return LLMResult(generations=[[Generation(text=text, generation_info={'finish_reason': 'completed'}) for text in texts]])

    class GatewayEmbeddings(GatewayEmbeddingLogic, BaseRagasEmbeddings):
        def __init__(self):
            super().__init__()
            self.gateway = gateway
            self.set_run_config(config)
    return GatewayLLM(), GatewayEmbeddings(), config
