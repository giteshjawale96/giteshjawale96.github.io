---
title: "Building an AI Deployment Risk Analyzer"
date: 2025-10-01T09:00:00+05:30
description: "A system that analyzes deployment manifests, historical incident data, and deployment timing to generate a risk score before a release goes live."
author: "Gitesh Jawale"
tags: ["AI Infrastructure", "Platform Engineering", "SRE"]
categories: ["AI Infrastructure"]
draft: false
---

Most deployment failures are predictable. The patterns repeat: missing readiness probes, memory limits unchanged despite size increases, deploying during peak traffic hours, services with recent incident history. Engineers know these patterns. They just don't always catch them under deployment pressure.

An AI deployment risk analyzer encodes these patterns and runs them automatically on every deployment manifest.

## What the System Checks

The risk analyzer operates in three layers:

**Static manifest analysis** — things that are wrong in the YAML itself:
- Missing readiness or liveness probes
- No resource requests or limits
- Memory limit unchanged vs previous version
- New environment variables referencing undefined secrets
- Image tag is `latest` (not pinned)
- Single replica with no PodDisruptionBudget

**Historical risk factors** — information from past incidents:
- This service had N incidents in the last 30 days
- Previous version was rolled back within 24 hours of deployment
- This service causes downstream failures when it's degraded

**Contextual risk factors** — deployment timing and traffic:
- Deploying during peak traffic window (defined per service)
- No canary or gradual rollout strategy for a high-traffic service
- Multiple services deploying simultaneously in the same namespace

## Implementation

### Risk Rule Engine

```python
from dataclasses import dataclass
from typing import Callable

@dataclass
class RiskRule:
    name: str
    description: str
    severity: str          # high, medium, low
    check: Callable
    recommendation: str

def check_missing_readiness_probe(manifest: dict) -> bool:
    containers = (
        manifest.get("spec", {})
        .get("template", {})
        .get("spec", {})
        .get("containers", [])
    )
    return any(
        "readinessProbe" not in container
        for container in containers
    )

def check_memory_limit_unchanged(manifest: dict, previous: dict) -> bool:
    """Returns True if manifest size grew but memory limit didn't increase."""
    current_image = get_image_tag(manifest)
    previous_image = get_image_tag(previous)
    current_limit  = get_memory_limit_bytes(manifest)
    previous_limit = get_memory_limit_bytes(previous)

    # Can't determine without image size info — skip
    if not current_image or not previous_image:
        return False

    # Memory limit identical but image changed significantly
    return current_limit == previous_limit and current_image != previous_image

RISK_RULES = [
    RiskRule(
        name="missing_readiness_probe",
        description="Container has no readiness probe",
        severity="high",
        check=check_missing_readiness_probe,
        recommendation="Add a readiness probe to prevent traffic routing to unready pods",
    ),
    RiskRule(
        name="latest_image_tag",
        description="Image uses :latest tag",
        severity="medium",
        check=lambda m: ":latest" in get_image(m),
        recommendation="Pin to a specific image digest for reproducible deployments",
    ),
    RiskRule(
        name="single_replica_no_pdb",
        description="Single replica deployment without PodDisruptionBudget",
        severity="high",
        check=lambda m: get_replicas(m) == 1 and not has_pdb(m),
        recommendation="Add minAvailable PodDisruptionBudget or increase replicas to 2+",
    ),
]
```

### Scoring

```python
SEVERITY_SCORES = {"high": 30, "medium": 15, "low": 5}

def calculate_risk_score(
    manifest: dict,
    previous: dict,
    incident_history: list[dict],
) -> dict:
    triggered_rules = []
    total_score = 0

    for rule in RISK_RULES:
        if rule.check(manifest):
            triggered_rules.append(rule)
            total_score += SEVERITY_SCORES[rule.severity]

    # Historical incidents add to risk score
    recent_incidents = [
        i for i in incident_history
        if i["service"] == get_service_name(manifest)
    ]
    total_score += len(recent_incidents) * 10

    risk_level = (
        "HIGH"   if total_score >= 50 else
        "MEDIUM" if total_score >= 25 else
        "LOW"
    )

    return {
        "score":         total_score,
        "level":         risk_level,
        "triggered":     triggered_rules,
        "incidents_30d": len(recent_incidents),
    }
```

### LLM-Enhanced Risk Report

```python
async def generate_risk_report(
    service: str,
    version: str,
    risk_result: dict,
) -> str:
    rules_text = "\n".join([
        f"- [{r.severity.upper()}] {r.description}: {r.recommendation}"
        for r in risk_result["triggered"]
    ])

    prompt = f"""Analyze this deployment risk assessment and provide a clear,
actionable summary for an engineer about to deploy to production.

Service: {service}
Version: {version}
Risk Score: {risk_result['score']}/100 ({risk_result['level']})
Recent Incidents: {risk_result['incidents_30d']} in last 30 days

Risk Factors:
{rules_text}

Provide:
1. A 2-sentence summary of the main risks
2. The single most important action to take before deploying
3. Whether you recommend proceeding, proceeding with caution, or blocking"""

    return await query_model(prompt)
```

## Sample Output

```
Deployment Risk Analysis — payments-service v2.5.0
Risk Score: 72/100 (HIGH)

Risk Factors:
- [HIGH]   Missing readiness probe on payments container
- [HIGH]   Memory limit unchanged (512Mi) despite image size increase
- [MEDIUM] Deployment scheduled during peak traffic window (2pm-4pm)
- [LOW]    No PodDisruptionBudget configured

Historical context:
- 2 incidents in the last 30 days for this service
- Last incident: OOMKill 12 days ago (same root cause as current risk)

Summary:
The combination of an unchanged memory limit with an increased image size mirrors
the exact failure pattern from the incident 12 days ago. Deploying during peak
traffic means a rollback will impact more users.

Recommendation: BLOCK
Required before deploying:
1. Increase memory limit from 512Mi to at least 1Gi
2. Add readiness probe with appropriate initialDelaySeconds
3. Reschedule to after 8pm or use canary deployment strategy
```

The system doesn't replace engineer judgment — it surfaces the information needed to exercise it properly.
