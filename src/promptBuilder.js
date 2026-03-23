// ESM module
export function buildPrompts(template, request) {
  const { variables = {}, template_code } = request;

  // Build image prompt with style, lighting, composition
  const styleGuide = 'clean, modern app store marketing style, professional product photography';
  const lighting = 'soft studio lighting, bright and vibrant';
  const composition = 'centered composition, white space, minimalist';

  const gender = variables.gender || 'person';
  const hairstyle = variables.hairstyle || 'natural';

  const img1Prompt = `A ${gender} with ${hairstyle} hair using a mobile app, ${styleGuide}, ${lighting}, ${composition}, high quality marketing image, no text, isolated on white background`;

  const taglinePrompt = buildTaglinePrompt(template_code, variables);

  return { img1_prompt: img1Prompt, tagline_prompt: taglinePrompt };
}

function buildTaglinePrompt(templateCode, variables) {
  return `Generate a short, compelling app store screenshot tagline (max 8 words) for template "${templateCode}". Make it benefit-focused and action-oriented. Return only the tagline text, no quotes.`;
}
