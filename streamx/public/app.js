let hlsInstance = null;
let currentCategory = 'trending';
let currentPage = 1;
let isLoadingMore = false;
let activeStreamUrl = '';

const playerContainer = document.getElementById('player-container');
const videoElement = document.getElementById('video-element');
const playerLoader = document.getElementById('player-loader');
const playerStatusText = document.getElementById('player-status-text');
const currentVideoTitle = document.getElementById('current-video-title');
const currentVideoCdn = document.getElementById('current-video-cdn');
const closePlayerBtn = document.getElementById('close-player-btn');
const copyStreamBtn = document.getElementById('copy-stream-btn');
const videoGrid = document.getElementById('video-grid');
const feedTitle = document.getElementById('feed-title');
const feedStats = document.getElementById('feed-stats');
const streamUrlInput = document.getElementById('stream-url-input');
const inspectBtn = document.getElementById('inspect-btn');
const catChips = document.querySelectorAll('.cat-chip');
const relatedSection = document.getElementById('related-section');
const relatedTray = document.getElementById('related-tray');
const infiniteLoader = document.getElementById('infinite-loader');

// ==========================================
// 1. CATEGORY BAR SELECTION
// ==========================================
catChips.forEach(chip => {
  chip.addEventListener('click', () => {
    catChips.forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    currentCategory = chip.dataset.cat;
    currentPage = 1;
    feedTitle.textContent = `${chip.textContent} Videos`;
    loadFeed(currentCategory, 1, false);
  });
});

// ==========================================
// 2. CATALOG FEED LOADING & INFINITE SCROLL
// ==========================================
async function loadFeed(cat = 'trending', page = 1, append = false) {
  if (!append) {
    videoGrid.innerHTML = `
      <div class="loading-state">
        <div class="spinner"></div>
        <p>Loading ${cat} streams from SxyPrn...</p>
      </div>
    `;
    feedStats.textContent = 'Fetching...';
  } else {
    infiniteLoader.classList.remove('hidden');
  }

  try {
    const res = await fetch(`/api/feed?cat=${encodeURIComponent(cat)}&page=${encodeURIComponent(page)}`);
    const data = await res.json();
    if (data.ok && data.videos && data.videos.length > 0) {
      if (!append) videoGrid.innerHTML = '';
      renderVideos(data.videos, append);
      feedStats.textContent = `${videoGrid.children.length} Streams`;
    } else {
      if (!append) {
        videoGrid.innerHTML = `
          <div class="empty-state">
            <p>No streams found for "${cat}".</p>
          </div>
        `;
      }
    }
  } catch (err) {
    console.error('Feed error:', err);
    if (!append) {
      videoGrid.innerHTML = `
        <div class="empty-state">
          <p>Failed to load feed: ${err.message}</p>
        </div>
      `;
    }
  } finally {
    infiniteLoader.classList.add('hidden');
    isLoadingMore = false;
  }
}

function renderVideos(videos, append = false) {
  videos.forEach(v => {
    const card = document.createElement('div');
    card.className = 'video-card';
    card.onclick = () => playStream(v);

    const tagsHtml = (v.tags || []).slice(0, 3)
      .map(t => `<span class="tag-badge">#${t}</span>`).join('');

    card.innerHTML = `
      <div class="thumb-wrap">
        <img class="card-thumb" src="${v.poster || ''}" alt="${v.title}" loading="lazy" onerror="this.src='/css/placeholder.png'; this.style.opacity=0.3;">
        ${v.duration ? `<span class="duration-badge">${v.duration}</span>` : ''}
      </div>
      <div class="card-body">
        <h4 class="card-title">${v.title}</h4>
        <div class="card-footer">
          <span>${v.views ? `${v.views} views` : 'Ready'}</span>
          <div class="tag-list">${tagsHtml}</div>
        </div>
      </div>
    `;
    videoGrid.appendChild(card);
  });
}

// Window scroll listener for infinite pagination
window.addEventListener('scroll', () => {
  if (isLoadingMore) return;
  const scrollPos = window.innerHeight + window.scrollY;
  const threshold = document.body.offsetHeight - 600;
  if (scrollPos >= threshold) {
    isLoadingMore = true;
    currentPage += 1;
    loadFeed(currentCategory, currentPage, true);
  }
});

// ==========================================
// 3. FAST-START VIDEO PLAYER EVENT LISTENERS
// ==========================================
videoElement.addEventListener('waiting', () => {
  playerLoader.classList.remove('hidden');
  playerStatusText.textContent = 'Buffering stream...';
});

videoElement.addEventListener('playing', () => {
  playerLoader.classList.add('hidden');
});

// Start playing the microsecond the first frame is ready!
videoElement.addEventListener('loadeddata', () => {
  playerLoader.classList.add('hidden');
  videoElement.play().catch(() => {
    playerStatusText.textContent = '▶ Tap to Play';
    playerLoader.classList.remove('hidden');
  });
});

playerLoader.addEventListener('click', () => {
  playerLoader.classList.add('hidden');
  videoElement.play().catch(() => {});
});

videoElement.addEventListener('progress', () => {
  if (videoElement.duration > 0 && videoElement.buffered.length > 0) {
    const bufferedEnd = videoElement.buffered.end(videoElement.buffered.length - 1);
    const ahead = Math.max(0, bufferedEnd - videoElement.currentTime);
    if (ahead > 2) {
      currentVideoCdn.textContent = `Ultra-Smooth Pipeline (Buffer: ${Math.round(ahead)}s ahead)`;
    }
  }
});

videoElement.addEventListener('error', () => {
  if (activeStreamUrl && !activeStreamUrl.includes('retry=1')) {
    playerStatusText.textContent = 'Optimizing stream...';
    activeStreamUrl += '&retry=1';
    videoElement.src = activeStreamUrl;
    videoElement.load();
    videoElement.play().catch(() => {});
  } else {
    playerLoader.classList.remove('hidden');
    playerStatusText.textContent = '▶ Tap Video to Play';
  }
});

function renderRelated(relatedList) {
  if (!relatedList || relatedList.length === 0) {
    relatedSection.classList.add('hidden');
    return;
  }
  relatedTray.innerHTML = '';
  relatedList.forEach(rel => {
    const rCard = document.createElement('div');
    rCard.className = 'related-card';
    rCard.onclick = () => playStream(rel);
    rCard.innerHTML = `
      <div class="related-thumb-wrap">
        <img src="${rel.poster || ''}" alt="${rel.title}" loading="lazy">
        ${rel.duration ? `<span class="related-duration">${rel.duration}</span>` : ''}
      </div>
      <div class="related-body">
        <h5 class="related-card-title">${rel.title}</h5>
      </div>
    `;
    relatedTray.appendChild(rCard);
  });
  relatedSection.classList.remove('hidden');
}

async function playStream(video) {
  playerContainer.classList.remove('hidden');
  currentVideoTitle.textContent = video.title || 'Connecting to stream...';
  currentVideoCdn.textContent = 'Connecting direct stream...';
  playerLoader.classList.remove('hidden');
  playerStatusText.textContent = 'Loading video stream...';

  playerContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });

  if (hlsInstance) {
    hlsInstance.destroy();
    hlsInstance = null;
  }
  videoElement.pause();
  videoElement.removeAttribute('src');

  try {
    let streamUrl = video.streamUrl;
    let title = video.title;
    let related = video.related || [];

    if (!streamUrl) {
      const targetParam = video.id || video.url;
      const t0 = performance.now();
      const res = await fetch(`/api/stream?id=${encodeURIComponent(targetParam)}`);
      const data = await res.json();
      if (!data.ok || !data.streamUrl) {
        throw new Error(data.error || 'Failed to extract stream');
      }
      streamUrl = data.streamUrl;
      title = data.title || title;
      related = data.related || [];
      const resolveMs = Math.round(performance.now() - t0);
      currentVideoCdn.textContent = `Connected (${resolveMs}ms)`;
    }

    renderRelated(related);

    activeStreamUrl = window.location.origin + streamUrl;
    currentVideoTitle.textContent = title;

    videoElement.src = streamUrl;
    videoElement.preload = 'auto';
    videoElement.load();
    videoElement.play().catch(() => {
      playerStatusText.textContent = '▶ Tap to Play';
      playerLoader.classList.remove('hidden');
    });
  } catch (err) {
    playerLoader.classList.remove('hidden');
    playerStatusText.textContent = 'Error: ' + err.message;
  }
}

closePlayerBtn.onclick = () => {
  playerContainer.classList.add('hidden');
  videoElement.pause();
  videoElement.removeAttribute('src');
  videoElement.load();
  if (hlsInstance) {
    hlsInstance.destroy();
    hlsInstance = null;
  }
  activeStreamUrl = '';
};

copyStreamBtn.onclick = () => {
  if (activeStreamUrl) {
    navigator.clipboard.writeText(activeStreamUrl).then(() => {
      copyStreamBtn.textContent = '✓ Copied!';
      setTimeout(() => copyStreamBtn.textContent = '📋 Copy Stream URL', 2000);
    });
  }
};

inspectBtn.onclick = () => {
  const url = streamUrlInput.value.trim();
  if (url) {
    playStream({ title: 'Inspecting: ' + url, id: url });
  }
};

// Initial load
loadFeed(currentCategory, 1);
