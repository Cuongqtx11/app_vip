export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Chỉ hỗ trợ POST' });
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'Thiếu mã giao dịch' });

    try {
        // ĐÃ SỬA: Trỏ đúng về public/data/keys.json
        const url = `https://api.github.com/repos/cuongqtx11/app_vip/contents/public/data/keys.json`;
        const gitRes = await fetch(url, { headers: { 'Authorization': `token ${process.env.GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }});
        if (!gitRes.ok) return res.status(200).json({ status: 'pending' });
        
        const gitData = await gitRes.json();
        const keysDB = JSON.parse(Buffer.from(gitData.content, 'base64').toString('utf-8'));

        const found = keysDB.find(k => k.transaction_code === content.toUpperCase());
        if (found) {
            return res.status(200).json({ status: 'success', key: found.key, package: found.package });
        } else {
            return res.status(200).json({ status: 'pending', message: 'Đang chờ thanh toán...' });
        }
    } catch (error) { return res.status(500).json({ status: 'error' }); }
}
