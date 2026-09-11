"""Local semantic retrieval. SQLite owns text, Qdrant is a disposable RAM index."""
import asyncio
import hashlib
import re
import uuid

from app.services.ai_provider import AIProviderError, ai_provider

MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"


def redact(text: str) -> str:
    text = re.sub(r"[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}", "[контакт исключён]", text)
    return re.sub(r"(?:\+7|8)[\s()\-\d]{9,}", "[телефон исключён]", text).strip()


class KnowledgeIndex:
    def __init__(self):
        self.lock = asyncio.Lock()
        self.model = None
        self.client = None
        self.fingerprints = {}

    def _load(self):
        from fastembed import TextEmbedding
        from qdrant_client import QdrantClient, models

        if self.model is None:
            self.model = TextEmbedding(MODEL, cache_dir=str(ai_provider._data_dir() / "embedding-models"), threads=2)
        if self.client is None:
            self.client = QdrantClient(":memory:")
            self.client.create_collection("materials", vectors_config=models.VectorParams(size=384, distance=models.Distance.COSINE))

    async def load(self):
        async with self.lock:
            try:
                await asyncio.to_thread(self._load)
            except Exception as exc:
                raise AIProviderError("Не удалось загрузить модель поиска. Проверьте интернет и свободное место; повторите подготовку поиска.") from exc

    def _search(self, query, documents):
        from qdrant_client import models

        allowed = {item["id"] for item in documents}
        # Remove deleted/unselected material before each query, so it cannot leak across sessions.
        for doc_id in set(self.fingerprints) - allowed:
            self.client.delete("materials", models.FilterSelector(filter=models.Filter(must=[models.FieldCondition(key="doc_id", match=models.MatchValue(value=doc_id))])))
            del self.fingerprints[doc_id]
        for doc in documents:
            digest = hashlib.sha256(doc["text"].encode()).hexdigest()
            if self.fingerprints.get(doc["id"]) == digest:
                continue
            self.client.delete("materials", models.FilterSelector(filter=models.Filter(must=[models.FieldCondition(key="doc_id", match=models.MatchValue(value=doc["id"]))])))
            chunks = [doc["text"][i:i + 1000] for i in range(0, len(doc["text"]), 850)]
            vectors = list(self.model.embed(chunks))
            self.client.upsert("materials", [models.PointStruct(id=str(uuid.uuid5(uuid.NAMESPACE_URL, f"{doc['id']}:{i}")), vector=v.tolist(), payload={"doc_id": doc["id"], "text": chunk, "chunk": i + 1}) for i, (chunk, v) in enumerate(zip(chunks, vectors, strict=True))])
            self.fingerprints[doc["id"]] = digest
        if not documents:
            return []
        vector = next(iter(self.model.query_embed(query))).tolist()
        hits = self.client.query_points("materials", query=vector, limit=5, score_threshold=0.2).points
        by_id = {doc["id"]: doc for doc in documents}
        return [{**by_id[hit.payload["doc_id"]], "text": hit.payload["text"], "chunk": hit.payload["chunk"], "score": round(hit.score, 3)} for hit in hits if hit.payload["doc_id"] in by_id]

    async def search(self, query, documents):
        if not documents:
            return []
        async with self.lock:
            if self.model is None or self.client is None:
                raise AIProviderError("В разделе «Подготовка» нажмите «Подготовить поиск» один раз перед использованием материалов.")
            return await asyncio.to_thread(self._search, query, documents)

    async def clear(self):
        async with self.lock:
            if self.client:
                await asyncio.to_thread(self.client.close)
            self.client = None
            self.fingerprints.clear()


knowledge = KnowledgeIndex()
