import { Router } from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import multer from 'multer';
import { loadFields, saveFields, loadPrompts, savePrompts } from '../utils/configManager.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const upload = multer({ dest: 'uploads/' });
const router = Router();

/**
 * Determine field key from CSS class name.
 */
function classToField(className) {
  const cn = (className || '').toLowerCase();
  if (cn.includes('title') || cn.includes('heading')) return { key: 'tagline', type: 'tagline' };
  if (cn.includes('desc') || cn.includes('sub_text') || cn.includes('sub-text') || cn.includes('prompt') || cn.includes('subtitle') || cn.includes('caption')) return { key: 'description', type: 'text' };
  return null;
}

/**
 * Auto-detect placeholders from HTML and convert elements to {{key}} format.
 */
function autoDetectFields(htmlContent) {
  let finalHtml = htmlContent;
  const autoFields = [];

  const bodyMatch = htmlContent.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyHtml = bodyMatch ? bodyMatch[1] : htmlContent;
  const cleaned = bodyHtml.replace(/<svg[\s\S]*?<\/svg>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');

  // Detect images
  let imgIdx = 0;
  const imgMatches = [...cleaned.matchAll(/<img[^>]*src=["']([^"']+)["'][^>]*>/gi)];
  imgMatches.forEach(m => {
    imgIdx++;
    const key = `image_${imgIdx}`;
    finalHtml = finalHtml.replace(m[1], `{{${key}}}`);
    autoFields.push({ key, type: 'image', label: `Image ${imgIdx}`, ratio: '9:16' });
  });

  const usedOriginals = new Set();

  // Detect containers with <p> children
  const containerRegex = /<(div|section|header|footer|article)([^>]*)>([\s\S]*?)<\/\1>/gi;
  let cm;
  while ((cm = containerRegex.exec(cleaned)) !== null) {
    const attrs = cm[2] || '';
    const inner = cm[3];
    const pTags = [...inner.matchAll(/<p[^>]*>([^<]+)<\/p>/gi)];
    if (pTags.length === 0) continue;
    const allText = pTags.map(p => p[1].trim()).filter(Boolean);
    if (allText.length === 0) continue;

    const classMatch = attrs.match(/class=["']([^"']+)["']/i);
    const fieldInfo = classToField(classMatch?.[1]);
    const fieldKey = fieldInfo?.key || 'text_' + (autoFields.filter(f => f.type === 'text' || f.type === 'tagline').length + 1);
    const fieldType = fieldInfo?.type || 'text';

    if (autoFields.some(f => f.key === fieldKey)) continue;

    pTags.forEach((p, i) => {
      usedOriginals.add(p[1].trim());
      if (i === 0) {
        finalHtml = finalHtml.replace(p[0], `<p>{{${fieldKey}}}</p>`);
      } else {
        finalHtml = finalHtml.replace(p[0], '');
      }
    });
    autoFields.push({ key: fieldKey, type: fieldType, label: fieldKey.replace(/_/g, ' ') });
  }

  // Detect standalone <p> tags
  const standalonePMatches = [...cleaned.matchAll(/<p([^>]*)>([^<]{2,})<\/p>/gi)];
  standalonePMatches.forEach(m => {
    const text = m[2].trim();
    if (!text || usedOriginals.has(text)) return;
    const attrs = m[1] || '';
    const classMatch = attrs.match(/class=["']([^"']+)["']/i);
    const fieldInfo = classToField(classMatch?.[1]);
    const fieldKey = fieldInfo?.key || 'text_' + (autoFields.filter(f => f.type === 'text' || f.type === 'tagline').length + 1);
    const fieldType = fieldInfo?.type || 'text';

    if (autoFields.some(f => f.key === fieldKey)) return;
    usedOriginals.add(text);
    finalHtml = finalHtml.replace(m[0], `<p${m[1]}>{{${fieldKey}}}</p>`);
    autoFields.push({ key: fieldKey, type: fieldType, label: fieldKey.replace(/_/g, ' ') });
  });

  // Detect standalone headings/spans
  const headingMatches = [...cleaned.matchAll(/<(h[1-6]|span)([^>]*)>([^<]{2,})<\/\1>/gi)];
  headingMatches.forEach(m => {
    const text = m[3].trim();
    if (!text || text.length > 200 || usedOriginals.has(text)) return;
    const classMatch = m[2].match(/class=["']([^"']+)["']/i);
    const fieldInfo = classToField(classMatch?.[1]);
    const fieldKey = fieldInfo?.key || 'text_' + (autoFields.filter(f => f.type === 'text' || f.type === 'tagline').length + 1);

    if (autoFields.some(f => f.key === fieldKey)) return;
    usedOriginals.add(text);
    finalHtml = finalHtml.replace(`>${text}<`, `>{{${fieldKey}}}<`);
    autoFields.push({ key: fieldKey, type: 'text', label: fieldKey.replace(/_/g, ' ') });
  });

  return { finalHtml, autoFields };
}

// POST /api/upload-template
router.post('/upload-template', upload.fields([
  { name: 'html', maxCount: 1 },
  { name: 'css', maxCount: 1 },
]), (req, res) => {
  const code = (req.body.code || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (!code) return res.status(400).json({ error: 'Template code is required' });
  if (!req.files?.html?.[0]) return res.status(400).json({ error: 'HTML file is required' });

  const tplDir = join(__dirname, '..', 'templates', code);
  if (!existsSync(tplDir)) mkdirSync(tplDir, { recursive: true });

  const htmlContent = readFileSync(req.files.html[0].path, 'utf-8');
  writeFileSync(join(tplDir, 'layout.html'), htmlContent, 'utf-8');

  if (req.files.css?.[0]) {
    const cssContent = readFileSync(req.files.css[0].path, 'utf-8');
    writeFileSync(join(tplDir, 'styles.css'), cssContent, 'utf-8');
  }

  // Clear old config
  const fc = loadFields();
  delete fc[code];
  saveFields(fc);

  const pc = loadPrompts();
  delete pc[code];
  savePrompts(pc);

  // Auto-detect fields
  let finalHtml = htmlContent;
  let autoFields = [];
  const existingVars = [...htmlContent.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]);

  if (existingVars.length === 0) {
    const result = autoDetectFields(htmlContent);
    finalHtml = result.finalHtml;
    autoFields = result.autoFields;
    writeFileSync(join(tplDir, 'layout.html'), finalHtml, 'utf-8');

    if (autoFields.length > 0) {
      const fc2 = loadFields();
      fc2[code] = autoFields;
      saveFields(fc2);
    }
  }

  const finalVars = [...finalHtml.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]);
  res.json({ ok: true, code, fields: [...new Set(finalVars)], autoFields });
});

// GET /api/scan-template/:code
router.get('/scan-template/:code', (req, res) => {
  const layoutPath = join(__dirname, '..', 'templates', req.params.code, 'layout.html');
  if (!existsSync(layoutPath)) return res.status(404).json({ error: 'Template not found' });
  const html = readFileSync(layoutPath, 'utf-8');
  const vars = [...html.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]);
  res.json({ placeholders: [...new Set(vars)], detected: [] });
});

// POST /api/apply-placeholders/:code
router.post('/apply-placeholders/:code', (req, res) => {
  const code = req.params.code;
  const layoutPath = join(__dirname, '..', 'templates', code, 'layout.html');
  if (!existsSync(layoutPath)) return res.status(404).json({ error: 'Template not found' });

  let html = readFileSync(layoutPath, 'utf-8');
  const { replacements } = req.body;
  if (!replacements?.length) return res.status(400).json({ error: 'No replacements' });

  replacements.forEach(r => {
    if (r.type === 'image' && r.original) {
      html = html.replace(r.original, `{{${r.key}}}`);
    } else if (r.type === 'text') {
      if (r.pTags?.length > 0) {
        r.pTags.forEach((p, i) => {
          if (i === 0) {
            html = html.replace(p.full, `<p>{{${r.key}}}</p>`);
          } else {
            html = html.replace(p.full, '');
          }
        });
      } else if (r.original) {
        html = html.replace(`>${r.original}<`, `>{{${r.key}}}<`);
      }
    }
  });

  writeFileSync(layoutPath, html, 'utf-8');
  res.json({ ok: true });
});

export default router;
