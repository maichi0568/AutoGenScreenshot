import { Router } from 'express';
import crypto from 'crypto';

const router = Router();

// In-memory session store: token -> { user, role, createdAt }
const sessions = new Map();
const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

function cleanExpired() {
  const now = Date.now();
  for (const [token, sess] of sessions) {
    if (now - sess.createdAt > SESSION_MAX_AGE) sessions.delete(token);
  }
}

function parseCookie(cookieStr) {
  const cookies = {};
  if (!cookieStr) return cookies;
  cookieStr.split(';').forEach(pair => {
    const [key, ...vals] = pair.trim().split('=');
    if (key) cookies[key.trim()] = vals.join('=').trim();
  });
  return cookies;
}

function getSession(req) {
  const token = parseCookie(req.headers.cookie)['session'];
  if (!token) return null;
  const sess = sessions.get(token);
  if (!sess || Date.now() - sess.createdAt > SESSION_MAX_AGE) return null;
  return sess;
}

// Get accounts from env: ACCOUNTS=user1:pass1:admin,user2:pass2:user
function getAccounts() {
  const raw = process.env.ACCOUNTS || '';
  return raw.split(',').map(entry => {
    const [username, password, role] = entry.trim().split(':');
    if (username && password) return { username: username.trim(), password: password.trim(), role: (role || 'user').trim() };
    return null;
  }).filter(Boolean);
}

// POST /api/auth/login
router.post('/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Thiếu tài khoản hoặc mật khẩu' });

  const accounts = getAccounts();
  const account = accounts.find(a => a.username === username && a.password === password);

  if (!account) {
    return res.status(401).json({ error: 'Sai tài khoản hoặc mật khẩu' });
  }

  cleanExpired();
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, {
    user: account.username,
    role: account.role,
    createdAt: Date.now(),
  });

  res.cookie('session', token, {
    httpOnly: true,
    maxAge: SESSION_MAX_AGE,
    sameSite: 'lax',
  });

  return res.json({ ok: true, role: account.role, user: account.username });
});

// POST /api/auth/logout
router.post('/auth/logout', (req, res) => {
  const token = parseCookie(req.headers.cookie)['session'];
  if (token) sessions.delete(token);
  res.clearCookie('session');
  res.json({ ok: true });
});

// GET /api/auth/me
router.get('/auth/me', (req, res) => {
  const sess = getSession(req);
  if (sess) {
    return res.json({ ok: true, user: sess.user, role: sess.role });
  }
  res.status(401).json({ ok: false });
});

// Admin-only routes/pages
const ADMIN_PAGES = ['/admin.html'];
const ADMIN_API_PREFIXES = [
  '/api/admin/',
  '/api/upload-template',
  '/api/scan-template',
  '/api/apply-placeholders',
];

function isAdminOnly(path) {
  if (ADMIN_PAGES.includes(path)) return true;
  for (const prefix of ADMIN_API_PREFIXES) {
    if (path.startsWith(prefix)) return true;
  }
  return false;
}

// Middleware: check auth for protected routes
export function requireAuth(req, res, next) {
  if (req.path.startsWith('/api/auth/')) return next();
  if (req.path === '/login.html' || req.path === '/login') return next();
  if (req.path.startsWith('/preview/')) return next();
  if (/\.(css|js|woff2?|ttf|eot|svg|png|jpg|jpeg|gif|ico)$/i.test(req.path)) return next();
  if (req.path.startsWith('/templates/')) return next();

  const sess = getSession(req);
  if (!sess) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
    return res.redirect('/login.html');
  }

  req.session = sess;
  next();
}

// Middleware: require admin role (for admin app on separate port)
export function requireAdminRole(req, res, next) {
  if (req.path.startsWith('/api/auth/')) return next();
  if (req.path === '/login.html' || req.path === '/login') return next();
  if (/\.(css|js|woff2?|ttf|eot|svg|png|jpg|jpeg|gif|ico)$/i.test(req.path)) return next();

  if (!req.session || req.session.role !== 'admin') {
    if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'Admin only' });
    return res.redirect('/login.html');
  }
  next();
}

export default router;
