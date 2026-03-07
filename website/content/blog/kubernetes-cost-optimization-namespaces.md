---
title: "Kubernetes Cost Optimization — Namespace-Level Resource Management"
date: 2025-12-20T09:00:00+05:30
description: "Practical techniques for reducing Kubernetes cluster costs through namespace quotas, LimitRanges, and resource right-sizing based on actual usage data."
author: "Gitesh Jawale"
tags: ["Kubernetes", "Cloud Architecture", "Platform Engineering"]
categories: ["Platform Engineering"]
draft: false
---

Cloud Kubernetes bills grow silently. Namespaces accumulate over-provisioned deployments, unused resources stay running, and teams request more than they need because there's no visibility into what anything costs.

This article covers the practical mechanics of namespace-level cost management in Kubernetes — the tooling is less important than getting the fundamentals right.

## The Three Sources of Waste

In every cluster I've worked on, cloud cost waste falls into three categories:

**1. Over-provisioned requests.** Teams set CPU and memory requests high "just to be safe." The cluster schedules based on requests, so a node that looks 90% allocated might be 20% actually utilized.

**2. Idle workloads.** Staging environments, experiment namespaces, and temporary deployments that nobody deleted. They sit there consuming node resources.

**3. Wrong node types.** General-purpose nodes running memory-intensive workloads, or large nodes running tiny workloads that don't pack efficiently.

## Measuring Actual Usage

Before optimizing, measure. The gap between requested resources and actual usage tells you the optimization opportunity:

```bash
# Compare requests vs actual usage per namespace
kubectl top pods --all-namespaces | sort -k4 -rn | head -30

# More detailed: resource requests vs limits vs actual
kubectl get pods --all-namespaces -o json | jq -r '
  .items[] |
  .metadata.namespace + "/" + .metadata.name + " | " +
  (.spec.containers[0].resources.requests.cpu // "none") + " CPU req | " +
  (.spec.containers[0].resources.requests.memory // "none") + " mem req"
' | head -30
```

For production analysis, use Prometheus:

```promql
# CPU request vs actual usage ratio per namespace
sum(kube_pod_container_resource_requests{resource="cpu"}) by (namespace)
/
sum(rate(container_cpu_usage_seconds_total{container!=""}[5m])) by (namespace)
```

A ratio above 3x (requesting 3x more than using) is a clear optimization target.

## ResourceQuotas and LimitRanges

These two objects are the core levers for namespace-level cost control.

### ResourceQuota — hard limits per namespace

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: ai-team-quota
  namespace: ai-platform
spec:
  hard:
    requests.cpu:    "20"
    requests.memory: "40Gi"
    limits.cpu:      "40"
    limits.memory:   "80Gi"
    pods:            "50"
    persistentvolumeclaims: "20"
```

This prevents any namespace from growing beyond defined limits without a quota increase request — which forces a conversation about cost.

### LimitRange — defaults and per-container bounds

```yaml
apiVersion: v1
kind: LimitRange
metadata:
  name: default-limits
  namespace: ai-platform
spec:
  limits:
    - type: Container
      default:          # applied if no limits specified
        cpu:    "500m"
        memory: "512Mi"
      defaultRequest:   # applied if no requests specified
        cpu:    "100m"
        memory: "128Mi"
      max:              # maximum a container can request
        cpu:    "4"
        memory: "8Gi"
      min:
        cpu:    "50m"
        memory: "64Mi"
```

Without LimitRange, containers that don't specify resources get best-effort scheduling — they can consume entire nodes.

## Automated Right-Sizing

Vertical Pod Autoscaler (VPA) in recommendation mode gives you data-driven right-sizing suggestions without automatically changing anything:

```yaml
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata:
  name: payments-service-vpa
  namespace: production
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: payments-service
  updatePolicy:
    updateMode: "Off"   # recommendation only, don't auto-update
```

After a few days, VPA collects usage data:

```bash
kubectl describe vpa payments-service-vpa -n production
```

The output shows target requests based on actual usage — often 40-60% lower than what teams originally set.

## Idle Resource Detection

A simple script to find namespaces with zero activity in the last 7 days:

```bash
# Find pods that haven't had CPU activity
kubectl top pods --all-namespaces | awk '$4 == "0m" {print $1, $2}'

# Find deployments with 0 replicas (but still have PVCs)
kubectl get deployments --all-namespaces -o json | \
  jq -r '.items[] | select(.spec.replicas == 0) |
  .metadata.namespace + "/" + .metadata.name'
```

Build this into a weekly report. Idle namespaces in non-prod environments are the easiest cost reduction — just delete them.

## The Governance Model

Technical tooling only works with a governance model:

1. **Namespace creation requires a quota.** No namespace exists without a ResourceQuota.
2. **Quarterly right-sizing reviews.** Pull VPA recommendations, compare to current requests, update.
3. **Cost visibility per team.** Use namespace labels + Kubecost or OpenCost to show each team their monthly spend.
4. **Chargeback or showback.** Even showback (no actual charge) creates accountability.

The teams that know what they spend are the ones that optimize. The teams that don't know, don't.
