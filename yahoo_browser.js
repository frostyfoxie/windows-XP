/**
 * Yahoo! Browser '05 Suite (Universal Web Engine)
 * Fully functional in all standard browsers.
 * Features:
 *  - Strips X-Frame-Options/CSP restrictions via smart proxy + base-href rewriting
 *  - In-frame navigation loop: clicking links keeps navigation inside the window
 *  - Native universal Google/Yahoo live web search integration (?igu=1)
 *  - Retro 2005 Yahoo! Portal homepage with working live search & bookmarks
 */
window.YahooBrowser = (function () {
  let historyStack = [];
  let historyIndex = -1;
  const defaultHomepage = 'about:yahoo';
  let isNavigating = false;

  function init() {
    setupBrowserEngine();
    navigate(defaultHomepage);
  }

  function setupBrowserEngine() {
    const container = document.getElementById('yahooViewportContainer');
    if (!container) return;
    container.innerHTML = '';

    const iframe = document.createElement('iframe');
    iframe.id = 'yahooIframe';
    iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin allow-popups');
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = 'none';
    iframe.style.background = '#ffffff';

    iframe.onload = () => {
      setStatus('Done');
      setLoading(false);
      try {
        // Attempt to bind link interceptors if same-origin or srcdoc
        if (iframe.contentDocument) {
          bindLinkInterceptors(iframe.contentDocument);
        }
      } catch (e) {}
    };

    container.appendChild(iframe);
  }

  function bindLinkInterceptors(doc) {
    if (!doc) return;
    doc.querySelectorAll('a').forEach(link => {
      if (!link.dataset.bound) {
        link.dataset.bound = 'true';
        link.addEventListener('click', (e) => {
          const href = link.getAttribute('href');
          if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
            e.preventDefault();
            // Resolve relative URLs against the document's baseURI
            const absoluteUrl = new URL(href, doc.baseURI || window.location.href).href;
            navigate(absoluteUrl);
          }
        });
      }
    });
  }

  function navigate(rawInput) {
    if (!rawInput) return;
    let url = rawInput.trim();

    // Check if input is a search query or a website address
    if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('about:')) {
      if (url.includes('.') && !url.includes(' ')) {
        url = 'https://' + url;
      } else {
        // Live web search using framing-enabled search endpoint
        url = `https://www.google.com/search?igu=1&q=${encodeURIComponent(url)}`;
      }
    }

    if (historyIndex === -1 || historyStack[historyIndex] !== url) {
      historyStack = historyStack.slice(0, historyIndex + 1);
      historyStack.push(url);
      historyIndex++;
    }

    loadUrl(url);
  }

  async function loadUrl(url) {
    if (isNavigating) return;
    isNavigating = true;
    setLoading(true);
    updateUrlBar(url);
    setStatus('Connecting to ' + url + '...');

    const iframe = document.getElementById('yahooIframe');
    if (!iframe) { isNavigating = false; return; }

    // 1. Retro Yahoo! 2005 Portal Homepage
    if (url === 'about:yahoo' || url === 'about:home' || url === 'http://www.yahoo.com/' || url === 'https://www.yahoo.com/') {
      renderYahooPortal(iframe);
      isNavigating = false;
      return;
    }

    // 2. Direct-embeddable engines (e.g. Google framing-enabled search, Wikipedia, Wiby)
    if (url.includes('google.com/search?igu=1') || url.includes('wiby.me')) {
      iframe.removeAttribute('srcdoc');
      iframe.src = url;
      isNavigating = false;
      return;
    }

    // 3. Universal Web Surfer: Proxied fetch with HTML Base-URI injection
    try {
      setStatus('Fetching web content via universal gateway...');
      const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);

      const response = await fetch(proxyUrl, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) throw new Error(`HTTP error ${response.status}`);
      let html = await response.text();

      // Inject <base href="..."> so relative stylesheets, scripts, images & fonts load properly
      const baseTag = `<base href="${url}">`;
      
      // Inject script to intercept all link clicks and keep navigation inside this browser
      const interceptorScript = `
        <script>
          document.addEventListener('click', function(e) {
            var target = e.target.closest('a');
            if (target && target.href && !target.href.startsWith('javascript:')) {
              e.preventDefault();
              window.parent.YahooBrowser.navigate(target.href);
            }
          }, true);
        <\/script>
      `;

      if (html.includes('<head>')) {
        html = html.replace('<head>', '<head>' + baseTag + interceptorScript);
      } else {
        html = baseTag + interceptorScript + html;
      }

      iframe.srcdoc = html;
      setStatus('Done');
    } catch (err) {
      console.warn("Proxy load failed, falling back to direct iframe embed:", err);
      // Fallback: direct embed or search mirror
      iframe.removeAttribute('srcdoc');
      iframe.src = url;
      setStatus('Loaded (Direct Connection)');
    } finally {
      isNavigating = false;
      setLoading(false);
    }
  }

  function renderYahooPortal(iframe) {
    setStatus('Done');
    setLoading(false);

    const portalHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          * { margin:0; padding:0; box-sizing:border-box; font-family: Arial, Tahoma, Helvetica, sans-serif; font-size:12px; }
          body { background:#f5f5f5; color:#000; }
          .header { background:#ffffff; border-bottom:2px solid #500078; padding:8px 14px; display:flex; align-items:center; justify-content:space-between; }
          .logo { font-size:28px; font-weight:bold; color:#7b0099; letter-spacing:-1px; }
          .logo span { color:#ff3300; }
          .search-box-wrap { background:linear-gradient(to bottom, #7b0099, #500078); padding:10px 14px; display:flex; gap:6px; align-items:center; }
          .search-input { flex:1; height:28px; padding:4px 8px; font-size:13px; border:1px solid #333; outline:none; font-weight:bold; }
          .search-btn { height:28px; padding:0 18px; background:linear-gradient(to bottom, #ffee00, #ffaa00); border:1px solid #cc8800; font-weight:bold; cursor:pointer; font-size:12px; }
          .search-btn:hover { filter:brightness(1.1); }
          .nav-bar { background:#eee; padding:5px 14px; border-bottom:1px solid #ccc; display:flex; gap:16px; font-size:11px; flex-wrap:wrap; }
          .nav-bar a { color:#0033cc; text-decoration:none; font-weight:bold; cursor:pointer; }
          .nav-bar a:hover { text-decoration:underline; }
          .content { padding:14px; display:grid; grid-template-columns: 2fr 1fr; gap:14px; max-width:980px; margin:0 auto; }
          .card { background:#fff; border:1px solid #dcdcdc; border-radius:3px; padding:12px; margin-bottom:12px; box-shadow:0 1px 3px rgba(0,0,0,0.05); }
          .card h3 { color:#500078; border-bottom:1px solid #eee; padding-bottom:4px; margin-bottom:8px; font-size:13px; }
          .news-item { margin-bottom:8px; line-height:1.4; }
          .news-item a { color:#0033cc; text-decoration:none; font-size:12px; font-weight:bold; }
          .news-item a:hover { text-decoration:underline; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="logo">YAHOO!<span>!</span></div>
          <div style="font-size:11px; color:#555;">Wednesday, October 1, 2005 &bull; Make Yahoo! your home page</div>
        </div>

        <div class="search-box-wrap">
          <input type="text" id="pSearch" class="search-input" placeholder="Search the Web...">
          <button class="search-btn" onclick="doSearch()">Yahoo! Search</button>
        </div>

        <div class="nav-bar">
          <a onclick="parent.YahooBrowser.navigate('https://en.wikipedia.org')">Wikipedia</a>
          <a onclick="parent.YahooBrowser.navigate('https://wiby.me')">Wiby Search (Classic Web)</a>
          <a onclick="parent.YahooBrowser.navigate('https://web.archive.org')">Wayback Machine</a>
          <a onclick="parent.YahooBrowser.navigate('https://news.ycombinator.com')">Hacker News</a>
          <a onclick="parent.YahooBrowser.navigate('https://www.google.com/search?igu=1')">Google Mirror</a>
        </div>

        <div class="content">
          <div>
            <div class="card">
              <h3>Today's Top Stories</h3>
              <div class="news-item"><a onclick="parent.YahooBrowser.navigate('https://en.wikipedia.org/wiki/Windows_XP')">&bull; Windows XP remains the undisputed king of desktop operating systems worldwide</a></div>
              <div class="news-item"><a onclick="parent.YahooBrowser.navigate('https://en.wikipedia.org/wiki/Nullsoft')">&bull; Nullsoft Winamp reaches peak community skinning and MP3 audio fidelity</a></div>
              <div class="news-item"><a onclick="parent.YahooBrowser.navigate('https://en.wikipedia.org/wiki/MSN_Messenger')">&bull; MSN Messenger 7.5 connects millions with winks, nudges and voice clips</a></div>
              <div class="news-item"><a onclick="parent.YahooBrowser.navigate('https://en.wikipedia.org/wiki/World_Wide_Web')">&bull; Web 2.0 revolution underway as community-driven portals take center stage</a></div>
            </div>

            <div class="card">
              <h3>Featured Retro Bookmarks</h3>
              <p style="margin-bottom:8px; color:#444;">Surf live pages directly within this window:</p>
              <div style="display:flex; gap:8px; flex-wrap:wrap;">
                <button style="padding:4px 8px; cursor:pointer;" onclick="parent.YahooBrowser.navigate('https://wiby.me')">Surprise Retro Web (Wiby)</button>
                <button style="padding:4px 8px; cursor:pointer;" onclick="parent.YahooBrowser.navigate('https://en.wikipedia.org')">Browse Wikipedia</button>
                <button style="padding:4px 8px; cursor:pointer;" onclick="parent.YahooBrowser.navigate('https://news.ycombinator.com')">Hacker News Live</button>
              </div>
            </div>
          </div>

          <div>
            <div class="card">
              <h3>Weather & Forecast</h3>
              <div style="font-size:22px; font-weight:bold; color:#ff6600;">72&deg; F</div>
              <div style="color:#666;">Sunny &bull; Barometer: 30.12 in</div>
            </div>

            <div class="card">
              <h3>Market Summary</h3>
              <div style="font-size:11px; line-height:1.7;">
                <b>DOW:</b> 10,540 <span style="color:green;">+42.10</span><br>
                <b>NASDAQ:</b> 2,145 <span style="color:green;">+11.20</span><br>
                <b>S&P 500:</b> 1,220 <span style="color:green;">+5.30</span>
              </div>
            </div>
          </div>
        </div>

        <script>
          function doSearch() {
            var q = document.getElementById('pSearch').value;
            if (q) parent.YahooBrowser.navigate(q);
          }
          document.getElementById('pSearch').addEventListener('keydown', function(e) {
            if (e.key === 'Enter') doSearch();
          });
        <\/script>
      </body>
      </html>
    `;

    iframe.removeAttribute('src');
    iframe.srcdoc = portalHtml;
  }

  function goBack() {
    if (historyIndex > 0) {
      historyIndex--;
      loadUrl(historyStack[historyIndex]);
    }
  }

  function goForward() {
    if (historyIndex < historyStack.length - 1) {
      historyIndex++;
      loadUrl(historyStack[historyIndex]);
    }
  }

  function reload() {
    if (historyIndex >= 0) loadUrl(historyStack[historyIndex]);
  }

  function goHome() {
    navigate('about:yahoo');
  }

  function updateUrlBar(url) {
    const input = document.getElementById('yahooAddressInput');
    if (input) input.value = (url === 'about:yahoo' || url === 'about:home') ? 'http://www.yahoo.com/' : url;
  }

  function setStatus(text) {
    const statusEl = document.getElementById('yahooStatusText');
    if (statusEl) statusEl.innerText = text;
  }

  function setLoading(loading) {
    const icon = document.getElementById('yahooThrobber');
    if (icon) {
      icon.className = loading ? "fas fa-spinner fa-spin" : "fas fa-globe-americas";
      icon.style.color = loading ? "#ff9900" : "#388efd";
    }
  }

  return {
    init,
    navigate,
    goBack,
    goForward,
    reload,
    goHome
  };
})();
