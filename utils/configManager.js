import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = join(__dirname, '..', 'config');

function loadJson(filename) {
  const p = join(CONFIG_DIR, filename);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : {};
}

function saveJson(filename, data) {
  const p = join(CONFIG_DIR, filename);
  writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8');
}

export function loadData() {
  const d = loadJson('data.json');
  return Array.isArray(d) ? d : [];
}

export function saveData(data) {
  saveJson('data.json', data);
}

export function loadFields() {
  return loadJson('template-fields.json');
}

export function saveFields(data) {
  saveJson('template-fields.json', data);
}

export function loadPrompts() {
  return loadJson('prompts.json');
}

export function savePrompts(data) {
  saveJson('prompts.json', data);
}
