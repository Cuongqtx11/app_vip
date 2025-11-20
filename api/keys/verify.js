// api/keys/verify.js - Xác thực và sử dụng key
export default async function handler(req, res) {
  // CORS headers
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
    const { key } = req.body;

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

    // 1. Fetch keys từ GitHub
    const getFileUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${FILE_PATH}`;
    
    const getResponse = await fetch(getFileUrl, {
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'VIP-Key-System'
      }
    });

    if (!getResponse.ok) {
      console.error('GitHub fetch failed:', getResponse.status);
      return res.status(404).json({ error: 'Keys database not found' });
    }

    const fileData = await getResponse.json();
    const sha = fileData.sha;
    const content = Buffer.from(fileData.content, 'base64').toString('utf-8');
    let keys = JSON.parse(content);

    // 2. Tìm key
    const keyIndex = keys.findIndex(k => k.key === key.toUpperCase());
    
    if (keyIndex === -1) {
      return res.status(404).json({ 
        error: 'Mã key không tồn tại',
        code: 'KEY_NOT_FOUND'
      });
    }

    const foundKey = keys[keyIndex];

    // 3. Kiểm tra key có active không
    if (!foundKey.active) {
      return res.status(403).json({ 
        error: 'Mã key đã bị vô hiệu hóa',
        code: 'KEY_INACTIVE'
      });
    }

    // 4. Kiểm tra thời hạn
    if (foundKey.expiresAt) {
      const expiryDate = new Date(foundKey.expiresAt);
      const now = new Date();
      
      if (expiryDate < now) {
        // Vô hiệu hóa key hết hạn
        foundKey.active = false;
        keys[keyIndex] = foundKey;
        
        await updateKeysOnGitHub(keys, sha, GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, FILE_PATH);
        
        return res.status(403).json({ 
          error: 'Mã key đã hết hạn sử dụng',
          code: 'KEY_EXPIRED',
          expiredAt: foundKey.expiresAt
        });
      }
    }

    // 5. Kiểm tra số lượt sử dụng
    if (foundKey.maxUses && foundKey.currentUses >= foundKey.maxUses) {
      // Vô hiệu hóa key hết lượt
      foundKey.active = false;
      keys[keyIndex] = foundKey;
      
      await updateKeysOnGitHub(keys, sha, GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, FILE_PATH);
      
      return res.status(403).json({ 
        error: 'Mã key đã hết lượt sử dụng',
        code: 'KEY_MAX_USES_REACHED',
        maxUses: foundKey.maxUses,
        currentUses: foundKey.currentUses
      });
    }

    // 6. Tăng số lượt sử dụng
    foundKey.currentUses = (foundKey.currentUses || 0) + 1;
    foundKey.lastUsedAt = new Date().toISOString();
    keys[keyIndex] = foundKey;

    // 7. Cập nhật lên GitHub
    await updateKeysOnGitHub(keys, sha, GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, FILE_PATH);

    // 8. Trả về kết quả thành công
    const remainingUses = foundKey.maxUses 
      ? foundKey.maxUses - foundKey.currentUses 
      : null;

    return res.status(200).json({
      success: true,
      message: 'Xác thực thành công',
      remainingUses: remainingUses,
      isUnlimited: !foundKey.maxUses,
      expiresAt: foundKey.expiresAt
    });

  } catch (error) {
    console.error('Verify key error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error.message 
    });
  }
}

// Helper function để cập nhật keys lên GitHub
async function updateKeysOnGitHub(keys, sha, token, owner, repo, filePath) {
  const getFileUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;
  
  const newContent = Buffer.from(JSON.stringify(keys, null, 2)).toString('base64');
  
  const updateResponse = await fetch(getFileUrl, {
    method: 'PUT',
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'VIP-Key-System'
    },
    body: JSON.stringify({
      message: 'Update key usage',
      content: newContent,
      sha: sha,
      branch: 'main'
    })
  });

  if (!updateResponse.ok) {
    const errorText = await updateResponse.text();
    throw new Error(`Failed to update keys: ${errorText}`);
  }

  return true;
}
