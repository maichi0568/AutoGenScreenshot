// ESM module — FAL.AI VERSION (Nano Banana)
import { getFromCache, saveToCache } from './cache.js';

const FAL_KEY = process.env.FAL_KEY || process.env.GEMINI_API_KEY;
const FAL_HEADERS = { 'Content-Type': 'application/json', 'Authorization': `Key ${FAL_KEY}` };

async function retryWithBackoff(fn, maxRetries = 2) {
  for (let i = 0; i <= maxRetries; i++) {
    try { return await fn(); }
    catch (err) {
      if (i === maxRetries) throw err;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

// Helper: call fal.ai any-llm for text generation
async function falLLM(prompt, model = 'google/gemini-2.5-flash') {
  const res = await fetch('https://fal.run/fal-ai/any-llm', {
    method: 'POST',
    headers: FAL_HEADERS,
    body: JSON.stringify({ model, prompt }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`fal any-llm error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.output;
}

// Helper: call fal.ai any-llm/vision for image understanding
async function falVision(imageUrl, prompt, model = 'google/gemini-2.5-flash') {
  const res = await fetch('https://fal.run/fal-ai/any-llm/vision', {
    method: 'POST',
    headers: FAL_HEADERS,
    body: JSON.stringify({ model, prompt, image_url: imageUrl }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`fal vision error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.output;
}

// Convert local file to base64 data URI
function fileToDataUri(filePath, mimeType = 'image/png') {
  const { readFileSync } = require('fs');
  const buffer = readFileSync(filePath);
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

// Aspect ratio string to pixel dimensions
function aspectToSize(aspectRatio) {
  const map = {
    '9:16': { width: 1080, height: 1920 },
    '16:9': { width: 1920, height: 1080 },
    '3:4': { width: 1080, height: 1440 },
    '4:3': { width: 1440, height: 1080 },
    '1:1': { width: 1080, height: 1080 },
  };
  return map[aspectRatio] || map['9:16'];
}

export async function generateImage(prompt, aspectRatio = '9:16') {
  const cacheKey = `${prompt}__ar:${aspectRatio}__t:${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const cached_path = await retryWithBackoff(async () => {
    console.log(`[fal-nano-banana] generating image...`);
    const size = aspectToSize(aspectRatio);
    const res = await fetch('https://fal.run/fal-ai/nano-banana', {
      method: 'POST',
      headers: FAL_HEADERS,
      body: JSON.stringify({ prompt, image_size: size }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`fal image gen error ${res.status}: ${err}`);
    }
    const data = await res.json();
    const imgUrl = data.images?.[0]?.url;
    if (!imgUrl) throw new Error('No image returned from fal.ai');

    // Download the image
    const imgRes = await fetch(imgUrl);
    if (!imgRes.ok) throw new Error(`Failed to download image: ${imgRes.status}`);
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    return saveToCache(cacheKey, buffer);
  });

  return { type: 'file', path: cached_path };
}

export async function generateText(prompt) {
  return retryWithBackoff(async () => {
    return falLLM(prompt);
  });
}

export async function describeFace(imagePath) {
  const { readFileSync } = await import('fs');
  const imageBuffer = readFileSync(imagePath);
  const base64 = imageBuffer.toString('base64');
  const dataUri = `data:image/png;base64,${base64}`;
  const facePrompt = 'Describe this person\'s facial features in detail for image generation purposes: face shape, skin tone, eye shape and color, nose shape, lip shape, eyebrow shape, hair color and style, approximate age range. Be precise and concise. Output ONLY the physical description, no intro or commentary.';

  return retryWithBackoff(async () => {
    return falVision(dataUri, facePrompt);
  });
}

export async function editImage(imagePath, modification, aspectRatio = '9:16') {
  const { readFileSync } = await import('fs');
  const imageBuffer = readFileSync(imagePath);
  const base64 = imageBuffer.toString('base64');
  const dataUri = `data:image/png;base64,${base64}`;

  const cacheKey = `edit_${modification}_${imagePath}__ar:${aspectRatio}`;
  const cached = getFromCache(cacheKey);
  if (cached) return { type: 'file', path: cached };

  const cached_path = await retryWithBackoff(async () => {
    console.log(`[fal-nano-banana] editing image...`);
    const res = await fetch('https://fal.run/fal-ai/nano-banana/edit', {
      method: 'POST',
      headers: FAL_HEADERS,
      body: JSON.stringify({
        prompt: `Edit this photo: ${modification}. Keep EVERYTHING else exactly the same - same person, same face, same skin, same clothes, same pose, same background, same lighting. The person must be 100% identical except for the specified change.`,
        image_urls: [dataUri],
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`fal edit error ${res.status}: ${err}`);
    }
    const data = await res.json();
    const imgUrl = data.images?.[0]?.url;
    if (!imgUrl) throw new Error('No image returned from fal edit');

    const imgRes = await fetch(imgUrl);
    if (!imgRes.ok) throw new Error(`Failed to download edited image: ${imgRes.status}`);
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    return saveToCache(cacheKey, buffer);
  });

  return { type: 'file', path: cached_path };
}

// Analyze a template screenshot and extract its components as structured JSON
export async function analyzeTemplateImage(imagePath) {
  const { readFileSync } = await import('fs');
  const sharp = (await import('sharp')).default;

  let imageBuffer;
  try {
    imageBuffer = await sharp(imagePath)
      .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
  } catch {
    imageBuffer = readFileSync(imagePath);
  }
  const base64 = imageBuffer.toString('base64');
  const dataUri = `data:image/jpeg;base64,${base64}`;

  const prompt = `You are analyzing an app store screenshot template. This image contains a designed layout with text and photos composed together.

Extract the components and return ONLY valid JSON (no markdown, no code block, no explanation):
{
  "tagline": "the main text/tagline visible in the image, keep original language",
  "images": [
    {
      "id": "image_1",
      "description": "detailed description of this photo for an AI image generator to create a similar one. Describe the person/subject, pose, expression, clothing, background, lighting, style. Be very specific.",
      "position": "where in the layout (e.g. center, left, right, top-left, bottom)",
      "aspect_ratio": "estimated ratio like 9:16, 3:4, 1:1"
    }
  ],
  "background_color": "dominant background color as hex, e.g. #1a1a2e",
  "layout_description": "brief description of the overall layout structure",
  "num_images": 1
}

Rules:
- List ALL distinct photos/images in the template (not icons or UI elements)
- For each image, write a detailed generation prompt as the description
- If there are before/after images, describe each separately
- tagline should be the main headline text only
- num_images = total count of photos`;

  return retryWithBackoff(async () => {
    console.log('[fal-vision] analyzing template image...');
    let text = await falVision(dataUri, prompt);
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    console.log(`[fal-vision] extracted: ${text.slice(0, 300)}`);
    return JSON.parse(text);
  });
}

// Generate new assets from a reference template image
export async function generateFromReference(refImagePath, aspectRatio = '9:16', extraPrompt = '') {
  const analysis = await analyzeTemplateImage(refImagePath);
  console.log(`[ref-gen] found ${analysis.num_images} image(s), tagline: "${analysis.tagline}"`);

  // Generate new tagline
  const taglinePrompt = `Rewrite this app store screenshot tagline in a fresh new way, same language, same meaning but different wording. Max 2 lines, max 22 chars per line. Original: "${analysis.tagline}"${extraPrompt ? '. Context: ' + extraPrompt : ''}. Return ONLY the new tagline text.`;
  const newTagline = await generateText(taglinePrompt);

  // Generate new images in parallel
  const imageResults = await Promise.all(
    analysis.images.map(async (img) => {
      const prompt = extraPrompt
        ? `${extraPrompt}. ${img.description}`
        : img.description;
      const ratio = img.aspect_ratio || aspectRatio;
      const result = await generateImage(prompt, ratio);
      return { id: img.id, position: img.position, ...result };
    })
  );

  return {
    analysis,
    tagline: newTagline,
    images: imageResults,
    background_color: analysis.background_color,
  };
}

// Parse Figma URL into fileKey and nodeId
function parseFigmaUrl(figmaUrl) {
  const urlObj = new URL(figmaUrl);
  const pathParts = urlObj.pathname.split('/').filter(Boolean);

  let fileKey = null;
  for (let i = 0; i < pathParts.length; i++) {
    if (pathParts[i] === 'design' || pathParts[i] === 'file') {
      fileKey = pathParts[i + 1];
      break;
    }
    if (pathParts[i] === 'branch') {
      fileKey = pathParts[i + 1];
      break;
    }
  }
  if (!fileKey) throw new Error('Cannot parse Figma file key from URL');

  let nodeId = urlObj.searchParams.get('node-id');
  if (nodeId) nodeId = nodeId.replace(/-/g, ':');

  return { fileKey, nodeId };
}

// Recursively extract layer names and types from Figma node tree
function extractLayers(node, layers = [], depth = 0) {
  if (!node) return layers;

  const name = (node.name || '').trim();
  const type = node.type;

  if (depth > 0 && name) {
    const info = { name, type, id: node.id };

    if (node.absoluteBoundingBox) {
      info.x = Math.round(node.absoluteBoundingBox.x);
      info.y = Math.round(node.absoluteBoundingBox.y);
      info.width = Math.round(node.absoluteBoundingBox.width);
      info.height = Math.round(node.absoluteBoundingBox.height);
    }

    if (node.fills?.length > 0) {
      const fill = node.fills[0];
      if (fill.type === 'SOLID' && fill.color) {
        const r = Math.round(fill.color.r * 255);
        const g = Math.round(fill.color.g * 255);
        const b = Math.round(fill.color.b * 255);
        info.color = `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
      }
    }

    if (type === 'TEXT' && node.characters) {
      info.text = node.characters;
      if (node.style) {
        info.fontSize = node.style.fontSize;
        info.fontWeight = node.style.fontWeight;
      }
    }

    layers.push(info);
  }

  if (node.children) {
    for (const child of node.children) {
      extractLayers(child, layers, depth + 1);
    }
  }

  return layers;
}

// Fetch Figma frame as PNG + extract layer info
export async function fetchFigmaImage(figmaUrl) {
  const { writeFileSync } = await import('fs');
  const { join } = await import('path');

  const { fileKey, nodeId } = parseFigmaUrl(figmaUrl);
  const token = process.env.FIGMA_TOKEN;
  if (!token) throw new Error('FIGMA_TOKEN not set in environment');

  const ids = nodeId || '';
  const [nodesRes, imgRes] = await Promise.all([
    fetch(`https://api.figma.com/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(ids)}`, {
      headers: { 'X-Figma-Token': token }
    }),
    fetch(`https://api.figma.com/v1/images/${fileKey}?ids=${encodeURIComponent(ids)}&format=png&scale=2`, {
      headers: { 'X-Figma-Token': token }
    }),
  ]);

  let layers = [];
  if (nodesRes.ok) {
    const nodesData = await nodesRes.json();
    const nodes = nodesData.nodes || {};
    const rootNode = Object.values(nodes)[0]?.document;
    if (rootNode) {
      layers = extractLayers(rootNode);
      console.log(`[figma] Found ${layers.length} layers:`, layers.map(l => `${l.name} (${l.type})`).join(', '));
    }
  }

  if (!imgRes.ok) {
    const errText = await imgRes.text();
    throw new Error(`Figma API error ${imgRes.status}: ${errText}`);
  }
  const imgData = await imgRes.json();
  const imgUrl = Object.values(imgData.images || {})[0];
  if (!imgUrl) throw new Error('No image returned from Figma API. Make sure the node-id is correct.');

  console.log(`[figma] Downloading PNG...`);
  const pngRes = await fetch(imgUrl);
  if (!pngRes.ok) throw new Error(`Failed to download Figma image: ${pngRes.status}`);
  const buffer = Buffer.from(await pngRes.arrayBuffer());

  const tempPath = join('uploads', `figma_${Date.now()}.png`);
  writeFileSync(tempPath, buffer);
  console.log(`[figma] Saved to ${tempPath} (${buffer.length} bytes)`);

  return { imagePath: tempPath, layers };
}

// Analyze a template image and generate full HTML/CSS layout
export async function analyzeTemplateLayout(imagePath, layers = []) {
  const { readFileSync } = await import('fs');
  const sharp = (await import('sharp')).default;

  let imageBuffer;
  try {
    imageBuffer = await sharp(imagePath)
      .resize(1500, 1500, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
  } catch {
    imageBuffer = readFileSync(imagePath);
  }
  const base64 = imageBuffer.toString('base64');
  const dataUri = `data:image/jpeg;base64,${base64}`;

  let layerInstructions = '';
  if (layers.length > 0) {
    const layerList = layers.map(l => {
      let desc = `- "${l.name}" (${l.type})`;
      if (l.width && l.height) desc += ` — ${l.width}x${l.height}px at (${l.x}, ${l.y})`;
      if (l.color) desc += ` — color: ${l.color}`;
      if (l.text) desc += ` — text: "${l.text}"`;
      if (l.fontSize) desc += ` — fontSize: ${l.fontSize}`;
      return desc;
    }).join('\n');

    layerInstructions = `
IMPORTANT — Figma Layer Names:
The designer has named the layers in Figma. Use these EXACT names as {{placeholder}} keys:
${layerList}

Mapping rules:
- Layer names containing "image", "img", "photo", "picture" or layer type is IMAGE/RECTANGLE with image fill → use as <img src="{{layer_name}}">
- Layer names containing "tagline", "title", "heading", "text" or type is TEXT → use as {{layer_name}} in a text element
- Layer names containing "description", "desc", "subtitle", "caption" → use as {{layer_name}} in a text element
- Layer names containing "background", "bg" → use the layer name for background color placeholder
- For other named layers, use the layer name as-is for the placeholder key: {{layer_name}}
- Convert layer names to snake_case for placeholder keys (e.g. "Main Image" → {{main_image}}, "tagline" → {{tagline}})
- Use the layer positions (x, y, width, height) to place elements accurately with absolute positioning
- Decorative layers (stars, arrows, shapes without meaningful names) should be reproduced as CSS/SVG, not as placeholders
`;
  }

  const prompt = `You are an expert UI developer. Analyze this app store screenshot template image and generate a FULL HTML page that recreates this layout precisely.

The template is 1080x1920 pixels. You must generate complete, working HTML with inline CSS that matches the layout.
${layerInstructions}
RULES:
1. Use absolute positioning for ALL elements inside the main container (.template-bg)
2. The main container must be exactly 1080px × 1920px with position:relative
3. For each PHOTO/IMAGE area, use an <img> tag with src="{{key}}" where key comes from the layer name${layers.length === 0 ? ' (use image_1, image_2, etc.)' : ''}
4. For headline/tagline text, use a <p> tag containing {{key}}${layers.length === 0 ? ' (use text_1)' : ''}
5. For subtitle/description text, use a <p> tag containing {{key}}${layers.length === 0 ? ' (use description)' : ''}
6. Reproduce decorative elements (shapes, gradients, overlays) using CSS or simple SVG
7. Match colors, border-radius, shadows, gradients as closely as possible
8. Use 'Poppins' as the font family
9. Include the Google Fonts import for Poppins (weights 400 and 800)
10. Do NOT use external images - only {{placeholders}} or CSS/SVG for decorations
11. Make sure image containers have overflow:hidden and img tags have object-fit:cover
12. Background can be a solid color or gradient matching the original

Return ONLY the complete HTML document (<!DOCTYPE html> to </html>). No markdown, no code blocks, no explanation.

The HTML must follow this structure:
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Template</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;800&display=swap');
    html, body { height:100%; margin:0; padding:0; box-sizing:border-box; }
    body { background:#000; min-height:1920px; min-width:1080px; overflow-x:auto; }
    .template-bg { position:relative; width:1080px; height:1920px; overflow:hidden; margin:0 auto; font-family:'Poppins',Arial,sans-serif; /* background here */ }
    /* ... all element styles with absolute positioning ... */
  </style>
</head>
<body>
  <div class="template-bg">
    <!-- elements here -->
  </div>
</body>
</html>`;

  return retryWithBackoff(async () => {
    console.log('[fal-vision] analyzing template layout from image...');
    let html = await falVision(dataUri, prompt);
    html = html.replace(/^```(?:html)?\s*/i, '').replace(/\s*```$/, '');
    console.log(`[fal-vision] generated HTML layout (${html.length} chars)`);
    return html;
  });
}

export function generateSolidColor(hexColor) {
  return hexColor || '#6C63FF';
}

export async function generateAssets(prompts, request) {
  const assets = {};
  assets.background = generateSolidColor(request.background_color);
  const imgResult = await generateImage(prompts.img1_prompt);
  assets.img1 = imgResult;
  if (request.tagline) {
    assets.tagline = request.tagline;
  } else {
    assets.tagline = await generateText(prompts.tagline_prompt);
  }
  assets.ui = request.ui_image_path || null;
  return assets;
}
