// api/sync-ipa.js - Sync thông minh chỉ IPA ngày hiện tại

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { forceFullSync } = req.body; // Cho phép sync toàn bộ khi cần

    // 🔐 AUTH CHECK (Bypass cho cron job)
    const isCronJob = req.headers.cookie && req.headers.cookie.includes('admin_token=cron_job_authorized');
    const hasAuthCookie = req.headers.cookie && (
      req.headers.cookie.includes('admin_token') || 
      req.headers.cookie.includes('auth')
    );
    
    if (!hasAuthCookie && !isCronJob) {
      return res.status(401).json({ 
        error: 'Unauthorized',
        code: 'NO_AUTH_COOKIE'
      });
    }

    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const GITHUB_OWNER = process.env.GITHUB_OWNER || 'Cuongqtx11';
    const GITHUB_REPO = process.env.GITHUB_REPO || 'app_vip';
    const FILE_PATH = 'public/data/ipa.json';
    const APPTESTER_URL = 'https://repository.apptesters.org/';

    if (!GITHUB_TOKEN) {
      return res.status(500).json({ error: 'GitHub token not configured' });
    }

    console.log('🔄 Starting smart sync...');

    // 1️⃣ Fetch toàn bộ dữ liệu từ AppTesters
    const appTestersResponse = await fetch(APPTESTER_URL);
    if (!appTestersResponse.ok) {
      throw new Error('Failed to fetch AppTesters data');
    }
    
    const allAppTestersData = await appTestersResponse.json();
    console.log(`📦 Total apps from AppTesters: ${allAppTestersData.length}`);

    // 🎯 LỌC CHỈ LẤY IPA NGÀY HÔM NAY (trừ khi forceFullSync)
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    let filteredApps = allAppTestersData;
    
    if (!forceFullSync) {
      filteredApps = allAppTestersData.filter(app => {
        return app.versionDate && app.versionDate.startsWith(today);
      });
      console.log(`📅 Apps released today (${today}): ${filteredApps.length}`);
    } else {
      console.log('⚠️ FORCE FULL SYNC MODE - Processing all apps');
    }

    // 2️⃣ Lấy dữ liệu hiện tại từ GitHub
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
      console.log(`📄 Current data: ${currentData.length} apps`);
    }

    // 3️⃣ Phân loại: Manual apps (giữ nguyên 100%)
    const manualApps = currentData.filter(app => app.source === 'manual');
    const existingAutoApps = currentData.filter(app => app.source === 'apptesters');
    
    console.log(`✋ Manual apps (keep): ${manualApps.length}`);
    console.log(`🤖 Existing auto apps: ${existingAutoApps.length}`);

    // 4️⃣ Convert & Merge thông minh
    const newAutoApps = [];
    const updatedApps = [];
    const skippedApps = [];

    filteredApps.forEach(app => {
      const convertedApp = {
        id: `ipa-${app.bundleID}`,
        type: 'ipa',
        name: app.name,
        icon: app.iconURL || app.icon,
        desc: app.localizedDescription || 'Injected with Premium',
        tags: autoDetectTags(app.name, app.localizedDescription),
        badge: isRecent(app.versionDate) ? 'new' : null,
        fileLink: app.downloadURL || app.down,
        version: app.version,
        developer: app.developerName || 'AppTesters',
        date: app.versionDate,
        source: 'apptesters',
        bundleID: app.bundleID,
        lastSync: new Date().toISOString()
      };

      // 🔍 Kiểm tra trùng lặp: Tên + Version
      const existingApp = existingAutoApps.find(existing => 
        existing.name === convertedApp.name
      );

      if (existingApp) {
        // Nếu version khác → cập nhật
        if (existingApp.version !== convertedApp.version) {
          updatedApps.push(convertedApp);
          console.log(`🔄 Update: ${app.name} (${existingApp.version} → ${convertedApp.version})`);
        } else {
          // Version giống → giữ nguyên
          skippedApps.push(existingApp);
        }
      } else {
        // App mới hoàn toàn
        newAutoApps.push(convertedApp);
        console.log(`✨ New: ${app.name} v${convertedApp.version}`);
      }
    });

    // 5️⃣ Gộp dữ liệu cuối cùng
    const finalAutoApps = [
      ...skippedApps,   // Apps cũ không thay đổi
      ...updatedApps,   // Apps được cập nhật version mới
      ...newAutoApps    // Apps hoàn toàn mới
    ];

    const mergedData = [
      ...manualApps,      // Manual apps luôn ở đầu
      ...finalAutoApps    // Auto apps
    ];

    console.log(`
📊 SYNC SUMMARY:
  - Manual (kept): ${manualApps.length}
  - New apps: ${newAutoApps.length}
  - Updated: ${updatedApps.length}
  - Skipped (unchanged): ${skippedApps.length}
  - Total: ${mergedData.length}
    `);

    // 6️⃣ Upload lên GitHub
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
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(updatePayload)
    });

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      console.error('❌ GitHub upload error:', errorText);
      return res.status(500).json({ 
        error: 'Failed to update GitHub', 
        details: errorText 
      });
    }

    console.log('✅ Auto-sync completed!');
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
    console.error('💥 Sync error:', error);
    return res.status(500).json({ 
      error: 'Internal server error', 
      details: error.message 
    });
  }
}

// 🏷️ Helper: Tự động phát hiện tags
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

// 🆕 Helper: Kiểm tra app mới (7 ngày)
function isRecent(versionDate) {
  if (!versionDate) return false;
  
  const appDate = new Date(versionDate);
  const now = new Date();
  const diffTime = Math.abs(now - appDate);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  return diffDays <= 7;
}
