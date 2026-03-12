const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function cleanup() {
    console.log("--- Bắt đầu dọn dẹp Key UDID lỗi ---");
    // Xóa theo transaction_code (chứa UDID) hoặc package_name
    const { data, error } = await supabase
        .from('user_keys')
        .delete()
        .or('package_name.ilike.%UDID%,transaction_code.not.is.null');

    if (error) console.error("Lỗi xóa:", error);
    else console.log("Đã xóa sạch các Key liên quan đến UDID.");
}
cleanup();
