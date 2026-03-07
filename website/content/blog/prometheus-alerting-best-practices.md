---
title: "Prometheus Alerting — Rules That Actually Work"
date: 2025-11-10T09:00:00+05:30
description: "Most Prometheus alert rules are wrong. They alert on the wrong signals, at the wrong thresholds, and without enough context. Here is how to write alerts that are actually useful."
author: "Gitesh Jawale"
tags: ["Observability", "SRE", "Kubernetes"]
categories: ["Observability"]
draft: false
---

Bad alerting is worse than no alerting. A team that receives 200 alerts per day and ignores most of them is in a worse position than a team with 10 alerts that all mean something.

Most Prometheus alert rule libraries are a starting point, not a finished product. This covers the principles I use to write alert rules that have a good signal-to-noise ratio.

## Alert on Symptoms, Not Causes

The most common mistake: alerting on the cause of a problem rather than the impact on users.

**Wrong (cause-based):**
```yaml
- alert: HighCPU
  expr: container_cpu_usage_seconds_total > 0.8
  for: 5m
```

**Right (symptom-based):**
```yaml
- alert: HighErrorRate
  expr: |
    sum(rate(http_requests_total{status=~"5.."}[5m])) by (service)
    /
    sum(rate(http_requests_total[5m])) by (service)
    > 0.05
  for: 5m
  labels:
    severity: critical
  annotations:
    summary: "{{ $labels.service }} error rate > 5%"
    description: "Current error rate: {{ $value | humanizePercentage }}"
    runbook: "https://runbooks.internal/high-error-rate"
```

High CPU is a cause. Users receiving errors is a symptom. Alert on the symptom.

## The Four Golden Signals

Structure your alerting around the four golden signals:

| Signal | Prometheus metric approach |
|--------|---------------------------|
| Latency | `histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[5m]))` |
| Traffic | `sum(rate(http_requests_total[5m]))` |
| Errors | `rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m])` |
| Saturation | `container_memory_working_set_bytes / kube_pod_container_resource_limits{resource="memory"}` |

Every critical service should have alerts on all four.

## Practical Alert Rules

### SLO-Based Latency Alert

```yaml
- alert: HighP99Latency
  expr: |
    histogram_quantile(
      0.99,
      sum(rate(http_request_duration_seconds_bucket{job="payments-api"}[5m])) by (le)
    ) > 2.0
  for: 10m
  labels:
    severity: warning
    team: payments
  annotations:
    summary: "Payments API P99 latency > 2s"
    description: "P99 latency is {{ $value | humanizeDuration }} (threshold: 2s)"
    dashboard: "https://grafana.internal/d/payments-latency"
    runbook: "https://runbooks.internal/payments-latency"
```

### Pod Restart Loop

```yaml
- alert: PodCrashLooping
  expr: |
    increase(kube_pod_container_status_restarts_total[1h]) > 5
  for: 0m
  labels:
    severity: critical
  annotations:
    summary: "Pod {{ $labels.namespace }}/{{ $labels.pod }} is crash looping"
    description: "{{ $value }} restarts in the last hour"
```

### Memory Pressure (before OOMKill, not after)

```yaml
- alert: PodMemoryPressure
  expr: |
    (
      container_memory_working_set_bytes{container!=""}
      / on(namespace, pod, container)
      kube_pod_container_resource_limits{resource="memory"}
    ) > 0.85
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "Container {{ $labels.container }} using > 85% memory limit"
    description: "Memory: {{ $value | humanizePercentage }} of limit"
```

### Node Not Ready

```yaml
- alert: NodeNotReady
  expr: kube_node_status_condition{condition="Ready",status="true"} == 0
  for: 5m
  labels:
    severity: critical
  annotations:
    summary: "Node {{ $labels.node }} is not ready"
```

## Adding Runbook Links

Every production alert should have a `runbook` annotation. Engineers should never receive an alert and not know what to do:

```yaml
annotations:
  summary: "Short description of what is happening"
  description: "Detailed context with metric values: {{ $value }}"
  runbook: "https://runbooks.internal/alert-name"
  dashboard: "https://grafana.internal/d/relevant-dashboard"
```

Even a 3-bullet runbook is better than nothing:
1. What does this alert mean?
2. How do I verify it?
3. What should I do first?

## Testing Alert Rules

Test your alert rules before they fire in production:

```bash
# Unit test with promtool
cat > alerts_test.yaml << EOF
rule_files:
  - alerts.yaml
tests:
  - interval: 1m
    input_series:
      - series: 'http_requests_total{status="500", service="payments"}'
        values: '0 10 20 30 40 50'
      - series: 'http_requests_total{status="200", service="payments"}'
        values: '100 100 100 100 100 100'
    alert_rule_test:
      - eval_time: 5m
        alertname: HighErrorRate
        exp_alerts:
          - exp_labels:
              severity: critical
              service: payments
EOF

promtool test rules alerts_test.yaml
```

## The Alerting Philosophy

Three questions to ask about every alert before adding it to production:

1. **Is this actionable?** Can an on-call engineer do something about it right now?
2. **Is the threshold meaningful?** Is it tied to an SLO or user impact, or is it arbitrary?
3. **Is the context sufficient?** Does the alert message tell the engineer what they need to know?

If any answer is "no," fix the alert before adding it. Every alert that fires unnecessarily erodes trust in your monitoring system.
