// telegram-bot/bot.js - Telegram Bot để quản lý keys
// Deploy trên Vercel hoặc server riêng

const TelegramBot = require('node-telegram-bot-api');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_IDS = process.env.TELEGRAM_ADMIN_IDS?.split(',').map(id => parseInt(id)) || [];
const API_URL = process.env.API_URL || 'https://your-domain.vercel.app';
const TELEGRAM_SECRET = process.env.TELEGRAM_BOT_SECRET;

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Check if user is admin
function isAdmin(userId) {
  return ADMIN_IDS.includes(userId);
}

// Main menu
function getMainMenu() {
  return {
    reply_markup: {
      keyboard: [
        ['📝 Tạo Key Mới', '📋 Danh Sách Keys'],
        ['🗑️ Xóa Key', '📊 Thống Kê'],
        ['❓ Hướng Dẫn']
      ],
      resize_keyboard: true
    }
  };
}

// Start command
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!isAdmin(userId)) {
    bot.sendMessage(chatId, '❌ Bạn không có quyền sử dụng bot này!');
    return;
  }

  bot.sendMessage(
    chatId,
    '👋 Xin chào Admin!\n\n' +
    '🔑 Bot quản lý Key Download VIP\n\n' +
    'Chọn chức năng bên dưới:',
    getMainMenu()
  );
});

// Create key
bot.onText(/📝 Tạo Key Mới/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!isAdmin(userId)) {
    return;
  }

  bot.sendMessage(
    chatId,
    '🔑 Tạo Key Mới\n\n' +
    'Gửi thông tin theo định dạng:\n' +
    '<code>/create [số_ngày] [số_lượt]</code>\n\n' +
    'Ví dụ:\n' +
    '• <code>/create 30 100</code> - Key 30 ngày, 100 lượt\n' +
    '• <code>/create 0 50</code> - Key vô thời hạn, 50 lượt\n' +
    '• <code>/create 7 0</code> - Key 7 ngày, không giới hạn lượt',
    { parse_mode: 'HTML' }
  );
});

bot.onText(/\/create (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!isAdmin(userId)) {
    return;
  }

  const params = match[1].split(' ');
  const duration = parseInt(params[0]) || 0;
  const maxUses = parseInt(params[1]) || 0;

  bot.sendMessage(chatId, '⏳ Đang tạo key...');

  try {
    const response = await fetch(`${API_URL}/api/keys/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        telegramSecret: TELEGRAM_SECRET,
        duration: duration,
        maxUses: maxUses
      })
    });

    const result = await response.json();

    if (result.success) {
      let message = '✅ Tạo Key Thành Công!\n\n';
      message += `🔑 Key: <code>${result.key}</code>\n`;
      message += `📅 Hết hạn: ${result.expiresAt ? new Date(result.expiresAt).toLocaleDateString('vi-VN') : 'Vô thời hạn'}\n`;
      message += `🎫 Số lượt: ${result.maxUses || 'Không giới hạn'}\n\n`;
      message += '👉 Copy và gửi cho người dùng';

      bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
    } else {
      bot.sendMessage(chatId, '❌ Lỗi tạo key: ' + result.error);
    }
  } catch (error) {
    bot.sendMessage(chatId, '❌ Lỗi kết nối API: ' + error.message);
  }
});

// List keys
bot.onText(/📋 Danh Sách Keys/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!isAdmin(userId)) {
    return;
  }

  bot.sendMessage(chatId, '⏳ Đang tải danh sách...');

  try {
    const response = await fetch(`${API_URL}/api/keys/list`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        telegramSecret: TELEGRAM_SECRET
      })
    });

    const result = await response.json();

    if (result.keys && result.keys.length > 0) {
      const activeKeys = result.keys.filter(k => k.active);
      const inactiveKeys = result.keys.filter(k => !k.active);

      let message = `📋 Danh Sách Keys (${result.keys.length})\n\n`;
      message += `✅ Hoạt động: ${activeKeys.length}\n`;
      message += `❌ Vô hiệu: ${inactiveKeys.length}\n\n`;
      message += '━━━━━━━━━━━━━━━━\n\n';

      // Show first 10 active keys
      activeKeys.slice(0, 10).forEach((key, index) => {
        message += `${index + 1}. <code>${key.key}</code>\n`;
        message += `   📊 ${key.currentUses}/${key.maxUses || '∞'} lượt`;
        
        if (key.expiresAt) {
          const daysLeft = Math.ceil((new Date(key.expiresAt) - new Date()) / (1000 * 60 * 60 * 24));
          message += ` | ⏰ ${daysLeft} ngày`;
        }
        message += '\n\n';
      });

      if (activeKeys.length > 10) {
        message += `... và ${activeKeys.length - 10} key khác\n\n`;
      }

      message += '━━━━━━━━━━━━━━━━\n';
      message += 'Gửi <code>/detail KEY</code> để xem chi tiết';

      bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
    } else {
      bot.sendMessage(chatId, '📋 Chưa có key nào!');
    }
  } catch (error) {
    bot.sendMessage(chatId, '❌ Lỗi: ' + error.message);
  }
});

// Delete key
bot.onText(/🗑️ Xóa Key/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!isAdmin(userId)) {
    return;
  }

  bot.sendMessage(
    chatId,
    '🗑️ Xóa Key\n\n' +
    'Gửi lệnh: <code>/delete KEY</code>\n\n' +
    'Ví dụ: <code>/delete ABCD-1234-EFGH-5678</code>',
    { parse_mode: 'HTML' }
  );
});

bot.onText(/\/delete (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!isAdmin(userId)) {
    return;
  }

  const key = match[1].trim().toUpperCase();

  try {
    const response = await fetch(`${API_URL}/api/keys/delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        telegramSecret: TELEGRAM_SECRET,
        key: key
      })
    });

    const result = await response.json();

    if (result.success) {
      bot.sendMessage(chatId, `✅ Đã xóa key: <code>${key}</code>`, { parse_mode: 'HTML' });
    } else {
      bot.sendMessage(chatId, '❌ Lỗi: ' + result.error);
    }
  } catch (error) {
    bot.sendMessage(chatId, '❌ Lỗi kết nối: ' + error.message);
  }
});

// Statistics
bot.onText(/📊 Thống Kê/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!isAdmin(userId)) {
    return;
  }

  try {
    const response = await fetch(`${API_URL}/api/keys/list`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        telegramSecret: TELEGRAM_SECRET
      })
    });

    const result = await response.json();

    if (result.keys) {
      const keys = result.keys;
      const active = keys.filter(k => k.active).length;
      const inactive = keys.filter(k => !k.active).length;
      const totalUses = keys.reduce((sum, k) => sum + k.currentUses, 0);

      let message = '📊 Thống Kê\n\n';
      message += `🔢 Tổng số key: ${keys.length}\n`;
      message += `✅ Đang hoạt động: ${active}\n`;
      message += `❌ Đã vô hiệu: ${inactive}\n`;
      message += `📥 Tổng lượt tải: ${totalUses}\n`;

      bot.sendMessage(chatId, message);
    }
  } catch (error) {
    bot.sendMessage(chatId, '❌ Lỗi: ' + error.message);
  }
});

// Help
bot.onText(/❓ Hướng Dẫn/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!isAdmin(userId)) {
    return;
  }

  const helpText = `
📚 Hướng Dẫn Sử Dụng Bot

🔑 Tạo Key:
<code>/create [ngày] [lượt]</code>

📋 Danh sách:
Nhấn nút "📋 Danh Sách Keys"

🗑️ Xóa Key:
<code>/delete KEY-CODE</code>

📊 Thống kê:
Nhấn nút "📊 Thống Kê"

💡 Ví dụ:
• <code>/create 30 100</code> - Key 30 ngày, 100 lượt
• <code>/create 0 0</code> - Key vô hạn
• <code>/delete ABCD-1234-EFGH-5678</code>
  `;

  bot.sendMessage(chatId, helpText, { parse_mode: 'HTML' });
});

console.log('✅ Telegram Bot started!');

// Export cho Vercel
module.exports = bot;
