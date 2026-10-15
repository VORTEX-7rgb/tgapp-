const fs = require('fs');
const path = require('path');
const { BOT_TOKEN } = require('./config');

const DB_PATH = path.join(__dirname, 'data', 'videos.json');

function getAllVideos() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      fs.writeFileSync(DB_PATH, '[]', 'utf8');
      return [];
    }
    const data = fs.readFileSync(DB_PATH, 'utf8');
    return JSON.parse(data || '[]');
  } catch (err) {
    console.error('[DB Error] Failed to read videos:', err.message);
    return [];
  }
}

function saveVideos(videos) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(videos, null, 2), 'utf8');
  } catch (err) {
    console.error('[DB Error] Failed to save videos:', err.message);
  }
}

function addVideo({ messageId, title, duration = '0:00', category = 'Delta Course', fileId = null, filePath = null }) {
  const videos = getAllVideos();
  const existingIndex = videos.findIndex(v => String(v.messageId) === String(messageId));

  const entry = {
    messageId: Number(messageId),
    title: title || `Lecture #${messageId}`,
    duration: duration,
    category: category,
    fileId: fileId,
    filePath: filePath,
    addedAt: new Date().toISOString()
  };

  if (existingIndex >= 0) {
    videos[existingIndex] = { ...videos[existingIndex], ...entry };
  } else {
    videos.push(entry);
  }

  saveVideos(videos);
  console.log(`[DB] Indexed video #${messageId}: "${entry.title}" (fileId: ${fileId ? 'Yes' : 'No'})`);
  return entry;
}

function getVideoByMessageId(messageId) {
  const videos = getAllVideos();
  return videos.find(v => String(v.messageId) === String(messageId));
}

async function getFilePath(fileId) {
  if (!fileId) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`);
    const data = await res.json();
    if (data.ok && data.result.file_path) {
      return data.result.file_path;
    }
    console.error('[GetFile Error]:', data.description);
    return null;
  } catch (e) {
    console.error('[GetFile Network Error]:', e.message);
    return null;
  }
}

module.exports = {
  getAllVideos,
  addVideo,
  getVideoByMessageId,
  getFilePath
};
