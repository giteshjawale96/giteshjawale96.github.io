---
title: "AI-Generated Incident Timelines — Building the Investigation Engine"
date: 2025-10-28T09:00:00+05:30
description: "How I built a system that automatically generates incident timelines by correlating Kubernetes events, deployment history, and metric anomalies."
author: "Gitesh Jawale"
tags: ["SRE", "AI Infrastructure", "Observability"]
categories: ["AI + SRE"]
draft: false
mermaid: true
---

Incident postmortems have a problem: the timeline section is almost always incomplete.

Engineers reconstruct what happened from memory, Slack messages, and whatever was visible in dashboards at the time. Important events get missed. The sequence is sometimes wrong. Valuable signal gets lost because nobody thought to look at it during the incident.

An automated timeline builder changes this. This article covers how I built one.

## The Data Sources

A complete incident timeline requires correlation across at least four data sources:

{{< mermaid >}}
flowchart TD
    A[Prometheus\nMetric anomalies] --> E[Timeline Builder]
    B[Kubernetes Events API\nOOMKills, scheduling, restarts] --> E
    C[Loki\nApplication logs] --> E
    D[Deployment History\nArgoCD/Helm] --> E
    E --> F[Chronological\nIncident Timeline]
    F --> G[LLM Analysis\nProbable cause]
{{< /mermaid >}}

Each source gives a different view of the same failure:
- **Prometheus:** When metrics crossed thresholds
- **K8s Events:** Pod lifecycle events (scheduling, OOMKill, restarts)
- **Loki:** Application errors that preceded the failure
- **Deployment history:** What changed before the incident

## Collecting the Timeline Events

```python
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

@dataclass
class TimelineEvent:
    timestamp: datetime
    source: str           # prometheus, k8s-events, loki, deployment
    severity: str         # critical, warning, info
    description: str
    metadata: dict

async def build_incident_timeline(
    namespace: str,
    start_time: datetime,
    end_time: datetime,
) -> list[TimelineEvent]:
    events = []

    # Collect from all sources in parallel
    k8s_events, metric_anomalies, log_errors, deployments = await asyncio.gather(
        collect_k8s_events(namespace, start_time, end_time),
        collect_metric_anomalies(namespace, start_time, end_time),
        collect_log_errors(namespace, start_time, end_time),
        collect_deployments(namespace, start_time, end_time),
    )

    events.extend(k8s_events)
    events.extend(metric_anomalies)
    events.extend(log_errors)
    events.extend(deployments)

    # Sort chronologically
    return sorted(events, key=lambda e: e.timestamp)
```

## Kubernetes Events Collector

```python
async def collect_k8s_events(
    namespace: str,
    start_time: datetime,
    end_time: datetime,
) -> list[TimelineEvent]:
    v1 = client.CoreV1Api()
    events = v1.list_namespaced_event(
        namespace=namespace,
        field_selector="type=Warning",
    )

    timeline_events = []
    for event in events.items:
        event_time = event.last_timestamp
        if not event_time:
            continue
        ts = event_time.replace(tzinfo=None)
        if not (start_time <= ts <= end_time):
            continue

        severity = "critical" if event.reason in ["OOMKilling", "BackOff", "Failed"] else "warning"

        timeline_events.append(TimelineEvent(
            timestamp=ts,
            source="k8s-events",
            severity=severity,
            description=f"{event.reason}: {event.message}",
            metadata={
                "object": event.involved_object.name,
                "kind":   event.involved_object.kind,
                "count":  event.count,
            }
        ))

    return timeline_events
```

## Prometheus Anomaly Detection

Instead of looking for threshold breaches, I detect when metrics changed significantly from their recent baseline:

```python
async def collect_metric_anomalies(
    namespace: str,
    start_time: datetime,
    end_time: datetime,
) -> list[TimelineEvent]:
    queries = [
        (
            f'rate(kube_pod_container_status_restarts_total{{namespace="{namespace}"}}[5m])',
            "Restart rate spike",
            "critical"
        ),
        (
            f'container_memory_working_set_bytes{{namespace="{namespace}"}} / '
            f'kube_pod_container_resource_limits{{namespace="{namespace}", resource="memory"}}',
            "Memory pressure",
            "warning"
        ),
    ]

    anomalies = []
    for query, label, severity in queries:
        results = await prometheus_query_range(query, start_time, end_time)
        for series in results:
            # Find points that deviate significantly from baseline
            values = [(float(t), float(v)) for t, v in series["values"]]
            baseline = statistics.mean([v for _, v in values[:10]])  # first 10 as baseline

            for ts, value in values:
                if value > baseline * 3 and value > 0.1:  # 3x spike threshold
                    anomalies.append(TimelineEvent(
                        timestamp=datetime.fromtimestamp(ts),
                        source="prometheus",
                        severity=severity,
                        description=f"{label}: {value:.2f} (baseline: {baseline:.2f})",
                        metadata={"metric": query, "labels": series["metric"]}
                    ))
                    break  # first anomaly point per series

    return anomalies
```

## Generating the LLM Analysis

Once the timeline is built, pass it to an LLM for probable cause analysis:

```python
async def analyze_timeline(events: list[TimelineEvent]) -> str:
    # Format the timeline for the LLM
    timeline_text = "\n".join([
        f"[{e.timestamp.strftime('%H:%M:%S')}] [{e.severity.upper()}] [{e.source}] {e.description}"
        for e in events
    ])

    prompt = f"""You are an SRE analyzing an incident timeline.
Review the following events in chronological order and:
1. Identify the most probable root cause
2. Explain the failure sequence (what happened, in what order)
3. Suggest immediate remediation steps

Timeline:
{timeline_text}

Analysis:"""

    return await query_model(prompt, model="qwen2.5:7b")
```

## Sample Output

```
Incident Timeline — 2026-03-08 14:28 UTC to 14:45 UTC
Namespace: payments

14:28:03  [INFO]      [deployment]    payments-service v2.4.1 deployed
14:28:45  [WARNING]   [prometheus]    Memory pressure: 0.78 (baseline: 0.42)
14:31:12  [WARNING]   [prometheus]    Memory pressure: 0.94 (baseline: 0.42)
14:31:58  [CRITICAL]  [k8s-events]    OOMKilling: Container payments exceeded memory limit
14:32:01  [CRITICAL]  [k8s-events]    BackOff: restarting failed container
14:32:15  [WARNING]   [loki]          java.lang.OutOfMemoryError: Java heap space (×12)
14:32:44  [CRITICAL]  [k8s-events]    OOMKilling: Container payments exceeded memory limit (×3)

Root cause analysis:
The deployment of payments-service v2.4.1 at 14:28 caused a sustained increase in
memory consumption. Memory utilization rose from 42% to 94% of the container limit
over approximately 3 minutes, culminating in OOMKill at 14:31. The application logs
confirm Java heap exhaustion. The new version likely increased heap usage without
a corresponding increase in the memory limit.

Immediate actions:
1. Roll back to payments-service v2.4.0
2. Increase memory limit from 512Mi to 1Gi before re-deploying v2.4.1
3. Add memory profiling to the CI pipeline for Java services
```

The complete system turns a 90-minute manual timeline reconstruction into a 30-second automated report.
