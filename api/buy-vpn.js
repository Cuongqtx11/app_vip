export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'Thiếu mã' });

    try {
        const url = `https://api.github.com/repos/cuongqtx11/app_vip/contents/database/vpn_data.json`;
        const gitRes = await fetch(url, { headers: { 'Authorization': `token ${process.env.GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }});
        if (!gitRes.ok) return res.status(200).json({ status: 'pending' });
        
        const gitData = await gitRes.json();
        const vpnList = JSON.parse(Buffer.from(gitData.content, 'base64').toString('utf-8'));

        const found = vpnList.find(k => k.owner_content === content.toUpperCase());
        if (found) {
            return res.status(200).json({ status: 'success', data: { qr_image: found.qr_image, conf_text: found.conf, expire: found.expire_at } });
        } else {
            return res.status(200).json({ status: 'pending', message: 'Chờ thanh toán...' });
        }
    } catch (error) { return res.status(500).json({ status: 'error' }); }
}
