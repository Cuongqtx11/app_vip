export default async function handler(req, res) {
    // Trả về 200 OK ngay để PayOS không gọi lại nhiều lần
    res.status(200).json({ success: true }); 

    try {
        console.log("========== BẮT ĐẦU NHẬN WEBHOOK TỪ PAYOS ==========");
        console.log("Dữ liệu thô nhận được:", JSON.stringify(req.body));
        
        const { data, success } = req.body;
        
        if (!success || !data || !data.description) {
            console.log("❌ Webhook không hợp lệ hoặc thiếu thông tin description.");
            return;
        }

        const fullDescription = String(data.description).toUpperCase();
        const amount = parseInt(data.amount);
        console.log(`💵 Số tiền nạp: ${amount} | 📝 Nội dung chuyển khoản: "${fullDescription}"`);

        // --- TÌM MÃ 6 KÝ TỰ (KEY) HOẶC 9 KÝ TỰ (VPN) ---
        // Tách các cụm chữ/số ra để tìm mã chính xác
        const parts = fullDescription.split(/[^A-Z0-9]+/);
        console.log("🔍 Các từ khóa tách được:", parts);

        let transCode = null;
        let codeType = null;

        for (const part of parts) {
            if (part.length === 6) {
                transCode = part;
                codeType = 'key';
                break; 
            } else if (part.length === 9) {
                transCode = part;
                codeType = 'vpn';
                break;
            }
        }

        if (!transCode) {
            console.log("❌ LỖI: Không tìm thấy mã 6 hoặc 9 ký tự nào để tạo Key!");
            return; 
        }

        console.log(`✅ Đã bắt được mã giao dịch: [ ${transCode} ] - Loại: ${codeType}`);

        // --- KẾT NỐI GITHUB ĐỂ GHI FILE ---
        const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
        if (!GITHUB_TOKEN) {
            console.log("❌ LỖI: Chưa có biến môi trường GITHUB_TOKEN trên Vercel!");
            return;
        }

        const OWNER = 'cuongqtx11';
        const REPO = 'app_vip';

        async function readGit(path) {
            console.log(`📂 Đang đọc file từ GitHub: ${path}...`);
            const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`, {
                headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }
            });
            if(!res.ok) {
                console.log(`❌ Lỗi đọc file (Mã ${res.status}): File không tồn tại hoặc Token sai.`);
                return null;
            }
            const d = await res.json();
            return { data: JSON.parse(Buffer.from(d.content, 'base64').toString('utf-8')), sha: d.sha, url: d.url };
        }

        async function writeGit(url, dataObj, sha, msg) {
            console.log(`✍️ Đang lưu Key mới lên GitHub...`);
            const res = await fetch(url, {
                method: 'PUT',
                headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: msg, content: Buffer.from(JSON.stringify(dataObj, null, 2)).toString('base64'), sha })
            });
            if (res.ok) console.log("✅ LƯU FILE LÊN GITHUB THÀNH CÔNG!");
            else console.log("❌ LỖI KHI LƯU FILE:", res.status);
        }

        function genKey() {
            const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
            const p = () => Array.from({length:4}, () => c[Math.floor(Math.random()*c.length)]).join('');
            return `${p()}-${p()}-${p()}-${p()}`;
        }

        // --- XỬ LÝ GHI KEY APP (6 KÝ TỰ) ---
        if (codeType === 'key') {
            const path = 'public/data/keys.json'; // Sử dụng đường dẫn thư mục public của bạn
            const git = await readGit(path); 
            if(!git) return;

            if (git.data.find(k => k.transaction_code === transCode)) {
                console.log("⚠️ Mã giao dịch này đã được tạo Key trước đó rồi. Bỏ qua.");
                return;
            }

            let days = 0, uses = 0, pkg = '';
            if (amount >= 4999000) { pkg = 'Gói Vĩnh Viễn'; days = 36500; }
            else if (amount >= 199000) { pkg = 'Gói 1 Năm'; days = 365; }
            else if (amount >= 149000) { pkg = 'Gói 6 Tháng'; days = 180; }
            else if (amount >= 39000) { pkg = 'Gói Tháng VIP'; days = 30; }
            else if (amount >= 19000) { pkg = 'Gói Tuần VIP'; days = 7; }
            else if (amount >= 5000) { pkg = 'Gói Trải Nghiệm'; uses = 20; }
            else {
                console.log(`❌ Số tiền ${amount}đ không khớp với gói nào, tạo key thất bại!`);
                return;
            }

            const now = new Date();
            const newKey = genKey();
            git.data.unshift({
                id: `key_${Math.floor(Date.now()/1000)}`,
                key: newKey,
                createdAt: now.toISOString(),
                expiresAt: days > 0 ? new Date(now.getTime() + days*86400000).toISOString() : null,
                maxUses: uses > 0 ? uses : null,
                currentUses: 0,
                active: true,
                createdBy: 'payos_webhook',
                transaction_code: transCode,
                package: pkg,
                notes: "Auto PayOS"
            });
            
            await writeGit(git.url, git.data, git.sha, `PayOS: Tự động tạo Key cho đơn ${transCode}`);
            console.log(`🎉 HOÀN TẤT! ĐÃ TẠO VÀ LƯU KEY: ${newKey}`);
        }
        console.log("========== KẾT THÚC XỬ LÝ WEBHOOK ==========");
    } catch(e) {
        console.log("❌ LỖI HỆ THỐNG KHÔNG XÁC ĐỊNH:", e.message);
    }
}
