// ESM module
import { readFileSync } from 'fs';
import { join } from 'path';

const PORT = process.env.PORT || 3000;

// Template configs: placeholders + dimensions
const TEMPLATE_META = {
  t1: { width: 1080, height: 1920, placeholders: ['title_line1', 'title_line2', 'main_image', 'circle_image'] },
  t2: { width: 1080, height: 1920, placeholders: ['title_line1', 'title_line2', 'main_image', 'before_image', 'prompt_text'] },
  t3: { width: 1080, height: 1920, placeholders: ['title_line1', 'title_line2', 'image_1', 'image_2', 'image_3', 'image_4'] },
  figma1:{ width: 1080, height: 1920, placeholders: ['title_line1', 'title_line2', 'main_image', 'circle_image'] },
  tmpl1: { width: 1080, height: 1920, placeholders: ['title_line1', 'title_line2', 'main_image', 'circle_image'] },
  tmpl4: { width: 1080, height: 1920, placeholders: ['title_line1', 'title_line2', 'img1', 'img2', 'img3', 'img4'] },
  template2:{ width: 1080, height: 1920, placeholders: ['title_line1', 'title_line2', 'main_image', 'circle_image'] },
  restyle:{ width: 1242, height: 2688, placeholders: ['tagline', 'img1'] },
  lifestyle:{ width: 1242, height: 2688, placeholders: ['img1', 'tagline', 'background', 'ui'] },
  minimal: { width: 1242, height: 2688, placeholders: ['img1', 'tagline', 'background', 'ui'] },
  bold:    { width: 1242, height: 2688, placeholders: ['img1', 'tagline', 'background', 'ui'] },
  hair:    { width: 1080, height: 1920, placeholders: ['image_1', 'image_2', 'image_3', 'text_1'] },
  mockup:  { width: 1080, height: 1920, placeholders: ['image_1', 'image_2', 'text_1'] },
  i2i:     { width: 1080, height: 1920, placeholders: ['image_1', 'image_2', 'text_1'] },
  multistyle: { width: 1080, height: 1920, placeholders: ['image_1', 'image_2', 'image_3', 'image_4', 'image_5', 'image_6', 'image_7', 'image_8', 'text_1'] },
  filter:  { width: 1080, height: 1920, placeholders: ['image_1', 'text_1'] },
  '2i2i':  { width: 1080, height: 1920, placeholders: ['image_1', 'image_2', 'image_3', 'text_1'] },
  '2i2i1': { width: 1080, height: 1920, placeholders: ['image_1', 'image_2', 'image_3', 'text_1'] },
  makeup:  { width: 1080, height: 1920, placeholders: ['image_1', 'image_2', 'text_1'] },
  ti2v:    { width: 1080, height: 1920, placeholders: ['image_1', 'image_2', 'text_1', 'description'] },
  i2i1:    { width: 1080, height: 1920, placeholders: ['image_1', 'image_2', 'text_1'] },
};

export function getTemplateDimensions(templateCode) {
  return TEMPLATE_META[templateCode] || { width: 1080, height: 1920 };
}

export function renderTemplate(template, assets) {
  const code = template.template_code;
  const layoutPath = join('./templates', code, 'layout.html');
  let html = readFileSync(layoutPath, 'utf-8');

  // Inject <base> tag so CSS/SVG/fonts resolve correctly when loaded by Puppeteer
  const baseHref = `http://localhost:${PORT}/templates/${code}/`;
  html = html.replace(/(<head[^>]*>)/i, `$1\n  <base href="${baseHref}">`);

  // Replace all {{key}} placeholders
  for (const [key, value] of Object.entries(assets)) {
    if (value === null || value === undefined) continue;

    let replacement;
    if (typeof value === 'object' && value.type === 'file') {
      // Convert file to base64 data URI
      const imgData = readFileSync(value.path);
      replacement = `data:image/png;base64,${imgData.toString('base64')}`;
    } else {
      replacement = String(value);
    }
    html = html.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), replacement);
  }

  // Legacy field mappings for old templates
  if (assets.img1) {
    const v = assets.img1;
    const src = (typeof v === 'object' && v.type === 'file')
      ? `data:image/png;base64,${readFileSync(v.path).toString('base64')}`
      : String(v);
    html = html.replace(/\{\{img1\}\}/g, src);
  }
  if (assets.background) html = html.replace(/\{\{background\}\}/g, assets.background);
  if (assets.tagline)    html = html.replace(/\{\{tagline\}\}/g, assets.tagline);
  if (assets.ui) {
    const uiData = readFileSync(assets.ui);
    html = html.replace(/\{\{ui\}\}/g, `data:image/png;base64,${uiData.toString('base64')}`);
  }

  return html;
}
