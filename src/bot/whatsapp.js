/**
 * WhatsApp Client — infinityX Bot
 * Developer: Tarif Ahmed (infinityX)
 * Telegram: https://t.me/infinityxbd
 */
const { Client, LocalAuth } = require('whatsapp-web.js');
const { handleMessage } = require('./handler');
const { execSync } = require('child_process');

process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught exception:', err.message);
});

process.on('unhandledRejection', (err) => {
  console.error('❌ Unhandled rejection:', err?.message || err);
});

function findChrome() {
  const paths = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/snap/bin/chromium',
    '/home/codespace/.cache/puppeteer/chrome/linux-146.0.7680.31/chrome-linux64/chrome',
    '/home/codespace/.cache/puppeteer/chrome/linux-121.0.6167.85/chrome-linux64/chrome',
  ];
  for (const p of paths) {
    try {
      if (require('fs').existsSync(p)) return p;
    } catch (e) {}
  }
  try {
    const found = execSync('which chromium chromium-browser google-chrome google-chrome-stable 2>/dev/null', { encoding: 'utf-8' }).trim();
    if (found) return found.split('\n')[0];
  } catch (e) {}
  return undefined;
}

const chromePath = findChrome();
if (chromePath) {
  console.log(`🌐 Chrome: ${chromePath}`);
} else {
  console.log('⚠️ No Chrome found — Puppeteer will download its own');
}

const args = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-accelerated-2d-canvas',
  '--no-first-run',
  '--no-zygote',
  '--disable-gpu',
  '--disable-blink-features=AutomationControlled',
  '--disable-features=IsolateOrigins,site-per-process',
  '--window-size=1280,720',
];

const puppeteerConfig = {
  headless: true,
  args,
  defaultViewport: { width: 1280, height: 720 },
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

if (chromePath) {
  puppeteerConfig.executablePath = chromePath;
}

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: '.wwebjs_auth' }),
  puppeteer: puppeteerConfig,
});

const botState = { status: 'offline', startTime: null, botWid: null, lidMap: {} };

function setBotStatus(status) {
  botState.status = status;
  if (status === 'online') botState.startTime = Date.now();
}

let onlineInterval = null;

function cleanWid(id) {
  return String(id).replace(/@c\.us/, '').replace(/@lid/, '').replace(/@g\.us/, '');
}

// Lazy LID resolver — looks up a single contact on demand
async function resolveLid(senderId) {
  try {
    const contact = await client.getContactById(senderId);
    if (contact) {
      // Try phone number first
      if (contact.number) {
        const phone = contact.number.replace(/\D/g, '');
        const lid = cleanWid(senderId);
        if (phone && lid) {
          botState.lidMap[lid] = phone;
          botState.lidMap[phone] = lid;
          console.log(`🔍 resolveLid: ${senderId} → phone: ${phone}`);
          return phone;
        }
      }
      // Try pushname as fallback
      if (contact.pushname) {
        console.log(`🔍 resolveLid: ${senderId} → pushname: ${contact.pushname}`);
      }
    }
  } catch (e) {
    console.log(`🔍 resolveLid failed for ${senderId}: ${e.message}`);
  }
  return null;
}

client.on('loading_screen', (percent, message) => {
  console.log(`🔄 Loading: ${percent}% - ${message}`);
});

let qrShown = false;
client.on('qr', async (qr) => {
  if (!qrShown) {
    console.log('📱 QR ready — pair from Admin Panel → WhatsApp Login');
    qrShown = true;
  }
});

client.on('authenticated', () => {
  console.log('✅ WhatsApp authenticated!');
});

client.on('auth_failure', (msg) => {
  console.error('❌ Auth failed:', msg);
  botState.status = 'offline';
});

client.on('ready', async () => {
  const wid = client.info.wid;
  const botWid = wid._serialized || wid;
  botState.botWid = botWid;
  botState.status = 'online';
  botState.startTime = Date.now();
  console.log(`🟢 Bot ONLINE! WID: ${botWid}`);

  try { await client.sendPresenceAvailable(); } catch (e) {}

  if (onlineInterval) clearInterval(onlineInterval);
  onlineInterval = setInterval(async () => {
    try { await client.sendPresenceAvailable(); } catch (e) {}
  }, 120000);
});

client.on('disconnected', (reason) => {
  console.log('🔴 Disconnected:', reason);
  botState.status = 'offline';
  if (onlineInterval) clearInterval(onlineInterval);
});

client.on('message', async (message) => {
  await handleMessage(message, client);
});

module.exports = { client, botState, setBotStatus, resolveLid };
