#!/usr/bin/env node
'use strict';

/**
 * Build script: assembles a self-contained index.html from simulator components.
 * All JS is inlined into a single <script> block — no ES module imports needed.
 * This allows the file to work from file:// protocol and GitHub Pages.
 *
 * Usage: node wfx_compiler/simulator_static/build.js
 */

const fs = require('fs');
const path = require('path');

const STATIC_DIR = __dirname;
const SIM_DIR = path.join(__dirname, '..', 'simulator');

function read(f) { return fs.readFileSync(f, 'utf8'); }

function stripModuleSyntax(code) {
  // Remove import lines
  code = code.replace(/^import\s+\{[^}]+\}\s+from\s+['"][^'"]+['"];?\s*$/gm, '');
  // Remove 'export' prefix from declarations
  code = code.replace(/^export (const |let |var |function |class )/gm, '$1');
  return code;
}

// Read JS source files and strip module syntax
let palettesCode = stripModuleSyntax(read(path.join(SIM_DIR, 'palettes.js')));
let fontsCode = stripModuleSyntax(read(path.join(SIM_DIR, 'fonts.js')));
let simEngineCode = stripModuleSyntax(read(path.join(SIM_DIR, 'sim-engine.js')));
let rendererCode = stripModuleSyntax(read(path.join(SIM_DIR, 'renderer.js')));
let compilerCode = stripModuleSyntax(read(path.join(STATIC_DIR, 'compiler-browser.js')));

// compiler-browser.js duplicates REG, OP, WFX constants already in sim-engine.js.
// Remove the entire opcodes section from compiler code.
compilerCode = compilerCode.replace(
  /\/\/ =+\r?\n\/\/ opcodes\.js[\s\S]*?(?=\/\/ =+\r?\n\/\/ lexer\.js)/,
  ''
);

// Also remove the standalone comment header from compiler (already inside our combined script)
compilerCode = compilerCode.replace(/^\/\*\*[\s\S]*?\*\/\s*\n*/m, '');

// ---- Read current index.html to extract HTML structure ----
const currentHtml = read(path.join(STATIC_DIR, 'index.html'));

// Extract CSS block
const cssMatch = currentHtml.match(/<style>([\s\S]*?)<\/style>/);
if (!cssMatch) { console.error('Could not extract <style> from index.html'); process.exit(1); }
const cssContent = cssMatch[1];

// Extract body HTML between <body> and the <script tag
const bodyMatch = currentHtml.match(/<body>([\s\S]*?)<script/);
if (!bodyMatch) { console.error('Could not extract body HTML'); process.exit(1); }
const bodyContent = bodyMatch[1].trim();

// Extract app code from the module script
const scriptMatch = currentHtml.match(/<script[^>]*>([\s\S]*?)<\/script>/);
if (!scriptMatch) { console.error('Could not extract script content'); process.exit(1); }
let appCode = scriptMatch[1];
// Strip import lines from app code
appCode = appCode.replace(/^import\s+\{[^}]+\}\s+from\s+['"][^'"]+['"];?\s*$/gm, '');
appCode = appCode.trim();

// ---- Assemble the self-contained HTML ----
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>WLED-Lang Simulator</title>
<style>${cssContent}</style>
</head>
<body>
${bodyContent}
<script>
'use strict';

// ===================================================================
// Self-contained WLED-Lang Simulator — all JS inlined for file:// use
// Built by: node wfx_compiler/simulator_static/build.js
// ===================================================================

// ==================== Palettes ====================
${palettesCode}

// ==================== Fonts ====================
${fontsCode}

// ==================== Sim Engine ====================
${simEngineCode}

// ==================== Renderer ====================
${rendererCode}

// ==================== Compiler ====================
${compilerCode}

// ==================== Application ====================
${appCode}
<\/script>
</body>
</html>
`;

const outPath = path.join(STATIC_DIR, 'index.html');
fs.writeFileSync(outPath, html, 'utf8');
const kb = (html.length / 1024).toFixed(1);
console.log(`Built self-contained index.html (${kb} KB)`);
