import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const JWT_SECRET = process.env.JWT_SECRET || 'your_secret_key_senior_dev';

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    const { action } = req.query;

    // ============================================================
    // 1. CREATE PAYMENT (Tạo đơn hàng PayOS)
    // ============================================================
    if (action === 'create' && req.method === 'POST') {
        try {
            const { amount, packageName } = req.body;
            if (!amount) return res.status(400).json({ error: 'Thiếu số tiền' });

            const cookies = req.headers.cookie || '';
            const token = cookies.split('; ').find(row => row.startsWith('auth_token='))?.split('=')[1];
            let userId = null;
            let username = 'Anonymous';
            if (token) {
                try {
                    const decoded = jwt.verify(token, JWT_SECRET);
                    userId = decoded.id;
                    username = decoded.username;
                } catch (e) {}
            }

            // Chuẩn hóa orderCode: 9 số cuối timestamp + 5 số ngẫu nhiên = 14 chữ số (An toàn cho mọi Bank)
            const orderCode = Number(Date.now().toString().slice(-9) + Math.floor(10000 + Math.random() * 90000).toString());
            
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
            let codePart = '';
            for (let i = 0; i < 6; i++) { codePart += chars.charAt(Math.floor(Math.random() * chars.length)); }
            const transferCode = `MA${codePart}`; // Thêm tiền tố MA để tránh bị bộ lọc bank chặn

            const host = `https://${req.headers.host}`;
            const body = {
                orderCode: orderCode,
                amount: parseInt(amount),
                description: transferCode,
                returnUrl: host + '/#profile',
                cancelUrl: host
            };

            const signData = `amount=${body.amount}&cancelUrl=${body.cancelUrl}&description=${body.description}&orderCode=${body.orderCode}&returnUrl=${body.returnUrl}`;
            body.signature = crypto.createHmac('sha256', process.env.PAYOS_CHECKSUM_KEY).update(signData).digest('hex');

            const resp = await fetch('https://api-merchant.payos.vn/v2/payment-requests', {
                method: 'POST',
                headers: {
                    'x-client-id': process.env.PAYOS_CLIENT_ID,
                    'x-api-key': process.env.PAYOS_API_KEY,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });

            const data = await resp.json();

            if (data.code === '00') {
                await supabase.from('orders').insert([{
                    order_code: String(orderCode),
                    transaction_code: transferCode,
                    user_id: userId,
                    username: username,
                    package_name: packageName || 'Gói VIP',
                    amount: parseInt(amount),
                    status: 'pending'
                }]);

                return res.status(200).json({ 
                    success: true,
                    checkoutUrl: data.data.checkoutUrl,
                    qrCode: data.data.qrCode,
                    orderCode: orderCode,
                    transferCode: transferCode
                });
            } else {
                return res.status(400).json({ success: false, error: data.desc });
            }
        } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
    }

    // ============================================================
    // 2. CHECK ORDER (Polling trạng thái đơn hàng)
    // ============================================================
    if (action === 'check' && req.method === 'GET') {
        const { code } = req.query;
        if (!code) return res.status(400).json({ error: 'Thiếu mã đơn hàng' });

        try {
            const { data: order, error: orderError } = await supabase.from('orders').select('*').eq('order_code', String(code)).single();
            if (orderError || !order) return res.status(404).json({ status: 'not_found' });

            if (order.status !== 'completed') {
                return res.status(200).json({ status: 'pending', transfer_code: order.transaction_code });
            }

            const { data: keyData } = await supabase.from('user_keys').select('*').eq('transaction_code', order.transaction_code).single();

            return res.status(200).json({
                status: 'completed',
                key_code: keyData ? keyData.key_code : 'Đang khởi tạo...',
                package_name: order.package_name,
                expires_at: keyData ? keyData.expires_at : null,
                transfer_code: order.transaction_code
            });
        } catch (error) { return res.status(500).json({ status: 'error' }); }
    }

    // ============================================================
    // 3. WEBHOOK (Nhận thông báo từ PayOS)
    // ============================================================
    if (action === 'webhook' && req.method === 'POST') {
        console.log('--- [WEBHOOK START] ---');
        console.log('[Webhook] Full Body:', JSON.stringify(req.body));
        
        try {
            const webhookData = req.body.data || req.body;
            const orderCode = String(webhookData.orderCode || req.body.orderCode);
            const amount = webhookData.amount || req.body.amount;

            console.log(`[Webhook] Processing Order: ${orderCode}, Amount: ${amount}`);
            
            if (!orderCode || orderCode === 'undefined') {
                console.log('[Webhook] Invalid OrderCode, skipping.');
                return res.status(200).json({ success: true });
            }

            // Tìm đơn hàng pending
            const { data: orderData, error: orderError } = await supabase.from('orders').select('*').eq('order_code', orderCode).eq('status', 'pending').single();

            if (orderError || !orderData) {
                console.log(`[Webhook] Order not found or not pending: ${orderCode}`);
                return res.status(200).json({ success: true });
            }

            console.log(`[Webhook] Found Order in DB: ${orderData.package_name} for User: ${orderData.user_id}`);

            const userId = orderData.user_id;
            const transferCode = orderData.transaction_code;
            let pkg = orderData.package_name || 'Gói VIP';

            // Logic tính ngày và lượt tải
            let days = 0, maxUses = 9999;
            if (pkg.includes('Năm')) days = 365;
            else if (pkg.includes('Tháng')) days = 30;
            else if (pkg.includes('Tuần')) days = 7;
            else if (pkg.includes('6 Tháng')) days = 180;
            else if (pkg.includes('Vĩnh Viễn')) days = 0;
            
            // Ưu tiên ghi đè theo số tiền thực tế (đề phòng khách chuyển sai gói)
            if (amount >= 5000 && amount < 19000) { pkg='Gói 5K (20 Lượt)'; days=0; maxUses=20; }
            else if (amount >= 2000 && amount < 5000) { pkg='Gói 2K (10 Lượt)'; days=7; maxUses=10; }
            else if (amount >= 19000 && amount < 39000) { pkg='Gói Tuần'; days=7; maxUses=9999; }
            else if (amount >= 39000 && amount < 199000) { pkg='Gói Tháng'; days=30; maxUses=9999; }
            else if (amount >= 199000) { pkg='Gói Năm'; days=365; maxUses=9999; }

            const genKey = () => {
                const part = () => Array.from({length:4}, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random()*36)]).join('');
                return `${part()}-${part()}-${part()}-${part()}`;
            };
            const newKey = genKey();
            const expiresAt = days > 0 ? new Date(Date.now() + days*86400000).toISOString() : null;

            console.log(`[Webhook] Generating Key: ${newKey}, Expiry: ${expiresAt}`);

            // Insert Key
            const { error: insertError } = await supabase.from('user_keys').insert([{
                key_code: newKey,
                user_id: userId,
                transaction_code: transferCode,
                status: 'active',
                usage_count: 0,
                max_usage: maxUses,
                expires_at: expiresAt,
                package_name: pkg,
                updated_at: new Date().toISOString()
            }]);

            if (insertError) {
                console.error('[Webhook] Error inserting key:', insertError.message);
                return res.status(200).json({ success: true });
            }

            // Update Order
            const { error: updateError } = await supabase.from('orders').update({ status: 'completed' }).eq('id', orderData.id);
            if (updateError) {
                console.error('[Webhook] Error updating order status:', updateError.message);
            }

            console.log(`[Webhook] SUCCESS: Order ${orderCode} completed.`);
            
            // GitHub Sync (Silent)
            try {
                const gToken = process.env.GITHUB_TOKEN;
                if (gToken) {
                    console.log('[Webhook] Syncing to GitHub...');
                    const url = `https://api.github.com/repos/Cuongqtx11/app_vip/contents/public/data/keys.json`;
                    const gitRes = await fetch(url, { headers: { 'Authorization': `token ${gToken}`, 'Accept': 'application/vnd.github.v3+json' }});
                    if (gitRes.ok) {
                        const file = await gitRes.json();
                        const currentKeys = JSON.parse(Buffer.from(file.content, 'base64').toString('utf-8'));
                        currentKeys.unshift({
                            id: `key_${Math.floor(Date.now() / 1000)}`,
                            key: newKey,
                            createdAt: new Date().toISOString(),
                            expiresAt: expiresAt,
                            maxUses: maxUses >= 9000 ? null : maxUses,
                            currentUses: 0,
                            active: true,
                            createdBy: "payos_webhook",
                            transaction_code: transferCode,
                            package: pkg,
                            notes: "Auto PayOS"
                        });
                        await fetch(url, {
                            method: 'PUT',
                            headers: { 'Authorization': `token ${gToken}`, 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                message: `Auto-Sync Key: ${transferCode}`,
                                content: Buffer.from(JSON.stringify(currentKeys, null, 2)).toString('base64'),
                                sha: file.sha
                            })
                        });
                        console.log('[Webhook] GitHub Sync Done.');
                    }
                }
            } catch (gitErr) { console.error('[Webhook] GitHub Sync Error:', gitErr.message); }

            return res.status(200).json({ success: true });
        } catch(e) { 
            console.error('[Webhook] Critical Error:', e.message);
            return res.status(200).json({ success: true }); 
        }
    }

    // ============================================================
    // 4. BUY VPN (Check VPN status)
    // ============================================================
    if (action === 'buy' && req.method === 'POST') {
        const { content } = req.body;
        if (!content) return res.status(400).json({ error: 'Thiếu mã' });
        try {
            const url = `https://api.github.com/repos/cuongqtx11/app_vip/contents/database/vpn_data.json`;
            const gitRes = await fetch(url, { headers: { 'Authorization': `token ${process.env.GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }});
            if (!gitRes.ok) return res.status(200).json({ status: 'pending' });
            const gitData = await gitRes.json();
            const vpnList = JSON.parse(Buffer.from(gitData.content, 'base64').toString('utf-8'));
            const found = vpnList.find(k => k.owner_content === content.toUpperCase());
            if (found) return res.status(200).json({ status: 'success', data: { qr_image: found.qr_image, conf_text: found.conf, expire: found.expire_at } });
            return res.status(200).json({ status: 'pending' });
        } catch (error) { return res.status(500).json({ status: 'error' }); }
    }

    return res.status(400).json({ error: 'Action không hợp lệ' });
}
