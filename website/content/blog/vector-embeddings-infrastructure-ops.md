---
title: "Vector Embeddings for Infrastructure Operations — Practical Use Cases"
date: 2025-08-20T09:00:00+05:30
description: "Beyond RAG: practical use cases for vector embeddings in infrastructure operations — alert deduplication, incident similarity search, and config anomaly detection."
author: "Gitesh Jawale"
tags: ["AI Infrastructure", "Observability", "SRE"]
categories: ["AI Infrastructure"]
draft: false
---

Vector embeddings are most commonly discussed in the context of RAG — store documents, retrieve relevant ones. But embeddings have broader utility in infrastructure operations that gets less attention.

This article covers three specific use cases I've explored.

## Use Case 1: Alert Deduplication

The problem: an incident fires 15 AlertManager alerts that all describe the same underlying failure. On-call engineers learn to ignore the noise.

Embeddings solve this by grouping alerts by semantic similarity rather than just label matching. Two alerts with different labels but describing the same failure will have high vector similarity.

```python
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct
import asyncio

client = QdrantClient(host="localhost", port=6333)

async def deduplicate_alerts(alerts: list[dict]) -> list[list[dict]]:
    """Group semantically similar alerts together."""
    # Create embeddings for each alert message
    messages = [
        f"{a['alertname']} {a.get('namespace', '')} {a.get('message', '')}"
        for a in alerts
    ]
    embeddings = await embed(messages)

    # Search for similar alerts
    groups = []
    assigned = set()

    for i, (alert, embedding) in enumerate(zip(alerts, embeddings)):
        if i in assigned:
            continue

        # Find all alerts similar to this one
        similar = client.search(
            collection_name="active_alerts",
            query_vector=embedding,
            score_threshold=0.85,
            limit=50,
        )

        group = [alert]
        assigned.add(i)

        for result in similar:
            j = result.payload.get("original_index")
            if j is not None and j not in assigned:
                group.append(alerts[j])
                assigned.add(j)

        groups.append(group)

    return groups
```

In testing on a real cluster workload, this reduced 47 active alerts to 8 incident groups — a 6x reduction in cognitive load for the on-call engineer.

## Use Case 2: Incident Similarity Search

When an incident occurs, the most valuable thing an on-call engineer can know is: "Has this happened before? What did we do?"

If you store past incident reports as embeddings, you can search for similar past incidents at incident start:

```python
async def find_similar_incidents(
    current_incident: str,
    top_k: int = 3,
) -> list[dict]:
    """Find past incidents similar to the current one."""
    embedding = (await embed([current_incident]))[0]

    results = client.search(
        collection_name="past_incidents",
        query_vector=embedding,
        limit=top_k,
        score_threshold=0.7,
        with_payload=True,
    )

    return [
        {
            "date":       r.payload["date"],
            "service":    r.payload["service"],
            "summary":    r.payload["summary"],
            "root_cause": r.payload["root_cause"],
            "resolution": r.payload["resolution"],
            "similarity": r.score,
        }
        for r in results
    ]

# Usage: at incident start
similar = await find_similar_incidents(
    "payments-service OOMKill after deployment, memory spike at 14:31"
)
# Returns: 2 past incidents with same pattern + their resolutions
```

This turns your incident history into a searchable knowledge base without requiring any manual tagging or categorization.

## Use Case 3: Configuration Anomaly Detection

Detect when a new Kubernetes deployment configuration is significantly different from what you normally deploy. This catches configuration drift early — before it causes an incident.

```python
async def check_config_anomaly(
    new_manifest: dict,
    service_name: str,
) -> dict:
    """Check if a new manifest is anomalous compared to historical deployments."""
    # Serialize the manifest to a text representation
    config_text = yaml.dump(new_manifest)
    embedding = (await embed([config_text]))[0]

    # Search for similar past deployments for this service
    similar = client.search(
        collection_name="deployment_history",
        query_vector=embedding,
        query_filter={
            "must": [{"key": "service", "match": {"value": service_name}}]
        },
        limit=10,
    )

    if not similar:
        return {"anomaly": False, "reason": "No history for this service"}

    avg_similarity = sum(r.score for r in similar) / len(similar)

    if avg_similarity < 0.6:
        return {
            "anomaly": True,
            "confidence": 1 - avg_similarity,
            "reason": f"This deployment is significantly different from the last {len(similar)} deployments",
            "avg_historical_similarity": avg_similarity,
        }

    return {"anomaly": False, "avg_similarity": avg_similarity}
```

This doesn't tell you *what* is different — just that something is significantly different from the norm. It's a first-pass filter that flags configurations for human review.

## Embedding Model Choice

For infrastructure text (alert messages, YAML configs, log lines), I've found `nomic-embed-text` (274MB, runs locally) to produce better results than general-purpose embeddings for technical content. It handles Kubernetes-specific terminology and YAML structure well.

For sentence-level similarity (incident descriptions, runbook summaries), `all-MiniLM-L6-v2` from sentence-transformers is also excellent and very fast.

The common theme across all three use cases: embeddings work well for measuring *semantic similarity* across heterogeneous text data, without requiring manual feature engineering or labeling. That's exactly what infrastructure operations data looks like — inconsistently formatted, domain-specific, high volume.
