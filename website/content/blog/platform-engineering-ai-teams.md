---
title: "What Platform Engineering Looks Like for AI Teams"
date: 2026-01-05T09:00:00+05:30
description: "AI teams have different infrastructure needs than traditional software teams. Here is what platform engineering looks like when your users are running LLMs and ML workloads."
author: "Gitesh Jawale"
tags: ["Platform Engineering", "AI Infrastructure", "Kubernetes"]
categories: ["Platform Engineering"]
draft: false
---

Platform engineering for a standard software team is relatively well-defined: CI/CD pipelines, container orchestration, observability stack, secrets management, and a developer portal. The golden path exists.

For AI teams, the golden path doesn't exist yet. The tooling is changing monthly, the infrastructure requirements are different, and the failure modes are unfamiliar.

This is what I've learned about what platform engineering looks like when your internal customers are building LLM applications.

## How AI Teams Are Different From Software Teams

Standard software teams need:
- Stateless compute (pods that start fast and can be replaced)
- Consistent latency (P99 < 200ms is a reasonable target)
- Fast deployment cycles (deploy → test → iterate in minutes)

AI teams need:
- **Stateful model serving** (loading a model takes time; you want warm pods)
- **Variable latency with different SLOs** (inference takes 2-30s; that's expected)
- **Experiment infrastructure** (run 5 different prompt versions simultaneously)
- **Data pipeline access** (embeddings generation, dataset processing)
- **Cost visibility at the workload level** (GPU time is expensive; who's spending what)
- **Model registry and versioning** (which model version is running in prod right now?)

## The Three Platform Layers for AI

I think about AI platform engineering in three layers:

**Layer 1: Infrastructure** — What the AI team's workloads run on
- GPU node pools (when needed) with proper scheduling
- CPU-optimized nodes for inference without GPU requirement
- High-memory nodes for embedding generation and context assembly
- Fast persistent storage for model artifacts

**Layer 2: Services** — Managed services the AI team consumes
- Model serving runtime (Ollama, vLLM, or managed inference API)
- Vector database (Qdrant, Weaviate, or managed option)
- Experiment tracking (MLflow, Weights & Biases)
- Model registry with versioning

**Layer 3: Developer Experience** — How the AI team interacts with the platform
- Self-service model deployment (deploy a new model version with a PR)
- Inference playground (test prompts against different models before coding)
- Cost and quota dashboards (visibility into GPU and API spend)
- Observability pre-wired (every inference request gets traced automatically)

## Self-Service Model Deployment

The highest-value thing a platform team can build for AI teams: a workflow where they can deploy a new model or update a prompt template without filing a ticket.

A simple implementation using GitOps:

```yaml
# ai-models/qwen-7b/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: qwen-7b-inference
  namespace: ai-platform
  annotations:
    platform.io/model: "qwen2.5:7b"
    platform.io/owner: "ai-team"
    platform.io/cost-center: "ai-research"
spec:
  replicas: 2
  template:
    spec:
      containers:
        - name: ollama
          image: ollama/ollama:latest
          env:
            - name: OLLAMA_MODELS
              value: /models
          volumeMounts:
            - name: models
              mountPath: /models
      initContainers:
        - name: pull-model
          image: ollama/ollama:latest
          command: ["ollama", "pull", "qwen2.5:7b"]
```

A PR to change `qwen2.5:7b` to `qwen2.5:14b` triggers a deployment. The platform handles the rest.

## Cost Visibility

GPU compute is expensive. Without cost attribution, you won't know which team or workload is responsible for a $10,000 monthly GPU bill.

Implement namespace-level cost attribution using Kubernetes labels:

```yaml
# Label every AI workload with cost metadata
metadata:
  labels:
    cost-center: "ai-research"
    team: "nlp"
    project: "sre-copilot"
```

Then use these labels in your cost allocation tool (Kubecost, OpenCost, or cloud provider billing tags).

## What the Platform Team Should NOT Build

The hardest part of AI platform engineering is knowing what not to build.

Don't build:
- A custom model training pipeline (use MLflow or Weights & Biases)
- A custom vector database (use Qdrant or Weaviate)
- A custom experiment tracking system (it already exists)
- A bespoke model serving framework (vLLM, Ollama, and TorchServe are better than anything you'll build)

Your value is in **integration and operationalization** — wiring existing tools together into a coherent platform that AI teams can use without becoming infrastructure engineers themselves.

The platform team's job is to make the AI team faster, not to build AI tooling from scratch.
