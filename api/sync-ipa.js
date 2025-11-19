// api/sync-ipa.js - Sync với format đúng từ AppTesters

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

  console.log('🔄 Sync started at:', new Date().toISOString());

  try {
    const { forceFullSync } = req.body || {};

    // 🔐 AUTH CHECK
    const isCronJob = req.headers.cookie && req.headers.cookie.includes('admin_token=cron_job_authorized');
    const hasAuthCookie = req.headers.cookie && (
      req.headers.cookie.includes('admin_token') || 
      req.headers.cookie.includes('auth')
    );
    
    if (!hasAuthCookie && !isCronJob) {
      console.log('⚠️ Auth failed');
      return res.status(401).json({ 
        error: 'Unauthorized',
        code: 'NO_AUTH_COOKIE'
      });
    }

    console.log('✅ Auth passed');

    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const GITHUB_OWNER = process.env.GITHUB_OWNER || 'Cuongqtx11';
    const GITHUB_REPO = process.env.GITHUB_REPO || 'app_vip';
    const FILE_PATH = 'public/data/ipa.json';
    const APPTESTER_URL = 'https://repository.apptesters.org/';

    if (!GITHUB_TOKEN) {
      console.error('❌ GITHUB_TOKEN not found');
      return res.status(500).json({ 
        error: 'GitHub token not configured' 
      });
    }

    console.log('📡 Config:', { GITHUB_OWNER, GITHUB_REPO });

    // 1️⃣ Fetch từ AppTesters
    console.log('📦 Fetching from AppTesters...');
    let allAppTestersData;
    
    try {
      const response = await fetch(APPTESTER_URL, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }
      
      const jsonData = await response.json();
      
      // ✅ Lấy array từ key "apps"
      if (jsonData.apps && Array.isArray(jsonData.apps)) {
        allAppTestersData = jsonData.apps;
        console.log(`✅ Found ${allAppTestersData.length} apps in "apps" key`);
      } else {
        throw new Error('No "apps" array found in response');
      }
      
    } catch (fetchError) {
      console.error('❌ Fetch error:', fetchError.message);
      return res.status(500).json({ 
        error: 'Failed to fetch from AppTesters', 
        details: fetchError.message 
      });
    }

    // 🎯 Lọc theo ngày
    const today = new Date().toISOString().split('T')[0];
    let filteredApps = allAppTestersData;
    
    if (!forceFullSync) {
      filteredApps = allAppTestersData.filter(app => {
        return app.versionDate && app.versionDate.startsWith(today);
      });
      console.log(`📅 Apps today (${today}): ${filteredApps.length}`);
    } else {
      console.log('⚠️ FORCE FULL SYNC MODE');
    }

    // 2️⃣ Lấy dữ liệu hiện tại từ GitHub
    console.log('📄 Fetching from GitHub...');
    const getFileUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${FILE_PATH}`;
    
    let currentData = [];
    let sha = null;

    try {
      const getResponse = await fetch(getFileUrl, {
        headers: {
          'Authorization': `token ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'KhoAppVIP'
        }
      });

      if (getResponse.ok) {
        const fileData = await getResponse.json();
        sha = fileData.sha;
        const content = Buffer.from(fileData.content, 'base64').toString('utf-8');
        currentData = JSON.parse(content);
        console.log(`✅ Current: ${currentData.length} apps`);
      } else if (getResponse.status === 404) {
        console.log('⚠️ File not found, will create new');
      } else {
        throw new Error(`GitHub GET failed: ${getResponse.status}`);
      }
    } catch (githubError) {
      console.error('❌ GitHub error:', githubError.message);
      return res.status(500).json({ 
        error: 'Failed to fetch from GitHub', 
        details: githubError.message 
      });
    }

    // 3️⃣ Phân loại
    const manualApps = currentData.filter(app => app.source === 'manual');
    const existingAutoApps = currentData.filter(app => app.source === 'apptesters');
    
    console.log(`✋ Manual: ${manualApps.length} | 🤖 Auto: ${existingAutoApps.length}`);

    // 4️⃣ Convert & Merge
    const newAutoApps = [];
    const updatedApps = [];
    const skippedApps = [];

    filteredApps.forEach(app => {
      try {
        const convertedApp = {
          id: `ipa-${app.bundleID || app.name.replace(/\s+/g, '-').toLowerCase()}`,
          type: 'ipa',
          name: app.name,
          icon: app.iconURL || app.icon,
          desc: app.localizedDescription || 'Injected with Premium',
          tags: autoDetectTags(app.name, app.localizedDescription || ''),
          badge: isRecent(app.versionDate) ? 'new' : null,
          fileLink: app.downloadURL || app.down,
          version: app.version,
          developer: app.developerName || 'apptesters.org',
          date: app.versionDate,
          source: 'apptesters',
          bundleID: app.bundleID,
          lastSync: new Date().toISOString()
        };

        const existing = existingAutoApps.find(e => e.name === convertedApp.name);

        if (existing) {
          if (existing.version !== convertedApp.version) {
            updatedApps.push(convertedApp);
            console.log(`🔄 Update: ${app.name} (${existing.version} → ${convertedApp.version})`);
          } else {
            skippedApps.push(existing);
          }
        } else {
          newAutoApps.push(convertedApp);
          console.log(`✨ New: ${app.name} v${convertedApp.version}`);
        }
      } catch (err) {
        console.error('⚠️ Convert error:', app.name, err.message);
      }
    });

    const finalAutoApps = [...skippedApps, ...updatedApps, ...newAutoApps];
    const mergedData = [...manualApps, ...finalAutoApps];

    console.log(`📊 Summary: Manual=${manualApps.length} | New=${newAutoApps.length} | Updated=${updatedApps.length} | Total=${mergedData.length}`);

    // 5️⃣ Upload
    console.log('📤 Uploading to GitHub...');
    try {
      const newContent = Buffer.from(JSON.stringify(mergedData, null, 2)).toString('base64');
      
      const updatePayload = {
        message: `Auto-sync: +${newAutoApps.length} new, ~${updatedApps.length} updated`,
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
          'User-Agent': 'KhoAppVIP'
        },
        body: JSON.stringify(updatePayload)
      });

      if (!updateResponse.ok) {
        const errorText = await updateResponse.text();
        throw new Error(`PUT failed: ${errorText}`);
      }

      console.log('✅ Upload successful!');
    } catch (uploadError) {
      console.error('❌ Upload error:', uploadError.message);
      return res.status(500).json({ 
        error: 'Failed to upload', 
        details: uploadError.message 
      });
    }

    return res.status(200).json({ 
      success: true,
      message: newAutoApps.length > 0 
        ? `Đã thêm ${newAutoApps.length} app mới!` 
        : 'Không có app mới hôm nay',
      stats: {
        manual: manualApps.length,
        auto: finalAutoApps.length,
        total: mergedData.length,
        new: newAutoApps.length,
        updated: updatedApps.length,
        skipped: skippedApps.length
      }
    });

  } catch (error) {
    console.error('💥 CRITICAL ERROR:', error);
    return res.status(500).json({ 
      error: 'Internal server error', 
      details: error.message
    });
  }
}

// Helper functions
function autoDetectTags(name, desc) {
  const tags = [];
  const text = `${name} ${desc}`.toLowerCase();
  
  const tagKeywords = {
    game: ['game', 'play', 'clash', 'minecraft', 'mario', 'puzzle', 'racing', 'arcade'],
    photo: ['photo', 'camera', 'snap', 'pic', 'remini', 'lightroom', 'vsco', 'filter'],
    music: ['music', 'spotify', 'sound', 'audio', 'piano', 'tune', 'song'],
    social: ['social', 'messenger', 'chat', 'instagram', 'facebook', 'telegram', 'tiktok'],
    utility: ['utility', 'tool', 'scanner', 'calculator', 'vpn', 'truecaller', 'cleaner'],
    productivity: ['productivity', 'note', 'docs', 'edit', 'office', 'pdf', 'scanner']
  };
  
  for (const [tag, keywords] of Object.entries(tagKeywords)) {
    if (keywords.some(keyword => text.includes(keyword))) {
      tags.push(tag);
    }
  }
  
  return tags.length > 0 ? tags : ['utility'];
}

function isRecent(versionDate) {
  if (!versionDate) return false;
  
  try {
    const appDate = new Date(versionDate);
    const now = new Date();
    const diffTime = Math.abs(now - appDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    return diffDays <= 7;
  } catch {
    return false;
  }
}
