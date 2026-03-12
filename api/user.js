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
      const { data: keys } = await supabase.from('user_keys').select('id, key_code, package_name, status, usage_count, max_usage, expires_at, created_at').eq('user_id', userId).order('created_at', { ascending: false });
      return res.json({ success: true, user, keys });
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
        const isValidUDID = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{16}$/.test(udid) || /^[0-9A-Fa-f]{40}$/.test(udid);
        if (!isValidUDID) return res.status(400).json({ error: 'Định dạng UDID không hợp lệ' });

        // A. Kiểm tra trong verifications
        const { data: verified } = await supabase.from('udid_verifications').select('*').eq('udid', udid).single();
        
        if (verified) {
            const udidTransCode = 'UDID:' + udid.toUpperCase();

            // B. Tìm xem UDID này đã từng có ai kích hoạt chưa (Để lấy hạn dùng gốc)
            const { data: firstKey } = await supabase.from('user_keys')
                .select('*')
                .eq('transaction_code', udidTransCode)
                .order('created_at', { ascending: true })
                .limit(1)
                .single();

            let expiresAt;
            if (firstKey) {
                // Đã có người kích hoạt -> Lấy đúng hạn dùng của người đầu tiên
                expiresAt = firstKey.expires_at;
            } else {
                // CHƯA AI KÍCH HOẠT -> Thiết lập 30 NGÀY từ bây giờ (Cố định cho UDID này)
                expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
            }

            // C. Kiểm tra user hiện tại đã nhận key cho UDID này chưa
            const { data: userKey } = await supabase.from('user_keys')
                .select('*')
                .eq('user_id', userId)
                .eq('transaction_code', udidTransCode)
                .single();

            if (userKey) {
                return res.json({ status: 'already_claimed', key_code: userKey.key_code, expires_at: userKey.expires_at });
            }

            // Kiểm tra nếu hạn dùng gốc đã hết
            if (new Date(expiresAt) < new Date()) {
                return res.json({ status: 'expired' });
            }

            // D. Tạo key mới cho user này (Dùng chung expiresAt cố định)
            const genKey = () => {
                const part = () => Array.from({length:4}, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random()*36)]).join('');
                return `${part()}-${part()}-${part()}-${part()}`;
            };
            const newKey = genKey();

            const { error: insErr } = await supabase.from('user_keys').insert([{ 
                key_code: newKey, 
                user_id: userId, 
                package_name: 'Gói UDID Free (1 Tháng)', 
                status: 'active', 
                usage_count: 0, 
                max_usage: 999999, 
                expires_at: expiresAt, 
                transaction_code: udidTransCode 
            }]);

            if (insErr) return res.status(500).json({ error: 'Lỗi gán mã VIP' });
            return res.json({ status: 'success', key_code: newKey, expires_at: expiresAt });
        }

        // D. Nếu chưa có trong verifications -> Kiểm tra pending
        const { data: pending } = await supabase.from('udid_pending').select('*').eq('udid', udid).single();
        if (pending) return res.json({ status: 'pending' });

        // E. Thêm mới vào pending nếu chưa có
        await supabase.from('udid_pending').insert([{ udid, user_id: userId, status: 'pending' }]);
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
