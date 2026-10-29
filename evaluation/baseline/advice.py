"""Validated, local prepared information. No diagnosis or language understanding."""
import copy
import json
from pathlib import Path
import re
import unicodedata
from urllib.parse import urlparse


class CatalogueError(ValueError):
    pass


def normalize(text):
    text = unicodedata.normalize("NFKC", text).casefold()
    return " ".join(re.findall(r"[^\W_]+", text, flags=re.UNICODE))


def _object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise CatalogueError("Duplicate catalogue key")
        value[key] = item
    return value


def load_catalogue(path=None):
    """Fail closed for the entire catalogue; never serve a partial document."""
    try:
        data = json.loads(Path(path or Path(__file__).with_name("advice.json")).read_text(encoding="utf-8"),
                          object_pairs_hook=_object)
        validate(data)
        return data
    except (ValueError, TypeError, KeyError, OSError, UnicodeError, RecursionError) as exc:
        raise CatalogueError("Invalid advice catalogue") from exc


def validate(data):
    def require(condition):
        if not condition:
            raise CatalogueError("Invalid advice schema")

    def text(value):
        require(isinstance(value, str) and bool(value.strip()))
        value.encode("utf-8")

    def answer(value, fallback=False):
        require(isinstance(value, dict) and set(value) == {
            "id", "title", "paragraphs", "urgency", "sources", "related_question_ids"
        } | (set() if fallback else {"question", "priority", "rules"}))
        text(value["title"])
        require(value["urgency"] in ({"unknown"} if fallback else {"routine", "urgent", "emergency"}))
        require(isinstance(value["paragraphs"], list) and bool(value["paragraphs"]))
        for paragraph in value["paragraphs"]:
            text(paragraph)
        require(isinstance(value["sources"], list) and bool(value["sources"]))
        for source in value["sources"]:
            require(isinstance(source, dict) and set(source) == {"title", "url"})
            text(source["title"])
            text(source["url"])
            url = urlparse(source["url"])
            require(url.scheme == "https" and url.netloc in {"www.cdc.gov", "www.nhs.uk", "www.fda.gov"}
                    and bool(url.path) and not url.fragment and not url.query)
        require(isinstance(value["related_question_ids"], list))
        require(all(isinstance(item, str) for item in value["related_question_ids"]))
        require(len(set(value["related_question_ids"])) == len(value["related_question_ids"]))
        if fallback:
            require(value["id"] is None)
            return
        text(value["id"])
        require(re.fullmatch(r"[a-z][a-z0-9_]{0,63}", value["id"]) is not None)
        text(value["question"])
        require(type(value["priority"]) is int and value["priority"] ==
                {"routine": 10, "urgent": 20, "emergency": 30}[value["urgency"]])
        require(isinstance(value["rules"], list) and bool(value["rules"]))
        for rule in value["rules"]:
            require(isinstance(rule, list) and bool(rule))
            for phrase in rule:
                text(phrase)
                require(bool(normalize(phrase)))

    required = {"version", "disclaimer", "safety_notice", "questions", "fallback"}
    require(isinstance(data, dict) and required <= set(data) <= required | {"presentation"})
    require(type(data["version"]) is int and data["version"] == 1)
    text(data["disclaimer"])
    text(data["safety_notice"])
    require(isinstance(data["questions"], list) and bool(data["questions"]))
    for entry in data["questions"]:
        answer(entry)
    ids = [entry["id"] for entry in data["questions"]]
    require(len(ids) == len(set(ids)))
    require(len({normalize(entry["question"]) for entry in data["questions"]}) == len(ids))
    if "presentation" in data:
        presentation = data["presentation"]
        require(isinstance(presentation, dict) and set(presentation) == {
            "summary", "lens_action", "triage", "caution", "topics"})

        def bounded(value, maximum):
            text(value)
            require(len(value) <= maximum)
            require(not any(ord(c) < 32 and c not in "\t\n\r" or ord(c) == 127 for c in value))

        for key in ("summary", "lens_action", "caution"):
            bounded(presentation[key], 500)
        triage = presentation["triage"]
        require(isinstance(triage, list) and len(triage) == 2)
        levels = []
        for item in triage:
            require(isinstance(item, dict) and set(item) == {"level", "title", "text"})
            require(item["level"] in ("emergency", "urgent"))
            levels.append(item["level"])
            bounded(item["title"], 80)
            bounded(item["text"], 1000)
        require(len(set(levels)) == 2)
        topics = presentation["topics"]
        require(isinstance(topics, list) and 1 <= len(topics) <= 4)
        topic_ids = []
        for item in topics:
            require(isinstance(item, dict) and set(item) == {"id", "label"})
            bounded(item["id"], 128)
            require(item["id"] in ids)
            topic_ids.append(item["id"])
            bounded(item["label"], 80)
        require(len(set(topic_ids)) == len(topic_ids))
    answer(data["fallback"], fallback=True)
    for entry in [*data["questions"], data["fallback"]]:
        require(set(entry["related_question_ids"]) <= set(ids))
        require(entry["id"] not in entry["related_question_ids"])


def catalogue(data):
    result = {"version": data["version"], "disclaimer": data["disclaimer"],
              "safety_notice": data["safety_notice"],
              "questions": [{"id": item["id"], "question": item["question"]} for item in data["questions"]]}
    if "presentation" in data:
        result["presentation"] = copy.deepcopy(data["presentation"])
    return result


def prepared(data, entry, matched):
    result = {key: copy.deepcopy(entry[key]) for key in
              ("id", "title", "paragraphs", "urgency", "sources", "related_question_ids")}
    return dict(result, version=data["version"], matched=matched)


def answer_id(data, question_id):
    for entry in data["questions"]:
        if entry["id"] == question_id:
            return prepared(data, entry, True)
    raise KeyError(question_id)


def answer_message(data, message):
    """Boundary phrases for symptoms; exact routine prompts only.

    Does not interpret negation, tense, or context. Safety phrases intentionally
    remain conservative even when negated. Ambiguous routine text falls back.
    """
    normalized = normalize(message)
    padded = " " + normalized + " "
    matches = []
    for entry in data["questions"]:
        if entry["urgency"] == "routine":
            hit = normalized == normalize(entry["question"]) or any(
                len(rule) == 1 and normalized == normalize(rule[0]) for rule in entry["rules"])
        else:
            hit = any(all(" " + normalize(phrase) + " " in padded for phrase in rule)
                      for rule in entry["rules"])
        if hit:
            matches.append(entry)
    if matches:
        highest = max(entry["priority"] for entry in matches)
        winners = [entry for entry in matches if entry["priority"] == highest]
        if highest > 10 or len(winners) == 1:
            return prepared(data, winners[0], True)
    return prepared(data, data["fallback"], False)
