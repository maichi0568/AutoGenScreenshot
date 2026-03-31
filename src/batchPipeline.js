// ESM module — batch generation per language
import { generateImage, generateText, describeFace, editImage } from './assetGenerator.js';
import { renderTemplate, getTemplateDimensions } from './renderer.js';
import { captureScreenshot } from './screenshotEngine.js';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Map language/country name to ethnicity description for accurate image generation
const ETHNICITY_MAP = {
  English: 'Caucasian European',
  Japanese: 'Japanese East Asian',
  Vietnamese: 'Vietnamese Southeast Asian',
  Korean: 'Korean East Asian',
  Chinese: 'Chinese East Asian',
  Thai: 'Thai Southeast Asian',
  German: 'German European',
  French: 'French European',
  Spanish: 'Spanish European',
  Portuguese: 'Brazilian Latin American',
  Indonesian: 'Indonesian Southeast Asian',
  Hindi: 'Indian South Asian',
  Arabic: 'Middle Eastern Arab',
  Turkish: 'Turkish Middle Eastern',
  Russian: 'Russian Eastern European',
  Italian: 'Italian Southern European',
  Dutch: 'Dutch Northern European',
  Polish: 'Polish Eastern European',
  Malay: 'Malay Southeast Asian',
  Swedish: 'Swedish Scandinavian',
};

function getEthnicityInstruction(country) {
  const ethnicity = ETHNICITY_MAP[country] || country;
  return `${ethnicity} person, `;
}

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

// Variation suffixes injected during retry to force different outputs
const IMAGE_VARIATION_HINTS = [
  'different angle and composition, ',
  'alternative pose and framing, ',
  'new creative perspective, ',
  'fresh unique look, ',
  'different lighting and mood, ',
  'varied expression and style, ',
  'alternative artistic direction, ',
  'different background setting, ',
];

const TEXT_VARIATION_HINTS = [
  ' Use completely different wording.',
  ' Be more creative and unexpected.',
  ' Try a fresh angle.',
  ' Use a different tone.',
  ' Make it catchy in a new way.',
  ' Surprise me with something original.',
];

function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// Pick a prompt: if value is an array, pick random; if string, return it
function pickPrompt(val) {
  if (!val) return '';
  if (Array.isArray(val)) return val.length > 0 ? pickRandom(val) : '';
  return val;
}

export async function processBatchLanguage(lang, values, templateCode = 'tmpl1', featureName = '', retryOpts = {}) {
  // retryOpts: { retryParts: ['tagline','img1',...] or ['all'], previousAssets: { tagline, images: { slotKey: result } } }
  const retryParts = retryOpts.retryParts || null; // null = generate all (first run)
  const prevAssets = retryOpts.previousAssets || null;
  const retryAll = !retryParts || retryParts.includes('all');
  const isRetry = retryParts !== null;
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

  console.log(`[batch] uploaded_files:`, JSON.stringify(values.uploaded_files || {}));
  const { name, country } = lang;

  // 1. Tagline: AI generate or translate custom text
  const adminPrompts = loadPrompts()[templateCode] || {};
  let t1, t2;

  const shouldRetryTagline = retryAll || (retryParts && retryParts.includes('tagline'));

  if (!shouldRetryTagline && prevAssets?.tagline) {
    // Reuse previous tagline
    t1 = prevAssets.tagline;
    t2 = '';
    if (prevAssets.customFields) values._customFields = prevAssets.customFields;
  } else if (values.tagline_mode === 'custom') {
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
    const taglinePrompt = pickPrompt(adminPrompts.tagline_prompt);
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
    if (isRetry && shouldRetryTagline) taglineGenPrompt += pickRandom(TEXT_VARIATION_HINTS);
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

  // Helper: should this image slot be regenerated?
  const shouldRetryImage = (slotKey) => retryAll || (retryParts && retryParts.includes(slotKey));

  // Helper: add variation to prompt when retrying to ensure different output
  const varyPrompt = (prompt, slotKey) => {
    if (isRetry && shouldRetryImage(slotKey)) {
      return pickRandom(IMAGE_VARIATION_HINTS) + prompt;
    }
    return prompt;
  };

  // Separate: slots without refs first, then slots with refs
  const noRefSlots = config.images.filter(s => !refMap[s.key]);
  const refSlots = config.images.filter(s => refMap[s.key]);

  // Future baby templates: generate baby first, then describe its features for parent prompts
  const isFutureBaby = templateCode === '2i2i' || templateCode === '2i2i1';
  let babyFaceDesc = '';

  // Generate non-ref images first (in parallel, or sequentially for future baby)
  const imageResultMap = {};
  if (isFutureBaby) {
    // Generate baby (image_1) first, then describe its face
    const babySlot = noRefSlots.find(s => s.key === 'image_1');
    const otherSlots = noRefSlots.filter(s => s.key !== 'image_1');

    if (babySlot) {
      if (!shouldRetryImage(babySlot.key) && prevAssets?.images?.[babySlot.key]) {
        console.log(`[retry-skip] slot=${babySlot.key} reusing previous image`);
        imageResultMap[babySlot.key] = prevAssets.images[babySlot.key];
      } else {
        const rawPrompt = pickPrompt(adminPrompts[babySlot.promptKey]) || values[babySlot.promptKey] || 'portrait photo';
        const basePrompt = rawPrompt.replace(/\{country\}/gi, country).replace(/\{gender\}/gi, values.gender || 'female');
        const prompt = varyPrompt(`${getEthnicityInstruction(country)}${basePrompt}`, babySlot.key);
        console.log(`[gen-image] slot=${babySlot.key} prompt=${prompt.slice(0, 100)}... ratio=${babySlot.aspectRatio}`);
        const babyResult = await generateImage(prompt, babySlot.aspectRatio);
        imageResultMap[babySlot.key] = babyResult;
      }

      // Describe baby's face for genetic inheritance
      const babyImage = imageResultMap[babySlot.key];
      if (babyImage?.path) {
        try {
          babyFaceDesc = await describeFace(babyImage.path);
          console.log(`[future-baby] baby face described: ${babyFaceDesc.slice(0, 100)}...`);
        } catch (err) {
          console.warn('[future-baby] Failed to describe baby face:', err.message);
        }
      }
    }

    // Generate parent images with baby's genetic features (short traits only to avoid safety filter)
    await Promise.all(
      otherSlots.map(async slot => {
        if (!shouldRetryImage(slot.key) && prevAssets?.images?.[slot.key]) {
          console.log(`[retry-skip] slot=${slot.key} reusing previous image`);
          imageResultMap[slot.key] = prevAssets.images[slot.key];
          return;
        }
        const rawPrompt = pickPrompt(adminPrompts[slot.promptKey]) || values[slot.promptKey] || 'portrait photo, professional photography';
        const basePrompt = rawPrompt.replace(/\{country\}/gi, country).replace(/\{gender\}/gi, values.gender || 'female');
        let shortTraits = '';
        if (babyFaceDesc) {
          const skinMatch = babyFaceDesc.match(/(?:fair|light|medium|olive|tan|dark|brown|pale|warm|cool)\s*(?:skin|complexion|toned?)/i);
          const eyeMatch = babyFaceDesc.match(/(?:blue|green|brown|hazel|dark|light|gray|black)\s*eyes?/i);
          const hairMatch = babyFaceDesc.match(/(?:blonde|brown|black|red|dark|light|auburn|chestnut)\s*hair/i);
          const parts = [skinMatch?.[0], eyeMatch?.[0], hairMatch?.[0]].filter(Boolean);
          shortTraits = parts.length ? parts.join(', ') + '. ' : '';
        }
        const prompt = varyPrompt(`${getEthnicityInstruction(country)}${shortTraits}${basePrompt}`, slot.key);
        console.log(`[gen-image] slot=${slot.key} prompt=${prompt.slice(0, 100)}... ratio=${slot.aspectRatio}`);
        const result = await generateImage(prompt, slot.aspectRatio);
        imageResultMap[slot.key] = result;
        return result;
      })
    );
  } else {
    // Normal flow: generate all non-ref images in parallel
    await Promise.all(
      noRefSlots.map(async slot => {
        // Retry check: reuse previous image if not retrying this slot
        if (!shouldRetryImage(slot.key) && prevAssets?.images?.[slot.key]) {
          console.log(`[retry-skip] slot=${slot.key} reusing previous image`);
          imageResultMap[slot.key] = prevAssets.images[slot.key];
          return;
        }
        // Check if user uploaded a file for this slot
        const uploadedPath = values.uploaded_files?.[slot.key];
        if (uploadedPath && existsSync(uploadedPath)) {
          console.log(`[upload] slot=${slot.key} using uploaded file: ${uploadedPath}`);
          imageResultMap[slot.key] = { type: 'file', path: uploadedPath };
          return;
        }
        const rawPrompt = pickPrompt(adminPrompts[slot.promptKey]) || values[slot.promptKey] || 'portrait photo, professional photography';
        const basePrompt = rawPrompt.replace(/\{country\}/gi, country).replace(/\{gender\}/gi, values.gender || 'female');
        const prompt = varyPrompt(`${getEthnicityInstruction(country)}${basePrompt}`, slot.key);
        console.log(`[gen-image] slot=${slot.key} prompt=${prompt.slice(0, 100)}... ratio=${slot.aspectRatio}`);
        const result = await generateImage(prompt, slot.aspectRatio);
        imageResultMap[slot.key] = result;
        return result;
      })
    );
  }

  // Generate ref images sequentially: use editImage to keep person 100% identical
  for (const slot of refSlots) {
    // Retry check: reuse previous image if not retrying this slot
    if (!shouldRetryImage(slot.key) && prevAssets?.images?.[slot.key]) {
      console.log(`[retry-skip] ref slot=${slot.key} reusing previous image`);
      imageResultMap[slot.key] = prevAssets.images[slot.key];
      continue;
    }
    // Check if user uploaded a file for this slot
    const uploadedRefPath = values.uploaded_files?.[slot.key];
    if (uploadedRefPath && existsSync(uploadedRefPath)) {
      console.log(`[upload] ref slot=${slot.key} using uploaded file: ${uploadedRefPath}`);
      imageResultMap[slot.key] = { type: 'file', path: uploadedRefPath };
      continue;
    }
    const refTarget = refMap[slot.key]; // e.g. "image_1"
    const refResult = imageResultMap[refTarget];
    const rawRefPrompt = pickPrompt(adminPrompts[slot.promptKey]) || values[slot.promptKey] || '';
    let basePrompt = rawRefPrompt
      .replace(/\{country\}/gi, country)
      .replace(/\{gender\}/gi, values.gender || 'female')
      .replace(/\[baby features\]/gi, babyFaceDesc || 'similar genetic features');

    // For future baby ref slots: generate a NEW parent image (don't editImage the baby)
    if (isFutureBaby) {
      let faceDesc = babyFaceDesc;
      if (!faceDesc && refResult?.path) {
        try {
          faceDesc = await describeFace(refResult.path);
        } catch (err) {
          console.warn(`Face describe failed for baby ref:`, err.message);
        }
      }
      // Extract only key traits (skin tone, eye color, hair color) to keep prompt short and avoid safety filter
      let shortTraits = '';
      if (faceDesc) {
        const skinMatch = faceDesc.match(/(?:fair|light|medium|olive|tan|dark|brown|pale|warm|cool)\s*(?:skin|complexion|toned?)/i);
        const eyeMatch = faceDesc.match(/(?:blue|green|brown|hazel|dark|light|gray|black)\s*eyes?/i);
        const hairMatch = faceDesc.match(/(?:blonde|brown|black|red|dark|light|auburn|chestnut)\s*hair/i);
        const parts = [skinMatch?.[0], eyeMatch?.[0], hairMatch?.[0]].filter(Boolean);
        shortTraits = parts.length ? parts.join(', ') + '. ' : '';
      }
      const prompt = varyPrompt(`${getEthnicityInstruction(country)}${shortTraits}${basePrompt || 'portrait photo, professional photography'}`, slot.key);
      console.log(`[future-baby] generating parent slot=${slot.key} prompt=${prompt.slice(0, 120)}...`);
      const result = await generateImage(prompt, slot.aspectRatio);
      imageResultMap[slot.key] = result;
      continue;
    }

    // Non-baby templates: use editImage to keep person identical
    if (refResult?.path) {
      try {
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
    const prompt = varyPrompt(`${refPrefix}${getEthnicityInstruction(country)}${basePrompt || 'portrait photo, professional photography'}`, slot.key);
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
    const descPrompt = pickPrompt(adminPrompts.description_prompt);
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
    [class*="img-inner"] img:not(.side-img-inner-img img):not(.side-img-inner-img2 img),
    [class*="img-block"] img,
    .gallery img,
    .feature-img img,
    .photo-frame img,
    .main-img img,
    .main-img-bg-img {
      width:100%!important;
      height:100%!important;
      object-fit:cover!important;
      object-position:center top!important;
    }
    .side-img-inner-img img,
    .side-img-inner-img2 img {
      width:100%!important;
      height:100%!important;
      object-fit:cover!important;
      object-position:center top!important;
    }
  </style>`;
  html = html.replace('</head>', wrapCSS + '</head>');

  // Font handling: Poppins + Noto Sans variant per language for full character support
  const NOTO_FONT_MAP = {
    Japanese:   'Noto+Sans+JP',
    Korean:     'Noto+Sans+KR',
    Chinese:    'Noto+Sans+SC',
    Thai:       'Noto+Sans+Thai',
    Hindi:      'Noto+Sans+Devanagari',
    Arabic:     'Noto+Sans+Arabic',
    Russian:    'Noto+Sans',
    Hebrew:     'Noto+Sans+Hebrew',
    Greek:      'Noto+Sans',
    Bengali:    'Noto+Sans+Bengali',
    Tamil:      'Noto+Sans+Tamil',
    Telugu:     'Noto+Sans+Telugu',
    Kannada:    'Noto+Sans+Kannada',
    Malayalam:  'Noto+Sans+Malayalam',
    Burmese:    'Noto+Sans+Myanmar',
    Khmer:      'Noto+Sans+Khmer',
    Lao:        'Noto+Sans+Lao',
    Georgian:   'Noto+Sans+Georgian',
    Armenian:   'Noto+Sans+Armenian',
    Mongolian:  'Noto+Sans+Mongolian',
    Vietnamese: 'Noto+Sans',
    English:    'Noto+Sans',
    French:     'Noto+Sans',
    Spanish:    'Noto+Sans',
    Portuguese: 'Noto+Sans',
    German:     'Noto+Sans',
    Italian:    'Noto+Sans',
    Dutch:      'Noto+Sans',
    Polish:     'Noto+Sans',
    Swedish:    'Noto+Sans',
    Turkish:    'Noto+Sans',
    Indonesian: 'Noto+Sans',
    Malay:      'Noto+Sans',
  };

  const langKey = lang.name || lang.country || '';
  const notoVariant = NOTO_FONT_MAP[langKey] || 'Noto+Sans';
  const notoName = notoVariant.replace(/\+/g, ' ');
  const userFont = values.font;

  // Always load Poppins (full subset) + Noto Sans variant for complete character coverage
  const families = [`Poppins:wght@400;600;700;800`];
  if (notoVariant !== 'Noto+Sans') families.push(`${notoVariant}:wght@400;600;700;800`);
  families.push('Noto+Sans:wght@400;600;700;800');

  const primaryFont = userFont || 'Poppins';
  const fontStack = userFont
    ? `'${userFont}','${notoName}','Noto Sans',sans-serif`
    : `'Poppins','${notoName}','Noto Sans',sans-serif`;

  if (userFont) {
    families.unshift(`${encodeURIComponent(userFont)}:wght@400;600;700;800`);
  }

  const fontCSS = `<link href="https://fonts.googleapis.com/css2?${families.map(f => 'family=' + f).join('&')}&display=swap" rel="stylesheet">
  <style>*{font-family:${fontStack}!important;}</style>`;
  html = html.replace('</head>', fontCSS + '</head>');

  // 5. Screenshot
  const safeName = featureName ? featureName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') : '';
  const jobId = safeName
    ? `${safeName}_${templateCode}_${lang.code}_${Date.now()}`
    : `batch_${templateCode}_${lang.code}_${Date.now()}`;
  const dims = getTemplateDimensions(templateCode);
  const result = await captureScreenshot(html, jobId, dims);

  // Return result with intermediate assets for retry support
  return {
    filename: result.filename,
    url: `/api/output/${result.filename}`,
    _intermediateAssets: {
      tagline: t1,
      customFields: values._customFields || null,
      images: imageResultMap,
    }
  };
}
