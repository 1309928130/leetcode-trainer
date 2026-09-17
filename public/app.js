/**
 * LeetCode Trainer — front-end.
 *
 * Progress is stored in localStorage. Code execution is delegated to the local
 * Node server (`POST /api/run`), which runs the submission with real CPython.
 */

const STORAGE_KEY = 'leetcodeTrainer_v1';
const DATA_VERSION = 1;

// --- State ---
let problems = [];
let progress = loadProgress();
let currentId = null;
let currentTab = 'description';
let codeByProblem = progress.code || {};
let lastRunKind = null; // 'run' | 'submit'

const el = {
  judgeStatus: document.getElementById('judgeStatus'),
  navProblems: document.getElementById('navProblems'),
  navMastered: document.getElementById('navMastered'),
  navStats: document.getElementById('navStats'),
  sidebar: document.getElementById('sidebar'),
  searchInput: document.getElementById('searchInput'),
  difficultyFilter: document.getElementById('difficultyFilter'),
  problemList: document.getElementById('problemList'),
  main: document.querySelector('.main'),
  workbench: document.getElementById('workbench'),
  problemBody: document.getElementById('problemBody'),
  problemMain: document.getElementById('problemMain'),
  sidebarResizer: document.getElementById('sidebarResizer'),
  workbenchResizer: document.getElementById('workbenchResizer'),
  foldSidebarBtn: document.getElementById('foldSidebarBtn'),
  unfoldSidebarBtn: document.getElementById('unfoldSidebarBtn'),
  editorWrap: document.getElementById('editorWrap'),
  resultsResizer: document.getElementById('resultsResizer'),
  problemNumber: document.getElementById('problemNumber'),
  problemTitle: document.getElementById('problemTitle'),
  problemDifficulty: document.getElementById('problemDifficulty'),
  problemTags: document.getElementById('problemTags'),
  statementPane: document.getElementById('statementPane'),
  attemptPane: document.getElementById('attemptPane'),
  explanationPane: document.getElementById('explanationPane'),
  hintsPane: document.getElementById('hintsPane'),
  historyPane: document.getElementById('historyPane'),
  tabAttempt: document.getElementById('tabAttempt'),
  tabs: document.getElementById('tabs'),
  toggleSolution: document.getElementById('toggleSolution'),
  solutionBlock: document.getElementById('solutionBlock'),
  solutionCode: document.getElementById('solutionCode'),
  solutionComplexity: document.getElementById('solutionComplexity'),
  copySolutionBtn: document.getElementById('copySolutionBtn'),
  zhanBtn: document.getElementById('zhanBtn'),
  codeEditor: document.getElementById('codeEditor'),
  gutter: document.getElementById('gutter'),
  resetCodeBtn: document.getElementById('resetCodeBtn'),
  runBtn: document.getElementById('runBtn'),
  submitBtn: document.getElementById('submitBtn'),
  results: document.getElementById('results'),
  resultsSummary: document.getElementById('resultsSummary'),
  resultsBody: document.getElementById('resultsBody'),
  statsPage: document.getElementById('statsPage'),
  statsSummary: document.getElementById('statsSummary'),
  problemStatsTable: document.getElementById('problemStatsTable'),
  attemptLogTable: document.getElementById('attemptLogTable'),
  exportStatsBtn: document.getElementById('exportStatsBtn'),
  clearStatsBtn: document.getElementById('clearStatsBtn'),
};

// --- Progress persistence ---
function loadProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultProgress();
    const p = JSON.parse(raw);
    return {
      version: DATA_VERSION,
      mastered: p.mastered || {},
      code: p.code || {},
      runs: Array.isArray(p.runs) ? p.runs : [],
      submissions: p.submissions || {},
      lastProblem: p.lastProblem || null,
    };
  } catch {
    return defaultProgress();
  }
}

function defaultProgress() {
  return {
    version: DATA_VERSION,
    mastered: {},
    code: {},
    runs: [],
    submissions: {},
    lastProblem: null,
  };
}

/** Max saved versions kept per problem. */
const MAX_VERSIONS_PER_PROBLEM = 30;

let saveTimer = null;
function saveProgress() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    } catch (e) {
      console.warn('Failed to save progress', e);
    }
  }, 200);
}

// --- Helpers ---
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Minimal Markdown renderer — enough for problem statements and explanations.
 * Supports headings, bold, italic, inline code, fenced code, lists, links,
 * blockquotes, and paragraphs. Inline code is protected before other inline rules.
 */
function renderMarkdown(src) {
  if (!src) return '';
  const lines = String(src).replace(/\r\n/g, '\n').split('\n');
  let html = '';
  let i = 0;
  let inList = false;
  let inCode = false;
  let codeLines = [];

  const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };

  const inline = (text) => {
    const codes = [];
    let t = text.replace(/`([^`]+)`/g, (_, c) => {
      codes.push(`<code>${escapeHtml(c)}</code>`);
      return `\u0000${codes.length - 1}\u0000`;
    });
    t = escapeHtml(t);
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
    t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    t = t.replace(/\u0000(\d+)\u0000/g, (_, n) => codes[Number(n)]);
    return t;
  };

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim().startsWith('```')) {
      if (inCode) {
        html += `<pre>${escapeHtml(codeLines.join('\n'))}</pre>`;
        codeLines = [];
        inCode = false;
      } else {
        closeList();
        inCode = true;
      }
      i += 1;
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      i += 1;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      closeList();
      const level = Math.min(heading[1].length + 1, 6);
      html += `<h${level}>${inline(heading[2])}</h${level}>`;
      i += 1;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${inline(line.replace(/^\s*[-*]\s+/, ''))}</li>`;
      i += 1;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      closeList();
      html += `<blockquote>${inline(line.replace(/^\s*>\s?/, ''))}</blockquote>`;
      i += 1;
      continue;
    }

    if (line.trim() === '') {
      closeList();
      i += 1;
      continue;
    }

    closeList();
    html += `<p>${inline(line)}</p>`;
    i += 1;
  }
  if (inCode && codeLines.length) html += `<pre>${escapeHtml(codeLines.join('\n'))}</pre>`;
  closeList();
  return html;
}

// --- Problem list ---
function renderProblemList() {
  const query = el.searchInput.value.trim().toLowerCase();
  const diff = el.difficultyFilter.value;
  const showMasteredOnly = el.navMastered.classList.contains('active');

  const filtered = problems
    .filter((p) => {
      if (showMasteredOnly && !progress.mastered[p.id]) return false;
      if (diff && p.difficulty !== diff) return false;
      if (query) {
        const hay = `${p.number} ${p.title} ${(p.tags || []).join(' ')}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    })
    .sort((a, b) => (a.number || 0) - (b.number || 0));

  if (filtered.length === 0) {
    el.problemList.innerHTML = `<p style="color:var(--muted);font-size:0.82rem;padding:12px;text-align:center">${
      showMasteredOnly ? 'No mastered problems yet. Use 斩 to mark one.' : 'No problems match.'
    }</p>`;
    return;
  }

  el.problemList.innerHTML = filtered.map((p) => {
    const mastered = Boolean(progress.mastered[p.id]);
    return `
      <div class="problem-item${p.id === currentId ? ' active' : ''}${mastered ? ' mastered' : ''}" data-id="${escapeHtml(p.id)}">
        <span class="dot ${p.difficulty.toLowerCase()}"></span>
        <span class="problem-item-num">${p.number || ''}</span>
        <span class="problem-item-title">${escapeHtml(p.title)}</span>
        ${mastered ? '<span class="tick">✓</span>' : ''}
      </div>
    `;
  }).join('');

  el.problemList.querySelectorAll('.problem-item').forEach((node) => {
    node.addEventListener('click', () => selectProblem(node.dataset.id));
  });
}

// --- Problem pane ---
function renderStatement(p) {
  let html = renderMarkdown(p.statement);

  if (p.examples && p.examples.length) {
    html += '<h3>Examples</h3>';
    p.examples.forEach((ex) => {
      const out = Array.isArray(ex.output) ? `[${ex.output.join(', ')}]` : ex.output;
      html += `
        <div class="example-block">
          <div class="ex-line"><span class="ex-label">Input:</span>${escapeHtml(ex.input)}</div>
          <div class="ex-line"><span class="ex-label">Output:</span>${escapeHtml(out)}</div>
          ${ex.explain ? `<div class="example-explain">${inlinePlain(ex.explain)}</div>` : ''}
        </div>
      `;
    });
  }

  if (p.constraints && p.constraints.length) {
    html += '<h3>Constraints</h3><ul class="constraints">';
    html += p.constraints.map((c) => `<li><code>${escapeHtml(c)}</code></li>`).join('');
    html += '</ul>';
  }

  el.statementPane.innerHTML = html;
}

function inlinePlain(text) {
  return escapeHtml(text).replace(/`([^`]+)`/g, '<code>$1</code>');
}

function renderAttempt(p) {
  if (!p.originalAttempt) {
    el.tabAttempt.style.display = 'none';
    return;
  }
  el.tabAttempt.style.display = '';
  let html = '';
  if (p.attemptNotes && p.attemptNotes.length) {
    html += '<h3>What needed adjusting</h3>';
    html += p.attemptNotes.map((n) => `
      <div class="issue-item">
        <div class="issue-title">${inlinePlain(n.issue)}</div>
        <div class="issue-detail">${renderMarkdown(n.detail)}</div>
      </div>
    `).join('');
  }
  html += '<h3>Original attempt</h3>';
  html += `<pre>${escapeHtml(p.originalAttempt)}</pre>`;
  el.attemptPane.innerHTML = html;
}

function renderExplanation(p) {
  el.explanationPane.innerHTML = renderMarkdown(p.explanation || '_No explanation yet._');
}

function renderHints(p) {
  const hints = p.hints || [];
  if (!hints.length) {
    el.hintsPane.innerHTML = '<p style="color:var(--muted)">No hints for this problem.</p>';
    return;
  }
  el.hintsPane.innerHTML = hints.map((h, idx) => `
    <details class="hint">
      <summary>Hint ${idx + 1}</summary>
      <div>${renderMarkdown(h)}</div>
    </details>
  `).join('');
}

/** Every version you've submitted for this problem, newest first. */
function renderHistory(p) {
  const subs = getSubmissions(p.id).slice().reverse();

  if (!subs.length) {
    el.historyPane.innerHTML = '<p style="color:var(--muted)">No submissions saved yet. '
      + 'Every time you hit <strong>Submit</strong>, a full snapshot of your code is kept here '
      + 'so you can review it later. (<strong>Run</strong> is not saved.)</p>';
    return;
  }

  el.historyPane.innerHTML = `
    <p class="history-note">${subs.length} saved version${subs.length === 1 ? '' : 's'} — newest first.
      Submitting the same code twice still creates a new entry. Keeps the last ${MAX_VERSIONS_PER_PROBLEM}.</p>
    ${subs.map((sub) => `
      <details class="history-item" data-version="${sub.version}">
        <summary class="history-summary">
          <span class="history-version">v${sub.version}</span>
          <span class="history-status ${sub.ok ? 'ok' : 'bad'}">${sub.ok ? '✓' : '✗'} ${escapeHtml(submissionSummary(sub))}</span>
          <span class="history-time">${escapeHtml(formatTime(sub.timestamp))}${sub.totalMs != null ? ` · ${sub.totalMs} ms` : ''}</span>
        </summary>
        ${sub.error ? `<p class="history-error">${escapeHtml(sub.error)}</p>` : ''}
        <pre class="history-code">${escapeHtml(sub.code)}</pre>
        <div class="history-actions">
          <button type="button" class="btn-icon" data-action="load-version" data-version="${sub.version}">Load into editor</button>
          <button type="button" class="btn-icon" data-action="copy-version" data-version="${sub.version}">Copy code</button>
          <button type="button" class="btn-icon" data-action="delete-version" data-version="${sub.version}">Delete</button>
        </div>
      </details>
    `).join('')}
  `;

  el.historyPane.querySelectorAll('[data-action="load-version"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sub = getSubmissions(p.id).find((s) => s.version === Number(btn.dataset.version));
      if (!sub) return;
      if (!confirm(`Replace the editor with version v${sub.version}? Your current code will be overwritten (but any already-submitted versions stay saved).`)) return;
      setEditorCode(sub.code);
      codeByProblem[p.id] = sub.code;
      progress.code = codeByProblem;
      saveProgress();
      switchTab('description');
    });
  });

  el.historyPane.querySelectorAll('[data-action="copy-version"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const sub = getSubmissions(p.id).find((s) => s.version === Number(btn.dataset.version));
      if (!sub) return;
      try {
        await navigator.clipboard.writeText(sub.code);
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy code'; }, 1200);
      } catch {
        btn.textContent = 'Failed';
      }
    });
  });

  el.historyPane.querySelectorAll('[data-action="delete-version"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const version = Number(btn.dataset.version);
      if (!confirm(`Delete saved version v${version}? This cannot be undone.`)) return;
      const list = getSubmissions(p.id).filter((s) => s.version !== version);
      progress.submissions[p.id] = list;
      saveProgress();
      renderHistory(p);
    });
  });
}

// --- Editor ---
function updateGutter() {
  const lines = el.codeEditor.value.split('\n').length;
  let g = '';
  for (let i = 1; i <= Math.max(lines, 1); i += 1) g += `${i}\n`;
  el.gutter.textContent = g;
  el.gutter.scrollTop = el.codeEditor.scrollTop;
}

function setEditorCode(code) {
  el.codeEditor.value = code;
  updateGutter();
}

function currentProblem() {
  return problems.find((p) => p.id === currentId) || null;
}

// --- Results rendering ---
function renderResults(data, kind) {
  const summary = data.summary || { passed: 0, total: 0 };
  const allPassed = data.ok;
  const isCompileError = Boolean(data.compileError);

  el.resultsSummary.className = 'results-summary';
  if (isCompileError) {
    el.resultsSummary.textContent = 'Error';
    el.resultsSummary.classList.add('bad');
  } else {
    el.resultsSummary.textContent = `${summary.passed} / ${summary.total} passed${data.totalMs != null ? ` · ${data.totalMs} ms` : ''}`;
    el.resultsSummary.classList.add(allPassed ? 'ok' : 'bad');
  }

  let html = '';
  if (isCompileError) {
    html += `<div class="banner bad">Could not run your code<pre>${escapeHtml(data.compileError)}</pre></div>`;
  } else if (allPassed) {
    html += `<div class="banner ok">✓ ${kind === 'submit' ? 'Accepted' : 'All example tests passed'} — ${summary.passed}/${summary.total}</div>`;
  } else {
    html += `<div class="banner bad">✗ ${summary.total - summary.passed} of ${summary.total} test(s) failed</div>`;
  }

  (data.results || []).forEach((r) => {
    html += `
      <div class="result-row ${r.passed ? 'pass' : 'fail'}">
        <span class="result-icon">${r.passed ? '✓' : '✗'}</span>
        <div class="result-name">
          ${escapeHtml(r.name)}
          ${r.passed ? '' : `<div class="result-detail">${
            r.error
              ? `<span class="err">${escapeHtml(r.error)}</span>`
              : `expected <span class="exp">${escapeHtml(r.expected)}</span> · got <span class="got">${escapeHtml(r.got)}</span>`
          }</div>`}
        </div>
        <span class="result-dur">${r.durationMs != null ? `${r.durationMs} ms` : ''}</span>
      </div>
    `;
  });

  el.resultsBody.innerHTML = html;
}

// --- Run / Submit ---
async function runCode(kind) {
  const p = currentProblem();
  if (!p) return;

  const code = el.codeEditor.value;
  codeByProblem[p.id] = code;
  progress.code = codeByProblem;
  saveProgress();

  const isSubmit = kind === 'submit';
  const tests = isSubmit ? (p.tests || []) : (p.tests || []).slice(0, 2);
  const className = p.className || 'Solution';
  const method = p.method;
  lastRunKind = kind;

  el.runBtn.disabled = true;
  el.submitBtn.disabled = true;
  el.resultsSummary.className = 'results-summary running';
  el.resultsSummary.textContent = 'Running…';
  el.resultsBody.innerHTML = '<p class="results-placeholder">Executing with CPython…</p>';

  const started = Date.now();
  let data;
  let netError = null;
  try {
    const res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, className, method, tests }),
    });
    if (!res.ok && res.status !== 200) {
      throw new Error(`Server responded ${res.status}`);
    }
    data = await res.json();
  } catch (e) {
    netError = e.message || String(e);
    data = { ok: false, compileError: `Could not reach the judge server. Is it running (npm run serve)?\n${netError}`, results: [], summary: { passed: 0, total: tests.length } };
  }

  el.runBtn.disabled = false;
  el.submitBtn.disabled = false;
  renderResults(data, kind);

  const errorText = (data.results || []).find((r) => r.error)?.error || data.compileError || null;

  const runRecord = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    problemId: p.id,
    problemTitle: p.title,
    kind,
    ok: Boolean(data.ok),
    passed: data.summary?.passed || 0,
    total: data.summary?.total || 0,
    totalMs: data.totalMs ?? null,
    error: errorText,
    timestamp: new Date().toISOString(),
  };

  // On Submit, keep a full snapshot of this answer so it can be reviewed later.
  if (isSubmit) {
    runRecord.version = addSubmission(p.id, {
      code,
      ok: Boolean(data.ok),
      passed: runRecord.passed,
      total: runRecord.total,
      totalMs: runRecord.totalMs,
      error: errorText,
      compileError: data.compileError || null,
      timestamp: runRecord.timestamp,
    });
  }

  progress.runs.push(runRecord);
  // Keep the log bounded.
  if (progress.runs.length > 500) progress.runs = progress.runs.slice(-500);
  saveProgress();

  // Auto-mark mastered on an accepted submit.
  if (isSubmit && data.ok && !progress.mastered[p.id]) {
    progress.mastered[p.id] = new Date().toISOString();
    saveProgress();
    updateZhanButton();
    renderProblemList();
  }

  if (isSubmit) renderHistory(p);

  return data;
}

/**
 * Store a full snapshot of a submitted answer.
 * Returns the version number (1-based) assigned to this snapshot.
 */
function addSubmission(problemId, snapshot) {
  if (!progress.submissions) progress.submissions = {};
  const list = progress.submissions[problemId] || [];

  const last = list[list.length - 1];
  const version = (last?.version || 0) + 1;

  list.push({ version, ...snapshot });
  // Drop the oldest snapshots once we exceed the cap.
  while (list.length > MAX_VERSIONS_PER_PROBLEM) list.shift();

  progress.submissions[problemId] = list;
  return version;
}

function getSubmissions(problemId) {
  return progress.submissions?.[problemId] || [];
}

/** Human-readable one-line summary of a snapshot result. */
function submissionSummary(sub) {
  if (sub.compileError) return `Error — ${String(sub.compileError).split('\n')[0]}`;
  return `${sub.passed}/${sub.total} passed`;
}

function updateZhanButton() {
  const p = currentProblem();
  const done = p && progress.mastered[p.id];
  el.zhanBtn.classList.toggle('done', Boolean(done));
  el.zhanBtn.textContent = done ? '✓ Mastered' : '斩';
  el.zhanBtn.title = done ? 'Click to un-master' : 'Mark as mastered';
}

// --- Selection ---
function selectProblem(id, { focusEditor = false } = {}) {
  if (!id || !problems.some((p) => p.id === id)) return;
  currentId = id;
  progress.lastProblem = id;
  saveProgress();

  const p = problems.find((x) => x.id === id);

  el.problemBody.hidden = false;

  el.problemNumber.textContent = p.number ? `${p.number}.` : '';
  el.problemTitle.textContent = p.title;
  el.problemDifficulty.textContent = p.difficulty;
  el.problemDifficulty.className = `pill ${p.difficulty.toLowerCase()}`;
  el.problemTags.innerHTML = [
    ...(p.patterns || []).map((t) => `<span class="tag">🏷 ${escapeHtml(t)}</span>`),
    ...(p.tags || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`),
  ].join('');

  renderStatement(p);
  renderAttempt(p);
  renderExplanation(p);
  renderHints(p);
  renderHistory(p);

  el.solutionCode.textContent = p.solution || '';
  el.solutionComplexity.textContent = p.complexity
    ? `Time ${p.complexity.time} · Space ${p.complexity.space}`
    : '';
  el.solutionBlock.hidden = !p.showSolution;
  el.toggleSolution.textContent = p.showSolution ? 'Hide solution' : 'Solution';

  const saved = progress.code[p.id];
  setEditorCode(saved || p.starterCode || '');
  updateZhanButton();
  switchTab('description');
  renderProblemList();

  // Reset results panel for the new problem.
  el.resultsSummary.className = 'results-summary';
  el.resultsSummary.textContent = '';
  el.resultsBody.innerHTML = '<p class="results-placeholder">Run your code to see test results. <kbd>Ctrl</kbd>+<kbd>Enter</kbd> to run.</p>';

  if (focusEditor) el.codeEditor.focus();
}

function switchTab(tab) {
  currentTab = tab;
  el.tabs.querySelectorAll('.tab').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  document.querySelectorAll('.tab-pane').forEach((pane) => {
    pane.classList.toggle('active', pane.dataset.pane === tab);
  });
}

// --- Views ---
function setNavActive(which) {
  [el.navProblems, el.navMastered, el.navStats].forEach((b) => b.classList.remove('active'));
  if (which === 'stats') el.navStats.classList.add('active');
  else if (which === 'mastered') el.navMastered.classList.add('active');
  else el.navProblems.classList.add('active');
}

function showPracticeView(masteredOnly) {
  el.statsPage.hidden = true;
  getLayout().classList.remove('stats-view');
  el.sidebar.hidden = false;
  el.main.hidden = false;
  el.workbench.hidden = false;
  el.sidebarResizer.hidden = false;
  el.workbenchResizer.hidden = false;
  el.navMastered.classList.toggle('active', masteredOnly);
  setNavActive(masteredOnly ? 'mastered' : 'problems');
  if (masteredOnly) {
    el.navProblems.classList.remove('active');
    el.navMastered.classList.add('active');
  }
  renderProblemList();
  // If the current problem is filtered out, clear selection.
  const visible = problems.some((p) => p.id === currentId
    && (!masteredOnly || progress.mastered[p.id]));
  if (!visible && problems.length) {
    const first = problems.find((p) => !masteredOnly || progress.mastered[p.id]);
    if (first) selectProblem(first.id);
  }
}

function showStatsView() {
  getLayout().classList.add('stats-view');
  el.sidebar.hidden = true;
  el.main.hidden = true;
  el.workbench.hidden = true;
  el.sidebarResizer.hidden = true;
  el.workbenchResizer.hidden = true;
  el.statsPage.hidden = false;
  setNavActive('stats');
  renderStats();
}

function renderStats() {
  const runs = progress.runs || [];
  const submits = runs.filter((r) => r.kind === 'submit');
  const solvedIds = new Set(submits.filter((r) => r.ok).map((r) => r.problemId));
  const totalAttempts = runs.length;
  const accepted = submits.filter((r) => r.ok).length;

  el.statsSummary.innerHTML = `
    <div class="stat-box"><div class="stat-value">${problems.length}</div><div class="stat-label">Problems</div></div>
    <div class="stat-box"><div class="stat-value">${solvedIds.size}</div><div class="stat-label">Solved</div></div>
    <div class="stat-box"><div class="stat-value">${totalAttempts}</div><div class="stat-label">Total runs</div></div>
    <div class="stat-box"><div class="stat-value">${submits.length ? Math.round((accepted / submits.length) * 100) : 0}%</div><div class="stat-label">Submit success</div></div>
    <div class="stat-box"><div class="stat-value">${Object.keys(progress.mastered).length}</div><div class="stat-label">斩 mastered</div></div>
  `;

  const perProblem = problems.slice().sort((a, b) => (a.number || 0) - (b.number || 0)).map((p) => {
    const pruns = runs.filter((r) => r.problemId === p.id);
    const psubs = pruns.filter((r) => r.kind === 'submit');
    const okSubs = psubs.filter((r) => r.ok);
    const bestMs = okSubs.length ? Math.min(...okSubs.map((r) => r.totalMs ?? Infinity)) : null;
    const last = psubs.length ? psubs[psubs.length - 1].timestamp : null;
    return { p, runs: pruns.length, submits: psubs.length, solved: okSubs.length > 0, bestMs, last };
  });

  el.problemStatsTable.querySelector('tbody').innerHTML = perProblem.map((row) => `
    <tr>
      <td>${row.p.number || ''}</td>
      <td>${escapeHtml(row.p.title)}</td>
      <td>${row.p.difficulty}</td>
      <td>${row.runs}</td>
      <td>${row.submits}</td>
      <td class="${row.solved ? 'ok' : ''}">${row.solved ? '✓' : '—'}</td>
      <td>${row.bestMs != null && Number.isFinite(row.bestMs) ? `${row.bestMs} ms` : '—'}</td>
      <td>${row.last ? escapeHtml(formatTime(row.last)) : '—'}</td>
      <td>${progress.mastered[row.p.id] ? '✓' : ''}</td>
    </tr>
  `).join('');

  const log = runs.slice().reverse().slice(0, 200);
  el.attemptLogTable.querySelector('tbody').innerHTML = log.length ? log.map((r) => `
    <tr>
      <td>${escapeHtml(formatTime(r.timestamp))}</td>
      <td>${escapeHtml(r.problemTitle || r.problemId)}</td>
      <td>${r.kind}</td>
      <td class="${r.ok ? 'ok' : 'bad'}">${r.ok ? '✓ Accepted' : '✗ Failed'}</td>
      <td>${r.passed}/${r.total}</td>
      <td>${r.totalMs ?? '—'}</td>
      <td>${r.error ? escapeHtml(String(r.error).slice(0, 80)) : ''}</td>
    </tr>
  `).join('') : '<tr><td colspan="7" style="text-align:center;color:var(--muted)">No runs yet.</td></tr>';
}

function formatTime(iso) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function exportStats() {
  const payload = {
    exportedAt: new Date().toISOString(),
    progress,
    problems: problems.map((p) => ({ id: p.id, number: p.number, title: p.title, difficulty: p.difficulty })),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `leetcode-trainer-stats-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// --- Judge status ---
async function checkJudge() {
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    if (data.ok) {
      el.judgeStatus.textContent = `judge: ${data.python}`;
      el.judgeStatus.className = 'judge-status ok';
    } else {
      el.judgeStatus.textContent = 'judge offline';
      el.judgeStatus.className = 'judge-status bad';
      el.judgeStatus.title = data.error || 'Python not found';
    }
  } catch {
    el.judgeStatus.textContent = 'judge offline';
    el.judgeStatus.className = 'judge-status bad';
    el.judgeStatus.title = 'The local server is not reachable.';
  }
}

// --- Column resizing (sidebar | problem | workbench) ---
const COL_KEY = 'leetcodeTrainer_cols';
const SIDEBAR_MIN = 160;
const SIDEBAR_MAX = 560;
const SIDEBAR_DEFAULT = 280;
const PROBLEM_MIN = 260;
const PROBLEM_DEFAULT_PCT = 45; // initial share of the flexible area
const MAIN_MIN = 300;

function getLayout() {
  return document.querySelector('.layout');
}

function setColVar(name, px) {
  document.documentElement.style.setProperty(name, `${Math.round(px)}px`);
}

function saveCols() {
  const layout = getLayout();
  const sidebarW = layout.querySelector('.sidebar').getBoundingClientRect().width;
  const problemW = el.problemMain.getBoundingClientRect().width;
  try {
    localStorage.setItem(COL_KEY, JSON.stringify({ sidebarW, problemW }));
  } catch { /* ignore */ }
}

/** Restore saved widths, or derive sensible defaults for a first visit. */
function initColumns() {
  const layout = getLayout();
  const total = layout.getBoundingClientRect().width;
  const avail = total - 14; // two handles

  let sidebarW = SIDEBAR_DEFAULT;
  let problemW = Math.round((avail - sidebarW) * (PROBLEM_DEFAULT_PCT / 100));
  let restored = false;

  try {
    const saved = JSON.parse(localStorage.getItem(COL_KEY) || 'null');
    if (saved && Number.isFinite(saved.sidebarW) && Number.isFinite(saved.problemW)) {
      sidebarW = saved.sidebarW;
      problemW = saved.problemW;
      restored = true;
    }
  } catch { /* ignore */ }

  // Clamp so the three panes always fit.
  const maxSidebar = Math.min(SIDEBAR_MAX, avail - PROBLEM_MIN - MAIN_MIN);
  sidebarW = Math.min(Math.max(sidebarW, SIDEBAR_MIN), Math.max(SIDEBAR_MIN, maxSidebar));
  problemW = Math.min(Math.max(problemW, PROBLEM_MIN), Math.max(PROBLEM_MIN, avail - sidebarW - MAIN_MIN));

  setColVar('--sidebar-w', sidebarW);
  setColVar('--problem-w', problemW);
  return { restored, avail };
}

/**
 * Wire a vertical drag handle.
 * @param {HTMLElement} handle
 * @param {(deltaX: number) => void} onDelta  called with the horizontal movement
 * @param {() => void} onDone
 */
function bindColResizer(handle, onDelta, onDone) {
  let dragging = false;
  let startX = 0;

  const move = (e) => {
    if (!dragging) return;
    const x = e.touches ? e.touches[0].clientX : e.clientX;
    onDelta(x - startX);
    startX = x;
  };

  const up = () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    window.removeEventListener('touchmove', move);
    window.removeEventListener('touchend', up);
    onDone();
  };

  const down = (e) => {
    dragging = true;
    startX = e.touches ? e.touches[0].clientX : e.clientX;
    handle.classList.add('dragging');
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    window.addEventListener('touchmove', move, { passive: true });
    window.addEventListener('touchend', up);
    e.preventDefault();
  };

  handle.addEventListener('mousedown', down);
  handle.addEventListener('touchstart', down, { passive: false });

  // Keyboard nudging for accessibility.
  handle.addEventListener('keydown', (e) => {
    const step = 20;
    if (e.key === 'ArrowLeft') { onDelta(-step); onDone(); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { onDelta(step); onDone(); e.preventDefault(); }
  });
}

function currentWidths() {
  const layout = getLayout();
  return {
    layout,
    total: layout.getBoundingClientRect().width,
    sidebarW: layout.querySelector('.sidebar').getBoundingClientRect().width,
    problemW: el.problemMain.getBoundingClientRect().width,
  };
}

function initColumnResizers() {
  // Sidebar | problem
  bindColResizer(
    el.sidebarResizer,
    (dx) => {
      const { total, sidebarW } = currentWidths();
      const avail = total - 14;
      let next = sidebarW + dx;
      next = Math.min(Math.max(next, SIDEBAR_MIN), Math.min(SIDEBAR_MAX, avail - PROBLEM_MIN - MAIN_MIN));
      setColVar('--sidebar-w', next);
      updateGutter();
    },
    saveCols,
  );

  // Problem | workbench
  bindColResizer(
    el.workbenchResizer,
    (dx) => {
      const { total, sidebarW, problemW } = currentWidths();
      const avail = total - 14;
      let next = problemW + dx;
      next = Math.min(Math.max(next, PROBLEM_MIN), avail - sidebarW - MAIN_MIN);
      setColVar('--problem-w', next);
      updateGutter();
    },
    saveCols,
  );

  // Double-click resets both columns to defaults.
  const resetCols = () => {
    localStorage.removeItem(COL_KEY);
    document.documentElement.style.removeProperty('--sidebar-w');
    document.documentElement.style.removeProperty('--problem-w');
    initColumns();
    updateGutter();
  };
  el.sidebarResizer.addEventListener('dblclick', resetCols);
  el.workbenchResizer.addEventListener('dblclick', resetCols);

  // Keep columns within bounds when the window is resized.
  let colTimer = null;
  let wasStacked = window.innerWidth <= 1100;
  window.addEventListener('resize', () => {
    clearTimeout(colTimer);
    colTimer = setTimeout(() => {
      const isStacked = window.innerWidth <= 1100;

      // Crossing the breakpoint: recompute sensible widths for the new mode.
      if (isStacked !== wasStacked) {
        wasStacked = isStacked;
        initColumns();
        updateGutter();
        return;
      }
      if (isStacked) return; // stacked layout handles its own sizing

      const { layout, total, sidebarW, problemW } = currentWidths();
      const avail = total - 14;
      if (sidebarW + problemW + MAIN_MIN > avail) {
        const next = Math.max(PROBLEM_MIN, avail - sidebarW - MAIN_MIN);
        setColVar('--problem-w', next);
        saveCols();
      }
      updateGutter();
    }, 150);
  });
}

// --- Sidebar folding ---
function setSidebarFolded(folded) {
  const layout = getLayout();
  layout.classList.toggle('sidebar-collapsed', folded);
  document.body.classList.toggle('sidebar-folded', folded);
  el.foldSidebarBtn.title = folded ? 'Show the problem list' : 'Hide the problem list';
  try { localStorage.setItem('leetcodeTrainer_sidebarFolded', folded ? '1' : '0'); } catch { /* ignore */ }
  requestAnimationFrame(updateGutter);
}

function initSidebarFold() {
  let folded = localStorage.getItem('leetcodeTrainer_sidebarFolded') === '1';
  // Never start folded after arriving from the 斩 Mastered view on a narrow screen.
  if (window.innerWidth < 720) folded = false;
  setSidebarFolded(folded);

  el.foldSidebarBtn.addEventListener('click', () => setSidebarFolded(true));
  el.unfoldSidebarBtn.addEventListener('click', () => setSidebarFolded(false));
}

// --- Results panel resizing ---
const RESULTS_H_KEY = 'leetcodeTrainer_resultsH';
const DEFAULT_RESULTS_H = 220;

function setResultsHeight(px) {
  const h = Math.max(90, Math.round(px));
  document.documentElement.style.setProperty('--results-h', `${h}px`);
  try { localStorage.setItem(RESULTS_H_KEY, String(h)); } catch { /* ignore */ }
  return h;
}

function initResultsResizer() {
  const saved = Number(localStorage.getItem(RESULTS_H_KEY));
  if (Number.isFinite(saved) && saved >= 90) {
    document.documentElement.style.setProperty('--results-h', `${saved}px`);
  }

  const handle = el.resultsResizer;
  const workbench = el.workbench;
  let startY = 0;
  let startH = 0;
  let dragging = false;

  const currentH = () => el.results.getBoundingClientRect().height;

  const onMove = (e) => {
    if (!dragging) return;
    const y = e.touches ? e.touches[0].clientY : e.clientY;
    // Dragging up (negative delta) makes the results panel taller.
    setResultsHeight(startH - (y - startY));
  };

  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    window.removeEventListener('touchmove', onMove);
    window.removeEventListener('touchend', onUp);
    updateGutter();
  };

  const onDown = (e) => {
    dragging = true;
    startY = e.touches ? e.touches[0].clientY : e.clientY;
    startH = currentH();
    handle.classList.add('dragging');
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'row-resize';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onUp);
    e.preventDefault();
  };

  handle.addEventListener('mousedown', onDown);
  handle.addEventListener('touchstart', onDown, { passive: false });

  // Double-click (or Enter) restores the default height.
  handle.addEventListener('dblclick', () => {
    setResultsHeight(DEFAULT_RESULTS_H);
    updateGutter();
  });
  handle.addEventListener('keydown', (e) => {
    const step = 24;
    if (e.key === 'ArrowUp') {
      setResultsHeight(currentH() + step);
      updateGutter();
      e.preventDefault();
    } else if (e.key === 'ArrowDown') {
      setResultsHeight(currentH() - step);
      updateGutter();
      e.preventDefault();
    } else if (e.key === 'Home') {
      setResultsHeight(DEFAULT_RESULTS_H);
      updateGutter();
      e.preventDefault();
    }
  });

  // Falling back to the default if the window gets too small for the saved height.
  window.addEventListener('resize', () => {
    const maxH = workbench.getBoundingClientRect().height - 120;
    if (currentH() > maxH) setResultsHeight(Math.max(90, maxH));
    updateGutter();
  });
}

// --- Editor events ---
function bindEditor() {
  el.codeEditor.addEventListener('input', () => {
    updateGutter();
    if (currentId) {
      codeByProblem[currentId] = el.codeEditor.value;
      progress.code = codeByProblem;
      saveProgress();
    }
  });

  el.codeEditor.addEventListener('scroll', () => {
    el.gutter.scrollTop = el.codeEditor.scrollTop;
  });

  // Tab inserts 4 spaces instead of moving focus; Shift+Tab dedents.
  el.codeEditor.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = el.codeEditor.selectionStart;
      const end = el.codeEditor.selectionEnd;
      const value = el.codeEditor.value;
      if (!e.shiftKey) {
        el.codeEditor.value = `${value.slice(0, start)}    ${value.slice(end)}`;
        el.codeEditor.selectionStart = el.codeEditor.selectionEnd = start + 4;
      } else {
        const lineStart = value.lastIndexOf('\n', start - 1) + 1;
        if (value.slice(lineStart, lineStart + 4) === '    ') {
          el.codeEditor.value = value.slice(0, lineStart) + value.slice(lineStart + 4);
          el.codeEditor.selectionStart = el.codeEditor.selectionEnd = Math.max(lineStart, start - 4);
        }
      }
      updateGutter();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      runCode('run');
    }
  });
}

// --- Init ---
function bindEvents() {
  el.searchInput.addEventListener('input', renderProblemList);
  el.difficultyFilter.addEventListener('change', renderProblemList);

  el.navProblems.addEventListener('click', () => showPracticeView(false));
  el.navMastered.addEventListener('click', () => showPracticeView(true));
  el.navStats.addEventListener('click', showStatsView);

  el.tabs.addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (tab) switchTab(tab.dataset.tab);
  });

  el.runBtn.addEventListener('click', () => runCode('run'));
  el.submitBtn.addEventListener('click', () => runCode('submit'));

  el.resetCodeBtn.addEventListener('click', () => {
    const p = currentProblem();
    if (!p) return;
    if (!confirm('Reset the editor to the starter code? Your current code for this problem will be lost.')) return;
    setEditorCode(p.starterCode || '');
    codeByProblem[p.id] = el.codeEditor.value;
    progress.code = codeByProblem;
    saveProgress();
  });

  el.toggleSolution.addEventListener('click', () => {
    const p = currentProblem();
    if (!p) return;
    p.showSolution = !p.showSolution;
    el.solutionBlock.hidden = !p.showSolution;
    el.toggleSolution.textContent = p.showSolution ? 'Hide solution' : 'Solution';
  });

  el.copySolutionBtn.addEventListener('click', async () => {
    const p = currentProblem();
    if (!p) return;
    try {
      await navigator.clipboard.writeText(p.solution || '');
      el.copySolutionBtn.textContent = 'Copied!';
      setTimeout(() => { el.copySolutionBtn.textContent = 'Copy'; }, 1200);
    } catch {
      el.copySolutionBtn.textContent = 'Failed';
    }
  });

  el.zhanBtn.addEventListener('click', () => {
    const p = currentProblem();
    if (!p) return;
    if (progress.mastered[p.id]) delete progress.mastered[p.id];
    else progress.mastered[p.id] = new Date().toISOString();
    saveProgress();
    updateZhanButton();
    renderProblemList();
  });

  el.exportStatsBtn.addEventListener('click', exportStats);
  el.clearStatsBtn.addEventListener('click', () => {
    if (!confirm('Reset all progress (mastered, saved code, run history)? This cannot be undone.')) return;
    progress = defaultProgress();
    codeByProblem = progress.code;
    saveProgress();
    if (currentId) selectProblem(currentId);
    renderProblemList();
    renderStats();
  });
}

async function init() {
  bindEvents();
  bindEditor();
  initColumns();
  initColumnResizers();
  initSidebarFold();
  initResultsResizer();
  checkJudge();

  try {
    const res = await fetch('./data/problems.json');
    const data = await res.json();
    problems = data.problems || [];
  } catch (e) {
    console.error('Failed to load problems', e);
    el.problemList.innerHTML = '<p style="color:var(--bad);padding:12px;font-size:0.82rem">Failed to load problems.json</p>';
    return;
  }

  if (problems.length === 0) {
    el.problemList.innerHTML = '<p style="color:var(--muted);padding:12px;font-size:0.82rem">'
      + 'No problems found. Add some to <code>public/data/problems.json</code>.</p>';
    return;
  }

  renderProblemList();

  const startId = (progress.lastProblem && problems.some((p) => p.id === progress.lastProblem))
    ? progress.lastProblem
    : problems[0].id;
  selectProblem(startId);

  // Global run shortcut even when focus is outside the editor.
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      runCode('run');
    }
  });
}

init();
