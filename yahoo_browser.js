/**
 * Yahoo! Browser '05 Suite - Multi-Tab Universal Web Engine
 * Features:
 *  - Full Multi-Tab Support (create, close, switch, preserve tab state & history)
 *  - Native YouTube Engine (converts watch URLs to embeds + built-in YouTube video search)
 *  - Universal CORS proxy gateway with base-href and link-click interception
 *  - Retro 2005 Yahoo! Portal homepage per tab
 */
window.YahooBrowser = (function () {
  let tabs = [];
  let activeTabId = null;
  let tabCounter = 0;

  function init() {
    createTab('about:yahoo');
  }

  function createTab(initialUrl = 'about:yahoo') {
    tabCounter++;
    const tabId = 'tab_' + tabCounter;

    const tab = {
      id: tabId,
      title: 'Yahoo!',
      url: initialUrl,
      history: [initialUrl],
      historyIndex: 0,
      isLoading: false
    };

    tabs.push(tab);
    renderTabStrip();
    createTabViewport(tab);
    switchTab(tabId);
  }

  function closeTab(tabId, event) {
    if (event) event.stopPropagation();
    if (tabs.length <= 1) {
      navigate('about:yahoo');
      return;
    }

    const idx = tabs.findIndex(t => t.id === tabId);
    if (idx === -1) return;

    const vp = document.getElementById('vp_' + tabId);
    if (vp) vp.remove();

    tabs.splice(idx, 1);

    if (activeTabId === tabId) {
      const nextTab = tabs[Math.max(0, idx - 1)];
      switchTab(nextTab.id);
    } else {
      renderTabStrip();
    }
  }

  function switchTab(tabId) {
    activeTabId = tabId;
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return;

    document.querySelectorAll('.browser-tab-viewport').forEach(el => el.style.display = 'none');
    const curVp = document.getElementById('vp_' + tabId);
    if (curVp) curVp.style.display = 'block';

    updateAddressBar(tab.url);
    setStatus(tab.isLoading ? 'Loading page...' : 'Done');
    setLoading(tab.isLoading);
    renderTabStrip();
  }

  function renderTabStrip() {
    const strip = document.getElementById('browserTabStrip');
    if (!strip) return;
    strip.innerHTML = '';

    tabs.forEach(tab => {
      const tabEl = document.createElement('div');
      const isActive = tab.id === activeTabId;
      tabEl.className = `browser-tab ${isActive ? 'active' : ''}`;
      tabEl.onclick = () => switchTab(tab.id);

      tabEl.innerHTML = `
        <i class="fas fa-globe" style="font-size: 10px; color: ${isActive ? '#7b0099' : '#666'};"></i>
        <span class="tab-title">${escapeHtml(tab.title)}</span>
        <span class="tab-close" onclick="YahooBrowser.closeTab('${tab.id}', event)">✕</span>
      `;
      strip.appendChild(tabEl);
    });

    // New Tab (+) Button
    const newBtn = document.createElement('button');
    newBtn.className = 'browser-tab-add';
    newBtn.title = 'New Tab';
    newBtn.innerHTML = '+';
    newBtn.onclick = () => createTab('about:yahoo');
    strip.appendChild(newBtn);
  }

  function createTabViewport(tab) {
    const container = document.getElementById('yahooViewportContainer');
    if (!container) return;

    const vp = document.createElement('div');
    vp.id = 'vp_' + tab.id;
    vp.className = 'browser-tab-viewport';
    vp.style.width = '100%';
    vp.style.height = '100%';
    vp.style.display = 'none';

    const iframe = document.createElement('iframe');
    iframe.id = 'iframe_' + tab.id;
    iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin allow-popups allow-presentation');
    iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture');
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = 'none';
    iframe.style.background = '#ffffff';

    iframe.onload = () => {
      tab.isLoading = false;
      if (tab.id === activeTabId) {
        setStatus('Done');
        setLoading(false);
      }
    };

    vp.appendChild(iframe);
    container.appendChild(vp);

    loadUrlInTab(tab, tab.url);
  }

  function navigate(rawInput) {
    if (!activeTabId) return;
    const tab = tabs.find(t => t.id === activeTabId);
    if (!tab) return;

    let url = (rawInput || '').trim();
    if (!url) return;

    // Detect YouTube link or query
    if (url.includes('youtube.com/watch') || url.includes('youtu.be/')) {
      const videoId = extractYouTubeId(url);
      if (videoId) {
        url = `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1`;
        tab.title = 'YouTube Player';
      }
    } else if (url === 'youtube' || url === 'youtube.com' || url === 'https://youtube.com' || url === 'https://www.youtube.com') {
      url = 'about:youtube';
      tab.title = 'YouTube';
    } else if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('about:')) {
      if (url.includes('.') && !url.includes(' ')) {
        url = 'https://' + url;
      } else {
        // Universal framing-enabled Google Search
        url = `https://www.google.com/search?igu=1&q=${encodeURIComponent(url)}`;
        tab.title = rawInput + ' - Search';
      }
    }

    if (tab.historyIndex === -1 || tab.history[tab.historyIndex] !== url) {
      tab.history = tab.history.slice(0, tab.historyIndex + 1);
      tab.history.push(url);
      tab.historyIndex++;
    }

    tab.url = url;
    loadUrlInTab(tab, url);
  }

  function extractYouTubeId(url) {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
  }

  async function loadUrlInTab(tab, url) {
    const iframe = document.getElementById('iframe_' + tab.id);
    if (!iframe) return;

    tab.isLoading = true;
    if (tab.id === activeTabId) {
      updateAddressBar(url);
      setStatus('Connecting to ' + url + '...');
      setLoading(true);
    }

    // 1. Retro Yahoo! 2005 Portal
    if (url === 'about:yahoo' || url === 'about:home' || url === 'http://www.yahoo.com/') {
      tab.title = 'Yahoo!';
      renderYahooPortal(iframe, tab);
      renderTabStrip();
      return;
    }

    // 2. Dedicated Interactive YouTube Engine
    if (url === 'about:youtube' || url.startsWith('about:youtube')) {
      tab.title = 'YouTube Video Portal';
      renderYouTubePortal(iframe);
      renderTabStrip();
      return;
    }

    // 3. Direct Embed Engines (Google framing-enabled search, Wikipedia, Archive.org, Wiby, YouTube embed)
    if (url.includes('youtube-nocookie.com/embed') || url.includes('google.com/search?igu=1') || url.includes('wikipedia.org') || url.includes('wiby.me')) {
      iframe.removeAttribute('srcdoc');
      iframe.src = url;
      try {
        const parsed = new URL(url);
        tab.title = parsed.hostname;
      } catch (e) {
        tab.title = 'Web Page';
      }
      renderTabStrip();
      return;
    }

    // 4. Universal Web Proxy Gateway
    try {
      setStatus('Fetching web content via universal gateway...');
      const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);

      const response = await fetch(proxyUrl, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) throw new Error('HTTP error ' + response.status);
      let html = await response.text();

      const baseTag = `<base href="${url}">`;
      const interceptor = `
        <script>
          document.addEventListener('click', function(e) {
            var a = e.target.closest('a');
            if (a && a.href && !a.href.startsWith('javascript:')) {
              e.preventDefault();
              window.parent.YahooBrowser.navigate(a.href);
            }
          }, true);
        <\/script>
      `;

      if (html.includes('<head>')) {
        html = html.replace('<head>', '<head>' + baseTag + interceptor);
      } else {
        html = baseTag + interceptor + html;
      }

      iframe.removeAttribute('src');
      iframe.srcdoc = html;
      tab.title = new URL(url).hostname;
    } catch (err) {
      console.warn("Proxy failed, falling back to direct iframe:", err);
      iframe.removeAttribute('srcdoc');
      iframe.src = url;
      tab.title = 'Web Page';
    } finally {
      tab.isLoading = false;
      if (tab.id === activeTabId) {
        setStatus('Done');
        setLoading(false);
      }
      renderTabStrip();
    }
  }

  function renderYahooPortal(iframe, tab) {
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
          .nav-bar { background:#eee; padding:6px 14px; border-bottom:1px solid #ccc; display:flex; gap:14px; font-size:11px; flex-wrap:wrap; }
          .nav-bar a { color:#0033cc; text-decoration:none; font-weight:bold; cursor:pointer; }
          .nav-bar a:hover { text-decoration:underline; }
          .content { padding:14px; display:grid; grid-template-columns: 2fr 1fr; gap:14px; max-width:980px; margin:0 auto; }
          .card { background:#fff; border:1px solid #dcdcdc; border-radius:3px; padding:12px; margin-bottom:12px; }
          .card h3 { color:#500078; border-bottom:1px solid #eee; padding-bottom:4px; margin-bottom:8px; font-size:13px; }
          .news-item { margin-bottom:8px; line-height:1.4; }
          .news-item a { color:#0033cc; text-decoration:none; font-size:12px; font-weight:bold; }
          .yt-badge { background:#cc0000; color:#fff; padding:2px 6px; border-radius:3px; font-weight:bold; font-size:11px; text-decoration:none; cursor:pointer; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="logo">YAHOO!<span>!</span></div>
          <div style="font-size:11px; color:#555;">Live Multi-Tab Windows XP Browser &bull; October 1, 2005</div>
        </div>

        <div class="search-box-wrap">
          <input type="text" id="pSearch" class="search-input" placeholder="Search the web with Google/Yahoo or type any URL...">
          <button class="search-btn" onclick="doSearch()">Web Search</button>
        </div>

        <div class="nav-bar">
          <a onclick="parent.YahooBrowser.navigate('about:youtube')"><span class="yt-badge"><i class="fas fa-play"></i> YouTube Portal</span></a>
          <a onclick="parent.YahooBrowser.navigate('https://en.wikipedia.org')">Wikipedia</a>
          <a onclick="parent.YahooBrowser.navigate('https://wiby.me')">Wiby (Classic Search)</a>
          <a onclick="parent.YahooBrowser.navigate('https://web.archive.org')">Wayback Machine</a>
          <a onclick="parent.YahooBrowser.navigate('https://news.ycombinator.com')">Hacker News</a>
        </div>

        <div class="content">
          <div>
            <div class="card">
              <h3>In the News &bull; 2005 Edition</h3>
              <div class="news-item"><a onclick="parent.YahooBrowser.navigate('https://en.wikipedia.org/wiki/Windows_XP')">&bull; Windows XP dominates over 80% of desktop operating systems worldwide</a></div>
              <div class="news-item"><a onclick="parent.YahooBrowser.navigate('https://en.wikipedia.org/wiki/YouTube')">&bull; Video-sharing platforms emerge as broadband connections expand</a></div>
              <div class="news-item"><a onclick="parent.YahooBrowser.navigate('https://en.wikipedia.org/wiki/Winamp')">&bull; Winamp 2.80 and modular MP3 skins celebrate peak audio community adoption</a></div>
            </div>

            <div class="card">
              <h3>Fast Bookmarks & Multi-Tab Hub</h3>
              <p style="margin-bottom:8px; color:#444;">Click the <b>+</b> button at the top to open multiple tabs simultaneously. Surf live pages without leaving your XP desktop:</p>
              <div style="display:flex; gap:8px; flex-wrap:wrap;">
                <button style="padding:4px 8px; cursor:pointer;" onclick="parent.YahooBrowser.navigate('about:youtube')">Open YouTube Video Hub</button>
                <button style="padding:4px 8px; cursor:pointer;" onclick="parent.YahooBrowser.navigate('https://wiby.me')">Wiby Surprise Web</button>
                <button style="padding:4px 8px; cursor:pointer;" onclick="parent.YahooBrowser.navigate('https://en.wikipedia.org/wiki/Main_Page')">Wikipedia Main</button>
              </div>
            </div>
          </div>

          <div>
            <div class="card">
              <h3>Weather & Time</h3>
              <div style="font-size:24px; font-weight:bold; color:#ff6600;">72&deg; F</div>
              <div style="color:#666;">Partly Cloudy &bull; Barometer: 30.15 in</div>
            </div>
            <div class="card">
              <h3>Financial Ticker</h3>
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

  function renderYouTubePortal(iframe) {
    const ytHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          * { margin:0; padding:0; box-sizing:border-box; font-family: Arial, Tahoma, sans-serif; }
          body { background:#181818; color:#fff; padding:12px; }
          .header { display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid #333; padding-bottom:10px; margin-bottom:12px; }
          .logo { font-size:22px; font-weight:bold; color:#ff0000; display:flex; align-items:center; gap:6px; }
          .logo span { background:#ff0000; color:#fff; padding:2px 6px; border-radius:4px; font-size:14px; }
          .search-bar { display:flex; gap:6px; flex:1; max-width:500px; margin:0 20px; }
          .search-bar input { flex:1; padding:6px 10px; background:#121212; border:1px solid #444; color:#fff; border-radius:2px; outline:none; }
          .search-bar button { padding:6px 14px; background:#cc0000; border:none; color:#fff; font-weight:bold; cursor:pointer; border-radius:2px; }
          .player-wrap { width:100%; aspect-ratio:16/9; max-height:480px; background:#000; border-radius:4px; overflow:hidden; margin-bottom:14px; }
          .player-wrap iframe { width:100%; height:100%; border:none; }
          .featured-grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap:12px; }
          .video-card { background:#222; border-radius:4px; overflow:hidden; cursor:pointer; transition:transform 0.15s; border:1px solid #333; }
          .video-card:hover { transform:scale(1.02); border-color:#ff0000; }
          .thumb { width:100%; height:110px; background:#333; background-size:cover; background-position:center; display:flex; align-items:center; justify-content:center; }
          .info { padding:8px; font-size:12px; }
          .v-title { font-weight:bold; margin-bottom:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
          .v-author { color:#aaa; font-size:11px; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="logo"><i class="fas fa-play-circle"></i> YouTube <span>XP</span></div>
          <div class="search-bar">
            <input type="text" id="ytQuery" placeholder="Search YouTube or paste video URL/ID...">
            <button onclick="searchYt()">Play Video</button>
          </div>
          <button style="padding:4px 8px; cursor:pointer; background:#333; color:#fff; border:1px solid #555;" onclick="parent.YahooBrowser.navigate('about:yahoo')">Back to Yahoo!</button>
        </div>

        <div class="player-wrap">
          <iframe id="mainYtPlayer" src="https://www.youtube-nocookie.com/embed/jfKfPfyJRdk?autoplay=1" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
        </div>

        <div style="font-weight:bold; margin-bottom:8px; font-size:14px; color:#ff4444;"><i class="fas fa-fire"></i> Featured Retro & Music Streams</div>
        <div class="featured-grid">
          <div class="video-card" onclick="playVid('jfKfPfyJRdk', 'Lofi Girl - Relaxing Beats')">
            <div class="thumb" style="background-image:url('https://img.youtube.com/vi/jfKfPfyJRdk/mqdefault.jpg');"><i class="fas fa-play-circle" style="font-size:28px; color:rgba(255,255,255,0.8);"></i></div>
            <div class="info"><div class="v-title">Lofi Girl - Beats to Relax/Study</div><div class="v-author">Lofi Girl</div></div>
          </div>
          <div class="video-card" onclick="playVid('5qap5aO4i9A', 'Lofi Hip Hop Radio')">
            <div class="thumb" style="background-image:url('https://img.youtube.com/vi/5qap5aO4i9A/mqdefault.jpg');"><i class="fas fa-play-circle" style="font-size:28px; color:rgba(255,255,255,0.8);"></i></div>
            <div class="info"><div class="v-title">Lofi Hip Hop Radio 24/7</div><div class="v-author">ChilledCow</div></div>
          </div>
          <div class="video-card" onclick="playVid('dQw4w9WgXcQ', 'Rick Astley - Never Gonna Give You Up')">
            <div class="thumb" style="background-image:url('https://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg');"><i class="fas fa-play-circle" style="font-size:28px; color:rgba(255,255,255,0.8);"></i></div>
            <div class="info"><div class="v-title">Never Gonna Give You Up</div><div class="v-author">Rick Astley</div></div>
          </div>
          <div class="video-card" onclick="playVid('4xDzrJKXOOY', 'Synthwave Radio - Chill Retro')">
            <div class="thumb" style="background-image:url('https://img.youtube.com/vi/4xDzrJKXOOY/mqdefault.jpg');"><i class="fas fa-play-circle" style="font-size:28px; color:rgba(255,255,255,0.8);"></i></div>
            <div class="info"><div class="v-title">Synthwave Chill Radio</div><div class="v-author">Lofi Records</div></div>
          </div>
        </div>

        <script>
          function playVid(id, title) {
            document.getElementById('mainYtPlayer').src = "https://www.youtube-nocookie.com/embed/" + id + "?autoplay=1";
          }
          function searchYt() {
            var q = document.getElementById('ytQuery').value.trim();
            if (!q) return;
            var reg = /^.*(youtu.be\\/|v\\/|u\\/\\w\\/|embed\\/|watch\\?v=|\\&v=)([^#\\&\\?]*).*/;
            var match = q.match(reg);
            if (match && match[2].length === 11) {
              playVid(match[2]);
            } else {
              parent.YahooBrowser.navigate("https://www.google.com/search?igu=1&q=site:youtube.com+" + encodeURIComponent(q));
            }
          }
          document.getElementById('ytQuery').addEventListener('keydown', function(e) {
            if (e.key === 'Enter') searchYt();
          });
        <\/script>
      </body>
      </html>
    `;
    iframe.removeAttribute('src');
    iframe.srcdoc = ytHtml;
  }

  function goBack() {
    if (!activeTabId) return;
    const tab = tabs.find(t => t.id === activeTabId);
    if (tab && tab.historyIndex > 0) {
      tab.historyIndex--;
      tab.url = tab.history[tab.historyIndex];
      loadUrlInTab(tab, tab.url);
    }
  }

  function goForward() {
    if (!activeTabId) return;
    const tab = tabs.find(t => t.id === activeTabId);
    if (tab && tab.historyIndex < tab.history.length - 1) {
      tab.historyIndex++;
      tab.url = tab.history[tab.historyIndex];
      loadUrlInTab(tab, tab.url);
    }
  }

  function reload() {
    if (!activeTabId) return;
    const tab = tabs.find(t => t.id === activeTabId);
    if (tab) loadUrlInTab(tab, tab.url);
  }

  function goHome() {
    navigate('about:yahoo');
  }

  function updateAddressBar(url) {
    const input = document.getElementById('yahooAddressInput');
    if (!input) return;
    if (url === 'about:yahoo' || url === 'about:home') {
      input.value = 'http://www.yahoo.com/';
    } else if (url === 'about:youtube') {
      input.value = 'http://www.youtube.com/';
    } else {
      input.value = url;
    }
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

  function escapeHtml(str) {
    return (str || '').replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[m]);
  }

  return {
    init,
    createTab,
    closeTab,
    switchTab,
    navigate,
    goBack,
    goForward,
    reload,
    goHome
  };
})();
