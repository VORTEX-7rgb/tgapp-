const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const MATRIX_FILE = path.join(DATA_DIR, 'co_watch_matrix.json');

// In-Memory Graph: sourceId -> { targetId: weight }
// Max 10,000 nodes (~1.2 MB RAM ceiling)
let coWatchGraph = {};
let saveTimer = null;
let pendingUpdates = 0;

function loadMatrix() {
  try {
    if (fs.existsSync(MATRIX_FILE)) {
      coWatchGraph = JSON.parse(fs.readFileSync(MATRIX_FILE, 'utf8')) || {};
    }
  } catch (err) {
    console.warn('[Co-Watch Engine] Starting fresh matrix:', err.message);
    coWatchGraph = {};
  }
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    pendingUpdates = 0;
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(MATRIX_FILE, JSON.stringify(coWatchGraph, null, 2), 'utf8');
    } catch (err) {
      console.error('[Co-Watch Engine] Failed saving matrix:', err.message);
    }
  }, 30000); // Debounced save every 30 seconds
}

function recordCoWatch(sourceId, targetId, weight = 1.0) {
  if (!sourceId || !targetId || sourceId === targetId) return;
  const sId = String(sourceId);
  const tId = String(targetId);

  // Eviction guard if graph exceeds 10,000 nodes
  if (!coWatchGraph[sId] && Object.keys(coWatchGraph).length > 10000) {
    const firstKey = Object.keys(coWatchGraph)[0];
    delete coWatchGraph[firstKey];
  }

  if (!coWatchGraph[sId]) coWatchGraph[sId] = {};
  coWatchGraph[sId][tId] = +((coWatchGraph[sId][tId] || 0) + weight).toFixed(2);

  // Bidirectional gentle link (target -> source +0.25)
  if (!coWatchGraph[tId]) coWatchGraph[tId] = {};
  coWatchGraph[tId][sId] = +((coWatchGraph[tId][sId] || 0) + (weight * 0.25)).toFixed(2);

  pendingUpdates++;
  if (pendingUpdates >= 25) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
  }
  scheduleSave();
}

/**
 * Returns a normalized Map of targetId -> score (0.0 to 1.0)
 * Prevents popularity bias by normalizing against the maximum edge weight for sourceId
 */
function getNormalizedWeights(sourceId) {
  if (!sourceId) return new Map();
  const sId = String(sourceId);
  const targets = coWatchGraph[sId];
  if (!targets || Object.keys(targets).length === 0) return new Map();

  const map = new Map();
  let maxWeight = 0;
  for (const w of Object.values(targets)) {
    if (w > maxWeight) maxWeight = w;
  }
  if (maxWeight <= 0) return map;

  for (const [targetId, weight] of Object.entries(targets)) {
    map.set(targetId, +(weight / maxWeight).toFixed(3));
  }
  return map;
}

function getCoWatchedIds(sourceId, limit = 6) {
  if (!sourceId) return [];
  const sId = String(sourceId);
  const targets = coWatchGraph[sId];
  if (!targets) return [];

  return Object.entries(targets)
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit)
    .map(([id]) => id);
}

loadMatrix();

module.exports = {
  recordCoWatch,
  getNormalizedWeights,
  getCoWatchedIds,
  loadMatrix
};
