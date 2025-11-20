// api/keys/create.js - Tạo key mới
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
    const { telegramSecret, duration, maxUses, notes } = req.body;
    
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

    // Get current keys from GitHub
    const getFileUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${FILE_PATH}`;
    let currentKeys = [];
    let sha = null;

    try {
      const getResponse = await fetch(getFileUrl, {
        headers: {
          'Authorization': `token ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'VIP-Key-System'
        }
      });

      if (getResponse.ok) {
        const fileData = await getResponse.json();
        sha = fileData.sha;
        const content = Buffer.from(fileData.content, 'base64').toString('utf-8');
        currentKeys = JSON.parse(content);
      } else if (getResponse.status === 404) {
        console.log('Keys file not found, will create new one');
      } else {
        throw new Error(`GitHub API error: ${getResponse.status}`);
      }
    } catch (error) {
      console.log('Error fetching keys, will create new file:', error.message);
    }

    // Generate new key
    const newKey = {
      id: `key_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      key: generateRandomKey(),
      createdAt: new Date().toISOString(),
      expiresAt: duration && duration > 0 
        ? new Date(Date.now() + duration * 24 * 60 * 60 * 1000).toISOString() 
        : null,
      maxUses: maxUses && maxUses > 0 ? maxUses : null,
      currentUses: 0,
      active: true,
      createdBy: 'telegram_bot',
      notes: notes || `${duration || '∞'} days, ${maxUses || '∞'} uses`
    };

    // Add to beginning of array
    currentKeys.unshift(newKey);

    // Save to GitHub
    const newContent = Buffer.from(JSON.stringify(currentKeys, null, 2)).toString('base64');
    const updatePayload = {
      message: `Create new VIP key: ${newKey.key}`,
      content: newContent,
      branch: 'main'
    };

    if (sha) {
      updatePayload.sha = sha;
    }

    const updateResponse = await fetch(getFileUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent': 'VIP-Key-System'
      },
      body: JSON.stringify(updatePayload)
    });

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      throw new Error(`Failed to save key: ${errorText}`);
    }

    return res.status(200).json({
      success: true,
      message: 'Key created successfully',
      key: newKey.key,
      expiresAt: newKey.expiresAt,
      maxUses: newKey.maxUses,
      details: {
        id: newKey.id,
        createdAt: newKey.createdAt,
        isUnlimited: !newKey.maxUses && !newKey.expiresAt
      }
    });

  } catch (error) {
    console.error('Create key error:', error);
    return res.status(500).json({ 
      error: 'Internal server error', 
      details: error.message
    });
  }
}

// Helper function: Generate random key với format XXXX-XXXX-XXXX-XXXX
function generateRandomKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let key = '';
  
  for (let i = 0; i < 4; i++) {
    if (i > 0) key += '-';
    for (let j = 0; j < 4; j++) {
      key += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  }
  
  return key;
}
