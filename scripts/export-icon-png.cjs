#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

async function main() {
  const args = process.argv.slice(2);
  const usage = 'Usage: node export-icon-png.cjs icon.svg --output-dir DIR --name NAME --color #RRGGBB [--size 24] [--scales 1,2,3]';
  if (!args.length || args[0] === '--help') { console.log(usage); return; }
  const input = path.resolve(args.shift());
  const allowed = new Set(['--output-dir', '--name', '--color', '--size', '--scales']);
  const options = {};
  while (args.length) {
    const flag = args.shift();
    if (!allowed.has(flag) || !args.length || options[flag] !== undefined) throw new Error(usage);
    options[flag] = args.shift();
  }
  const size = Number(options['--size'] ?? 24);
  const scales = (options['--scales'] ?? '1,2,3').split(',').map(Number);
  const name = options['--name'];
  const color = options['--color'];
  if (!options['--output-dir'] || !name || !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(name)) throw new Error('Supply an output directory and a simple asset name.');
  if (!/^#[0-9a-f]{6}$/i.test(color ?? '')) throw new Error('Supply a foreground color in #RRGGBB form.');
  if (!Number.isInteger(size) || size < 8 || size > 256) throw new Error('Size must be an integer between 8 and 256 CSS pixels.');
  if (!scales.length || scales.some(value => ![1, 2, 3].includes(value)) || new Set(scales).size !== scales.length) throw new Error('Scales must be distinct values from 1,2,3.');
  if (path.extname(input).toLowerCase() !== '.svg') throw new Error('Input must be an SVG file.');
  const svg = (await fs.readFile(input, 'utf8')).replace(/currentColor/g, color);
  if (!svg.includes('<svg')) throw new Error('Input does not contain an SVG element.');
  let sharp;
  try { sharp = require('sharp'); } catch { throw new Error('sharp is unavailable. Run npm install --no-save --package-lock=false sharp in the skill root, or use another SVG renderer.'); }
  const outputDir = path.resolve(options['--output-dir']);
  const outputs = scales.map(scale => ({ scale, file: path.join(outputDir, `${name}${scale === 1 ? '' : `@${scale}x`}.png`) }));
  for (const { file } of outputs) {
    try { await fs.access(file); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    throw new Error(`Output already exists: ${file}`);
  }
  await fs.mkdir(outputDir, { recursive: true });
  for (const { scale, file } of outputs) {
    await sharp(Buffer.from(svg), { density: 72 * scale }).resize(size * scale, size * scale).png().toFile(file);
    console.log(file);
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
