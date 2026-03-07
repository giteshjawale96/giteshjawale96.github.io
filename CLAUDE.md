# CLAUDE.md — GJ Blog / Personal Brand

## Project Overview
Hugo static site for Gitesh Jawale's personal brand and blog.
- **Location:** `website/` subdirectory (all Hugo source here)
- **Target URL:** https://giteshjawale96.github.io/
- **Hugo version:** Extended v0.125.7+
- **Deploy:** GitHub Actions on push to `main` → GitHub Pages

## Directory Structure
```
Blog-GithubPages-PersonalBrand/
  website/              ← Hugo root (run hugo commands from here)
    config.toml
    content/blog/       ← 21 blog posts (Markdown)
    layouts/            ← all custom layouts (no external theme)
    static/css/main.css ← all styles
    static/js/main.js   ← theme toggle, mobile nav, reading progress
  .github/workflows/deploy.yml
  CLAUDE.md             ← this file
  GITESH_CAREER_BRAND_MASTERPLAN.md
```

## Key Architecture Decisions
- No external Hugo theme — fully custom layouts in `layouts/`
- Dark/light theme via CSS custom properties + vanilla JS (`localStorage`)
- Client-side search using Fuse.js v7 + Hugo JSON output (`/index.json`)
- Search is embedded inline on the blog listing page (not a separate page)
- Syntax highlighting: Chroma (Hugo built-in), CSS in `static/css/syntax.css`
- Mermaid diagrams: ESM CDN, only on posts with `mermaid: true` frontmatter
- No Hugo Pipes — CSS/JS served directly from `static/`
- Pagination: custom partial at `layouts/partials/pagination.html`

## Content Categories & Gradient Classes
Posts use categories that map to CSS gradient classes for thumbnails:
- "AI Infrastructure" → `.tc-ai` (purple/blue)
- "SRE" → `.tc-sre` (orange/red)
- "Platform Engineering" → `.tc-platform` (teal)
- "Observability" → `.tc-obs` (green)
- Kubernetes-tagged → `.tc-k8s` (blue)
- Default → `.tc-default` (dark blue-gray)

## Shortcodes
- `{{< callout type="info|tip|warning|danger" title="..." >}}`
- `{{< mermaid >}}` (requires `mermaid: true` in frontmatter)
- `{{< video src="/videos/file.mp4" >}}`

## Running Locally
```bash
cd website
hugo server -D
```

## Adding a Blog Post
1. Create `website/content/blog/slug.md`
2. Required frontmatter: `title`, `date`, `description`, `tags`, `categories`, `draft`
3. Categories should be one of: AI Infrastructure, SRE, Platform Engineering, Observability, Experiments
4. No real cover images — gradient placeholders auto-generated from category

## Brand Pillars (content themes)
AI Infrastructure | Kubernetes & Platform | Observability | SRE | Experiments

## User Preferences
- Professional, minimal, no emojis in code/content
- Content-first; blog is anchor for LinkedIn strategy
- Dark mode default
