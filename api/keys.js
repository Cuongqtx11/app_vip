import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// Helper function for key generation
function generateRandomKey() {
  const part = () => Array.from({length:4}, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random()*36)]).join('');
  return `${part()}-${part()}-${part()}-${part()}`;
}

async function fetchGithubKeys({ GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, FILE_PATH }) {
  if (!GITHUB_TOKEN) return { keys: [], sha: null };

  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${FILE_PATH}`;
  const gitRes = await fetch(url, {
    headers: {
      'Authorization': `token ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json'
    }
  });

  if (!gitRes.ok) return { keys: [], sha: null };

  const file = await gitRes.json();
  const keys = JSON.parse(Buffer.from(file.content, 'base64').toString('utf-8'));
  return { keys: Array.isArray(keys) ? keys : [], sha: file.sha, url };
}

function getLegacyKeyState(legacyKey) {
  if (!legacyKey) return { valid: false, error: 'Mã key không tồn tại' };

  if (legacyKey.active === false) {
    return { valid: false, status: 403, error: 'Key này đã bị khóa hoặc hết hạn' };
  }

  if (legacyKey.expiresAt && new Date(legacyKey.expiresAt) < new Date()) {
    return { valid: false, status: 403, error: 'Mã key này đã hết hạn sử dụng' };
  }

  if (legacyKey.maxUses && Number(legacyKey.currentUses || 0) >= Number(legacyKey.maxUses)) {
    return { valid: false, status: 403, error: 'Mã key đã hết lượt sử dụng' };
  }

  return { valid: true };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const GITHUB_OWNER = 'Cuongqtx11';
  const GITHUB_REPO = 'app_vip';
  const FILE_PATH = 'public/data/keys.json';

  // ============================================================
  // 1. VERIFY KEY
  // ============================================================
  if (action === 'verify' && req.method === 'POST') {
    const { key } = req.body;
    const normalizedKey = String(key || '').trim().toUpperCase();

    if (!normalizedKey) return res.status(400).json({ error: 'Vui lòng nhập mã key' });

    try {
      // Ưu tiên Supabase trước
      const { data: keyData, error: keyError } = await supabase
        .from('user_keys')
        .select('*')
        .eq('key_code', normalizedKey)
        .single();

      if (!keyError && keyData) {
        if (keyData.status !== 'active') return res.status(403).json({ error: 'Key này đã bị khóa hoặc hết hạn' });
        if (keyData.expires_at && new Date(keyData.expires_at) < new Date()) {
          await supabase.from('user_keys').update({ status: 'expired' }).eq('id', keyData.id);
          return res.status(403).json({ error: 'Mã key này đã hết hạn sử dụng' });
        }
        if (keyData.max_usage && keyData.usage_count >= keyData.max_usage) {
          return res.status(403).json({ error: 'Mã key đã hết lượt sử dụng' });
        }

        const newUsageCount = (keyData.usage_count || 0) + 1;
        await supabase
          .from('user_keys')
          .update({ usage_count: newUsageCount, updated_at: new Date().toISOString() })
          .eq('id', keyData.id);

        // GitHub Sync (Silent) nếu key cũng có trong keys.json
        try {
          if (GITHUB_TOKEN) {
            const { keys, sha, url } = await fetchGithubKeys({ GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, FILE_PATH });
            let found = false;
            const currentKeys = keys.map(k => {
              if (String(k.key || '').toUpperCase() === normalizedKey) {
                k.currentUses = newUsageCount;
                k.lastUsedAt = new Date().toISOString();
                found = true;
              }
              return k;
            });

            if (found && sha && url) {
              await fetch(url, {
                method: 'PUT',
                headers: {
                  'Authorization': `token ${GITHUB_TOKEN}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  message: `Update Usage: ${normalizedKey}`,
                  content: Buffer.from(JSON.stringify(currentKeys, null, 2)).toString('base64'),
                  sha
                })
              });
            }
          }
        } catch (e) {}

        return res.status(200).json({
          success: true,
          message: 'Key hợp lệ!',
          remaining: keyData.max_usage ? (keyData.max_usage - newUsageCount) : 'unlimited',
          source: 'supabase'
        });
      }

      // Fallback sang keys.json nếu Supabase không có
      try {
        const { keys, sha, url } = await fetchGithubKeys({ GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, FILE_PATH });
        const legacyKey = keys.find(k => String(k.key || '').toUpperCase() === normalizedKey);
        const state = getLegacyKeyState(legacyKey);

        if (!state.valid) {
          return res.status(state.status || 404).json({ error: state.error });
        }

        const newUsageCount = Number(legacyKey.currentUses || 0) + 1;
        legacyKey.currentUses = newUsageCount;
        legacyKey.lastUsedAt = new Date().toISOString();

        if (sha && url) {
          await fetch(url, {
            method: 'PUT',
            headers: {
              'Authorization': `token ${GITHUB_TOKEN}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              message: `Update Legacy Usage: ${normalizedKey}`,
              content: Buffer.from(JSON.stringify(keys, null, 2)).toString('base64'),
              sha
            })
          });
        }

        const remaining = legacyKey.maxUses
          ? Math.max(0, Number(legacyKey.maxUses) - newUsageCount)
          : 'unlimited';

        return res.status(200).json({
          success: true,
          message: 'Key hợp lệ!',
          remaining,
          source: 'keys_json'
        });
      } catch (fallbackError) {
        return res.status(404).json({ error: 'Mã key không tồn tại' });
      }
    } catch (error) {
      return res.status(500).json({ error: 'Lỗi xác thực' });
    }
  }

  // ============================================================
  // 2. CREATE KEY (Telegram Bot)
  // ============================================================
  if (action === 'create' && req.method === 'POST') {
    const { telegramSecret, duration, maxUses, notes } = req.body;
    if (telegramSecret !== process.env.TELEGRAM_BOT_SECRET) return res.status(401).json({ error: 'Unauthorized' });

    try {
      const newKeyVal = generateRandomKey();
      const expiresAt = duration && duration > 0 ? new Date(Date.now() + duration * 86400000).toISOString() : null;
      const keyObj = {
        id: `key_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        key: newKeyVal,
        createdAt: new Date().toISOString(),
        expiresAt: expiresAt,
        maxUses: maxUses || null,
        currentUses: 0,
        active: true,
        createdBy: 'telegram_bot',
        notes: notes || 'Manual create'
      };

      // GitHub Sync
      const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${FILE_PATH}`;
      const gitRes = await fetch(url, { headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }});
      if (gitRes.ok) {
        const file = await gitRes.json();
        const currentKeys = JSON.parse(Buffer.from(file.content, 'base64').toString('utf-8'));
        currentKeys.unshift(keyObj);
        await fetch(url, {
          method: 'PUT',
          headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: `Create key: ${newKeyVal}`, content: Buffer.from(JSON.stringify(currentKeys, null, 2)).toString('base64'), sha: file.sha })
        });
      }

      // Supabase Sync (Optional)
      await supabase.from('user_keys').insert([{ key_code: newKeyVal, status: 'active', usage_count: 0, max_usage: maxUses || 9999, expires_at: expiresAt }]);

      return res.status(200).json({ success: true, key: newKeyVal });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  // ============================================================
  // 3. DELETE KEY (Telegram Bot)
  // ============================================================
  if (action === 'delete' && req.method === 'POST') {
    const { telegramSecret, key } = req.body;
    if (telegramSecret !== process.env.TELEGRAM_BOT_SECRET) return res.status(401).json({ error: 'Unauthorized' });

    try {
      const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${FILE_PATH}`;
      const gitRes = await fetch(url, { headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }});
      if (gitRes.ok) {
        const file = await gitRes.json();
        let keys = JSON.parse(Buffer.from(file.content, 'base64').toString('utf-8'));
        keys = keys.filter(k => k.key !== key.toUpperCase());
        await fetch(url, {
          method: 'PUT',
          headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: `Delete key: ${key}`, content: Buffer.from(JSON.stringify(keys, null, 2)).toString('base64'), sha: file.sha })
        });
      }
      await supabase.from('user_keys').delete().eq('key_code', key.toUpperCase());
      return res.status(200).json({ success: true });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  // ============================================================
  // 4. LIST KEYS (Telegram Bot)
  // ============================================================
  if (action === 'list' && req.method === 'POST') {
    const { telegramSecret } = req.body;
    if (telegramSecret !== process.env.TELEGRAM_BOT_SECRET) return res.status(401).json({ error: 'Unauthorized' });

    try {
      const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${FILE_PATH}`;
      const gitRes = await fetch(url, { headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }});
      if (!gitRes.ok) return res.status(404).json({ error: 'Not found' });
      const file = await gitRes.json();
      const keys = JSON.parse(Buffer.from(file.content, 'base64').toString('utf-8'));
      return res.status(200).json({ success: true, keys });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  return res.status(400).json({ error: 'Action không hợp lệ' });
}
