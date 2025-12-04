// api/sync-ipa.js - GIỮ TẤT CẢ PHIÊN BẢN KHÁC NHAU

export default async function handler(req, res) {
  // CRITICAL: CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Cookie');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  console.log('🔄 Sync API called:', new Date().toISOString());

  try {
    const { syncHours, botSync } = req.body || {};

    // 🔐 AUTH CHECK
    const cookie = req.headers.cookie || '';
    const hasAuthCookie = 
      cookie.includes('admin_token') || 
      cookie.includes('auth') ||
      botSync === true;
    
    if (!hasAuthCookie) {
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
      return res.status(500).json({ error: 'GitHub token not configured' });
    }

    // 1. Fetch từ AppTesters
    console.log('📦 Fetching from AppTesters...');
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
    const allAppTestersData = jsonData.apps || [];
    console.log(`✅ Found ${allAppTestersData.length} apps`);

    // 2. Filter by time range
    let filteredApps = allAppTestersData;
    let filterText = '';
    
    if (syncHours > 0) {
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

    // 4. Phân loại apps hiện tại
    const manualApps = currentData.filter(app => app.source === 'manual');
    const existingAutoApps = currentData.filter(app => app.source === 'apptesters');
    const otherApps = currentData.filter(app => !app.source || 
      (app.source !== 'manual' && app.source !== 'apptesters'));
    
    console.log(`✋ Manual: ${manualApps.length} | 🤖 Auto: ${existingAutoApps.length}`);

    // 5. 🎯 LOGIC MỚI: GIỮ TẤT CẢ PHIÊN BẢN
    const newApps = [];
    const skippedApps = [];
    const keptOldVersions = [];

    filteredApps.forEach(app => {
      try {
        const convertedApp = {
          id: `ipa-${app.bundleID || app.name.replace(/\s+/g, '-').toLowerCase()}-${app.version}`,
          type: 'ipa',
          name: app.name,
          icon: app.iconURL || app.icon,
          desc: app.localizedDescription || 'Injected with Premium',
          tags: smartDetectTags(app),
          badge: smartDetectBadge(app),
          fileLink: app.downloadURL || app.down,
          version: app.version,
          developer: app.developerName || 'khomodvip',
          date: app.versionDate,
          source: 'apptesters',
          bundleID: app.bundleID,
          lastSync: new Date().toISOString()
        };

        // 🔍 Kiểm tra trùng HOÀN TOÀN (tên + bundleID + version)
        const exactDuplicate = existingAutoApps.find(e => 
          e.name === convertedApp.name && 
          e.bundleID === convertedApp.bundleID &&
          e.version === convertedApp.version
        );

        if (exactDuplicate) {
          // ⏭️ BỎ QUA - Trùng hoàn toàn
          skippedApps.push(convertedApp);
          console.log(`⏭️ Skip (exact): ${app.name} v${app.version}`);
        } else {
          // ✨ THÊM MỚI - Chưa có hoặc phiên bản khác
          newApps.push(convertedApp);
          
          // Kiểm tra xem có phiên bản cũ của app này không
          const oldVersions = existingAutoApps.filter(e => 
            e.name === convertedApp.name && 
            e.bundleID === convertedApp.bundleID &&
            e.version !== convertedApp.version
          );
          
          if (oldVersions.length > 0) {
            console.log(`📦 New version: ${app.name} v${app.version} (keeping ${oldVersions.length} old version(s))`);
            keptOldVersions.push(...oldVersions);
          } else {
            console.log(`✨ Brand new: ${app.name} v${app.version}`);
          }
        }
      } catch (err) {
        console.error('⚠️ Convert error:', app.name, err.message);
      }
    });

    // 6. 🔄 MERGE: GIỮ TẤT CẢ + THÊM MỚI
    // Bước 1: Lấy tất cả apps cũ (trừ những cái bị skip vì trùng)
    const allAutoApps = [...existingAutoApps, ...newApps];
    
    // Bước 2: Loại bỏ duplicates (chỉ xóa những cái trùng hoàn toàn)
    const uniqueApps = [];
    const seenKeys = new Set();
    
    allAutoApps.forEach(app => {
      const key = `${app.name}|${app.bundleID}|${app.version}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        uniqueApps.push(app);
      }
    });
    
    // Bước 3: Sort theo date (mới nhất lên đầu)
    uniqueApps.sort((a, b) => {
      const dateA = new Date(a.date || a.lastSync || 0);
      const dateB = new Date(b.date || b.lastSync || 0);
      return dateB - dateA;
    });

    // Manual apps sort
    manualApps.sort((a, b) => {
      const dateA = new Date(a.date || 0);
      const dateB = new Date(b.date || 0);
      return dateB - dateA;
    });

    // Final merge
    const mergedData = [...uniqueApps, ...manualApps, ...otherApps];

    console.log(`📊 Summary:
  - New apps/versions: ${newApps.length}
  - Kept old versions: ${keptOldVersions.length}
  - Skipped (exact duplicates): ${skippedApps.length}
  - Total auto apps: ${uniqueApps.length}
  - Manual apps: ${manualApps.length}
  - TOTAL: ${mergedData.length}`);

    // 7. Upload to GitHub (chỉ khi có thay đổi)
    if (newApps.length > 0) {
      console.log('📤 Uploading...');
      
      const newContent = Buffer.from(JSON.stringify(mergedData, null, 2)).toString('base64');
      
      const updatePayload = {
        message: `Sync: +${newApps.length} new (kept all versions)`,
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
        message: `Sync thành công: +${newApps.length} mới/phiên bản mới`,
        filterRange: filterText,
        stats: {
          new: newApps.length,
          kept: keptOldVersions.length,
          skipped: skippedApps.length,
          total: mergedData.length
        }
      });
    } else {
      return res.status(200).json({ 
        success: true,
        message: 'Không có app/phiên bản mới',
        filterRange: filterText,
        stats: {
          new: 0,
          kept: keptOldVersions.length,
          skipped: skippedApps.length,
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
