// reels.js - High-Performance TikTok/Shorts Video Engine

let activeSource = 'all';
let currentPage = 1;
let isLoading = false;
let hasMore = true;
let isMuted = true;
let reelsData = [];
let activeIndex = 0;
let lastTap = 0;
let totalReelsCount = 12245;

const reelsContainer = document.getElementById('reels-container');
const soundBtn = document.getElementById('sound-toggle-btn');
const soundIcon = document.getElementById('sound-icon');
const counterBadge = document.getElementById('reel-counter-badge');

// Initialize
async function init() {
  setupFilterPills();
  setupSoundToggle();
  setupKeyboardNav();
  setupDesktopNav();
  setupScrollListener();
  await loadReels(true);
}

// Continuous Infinite Scroll Detection
function setupScrollListener() {
  reelsContainer.addEventListener('scroll', () => {
    const remaining = reelsContainer.scrollHeight - reelsContainer.scrollTop - reelsContainer.clientHeight;
    // When within 3 screens of the bottom, fetch next batch
    if (remaining < 2500 && !isLoading && hasMore) {
      loadReels();
    }
  }, { passive: true });
}

const seenIds = new Set();

// Set up Source Filter Pills
function setupFilterPills() {
  const pills = document.querySelectorAll('.pill-btn');
  pills.forEach(pill => {
    pill.addEventListener('click', async () => {
      if (pill.dataset.source === activeSource) return;
      pills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      activeSource = pill.dataset.source;
      currentPage = 1;
      hasMore = true;
      reelsData = [];
      seenIds.clear();
      reelsContainer.innerHTML = '';
      await loadReels(true);
    });
  });
}

// Fetch and append reels (20 items per batch)
async function loadReels(isReset = false) {
  if (isLoading || !hasMore) return;
  isLoading = true;

  try {
    const res = await fetch(`/api/reels?source=${activeSource}&page=${currentPage}&limit=20`);
    const data = await res.json();

    if (data && data.ok && data.reels && data.reels.length > 0) {
      hasMore = data.hasMore;
      currentPage++;
      if (data.total) totalReelsCount = data.total;

      data.reels.forEach((reel) => {
        if (!reel || !reel.streamUrl) return;
        // Zero-Duplicate Guarantee: ignore any reel already in feed
        if (seenIds.has(reel.id)) return;
        seenIds.add(reel.id);

        const itemIdx = reelsData.length;
        reelsData.push(reel);
        renderReelItem(reel, itemIdx);
      });

      setupIntersectionObserver();
      updateCounterBadge(activeIndex);

      if (isReset && reelsData.length > 0) {
        // Play first video automatically
        setTimeout(() => playReelAtIndex(0), 100);
      }
    } else {
      hasMore = false;
    }
  } catch (err) {
    console.error('Failed to load reels:', err);
  } finally {
    isLoading = false;
  }
}

// Render a single reel card
function renderReelItem(reel, index) {
  const item = document.createElement('div');
  item.className = 'reel-item';
  item.dataset.index = index;

  const rawPoster = reel.poster || reel.thumb || '';
  const posterUrl = rawPoster && (rawPoster.includes('pix.upskirt.tv') || rawPoster.includes('upskirt.tv'))
    ? '/api/thumb?url=' + encodeURIComponent(rawPoster)
    : rawPoster;

  item.innerHTML = `
    <div class="reel-overlay-top"></div>
    <div class="reel-overlay-bottom"></div>

    <video 
      class="reel-video" 
      data-src="${reel.streamUrl}" 
      poster="${posterUrl}"
      playsinline 
      webkit-playsinline 
      x5-playsinline 
      loop 
      preload="none"
      referrerpolicy="no-referrer"
      ${isMuted ? 'muted' : ''}
    ></video>

    <div class="reel-spinner" id="spinner-${index}"></div>
    <div class="play-pause-icon" id="play-pause-${index}">?</div>

    <!-- Right Action Sidebar -->
    <div class="reel-actions">
      <button class="action-btn" onclick="toggleLike(event, this)">
        <div class="action-icon-circle">??</div>
        <span class="action-label like-count">${reel.likes || 1420}</span>
      </button>

      <button class="action-btn" onclick="handleShare(event)">
        <div class="action-icon-circle">??</div>
        <span class="action-label">Share</span>
      </button>

      <a href="https://t.me/Fiziiiibot" target="_blank" class="action-btn" onclick="event.stopPropagation()">
        <div class="action-icon-circle" style="color: #00f2fe;">??</div>
        <span class="action-label">VIP</span>
      </a>
    </div>

    <!-- Bottom Metadata -->
    <div class="reel-meta">
      <div class="meta-author-row">
        <span class="meta-author">${reel.author || '@Creator'}</span>
        <span class="meta-source-tag">${reel.source || 'reel'}</span>
      </div>
      <p class="meta-title">${reel.title || 'Trending Reel'}</p>
      <div class="meta-sound">
        <span>?</span>
        <span>Original Audio - @Fiziiiibot Verified Stream</span>
      </div>
    </div>
  `;

  // Attach tap / double-tap events to video slide
  item.addEventListener('click', (e) => handleTap(e, item, index));

  const video = item.querySelector('.reel-video');
  const spinner = item.querySelector('.reel-spinner');

  let stallTimer = null;

  const hideSpinner = () => {
    if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; }
    spinner.style.display = 'none';
  };

  const showSpinnerWithTimeout = () => {
    spinner.style.display = 'block';
    if (stallTimer) clearTimeout(stallTimer);
    // 3.5s Watchdog: auto-hide spinner & auto-advance if network or decoder hangs
    stallTimer = setTimeout(() => {
      hideSpinner();
      console.warn(`[Reel Watchdog] Reel #${index} stalled for >3.5s`);
      if (index === activeIndex) {
        // Auto-advance to next reel so user never gets stuck
        const nextItem = document.querySelector(`.reel-item[data-index="${index + 1}"]`);
        if (nextItem) nextItem.scrollIntoView({ behavior: 'smooth' });
      }
    }, 3500);
  };

  video.addEventListener('waiting', showSpinnerWithTimeout);
  video.addEventListener('playing', hideSpinner);
  video.addEventListener('canplay', hideSpinner);
  video.addEventListener('loadeddata', hideSpinner);
  video.addEventListener('error', () => {
    hideSpinner();
    console.warn(`[Reel Error] Video #${index} failed to decode or load.`);
    if (index === activeIndex) {
      setTimeout(() => {
        const nextItem = document.querySelector(`.reel-item[data-index="${index + 1}"]`);
        if (nextItem) nextItem.scrollIntoView({ behavior: 'smooth' });
      }, 600);
    }
  });

  reelsContainer.appendChild(item);
}

// Handle Tap (Play/Pause) vs Double-Tap (Heart Like)
function handleTap(e, item, index) {
  if (e.target.closest('.reel-actions') || e.target.closest('.reels-header')) return;

  const now = Date.now();
  const diff = now - lastTap;
  lastTap = now;

  if (diff < 300 && diff > 0) {
    triggerHeartBurst(e, item);
  } else {
    setTimeout(() => {
      if (Date.now() - lastTap >= 300) {
        togglePlayPause(item, index);
      }
    }, 300);
  }
}

// Double-Tap Heart Burst Animation
function triggerHeartBurst(e, item) {
  const heart = document.createElement('div');
  heart.className = 'heart-burst';
  heart.innerHTML = '??';
  item.appendChild(heart);

  const likeBtn = item.querySelector('.action-btn');
  if (likeBtn && !likeBtn.classList.contains('liked')) {
    likeBtn.classList.add('liked');
    const countSpan = likeBtn.querySelector('.like-count');
    if (countSpan) {
      const current = parseInt(countSpan.textContent.replace(/[^0-9]/g, ''), 10) || 1000;
      countSpan.textContent = current + 1;
    }
  }

  setTimeout(() => heart.remove(), 750);
}

// Play / Pause Toggle
function togglePlayPause(item, index) {
  const video = item.querySelector('.reel-video');
  const icon = item.querySelector('.play-pause-icon');
  if (!video) return;

  if (video.paused) {
    video.play().catch(() => {});
    showIcon(icon, '?');
  } else {
    video.pause();
    showIcon(icon, '??');
  }
}

function showIcon(iconEl, symbol) {
  if (!iconEl) return;
  iconEl.textContent = symbol;
  iconEl.classList.add('show');
  setTimeout(() => iconEl.classList.remove('show'), 400);
}

// Play reel at given index with Sliding-Window Virtualization
function playReelAtIndex(idx) {
  activeIndex = idx;
  updateCounterBadge(idx);
  const items = document.querySelectorAll('.reel-item');

  items.forEach((item, i) => {
    const video = item.querySelector('.reel-video');
    if (!video) return;

    const diff = i - idx;

    // Sliding Window: previous 1, active, and next 2
    if (diff >= -1 && diff <= 2) {
      // Attach src if not currently loaded
      if (!video.src || video.src === '' || video.src === window.location.href) {
        if (video.dataset.src) {
          video.src = video.dataset.src;
          video.load();
        }
      }

      if (diff === 0) {
        // Active video: play immediately
        video.preload = 'auto';
        video.muted = isMuted;
        const p = video.play();
        if (p !== undefined) {
          p.catch(e => {
            if (e.name === 'NotAllowedError') {
              video.muted = true;
              isMuted = true;
              updateSoundIcon();
              video.play().catch(() => {});
            }
          });
        }
      } else {
        // Buffer neighboring video (preloaded, stay paused)
        video.pause();
        video.preload = 'auto';
      }
    } else {
      // Distant video: unload src to free network sockets & phone RAM
      video.pause();
      if (video.src && video.src !== '') {
        video.removeAttribute('src');
        video.load();
      }
      video.preload = 'none';
    }
  });

  // Prefetch next batch when within 6 videos of the end
  if (idx >= reelsData.length - 6 && !isLoading && hasMore) {
    loadReels();
  }
}

// Update Top Counter Badge
function updateCounterBadge(idx) {
  const badge = document.getElementById('reel-counter-badge');
  if (badge) {
    badge.textContent = `${idx + 1} / ${totalReelsCount.toLocaleString()}+`;
  }
}

// Intersection Observer for scroll snapping
let observer = null;
function setupIntersectionObserver() {
  if (observer) observer.disconnect();

  observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting && entry.intersectionRatio >= 0.35) {
        const idx = parseInt(entry.target.dataset.index, 10);
        playReelAtIndex(idx);
      }
    });
  }, {
    root: reelsContainer,
    threshold: 0.35
  });

  document.querySelectorAll('.reel-item').forEach(item => observer.observe(item));
}

// Sound Mute Toggle
function setupSoundToggle() {
  soundBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    isMuted = !isMuted;
    updateSoundIcon();

    const items = document.querySelectorAll('.reel-item');
    if (items[activeIndex]) {
      const v = items[activeIndex].querySelector('.reel-video');
      if (v) v.muted = isMuted;
    }
  });
}

function updateSoundIcon() {
  soundIcon.textContent = isMuted ? '??' : '??';
}

// Toggle Like
window.toggleLike = function(e, btn) {
  e.stopPropagation();
  btn.classList.toggle('liked');
  const countSpan = btn.querySelector('.like-count');
  if (countSpan) {
    let current = parseInt(countSpan.textContent.replace(/[^0-9]/g, ''), 10) || 1200;
    countSpan.textContent = btn.classList.contains('liked') ? current + 1 : current - 1;
  }
};

// Share
window.handleShare = function(e) {
  e.stopPropagation();
  if (navigator.share) {
    navigator.share({
      title: 'Watch on Fiziii',
      url: window.location.href
    }).catch(() => {});
  } else {
    window.open('https://t.me/Fiziiiibot', '_blank');
  }
};

// Desktop Arrow Keys Navigation
function setupKeyboardNav() {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'j') {
      scrollReel(1);
    } else if (e.key === 'ArrowUp' || e.key === 'k') {
      scrollReel(-1);
    } else if (e.key === ' ' || e.key === 'k') {
      e.preventDefault();
      const items = document.querySelectorAll('.reel-item');
      if (items[activeIndex]) togglePlayPause(items[activeIndex], activeIndex);
    } else if (e.key === 'm') {
      soundBtn.click();
    }
  });
}

function setupDesktopNav() {
  const upBtn = document.getElementById('desktop-prev');
  const downBtn = document.getElementById('desktop-next');
  if (upBtn) upBtn.addEventListener('click', () => scrollReel(-1));
  if (downBtn) downBtn.addEventListener('click', () => scrollReel(1));
}

function scrollReel(direction) {
  const targetIdx = activeIndex + direction;
  const items = document.querySelectorAll('.reel-item');
  if (targetIdx >= 0 && targetIdx < items.length) {
    items[targetIdx].scrollIntoView({ behavior: 'smooth' });
  }
}

document.addEventListener('DOMContentLoaded', init);
