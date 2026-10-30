#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const ignored = new Set(['.git', 'node_modules', 'output', '.venv', '__pycache__']);
function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (ignored.has(entry.name) || entry.name === '.DS_Store') return [];
    const full = path.join(directory, entry.name);
    assert(!entry.isSymbolicLink(), `Symlink is outside the text-only package: ${path.relative(root, full)}`);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

try {
  const files = walk(root);
  const textFiles = new Map();
  const sampleImages = new Set(['assets/previews/light.jpg', 'assets/previews/dark.jpg']);
  let imageCount = 0;
  const privatePath = /(?:\/Users\/|\/home\/|\/private\/(?:tmp|var)\/|[A-Za-z]:\\Users\\)[^\s"'<>]+/;
  const secret = /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9]{32,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/;
  for (const file of files) {
    const relative = path.relative(root, file).split(path.sep).join('/');
    assert(!relative.startsWith('private/') && !relative.startsWith('references/screenshots/'), `Private source material: ${relative}`);
    assert(!/(?:^|\/)(?:\.env(?:\..*)?|\.npmrc)$/.test(relative), `Local configuration: ${relative}`);
    if (sampleImages.has(relative)) {
      const jpeg = fs.readFileSync(file);
      assert(jpeg.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) && jpeg.subarray(-2).equals(Buffer.from([0xff, 0xd9])), `Invalid sample JPEG: ${relative}`);
      assert(!privatePath.test(jpeg.toString('latin1')) && !secret.test(jpeg.toString('latin1')), `Private data pattern in sample JPEG: ${relative}`);
      imageCount++;
      continue;
    }
    assert(/\.(?:md|css|html|js|cjs|svg|yaml)$/.test(relative) || ['LICENSE', '.gitignore'].includes(relative), `Unexpected distribution file: ${relative}`);
    const bytes = fs.readFileSync(file);
    const text = bytes.toString('utf8');
    assert(!bytes.includes(0) && !text.includes('\ufffd'), `Non-UTF-8 file: ${relative}`);
    assert(!privatePath.test(text), `Private machine path: ${relative}`);
    assert(!secret.test(text), `Credential pattern: ${relative}`);
    textFiles.set(relative, text);
    if (/\.(?:js|cjs)$/.test(relative)) new vm.Script(text, { filename: relative });
    if (relative.endsWith('.md')) {
      for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
        const target = match[1].replace(/^<|>$/g, '').split('#')[0];
        if (!target || /^(?:https?:|mailto:)/.test(target)) continue;
        assert(!path.isAbsolute(target), `Absolute local reference: ${relative}`);
        const resolved = path.resolve(path.dirname(file), decodeURIComponent(target));
        assert(resolved.startsWith(root + path.sep) && fs.existsSync(resolved), `Missing local reference in ${relative}: ${target}`);
      }
    }
  }

  const html = textFiles.get('assets/theme-preview.html');
  assert(html, 'Missing preview');
  for (const match of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
    new vm.Script(match[1], { filename: 'theme-preview inline script' });
  }
  for (const match of html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"/g)) {
    assert(fs.existsSync(path.resolve(root, 'assets', match[1])), `Missing preview resource: ${match[1]}`);
  }
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'Duplicate HTML ID');
  for (const match of html.matchAll(/\baria-(?:labelledby|describedby)="([^"]+)"/g)) {
    for (const id of match[1].split(/\s+/)) assert(ids.includes(id), `Missing accessible description: ${id}`);
  }

  const context = vm.createContext({});
  vm.runInContext(textFiles.get('assets/preview-locales.js') + '\nthis.catalog = EVEN_PREVIEW_LOCALES;', context);
  const locales = ['en', 'zh-Hans', 'zh-Hant', 'ja', 'es', 'fr', 'de', 'it', 'ko'];
  assert.equal(Object.keys(context.catalog).length, locales.length);
  const keys = [...new Set([...html.matchAll(/\bdata-i18n(?:-placeholder)?="([^"]+)"/g)].map(match => match[1]).concat('updated'))];
  for (const locale of locales) {
    const catalog = context.catalog[locale];
    assert(catalog, `Missing locale: ${locale}`);
    assert(html.includes(`value="${locale}"`), `Missing language option: ${locale}`);
    for (const key of keys) assert(typeof catalog[key] === 'string' && catalog[key].length > 0, `Missing translation: ${locale}.${key}`);
  }
  const icons = [...textFiles.entries()].filter(([name]) => name.endsWith('.svg'));
  assert.equal(icons.length, 4);
  for (const [name, svg] of icons) {
    assert(/viewBox="0 0 24 24"/.test(svg), `Unexpected SVG dimensions: ${name}`);
    assert(svg.includes('currentColor') && !/<(?:script|foreignObject)\b/i.test(svg), `Unexpected SVG content: ${name}`);
  }
  console.log(`PASS: ${textFiles.size} text/vector files; ${imageCount} sample JPEGs; local references; JavaScript syntax; ${locales.length} locales × ${keys.length} keys; ${icons.length} SVG icons; private-path and credential-pattern checks.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
