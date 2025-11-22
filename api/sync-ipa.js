// api/sync-ipa.js - Smart Auto-Detect Tags & Badges

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

    // Auth check
    const hasAuthCookie = req.headers.cookie && (
      req.headers.cookie.includes('admin_token') || 
      req.headers.cookie.includes('auth')
    );
    
    if (!hasAuthCookie) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

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

    // 2. Filter by date
    const today = new Date().toISOString().split('T')[0];
    let filteredApps = allAppTestersData;
    
    if (!forceFullSync) {
      filteredApps = allAppTestersData.filter(app => {
        return app.versionDate && app.versionDate.startsWith(today);
      });
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

    // 5. Convert với AI-like detection
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
          tags: smartDetectTags(app),           // 🆕 SMART DETECTION
          badge: smartDetectBadge(app),         // 🆕 SMART BADGE
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

    // Giữ apps cũ không bị update
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

    console.log(`📊 Summary:
  - New: ${newAutoApps.length}
  - Updated: ${updatedApps.length}
  - Total: ${mergedData.length}`);

    // 7. Upload to GitHub
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

// ==================== 🆕 SMART DETECTION ====================

function smartDetectTags(app) {
  const tags = [];
  const name = (app.name || '').toLowerCase();
  const desc = (app.localizedDescription || '').toLowerCase();
  const bundleID = (app.bundleID || '').toLowerCase();
  const text = `${name} ${desc} ${bundleID}`;
  
  // 🎮 GAME - Priority detection
  const gameKeywords = [
    'game', 'play', 'racing', 'clash', 'craft', 'mario', 'sonic',
    'puzzle', 'arcade', 'adventure', 'action', 'rpg', 'strategy',
    'simulator', 'runner', 'shooter', 'battle', 'war', 'fight',
    'casino', 'cards', 'poker', 'chess', 'sudoku', 'zombie',
    'dragon', 'hero', 'legend', 'quest', 'dungeon', 'fantasy'
  ];
  
  // 📸 PHOTO
  const photoKeywords = [
    'photo', 'camera', 'pic', 'image', 'snap', 'selfie',
    'filter', 'beauty', 'editor', 'collage', 'gallery',
    'lightroom', 'vsco', 'picsart', 'remini', 'facetune',
    'photoshop', 'instagram', 'snapseed', 'prisma'
  ];
  
  // 🎵 MUSIC
  const musicKeywords = [
    'music', 'audio', 'sound', 'song', 'radio', 'player',
    'spotify', 'soundcloud', 'youtube music', 'apple music',
    'piano', 'guitar', 'tune', 'beat', 'mp3', 'podcast'
  ];
  
  // 💬 SOCIAL
  const socialKeywords = [
    'social', 'chat', 'messenger', 'message', 'whatsapp',
    'telegram', 'facebook', 'instagram', 'twitter', 'tiktok',
    'snapchat', 'discord', 'skype', 'viber', 'line', 'wechat',
    'dating', 'friend', 'community', 'network'
  ];
  
  // 🔧 UTILITY
  const utilityKeywords = [
    'utility', 'tool', 'manager', 'cleaner', 'booster',
    'vpn', 'scanner', 'calculator', 'converter', 'translator',
    'weather', 'clock', 'alarm', 'flashlight', 'compass',
    'qr', 'barcode', 'file', 'zip', 'backup'
  ];
  
  // ⚡ PRODUCTIVITY
  const productivityKeywords = [
    'productivity', 'note', 'todo', 'task', 'calendar',
    'office', 'word', 'excel', 'pdf', 'document', 'edit',
    'scanner', 'email', 'drive', 'cloud', 'sync'
  ];
  
  // 🎬 VIDEO
  const videoKeywords = [
    'video', 'movie', 'film', 'tv', 'stream', 'player',
    'youtube', 'netflix', 'editor', 'maker', 'recorder'
  ];
  
  // 🏃 HEALTH & FITNESS
  const healthKeywords = [
    'health', 'fitness', 'workout', 'exercise', 'yoga',
    'diet', 'calorie', 'step', 'run', 'walk', 'sleep'
  ];
  
  const allCategories = {
    game: gameKeywords,
    photo: photoKeywords,
    music: musicKeywords,
    social: socialKeywords,
    utility: utilityKeywords,
    productivity: productivityKeywords,
    video: videoKeywords,
    health: healthKeywords
  };
  
  // Score-based detection
  let scores = {};
  
  for (const [category, keywords] of Object.entries(allCategories)) {
    scores[category] = 0;
    
    keywords.forEach(keyword => {
      // Exact match in name = +3 points
      if (name.includes(keyword)) {
        scores[category] += 3;
      }
      // Match in description = +1 point
      if (desc.includes(keyword)) {
        scores[category] += 1;
      }
      // Match in bundleID = +2 points
      if (bundleID.includes(keyword)) {
        scores[category] += 2;
      }
    });
  }
  
  // Get top 2 categories with score > 0
  const sortedCategories = Object.entries(scores)
    .filter(([_, score]) => score > 0)
    .sort(([_, a], [__, b]) => b - a)
    .slice(0, 2)
    .map(([cat, _]) => cat);
  
  // If no match, random from common categories
  if (sortedCategories.length === 0) {
    const commonTags = ['utility', 'productivity', 'photo', 'social'];
    return [commonTags[Math.floor(Math.random() * commonTags.length)]];
  }
  
  return sortedCategories;
}

function smartDetectBadge(app) {
  const name = (app.name || '').toLowerCase();
  const desc = (app.localizedDescription || '').toLowerCase();
  const versionDate = app.versionDate;
  
  // Check if recent (within 7 days)
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
  
  // 🆕 NEW - Recent apps
  if (isRecent) {
    return 'new';
  }
  
  // 🔥 TRENDING - Popular apps
  const trendingKeywords = [
    'spotify', 'youtube', 'tiktok', 'instagram', 'facebook',
    'whatsapp', 'telegram', 'snapchat', 'netflix', 'twitter',
    'minecraft', 'roblox', 'among us', 'pubg', 'free fire',
    'zoom', 'discord', 'canva', 'capcut', 'lightroom'
  ];
  
  if (trendingKeywords.some(keyword => name.includes(keyword))) {
    // 50% chance trending, 50% chance top
    return Math.random() > 0.5 ? 'trending' : 'top';
  }
  
  // ⭐ TOP - Premium/Pro apps
  const premiumKeywords = [
    'premium', 'pro', 'plus', 'gold', 'vip', 'unlocked',
    'full', 'cracked', 'modded', 'hacked'
  ];
  
  if (premiumKeywords.some(keyword => desc.includes(keyword))) {
    return 'top';
  }
  
  // 🎲 Random for variety (20% chance)
  if (Math.random() < 0.2) {
    const randomBadges = ['trending', 'top', null, null, null];
    return randomBadges[Math.floor(Math.random() * randomBadges.length)];
  }
  
  return null; // No badge (60% apps have no badge for clean look)
}
