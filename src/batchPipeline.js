// ESM module — batch generation per language
import { generateImage, generateText, describeFace, editImage } from './assetGenerator.js';
import { renderTemplate, getTemplateDimensions } from './renderer.js';
import { captureScreenshot } from './screenshotEngine.js';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadPrompts() {
  const p = join(__dirname, '../config/prompts.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : {};
}

function loadFieldConfig() {
  const p = join(__dirname, '../config/template-fields.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : {};
}

const TEMPLATE_DEFS = {
  lifestyle: {
    template: { template_code: 'lifestyle', name: 'Lifestyle' },
    images: [
      { key: 'img1', promptKey: 'img1_prompt', aspectRatio: '9:16' },
    ],
  },
  minimal: {
    template: { template_code: 'minimal', name: 'Minimal' },
    images: [
      { key: 'img1', promptKey: 'img1_prompt', aspectRatio: '9:16' },
    ],
  },
  bold: {
    template: { template_code: 'bold', name: 'Bold' },
    images: [
      { key: 'img1', promptKey: 'img1_prompt', aspectRatio: '9:16' },
    ],
  },
  template2: {
    template: { template_code: 'template2', name: 'Template 2' },
    images: [
      { key: 'main_image', promptKey: 'main_image_prompt', aspectRatio: '9:16' },
      { key: 'circle_image', promptKey: 'circle_image_prompt', aspectRatio: '1:1' },
    ],
  },
};

const COLOR_CSS = (start, end) => `<style>
:root{--accent-start:${start};--accent-end:${end};}
.frame,.template-bg,.figma-bg{background:linear-gradient(180deg,#000 20.715%,${start} 55.485%,${end} 99.469%)!important;}
.title,.template-title,.figma-title{background:linear-gradient(90deg,${start},${end})!important;-webkit-background-clip:text!important;background-clip:text!important;-webkit-text-fill-color:transparent!important;}
[class*="img"],[class*="frame"],[class*="container"],[class*="block"],[class*="photo"],[class*="rect"],.before-rect,.main-frame,.circle-frame{border-color:${end}!important;}
.red-bg-bar,.prompt-rect,.desc-bg{background:${start}!important;}
.swatch-overlay,.main-img-overlay-left{background:color-mix(in srgb,${end} 26%,transparent)!important;}
.swatch-overlay2,.main-img-overlay-right{background:color-mix(in srgb,${start} 26%,transparent)!important;}
.swatch-center-container{border-color:${end}!important;}
</style>`;

export async function processBatchLanguage(lang, values, templateCode = 'tmpl1', featureName = '') {
  let config = TEMPLATE_DEFS[templateCode];

  // If no hardcoded config, build from dynamic field config
  if (!config) {
    const dynFields = loadFieldConfig()[templateCode];
    if (!dynFields) throw new Error(`Unknown template: ${templateCode}. No field config found.`);
    const imageFields = dynFields.filter(f => f.type === 'image' || f.type === 'upload');
    config = {
      template: { template_code: templateCode, name: templateCode },
      images: imageFields.map(f => ({
        key: f.key,
        promptKey: f.key + '_prompt',
        aspectRatio: f.ratio || '9:16',
      })),
    };
  }

  const { name, country } = lang;

  // 1. Tagline: AI generate or translate custom text
  const adminPrompts = loadPrompts()[templateCode] || {};
  let t1, t2;

  if (values.tagline_mode === 'custom') {
    // Custom mode: use text exactly as user typed
    const ct = values.custom_text || {};
    // Parse custom text and translate to target language
    const rawText = ct.tagline || ct.text_1 || ct.title_line1 || '';
    if (rawText) {
      const translated = await generateText(`Translate to ${name}. Keep same meaning, same number of words, short and catchy. Return ONLY the translated text, no quotes, no explanation: "${rawText}"`);
      t1 = translated.replace(/^["']|["']$/g, '').replace(/\n/g, ' ').trim();
    } else {
      t1 = '';
    }
    t2 = '';
    // Translate other custom fields too
    if (ct) {
      const translatedFields = {};
      for (const [k, v] of Object.entries(ct)) {
        if (v && k !== 'tagline' && k !== 'text_1' && k !== 'title_line1') {
          const tr = await generateText(`Translate to ${name}. Keep same meaning, natural tone. Return ONLY the translated text, no quotes: "${v}"`);
          translatedFields[k] = tr.replace(/^["']|["']$/g, '').trim();
        }
      }
      values._customFields = translatedFields;
    }
  } else {
    // AI mode: generate tagline from admin prompt
    const taglinePrompt = adminPrompts.tagline_prompt || '';
    let taglineGenPrompt;
    if (taglinePrompt) {
      taglineGenPrompt = taglinePrompt
        .replace(/\{lang\}/gi, name)
        .replace(/\{feature\}/gi, featureName || 'app feature')
        .replace(/\{template\}/gi, templateCode);
      // If admin prompt doesn't mention language, append it
      if (!taglinePrompt.match(/\{lang\}/i)) {
        taglineGenPrompt += ` Language: ${name}.`;
      }
    } else {
      taglineGenPrompt = `App store screenshot tagline for "${featureName || 'app feature'}". Language: ${name}. 3-6 words, single line. Short and catchy. No quotes, no explanation. Return ONLY the tagline.`;
    }
    const taglineRaw = await generateText(taglineGenPrompt);
    // Single line tagline — CSS will handle wrapping at 1000px
    t1 = taglineRaw.replace(/["*\n]/g, ' ').replace(/\s+/g, ' ').trim();
    t2 = '';
  }

  // 2. Generate localized images — handle face refs
  // Build ref map: slotKey -> refSlotKey (e.g. "circle_image_ref" -> "main_image")
  const refMap = {};
  config.images.forEach(slot => {
    const refKey = slot.promptKey.replace('_prompt', '_ref');
    const refVal = adminPrompts[refKey];
    if (refVal && refVal !== 'none') refMap[slot.key] = refVal;
  });

  // Separate: slots without refs first, then slots with refs
  const noRefSlots = config.images.filter(s => !refMap[s.key]);
  const refSlots = config.images.filter(s => refMap[s.key]);

  // Generate non-ref images first (in parallel)
  const imageResultMap = {};
  const noRefResults = await Promise.all(
    noRefSlots.map(async slot => {
      const basePrompt = adminPrompts[slot.promptKey] || values[slot.promptKey] || 'portrait photo, professional photography';
      const prompt = `${country} ${basePrompt}`;
      const result = await generateImage(prompt, slot.aspectRatio);
      imageResultMap[slot.key] = result;
      return result;
    })
  );

  // Generate ref images sequentially: use editImage to keep person 100% identical
  for (const slot of refSlots) {
    const refTarget = refMap[slot.key]; // e.g. "image_1"
    const refResult = imageResultMap[refTarget];
    const basePrompt = adminPrompts[slot.promptKey] || values[slot.promptKey] || '';

    if (refResult?.path) {
      try {
        // Use editImage: edit the ref image directly, keeping person identical
        const result = await editImage(refResult.path, basePrompt, slot.aspectRatio);
        imageResultMap[slot.key] = result;
        continue;
      } catch (err) {
        console.warn(`editImage failed for ${slot.key}, falling back to describeFace:`, err.message);
      }
    }

    // Fallback: describe face + generate new image
    let faceDesc = '';
    if (refResult?.path) {
      try {
        faceDesc = await describeFace(refResult.path);
      } catch (err) {
        console.warn(`Face describe failed for ref ${refTarget}:`, err.message);
      }
    }
    const refPrefix = faceDesc
      ? `IMPORTANT: The person must have these exact facial features: ${faceDesc}. `
      : '';
    const prompt = `${refPrefix}${country} ${basePrompt || 'portrait photo, professional photography'}`;
    const result = await generateImage(prompt, slot.aspectRatio);
    imageResultMap[slot.key] = result;
  }

  // 3. Build assets
  const cleanT1 = t1.replace(/^["']|["']$/g, '');
  const cleanT2 = t2.replace(/^["']|["']$/g, '');
  const fullTagline = cleanT1 + (cleanT2 ? ' ' + cleanT2 : '');
  const assets = {
    title_line1: cleanT1,
    title_line2: cleanT2,
    tagline: fullTagline,
  };

  // Map tagline to all text/tagline fields in dynamic config
  const dynFields = loadFieldConfig()[templateCode] || [];
  const textFields = dynFields.filter(f => f.type === 'text' || f.type === 'tagline');
  textFields.forEach((f, i) => {
    if (f.key === 'description') return;
    if (!assets[f.key]) {
      assets[f.key] = fullTagline;
    }
  });

  // Add any extra custom text fields
  if (values._customFields) {
    Object.entries(values._customFields).forEach(([k, v]) => {
      assets[k] = v; // custom values override AI generated
    });
  }

  // Generate description if field exists and admin has a prompt
  const descField = dynFields.find(f => f.key === 'description');
  if (descField && !assets.description) {
    const descPrompt = adminPrompts.description_prompt || '';
    if (descPrompt) {
      let dp = descPrompt.replace(/\{lang\}/gi, name).replace(/\{feature\}/gi, featureName || 'app');
      if (!descPrompt.match(/\{lang\}/i)) dp += ` Language: ${name}.`;
      const descText = await generateText(dp);
      assets.description = descText.replace(/^["']|["']$/g, '');
    }
  }
  config.images.forEach(slot => {
    assets[slot.key] = imageResultMap[slot.key];
  });

  // 4. Render HTML
  let html = renderTemplate(config.template, assets);
  html = html.replace('</head>', COLOR_CSS(values.accent_start || '#ff5858', values.accent_end || '#f9a3a3') + '</head>');

  // Inject text wrap CSS
  const wrapCSS = `<style>
    .title,.tagline,.template-title,.figma-title {
      white-space:normal!important;
      width:1000px!important;
      max-width:1000px!important;
    }
    [class*="img-inner"],[class*="img-block"] > div {
      position:absolute!important;
      left:0!important;top:0!important;right:0!important;bottom:0!important;
      width:100%!important;height:100%!important;
      transform:none!important;
    }
    [class*="img-inner"] div,[class*="img-inner"] > div > div {
      position:absolute!important;
      left:0!important;top:0!important;
      width:100%!important;height:100%!important;
      transform:none!important;
    }
    [class*="img-inner"] img,[class*="img-block"] img {
      width:100%!important;height:100%!important;object-fit:cover!important;
    }
  </style>`;
  html = html.replace('</head>', wrapCSS + '</head>');

  // Inject font override if provided
  if (values.font) {
    const fontCSS = `<link href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(values.font)}:wght@400;600;700;800&display=swap" rel="stylesheet">
    <style>.title,.tagline,.content,.frame{font-family:'${values.font}',sans-serif!important;}</style>`;
    html = html.replace('</head>', fontCSS + '</head>');
  }

  // 5. Screenshot
  const safeName = featureName ? featureName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') : '';
  const jobId = safeName
    ? `${safeName}_${templateCode}_${lang.code}_${Date.now()}`
    : `batch_${templateCode}_${lang.code}_${Date.now()}`;
  const dims = getTemplateDimensions(templateCode);
  const result = await captureScreenshot(html, jobId, dims);

  return { filename: result.filename, url: `/api/output/${result.filename}` };
}
