---
title: "Loki Log Aggregation for Kubernetes — Production Setup"
date: 2025-10-15T09:00:00+05:30
description: "A practical guide to deploying Loki with Promtail in Kubernetes — storage configuration, label design, query patterns, and performance tuning."
author: "Gitesh Jawale"
tags: ["Observability", "Kubernetes", "Platform Engineering"]
categories: ["Observability"]
draft: false
---

Loki's promise is compelling: Prometheus-like log aggregation that integrates natively with Grafana and costs significantly less than Elasticsearch. In practice, it works well — but requires understanding its design philosophy to avoid performance pitfalls.

This article covers a production Loki setup for Kubernetes.

## Loki's Core Concept: Labels Are Not Fields

The most important thing to understand about Loki: **labels are for indexing, log content is not**.

In Elasticsearch, you index every field in your log messages and query them directly. In Loki, you index only the labels (metadata), then search log content with regex at query time.

This means:
- Labels should be low-cardinality (namespace, pod, container, app name)
- High-cardinality data (request IDs, user IDs, trace IDs) stays in the log line
- Log content searches use `|=` (contains) and `|~` (regex match)

Using high-cardinality labels is the #1 performance mistake in Loki deployments.

## Deployment

I use the Helm chart with a simple scalable deployment:

```yaml
# loki-values.yaml
loki:
  auth_enabled: false

  storage:
    type: s3
    s3:
      region: us-east-1
      bucketnames: my-loki-chunks
      s3forcepathstyle: false

  schemaConfig:
    configs:
      - from: "2024-01-01"
        store: tsdb
        object_store: s3
        schema: v13
        index:
          prefix: loki_index_
          period: 24h

  limits_config:
    retention_period: 30d
    ingestion_rate_mb: 10
    ingestion_burst_size_mb: 20
    max_query_parallelism: 32
    max_streams_per_user: 10000

deploymentMode: SimpleScalable

backend:
  replicas: 3

read:
  replicas: 3

write:
  replicas: 3
```

For smaller clusters, `SingleBinary` mode with local storage works well for getting started.

## Promtail Configuration

Promtail runs as a DaemonSet, collecting logs from every node:

```yaml
# promtail-values.yaml
config:
  clients:
    - url: http://loki-gateway.monitoring.svc/loki/api/v1/push

  snippets:
    pipelineStages:
      # Parse JSON logs
      - json:
          expressions:
            level: level
            msg: message
            trace_id: trace_id

      # Set log level as label (low cardinality — only debug/info/warn/error)
      - labels:
          level:

      # Drop debug logs in production to reduce volume
      - match:
          selector: '{level="debug"}'
          stages:
            - drop: {}

      # Parse duration from log messages
      - regex:
          expression: 'duration=(?P<duration>[0-9.]+)ms'
      - metrics:
          http_log_duration_ms:
            type: Histogram
            description: "HTTP request duration from logs"
            source: duration
            config:
              buckets: [10, 50, 100, 500, 1000, 5000]
```

## Label Design

Good label design for Kubernetes:

```yaml
# Keep these labels — low cardinality, high query value
- namespace        # 5-20 values per cluster
- app              # one per application
- container        # one per container name
- node             # one per node (be careful with large clusters)
- level            # debug/info/warn/error

# Do NOT add these as labels — high cardinality
# - pod_name       (changes on every restart)
# - request_id     (unique per request)
# - user_id        (unique per user)
# - session_id     (unique per session)
```

## Query Patterns

```logql
# All errors from a namespace in the last hour
{namespace="payments"} |= "ERROR"

# JSON parsed: find requests taking > 5 seconds
{namespace="payments", app="api"}
  | json
  | duration > 5000

# Count error rate per app (metric query)
sum(rate({namespace="payments"} |= "ERROR" [5m])) by (app)

# Find OOMKill events
{namespace="kube-system"}
  |= "OOMKilling"

# Correlate with trace ID across services
{namespace="payments"} |= "trace_id=abc123"
  or
{namespace="inventory"} |= "trace_id=abc123"
```

## Alerting from Loki

With the Loki ruler, you can alert directly from log queries:

```yaml
groups:
  - name: log_alerts
    rules:
      - alert: HighErrorLogRate
        expr: |
          sum(rate({namespace="payments"} |= "ERROR" [5m])) by (app) > 10
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High error log rate in {{ $labels.app }}"
```

## Performance Tuning

If Loki is slow:

1. **Check your label cardinality.** `loki_ingester_streams_created_total` tells you how many streams exist. Over 100,000 is a problem.

2. **Check query time range.** Loki is fast for recent data (24h), slow for historical queries (30d). Add time range filters.

3. **Avoid leading wildcards.** `|~ ".*ERROR"` is much slower than `|= "ERROR"`. Start with `|=` when possible.

4. **Use chunk caching.** Enable Redis or Memcached for the results cache to speed up repeated queries.

Loki isn't Elasticsearch and isn't trying to be. Used correctly — low-cardinality labels, content search for specifics, native Grafana integration — it's an excellent and cost-effective logging backend for Kubernetes environments.
