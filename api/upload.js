// api/upload.js - Upload an toàn (Fix Auth Bypass)
import crypto from 'crypto';

export default async function handler(req, res) {
  // Chỉ cho phép POST request
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { type, data } = req.body;

    // 🔐 BẢO MẬT CAO: Xác thực Token
    // 1. Tái tạo token chuẩn từ Secret Key trong server
    const secret = process.env.ADMIN_SECRET || 'mac-dinh-can-thay-doi-trong-env';
    const validToken = crypto.createHmac('sha256', secret)
                             .update('admin-session')
                             .digest('hex');

    // 2. Lấy cookie từ request
    const cookies = req.headers.cookie || '';

    // 3. Kiểm tra chính xác (Token gửi lên phải GIỐNG HỆT token chuẩn)
    // Hacker không thể fake vì không biết ADMIN_SECRET để tạo ra validToken này
    if (!cookies.includes(`admin_token=${validToken}`)) {
      console.log('⚠️ Unauthorized upload attempt');
      return res.status(401).json({ 
        error: 'Unauthorized - Invalid or missing token',
        code: 'AUTH_FAILED'
      });
    }

    // --- (Phần code logic bên dưới giữ nguyên) ---
    // Validate input
    if (!type || !data || !['ipa', 'dylib', 'conf', 'cert', 'mod', 'sign'].includes(type)) {
      return res.status(400).json({ error: 'Invalid request data' });
    }

    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const GITHUB_OWNER = process.env.GITHUB_OWNER || 'Cuongqtx11';
    const GITHUB_REPO = process.env.GITHUB_REPO || 'app_vip';
    
    // Định tuyến đường dẫn file
    let FILE_PATH;
    if (['cert', 'mod', 'sign'].includes(type)) {
        FILE_PATH = `public/pages/data/${type}.json`;
    } else {
        FILE_PATH = `public/data/${type}.json`;
    }

    if (!GITHUB_TOKEN) {
      return res.status(500).json({ error: 'GitHub token not configured' });
    }

    // 1. Fetch file hiện tại
    const getFileUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${FILE_PATH}`;
    const getResponse = await fetch(getFileUrl, {
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    let currentData = [];
    let sha = null;

    if (getResponse.ok) {
      const fileData = await getResponse.json();
      sha = fileData.sha;
      const content = Buffer.from(fileData.content, 'base64').toString('utf-8');
      currentData = JSON.parse(content);
    } else if (getResponse.status !== 404) {
      const errorText = await getResponse.text();
      return res.status(500).json({ error: 'Failed to fetch GitHub', details: errorText });
    }

    // 2. Add data
    currentData.unshift(data);

    // 3. Upload lại
    const newContent = Buffer.from(JSON.stringify(currentData, null, 2)).toString('base64');
    const commitName = data.name || data.title || data.filename || 'Untitled Item';
    
    const updateResponse = await fetch(getFileUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: `Add new ${type}: ${commitName}`,
        content: newContent,
        sha: sha,
        branch: 'main'
      })
    });

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      return res.status(500).json({ error: 'Failed to update GitHub', details: errorText });
    }

    return res.status(200).json({ success: true, message: 'Upload successful', id: data.id });

  } catch (error) {
    console.error('Upload error:', error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
}
