// ESM module - orchestrates the full generation pipeline
import { buildPrompts } from './promptBuilder.js';
import { generateAssets } from './assetGenerator.js';
import { renderTemplate, getTemplateDimensions } from './renderer.js';
import { captureScreenshot } from './screenshotEngine.js';
import { updateJob } from './jobManager.js';

const TEMPLATES = {
  'lifestyle': {
    template_code: 'lifestyle',
    name: 'Lifestyle',
    description: 'Person using app with UI overlay',
    assets: ['background', 'img1', 'ui', 'tagline'],
    variables: ['gender', 'hairstyle'],
    layout: 'templates/lifestyle/layout.html',
    styles: 'templates/lifestyle/styles.css'
  },
  'minimal': {
    template_code: 'minimal',
    name: 'Minimal',
    description: 'Clean phone mockup with person',
    assets: ['background', 'img1', 'ui', 'tagline'],
    variables: [],
    layout: 'templates/minimal/layout.html',
    styles: 'templates/minimal/styles.css'
  },
  'bold': {
    template_code: 'bold',
    name: 'Bold',
    description: 'Full bleed hero with strong typography',
    assets: ['background', 'img1', 'ui', 'tagline'],
    variables: ['gender'],
    layout: 'templates/bold/layout.html',
    styles: 'templates/bold/styles.css'
  },
  'template2': {
    template_code: 'template2',
    name: 'Template 2',
    description: 'Figma-based: black→red gradient, rounded frame, circle overlay',
    assets: ['main_image', 'circle_image', 'title_line1', 'title_line2'],
    variables: ['gender', 'hairstyle'],
    layout: 'templates/template2/layout.html',
    styles: 'templates/template2/styles.css'
  },
  'tmpl1': {
    template_code: 'tmpl1',
    name: 'Template 1',
    description: 'Gradient bg, main frame with border, circle before-photo with flip effect, arrow decoration',
    assets: ['main_image', 'circle_image', 'title_line1', 'title_line2'],
    variables: ['gender', 'hairstyle'],
    layout: 'templates/tmpl1/layout.html',
    styles: 'templates/tmpl1/styles.css'
  },
  'tmpl4': {
    template_code: 'tmpl4',
    name: 'Template 4',
    description: '4-photo collage with rotations, gradient bg, decorative curve',
    assets: ['img1', 'img2', 'img3', 'img4', 'title_line1', 'title_line2'],
    variables: ['gender', 'hairstyle'],
    layout: 'templates/tmpl4/layout.html',
    styles: 'templates/tmpl4/styles.css'
  },
  'hair': {
    template_code: 'hair',
    name: 'Hair Style',
    description: 'Hair style transformation with gallery grid',
    assets: ['image_1', 'image_2', 'image_3', 'text_1'],
    variables: [],
    layout: 'templates/hair/layout.html',
    styles: 'templates/hair/styles.css'
  },
  'mockup': {
    template_code: 'mockup',
    name: 'Mockup',
    description: 'Bring photos together naturally with rounded frame',
    assets: ['image_1', 'image_2', 'text_1'],
    variables: [],
    layout: 'templates/mockup/layout.html',
    styles: 'templates/mockup/styles.css'
  },
  'i2i': {
    template_code: 'i2i',
    name: 'Image to Image',
    description: 'Switch outfits with main and bottom frame',
    assets: ['image_1', 'image_2', 'text_1'],
    variables: [],
    layout: 'templates/i2i/layout.html',
    styles: 'templates/i2i/styles.css'
  },
  'multistyle': {
    template_code: 'multistyle',
    name: 'Multi Style',
    description: 'Apply AI styles with multi-photo grid layout',
    assets: ['image_1', 'image_2', 'image_3', 'image_4', 'image_5', 'image_6', 'image_7', 'image_8', 'text_1'],
    variables: [],
    layout: 'templates/multistyle/layout.html',
    styles: 'templates/multistyle/styles.css'
  },
  'filter': {
    template_code: 'filter',
    name: 'Filter',
    description: 'Filter effects with color swatches and dividers',
    assets: ['image_1', 'text_1'],
    variables: [],
    layout: 'templates/filter/layout.html',
    styles: 'templates/filter/styles.css'
  },
  '2i2i': {
    template_code: '2i2i',
    name: '2 Image to 2 Image',
    description: 'Two image comparison layout',
    assets: ['image_1', 'image_2', 'image_3', 'text_1'],
    variables: [],
    layout: 'templates/2i2i/layout.html',
    styles: 'templates/2i2i/styles.css'
  },
  '2i2i1': {
    template_code: '2i2i1',
    name: '2 Image to 2 Image (1)',
    description: 'Two image comparison layout variant',
    assets: ['image_1', 'image_2', 'image_3', 'text_1'],
    variables: [],
    layout: 'templates/2i2i1/layout.html',
    styles: 'templates/2i2i1/styles.css'
  },
  'makeup': {
    template_code: 'makeup',
    name: 'Makeup',
    description: 'Makeup transformation with before/after split',
    assets: ['image_1', 'image_2', 'text_1'],
    variables: [],
    layout: 'templates/makeup/layout.html',
    styles: 'templates/makeup/styles.css'
  },
  'ti2v': {
    template_code: 'ti2v',
    name: 'Text/Image to Video',
    description: 'AI portraits with circle overlay and description',
    assets: ['image_1', 'image_2', 'text_1', 'description'],
    variables: [],
    layout: 'templates/ti2v/layout.html',
    styles: 'templates/ti2v/styles.css'
  },
  'i2i1': {
    template_code: 'i2i1',
    name: 'Image to Image (1)',
    description: 'Switch outfits with circle overlay variant',
    assets: ['image_1', 'image_2', 'text_1'],
    variables: [],
    layout: 'templates/i2i1/layout.html',
    styles: 'templates/i2i1/styles.css'
  },
};

export function getTemplates() {
  return Object.values(TEMPLATES);
}

export async function runPipeline(job, request) {
  try {
    updateJob(job.job_id, { status: 'processing' });

    const template = TEMPLATES[request.template_code];
    if (!template) throw new Error(`Template "${request.template_code}" not found`);

    const prompts = buildPrompts(template, request);
    const assets = await generateAssets(prompts, request);

    updateJob(job.job_id, { assets });

    const html = renderTemplate(template, assets);
    const dims = getTemplateDimensions(template.template_code);
    const result = await captureScreenshot(html, job.job_id, dims);

    updateJob(job.job_id, {
      status: 'completed',
      result: { filename: result.filename, url: `/api/output/${result.filename}` }
    });
  } catch (err) {
    updateJob(job.job_id, { status: 'failed', error: err.message });
    console.error('Pipeline error:', err);
  }
}
