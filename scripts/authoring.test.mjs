import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const AUTHORING_SCRIPTS = ['author-neighborhood-buildings.mjs', 'author-first-building-batch.mjs', 'author-urban-variants.mjs'];

function packagesUnder(dir) {
  return readdirSync(dir, { recursive: true }).map(String).filter((file) => file.endsWith('main.building.json')).map((file) => path.join(dir, file));
}

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

/** Rooms by section id, read from each section's layout file. */
function sectionRooms(file, definition) {
  const rooms = new Map();
  for (const section of definition.sections ?? []) {
    const layout = path.join(path.dirname(file), section.layout);
    assert.ok(existsSync(layout), `${definition.id}: missing ${section.layout}`);
    rooms.set(section.id, { section, ids: new Set(readJson(layout).rooms.map((room) => room.id)) });
  }
  return rooms;
}

/** A `section/floor/room` reference names a real room on a floor its section has. */
function assertRoomRef(definition, rooms, ref) {
  const [sectionId, floor, roomId] = ref.split('/');
  const entry = rooms.get(sectionId);
  assert.ok(entry, `${definition.id}: ${ref} names an unknown section`);
  const level = Number(floor);
  assert.ok(level >= entry.section.floor && level < entry.section.floor + entry.section.floors, `${definition.id}: ${ref} is off its section's floors`);
  assert.ok(entry.ids.has(roomId), `${definition.id}: ${ref} names an unknown room`);
}

/** A non-empty footprint, and every door and stair joins real rooms on floors their sections have. */
function assertPackage(file, definition) {
  assert.ok(definition.w > 0 && definition.d > 0 && definition.floors > 0, `${definition.id}: empty footprint`);
  const rooms = sectionRooms(file, definition);
  if (!rooms.size) return;
  for (const link of [...(definition.connections ?? []), ...(definition.stairs ?? [])]) {
    assertRoomRef(definition, rooms, link.a);
    assertRoomRef(definition, rooms, link.b);
  }
}

test('authoring scripts generate self-consistent building packages', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pd-authoring-'));
  try {
    for (const script of AUTHORING_SCRIPTS) execFileSync(process.execPath, [path.join(scriptsDir, script)], { cwd: dir, stdio: 'pipe' });
    const packages = packagesUnder(dir);
    assert.ok(packages.length > 50, `generated ${packages.length} packages`);
    const ids = new Set();
    for (const file of packages) {
      const definition = readJson(file);
      assert.ok(!ids.has(definition.id), `duplicate package ${definition.id}`);
      ids.add(definition.id);
      assertPackage(file, definition);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('authoring scripts refuse to overwrite an authored package without --refresh', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pd-authoring-'));
  try {
    const run = () => execFileSync(process.execPath, [path.join(scriptsDir, AUTHORING_SCRIPTS[0])], { cwd: dir, stdio: 'pipe' });
    run();
    assert.throws(run, /Refusing to overwrite/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
