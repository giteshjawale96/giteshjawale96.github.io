---
title: "Kubernetes HPA with Custom Metrics — Beyond CPU Scaling"
date: 2026-01-15T09:00:00+05:30
description: "How to configure Kubernetes Horizontal Pod Autoscaler with custom Prometheus metrics — the setup, common pitfalls, and real examples for queue-based and AI inference workloads."
author: "Gitesh Jawale"
tags: ["Kubernetes", "Observability", "Platform Engineering"]
categories: ["Platform Engineering"]
draft: false
---

CPU-based autoscaling is the default, but it's the wrong signal for most modern workloads. A queue consumer should scale on queue depth. An AI inference service should scale on request latency or pending requests. A batch job should scale on items remaining.

This article covers how to configure Kubernetes HPA with custom Prometheus metrics using the Prometheus Adapter.

## The Stack

You need three components:
- **Prometheus** — scraping your application metrics
- **Prometheus Adapter** — translating Prometheus metrics into the Kubernetes Custom Metrics API
- **HPA** — consuming the Custom Metrics API to make scaling decisions

## Installing Prometheus Adapter

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm install prometheus-adapter prometheus-community/prometheus-adapter \
  --namespace monitoring \
  --set prometheus.url=http://prometheus-server.monitoring.svc \
  --set prometheus.port=80
```

## Configuring Custom Metrics

The adapter needs a rules configuration that maps Prometheus metrics to Kubernetes metric names:

```yaml
# values.yaml for prometheus-adapter
rules:
  custom:
    # Scale on request queue depth
    - seriesQuery: 'http_requests_pending{namespace!="",pod!=""}'
      resources:
        overrides:
          namespace: { resource: namespace }
          pod:       { resource: pod }
      name:
        matches: "http_requests_pending"
        as:      "pending_requests_per_pod"
      metricsQuery: 'avg(<<.Series>>{<<.LabelMatchers>>}) by (<<.GroupBy>>)'

    # Scale on LLM inference queue depth
    - seriesQuery: 'llm_inference_queue_depth{namespace!="",pod!=""}'
      resources:
        overrides:
          namespace: { resource: namespace }
          pod:       { resource: pod }
      name:
        matches: "llm_inference_queue_depth"
        as:      "inference_queue_depth"
      metricsQuery: 'sum(<<.Series>>{<<.LabelMatchers>>}) by (<<.GroupBy>>)'
```

## HPA Configuration

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: inference-server-hpa
  namespace: ai-platform
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: inference-server
  minReplicas: 1
  maxReplicas: 10
  metrics:
    # Primary: scale on queue depth
    - type: Pods
      pods:
        metric:
          name: inference_queue_depth
        target:
          type: AverageValue
          averageValue: "5"   # target 5 pending requests per pod

    # Secondary: don't let latency blow up
    - type: Pods
      pods:
        metric:
          name: llm_p95_latency_seconds
        target:
          type: AverageValue
          averageValue: "10"  # target P95 under 10s per pod

  behavior:
    scaleUp:
      stabilizationWindowSeconds: 60
      policies:
        - type: Pods
          value: 2
          periodSeconds: 60   # add at most 2 pods per minute
    scaleDown:
      stabilizationWindowSeconds: 300  # wait 5 min before scaling down
      policies:
        - type: Pods
          value: 1
          periodSeconds: 120
```

The `stabilizationWindowSeconds` for scale-down is important for AI workloads — model pods take time to load, so you want to avoid flapping.

## Exposing the Right Metrics from Your Application

Your application needs to expose the metric Prometheus can scrape:

```python
from prometheus_client import Gauge

inference_queue_depth = Gauge(
    "llm_inference_queue_depth",
    "Number of inference requests currently queued",
    ["model"],
)

# In your request handler
async def handle_inference_request(request):
    inference_queue_depth.labels(model="qwen2.5-7b").inc()
    try:
        result = await process_inference(request)
        return result
    finally:
        inference_queue_depth.labels(model="qwen2.5-7b").dec()
```

## Verifying It Works

```bash
# Check if the adapter can see your metrics
kubectl get --raw "/apis/custom.metrics.k8s.io/v1beta1" | jq .

# Check specific metric value
kubectl get --raw \
  "/apis/custom.metrics.k8s.io/v1beta1/namespaces/ai-platform/pods/*/inference_queue_depth" \
  | jq .

# Describe the HPA to see current metric values and scaling events
kubectl describe hpa inference-server-hpa -n ai-platform
```

## Common Pitfalls

**Metric not found:** The adapter config series query must exactly match what Prometheus is scraping. Check with `kubectl get --raw "/apis/custom.metrics.k8s.io/v1beta1"`.

**Wrong aggregation:** Using `avg` vs `sum` changes the scaling behavior significantly. For queue depth, use `sum` (total queue across all pods). For latency, use `avg` (average per pod).

**Scale-down too aggressive:** Always set a meaningful `stabilizationWindowSeconds` for scale-down. Default is 300s for scale-down, 0s for scale-up. For AI workloads, I use 600s scale-down to avoid churn.

Custom metrics autoscaling takes more initial effort to configure, but the scaling behavior is dramatically better for any workload where CPU doesn't correlate with load.
