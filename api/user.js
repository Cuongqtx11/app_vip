import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const JWT_SECRET = process.env.JWT_SECRET || 'your_secret_key_senior_dev';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  
  const authHeader = req.headers['authorization'];
  let token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    const cookies = req.headers.cookie || '';
    token = cookies.split('; ').find(row => row.startsWith('auth_token='))?.split('=')[1];
  }
  
  if (!token) return res.status(401).json({ error: 'Unauthorized: No token provided' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.id;
    const { action } = req.query;

    // --- 1. PROFILE ---
    if (!action || action === 'profile') {
      const { data: user, error: userError } = await supabase.from('users').select('id, username, email, created_at').eq('id', userId).single();
      if (userError || !user) return res.status(404).json({ error: 'User not found' });
      
      const { data: keys } = await supabase.from('user_keys')
        .select('id, key_code, package_name, status, usage_count, max_usage, expires_at, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      
      // Xử lý Key Code để xóa hậu tố # (nếu có) trước khi trả về
      const cleanedKeys = (keys || []).map(k => ({
        ...k,
        key_code: k.key_code.split('#')[0]
      }));

      return res.json({ success: true, user, keys: cleanedKeys });
    }

    // --- 2. KÍCH HOẠT KEY (ADD KEY) ---
    if (action === 'add-key' && req.method === 'POST') {
      const { key_code } = req.body;
      const { data: existingKey } = await supabase.from('user_keys').select('*').eq('key_code', key_code.toUpperCase()).single();
      if (!existingKey || existingKey.user_id) return res.status(400).json({ error: 'Mã Key không hợp lệ hoặc đã được sử dụng' });
      await supabase.from('user_keys').update({ user_id: userId }).eq('id', existingKey.id);
      return res.json({ success: true, message: 'Kích hoạt Key thành công!' });
    }

    // --- 3. XÁC MINH UDID (VERIFY UDID) ---
    if (action === 'verify-udid' && req.method === 'POST') {
        const { udid } = req.body;
        const normalizedUDID = (udid || '').toUpperCase();
        const isValidUDID = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{16}$/.test(normalizedUDID) || /^[0-9A-Fa-f]{40}$/.test(normalizedUDID);
        if (!isValidUDID) return res.status(400).json({ error: 'Định dạng UDID không hợp lệ' });

        const udidTransCode = 'UDID:' + normalizedUDID;

        // A. Kiểm tra trong verifications
        const { data: verified } = await supabase.from('udid_verifications').select('*').eq('udid', normalizedUDID).single();
        
        if (verified) {
            // B. Tìm xem UDID này đã từng có Key nào được tạo chưa (Toàn hệ thống)
            const { data: firstKey } = await supabase.from('user_keys')
                .select('*')
                .eq('transaction_code', udidTransCode)
                .order('created_at', { ascending: true })
                .limit(1)
                .single();

            let finalKeyCode, finalExpiresAt, isNewForAll = false;

            if (firstKey) {
                // ĐÃ CÓ KEY CHO UDID NÀY: Dùng lại mã Key và hạn cũ
                finalKeyCode = firstKey.key_code;
                finalExpiresAt = firstKey.expires_at;
            } else {
                // CHƯA CÓ KEY: Tạo mới mã Key và hạn 30 ngày (Cố định cho UDID này)
                const genKey = () => {
                    const part = () => Array.from({length:4}, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random()*36)]).join('');
                    return `${part()}-${part()}-${part()}-${part()}`;
                };
                finalKeyCode = genKey();
                finalExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
                isNewForAll = true;
            }

            // C. Kiểm tra user hiện tại đã có bản ghi Key này chưa
            // Vì Key Code là UNIQUE trong DB, ta sẽ dùng một thủ thuật: 
            // - User đầu tiên giữ Key nguyên gốc: XXXX-XXXX
            // - User sau vẫn dùng mã đó nhưng thêm dấu cách hoặc ID user để DB không báo lỗi, 
            // - NHƯNG khi trả về JSON cho frontend, ta sẽ cắt bỏ phần hậu tố để khách thấy GIỐNG HỆT NHAU.
            
            const dbKeyCode = firstKey ? `${finalKeyCode}#${userId}` : finalKeyCode;

            const { data: userRecord } = await supabase.from('user_keys')
                .select('*')
                .eq('user_id', userId)
                .eq('transaction_code', udidTransCode)
                .single();

            if (!userRecord) {
                // Insert cho user hiện tại
                const { error: insErr } = await supabase.from('user_keys').insert([{ 
                    key_code: dbKeyCode, 
                    user_id: userId, 
                    package_name: 'Gói UDID Free (1 Tháng)', 
                    status: 'active', 
                    usage_count: 0, 
                    max_usage: 999999, 
                    expires_at: finalExpiresAt, 
                    transaction_code: udidTransCode 
                }]);
                if (insErr) {
                    console.error('Error adding key to user:', insErr.message);
                    return res.status(500).json({ error: 'Lỗi gán mã VIP' });
                }

                // D. ĐỒNG BỘ LÊN GITHUB (Chỉ khi mã Key này mới hoàn toàn)
                if (isNewForAll) {
                    try {
                        const gToken = process.env.GITHUB_TOKEN;
                        if (gToken) {
                            const url = `https://api.github.com/repos/Cuongqtx11/app_vip/contents/public/data/keys.json`;
                            const gitRes = await fetch(url, { headers: { 'Authorization': `token ${gToken}`, 'Accept': 'application/vnd.github.v3+json' }});
                            if (gitRes.ok) {
                                const file = await gitRes.json();
                                const currentKeys = JSON.parse(Buffer.from(file.content, 'base64').toString('utf-8'));
                                currentKeys.unshift({
                                    id: `udid_${Math.floor(Date.now() / 1000)}`,
                                    key: finalKeyCode,
                                    createdAt: new Date().toISOString(),
                                    expiresAt: finalExpiresAt,
                                    maxUses: null,
                                    currentUses: 0,
                                    active: true,
                                    createdBy: "udid_verify",
                                    transaction_code: udidTransCode,
                                    package: 'Gói UDID Free',
                                    notes: "Auto UDID Verify"
                                });
                                await fetch(url, {
                                    method: 'PUT',
                                    headers: { 'Authorization': `token ${gToken}`, 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        message: `Sync UDID Key: ${normalizedUDID}`,
                                        content: Buffer.from(JSON.stringify(currentKeys, null, 2)).toString('base64'),
                                        sha: file.sha
                                    })
                                });
                            }
                        }
                    } catch (gitErr) {}
                }
            }

            // Kiểm tra hạn dùng
            if (new Date(finalExpiresAt) < new Date()) {
                return res.json({ status: 'expired' });
            }

            return res.json({ status: 'success', key_code: finalKeyCode, expires_at: finalExpiresAt });
        }

        // E. Nếu chưa có trong verifications -> Kiểm tra pending
        const { data: pending } = await supabase.from('udid_pending').select('*').eq('udid', normalizedUDID).single();
        if (pending) return res.json({ status: 'pending' });

        // F. Thêm mới vào pending nếu chưa có
        await supabase.from('udid_pending').insert([{ udid: normalizedUDID, user_id: userId, status: 'pending' }]);
        return res.json({ status: 'pending' });
    }

    // --- 4. CHECK UDID POLLING ---
    if (action === 'check-udid' && req.method === 'GET') {
        const { udid } = req.query;
        if (!udid) return res.status(400).json({ error: 'Thiếu UDID' });

        const { data: verified } = await supabase.from('udid_verifications').select('*').eq('udid', udid).single();
        if (verified) return res.json({ status: 'completed' });

        const { data: pending } = await supabase.from('udid_pending').select('*').eq('udid', udid).single();
        if (!pending) return res.json({ status: 'not_found' });
        if (pending.status === 'failed') return res.json({ status: 'failed' });
        
        return res.json({ status: 'pending' });
    }

  } catch (error) {
    if (error.name === 'TokenExpiredError') return res.status(401).json({ error: 'token_expired' });
    return res.status(401).json({ error: 'Unauthorized' });
  }
}
