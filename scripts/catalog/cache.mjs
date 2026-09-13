import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { digest, safeKey, requiredCaptures } from './core.mjs';
import { pool, uploadVerified } from './storage.mjs';

export async function restoreCapture(store, key, output, expected) {
  const bytes = await store.get(`captures/${safeKey(key)}.json`);
  if (!bytes) return null;
  let record;
  try {
    record = JSON.parse(bytes);
    if (record.fingerprint !== key || record.id !== expected.id || record.variant !== expected.variant ||
      record.folder !== expected.folder || !record.restorationVerified || !record.captures?.length) return null;
    const paths = new Set();
    for (const capture of record.captures) {
      safeKey(capture.file);
      if (paths.has(capture.file) || !/^[a-f0-9]{64}$/.test(capture.sha256)) return null;
      paths.add(capture.file);
    }
    if (requiredCaptures(expected, expected.exhaustive).some(file => !paths.has(file))) return null;
    if (expected.destruction === 'unsupported' && !record.destructionUnsupported) return null;
  } catch { return null; }
  let valid = true;
  await pool(record.captures, 4, async capture => {
    const image = await store.get(`evidence/${capture.sha256}.png`);
    if (!image || digest(image) !== capture.sha256) { valid = false; return; }
    const target = join(output, safeKey(record.folder), capture.file);
    await mkdir(dirname(target), { recursive: true }); await writeFile(target, image);
  });
  if (!valid) return null;
  if (record.destructionUnsupported) {
    const target = join(output, record.folder, 'destruction/README.md');
    await mkdir(dirname(target), { recursive: true }); await writeFile(target, record.destructionUnsupported + '\n');
  }
  await writeFile(join(output, record.folder, 'manifest.json'), JSON.stringify(record));
  return record;
}

export async function saveCapture(store, record, root) {
  await pool(record.captures, 4, async capture => {
    const bytes = await readFile(join(root, safeKey(record.folder), safeKey(capture.file)));
    if (digest(bytes) !== capture.sha256) throw new Error('Cannot cache corrupted capture');
    await uploadVerified(store, `evidence/${capture.sha256}.png`, bytes, 'image/png');
  });
  // A cache record is the commit marker, written after all evidence exists.
  await uploadVerified(store, `captures/${safeKey(record.fingerprint)}.json`, Buffer.from(JSON.stringify(record)), 'application/json');
  await store.put(`timings/${digest(Buffer.from(`${record.id}/${record.variant}`))}.json`,
    Buffer.from(JSON.stringify({ durationMs: record.durationMs })), 'application/json');
}
