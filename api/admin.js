import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Cookie');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Cho phép cả GET và POST cho action=sync (bot có thể dùng cả 2)
  const { action } = req.query;

  // ============================================================
  // 1. SYNC IPA (Logic cũ cực mạnh đã khôi phục)
  // ============================================================
  if (action === 'sync') {
    try {
        const body = req.body || {};
        const botSync = body.botSync === true || req.query.botSync === 'true';
        const cookie = req.headers.cookie || '';
        if (!cookie.includes('admin_token') && !botSync) return res.status(401).json({ error: 'Unauthorized' });

        const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
        const GITHUB_OWNER = 'Cuongqtx11';
        const GITHUB_REPO = 'app_vip';
        const APPTESTER_URL = process.env.APPTESTER_URL;
        const FILE_PATH = 'public/data/ipa.json';

        if (!APPTESTER_URL) return res.status(500).json({ error: 'Thiếu biến môi trường APPTESTER_URL' });
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'Thiếu biến môi trường GITHUB_TOKEN' });

        const sourceRes = await fetch(APPTESTER_URL);
        const sourceData = await sourceRes.json();
        const allAppTestersData = sourceData.apps || [];

        // Fetch current data from GitHub (Large File Strategy)
        const getRawUrl = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/main/${FILE_PATH}`;
        const getDirUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/public/data`;
        
        let currentData = [];
        let sha = null;

        const [dirResponse, contentResponse] = await Promise.all([
            fetch(getDirUrl, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` }}),
            fetch(getRawUrl)
        ]);

        if (dirResponse.ok) {
            const dirFiles = await dirResponse.json();
            sha = dirFiles.find(f => f.name === 'ipa.json')?.sha;
        }
        if (contentResponse.ok) {
            currentData = await contentResponse.json();
        }

        const existingAutoApps = currentData.filter(app => app.source === 'apptesters');
        const manualApps = currentData.filter(app => app.source === 'manual');
        const otherApps = currentData.filter(app => app.source !== 'manual' && app.source !== 'apptesters');

        const newApps = [];
        allAppTestersData.forEach(app => {
            const converted = {
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
            if (!existingAutoApps.find(e => e.name === converted.name && e.bundleID === converted.bundleID && e.version === converted.version)) {
                newApps.push(converted);
            }
        });

        if (newApps.length > 0) {
            const mergedData = [...newApps, ...existingAutoApps, ...manualApps, ...otherApps];
            const updateUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${FILE_PATH}`;
            await fetch(updateUrl, {
                method: 'PUT',
                headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: `Sync: +${newApps.length} new (Auto Tag V3 Pro)`, content: Buffer.from(JSON.stringify(mergedData, null, 2)).toString('base64'), sha })
            });
        }
        return res.status(200).json({ success: true, count: newApps.length, stats: { new: newApps.length, total: currentData.length + newApps.length } });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  // ============================================================
  // 2. UPLOAD / UPDATE FILE (Cập nhật database json)
  // ============================================================
  if (action === 'upload' && req.method === 'POST') {
    try {
        const { path: FILE_PATH, content: NEW_CONTENT } = req.body;
        const cookie = req.headers.cookie || '';
        if (!cookie.includes('admin_token')) return res.status(401).json({ error: 'Unauthorized' });

        const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
        const GITHUB_OWNER = 'Cuongqtx11';
        const GITHUB_REPO = 'app_vip';

        const getUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${FILE_PATH}`;
        const getRes = await fetch(getUrl, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` }});
        let sha = null;
        if (getRes.ok) {
            const fileData = await getRes.json();
            sha = fileData.sha;
        }

        await fetch(getUrl, {
            method: 'PUT',
            headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: `Admin update: ${FILE_PATH}`, content: Buffer.from(JSON.stringify(NEW_CONTENT, null, 2)).toString('base64'), sha })
        });

        return res.status(200).json({ success: true });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  return res.status(400).json({ error: 'Action không hợp lệ' });
}

// Helper: Tag Detection (Logic V3 Pro)
function smartDetectTags(app) {
  const combined = `${app.name} ${app.bundleID} ${app.localizedDescription}`.toLowerCase();
  if (combined.includes('game') || combined.includes('play')) return ['game'];
  if (combined.includes('social') || combined.includes('chat') || combined.includes('messenger')) return ['social'];
  if (combined.includes('photo') || combined.includes('video') || combined.includes('editor')) return ['photo & video'];
  if (combined.includes('music') || combined.includes('audio')) return ['music'];
  return ['utilities'];
}

function smartDetectBadge(app) {
  const name = (app.name || '').toLowerCase();
  if (name.includes('premium') || name.includes('pro') || name.includes('vip') || name.includes('mod')) return 'vip';
  if (Math.random() > 0.9) return 'trending';
  return null;
}
