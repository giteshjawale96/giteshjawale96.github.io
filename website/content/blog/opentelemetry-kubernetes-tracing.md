---
title: "OpenTelemetry Distributed Tracing in Kubernetes — Getting Started"
date: 2025-07-01T09:00:00+05:30
description: "How to instrument a Python FastAPI service with OpenTelemetry, deploy the Collector in Kubernetes, and send traces to Grafana Tempo."
author: "Gitesh Jawale"
tags: ["Observability", "Kubernetes", "Platform Engineering"]
categories: ["Observability"]
draft: false
---

Logs and metrics tell you what happened. Traces tell you where time was spent and how requests flowed across services. For microservices architectures — and especially for AI pipelines with multiple components — distributed tracing is essential for understanding latency.

This covers a practical OpenTelemetry setup: instrument a Python service, deploy the Collector, send to Grafana Tempo.

## Python Instrumentation

Auto-instrumentation is the fastest way to get started — it adds traces to common libraries (FastAPI, httpx, SQLAlchemy, Redis) without changing application code:

```bash
pip install opentelemetry-distro opentelemetry-exporter-otlp
opentelemetry-bootstrap --action=install
```

Configure via environment variables:

```yaml
# In your Deployment manifest
env:
  - name: OTEL_SERVICE_NAME
    value: "inference-server"
  - name: OTEL_EXPORTER_OTLP_ENDPOINT
    value: "http://otel-collector.monitoring.svc:4317"
  - name: OTEL_TRACES_SAMPLER
    value: "parentbased_traceidratio"
  - name: OTEL_TRACES_SAMPLER_ARG
    value: "0.1"   # sample 10% of traces in production
```

Run with auto-instrumentation:

```dockerfile
CMD ["opentelemetry-instrument", "uvicorn", "main:app", "--host", "0.0.0.0"]
```

## Manual Spans for AI Operations

Auto-instrumentation misses AI-specific operations. Add manual spans for LLM calls and RAG retrieval:

```python
from opentelemetry import trace
from opentelemetry.trace import Status, StatusCode

tracer = trace.get_tracer("inference-server")

async def run_inference(prompt: str, model: str) -> str:
    with tracer.start_as_current_span("llm.inference") as span:
        span.set_attribute("llm.model", model)
        span.set_attribute("llm.prompt_length", len(prompt))

        try:
            result = await ollama_generate(prompt, model)
            span.set_attribute("llm.response_length", len(result))
            span.set_attribute("llm.tokens_estimated", len(result.split()))
            return result
        except Exception as e:
            span.set_status(Status(StatusCode.ERROR, str(e)))
            raise

async def rag_retrieve(query: str) -> list[dict]:
    with tracer.start_as_current_span("rag.retrieval") as span:
        span.set_attribute("rag.query_length", len(query))

        results = await search_qdrant(query)
        span.set_attribute("rag.results_count", len(results))
        span.set_attribute("rag.top_score", results[0]["score"] if results else 0)
        return results
```

## OpenTelemetry Collector in Kubernetes

The Collector receives telemetry from your services, processes it, and forwards to Tempo:

```yaml
# otel-collector-config.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: otel-collector-config
  namespace: monitoring
data:
  config.yaml: |
    receivers:
      otlp:
        protocols:
          grpc:
            endpoint: 0.0.0.0:4317
          http:
            endpoint: 0.0.0.0:4318

    processors:
      batch:
        timeout: 5s
        send_batch_size: 1000
      memory_limiter:
        check_interval: 1s
        limit_mib: 512

    exporters:
      otlp:
        endpoint: tempo.monitoring.svc:4317
        tls:
          insecure: true
      logging:
        loglevel: warn

    service:
      pipelines:
        traces:
          receivers:  [otlp]
          processors: [memory_limiter, batch]
          exporters:  [otlp]
```

## Grafana Tempo Setup

Deploy Tempo with object storage backend:

```yaml
# tempo-values.yaml
tempo:
  storage:
    trace:
      backend: s3
      s3:
        bucket: my-tempo-traces
        region: us-east-1

  retention: 720h  # 30 days

metricsGenerator:
  enabled: true    # generates RED metrics from traces automatically
  remoteWriteUrl: "http://prometheus.monitoring.svc/api/v1/write"
```

The metrics generator is powerful — it derives request rate, error rate, and duration metrics from traces automatically. This gives you RED metrics for every service without additional instrumentation.

## Correlating Traces with Logs

Add trace context to your log output for correlation in Grafana:

```python
import logging
from opentelemetry import trace

class TraceContextFormatter(logging.Formatter):
    def format(self, record):
        span = trace.get_current_span()
        if span.is_recording():
            ctx = span.get_span_context()
            record.trace_id = format(ctx.trace_id, '032x')
            record.span_id  = format(ctx.span_id, '016x')
        else:
            record.trace_id = "0" * 32
            record.span_id  = "0" * 16
        return super().format(record)

# Log format includes trace context
logging.basicConfig(
    format='%(asctime)s %(levelname)s trace_id=%(trace_id)s %(message)s'
)
```

In Grafana, you can then click from a trace span to the correlated log lines — the entire context in one view.

Tracing has the highest setup cost of the three observability signals. It also provides the clearest picture of end-to-end request flow. For AI pipelines where a single user request touches LLM inference, RAG retrieval, a database, and multiple APIs, it's invaluable.
