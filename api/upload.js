// api/upload.js - Vercel Serverless Function
// API này sẽ cập nhật file JSON trên GitHub

export default async function handler(req, res) {
  // Chỉ cho phép POST request
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { type, data } = req.body;

    // Validate input
    if (!type || !data || !['ipa', 'dylib', 'conf'].includes(type)) {
      return res.status(400).json({ error: 'Invalid request data' });
    }

    // GitHub configuration từ environment variables
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const GITHUB_OWNER = process.env.GITHUB_OWNER || 'Cuongqtx11';
    const GITHUB_REPO = process.env.GITHUB_REPO || 'app_vip';
    const FILE_PATH = `public/data/${type}.json`;

    if (!GITHUB_TOKEN) {
      return res.status(500).json({ error: 'GitHub token not configured' });
    }

    // 1. Lấy nội dung file hiện tại từ GitHub
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
    }

    // 2. Thêm data mới vào mảng
    currentData.push(data);

    // 3. Cập nhật file lên GitHub
    const newContent = Buffer.from(JSON.stringify(currentData, null, 2)).toString('base64');
    
    const updatePayload = {
      message: `Add new ${type}: ${data.name}`,
      content: newContent,
      branch: 'main'
    };

    if (sha) {
      updatePayload.sha = sha; // Cần SHA nếu file đã tồn tại
    }

    const updateResponse = await fetch(getFileUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(updatePayload)
    });

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      console.error('GitHub API Error:', errorText);
      return res.status(500).json({ error: 'Failed to update GitHub', details: errorText });
    }

    return res.status(200).json({ 
      success: true, 
      message: 'Upload successful',
      id: data.id 
    });

  } catch (error) {
    console.error('Upload error:', error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
}
