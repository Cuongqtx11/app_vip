// api/keys/list.js - Lấy danh sách tất cả keys (cho Telegram Bot)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { telegramSecret } = req.body;
    
    // Xác thực Telegram Bot
    if (telegramSecret !== process.env.TELEGRAM_BOT_SECRET) {
      return res.status(401).json({ 
        error: 'Unauthorized',
        message: 'Invalid Telegram secret'
      });
    }

    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const GITHUB_OWNER = process.env.GITHUB_OWNER || 'Cuongqtx11';
    const GITHUB_REPO = process.env.GITHUB_REPO || 'app_vip';
    const FILE_PATH = 'public/data/keys.json';

    if (!GITHUB_TOKEN) {
      return res.status(500).json({ error: 'GitHub token not configured' });
    }

    const getFileUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${FILE_PATH}`;
    
    const getResponse = await fetch(getFileUrl, {
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'VIP-Key-System'
      }
    });

    if (!getResponse.ok) {
      if (getResponse.status === 404) {
        // File chưa tồn tại, trả về mảng rỗng
        return res.status(200).json({ 
          keys: [],
          message: 'No keys found'
        });
      }
      
      throw new Error(`GitHub API error: ${getResponse.status}`);
    }

    const fileData = await getResponse.json();
    const content = Buffer.from(fileData.content, 'base64').toString('utf-8');
    const keys = JSON.parse(content);

    // Tính toán thống kê
    const stats = {
      total: keys.length,
      active: keys.filter(k => k.active).length,
      inactive: keys.filter(k => !k.active).length,
      expired: keys.filter(k => k.expiresAt && new Date(k.expiresAt) < new Date()).length,
      totalUses: keys.reduce((sum, k) => sum + (k.currentUses || 0), 0)
    };

    return res.status(200).json({ 
      success: true,
      keys: keys,
      stats: stats
    });

  } catch (error) {
    console.error('List keys error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error.message
    });
  }
}
