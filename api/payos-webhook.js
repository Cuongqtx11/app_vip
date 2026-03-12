// api/payos-webhook.js - FORWARD COMPATIBILITY ROUTE
import handler from './payment.js';

export default async (req, res) => {
  // Gán action=webhook để payment.js nhận diện đúng nhánh logic
  req.query.action = 'webhook';
  return handler(req, res);
};
