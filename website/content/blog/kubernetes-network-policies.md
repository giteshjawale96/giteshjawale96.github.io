---
title: "Kubernetes Network Policies — Zero-Trust Networking in Practice"
date: 2025-09-20T09:00:00+05:30
description: "How to implement zero-trust networking in Kubernetes using NetworkPolicies — from default deny to service-specific allow rules, with practical examples."
author: "Gitesh Jawale"
tags: ["Kubernetes", "Platform Engineering", "Cloud Architecture"]
categories: ["Platform Engineering"]
draft: false
---

By default, Kubernetes allows all traffic between pods — any pod can talk to any other pod across any namespace. This is the wrong default for production.

NetworkPolicies let you enforce zero-trust networking: default deny, explicit allow only. This is security hygiene that also makes your architecture clearer.

## The Default Deny Baseline

Start with a default-deny policy in every namespace:

```yaml
# Apply this to every namespace
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: payments
spec:
  podSelector: {}        # select all pods in namespace
  policyTypes:
    - Ingress
    - Egress
```

This blocks all traffic by default. Now add explicit allows for what needs to communicate.

## Allowing Specific Traffic

### Allow ingress from a specific namespace

```yaml
# Allow ingress to payments from api-gateway namespace only
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-from-api-gateway
  namespace: payments
spec:
  podSelector:
    matchLabels:
      app: payments-service
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: api-gateway
          podSelector:
            matchLabels:
              app: api-gateway
      ports:
        - protocol: TCP
          port: 8080
```

### Allow egress to database

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-db-egress
  namespace: payments
spec:
  podSelector:
    matchLabels:
      app: payments-service
  policyTypes:
    - Egress
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: data
          podSelector:
            matchLabels:
              app: postgres
      ports:
        - protocol: TCP
          port: 5432
```

### Allow DNS resolution (don't forget this)

```yaml
# Without this, pods can't resolve DNS after default-deny
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-dns
  namespace: payments
spec:
  podSelector: {}
  policyTypes:
    - Egress
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
          podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
```

## Monitoring NetworkPolicy Effectiveness

Once you've applied NetworkPolicies, verify they're working:

```bash
# Test connectivity from one pod to another
kubectl exec -n payments payments-pod-xxx -- \
  curl -v --max-time 5 http://inventory-service.inventory.svc.cluster.local

# If blocked, you'll see: Connection timed out
# This is expected behavior for zero-trust

# Check which policies apply to a pod
kubectl describe pod payments-pod-xxx -n payments | grep -A5 "Network"
```

For ongoing visibility, use Cilium's Hubble (if using Cilium CNI) or Calico's flow logs to see which connections are being allowed vs denied.

## Common Pitfalls

**Forgetting DNS egress.** After default deny, pods can't resolve service names. Always add the DNS egress rule.

**Namespace label changes.** If you label namespaces for NetworkPolicy selectors, a label change silently breaks traffic. Use `kubernetes.io/metadata.name` (immutable) rather than custom labels when possible.

**Missing monitoring namespace access.** Prometheus needs to scrape all namespaces. Add an explicit ingress rule allowing Prometheus from the monitoring namespace.

```yaml
# Allow Prometheus scraping in every namespace
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-prometheus-scraping
spec:
  podSelector: {}
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: monitoring
      ports:
        - port: metrics
          protocol: TCP
```

NetworkPolicies require a CNI that supports them (Calico, Cilium, Weave Net). Not all CNIs do — check before assuming they're enforced.

Start with one non-critical namespace, validate connectivity, then roll out default-deny progressively. The blast radius of misconfiguration is too high to apply cluster-wide at once.
