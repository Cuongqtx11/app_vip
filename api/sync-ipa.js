// api/sync-ipa.js - Compatibility shim, forward sang admin?action=sync
import adminHandler from './admin.js';

export default async function handler(req, res) {
    req.query.action = 'sync';
    req.query.botSync = 'true';
    return adminHandler(req, res);
}
