// api/sync-ipa.js - PHIÊN BẢN FINAL: BẢO MẬT + AUTO TAG V3 + FIX LARGE FILE
import crypto from 'crypto';

export default async function handler(req, res) {
  // 1. Cấu hình CORS (Cho phép truy cập từ mọi nguồn)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Cookie');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { syncHours, botSync, telegramSecret } = req.body || {};

    // ==================================================================
    // 🔐 BẢO MẬT: CHẶN HACKER & NGƯỜI LẠ
    // ==================================================================
    let isAuthenticated = false;

    // Cửa 1: Dành cho Bot (Telegram/Cronjob)
    if (botSync === true) {
        // Bắt buộc phải có secret key đúng
        if (telegramSecret && telegramSecret === process.env.TELEGRAM_BOT_SECRET) {
            isAuthenticated = true;
        }
    } 
    // Cửa 2: Dành cho Admin (Trình duyệt)
    else {
        const secret = process.env.ADMIN_SECRET || 'secret-mac-dinh';
        // Tạo lại token chuẩn để so sánh
        const validToken = crypto.createHmac('sha256', secret).update('admin-session').digest('hex');
        const cookies = req.headers.cookie || '';
        
        // So sánh token trong cookie
        if (cookies.includes(`admin_token=${validToken}`)) {
            isAuthenticated = true;
        }
    }

    if (!isAuthenticated) {
        return res.status(401).json({ 
            error: 'Unauthorized', 
            message: 'Truy cập bị từ chối. Vui lòng đăng nhập Admin hoặc cung cấp Secret Key.' 
        });
    }

    // ==================================================================
    // 📦 LOGIC ĐỒNG BỘ DỮ LIỆU
    // ==================================================================
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const GITHUB_OWNER = process.env.GITHUB_OWNER || 'Cuongqtx11';
    const GITHUB_REPO = process.env.GITHUB_REPO || 'app_vip';
    const APPTESTER_URL = process.env.APPTESTER_URL;
    const FILE_PATH = 'public/data/ipa.json';

    if (!GITHUB_TOKEN) return res.status(500).json({ error: 'Chưa cấu hình GITHUB_TOKEN' });
    if (!APPTESTER_URL) return res.status(500).json({ error: 'Chưa cấu hình APPTESTER_URL' });

    // 1. Lấy dữ liệu nguồn (AppTesters)
    const response = await fetch(APPTESTER_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!response.ok) throw new Error('Không lấy được dữ liệu nguồn');
    const jsonData = await response.json();
    const allAppTestersData = jsonData.apps || [];

    // 2. Lọc theo thời gian
    let filteredApps = allAppTestersData;
    if (syncHours > 0) {
      const cutoffTime = new Date(Date.now() - syncHours * 60 * 60 * 1000);
      filteredApps = allAppTestersData.filter(app => {
        try { return new Date(app.versionDate) >= cutoffTime; } catch { return false; }
      });
    } else {
      // Mặc định: Lấy app của ngày hôm nay
      const today = new Date().toISOString().split('T')[0];
      filteredApps = allAppTestersData.filter(app => app.versionDate && app.versionDate.startsWith(today));
    }

    // 3. Lấy dữ liệu hiện tại từ GitHub (Chế độ Large File)
    // Dùng RAW URL để tránh lỗi giới hạn dung lượng API
    const getDirUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/public/data`;
    const getRawUrl = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/main/${FILE_PATH}`;
    
    let currentData = [];
    let sha = null;

    try {
      const [dirRes, rawRes] = await Promise.all([
        fetch(getDirUrl, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } }),
        fetch(getRawUrl, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } })
      ]);

      // Lấy SHA để update file
      if (dirRes.ok) {
        const files = await dirRes.json();
        const f = Array.isArray(files) ? files.find(x => x.name === 'ipa.json') : null;
        if (f) sha = f.sha;
      }
      // Lấy nội dung file
      if (rawRes.ok) {
        const txt = await rawRes.text();
        try { currentData = JSON.parse(txt); } catch {}
      }
    } catch (e) { console.error('GitHub Fetch Error:', e); }

    // 4. Xử lý & Gộp dữ liệu
    const manualApps = currentData.filter(app => app.source === 'manual');
    const autoApps = currentData.filter(app => app.source === 'apptesters');
    const otherApps = currentData.filter(app => !['manual', 'apptesters'].includes(app.source));
    
    const newApps = [];
    
    filteredApps.forEach(app => {
      try {
        const converted = {
          id: `ipa-${app.bundleID || app.name.replace(/\s+/g, '-').toLowerCase()}-${app.version}`,
          type: 'ipa',
          name: app.name,
          icon: app.iconURL || app.icon,
          desc: app.localizedDescription || 'Premium',
          tags: smartDetectTags(app), // Hàm tự động gắn thẻ
          badge: smartDetectBadge(app), // Hàm tự động gắn badge New/Vip
          fileLink: app.downloadURL || app.down,
          version: app.version,
          developer: app.developerName || 'khomodvip',
          date: app.versionDate,
          source: 'apptesters',
          bundleID: app.bundleID,
          lastSync: new Date().toISOString()
        };

        // Kiểm tra trùng: Nếu App + Version này chưa có thì mới thêm
        const exists = autoApps.find(e => 
          e.name === converted.name && 
          e.bundleID === converted.bundleID && 
          e.version === converted.version
        );

        if (!exists) newApps.push(converted);
      } catch {}
    });

    // Gộp tất cả lại (Giữ cả phiên bản cũ)
    const allAuto = [...autoApps, ...newApps];
    
    // Xóa trùng lặp tuyệt đối (nếu có lỗi hệ thống)
    const uniqueAuto = [];
    const seen = new Set();
    allAuto.forEach(a => {
      const k = `${a.name}|${a.bundleID}|${a.version}`;
      if (!seen.has(k)) { seen.add(k); uniqueAuto.push(a); }
    });

    // Sắp xếp: Mới nhất lên đầu
    uniqueAuto.sort((a,b) => new Date(b.date||0) - new Date(a.date||0));
    manualApps.sort((a,b) => new Date(b.date||0) - new Date(a.date||0));

    const finalData = [...uniqueAuto, ...manualApps, ...otherApps];

    // 5. Upload lên GitHub
    if (newApps.length > 0) {
      const content = Buffer.from(JSON.stringify(finalData, null, 2)).toString('base64');
      const upRes = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${FILE_PATH}`, {
        method: 'PUT',
        headers: {
          'Authorization': `token ${GITHUB_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: `Sync: +${newApps.length} apps`,
          content: content,
          sha: sha,
          branch: 'main'
        })
      });
      if (!upRes.ok) throw new Error('Upload lên GitHub thất bại');
      return res.json({ success: true, count: newApps.length, message: `Đã thêm ${newApps.length} app mới.` });
    }

    return res.json({ success: true, count: 0, message: 'Không có app mới.' });

  } catch (error) {
    return res.status(500).json({ error: 'Server Error', details: error.message });
  }
}

// --- HELPER FUNCTIONS (Đừng xóa phần này) ---

function smartDetectTags(app) {
  const txt = ((app.name||'') + (app.bundleID||'') + (app.localizedDescription||'')).toLowerCase();
  
  // Logic nhận diện Tag thông minh V3
  if (['game','play','shooter','pubg','roblox','survival','moba','lien quan'].some(k => txt.includes(k))) return ['game'];
  if (['social','facebook','tiktok','chat','messenger'].some(k => txt.includes(k))) return ['social'];
  if (['photo','video','edit','capcut','picsart'].some(k => txt.includes(k))) return ['photo & video'];
  if (['music','spotify','audio','mp3'].some(k => txt.includes(k))) return ['music'];
  if (['vpn','tool','util','proxy'].some(k => txt.includes(k))) return ['utilities'];
  
  return ['utilities']; // Mặc định
}

function smartDetectBadge(app) {
  // Logic nhận diện Badge (New/Vip)
  if (app.versionDate) {
    const d = (new Date() - new Date(app.versionDate)) / 86400000; // Tính số ngày
    if (d <= 7) return 'new';
  }
  const txt = ((app.name||'') + (app.localizedDescription||'')).toLowerCase();
  if (txt.includes('mod') || txt.includes('hack') || txt.includes('premium') || txt.includes('vip')) return 'vip';
  
  return null;
}
