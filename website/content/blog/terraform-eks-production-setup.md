---
title: "Production EKS Cluster Setup with Terraform — What I Actually Use"
date: 2025-12-01T09:00:00+05:30
description: "The Terraform configuration I use for production EKS clusters — node groups, add-ons, IAM roles, and the decisions I made and why."
author: "Gitesh Jawale"
tags: ["Kubernetes", "Cloud Architecture", "Platform Engineering"]
categories: ["Platform Engineering"]
draft: false
---

There are many Terraform EKS tutorials. Most of them show the minimum viable configuration. This one shows what I actually use in production — the add-ons, IAM configuration, node group structure, and the reasoning behind each decision.

## Module Structure

I organize EKS infrastructure as three separate Terraform modules with explicit dependencies:

```
infrastructure/
├── networking/          # VPC, subnets, security groups
├── eks-cluster/         # Control plane, node groups, add-ons
└── eks-addons/          # Helm releases, IRSA roles
```

Separating networking from the cluster means you can update node groups without risk of VPC changes, and vice versa.

## The Cluster

```hcl
module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.0"

  cluster_name    = var.cluster_name
  cluster_version = "1.29"

  cluster_endpoint_public_access       = true
  cluster_endpoint_public_access_cidrs = var.allowed_cidrs

  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets

  # Enable IRSA
  enable_irsa = true

  # Cluster add-ons managed by EKS
  cluster_addons = {
    coredns = {
      most_recent = true
    }
    kube-proxy = {
      most_recent = true
    }
    vpc-cni = {
      most_recent    = true
      before_compute = true  # must be ready before nodes join
    }
    aws-ebs-csi-driver = {
      most_recent              = true
      service_account_role_arn = module.ebs_csi_irsa_role.iam_role_arn
    }
  }

  eks_managed_node_groups = {
    # General workloads — on-demand for reliability
    general = {
      name           = "${var.cluster_name}-general"
      instance_types = ["m6i.xlarge"]
      min_size       = 2
      max_size       = 10
      desired_size   = 3

      labels = {
        role = "general"
      }

      taints = []
    }

    # AI/ML workloads — spot for cost, on-demand fallback
    ai_spot = {
      name           = "${var.cluster_name}-ai-spot"
      instance_types = ["r6i.2xlarge", "r6i.4xlarge", "r6a.2xlarge"]
      capacity_type  = "SPOT"
      min_size       = 0
      max_size       = 5
      desired_size   = 0  # scale from zero

      labels = {
        role      = "ai-inference"
        node-pool = "ai"
      }

      taints = [
        {
          key    = "ai-workload"
          value  = "true"
          effect = "NO_SCHEDULE"
        }
      ]
    }
  }
}
```

## IAM Roles for Service Accounts (IRSA)

Never use node instance profiles for pod-level AWS access. Use IRSA to give pods exactly the IAM permissions they need:

```hcl
# Example: Bedrock access for AI inference pods
module "bedrock_irsa" {
  source = "terraform-aws-modules/iam/aws//modules/iam-role-for-service-accounts-eks"

  role_name = "${var.cluster_name}-bedrock-access"

  oidc_providers = {
    main = {
      provider_arn               = module.eks.oidc_provider_arn
      namespace_service_accounts = ["ai-platform:inference-server"]
    }
  }

  role_policy_arns = {
    policy = aws_iam_policy.bedrock_access.arn
  }
}

resource "aws_iam_policy" "bedrock_access" {
  name = "${var.cluster_name}-bedrock-access"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
        Resource = "arn:aws:bedrock:${var.region}::foundation-model/*"
      }
    ]
  })
}
```

## Cluster Add-ons via Helm

After the cluster is provisioned, I install core add-ons with Helm:

```hcl
resource "helm_release" "cluster_autoscaler" {
  name       = "cluster-autoscaler"
  repository = "https://kubernetes.github.io/autoscaler"
  chart      = "cluster-autoscaler"
  namespace  = "kube-system"
  version    = "9.35.0"

  set {
    name  = "autoDiscovery.clusterName"
    value = var.cluster_name
  }

  set {
    name  = "rbac.serviceAccount.annotations.eks\\.amazonaws\\.com/role-arn"
    value = module.cluster_autoscaler_irsa.iam_role_arn
  }

  set {
    name  = "extraArgs.scale-down-delay-after-add"
    value = "5m"
  }

  set {
    name  = "extraArgs.scale-down-unneeded-time"
    value = "10m"
  }

  depends_on = [module.eks]
}
```

## What I Learned

**Use managed add-ons for core components.** VPC CNI, CoreDNS, kube-proxy — let EKS manage these. The upgrade path is much smoother.

**Separate node groups for different workload types.** Don't put AI workloads on the same node group as API servers. Separate cost centers, separate scaling behavior, separate instance types.

**IRSA everywhere.** The overhead of setting up IRSA is low. The risk of over-permissioned node instance profiles is high.

**Version pin your Helm charts.** `most_recent = true` is convenient but creates drift. In production, pin versions and update deliberately.

**Tag everything.** Add `cost_center`, `environment`, and `team` tags to all resources. You'll thank yourself at billing review time.

This configuration has been stable across several production clusters. The most common change request is adding new node groups for specialized workloads — which is exactly the kind of change that's easy to make with this structure.
