// api/keys/delete.js - Xóa một key
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
    const { telegramSecret, key } = req.body;
    
    // Xác thực Telegram Bot
    if (telegramSecret !== process.env.TELEGRAM_BOT_SECRET) {
      return res.status(401).json({ 
        error: 'Unauthorized',
        message: 'Invalid Telegram secret'
      });
    }

    if (!key) {
      return res.status(400).json({ error: 'Key is required' });
    }

    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const GITHUB_OWNER = process.env.GITHUB_OWNER || 'Cuongqtx11';
    const GITHUB_REPO = process.env.GITHUB_REPO || 'app_vip';
    const FILE_PATH = 'public/data/keys.json';

    if (!GITHUB_TOKEN) {
      return res.status(500).json({ error: 'GitHub token not configured' });
    }

    const getFileUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${FILE_PATH}`;
    
    // Fetch current keys
    const getResponse = await fetch(getFileUrl, {
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'VIP-Key-System'
      }
    });

    if (!getResponse.ok) {
      return res.status(404).json({ 
        error: 'Keys database not found'
      });
    }

    const fileData = await getResponse.json();
    const sha = fileData.sha;
    const content = Buffer.from(fileData.content, 'base64').toString('utf-8');
    let keys = JSON.parse(content);

    // Tìm và xóa key
    const keyToDelete = keys.find(k => k.key === key.toUpperCase());
    
    if (!keyToDelete) {
      return res.status(404).json({ 
        error: 'Key not found',
        key: key
      });
    }

    // Filter out the key
    keys = keys.filter(k => k.key !== key.toUpperCase());

    // Update GitHub
    const newContent = Buffer.from(JSON.stringify(keys, null, 2)).toString('base64');
    
    const updateResponse = await fetch(getFileUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent': 'VIP-Key-System'
      },
      body: JSON.stringify({
        message: `Delete key: ${key.toUpperCase()}`,
        content: newContent,
        sha: sha,
        branch: 'main'
      })
    });

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      throw new Error(`Failed to update GitHub: ${errorText}`);
    }

    return res.status(200).json({ 
      success: true, 
      message: 'Key deleted successfully',
      deletedKey: {
        key: keyToDelete.key,
        createdAt: keyToDelete.createdAt,
        currentUses: keyToDelete.currentUses
      }
    });

  } catch (error) {
    console.error('Delete key error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error.message
    });
  }
}
