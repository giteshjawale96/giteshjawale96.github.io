---
title: "Secrets Management in Kubernetes — Don't Store Secrets in Git"
date: 2025-08-05T09:00:00+05:30
description: "Why Kubernetes Secrets are not really secret, and how to use External Secrets Operator with AWS Secrets Manager or HashiCorp Vault to do secrets management properly."
author: "Gitesh Jawale"
tags: ["Kubernetes", "Platform Engineering", "Cloud Architecture"]
categories: ["Platform Engineering"]
draft: false
---

Kubernetes Secrets are base64-encoded, not encrypted. By default, they're stored in etcd in plaintext. Any engineer with `kubectl get secret` access can read them. And most teams store them in Git.

This is not secure secrets management. Here is how to do it properly.

## The Problem with Native Kubernetes Secrets

```bash
# This is all it takes to read a "secret"
kubectl get secret my-secret -o jsonpath='{.data.password}' | base64 -d
```

The issues:
1. **etcd stores them in plaintext** (unless you enable encryption at rest)
2. **RBAC for secrets is coarse-grained** — you either have access to a namespace's secrets or you don't
3. **Rotation requires redeployment** — updating a secret doesn't automatically update running pods
4. **No audit trail** — who accessed which secret and when?

## The Right Pattern: External Secrets Operator

External Secrets Operator (ESO) creates a bridge between Kubernetes and real secrets managers (AWS Secrets Manager, Vault, GCP Secret Manager). Secrets never live in Git — only *references* to secrets do.

```
AWS Secrets Manager / Vault
         |
External Secrets Operator
         |
Kubernetes Secret (created dynamically, auto-rotated)
         |
Your Pod
```

## Setup with AWS Secrets Manager

```bash
helm repo add external-secrets https://charts.external-secrets.io
helm install external-secrets external-secrets/external-secrets \
  --namespace external-secrets \
  --create-namespace \
  --set installCRDs=true
```

Configure the SecretStore (per namespace, using IRSA):

```yaml
apiVersion: external-secrets.io/v1beta1
kind: SecretStore
metadata:
  name: aws-secretsmanager
  namespace: payments
spec:
  provider:
    aws:
      service: SecretsManager
      region: us-east-1
      auth:
        jwt:
          serviceAccountRef:
            name: external-secrets-sa  # IRSA-annotated service account
```

Create an ExternalSecret that maps AWS secrets to Kubernetes secrets:

```yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: payments-db-credentials
  namespace: payments
spec:
  refreshInterval: 1h          # auto-rotate every hour
  secretStoreRef:
    name: aws-secretsmanager
    kind: SecretStore
  target:
    name: payments-db-credentials  # Kubernetes Secret name created
    creationPolicy: Owner
  data:
    - secretKey: DB_PASSWORD       # key in the Kubernetes Secret
      remoteRef:
        key: payments/production/db  # path in AWS Secrets Manager
        property: password
    - secretKey: DB_USERNAME
      remoteRef:
        key: payments/production/db
        property: username
```

The Kubernetes Secret is created automatically. When the AWS secret rotates, ESO updates the Kubernetes Secret within `refreshInterval`. Your pod consumes it as a normal Kubernetes Secret.

## What Goes in Git

With ESO, Git contains only references — never values:

```
✅ In Git:   ExternalSecret manifest (references the AWS path)
✅ In Git:   SecretStore manifest (references the region and auth method)
❌ Not in Git: The actual secret values
❌ Not in Git: Kubernetes Secret manifests with base64 data
```

## Secret Rotation without Redeployment

Enable automatic pod restart on secret rotation:

```yaml
# Add this annotation to your deployment
annotations:
  reloader.stakater.com/auto: "true"
```

Install Stakater Reloader:

```bash
helm install reloader stakater/reloader --namespace kube-system
```

Now when ESO rotates a secret (after detecting an AWS Secrets Manager rotation), the pods automatically restart with the new value. Zero manual intervention.

## Vault Integration

For teams using HashiCorp Vault:

```yaml
apiVersion: external-secrets.io/v1beta1
kind: SecretStore
metadata:
  name: vault-backend
  namespace: payments
spec:
  provider:
    vault:
      server: "https://vault.internal:8200"
      path: "secret"
      version: "v2"
      auth:
        kubernetes:
          mountPath: "kubernetes"
          role: "payments-role"
```

Vault's Kubernetes auth method uses the pod's ServiceAccount token for authentication — no static credentials needed.

## Audit Trail

With AWS Secrets Manager, every access is logged in CloudTrail. With Vault, every access is logged in Vault audit logs. This gives you the audit trail that native Kubernetes Secrets don't provide.

The setup cost of External Secrets Operator is 2-4 hours. The alternative — secrets in Git or plaintext in etcd — is a security debt that compounds over time.
