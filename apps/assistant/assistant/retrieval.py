"""Retrieval for the assistant (the "R" of RAG), as a LangChain retriever.

The Help Center search itself is knowledge.py (keywords + meaning, on this server). This wraps it in
LangChain's retriever interface, so the conversation graph retrieves the articles for a question
*before* the AI answers and gives them to it as the only source for product, process and policy facts.
That is one AI round fewer than letting the AI search first, and it means the AI never answers a
"how do I / is it covered / how much" question without the company's own words in front of it.
"""
from __future__ import annotations

from typing import Any, Callable, List, Optional, Sequence

from langchain_core.callbacks import CallbackManagerForRetrieverRun
from langchain_core.documents import Document
from langchain_core.retrievers import BaseRetriever
from pydantic import ConfigDict

from .knowledge import Hit

# what goes to the AI per question: a few excerpts, each cut to a sensible length
TOP_K = 3
EXCERPT_CHARS = 1200


class HelpRetriever(BaseRetriever):
    """The company's published Help Center articles that match a question, as LangChain Documents.

    `search` is the index lookup for this person (customer or staff view): (query, limit) -> hits.
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)

    search: Callable[[str, int], Sequence[Hit]]
    k: int = TOP_K

    def _get_relevant_documents(self, query: str, *, run_manager: CallbackManagerForRetrieverRun) -> List[Document]:
        if not query.strip():
            return []
        docs = []
        for h in self.search(query, self.k):
            docs.append(Document(page_content=h.chunk.text, metadata={
                "article_id": h.chunk.article_id, "title": h.chunk.title, "category": h.chunk.category,
                "audience": h.chunk.audience, "score": h.score,
                # matched by its words (exact terms, names, Roman Urdu keywords) and/or by meaning
                "keyword_rank": h.keyword_rank, "meaning_rank": h.meaning_rank,
            }))
        return docs


def retriever_for(tool: Any) -> Optional[HelpRetriever]:
    """The retriever behind a search_help tool (None when this person has no Help Center tool)."""
    hits = getattr(tool, "hits", None)
    return HelpRetriever(search=lambda q, k: hits(q, limit=k)) if callable(hits) else None


def format_excerpts(docs: Sequence[Document]) -> str:
    """The excerpts as the AI sees them, numbered, each with its article's exact title."""
    parts = []
    for n, d in enumerate(docs, 1):
        text = d.page_content if len(d.page_content) <= EXCERPT_CHARS else d.page_content[:EXCERPT_CHARS] + " ..."
        parts.append(f"[{n}] {d.metadata.get('title', '')} ({str(d.metadata.get('category', '')).lower()})\n{text}")
    return "\n\n".join(parts)
