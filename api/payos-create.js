import crypto from 'crypto';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Chỉ hỗ trợ POST' });
    const { amount, content } = req.body;
    
    // Tạo mã đơn hàng số nguyên ngẫu nhiên theo chuẩn PayOS
    const orderCode = Number(String(Date.now()).slice(-6) + Math.floor(Math.random() * 100));
    const host = `https://${req.headers.host}`;
    
    const body = {
        orderCode: orderCode,
        amount: parseInt(amount),
        description: content,
        returnUrl: host,
        cancelUrl: host
    };

    // Tạo chữ ký bảo mật
    const signData = `amount=${body.amount}&cancelUrl=${body.cancelUrl}&description=${body.description}&orderCode=${body.orderCode}&returnUrl=${body.returnUrl}`;
    body.signature = crypto.createHmac('sha256', process.env.PAYOS_CHECKSUM_KEY).update(signData).digest('hex');

    try {
        const resp = await fetch('https://api-merchant.payos.vn/v2/payment-requests', {
            method: 'POST',
            headers: {
                'x-client-id': process.env.PAYOS_CLIENT_ID,
                'x-api-key': process.env.PAYOS_API_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });
        const data = await resp.json();
        if (data.code === '00') {
            // Trả về mã chuỗi QR để web hiển thị
            res.status(200).json({ qrCode: data.data.qrCode, checkoutUrl: data.data.checkoutUrl });
        } else {
            res.status(400).json({ error: data.desc });
        }
    } catch(e) { res.status(500).json({ error: e.message }); }
}
