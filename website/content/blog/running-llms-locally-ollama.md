---
title: "Running Local LLMs with Ollama — Practical Setup Guide"
date: 2026-02-10T09:00:00+05:30
description: "How to set up Ollama on a Mac Mini M4, choose the right models for infrastructure automation tasks, and work within the memory constraints of local hardware."
author: "Gitesh Jawale"
tags: ["AI Infrastructure", "Experiments", "Observability"]
categories: ["Experiments"]
draft: false
mermaid: false
---

Running LLMs locally used to mean dealing with complex Python environments, CUDA drivers, and hardware that cost more than a car. Ollama changed that.

This is a practical walkthrough of what I learned setting up Ollama on a Mac Mini M4 for infrastructure automation experiments — model selection, memory constraints, API usage, and honest assessment of what local models are actually good for.

## Why Local LLMs for Infrastructure Work

Before setup details: why bother running locally when OpenAI exists?

Three reasons that matter for infrastructure use cases:

1. **No data leaves your environment.** You can safely pass real Kubernetes configs, log snippets, and metrics data to the model without worrying about sending operational data to a third-party API.
2. **No API costs during development.** Running 500 test queries per day costs $0 locally vs meaningful API spend.
3. **Latency control.** Local inference has predictable latency (hardware-dependent). API latency varies with load.

The tradeoff: local models are smaller and generally less capable than GPT-4 class models.

## Mac Mini M4 Setup

The M4 chip's unified memory architecture makes it excellent for LLM inference. The CPU and GPU share the same memory pool, so a 16GB Mac Mini can run models that need 8-10GB without a discrete GPU.

```bash
# Install Ollama
brew install ollama

# Start the server
ollama serve

# Pull a model (in another terminal)
ollama pull mistral:7b-instruct-q4_K_M
```

That's it. Ollama handles everything else — model download, format conversion, server startup.

## Model Selection

Here's what I tested and what each model is good for on a 16GB Mac Mini:

| Model | Size | Speed | Good for |
|-------|------|-------|----------|
| `phi3:mini` | 2.3GB | Fast | Quick tests, simple tasks |
| `qwen2.5:3b` | 2GB | Fast | Summarization, classification |
| `mistral:7b-instruct-q4_K_M` | 4.1GB | Medium | General agent tasks, reasoning |
| `qwen2.5:7b` | 4.7GB | Medium | Best balance of speed/quality |
| `llama3.2:3b` | 2GB | Fast | Conversational tasks |
| `nomic-embed-text` | 274MB | Very fast | RAG embeddings |

For infrastructure automation specifically, I found `qwen2.5:7b` to be the best balance. It handles structured output (JSON), follows system prompts reliably, and can reason about Kubernetes configs with reasonable accuracy.

## Using the Ollama API

Ollama exposes an HTTP API at `localhost:11434`. You can use it directly:

```python
import httpx
import json

async def query_model(prompt: str, model: str = "qwen2.5:7b") -> str:
    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(
            "http://localhost:11434/api/generate",
            json={
                "model": model,
                "prompt": prompt,
                "stream": False,
                "options": {
                    "temperature": 0.1,  # lower = more deterministic
                    "num_ctx": 4096,     # context window
                }
            }
        )
        response.raise_for_status()
        return response.json()["response"]

# Or use the OpenAI-compatible endpoint
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:11434/v1",
    api_key="ollama",  # any string works
)

response = client.chat.completions.create(
    model="qwen2.5:7b",
    messages=[
        {"role": "system", "content": "You are an infrastructure analysis assistant."},
        {"role": "user", "content": "Analyze this Kubernetes event: OOMKilled on pod payments-v2"}
    ],
    temperature=0.1,
)
```

The OpenAI-compatible endpoint is useful because you can swap between Ollama and OpenAI with a single config change.

## What Local Models Are Actually Good For

After testing across infrastructure tasks, here's my honest assessment:

**Good:**
- Classifying alert severity from description text
- Extracting structured data from log lines
- Summarizing incident descriptions
- Generating boilerplate Kubernetes YAML from a description
- Answering questions about well-documented tools (kubectl, Terraform)

**Mediocre:**
- Multi-step reasoning over complex infrastructure state
- Identifying subtle misconfigurations in YAML
- Generating reliable root cause analysis from correlated signals

**Bad:**
- Tasks requiring up-to-date knowledge (new Kubernetes features, recent CVEs)
- Complex mathematical reasoning (capacity planning calculations)
- Tasks requiring very long context (large log files, full cluster state)

The pattern: local 7B models are good at **classification and extraction**, mediocre at **structured reasoning**, and unreliable at **complex multi-step analysis**.

For my AI SRE Copilot project, I use Ollama for:
- Signal classification (is this alert worth escalating?)
- Log summarization (what are the key error patterns in these 200 log lines?)
- Embedding generation for the RAG pipeline

And I use an API model (or plan to) for:
- Root cause reasoning over correlated signals
- Generating human-readable incident reports

## Memory and Context Window Constraints

The biggest practical constraint on a 16GB Mac Mini:

- Running `qwen2.5:7b` uses ~6GB of unified memory
- Context window is limited to ~4096 tokens by default
- Passing large log files or long Kubernetes configs exhausts the context quickly

Strategies I use:

1. **Summarize before passing to the model.** Don't pass raw 500-line log files. Extract the last 30 error lines first.
2. **Chunk large inputs.** Split a long Kubernetes config into sections and process each separately.
3. **Use smaller models for filtering.** Use `qwen2.5:3b` to filter noise from 100 alerts down to 5 relevant ones, then use the 7B model on those 5.

Local LLMs are not a replacement for GPT-4. They are a fast, private, cost-free tool for the parts of your pipeline that don't require maximum capability.
