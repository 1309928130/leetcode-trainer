#!/usr/bin/env node
/**
 * Local dev server for the LeetCode Trainer.
 *
 *   node server/index.js            (defaults to port 5050)
 *   PORT=6060 node server/index.js
 *
 * Serves ./public statically and exposes POST /api/run, which shells out to a
 * real CPython interpreter (./server/judge.py) to grade a submission against
 * the problem's test cases.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { URL } = require('node:url');

const PORT = Number(process.env.PORT || 5050);
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const JUDGE = path.join(__dirname, 'judge.py');

/** Preferred interpreter, first one that works wins. */
const PYTHON_CANDIDATES = [
  process.env.PYTHON,
  'python',
  'python3',
  'py',
].filter(Boolean);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

const MAX_BODY_BYTES = 1024 * 1024; // 1 MB
const RUN_TIMEOUT_MS = Number(process.env.JUDGE_TIMEOUT_MS || 8000);

// --- Python discovery (once, at startup) ---
let resolvedPython = null;
let pythonCheckError = null;

function probePython() {
  return new Promise((resolve) => {
    const candidates = [...PYTHON_CANDIDATES];
    const tryNext = () => {
      if (candidates.length === 0) {
        pythonCheckError =
          'No Python interpreter found. Set PYTHON to a python executable.';
        return resolve(null);
      }
      const cmd = candidates.shift();
      const child = spawn(cmd, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { out += d; });
      child.on('error', () => tryNext());
      child.on('close', (code) => {
        if (code === 0) {
          resolvedPython = cmd;
          console.log(`[judge] using Python: ${cmd} (${out.trim()})`);
          resolve(cmd);
        } else {
          tryNext();
        }
      });
    };
    tryNext();
  });
}

function runJudge(job) {
  return new Promise((resolve) => {
    if (!resolvedPython) {
      return resolve({
        status: 500,
        body: { ok: false, compileError: pythonCheckError || 'Python unavailable.', results: [], summary: { passed: 0, total: 0 } },
      });
    }

    const child = spawn(resolvedPython, [JUDGE], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
    }, RUN_TIMEOUT_MS);

    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });

    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ status: 500, body: { ok: false, compileError: `Failed to start Python: ${e.message}`, results: [], summary: { passed: 0, total: 0 } } });
    });

    child.on('close', () => {
      clearTimeout(timer);
      if (killed) {
        return resolve({
          status: 200,
          body: {
            ok: false,
            compileError: `Time limit exceeded (${RUN_TIMEOUT_MS} ms) — possible infinite loop.`,
            results: [],
            summary: { passed: 0, total: job.tests?.length || 0 },
          },
        });
      }
      try {
        const parsed = JSON.parse(stdout);
        resolve({ status: 200, body: parsed });
      } catch {
        resolve({
          status: 500,
          body: {
            ok: false,
            compileError: `Judge produced no valid output.${stderr ? `\n${stderr.trim()}` : ''}`,
            results: [],
            summary: { passed: 0, total: 0 },
          },
        });
      }
    });

    child.stdin.end(JSON.stringify(job));
  });
}

// --- Static file serving ---
function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });
    res.end(data);
  });
}

function handleStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel));

  // Prevent path traversal outside PUBLIC_DIR.
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isFile()) return sendFile(res, filePath);
    if (!err && stat.isDirectory()) return sendFile(res, path.join(filePath, 'index.html'));
    // SPA-ish fallback: unknown paths get index.html.
    if (!path.extname(rel)) return sendFile(res, path.join(PUBLIC_DIR, 'index.html'));
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });
}

// --- Request handling ---
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/api/run') {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Use POST' }));
      return;
    }
    try {
      const raw = await readBody(req);
      const job = JSON.parse(raw);
      if (!job || typeof job.code !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, compileError: 'Missing `code`.', results: [], summary: { passed: 0, total: 0 } }));
        return;
      }
      const started = Date.now();
      const { status, body } = await runJudge(job);
      const totalMs = Date.now() - started;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ...body, totalMs }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, compileError: `Bad request: ${e.message}`, results: [], summary: { passed: 0, total: 0 } }));
    }
    return;
  }

  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: Boolean(resolvedPython), python: resolvedPython, error: pythonCheckError }));
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method not allowed');
    return;
  }

  handleStatic(req, res, url.pathname);
});

probePython().then(() => {
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n  Port ${PORT} is already in use.`);
      console.error('  Either stop the other process, or start on a different port:');
      console.error(`      PORT=${PORT + 1} npm run serve\n`);
      process.exit(1);
    }
    throw err;
  });

  server.listen(PORT, () => {
    console.log(`\n  LeetCode Trainer running:  http://localhost:${PORT}\n`);
    if (!resolvedPython) {
      console.warn(`  [warn] ${pythonCheckError}`);
      console.warn('         Code execution will fail until a Python interpreter is available.\n');
    }
  });
});
