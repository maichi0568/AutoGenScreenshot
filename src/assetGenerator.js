// ESM module
import { GoogleGenAI } from '@google/genai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getFromCache, saveToCache } from './cache.js';

const genAI   = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const genAIv2 = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function retryWithBackoff(fn, maxRetries = 2) {
  for (let i = 0; i <= maxRetries; i++) {
    try { return await fn(); }
    catch (err) {
      if (i === maxRetries) throw err;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

export async function generateImage(prompt, aspectRatio = '9:16') {
  // Include aspectRatio in cache key so different ratios are cached separately
  const cacheKey = `${prompt}__ar:${aspectRatio}`;
  const cached = getFromCache(cacheKey);
  if (cached) return { type: 'file', path: cached };

  const cached_path = await retryWithBackoff(async () => {
    const response = await genAIv2.models.generateImages({
      model: 'imagen-4.0-generate-001',
      prompt,
      config: { numberOfImages: 1, outputMimeType: 'image/png', aspectRatio }
    });

    const imageData = response.generatedImages[0].image.imageBytes;
    const buffer = Buffer.from(imageData, 'base64');
    return saveToCache(cacheKey, buffer);
  });

  return { type: 'file', path: cached_path };
}

export async function generateText(prompt) {
  return retryWithBackoff(async () => {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  });
}

// Describe a person's face from an image file for use as reference in other prompts
export async function describeFace(imagePath) {
  const { readFileSync } = await import('fs');
  const imageBuffer = readFileSync(imagePath);
  const base64 = imageBuffer.toString('base64');

  return retryWithBackoff(async () => {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: 'image/png',
          data: base64,
        },
      },
      'Describe this person\'s facial features in detail for image generation purposes: face shape, skin tone, eye shape and color, nose shape, lip shape, eyebrow shape, hair color and style, approximate age range. Be precise and concise. Output ONLY the physical description, no intro or commentary.',
    ]);
    return result.response.text().trim();
  });
}

// Edit an existing image using Gemini - keeps the person 100% identical, only changes specified part
export async function editImage(imagePath, modification, aspectRatio = '9:16') {
  const { readFileSync } = await import('fs');
  const imageBuffer = readFileSync(imagePath);
  const base64 = imageBuffer.toString('base64');

  const cacheKey = `edit_${modification}_${imagePath}__ar:${aspectRatio}`;
  const cached = getFromCache(cacheKey);
  if (cached) return { type: 'file', path: cached };

  const cached_path = await retryWithBackoff(async () => {
    const response = await genAIv2.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'image/png', data: base64 } },
          { text: `Edit this photo: ${modification}. Keep EVERYTHING else exactly the same - same person, same face, same skin, same clothes, same pose, same background, same lighting. The person must be 100% identical except for the specified change.` }
        ]
      }],
      config: { responseModalities: ['image', 'text'] }
    });

    const parts = response.candidates?.[0]?.content?.parts || [];
    const imgPart = parts.find(p => p.inlineData);
    if (!imgPart) throw new Error('No image returned from edit');

    const buffer = Buffer.from(imgPart.inlineData.data, 'base64');
    return saveToCache(cacheKey, buffer);
  });

  return { type: 'file', path: cached_path };
}

export function generateSolidColor(hexColor) {
  return hexColor || '#6C63FF';
}

export async function generateAssets(prompts, request) {
  const assets = {};

  // Background: solid color (NOT AI generated per spec)
  assets.background = generateSolidColor(request.background_color);

  // img1: AI generated image (with cache)
  const imgResult = await generateImage(prompts.img1_prompt);
  assets.img1 = imgResult;

  // tagline: user provided or AI generated
  if (request.tagline) {
    assets.tagline = request.tagline;
  } else {
    assets.tagline = await generateText(prompts.tagline_prompt);
  }

  // ui: always uploaded by user
  assets.ui = request.ui_image_path || null;

  return assets;
}
