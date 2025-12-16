// api/sync-ipa.js - V4.0: REAL APPSTORE CATEGORY + LOWERCASE TAGS

export default async function handler(req, res) {
  // 1. Cấu hình CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Cookie, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const startTime = Date.now();
  console.log('🔄 Sync V4 (AppStore) called:', new Date().toISOString());

  try {
    const { syncHours, botSync } = req.body || {};

    // 🔐 2. AUTH CHECK
    const cookie = req.headers.cookie || '';
    const authHeader = req.headers.authorization || '';
    const hasAuthCookie = 
      cookie.includes('admin_token') || 
      cookie.includes('auth') || 
      authHeader.includes(process.env.ADMIN_SECRET) || 
      botSync === true;
    
    if (!hasAuthCookie) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // 🔒 3. CONFIG
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const GITHUB_OWNER = process.env.GITHUB_OWNER || 'Cuongqtx11';
    const GITHUB_REPO = process.env.GITHUB_REPO || 'app_vip';
    const APPTESTER_URL = process.env.APPTESTER_URL;
    const FILE_PATH = 'public/data/ipa.json';
    const NOTIFY_WEBHOOK = process.env.NOTIFY_WEBHOOK;

    if (!GITHUB_TOKEN || !APPTESTER_URL) {
      return res.status(500).json({ error: 'Missing Env Vars' });
    }

    // 📦 4. FETCH DATA NGUỒN
    const sourceRes = await fetch(APPTESTER_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!sourceRes.ok) throw new Error(`Source API error: ${sourceRes.status}`);
    const sourceJson = await sourceRes.json();
    const sourceApps = sourceJson.apps || [];

    // 🕵️ 5. FILTER DATA
    let processedApps = sourceApps;
    let filterLabel = 'All Time';

    if (syncHours > 0) {
      const cutoff = new Date(Date.now() - syncHours * 3600 * 1000);
      processedApps = sourceApps.filter(app => {
        try { return new Date(app.versionDate) >= cutoff; } catch { return false; }
      });
      filterLabel = `Last ${syncHours}h`;
    } else {
      const today = new Date().toISOString().split('T')[0];
      processedApps = sourceApps.filter(app => app.versionDate && app.versionDate.startsWith(today));
      filterLabel = 'Today';
    }

    // 📄 6. FETCH GITHUB DATA
    const ghUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${FILE_PATH}`;
    const ghRes = await fetch(ghUrl, {
      headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }
    });

    let currentData = [];
    let sha = null;
    if (ghRes.ok) {
      const fileData = await ghRes.json();
      sha = fileData.sha;
      currentData = JSON.parse(Buffer.from(fileData.content, 'base64').toString('utf-8'));
    }

    // 🛠️ 7. MERGE LOGIC WITH ASYNC TAGGING
    const manualApps = currentData.filter(app => app.source === 'manual');
    const autoApps = currentData.filter(app => app.source !== 'manual');
    const existingMap = new Map();
    autoApps.forEach(app => existingMap.set(`${app.bundleID}|${app.version}`, app));

    const newAddedApps = [];

    // ⚠️ Dùng vòng lặp for...of để có thể dùng await (Gọi iTunes API)
    for (const srcApp of processedApps) {
      if (!srcApp.name || !srcApp.downloadURL) continue;

      const bundleID = srcApp.bundleID || srcApp.name.replace(/\s+/g, '').toLowerCase();
      const version = srcApp.version || '1.0';
      const key = `${bundleID}|${version}`;

      if (!existingMap.has(key)) {
        // Chỉ gọi iTunes API cho App MỚI (để tránh chậm server)
        const realTag = await getRealAppStoreCategory(srcApp.name, bundleID, srcApp.localizedDescription);
        
        const newAppObj = {
          id: `ipa-${bundleID}-${version}`.replace(/[^a-zA-Z0-9\-\.]/g, '-'),
          type: 'ipa',
          name: srcApp.name,
          icon: srcApp.iconURL || srcApp.icon,
          desc: srcApp.localizedDescription || 'Injected with Premium',
          tags: [realTag], // ✅ Đảm bảo luôn là array chứa string thường: ['game']
          badge: smartDetectBadge(srcApp),
          fileLink: srcApp.downloadURL || srcApp.down,
          version: version,
          developer: srcApp.developerName || 'khomodvip',
          date: srcApp.versionDate || new Date().toISOString().split('T')[0],
          source: 'apptesters',
          bundleID: bundleID,
          lastSync: new Date().toISOString()
        };

        newAddedApps.push(newAppObj);
        existingMap.set(key, newAppObj);
        
        // Delay nhẹ để tránh bị Apple chặn nếu loop quá nhanh
        await new Promise(r => setTimeout(r, 100)); 
      }
    }

    const mergedAutoApps = Array.from(existingMap.values());
    mergedAutoApps.sort((a, b) => new Date(b.lastSync) - new Date(a.lastSync));

    const finalData = [...mergedAutoApps, ...manualApps];

    // 📤 8. UPLOAD
    if (newAddedApps.length > 0) {
      const contentBase64 = Buffer.from(JSON.stringify(finalData, null, 2)).toString('base64');
      await fetch(ghUrl, {
        method: 'PUT',
        headers: {
          'Authorization': `token ${GITHUB_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: `Sync V4: +${newAddedApps.length} apps (Correct Tags)`,
          content: contentBase64,
          sha: sha,
          branch: 'main'
        })
      });

      if (NOTIFY_WEBHOOK) await sendNotification(NOTIFY_WEBHOOK, newAddedApps);

      return res.status(200).json({
        success: true,
        message: `Đã thêm ${newAddedApps.length} app mới với Tag chuẩn AppStore.`,
        newApps: newAddedApps.map(a => `${a.name} [${a.tags[0]}]`)
      });
    } else {
      return res.status(200).json({ success: true, message: 'Không có app mới.' });
    }

  } catch (error) {
    console.error('💥 Sync Error:', error);
    return res.status(500).json({ error: error.message });
  }
}

// ==================== 🍎 APP STORE LOOKUP LOGIC ====================

async function getRealAppStoreCategory(name, bundleId, desc) {
  try {
    let genre = null;
    
    // Cách 1: Tìm bằng Bundle ID (Chính xác nhất)
    if (bundleId && bundleId.includes('.')) {
      const res = await fetch(`https://itunes.apple.com/lookup?bundleId=${bundleId}`);
      const data = await res.json();
      if (data.resultCount > 0) {
        genre = data.results[0].primaryGenreName;
      }
    }

    // Cách 2: Tìm bằng Tên (Nếu bundle id là fake/custom)
    if (!genre) {
      const cleanName = name.replace(/[\(\[\{].*?[\)\]\}]/g, '').trim(); // Xóa (Hack), [Mod]...
      const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(cleanName)}&entity=software&limit=1`);
      const data = await res.json();
      if (data.resultCount > 0) {
        genre = data.results[0].primaryGenreName;
      }
    }

    // Mapping từ Apple Genre sang Tag hệ thống (Lowercase 100%)
    if (genre) return mapAppleGenreToTag(genre);

  } catch (e) {
    console.log(`⚠️ iTunes Lookup Failed for ${name}:`, e.message);
  }

  // Cách 3: Fallback nếu không tìm thấy trên Store (App lậu/Banned)
  return fallbackKeywordTag(name, desc);
}

function mapAppleGenreToTag(genre) {
  const g = genre.toLowerCase();
  
  // Nhóm GAME
  if (['games', 'action', 'adventure', 'board', 'card', 'casino', 'puzzle', 'racing', 'role playing', 'simulation', 'strategy', 'trivia', 'word'].some(k => g.includes(k))) {
    return 'game';
  }
  
  // Nhóm PHOTO/VIDEO
  if (g.includes('photo') || g.includes('video') || g.includes('camera')) return 'photo';
  
  // Nhóm SOCIAL
  if (g.includes('social') || g.includes('networking')) return 'social';
  
  // Nhóm MUSIC
  if (g.includes('music')) return 'music';
  
  // Nhóm UTILITY/PRODUCTIVITY
  if (g.includes('utilities') || g.includes('productivity') || g.includes('business') || g.includes('finance') || g.includes('education') || g.includes('reference')) return 'utility';

  if (g.includes('entertainment')) return 'entertainment';
  
  return 'utility'; // Mặc định nếu lạ
}

function fallbackKeywordTag(name, desc) {
  const text = `${name} ${desc}`.toLowerCase();
  if (text.includes('game') || text.includes('pubg') || text.includes('roblox') || text.includes('rpg')) return 'game';
  if (text.includes('editor') || text.includes('cut') || text.includes('photo')) return 'photo';
  if (text.includes('social') || text.includes('facebook') || text.includes('tiktok')) return 'social';
  if (text.includes('music') || text.includes('spotify')) return 'music';
  return 'utility';
}

function smartDetectBadge(app) {
  const text = (app.localizedDescription || '').toLowerCase();
  const today = new Date().toISOString().split('T')[0];
  
  if (app.versionDate && app.versionDate.startsWith(today)) return 'new';
  if (text.includes('premium') || text.includes('pro') || text.includes('vip')) return 'vip';
  return 'updated';
}

async function sendNotification(webhookUrl, apps) {
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: `✅ Sync V4: Added ${apps.length} apps` })
    });
  } catch {}
}
