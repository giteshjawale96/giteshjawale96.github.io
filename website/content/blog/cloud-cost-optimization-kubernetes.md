---
title: "Cloud Cost Optimization for Kubernetes — Where the Waste Actually Is"
date: 2025-06-15T09:00:00+05:30
description: "After auditing cloud costs across multiple Kubernetes environments, here are the biggest sources of waste and how to address them systematically."
author: "Gitesh Jawale"
tags: ["Cloud Architecture", "Kubernetes", "Platform Engineering"]
categories: ["Platform Engineering"]
draft: false
---

Cloud cost optimization gets treated as a one-time project. Do the audit, cut the waste, declare victory. Then costs creep back up six months later.

The organizations that sustain cost efficiency treat it as ongoing operations, not a project. This article covers the systematic approach — where waste comes from, how to find it, and how to keep it from returning.

## Where the Money Goes

Based on audits across several environments, the typical breakdown of Kubernetes cloud costs:

| Category | % of total cost | Notes |
|----------|----------------|-------|
| Node compute | 45-60% | Usually the biggest lever |
| Persistent storage | 10-20% | Often forgotten and abandoned |
| Data transfer | 5-15% | Especially cross-AZ traffic |
| Load balancers | 5-10% | Each Service of type LoadBalancer costs money |
| Managed services | 10-20% | RDS, ElastiCache, etc. |

Node compute is usually the largest line item and the most fixable.

## Node Compute Optimization

### Right-size your nodes

The most common waste pattern: too many large nodes running with low utilization.

```bash
# Check actual node utilization
kubectl top nodes

# Cross-reference with requested resources per node
kubectl describe nodes | grep -A5 "Allocated resources"
```

If nodes consistently run at <50% requested resources, you're paying for unused capacity. Options:
- Move to smaller instance types with more of them
- Enable cluster autoscaler and reduce minimum node count
- Use Karpenter (AWS) for more efficient bin-packing

### Spot/Preemptible Instances

Spot instances are 60-80% cheaper than on-demand. They can be interrupted, so use them for:
- Stateless workloads that restart cleanly
- Batch jobs and data processing
- Non-critical or development environments
- AI inference with request queuing (interrupted pod → another pod picks up)

```yaml
# Mixed on-demand (base) + spot (burst) node groups
nodeGroups:
  - name: on-demand-base
    instanceType: m6i.xlarge
    minSize: 2
    maxSize: 4
    capacityType: ON_DEMAND
    labels:
      node-priority: base

  - name: spot-burst
    instanceTypes: [m6i.xlarge, m6i.2xlarge, m5.xlarge, m5.2xlarge]
    minSize: 0
    maxSize: 20
    capacityType: SPOT
    labels:
      node-priority: burst
```

Using multiple instance types in the spot pool reduces interruption risk — if one type is unavailable, the autoscaler uses another.

## Storage Waste

Storage is invisible until the bill arrives.

Common storage waste:
- PersistentVolumes orphaned when workloads were deleted
- Snapshots accumulating indefinitely
- Oversized volumes that were never resized down

```bash
# Find PVCs not bound to any pod (orphaned)
kubectl get pvc --all-namespaces | grep -v Bound

# Find PVs in Released state (unbound)
kubectl get pv | grep Released

# Find old snapshots (AWS)
aws ec2 describe-snapshots --owner-ids self \
  --query 'Snapshots[?StartTime<=`2025-01-01`].[SnapshotId,StartTime,VolumeSize]' \
  --output table
```

Implement a PVC cleanup policy: automatically delete PVCs in non-production namespaces that haven't been used in 30 days.

## Data Transfer Costs

Cross-availability-zone traffic is charged in AWS and other clouds. In a multi-AZ cluster, pod-to-pod traffic that crosses AZs is billed.

Solutions:
1. **Topology-aware routing** — prefer routing traffic to pods in the same AZ:

```yaml
apiVersion: v1
kind: Service
metadata:
  annotations:
    service.kubernetes.io/topology-mode: Auto
```

2. **Affinity rules** — run dependent services in the same AZ:

```yaml
affinity:
  podAffinity:
    preferredDuringSchedulingIgnoredDuringExecution:
      - weight: 100
        podAffinityTerm:
          labelSelector:
            matchLabels:
              app: payments-db
          topologyKey: topology.kubernetes.io/zone
```

Data transfer savings vary by architecture, but teams with heavy microservices communication often see 15-25% reduction in data transfer costs.

## Load Balancer Proliferation

Every `Service` of type `LoadBalancer` creates a cloud load balancer that costs ~$20-30/month minimum. In clusters with many teams, these multiply.

Consolidate with an ingress controller:
- One NLB/ALB for the ingress controller
- All services behind it use `ClusterIP` + Ingress rules
- Net result: 1 load balancer instead of 20

## The Governance Layer

Technical solutions work for known waste. Governance prevents new waste from accumulating:

1. **Budget alerts.** Set AWS Budget alerts at 80% and 100% of monthly target. Team leads get notified, not just finance.

2. **Namespace cost reports.** Weekly Slack message to each team showing their namespace cost vs previous week. Visibility creates accountability.

3. **Resource quota enforcement.** No namespace without a ResourceQuota. Teams can request increases with justification.

4. **Quarterly cleanup sprints.** One day per quarter where teams audit their namespace for unused resources.

Cost optimization without governance is a one-time fix. With governance, it's a sustained practice.
