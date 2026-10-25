const coWatch = require('./co_watch_engine');
const fs = require('fs');
const path = require('path');
const nuditok = require('./nuditok_scraper');

let vmmsDesiList = [];
let kamababaList = [];
let westernReelsList = [];
let globalHeatMap = {};
let pendingTelemetryCount = 0;
let saveHeatTimer = null;

const DATA_DIR = path.join(__dirname, 'data');
const GLOBAL_HEAT_FILE = path.join(DATA_DIR, 'global_heat.json');
const PURE_VMMS_FILE = path.join(DATA_DIR, 'viralmms_pure_vertical.json');
const FAST_VMMS_FILE = path.join(DATA_DIR, 'viralmms_fast_reels.json');
const VMMS_FILE = path.join(DATA_DIR, 'viralmms_catalog.json');
const PURE_KMB_FILE = path.join(DATA_DIR, 'kamababa_pure_vertical.json');
const FAST_KMB_FILE = path.join(DATA_DIR, 'kamababa_fast_reels.json');
const KMB_FILE = path.join(DATA_DIR, 'kamababa_catalog.json');
const PURE_WESTERN_FILE = path.join(DATA_DIR, 'western_pure_vertical.json');

// Standardized Tag Dictionary & NudiTok Bridge Mapping
const TAG_RULES = [
  { tag: 'bhabhi', regex: /\b(bhabhi|bhabi|boudhi|devar)\b/i },
  { tag: 'aunty', regex: /\b(aunty|auntie|milf|mature|housewife|wife|married)\b/i },
  { tag: 'college', regex: /\b(college|student|hostel|pg|roommate|teen|young|18|19)\b/i },
  { tag: 'village', regex: /\b(village|dehati|jungli|adivasi|farmer|outdoor|jungle)\b/i },
  { tag: 'punjabi', regex: /\b(punjabi|ludhiana|chandigarh)\b/i },
  { tag: 'tamil', regex: /\b(tamil|chennai|madurai|vellore|south)\b/i },
  { tag: 'mallu', regex: /\b(mallu|kerala|telugu)\b/i },
  { tag: 'bangla', regex: /\b(bangla|bengali|kolkata|bong|bangladeshi|assam|assamese|guwahati)\b/i },
  { tag: 'pakistani', regex: /\b(pakistani|muslim|hijabi|kashmiri)\b/i },
  { tag: 'blowjob', regex: /\b(blowjob|blow|suck|sucking|oral|mouth|deepthroat)\b/i, nuditokSlug: 'blowjob' },
  { tag: 'doggystyle', regex: /\b(doggy|doggystyle|behind|riding|ride|bouncing)\b/i, nuditokSlug: 'doggystyle' },
  { tag: 'anal', regex: /\b(anal|ass|asshole|butt)\b/i, nuditokSlug: 'anal' },
  { tag: 'boobs', regex: /\b(boob|boobs|busty|melons|milky|cleavage|pressing|milkers)\b/i, nuditokSlug: 'boobs' },
  { tag: 'solo', regex: /\b(solo|selfie|masturbat|finger|fingering|vibrator|strip|strips|dance|videocall|call)\b/i, nuditokSlug: 'solo' },
  { tag: 'thong', regex: /\b(lingerie|thong|bikini|saree|dress|onesie)\b/i, nuditokSlug: 'thong' },
  { tag: 'amateur', regex: /\b(amateur|homemade|local|couple|gf|bf|lover|romance|romantic)\b/i, nuditokSlug: 'amateur' },
  { tag: 'hotel', regex: /\b(hotel|room|bathroom|shower|bath|kitchen|office|car|bathtub)\b/i },
  { tag: 'blonde', regex: /\b(blonde|blondie|goldielocks)\b/i },
  { tag: 'brunette', regex: /\b(brunette|brown hair)\b/i },
  { tag: 'redhead', regex: /\b(redhead|ginger)\b/i },
  { tag: 'pov', regex: /\b(pov|first person|point of view)\b/i },
  { tag: 'taboo', regex: /\b(taboo|stepsister|stepmom|stepdaughter|family|daddy)\b/i },
  { tag: 'creampie', regex: /\b(creampie|creampied|breeding)\b/i },
  { tag: 'fitness', regex: /\b(fitness|gym|workout|athletic|abs)\b/i },
  { tag: 'glamour', regex: /\b(glamour|model|vip|luxury)\b/i },
  { tag: 'western', regex: /\b(western|american|euro|european|latina|caucasian)\b/i }
];

const NUDITOK_VALID_SLUGS = new Set([
  'trending', 'amateur', 'nsfw', 'solo', 'explicit',
  'blowjob', 'doggystyle', 'pussy', 'indian', 'anal', 'thong', 'boobs'
]);

function extractTags(title = '', slug = '', category = '', source = '') {
  const combined = `${title} ${slug} ${category}`.toLowerCase();
  const matched = new Set();

  for (const rule of TAG_RULES) {
    if (rule.regex.test(combined)) matched.add(rule.tag);
  }
  if (source === 'desi' || source === 'kamababa') {
    matched.add('desi');
  }
  if (matched.size === 0) {
    matched.add(source === 'nuditok' ? 'trending' : 'desi');
  }
  return Array.from(matched);
}

function loadGlobalHeat() {
  try {
    const heatFile = (process.env.VERCEL && fs.existsSync(path.join('/tmp', 'global_heat.json')))
      ? path.join('/tmp', 'global_heat.json')
      : GLOBAL_HEAT_FILE;
    if (fs.existsSync(heatFile)) {
      globalHeatMap = JSON.parse(fs.readFileSync(heatFile, 'utf8')) || {};
    }
  } catch (err) {
    console.warn('[Reels Catalog] Could not load global_heat.json, starting fresh.');
    globalHeatMap = {};
  }
}

function scheduleSaveGlobalHeat() {
  if (saveHeatTimer) return;
  saveHeatTimer = setTimeout(() => {
    saveHeatTimer = null;
    pendingTelemetryCount = 0;
    try {
      const heatFile = process.env.VERCEL
        ? path.join('/tmp', 'global_heat.json')
        : GLOBAL_HEAT_FILE;
      const targetDir = path.dirname(heatFile);
      if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(heatFile, JSON.stringify(globalHeatMap, null, 2), 'utf8');
    } catch (err) {
      console.error('[Reels Catalog] Failed saving global_heat.json:', err.message);
    }
  }, 15000);
}

function getVideoHeatScore(id, fallbackLikes = 1500) {
  const entry = globalHeatMap[id];
  if (!entry) {
    return Math.min(5.0, Math.max(1.0, (fallbackLikes || 1500) / 2000));
  }
  return entry.score || 2.5;
}

function recordTelemetry(events = []) {
  let count = 0;
  for (const ev of events) {
    if (!ev || !ev.id) continue;
    const id = String(ev.id);
    if (!globalHeatMap[id]) {
      globalHeatMap[id] = { views: 0, likes: 0, loops: 0, skips: 0, score: 2.5, watchRatioAvg: 1.0, watchSamples: 0 };
    }
    const item = globalHeatMap[id];

    // UPGRADE 1: Continuous Watch-Ratio Metric (TikTok Algorithm)
    if (ev.watchRatio !== undefined && typeof ev.watchRatio === 'number') {
      const wr = Math.min(3.0, Math.max(0.0, Number(ev.watchRatio)));
      item.watchSamples = (item.watchSamples || 0) + 1;
      item.watchRatioAvg = +(((item.watchRatioAvg || 1.0) * (item.watchSamples - 1) + wr) / item.watchSamples).toFixed(2);

      if (wr < 0.20 && (ev.dwellSec || 0) < 2.5) {
        // Fast skip / bounce penalty
        item.skips += 1;
        item.score = Math.max(0.2, +(item.score - 0.55).toFixed(2));
      } else if (wr >= 0.85) {
        // Deep watch / full completion boost
        item.views += 1;
        const boost = wr >= 1.0 ? 0.75 : 0.45;
        item.score = Math.min(15, +(item.score + boost).toFixed(2));
      } else {
        // Normal watch
        item.views += 1;
        item.score = Math.min(15, +(item.score + 0.20).toFixed(2));
      }
    } else {
      switch (ev.action) {
        case 'like':
        case 'save':
          item.likes += 1;
          item.score = Math.min(15, +(item.score + 0.8).toFixed(2));
          break;
        case 'loop':
          item.loops += 1;
          item.score = Math.min(15, +(item.score + 0.6).toFixed(2));
          break;
        case 'watch15s':
        case 'watchFull':
          item.views += 1;
          item.score = Math.min(15, +(item.score + 0.35).toFixed(2));
          break;
        case 'skip':
          item.skips += 1;
          item.score = Math.max(0.2, +(item.score - 0.45).toFixed(2));
          break;
      }
    }

    if (ev.loops && ev.loops > 0) {
      item.loops = (item.loops || 0) + Number(ev.loops);
      item.score = Math.min(15, +(item.score + 0.65).toFixed(2));
    }
    if (ev.action === 'like' || ev.action === 'save') {
      item.likes += 1;
      item.score = Math.min(15, +(item.score + 0.85).toFixed(2));
    }

    // UPGRADE 3: Record Co-Watch Association
    if (ev.coWatchedWith && coWatch && coWatch.recordCoWatch) {
      const coWeight = (ev.watchRatio && ev.watchRatio >= 0.6) ? 1.5 : 1.0;
      coWatch.recordCoWatch(id, ev.coWatchedWith, coWeight);
    }

    count++;
  }
  if (count > 0) {
    pendingTelemetryCount += count;
    if (pendingTelemetryCount >= 50) {
      if (saveHeatTimer) clearTimeout(saveHeatTimer);
      saveHeatTimer = null;
    }
    scheduleSaveGlobalHeat();
  }
  return count;
}

function initCatalogs() {
  loadGlobalHeat();
  try {
    const vmmsFileToUse = fs.existsSync(PURE_VMMS_FILE)
      ? PURE_VMMS_FILE
      : (fs.existsSync(FAST_VMMS_FILE) ? FAST_VMMS_FILE : VMMS_FILE);

    if (fs.existsSync(vmmsFileToUse)) {
      const rawVmms = JSON.parse(fs.readFileSync(vmmsFileToUse, 'utf8'));
      const seenVmmsUrls = new Set();
      vmmsDesiList = rawVmms
        .filter(v => {
          if (!v || !v.streamUrl) return false;
          const normUrl = v.streamUrl.trim().toLowerCase();
          if (seenVmmsUrls.has(normUrl)) return false;
          seenVmmsUrls.add(normUrl);
          return true;
        })
        .map((v, idx) => {
          const hashNum = String(v.id || idx).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
          const likes = v.likes || (1600 + (hashNum % 5200));
          const tags = extractTags(v.title, v.slug, v.category, 'desi');
          return {
            id: v.id || `vmms-reel-${idx}`,
            title: v.title || 'Desi MMS Reel',
            streamUrl: v.streamUrl,
            poster: v.poster || v.thumb || '',
            thumb: v.thumb || v.poster || '',
            duration: v.duration || '0:30',
            ratio: v.ratio || 1.78,
            author: '@DesiLeaks',
            views: v.views || `${Math.floor(likes / 12)}k`,
            likes,
            tags,
            source: 'desi',
            category: 'desi'
          };
        });
      console.log(`[Reels Catalog] Loaded & Tagged ${vmmsDesiList.length} Desi MMS reels.`);
    }

    const kmbFileToUse = fs.existsSync(PURE_KMB_FILE)
      ? PURE_KMB_FILE
      : (fs.existsSync(FAST_KMB_FILE) ? FAST_KMB_FILE : KMB_FILE);

    if (fs.existsSync(kmbFileToUse)) {
      const rawKmb = JSON.parse(fs.readFileSync(kmbFileToUse, 'utf8'));
      const seenStreamUrls = new Set();
      kamababaList = rawKmb
        .filter(v => {
          if (!v || !v.streamUrl) return false;
          const normUrl = v.streamUrl.trim().toLowerCase();
          if (seenStreamUrls.has(normUrl)) return false;
          seenStreamUrls.add(normUrl);
          return true;
        })
        .map((v, idx) => {
          const hashNum = String(v.id || idx).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
          const likes = v.likes || (1800 + (hashNum % 5500));
          const tags = extractTags(v.title, v.slug, v.category, 'kamababa');
          return {
            id: v.id || `kmb-reel-${idx}`,
            title: v.title || 'KamaBaba Desi Reel',
            streamUrl: v.streamUrl,
            poster: v.poster || '',
            thumb: v.thumb || v.poster || '',
            duration: v.duration || '0:45',
            ratio: v.ratio || 1.78,
            author: '@KamaBaba',
            views: v.views || `${Math.floor(likes / 12)}k`,
            likes,
            tags,
            source: 'kamababa',
            category: 'desi'
          };
        });
      console.log(`[Reels Catalog] Loaded & Tagged ${kamababaList.length} KamaBaba reels.`);
    }

    const westernFileToUse = fs.existsSync(PURE_WESTERN_FILE)
      ? PURE_WESTERN_FILE
      : (fs.existsSync(path.join(__dirname, 'public', 'western_pure_vertical.json')) ? path.join(__dirname, 'public', 'western_pure_vertical.json') : null);

    if (westernFileToUse && fs.existsSync(westernFileToUse)) {
      const rawWestern = JSON.parse(fs.readFileSync(westernFileToUse, 'utf8'));
      const seenWesternUrls = new Set();
      westernReelsList = rawWestern
        .filter(v => {
          if (!v || !v.streamUrl) return false;
          const normUrl = v.streamUrl.trim().toLowerCase();
          if (seenWesternUrls.has(normUrl)) return false;
          seenWesternUrls.add(normUrl);
          return true;
        })
        .map((v, idx) => {
          const hashNum = String(v.id || idx).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
          const likes = v.likes || (2500 + (hashNum % 4200));
          const tags = extractTags(v.title, v.slug || '', v.category || 'western', 'western');
          return {
            id: v.id || `western-reel-${idx}`,
            title: v.title || 'Western HD Reel',
            streamUrl: v.streamUrl,
            poster: v.poster || '',
            thumb: v.thumb || v.poster || '',
            duration: v.duration || '0:15',
            ratio: 0.5625,
            width: 608,
            height: 1080,
            isVertical: true,
            author: v.author || '@WesternReels',
            views: v.views || `${Math.floor(likes / 10)}k`,
            likes,
            tags,
            source: 'western',
            category: 'western',
            isHD: true,
            cors: true
          };
        });
      console.log(`[Reels Catalog] Loaded & Tagged ${westernReelsList.length} pure 9:16 Western reels.`);
    }
  } catch (err) {
    console.error('[Reels Catalog] Error initializing catalogs:', err.message);
  }
}

initCatalogs();

// Watch for atomic file updates (Hot-Reload without server restart)
let reloadDebounce = null;
[PURE_KMB_FILE, PURE_VMMS_FILE, PURE_WESTERN_FILE].forEach(file => {
  if (fs.existsSync(file)) {
    fs.watchFile(file, { interval: 3000 }, (curr, prev) => {
      if (curr.mtimeMs !== prev.mtimeMs) {
        clearTimeout(reloadDebounce);
        reloadDebounce = setTimeout(() => {
          console.log(`[Hot-Reload] Detected update in ${path.basename(file)}, refreshing RAM catalog...`);
          initCatalogs();
        }, 1500);
      }
    });
  }
});

function resolveNuditokTag(topTags = {}) {
  const sorted = Object.entries(topTags)
    .filter(([, weight]) => Number(weight) > 2)
    .sort((a, b) => Number(b[1]) - Number(a[1]));

  for (const [tag] of sorted) {
    if (NUDITOK_VALID_SLUGS.has(tag)) return tag;
    const rule = TAG_RULES.find(r => r.tag === tag && r.nuditokSlug);
    if (rule) return rule.nuditokSlug;
    if (tag === 'desi' || tag === 'bhabhi' || tag === 'aunty') return 'indian';
  }
  return 'trending';
}

function parseDurationSecs(dur) {
  if (typeof dur === 'number') return dur;
  if (!dur || typeof dur !== 'string') return 15;
  const parts = dur.trim().split(':').map(Number);
  if (parts.length === 2) return (parts[0] * 60) + parts[1];
  if (parts.length === 3) return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
  const num = parseFloat(dur);
  return isNaN(num) ? 15 : num;
}

function scoreCandidatePool(pool, topTags = {}, dislikedSet = new Set(), recentTags = []) {
  // UPGRADE 2: Calculate Session Category Fatigue
  const tagStreak = {};
  if (Array.isArray(recentTags)) {
    for (const t of recentTags) {
      tagStreak[t] = (tagStreak[t] || 0) + 1;
    }
  }

  return pool.map(v => {
    const vTags = v.tags || [];
    let userAffinity = 0;
    let dislikePenalty = 0;
    let fatiguePenalty = 0;

    for (const t of vTags) {
      if (topTags[t] !== undefined) {
        userAffinity += Number(topTags[t]);
      }
      if (dislikedSet.has(t)) {
        dislikePenalty += 15;
      }
      // If user recently saw 3 or more videos with this tag in this session, apply fatigue decay
      const count = tagStreak[t] || 0;
      if (count >= 3) {
        fatiguePenalty += (count - 2) * 2.5; // gently deprioritizes to force variety
      }
    }

    const globalHeat = getVideoHeatScore(v.id, v.likes);
    const jitter = (Math.random() - 0.5) * 1.8;
    const totalScore = (userAffinity * 1.8) + (globalHeat * 1.2) - dislikePenalty - fatiguePenalty + jitter;

    return {
      video: v,
      userAffinity,
      globalHeat,
      totalScore
    };
  });
}

function selectFromScoredPool(scored, targetCount, seenSet = new Set()) {
  if (!scored || scored.length === 0 || targetCount <= 0) return [];

  const selectedIds = new Set();
  const batch = [];

  const takeFromList = (list, count) => {
    let added = 0;
    for (const item of list) {
      if (added >= count) break;
      if (!selectedIds.has(item.video.id)) {
        selectedIds.add(item.video.id);
        batch.push(item.video);
        added++;
      }
    }
  };

  const byTotalScore = [...scored].sort((a, b) => b.totalScore - a.totalScore);
  takeFromList(byTotalScore, 1);

  const exploitCount = Math.max(1, Math.round(targetCount * 0.45));
  takeFromList(byTotalScore, exploitCount);

  const crowdCount = Math.max(1, Math.round(targetCount * 0.25));
  const byGlobalHeat = [...scored].sort((a, b) => (b.globalHeat + Math.random()) - (a.globalHeat + Math.random()));
  takeFromList(byGlobalHeat, crowdCount);

  const exploreCount = Math.max(1, Math.round(targetCount * 0.20));
  const byDiscovery = [...scored]
    .filter(item => item.userAffinity >= 0)
    .sort(() => Math.random() - 0.5);
  takeFromList(byDiscovery, exploreCount);

  const wildcardPool = [...scored].sort(() => Math.random() - 0.5);
  takeFromList(wildcardPool, targetCount - batch.length);

  return batch;
}

function weightedZipper(desiArr = [], engArr = [], targetRatio = 0.5) {
  const result = [];
  let dIdx = 0;
  let eIdx = 0;
  let runningDesi = 0;
  let runningTotal = 0;

  while (dIdx < desiArr.length || eIdx < engArr.length) {
    if (dIdx >= desiArr.length) {
      result.push(engArr[eIdx++]);
    } else if (eIdx >= engArr.length) {
      result.push(desiArr[dIdx++]);
    } else {
      const currentRatio = runningTotal === 0 ? 0 : runningDesi / runningTotal;
      if (currentRatio < targetRatio) {
        result.push(desiArr[dIdx++]);
        runningDesi++;
      } else {
        result.push(engArr[eIdx++]);
      }
      runningTotal++;
    }
  }
  return result;
}

function antiClumpPass(reels = []) {
  const arr = [...reels];
  for (let i = 1; i < arr.length; i++) {
    const prev = arr[i - 1];
    const curr = arr[i];
    const prevTag = prev.tags?.[0] || prev.source;
    const currTag = curr.tags?.[0] || curr.source;

    if (prevTag === currTag && prev.author === curr.author) {
      for (let j = i + 1; j < arr.length; j++) {
        const cand = arr[j];
        const candTag = cand.tags?.[0] || cand.source;
        if (candTag !== prevTag || cand.author !== prev.author) {
          arr[i] = cand;
          arr[j] = curr;
          break;
        }
      }
    }
  }
  return arr;
}

async function getPersonalizedFeed({
  source = 'trending',
  limit = 20,
  desiRatio = 0.5,
  topTags = {},
  dislikedTags = [],
  recentSeenIds = [],
  recentTags = [],
  sessionSeed = Date.now()
} = {}) {
  const lim = Math.min(30, Math.max(4, parseInt(limit, 10) || 20));
  const clampedDesiRatio = Math.min(0.80, Math.max(0.20, Number(desiRatio) || 0.50));
  const seenSet = new Set(Array.isArray(recentSeenIds) ? recentSeenIds : []);
  const dislikedSet = new Set(Array.isArray(dislikedTags) ? dislikedTags : []);

  const normalizedSource = (source || 'trending').toLowerCase().trim();
  const isPureDesi = normalizedSource === 'desi' || normalizedSource === 'kamababa' || normalizedSource === 'viralmms' || normalizedSource === 'vmms';
  const isPureWestern = normalizedSource === 'western' || normalizedSource === 'tikpron';
  const isPureEnglish = normalizedSource === 'english' || normalizedSource === 'nuditok' || normalizedSource === 'onlytik';
  const isTrending = !isPureDesi && !isPureWestern && !isPureEnglish;

  let desiSelected = [];
  let englishSelected = [];

  // 1. Process Desi Pool (KamaBaba + ViralMMS)
  if (isPureDesi || isTrending) {
    const targetDesiCount = isPureDesi ? lim : Math.max(2, Math.round(lim * clampedDesiRatio));
    if (normalizedSource === 'viralmms' || normalizedSource === 'vmms') {
      let pool = vmmsDesiList.filter(v => v && v.streamUrl && !seenSet.has(v.id));
      if (pool.length < targetDesiCount) pool = vmmsDesiList.filter(v => v && v.streamUrl);
      const scored = scoreCandidatePool(pool, topTags, dislikedSet, recentTags);
      desiSelected = selectFromScoredPool(scored, targetDesiCount, seenSet);
    } else if (normalizedSource === 'kamababa') {
      let pool = kamababaList.filter(v => v && v.streamUrl && !seenSet.has(v.id));
      if (pool.length < targetDesiCount) pool = kamababaList.filter(v => v && v.streamUrl);
      const scored = scoreCandidatePool(pool, topTags, dislikedSet);
      desiSelected = selectFromScoredPool(scored, targetDesiCount, seenSet);
    } else {
      // Balanced Desi MMS + KamaBaba Selection (50/50 blend so ViralMMS is never drowned out)
      const halfCount = Math.max(1, Math.floor(targetDesiCount / 2));
      const remainingCount = targetDesiCount - halfCount;

      let vmmsPool = vmmsDesiList.filter(v => v && v.streamUrl && !seenSet.has(v.id));
      if (vmmsPool.length < halfCount) vmmsPool = vmmsDesiList.filter(v => v && v.streamUrl);
      const vmmsScored = scoreCandidatePool(vmmsPool, topTags, dislikedSet, recentTags);
      const vmmsBatch = selectFromScoredPool(vmmsScored, halfCount, seenSet);

      let kmbPool = kamababaList.filter(v => v && v.streamUrl && !seenSet.has(v.id));
      if (kmbPool.length < remainingCount) kmbPool = kamababaList.filter(v => v && v.streamUrl);
      const kmbScored = scoreCandidatePool(kmbPool, topTags, dislikedSet, recentTags);
      const kmbBatch = selectFromScoredPool(kmbScored, remainingCount, seenSet);

      const blended = [];
      const maxLen = Math.max(vmmsBatch.length, kmbBatch.length);
      for (let i = 0; i < maxLen; i++) {
        if (i < vmmsBatch.length) blended.push(vmmsBatch[i]);
        if (i < kmbBatch.length) blended.push(kmbBatch[i]);
      }
      desiSelected = blended.slice(0, targetDesiCount);
    }
  }

  // 2. Process Western / English Pool (Pure 9:16 Vertical TikPron + NudiTok API)
  if (isPureWestern) {
    let pool = westernReelsList.filter(v => v && v.streamUrl && !seenSet.has(v.id));
    if (pool.length < lim) pool = westernReelsList.filter(v => v && v.streamUrl);
    const scored = scoreCandidatePool(pool, topTags, dislikedSet);
    englishSelected = selectFromScoredPool(scored, lim, seenSet);
  } else if (isPureEnglish || isTrending) {
    const targetEnglishCount = isPureEnglish ? lim : Math.max(2, lim - desiSelected.length);
    
    // Select verified in-memory 9:16 Western reels (0ms instant latency)
    let westernBatch = [];
    if (westernReelsList.length > 0) {
      let wPool = westernReelsList.filter(v => v && v.streamUrl && !seenSet.has(v.id));
      if (wPool.length < 2) wPool = westernReelsList.filter(v => v && v.streamUrl);
      const wScored = scoreCandidatePool(wPool, topTags, dislikedSet);
      const wTarget = Math.max(1, Math.round(targetEnglishCount * 0.5));
      westernBatch = selectFromScoredPool(wScored, wTarget, seenSet);
    }

    try {
      const targetTag = resolveNuditokTag(topTags);
      const queryCount = Math.min(50, targetEnglishCount * 2);
      const randomOffset = Math.floor((sessionSeed % 20) * targetEnglishCount);
      const nudiRes = targetTag === 'trending'
        ? await nuditok.getTrendingVideos(1, queryCount, randomOffset)
        : await nuditok.getTagVideos(targetTag, 1, queryCount, randomOffset);

      const rawVideos = Array.isArray(nudiRes?.videos) ? nudiRes.videos : [];
      const mappedEnglish = rawVideos.map(v => {
        const durSec = parseDurationSecs(v.duration);
        return {
          id: v.id,
          title: v.title || 'Trending Reel',
          streamUrl: v.video_url || v.streamUrl,
          poster: v.poster || v.thumb || '',
          thumb: v.thumb || v.poster || '',
          duration: v.duration || '0:15',
          durationSec: durSec,
          ratio: 0.5625,
          author: v.author ? `@${v.author.replace(/^@/, '')}` : '@TikTokReels',
          views: v.views || '88k',
          likes: v.likes || 2400,
          tags: extractTags(v.title, v.description, targetTag, 'nuditok'),
          source: 'english',
          category: 'reels'
        };
      }).filter(v => v.streamUrl);

      // Interleave westernBatch with NudiTok
      const combinedEnglish = [];
      let w = 0, n = 0;
      while (w < westernBatch.length || n < mappedEnglish.length) {
        if (w < westernBatch.length) combinedEnglish.push(westernBatch[w++]);
        if (n < mappedEnglish.length) combinedEnglish.push(mappedEnglish[n++]);
      }

      const candidatesEnglish = combinedEnglish.length > 0 ? combinedEnglish : (westernBatch.length > 0 ? westernBatch : mappedEnglish);
      let unseenEnglish = candidatesEnglish.filter(v => !seenSet.has(v.id));
      if (unseenEnglish.length < targetEnglishCount) unseenEnglish = candidatesEnglish;

      const scoredEnglish = scoreCandidatePool(unseenEnglish, topTags, dislikedSet, recentTags);
      englishSelected = selectFromScoredPool(scoredEnglish, targetEnglishCount, seenSet);
    } catch (e) {
      console.warn('[Reels Catalog] NudiTok fetch fallback, using Western RAM pool:', e.message);
      if (westernBatch.length > 0) {
        englishSelected = westernBatch;
      } else if (isTrending && desiSelected.length < lim) {
        const desiPool = [...vmmsDesiList, ...kamababaList];
        const extraNeeded = lim - desiSelected.length;
        desiSelected.push(...desiPool.slice(0, extraNeeded));
      }
    }
  }

  // 3. Assemble and Zipper
  let finalReels = [];
  if (isPureDesi) {
    finalReels = desiSelected;
  } else if (isPureWestern || isPureEnglish) {
    finalReels = englishSelected;
  } else {
    finalReels = weightedZipper(desiSelected, englishSelected, clampedDesiRatio);
  }

  const hook = finalReels[0];
  const rest = antiClumpPass(finalReels.slice(1));
  const ordered = hook ? [hook, ...rest] : rest;

  const total = isPureDesi
    ? (vmmsDesiList.length + kamababaList.length)
    : (isPureWestern ? westernReelsList.length : (vmmsDesiList.length + kamababaList.length + westernReelsList.length + 11525));

  return {
    ok: true,
    source: normalizedSource,
    desiRatio: clampedDesiRatio,
    total,
    hasMore: true,
    reels: ordered.slice(0, lim)
  };
}

async function getReels(source = 'all', page = 1, limit = 20) {
  return getPersonalizedFeed({
    source,
    limit,
    topTags: {},
    dislikedTags: [],
    recentSeenIds: [],
    sessionSeed: page * 997
  });
}

module.exports = {
  getReels,
  getPersonalizedFeed,
  recordTelemetry,
  initCatalogs
};
