# Gitesh Jawale — Personal Technical Blog

Personal blog and portfolio site for **Gitesh Jawale**, AI Infrastructure & Platform Engineer.

Built with [Hugo](https://gohugo.io/), hosted on [GitHub Pages](https://pages.github.com/),
deployed automatically via [GitHub Actions](https://github.com/features/actions).

**Live site:** https://giteshjawale.github.io/

---

## Prerequisites

- [Hugo Extended](https://gohugo.io/installation/) v0.125.7 or later
- Git

Install Hugo on macOS:
```bash
brew install hugo
```

Install Hugo on Linux:
```bash
wget https://github.com/gohugoio/hugo/releases/download/v0.125.7/hugo_extended_0.125.7_linux-amd64.deb
sudo dpkg -i hugo_extended_0.125.7_linux-amd64.deb
```

---

## Run Locally

```bash
# Clone the repository
git clone https://github.com/giteshjawale/giteshjawale.github.io.git
cd giteshjawale.github.io

# Start the development server with live reload
hugo server -D

# Open in browser
open http://localhost:1313
```

The `-D` flag includes draft posts. Remove it to preview only published content.

---

## Writing a New Post

### 1. Create a branch

```bash
git checkout -b post/your-article-title
```

### 2. Create the markdown file

```bash
hugo new content/blog/your-article-title.md
```

Or create it manually at `content/blog/your-article-title.md`.

### 3. Add frontmatter

```yaml
---
title: "Your Article Title"
date: 2026-03-15T10:00:00+05:30
description: "One sentence summary for SEO and social sharing."
author: "Gitesh Jawale"
tags:
  - AI Infrastructure
  - Kubernetes
categories:
  - Platform Engineering
cover: "/images/blog/your-image.jpg"
draft: false
mermaid: true   # set to true only if the post uses mermaid diagrams
---
```

### 4. Write in Markdown

Supported elements:

- Standard markdown (headings, lists, tables, code blocks, images)
- Syntax highlighted code fences (any language)
- Mermaid diagrams via `{{</* mermaid */>}}` shortcode
- Callout blocks via `{{</* callout type="info" title="Title" */>}}` shortcode
- Local video embeds via `{{</* video src="/videos/demo.mp4" */>}}` shortcode

Callout types: `info`, `tip`, `warning`, `danger`

### 5. Add images

Place blog cover images in: `static/images/blog/`

Reference in frontmatter as: `cover: "/images/blog/your-image.jpg"`

Reference inline in markdown as: `![Alt text](/images/blog/your-image.jpg)`

### 6. Commit and open a PR

```bash
git add .
git commit -m "post: your article title"
git push origin post/your-article-title
# Open a pull request on GitHub
```

Merging to `main` automatically builds and deploys the site.

---

## Repository Structure

```
.
├── .github/
│   └── workflows/
│       └── deploy.yml          # GitHub Actions deployment pipeline
├── assets/
│   ├── images/                 # Source images (unprocessed)
│   └── videos/                 # Source videos
├── content/
│   ├── _index.md               # Homepage content
│   ├── blog/                   # Blog posts (*.md)
│   ├── projects/               # Project pages
│   ├── architecture/           # Architecture library pages
│   ├── about/
│   │   └── index.md
│   ├── contact/
│   │   └── index.md
│   └── search/
│       └── _index.md
├── layouts/
│   ├── _default/
│   │   ├── baseof.html         # Base HTML wrapper
│   │   ├── list.html           # Section/taxonomy list pages
│   │   └── single.html         # Individual post/page
│   ├── partials/
│   │   ├── head.html           # <head> with SEO + OpenGraph
│   │   ├── header.html         # Navigation
│   │   ├── footer.html
│   │   └── post-card.html      # Blog post card component
│   ├── search/
│   │   └── list.html           # Search page with Fuse.js
│   ├── shortcodes/
│   │   ├── callout.html        # Callout blocks
│   │   ├── mermaid.html        # Mermaid diagrams
│   │   └── video.html          # Local video embeds
│   ├── index.html              # Homepage layout
│   └── index.json              # Search index (JSON output)
├── static/
│   ├── css/
│   │   ├── main.css            # All styles (dark/light themes)
│   │   └── syntax.css          # Syntax highlighting
│   ├── js/
│   │   └── main.js             # Theme toggle, mobile nav, copy button
│   ├── images/                 # Static images served as-is
│   └── favicon.svg
├── themes/                     # Empty — custom layouts used instead
└── config.toml                 # Hugo configuration
```

---

## Deploy to GitHub Pages

### One-time GitHub setup

1. Push this repository to GitHub (repository name: `giteshjawale.github.io`)
2. Go to **Settings → Pages**
3. Set **Source** to **GitHub Actions**
4. The workflow at `.github/workflows/deploy.yml` handles everything else

### What happens on every push to `main`

1. GitHub Actions checks out the repository
2. Installs Hugo Extended v0.125.7
3. Runs `hugo --minify`
4. Deploys the `public/` directory to GitHub Pages

Pull requests trigger a build-only run (no deployment) to catch errors before merge.

---

## Configuration

Edit `config.toml` to update:

| Setting | Location | Description |
|---------|----------|-------------|
| Site URL | `baseURL` | Must match your GitHub Pages URL |
| Author name | `[params] author` | Displayed in posts and footer |
| Social links | `[params] github/linkedin/twitter` | Footer and meta tags |
| OG image | `[params] ogImage` | Default social sharing image |
| Posts per page | `paginate` | Default: 10 |
| Date format | `[params] dateFormat` | Default: "January 2, 2006" |

---

## Performance

- Zero JavaScript frameworks — vanilla JS only (~3KB)
- All CSS in a single file (~12KB gzipped)
- Fonts loaded from Google Fonts with `preconnect`
- Images served with `loading="lazy"`
- Hugo minification enabled in production build
- No server-side dependencies — fully static

---

## Customization

**Change accent color:** Edit `--accent` in `static/css/main.css`

**Add a new section:** Create `content/newsection/_index.md` and add a menu entry in `config.toml`

**Add a project:** Create `content/projects/project-name.md` with standard frontmatter

**Update syntax theme:** Run `hugo gen chromastyles --style=dracula > static/css/syntax.css`
Available styles: `github-dark`, `dracula`, `monokai`, `nord`, `solarized-dark`
