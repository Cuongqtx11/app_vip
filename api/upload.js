export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { type, data } = req.body;

    // 🔐 SIMPLE AUTH CHECK
    const cookieToken = req.headers.cookie?.includes('admin_token');
    if (!cookieToken) {
      return res.status(401).json({ error: 'Unauthorized - Please login' });
    }

    // Validate input
    if (!type || !data || !['ipa', 'dylib', 'conf'].includes(type)) {
      return res.status(400).json({ error: 'Invalid request data' });
    }

    // GitHub configuration - SỬ DỤNG ENV VARIABLES
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const GITHUB_OWNER = process.env.GITHUB_OWNER; // Sẽ lấy từ env
    const GITHUB_REPO = process.env.GITHUB_REPO;   // Sẽ lấy từ env
    const FILE_PATH = `public/data/${type}.json`;

    if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
      return res.status(500).json({ 
        error: 'GitHub configuration missing',
        details: { hasToken: !!GITHUB_TOKEN, owner: GITHUB_OWNER, repo: GITHUB_REPO }
      });
    }

    // 1. Get current file content
    const getFileUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${FILE_PATH}`;
    
    console.log('📡 Fetching from:', getFileUrl);
    
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
    } else if (getResponse.status === 404) {
      console.log('📄 File not found, creating new one...');
    } else {
      const errorText = await getResponse.text();
      console.error('❌ GitHub API Error:', errorText);
      return res.status(500).json({ 
        error: 'Failed to fetch from GitHub', 
        details: errorText,
        url: getFileUrl
      });
    }

    // 2. Add new data to beginning
    currentData.unshift(data);

    // 3. Update file on GitHub
    const newContent = Buffer.from(JSON.stringify(currentData, null, 2)).toString('base64');
    
    const updatePayload = {
      message: `Add new ${type}: ${data.name}`,
      content: newContent,
      branch: 'main'
    };

    if (sha) {
      updatePayload.sha = sha;
    }

    console.log('📤 Uploading to GitHub...');
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
      console.error('❌ GitHub Upload Error:', errorText);
      return res.status(500).json({ 
        error: 'Failed to update GitHub', 
        details: errorText 
      });
    }

    console.log('✅ Upload successful!');
    return res.status(200).json({ 
      success: true, 
      message: 'Upload successful',
      id: data.id 
    });

  } catch (error) {
    console.error('💥 Upload error:', error);
    return res.status(500).json({ 
      error: 'Internal server error', 
      details: error.message 
    });
  }
}
