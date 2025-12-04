// api/sync-ipa.js - PHIÊN BẢN CẬP NHẬT TAG & BADGE THÔNG MINH

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

    // 5. 🎯 LOGIC MỚI: GIỮ TẤT CẢ PHIÊN BẢN (Sử dụng hàm smartDetect mới)
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
          tags: smartDetectTags(app),    // <--- CẬP NHẬT TAG THÔNG MINH
          badge: smartDetectBadge(app),  // <--- CẬP NHẬT BADGE THÔNG MINH
          fileLink: app.downloadURL || app.down,
          version: app.version,
          developer: app.developerName || 'apptesters.org',
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
          skippedApps.push(convertedApp);
        } else {
          newApps.push(convertedApp);
          
          const oldVersions = existingAutoApps.filter(e => 
            e.name === convertedApp.name && 
            e.bundleID === convertedApp.bundleID &&
            e.version !== convertedApp.version
          );
          
          if (oldVersions.length > 0) {
            keptOldVersions.push(...oldVersions);
          }
        }
      } catch (err) {
        console.error('⚠️ Convert error:', app.name, err.message);
      }
    });

    // 6. 🔄 MERGE
    const allAutoApps = [...existingAutoApps, ...newApps];
    const uniqueApps = [];
    const seenKeys = new Set();
    
    allAutoApps.forEach(app => {
      const key = `${app.name}|${app.bundleID}|${app.version}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        uniqueApps.push(app);
      }
    });
    
    uniqueApps.sort((a, b) => {
      const dateA = new Date(a.date || a.lastSync || 0);
      const dateB = new Date(b.date || b.lastSync || 0);
      return dateB - dateA;
    });

    manualApps.sort((a, b) => {
      const dateA = new Date(a.date || 0);
      const dateB = new Date(b.date || 0);
      return dateB - dateA;
    });

    const mergedData = [...uniqueApps, ...manualApps, ...otherApps];

    console.log(`📊 Summary: +${newApps.length} new | Total: ${mergedData.length}`);

    // 7. Upload to GitHub
    if (newApps.length > 0) {
      console.log('📤 Uploading...');
      const newContent = Buffer.from(JSON.stringify(mergedData, null, 2)).toString('base64');
      const updatePayload = {
        message: `Sync: +${newApps.length} new (smart tags)`,
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

      if (!updateResponse.ok) throw new Error('Upload failed');

      console.log('✅ Success!');
      return res.status(200).json({ 
        success: true,
        message: `Sync thành công: +${newApps.length} mới`,
        filterRange: filterText,
        stats: { new: newApps.length, total: mergedData.length }
      });
    } else {
      return res.status(200).json({ 
        success: true,
        message: 'Không có app/phiên bản mới',
        filterRange: filterText,
        stats: { new: 0, total: mergedData.length }
      });
    }

  } catch (error) {
    console.error('💥 ERROR:', error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
}

// ==================== HELPER FUNCTIONS (UPDATED SMART DETECT) ====================

function smartDetectTags(app) {
  const name = (app.name || '').toLowerCase();
  const desc = (app.localizedDescription || '').toLowerCase();
  const bundleID = (app.bundleID || '').toLowerCase();
  
  // Danh mục từ khóa nâng cao, sát thực tế
  const categories = {
    'game': [
      // Genres
      'game', 'play', 'rpg', 'moba', 'fps', 'survival', 'puzzle', 'simulator', 
      // Popular Titles
      'lien quan', 'pubg', 'free fire', 'roblox', 'minecraft', 'genshin', 
      'honkai', 'gta', 'pokemon', 'tft', 'wild rift', 'fc mobile', 'brawl stars'
    ],
    'social': [
      'social', 'chat', 'messenger', 'connect',
      'facebook', 'instagram', 'tiktok', 'twitter', 'x', 'threads', 'zalo', 
      'telegram', 'discord', 'whatsapp', 'snapchat', 'reddit'
    ],
    'editor': [ // Nhóm Edit ảnh/video đang hot
      'editor', 'video', 'photo', 'camera', 'filter', 'preset',
      'capcut', 'picsart', 'lightroom', 'vsco', 'alight motion', 'wink', 
      'facetune', 'remini', 'meitu', 'photoshop', 'canva'
    ],
    'music': [
      'music', 'audio', 'song', 'stream', 'mp3', 'sound',
      'spotify', 'soundcloud', 'youtube music', 'deezer', 'shazam', 'zing'
    ],
    'movie': [ // Nhóm xem phim
      'movie', 'film', 'cinema', 'stream', 'tv',
      'netflix', 'disney', 'hbo', 'iqiyi', 'wetv', 'loklok', 'dramabox'
    ],
    'utility': [
      'utility', 'tool', 'manager', 'browser', 'vpn', 'adblock',
      'esign', 'scarlet', 'gbox', 'trollstore', 'flekstore', 
      'unc0ver', 'taurine', 'dopamine', 'file', 'wifi', 'keyboard'
    ],
    'ai': [ // Nhóm AI
      'ai', 'gpt', 'bot', 'artificial', 'intelligence', 'chatgpt', 
      'midjourney', 'stable diffusion', 'poe', 'character.ai'
    ]
  };

  let scores = {};

  // Tính điểm dựa trên vị trí xuất hiện từ khóa
  for (const [category, keywords] of Object.entries(categories)) {
    scores[category] = 0;
    keywords.forEach(keyword => {
      // Tên app chứa keyword => ưu tiên cao nhất (5đ)
      if (name.includes(keyword)) scores[category] += 5;
      // Bundle ID chứa keyword => ưu tiên nhì (3đ)
      if (bundleID.includes(keyword)) scores[category] += 3;
      // Mô tả chứa keyword => ưu tiên thấp (1đ)
      if (desc.includes(keyword)) scores[category] += 1;
    });
  }

  // Lấy danh mục có điểm cao nhất
  const sortedCategories = Object.entries(scores)
    .filter(([_, score]) => score > 0)
    .sort(([_, a], [__, b]) => b - a)
    .map(([cat, _]) => cat);
  
  // Fallback thông minh
  if (sortedCategories.length === 0) {
    // Nếu tên ngắn hoặc chứa dấu chấm (thường là tool hệ thống)
    if (name.length < 5 || name.includes('.')) return ['utility'];
    return ['app']; 
  }
  
  // Trả về tối đa 2 tag chính xác nhất
  return sortedCategories.slice(0, 2);
}

function smartDetectBadge(app) {
  const name = (app.name || '').toLowerCase();
  const desc = (app.localizedDescription || '').toLowerCase();
  
  // 1. Check NEW (Trong vòng 7 ngày)
  if (app.versionDate) {
    try {
      const appDate = new Date(app.versionDate);
      const now = new Date();
      const diffDays = Math.ceil((now - appDate) / (1000 * 60 * 60 * 24));
      if (diffDays <= 7) return 'new';
    } catch (e) {}
  }

  // 2. Check VIP / MOD (Dựa trên nội dung Hack/Mod/Premium)
  const premiumKeywords = [
    'hacked', 'hack', 'mod', 'cheat', 'menu', 'unlocked', 'premium', 'pro', 
    'no ads', 'vip', 'gold', 'plus', 'infinite', 'god mode'
  ];
  
  if (premiumKeywords.some(k => name.includes(k))) return 'vip';
  if (premiumKeywords.some(k => desc.includes(k))) return 'vip';

  // 3. Check HOT (Các App phổ biến nhất thực tế)
  const trendingApps = [
    'tiktok', 'facebook', 'instagram', 'youtube', 'messenger',
    'esign', 'scarlet', 'gbox', 'trollstore', 'delta', 'ppsspp',
    'roblox', 'lien quan', 'minecraft', 'gta',
    'spotify', 'netflix', 'capcut'
  ];

  if (trendingApps.some(k => name.includes(k))) {
    return 'hot';
  }

  // Mặc định không có badge (tránh rác giao diện)
  return null;
}
