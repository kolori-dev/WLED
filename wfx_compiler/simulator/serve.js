#!/usr/bin/env node
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { compile } = require('../compiler');

const PORT = parseInt(process.env.PORT) || 3456;
const DIR = __dirname;
const EFFECTS_DIR = path.resolve(__dirname, '../../wfx_effects');

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
};

const MAX_BODY_SIZE = 1024 * 1024; // 1MB limit

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      body += chunk;
    });
    req.on('end', () => resolve(body));
  });
}

// Validate filename: alphanumeric, underscores, hyphens, must end with .wled
function isValidFilename(name) {
  return /^[a-zA-Z0-9_\- ]+\.wled$/.test(name) && !name.includes('..');
}

const server = http.createServer(async (req, res) => {
  const setCors = () => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  };
  setCors();

  // POST /compile — .wled source → .wfx binary
  if (req.method === 'POST' && req.url === '/compile') {
    let body;
    try { body = await readBody(req); } catch (e) {
      res.writeHead(413, { 'Content-Type': 'text/plain' }); res.end(e.message); return;
    }
    try {
      const binary = compile(body);
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      res.end(Buffer.from(binary));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end(e.message);
    }
    return;
  }

  // GET /effects — list all .wled files
  if (req.method === 'GET' && req.url === '/effects') {
    try {
      const files = fs.readdirSync(EFFECTS_DIR)
        .filter(f => f.endsWith('.wled'))
        .sort();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(files));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(e.message);
    }
    return;
  }

  // GET /effects/<name>.wled — read effect source
  if (req.method === 'GET' && req.url.startsWith('/effects/')) {
    const name = decodeURIComponent(req.url.slice('/effects/'.length));
    if (!isValidFilename(name)) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid filename');
      return;
    }
    const filePath = path.join(EFFECTS_DIR, name);
    if (!filePath.startsWith(EFFECTS_DIR)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    fs.readFile(filePath, 'utf8', (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(data);
    });
    return;
  }

  // PUT /effects/<name>.wled — save effect source
  if (req.method === 'PUT' && req.url.startsWith('/effects/')) {
    const name = decodeURIComponent(req.url.slice('/effects/'.length));
    if (!isValidFilename(name)) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid filename');
      return;
    }
    const filePath = path.join(EFFECTS_DIR, name);
    if (!filePath.startsWith(EFFECTS_DIR)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    let body;
    try { body = await readBody(req); } catch (e) {
      res.writeHead(413, { 'Content-Type': 'text/plain' }); res.end(e.message); return;
    }
    try {
      fs.writeFileSync(filePath, body, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Saved');
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(e.message);
    }
    return;
  }

  // DELETE /effects/<name>.wled — delete effect source
  if (req.method === 'DELETE' && req.url.startsWith('/effects/')) {
    const name = decodeURIComponent(req.url.slice('/effects/'.length));
    if (!isValidFilename(name)) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid filename');
      return;
    }
    const filePath = path.join(EFFECTS_DIR, name);
    if (!filePath.startsWith(EFFECTS_DIR)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    try {
      fs.unlinkSync(filePath);
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Deleted');
    } catch (e) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    }
    return;
  }

  // GET — serve static files
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(DIR, filePath);

  // Security: stay within DIR
  if (!filePath.startsWith(DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  const ext = path.extname(filePath);
  const contentType = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`WFX Simulator running at ${url}`);
  console.log(`Effects directory: ${EFFECTS_DIR}`);

  // Auto-open browser
  const { exec } = require('child_process');
  const cmd = process.platform === 'win32' ? 'start' :
              process.platform === 'darwin' ? 'open' : 'xdg-open';
  exec(`${cmd} ${url}`);
});
