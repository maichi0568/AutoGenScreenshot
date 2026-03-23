// ESM module
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const CACHE_DIR = './assets/cache';
if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });

export function getCacheKey(prompt) {
  return createHash('sha256').update(prompt).digest('hex');
}

export function getFromCache(prompt) {
  const key = getCacheKey(prompt);
  const filePath = join(CACHE_DIR, `${key}.png`);
  if (existsSync(filePath)) return filePath;
  return null;
}

export function saveToCache(prompt, imageBuffer) {
  const key = getCacheKey(prompt);
  const filePath = join(CACHE_DIR, `${key}.png`);
  writeFileSync(filePath, imageBuffer);
  return filePath;
}
