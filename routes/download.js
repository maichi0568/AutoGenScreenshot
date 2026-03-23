import { Router } from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import archiver from 'archiver';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, '..', 'assets', 'output');
const router = Router();

function createZipResponse(res, validFiles, zipName, folders = {}) {
  res.set('Content-Type', 'application/zip');
  res.set('Content-Disposition', `attachment; filename="${zipName}"`);

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', err => {
    console.error('Archive error:', err);
    if (!res.headersSent) res.status(500).end();
  });
  archive.pipe(res);

  for (const f of validFiles) {
    const folder = folders[f];
    const nameInZip = folder ? `${folder}/${f}` : f;
    archive.file(join(OUTPUT_DIR, f), { name: nameInZip });
  }

  return archive.finalize();
}

function getValidFiles(files) {
  return files.filter(f => existsSync(join(OUTPUT_DIR, f)));
}

// POST /api/zip-download
router.post('/zip-download', async (req, res) => {
  let files;
  try { files = JSON.parse(req.body.files); } catch { files = []; }
  let folders = {};
  try { if (req.body.folders) folders = JSON.parse(req.body.folders); } catch {}
  const zipName = req.body.zipName || 'screenshots.zip';

  if (!files.length) return res.status(400).send('No files');
  const validFiles = getValidFiles(files);
  if (!validFiles.length) return res.status(404).send('No files found');

  await createZipResponse(res, validFiles, zipName, folders);
});

// GET /api/zip
router.get('/zip', async (req, res) => {
  const files = (req.query.files || '').split(',').filter(Boolean);
  const zipName = req.query.name || 'screenshots.zip';

  if (!files.length) return res.status(400).json({ error: 'files required' });
  const validFiles = getValidFiles(files);
  if (!validFiles.length) return res.status(404).json({ error: 'no files found' });

  await createZipResponse(res, validFiles, zipName);
});

// POST /api/zip
router.post('/zip', async (req, res) => {
  const { files, zipName } = req.body;
  if (!files?.length) return res.status(400).json({ error: 'files required' });

  const validFiles = getValidFiles(files);
  if (!validFiles.length) return res.status(404).json({ error: 'no files found' });

  await createZipResponse(res, validFiles, zipName || 'screenshots.zip');
});

export default router;
