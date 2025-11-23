// api/sync-ipa.js - FIXED với CORS và Auth bypass cho bot

export default async function handler(req, res) {
  // CRITICAL: CORS headers phải đặt đầu tiên
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Cookie');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  // Handle OPTIONS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // ONLY allow POST
  if (req.method !== 'POST') {
    console.log('❌ Method not allowed:', req.method);
    return res.status(405).json({ 
      error: 'Method not allowed',
      allowedMethods: ['POST']
    });
  }

  console.log('🔄 Sync API called:', new Date().toISOString());
  console.log('📝 Headers:', req.headers.cookie ? 'Has cookie' : 'No cookie');

  try {
    const { syncHours, botSync } = req.body || {};

    // 🔐 AUTH CHECK - Multiple bypass methods
    const cookie = req.headers.cookie || '';
    
    const hasAuthCookie = 
      cookie.includes('admin_token') || 
      cookie.includes('auth') ||
      cookie.includes('sync_authorized') ||
      cookie.includes('bot_sync_bypass') ||  // Bot bypass
      botSync === true;  // Bot flag bypass
    
    if (!hasAuthCookie) {
      console.log('⚠️ Auth failed - Cookie:', cookie);
      console.log('⚠️ Auth failed - botSync:', botSync);
      return res.status(401).json({ 
        error: 'Unauthorized',
        code: 'NO_AUTH_COOKIE',
        hint: 'Add admin_token cookie or set botSync=true'
      });
    }

    console.log('✅ Auth passed (botSync:', botSync, ')');

    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const GITHUB_OWNER = process.env.GITHUB_OWNER || 'Cuongqtx11';
    const GITHUB_REPO = process.env.GITHUB_REPO || 'app_vip';
    const FILE_PATH = 'public/data/ipa.json';
    const APPTESTER_URL = 'https://repository.apptesters.org/';

    if (!GITHUB_TOKEN) {
      console.error('❌ GITHUB_TOKEN not found');
      return res.status(500).json({ error: 'GitHub token not configured' });
    }

    // 1. Fetch từ AppTesters
    console.log('📦 Fetching from AppTesters...');
    let allAppTestersData;
    
    try {
      const response = await fetch(APPTESTER_URL, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }
      
      const jsonData = await response.json();
      
      if (jsonData.apps && Array.isArray(jsonData.apps)) {
        allAppTestersData = jsonData.apps;
        console.log(`✅ Found ${allAppTestersData.length} apps`);
      } else {
        throw new Error('No apps array found');
      }
      
    } catch (fetchError) {
      console.error('❌ Fetch error:', fetchError.message);
      return res.status(500).json({ 
        error: 'Failed to fetch from AppTesters', 
        details: fetchError.message 
      });
    }

    // 2. Filter by time range
    let filteredApps = allAppTestersData;
    let filterText = '';
    
    if (syncHours === -1) {
      filterText = 'Full Sync';
      console.log('⚠️ FULL SYNC MODE');
    } else if (syncHours > 0) {
      const cutoffTime = new Date(Date.now() - syncHours * 60 * 60 * 1000);
      filteredApps = allAppTestersData.filter(app => {
        if (!app.versionDate) return false;
        try {
          const appDate = new Date(app.versionDate);
          return appDate >= cutoffTime;
        } catch {
          return false;
        }
      });
      filterText = `${syncHours}h`;
      console.log(`📅 Apps in last ${syncHours}h: ${filteredApps.length}`);
    } else {
      const today = new Date().toISOString().split('T')[0];
      filteredApps = allAppTestersData.filter(app => {
        return app.versionDate && app.versionDate.startsWith(today);
      });
      filterText = 'Today';
      console.log(`📅 Apps today: ${filteredApps.length}`);
    }

    // 3. Get current data from GitHub
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
      }
    } catch (githubError) {
      console.error('❌ GitHub error:', githubError.message);
      return res.status(500).json({ 
        error: 'Failed to fetch from GitHub', 
        details: githubError.message 
      });
    }

    // 4. Phân loại
    const manualApps = currentData.filter(app => app.source === 'manual');
    const existingAutoApps = currentData.filter(app => app.source === 'apptesters');
    const otherApps = currentData.filter(app => !app.source || 
      (app.source !== 'manual' && app.source !== 'apptesters'));
    
    console.log(`✋ Manual: ${manualApps.length} | 🤖 Auto: ${existingAutoApps.length}`);

    // 5. Convert với smart detection
    const newAutoApps = [];
    const updatedApps = [];

    filteredApps.forEach(app => {
      try {
        const convertedApp = {
          id: `ipa-${app.bundleID || app.name.replace(/\s+/g, '-').toLowerCase()}`,
          type: 'ipa',
          name: app.name,
          icon: app.iconURL || app.icon,
          desc: app.localizedDescription || 'Injected with Premium',
          tags: smartDetectTags(app),
          badge: smartDetectBadge(app),
          fileLink: app.downloadURL || app.down,
          version: app.version,
          developer: app.developerName || 'apptesters.org',
          date: app.versionDate,
          source: 'apptesters',
          bundleID: app.bundleID,
          lastSync: new Date().toISOString()
        };

        const existing = existingAutoApps.find(e => 
          e.name === convertedApp.name && 
          e.bundleID === convertedApp.bundleID
        );

        if (existing) {
          if (existing.version !== convertedApp.version) {
            updatedApps.push(convertedApp);
            console.log(`🔄 Update: ${app.name}`);
          }
        } else {
          newAutoApps.push(convertedApp);
          console.log(`✨ New: ${app.name}`);
        }
      } catch (err) {
        console.error('⚠️ Convert error:', app.name, err.message);
      }
    });

    const unchangedAutoApps = existingAutoApps.filter(old => {
      const isUpdated = updatedApps.some(u => u.name === old.name);
      const isNew = newAutoApps.some(n => n.name === old.name);
      return !isUpdated && !isNew;
    });

    // 6. Merge & Sort
    const allAutoApps = [...newAutoApps, ...updatedApps, ...unchangedAutoApps];
    
    allAutoApps.sort((a, b) => {
      const dateA = new Date(a.date || a.lastSync || 0);
      const dateB = new Date(b.date || b.lastSync || 0);
      return dateB - dateA;
    });

    manualApps.sort((a, b) => {
      const dateA = new Date(a.date || 0);
      const dateB = new Date(b.date || 0);
      return dateB - dateA;
    });

    const mergedData = [...allAutoApps, ...manualApps, ...otherApps];

    console.log(`📊 Summary: New=${newAutoApps.length}, Updated=${updatedApps.length}, Total=${mergedData.length}`);

    // 7. Upload to GitHub (nếu có thay đổi)
    if (newAutoApps.length > 0 || updatedApps.length > 0) {
      console.log('📤 Uploading...');
      
      const newContent = Buffer.from(JSON.stringify(mergedData, null, 2)).toString('base64');
      
      const updatePayload = {
        message: `Sync: +${newAutoApps.length} new, ~${updatedApps.length} updated`,
        content: newContent,
        branch: 'main'
      };

      if (sha) updatePayload.sha = sha;

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
        throw new Error('Upload failed');
      }

      console.log('✅ Success!');
      
      return res.status(200).json({ 
        success: true,
        message: `Sync thành công: +${newAutoApps.length} mới`,
        filterRange: filterText,
        stats: {
          new: newAutoApps.length,
          updated: updatedApps.length,
          total: mergedData.length
        }
      });
    } else {
      return res.status(200).json({ 
        success: true,
        message: 'Không có app mới',
        filterRange: filterText,
        stats: {
          new: 0,
          updated: 0,
          total: mergedData.length
        }
      });
    }

  } catch (error) {
    console.error('💥 ERROR:', error);
    return res.status(500).json({ 
      error: 'Internal server error', 
      details: error.message
    });
  }
}

// ==================== HELPER FUNCTIONS ====================

function smartDetectTags(app) {
  const tags = [];
  const name = (app.name || '').toLowerCase();
  const desc = (app.localizedDescription || '').toLowerCase();
  const bundleID = (app.bundleID || '').toLowerCase();
  
  const gameKeywords = ['game', 'play', 'racing', 'clash', 'craft', 'puzzle', 'arcade'];
  const photoKeywords = ['photo', 'camera', 'pic', 'image', 'snap', 'filter', 'lightroom'];
  const musicKeywords = ['music', 'audio', 'sound', 'song', 'spotify', 'piano'];
  const socialKeywords = ['social', 'chat', 'messenger', 'instagram', 'facebook', 'tiktok'];
  const utilityKeywords = ['utility', 'tool', 'manager', 'vpn', 'scanner', 'calculator'];
  const productivityKeywords = ['productivity', 'note', 'todo', 'office', 'pdf', 'document'];
  
  const allCategories = {
    game: gameKeywords,
    photo: photoKeywords,
    music: musicKeywords,
    social: socialKeywords,
    utility: utilityKeywords,
    productivity: productivityKeywords
  };
  
  let scores = {};
  
  for (const [category, keywords] of Object.entries(allCategories)) {
    scores[category] = 0;
    keywords.forEach(keyword => {
      if (name.includes(keyword)) scores[category] += 3;
      if (desc.includes(keyword)) scores[category] += 1;
      if (bundleID.includes(keyword)) scores[category] += 2;
    });
  }
  
  const sortedCategories = Object.entries(scores)
    .filter(([_, score]) => score > 0)
    .sort(([_, a], [__, b]) => b - a)
    .slice(0, 2)
    .map(([cat, _]) => cat);
  
  if (sortedCategories.length === 0) {
    const commonTags = ['utility', 'productivity', 'photo'];
    return [commonTags[Math.floor(Math.random() * commonTags.length)]];
  }
  
  return sortedCategories;
}

function smartDetectBadge(app) {
  const name = (app.name || '').toLowerCase();
  const desc = (app.localizedDescription || '').toLowerCase();
  const versionDate = app.versionDate;
  
  let isRecent = false;
  if (versionDate) {
    try {
      const appDate = new Date(versionDate);
      const now = new Date();
      const diffDays = Math.ceil((now - appDate) / (1000 * 60 * 60 * 24));
      isRecent = diffDays <= 7;
    } catch (e) {
      isRecent = false;
    }
  }
  
  if (isRecent) return 'new';
  
  const trendingKeywords = [
    'spotify', 'youtube', 'tiktok', 'instagram', 'facebook',
    'whatsapp', 'telegram', 'netflix', 'minecraft'
  ];
  
  if (trendingKeywords.some(keyword => name.includes(keyword))) {
    return Math.random() > 0.5 ? 'trending' : 'top';
  }
  
  const premiumKeywords = ['premium', 'pro', 'plus', 'gold', 'vip', 'unlocked'];
  if (premiumKeywords.some(keyword => desc.includes(keyword))) {
    return 'top';
  }
  
  if (Math.random() < 0.2) {
    const randomBadges = ['trending', 'top', null, null, null];
    return randomBadges[Math.floor(Math.random() * randomBadges.length)];
  }
  
  return null;
}
