export default async function handler(req, res) {
    // Luôn trả về 200 để PayOS biết đã nhận được tin
    res.status(200).json({ success: true }); 

    try {
        const { data } = req.body;
        if (!data || !data.description) return;

        const content = data.description.trim().toUpperCase();
        const amount = parseInt(data.amount);

        const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
        const OWNER = 'cuongqtx11';
        const REPO = 'app_vip';

        // Hàm đọc file GitHub
        async function readGit(path) {
            const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`, {
                headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }
            });
            if(!res.ok) return null;
            const d = await res.json();
            return { data: JSON.parse(Buffer.from(d.content, 'base64').toString('utf-8')), sha: d.sha, url: d.url };
        }

        // Hàm ghi file GitHub
        async function writeGit(url, dataObj, sha, msg) {
            await fetch(url, {
                method: 'PUT',
                headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: msg, content: Buffer.from(JSON.stringify(dataObj, null, 2)).toString('base64'), sha })
            });
        }

        function genKey() {
            const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
            const p = () => Array.from({length:4}, () => c[Math.floor(Math.random()*c.length)]).join('');
            return `${p()}-${p()}-${p()}-${p()}`;
        }

        // --- XỬ LÝ MUA KEY APP (6 KÝ TỰ) ---
        if (content.length === 6) {
            // ĐÃ SỬA: Trỏ đúng về public/data/keys.json
            const git = await readGit('public/data/keys.json'); 
            if(!git || git.data.find(k => k.transaction_code === content)) return;

            let days = 0, uses = 0, pkg = '';
            if (amount >= 4999000) { pkg = 'Gói Vĩnh Viễn'; days = 36500; } // Thêm gói vĩnh viễn (100 năm)
            else if (amount >= 199000) { pkg = 'VIP 1 Năm'; days = 365; }
            else if (amount >= 149000) { pkg = 'VIP 6 Tháng'; days = 180; }
            else if (amount >= 39000) { pkg = 'VIP 1 Tháng'; days = 30; }
            else if (amount >= 19000) { pkg = 'VIP 1 Tuần'; days = 7; }
            else if (amount >= 5000) { pkg = 'Gói Lẻ'; uses = 10; }
            else return;

            const now = new Date();
            git.data.unshift({
                id: `key_${Math.floor(Date.now()/1000)}`,
                key: genKey(),
                createdAt: now.toISOString(),
                expiresAt: days > 0 ? new Date(now.getTime() + days*86400000).toISOString() : null,
                maxUses: uses > 0 ? uses : null,
                currentUses: 0,
                active: true,
                createdBy: 'payos_webhook',
                transaction_code: content,
                package: pkg,
                notes: "Auto PayOS"
            });
            await writeGit(git.url, git.data, git.sha, `PayOS: Created Key for ${content}`);
        }
        
        // --- XỬ LÝ MUA VPN (9 KÝ TỰ) ---
        else if (content.length === 9) {
            // ĐÃ SỬA: Trỏ đúng về public/data/vpn_data.json
            const git = await readGit('public/data/vpn_data.json');
            if(!git || git.data.find(k => k.owner_content === content)) return;

            const idx = git.data.findIndex(k => k.status === 'available');
            if(idx === -1) return;

            const now = new Date();
            const exp = new Date(now.getTime() + 30*86400000);

            git.data[idx] = { ...git.data[idx], status: 'sold', owner_content: content, sold_at: now.toISOString(), expire_at: exp.toISOString() };
            await writeGit(git.url, git.data, git.sha, `PayOS: Sold VPN for ${content}`);
        }
    } catch(e) {
        console.error("Webhook Error: ", e);
    }
}
