---
title: "GitOps with ArgoCD — Practical Setup for Platform Teams"
date: 2025-11-20T09:00:00+05:30
description: "How to set up ArgoCD for a multi-team Kubernetes environment — app of apps pattern, RBAC, sync policies, and what to watch out for."
author: "Gitesh Jawale"
tags: ["Kubernetes", "Platform Engineering", "Cloud Architecture"]
categories: ["Platform Engineering"]
draft: false
---

GitOps with ArgoCD is one of those things that looks simple in the docs and becomes complex in production. The core concept is straightforward — Git is the source of truth, ArgoCD reconciles the cluster to match it. The complexity is in the structure, access control, and sync behavior.

This covers the practical setup for a multi-team environment.

## Repository Structure

The most important decision is how you structure your Git repositories. I use the **app-of-apps pattern** with a dedicated platform repo:

```
platform-gitops/
├── bootstrap/
│   └── argocd-apps.yaml        # Root app that manages all other apps
├── platform/
│   ├── monitoring/             # Prometheus, Grafana, Loki
│   ├── ingress/                # Nginx ingress, cert-manager
│   ├── autoscaler/             # Cluster autoscaler
│   └── argocd/                 # ArgoCD self-management
└── teams/
    ├── ai-platform/            # AI team's apps
    ├── payments/               # Payments team's apps
    └── data/                   # Data team's apps
```

Each team has their own application repository. The platform repo contains ArgoCD `Application` manifests that point to team repos:

```yaml
# teams/ai-platform/inference-server.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: inference-server
  namespace: argocd
  finalizers:
    - resources-finalizer.argocd.io
spec:
  project: ai-platform
  source:
    repoURL: https://github.com/org/ai-platform-apps
    targetRevision: main
    path: kubernetes/inference-server
  destination:
    server: https://kubernetes.default.svc
    namespace: ai-platform
  syncPolicy:
    automated:
      prune: true        # delete resources removed from git
      selfHeal: true     # revert manual kubectl changes
    syncOptions:
      - CreateNamespace=true
      - PrunePropagationPolicy=foreground
```

## AppProject for Multi-Team RBAC

`AppProject` isolates teams from each other. Each team can only deploy to their namespaces and only from their repositories:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: AppProject
metadata:
  name: ai-platform
  namespace: argocd
spec:
  description: "AI Platform Team Applications"

  # Which repos are allowed as sources
  sourceRepos:
    - "https://github.com/org/ai-platform-apps"
    - "https://github.com/org/helm-charts"

  # Which clusters and namespaces can be deployed to
  destinations:
    - namespace: ai-platform
      server: https://kubernetes.default.svc
    - namespace: ai-platform-staging
      server: https://kubernetes.default.svc

  # Deny cluster-level resources (platform team manages those)
  clusterResourceWhitelist: []

  # Allow all namespace-scoped resources
  namespaceResourceWhitelist:
    - group: "*"
      kind: "*"

  # Team RBAC
  roles:
    - name: team-deployer
      policies:
        - p, proj:ai-platform:team-deployer, applications, sync, ai-platform/*, allow
        - p, proj:ai-platform:team-deployer, applications, get, ai-platform/*, allow
      groups:
        - ai-platform-team
```

## Sync Policies — Automated vs Manual

**Automated sync** (with `selfHeal: true`) is the ideal GitOps state — any drift from Git is automatically corrected. Use it for:
- Applications where the deployment process is well-tested
- Non-critical environments (staging, dev)
- Workloads where unintended configuration changes are a risk

**Manual sync** is appropriate for:
- Production database schema changes
- Workloads with complex rollback requirements
- Changes that require human verification before applying

I use automated sync everywhere except for stateful workloads in production.

## Health Checks and Rollback

ArgoCD uses resource health checks to determine if a sync was successful. For custom resources, you may need to add health check scripts:

```yaml
# argocd-cm ConfigMap
data:
  resource.customizations.health.inference.io_InferenceServer: |
    hs = {}
    if obj.status ~= nil then
      if obj.status.phase == "Running" then
        hs.status = "Healthy"
      elseif obj.status.phase == "Failed" then
        hs.status = "Degraded"
        hs.message = obj.status.message
      else
        hs.status = "Progressing"
      end
    end
    return hs
```

For rollback on failure, combine ArgoCD sync waves with health checks:

```yaml
metadata:
  annotations:
    argocd.argoproj.io/sync-wave: "2"    # deploy after wave 1 resources
    argocd.argoproj.io/hook: PostSync
    argocd.argoproj.io/hook-delete-policy: HookSucceeded
```

## What to Watch Out For

**Prune + selfHeal in production is dangerous without testing.** If there's a bug in your Git repo (a missing file, a bad merge), ArgoCD will delete the corresponding production resources. Test automated sync in staging first.

**Secrets in Git.** Don't store Kubernetes Secrets in Git, even encrypted. Use External Secrets Operator with your secrets manager (AWS Secrets Manager, Vault) and store references in Git instead.

**Resource ignoring differences.** Some controllers modify resources after creation (adding annotations, defaulting fields). Use `ignoreDifferences` to prevent ArgoCD from constantly trying to revert them:

```yaml
spec:
  ignoreDifferences:
    - group: apps
      kind: Deployment
      jsonPointers:
        - /spec/replicas  # ignore if HPA is managing replicas
```

GitOps with ArgoCD removes the "what's actually deployed" ambiguity that plagues teams managing Kubernetes manually. That clarity is worth the setup complexity.
