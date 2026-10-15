"""The Help Center, searchable: what the assistant knows about using the product, fixing problems, the
company's processes and its policies (written in the console, served by the API).

Search is hybrid, on this server, no outside service:
  * keywords (Okapi BM25): exact words, names, error messages, Roman Urdu tags
  * meaning (a small multilingual embedding model, run with ONNX): "invite my wife" finds "add a family
    member", Urdu script finds English articles
  ranked together with reciprocal rank fusion. If the embedding model can't load, keywords still work.

Articles are split into chunks of a few paragraphs, each carrying its article's title, so a long
article's answer is found without sending the whole article to the AI.
"""
from __future__ import annotations

import logging
import math
import re
import threading
from collections import Counter
from dataclasses import dataclass
from typing import Callable, Dict, List, Optional, Sequence

log = logging.getLogger(__name__)

EMBED_MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
CHUNK_WORDS = 220
CATEGORY_WORDS = {
    "USAGE": "how to use", "TROUBLESHOOTING": "troubleshooting problem fix", "PROCESS": "process steps",
    "POLICY": "policy", "FAQ": "question answer",
}

# words that carry no meaning for search (English + Roman Urdu)
STOP = set("""
a an the and or but if of to in on at for with by from as is are was were be been being it its this that these those
i me my we our you your he she they them their what which who whom how why when where can could would should will
do does did done have has had not no yes so than then there here just also very more most some any all each
please kya kia hai hain ho hota hoti tha thi ka ki ke ko se mein me main par per aur ya bhi to toh na nahi
""".split())

Embedder = Callable[[Sequence[str]], List[List[float]]]


@dataclass(frozen=True)
class Chunk:
    article_id: str
    title: str
    category: str
    audience: str
    text: str


@dataclass(frozen=True)
class Hit:
    chunk: Chunk
    score: float
    keyword_rank: Optional[int]
    meaning_rank: Optional[int]


def tokens(text: str) -> List[str]:
    """Lowercase words in any script (Latin and Urdu), without stop words; crude plural folding."""
    words = re.findall(r"[\w']+", text.lower())
    out = []
    for w in words:
        w = w.strip("'")
        if len(w) < 2 or w in STOP:
            continue
        if len(w) > 4 and w.endswith("s") and not w.endswith("ss"):
            w = w[:-1]
        out.append(w)
    return out


def split_article(article: dict) -> List[Chunk]:
    """Paragraph-aligned chunks of about CHUNK_WORDS words; each starts with the article's title."""
    title = article["title"].strip()
    tags = ", ".join(article.get("tags") or [])
    head = f"{title}\n" + (f"Keywords: {tags}\n" if tags else "")
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", article.get("body") or "") if p.strip()]
    chunks: List[str] = []
    current: List[str] = []
    count = 0
    for p in paragraphs:
        n = len(p.split())
        if current and count + n > CHUNK_WORDS:
            chunks.append("\n\n".join(current))
            # carry the section heading into the next chunk, so it isn't read out of context
            heading = next((x for x in reversed(current) if x.startswith("#")), None)
            current, count = ([heading] if heading and heading != current[-1] else []), 0
        current.append(p)
        count += n
    if current:
        chunks.append("\n\n".join(current))
    if not chunks:
        chunks = [""]
    return [Chunk(article["id"], title, article.get("category", ""), article.get("audience", "EVERYONE"), head + body)
            for body in chunks]


class _Bm25:
    def __init__(self, docs: List[List[str]], k1: float = 1.4, b: float = 0.75) -> None:
        self.docs = [Counter(d) for d in docs]
        self.lengths = [len(d) for d in docs]
        self.avg = (sum(self.lengths) / len(docs)) if docs else 0
        df: Counter = Counter()
        for d in self.docs:
            df.update(d.keys())
        n = len(docs)
        self.idf = {t: math.log(1 + (n - f + 0.5) / (f + 0.5)) for t, f in df.items()}
        self.k1, self.b = k1, b

    def scores(self, query: List[str]) -> List[float]:
        out = []
        for d, length in zip(self.docs, self.lengths):
            s = 0.0
            for t in set(query):
                f = d.get(t)
                if f:
                    s += self.idf[t] * f * (self.k1 + 1) / (f + self.k1 * (1 - self.b + self.b * length / (self.avg or 1)))
            out.append(s)
        return out


def _normalise(v: List[float]) -> List[float]:
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / n for x in v]


class Index:
    """The searchable form of one company's published articles (for one audience)."""

    def __init__(self, articles: List[dict], embed: Optional[Embedder]) -> None:
        self.chunks: List[Chunk] = [c for a in articles for c in split_article(a)]
        self._bm25 = _Bm25([tokens(c.text + " " + CATEGORY_WORDS.get(c.category, "")) for c in self.chunks])
        self._vectors: Optional[List[List[float]]] = None
        if embed and self.chunks:
            try:
                self._vectors = [_normalise(v) for v in embed([c.text for c in self.chunks])]
            except Exception:  # noqa: BLE001 - keywords alone still work
                log.exception("Could not embed the help articles; searching by keywords only")
        self._embed = embed

    def search(self, query: str, limit: int = 4, fused_k: int = 60) -> List[Hit]:
        if not self.chunks or not query.strip():
            return []
        kw = self._bm25.scores(tokens(query))
        kw_order = [i for i in sorted(range(len(kw)), key=lambda i: -kw[i]) if kw[i] > 0]
        mean_order: List[int] = []
        sims: List[float] = []
        if self._vectors is not None and self._embed:
            try:
                q = _normalise(self._embed([query])[0])
                sims = [sum(a * b for a, b in zip(q, v)) for v in self._vectors]
                mean_order = [i for i in sorted(range(len(sims)), key=lambda i: -sims[i]) if sims[i] > 0.2]
            except Exception:  # noqa: BLE001
                log.exception("Embedding the question failed; keywords only")
        # reciprocal rank fusion: good in either list is good
        fused: Dict[int, float] = {}
        kw_rank = {i: r for r, i in enumerate(kw_order)}
        mean_rank = {i: r for r, i in enumerate(mean_order)}
        for i in set(kw_rank) | set(mean_rank):
            fused[i] = sum(1 / (fused_k + r + 1) for r in (kw_rank.get(i), mean_rank.get(i)) if r is not None)
        ranked = sorted(fused, key=lambda i: -fused[i])
        hits: List[Hit] = []
        seen_articles: Counter = Counter()
        for i in ranked:
            c = self.chunks[i]
            if seen_articles[c.article_id] >= 2:      # at most two chunks of one article: room for others
                continue
            seen_articles[c.article_id] += 1
            hits.append(Hit(c, fused[i], kw_rank.get(i), mean_rank.get(i)))
            if len(hits) == limit:
                break
        return hits


class KnowledgeBase:
    """Indexes per (company, audience) version key, rebuilt only when the Help Center changes."""

    def __init__(self, embed: Optional[Embedder] = None, max_indexes: int = 16) -> None:
        self._embed = embed
        self._indexes: Dict[str, Index] = {}
        self._lock = threading.Lock()
        self._max = max_indexes

    def index(self, key: str, load: Callable[[], List[dict]]) -> Index:
        with self._lock:
            found = self._indexes.get(key)
        if found is not None:
            return found
        built = Index(load(), self._embed)
        with self._lock:
            if len(self._indexes) >= self._max:
                self._indexes.pop(next(iter(self._indexes)))
            self._indexes[key] = built
        log.info("Help Center indexed: %d chunks (%s)", len(built.chunks), key.split(":")[1] if ":" in key else key)
        return built


def local_embedder(model: str = EMBED_MODEL) -> Optional[Embedder]:
    """The multilingual embedding model on ONNX Runtime (downloaded once, then cached). None if unavailable."""
    try:
        from fastembed import TextEmbedding
    except ImportError:
        log.warning("fastembed is not installed: help search uses keywords only")
        return None
    holder: Dict[str, object] = {}
    lock = threading.Lock()

    def embed(texts: Sequence[str]) -> List[List[float]]:
        with lock:
            if "m" not in holder:
                log.info("Loading the embedding model %s ...", model)
                holder["m"] = TextEmbedding(model)
        return [list(map(float, v)) for v in holder["m"].embed(list(texts))]  # type: ignore[attr-defined]

    return embed
