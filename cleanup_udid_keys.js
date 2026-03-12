import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function cleanup() {
    console.log('--- ĐANG XÓA TẤT CẢ KEY UDID CŨ ---');
    const { data, error } = await supabase
        .from('user_keys')
        .delete()
        .like('transaction_code', 'UDID:%');

    if (error) {
        console.error('Lỗi:', error.message);
    } else {
        console.log('✅ Đã xóa sạch các key UDID cũ.');
    }
}

cleanup();
