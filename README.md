# Gitesh Jawale — Personal Technical Blog

Personal blog and portfolio for **Gitesh Jawale**, AI Infrastructure & Platform Engineer.
Built with [Hugo](https://gohugo.io/), hosted on [GitHub Pages](https://pages.github.com/).

**Live site:** https://giteshjawale96.github.io/

---

## Prerequisites

- [Hugo Extended](https://gohugo.io/installation/) v0.125.7 or later
- Git

```bash
# macOS
brew install hugo

# Linux
wget https://github.com/gohugoio/hugo/releases/download/v0.125.7/hugo_extended_0.125.7_linux-amd64.deb
sudo dpkg -i hugo_extended_0.125.7_linux-amd64.deb
```

---

## Run Locally

```bash
cd website
hugo server -D        # -D includes draft posts
# open http://localhost:1313
```

---

## How to Create a New Blog Post

### Step 1 — Create a branch

```bash
git checkout -b post/your-article-title
```

### Step 2 — Create the markdown file

Create the file manually at:

```
website/content/blog/your-article-slug.md
```

Use lowercase, hyphens only — no spaces or special characters in the filename.

### Step 3 — Add the frontmatter

Copy this template at the top of your file:

```yaml
---
title: "Your Article Title Here"
date: 2026-03-15T10:00:00+05:30
description: "One sentence summary — shown in post cards, SEO, and social previews."
author: "Gitesh Jawale"
tags:
  - Kubernetes
  - AI Infrastructure
  - SRE
categories:
  - AI Infrastructure
cover: "/images/blog/your-cover-image.jpg"
draft: false
mermaid: false
---
```

**Frontmatter fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `title` | Yes | Post title shown as H1 and in browser tab |
| `date` | Yes | Publication date (ISO 8601 format) |
| `description` | Yes | 1–2 sentence summary for SEO and post cards |
| `author` | Yes | Keep as "Gitesh Jawale" |
| `tags` | Yes | Array of tags — drives filtering on /blog/ |
| `categories` | Yes | One category from the list below |
| `cover` | No | Cover image path (see images section below) |
| `draft` | Yes | Set `false` to publish, `true` to hide |
| `mermaid` | No | Set `true` only if post uses Mermaid diagrams |

**Valid categories** (controls the gradient thumbnail color):

| Category | Gradient color |
|----------|----------------|
| `AI Infrastructure` | Purple / blue |
| `SRE` | Orange / red |
| `Platform Engineering` | Teal |
| `Observability` | Green |
| `Experiments` | Dark blue |

---

## Adding Images

### Cover image (shown in post card + top of post)

1. Place the image in `website/static/images/blog/`
2. Supported formats: `.jpg`, `.png`, `.webp`
3. Recommended size: **1200 × 630px** (matches OG image ratio)
4. Reference in frontmatter:

```yaml
cover: "/images/blog/my-cover-image.jpg"
```

If no cover image is set, the blog page shows an auto-generated gradient thumbnail based on the category.

### Inline images inside the post

Place images in `website/static/images/blog/` and reference them in markdown:

```markdown
![Alt text describing the image](/images/blog/my-diagram.png)
```

For a captioned image:

```markdown
![Architecture overview](/images/blog/arch-diagram.png)
*Figure 1: High-level architecture of the AI SRE Copilot*
```

For a full-width image with no border, the standard markdown syntax works. Hugo automatically renders images with `loading="lazy"`.

---

## Code Blocks

Always specify the language after the opening fence for proper syntax highlighting:

````markdown
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
```
````

````markdown
```python
def query_model(prompt: str) -> str:
    response = requests.post(endpoint, json={"prompt": prompt})
    return response.json()["response"]
```
````

````markdown
```bash
kubectl get pods -n ai-infra
kubectl logs -f sre-copilot-78d9f
```
````

````markdown
```go
func main() {
    log.Println("Starting SRE copilot")
}
```
````

````markdown
```terraform
resource "aws_eks_cluster" "main" {
  name     = "ai-infra"
  role_arn = aws_iam_role.eks.arn
}
```
````

Common language identifiers: `yaml`, `python`, `bash`, `go`, `terraform`, `json`, `sql`, `javascript`, `typescript`, `dockerfile`, `toml`, `markdown`.

Line numbers are shown automatically. The **Copy** button copies clean code without line numbers.

---

## Shortcodes

### Callout blocks

Use callouts to highlight important information:

```
{{< callout type="info" title="Note" >}}
This is an informational callout.
{{< /callout >}}

{{< callout type="tip" title="Pro tip" >}}
A helpful tip for the reader.
{{< /callout >}}

{{< callout type="warning" title="Warning" >}}
Something the reader should be careful about.
{{< /callout >}}

{{< callout type="danger" title="Important" >}}
A critical warning or breaking change notice.
{{< /callout >}}
```

Types: `info` (blue), `tip` (green), `warning` (yellow), `danger` (red)

### Mermaid diagrams

Set `mermaid: true` in frontmatter, then use the shortcode:

```
{{< mermaid >}}
graph TD
    A[Prometheus] --> B[Alert Manager]
    B --> C[SRE Copilot]
    C --> D[Slack Notification]
    C --> E[Auto-remediation]
{{< /mermaid >}}
```

Supported diagram types: `graph`, `sequenceDiagram`, `flowchart`, `classDiagram`, `stateDiagram`, `erDiagram`, `gantt`.

### Video embeds

Place video files in `website/static/videos/` then reference them:

```
{{< video src="/videos/demo.mp4" >}}
```

---

## Complete Post Example

```markdown
---
title: "How I Built an AI-Powered Incident Timeline Generator"
date: 2026-04-01T09:00:00+05:30
description: "Using LLMs to reconstruct incident timelines from Loki logs — design decisions, prompting strategy, and production lessons."
author: "Gitesh Jawale"
tags:
  - AI Infrastructure
  - SRE
  - Observability
categories:
  - AI Infrastructure
cover: "/images/blog/incident-timeline-cover.jpg"
draft: false
mermaid: true
---

SRE engineers spend the first 20 minutes of every incident manually correlating
logs across services to build a timeline. This is pattern-matching work — exactly
what LLMs are good at.

This post explains how I built a timeline generator that takes raw Loki log streams
and produces a structured incident narrative.

## Architecture

{{< mermaid >}}
sequenceDiagram
    participant E as Engineer
    participant C as Copilot
    participant L as Loki
    participant LLM as LLM Engine

    E->>C: "Summarize incident in namespace prod"
    C->>L: Query logs for last 2h
    L-->>C: Raw log lines
    C->>LLM: Prompt with log chunks
    LLM-->>C: Structured timeline
    C-->>E: Timeline + root cause
{{< /mermaid >}}

## Querying Loki

The first step is fetching logs from Loki using the HTTP API:

```python
import httpx

async def fetch_logs(namespace: str, duration: str = "2h") -> list[str]:
    query = f'{{namespace="{namespace}"}}'
    resp = await httpx.AsyncClient().get(
        "http://loki:3100/loki/api/v1/query_range",
        params={"query": query, "since": duration, "limit": 5000},
    )
    return [line["message"] for stream in resp.json()["data"]["result"]
            for _, line in stream["values"]]
```

{{< callout type="tip" title="Limit log volume" >}}
Always set a `limit` parameter. Without it, Loki may return millions of lines
and your LLM context window will overflow.
{{< /callout >}}

## Prompt Design

The prompting strategy matters more than the model choice:

```python
SYSTEM_PROMPT = """
You are an SRE assistant. Given raw log lines from a Kubernetes namespace,
produce a chronological incident timeline. For each event, include:
- Timestamp
- Affected component
- What happened
- Severity (INFO/WARN/ERROR/CRITICAL)

Output valid JSON only.
"""
```

## Results

Here is an example output for a memory OOM incident:

![Incident timeline output](/images/blog/timeline-output.png)
*The copilot correctly identified the cascade: OOM kill → pod restart → traffic spike*

{{< callout type="warning" title="LLM hallucination risk" >}}
Always show the raw log evidence alongside the generated timeline.
Engineers should verify the LLM's interpretation before acting on it.
{{< /callout >}}

## Key Lessons

1. Chunk logs by time window (5-minute slices) before sending to the LLM
2. Use structured output (JSON schema) rather than free text
3. Include the pod name and namespace in every log line before sending
4. Keep the context window under 80% capacity for reliability
```

---

## Repository Structure

```
Blog-GithubPages-PersonalBrand/
├── .github/workflows/deploy.yml     # GitHub Actions — auto-deploy on push to main
├── website/                         # Hugo site root
│   ├── config.toml                  # Site config: URL, params, menus, taxonomies
│   ├── content/
│   │   ├── blog/                    # Blog posts (*.md) — one file per post
│   │   ├── projects/_index.md       # Projects section
│   │   ├── architecture/_index.md   # Architecture library
│   │   ├── about/index.md
│   │   └── contact/index.md
│   ├── layouts/
│   │   ├── _default/
│   │   │   ├── baseof.html          # HTML shell (head, nav, footer)
│   │   │   ├── list.html            # Blog listing with inline search
│   │   │   └── single.html          # Individual blog post (TOC sidebar)
│   │   ├── partials/
│   │   │   ├── head.html            # SEO, OpenGraph, CSS includes
│   │   │   ├── header.html          # Navigation bar
│   │   │   ├── footer.html
│   │   │   ├── post-card.html       # Homepage post card
│   │   │   └── pagination.html      # Custom pagination
│   │   ├── shortcodes/
│   │   │   ├── callout.html
│   │   │   ├── mermaid.html
│   │   │   └── video.html
│   │   ├── index.html               # Homepage layout
│   │   └── index.json               # Fuse.js search index
│   └── static/
│       ├── css/main.css             # All styles (dark/light, responsive)
│       ├── css/syntax.css           # Chroma syntax highlighting
│       ├── js/main.js               # Theme toggle, copy button, TOC highlight
│       └── images/blog/             # Place all blog images here
└── README.md                        # This file
```

---

## Publish a Post

```bash
# 1. Create branch
git checkout -b post/your-title

# 2. Write the post in website/content/blog/slug.md

# 3. Preview locally
cd website && hugo server -D

# 4. Commit and push
git add website/content/blog/slug.md website/static/images/blog/
git commit -m "post: your article title"
git push origin post/your-title

# 5. Open a PR on GitHub and merge to main
# GitHub Actions will build and deploy automatically (~2 minutes)
```

---

## Deploy

Pushing to `main` triggers `.github/workflows/deploy.yml` which:
1. Installs Hugo Extended v0.125.7
2. Builds with `hugo --minify --source website`
3. Deploys `website/public/` to GitHub Pages

Pull requests run a build-only check (no deploy) to catch errors early.

---

## Quick Config Reference

Edit `website/config.toml`:

| Setting | Key | Example |
|---------|-----|---------|
| Site URL | `baseURL` | `"https://giteshjawale96.github.io/"` |
| Posts per page | `paginate` | `10` |
| Author name | `params.author` | `"Gitesh Jawale"` |
| GitHub URL | `params.github` | `"https://github.com/giteshjawale"` |
| LinkedIn URL | `params.linkedin` | `"https://linkedin.com/in/giteshjawale"` |
| Date format | `params.dateFormat` | `"January 2, 2006"` |
| Show reading time | `params.showReadingTime` | `true` |
