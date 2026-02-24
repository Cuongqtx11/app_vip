export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Chỉ hỗ trợ POST' });

    try {
        console.log("========== BẮT ĐẦU XỬ LÝ ==========");
        const { data, success } = req.body;
        
        if (!success || !data || !data.description) {
            return res.status(200).json({ success: true });
        }

        const fullDescription = String(data.description).toUpperCase();
        const amount = parseInt(data.amount);
        console.log(`💵 Tiền: ${amount} | 📝 Nội dung: "${fullDescription}"`);

        const parts = fullDescription.split(/[^A-Z0-9]+/);
        let transCode = null, codeType = null;

        for (const part of parts) {
            if (part.length === 6) { transCode = part; codeType = 'key'; break; } 
            else if (part.length === 9) { transCode = part; codeType = 'vpn'; break; }
        }

        if (!transCode) {
            console.log("❌ Bỏ qua vì không thấy mã 6/9 ký tự.");
            return res.status(200).json({ success: true }); 
        }

        console.log(`✅ Mã GD: [ ${transCode} ]`);

        const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
        const OWNER = 'cuongqtx11';
        const REPO = 'app_vip';

        // HÀM ĐỌC GITHUB SIÊU BẮT LỖI
        async function readGit(path) {
            console.log(`📂 Đang gọi API GitHub để đọc: ${path}...`);
            try {
                const gitRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`, {
                    headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }
                });
                
                console.log(`📡 Phản hồi từ GitHub: HTTP ${gitRes.status}`);
                
                if(!gitRes.ok) {
                    const errText = await gitRes.text();
                    console.log(`❌ LỖI GITHUB TỪ CHỐI: ${errText}`);
                    return null;
                }
                
                const d = await gitRes.json();
                let fileContent = '';
                try {
                    fileContent = Buffer.from(d.content, 'base64').toString('utf-8');
                    const parsedData = JSON.parse(fileContent);
                    console.log(`✅ Đọc thành công! Đang có ${parsedData.length} dòng dữ liệu.`);
                    return { data: parsedData, sha: d.sha, url: d.url };
                } catch (parseError) {
                    console.log(`❌ LỖI ĐỊNH DẠNG FILE JSON: File keys.json bị sai hoặc trống trơn. Nội dung hiện tại: "${fileContent}"`);
                    return null;
                }
            } catch (networkErr) {
                console.log(`❌ LỖI MẠNG KHI KẾT NỐI GITHUB:`, networkErr.message);
                return null;
            }
        }

        async function writeGit(url, dataObj, sha, msg) {
            console.log(`✍️ Đang tiến hành lưu lên GitHub...`);
            const gitRes = await fetch(url, {
                method: 'PUT',
                headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: msg, content: Buffer.from(JSON.stringify(dataObj, null, 2)).toString('base64'), sha })
            });
            if (gitRes.ok) console.log("✅ LƯU FILE LÊN GITHUB THÀNH CÔNG RỰC RỠ!");
            else {
                const errText = await gitRes.text();
                console.log(`❌ LỖI KHI GHI FILE: HTTP ${gitRes.status} - Chi tiết: ${errText}`);
            }
        }

        function genKey() {
            const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
            const p = () => Array.from({length:4}, () => c[Math.floor(Math.random()*c.length)]).join('');
            return `${p()}-${p()}-${p()}-${p()}`;
        }

        if (codeType === 'key') {
            const git = await readGit('public/data/keys.json'); 
            if(!git) return res.status(200).json({ success: true });

            if (git.data.find(k => k.transaction_code === transCode)) {
                console.log("⚠️ Key đã được tạo rồi.");
                return res.status(200).json({ success: true });
            }

            let days = 0, uses = 0, pkg = '';
            if (amount >= 4999000) { pkg = 'Gói Vĩnh Viễn'; days = 36500; }
            else if (amount >= 199000) { pkg = 'Gói 1 Năm'; days = 365; }
            else if (amount >= 149000) { pkg = 'Gói 6 Tháng'; days = 180; }
            else if (amount >= 39000) { pkg = 'Gói Tháng VIP'; days = 30; }
            else if (amount >= 19000) { pkg = 'Gói Tuần VIP'; days = 7; }
            else if (amount >= 5000) { pkg = 'Gói Trải Nghiệm'; uses = 20; }
            else {
                console.log(`❌ Số tiền không khớp!`);
                return res.status(200).json({ success: true });
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
            
            await writeGit(git.url, git.data, git.sha, `PayOS: Tạo Key ${transCode}`);
            console.log(`🎉 HOÀN TẤT TẠO KEY: ${newKey}`);
        }
        
        console.log("========== KẾT THÚC ==========");
        return res.status(200).json({ success: true });

    } catch(e) {
        console.log("❌ LỖI KHÔNG XÁC ĐỊNH:", e.message);
        return res.status(200).json({ success: true });
    }
}
