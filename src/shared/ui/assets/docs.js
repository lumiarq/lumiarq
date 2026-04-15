/* ── docs.js — LumiARQ docs page scripts ─────────────────────────────────
 * Loaded via @scripts('docs.js') in docs-page.veil.html
 * Inlined into the page bundle at build time by the Veil compiler.
 * ──────────────────────────────────────────────────────────────────────── */

;(function () {
  'use strict';

  /* ── <run-example> custom element upgrade ───────────────────────────── */
  document.querySelectorAll('run-example').forEach(function (el) {
    var text = el.textContent.trim();
    var wrapper = document.createElement('div');
    wrapper.className = 'example-output';

    var btn = document.createElement('button');
    btn.className = 'run-btn';
    btn.setAttribute('type', 'button');
    btn.innerHTML = '<em class="run-icon">▶</em> <span class="run-label">Run example</span>';

    var output = document.createElement('pre');
    output.className = 'output-console';
    output.textContent = text;
    output.hidden = true;

    btn.addEventListener('click', function () {
      output.hidden = !output.hidden;
      btn.querySelector('.run-label').textContent = output.hidden ? 'Run example' : 'Hide output';
    });

    wrapper.appendChild(btn);
    wrapper.appendChild(output);
    el.replaceWith(wrapper);
  });

  /* ── TOC active-section tracking ────────────────────────────────────── */
  var tocLinks = document.querySelectorAll('.toc-link');
  if (tocLinks.length) {
    var HEADER_H = parseInt(
      getComputedStyle(document.documentElement).getPropertyValue('--header-h') || '60', 10
    );
    var OFFSET = HEADER_H + 20;

    var linkMap = {};
    tocLinks.forEach(function (link) {
      var id = (link.getAttribute('href') || '').replace(/^#/, '');
      if (id) linkMap[id] = link;
    });

    var article = document.querySelector('article');
    if (article) {
      var targets = Array.from(article.querySelectorAll('a[name]'));
      if (!targets.length) targets = Array.from(article.querySelectorAll('h2[id], h3[id]'));

      if (targets.length) {
        var activeLink = null;
        var rafPending = false;

        function setActive(link) {
          if (activeLink === link) return;
          if (activeLink) activeLink.classList.remove('active');
          activeLink = link;
          if (link) link.classList.add('active');
        }

        function update() {
          rafPending = false;
          var scrollY = window.scrollY;
          var threshold = scrollY + OFFSET;
          var best = null;

          for (var i = targets.length - 1; i >= 0; i--) {
            var el = targets[i];
            var absTop = el.getBoundingClientRect().top + scrollY;
            if (absTop <= threshold) { best = el; break; }
          }
          if (!best) best = targets[0];

          var id = best && (best.id || best.getAttribute('name'));
          setActive(id && linkMap[id] ? linkMap[id] : null);
        }

        window.addEventListener('scroll', function () {
          if (!rafPending) { rafPending = true; requestAnimationFrame(update); }
        }, { passive: true });

        update();
      }
    }
  }

  /* ── Copy-to-clipboard for code blocks ──────────────────────────────── */
  var copyIcon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  var checkIcon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

  document.querySelectorAll('article pre:not(.output-console)').forEach(function (pre) {
    var btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.setAttribute('aria-label', 'Copy code');
    btn.innerHTML = copyIcon + '<span>Copy</span>';

    btn.addEventListener('click', function () {
      var code = pre.querySelector('code');
      var text = code ? code.innerText : pre.innerText;

      function showCopied() {
        btn.classList.add('copied');
        btn.innerHTML = checkIcon + '<span>Copied!</span>';
        setTimeout(function () {
          btn.classList.remove('copied');
          btn.innerHTML = copyIcon + '<span>Copy</span>';
        }, 2000);
      }

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(showCopied);
      } else {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        try { document.execCommand('copy'); showCopied(); } catch (_) {}
        document.body.removeChild(ta);
      }
    });

    pre.appendChild(btn);
  });

  /* ═══════════════════════════════════════════════════════════════════════
     ALGOLIA-STYLE CLIENT SEARCH
     ═══════════════════════════════════════════════════════════════════════
     - Lazy-fetches /api/search-index on first Cmd+K / modal open
     - Scores: title (4×) > section (2×) > description (2×) > excerpt (1.5×) > body (1×)
     - Highlights matched terms in results
     - Keyboard navigation: ↑↓ to move, Enter to go, Esc to close
  ════════════════════════════════════════════════════════════════════════ */
  (function () {
    var searchInput   = document.getElementById('search-input');
    var searchResults = document.getElementById('search-results');
    if (!searchInput || !searchResults) return;

    var searchIndex  = null;   // lazy-loaded
    var indexLoading = false;
    var debounceTimer = null;
    var activeIdx = -1;

    // ── Load index ──────────────────────────────────────────────────────
    function loadIndex(cb) {
      if (searchIndex) { cb(searchIndex); return; }
      if (indexLoading) { setTimeout(function () { loadIndex(cb); }, 100); return; }
      indexLoading = true;
      fetch('/api/search-index')
        .then(function (r) { return r.json(); })
        .then(function (data) {
          searchIndex = data.pages || [];
          indexLoading = false;
          cb(searchIndex);
        })
        .catch(function () {
          searchIndex = [];
          indexLoading = false;
          cb(searchIndex);
        });
    }

    // ── Scoring ─────────────────────────────────────────────────────────
    function score(page, terms) {
      var s = 0;
      terms.forEach(function (t) {
        var re = new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        var titleMatches   = (page.title       || '').match(re);
        var sectionMatches = (page.section     || '').match(re);
        var descMatches    = (page.description || '').match(re);
        var excerptMatches = (page.excerpt     || '').match(re);
        var bodyMatches    = (page.body        || '').match(re);
        s += (titleMatches   ? titleMatches.length   * 4   : 0);
        s += (sectionMatches ? sectionMatches.length * 2   : 0);
        s += (descMatches    ? descMatches.length    * 2   : 0);
        s += (excerptMatches ? excerptMatches.length * 1.5 : 0);
        s += (bodyMatches    ? bodyMatches.length    * 1   : 0);
      });
      return s;
    }

    // ── Highlight ───────────────────────────────────────────────────────
    function highlight(text, terms) {
      if (!text) return '';
      var safe = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
      terms.forEach(function (t) {
        var re = new RegExp('(' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
        safe = safe.replace(re, '<mark>$1</mark>');
      });
      return safe;
    }

    // ── Snippet: find the most relevant sentence containing a term ──────
    function snippet(text, terms, maxLen) {
      maxLen = maxLen || 160;
      if (!text) return '';
      var lower = text.toLowerCase();
      var best = -1;
      terms.forEach(function (t) {
        var i = lower.indexOf(t.toLowerCase());
        if (i !== -1 && (best === -1 || i < best)) best = i;
      });
      if (best === -1) return text.slice(0, maxLen);
      var start = Math.max(0, best - 60);
      var end   = Math.min(text.length, start + maxLen);
      var raw   = (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
      return raw;
    }

    // ── Render results ──────────────────────────────────────────────────
    function renderResults(pages, terms) {
      activeIdx = -1;
      if (!pages.length) {
        searchResults.innerHTML = '<p class="search-empty">No results found.</p>';
        return;
      }
      var html = '<ul class="search-result-list" role="listbox">';
      pages.slice(0, 8).forEach(function (page, i) {
        var href    = page.slug === 'index'
          ? '/docs/' + page.version
          : '/docs/' + page.version + '/' + page.slug;
        var snip    = snippet(page.body || page.excerpt || '', terms);
        html += '<li class="search-result-item" role="option" data-idx="' + i + '" data-href="' + href + '">' +
          '<a href="' + href + '" class="search-result-link" tabindex="-1">' +
            '<span class="search-result-title">' + highlight(page.title, terms) + '</span>' +
            (page.section ? '<span class="search-result-section">' + highlight(page.section, terms) + '</span>' : '') +
            (snip ? '<span class="search-result-excerpt">' + highlight(snip, terms) + '</span>' : '') +
          '</a>' +
        '</li>';
      });
      html += '</ul>';
      searchResults.innerHTML = html;

      // click handler
      searchResults.querySelectorAll('.search-result-item').forEach(function (item) {
        item.addEventListener('mousedown', function (e) {
          e.preventDefault();
          window.location.href = item.getAttribute('data-href');
        });
      });
    }

    // ── Keyboard nav ────────────────────────────────────────────────────
    function getItems() {
      return Array.from(searchResults.querySelectorAll('.search-result-item'));
    }

    function setActiveItem(idx) {
      var items = getItems();
      items.forEach(function (el) { el.classList.remove('search-result-active'); });
      if (idx >= 0 && idx < items.length) {
        items[idx].classList.add('search-result-active');
        items[idx].scrollIntoView({ block: 'nearest' });
      }
      activeIdx = idx;
    }

    searchInput.addEventListener('keydown', function (e) {
      var items = getItems();
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveItem(Math.min(activeIdx + 1, items.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveItem(Math.max(activeIdx - 1, 0));
      } else if (e.key === 'Enter') {
        if (activeIdx >= 0 && items[activeIdx]) {
          var href = items[activeIdx].getAttribute('data-href');
          if (href) window.location.href = href;
        }
      }
    });

    // ── Search ──────────────────────────────────────────────────────────
    function doSearch(query) {
      var q = query.trim();
      if (!q) { searchResults.innerHTML = ''; return; }

      var terms = q.toLowerCase().split(/\s+/).filter(Boolean);

      loadIndex(function (index) {
        var scored = index
          .map(function (page) { return { page: page, score: score(page, terms) }; })
          .filter(function (r) { return r.score > 0; })
          .sort(function (a, b) { return b.score - a.score; });

        renderResults(scored.map(function (r) { return r.page; }), terms);
      });
    }

    searchInput.addEventListener('input', function () {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () { doSearch(searchInput.value); }, 150);
    });

    // Prefetch index when modal opens (watch Alpine searchOpen)
    var overlay = document.querySelector('.search-modal-overlay');
    if (overlay && window.MutationObserver) {
      new MutationObserver(function () {
        if (overlay.style.display !== 'none' && !searchIndex && !indexLoading) {
          loadIndex(function () {}); // warm the cache
        }
      }).observe(overlay, { attributes: true, attributeFilter: ['style'] });
    }

  }());

}());

  // Transforms `<run-example>text</run-example>` into interactive toggle panels.
  // Must run before Alpine.js initialises (inline scripts execute before defer).
  document.querySelectorAll('run-example').forEach(function (el) {
    var text = el.textContent.trim();
    var wrapper = document.createElement('div');
    wrapper.className = 'example-output';

    var btn = document.createElement('button');
    btn.className = 'run-btn';
    btn.setAttribute('type', 'button');
    btn.innerHTML = '<em class="run-icon">▶</em> <span class="run-label">Run example</span>';

    var output = document.createElement('pre');
    output.className = 'output-console';
    output.textContent = text;
    output.hidden = true;

    btn.addEventListener('click', function () {
      output.hidden = !output.hidden;
      btn.querySelector('.run-label').textContent = output.hidden ? 'Run example' : 'Hide output';
    });

    wrapper.appendChild(btn);
    wrapper.appendChild(output);
    el.replaceWith(wrapper);
  });

  /* ── TOC active-section tracking ────────────────────────────────────── */
  var tocLinks = document.querySelectorAll('.toc-link');
  if (tocLinks.length) {
    var HEADER_H = parseInt(
      getComputedStyle(document.documentElement).getPropertyValue('--header-h') || '60', 10
    );
    var OFFSET = HEADER_H + 20;

    var linkMap = {};
    tocLinks.forEach(function (link) {
      var id = (link.getAttribute('href') || '').replace(/^#/, '');
      if (id) linkMap[id] = link;
    });

    var article = document.querySelector('article');
    if (article) {
      var targets = Array.from(article.querySelectorAll('a[name]'));
      if (!targets.length) targets = Array.from(article.querySelectorAll('h2[id], h3[id]'));

      if (targets.length) {
        var activeLink = null;
        var rafPending = false;

        function setActive(link) {
          if (activeLink === link) return;
          if (activeLink) activeLink.classList.remove('active');
          activeLink = link;
          if (link) link.classList.add('active');
        }

        function update() {
          rafPending = false;
          var scrollY = window.scrollY;
          var threshold = scrollY + OFFSET;
          var best = null;

          for (var i = targets.length - 1; i >= 0; i--) {
            var el = targets[i];
            var absTop = el.getBoundingClientRect().top + scrollY;
            if (absTop <= threshold) { best = el; break; }
          }
          if (!best) best = targets[0];

          var id = best && (best.id || best.getAttribute('name'));
          setActive(id && linkMap[id] ? linkMap[id] : null);
        }

        window.addEventListener('scroll', function () {
          if (!rafPending) { rafPending = true; requestAnimationFrame(update); }
        }, { passive: true });

        update();
      }
    }
  }

  /* ── Copy-to-clipboard for code blocks ──────────────────────────────── */
  var copyIcon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  var checkIcon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

  document.querySelectorAll('article pre:not(.output-console)').forEach(function (pre) {
    var btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.setAttribute('aria-label', 'Copy code');
    btn.innerHTML = copyIcon + '<span>Copy</span>';

    btn.addEventListener('click', function () {
      var code = pre.querySelector('code');
      var text = code ? code.innerText : pre.innerText;

      function showCopied() {
        btn.classList.add('copied');
        btn.innerHTML = checkIcon + '<span>Copied!</span>';
        setTimeout(function () {
          btn.classList.remove('copied');
          btn.innerHTML = copyIcon + '<span>Copy</span>';
        }, 2000);
      }

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(showCopied);
      } else {
        // Fallback for non-secure contexts (HTTP dev servers)
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        try { document.execCommand('copy'); showCopied(); } catch (_) {}
        document.body.removeChild(ta);
      }
    });

    pre.appendChild(btn);
  });
