const { BOT_TOKEN, CHANNEL_ID, WEB_APP_URL } = require('./config');
const { getUpdates, copyMessage, sendMessage, apiCall } = require('./telegram');
const { getAllVideos, addVideo, getVideoByMessageId } = require('./videos');

let lastUpdateId = 0;
let isPolling = false;

function formatDuration(seconds) {
  if (!seconds) return '5m 00s';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs < 10 ? '0' : ''}${secs}s`;
}

async function handleUpdate(update) {
  // 1. Listen for new uploads in the storage channel
  if (update.channel_post) {
    const post = update.channel_post;
    const channelIdStr = String(post.chat.id);
    
    // Check if it belongs to our channel
    if (channelIdStr === String(CHANNEL_ID)) {
      console.log(`[Channel Post] Detected new post in channel: message_id ${post.message_id}`);
      let title = post.caption || '';
      let duration = '5m 00s';

      let fileId = null;

      if (post.video) {
        title = title || post.video.file_name || `Lecture #${post.message_id}`;
        duration = formatDuration(post.video.duration);
        fileId = post.video.file_id;
      } else if (post.document) {
        title = title || post.document.file_name || `Document #${post.message_id}`;
        fileId = post.document.file_id;
      } else if (post.text) {
        title = post.text.split('\n')[0].substring(0, 50);
      } else {
        title = `Lecture #${post.message_id}`;
      }

      addVideo({
        messageId: post.message_id,
        title: title,
        duration: duration,
        category: 'Delta Course',
        fileId: fileId
      });
      return;
    }
  }

  // 2. Handle Callback Queries (when a user taps an inline button)
  if (update.callback_query) {
    const cq = update.callback_query;
    const data = cq.data || '';
    const userId = cq.from.id;

    if (data.startsWith('play_')) {
      const msgId = Number(data.replace('play_', ''));
      await apiCall('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: '⚡ Loading lecture stream...'
      });

      console.log(`[Playback Request] User ${userId} requested video #${msgId}`);
      const res = await copyMessage(userId, CHANNEL_ID, msgId, true);
      
      if (!res.ok) {
        await sendMessage(userId, `⚠️ Could not load lecture #${msgId}: ${res.description || 'Channel message not found'}. Make sure the message exists in the storage channel!`);
      }
      return;
    }
  }

  // 3. Handle Private Chat Messages (/start, /courses, /index)
  if (update.message && update.message.chat.type === 'private') {
    const msg = update.message;
    const userId = msg.chat.id;
    const text = (msg.text || '').trim();

    // Command: /start or /app
    if (text.startsWith('/start') || text.startsWith('/app')) {
      let reply = `🎬 *Welcome to StreamBox!*\n\n` +
        `Enjoy fast video streaming with *zero ads*, *zero popups*, and *direct CDN playback*.\n\n` +
        `Tap the button below or the menu button in the bottom left to launch the Mini App:`;

      const inlineKeyboard = [
        [
          {
            text: '🎬 Open StreamBox (Mini App)',
            web_app: { url: WEB_APP_URL }
          }
        ]
      ];

      await sendMessage(userId, reply, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: inlineKeyboard
        }
      });
      return;
    }

    // Command: /courses or /list
    if (text === '/courses' || text === '/list') {
      const videos = getAllVideos();
      const keyboard = [
        [
          {
            text: '🎬 Open StreamBox (Mini App)',
            web_app: { url: WEB_APP_URL }
          }
        ]
      ];

      if (videos.length > 0) {
        videos.forEach(v => {
          keyboard.push([{
            text: `▶️ ${v.title} (${v.duration})`,
            callback_data: `play_${v.messageId}`
          }]);
        });
      } else {
        keyboard.push([{
          text: '📭 No videos yet',
          callback_data: 'noop'
        }]);
      }

      await sendMessage(userId, '📖 *Course Catalog:*\nTap any lecture below to start streaming immediately:', {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
      });
      return;
    }

    // Command: /index <messageId> <title>
    // Allows manually indexing existing channel videos
    if (text.startsWith('/index')) {
      const parts = text.split(' ');
      const msgId = Number(parts[1]);
      const title = parts.slice(2).join(' ') || `Lecture #${msgId}`;

      if (!msgId) {
        await sendMessage(userId, 'Usage: `/index <message_id> <Lecture Title>`\nExample: `/index 1 Welcome to Delta`', { parse_mode: 'Markdown' });
        return;
      }

      addVideo({ messageId: msgId, title: title, duration: '10m 00s' });
      await sendMessage(userId, `✅ Indexed message *#${msgId}* as "*${title}*"!\nNow tap below to test delivery:`, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: `▶️ Watch ${title}`, callback_data: `play_${msgId}` }]]
        }
      });
      return;
    }
  }
}

async function startPolling() {
  if (isPolling) return;
  isPolling = true;
  console.log('[Bot] Polling loop started for @Fiziiiibot...');

  while (isPolling) {
    try {
      const updatesRes = await getUpdates(lastUpdateId + 1, 15);
      if (updatesRes.ok && Array.isArray(updatesRes.result)) {
        for (const update of updatesRes.result) {
          lastUpdateId = Math.max(lastUpdateId, update.update_id);
          try {
            await handleUpdate(update);
          } catch (handlerErr) {
            console.error('[Update Handler Error]:', handlerErr);
          }
        }
      }
    } catch (err) {
      console.error('[Polling Network Error]:', err.message);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

function stopPolling() {
  isPolling = false;
}

module.exports = {
  startPolling,
  stopPolling,
  handleUpdate
};
