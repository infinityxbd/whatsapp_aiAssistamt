/**
 * Admin Routes — infinityX Bot
 * Developer: Tarif Ahmed (infinityX)
 * Telegram: https://t.me/infinityxbd
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const { readJSON, writeJSON } = require('../storage/store');
const { requireAuth } = require('./middleware');

function createRoutes(botState, client) {
  const router = express.Router();

  router.use(requireAuth);

  // Serve login page (no auth required for GET)
  router.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'views/login.html'));
  });

  // Serve dashboard (auth required via middleware)
  router.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'views/dashboard.html'));
  });

  // Auth routes
  router.post('/login', async (req, res) => {
    const { password } = req.body;
    const config = readJSON('config.json') || {};

    if (!config.adminPasswordHash) {
      return res.redirect('/admin/login?error=1');
    }

    const match = await bcrypt.compare(password, config.adminPasswordHash);
    if (match) {
      req.session.authenticated = true;
      return res.redirect('/admin/dashboard');
    }
    res.redirect('/admin/login?error=1');
  });

  router.post('/logout', (req, res) => {
    req.session.destroy(() => {
      res.redirect('/admin/login');
    });
  });

  // API: Status
  router.get('/api/status', (req, res) => {
    const uptime = botState.startTime ? Math.floor((Date.now() - botState.startTime) / 1000) : 0;
    res.json({
      status: botState.status,
      uptime,
      startTime: botState.startTime
    });
  });

  // API: Settings
  router.get('/api/settings', (req, res) => {
    const config = readJSON('config.json') || {};
    res.json({
      botPrompt: config.botPrompt || '',
      replyToInbox: config.replyToInbox !== false,
      replyToGroups: config.replyToGroups === true,
      botName: config.botName || 'AI Assistant',
      botEnabled: config.botEnabled !== false
    });
  });

  router.post('/api/settings', (req, res) => {
    const { botPrompt, replyToInbox, replyToGroups, botName, botEnabled } = req.body;
    const config = readJSON('config.json') || {};

    if (typeof botPrompt === 'string') config.botPrompt = botPrompt;
    if (typeof replyToInbox === 'boolean') config.replyToInbox = replyToInbox;
    if (typeof replyToGroups === 'boolean') config.replyToGroups = replyToGroups;
    if (typeof botName === 'string') config.botName = botName;

    writeJSON('config.json', config);
    res.json({ success: true });
  });

  // API: Bot On/Off Toggle
  router.get('/api/bot-toggle', (req, res) => {
    const config = readJSON('config.json') || {};
    res.json({ enabled: config.botEnabled !== false });
  });

  router.post('/api/bot-toggle', async (req, res) => {
    const { enabled } = req.body;
    const config = readJSON('config.json') || {};
    config.botEnabled = enabled;
    writeJSON('config.json', config);

    try {
      if (client) {
        if (enabled) {
          await client.sendPresenceAvailable();
          console.log('🟢 Bot enabled via admin panel - presence ONLINE');
        } else {
          await client.sendPresenceUnavailable();
          console.log('🔴 Bot disabled via admin panel - presence OFFLINE');
        }
      }
    } catch (e) {
      console.error('⚠️ Failed to toggle presence:', e.message);
    }

    res.json({ success: true, enabled });
  });

  // API: Keys
  router.get('/api/keys', (req, res) => {
    const keys = readJSON('apikeys.json') || [];
    const masked = keys.map(k => ({
      ...k,
      apiKey: '••••••••••••' + k.apiKey.slice(-4)
    }));
    res.json(masked);
  });

  router.post('/api/keys', (req, res) => {
    const { name, apiKey, endpoint, model } = req.body;
    if (!name || !apiKey) {
      return res.status(400).json({ error: 'Name and API key are required' });
    }

    const keys = readJSON('apikeys.json') || [];
    const newKey = {
      id: uuidv4(),
      name,
      apiKey,
      endpoint: endpoint || 'https://generativelanguage.googleapis.com',
      model: model || 'gemini-1.5-flash',
      enabled: true,
      addedAt: new Date().toISOString()
    };
    keys.push(newKey);
    writeJSON('apikeys.json', keys);
    res.json({ success: true, id: newKey.id });
  });

  router.delete('/api/keys/:id', (req, res) => {
    let keys = readJSON('apikeys.json') || [];
    keys = keys.filter(k => k.id !== req.params.id);
    writeJSON('apikeys.json', keys);
    res.json({ success: true });
  });

  router.patch('/api/keys/:id', (req, res) => {
    const keys = readJSON('apikeys.json') || [];
    const key = keys.find(k => k.id === req.params.id);
    if (!key) return res.status(404).json({ error: 'Key not found' });
    key.enabled = req.body.enabled !== undefined ? req.body.enabled : !key.enabled;
    writeJSON('apikeys.json', keys);
    res.json({ success: true, enabled: key.enabled });
  });

  // API: Check API key health
  router.get('/api/keys/check', async (req, res) => {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const keys = readJSON('apikeys.json') || [];
    const results = [];

    for (const key of keys) {
      try {
        const genAI = new GoogleGenerativeAI(key.apiKey);
        const model = genAI.getGenerativeModel({ model: key.model || 'gemini-2.0-flash-lite' });
        await model.generateContent('hi');
        results.push({ id: key.id, status: 'ok', error: null });
      } catch (e) {
        const errMsg = e.message || 'Unknown error';
        let friendly = 'Unknown error';
        if (errMsg.includes('429')) friendly = 'Rate limited / Quota exceeded';
        else if (errMsg.includes('403')) friendly = 'Invalid API key / Access denied';
        else if (errMsg.includes('404')) friendly = 'Model not found';
        else if (errMsg.includes('fetch')) friendly = 'Network error';
        else friendly = errMsg.substring(0, 80);
        results.push({ id: key.id, status: 'error', error: friendly });
      }
    }

    const keyStatusPath = require('path').join(__dirname, '../../data/keystatus.json');
    require('fs').writeFileSync(keyStatusPath, JSON.stringify(results, null, 2));
    res.json(results);
  });

  // API: Contacts (for blocklist search)
  router.get('/api/contacts', (req, res) => {
    try {
      if (client && client.info && client.contacts) {
        const contacts = client.contacts.map(c => ({
          id: c.id._serialized || c.id,
          name: c.name || c.pushname || c.id.user || 'Unknown',
          number: c.id.user || c.id
        }));
        res.json(contacts);
      } else {
        res.json([]);
      }
    } catch (e) {
      res.json([]);
    }
  });

  // API: WhatsApp Login / Pairing
  router.get('/api/whatsapp/status', (req, res) => {
    try {
      const connected = botState.status === 'online';
      const info = client ? client.info : null;
      res.json({ connected, info: info || null });
    } catch (e) {
      res.json({ connected: false, info: null });
    }
  });

  router.post('/api/whatsapp/pair', async (req, res) => {
    const { phoneNumber } = req.body;
    if (!phoneNumber) {
      return res.status(400).json({ error: 'Phone number is required' });
    }
    const cleanNumber = phoneNumber.trim().replace(/\D/g, '');
    if (cleanNumber.length < 10) {
      return res.status(400).json({ error: 'Invalid phone number' });
    }

    // Wait up to 15s for client to be ready after reinit
    let ready = false;
    for (let i = 0; i < 30; i++) {
      if (client && client.pupPage && !client.pupPage.isClosed()) {
        ready = true;
        break;
      }
      await new Promise(r => setTimeout(r, 500));
    }

    if (!ready) {
      return res.status(500).json({ error: 'Client not ready. Wait a moment and try again.' });
    }

    // Extra wait for page to stabilize
    await new Promise(r => setTimeout(r, 2000));

    try {
      const code = await client.requestPairingCode(cleanNumber);
      const formatted = code.match(/.{1,4}/g).join('-');
      console.log(`🔑 Pairing code requested for ${cleanNumber}: ${formatted}`);
      res.json({ success: true, code: formatted });
    } catch (e) {
      console.error('❌ Pairing failed:', e.message || e);
      res.status(500).json({ error: e.message || 'Pairing failed. Try again.' });
    }
  });

  router.post('/api/whatsapp/logout', async (req, res) => {
    // Wipe session data
    const fs = require('fs');
    const path = require('path');
    const sessionDir = path.join(__dirname, '../../.wwebjs_auth');
    try {
      if (fs.existsSync(sessionDir)) {
        fs.rmSync(sessionDir, { recursive: true, force: true });
        console.log('🧹 Session data wiped');
      }
    } catch (e) {}

    res.json({ success: true });
    console.log('🔴 WhatsApp logout from admin panel');

    // Try clean logout — if it fails, force destroy to trigger disconnected event
    try {
      await client.logout();
    } catch (e) {
      console.log('⚠️ logout failed, forcing destroy...');
      try { await client.destroy(); } catch (e2) {}
      // disconnected event should fire from destroy
    }
  });

  router.post('/api/whatsapp/restart', async (req, res) => {
    try {
      try { await client.destroy(); } catch (e) {}
      botState.status = 'offline';
      await new Promise(r => setTimeout(r, 2000));
      await client.initialize();
      console.log('🔄 WhatsApp client restarted');
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // API: Blocklist
  router.get('/api/blocklist', (req, res) => {
    const blocklist = readJSON('blocklist.json') || { numbers: [], groups: [] };
    res.json(blocklist);
  });

  router.post('/api/blocklist', (req, res) => {
    const { type, value } = req.body;
    const blocklist = readJSON('blocklist.json') || { numbers: [], groups: [] };

    if (type === 'number') {
      let num = value.trim();
      if (!num.endsWith('@c.us')) num += '@c.us';
      if (!blocklist.numbers.includes(num)) blocklist.numbers.push(num);
    } else if (type === 'group') {
      if (!blocklist.groups.includes(value)) blocklist.groups.push(value);
    } else {
      return res.status(400).json({ error: 'Invalid type' });
    }

    writeJSON('blocklist.json', blocklist);
    res.json({ success: true });
  });

  router.delete('/api/blocklist/:type/:encodedId', (req, res) => {
    const { type, encodedId } = req.params;
    const id = decodeURIComponent(encodedId);
    const blocklist = readJSON('blocklist.json') || { numbers: [], groups: [] };

    if (type === 'number') {
      blocklist.numbers = blocklist.numbers.filter(n => n !== id);
    } else if (type === 'group') {
      blocklist.groups = blocklist.groups.filter(g => g !== id);
    } else {
      return res.status(400).json({ error: 'Invalid type' });
    }

    writeJSON('blocklist.json', blocklist);
    res.json({ success: true });
  });

  // API: Change Password
  router.post('/api/change-password', async (req, res) => {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    const config = readJSON('config.json') || {};

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ error: 'New passwords do not match' });
    }

    if (!config.adminPasswordHash) {
      return res.status(400).json({ error: 'No password set' });
    }

    const match = await bcrypt.compare(currentPassword, config.adminPasswordHash);
    if (!match) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    config.adminPasswordHash = await bcrypt.hash(newPassword, 10);
    writeJSON('config.json', config);
    res.json({ success: true });
  });

  // API: Admin Users (WhatsApp command users)
  router.get('/api/admin-users', (req, res) => {
    const users = readJSON('adminusers.json') || [];
    res.json(users);
  });

  router.post('/api/admin-users', (req, res) => {
    const { number, name } = req.body;
    if (!number) return res.status(400).json({ error: 'Number is required' });

    const users = readJSON('adminusers.json') || [];
    let cleanNum = number.trim().replace(/\D/g, '');
    if (!cleanNum.endsWith('@c.us')) cleanNum += '@c.us';

    if (users.find(u => u.number === cleanNum)) {
      return res.status(400).json({ error: 'Number already added' });
    }

    const newUser = {
      id: uuidv4(),
      number: cleanNum,
      name: name || cleanNum.replace('@c.us', ''),
      addedAt: new Date().toISOString()
    };
    users.push(newUser);
    writeJSON('adminusers.json', users);
    console.log(`👤 Admin user added: ${cleanNum} (${newUser.name})`);
    res.json({ success: true, user: newUser });
  });

  router.delete('/api/admin-users/:id', (req, res) => {
    let users = readJSON('adminusers.json') || [];
    users = users.filter(u => u.id !== req.params.id);
    writeJSON('adminusers.json', users);
    console.log(`👤 Admin user removed: ${req.params.id}`);
    res.json({ success: true });
  });

  // API: Factory Reset
  router.post('/api/factory-reset', async (req, res) => {
    const fs = require('fs');
    const path = require('path');
    const dataDir = path.join(__dirname, '../../data');

    try {
      // Wipe WhatsApp session
      const sessionDir = path.join(__dirname, '../../.wwebjs_auth');
      if (fs.existsSync(sessionDir)) {
        fs.rmSync(sessionDir, { recursive: true, force: true });
      }

      // Wipe cache
      const cacheDir = path.join(__dirname, '../../.wwebjs_cache');
      if (fs.existsSync(cacheDir)) {
        fs.rmSync(cacheDir, { recursive: true, force: true });
      }

      // Reset all data files to defaults
      const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        const filePath = path.join(dataDir, file);
        try { fs.unlinkSync(filePath); } catch (e) {}
      }

      // Destroy WhatsApp client
      try { await client.destroy(); } catch (e) {}
      botState.status = 'offline';
      botState.botWid = null;

      console.log('🔴 FACTORY RESET — All data wiped');
      res.json({ success: true, message: 'All data cleared. Bot will restart.' });

      // Reinit after response sent
      setTimeout(async () => {
        try { await client.initialize(); } catch (e) {
          console.error('❌ Reinit after reset failed:', e.message);
        }
      }, 3000);
    } catch (e) {
      console.error('❌ Factory reset failed:', e.message);
      res.status(500).json({ error: 'Reset failed: ' + e.message });
    }
  });

  return router;
}

module.exports = createRoutes;
