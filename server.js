import 'dotenv/config';
import express from 'express';
import { existsSync, mkdirSync } from 'fs';
import multer from 'multer';

import authRoutes, { requireAuth, requireAdminRole } from './routes/auth.js';
import { loadData } from './utils/configManager.js';
import generationRoutes from './routes/generation.js';
import adminRoutes from './routes/admin.js';
import templateRoutes from './routes/template.js';
import previewRoutes from './routes/preview.js';
import downloadRoutes from './routes/download.js';

const USER_PORT = process.env.PORT || 3000;
const ADMIN_PORT = process.env.ADMIN_PORT || 3001;

// Ensure required directories exist
['assets/cache', 'assets/output', 'uploads'].forEach(d => {
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
});

// --- Shared middleware setup ---
function applyCommon(app) {
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use('/api/output', express.static('assets/output'));
  app.use('/api/cache', express.static('assets/cache'));
  app.use('/templates', express.static('templates'));
}

// ==================== USER APP (port 3000) ====================
const userApp = express();
applyCommon(userApp);

// Serve only user pages
userApp.use(express.static('public', {
  index: 'index.html',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('admin.html')) {
      res.status(404);
    }
  }
}));
// Block admin.html on user app
userApp.get('/admin.html', (req, res) => res.status(404).send('Not found'));

// User app needs read-only access to data
userApp.get('/api/data', (req, res) => res.json(loadData()));

const upload = multer({ dest: 'uploads/' });
userApp.post('/api/generate', upload.single('ui_image'), (req, res, next) => next());

userApp.use('/api', generationRoutes);
userApp.use('/api', templateRoutes);
userApp.use('/api', downloadRoutes);
userApp.use('/preview', previewRoutes);

userApp.listen(USER_PORT, () => {
  console.log(`User app running at http://localhost:${USER_PORT}`);
});

// ==================== ADMIN APP (port 3001) ====================
const adminApp = express();
applyCommon(adminApp);

// Serve admin.html as index
adminApp.get('/', (req, res) => res.redirect('/admin.html'));
adminApp.use(express.static('public'));

const adminUpload = multer({ dest: 'uploads/' });
adminApp.post('/api/generate', adminUpload.single('ui_image'), (req, res, next) => next());

adminApp.use('/api', generationRoutes);
adminApp.use('/api', adminRoutes);
adminApp.use('/api', templateRoutes);
adminApp.use('/api', downloadRoutes);
adminApp.use('/preview', previewRoutes);

adminApp.listen(ADMIN_PORT, () => {
  console.log(`Admin app running at http://localhost:${ADMIN_PORT}`);
});
