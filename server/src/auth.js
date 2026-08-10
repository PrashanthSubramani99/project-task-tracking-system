import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { db } from './db.js';

const SECRET = process.env.JWT_SECRET || 'teamtrack-dev-secret-change-me';
const TOKEN_TTL = process.env.TOKEN_TTL || '30d';

export const hashPassword = (plain) => bcrypt.hashSync(plain, 10);
export const verifyPassword = (plain, hash) => bcrypt.compareSync(plain, hash);

export function signToken(user) {
  return jwt.sign({ uid: user.id, role: user.role }, SECRET, { expiresIn: TOKEN_TTL });
}

export const PUBLIC_USER_COLS =
  'id, name, email, role, title, phone, avatar_color, is_active, journey, notify_prefs, last_seen_at, created_at';

export function findUserById(id) {
  return db.prepare(`SELECT ${PUBLIC_USER_COLS} FROM users WHERE id = ?`).get(id);
}

/** Attaches req.user when a valid bearer token is present. */
export function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Sign in to continue' });
  try {
    const payload = jwt.verify(token, SECRET);
    const user = findUserById(payload.uid);
    if (!user) return res.status(401).json({ error: 'Account no longer exists' });
    if (!user.is_active) return res.status(403).json({ error: 'This account has been deactivated' });
    req.user = user;
    touchLastSeen(user.id);
    next();
  } catch {
    return res.status(401).json({ error: 'Your session has expired, please sign in again' });
  }
}

let lastTouch = new Map();
function touchLastSeen(userId) {
  // Cheap throttle so every request does not write to disk.
  const now = Date.now();
  if (now - (lastTouch.get(userId) || 0) < 60_000) return;
  lastTouch.set(userId, now);
  db.prepare("UPDATE users SET last_seen_at = datetime('now') WHERE id = ?").run(userId);
}

export function requireOrgRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to do that' });
    }
    next();
  };
}
