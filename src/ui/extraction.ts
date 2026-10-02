export function buildExtractSourcesScript(): string {
  return `(function() {
    function isInternalLink(url) {
      if (!url) return true;
      try {
        var hostname = new URL(url).hostname;
        // Domain check must match src/utils.ts isPerplexityDomain()
        var path = new URL(url).pathname;
        return (hostname === 'perplexity.ai' || hostname.endsWith('.perplexity.ai')) && ['search', 'account', 'home', 'spaces'].some(function(segment) { return path === '/' + segment || path.startsWith('/' + segment + '/'); });
      } catch (e) {
        return true;
      }
    }

    function extractDomain(url) {
      try {
        return new URL(url).hostname;
      } catch (e) {
        return '';
      }
    }

    var sources = [];
    var seenUrls = {};

    // Strategy A: Find links inside tabpanel elements
    var tabpanels = document.querySelectorAll('[role="tabpanel"]');
    for (var t = 0; t < tabpanels.length; t++) {
      var anchors = tabpanels[t].querySelectorAll('a[href]');
      for (var i = 0; i < anchors.length; i++) {
        var a = anchors[i];
        var href = a.href;
        var text = (a.innerText || '').trim();
        if (!href || seenUrls[href]) continue;
        if (href.indexOf('javascript:') === 0) continue;
        if (href.indexOf('#') === href.length - 1) continue;
        if (isInternalLink(href)) continue;
        seenUrls[href] = true;
        sources.push({ url: href, title: text || extractDomain(href) || href });
      }
    }

    // Strategy B: Find citation elements (Comet v145 source format)
    var citations = document.querySelectorAll('[class*="citation"]');
    for (var c = 0; c < citations.length; c++) {
      var el = citations[c];
      if (el.className.indexOf('citation-nbsp') !== -1 || el.parentElement?.closest('[data-pplx-citation]')) continue;
      var anchor = el.closest('a') || el.querySelector('a');
      var dataUrl = Array.from(el.attributes || []).map(function(a) { return a.value; }).find(function(v) { return v.startsWith('https://') || v.startsWith('http://'); });
      if (anchor || dataUrl) {
        var href2 = dataUrl || anchor.href;
        if (!href2 || seenUrls[href2]) continue;
        if (isInternalLink(href2)) continue;
        seenUrls[href2] = true;
        var text2 = (el.innerText || '').trim().split('\\n')[0].trim();
        sources.push({ url: href2, title: text2 || extractDomain(href2) || href2 });
      } else {
        // Collapsed citation without link — extract source name from text
        var rawText = (el.innerText || '').trim().split('\\n')[0].trim();
        // Strip "+N" count suffix (e.g., "ainews+3" → "ainews")
        var plusIdx = rawText.lastIndexOf('+');
        var citeTitle = plusIdx > 0 ? rawText.substring(0, plusIdx).trim() : rawText;
        if (!citeTitle || seenUrls[citeTitle]) continue;
        seenUrls[citeTitle] = true;
        sources.push({ url: '', title: citeTitle });
      }
    }

    // Strategy C: project answers often render plain links, not citation badges.
    var answerAnchors = document.querySelectorAll('main [class*="prose"] a[href]');
    for (var p = 0; p < answerAnchors.length; p++) {
      var link = answerAnchors[p];
      var url = link.href;
      if (!url || seenUrls[url] || isInternalLink(url)) continue;
      if (!url.startsWith('https://') && !url.startsWith('http://')) continue;
      seenUrls[url] = true;
      sources.push({ url: url, title: (link.innerText || '').trim() || extractDomain(url) || url });
    }

    return JSON.stringify(sources);
  })()`
}

/**
 * Build script that clicks all collapsed citations (those matching "+N" pattern)
 * to expand them and reveal hidden source links.
 * Returns the number of citations clicked.
 */
export function buildExpandCollapsedCitationsScript(): string {
  return `(function() {
    var clicked = 0;
    var citations = document.querySelectorAll('[class*="citation"]');
    for (var c = 0; c < citations.length; c++) {
      var el = citations[c];
      if (el.className.indexOf('citation-nbsp') !== -1) continue;
      // Only click if this is a collapsed citation (no anchor link nearby)
      var anchor = el.closest('a') || el.querySelector('a');
      if (anchor) continue;
      // Check if text matches collapsed pattern (e.g., "wsj+3")
      var rawText = (el.innerText || '').trim();
      if (rawText.indexOf('+') !== -1) {
        el.click();
        clicked++;
      }
    }
    return clicked;
  })()`
}

export function buildExtractPageContentScript(maxLength = 10000): string {
  return `(function() {
    var body = document.body;
    if (!body) return JSON.stringify({ text: '', title: '' });
    var text = body.innerText || '';
    text = text.replace(/^\\s*(Sign in|Log in|Get the app|Download)/gm, '');
    if (text.length > ${maxLength}) text = text.substring(0, ${maxLength});
    return JSON.stringify({ text: text, title: document.title || '' });
  })()`
}
