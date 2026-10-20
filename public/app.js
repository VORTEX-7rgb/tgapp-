// ==========================================
// Universal AdBlock & Popup Shield
// Blocks all popups, redirect tabs, and malicious triggers
// ==========================================
window.open = function(url) {
  console.warn('[Shield] Blocked popup/new tab attempt to:', url);
  return null;
};

document.addEventListener('click', function(e) {
  const target = e.target.closest('a');
  if (target && target.href) {
    const lower = target.href.toLowerCase();
    if (lower.includes('.apk') || lower.includes('download') || lower.includes('adsterra') || lower.includes('pop') || lower.includes('click')) {
      e.preventDefault();
      e.stopPropagation();
      console.warn('[Shield] Blocked malicious link click:', target.href);
    }
  }
}, true);

// Telegram WebApp Initialization
const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  if (tg.enableClosingConfirmation) {
    tg.enableClosingConfirmation();
  }
}

// State
let currentSource = 'kamababa'; // Mandatory: KamaBaba is primary
let currentCategory = '';
let currentFilter = 'latest';
let searchQuery = '';
let currentPage = 1;
let isLoading = false;
let hlsInstance = null;
let stallWatchdog = null;

// DOM Elements
const videoGrid = document.getElementById('video-grid');
const categoriesBar = document.getElementById('categories-bar');
const filterBtns = document.querySelectorAll('.filter-btn');
const searchInput = document.getElementById('search-input');
const searchBtn = document.getElementById('search-btn');
const paginationBar = document.getElementById('pagination-bar');
const loader = document.getElementById('loader');
const sectionTitle = document.getElementById('current-section-title');
const videoCount = document.getElementById('video-count');
const tabKamaBaba = document.getElementById('tab-kamababa');
const tabViralMMS = document.getElementById('tab-viralmms');
const tabDesi52 = document.getElementById('tab-desi52');
const tabUsersPorn = document.getElementById('tab-usersporn');
const tabCumlouder = document.getElementById('tab-cumlouder');
const tabUpskirt = document.getElementById('tab-upskirt');

// Player Elements
const playerSection = document.getElementById('player-section');
const playerWrapper = document.getElementById('player-wrapper');
const closePlayerBtn = document.getElementById('close-player-btn');
const playerTitle = document.getElementById('player-video-title');
const playerCdnBadge = document.getElementById('player-cdn-badge');
const nativePlayer = document.getElementById('native-player');
const embedPlayer = document.getElementById('embed-player');
const playerBuffering = document.getElementById('player-buffering');
const playerStatusText = document.getElementById('player-status-text');
const unmuteBadge = document.getElementById('unmute-badge');
const seekOverlayLeft = document.getElementById('seek-overlay-left');
const seekOverlayRight = document.getElementById('seek-overlay-right');
const speedBtns = document.querySelectorAll('.speed-btn');
const qualitySelector = document.getElementById('quality-selector');
const qualityBtns = document.querySelectorAll('.quality-btn');

// Video Player State
let currentVideo = null;
let activeQuality = '720p';

// Refinement 4: Smooth Quality Switching Without Losing Play State on iOS
function switchQuality(videoEl, newUrl) {
  if (!videoEl || !newUrl) return;
  const savedTime = videoEl.currentTime;
  const wasPlaying = !videoEl.paused;
  videoEl.src = newUrl;
  videoEl.addEventListener('loadedmetadata', function onMeta() {
    videoEl.currentTime = savedTime;
    if (wasPlaying) videoEl.play().catch(() => {});
  }, { once: true });
  videoEl.load();
}

// Wire quality buttons
qualityBtns.forEach(btn => {
  btn.onclick = (e) => {
    e.stopPropagation();
    const q = btn.dataset.quality;
    if (activeQuality === q || !currentVideo || !currentVideo.qualityUrls || !currentVideo.qualityUrls[q]) return;
    activeQuality = q;
    qualityBtns.forEach(b => b.classList.toggle('active', b.dataset.quality === q));
    switchQuality(nativePlayer, currentVideo.qualityUrls[q]);
  };
});

// Base API URL
const API_BASE = window.API_BASE_URL || '';

// ==========================================
// 1. Source Switcher (KamaBaba vs ViralMMS vs Desi52 vs UsersPorn)
// ==========================================
function setSource(source) {
  if (currentSource === source) return;
  currentSource = source;

  document.querySelectorAll('.source-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.source === source);
  });

  if (source === 'viralmms') {
    sectionTitle.textContent = 'ViralMMS Releases';
  } else if (source === 'kamababa') {
    sectionTitle.textContent = 'KamaBaba Releases';
  } else if (source === 'usersporn') {
    sectionTitle.textContent = 'UsersPorn HD Releases';
  } else if (source === 'cumlouder') {
    sectionTitle.textContent = 'Cumlouder HD Releases';
  } else if (source === 'upskirt') {
    sectionTitle.textContent = 'Upskirt HD (1080p & Singapore CDN)';
  } else {
    sectionTitle.textContent = 'Desi52 Releases';
  }

  currentCategory = '';
  searchQuery = '';
  if (searchInput) searchInput.value = '';
  currentPage = 1;

  closePlayer();
  loadCategories();
  loadVideos(true, 1);
}

if (tabKamaBaba) tabKamaBaba.onclick = () => setSource('kamababa');
if (tabViralMMS) tabViralMMS.onclick = () => setSource('viralmms');
if (tabDesi52) tabDesi52.onclick = () => setSource('desi52');
if (tabUsersPorn) tabUsersPorn.onclick = () => setSource('usersporn');
if (tabCumlouder) tabCumlouder.onclick = () => setSource('cumlouder');
if (tabUpskirt) tabUpskirt.onclick = () => setSource('upskirt');

// ==========================================
// 2. Categories Loading
// ==========================================
async function loadCategories() {
  try {
    let url = `${API_BASE}/api/categories`;
    if (currentSource === 'kamababa') {
      url = `${API_BASE}/api/kmb/categories`;
    } else if (currentSource === 'viralmms') {
      url = `${API_BASE}/api/vmms/categories`;
    } else if (currentSource === 'usersporn') {
      url = `${API_BASE}/api/up/categories`;
    } else if (currentSource === 'cumlouder') {
      url = `${API_BASE}/api/cl/categories`;
    } else if (currentSource === 'upskirt') {
      url = `${API_BASE}/api/ut/categories`;
    }

    const res = await fetch(url);
    const data = await res.json();
    if (data.ok && data.categories) {
      categoriesBar.innerHTML = '';
      data.categories.forEach(cat => {
        const btn = document.createElement('button');
        btn.className = `cat-pill ${cat.slug === currentCategory ? 'active' : ''}`;
        btn.textContent = cat.name;
        btn.onclick = () => {
          document.querySelectorAll('.cat-pill').forEach(p => p.classList.remove('active'));
          btn.classList.add('active');
          currentCategory = cat.slug;
          searchQuery = '';
          if (searchInput) searchInput.value = '';
          currentPage = 1;
          sectionTitle.textContent = cat.name;
          loadVideos(true, 1);
        };
        categoriesBar.appendChild(btn);
      });
    }
  } catch (err) {
    console.error('Failed to load categories:', err);
  }
}

// ==========================================
// 3. Videos Loading & Rendering
// ==========================================
async function loadVideos(reset = false, targetPage = null) {
  if (isLoading) return;
  isLoading = true;

  if (targetPage !== null) {
    currentPage = targetPage;
  }

  if (reset) {
    videoGrid.innerHTML = '';
  }

  loader.classList.remove('hidden');
  if (paginationBar) paginationBar.classList.add('hidden');

  let apiUrl = '';

  if (searchQuery) {
    if (currentSource === 'viralmms') {
      apiUrl = `${API_BASE}/api/vmms/search?q=${encodeURIComponent(searchQuery)}&page=${currentPage}`;
    } else if (currentSource === 'kamababa') {
      apiUrl = `${API_BASE}/api/kmb/search?q=${encodeURIComponent(searchQuery)}&page=${currentPage}`;
    } else if (currentSource === 'usersporn') {
      apiUrl = `${API_BASE}/api/up/search?q=${encodeURIComponent(searchQuery)}&page=${currentPage}`;
    } else if (currentSource === 'cumlouder') {
      apiUrl = `${API_BASE}/api/cl/search?q=${encodeURIComponent(searchQuery)}&page=${currentPage}`;
    } else if (currentSource === 'upskirt') {
      apiUrl = `${API_BASE}/api/ut/search?q=${encodeURIComponent(searchQuery)}&page=${currentPage}`;
    } else {
      apiUrl = `${API_BASE}/api/search?q=${encodeURIComponent(searchQuery)}&page=${currentPage}`;
    }
    sectionTitle.textContent = `Search: "${searchQuery}" (Page ${currentPage})`;
  } else if (currentCategory && currentCategory !== 'all') {
    if (currentSource === 'viralmms') {
      apiUrl = `${API_BASE}/api/vmms/category/${encodeURIComponent(currentCategory)}?page=${currentPage}`;
    } else if (currentSource === 'kamababa') {
      apiUrl = `${API_BASE}/api/kmb/category/${encodeURIComponent(currentCategory)}?page=${currentPage}`;
    } else if (currentSource === 'usersporn') {
      apiUrl = `${API_BASE}/api/up/category/${encodeURIComponent(currentCategory)}?page=${currentPage}`;
    } else if (currentSource === 'cumlouder') {
      apiUrl = `${API_BASE}/api/cl/category/${encodeURIComponent(currentCategory)}?page=${currentPage}`;
    } else if (currentSource === 'upskirt') {
      apiUrl = `${API_BASE}/api/ut/browse?category=${encodeURIComponent(currentCategory)}&page=${currentPage}`;
    } else {
      apiUrl = `${API_BASE}/api/category/${encodeURIComponent(currentCategory)}?page=${currentPage}`;
    }
  } else {
    if (currentSource === 'viralmms') {
      apiUrl = `${API_BASE}/api/vmms/browse?page=${currentPage}`;
    } else if (currentSource === 'kamababa') {
      apiUrl = `${API_BASE}/api/kmb/browse?page=${currentPage}`;
    } else if (currentSource === 'usersporn') {
      apiUrl = `${API_BASE}/api/up/browse?page=${currentPage}`;
    } else if (currentSource === 'cumlouder') {
      apiUrl = `${API_BASE}/api/cl/browse?page=${currentPage}`;
    } else if (currentSource === 'upskirt') {
      apiUrl = `${API_BASE}/api/ut/browse?page=${currentPage}`;
    } else {
      apiUrl = `${API_BASE}/api/browse?page=${currentPage}&filter=${encodeURIComponent(currentFilter)}`;
    }
  }

  try {
    const res = await fetch(apiUrl);
    const data = await res.json();

    if (data.ok && data.videos && data.videos.length > 0) {
      renderVideos(data.videos);
      videoCount.textContent = `(Page ${data.page || currentPage} of ${data.totalPages || 'many'})`;
      renderPagination(data);
    } else {
      if (reset) {
        videoGrid.innerHTML = `
          <div class="empty-state">
            <p>No videos found. Try a different search or category.</p>
          </div>
        `;
      }
      if (paginationBar) paginationBar.classList.add('hidden');
    }
  } catch (err) {
    console.error('Failed to load videos:', err);
    if (reset) {
      videoGrid.innerHTML = `<div class="empty-state"><p>Error connecting to video catalog.</p></div>`;
    }
  } finally {
    isLoading = false;
    loader.classList.add('hidden');
  }
}

function renderPagination(data) {
  if (!paginationBar) return;
  const current = Number(data.page) || 1;
  const total = Number(data.totalPages) || 1;

  if (total <= 1) {
    paginationBar.classList.add('hidden');
    paginationBar.innerHTML = '';
    return;
  }

  paginationBar.classList.remove('hidden');
  paginationBar.innerHTML = '';

  const createBtn = (text, targetPage, isActive = false, isDisabled = false) => {
    const btn = document.createElement('button');
    btn.className = `page-btn ${isActive ? 'active' : ''} ${isDisabled ? 'disabled' : ''}`;
    btn.textContent = text;
    if (!isDisabled && !isActive) {
      btn.onclick = () => goToPage(targetPage);
    }
    return btn;
  };

  paginationBar.appendChild(createBtn('Previous', current - 1, false, current <= 1));

  let startPage = Math.max(1, current - 3);
  let endPage = Math.min(total, current + 3);

  if (current <= 4) endPage = Math.min(total, 7);
  if (current >= total - 3) startPage = Math.max(1, total - 6);

  if (startPage > 1) {
    paginationBar.appendChild(createBtn('1', 1, current === 1));
    if (startPage > 2) {
      const dots = document.createElement('span');
      dots.className = 'page-dots';
      dots.textContent = '...';
      paginationBar.appendChild(dots);
    }
  }

  for (let p = startPage; p <= endPage; p++) {
    paginationBar.appendChild(createBtn(String(p), p, p === current));
  }

  if (endPage < total) {
    if (endPage < total - 1) {
      const dots = document.createElement('span');
      dots.className = 'page-dots';
      dots.textContent = '...';
      paginationBar.appendChild(dots);
    }
    paginationBar.appendChild(createBtn(String(total), total, current === total));
  }

  paginationBar.appendChild(createBtn('Next', current + 1, false, current >= total));
  if (current < total) {
    paginationBar.appendChild(createBtn('Last', total, false, false));
  }
}

function goToPage(page) {
  currentPage = page;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  loadVideos(true, page);
}

/**
 * Mandatory Production Fix #1 & #2:
 * Render cards with referrerpolicy="no-referrer" and ISP-proof thumbnails
 */
function renderVideos(videos) {
  videos.forEach(v => {
    const card = document.createElement('div');
    card.className = 'video-card';
    card.dataset.id = v.id || '';
    card.onclick = () => openPlayer(v);

    // Resolve raw source image URL (unwrapped from /api/thumb or wsrv.nl)
    let sourceImg = v.rawThumb || v.rawPoster || '';
    if (!sourceImg && v.thumb) {
      if (v.thumb.includes('/api/thumb?url=')) {
        try {
          const match = v.thumb.match(/[?&]url=([^&]+)/);
          if (match) sourceImg = decodeURIComponent(match[1]);
        } catch (_) {}
      } else if (v.thumb.includes('wsrv.nl/?url=')) {
        try {
          const match = v.thumb.match(/[?&]url=([^&]+)/);
          if (match) sourceImg = decodeURIComponent(match[1]);
        } catch (_) {}
      } else if (v.thumb.startsWith('http')) {
        sourceImg = v.thumb;
      }
    }
    if (!sourceImg && v.poster && v.poster.startsWith('http') && !v.poster.includes('/api/thumb')) {
      sourceImg = v.poster;
    }

    // Primary Thumbnail: ALWAYS wsrv.nl edge CDN (0.00 KB VPS Bandwidth on normal page loads)
    let primaryThumb = '';
    if (v.thumb && v.thumb.includes('wsrv.nl/?url=')) {
      primaryThumb = v.thumb;
    } else if (sourceImg) {
      primaryThumb = `https://wsrv.nl/?url=${encodeURIComponent(sourceImg)}&w=480&output=webp`;
    } else if (v.thumb && !v.thumb.startsWith('/')) {
      primaryThumb = v.thumb;
    } else {
      primaryThumb = 'https://via.placeholder.com/320x180/202020/666666?text=Preview';
    }

    // Fallback Thumbnail: ONLY loaded via onerror if wsrv.nl edge fails
    const fallbackThumb = sourceImg 
      ? `${API_BASE}/api/thumb?url=${encodeURIComponent(sourceImg)}` 
      : '';

    card.innerHTML = `
      <div class="card-thumb-wrap">
        <img class="card-thumb" 
             src="${primaryThumb}" 
             alt="${v.title}" 
             loading="lazy" 
             referrerpolicy="no-referrer"
             onerror="if (!this.dataset.fallback && '${fallbackThumb}') { this.dataset.fallback = '1'; this.src = '${fallbackThumb}'; } else { this.src='https://via.placeholder.com/320x180/202020/666666?text=Preview'; }">
        <div class="card-badges">
          <span class="badge-hd">${v.qualityUrls ? '1080p HD' : (v.type === 'mp4' ? 'MP4' : 'HD')}</span>
          ${v.duration ? `<span class="badge-duration">${v.duration}</span>` : ''}
        </div>
        <div class="play-overlay">
          <div class="play-icon">▶</div>
        </div>
      </div>
      <div class="card-body">
        <h4 class="card-title" title="${v.title}">${v.title}</h4>
        <div class="card-meta">
          <span>${v.category ? '#' + v.category : (v.source === 'upskirt' ? '🔥 1080p HD' : '🔥 Featured')}</span>
          <span class="stream-pill">${v.source === 'upskirt' ? '⚡ Singapore CDN' : (v.qualityUrls ? '⚡ Multi-Q CDN' : (v.type === 'mp4' ? '⚡ Direct MP4' : 'HLS Direct'))}</span>
        </div>
      </div>
    `;

    // Instant Pre-Warm on hover / touchstart (cuts click-to-play wait time)
    if (!v.streamUrl) {
      const prewarm = () => {
        if (!card.dataset.prewarmed) {
          card.dataset.prewarmed = '1';
          if (currentSource === 'desi52' && (v.url || v.postUrl)) {
            fetch(`${API_BASE}/api/stream-info?url=${encodeURIComponent(v.url || v.postUrl)}`).catch(() => {});
          } else if (currentSource === 'cumlouder' && (v.id || v.slug)) {
            fetch(`${API_BASE}/api/cl/stream-info?id=${encodeURIComponent(v.id || v.slug)}`).catch(() => {});
          } else if (currentSource === 'usersporn' && (v.id || v.rawId)) {
            fetch(`${API_BASE}/api/up/stream-info?id=${encodeURIComponent(v.id || v.rawId)}`).catch(() => {});
          } else if (currentSource === 'upskirt' && (v.id || v.numericId)) {
            fetch(`${API_BASE}/api/ut/stream-info?id=${encodeURIComponent(v.id || v.numericId)}`).catch(() => {});
          }
        }
      };
      card.addEventListener('mouseenter', prewarm, { passive: true, once: true });
      card.addEventListener('touchstart', prewarm, { passive: true, once: true });
    }

    videoGrid.appendChild(card);
  });
}

// ==========================================
// 4. Netflix-Grade In-Page Video Player
// Synchronous Unmuted Tap + Zero VPS Bandwidth
// ==========================================
function showIspAlert() {
  if (stallWatchdog) clearTimeout(stallWatchdog);
  // Do not show error if video is actually playing
  if (nativePlayer && !nativePlayer.paused && nativePlayer.currentTime > 0.5) {
    return;
  }
  playerBuffering.classList.remove('hidden');
  playerBuffering.classList.add('clickable');

  const altSource = currentSource === 'desi52' ? 'kamababa' : (currentSource === 'kamababa' ? 'cumlouder' : 'kamababa');
  const altName = altSource === 'kamababa' ? '🔥 KamaBaba (Instant MP4)' : (altSource === 'cumlouder' ? '⚡ Cumlouder HD' : '🎬 Desi52');

  playerStatusText.innerHTML = `
    <div class="isp-alert-box">
      <span class="isp-alert-title">⚠️ Stream Blocked by ISP or Slow Connection?</span>
      <span class="isp-alert-desc">Indian telecoms (Jio, Airtel) frequently throttle or block adult video CDNs at DNS level. Switch your phone DNS to Cloudflare (1.1.1.1) or try another high-speed server.</span>
      <div class="isp-alert-actions">
        <button id="retry-isp-btn" class="cat-pill active">🔄 Retry</button>
        <button id="switch-desi-btn" class="cat-pill">${altName}</button>
        <button id="close-isp-btn" class="cat-pill">Close</button>
      </div>
    </div>
  `;

  const retryBtn = document.getElementById('retry-isp-btn');
  if (retryBtn) retryBtn.onclick = (e) => {
    e.stopPropagation();
    nativePlayer.load();
    nativePlayer.play().catch(() => {});
  };

  const switchBtn = document.getElementById('switch-desi-btn');
  if (switchBtn) switchBtn.onclick = (e) => {
    e.stopPropagation();
    setSource(altSource);
  };

  const closeBtn = document.getElementById('close-isp-btn');
  if (closeBtn) closeBtn.onclick = (e) => {
    e.stopPropagation();
    closePlayer();
  };
}

function startStallWatchdog() {
  if (stallWatchdog) clearTimeout(stallWatchdog);
  // 18-second generous watchdog to accommodate HLS chunk downloads on cellular/campus networks
  stallWatchdog = setTimeout(() => {
    if (nativePlayer.readyState < 2 && !nativePlayer.paused && nativePlayer.currentTime === 0) {
      console.warn('[Watchdog] Video stalled for > 18 seconds without receiving data. Displaying ISP prompt.');
      showIspAlert();
    }
  }, 18000);
}

function clearStallWatchdog() {
  if (stallWatchdog) {
    clearTimeout(stallWatchdog);
    stallWatchdog = null;
  }
}

async function openPlayer(video) {
  currentVideo = video;
  playerSection.classList.remove('hidden');
  playerTitle.textContent = video.title || 'Now Playing';
  playerBuffering.classList.remove('hidden');
  playerStatusText.textContent = 'Connecting clean stream...';
  unmuteBadge.classList.add('hidden');

  // Telegram WebApp Hardware BackButton binding
  if (tg?.BackButton) {
    tg.BackButton.show();
    tg.BackButton.onClick(closePlayer);
  }

  // Enforce mobile inline playback
  nativePlayer.pause();
  nativePlayer.src = '';
  nativePlayer.playsInline = true;
  nativePlayer.webkitPlaysInline = true;
  nativePlayer.setAttribute('playsinline', 'true');
  nativePlayer.setAttribute('webkit-playsinline', 'true');
  nativePlayer.setAttribute('x5-playsinline', 'true');
  nativePlayer.setAttribute('x5-video-player-type', 'h5-page');
  nativePlayer.setAttribute('referrerpolicy', 'no-referrer');

  if (hlsInstance) {
    hlsInstance.destroy();
    hlsInstance = null;
  }

  // Hook stall and error listeners
  nativePlayer.onwaiting = () => {
    startStallWatchdog();
    playerBuffering.classList.remove('hidden');
    playerBuffering.classList.remove('clickable');
    playerStatusText.textContent = 'Buffering...';
  };
  nativePlayer.onplaying = () => {
    clearStallWatchdog();
    playerBuffering.classList.add('hidden');
  };
  nativePlayer.oncanplay = () => {
    clearStallWatchdog();
    playerBuffering.classList.add('hidden');
  };
  nativePlayer.ontimeupdate = () => {
    if (!playerBuffering.classList.contains('hidden') && !nativePlayer.paused && nativePlayer.currentTime > 0.2) {
      clearStallWatchdog();
      playerBuffering.classList.add('hidden');
    }
  };
  nativePlayer.onerror = (e) => {
    // Ignore aborted loads (occurs when switching videos or resetting src)
    if (!nativePlayer.error || nativePlayer.error.code === 1) {
      return;
    }
    console.warn('[Player Error] Native video emitted error code:', nativePlayer.error.code, nativePlayer.error.message);

    // Failover for Cumlouder: First try self-healing fresh direct token, then fallback to sandboxed embed iframe
    if (currentSource === 'cumlouder' && currentVideo) {
      if (!currentVideo._hasAutoRetried) {
        currentVideo._hasAutoRetried = true;
        console.warn('[Cumlouder Self-Healing] Direct stream failed. Silently fetching fresh direct token from server...');
        playerStatusText.textContent = 'Refreshing stream token...';
        playerBuffering.classList.remove('hidden');
        fetch(`${API_BASE}/api/cl/stream-info?id=${encodeURIComponent(currentVideo.id || currentVideo.slug)}&force=1`)
          .then(r => r.json())
          .then(data => {
            if (data && data.ok && data.streamUrl) {
              currentVideo.streamUrl = data.streamUrl;
              nativePlayer.src = data.streamUrl;
              nativePlayer.load();
              nativePlayer.play().catch(() => {
                nativePlayer.muted = true;
                nativePlayer.play().catch(() => {});
                unmuteBadge.classList.remove('hidden');
              });
            } else if (currentVideo.embedUrl || currentVideo.numericId) {
              // Failover to Sandboxed Embed Engine
              console.warn('[Cumlouder Engine Failover] Switching to Sandboxed Embed Engine...');
              playerCdnBadge.textContent = '🛡️ Zero-Ad Sandboxed Embed';
              nativePlayer.classList.add('hidden');
              nativePlayer.pause();
              embedPlayer.classList.remove('hidden');
              embedPlayer.src = currentVideo.embedUrl || `https://www.cumlouder.com/embed/${currentVideo.numericId}/`;
              playerBuffering.classList.add('hidden');
            } else {
              showIspAlert();
            }
          })
          .catch(() => {
            if (currentVideo.embedUrl || currentVideo.numericId) {
              console.warn('[Cumlouder Engine Failover] Switching to Sandboxed Embed Engine...');
              playerCdnBadge.textContent = '🛡️ Zero-Ad Sandboxed Embed';
              nativePlayer.classList.add('hidden');
              nativePlayer.pause();
              embedPlayer.classList.remove('hidden');
              embedPlayer.src = currentVideo.embedUrl || `https://www.cumlouder.com/embed/${currentVideo.numericId}/`;
              playerBuffering.classList.add('hidden');
            } else {
              showIspAlert();
            }
          });
        return;
      }

      // If already retried direct token and still failed, switch to Sandboxed Embed Engine
      if ((currentVideo.embedUrl || currentVideo.numericId) && embedPlayer.classList.contains('hidden')) {
        console.warn('[Cumlouder Engine Failover] Switching to Sandboxed Embed Engine...');
        playerCdnBadge.textContent = '🛡️ Zero-Ad Sandboxed Embed';
        nativePlayer.classList.add('hidden');
        nativePlayer.pause();
        embedPlayer.classList.remove('hidden');
        embedPlayer.src = currentVideo.embedUrl || `https://www.cumlouder.com/embed/${currentVideo.numericId}/`;
        playerBuffering.classList.add('hidden');
        return;
      }
    }

    // Self-Healing for UsersPorn: Step-down quality or fetch fresh direct token
    if (currentSource === 'usersporn' && currentVideo) {
      // 1. Step-down quality if high quality failed (e.g. 1080p -> 720p -> 480p -> 360p)
      if (currentVideo.qualityUrls) {
        if (activeQuality === '1080p' && currentVideo.qualityUrls['720p']) {
          console.warn('[UsersPorn Step-Down] 1080p failed. Stepping down to 720p...');
          activeQuality = '720p';
          qualityBtns.forEach(b => b.classList.toggle('active', b.dataset.quality === activeQuality));
          nativePlayer.src = currentVideo.qualityUrls['720p'];
          nativePlayer.load();
          nativePlayer.play().catch(() => {});
          return;
        } else if ((activeQuality === '720p' || activeQuality === '1080p') && currentVideo.qualityUrls['480p']) {
          console.warn('[UsersPorn Step-Down] 720p failed. Stepping down to 480p...');
          activeQuality = '480p';
          qualityBtns.forEach(b => b.classList.toggle('active', b.dataset.quality === activeQuality));
          nativePlayer.src = currentVideo.qualityUrls['480p'];
          nativePlayer.load();
          nativePlayer.play().catch(() => {});
          return;
        } else if ((activeQuality === '480p' || activeQuality === '720p') && currentVideo.qualityUrls['360p']) {
          console.warn('[UsersPorn Step-Down] 480p failed. Stepping down to 360p...');
          activeQuality = '360p';
          qualityBtns.forEach(b => b.classList.toggle('active', b.dataset.quality === activeQuality));
          nativePlayer.src = currentVideo.qualityUrls['360p'];
          nativePlayer.load();
          nativePlayer.play().catch(() => {});
          return;
        }
      }

      // 2. Fresh Token Re-fetch: If token was expired or blocked
      if (!currentVideo._retriedFreshToken) {
        currentVideo._retriedFreshToken = true;
        console.warn('[UsersPorn Self-Healing] Stream failed. Silently fetching fresh direct token from server...');
        playerStatusText.textContent = 'Refreshing stream token...';
        playerBuffering.classList.remove('hidden');
        fetch(`${API_BASE}/api/up/stream-info?id=${encodeURIComponent(currentVideo.id || currentVideo.rawId)}&force=1`)
          .then(r => r.json())
          .then(data => {
            if (data && data.ok && data.streamUrl) {
              Object.assign(currentVideo, data);
              if (data.qualityUrls) {
                activeQuality = data.qualityUrls['720p'] ? '720p' : (data.qualityUrls['480p'] ? '480p' : '360p');
                qualityBtns.forEach(b => b.classList.toggle('active', b.dataset.quality === activeQuality));
              }
              const target = (currentVideo.qualityUrls && currentVideo.qualityUrls[activeQuality]) || currentVideo.streamUrl;
              nativePlayer.src = target;
              nativePlayer.load();
              nativePlayer.play().catch(() => {
                nativePlayer.muted = true;
                nativePlayer.play().catch(() => {});
                unmuteBadge.classList.remove('hidden');
              });
            } else {
              showIspAlert();
            }
          })
          .catch(() => showIspAlert());
        return;
      }
    }

    showIspAlert();
  };

  // Configure Quality Selector UI if qualityUrls present
  if (video.qualityUrls && qualitySelector) {
    qualitySelector.classList.remove('hidden');
    qualityBtns.forEach(btn => {
      const q = btn.dataset.quality;
      const hasUrl = Boolean(video.qualityUrls[q]);
      btn.classList.toggle('hidden', !hasUrl);
    });

    let defQ = '720p';
    if (video.defaultQuality === 'x3' && video.qualityUrls['1080p']) defQ = '1080p';
    else if (video.defaultQuality === 'x2' && video.qualityUrls['720p']) defQ = '720p';
    else if (video.defaultQuality === 'x1' && video.qualityUrls['480p']) defQ = '480p';
    else if (video.qualityUrls['720p']) defQ = '720p';
    else if (video.qualityUrls['480p']) defQ = '480p';
    else defQ = '360p';

    activeQuality = defQ;
    qualityBtns.forEach(b => b.classList.toggle('active', b.dataset.quality === activeQuality));
  } else if (qualitySelector) {
    qualitySelector.classList.add('hidden');
  }

  // ==========================================
  // Cumlouder Hybrid Dual-Engine Playback
  if (currentSource === 'cumlouder') {
    // Hot Window: Native HTML5 MP4 Engine (0ms start)
    if (video.streamUrl) {
      playerCdnBadge.textContent = '⚡ CDN77 Direct MP4';
      embedPlayer.classList.add('hidden');
      embedPlayer.src = '';
      nativePlayer.classList.remove('hidden');
      if (video.poster) nativePlayer.poster = video.poster;
      nativePlayer.src = video.streamUrl;
      nativePlayer.muted = false;
      startStallWatchdog();
      const playPromise = nativePlayer.play();
      if (playPromise !== undefined) {
        playPromise.then(() => {
          clearStallWatchdog();
          playerBuffering.classList.add('hidden');
          unmuteBadge.classList.add('hidden');
        }).catch(() => {
          nativePlayer.muted = true;
          nativePlayer.play().catch(() => {});
          unmuteBadge.classList.remove('hidden');
        });
      }
      return;
    }

    // Cold Archive: Resolve clean stream via server and play in Native Player (0ms on next tap)
    playerBuffering.classList.remove('hidden');
    playerStatusText.textContent = 'Resolving clean 1080p stream...';
    try {
      const res = await fetch(`${API_BASE}/api/cl/stream-info?id=${encodeURIComponent(video.id || video.slug)}`);
      const data = await res.json();
      if (data && data.ok) {
        Object.assign(video, data);
        currentVideo = video;
        if (data.streamUrl) {
          playerCdnBadge.textContent = '⚡ CDN77 Direct MP4';
          embedPlayer.classList.add('hidden');
          embedPlayer.src = '';
          nativePlayer.classList.remove('hidden');
          if (video.poster) nativePlayer.poster = video.poster;
          nativePlayer.src = data.streamUrl;
          nativePlayer.muted = false;
          startStallWatchdog();
          const playPromise = nativePlayer.play();
          if (playPromise !== undefined) {
            playPromise.then(() => {
              clearStallWatchdog();
              playerBuffering.classList.add('hidden');
              unmuteBadge.classList.add('hidden');
            }).catch(() => {
              nativePlayer.muted = true;
              nativePlayer.play().catch(() => {});
              unmuteBadge.classList.remove('hidden');
            });
          }
          return;
        } else if (data.embedUrl || video.numericId) {
          playerCdnBadge.textContent = '🛡️ Zero-Ad Sandboxed Embed';
          nativePlayer.classList.add('hidden');
          nativePlayer.pause();
          embedPlayer.classList.remove('hidden');
          embedPlayer.src = data.embedUrl || `https://www.cumlouder.com/embed/${video.numericId}/`;
          playerBuffering.classList.add('hidden');
          return;
        }
      }
      showIspAlert();
      return;
    } catch (e) {
      showIspAlert();
      return;
    }
  }

  // On-demand lazy resolution for cold or expired UsersPorn archive videos
  const nowSec = Math.floor(Date.now() / 1000);
  const isUpExpired = !video.streamUrl || (video.expiresAt && video.expiresAt <= nowSec + 300);
  if (currentSource === 'usersporn' && isUpExpired) {
    playerStatusText.textContent = 'Resolving clean HD stream...';
    try {
      const res = await fetch(`${API_BASE}/api/up/stream-info?id=${encodeURIComponent(video.id || video.rawId)}&force=1`);
      const data = await res.json();
      if (data.ok && data.streamUrl) {
        Object.assign(video, data);
        currentVideo = video;
        if (video.qualityUrls && qualitySelector) {
          qualitySelector.classList.remove('hidden');
          qualityBtns.forEach(btn => {
            const q = btn.dataset.quality;
            btn.classList.toggle('hidden', !video.qualityUrls[q]);
          });
          let defQ = '720p';
          if (video.defaultQuality === 'x3' && video.qualityUrls['1080p']) defQ = '1080p';
          else if (video.defaultQuality === 'x2' && video.qualityUrls['720p']) defQ = '720p';
          else if (video.defaultQuality === 'x1' && video.qualityUrls['480p']) defQ = '480p';
          else if (video.qualityUrls['720p']) defQ = '720p';
          else if (video.qualityUrls['480p']) defQ = '480p';
          else defQ = '360p';
          activeQuality = defQ;
          qualityBtns.forEach(b => b.classList.toggle('active', b.dataset.quality === activeQuality));
        }
      } else {
        showIspAlert();
        return;
      }
    } catch (e) {
      showIspAlert();
      return;
    }
  }

  // On-demand lazy resolution for cold Upskirt videos
  if (currentSource === 'upskirt' && !video.streamUrl) {
    playerStatusText.textContent = 'Resolving clean 1080p stream...';
    try {
      const res = await fetch(`${API_BASE}/api/ut/stream-info?id=${encodeURIComponent(video.id || video.numericId)}`);
      const data = await res.json();
      if (data && data.ok && data.streamUrl) {
        Object.assign(video, data);
        currentVideo = video;
      } else {
        showIspAlert();
        return;
      }
    } catch (e) {
      showIspAlert();
      return;
    }
  }

  // Determine if direct MP4 or HLS
  const isDirectMp4 = video.type === 'mp4' || 
    (video.streamUrl && video.streamUrl.endsWith('.mp4')) || 
    (video.streamUrl && video.streamUrl.includes('cdn.mykamababa.com')) ||
    (video.streamUrl && video.streamUrl.includes('mjedge.net')) ||
    (video.streamUrl && video.streamUrl.includes('spac.me'));

  // ==========================================
  // Mandatory Production Fix #3:
  // Synchronous Unmuted Play on Tap (Direct MP4)
  // ==========================================
  if (isDirectMp4 && video.streamUrl) {
    playerCdnBadge.textContent = (video.source === 'upskirt' || currentSource === 'upskirt')
      ? '⚡ Singapore Fast CDN (1080p)'
      : (video.qualityUrls ? '⚡ Spac.me Direct CDN' : '⚡ Direct MP4 CDN');
    embedPlayer.classList.add('hidden');
    embedPlayer.src = '';
    nativePlayer.classList.remove('hidden');
    if (video.poster) nativePlayer.poster = video.poster;

    const initialStreamUrl = (video.qualityUrls && video.qualityUrls[activeQuality]) || video.streamUrl;
    nativePlayer.src = initialStreamUrl;
    nativePlayer.muted = false; // Synchronous unmuted request inside click stack

    startStallWatchdog();
    const playPromise = nativePlayer.play();
    if (playPromise !== undefined) {
      playPromise.then(() => {
        clearStallWatchdog();
        playerBuffering.classList.add('hidden');
        unmuteBadge.classList.add('hidden');
      }).catch((err) => {
        console.log('[Autoplay] Unmuted autoplay prevented by browser policy, falling back to muted:', err.message);
        nativePlayer.muted = true;
        nativePlayer.play().catch(() => {});
        unmuteBadge.classList.remove('hidden');
      });
    }
    return;
  }

  // ==========================================
  // Desi52 HLS Stream Pipeline
  // ==========================================
  playerCdnBadge.textContent = '⚡ Direct HLS CDN';
  try {
    let data = null;

    if (video.streamUrl && video.rawUrl) {
      data = {
        ok: true,
        type: 'hls',
        streamUrl: video.streamUrl,
        rawUrl: video.rawUrl,
        poster: video.poster || video.thumb,
        title: video.title
      };
    } else {
      const res = await fetch(`${API_BASE}/api/stream-info?url=${encodeURIComponent(video.url || video.postUrl)}`);
      data = await res.json();
    }

    if (!data || !data.ok || (!data.rawUrl && !data.streamUrl)) {
      showIspAlert();
      return;
    }

    embedPlayer.classList.add('hidden');
    embedPlayer.src = '';
    nativePlayer.classList.remove('hidden');
    if (data.poster) nativePlayer.poster = data.poster;

    if (Hls.isSupported()) {
      hlsInstance = new Hls({
        enableWorker: true,
        progressive: true,
        lowLatencyMode: true,
        maxBufferLength: 8,
        maxMaxBufferLength: 15,
        maxBufferSize: 15 * 1000 * 1000,
        maxBufferHole: 0.5,
        highBufferWatchdogPeriod: 2,
        nudgeOffset: 0.2,
        nudgeMaxRetry: 5,
        startFragPrefetch: true,
        fragLoadingTimeOut: 20000,
        fragLoadingMaxRetry: 4
      });

      const fullStreamUrl = data.streamUrl 
        ? (data.streamUrl.startsWith('http') ? data.streamUrl : `${API_BASE}${data.streamUrl}`)
        : data.rawUrl;

      hlsInstance.loadSource(fullStreamUrl);
      hlsInstance.attachMedia(nativePlayer);

      hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
        nativePlayer.muted = false;
        const playPromise = nativePlayer.play();
        if (playPromise !== undefined) {
          playPromise.then(() => {
            playerBuffering.classList.add('hidden');
            unmuteBadge.classList.add('hidden');
          }).catch(() => {
            nativePlayer.muted = true;
            nativePlayer.play().catch(() => {});
            unmuteBadge.classList.remove('hidden');
          });
        }
      });

      hlsInstance.on(Hls.Events.ERROR, (event, errData) => {
        if (errData.fatal) {
          switch (errData.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.warn('[HLS] Network error encountered, attempting automatic recovery...', errData.details);
              hlsInstance.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.warn('[HLS] Media buffer error encountered, attempting recovery...', errData.details);
              hlsInstance.recoverMediaError();
              break;
            default:
              console.error('[HLS] Unrecoverable fatal error:', errData);
              showIspAlert();
              break;
          }
        }
      });
    } else if (nativePlayer.canPlayType('application/vnd.apple.mpegurl')) {
      nativePlayer.src = data.streamUrl || data.rawUrl;
      nativePlayer.play().catch(() => {
        nativePlayer.muted = true;
        nativePlayer.play().catch(() => {});
        unmuteBadge.classList.remove('hidden');
      });
    }
  } catch (err) {
    console.error('HLS setup error:', err);
    showIspAlert();
  }
}

function closePlayer() {
  clearStallWatchdog();
  playerSection.classList.add('hidden');
  nativePlayer.pause();
  nativePlayer.src = '';
  if (qualitySelector) qualitySelector.classList.add('hidden');
  currentVideo = null;
  if (embedPlayer) {
    embedPlayer.src = '';
    embedPlayer.classList.add('hidden');
  }
  if (hlsInstance) {
    hlsInstance.destroy();
    hlsInstance = null;
  }
  if (unmuteBadge) unmuteBadge.classList.add('hidden');
  if (tg?.BackButton) tg.BackButton.hide();
}

closePlayerBtn.onclick = closePlayer;

// Unmute Badge Handler
if (unmuteBadge) {
  unmuteBadge.onclick = (e) => {
    e.stopPropagation();
    nativePlayer.muted = false;
    unmuteBadge.classList.add('hidden');
  };
}

// Double-Tap Seek Handlers (+10s / -10s)
let lastTapTime = 0;
if (playerWrapper) {
  playerWrapper.addEventListener('click', (e) => {
    const now = Date.now();
    const rect = playerWrapper.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const isLeft = x < rect.width * 0.4;
    const isRight = x > rect.width * 0.6;

    if (now - lastTapTime < 350) {
      // Double tap detected
      if (isLeft) {
        nativePlayer.currentTime = Math.max(0, nativePlayer.currentTime - 10);
        showSeekIndicator(seekOverlayLeft);
      } else if (isRight) {
        nativePlayer.currentTime = Math.min(nativePlayer.duration || 9999, nativePlayer.currentTime + 10);
        showSeekIndicator(seekOverlayRight);
      }
    }
    lastTapTime = now;
  });
}

function showSeekIndicator(el) {
  if (!el) return;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 700);
}

// Playback Speed Selector
speedBtns.forEach(btn => {
  btn.onclick = () => {
    speedBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const speed = parseFloat(btn.dataset.speed) || 1.0;
    nativePlayer.playbackRate = speed;
  };
});

// ==========================================
// 5. Events & Search Controls
// ==========================================
filterBtns.forEach(btn => {
  btn.onclick = () => {
    filterBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    searchQuery = '';
    if (searchInput) searchInput.value = '';
    sectionTitle.textContent = `${btn.textContent} Releases`;
    loadVideos(true, 1);
  };
});

function handleSearch() {
  const query = searchInput.value.trim();
  if (!query) return;
  searchQuery = query;
  currentPage = 1;
  loadVideos(true, 1);
}

if (searchBtn) searchBtn.onclick = handleSearch;
if (searchInput) {
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSearch();
  });
}

// Keyboard shortcuts (Space = play/pause, Left/Right = seek 5s, F = fullscreen)
document.addEventListener('keydown', (e) => {
  if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
  if (playerSection.classList.contains('hidden')) return;

  if (e.code === 'Space') {
    e.preventDefault();
    if (nativePlayer.paused) nativePlayer.play();
    else nativePlayer.pause();
  } else if (e.code === 'ArrowLeft') {
    e.preventDefault();
    nativePlayer.currentTime = Math.max(0, nativePlayer.currentTime - 5);
    showSeekIndicator(seekOverlayLeft);
  } else if (e.code === 'ArrowRight') {
    e.preventDefault();
    nativePlayer.currentTime = Math.min(nativePlayer.duration || 9999, nativePlayer.currentTime + 5);
    showSeekIndicator(seekOverlayRight);
  } else if (e.code === 'KeyF') {
    e.preventDefault();
    if (nativePlayer.requestFullscreen) {
      nativePlayer.requestFullscreen();
    }
  }
});

// Initialize App
const urlParams = new URLSearchParams(window.location.search);
const initSource = urlParams.get('source');
if (initSource && ['kamababa', 'viralmms', 'desi52', 'usersporn', 'cumlouder', 'upskirt'].includes(initSource.toLowerCase())) {
  setSource(initSource.toLowerCase());
} else {
  document.querySelectorAll('.source-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.source === currentSource);
  });
  loadCategories();
  loadVideos(true, 1);
}
