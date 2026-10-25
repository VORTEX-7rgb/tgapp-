// ============================================================================
// FIZIIII PRO — Unified YouTube & Shorts Hybrid Engine
// High Performance • Zero VPS Bandwidth • Direct CDN Streaming
// ============================================================================

(function() {
  'use strict';

  // Telegram WebApp Setup
  const tg = window.Telegram?.WebApp;
  if (tg) {
    try {
      tg.ready();
      tg.expand();
      if (tg.enableClosingConfirmation) tg.enableClosingConfirmation();
    } catch(e) {}
  }

  function triggerHaptic(type = 'light') {
    if (!tg?.HapticFeedback) return;
    try {
      if (type === 'selection') tg.HapticFeedback.selectionChanged();
      else if (type === 'light') tg.HapticFeedback.impactOccurred('light');
      else if (type === 'medium') tg.HapticFeedback.impactOccurred('medium');
      else if (type === 'heavy') tg.HapticFeedback.impactOccurred('heavy');
      else if (type === 'success') tg.HapticFeedback.notificationOccurred('success');
    } catch(e) {}
  }

  // State
  let currentProvider = 'all';
  let currentCategory = '';
  let searchQuery = '';
  let currentPage = 1;
  let isLoading = false;
  let hasMore = true;
  let searchTimer = null;
  let currentVideo = null;
  let reelsShelfList = [];
  const savedVault = new Map();

  // Cinema Real-Time SBRS Taste Profiling & Anonymous Session Adaptation
  const CINEMA_TASTE_KEY = 'fiziiii_cinema_taste_v1';
  const CINEMA_SEEN_KEY = 'fiziiii_cinema_seen_v1';
  let userCinemaTaste = new Map();
  let cinemaSeenQueue = [];
  const renderedVideoIds = new Set();

  try {
    const rawT = JSON.parse(localStorage.getItem(CINEMA_TASTE_KEY) || '{}');
    Object.entries(rawT).forEach(([k, v]) => userCinemaTaste.set(k, Number(v)));
    const rawS = JSON.parse(localStorage.getItem(CINEMA_SEEN_KEY) || '[]');
    if (Array.isArray(rawS)) cinemaSeenQueue = rawS;
  } catch(e) {}

  function saveCinemaTaste() {
    try {
      const obj = Object.fromEntries(userCinemaTaste);
      localStorage.setItem(CINEMA_TASTE_KEY, JSON.stringify(obj));
      localStorage.setItem(CINEMA_SEEN_KEY, JSON.stringify(cinemaSeenQueue.slice(-100)));
    } catch(e) {}
  }

  // Load Saved Vault
  try {
    const raw = localStorage.getItem('fiziiii_saved_v1');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        parsed.forEach(item => { if (item?.id) savedVault.set(item.id, item); });
      }
    }
  } catch(e) {}

  // DOM Elements
  const searchInput = document.getElementById('search-input');
  const providerTabs = document.querySelectorAll('.provider-chip');
  const categoriesBar = document.getElementById('categories-bar');
  const cinemaGrid = document.getElementById('cinema-grid');
  const cinemaLoader = document.getElementById('cinema-loader');
  const sectionTitle = document.getElementById('section-title');
  const sectionCount = document.getElementById('section-count');
  
  // Watch View Portal Elements
  const watchPortal = document.getElementById('watch-view-portal');
  const watchBackBtn = document.getElementById('watch-back-btn');
  const watchCloseTopBtn = document.getElementById('watch-close-top-btn');
  const watchShareTopBtn = document.getElementById('watch-share-top-btn');
  const watchShareBtn = document.getElementById('watch-share-btn');
  const watchCopyBtn = document.getElementById('watch-copy-btn');
  const watchSaveLabel = document.getElementById('watch-save-label');
  const watchRelatedGrid = document.getElementById('watch-related-grid');
  const watchRelatedLoader = document.getElementById('watch-related-loader');
  const watchRelatedCount = document.getElementById('watch-related-count');
  
  // Player Core Elements
  const theaterVideo = document.getElementById('theater-video');
  const theaterIframe = document.getElementById('theater-iframe');
  const theaterTitle = document.getElementById('theater-title');
  const theaterSource = document.getElementById('theater-source');
  const theaterDuration = document.getElementById('theater-duration');
  const theaterViews = document.getElementById('theater-views');
  const theaterHashtags = document.getElementById('theater-hashtags');
  const theaterUnmute = document.getElementById('theater-unmute');
  const theaterBuffering = document.getElementById('theater-buffering');
  const theaterSaveBtn = document.getElementById('theater-save-btn');
  const qualitySelector = document.getElementById('theater-quality-selector');
  const speedBtns = document.querySelectorAll('.speed-btn');
  const seekOverlayLeft = document.getElementById('seek-overlay-left');
  const seekOverlayRight = document.getElementById('seek-overlay-right');

  // Reels Shelf Elements
  const reelsCarousel = document.getElementById('reels-carousel');
  const reelsShelfCount = document.getElementById('reels-shelf-count');
  const shelfOpenAllBtn = document.getElementById('shelf-open-all-btn');
  const topReelsBtn = document.getElementById('top-reels-btn');

  // Fullscreen Reels Overlay Elements
  const reelsOverlay = document.getElementById('reels-overlay-portal');
  const reelsOverlayClose = document.getElementById('reels-overlay-close');

  // Vault Drawer
  const vaultBtn = document.getElementById('vault-btn');
  const vaultBadge = document.getElementById('vault-count-badge');
  const vaultBackdrop = document.getElementById('vault-backdrop');
  const vaultDrawer = document.getElementById('vault-drawer');
  const vaultList = document.getElementById('vault-list');
  const vaultCloseBtn = document.getElementById('vault-close-btn');

  // ============================================================================
  // PRE-WARMING & BUFFER ACCELERATOR
  // ============================================================================
  const prewarmedHosts = new Set();
  function prewarmConnection(url) {
    if (!url) return;
    try {
      const host = new URL(url).hostname;
      if (prewarmedHosts.has(host)) return;
      prewarmedHosts.add(host);
      
      const link1 = document.createElement('link');
      link1.rel = 'preconnect';
      link1.href = `https://${host}`;
      link1.crossOrigin = '';
      document.head.appendChild(link1);

      const link2 = document.createElement('link');
      link2.rel = 'dns-prefetch';
      link2.href = `https://${host}`;
      document.head.appendChild(link2);
    } catch(e) {}
  }

  // ============================================================================
  // 1. INITIALIZATION
  // ============================================================================
  function init() {
    try { setupProviderTabs(); } catch(e) { console.warn('[Init] Tabs:', e.message); }
    try { setupSearch(); } catch(e) { console.warn('[Init] Search:', e.message); }
    try { setupWatchPortal(); } catch(e) { console.warn('[Init] Watch Portal:', e.message); }
    try { setupReelsOverlay(); } catch(e) { console.warn('[Init] Reels Overlay:', e.message); }
    try { setupVaultDrawer(); } catch(e) { console.warn('[Init] Vault:', e.message); }
    try { loadCategories(); } catch(e) { console.warn('[Init] Categories:', e.message); }
    try { loadReelsShelf(); } catch(e) { console.warn('[Init] Reels Shelf:', e.message); }
    loadFullVideos(true);
    try { setupInfiniteScroll(); } catch(e) { console.warn('[Init] Scroll:', e.message); }
    try { updateVaultBadge(); } catch(e) { console.warn('[Init] Badge:', e.message); }
  }

  // ============================================================================
  // 2. PROVIDER TABS & CATEGORIES
  // ============================================================================
  function setupProviderTabs() {
    providerTabs.forEach(chip => {
      chip.addEventListener('click', () => {
        const prov = chip.dataset.provider;
        if (currentProvider === prov) return;
        triggerHaptic('selection');
        providerTabs.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');

        currentProvider = prov;
        currentCategory = '';
        searchQuery = '';
        if (searchInput) searchInput.value = '';
        currentPage = 1;
        hasMore = true;

        updateSectionHeading();
        loadCategories();
        loadFullVideos(true);
      });
    });
  }

  function updateSectionHeading() {
    if (searchQuery) {
      sectionTitle.textContent = `Search: "${searchQuery}"`;
    } else if (currentCategory) {
      sectionTitle.textContent = `${currentCategory.replace(/-/g, ' ')}`;
    } else {
      const names = {
        all: 'Latest Full-Length Releases',
        kamababa: 'KamaBaba Desi Releases',
        viralmms: 'ViralMMS Smartphone Leaks',
        skbj: '💃 Korean BJ Streams & Leaks (55 Verified)',
        upskirt: 'Upskirt HD Singapore CDN',
        pornbusy: '🇺🇸 Western HD 1024p Cinema & Highlights'
      };
      sectionTitle.textContent = names[currentProvider] || 'Latest Releases';
    }
  }

  async function loadCategories() {
    if (!categoriesBar) return;
    try {
      let categories = [];
      if (currentProvider === 'pornbusy') {
        categories = [
          { name: 'Milf', slug: 'milf' },
          { name: 'Blonde', slug: 'blonde' },
          { name: 'Brunette', slug: 'brunette' },
          { name: 'Lesbian', slug: 'lesbian' },
          { name: 'Asian', slug: 'asian' },
          { name: 'Ebony', slug: 'ebony' },
          { name: 'Creampie', slug: 'creampie' },
          { name: 'Teen', slug: 'teen' },
          { name: 'POV', slug: 'pov' },
          { name: 'Taboo', slug: 'taboo' }
        ];
      } else {
        let url = '/api/kmb/categories';
        if (currentProvider === 'viralmms') url = '/api/vmms/categories';
        else if (currentProvider === 'skbj') url = '/api/skbj/categories';
        else if (currentProvider === 'upskirt') url = '/api/ut/categories';

        try {
          const res = await fetch(url);
          if (res.ok) {
            const data = await res.json();
            if (data.ok && Array.isArray(data.categories)) {
              categories = data.categories;
            }
          }
        } catch(e) {}
      }

      if (Array.isArray(categories) && categories.length > 0) {
        categoriesBar.innerHTML = '';
        
        // "All" Category Chip
        const allChip = document.createElement('button');
        allChip.className = `category-chip ${currentCategory === '' ? 'active' : ''}`;
        allChip.textContent = '🔥 All';
        allChip.onclick = () => {
          triggerHaptic('selection');
          document.querySelectorAll('.category-chip').forEach(c => c.classList.remove('active'));
          allChip.classList.add('active');
          currentCategory = '';
          searchQuery = '';
          if (searchInput) searchInput.value = '';
          currentPage = 1;
          updateSectionHeading();
          loadFullVideos(true);
        };
        categoriesBar.appendChild(allChip);

        categories.forEach(cat => {
          const btn = document.createElement('button');
          btn.className = `category-chip ${cat.slug === currentCategory ? 'active' : ''}`;
          btn.textContent = cat.name;
          btn.onclick = () => {
            triggerHaptic('selection');
            document.querySelectorAll('.category-chip').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            currentCategory = cat.slug || cat.name;
            searchQuery = '';
            if (searchInput) searchInput.value = '';
            currentPage = 1;
            updateSectionHeading();
            loadFullVideos(true);
          };
          categoriesBar.appendChild(btn);
        });
      }
    } catch(err) {
      console.warn('[Categories] Error loading:', err.message);
    }
  }

  // ============================================================================
  // 3. FULL-LENGTH VIDEOS FEED & SEARCH
  // ============================================================================
  async function loadFullVideos(isReset = false) {
    if (isLoading || (!hasMore && !isReset)) return;
    isLoading = true;

    if (isReset) {
      currentPage = 1;
      hasMore = true;
      if (cinemaGrid) {
        cinemaGrid.innerHTML = Array(6).fill(0).map(() => `
          <div style="background: rgba(255,255,255,0.03); border-radius: 14px; overflow: hidden; border: 0.5px solid rgba(255,255,255,0.06); aspect-ratio: 16/11;">
            <div style="width: 100%; aspect-ratio: 16/9; background: rgba(255,255,255,0.06); animation: pulse 1.5s infinite ease-in-out;"></div>
            <div style="padding: 12px; display: flex; flex-direction: column; gap: 8px;">
              <div style="width: 75%; height: 13px; background: rgba(255,255,255,0.08); border-radius: 4px;"></div>
              <div style="width: 40%; height: 9px; background: rgba(255,255,255,0.04); border-radius: 4px;"></div>
            </div>
          </div>
        `).join('');
      }
    }

    if (cinemaLoader) cinemaLoader.style.display = 'flex';

    try {
      let endpoint = '';
      if (searchQuery) {
        if (currentProvider === 'kamababa') {
          endpoint = `/api/kmb/search?q=${encodeURIComponent(searchQuery)}&page=${currentPage}&limit=20`;
        } else if (currentProvider === 'viralmms') {
          endpoint = `/api/vmms/search?q=${encodeURIComponent(searchQuery)}&page=${currentPage}&limit=20`;
        } else if (currentProvider === 'skbj') {
          endpoint = `/api/skbj/search?q=${encodeURIComponent(searchQuery)}&page=${currentPage}&limit=20`;
        } else if (currentProvider === 'upskirt') {
          endpoint = `/api/ut/search?q=${encodeURIComponent(searchQuery)}&page=${currentPage}&limit=20`;
        } else if (currentProvider === 'pornbusy') {
          endpoint = `/api/pornbusy/search?q=${encodeURIComponent(searchQuery)}&page=${currentPage}&limit=20`;
        } else {
          endpoint = `/api/cinema/search?q=${encodeURIComponent(searchQuery)}&source=all&page=${currentPage}&limit=20`;
        }
      } else if (currentCategory && currentCategory !== 'all') {
        if (currentProvider === 'kamababa') {
          endpoint = `/api/kmb/category/${encodeURIComponent(currentCategory)}?page=${currentPage}&limit=20`;
        } else if (currentProvider === 'viralmms') {
          endpoint = `/api/vmms/category/${encodeURIComponent(currentCategory)}?page=${currentPage}&limit=20`;
        } else if (currentProvider === 'skbj') {
          endpoint = `/api/skbj/category/${encodeURIComponent(currentCategory)}?page=${currentPage}&limit=20`;
        } else if (currentProvider === 'pornbusy') {
          endpoint = `/api/pornbusy/category/${encodeURIComponent(currentCategory)}?page=${currentPage}&limit=20`;
        } else {
          endpoint = `/api/cinema/category/${encodeURIComponent(currentCategory)}?page=${currentPage}&limit=20`;
        }
      } else {
        if (currentProvider === 'kamababa') {
          endpoint = `/api/kmb/browse?page=${currentPage}&limit=20`;
        } else if (currentProvider === 'viralmms') {
          endpoint = `/api/vmms/browse?page=${currentPage}&limit=20`;
        } else if (currentProvider === 'skbj') {
          endpoint = `/api/skbj/browse?page=${currentPage}&limit=20`;
        } else if (currentProvider === 'upskirt') {
          endpoint = `/api/ut/browse?page=${currentPage}&limit=20`;
        } else if (currentProvider === 'pornbusy') {
          endpoint = `/api/pornbusy/browse?page=${currentPage}&limit=20`;
        } else {
          endpoint = `/api/cinema/feed?source=all&page=${currentPage}&limit=20`;
        }
      }

      console.log(`[Cinema] Requesting: ${endpoint}`);
      let res;
      try {
        if (endpoint.startsWith('/api/cinema/feed') && userCinemaTaste.size > 0) {
          res = await fetch('/api/cinema/feed', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              source: 'all',
              page: currentPage,
              limit: 20,
              topTags: Object.fromEntries(userCinemaTaste),
              recentSeenIds: cinemaSeenQueue.slice(-100)
            })
          });
        } else {
          res = await fetch(endpoint);
        }
      } catch(netErr) {
        console.warn(`[Cinema] Network fetch error on ${endpoint}:`, netErr.message);
      }

      // Auto-fallback if /api/cinema/feed or /api/pornbusy 404s or fails (e.g. server running old code)
      if (!res || !res.ok) {
        if (currentProvider === 'pornbusy' || endpoint.includes('/api/pornbusy/')) {
          console.warn(`[Cinema Feed] ${endpoint} returned ${res ? res.status : 'error'}, falling back to static /pornbusy_catalog.json`);
          res = await fetch('/pornbusy_catalog.json');
        } else if (endpoint.includes('/api/cinema/')) {
          const fallbackEndpoint = searchQuery 
            ? `/api/kmb/search?q=${encodeURIComponent(searchQuery)}&page=${currentPage}&limit=20`
            : `/api/kmb/browse?page=${currentPage}&limit=20`;
          console.warn(`[Cinema Feed] ${endpoint} returned ${res ? res.status : 'error'}, falling back to ${fallbackEndpoint}`);
          res = await fetch(fallbackEndpoint);
        }
      }

      if (!res || !res.ok) {
        throw new Error(`Server returned HTTP ${res ? res.status : 'Offline'}`);
      }

      let data;
      const text = await res.text();
      try {
        data = JSON.parse(text);
      } catch(parseErr) {
        console.warn('[Cinema] Non-JSON response, attempting static fallback...');
        if (currentProvider === 'pornbusy' || endpoint.includes('pornbusy')) {
          const staticRes = await fetch('/pornbusy_catalog.json');
          data = await staticRes.json();
        } else {
          throw new Error('Server returned non-JSON response');
        }
      }

      // If data is raw array (from static /pornbusy_catalog.json), format and filter in-memory
      if (Array.isArray(data)) {
        let items = data;
        if (currentCategory && currentCategory !== 'all') {
          const cat = currentCategory.toLowerCase();
          items = items.filter(v => (v.category && v.category.toLowerCase() === cat) || (Array.isArray(v.tags) && v.tags.includes(cat)));
        }
        if (searchQuery) {
          const q = searchQuery.toLowerCase();
          items = items.filter(v => (v.title || '').toLowerCase().includes(q));
        }
        data = {
          ok: true,
          videos: items,
          total: items.length,
          page: 1,
          totalPages: 1
        };
      }

      if (data && (data.ok || Array.isArray(data.videos)) && Array.isArray(data.videos) && data.videos.length > 0) {
        if (isReset) {
          renderedVideoIds.clear();
          if (cinemaGrid) cinemaGrid.innerHTML = '';
        }
        const videos = data.videos;
        if (typeof data.total === 'number' && sectionCount) {
          sectionCount.textContent = `${data.total.toLocaleString()} videos`;
        }
        hasMore = data.page < (data.totalPages || 999);
        currentPage++;

        renderVideoCards(videos);
        console.log(`[Cinema] Rendered ${videos.length} videos successfully.`);
      } else {
        hasMore = false;
        if (isReset && cinemaGrid) {
          cinemaGrid.innerHTML = `
            <div style="grid-column: 1/-1; padding: 48px 16px; text-align: center; color: var(--label-tertiary); font-size: 0.9rem;">
              No videos found matching your selection. Try another provider or search term.
            </div>
          `;
        }
      }
    } catch(err) {
      console.error('[Cinema Feed] Error loading videos:', err.message);
      if (isReset && cinemaGrid) {
        cinemaGrid.innerHTML = `
          <div style="grid-column: 1/-1; padding: 48px 16px; text-align: center; color: var(--label-tertiary); font-size: 0.9rem;">
            <p style="margin-bottom: 12px; color: #ff453a; font-weight: 600;">⚠️ Could not load videos (${err.message})</p>
            <button onclick="window.__loadCinemaVideos && window.__loadCinemaVideos(true)" style="background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.2); color: #fff; padding: 8px 20px; border-radius: 9999px; cursor: pointer; font-size: 0.85rem; font-weight: 500;">🔄 Tap to Retry</button>
          </div>
        `;
      }
    } finally {
      isLoading = false;
      if (cinemaLoader) cinemaLoader.style.display = 'none';
    }
  }

  function renderVideoCards(videos) {
    if (!cinemaGrid) return;
    const fragment = document.createDocumentFragment();

    videos.forEach(v => {
      if (!v || !v.id) return;
      const vId = String(v.id);
      if (renderedVideoIds.has(vId)) return; // Zero-duplicate guard
      renderedVideoIds.add(vId);
      const card = document.createElement('div');
      card.className = 'video-card';
      card.dataset.videoId = v.id;
      const rawT1 = v.thumb || v.poster || '';
      const thumbUrl = (rawT1 && (rawT1.includes('pix.upskirt.tv') || rawT1.includes('upskirt.tv'))) ? '/api/thumb?url=' + encodeURIComponent(rawT1) : (rawT1 || (v.rawThumb ? '/api/thumb?url=' + encodeURIComponent(v.rawThumb) : ''));
      let duration = v.duration;
      if (!duration || duration === '12:00' || duration === '15:00' || duration === '00:00' || duration === '0') {
        duration = (v.source === 'kamababa' || String(v.id).startsWith('kmb-')) ? 'MMS' : (v.isHD ? 'HD' : 'CLIP');
      }
      const sourceName = v.sourceName || (v.source ? v.source.toUpperCase() : 'DESI');
      const views = v.views || '180k';
      const title = v.title || 'Full Release Video';
      const isHD = v.isHD !== false;
      const tagText = Array.isArray(v.hashtags) && v.hashtags.length > 0
        ? v.hashtags.slice(0, 2).join(' ')
        : (v.category ? `#${v.category}` : '');

      card.innerHTML = `
        <div class="video-card-thumb-wrap">
          <img class="video-card-thumb" src="${thumbUrl}" alt="${title}" loading="lazy" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'320\\' height=\\'180\\' fill=\\'%23111\\'><rect width=\\'100%\\' height=\\'100%\\'/></svg>'">
          <span class="video-card-quality-badge">${isHD ? 'HD' : 'SD'}</span>
          <span class="video-card-source-badge">${sourceName}</span>
          <span class="video-card-duration-badge">${duration}</span>
        </div>
        <div class="video-card-body">
          <h3 class="video-card-title">${title}</h3>
          <div class="video-card-sub-row">
            <span>${views} views</span>
            <span class="video-card-tags">${tagText}</span>
          </div>
        </div>
      `;

      // Instant pre-warm connection on hover or touch before click
      const warmTarget = v.directStreamUrl || v.streamUrl;
      if (warmTarget) {
        const warm = () => prewarmConnection(warmTarget);
        card.addEventListener('mouseenter', warm, { once: true, passive: true });
        card.addEventListener('touchstart', warm, { once: true, passive: true });
      }

      card.addEventListener('click', () => {
        triggerHaptic('light');
        v._fromRelatedId = currentVideo ? currentVideo.id : null;
        openWatchView(v);
      });

      fragment.appendChild(card);
    });

    cinemaGrid.appendChild(fragment);
  }

  function setupSearch() {
    if (!searchInput) return;
    searchInput.addEventListener('input', (e) => {
      const q = e.target.value.trim();
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        searchQuery = q;
        currentPage = 1;
        hasMore = true;
        updateSectionHeading();
        loadFullVideos(true);
      }, 260);
    });
  }

  function setupInfiniteScroll() {
    window.addEventListener('scroll', () => {
      const scrollHeight = document.documentElement.scrollHeight;
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      const clientHeight = window.innerHeight;

      if (scrollHeight - (scrollTop + clientHeight) < 800) {
        if (!isLoading && hasMore) {
          loadFullVideos(false);
        }
      }
    }, { passive: true });
  }

  // Toast Helper
  function showToast(msg) {
    let toast = document.getElementById('cinema-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'cinema-toast';
      toast.className = 'cinema-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('visible');
    setTimeout(() => toast.classList.remove('visible'), 2200);
  }

  // ============================================================================
  // 4. DEDICATED WATCH PAGE & RECOMMENDATIONS ENGINE
  // ============================================================================
  function setupWatchPortal() {
    if (!theaterVideo) return;

    let bufferTimer = null;
    theaterVideo.addEventListener('waiting', () => {
      theaterBuffering?.classList.add('active');
      clearTimeout(bufferTimer);
      const checkCushion = () => {
        if (!theaterVideo.paused && theaterVideo.buffered.length > 0) {
          const cur = theaterVideo.currentTime;
          for (let i = 0; i < theaterVideo.buffered.length; i++) {
            if (theaterVideo.buffered.start(i) <= cur && theaterVideo.buffered.end(i) >= cur) {
              const cushion = theaterVideo.buffered.end(i) - cur;
              if (cushion >= 1.5 || theaterVideo.buffered.end(i) >= (theaterVideo.duration || 9999) - 0.5) {
                theaterBuffering?.classList.remove('active');
                return;
              }
            }
          }
        }
        if (theaterBuffering?.classList.contains('active')) {
          bufferTimer = setTimeout(checkCushion, 200);
        }
      };
      bufferTimer = setTimeout(checkCushion, 200);
    });
    theaterVideo.addEventListener('playing', () => {
      clearTimeout(bufferTimer);
      theaterBuffering?.classList.remove('active');
    });
    theaterVideo.addEventListener('canplay', () => {
      theaterBuffering?.classList.remove('active');
    });
    theaterVideo.addEventListener('error', () => {
      clearTimeout(bufferTimer);
      theaterBuffering?.classList.remove('active');
    });

    // Real-Time HTML5 Video Metadata & Duration Auto-Correction
    const onMetadataLoaded = () => {
      const realSec = theaterVideo.duration;
      if (realSec && isFinite(realSec) && realSec > 0) {
        const totalSec = Math.round(realSec);
        const mins = Math.floor(totalSec / 60);
        const secs = totalSec % 60;
        const formatted = mins + ':' + (secs < 10 ? '0' : '') + secs;

        if (theaterDuration) theaterDuration.textContent = formatted;

        if (currentTheaterVideo) {
          currentTheaterVideo.duration = formatted;
          currentTheaterVideo.durationSec = totalSec;

          // Update any card badges currently visible on page
          const badges = document.querySelectorAll('[data-video-id="' + currentTheaterVideo.id + '"] .video-card-duration-badge');
          badges.forEach(b => b.textContent = formatted);

          // Report real verified duration to server telemetry
          try {
            fetch('/api/cinema/telemetry', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                events: [{
                  id: currentTheaterVideo.id,
                  action: 'durationCorrection',
                  realDuration: formatted,
                  realDurationSec: totalSec
                }]
              })
            }).catch(() => {});
          } catch(e) {}
        }
      }
    };
    theaterVideo.addEventListener('loadedmetadata', onMetadataLoaded);
    theaterVideo.addEventListener('durationchange', onMetadataLoaded);

    // Unmute prompt
    theaterUnmute?.addEventListener('click', () => {
      theaterVideo.muted = false;
      theaterUnmute.classList.remove('active');
      triggerHaptic('selection');
    });

    // Speed Selector Buttons
    speedBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const speed = parseFloat(btn.dataset.speed);
        theaterVideo.playbackRate = speed;
        speedBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        triggerHaptic('selection');
      });
    });

    // Double-Tap to Seek
    let lastTapSide = null;
    let lastTapTime = 0;
    theaterVideo.parentElement?.addEventListener('click', (e) => {
      const rect = theaterVideo.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const isRight = clickX > rect.width / 2;
      const now = Date.now();

      if (now - lastTapTime < 280 && lastTapSide === (isRight ? 'R' : 'L')) {
        const delta = isRight ? 10 : -10;
        theaterVideo.currentTime = Math.max(0, Math.min(theaterVideo.duration || 9999, theaterVideo.currentTime + delta));
        triggerHaptic('medium');

        const overlay = isRight ? seekOverlayRight : seekOverlayLeft;
        overlay?.classList.add('flash');
        setTimeout(() => overlay?.classList.remove('flash'), 380);
      }
      lastTapTime = now;
      lastTapSide = isRight ? 'R' : 'L';
    });

    // Back & Close buttons
    watchBackBtn?.addEventListener('click', () => {
      triggerHaptic('light');
      closeWatchView();
    });
    watchCloseTopBtn?.addEventListener('click', () => {
      triggerHaptic('light');
      closeWatchView();
    });

    // Share buttons
    const handleShare = () => {
      triggerHaptic('selection');
      if (!currentVideo) return;
      const shareUrl = currentVideo.postUrl || window.location.href;
      const shareTitle = currentVideo.title || 'Watch on FIZIIII Cinema';
      if (navigator.share) {
        navigator.share({ title: shareTitle, text: shareTitle, url: shareUrl }).catch(() => {});
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(shareUrl).then(() => {
          showToast('Video link copied to clipboard!');
        }).catch(() => {});
      }
    };
    watchShareBtn?.addEventListener('click', handleShare);
    watchShareTopBtn?.addEventListener('click', handleShare);

    // Copy Direct Stream Link
    watchCopyBtn?.addEventListener('click', () => {
      triggerHaptic('selection');
      if (!currentVideo) return;
      const link = currentVideo.directStreamUrl || currentVideo.streamUrl || currentVideo.postUrl || window.location.href;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(link).then(() => {
          const label = document.getElementById('watch-copy-label');
          if (label) {
            const orig = label.textContent;
            label.textContent = '✅ Copied!';
            setTimeout(() => { label.textContent = orig; }, 2000);
          }
          showToast('Stream link copied!');
        }).catch(() => {});
      }
    });

    // Bookmark / Save to Vault
    theaterSaveBtn?.addEventListener('click', () => {
      if (!currentVideo) return;
      triggerHaptic('success');
      const isSaved = savedVault.has(currentVideo.id);
      if (isSaved) {
        savedVault.delete(currentVideo.id);
        if (watchSaveLabel) watchSaveLabel.textContent = 'Save to Vault';
        theaterSaveBtn.classList.remove('active');
      } else {
        savedVault.set(currentVideo.id, currentVideo);
        if (watchSaveLabel) watchSaveLabel.textContent = 'Saved in Vault';
        theaterSaveBtn.classList.add('active');
      }
      try {
        localStorage.setItem('fiziiii_saved_v1', JSON.stringify(Array.from(savedVault.values())));
      } catch(e) {}
      updateVaultBadge();
    });

    // Browser History & Gesture Back Support
    window.addEventListener('popstate', (e) => {
      if (watchPortal?.classList.contains('open')) {
        closeWatchView(false);
      }
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && watchPortal?.classList.contains('open')) {
        closeWatchView();
      }
    });
  }

  async function openWatchView(video, pushState = true) {
    if (!video || !watchPortal || !theaterVideo) return;
    currentVideo = video;

    // Lock background scroll to freeze feed position
    document.body.style.overflow = 'hidden';
    watchPortal.classList.add('open');
    watchPortal.scrollTop = 0;

    // Populate metadata
    // Immediate SBRS Adaptation on Click #1 (Works even in Incognito)
    const vTags = Array.isArray(video.tags) ? video.tags : (video.category ? [video.category] : []);
    vTags.forEach(t => {
      const clean = String(t).toLowerCase().trim();
      const current = userCinemaTaste.get(clean) || 0;
      userCinemaTaste.set(clean, +(current + 3.0).toFixed(1));
    });
    if (!cinemaSeenQueue.includes(String(video.id))) {
      cinemaSeenQueue.push(String(video.id));
      if (cinemaSeenQueue.length > 150) cinemaSeenQueue.shift();
    }
    saveCinemaTaste();

    // Send Co-Watch transition telemetry if navigated from a related card
    if (video._fromRelatedId && video._fromRelatedId !== video.id) {
      try {
        fetch('/api/cinema/telemetry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            events: [{
              id: video.id,
              fromRelatedId: video._fromRelatedId,
              action: 'clickRelated'
            }]
          })
        }).catch(() => {});
      } catch(e) {}
    }

    theaterTitle.textContent = video.title || 'Now Playing';
    theaterSource.textContent = video.sourceName || (video.source ? video.source.toUpperCase() : 'DESI');
    const initD = (video.duration && video.duration !== '12:00' && video.duration !== '15:00') ? video.duration : (video.source === 'kamababa' ? 'MMS' : '--:--');
    theaterDuration.textContent = initD;
    theaterViews.textContent = (video.views || '180k') + ' views';
    if (theaterHashtags) {
      const hashes = Array.isArray(video.hashtags) && video.hashtags.length > 0
        ? video.hashtags.join(' ')
        : (video.category ? `#${video.category}` : '');
      theaterHashtags.textContent = hashes;
    }

    // Save button state
    const isSaved = savedVault.has(video.id);
    if (watchSaveLabel) watchSaveLabel.textContent = isSaved ? 'Saved in Vault' : 'Save to Vault';
    theaterSaveBtn?.classList.toggle('active', isSaved);

    // Push browser history state for back button navigation
    if (pushState) {
      try {
        history.pushState({ view: 'watch', id: video.id }, '', `#watch-${video.id}`);
      } catch(e) {}
    }

    // Setup Telegram native BackButton
    if (tg?.BackButton) {
      try {
        tg.BackButton.show();
        tg.BackButton.onClick(closeWatchView);
      } catch(e) {}
    }

    // Stream URL Resolution:
    let streamUrl = video.streamUrl;
    if (video.source === 'skbj') {
      streamUrl = video.directStreamUrl || video.streamUrl;
    }

    // Self-healing token resolver for Upskirt
    if (!streamUrl || video.source === 'upskirt') {
      theaterBuffering?.classList.add('active');
      try {
        const resolveUrl = `/api/ut/stream-info?id=${encodeURIComponent(video.numericId || video.id)}`;
        const res = await fetch(resolveUrl);
        const resolved = await res.json();
        if (resolved.ok && resolved.streamUrl) {
          streamUrl = resolved.streamUrl;
          if (resolved.qualityUrls) video.qualityUrls = resolved.qualityUrls;
        }
      } catch(e) {
        console.warn('[Stream Resolver] Fallback to direct:', e.message);
      }
    }

    // Setup Multi-Quality buttons if available
    if (qualitySelector) {
      if (video.qualityUrls && Object.keys(video.qualityUrls).length > 1) {
        qualitySelector.style.display = 'inline-flex';
        qualitySelector.innerHTML = '';
        Object.keys(video.qualityUrls).forEach(q => {
          const qBtn = document.createElement('button');
          qBtn.className = `theater-ctrl-btn ${q === (video.defaultQuality || '720p') ? 'active' : ''}`;
          qBtn.textContent = q;
          qBtn.onclick = (e) => {
            e.stopPropagation();
            triggerHaptic('selection');
            const targetUrl = video.qualityUrls[q];
            if (!targetUrl) return;
            const curTime = theaterVideo.currentTime;
            theaterVideo.src = targetUrl;
            theaterVideo.currentTime = curTime;
            theaterVideo.play().catch(() => {});
            qualitySelector.querySelectorAll('button').forEach(b => b.classList.remove('active'));
            qBtn.classList.add('active');
          };
          qualitySelector.appendChild(qBtn);
        });
      } else {
        qualitySelector.style.display = 'none';
      }
    }

    // Pre-warm host immediately if not already done
    prewarmConnection(streamUrl);

    // Fallback if direct store fails
    const onVideoError = () => {
      theaterVideo.removeEventListener('error', onVideoError);
      if (video.source === 'skbj' && video.streamUrl && theaterVideo.src !== video.streamUrl) {
        console.warn('[Watch] Direct store retry with entrypoint URL:', video.streamUrl);
        theaterVideo.src = video.streamUrl;
        theaterVideo.play().catch(() => {});
      }
    };
    theaterVideo.addEventListener('error', onVideoError, { once: true });

    if (theaterIframe) {
      theaterIframe.style.display = 'none';
      theaterIframe.src = 'about:blank';
    }
    theaterVideo.style.display = 'block';
    theaterVideo.src = streamUrl;
    theaterVideo.poster = video.poster || video.thumb || '';

    const playPromise = theaterVideo.play();
    if (playPromise !== undefined) {
      playPromise.catch(err => {
        if (err.name === 'NotAllowedError') {
          theaterVideo.muted = true;
          theaterUnmute?.classList.add('active');
          theaterVideo.play().catch(() => {});
        }
      });
    }

    // Load Related Videos for this stream
    loadRelatedVideos(video);
  }

  function closeWatchView(popHistory = true) {
    if (!watchPortal) return;
    if (theaterIframe) {
      theaterIframe.src = 'about:blank';
      theaterIframe.style.display = 'none';
    }
    if (theaterVideo) {
      theaterVideo.pause();
      theaterVideo.removeAttribute('src');
      theaterVideo.load();
      theaterVideo.style.display = 'block';
    }
    watchPortal.classList.remove('open');
    document.body.style.overflow = '';
    currentVideo = null;

    if (tg?.BackButton) {
      try {
        tg.BackButton.hide();
      } catch(e) {}
    }

    if (popHistory && window.location.hash.startsWith('#watch-')) {
      try {
        history.back();
      } catch(e) {}
    }
  }

  // ============================================================================
  // LOAD & RENDER RELATED RECOMMENDATIONS
  // ============================================================================
  async function loadRelatedVideos(video) {
    if (!watchRelatedGrid) return;
    if (watchRelatedLoader) watchRelatedLoader.style.display = 'flex';
    watchRelatedGrid.innerHTML = '';

    try {
      const seenParam = encodeURIComponent(cinemaSeenQueue.slice(-15).join(','));
      const q = `/api/cinema/related?id=${encodeURIComponent(video.id)}&source=${encodeURIComponent(video.source || '')}&category=${encodeURIComponent(video.category || '')}&title=${encodeURIComponent(video.title || '')}&limit=12&seenIds=${seenParam}`;
      const res = await fetch(q);
      const data = await res.json();
      if (watchRelatedLoader) watchRelatedLoader.style.display = 'none';

      if (data && data.ok && Array.isArray(data.videos) && data.videos.length > 0) {
        if (watchRelatedCount) watchRelatedCount.textContent = `${data.videos.length} Recommended`;
        renderRelatedVideoCards(data.videos);
      } else {
        if (watchRelatedCount) watchRelatedCount.textContent = 'Curated';
      }
    } catch(err) {
      console.warn('[Related Videos] Fetch error:', err.message);
      if (watchRelatedLoader) watchRelatedLoader.style.display = 'none';
    }
  }

  function renderRelatedVideoCards(videos) {
    if (!watchRelatedGrid) return;
    watchRelatedGrid.innerHTML = '';
    const fragment = document.createDocumentFragment();

    videos.forEach(v => {
      const card = document.createElement('article');
      card.className = 'video-card related-video-card';

      card.dataset.videoId = v.id;
      const rawT2 = v.thumb || v.poster || '';
      const thumbUrl = (rawT2 && (rawT2.includes('pix.upskirt.tv') || rawT2.includes('upskirt.tv'))) ? '/api/thumb?url=' + encodeURIComponent(rawT2) : rawT2;
      const title = v.title || 'Untitled Release';
      let duration = v.duration;
      if (!duration || duration === '12:00' || duration === '15:00' || duration === '00:00' || duration === '0') {
        duration = (v.source === 'kamababa' || String(v.id).startsWith('kmb-')) ? 'MMS' : (v.isHD ? 'HD' : 'CLIP');
      }
      const views = v.views || '150k';
      const isHD = v.isHD !== false;
      const sourceName = v.sourceName || (v.source ? v.source.toUpperCase() : 'DESI');
      const tagText = Array.isArray(v.hashtags) && v.hashtags.length > 0
        ? v.hashtags.slice(0, 2).join(' ')
        : (v.category ? `#${v.category}` : '');

      card.innerHTML = `
        <div class="video-card-thumb-wrap">
          <img class="video-card-thumb" src="${thumbUrl}" alt="${title}" loading="lazy" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'320\\' height=\\'180\\' fill=\\'%23111\\'><rect width=\\'100%\\' height=\\'100%\\'/></svg>'">
          <span class="video-card-quality-badge">${isHD ? 'HD' : 'SD'}</span>
          <span class="video-card-source-badge">${sourceName}</span>
          <span class="video-card-duration-badge">${duration}</span>
        </div>
        <div class="video-card-body">
          <h3 class="video-card-title">${title}</h3>
          <div class="video-card-sub-row">
            <span>${views} views</span>
            <span class="video-card-tags">${tagText}</span>
          </div>
        </div>
      `;

      // Pre-warm on hover or touch
      const warmTarget = v.directStreamUrl || v.streamUrl;
      if (warmTarget) {
        const warm = () => prewarmConnection(warmTarget);
        card.addEventListener('mouseenter', warm, { once: true, passive: true });
        card.addEventListener('touchstart', warm, { once: true, passive: true });
      }

      card.addEventListener('click', () => {
        triggerHaptic('light');
        openWatchView(v);
      });

      fragment.appendChild(card);
    });

    watchRelatedGrid.appendChild(fragment);
  }

  // ============================================================================
  // 5. EMBEDDED "⚡ TRENDING REELS" SHELF (YouTube Shorts Style)
  // Shared shelf renderer (synchronizes Home Carousel with Reels Swiper)
  window.syncCinemaReelsShelf = function(reels) {
    if (!reelsCarousel || !Array.isArray(reels) || reels.length === 0) return;
    reelsShelfList = reels.slice(0, 14);
    if (reelsShelfCount) reelsShelfCount.textContent = `${reelsShelfList.length}+ Shorts`;
    renderReelsCarousel(reelsShelfList);
  };

  async function loadReelsShelf() {
    if (!reelsCarousel) return;

    // 1. Fast-path: If FiziiiiReelsEngine already has loaded reels in memory, use them immediately!
    if (window.FiziiiiReelsEngine && typeof window.FiziiiiReelsEngine.getReels === 'function') {
      const existing = window.FiziiiiReelsEngine.getReels();
      if (existing && existing.length > 0) {
        window.syncCinemaReelsShelf(existing);
        return;
      }
    }

    // 2. Fetch if not already provided
    try {
      const res = await fetch('/api/reels/feed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'trending', limit: 14 })
      });
      const data = await res.json();
      if (data && data.ok && Array.isArray(data.reels)) {
        if (!reelsShelfList || reelsShelfList.length === 0) {
          window.syncCinemaReelsShelf(data.reels);
        }
      }
    } catch(err) {
      console.warn('[Reels Shelf] Error:', err.message);
    }
  }

  function renderReelsCarousel(reels) {
    if (!reelsCarousel) return;
    reelsCarousel.innerHTML = '';
    const fragment = document.createDocumentFragment();

    reels.forEach((reel, index) => {
      const card = document.createElement('div');
      card.className = 'reel-shelf-card';
      // Prioritize resilient server proxy thumb over raw unproxied poster
      const rawT3 = reel.thumb || reel.poster || '';
      const thumbUrl = (rawT3 && (rawT3.includes('pix.upskirt.tv') || rawT3.includes('upskirt.tv'))) ? '/api/thumb?url=' + encodeURIComponent(rawT3) : rawT3;
      const views = reel.views || '140k';
      const title = reel.title || 'Trending Reel';

      card.innerHTML = `
        <img class="reel-shelf-poster" src="${thumbUrl}" alt="${title}" loading="lazy">
        <div class="reel-shelf-vignette"></div>
        <div class="reel-shelf-play-icon">
          <svg class="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
        </div>
        <div class="reel-shelf-meta">
          <p class="reel-shelf-title">${title}</p>
          <div class="reel-shelf-stats">
            <span class="reel-shelf-views">⚡ ${views}</span>
            <span>${reel.author || '@Reels'}</span>
          </div>
        </div>
      `;

      // Pass the exact reel ID and full reel object to prevent ANY index mismatch
      card.addEventListener('click', () => {
        triggerHaptic('medium');
        openFullscreenReels(reel.id, reel);
      });

      fragment.appendChild(card);
    });

    reelsCarousel.appendChild(fragment);
  }

  // ============================================================================
  // 6. FULLSCREEN VERTICAL REELS SWIPE ENGINE OVERLAY
  // ============================================================================
  function setupReelsOverlay() {
    if (!reelsOverlay) return;

    shelfOpenAllBtn?.addEventListener('click', () => {
      triggerHaptic('medium');
      if (reelsShelfList && reelsShelfList.length > 0) {
        openFullscreenReels(reelsShelfList[0].id, reelsShelfList[0]);
      } else {
        openFullscreenReels(0);
      }
    });

    topReelsBtn?.addEventListener('click', () => {
      triggerHaptic('medium');
      if (reelsShelfList && reelsShelfList.length > 0) {
        openFullscreenReels(reelsShelfList[0].id, reelsShelfList[0]);
      } else {
        openFullscreenReels(0);
      }
    });

    reelsOverlayClose?.addEventListener('click', () => {
      triggerHaptic('light');
      closeFullscreenReels();
    });
  }

  function openFullscreenReels(targetIdOrIndex = 0, fallbackReel = null) {
    if (!reelsOverlay) return;
    // Pause any playing theater full video
    if (theaterVideo && !theaterVideo.paused) {
      theaterVideo.pause();
    }

    reelsOverlay.classList.add('open');
    document.body.style.overflow = 'hidden';

    // Trigger internal Reels Engine with exact target ID or fallback object
    if (window.FiziiiiReelsEngine) {
      if (typeof window.FiziiiiReelsEngine.openReel === 'function' && (typeof targetIdOrIndex === 'string' || fallbackReel)) {
        window.FiziiiiReelsEngine.openReel(typeof targetIdOrIndex === 'string' ? targetIdOrIndex : fallbackReel?.id, fallbackReel);
      } else if (typeof window.FiziiiiReelsEngine.jumpToIndex === 'function') {
        const numIdx = typeof targetIdOrIndex === 'number' ? targetIdOrIndex : 0;
        window.FiziiiiReelsEngine.jumpToIndex(numIdx);
      }
    }
  }

  function closeFullscreenReels() {
    if (!reelsOverlay) return;
    reelsOverlay.classList.remove('open');
    document.body.style.overflow = '';

    // Pause all playing reels inside overlay
    document.querySelectorAll('.reel-video').forEach(v => {
      try { v.pause(); } catch(e) {}
    });
  }

  // ============================================================================
  // 7. PRIVATE VAULT DRAWER
  // ============================================================================
  function setupVaultDrawer() {
    const openVault = () => {
      triggerHaptic('light');
      renderVaultList();
      vaultBackdrop?.classList.add('open');
      vaultDrawer?.classList.add('open');
    };

    const closeVault = () => {
      vaultBackdrop?.classList.remove('open');
      vaultDrawer?.classList.remove('open');
    };

    vaultBtn?.addEventListener('click', openVault);
    vaultCloseBtn?.addEventListener('click', closeVault);
    vaultBackdrop?.addEventListener('click', closeVault);
  }

  function renderVaultList() {
    if (!vaultList) return;
    vaultList.innerHTML = '';
    if (savedVault.size === 0) {
      vaultList.innerHTML = `
        <div style="padding: 40px 16px; text-align: center; color: var(--label-tertiary); font-size: 0.85rem;">
          Your private vault is empty.<br>Tap "⭐️ Save" on any full video or bookmark any reel to store it here.
        </div>
      `;
      return;
    }

    Array.from(savedVault.values()).forEach(item => {
      const row = document.createElement('div');
      row.style.cssText = 'padding: 12px; border-radius: 12px; background: rgba(255,255,255,0.05); border: 0.5px solid rgba(255,255,255,0.1); cursor: pointer; display: flex; flex-direction: column; gap: 4px;';
      row.innerHTML = `
        <div style="display: flex; justify-content: space-between; font-size: 0.72rem; color: var(--label-tertiary);">
          <span style="font-weight: 700; color: #ff375f;">${item.sourceName || (item.source ? item.source.toUpperCase() : 'DESI')}</span>
          <span>${item.duration || '15:00'}</span>
        </div>
        <div style="font-size: 0.82rem; font-weight: 600; color: #fff; line-height: 1.3;">${item.title || 'Saved Video'}</div>
      `;

      row.onclick = () => {
        triggerHaptic('light');
        document.getElementById('vault-drawer')?.classList.remove('open');
        document.getElementById('vault-backdrop')?.classList.remove('open');
        openWatchView(item);
      };

      vaultList.appendChild(row);
    });
  }

  function updateVaultBadge() {
    if (!vaultBadge) return;
    if (savedVault.size > 0) {
      vaultBadge.textContent = savedVault.size;
      vaultBadge.style.display = 'inline-block';
    } else {
      vaultBadge.style.display = 'none';
    }
  }

  // Expose global retry hook
  window.__loadCinemaVideos = loadFullVideos;

  // Boot (guaranteed execution regardless of document ready state)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
