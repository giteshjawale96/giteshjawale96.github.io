---
title: "Running AI Workloads on Kubernetes in Production"
date: 2026-02-20T09:00:00+05:30
description: "What changes when your Kubernetes cluster starts running LLM inference workloads — scheduling, resource limits, node pools, and operational challenges."
author: "Gitesh Jawale"
tags: ["Kubernetes", "AI Infrastructure", "Platform Engineering"]
categories: ["AI Infrastructure"]
draft: false
mermaid: false
---

Running a typical microservices workload on Kubernetes is well-understood. You set CPU and memory requests, configure HPA, and the cluster manages itself reasonably well.

AI inference workloads are different. They are memory-hungry, latency-sensitive, GPU-dependent, and they behave in ways that surprise engineers who haven't operated them before.

This article covers the practical differences — what you need to change about your cluster, your scheduling, and your monitoring when AI workloads move in.

## The Resource Model Is Different

With a typical web service, a pod uses predictable CPU and memory across its lifetime. You can right-size it in a week of observation.

With an LLM inference pod:

- Memory usage spikes sharply at model load time (loading weights into GPU/CPU memory)
- Memory stays high throughout the pod's lifetime (the model stays in memory)
- CPU usage is variable and hard to predict based on batch size and sequence length
- Request latency is non-linear — it depends on prompt length, generation length, and concurrent requests

**Practical implication:** Standard HPA (scaling on CPU %) does not work well for LLM inference. You need to scale on custom metrics — queue depth, request latency P95, or GPU memory utilization.

## GPU Scheduling

If you're running GPU inference, you need GPU-capable nodes and proper scheduling:

```yaml
# Node affinity for GPU nodes
affinity:
  nodeAffinity:
    requiredDuringSchedulingIgnoredDuringExecution:
      nodeSelectorTerms:
        - matchExpressions:
            - key: node.kubernetes.io/gpu
              operator: In
              values: ["true"]

# Resource request for GPU
resources:
  limits:
    nvidia.com/gpu: 1
  requests:
    nvidia.com/gpu: 1
```

For CPU-only inference (Ollama, llama.cpp), you instead need memory-optimized nodes and correct memory limits. A Mistral 7B quantized model needs at least 6-8GB RAM. An unquantized 13B model needs 26GB+.

## Separate Node Pools

The most important architectural decision: **do not run AI inference pods on the same node pool as your application workloads**.

Reasons:

- Model loading causes memory spikes that can trigger OOMKill on other pods
- GPU nodes are expensive — you want precise cost attribution
- AI workloads need different autoscaling behavior (scale to zero, slow scale-up)
- Noisy neighbor effects on CPU-intensive inference

```yaml
# Taint your AI node pool
kubectl taint nodes -l node-pool=ai-inference ai-workload=true:NoSchedule

# Toleration in your inference deployment
tolerations:
  - key: "ai-workload"
    operator: "Equal"
    value: "true"
    effect: "NoSchedule"
```

## Health Checks Need Adjustment

Standard readiness probes assume a service starts quickly. An LLM inference server can take 30–120 seconds to load a model into memory.

```yaml
readinessProbe:
  httpGet:
    path: /health
    port: 11434
  initialDelaySeconds: 60   # give the model time to load
  periodSeconds: 10
  failureThreshold: 6

livenessProbe:
  httpGet:
    path: /health
    port: 11434
  initialDelaySeconds: 120
  periodSeconds: 30
```

Adjust `initialDelaySeconds` based on your actual model load time.

## What to Monitor

Beyond standard Kubernetes metrics, you need:

| Metric | Why it matters |
|--------|---------------|
| GPU memory utilization | Predict OOM before it happens |
| Request queue depth | Trigger scaling before latency spikes |
| Time to first token (TTFT) | Primary UX metric for streaming inference |
| Tokens per second | Throughput for batch workloads |
| Model load time | Alert if it exceeds threshold (degraded node) |
| Inference error rate | Model crashes, context length exceeded |

## Key Lessons

1. **Start with CPU inference.** Run Ollama with quantized models before committing to GPU nodes. Many tasks (summarization, classification, embedding) run acceptably on CPU.

2. **Model lifecycle management is infrastructure work.** Pulling a 7GB model file into a pod is not fast. You need init containers, persistent volumes, or pre-loaded node images.

3. **Separate concerns.** Keep inference pods, embedding pods, and orchestration pods in separate deployments with separate resource budgets.

4. **Your SLOs need updating.** P99 latency for an LLM inference endpoint will be 5–30 seconds depending on response length. Traditional SLOs (P99 < 200ms) do not apply.

AI workloads do not break Kubernetes — they expose its assumptions. The cluster still works; you just need to make those assumptions explicit.
