import 'dotenv/config';
import express from 'express';
import { existsSync, mkdirSync } from 'fs';
import multer from 'multer';

import generationRoutes from './routes/generation.js';
import adminRoutes from './routes/admin.js';
import templateRoutes from './routes/template.js';
import previewRoutes from './routes/preview.js';
import downloadRoutes from './routes/download.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure required directories exist
['assets/cache', 'assets/output', 'uploads'].forEach(d => {
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files
app.use(express.static('public'));
app.use('/api/output', express.static('assets/output'));
app.use('/api/cache', express.static('assets/cache'));
app.use('/templates', express.static('templates'));

// Multer for /api/generate (file upload)
const upload = multer({ dest: 'uploads/' });
app.post('/api/generate', upload.single('ui_image'), (req, res, next) => next());

// Mount routes
app.use('/api', generationRoutes);
app.use('/api', adminRoutes);
app.use('/api', templateRoutes);
app.use('/api', downloadRoutes);
app.use('/preview', previewRoutes);

app.listen(PORT, () => {
  console.log(`App Screenshot Generator running at http://localhost:${PORT}`);
});
