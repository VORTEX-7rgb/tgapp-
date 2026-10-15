const { BOT_TOKEN } = require('./config');

const BASE_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;

async function apiCall(method, body = {}) {
  const url = `${BASE_URL}/${method}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!data.ok) {
      console.error(`[Telegram API Error] ${method}:`, data.description);
    }
    return data;
  } catch (err) {
    console.error(`[Telegram Network Error] ${method}:`, err.message);
    return { ok: false, description: err.message };
  }
}

async function copyMessage(toChatId, fromChatId, messageId, protectContent = true) {
  console.log(`[CopyMessage] Sending msg ${messageId} from ${fromChatId} to ${toChatId} (DRM protected: ${protectContent})`);
  return apiCall('copyMessage', {
    chat_id: toChatId,
    from_chat_id: fromChatId,
    message_id: messageId,
    protect_content: protectContent
  });
}

async function sendMessage(chatId, text, extra = {}) {
  return apiCall('sendMessage', {
    chat_id: chatId,
    text: text,
    ...extra
  });
}

async function getUpdates(offset = 0, timeout = 30) {
  return apiCall('getUpdates', {
    offset: offset,
    timeout: timeout,
    allowed_updates: ['message', 'channel_post', 'callback_query']
  });
}

async function setWebhook(url) {
  return apiCall('setWebhook', { url });
}

async function deleteWebhook() {
  return apiCall('deleteWebhook', {});
}

module.exports = {
  apiCall,
  copyMessage,
  sendMessage,
  getUpdates,
  setWebhook,
  deleteWebhook
};
