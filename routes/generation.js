import { Router } from 'express';
import { basename } from 'path';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';
import multer from 'multer';
import { createJob, getJob, getAllJobs } from '../src/jobManager.js';
import { runPipeline } from '../src/pipeline.js';
import { generateImage, editImage, generateFromReference } from '../src/assetGenerator.js';
import { processBatchLanguage } from '../src/batchPipeline.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const router = Router();
const upload = multer({ dest: 'uploads/' });

// In-memory batch store
const batches = {};

// GET /api/test-imagen — debug endpoint
router.get('/test-imagen', async (req, res) => {
  const prompt = req.query.p || 'a beautiful landscape with mountains and blue sky';
  try {
    const result = await generateImage(prompt, '9:16');
    res.json({ ok: true, prompt, url: `/api/cache/${basename(result.path)}` });
  } catch (err) {
    res.json({ ok: false, prompt, error: err.message });
  }
});

// GET /api/debug-env
router.get('/debug-env', (req, res) => {
  res.json({ PORT: process.env.PORT, NODE_ENV: process.env.NODE_ENV });
});

// GET /api/test-batch-prompt — test with exact batch logic
router.get('/test-batch-prompt', async (req, res) => {
  const tpl = req.query.tpl || 'template6';
  try {
    const { readFileSync, existsSync } = await import('fs');
    const { join } = await import('path');
    const promptsPath = join(process.cwd(), 'config', 'prompts.json');
    const fieldsPath = join(process.cwd(), 'config', 'template-fields.json');

    const prompts = existsSync(promptsPath) ? JSON.parse(readFileSync(promptsPath, 'utf-8')) : {};
    const fields = existsSync(fieldsPath) ? JSON.parse(readFileSync(fieldsPath, 'utf-8')) : {};

    const adminPrompts = prompts[tpl] || {};
    const dynFields = fields[tpl] || [];
    const imageFields = dynFields.filter(f => f.type === 'image' || f.type === 'upload');

    const firstSlot = imageFields[0];
    if (!firstSlot) return res.json({ ok: false, error: 'No image fields found', tpl, adminPrompts: Object.keys(adminPrompts), dynFields });

    const promptKey = firstSlot.key + '_prompt';
    const basePrompt = adminPrompts[promptKey] || 'portrait photo';
    const fullPrompt = `English ${basePrompt}`;

    res.json({
      ok: 'testing',
      promptKey,
      promptLength: fullPrompt.length,
      fullPrompt,
      generating: true
    });

  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

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

// POST /api/gen-from-ref-image — upload a reference image, analyze & generate new assets
router.post('/gen-from-ref-image', upload.single('ref_image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No reference image uploaded' });

  const aspectRatio = req.body.aspectRatio || '9:16';
  const extraPrompt = req.body.extraPrompt || '';

  try {
    const refPath = req.file.path;
    const result = await generateFromReference(refPath, aspectRatio, extraPrompt);
    res.json({
      tagline: result.tagline,
      original_tagline: result.analysis.tagline,
      background_color: result.background_color,
      layout: result.analysis.layout_description,
      images: result.images.map(img => ({
        id: img.id,
        position: img.position,
        url: `/api/cache/${basename(img.path)}`,
      })),
    });
  } catch (err) {
    console.error('gen-from-ref-image error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/upload-asset — upload an image for use in batch generation
router.post('/upload-asset', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const filePath = req.file.path.replace(/\\/g, '/');
  res.json({ path: filePath, url: `/${filePath}` });
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
        job._intermediateAssets = result._intermediateAssets;
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

// GET /api/batch/:id/assets/:langCode — get intermediate assets for retry
router.get('/batch/:id/assets/:langCode', (req, res) => {
  const batch = batches[req.params.id];
  if (!batch) return res.status(404).json({ error: 'Batch not found' });
  const job = batch.jobs.find(j => j.code === req.params.langCode);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (!job._intermediateAssets) return res.status(404).json({ error: 'No intermediate assets' });
  res.json({
    tagline: job._intermediateAssets.tagline,
    imageSlots: Object.keys(job._intermediateAssets.images || {}),
  });
});

// POST /api/gen-retry — retry specific parts of a completed batch job
router.post('/gen-retry', (req, res) => {
  const { batchId, langCode, retryParts, values, templateCode, featureName } = req.body;
  if (!batchId || !langCode || !retryParts?.length) {
    return res.status(400).json({ error: 'batchId, langCode, retryParts required' });
  }

  const origBatch = batches[batchId];
  if (!origBatch) return res.status(404).json({ error: 'Original batch not found' });
  const origJob = origBatch.jobs.find(j => j.code === langCode);
  if (!origJob) return res.status(404).json({ error: 'Original job not found' });

  const previousAssets = origJob._intermediateAssets || null;
  const tplCode = templateCode || origBatch.templateCode;

  // Create a new single-job batch for the retry
  const retryBatchId = uuid();
  const lang = { code: origJob.code, name: origJob.name, country: origJob.country || origJob.name };
  const retryBatch = {
    id: retryBatchId,
    status: 'processing',
    templateCode: tplCode,
    isRetry: true,
    jobs: [{ ...lang, status: 'pending', url: null, error: null }]
  };
  batches[retryBatchId] = retryBatch;

  (async () => {
    const job = retryBatch.jobs[0];
    job.status = 'processing';
    try {
      const result = await processBatchLanguage(job, values, tplCode, featureName || '', {
        retryParts,
        previousAssets,
      });
      job.status = 'completed';
      job.url = result.url;
      job._intermediateAssets = result._intermediateAssets;

      // Update original batch job too so next retry uses latest assets
      origJob.url = result.url;
      origJob._intermediateAssets = result._intermediateAssets;
    } catch (err) {
      job.status = 'failed';
      job.error = err.message;
      console.error(`Retry ${retryBatchId} [${job.code}] failed:`, err.message);
    }
    retryBatch.status = 'completed';
  })().catch(console.error);

  res.json({ batchId: retryBatchId });
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
