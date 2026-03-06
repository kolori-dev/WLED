#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { Parser } = require('./parser');
const { Codegen } = require('./codegen');

function compile(source) {
  const parser = new Parser(source);
  const ast = parser.parse();
  const codegen = new Codegen(ast);
  return codegen.generate();
}

function compileFile(inputFile, outputFile, opts = {}) {
  let source;
  try {
    source = fs.readFileSync(inputFile, 'utf8');
  } catch (e) {
    console.error(`Error reading ${inputFile}: ${e.message}`);
    return false;
  }

  try {
    if (opts.printAst) {
      const parser = new Parser(source);
      const ast = parser.parse();
      console.log(JSON.stringify(ast, null, 2));
      return true;
    }

    const binary = compile(source);

    if (opts.printHex) {
      const lines = [];
      for (let i = 0; i < binary.length; i += 16) {
        const hex = [];
        const ascii = [];
        for (let j = 0; j < 16; j++) {
          if (i + j < binary.length) {
            const b = binary[i + j];
            hex.push(b.toString(16).padStart(2, '0'));
            ascii.push(b >= 0x20 && b < 0x7F ? String.fromCharCode(b) : '.');
          } else {
            hex.push('  ');
            ascii.push(' ');
          }
        }
        lines.push(`${i.toString(16).padStart(4, '0')}  ${hex.slice(0,8).join(' ')}  ${hex.slice(8).join(' ')}  |${ascii.join('')}|`);
      }
      console.log(lines.join('\n'));
    }

    if (outputFile) {
      const dir = path.dirname(outputFile);
      if (dir && dir !== '.') {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(outputFile, binary);
      console.log(`Compiled ${inputFile} → ${outputFile} (${binary.length} bytes)`);
    }
    return true;
  } catch (e) {
    console.error(`${inputFile}: ${e.message}`);
    return false;
  }
}

function compileAll(dirPath) {
  const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.wled'));
  if (files.length === 0) {
    console.error(`No .wled files found in ${dirPath}`);
    process.exit(1);
  }

  let ok = 0, fail = 0;
  for (const file of files) {
    const input = path.join(dirPath, file);
    const output = path.join(dirPath, file.replace(/\.wled$/, '.wfx'));
    if (compileFile(input, output)) {
      ok++;
    } else {
      fail++;
    }
  }
  console.log(`\nDone: ${ok} compiled, ${fail} failed (${files.length} total)`);
  if (fail > 0) process.exit(1);
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log('Usage: wledc <input.wled> [-o output.wfx]');
    console.log('       wledc <input.wled> --ast    (print AST)');
    console.log('       wledc <input.wled> --hex    (print hex dump)');
    console.log('       wledc <directory>           (compile all .wled files in directory)');
    process.exit(args.length === 0 ? 1 : 0);
  }

  const inputPath = args[0];

  // Check if input is a directory
  try {
    if (fs.statSync(inputPath).isDirectory()) {
      compileAll(inputPath);
      return;
    }
  } catch (e) {
    // Not a directory or doesn't exist — fall through to single-file mode
  }

  let outputFile = null;
  let printAst = false;
  let printHex = false;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '-o' && i + 1 < args.length) {
      outputFile = args[++i];
    } else if (args[i] === '--ast') {
      printAst = true;
    } else if (args[i] === '--hex') {
      printHex = true;
    }
  }

  if (!outputFile && !printAst) {
    outputFile = inputPath.replace(/\.wled$/, '.wfx');
  }

  if (!compileFile(inputPath, outputFile, { printAst, printHex })) {
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { compile };
