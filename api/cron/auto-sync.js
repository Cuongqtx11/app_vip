// api/cron/auto-sync.js - Vercel Cron Job (Chạy mỗi 6 giờ)

export default async function handler(req, res) {
  // Verify cron secret (bảo mật)
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('🤖 AUTO-SYNC started at:', new Date().toISOString());

  try {
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const GITHUB_OWNER = process.env.GITHUB_OWNER || 'Cuongqtx11';
    const GITHUB_REPO = process.env.GITHUB_REPO || 'app_vip';
    const FILE_PATH = 'public/data/ipa.json';
    const APPTESTER_URL = 'https://repository.apptesters.org/';

    if (!GITHUB_TOKEN) {
      throw new Error('GITHUB_TOKEN not configured');
    }

    // 1️⃣ Fetch từ AppTesters
    console.log('📦 Fetching from AppTesters...');
    const response = await fetch(APPTESTER_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`AppTesters API returned ${response.status}`);
    }

    const jsonData = await response.json();
    const allAppTestersData = jsonData.apps || [];
    console.log(`✅ Fetched ${allAppTestersData.length} apps from AppTesters`);

    // 🎯 Lấy apps trong 24h gần nhất
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    const recentApps = allAppTestersData.filter(app => {
      if (!app.versionDate) return false;
      return app.versionDate >= yesterdayStr;
    });

    console.log(`📅 Recent apps (last 24h): ${recentApps.length}`);

    if (recentApps.length === 0) {
      console.log('ℹ️ No new apps found');
      return res.status(200).json({
        success: true,
        message: 'No new apps found',
        stats: { new: 0, updated: 0 }
      });
    }

    // 2️⃣ Lấy dữ liệu hiện tại từ GitHub
    const getFileUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${FILE_PATH}`;
    
    const getResponse = await fetch(getFileUrl, {
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'KhoAppVIP-Cron'
      }
    });

    if (!getResponse.ok) {
      throw new Error(`GitHub GET failed: ${getResponse.status}`);
    }

    const fileData = await getResponse.json();
    const sha = fileData.sha;
    const content = Buffer.from(fileData.content, 'base64').toString('utf-8');
    const currentData = JSON.parse(content);
    console.log(`✅ Current data: ${currentData.length} apps`);

    // 3️⃣ Phân loại apps
    const manualApps = currentData.filter(app => app.source === 'manual');
    const existingAutoApps = currentData.filter(app => app.source === 'apptesters');
    const otherApps = currentData.filter(app => !app.source || 
      (app.source !== 'manual' && app.source !== 'apptesters'));

    // 4️⃣ Process new apps
    const newApps = [];
    const updatedApps = [];
    const skippedApps = [];

    recentApps.forEach(app => {
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

        // Kiểm tra duplicate
        const existing = existingAutoApps.find(e => 
          e.name === convertedApp.name && 
          e.bundleID === convertedApp.bundleID
        );

        if (existing) {
          if (existing.version !== convertedApp.version) {
            // Update version mới
            updatedApps.push(convertedApp);
            console.log(`🔄 Update: ${app.name} (${existing.version} → ${convertedApp.version})`);
          } else {
            // Skip - đã có rồi
            skippedApps.push(existing);
          }
        } else {
          // App hoàn toàn mới
          newApps.push(convertedApp);
          console.log(`✨ New: ${app.name} v${convertedApp.version}`);
        }
      } catch (err) {
        console.error('⚠️ Convert error:', app.name, err.message);
      }
    });

    // 🔒 Giữ lại apps cũ (không bị update)
    const unchangedAutoApps = existingAutoApps.filter(old => {
      const isUpdated = updatedApps.some(u => u.name === old.name && u.bundleID === old.bundleID);
      const isNew = newApps.some(n => n.name === old.name && n.bundleID === old.bundleID);
      return !isUpdated && !isNew;
    });

    // 5️⃣ 🎯 MERGE VÀ SẮP XẾP: APP MỚI LUÔN Ở ĐẦU
    const allAutoApps = [...newApps, ...updatedApps, ...unchangedAutoApps];
    
    // Sort by date (mới nhất lên đầu)
    allAutoApps.sort((a, b) => {
      const dateA = new Date(a.date || a.lastSync || 0);
      const dateB = new Date(b.date || b.lastSync || 0);
      return dateB - dateA; // Descending order (mới → cũ)
    });

    // Manual apps cũng sort theo date nếu có
    manualApps.sort((a, b) => {
      const dateA = new Date(a.date || 0);
      const dateB = new Date(b.date || 0);
      return dateB - dateA;
    });

    const mergedData = [
      ...allAutoApps,    // 🆕 Auto apps (sorted by date - MỚI NHẤT LÊN ĐẦU)
      ...manualApps,     // ✋ Manual apps (sorted)
      ...otherApps       // 📦 Other apps
    ];

    console.log(`📊 Summary:
  - New apps: ${newApps.length}
  - Updated apps: ${updatedApps.length}
  - Unchanged auto: ${unchangedAutoApps.length}
  - Manual apps: ${manualApps.length}
  - Other apps: ${otherApps.length}
  - TOTAL: ${mergedData.length}`);

    // 6️⃣ Upload to GitHub (chỉ khi có thay đổi)
    if (newApps.length > 0 || updatedApps.length > 0) {
      console.log('📤 Uploading to GitHub...');
      
      const newContent = Buffer.from(JSON.stringify(mergedData, null, 2)).toString('base64');
      
      const updateResponse = await fetch(getFileUrl, {
        method: 'PUT',
        headers: {
          'Authorization': `token ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'User-Agent': 'KhoAppVIP-Cron'
        },
        body: JSON.stringify({
          message: `🤖 Auto-sync: +${newApps.length} new, ~${updatedApps.length} updated`,
          content: newContent,
          sha: sha,
          branch: 'main'
        })
      });

      if (!updateResponse.ok) {
        const errorText = await updateResponse.text();
        throw new Error(`GitHub PUT failed: ${errorText}`);
      }

      console.log('✅ Upload successful!');
      
      return res.status(200).json({
        success: true,
        message: `Auto-sync completed: ${newApps.length} new, ${updatedApps.length} updated`,
        stats: {
          new: newApps.length,
          updated: updatedApps.length,
          total: mergedData.length
        }
      });
    } else {
      console.log('ℹ️ No changes detected');
      return res.status(200).json({
        success: true,
        message: 'No changes detected',
        stats: { new: 0, updated: 0 }
      });
    }

  } catch (error) {
    console.error('💥 CRON ERROR:', error);
    return res.status(500).json({
      error: 'Cron job failed',
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
