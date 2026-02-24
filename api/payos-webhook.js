export default async function handler(req, res) {
    // Đảm bảo chỉ nhận phương thức POST từ PayOS
    if (req.method !== 'POST') return res.status(405).json({ error: 'Chỉ hỗ trợ POST' });

    try {
        console.log("========== BẮT ĐẦU NHẬN WEBHOOK TỪ PAYOS ==========");
        
        const { data, success } = req.body;
        
        // 1. Kiểm tra dữ liệu đầu vào
        if (!success || !data || !data.description) {
            console.log("❌ Webhook không hợp lệ hoặc thiếu thông tin description.");
            return res.status(200).json({ success: true });
        }

        const fullDescription = String(data.description).toUpperCase();
        const amount = parseInt(data.amount);
        console.log(`💵 Số tiền nạp: ${amount} | 📝 Nội dung chuyển khoản: "${fullDescription}"`);

        // 2. TÌM MÃ 6 KÝ TỰ (KEY APP) HOẶC 9 KÝ TỰ (VPN)
        const parts = fullDescription.split(/[^A-Z0-9]+/);
        let transCode = null;
        let codeType = null;

        for (const part of parts) {
            if (part.length === 6) { transCode = part; codeType = 'key'; break; } 
            else if (part.length === 9) { transCode = part; codeType = 'vpn'; break; }
        }

        if (!transCode) {
            console.log("❌ LỖI: Không tìm thấy mã 6 hoặc 9 ký tự nào!");
            return res.status(200).json({ success: true }); 
        }

        console.log(`✅ Đã bắt được mã giao dịch: [ ${transCode} ] - Loại: ${codeType}`);

        // 3. KẾT NỐI GITHUB ĐỂ ĐỌC/GHI FILE
        const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
        if (!GITHUB_TOKEN) {
            console.log("❌ LỖI: Chưa có biến môi trường GITHUB_TOKEN trên Vercel!");
            return res.status(200).json({ success: true });
        }

        const OWNER = 'cuongqtx11';
        const REPO = 'app_vip';

        // Hàm đọc file GitHub
        async function readGit(path) {
            console.log(`📂 Đang mở file từ GitHub: ${path}...`);
            const gitRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`, {
                headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }
            });
            if(!gitRes.ok) {
                console.log(`❌ Lỗi đọc file. Mã lỗi: ${gitRes.status}`);
                return null;
            }
            const d = await gitRes.json();
            return { data: JSON.parse(Buffer.from(d.content, 'base64').toString('utf-8')), sha: d.sha, url: d.url };
        }

        // Hàm ghi file GitHub
        async function writeGit(url, dataObj, sha, msg) {
            console.log(`✍️ Đang ghi Key mới vào GitHub...`);
            const gitRes = await fetch(url, {
                method: 'PUT',
                headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: msg, content: Buffer.from(JSON.stringify(dataObj, null, 2)).toString('base64'), sha })
            });
            if (gitRes.ok) console.log("✅ LƯU FILE LÊN GITHUB THÀNH CÔNG!");
            else console.log("❌ LỖI KHI LƯU FILE:", gitRes.status);
        }

        // Hàm tự động sinh Key định dạng XXXX-XXXX-XXXX-XXXX
        function genKey() {
            const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
            const p = () => Array.from({length:4}, () => c[Math.floor(Math.random()*c.length)]).join('');
            return `${p()}-${p()}-${p()}-${p()}`;
        }

        // 4. XỬ LÝ MUA GÓI KEY APP (6 KÝ TỰ)
        if (codeType === 'key') {
            const path = 'public/data/keys.json'; // Đọc đúng từ file khoá của bạn
            const git = await readGit(path); 
            if(!git) return res.status(200).json({ success: true });

            // Chống cộng dồn (Nếu mã này đã xử lý rồi thì bỏ qua)
            if (git.data.find(k => k.transaction_code === transCode)) {
                console.log("⚠️ Mã giao dịch này đã được tạo Key trước đó rồi. Bỏ qua.");
                return res.status(200).json({ success: true });
            }

            // Phân loại gói theo số tiền
            let days = 0, uses = 0, pkg = '';
            if (amount >= 4999000) { pkg = 'Gói Vĩnh Viễn'; days = 36500; }
            else if (amount >= 199000) { pkg = 'Gói 1 Năm'; days = 365; }
            else if (amount >= 149000) { pkg = 'Gói 6 Tháng'; days = 180; }
            else if (amount >= 39000) { pkg = 'Gói Tháng VIP'; days = 30; }
            else if (amount >= 19000) { pkg = 'Gói Tuần VIP'; days = 7; }
            else if (amount >= 5000) { pkg = 'Gói Trải Nghiệm'; uses = 20; }
            else {
                console.log(`❌ Số tiền ${amount}đ không khớp với gói nào, tạo key thất bại!`);
                return res.status(200).json({ success: true });
            }

            // Tạo dữ liệu Key mới
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
            
            // Ghi dữ liệu đã cập nhật lên GitHub
            await writeGit(git.url, git.data, git.sha, `PayOS: Tự động tạo Key cho đơn ${transCode}`);
            console.log(`🎉 HOÀN TẤT! ĐÃ TẠO VÀ LƯU KEY: ${newKey}`);
        }
        
        // 5. XỬ LÝ MUA VPN (9 KÝ TỰ) NẾU CÓ DÙNG
        else if (codeType === 'vpn') {
            const path = 'public/data/vpn_data.json';
            const git = await readGit(path);
            if(!git) return res.status(200).json({ success: true });

            if (git.data.find(k => k.owner_content === transCode)) {
                return res.status(200).json({ success: true });
            }

            const idx = git.data.findIndex(k => k.status === 'available');
            if(idx !== -1) {
                const now = new Date();
                const exp = new Date(now.getTime() + 30*86400000); 
                git.data[idx] = { ...git.data[idx], status: 'sold', owner_content: transCode, sold_at: now.toISOString(), expire_at: exp.toISOString() };
                await writeGit(git.url, git.data, git.sha, `PayOS: Bán VPN cho đơn ${transCode}`);
                console.log(`🎉 HOÀN TẤT! ĐÃ CẤP VPN CHO ĐƠN: ${transCode}`);
