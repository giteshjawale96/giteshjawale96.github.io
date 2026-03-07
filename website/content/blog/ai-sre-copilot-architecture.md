---
title: "Architecture of the AI SRE Copilot — Design Decisions Explained"
date: 2025-07-15T09:00:00+05:30
description: "A deep dive into the architecture of the AI SRE Copilot — why I chose each component, the design decisions, and what I would do differently."
author: "Gitesh Jawale"
tags: ["AI Infrastructure", "SRE", "Platform Engineering"]
categories: ["AI Infrastructure"]
draft: false
mermaid: true
---

When I started building the AI SRE Copilot, I had a clear problem statement but unclear architecture. Several months in, the design has stabilized. This article explains what I built, why each component exists, and what I learned.

## The Problem Statement (Restated)

SRE engineers spend 40-60% of incident time on information gathering — pulling metrics, querying logs, correlating events. This is pattern-matching and retrieval work, not engineering judgment.

The AI SRE Copilot should handle the information gathering, leaving the engineer to make decisions.

It should answer: *"What is happening in this Kubernetes namespace right now, and what probably caused it?"*

## The Architecture

{{< mermaid >}}
flowchart TD
    subgraph data [Data Collection Layer]
        A[Prometheus Collector]
        B[K8s Events Collector]
        C[Loki Log Collector]
        D[Deployment Tracker]
    end

    subgraph context [Context Assembly Layer]
        E[Signal Aggregator]
        F[Context Builder]
    end

    subgraph knowledge [Knowledge Layer]
        G[Runbooks - Markdown]
        H[Past Incidents - JSON]
        I[nomic-embed-text]
        J[Qdrant Vector DB]
    end

    subgraph reasoning [Reasoning Layer]
        K[RAG Pipeline]
        L[LLM - qwen2.5:7b]
        M[Response Formatter]
    end

    subgraph api [API Layer]
        N[FastAPI Backend]
        O[CLI Interface]
    end

    A --> E
    B --> E
    C --> E
    D --> E
    E --> F
    G --> I
    H --> I
    I --> J
    F --> K
    J --> K
    K --> L
    L --> M
    M --> N
    N --> O
{{< /mermaid >}}

## Layer 1: Data Collection

Four collectors run independently, each with its own retry logic and timeout handling:

**Prometheus Collector** — queries metric ranges for the target namespace. Focuses on: restart rates, memory/CPU utilization ratios, request error rates, and latency percentiles.

**Kubernetes Events Collector** — fetches Warning events from the K8s API. Events are the most direct signal of what went wrong — OOMKill, BackOff, FailedScheduling.

**Loki Log Collector** — retrieves recent error-level logs from the namespace. Uses a structured LogQL query that filters to error patterns.

**Deployment Tracker** — queries Helm release history and ArgoCD sync history to find what changed recently.

**Design decision: parallel collection.** All four collectors run concurrently with `asyncio.gather()`. Total collection time is bounded by the slowest collector (~2s), not the sum.

## Layer 2: Context Assembly

The Signal Aggregator normalizes outputs from all four collectors into a unified event list. The Context Builder selects the most relevant signals — not everything, just the signals that matter.

**Design decision: selective context, not full context.** Early versions passed all available signals to the LLM. The output quality was worse — the model spent tokens on irrelevant information. The current version scores each signal by relevance and passes only the top-15 events.

Relevance scoring (simplified):

```python
def score_signal(signal: TimelineEvent) -> float:
    score = 0.0
    if signal.severity == "critical": score += 3.0
    if signal.severity == "warning":  score += 1.0
    # Recent signals are more relevant
    age_minutes = (datetime.utcnow() - signal.timestamp).seconds / 60
    score *= max(0.1, 1 - (age_minutes / 60))
    return score
```

## Layer 3: Knowledge

The knowledge layer stores runbooks and past incidents as vector embeddings. When a query comes in, the top-5 most relevant knowledge chunks are retrieved and included in the LLM context.

**Design decision: Qdrant over in-memory alternatives.** I considered using numpy for simple vector similarity since the knowledge base is small (~200 documents). Qdrant persists data between restarts and will scale if the knowledge base grows. The operational overhead is minimal.

**Design decision: separate collections per content type.** Runbooks and past incidents are in separate Qdrant collections with different retrieval strategies. Runbooks are retrieved by semantic similarity to the query. Incidents are retrieved by similarity to the current signal pattern.

## Layer 4: Reasoning

The RAG pipeline combines the collected signals (context) with the retrieved knowledge (retrieved) into a structured prompt:

```python
def build_prompt(
    namespace: str,
    signals: list[TimelineEvent],
    runbooks: list[dict],
    past_incidents: list[dict],
) -> str:
    signals_text = format_timeline(signals)
    runbooks_text = format_knowledge(runbooks)
    incidents_text = format_past_incidents(past_incidents)

    return f"""You are an SRE assistant analyzing a Kubernetes namespace.

Current signals for namespace '{namespace}':
{signals_text}

Relevant runbooks:
{runbooks_text}

Similar past incidents:
{incidents_text}

Provide:
1. What is happening (2-3 sentences)
2. Most probable cause (1-2 sentences, grounded in the signals)
3. Immediate action (1-2 steps)
4. Confidence level (high/medium/low) and why

Be concise. Focus on actionable information."""
```

**Design decision: structured output format.** Asking the LLM for free-form analysis produced verbose output. Specifying the four sections consistently produces output that's easier to parse and display.

## What I Would Do Differently

**Start with the output format.** I spent too long on data collection before thinking about what the output should look like. The output format drives every other decision — what signals to collect, what context to include, what the LLM should reason about.

**Use a smaller initial scope.** I tried to support all namespaces from the start. A better first version would analyze one well-understood service end-to-end and get that right before generalizing.

**Instrument the AI layer itself.** I didn't add Prometheus metrics to the AI layer until late. Now I track: query latency, retrieval score distribution, response length, and model selection. This is essential for understanding where the system is failing.

The full code is at [github.com/giteshjawale96/ai-sre-copilot](https://github.com/giteshjawale96/ai-sre-copilot).
