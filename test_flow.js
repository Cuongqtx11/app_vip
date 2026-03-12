import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

// Hardcode config for testing (from .env)
const SUPABASE_URL = 'https://cxweoaucrtmgzhzjhjzp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN4d2VvYXVjcnRtZ3poempoanpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNDQxNjUsImV4cCI6MjA4ODYyMDE2NX0.LxvbJNFPG_pT_m6djKPaMDIzufnNAprXF9l5Y4dqCP4';
const JWT_SECRET = 'app-vip-secret-key-2026';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function testFlow() {
    console.log("🚀 BẮT ĐẦU TEST FLOW MUA KEY...");

    try {
        // 1. Tạo user giả lập
        const testUsername = 'test_user_senior_' + Math.floor(Math.random() * 1000);
        const { data: user, error: signUpError } = await supabase.from('users').insert([
            { username: testUsername, password: 'password123' } 
        ]).select().single();

        if (signUpError) {
            console.error("❌ Lỗi tạo user test:", signUpError.message);
            return;
        }
        console.log("✅ Đã tạo user test:", testUsername);

        // 2. Logic tạo đơn hàng (như trong api/payos-create.js)
        const orderCode = Math.floor(100000 + Math.random() * 900000);
        const amount = 19000;
        const packageName = 'Gói Tuần VIP';

        console.log("📡 Đang lưu bản ghi PENDING vào bảng orders...");
        const { error: orderError } = await supabase.from('orders').insert([{
            order_code: String(orderCode),
            transaction_code: String(orderCode),
            user_id: user.id,
            username: testUsername,
            package_name: packageName,
            amount: amount,
            status: 'pending'
        }]);

        if (orderError) {
            console.error("❌ LỖI KHI LƯU BẢNG orders:", orderError.message);
        } else {
            console.log("✅ BẢNG orders: Đã tạo bản ghi PENDING thành công!");
            console.log(`   - OrderCode: ${orderCode}`);
            console.log(`   - Tài khoản: ${testUsername}`);
        }

        // 3. Kiểm tra lại dữ liệu
        const { data: checkOrder } = await supabase.from('orders').select('*').eq('order_code', String(orderCode)).single();
        if (checkOrder) {
            console.log("🎯 KẾT QUẢ: Hệ thống nhận diện bảng orders thành công!");
            console.log("------------------------------------------");
            console.log("Trạng thái đơn hàng trong DB:");
            console.log(`- ID: ${checkOrder.id}`);
            console.log(`- Username: ${checkOrder.username}`);
            console.log(`- Status: ${checkOrder.status}`);
            console.log("------------------------------------------");
        }

        // 4. Dọn dẹp
        await supabase.from('orders').delete().eq('order_code', String(orderCode));
        await supabase.from('users').delete().eq('id', user.id);
        console.log("🗑️ Đã dọn dẹp dữ liệu test.");

    } catch (e) {
        console.error("💥 Lỗi đột ngột:", e.message);
    }
}

testFlow();
