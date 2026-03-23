import { Router } from 'express';
import { basename } from 'path';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';
import { createJob, getJob, getAllJobs } from '../src/jobManager.js';
import { runPipeline } from '../src/pipeline.js';
import { generateImage, editImage } from '../src/assetGenerator.js';
import { processBatchLanguage } from '../src/batchPipeline.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const router = Router();

// In-memory batch store
const batches = {};

// POST /api/gen-image
router.post('/gen-image', async (req, res) => {
  const { prompt, aspectRatio } = req.body;
  if (!prompt?.trim()) return res.status(400).json({ error: 'prompt is required' });

  const validRatios = ['1:1', '9:16', '16:9', '3:4', '4:3'];
  const ratio = validRatios.includes(aspectRatio) ? aspectRatio : '9:16';

  try {
    const result = await generateImage(prompt.trim(), ratio);
    res.json({ url: `/api/cache/${basename(result.path)}` });
  } catch (err) {
    console.error('gen-image error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/gen-variation
router.post('/gen-variation', async (req, res) => {
  const { refImageUrl, aspectRatio, modification } = req.body;
  if (!refImageUrl) return res.status(400).json({ error: 'refImageUrl is required' });
  if (!modification) return res.status(400).json({ error: 'modification is required' });

  try {
    const refPath = join(__dirname, '..', refImageUrl.replace(/^\//, ''));
    if (!existsSync(refPath)) return res.status(404).json({ error: 'Reference image not found' });

    const ratio = ['1:1', '9:16', '16:9', '3:4', '4:3'].includes(aspectRatio) ? aspectRatio : '9:16';
    const result = await editImage(refPath, modification, ratio);
    res.json({ url: `/api/cache/${basename(result.path)}` });
  } catch (err) {
    console.error('gen-variation error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/gen-batch
router.post('/gen-batch', (req, res) => {
  const { languages, values, templateCode = 'tmpl1', featureName = '' } = req.body;
  console.log('[gen-batch] template:', templateCode, '| tagline_mode:', values?.tagline_mode, '| langs:', languages?.map(l => l.code).join(','));
  if (!languages?.length) return res.status(400).json({ error: 'languages required' });

  const batchId = uuid();
  const batch = {
    id: batchId,
    status: 'processing',
    templateCode,
    jobs: languages.map(l => ({ ...l, status: 'pending', url: null, error: null }))
  };
  batches[batchId] = batch;

  (async () => {
    for (const job of batch.jobs) {
      job.status = 'processing';
      try {
        const result = await processBatchLanguage(job, values, templateCode, featureName);
        job.status = 'completed';
        job.url = result.url;
      } catch (err) {
        job.status = 'failed';
        job.error = err.message;
        console.error(`Batch ${batchId} [${job.code}] failed:`, err.message, err.stack);
      }
    }
    batch.status = 'completed';
  })().catch(console.error);

  res.json({ batchId });
});

// GET /api/batch/:id
router.get('/batch/:id', (req, res) => {
  const batch = batches[req.params.id];
  if (!batch) return res.status(404).json({ error: 'Batch not found' });
  res.json(batch);
});

// POST /api/generate
router.post('/generate', async (req, res) => {
  try {
    const { template_code, background_color, tagline, gender, hairstyle } = req.body;
    if (!template_code) return res.status(400).json({ error: 'template_code is required' });

    const request = {
      template_code,
      background_color: background_color || '#6C63FF',
      tagline: tagline || null,
      variables: { gender, hairstyle },
      ui_image_path: req.file?.path || null
    };

    const job = createJob(request);
    runPipeline(job, request).catch(console.error);
    res.json({ job_id: job.job_id, status: job.status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/jobs/:id
router.get('/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// GET /api/jobs
router.get('/jobs', (req, res) => {
  res.json(getAllJobs());
});

export default router;
