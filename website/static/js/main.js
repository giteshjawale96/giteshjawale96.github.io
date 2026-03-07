(function () {
  'use strict';

  /* ── Theme toggle ─────────────────────────────────────────── */
  const html        = document.documentElement;
  const STORAGE_KEY = 'gj-theme';

  function applyTheme(theme) {
    html.dataset.theme = theme;
    localStorage.setItem(STORAGE_KEY, theme);
  }

  function initTheme() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) { applyTheme(stored); return; }
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(prefersDark ? 'dark' : 'light');
  }

  initTheme();

  document.addEventListener('DOMContentLoaded', function () {
    const btn = document.getElementById('theme-toggle');
    if (btn) {
      btn.addEventListener('click', function () {
        applyTheme(html.dataset.theme === 'dark' ? 'light' : 'dark');
      });
    }

    /* ── Mobile nav toggle ─────────────────────────────────── */
    const navToggle = document.getElementById('nav-toggle');
    const navLinks  = document.getElementById('nav-links');
    if (navToggle && navLinks) {
      navToggle.addEventListener('click', function () {
        const isOpen = navLinks.classList.toggle('open');
        navToggle.setAttribute('aria-expanded', String(isOpen));
        document.body.style.overflow = isOpen ? 'hidden' : '';
      });

      // Close on link click
      navLinks.querySelectorAll('.nav-link').forEach(function (link) {
        link.addEventListener('click', function () {
          navLinks.classList.remove('open');
          navToggle.setAttribute('aria-expanded', 'false');
          document.body.style.overflow = '';
        });
      });

      // Close on outside click
      document.addEventListener('click', function (e) {
        if (!navToggle.contains(e.target) && !navLinks.contains(e.target)) {
          navLinks.classList.remove('open');
          navToggle.setAttribute('aria-expanded', 'false');
          document.body.style.overflow = '';
        }
      });
    }

    /* ── Reading progress bar ──────────────────────────────── */
    const article = document.querySelector('.post-content');
    if (article) {
      const bar = document.createElement('div');
      bar.id = 'reading-progress';
      bar.style.cssText = [
        'position:fixed', 'top:0', 'left:0', 'height:3px',
        'background:var(--accent)', 'z-index:9999',
        'width:0%', 'transition:width 0.1s linear',
        'pointer-events:none'
      ].join(';');
      document.body.prepend(bar);

      window.addEventListener('scroll', function () {
        const scrollTop  = window.scrollY;
        const docHeight  = document.documentElement.scrollHeight - window.innerHeight;
        bar.style.width  = docHeight > 0 ? (scrollTop / docHeight * 100) + '%' : '0%';
      }, { passive: true });
    }

    /* ── Active TOC link highlight ─────────────────────────── */
    const tocLinks = document.querySelectorAll('.toc-inner nav a');
    if (tocLinks.length) {
      const headings = Array.from(
        document.querySelectorAll('.post-content h2, .post-content h3, .post-content h4')
      );

      const observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            const id = entry.target.id;
            tocLinks.forEach(function (l) {
              l.classList.toggle('active', l.getAttribute('href') === '#' + id);
            });
          }
        });
      }, { rootMargin: '-80px 0px -70% 0px' });

      headings.forEach(function (h) { if (h.id) observer.observe(h); });
    }

    /* ── Copy code button ──────────────────────────────────── */
    document.querySelectorAll('.prose pre').forEach(function (pre) {
      const btn = document.createElement('button');
      btn.textContent = 'Copy';
      btn.setAttribute('aria-label', 'Copy code');
      btn.style.cssText = [
        'position:absolute', 'top:0.6rem', 'right:0.6rem',
        'background:var(--bg-3)', 'color:var(--text-2)',
        'border:1px solid var(--border)', 'border-radius:5px',
        'font-size:0.72rem', 'font-weight:600', 'padding:0.25rem 0.6rem',
        'cursor:pointer', 'transition:all 0.2s', 'font-family:var(--font-sans)'
      ].join(';');
      pre.style.position = 'relative';
      pre.appendChild(btn);

      btn.addEventListener('click', function () {
        const code = pre.querySelector('code');
        let text;
        if (code) {
          // Clone and strip line number spans Hugo injects (class="ln")
          const clone = code.cloneNode(true);
          clone.querySelectorAll('.ln').forEach(function (el) { el.remove(); });
          text = clone.innerText;
        } else {
          text = pre.innerText;
        }
        navigator.clipboard.writeText(text).then(function () {
          btn.textContent = 'Copied!';
          btn.style.color = 'var(--green)';
          setTimeout(function () {
            btn.textContent = 'Copy';
            btn.style.color = 'var(--text-2)';
          }, 2000);
        });
      });
    });
  });
})();
