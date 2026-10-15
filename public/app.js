// ==========================================
// Universal AdBlock & Popup Shield
// Blocks all popups, redirect tabs, and malicious APK triggers
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
}

// State
let currentCategory = '';
let currentFilter = 'latest';
let searchQuery = '';
let currentPage = 1;
let isLoading = false;
let hlsInstance = null;

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

// Player Elements
const playerSection = document.getElementById('player-section');
const closePlayerBtn = document.getElementById('close-player-btn');
const playerTitle = document.getElementById('player-video-title');
const nativePlayer = document.getElementById('native-player');
const embedPlayer = document.getElementById('embed-player');
const playerBuffering = document.getElementById('player-buffering');
const playerStatusText = document.getElementById('player-status-text');

// Base API URL (empty for same origin, or configure for Netlify standalone frontend)
const API_BASE = window.API_BASE_URL || '';

// ==========================================
// 1. Categories Loading
// ==========================================
async function loadCategories() {
  try {
    const res = await fetch(`${API_BASE}/api/categories`);
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
          searchInput.value = '';
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
// 2. Videos Loading & Rendering
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
    apiUrl = `${API_BASE}/api/search?q=${encodeURIComponent(searchQuery)}&page=${currentPage}`;
    sectionTitle.textContent = `Search: "${searchQuery}" (Page ${currentPage})`;
  } else if (currentCategory) {
    apiUrl = `${API_BASE}/api/category/${encodeURIComponent(currentCategory)}?page=${currentPage}`;
  } else {
    apiUrl = `${API_BASE}/api/browse?page=${currentPage}&filter=${encodeURIComponent(currentFilter)}`;
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
      videoGrid.innerHTML = `<div class="empty-state"><p>Error connecting to stream server.</p></div>`;
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

  // 1. Previous button
  paginationBar.appendChild(createBtn('Previous', current - 1, false, current <= 1));

  // Determine window of page numbers (e.g., 1 2 [3] 4 5 6 7)
  let startPage = Math.max(1, current - 3);
  let endPage = Math.min(total, current + 3);

  if (current <= 4) {
    endPage = Math.min(total, 7);
  }
  if (current >= total - 3) {
    startPage = Math.max(1, total - 6);
  }

  // First page shortcut if window doesn't start at 1
  if (startPage > 1) {
    paginationBar.appendChild(createBtn('1', 1, current === 1));
    if (startPage > 2) {
      const dots = document.createElement('span');
      dots.className = 'page-dots';
      dots.textContent = '...';
      paginationBar.appendChild(dots);
    }
  }

  // Numbered buttons
  for (let p = startPage; p <= endPage; p++) {
    paginationBar.appendChild(createBtn(String(p), p, p === current));
  }

  // Last page shortcut if window doesn't reach total
  if (endPage < total) {
    if (endPage < total - 1) {
      const dots = document.createElement('span');
      dots.className = 'page-dots';
      dots.textContent = '...';
      paginationBar.appendChild(dots);
    }
    paginationBar.appendChild(createBtn(String(total), total, current === total));
  }

  // Next button
  paginationBar.appendChild(createBtn('Next', current + 1, false, current >= total));

  // Last button
  if (current < total) {
    paginationBar.appendChild(createBtn('Last', total, false, false));
  }
}

function goToPage(page) {
  currentPage = page;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  loadVideos(true, page);
}

function renderVideos(videos) {
  videos.forEach(v => {
    const card = document.createElement('div');
    card.className = 'video-card';
    card.dataset.url = v.url;
    card.onclick = () => openPlayer(v);

    card.innerHTML = `
      <div class="card-thumb-wrap">
        <img class="card-thumb" src="${v.thumb}" alt="${v.title}" loading="lazy" onerror="this.src='https://via.placeholder.com/320x180/202020/666666?text=Preview';">
        <div class="card-badges">
          ${v.isHD ? '<span class="badge-hd">HD</span>' : ''}
          ${v.duration ? `<span class="badge-duration">${v.duration}</span>` : ''}
        </div>
        <div class="play-overlay">
          <div class="play-icon">▶</div>
        </div>
      </div>
      <div class="card-body">
        <h4 class="card-title" title="${v.title}">${v.title}</h4>
        <div class="card-meta">
          <span>👁 ${v.views || '0'} views</span>
          <span class="stream-pill">Fast Stream</span>
        </div>
      </div>
    `;

    videoGrid.appendChild(card);
  });
}

// ==========================================
// 3. YouTube / Netflix Style In-Page Player
// ==========================================
async function openPlayer(video) {
  playerSection.classList.remove('hidden');
  playerTitle.textContent = video.title || 'Now Playing';
  playerBuffering.classList.remove('hidden');
  playerStatusText.textContent = 'Connecting clean stream...';

  // Strictly enforce inline playback to prevent mobile OS fullscreen takeover
  nativePlayer.pause();
  nativePlayer.src = '';
  nativePlayer.playsInline = true;
  nativePlayer.webkitPlaysInline = true;
  nativePlayer.muted = true; // Muted startup guarantees inline playback without browser blocking or fullscreen popups
  nativePlayer.setAttribute('playsinline', 'true');
  nativePlayer.setAttribute('webkit-playsinline', 'true');
  nativePlayer.setAttribute('x5-playsinline', 'true');
  nativePlayer.setAttribute('x5-video-player-type', 'h5-page');

  if (hlsInstance) {
    hlsInstance.destroy();
    hlsInstance = null;
  }

  // Hook buffer state listeners with debounce to prevent flashing overlays
  let bufferTimeout = null;
  nativePlayer.onwaiting = () => {
    if (bufferTimeout) clearTimeout(bufferTimeout);
    bufferTimeout = setTimeout(() => {
      if (!nativePlayer.paused) {
        playerBuffering.classList.remove('hidden');
        playerBuffering.classList.remove('clickable');
        playerStatusText.textContent = 'Buffering...';
      }
    }, 1200);
  };
  nativePlayer.onplaying = () => {
    if (bufferTimeout) clearTimeout(bufferTimeout);
    playerBuffering.classList.add('hidden');
    playerBuffering.classList.remove('clickable');
  };
  nativePlayer.oncanplay = () => {
    if (bufferTimeout) clearTimeout(bufferTimeout);
    playerBuffering.classList.add('hidden');
  };
  nativePlayer.ontimeupdate = () => {
    if (nativePlayer.currentTime > 0.05) {
      if (bufferTimeout) clearTimeout(bufferTimeout);
      playerBuffering.classList.add('hidden');
      playerBuffering.classList.remove('clickable');
    }
  };

  try {
    let data = null;
    let lastError = null;

    // Resilient stream resolution: up to 3 automatic attempts
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        playerStatusText.textContent = attempt === 1 
          ? 'Connecting to secure stream...' 
          : `Connecting to stream (attempt ${attempt}/3)...`;
        
        const res = await fetch(`${API_BASE}/api/stream-info?url=${encodeURIComponent(video.url)}`);
        const json = await res.json();
        
        if (json.ok && (json.type === 'hls' || json.type === 'embed') && (json.rawUrl || json.streamUrl || json.embedUrl)) {
          data = json;
          break;
        } else {
          lastError = json.error || 'Stream not ready';
        }
      } catch (e) {
        lastError = e.message;
      }

      if (attempt < 3) {
        await new Promise(r => setTimeout(r, 800));
      }
    }

    if (!data || !data.ok || (!data.rawUrl && !data.streamUrl)) {
      playerBuffering.classList.remove('hidden');
      playerBuffering.classList.add('clickable');
      playerStatusText.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;gap:10px;padding:12px;text-align:center;">
          <span style="font-size:14px;color:#fff;font-weight:600;">⚡ Stream Initializing</span>
          <span style="font-size:12px;color:#bbb;">Server is connecting to the video stream.</span>
          <div style="display:flex;gap:10px;margin-top:6px;">
            <button id="retry-open-btn" style="background:#e50914;color:#fff;border:none;padding:7px 18px;border-radius:18px;cursor:pointer;font-weight:600;font-size:13px;">🔄 Tap to Retry</button>
            <button onclick="closePlayer()" style="background:#333;color:#ccc;border:none;padding:7px 14px;border-radius:18px;cursor:pointer;font-size:13px;">Close</button>
          </div>
        </div>
      `;
      const retryBtn = document.getElementById('retry-open-btn');
      if (retryBtn) {
        retryBtn.onclick = (e) => {
          e.stopPropagation();
          openPlayer(video);
        };
      }
      return;
    }

    if (data.type === 'hls' && (data.rawUrl || data.streamUrl)) {
      embedPlayer.classList.add('hidden');
      embedPlayer.src = '';
      nativePlayer.classList.remove('hidden');
      playerStatusText.textContent = 'Starting direct stream...';
      if (data.poster) nativePlayer.poster = data.poster;

      if (Hls.isSupported()) {
        hlsInstance = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          maxBufferLength: 30,             // 30s forward buffer prevents socket starvation on mobile
          maxMaxBufferLength: 60,          // Max 60s buffer
          maxBufferSize: 60 * 1024 * 1024, // 60 MB buffer
          startFragPrefetch: true,         // Prefetch next chunk immediately
          backBufferLength: 30,            // 30s back buffer for smooth rewinding
          maxBufferHole: 0.5,              // Smooth jump over minor stream gaps
          highBufferWatchdogPeriod: 2
        });

        // Prefer direct raw CDN URL for Hls.js (bypasses serverless proxy hops)
        const streamSource = data.rawUrl || data.streamUrl;
        hlsInstance.loadSource(streamSource);
        hlsInstance.attachMedia(nativePlayer);
        
        hlsInstance.on(Hls.Events.MANIFEST_PARSED, (event, manifestData) => {
          playerBuffering.classList.add('hidden');

          // Bitrate & Resolution Clamping: Cap to 720p to prevent mobile buffer starvation from France origin
          if (manifestData && manifestData.levels && manifestData.levels.length > 1) {
            let maxLevelIdx = -1;
            for (let i = 0; i < manifestData.levels.length; i++) {
              const lvl = manifestData.levels[i];
              if ((lvl.height && lvl.height <= 720) || (lvl.bitrate && lvl.bitrate <= 2500000)) {
                maxLevelIdx = i;
              }
            }
            if (maxLevelIdx !== -1) {
              hlsInstance.autoLevelCapping = maxLevelIdx;
            }
          }

          const playPromise = nativePlayer.play();
          if (playPromise !== undefined) {
            playPromise.then(() => {
              // Playback successfully started
            }).catch(e => {
              console.log('Autoplay muted result:', e);
              playerStatusText.textContent = '▶ Tap to Play';
              playerBuffering.classList.remove('hidden');
              playerBuffering.classList.add('clickable');
              playerBuffering.onclick = () => {
                nativePlayer.muted = false;
                nativePlayer.play();
                playerBuffering.classList.add('hidden');
              };
            });
          }
        });

        // Unmute on first user tap inside the player
        nativePlayer.onclick = () => {
          if (nativePlayer.muted) {
            nativePlayer.muted = false;
          }
        };

        hlsInstance.on(Hls.Events.ERROR, (event, errData) => {
          console.warn('[HLS Error]:', errData.details, errData.type);
          
          // Auto-recovery for buffer stalls: immediately nudge playback and step down bitrate
          if (errData.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR || 
              errData.details === Hls.ErrorDetails.BUFFER_NUDGE_ON_STALL) {
            console.log('[HLS] Nudging video over buffer stall and scaling bitrate down...');
            if (hlsInstance.currentLevel > 0) {
              hlsInstance.nextLevel = Math.max(0, hlsInstance.currentLevel - 1);
            }
            if (nativePlayer && !nativePlayer.paused && nativePlayer.duration > 0) {
              nativePlayer.currentTime += 0.2;
            }
            return;
          }

          if (errData.fatal) {
            console.warn('[HLS Fatal Error]:', errData.type, errData.details);
            switch (errData.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                console.log('[HLS] Recovering from network error...');
                hlsInstance.startLoad();
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                console.log('[HLS] Recovering from media error...');
                hlsInstance.recoverMediaError();
                break;
              default:
                console.error('[HLS] Unrecoverable error encountered');
                if (hlsInstance) {
                  hlsInstance.destroy();
                  hlsInstance = null;
                }
                playerBuffering.classList.remove('hidden');
                playerBuffering.classList.add('clickable');
                playerStatusText.innerHTML = `
                  <div style="display:flex;flex-direction:column;align-items:center;gap:10px;">
                    <span style="font-size:13px;color:#ccc;">Stream connection interrupted</span>
                    <button id="retry-stream-btn" style="background:#e50914;color:#fff;border:none;padding:7px 18px;border-radius:20px;font-size:13px;font-weight:600;cursor:pointer;">🔄 Tap to Retry</button>
                  </div>
                `;
                const retryBtn = document.getElementById('retry-stream-btn');
                if (retryBtn) {
                  retryBtn.onclick = (e) => {
                    e.stopPropagation();
                    openPlayer(video);
                  };
                }
                break;
            }
          }
        });
      } else if (nativePlayer.canPlayType('application/vnd.apple.mpegurl')) {
        // Native Apple iOS Safari / Telegram WebView HLS Support
        // Explicitly load the iOS-compatible playlist with corrected video/mp2t MIME types
        const iosStreamUrl = `${API_BASE}/api/live.m3u8?url=${encodeURIComponent(data.rawUrl || data.streamUrl)}&ios=1`;
        nativePlayer.src = iosStreamUrl;
        nativePlayer.addEventListener('loadedmetadata', () => {
          playerBuffering.classList.add('hidden');
          nativePlayer.play().catch(e => {
            console.log('iOS Autoplay:', e);
            playerStatusText.textContent = '▶ Tap to Play';
            playerBuffering.classList.remove('hidden');
            playerBuffering.classList.add('clickable');
            playerBuffering.onclick = () => {
              nativePlayer.muted = false;
              nativePlayer.play();
              playerBuffering.classList.add('hidden');
            };
          });
        }, { once: true });

        nativePlayer.onclick = () => {
          if (nativePlayer.muted) {
            nativePlayer.muted = false;
          }
        };
      } else {
        throw new Error('Your browser does not support HLS video streaming.');
      }
    }
  } catch (err) {
    console.error('Player error:', err);
    playerBuffering.classList.remove('hidden');
    playerBuffering.classList.add('clickable');
    playerStatusText.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;gap:10px;padding:12px;text-align:center;">
        <span style="font-size:14px;color:#fff;font-weight:600;">⚡ Connection Hiccup</span>
        <span style="font-size:12px;color:#bbb;">Playback encountered a hiccup.</span>
        <div style="display:flex;gap:10px;margin-top:6px;">
          <button id="retry-open-btn2" style="background:#e50914;color:#fff;border:none;padding:7px 18px;border-radius:18px;cursor:pointer;font-weight:600;font-size:13px;">🔄 Tap to Retry</button>
          <button onclick="closePlayer()" style="background:#333;color:#ccc;border:none;padding:7px 14px;border-radius:18px;cursor:pointer;font-size:13px;">Close</button>
        </div>
      </div>
    `;
    const retryBtn = document.getElementById('retry-open-btn2');
    if (retryBtn) {
      retryBtn.onclick = (e) => {
        e.stopPropagation();
        openPlayer(video);
      };
    }
  }
}

function closePlayer() {
  playerSection.classList.add('hidden');
  nativePlayer.pause();
  nativePlayer.src = '';
  if (embedPlayer) {
    embedPlayer.src = '';
    embedPlayer.classList.add('hidden');
  }
  if (hlsInstance) {
    hlsInstance.destroy();
    hlsInstance = null;
  }
}

closePlayerBtn.onclick = closePlayer;

// ==========================================
// 4. Events & Search Controls
// ==========================================
filterBtns.forEach(btn => {
  btn.onclick = () => {
    filterBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    searchQuery = '';
    searchInput.value = '';
    sectionTitle.textContent = `${btn.textContent} Releases`;
    loadVideos(true);
  };
});

function handleSearch() {
  const query = searchInput.value.trim();
  if (!query) return;
  searchQuery = query;
  currentPage = 1;
  loadVideos(true);
}

searchBtn.onclick = handleSearch;
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleSearch();
});

// Initialize App
loadCategories();
loadVideos(true, 1);
