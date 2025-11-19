// api/sync-ipa.js - Sync thông minh với error handling tốt hơn

export default async function handler(req, res) {
  // Enable CORS for debugging
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

    // Validate environment variables
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const GITHUB_OWNER = process.env.GITHUB_OWNER || 'Cuongqtx11';
    const GITHUB_REPO = process.env.GITHUB_REPO || 'app_vip';
    const FILE_PATH = 'public/data/ipa.json';
    const APPTESTER_URL = 'https://repository.apptesters.org/';

    if (!GITHUB_TOKEN) {
      console.error('❌ GITHUB_TOKEN not found');
      return res.status(500).json({ 
        error: 'GitHub token not configured. Please set GITHUB_TOKEN in environment variables.' 
      });
    }

    console.log('📡 Config:', { GITHUB_OWNER, GITHUB_REPO, FILE_PATH });

    // 1️⃣ Fetch dữ liệu từ AppTesters
    console.log('📦 Fetching from AppTesters...');
    let allAppTestersData;
    
    try {
      const appTestersResponse = await fetch(APPTESTER_URL, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; KhoAppVIP/1.0)'
        }
      });
      
      if (!appTestersResponse.ok) {
        throw new Error(`AppTesters API returned ${appTestersResponse.status}: ${appTestersResponse.statusText}`);
      }
      
      const rawData = await appTestersResponse.text();
      allAppTestersData = JSON.parse(rawData);
      
      if (!Array.isArray(allAppTestersData)) {
        throw new Error('AppTesters data is not an array');
      }
      
      console.log(`✅ Fetched ${allAppTestersData.length} apps from AppTesters`);
    } catch (fetchError) {
      console.error('❌ AppTesters fetch error:', fetchError.message);
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
    console.log('📄 Fetching current data from GitHub...');
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
        console.log(`✅ Current data: ${currentData.length} apps`);
      } else if (getResponse.status === 404) {
        console.log('⚠️ File not found, will create new');
      } else {
        const errorText = await getResponse.text();
        throw new Error(`GitHub GET failed (${getResponse.status}): ${errorText}`);
      }
    } catch (githubError) {
      console.error('❌ GitHub GET error:', githubError.message);
      return res.status(500).json({ 
        error: 'Failed to fetch from GitHub', 
        details: githubError.message 
      });
    }

    // 3️⃣ Phân loại
    const manualApps = currentData.filter(app => app.source === 'manual');
    const existingAutoApps = currentData.filter(app => app.source === 'apptesters');
    
    console.log(`✋ Manual apps: ${manualApps.length}`);
    console.log(`🤖 Existing auto apps: ${existingAutoApps.length}`);

    // 4️⃣ Convert & Merge
    const newAutoApps = [];
    const updatedApps = [];
    const skippedApps = [];

    filteredApps.forEach(app => {
      try {
        const convertedApp = {
          id: `ipa-${app.bundleID || app.name.replace(/\s+/g, '-').toLowerCase()}`,
          type: 'ipa',
          name: app.name || 'Unknown',
          icon: app.iconURL || app.icon || 'https://via.placeholder.com/150',
          desc: app.localizedDescription || 'Injected with Premium',
          tags: autoDetectTags(app.name, app.localizedDescription || ''),
          badge: isRecent(app.versionDate) ? 'new' : null,
          fileLink: app.downloadURL || app.down || '#',
          version: app.version || '1.0.0',
          developer: app.developerName || 'AppTesters',
          date: app.versionDate || today,
          source: 'apptesters',
          bundleID: app.bundleID || null,
          lastSync: new Date().toISOString()
        };

        const existingApp = existingAutoApps.find(existing => 
          existing.name === convertedApp.name
        );

        if (existingApp) {
          if (existingApp.version !== convertedApp.version) {
            updatedApps.push(convertedApp);
          } else {
            skippedApps.push(existingApp);
          }
        } else {
          newAutoApps.push(convertedApp);
        }
      } catch (conversionError) {
        console.error('⚠️ Error converting app:', app.name, conversionError.message);
      }
    });

    const finalAutoApps = [...skippedApps, ...updatedApps, ...newAutoApps];
    const mergedData = [...manualApps, ...finalAutoApps];

    console.log(`📊 Summary:
  - Manual: ${manualApps.length}
  - New: ${newAutoApps.length}
  - Updated: ${updatedApps.length}
  - Skipped: ${skippedApps.length}
  - Total: ${mergedData.length}`);

    // 5️⃣ Upload lên GitHub
    console.log('📤 Uploading to GitHub...');
    try {
      const newContent = Buffer.from(JSON.stringify(mergedData, null, 2)).toString('base64');
      
      const updatePayload = {
        message: `Auto-sync IPA: +${newAutoApps.length} new, ~${updatedApps.length} updated`,
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
        throw new Error(`GitHub PUT failed (${updateResponse.status}): ${errorText}`);
      }

      console.log('✅ Upload successful!');
    } catch (uploadError) {
      console.error('❌ GitHub upload error:', uploadError.message);
      return res.status(500).json({ 
        error: 'Failed to upload to GitHub', 
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
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

// Helper functions
function autoDetectTags(name, desc) {
  const tags = [];
  const text = `${name} ${desc}`.toLowerCase();
  
  const tagKeywords = {
    game: ['game', 'play', 'clash', 'minecraft', 'mario', 'puzzle', 'racing'],
    photo: ['photo', 'camera', 'snap', 'pic', 'remini', 'lightroom', 'vsco'],
    music: ['music', 'spotify', 'sound', 'audio', 'piano', 'tune'],
    social: ['social', 'messenger', 'chat', 'instagram', 'facebook', 'telegram'],
    utility: ['utility', 'tool', 'scanner', 'calculator', 'vpn', 'truecaller'],
    productivity: ['productivity', 'note', 'docs', 'edit', 'office']
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
