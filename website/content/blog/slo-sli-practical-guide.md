---
title: "SLOs That Engineers Actually Use — A Practical Guide"
date: 2025-09-05T09:00:00+05:30
description: "Most SLO implementations fail because they measure the wrong things or create bureaucracy without improving reliability. Here is how to build SLOs that engineers trust and use."
author: "Gitesh Jawale"
tags: ["SRE", "Observability", "Platform Engineering"]
categories: ["SRE"]
draft: false
---

SLOs (Service Level Objectives) are one of the highest-leverage practices in SRE. They also fail frequently — not because the concept is wrong, but because of poor implementation.

The failure mode: SLOs become a compliance exercise. Numbers get set conservatively to avoid violations. Error budgets aren't used for anything. Nobody looks at SLO dashboards during incidents.

This covers how to build SLOs that engineers actually trust and use.

## Start With User Journey, Not Service Metrics

The biggest mistake: defining SLOs at the infrastructure layer instead of the user experience layer.

**Wrong approach:**
- API server uptime > 99.9%
- Database latency P99 < 50ms
- Queue depth < 1000

These measure internal systems, not user experience.

**Right approach — user journeys:**
- Users can complete checkout within 5 seconds (99th percentile)
- Payment processing succeeds for > 99.5% of attempts
- Search results return within 2 seconds for > 95% of queries

When you alert on error budget burn, you're alerting on actual user impact, not internal metrics.

## Defining SLIs Correctly

A Service Level Indicator (SLI) is a ratio: good events / valid events.

```promql
# SLI: fraction of checkout requests completing successfully under 5s
(
  sum(rate(http_requests_total{
    service="checkout",
    status=~"2..",
    le="5.0"  # if using latency histogram
  }[5m]))
) / (
  sum(rate(http_requests_total{
    service="checkout"
  }[5m]))
)
```

The ratio approach is powerful because it's insensitive to traffic volume changes. An SLI of 0.995 means 99.5% of requests were "good" regardless of whether you had 100 or 100,000 requests.

## Setting SLO Targets

Use historical data, not gut feel:

```bash
# Look at your actual 30-day performance
# In Grafana: set 30d range, check your P99 latency and error rate
# Set your SLO slightly below current performance to create a realistic target

# Example process:
# Current 30d error rate: 0.8%
# Set SLO to: 99% success (1% error budget)
# This gives you room to absorb incidents without constant violation
```

Common starting targets for different service types:
- User-facing APIs: 99.5% availability, P99 < 500ms
- Internal services: 99% availability, P99 < 2s
- Batch jobs: 99% completion, < 10min latency SLO doesn't apply

## Error Budget Policy

The error budget is what makes SLOs useful. Define what happens when you're burning it:

```
Error Budget Policy — Checkout Service

Budget: 0.5% of requests can fail per month
Monthly budget: ~3.6 hours equivalent downtime

When budget remaining > 50%:
  - Normal feature development velocity
  - Deploy with standard review process

When budget remaining 20-50%:
  - Require incident review for all production incidents
  - Deprioritize non-reliability improvements

When budget remaining < 20%:
  - Freeze all non-reliability feature work
  - Require SRE approval for production deployments
  - Weekly reliability review until budget recovers

When budget is exhausted:
  - No new deployments without explicit exception approval
  - Daily reliability war room until recovery
```

The policy makes the error budget actionable. Without a policy, the budget number is just a dashboard metric.

## Prometheus Recording Rules for SLOs

Define recording rules to make SLO queries performant:

```yaml
groups:
  - name: slo_checkout
    interval: 30s
    rules:
      # SLI: success rate
      - record: slo:checkout_success_rate:ratio_rate5m
        expr: |
          sum(rate(http_requests_total{service="checkout", status=~"2.."}[5m]))
          /
          sum(rate(http_requests_total{service="checkout"}[5m]))

      # Error budget burn rate (1h window vs 30d budget)
      - record: slo:checkout_error_budget_burn:1h
        expr: |
          (1 - slo:checkout_success_rate:ratio_rate5m)
          /
          (1 - 0.995)  # target SLO

      # Alert: burn rate > 14x (consumes 5% budget in 1h)
      - alert: CheckoutSLOBudgetBurnHigh
        expr: slo:checkout_error_budget_burn:1h > 14
        for: 2m
        labels:
          severity: critical
          slo: checkout
        annotations:
          summary: "Checkout service burning error budget at {{ $value }}x rate"
          description: "At this rate, budget exhausted in {{ printf \"%.1f\" (720 | divf $value) }} hours"
```

## What Good Looks Like

An SLO implementation is working when:
1. Engineers reference error budget in deployment decisions ("We have 80% budget left, safe to deploy")
2. Incidents trigger budget discussions, not just technical fixes
3. SLO dashboards are checked in incident review, not just post-incident
4. Teams negotiate realistic targets instead of padding them

SLOs create shared language between engineering and product. "We can't deploy this feature this week — we're at 15% error budget" is a conversation that engineering and product can have productively. "The database latency is at 45ms" is not.
