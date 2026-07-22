/**
 * Message Handler — infinityX Bot
 * Developer: Tarif Ahmed (infinityX)
 * Telegram: https://t.me/infinityxbd
 */
const gemini = require('../ai/gemini');
const { readJSON } = require('../storage/store');
const { handleCommand } = require('./commands');

const MAX_HISTORY = 7;
const chatHistories = {};

function formatTime() {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1) * 1000) + min * 1000;
}

function getChatHistory(chatId) {
  if (!chatHistories[chatId]) chatHistories[chatId] = [];
  return chatHistories[chatId];
}

function addToHistory(chatId, role, text) {
  const history = getChatHistory(chatId);
  history.push({ role, text });
  while (history.length > MAX_HISTORY) history.shift();
}

async function sendMessage(chatId, text, message, client) {
  try {
    await message.reply(text);
    return true;
  } catch (e) {}
  try {
    const chat = await client.getChatById(chatId);
    await chat.sendMessage(text);
    return true;
  } catch (e2) {
    console.error(`❌ Send failed: ${e2.message}`);
    return false;
  }
}

async function checkMutedArchived(chatId, client) {
  try {
    const chat = await client.getChatById(chatId);
    if (chat.isMuted) return 'muted';
    if (chat.archived) return 'archived';
    return null;
  } catch (e) {}
  try {
    const result = await client.pupPage.evaluate((id) => {
      try {
        const Chat = window.require('WAWebCollections').Chat;
        const model = Chat.getModelsArray().find(c => c.id && c.id._serialized === id);
        if (!model) return null;
        const isMuted = model.mute && model.mute.expiration !== 0;
        const isArchived = !!model.archive;
        if (isMuted) return 'muted';
        if (isArchived) return 'archived';
        return null;
      } catch (e) { return null; }
    }, chatId);
    return result;
  } catch (e) {}
  return null;
}

async function handleMessage(message, client) {
  try {
    if (message.type !== 'chat') return;

    const { botState } = require('./whatsapp');
    const isGroup = message.from.endsWith('@g.us');

    const chatCheck = await checkMutedArchived(message.from, client);
    if (chatCheck) {
      console.log(`⏭️ Ignored (${chatCheck}): ${message.from}`);
      return;
    }

    const commandSenderId = isGroup ? (message.author || message.from) : message.from;

    const isCommand = await handleCommand(message, client, botState.botWid, botState.lidMap, commandSenderId);
    if (isCommand) return;

    if (message.fromMe) return;

    const config = readJSON('config.json') || {};
    const blocklist = readJSON('blocklist.json') || { numbers: [], groups: [] };

    if (isGroup && !config.replyToGroups) return;
    if (!isGroup && !config.replyToInbox) return;

    if (blocklist.numbers.includes(message.from)) return;
    if (isGroup && blocklist.groups.includes(message.from)) return;
    if (config.botEnabled === false) return;

    const chatId = message.from;
    const userMsg = message.body;
    console.log(`💬 [${formatTime()}] ${isGroup ? 'Group' : 'Inbox'}: ${chatId}`);
    console.log(`📨 "${userMsg}"`);

    await sleep(randomBetween(1, 3));

    try { await client.sendSeen(chatId); } catch (e) {}

    try {
      await client.pupPage.evaluate((id) => {
        window.WWebJS.sendChatstate('typing', id);
        return true;
      }, chatId);
    } catch (e) {}

    await sleep(randomBetween(5, 10));

    addToHistory(chatId, 'user', userMsg);
    const history = getChatHistory(chatId);

    const aiResponse = await gemini.generateReply(userMsg, history);
    console.log(`🤖 Reply: "${aiResponse}"`);

    addToHistory(chatId, 'model', aiResponse);

    try {
      await client.pupPage.evaluate((id) => {
        window.WWebJS.sendChatstate('stop', id);
        return true;
      }, chatId);
    } catch (e) {}

    await sendMessage(chatId, aiResponse, message, client);
    console.log(`✅ Sent to ${chatId}`);

    try { await client.sendPresenceAvailable(); } catch (e) {}
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

module.exports = { handleMessage };
