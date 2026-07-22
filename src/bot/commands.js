/**
 * Bot Commands — infinityX Bot
 * Developer: Tarif Ahmed (infinityX)
 * Telegram: https://t.me/infinityxbd
 */
const { readJSON, writeJSON } = require('../storage/store');

function cleanId(id) {
  return String(id).replace(/@c\.us/, '').replace(/@lid/, '').replace(/@g\.us/, '');
}

function isAdminUser(senderId) {
  const adminUsers = readJSON('adminusers.json') || [];
  if (!Array.isArray(adminUsers)) {
    writeJSON('adminusers.json', []);
    return null;
  }
  const senderClean = cleanId(senderId);
  const senderDigits = senderId.replace(/\D/g, '');

  for (const u of adminUsers) {
    if (!u || !u.number) continue;
    // Exact clean match
    if (cleanId(u.number) === senderClean) return u;
    // LID match
    if (u.lid && cleanId(u.lid) === senderClean) return u;
    // Digit-only match (most reliable for LID vs phone)
    const adminDigits = u.number.replace(/\D/g, '');
    if (adminDigits && senderDigits && adminDigits === senderDigits) return u;
  }
  return null;
}

function setConfig(key, value) {
  const config = readJSON('config.json') || {};
  config[key] = value;
  writeJSON('config.json', config);
}

async function reply(message, text, client) {
  try {
    await message.reply(text);
  } catch (e) {
    try {
      const chat = await client.getChatById(message.from);
      await chat.sendMessage(text);
    } catch (e2) {
      console.error(`❌ Reply failed: ${e2.message}`);
    }
  }
}

async function handleCommand(message, client, botWid, lidMap, commandSenderId) {
  const body = message.body.trim();
  if (!body.startsWith('/')) return false;

  const senderId = commandSenderId || message.from;
  console.log(`🔍 Command: "${body}" from ${senderId} (chat: ${message.from})`);

  // Step 1: Try to resolve sender LID → phone
  let resolvedPhone = null;
  const senderClean = cleanId(senderId);
  const senderDigits = senderId.replace(/\D/g, '');

  // Check LidMap cache
  if (lidMap && lidMap[senderClean]) {
    resolvedPhone = lidMap[senderClean];
    console.log(`🔍 LID cache: ${senderClean} → ${resolvedPhone}`);
  }

  // Try resolving via contact lookup
  if (!resolvedPhone) {
    try {
      const { resolveLid } = require('./whatsapp');
      resolvedPhone = await resolveLid(senderId);
      if (resolvedPhone) {
        console.log(`🔍 Resolved ${senderId} → ${resolvedPhone}`);
      }
    } catch (e) {}
  }

  // Step 2: Check authorization
  let authorized = false;
  let isOwner = false;

  // 2a. Owner check — match sender digits with botWid digits
  const botDigits = (botWid || '').replace(/\D/g, '');
  if (senderDigits && botDigits && senderDigits === botDigits) {
    authorized = true;
    isOwner = true;
    console.log(`🟢 Owner match (digits): ${senderDigits}`);
  }

  // 2b. Owner check via resolved phone
  if (!authorized && resolvedPhone) {
    const rpDigits = resolvedPhone.replace(/\D/g, '');
    if (rpDigits && botDigits && rpDigits === botDigits) {
      authorized = true;
      isOwner = true;
      console.log(`🟢 Owner match (resolved phone): ${resolvedPhone}`);
    }
  }

  // 2c. Admin check — use the improved isAdminUser (has digit matching)
  if (!authorized) {
    const admin = isAdminUser(senderId) || (resolvedPhone ? isAdminUser(resolvedPhone) : null);
    if (admin) {
      authorized = true;
      console.log(`👤 Admin match: ${admin.number} (${admin.name})`);
    }
  }

  // 2d. Try matching with LID map entries
  if (!authorized && lidMap) {
    for (const [key, val] of Object.entries(lidMap)) {
      const valDigits = String(val).replace(/\D/g, '');
      if (valDigits && senderDigits && valDigits === senderDigits) {
        const admin = isAdminUser(val);
        if (admin) {
          authorized = true;
          console.log(`👤 Admin match via LID map: ${val}`);
          break;
        }
      }
    }
  }

  if (!authorized) {
    console.log(`❌ Not authorized: ${senderId} (digits: ${senderDigits}, resolved: ${resolvedPhone || 'null'}, botWid: ${botWid})`);
    await reply(message, '❌ You are not authorized to use commands.', client);
    return true;
  }

  if (isOwner) console.log(`🟢 Bot owner — full access`);
  else console.log(`👤 Admin access`);

  const args = body.split(' ');
  const cmd = args[0].toLowerCase();
  const param = args.slice(1).join(' ');
  console.log(`👤 Executing: ${cmd}`);

  switch (cmd) {

    // ─── Bot Power ───
    case '/onbot': {
      setConfig('botEnabled', true);
      try { await client.sendPresenceAvailable(); } catch (e) {}
      await reply(message, '✅ Bot ON', client);
      return true;
    }
    case '/offbot': {
      setConfig('botEnabled', false);
      try { await client.sendPresenceUnavailable(); } catch (e) {}
      await reply(message, '✅ Bot OFF', client);
      return true;
    }

    // ─── Inbox/Group Toggle ───
    case '/oninbox': {
      setConfig('replyToInbox', true);
      await reply(message, '✅ Inbox reply ON', client);
      return true;
    }
    case '/offinbox': {
      setConfig('replyToInbox', false);
      await reply(message, '✅ Inbox reply OFF', client);
      return true;
    }
    case '/ongroup': {
      setConfig('replyToGroups', true);
      await reply(message, '✅ Group reply ON', client);
      return true;
    }
    case '/offgroup': {
      setConfig('replyToGroups', false);
      await reply(message, '✅ Group reply OFF', client);
      return true;
    }

    // ─── Block ───
    case '/block': {
      if (!param) {
        await reply(message, '❌ Usage: /block <number>', client);
        return true;
      }
      let num = param.replace(/\D/g, '');
      if (!num.endsWith('@c.us')) num += '@c.us';
      const blocklist = readJSON('blocklist.json') || { numbers: [], groups: [] };
      if (blocklist.numbers.includes(num)) {
        await reply(message, `⚠️ ${param} already blocked.`, client);
        return true;
      }
      blocklist.numbers.push(num);
      writeJSON('blocklist.json', blocklist);
      await reply(message, `✅ Blocked: ${param}`, client);
      return true;
    }
    case '/unblock': {
      if (!param) {
        await reply(message, '❌ Usage: /unblock <number or group_id>', client);
        return true;
      }
      const blocklist = readJSON('blocklist.json') || { numbers: [], groups: [] };
      const target = param.trim();
      let idx = blocklist.numbers.findIndex(n =>
        n === target || n === target + '@c.us' || n.replace('@c.us', '') === target
      );
      if (idx !== -1) {
        blocklist.numbers.splice(idx, 1);
        writeJSON('blocklist.json', blocklist);
        await reply(message, `✅ Unblocked: ${target}`, client);
        return true;
      }
      idx = blocklist.groups.findIndex(g => g === target);
      if (idx !== -1) {
        blocklist.groups.splice(idx, 1);
        writeJSON('blocklist.json', blocklist);
        await reply(message, `✅ Group unblocked: ${target}`, client);
        return true;
      }
      await reply(message, `❌ Not found: ${target}`, client);
      return true;
    }
    case '/blocklist': {
      const blocklist = readJSON('blocklist.json') || { numbers: [], groups: [] };
      let txt = '📋 *Block List*\n\n';
      txt += `Numbers: ${blocklist.numbers.length > 0 ? blocklist.numbers.map(n => n.replace('@c.us', '')).join(', ') : 'none'}\n`;
      txt += `Groups: ${blocklist.groups.length > 0 ? blocklist.groups.join(', ') : 'none'}`;
      await reply(message, txt, client);
      return true;
    }

    // ─── Status ───
    case '/status': {
      const config = readJSON('config.json') || {};
      const uptime = process.uptime();
      const h = Math.floor(uptime / 3600);
      const m = Math.floor((uptime % 3600) / 60);
      let txt = `📊 *Bot Status*\n`;
      txt += `Bot: ${config.botEnabled !== false ? '🟢 ON' : '🔴 OFF'}\n`;
      txt += `Inbox: ${config.replyToInbox !== false ? '✅ ON' : '❌ OFF'}\n`;
      txt += `Groups: ${config.replyToGroups ? '✅ ON' : '❌ OFF'}\n`;
      txt += `Uptime: ${h}h ${m}m`;
      await reply(message, txt, client);
      return true;
    }

    // ─── Group List ───
    case '/gplist': {
      try {
        let groups = [];
        try {
          groups = await Promise.race([
            client.pupPage.evaluate(() => {
              try {
                const Chat = window.require('WAWebCollections').Chat;
                const models = Chat.getModelsArray();
                return models
                  .filter(c => c.isGroup)
                  .map(c => ({
                    name: c.formattedTitle || c.name || 'Unnamed',
                    id: c.id ? c.id._serialized : ''
                  }));
              } catch (e) { return []; }
            }),
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000))
          ]);
        } catch (e) {
          console.log('⚠️ gplist store failed:', e.message);
        }

        if (!groups || groups.length === 0) {
          await reply(message, '📋 Bot ke group e add karo.', client);
          return true;
        }

        let txt = `📋 *Groups (${groups.length}):*\n\n`;
        groups.forEach((g, i) => {
          txt += `${i + 1}. ${g.name}\n   ${g.id}\n\n`;
        });
        await reply(message, txt, client);
        return true;
      } catch (e) {
        console.error('❌ /gplist error:', e.message);
        await reply(message, '❌ Groups load korte paris na.', client);
        return true;
      }
    }

    // ─── Help ───
    case '/help': {
      const txt = `🤖 *Admin Commands*

*Bot Control:*
/onbot — Bot ON
/offbot — Bot OFF

*Reply Control:*
/oninbox — Inbox reply ON
/offinbox — Inbox reply OFF
/ongroup — Group reply ON
/offgroup — Group reply OFF

*Block:*
/block <number> — Block
/unblock <number> — Unblock
/blocklist — Blocked list

*Other:*
/gplist — Group list
/status — Bot status
/help — Commands`;
      await reply(message, txt, client);
      return true;
    }

    default:
      await reply(message, `❌ Unknown: ${cmd}\nType /help`, client);
      return true;
  }
}

module.exports = { handleCommand, isAdminUser };
