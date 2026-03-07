---
title: "Building a RAG Pipeline for Infrastructure Runbooks"
date: 2026-02-01T09:00:00+05:30
description: "How to build a retrieval-augmented generation system that makes your infrastructure runbooks searchable with natural language — architecture, implementation, and what I learned."
author: "Gitesh Jawale"
tags: ["AI Infrastructure", "Platform Engineering", "SRE"]
categories: ["AI Infrastructure"]
draft: false
mermaid: true
---

Infrastructure runbooks are some of the most valuable documents an engineering team produces — and some of the least accessible. They live in Confluence, Notion, GitHub wikis, and Slack messages. During an incident at 2 AM, finding the right runbook is a task in itself.

A RAG (Retrieval-Augmented Generation) pipeline changes this. Instead of searching, you ask a question and get an answer grounded in your actual runbooks.

This article covers how I built one for my AI SRE Copilot project.

## Architecture Overview

{{< mermaid >}}
flowchart LR
    A[Runbooks\nMarkdown/Confluence] --> B[Document Ingestion]
    B --> C[Text Chunking]
    C --> D[Embedding Model\nnomic-embed-text]
    D --> E[Qdrant Vector DB]
    F[User Query] --> G[Query Embedding]
    G --> H[Semantic Search\nQdrant]
    E --> H
    H --> I[Top-K Chunks]
    I --> J[Context Assembly]
    J --> K[LLM\nqwen2.5:7b]
    K --> L[Grounded Answer]
{{< /mermaid >}}

The pipeline has two phases: **ingestion** (one-time or periodic) and **query** (real-time).

## Document Ingestion

### Chunking Strategy

How you chunk documents matters more than which embedding model you use. My approach:

```python
from langchain.text_splitter import RecursiveCharacterTextSplitter

splitter = RecursiveCharacterTextSplitter(
    chunk_size=512,       # tokens per chunk
    chunk_overlap=64,     # overlap prevents context loss at boundaries
    separators=[
        "\n## ",          # split on h2 headings first
        "\n### ",
        "\n\n",
        "\n",
        " ",
    ]
)

def chunk_runbook(content: str, metadata: dict) -> list[dict]:
    chunks = splitter.split_text(content)
    return [
        {
            "text": chunk,
            "source": metadata["source"],
            "title": metadata["title"],
            "section": extract_section_header(chunk),
        }
        for chunk in chunks
    ]
```

Keep chunks small enough to be specific (512 tokens) but large enough to carry context (don't split mid-sentence on every line).

### Generating Embeddings

I use `nomic-embed-text` via Ollama — it's 274MB, fast, and produces high-quality embeddings for technical text:

```python
import httpx

async def embed(texts: list[str]) -> list[list[float]]:
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            "http://localhost:11434/api/embed",
            json={"model": "nomic-embed-text", "input": texts}
        )
        response.raise_for_status()
        return response.json()["embeddings"]
```

### Storing in Qdrant

```python
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct

client = QdrantClient(host="localhost", port=6333)

# Create collection
client.recreate_collection(
    collection_name="runbooks",
    vectors_config=VectorParams(size=768, distance=Distance.COSINE),
)

# Upsert chunks
def store_chunks(chunks: list[dict], embeddings: list[list[float]]):
    points = [
        PointStruct(
            id=i,
            vector=embeddings[i],
            payload={
                "text":   chunks[i]["text"],
                "source": chunks[i]["source"],
                "title":  chunks[i]["title"],
            }
        )
        for i in range(len(chunks))
    ]
    client.upsert(collection_name="runbooks", points=points)
```

## Query Phase

```python
async def search_runbooks(query: str, top_k: int = 5) -> list[dict]:
    # Embed the query
    query_embedding = (await embed([query]))[0]

    # Search Qdrant
    results = client.search(
        collection_name="runbooks",
        query_vector=query_embedding,
        limit=top_k,
        score_threshold=0.6,  # filter low-relevance results
    )

    return [
        {
            "text":  r.payload["text"],
            "title": r.payload["title"],
            "score": r.score,
        }
        for r in results
    ]

async def answer_question(question: str) -> str:
    # Retrieve relevant chunks
    chunks = await search_runbooks(question)

    if not chunks:
        return "No relevant runbook found for this question."

    # Build context
    context = "\n\n---\n\n".join(
        f"[{c['title']}]\n{c['text']}" for c in chunks
    )

    # Generate answer grounded in retrieved context
    prompt = f"""You are an infrastructure assistant. Answer the question below
using ONLY the provided runbook context. If the context doesn't contain
enough information, say so clearly.

Context:
{context}

Question: {question}

Answer:"""

    return await query_model(prompt)
```

## What I Learned

**Retrieval quality is everything.** If the right chunk isn't retrieved, the LLM can't answer correctly — no matter how capable it is. Spend more time on your chunking and embedding strategy than on your LLM choice.

**Hybrid search helps.** Pure semantic search misses exact matches (pod names, error codes). Adding BM25 keyword search alongside semantic search improves results for technical queries. Qdrant supports hybrid search natively.

**Runbook quality determines answer quality.** Vague runbooks produce vague answers. This is actually a useful forcing function — it surfaces poorly written documentation.

**Score thresholds prevent hallucination.** Setting `score_threshold=0.6` means if no relevant chunk scores above 60% similarity, the system says "I don't know" instead of hallucinating an answer. This is critical for a production tool.

The full implementation is in the [AI SRE Copilot repository](https://github.com/giteshjawale96/ai-sre-copilot).
