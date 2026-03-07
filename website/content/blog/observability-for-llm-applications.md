---
title: "Observability for LLM Applications — What Metrics Actually Matter"
date: 2026-01-25T09:00:00+05:30
description: "Standard Prometheus metrics are not enough for LLM-powered applications. Here are the specific metrics, dashboards, and alerting strategies you need."
author: "Gitesh Jawale"
tags: ["Observability", "AI Infrastructure", "SRE"]
categories: ["Observability"]
draft: false
---

Standard Prometheus dashboards show CPU, memory, request rate, and error rate. For most applications, this is sufficient. For LLM applications, it's not enough — and the gaps will surprise you during an incident.

This article covers the specific observability requirements for LLM-powered applications, organized by what breaks most often and how you detect it.

## The New Failure Modes

LLM applications introduce failure modes that traditional monitoring doesn't capture:

| Failure mode | Traditional monitoring catches it? |
|---|---|
| Pod OOMKill (model too large) | Yes |
| Inference API timeout (slow generation) | Partially — only if you alert on P99 |
| Context length exceeded | No |
| Model producing garbage output | No |
| Embedding drift (RAG quality degradation) | No |
| Prompt injection causing unexpected behavior | No |
| Token budget exhaustion (API cost spike) | No |

You need new signals for the bottom half of this table.

## Tier 1: Infrastructure Metrics (standard, just extend them)

Extend your existing Prometheus stack with these additional metrics:

```python
from prometheus_client import Histogram, Counter, Gauge

# Inference latency — more granular than standard HTTP metrics
inference_duration = Histogram(
    "llm_inference_duration_seconds",
    "Time from request to complete response",
    ["model", "endpoint"],
    buckets=[0.5, 1, 2, 5, 10, 20, 30, 60],  # LLM-appropriate buckets
)

time_to_first_token = Histogram(
    "llm_ttft_seconds",
    "Time to first token for streaming responses",
    ["model"],
    buckets=[0.1, 0.25, 0.5, 1, 2, 5],
)

# Token usage
tokens_used = Counter(
    "llm_tokens_total",
    "Total tokens consumed",
    ["model", "type"],  # type: prompt, completion
)

# Context window utilization
context_utilization = Histogram(
    "llm_context_utilization_ratio",
    "Fraction of context window used (0-1)",
    ["model"],
    buckets=[0.1, 0.25, 0.5, 0.7, 0.85, 0.95, 1.0],
)
```

## Tier 2: Application-Level Metrics

Beyond infrastructure, you need application-level signals:

```python
# RAG retrieval quality
retrieval_score = Histogram(
    "rag_retrieval_score",
    "Semantic similarity score of retrieved chunks",
    ["collection"],
    buckets=[0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
)

retrieval_empty = Counter(
    "rag_retrieval_empty_total",
    "Queries that returned no results above threshold",
    ["collection"],
)

# LLM response quality signals (simple heuristics)
response_too_short = Counter(
    "llm_response_too_short_total",
    "Responses shorter than minimum threshold",
    ["model", "endpoint"],
)

response_refusal = Counter(
    "llm_response_refusal_total",
    "Model refused to answer or said it doesn't know",
    ["model", "endpoint"],
)
```

## Key Dashboards

### Dashboard 1: Inference Performance

Panels:
- P50/P95/P99 inference latency (time series)
- Time to first token P95 (time series)
- Tokens/second throughput (gauge)
- Context utilization distribution (heatmap)
- Request rate and error rate

### Dashboard 2: RAG Pipeline Health

Panels:
- Retrieval score distribution (histogram)
- Empty retrieval rate (% of queries with no results)
- Embedding store size over time
- Time since last ingestion

### Dashboard 3: Cost and Usage

Panels:
- Token consumption rate (prompts vs completions)
- Projected monthly cost (tokens × price per token)
- Cost per operation type (alert analysis, summarization, etc.)
- Top consumers by endpoint

## Alerting

```yaml
groups:
  - name: llm_infrastructure
    rules:
      - alert: LLMHighLatency
        expr: histogram_quantile(0.95, rate(llm_inference_duration_seconds_bucket[5m])) > 30
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "LLM inference P95 latency > 30s"

      - alert: RAGRetrievalDegraded
        expr: rate(rag_retrieval_empty_total[10m]) / rate(llm_inference_duration_seconds_count[10m]) > 0.2
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "More than 20% of RAG queries returning no results"

      - alert: HighContextUtilization
        expr: histogram_quantile(0.90, rate(llm_context_utilization_ratio_bucket[10m])) > 0.9
        for: 15m
        labels:
          severity: info
        annotations:
          summary: "Context window consistently over 90% full — consider increasing chunk limits or summarizing inputs"
```

## What Standard SRE Metrics Miss

Two signals that I found critically important but don't fit neatly into Prometheus:

**1. Output quality degradation.** A model can return HTTP 200 with garbage output. The only way to detect this systematically is to run lightweight quality checks on outputs (minimum length, format validation, keyword presence checks) and log failures as metrics.

**2. Prompt regression.** When you update a prompt template, downstream quality can change in ways that don't show up in latency or error rates. You need an evals framework (even a simple one) that runs on a fixed test set before and after prompt changes.

Observability for LLM applications is a superset of traditional SRE monitoring — you still need all the infrastructure signals, you just need more of them.
