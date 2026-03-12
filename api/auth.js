import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const JWT_SECRET = process.env.JWT_SECRET || 'your_secret_key_senior_dev';
const RESEND_API_KEY = process.env.RESEND_API_KEY;

/**
 * UTILS: Trả về phản hồi chuẩn với Header chống Cache
 */
const sendResponse = (res, status, data) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    return res.status(status).json(data);
};

/**
 * AUTH SERVICE: Tạo Token cặp (Access + Refresh)
 */
const generateTokens = (payload) => {
    const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' });
    const refreshToken = jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' });
    return { accessToken, refreshToken };
};

/**
 * EMAIL SERVICE: Gửi email qua Resend
 */
async function sendResetEmail(email, token, host) {
    console.log(`[Resend Debug] Preparing to send to: ${email}`);
    if (!RESEND_API_KEY) return false;

    const resetLink = `https://${host}/reset-password.html?token=${token}`;
    
    try {
        const resp = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${RESEND_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                from: 'p12.vn - Kho App VIP <no-reply@p12.vn>', 
                to: email,
                subject: 'Khôi phục mật khẩu - p12.vn',
                html: `
                    <div style="font-family: sans-serif; max-width: 500px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
                        <h2 style="color: #7c3aed; text-align: center;">p12.vn</h2>
                        <p>Chào bạn,</p>
                        <p>Chúng tôi nhận được yêu cầu khôi phục mật khẩu cho tài khoản của bạn tại <b>p12.vn</b>.</p>
                        <p>Vui lòng bấm vào nút bên dưới để thiết lập mật khẩu mới:</p>
                        <div style="text-align: center; margin: 30px 0;">
                            <a href="${resetLink}" style="background: #7c3aed; color: white; padding: 12px 25px; text-decoration: none; border-radius: 8px; font-weight: bold;">ĐẶT LẠI MẬT KHẨU</a>
                        </div>
                        <p style="font-size: 0.8em; color: #666;">Link này sẽ hết hạn sau 1 giờ. Nếu bạn không yêu cầu, vui lòng bỏ qua email này.</p>
                        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
                        <p style="text-align: center; font-size: 0.8em; color: #999;">© 2026 p12.vn - cuios.shop</p>
                    </div>
                `
            })
        });

        const data = await resp.json();
        console.log(`[Resend Debug] Response:`, JSON.stringify(data));
        return resp.ok;
    } catch (e) {
        console.error(`[Resend Debug] Critical Error:`, e.message);
        return false;
    }
}

export default async function handler(req, res) {
    const { action } = req.query;
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    // --- 1. ĐĂNG KÝ (REGISTER) ---
    if (action === 'signup' && req.method === 'POST') {
        try {
            let { username, password, email } = req.body;
            if (!username || !password || password.length < 6) {
                return sendResponse(res, 400, { error: 'Username/Password không hợp lệ (min 6 ký tự)' });
            }
            if (email) email = email.toLowerCase().trim();

            const { data: existingUser } = await supabase.from('users').select('id').eq('username', username).single();
            if (existingUser) return sendResponse(res, 400, { error: 'Tên đăng nhập đã tồn tại!' });
            if (email) {
                const { data: existingEmail } = await supabase.from('users').select('id').eq('email', email).single();
                if (existingEmail) return sendResponse(res, 400, { error: 'Email đã được đăng ký!' });
            }
            const hashedPassword = await bcrypt.hash(password, 12);
            const { error } = await supabase.from('users').insert([{ username, password: hashedPassword, email: email || null }]);
            if (error) throw error;
            return sendResponse(res, 201, { success: true, message: 'Đăng ký thành công!' });
        } catch (e) { return sendResponse(res, 500, { error: 'Lỗi hệ thống: ' + e.message }); }
    }

    // --- 2. ĐĂNG NHẬP (LOGIN) ---
    if (action === 'login' && req.method === 'POST') {
        try {
            const { username, password } = req.body;
            if (!username || !password) return sendResponse(res, 400, { error: 'Thiếu thông tin đăng nhập' });
            const fiveMinsAgo = new Date(Date.now() - 5 * 60000).toISOString();
            const { count: attempts } = await supabase.from('login_attempts').select('*', { count: 'exact', head: true }).eq('username', username).gt('attempted_at', fiveMinsAgo);
            if (attempts && attempts >= 5) return sendResponse(res, 429, { error: 'Thử sai quá nhiều lần. Vui lòng quay lại sau 5 phút.' });
            const { data: user } = await supabase.from('users').select('*').eq('username', username).single();
            if (!user || !(await bcrypt.compare(password, user.password))) {
                await supabase.from('login_attempts').insert([{ username, ip_address: clientIp }]);
                return sendResponse(res, 401, { error: 'Tài khoản hoặc mật khẩu không chính xác!' });
            }
            await supabase.from('login_attempts').delete().eq('username', username);
            const payload = { id: user.id, username: user.username };
            const { accessToken, refreshToken } = generateTokens(payload);
            const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60000).toISOString();
            await supabase.from('refresh_tokens').insert([{ user_id: user.id, token: refreshToken, expires_at: expiresAt }]);
            const cookieOptions = `Path=/; SameSite=Lax; Max-Age=${30 * 24 * 3600}; Secure;`;
            res.setHeader('Set-Cookie', [
                `auth_token=${accessToken}; HttpOnly; ${cookieOptions}`,
                `refresh_token=${refreshToken}; HttpOnly; ${cookieOptions}`,
                `logged_in=true; ${cookieOptions}`
            ]);
            return sendResponse(res, 200, { success: true, token: accessToken, user: { id: user.id, username: user.username, email: user.email } });
        } catch (e) { return sendResponse(res, 500, { error: 'Lỗi đăng nhập: ' + e.message }); }
    }

    // --- 3. ĐĂNG XUẤT (LOGOUT) ---
    if (action === 'logout') {
        const deleteOptions = 'Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
        res.setHeader('Set-Cookie', [
            `auth_token=; HttpOnly; ${deleteOptions}`,
            `refresh_token=; HttpOnly; ${deleteOptions}`,
            `logged_in=; ${deleteOptions}`,
            `admin_token=; HttpOnly; ${deleteOptions}`
        ]);
        return sendResponse(res, 200, { success: true, message: 'Đã đăng xuất' });
    }

    // --- 4. REFRESH TOKEN ---
    if (action === 'refresh') {
        try {
            const cookies = req.headers.cookie || '';
            const rToken = cookies.split('; ').find(row => row.startsWith('refresh_token='))?.split('=')[1];
            if (!rToken) return sendResponse(res, 401, { error: 'No refresh token' });
            const { data: dbToken } = await supabase.from('refresh_tokens').select('*').eq('token', rToken).single();
            if (!dbToken || new Date(dbToken.expires_at) < new Date()) return sendResponse(res, 401, { error: 'Session expired' });
            const decoded = jwt.verify(rToken, JWT_SECRET);
            const { accessToken } = generateTokens({ id: decoded.id, username: decoded.username });
            res.setHeader('Set-Cookie', `auth_token=${accessToken}; HttpOnly; Path=/; SameSite=Lax; Max-Age=3600;`);
            return sendResponse(res, 200, { success: true, token: accessToken });
        } catch (e) { return sendResponse(res, 401, { error: 'Invalid session' }); }
    }

    // --- 5. QUÊN MẬT KHẨU ---
    if (action === 'forgot-password' && req.method === 'POST') {
        try {
            let { email } = req.body;
            if (!email) return sendResponse(res, 400, { error: 'Vui lòng nhập email' });
            email = email.toLowerCase().trim();

            const { data: user } = await supabase.from('users').select('id, email').eq('email', email).single();
            if (!user) return sendResponse(res, 200, { success: true, message: 'Nếu email tồn tại, link reset sẽ được gửi đi.' });

            const token = crypto.randomBytes(32).toString('hex');
            const expiresAt = new Date(Date.now() + 3600000).toISOString();
            await supabase.from('password_resets').delete().eq('user_id', user.id);
            await supabase.from('password_resets').insert([{ user_id: user.id, token, expires_at: expiresAt }]);
            await sendResetEmail(user.email, token, req.headers.host);
            return sendResponse(res, 200, { success: true, message: 'Đã gửi link khôi phục mật khẩu!' });
        } catch (e) { return sendResponse(res, 500, { error: e.message }); }
    }

    // --- 6. ĐẶT LẠI MẬT KHẨU ---
    if (action === 'reset-password' && req.method === 'POST') {
        try {
            const { token, password } = req.body;
            const { data: reset } = await supabase.from('password_resets').select('*').eq('token', token).single();
            if (!reset || new Date(reset.expires_at) < new Date()) return sendResponse(res, 400, { error: 'Link hết hạn' });
            const hashedPassword = await bcrypt.hash(password, 12);
            await supabase.from('users').update({ password: hashedPassword }).eq('id', reset.user_id);
            await supabase.from('password_resets').delete().eq('id', reset.id);
            return sendResponse(res, 200, { success: true });
        } catch (e) { return sendResponse(res, 500, { error: e.message }); }
    }

    // --- 7. ĐỔI MẬT KHẨU ---
    if (action === 'change-password' && req.method === 'PUT') {
        try {
            const authHeader = req.headers['authorization'];
            let token = authHeader && authHeader.split(' ')[1];
            if (!token) {
                const cookies = req.headers.cookie || '';
                token = cookies.split('; ').find(row => row.startsWith('auth_token='))?.split('=')[1];
            }
            if (!token) return sendResponse(res, 401, { error: 'Unauthorized' });
            const decoded = jwt.verify(token, JWT_SECRET);
            const { currentPassword, newPassword } = req.body;
            const { data: user } = await supabase.from('users').select('password').eq('id', decoded.id).single();
            if (!user || !(await bcrypt.compare(currentPassword, user.password))) return sendResponse(res, 400, { error: 'Mật khẩu hiện tại không đúng' });
            const hashedNewPassword = await bcrypt.hash(newPassword, 12);
            await supabase.from('users').update({ password: hashedNewPassword }).eq('id', decoded.id);
            return sendResponse(res, 200, { success: true });
        } catch (e) { return sendResponse(res, 401, { error: 'Unauthorized' }); }
    }

    // --- 8. CẬP NHẬT EMAIL ---
    if (action === 'update-email' && req.method === 'POST') {
        try {
            const authHeader = req.headers['authorization'];
            let token = authHeader && authHeader.split(' ')[1];
            if (!token) {
                const cookies = req.headers.cookie || '';
                token = cookies.split('; ').find(row => row.startsWith('auth_token='))?.split('=')[1];
            }
            if (!token) return sendResponse(res, 401, { error: 'Unauthorized' });
            const decoded = jwt.verify(token, JWT_SECRET);
            let { email } = req.body;
            if (!email || !email.includes('@')) return sendResponse(res, 400, { error: 'Email không hợp lệ' });
            email = email.toLowerCase().trim();
            const { data: existingUser } = await supabase.from('users').select('id').eq('email', email).neq('id', decoded.id).single();
            if (existingUser) return sendResponse(res, 400, { error: 'Email này đã được sử dụng bởi tài khoản khác' });
            const { error } = await supabase.from('users').update({ email }).eq('id', decoded.id);
            if (error) throw error;
            return sendResponse(res, 200, { success: true, message: 'Cập nhật email thành công!' });
        } catch (e) { return sendResponse(res, 401, { error: 'Unauthorized' }); }
    }

    return sendResponse(res, 400, { error: 'Action không hợp lệ' });
}
