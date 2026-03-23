import { Router } from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readdirSync, statSync, existsSync } from 'fs';
import { loadData, saveData, loadFields, saveFields, loadPrompts, savePrompts } from '../utils/configManager.js';
import { generateText } from '../src/assetGenerator.js';
import { getTemplates } from '../src/pipeline.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const router = Router();

// GET/POST /api/data
router.get('/data', (req, res) => {
  res.json(loadData());
});

router.post('/data', (req, res) => {
  try {
    saveData(req.body);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET/POST /api/admin/template-fields
router.get('/admin/template-fields', (req, res) => {
  res.json(loadFields());
});

router.post('/admin/template-fields', (req, res) => {
  try {
    saveFields(req.body);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET/POST /api/admin/prompts
router.get('/admin/prompts', (req, res) => {
  res.json(loadPrompts());
});

router.post('/admin/prompts', (req, res) => {
  try {
    savePrompts(req.body);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/templates
router.get('/templates', (req, res) => {
  res.json(getTemplates());
});

// GET /api/available-templates
router.get('/available-templates', (req, res) => {
  const tplRoot = join(__dirname, '..', 'templates');
  try {
    const dirs = readdirSync(tplRoot).filter(d => {
      const p = join(tplRoot, d);
      return statSync(p).isDirectory() && existsSync(join(p, 'layout.html'));
    });
    res.json(dirs);
  } catch {
    res.json([]);
  }
});

// GET /api/admin/template-defs
router.get('/admin/template-defs', (req, res) => {
  const IMAGE_SLOTS = {
    lifestyle: [{ key: 'img1', promptKey: 'img1_prompt', label: 'Person image', ratio: '9:16' }],
    minimal: [{ key: 'img1', promptKey: 'img1_prompt', label: 'Person image', ratio: '9:16' }],
    bold: [{ key: 'img1', promptKey: 'img1_prompt', label: 'Hero image', ratio: '9:16' }],
    template2: [
      { key: 'main_image', promptKey: 'main_image_prompt', label: 'Main image', ratio: '9:16' },
      { key: 'circle_image', promptKey: 'circle_image_prompt', label: 'Circle image', ratio: '1:1' },
    ],
    tmpl1: [
      { key: 'main_image', promptKey: 'main_image_prompt', label: 'Main image', ratio: '9:16' },
      { key: 'circle_image', promptKey: 'circle_image_prompt', label: 'Circle image', ratio: '1:1' },
    ],
    tmpl4: [
      { key: 'img1', promptKey: 'img1_prompt', label: 'Photo 1 — top left', ratio: '3:4' },
      { key: 'img2', promptKey: 'img2_prompt', label: 'Photo 2 — bottom left', ratio: '3:4' },
      { key: 'img3', promptKey: 'img3_prompt', label: 'Photo 3 — top right', ratio: '3:4' },
      { key: 'img4', promptKey: 'img4_prompt', label: 'Photo 4 — bottom right', ratio: '3:4' },
    ],
  };

  const fieldConfig = loadFields();
  const templates = getTemplates();
  const tplRoot = join(__dirname, '..', 'templates');
  const allCodes = new Set(templates.map(t => t.template_code));

  try {
    readdirSync(tplRoot).forEach(d => {
      if (!allCodes.has(d) && statSync(join(tplRoot, d)).isDirectory() && existsSync(join(tplRoot, d, 'layout.html'))) {
        templates.push({ template_code: d, name: d, description: '' });
      }
    });
  } catch {}

  const result = templates.map(t => {
    const dynFields = fieldConfig[t.template_code];
    let slots;
    if (dynFields) {
      slots = dynFields.filter(f => f.type === 'image').map(f => ({
        key: f.key,
        promptKey: f.key + '_prompt',
        label: f.label || f.key,
        ratio: f.ratio || '9:16',
      }));
    } else {
      slots = IMAGE_SLOTS[t.template_code] || [];
    }
    return { code: t.template_code, name: t.name, description: t.description, slots };
  });

  res.json(result);
});

// POST /api/gen-tagline
router.post('/gen-tagline', async (req, res) => {
  const { templateCode, featureName, lang } = req.body;
  if (!templateCode) return res.status(400).json({ error: 'templateCode is required' });

  try {
    const adminPrompts = loadPrompts();
    const taglinePrompt = (adminPrompts[templateCode] || {}).tagline_prompt || '';
    const langName = lang || 'English';
    const feature = featureName || 'app feature';

    let prompt;
    if (taglinePrompt) {
      prompt = taglinePrompt
        .replace(/\{lang\}/gi, langName)
        .replace(/\{feature\}/gi, feature)
        .replace(/\{template\}/gi, templateCode);
    } else {
      prompt = `Generate a short, compelling app store screenshot tagline for a "${feature}" feature. Language: ${langName}. STRICT RULE: Each line must be max 22 characters. Output exactly 2 lines. Benefit-focused and action-oriented. Return ONLY the tagline text, no quotes, no explanation.`;
    }

    const tagline = await generateText(prompt);
    res.json({ tagline });
  } catch (err) {
    console.error('gen-tagline error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
