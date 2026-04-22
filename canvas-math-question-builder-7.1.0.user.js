// ==UserScript==
// @name         Canvas Math Question Builder
// @namespace    http://tampermonkey.net/
// @version      7.1.0
// @description  AI-powered 3-panel math question builder. AI returns plain data only — HTML built in JS. Classic Quiz question groups. Registers in Canvas Tool Dashboard.
// @match        https://*.instructure.com/*
// @match        *://canvas.*.edu/*
// @match        *://canvas.*.com/*
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      api.anthropic.com
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/MarkAlanBrest/scripts/main/canvas-math-question-builder-7.1.0.user.js
// @updateURL    https://raw.githubusercontent.com/MarkAlanBrest/scripts/main/canvas-math-question-builder-7.1.0.user.js
// ==/UserScript==

(function () {
  'use strict';

  const ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';
  const APIKEY_KEY = 'AIgrader_APIKey';

  // -- STATE -----------------------------------------------------------------
  let anthropicKey = GM_getValue(APIKEY_KEY, '');
  let versions = [];
  let activeV = 0;
  let quizQuestions = [];
  let lastTopic = '';
  let isGenerating = false;
  let previewDirty = false;

  let togVideo = true;
  let togVideoUrl = '';
  let togExample = true;
  let togExplanation = true;
  let togGraphic = true;

  function getCourseId() {
    const m = window.location.pathname.match(/\/courses\/(\d+)/);
    return m ? m[1] : null;
  }
  function getCSRF() {
    const m = document.cookie.match(/(?:^|;\s*)_csrf_token=([^;]+)/);
    if (m) return decodeURIComponent(m[1]);
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.getAttribute('content') : '';
  }
  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // -- STYLES ----------------------------------------------------------------
  GM_addStyle(`
    #mqb-app {
      display:none; position:fixed; inset:0; z-index:2147483640;
      background:#f1f3f5; flex-direction:column;
      font-family:'Segoe UI',system-ui,sans-serif; font-size:14px; color:#1a1a1a;
    }
    #mqb-app.open { display:flex; }
    #mqb-app * { box-sizing:border-box; }
    #mqb-topbar {
      height:52px; background:#0C447C; color:#fff;
      display:flex; align-items:center; padding:0 20px; gap:14px;
      flex-shrink:0; box-shadow:0 2px 8px rgba(0,0,0,0.2);
    }
    #mqb-topbar h1 { font-size:16px; font-weight:600; margin:0; color:#fff; flex:1; }
    #mqb-close-app {
      background:rgba(255,255,255,0.15); border:none; color:#fff;
      border-radius:6px; padding:6px 14px; font-size:13px; cursor:pointer; font-family:inherit;
    }
    #mqb-close-app:hover { background:rgba(255,255,255,0.28); }
    #mqb-columns {
      display:grid; grid-template-columns:300px 1fr 280px;
      flex:1; min-height:0; overflow:hidden;
    }
    .mqb-col { display:flex; flex-direction:column; overflow-y:auto; height:100%; }
    #mqb-col-left  { background:#fff; border-right:1px solid #e2e4e7; }
    #mqb-col-mid   { background:#f8f9fa; border-right:1px solid #e2e4e7; }
    #mqb-col-right { background:#fff; }
    .mqb-col-header {
      padding:12px 16px 10px; border-bottom:1px solid #e5e7eb;
      font-size:11px; font-weight:700; text-transform:uppercase;
      letter-spacing:.07em; color:#6b7280; flex-shrink:0;
      background:inherit; position:sticky; top:0; z-index:2;
    }
    .mqb-col-body { padding:14px 16px; }
    .mqb-lbl { font-size:12px; color:#555; display:block; margin-bottom:4px; margin-top:10px; }
    .mqb-lbl:first-child { margin-top:0; }
    #mqb-app textarea, #mqb-app input[type=text],
    #mqb-app input[type=password], #mqb-app select {
      width:100%; font-size:13px; padding:8px 10px;
      border:1px solid #d1d5db; border-radius:6px;
      background:#fff; color:#1a1a1a; font-family:inherit; outline:none;
    }
    #mqb-app textarea { resize:vertical; }
    #mqb-app textarea:focus, #mqb-app input:focus, #mqb-app select:focus {
      border-color:#378ADD; box-shadow:0 0 0 2px #dbeafe;
    }
    .mqb-btn {
      cursor:pointer; font-family:inherit; font-size:13px; font-weight:500;
      padding:8px 14px; border-radius:6px; border:1px solid #d1d5db;
      background:#fff; color:#374151; transition:background .12s;
    }
    .mqb-btn:hover { background:#f3f4f6; }
    .mqb-btn:disabled { opacity:.4; cursor:default; }
    .mqb-btn-primary { background:#0C447C!important; color:#fff!important; border-color:#0C447C!important; }
    .mqb-btn-primary:hover { background:#185FA5!important; }
    .mqb-btn-success { background:#166534!important; color:#fff!important; border-color:#166534!important; }
    .mqb-btn-success:hover { background:#15803d!important; }
    .mqb-btn-sm { font-size:12px!important; padding:5px 10px!important; }
    .mqb-btn-ghost { border-color:transparent!important; color:#6b7280!important; background:transparent!important; }
    .mqb-btn-ghost:hover { background:#f3f4f6!important; }
    .mqb-btn-full { width:100%; text-align:center; display:block; }
    .mqb-card { background:#fff; border:1px solid #e5e7eb; border-radius:8px; padding:12px 14px; margin-bottom:12px; }
    .mqb-card-title { font-size:12px; font-weight:600; color:#374151; margin-bottom:6px; }
    .mqb-status { padding:8px 12px; border-radius:6px; font-size:12px; margin-bottom:10px; line-height:1.5; }
    .mqb-status-err  { background:#fef2f2; color:#991b1b; border:1px solid #fca5a5; }
    .mqb-status-ok   { background:#f0fdf4; color:#166534; border:1px solid #86efac; }
    .mqb-status-info { background:#eff6ff; color:#1e40af; border:1px solid #93c5fd; }
    .mqb-vtabs { display:flex; gap:5px; margin-bottom:10px; flex-wrap:wrap; }
    .mqb-vtab {
      padding:5px 12px; font-size:12px; font-weight:500;
      border-radius:6px; border:1px solid #d1d5db;
      cursor:pointer; background:#fff; color:#555; font-family:inherit;
    }
    .mqb-vtab.on { background:#0C447C; color:#fff; border-color:#0C447C; }
    #mqb-preview-wrap { background:#fff; border:1px solid #e5e7eb; border-radius:8px; padding:16px; min-height:200px; }
    #mqb-preview-empty {
      display:flex; align-items:center; justify-content:center;
      height:200px; color:#9ca3af; font-size:13px; text-align:center; line-height:1.7;
    }
    #mqb-preview[contenteditable=true] {
      outline:2px dashed #93C5FD; border-radius:6px; padding:6px; cursor:text;
    }
    #mqb-preview[contenteditable=true]:focus { outline:2px solid #3B82F6; }
    #mqb-edit-bar {
      display:none; align-items:center; gap:8px; margin-bottom:8px;
      padding:7px 10px; background:#FFF7ED; border:1px solid #FED7AA;
      border-radius:6px; font-size:11px; color:#92400E; flex-wrap:wrap;
    }
    #mqb-edit-bar.show { display:flex; }
    .mqb-dirty-dot { width:7px; height:7px; border-radius:50%; background:#F59E0B; display:inline-block; flex-shrink:0; }
    .mqb-ans-grid { display:flex; flex-wrap:wrap; gap:4px; margin-top:6px; }
    .mqb-pill {
      display:inline-block; font-size:11px; padding:2px 8px;
      border-radius:20px; background:#f3f4f6; color:#374151;
      border:1px solid #d1d5db; font-family:monospace;
    }
    .mqb-q-item { border:1px solid #e5e7eb; border-radius:8px; padding:10px 12px; margin-bottom:8px; background:#f9fafb; }
    .mqb-q-item-header { display:flex; align-items:flex-start; justify-content:space-between; gap:6px; margin-bottom:4px; }
    .mqb-q-num { font-weight:600; font-size:13px; color:#111; }
    .mqb-q-topic { font-size:11px; color:#6b7280; margin-top:1px; }
    .mqb-q-eq { font-size:11px; color:#374151; margin-top:3px; }
    .mqb-ver-badge { display:inline-block; font-size:10px; font-weight:600; padding:1px 6px; border-radius:20px; margin-right:3px; }
    .mqb-ver-a { background:#dbeafe; color:#1e40af; }
    .mqb-ver-b { background:#dcfce7; color:#166534; }
    .mqb-ver-c { background:#fef3c7; color:#92400e; }
    .mqb-q-tags { display:flex; gap:4px; flex-wrap:wrap; margin-top:5px; }
    .mqb-q-tag { font-size:10px; padding:1px 7px; border-radius:20px; background:#f1f5f9; color:#475569; border:1px solid #e2e8f0; }
    .mqb-spinner {
      display:inline-block; width:14px; height:14px;
      border:2px solid #bfdbfe; border-top-color:#1e40af;
      border-radius:50%; animation:mqbspin .7s linear infinite;
      vertical-align:middle; margin-right:6px;
    }
    @keyframes mqbspin { to { transform:rotate(360deg); } }
    .mqb-divider { height:1px; background:#e5e7eb; margin:12px 0; }
    .mqb-settings-toggle {
      font-size:12px; color:#6b7280; cursor:pointer;
      display:flex; align-items:center; gap:5px; margin-bottom:8px;
      background:none; border:none; font-family:inherit; padding:0;
    }
    .mqb-settings-toggle:hover { color:#374151; }
    #mqb-settings-body { display:none; }
    #mqb-settings-body.open { display:block; }
    .mqb-tog-section { margin-top:12px; margin-bottom:6px; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; color:#6b7280; }
    .mqb-tog-row {
      display:flex; align-items:center; justify-content:space-between;
      padding:7px 0; border-bottom:1px solid #f1f5f9;
    }
    .mqb-tog-row:last-child { border-bottom:none; }
    .mqb-tog-left { display:flex; flex-direction:column; gap:2px; }
    .mqb-tog-name { font-size:12px; font-weight:500; color:#111827; }
    .mqb-tog-desc { font-size:11px; color:#9ca3af; }
    .mqb-tog-sub { margin-top:5px; display:none; }
    .mqb-tog-sub.show { display:block; }
    .mqb-switch {
      width:36px; height:20px; border-radius:10px; position:relative;
      cursor:pointer; transition:background .2s; flex-shrink:0; border:none; outline:none;
    }
    .mqb-switch-knob {
      position:absolute; top:2px; width:16px; height:16px;
      border-radius:50%; background:#fff; transition:left .2s;
      box-shadow:0 1px 3px rgba(0,0,0,0.2);
    }
  `);

  // -- BUILD APP -------------------------------------------------------------
  const app = document.createElement('div');
  app.id = 'mqb-app';
  app.innerHTML = `
    <div id="mqb-topbar">
      <h1>&#x2711;&nbsp; Math Question Builder</h1>
      <span id="mqb-course-indicator" style="font-size:12px;opacity:.75"></span>
      <button id="mqb-close-app">&#x2715; Close</button>
    </div>
    <div id="mqb-columns">

      <div class="mqb-col" id="mqb-col-left">
        <div class="mqb-col-header">Builder</div>
        <div class="mqb-col-body">
          <div id="mqb-status" style="display:none"></div>
          <label class="mqb-lbl">Math problem</label>
          <textarea id="mqb-prob" rows="3" placeholder="e.g. solve for x: 2x + 3 = x + 9&#10;e.g. area of a triangle given base and height&#10;e.g. simplify (x&#178;&#8722;4)/(x&#8722;2)"></textarea>
          <label class="mqb-lbl">Versions to generate</label>
          <select id="mqb-num-v">
            <option value="3">3 versions (A, B, C)</option>
            <option value="2">2 versions (A, B)</option>
            <option value="1">1 version only</option>
          </select>
          <label class="mqb-lbl">Question format</label>
          <select id="mqb-q-format">
            <option value="short_answer">Short answer</option>
            <option value="multiple_choice">Multiple choice</option>
          </select>

          <div class="mqb-tog-section">Include in this question</div>

          <div class="mqb-tog-row">
            <div class="mqb-tog-left">
              <div class="mqb-tog-name">&#x1F5BC; Graphic</div>
              <div class="mqb-tog-desc">Include a diagram when helpful</div>
            </div>
            <button class="mqb-switch" id="sw-graphic"><div class="mqb-switch-knob" id="sw-graphic-knob"></div></button>
          </div>
          <div class="mqb-tog-row">
            <div class="mqb-tog-left">
              <div class="mqb-tog-name">&#x1F3AC; Video</div>
              <div class="mqb-tog-desc">Add an embedded video tab</div>
              <div class="mqb-tog-sub show" id="tog-video-sub">
                <textarea id="mqb-vid-url" rows="3" placeholder="Paste video URL or embed code" style="margin-top:4px"></textarea>
              </div>
            </div>
            <button class="mqb-switch" id="sw-video"><div class="mqb-switch-knob" id="sw-video-knob"></div></button>
          </div>
          <div class="mqb-tog-row">
            <div class="mqb-tog-left">
              <div class="mqb-tog-name">&#x1F4D6; Worked example</div>
              <div class="mqb-tog-desc">AI writes example with different numbers</div>
            </div>
            <button class="mqb-switch" id="sw-example"><div class="mqb-switch-knob" id="sw-example-knob"></div></button>
          </div>
          <div class="mqb-tog-row">
            <div class="mqb-tog-left">
              <div class="mqb-tog-name">&#x1F4DD; Step-by-step</div>
              <div class="mqb-tog-desc">AI writes full solution steps</div>
            </div>
            <button class="mqb-switch" id="sw-explanation"><div class="mqb-switch-knob" id="sw-explanation-knob"></div></button>
          </div>

          <div style="display:flex;gap:8px;margin-top:14px">
            <button class="mqb-btn mqb-btn-primary mqb-btn-full" id="mqb-gen-btn" style="flex:1">Generate</button>
          </div>
          <div id="mqb-loading" style="display:none;text-align:center;padding:16px;color:#6b7280;font-size:13px">
            <span class="mqb-spinner"></span> AI is writing your question...
          </div>
          <div id="mqb-add-area" style="display:none">
            <div class="mqb-divider"></div>
            <button class="mqb-btn mqb-btn-success mqb-btn-full" id="mqb-insert-btn">+ Add to quiz</button>
            <button class="mqb-btn mqb-btn-ghost mqb-btn-full mqb-btn-sm" id="mqb-regen-btn" style="margin-top:6px">&#x21BA; Regenerate</button>
          </div>

          <div class="mqb-divider"></div>
          <button class="mqb-settings-toggle" id="mqb-settings-toggle">
            <span id="mqb-settings-arrow">&#x25B6;</span> API Key &amp; Settings
          </button>
          <div id="mqb-settings-body">
            <label class="mqb-lbl" style="margin-top:0">Anthropic API key</label>
            <input type="password" id="mqb-apikey" placeholder="sk-ant-...">
            <div style="font-size:11px;color:#9ca3af;margin-top:5px;line-height:1.6">
              Shared with AI Grader, Module Builder &amp; Content Builder.<br>
              Get a key: <a href="https://console.anthropic.com/settings/keys" target="_blank" style="color:#0C447C">console.anthropic.com &#x2197;</a>
            </div>
            <button class="mqb-btn mqb-btn-primary mqb-btn-sm" id="mqb-save-key" style="margin-top:10px">Save key</button>
          </div>
        </div>
      </div>

      <div class="mqb-col" id="mqb-col-mid">
        <div class="mqb-col-header">Student Preview <span id="mqb-edit-hint" style="font-size:10px;font-weight:400;text-transform:none;letter-spacing:0;color:#9ca3af;margin-left:2px">— click to edit</span></div>
        <div class="mqb-col-body">
          <div id="mqb-vtabs-wrap" style="display:none">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
              <div class="mqb-vtabs" id="mqb-vtabs" style="margin-bottom:0"></div>
              <button class="mqb-btn mqb-btn-ghost mqb-btn-sm" id="mqb-reset-btn" style="display:none" title="Discard edits and reset to AI output">&#x21BA; Reset</button>
            </div>
          </div>
          <div id="mqb-edit-bar">
            <span class="mqb-dirty-dot"></span>
            <span>Edited — changes save when you click <strong>+ Add to quiz</strong></span>
          </div>
          <div id="mqb-preview-wrap">
            <div id="mqb-preview-empty">Generate a question on the left<br>to preview the student view here.</div>
            <div id="mqb-preview" style="display:none"></div>
          </div>
          <div id="mqb-ans-section" style="display:none;margin-top:14px">
            <div class="mqb-card">
              <div class="mqb-card-title" id="mqb-ans-title">Auto-graded accepted answers</div>
              <div style="font-size:11px;color:#6b7280;margin-bottom:8px" id="mqb-ans-desc">Canvas accepts any of these — loaded automatically into the quiz group.</div>
              <div class="mqb-vtabs" id="mqb-ans-vtabs"></div>
              <div class="mqb-ans-grid" id="mqb-ans-pills"></div>
            </div>
          </div>
          <div id="mqb-mid-add-area" style="display:none;margin-top:14px">
            <button class="mqb-btn mqb-btn-success mqb-btn-full" id="mqb-insert-btn-mid" style="padding:11px;font-size:14px">+ Add to quiz</button>
            <button class="mqb-btn mqb-btn-ghost mqb-btn-full mqb-btn-sm" id="mqb-regen-btn-mid" style="margin-top:6px">&#x21BA; Regenerate</button>
          </div>
        </div>
      </div>

      <div class="mqb-col" id="mqb-col-right">
        <div class="mqb-col-header">
          Quiz&nbsp;<span id="mqb-q-count" style="background:#e5e7eb;border-radius:20px;padding:1px 8px;font-size:11px;font-weight:700">0</span>
        </div>
        <div class="mqb-col-body">
          <label class="mqb-lbl" style="margin-top:0">Quiz title</label>
          <input type="text" id="mqb-quiz-title" value="Math Practice Quiz">
          <div class="mqb-divider"></div>
          <button class="mqb-btn mqb-btn-primary mqb-btn-full" id="mqb-create-quiz-btn" style="padding:11px;font-size:14px">
            &#x2713;&nbsp; Create Quiz in Canvas
          </button>
          <div id="mqb-export-status" style="margin-top:6px"></div>
          <div class="mqb-divider"></div>
          <div id="mqb-quiz-empty" style="text-align:center;padding:16px 8px;color:#9ca3af;font-size:12px;line-height:1.8">
            No questions yet.<br>Generate one and click<br><strong>+ Add to quiz</strong>.
          </div>
          <div id="mqb-quiz-list" style="margin-top:4px"></div>
          <div id="mqb-export-area" style="display:none">
            <div class="mqb-divider"></div>
            <button class="mqb-btn mqb-btn-ghost mqb-btn-full mqb-btn-sm" id="mqb-clear-btn">Clear all questions</button>
          </div>
        </div>
      </div>

    </div>
  `;
  document.body.appendChild(app);

  if (anthropicKey) document.getElementById('mqb-apikey').value = anthropicKey;

  // -- SWITCHES --------------------------------------------------------------
  function initSwitch(swId, knobId, subId, getVal, setVal) {
    const sw = document.getElementById(swId);
    const knob = document.getElementById(knobId);
    const sub = subId ? document.getElementById(subId) : null;
    function update(v) {
      sw.style.background = v ? '#0C447C' : '#d1d5db';
      knob.style.left = v ? '18px' : '2px';
      if (sub) sub.classList.toggle('show', v);
    }
    update(getVal());
    sw.addEventListener('click', () => { setVal(!getVal()); update(getVal()); });
  }
  initSwitch('sw-graphic', 'sw-graphic-knob', null, () => togGraphic, v => togGraphic = v);
  initSwitch('sw-video', 'sw-video-knob', 'tog-video-sub', () => togVideo, v => togVideo = v);
  initSwitch('sw-example', 'sw-example-knob', null, () => togExample, v => togExample = v);
  initSwitch('sw-explanation', 'sw-explanation-knob', null, () => togExplanation, v => togExplanation = v);

  // -- EVENTS ----------------------------------------------------------------
  document.getElementById('mqb-close-app').addEventListener('click', closeApp);
  document.getElementById('mqb-gen-btn').addEventListener('click', generate);
  document.getElementById('mqb-regen-btn').addEventListener('click', generate);
  document.getElementById('mqb-regen-btn-mid').addEventListener('click', generate);
  document.getElementById('mqb-insert-btn').addEventListener('click', insertQuestion);
  document.getElementById('mqb-insert-btn-mid').addEventListener('click', insertQuestion);
  document.getElementById('mqb-save-key').addEventListener('click', saveKey);
  document.getElementById('mqb-create-quiz-btn').addEventListener('click', createCanvasQuiz);
  document.getElementById('mqb-clear-btn').addEventListener('click', clearQuiz);
  document.getElementById('mqb-settings-toggle').addEventListener('click', toggleSettings);
  document.getElementById('mqb-reset-btn').addEventListener('click', resetPreview);
  document.getElementById('mqb-preview').addEventListener('input', () => {
    if (!previewDirty) {
      previewDirty = true;
      updateEditBar();
    }
  });

  function openApp() {
    app.classList.add('open');
    const cid = getCourseId();
    document.getElementById('mqb-course-indicator').textContent = cid ? 'Course ' + cid : '';
  }
  function closeApp() { app.classList.remove('open'); }
  function toggleSettings() {
    const body = document.getElementById('mqb-settings-body');
    const arrow = document.getElementById('mqb-settings-arrow');
    body.classList.toggle('open');
    arrow.textContent = body.classList.contains('open') ? '▼' : '▶';
  }
  function saveKey() {
    anthropicKey = document.getElementById('mqb-apikey').value.trim();
    GM_setValue(APIKEY_KEY, anthropicKey);
    showStatus('API key saved!', 'ok');
  }
  function showStatus(msg, type) {
    const el = document.getElementById('mqb-status');
    el.textContent = msg;
    el.className = 'mqb-status mqb-status-' + type;
    el.style.display = 'block';
    if (type !== 'info') setTimeout(() => { el.style.display = 'none'; }, 5000);
  }
  function showExportStatus(msg, type) {
    document.getElementById('mqb-export-status').innerHTML =
      `<div class="mqb-status mqb-status-${type}" style="margin-top:10px">${msg}</div>`;
  }
  function updateEditBar() {
    document.getElementById('mqb-edit-bar').classList.toggle('show', previewDirty);
    document.getElementById('mqb-reset-btn').style.display = previewDirty ? 'inline-block' : 'none';
  }
  function resetPreview() {
    previewDirty = false;
    updateEditBar();
    renderPreview(activeV);
  }

  function getQuestionFormat() {
    const el = document.getElementById('mqb-q-format');
    return el ? el.value : 'short_answer';
  }

  function isMultipleChoice() {
    return getQuestionFormat() === 'multiple_choice';
  }

  function normalizeChoice(choice, index) {
    const labels = ['A', 'B', 'C', 'D'];
    return {
      label: labels[index] || String.fromCharCode(65 + index),
      text: String(choice?.text || ''),
      correct: Boolean(choice?.correct)
    };
  }

  // -- PROMPT ----------------------------------------------------------------
  function buildPrompt(prob) {
    const nv = parseInt(document.getElementById('mqb-num-v').value, 10);
    const format = getQuestionFormat();
    return `You are a college-level math question data generator.

Problem: "${prob}"
Versions: ${nv} — label them Version A${nv > 1 ? ', Version B' : ''}${nv > 2 ? ', Version C' : ''} with different numbers, same concept, similar difficulty.
Question format: ${format === 'multiple_choice' ? 'multiple choice' : 'short answer'}

Return ONLY valid JSON. No markdown. No code fences. No extra text. Follow this exact structure:
{
  "topic": "topic under 5 words",
  "versions": [
    {
      "label": "Version A",
      "equation": "the equation as plain text",
      "answer": ${format === 'multiple_choice' ? '"B"' : '6'},
      "answerDisplay": ${format === 'multiple_choice' ? '"B. 6"' : '"6"'},
      "answerAlts": ${format === 'multiple_choice' ? '[]' : '["6", "6.0", "six", "x=6", "x = 6"]'},
      "choices": ${format === 'multiple_choice' ? '[{"label":"A","text":"4","correct":false},{"label":"B","text":"6","correct":true},{"label":"C","text":"8","correct":false},{"label":"D","text":"9","correct":false}]' : '[]'},
      "svgViewBox": "0 0 380 90",
      "svgBody": "",
      "example": "",
      "steps": []
    }
  ]
}

Field rules — follow exactly:
- equation: plain text string, e.g. "2x + 3 = x + 9"
- answer: ${format === 'multiple_choice' ? 'the correct choice label as a string, e.g. "B"' : 'a number (no quotes)'}
- answerDisplay: ${format === 'multiple_choice' ? 'the correct choice written as label plus text, e.g. "B. 6"' : 'the answer as a string, e.g. "6"'}
- answerAlts: ${format === 'multiple_choice' ? 'empty array []' : 'array of strings — include integer form, decimal form like "6.0", English word, "x=6", "x = 6", any other likely student inputs'}
- choices: ${format === 'multiple_choice' ? 'array of exactly 4 answer choices. Each choice must have label "A", "B", "C", or "D", a text string, and a boolean correct field. Exactly one choice must have correct:true.' : 'empty array []'}
- svgBody: ${togGraphic ? 'SVG inner elements ONLY (no svg wrapper tag). Include ONLY when a diagram genuinely helps — number line for one-step equations, balance scale for two-step, labeled shape for geometry, coordinate plane for linear equations. Leave as empty string "" for word problems, factoring, simplification, probability, statistics, or any problem where a diagram adds no value. Use fill="#E6F1FB" stroke="#378ADD" for shapes, stroke="#EF9F27" stroke-dasharray="4 3" for jump arrows, font-family="sans-serif" on text elements. Escape all double quotes as \\\\"' : 'Always return empty string ""'}
- svgViewBox: ${togGraphic ? 'matching viewBox string, e.g. "0 0 380 90". Use "0 0 1 1" if svgBody is empty' : 'Always return "0 0 1 1"'}
- example: ${togExample ? 'A complete worked example using numbers DIFFERENT from all versions. Plain text only. Use the pipe character | to separate lines. No quotes inside this string.' : 'Empty string ""'}
- steps: ${togExplanation ? 'Array of step strings for THIS version. Last step states the answer. Keep each step short.' : 'Empty array []'}
- Keep the final JSON valid and include every field, even when a field is empty.`;
  }

  function extractHtmlAttr(html, name) {
    const re = new RegExp(name + `=(["'])(.*?)\\1`, 'i');
    const match = html.match(re);
    return match ? match[2] : '';
  }

  function parseVideoInput(raw) {
    const input = String(raw || '').trim();
    if (!input) return { kind: 'empty' };

    if (/<iframe[\s\S]*?>/i.test(input)) {
      return {
        kind: 'iframe',
        src: extractHtmlAttr(input, 'src'),
        allow: extractHtmlAttr(input, 'allow'),
        title: extractHtmlAttr(input, 'title') || 'Video Help'
      };
    }

    if (/<video[\s\S]*?>/i.test(input) || /<source[\s\S]*?>/i.test(input)) {
      const src = extractHtmlAttr(input, 'src') || extractHtmlAttr(input, 'poster');
      return { kind: 'direct', src };
    }

    return { kind: 'url', src: input };
  }

  function getVideoEmbedHTML(rawInput) {
    const parsed = parseVideoInput(rawInput);
    if (parsed.kind === 'empty') {
      return `<p>Your instructor has enabled video support for this problem. Add a video URL or embed code in the builder to display it here.</p>`;
    }

    let embedUrl = parsed.src || '';
    const ytMatch = embedUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&?/]+)/i);
    const vimeoMatch = embedUrl.match(/vimeo\.com\/(\d+)/i);
    const isDirectVideo = /\.(mp4|webm|ogg)(\?|#|$)/i.test(embedUrl);

    if (ytMatch) {
      embedUrl = `https://www.youtube.com/embed/${ytMatch[1]}?controls=1&playsinline=1&rel=0`;
    } else if (vimeoMatch) {
      embedUrl = `https://player.vimeo.com/video/${vimeoMatch[1]}`;
    }

    if (parsed.kind === 'direct' || isDirectVideo) {
      return `<p><video controls="controls" preload="metadata" playsinline width="600" height="450"><source src="${escHtml(embedUrl)}"></video>&nbsp;</p>`;
    }

    const allow = parsed.allow || 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
    const title = parsed.title || 'embedded content';

    return `<p><iframe title="${escHtml(title)}" src="${escHtml(embedUrl)}" width="600" height="450" loading="lazy" allowfullscreen="allowfullscreen" allow="${escHtml(allow)}"></iframe>&nbsp;</p>`;
  }

  function parseViewBox(viewBox) {
    const parts = String(viewBox || '0 0 380 90').trim().split(/[\s,]+/).map(Number);
    const width = Number.isFinite(parts[2]) && parts[2] > 0 ? parts[2] : 380;
    const height = Number.isFinite(parts[3]) && parts[3] > 0 ? parts[3] : 90;
    return { width, height };
  }

  function getSvgMarkup(v) {
    const body = String(v?.svgBody || '').trim();
    if (!body) return '';
    const viewBox = String(v?.svgViewBox || '0 0 380 90').trim() || '0 0 380 90';
    const size = parseViewBox(viewBox);
    return `<svg viewBox="${escHtml(viewBox)}" xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}" role="img" aria-label="${escHtml(v?.equation || 'Math diagram')}">${body}</svg>`;
  }

  function buildGraphicBlock(v, options) {
    const opts = options || {};
    if (!opts.includeGraphic) return '';
    const alt = escHtml(`Diagram for ${v?.equation || 'math problem'}`);
    if (opts.graphicUrl) {
      return `<!-- MQB_GRAPHIC_START --><div style="margin:14px 0 2px"><img src="${escHtml(opts.graphicUrl)}" alt="${alt}" style="width:100%;max-width:420px;display:block"></div><!-- MQB_GRAPHIC_END -->`;
    }
    const svgMarkup = getSvgMarkup(v);
    return svgMarkup ? `<!-- MQB_GRAPHIC_START --><div style="margin:14px 0 2px">${svgMarkup}</div><!-- MQB_GRAPHIC_END -->` : '';
  }

  function slugify(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'item';
  }

  function svgToPngBlob(v) {
    return new Promise((resolve, reject) => {
      const svgMarkup = getSvgMarkup(v);
      if (!svgMarkup) { resolve(null); return; }
      const size = parseViewBox(v?.svgViewBox);
      const scale = Math.max(2, Math.ceil(840 / Math.max(size.width, 1)));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(size.width * scale));
      canvas.height = Math.max(1, Math.round(size.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Could not create a canvas for graphic export.'));
        return;
      }
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
      const blobUrl = URL.createObjectURL(svgBlob);
      const img = new Image();
      img.onload = () => {
        try {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((pngBlob) => {
            URL.revokeObjectURL(blobUrl);
            if (!pngBlob) {
              reject(new Error('Canvas could not convert the SVG graphic to PNG.'));
              return;
            }
            resolve(pngBlob);
          }, 'image/png');
        } catch (err) {
          URL.revokeObjectURL(blobUrl);
          reject(err);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(blobUrl);
        reject(new Error('The SVG graphic could not be rendered for Canvas.'));
      };
      img.src = blobUrl;
    });
  }

  async function uploadCourseFile(courseId, blob, filename, folderPath) {
    const initResp = await fetch(`${window.location.origin}/api/v1/courses/${courseId}/files`, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'X-CSRF-Token': getCSRF() },
      credentials: 'same-origin',
      body: new URLSearchParams({
        name: filename,
        size: String(blob.size || 0),
        content_type: blob.type || 'application/octet-stream',
        parent_folder_path: folderPath,
        on_duplicate: 'rename'
      })
    });
    if (!initResp.ok) {
      const text = await initResp.text();
      throw new Error('Canvas file init failed: ' + initResp.status + ': ' + text.slice(0, 200));
    }
    const initData = await initResp.json();
    if (!initData?.upload_url) {
      throw new Error('Canvas did not return a file upload URL for the graphic.');
    }

    const formData = new FormData();
    Object.entries(initData.upload_params || {}).forEach(([key, value]) => formData.append(key, value));
    formData.append('file', blob, filename);

    const uploadResp = await fetch(initData.upload_url, {
      method: 'POST',
      body: formData,
      credentials: 'same-origin'
    });
    if (!uploadResp.ok) {
      const text = await uploadResp.text();
      throw new Error('Canvas file upload failed: ' + uploadResp.status + ': ' + text.slice(0, 200));
    }

    let uploadData = null;
    const contentType = uploadResp.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      uploadData = await uploadResp.json();
    } else {
      const text = await uploadResp.text();
      try {
        uploadData = JSON.parse(text);
      } catch (_) {
        uploadData = null;
      }
    }

    if (uploadData?.url) return uploadData.url;
    if (uploadData?.id) {
      const fileData = await canvasAPI('GET', `/api/v1/files/${uploadData.id}`);
      if (fileData?.url) return fileData.url;
    }
    if (uploadResp.url && !/\/files\/api\/v1\//.test(uploadResp.url)) return uploadResp.url;
    throw new Error('Canvas uploaded the graphic but did not return a usable file URL.');
  }

  async function uploadQuestionGraphic(courseId, q, v) {
    const pngBlob = await svgToPngBlob(v);
    if (!pngBlob) return '';
    const filename = `mqb-${slugify(q.topic)}-${slugify(v.label)}-${Date.now()}.png`;
    return uploadCourseFile(courseId, pngBlob, filename, 'Math Question Builder');
  }

  function replaceInlineSvgWithImage(html, graphicUrl, equation) {
    if (!graphicUrl) return html;
    const imgHtml = `<!-- MQB_GRAPHIC_START --><div style="margin:14px 0 2px"><img src="${escHtml(graphicUrl)}" alt="${escHtml(`Diagram for ${equation || 'math problem'}`)}" style="width:100%;max-width:420px;display:block"></div><!-- MQB_GRAPHIC_END -->`;
    const markerPattern = /<!-- MQB_GRAPHIC_START -->[\s\S]*?<!-- MQB_GRAPHIC_END -->/i;
    if (markerPattern.test(html)) return html.replace(markerPattern, imgHtml);
    const wrappedSvgPattern = /<div style="margin:14px 0 2px">\s*<svg[\s\S]*?<\/svg>\s*<\/div>/i;
    if (wrappedSvgPattern.test(html)) return html.replace(wrappedSvgPattern, imgHtml);
    return html;
  }

  // -- BUILD HTML FROM DATA --------------------------------------------------
  function buildQuestionHTML(v, uid, options) {
    const opts = options || {};
    const includeGraphic = Object.prototype.hasOwnProperty.call(opts, 'includeGraphic') ? opts.includeGraphic : togGraphic;
    const includeVideo = Object.prototype.hasOwnProperty.call(opts, 'includeVideo') ? opts.includeVideo : togVideo;
    const includeExample = Object.prototype.hasOwnProperty.call(opts, 'includeExample') ? opts.includeExample : togExample;
    const includeExplanation = Object.prototype.hasOwnProperty.call(opts, 'includeExplanation') ? opts.includeExplanation : togExplanation;
    const vidUrl = Object.prototype.hasOwnProperty.call(opts, 'videoInput')
      ? String(opts.videoInput || '').trim()
      : document.getElementById('mqb-vid-url').value.trim();
    const tabQuestionId = `mqb-tab-q-${uid}`;
    const tabVideoId = `mqb-tab-v-${uid}`;
    const tabNotesId = `mqb-tab-n-${uid}`;
    const contentFont = `'Aptos', 'Segoe UI', 'Trebuchet MS', sans-serif`;

    function iconSvg(kind, color) {
      const common = `width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"`;
      if (kind === 'question') {
        return `<svg ${common}><circle cx="12" cy="12" r="9" stroke="${color}" stroke-width="1.8"/><path d="M9.8 9.2a2.6 2.6 0 1 1 4.2 2.1c-.9.7-1.8 1.2-1.8 2.4" stroke="${color}" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="17.2" r="1" fill="${color}"/></svg>`;
      }
      if (kind === 'video') {
        return `<svg ${common}><rect x="3.5" y="5.5" width="13" height="13" rx="2.5" stroke="${color}" stroke-width="1.8"/><path d="M10 9.3v5.4l4.7-2.7L10 9.3Z" fill="${color}"/><path d="M16.5 10.2l3.8-2.1v7.8l-3.8-2.1" stroke="${color}" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
      }
      return `<svg ${common}><path d="M6 4.8h8.7l3.3 3.3v11.1a1.8 1.8 0 0 1-1.8 1.8H7.8A1.8 1.8 0 0 1 6 19.2V4.8Z" stroke="${color}" stroke-width="1.8"/><path d="M14.7 4.8v3.5h3.5" stroke="${color}" stroke-width="1.8"/><path d="M9.2 12.2h5.6M9.2 15.3h4.2" stroke="${color}" stroke-width="1.8" stroke-linecap="round"/></svg>`;
    }

    function panelHeader(title, subtitle, bg, fg, iconKind) {
      return `<div style="margin:0 0 14px;padding:12px 14px;border-radius:10px;background:${bg};color:${fg};font-family:${contentFont}">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:999px;background:rgba(255,255,255,0.7)">${iconSvg(iconKind, fg)}</span>
          <div>
            <div style="font-size:18px;font-weight:700;line-height:1.2">${title}</div>
            <div style="font-size:12px;opacity:.82;line-height:1.35">${subtitle}</div>
          </div>
        </div>
      </div>`;
    }

    const svgBlock = buildGraphicBlock(v, { includeGraphic, graphicUrl: opts.graphicUrl || '' });

    const choiceBlock = (v.questionFormat === 'multiple_choice' && Array.isArray(v.choices) && v.choices.length)
      ? `<div style="margin-top:16px">
          <div style="font-family:${contentFont};font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#64748B;margin:0 0 8px">Answer Choices</div>
          <div style="display:grid;gap:8px">
            ${v.choices.map(choice => `<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border:1px solid #D7DEE7;border-radius:10px;background:#FFFFFF;font-family:${contentFont}">
              <span style="display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:24px;border-radius:999px;background:#EFF6FF;color:#0C447C;font-size:11px;font-weight:700;flex-shrink:0">${escHtml(choice.label || '')}</span>
              <span style="font-size:13px;line-height:1.5;color:#111827">${escHtml(choice.text || '')}</span>
            </div>`).join('')}
          </div>
        </div>`
      : '';

    const questionHtml = `${panelHeader('Question', 'Solve the math problem below.', 'linear-gradient(135deg, #EFF6FF, #DBEAFE)', '#0C447C', 'question')}
      <div style="padding:2px 2px 0;font-family:${contentFont}">
        <p style="font-size:18px;font-weight:700;line-height:1.4;margin:0 0 12px;color:#111827">${escHtml(v.equation)}</p>
        ${svgBlock}
        ${choiceBlock}
      </div>`;

    let notesHtml = '';
    if (includeExample && v.example && v.example.trim()) {
      const lines = v.example.split('|').map(l => l.trim()).filter(Boolean);
      notesHtml += `<div style="margin:0 0 14px;padding:12px 14px;border:1px solid #BFDBFE;border-radius:10px;background:#F8FBFF;font-family:${contentFont}">
        <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#2563EB;margin:0 0 8px">Worked Example</div>
        ${lines.map(l => `<p style="margin:0 0 8px;font-size:13px;line-height:1.65;color:#183B63">${escHtml(l)}</p>`).join('')}
      </div>`;
    }
    if (includeExplanation && v.steps && v.steps.length) {
      notesHtml += `<div style="margin:0 0 14px;padding:12px 14px;border:1px solid #86EFAC;border-radius:10px;background:#F7FEF8;font-family:${contentFont}">
        <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#166534;margin:0 0 8px">Step-by-Step Help</div>
        ${v.steps.map((s, i) => `<div style="display:flex;gap:10px;align-items:flex-start;margin:0 0 10px">
          <span style="display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:24px;border-radius:999px;background:#166534;color:#FFFFFF;font-size:11px;font-weight:700;flex-shrink:0">${i + 1}</span>
          <span style="font-size:13px;line-height:1.65;color:#14532D">${escHtml(s)}</span>
        </div>`).join('')}
      </div>`;
    }

    const tabs = [{
      label: 'Question',
      href: tabQuestionId,
      tint: '#EFF6FF',
      color: '#0C447C',
      icon: 'question'
    }];

    const panels = [`<div id="${tabQuestionId}">
        ${questionHtml}
      </div>`];

    if (includeVideo) {
      tabs.push({
        label: 'Video',
        href: tabVideoId,
        tint: '#FBF7FF',
        color: '#7C3AED',
        icon: 'video'
      });
      panels.push(`<div id="${tabVideoId}">
        ${panelHeader('Video Help', 'Watch the embedded support video.', 'linear-gradient(135deg, #FBF7FF, #F3E8FF)', '#7C3AED', 'video')}
        ${getVideoEmbedHTML(vidUrl)}
      </div>`);
    }

    if (notesHtml) {
      tabs.push({
        label: 'Notes',
        href: tabNotesId,
        tint: '#F0FDF4',
        color: '#166534',
        icon: 'notes'
      });
      panels.push(`<div id="${tabNotesId}">
        ${panelHeader('Notes', 'Review the example and solution notes.', 'linear-gradient(135deg, #F0FDF4, #DCFCE7)', '#166534', 'notes')}
        ${notesHtml}
      </div>`);
    }

    return `<div class="enhanceable_content tabs" style="max-width:760px;font-family:${contentFont}">
      <ul>
        ${tabs.map(tab => `<li><a href="#${tab.href}" style="display:inline-flex;align-items:center;gap:8px;background:${tab.tint};color:${tab.color};font-weight:700;border-radius:8px 8px 0 0;padding:8px 12px;border:1px solid rgba(15,23,42,0.08);border-bottom:none;box-shadow:0 1px 0 rgba(255,255,255,0.7) inset">${iconSvg(tab.icon, tab.color)}<span>${tab.label}</span></a></li>`).join('')}
      </ul>
      ${panels.join('')}
    </div>`;
  }

  // -- GENERATE --------------------------------------------------------------
  async function generate() {
    if (!anthropicKey) {
      document.getElementById('mqb-settings-body').classList.add('open');
      document.getElementById('mqb-settings-arrow').textContent = '▼';
      showStatus('Enter your Anthropic API key in Settings below.', 'err');
      return;
    }
    const prob = document.getElementById('mqb-prob').value.trim();
    if (!prob) { showStatus('Please describe a math problem first.', 'err'); return; }
    if (isGenerating) return;
    isGenerating = true;
    previewDirty = false;
    updateEditBar();
    setLoading(true);
    await callAPI(buildPrompt(prob));
    setLoading(false);
    isGenerating = false;
  }

  function setLoading(on) {
    document.getElementById('mqb-loading').style.display = on ? 'block' : 'none';
    document.getElementById('mqb-gen-btn').disabled = on;
    if (on) document.getElementById('mqb-add-area').style.display = 'none';
  }

  function callAPI(prompt) {
    return new Promise((resolve) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url: 'https://api.anthropic.com/v1/messages',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        data: JSON.stringify({
          model: ANTHROPIC_MODEL,
          max_tokens: 4000,
          messages: [{ role: 'user', content: prompt }]
        }),
        timeout: 60000,
        onload: function (res) {
          try {
            if (res.status === 401) throw new Error('Invalid API key — check Settings.');
            if (res.status === 429) throw new Error('Rate limit — wait and try again.');
            if (res.status >= 400) throw new Error('API error ' + res.status + ': ' + res.responseText.slice(0, 150));
            const data = JSON.parse(res.responseText);
            if (data.error) throw new Error(data.error.message);
            const raw = data.content.map(c => c.text || '').join('');
            const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
            const start = cleaned.indexOf('{');
            const end = cleaned.lastIndexOf('}');
            if (start === -1 || end === -1) throw new Error('No JSON found in response.');
            const parsed = JSON.parse(cleaned.slice(start, end + 1));
            if (!parsed.versions?.length) throw new Error('No versions in response.');
            lastTopic = parsed.topic || 'Math question';
            const selectedFormat = getQuestionFormat();
            const ts = Date.now();
            versions = parsed.versions.map((v, index) => {
              const next = {
                ...v,
                questionFormat: selectedFormat
              };
              if (selectedFormat === 'multiple_choice') {
                next.choices = Array.isArray(v.choices) ? v.choices.slice(0, 4).map(normalizeChoice) : [];
                if (next.choices.length === 4 && !next.choices.some(c => c.correct)) {
                  next.choices[0].correct = true;
                }
                const correct = next.choices.find(c => c.correct) || next.choices[0];
                next.answer = correct ? correct.label : '';
                next.answerDisplay = correct ? `${correct.label}. ${correct.text}` : '';
                next.answerAlts = [];
              } else {
                next.choices = [];
              }
              next.html = buildQuestionHTML(next, ts + index);
              return next;
            });
            activeV = 0;
            renderPreviewPanel();
            document.getElementById('mqb-add-area').style.display = 'block';
            showStatus('Question generated!', 'ok');
          } catch (e) {
            showStatus('Error: ' + e.message, 'err');
            console.error('[MathBuilder]', e);
          }
          resolve();
        },
        onerror: () => { showStatus('Network error — check connection.', 'err'); resolve(); },
        ontimeout: () => { showStatus('Request timed out. Try again.', 'err'); resolve(); }
      });
    });
  }

  // -- RENDER PREVIEW --------------------------------------------------------
  function renderPreviewPanel() {
    document.getElementById('mqb-preview-empty').style.display = 'none';
    document.getElementById('mqb-preview').style.display = 'block';
    document.getElementById('mqb-preview').setAttribute('contenteditable', 'true');
    document.getElementById('mqb-vtabs-wrap').style.display = 'block';
    document.getElementById('mqb-ans-section').style.display = 'block';
    document.getElementById('mqb-mid-add-area').style.display = 'block';
    previewDirty = false;
    updateEditBar();
    ['mqb-vtabs', 'mqb-ans-vtabs'].forEach(id => {
      const el = document.getElementById(id);
      el.innerHTML = '';
      versions.forEach((v, i) => {
        const b = document.createElement('button');
        b.className = 'mqb-vtab' + (i === 0 ? ' on' : '');
        b.textContent = v.label;
        b.addEventListener('click', () => {
          if (previewDirty) versions[activeV].html = document.getElementById('mqb-preview').innerHTML;
          activeV = i;
          previewDirty = false;
          updateEditBar();
          ['mqb-vtabs', 'mqb-ans-vtabs'].forEach(tid =>
            document.getElementById(tid).querySelectorAll('.mqb-vtab')
              .forEach((x, j) => x.className = 'mqb-vtab' + (j === i ? ' on' : ''))
          );
          renderPreview(i); renderAnswers(i);
        });
        el.appendChild(b);
      });
    });
    renderPreview(0); renderAnswers(0);
  }

  function renderPreview(i) {
    document.getElementById('mqb-preview').innerHTML = versions[i].html;
  }
  function renderAnswers(i) {
    const v = versions[i];
    const title = document.getElementById('mqb-ans-title');
    const desc = document.getElementById('mqb-ans-desc');
    if (v.questionFormat === 'multiple_choice') {
      title.textContent = 'Correct multiple-choice answer';
      desc.textContent = 'Canvas will show all answer choices and grade the single marked correct option automatically.';
      const correct = Array.isArray(v.choices) ? v.choices.find(c => c.correct) : null;
      const allChoices = Array.isArray(v.choices) ? v.choices : [];
      document.getElementById('mqb-ans-pills').innerHTML = allChoices.map(choice => {
        const isCorrect = correct && choice.label === correct.label;
        return `<span class="mqb-pill" style="${isCorrect ? 'background:#ECFDF3;color:#166534;border-color:#86EFAC' : ''}">${escHtml((choice.label || '') + '. ' + (choice.text || ''))}</span>`;
      }).join('');
      return;
    }

    title.textContent = 'Auto-graded accepted answers';
    desc.textContent = 'Canvas accepts any of these — loaded automatically into the quiz group.';
    const all = [String(v.answer), v.answerDisplay, ...(v.answerAlts || [])].filter((x, j, a) => x && a.indexOf(x) === j);
    document.getElementById('mqb-ans-pills').innerHTML = all.map(a => `<span class="mqb-pill">${escHtml(a)}</span>`).join('');
  }

  // -- INSERT INTO QUIZ ------------------------------------------------------
  function insertQuestion() {
    if (!versions.length) return;
    if (previewDirty) versions[activeV].html = document.getElementById('mqb-preview').innerHTML;
    quizQuestions.push({
      num: quizQuestions.length + 1, topic: lastTopic,
      videoInput: document.getElementById('mqb-vid-url').value.trim(),
      questionFormat: getQuestionFormat(),
      inclGraphic: togGraphic, inclVideo: togVideo, inclExample: togExample, inclExplain: togExplanation,
      versions: versions.map(v => ({ ...v }))
    });
    updateQCount(); renderQuizList();
    document.getElementById('mqb-prob').value = '';
    document.getElementById('mqb-add-area').style.display = 'none';
    document.getElementById('mqb-mid-add-area').style.display = 'none';
    document.getElementById('mqb-preview-empty').style.display = 'flex';
    document.getElementById('mqb-preview').style.display = 'none';
    document.getElementById('mqb-preview').removeAttribute('contenteditable');
    document.getElementById('mqb-vtabs-wrap').style.display = 'none';
    document.getElementById('mqb-ans-section').style.display = 'none';
    previewDirty = false;
    updateEditBar();
    versions = [];
    showStatus('Added! Write your next question.', 'ok');
  }

  function updateQCount() {
    const n = quizQuestions.length;
    document.getElementById('mqb-q-count').textContent = n;
    document.getElementById('mqb-quiz-empty').style.display = n ? 'none' : 'block';
    document.getElementById('mqb-export-area').style.display = n ? 'block' : 'none';
  }

  function renderQuizList() {
    const list = document.getElementById('mqb-quiz-list');
    list.innerHTML = '';
    const cols = ['mqb-ver-a', 'mqb-ver-b', 'mqb-ver-c'];
    quizQuestions.forEach((q, qi) => {
      const item = document.createElement('div');
      item.className = 'mqb-q-item';
      const header = document.createElement('div');
      header.className = 'mqb-q-item-header';
      const info = document.createElement('div');
      info.innerHTML = `<div class="mqb-q-num">Q${q.num}</div><div class="mqb-q-topic">${escHtml(q.topic)}</div>`;
      const rm = document.createElement('button');
      rm.className = 'mqb-btn mqb-btn-ghost mqb-btn-sm';
      rm.textContent = '✕'; rm.style.cssText = 'padding:2px 6px;flex-shrink:0';
      rm.addEventListener('click', () => {
        quizQuestions.splice(qi, 1); quizQuestions.forEach((qq, j) => qq.num = j + 1);
        updateQCount(); renderQuizList();
      });
      header.appendChild(info); header.appendChild(rm); item.appendChild(header);
      q.versions.forEach((v, vi) => {
        const row = document.createElement('div');
        row.className = 'mqb-q-eq';
        row.innerHTML = `<span class="mqb-ver-badge ${cols[vi]}">${v.label.replace('Version ', '')}</span>${escHtml(v.equation)}`;
        item.appendChild(row);
      });
      const tags = document.createElement('div');
      tags.className = 'mqb-q-tags';
      tags.innerHTML += `<span class="mqb-q-tag">${q.questionFormat === 'multiple_choice' ? '☑ Multiple Choice' : '✎ Short Answer'}</span>`;
      if (q.inclGraphic) tags.innerHTML += '<span class="mqb-q-tag">🖼 Graphic</span>';
      if (q.inclVideo) tags.innerHTML += '<span class="mqb-q-tag">🎬 Video</span>';
      if (q.inclExample) tags.innerHTML += '<span class="mqb-q-tag">📖 Example</span>';
      if (q.inclExplain) tags.innerHTML += '<span class="mqb-q-tag">📝 Steps</span>';
      if (tags.innerHTML) item.appendChild(tags);
      list.appendChild(item);
    });
  }

  function clearQuiz() {
    if (!confirm('Clear all questions?')) return;
    quizQuestions = []; updateQCount(); renderQuizList();
    document.getElementById('mqb-export-status').innerHTML = '';
  }

  // -- CREATE CANVAS QUIZ ----------------------------------------------------
  async function createCanvasQuiz() {
    const courseId = getCourseId();
    if (!courseId) { showExportStatus('Navigate to a Canvas course page first.', 'err'); return; }
    if (!quizQuestions.length) { showExportStatus('No questions to create yet.', 'err'); return; }
    const quizTitle = document.getElementById('mqb-quiz-title').value.trim() || 'Math Practice Quiz';
    const btn = document.getElementById('mqb-create-quiz-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="mqb-spinner"></span> Creating...';
    showExportStatus('Creating quiz in Canvas...', 'info');
    try {
      showExportStatus('Preparing graphics for Canvas...', 'info');
      const preparedQuestions = [];
      for (const q of quizQuestions) {
        const preparedVersions = [];
        for (const v of q.versions) {
          let graphicUrl = '';
          if (q.inclGraphic && v.svgBody && v.svgBody.trim()) {
            graphicUrl = await uploadQuestionGraphic(courseId, q, v);
          }
          const questionText = graphicUrl
            ? replaceInlineSvgWithImage(v.html, graphicUrl, v.equation)
            : v.html;
          preparedVersions.push({
            ...v,
            questionText
          });
        }
        preparedQuestions.push({ ...q, versions: preparedVersions });
      }

      showExportStatus('Creating quiz in Canvas...', 'info');
      const quiz = await canvasAPI('POST', `/api/v1/courses/${courseId}/quizzes`, {
        quiz: {
          title: quizTitle,
          quiz_type: 'assignment',
          shuffle_answers: false,
          show_correct_answers: true,
          allowed_attempts: -1,
          scoring_policy: 'keep_highest',
          published: false,
          description: `Generated by Canvas Math Question Builder — ${quizQuestions.length} question group(s). Canvas randomly shows one version per student.`
        }
      });
      const quizId = quiz.id;
      showExportStatus(`Quiz created. Adding ${preparedQuestions.length} question group(s)...`, 'info');
      for (const q of preparedQuestions) {
        const groupResp = await canvasAPI('POST', `/api/v1/courses/${courseId}/quizzes/${quizId}/groups`, {
          quiz_groups: [{ name: `Q${q.num}: ${q.topic}`, pick_count: 1, question_points: 1 }]
        });
        const groupId = groupResp.quiz_groups?.[0]?.id;
        if (!groupId) throw new Error(`Could not create question group for Q${q.num}`);
        for (const v of q.versions) {
          const isMc = q.questionFormat === 'multiple_choice';
          const answers = isMc
            ? (Array.isArray(v.choices) ? v.choices : []).map(choice => ({
                answer_text: choice.text || '',
                answer_weight: choice.correct ? 100 : 0
              }))
            : [String(v.answer), v.answerDisplay, ...(v.answerAlts || [])].filter((x, j, a) => x && a.indexOf(x) === j)
                .map(a => ({ answer_text: a, answer_weight: 100 }));

          if (!answers.length) {
            throw new Error(`No valid answers generated for ${v.label}`);
          }

          await canvasAPI('POST', `/api/v1/courses/${courseId}/quizzes/${quizId}/questions`, {
            question: {
              question_name: `${v.label}: ${v.equation}`,
              question_text: v.questionText || v.html,
              question_type: isMc ? 'multiple_choice_question' : 'short_answer_question',
              quiz_group_id: groupId,
              points_possible: 1,
              answers
            }
          });
        }
      }
      try {
        const mods = await canvasAPI('GET', `/api/v1/courses/${courseId}/modules?per_page=50`);
        if (Array.isArray(mods) && mods.length > 0) {
          const mod = mods[0];
          const items = await canvasAPI('GET', `/api/v1/courses/${courseId}/modules/${mod.id}/items?per_page=50`);
          await canvasAPI('POST', `/api/v1/courses/${courseId}/modules/${mod.id}/items`, {
            module_item: { title: quizTitle, type: 'Quiz', content_id: quizId, position: (Array.isArray(items) ? items.length : 0) + 1 }
          });
        }
      } catch (_) {}
      const base = window.location.origin;
      showExportStatus(`&#10003; <strong>${escHtml(quizTitle)}</strong> created — ${quizQuestions.length} question group(s), Canvas picks one version per student. <a href="${base}/courses/${courseId}/quizzes/${quizId}/edit" target="_blank" style="color:#1e40af;font-weight:500">Open in Canvas &#x2197;</a>`, 'ok');
    } catch (e) { showExportStatus('Failed: ' + e.message, 'err'); }
    btn.disabled = false;
    btn.innerHTML = '&#x2713;&nbsp; Create Quiz in Canvas';
  }

  function canvasAPI(method, path, body) {
    return new Promise((resolve, reject) => {
      const opts = {
        method,
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-CSRF-Token': getCSRF() },
        credentials: 'same-origin'
      };
      if (body && (method === 'POST' || method === 'PUT')) opts.body = JSON.stringify(body);
      fetch(window.location.origin + path, opts)
        .then(r => { if (!r.ok) return r.text().then(t => { throw new Error('Canvas API ' + r.status + ': ' + t.slice(0, 200)); }); return r.status === 204 ? null : r.json(); })
        .then(resolve).catch(reject);
    });
  }

  // -- REGISTER --------------------------------------------------------------
  function tryRegister() {
    try {
      if (typeof unsafeWindow !== 'undefined' && unsafeWindow.CanvasDash) {
        unsafeWindow.CanvasDash.register({
          id: 'math-question-builder',
          name: 'Math Builder',
          color: '#0C447C',
          description: 'AI math question builder — versioned question groups -> Canvas quiz',
          run: openApp
        });
      } else { setTimeout(tryRegister, 500); }
    } catch (e) { setTimeout(tryRegister, 500); }
  }
  tryRegister();

})();
