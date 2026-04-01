import { Router } from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync } from 'fs';
import { generateColorCSS, generateWrapCSS, generateFontCSS } from '../utils/cssGenerator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const router = Router();

function loadPrompts() {
  const p = join(__dirname, '..', 'config', 'prompts.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : {};
}

function loadFields() {
  const p = join(__dirname, '..', 'config', 'template-fields.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : {};
}

// GET /preview/:template_code
router.get('/:template_code', (req, res) => {
  const { template_code } = req.params;
  const layoutPath = join(__dirname, '..', 'templates', template_code, 'layout.html');

  if (!existsSync(layoutPath)) return res.status(404).send('Template not found');

  let html = readFileSync(layoutPath, 'utf-8');
  html = html.replace('href="styles.css"', `href="/templates/${template_code}/styles.css"`);

  // Load demo text from prompts config
  const prompts = loadPrompts();
  const tplPrompts = prompts[template_code] || {};
  const demoTagline = tplPrompts.demo_tagline || '';
  const demoAppName = tplPrompts.demo_app_name || '';

  // Inline local template files: {{file:filename}} → base64 data URI
  const templateDir = join(__dirname, '..', 'templates', template_code);
  html = html.replace(/\{\{file:([^}]+)\}\}/g, (match, filename) => {
    const filePath = join(templateDir, filename);
    if (existsSync(filePath)) {
      const data = readFileSync(filePath);
      const ext = filename.split('.').pop().toLowerCase();
      const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
      return `data:${mime};base64,${data.toString('base64')}`;
    }
    return match;
  });

  // Parse query params, fall back to demo text
  const rawTitle = req.query.title || '';
  let t1, t2;
  if (rawTitle) {
    const lines = rawTitle.split('\n').map(l => l.trim()).filter(Boolean);
    t1 = lines[0] || '';
    t2 = lines.slice(1).join('<br>') || '';
  } else if (req.query.t1) {
    t1 = req.query.t1;
    t2 = req.query.t2 || '';
  } else if (demoTagline) {
    const lines = demoTagline.split(/\\n|\n/).map(l => l.trim()).filter(Boolean);
    t1 = lines[0] || '';
    t2 = lines.slice(1).join('<br>') || '';
  } else {
    t1 = '';
    t2 = '';
  }

  const demoImages = [
    'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?w=800&q=80',
    'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=800&q=80',
    'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=800&q=80',
    'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=800&q=80',
    'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=800&q=80',
    'https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?w=800&q=80',
    'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=800&q=80',
    'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=800&q=80',
  ];
  const mainImg = req.query.main || demoImages[0];
  const beforeImg = req.query.before || demoImages[1];
  const color = req.query.color || '#6C63FF';
  const accentStart = req.query.accent_start || '';
  const accentEnd = req.query.accent_end || '';

  // Build demo title text for fallback
  const titleText = t1 ? (t1 + (t2 ? '<br>' + t2 : '')) : '';

  // Load field labels for image overlay
  const fieldConfig = loadFields();
  const fields = fieldConfig[template_code] || [];
  const fieldLabelMap = {};
  fields.forEach(f => { fieldLabelMap[f.key] = f.label || f.key; });

  // Helper: replace image placeholder and add data-field-key + title to parent <img>
  function replaceImagePlaceholder(h, key, url) {
    const label = fieldLabelMap[key] || key;
    // Match src="{{key}}" and add data attributes
    h = h.replace(new RegExp(`(src=["'])\\{\\{${key}\\}\\}(["'])`, 'g'), `$1${url}$2 data-field-key="${key}" title="${label}"`);
    // Also replace standalone {{key}} (e.g. in background or other attributes)
    h = h.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), url);
    return h;
  }

  // Replace known placeholders
  html = html
    .replace(/\{\{title_line1\}\}/g, t1)
    .replace(/\{\{title_line2\}\}/g, t2)
    .replace(/\{\{prompt_text\}\}/g, '');

  // Replace image placeholders with labels
  const imageKeys = ['main_image', 'before_image', 'circle_image', 'img1', 'img2', 'img3', 'img4'];
  const imageDefaults = {
    main_image: mainImg, before_image: beforeImg, circle_image: beforeImg,
    img1: mainImg, img2: mainImg, img3: mainImg, img4: mainImg,
  };
  imageKeys.forEach(key => {
    html = replaceImagePlaceholder(html, key, imageDefaults[key] || mainImg);
  });

  html = html.replace(/\{\{background\}\}/g, color);

  // Replace dynamic image fields from field config (with labels)
  let imgIdx = 0;
  fields.filter(f => f.type === 'image' || f.type === 'upload').forEach(f => {
    const url = req.query[f.key] || demoImages[imgIdx % demoImages.length];
    imgIdx++;
    html = replaceImagePlaceholder(html, f.key, url);
  });

  // Replace remaining {{...}} placeholders
  const defaultTitle = titleText || 'Your Look<br>Today';
  let remainImgIdx = 0;
  html = html.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (req.query[key]) return req.query[key];
    if (key === 'app_name') return demoAppName || 'App Name';
    if (key === 'tagline') return defaultTitle;
    if (key.startsWith('text_')) return defaultTitle;
    if (key === 'description') return 'Amazing AI-powered transformation';
    if (key.includes('image') || key.includes('img') || key.includes('photo')) {
      return demoImages[(remainImgIdx++) % demoImages.length];
    }
    return '';
  });

  // Inject CSS overrides
  const fontCSS = generateFontCSS(req.query.font);
  const wrapCSS = generateWrapCSS();
  const colorCSS = (accentStart || accentEnd || color) ? generateColorCSS(accentStart, accentEnd) : '';

  // Inject image label overlay CSS + JS (skip if no_labels=1 for screenshot mode)
  const showLabels = req.query.no_labels !== '1';
  const fieldLabelsJSON = JSON.stringify(fieldLabelMap).replace(/</g, '\\u003c');
  const labelOverlay = !showLabels ? '' : `
  <style>
    [data-field-key]{cursor:pointer}
    .field-label-overlay{position:absolute;top:8px;left:8px;padding:4px 10px;background:rgba(0,0,0,.75);backdrop-filter:blur(4px);color:#fff;font-size:13px;font-weight:600;border-radius:6px;pointer-events:none;opacity:0;transition:opacity .2s;z-index:999;font-family:'Inter',system-ui,sans-serif;white-space:nowrap;letter-spacing:.3px}
    .field-label-parent:hover .field-label-overlay{opacity:1}
  </style>
  <script>
  document.addEventListener('DOMContentLoaded', function(){
    var labels = ${fieldLabelsJSON};
    document.querySelectorAll('[data-field-key]').forEach(function(img){
      var key = img.getAttribute('data-field-key');
      var label = labels[key] || key;
      var parent = img.parentElement;
      if(parent){
        parent.classList.add('field-label-parent');
        if(getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
        var overlay = document.createElement('div');
        overlay.className = 'field-label-overlay';
        overlay.textContent = label;
        parent.appendChild(overlay);
      }
    });
  });
  </script>`;

  html = html.replace('</head>', fontCSS + wrapCSS + colorCSS + labelOverlay + '</head>');

  res.send(html);
});

export default router;
