import { Router } from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync } from 'fs';
import { generateColorCSS, generateWrapCSS, generateFontCSS } from '../utils/cssGenerator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const router = Router();

// GET /preview/:template_code
router.get('/:template_code', (req, res) => {
  const { template_code } = req.params;
  const layoutPath = join(__dirname, '..', 'templates', template_code, 'layout.html');

  if (!existsSync(layoutPath)) return res.status(404).send('Template not found');

  let html = readFileSync(layoutPath, 'utf-8');
  html = html.replace('href="styles.css"', `href="/templates/${template_code}/styles.css"`);

  // Parse query params
  const rawTitle = req.query.title || '';
  let t1, t2;
  if (rawTitle) {
    const lines = rawTitle.split('\n').map(l => l.trim()).filter(Boolean);
    t1 = lines[0] || '';
    t2 = lines.slice(1).join('<br>') || '';
  } else {
    t1 = req.query.t1 || '';
    t2 = req.query.t2 || '';
  }

  const mainImg = req.query.main || 'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?w=800&q=80';
  const beforeImg = req.query.before || 'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?w=300&q=80';
  const color = req.query.color || '#6C63FF';
  const accentStart = req.query.accent_start || '';
  const accentEnd = req.query.accent_end || '';

  // Replace known placeholders
  html = html
    .replace(/\{\{title_line1\}\}/g, t1)
    .replace(/\{\{title_line2\}\}/g, t2)
    .replace(/\{\{main_image\}\}/g, mainImg)
    .replace(/\{\{before_image\}\}/g, beforeImg)
    .replace(/\{\{circle_image\}\}/g, beforeImg)
    .replace(/\{\{img1\}\}/g, mainImg)
    .replace(/\{\{img2\}\}/g, mainImg)
    .replace(/\{\{img3\}\}/g, mainImg)
    .replace(/\{\{img4\}\}/g, mainImg)
    .replace(/\{\{background\}\}/g, color)
    .replace(/\{\{prompt_text\}\}/g, '');

  // Replace remaining {{...}} placeholders
  const titleText = t1 ? (t1 + (t2 ? '<br>' + t2 : '')) : '';
  html = html.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (req.query[key]) return req.query[key];
    if (key === 'tagline') return titleText;
    if (key.startsWith('text_')) return titleText;
    if (key.includes('image') || key.includes('img') || key.includes('photo')) return mainImg;
    return '';
  });

  // Inject CSS overrides
  const fontCSS = generateFontCSS(req.query.font);
  const wrapCSS = generateWrapCSS();
  const colorCSS = (accentStart || accentEnd || color) ? generateColorCSS(accentStart, accentEnd) : '';

  html = html.replace('</head>', fontCSS + wrapCSS + colorCSS + '</head>');

  res.send(html);
});

export default router;
