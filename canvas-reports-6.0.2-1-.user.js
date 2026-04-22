// ==UserScript==
// @name         Canvas Reports
// @namespace    http://tampermonkey.net/
// @version      6.0.2
// @description  At-risk reporting with printable class reports and student support guides.
// @match        https://*.instructure.com/*
// @match        *://canvas.*.edu/*
// @match        *://canvas.*.com/*
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/MarkAlanBrest/scripts/main/canvas-reports-6.0.2-1-.user.js
// @updateURL    https://raw.githubusercontent.com/MarkAlanBrest/scripts/main/canvas-reports-6.0.2-1-.user.js
// ==/UserScript==

(function () {
  "use strict";

  const SETTINGS_KEY = "csht_settings_v5";
  const APP_ID = "csht-app";
  const hostWindow = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;

  if (hostWindow.__CANVAS_STUDENT_HELP_TOOLS__) return;
  hostWindow.__CANVAS_STUDENT_HELP_TOOLS__ = true;
  if (window.top !== window.self) return;

  const DEFAULT_SETTINGS = {
    lookbackDays: 14,
    redGradeBelow: 70,
    yellowGradeBelow: 80,
    redMissingAtOrAbove: 2,
    yellowMissingAtOrAbove: 1,
    reportType: "class"
  };

  const STATUS_META = {
    red:    { label: "Red",    title: "At Risk",         color: "#991b1b", accent: "#dc2626", bg: "#fef2f2", border: "#fca5a5" },
    yellow: { label: "Yellow", title: "Needs Attention", color: "#92400e", accent: "#d97706", bg: "#fffbeb", border: "#fcd34d" },
    green:  { label: "Green",  title: "Good To Go",      color: "#166534", accent: "#16a34a", bg: "#f0fdf4", border: "#86efac" }
  };

  const state = {
    open: false,
    loading: false,
    students: [],
    courseId: null,
    courseName: "",
    activeFilters: { red: true, yellow: true, green: true },
    lastLoadedAt: null,
    settings: loadSettings()
  };

  GM_addStyle(`
    @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');

    /* ── OVERLAY ── */
    #${APP_ID} {
      position: fixed;
      inset: 0;
      z-index: 2147483640;
      display: none;
      align-items: stretch;
      justify-content: stretch;
      font-family: 'DM Sans', 'Segoe UI', system-ui, sans-serif;
    }
    #${APP_ID}.open { display: flex; }
    #${APP_ID} * { box-sizing: border-box; margin: 0; padding: 0; }

    /* ── SHELL: full screen, no overlay ── */
    #csht-shell {
      width: 100vw;
      height: 100vh;
      display: flex;
      overflow: hidden;
      color: #111827;
    }

    /* ════════════════════════════════════════
       SIDEBAR — dark navy, refined
    ════════════════════════════════════════ */
    #csht-sidebar {
      width: 320px;
      flex-shrink: 0;
      background: #0f1923;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      padding-left: 32px;
      padding-right: 32px;
    }

    /* Brand strip */
    #csht-brand {
      padding: 28px 0 22px;
      border-bottom: 1px solid rgba(255,255,255,0.06);
      flex-shrink: 0;
    }
    #csht-brand-eyebrow {
      font-family: 'DM Mono', monospace;
      font-size: 9px;
      font-weight: 500;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: #3b82f6;
      margin-bottom: 8px;
    }
    #csht-brand-title {
      font-size: 19px;
      font-weight: 600;
      color: #f1f5f9;
      letter-spacing: -0.01em;
      line-height: 1.2;
      margin-bottom: 6px;
    }
    #csht-course-line {
      font-size: 12px;
      color: #64748b;
      line-height: 1.4;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Scrollable controls area */
    #csht-sidebar-scroll {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 28px 0 120px;
    }
    #csht-sidebar-scroll::-webkit-scrollbar { width: 4px; }
    #csht-sidebar-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 2px; }

    /* Section dividers */
    .csht-nav-section {
      padding: 0;
      margin-bottom: 28px;
    }
    .csht-nav-section-label {
      font-family: 'DM Mono', monospace;
      font-size: 9px;
      font-weight: 500;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: #334155;
      padding: 0 2px;
      margin-bottom: 12px;
    }

    /* Field groups */
    .csht-field {
      margin-bottom: 14px;
    }
    .csht-field:last-child { margin-bottom: 0; }
    .csht-field-label {
      font-size: 11px;
      font-weight: 500;
      color: #94a3b8;
      margin-bottom: 6px;
      display: block;
    }
    .csht-field input,
    .csht-field select {
      font-family: 'DM Sans', inherit;
      font-size: 13px;
      font-weight: 400;
      padding: 11px 14px;
      border-radius: 8px;
      border: 1px solid rgba(255,255,255,0.08);
      background: rgba(255,255,255,0.05);
      color: #e2e8f0;
      width: 100%;
      outline: none;
      appearance: none;
      -webkit-appearance: none;
      transition: border-color 0.15s, background 0.15s;
      line-height: 1.4;
    }
    .csht-field select {
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%2364748b'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 12px center;
      padding-right: 32px;
    }
    .csht-field input:focus,
    .csht-field select:focus {
      border-color: rgba(59,130,246,0.5);
      background: rgba(59,130,246,0.06);
      outline: none;
    }
    .csht-field select option { background: #1e293b; color: #e2e8f0; }

    /* Two-column grid for threshold inputs */
    .csht-field-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }

    /* Status filter toggles — compact pills, 3 across */
    .csht-filter-row {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .csht-filter-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 13px;
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,0.1);
      background: rgba(255,255,255,0.04);
      cursor: pointer;
      font-family: 'DM Sans', inherit;
      font-size: 12px;
      font-weight: 500;
      color: #475569;
      transition: all 0.15s;
      white-space: nowrap;
      width: auto;
      flex-shrink: 0;
    }
    .csht-filter-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      flex-shrink: 0;
      opacity: 0.3;
      transition: opacity 0.15s;
    }
    .csht-filter-btn.on .csht-filter-dot { opacity: 1; }
    .csht-filter-btn.on-red    { color: #fca5a5; border-color: rgba(220,38,38,0.4); background: rgba(220,38,38,0.12); }
    .csht-filter-btn.on-yellow { color: #fcd34d; border-color: rgba(217,119,6,0.4); background: rgba(217,119,6,0.12); }
    .csht-filter-btn.on-green  { color: #86efac; border-color: rgba(22,163,74,0.4); background: rgba(22,163,74,0.12); }
    .csht-filter-btn:not(.on)  { opacity: 0.4; }

    .csht-filter-count {
      font-family: 'DM Mono', monospace;
      font-size: 10px;
      opacity: 0.65;
    }

    /* Status bar */
    #csht-sidebar-status {
      padding: 4px 0 0;
      font-family: 'DM Mono', monospace;
      font-size: 10px;
      color: #475569;
      line-height: 1.6;
      min-height: 16px;
    }
    #csht-sidebar-status.error { color: #f87171; }

    /* Fixed action bar at bottom */
    #csht-action-bar {
      position: absolute;
      bottom: 0;
      left: 0;
      width: 320px;
      padding: 16px 32px 20px;
      background: linear-gradient(to top, #0f1923 80%, transparent);
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .csht-btn-generate {
      width: 100%;
      padding: 16px 16px;
      font-family: 'DM Sans', inherit;
      font-size: 14px;
      font-weight: 600;
      letter-spacing: 0.01em;
      background: #2563eb;
      color: #ffffff;
      border: none;
      border-radius: 9px;
      cursor: pointer;
      transition: background 0.15s, transform 0.1s;
      position: relative;
      overflow: hidden;
    }
    .csht-btn-generate::before {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(135deg, rgba(255,255,255,0.12) 0%, transparent 60%);
      pointer-events: none;
    }
    .csht-btn-generate:hover { background: #1d4ed8; }
    .csht-btn-generate:active { transform: scale(0.98); }
    .csht-btn-generate:disabled { opacity: 0.4; cursor: default; transform: none; }

    .csht-btn-row {
      display: flex;
      gap: 10px;
    }
    .csht-btn-print {
      flex: 1;
      padding: 13px 12px;
      font-family: 'DM Sans', inherit;
      font-size: 13px;
      font-weight: 500;
      background: rgba(255,255,255,0.06);
      color: #94a3b8;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .csht-btn-print:hover:not(:disabled) { background: rgba(255,255,255,0.1); color: #e2e8f0; }
    .csht-btn-print:disabled { opacity: 0.3; cursor: default; }

    .csht-btn-close {
      flex: 1;
      padding: 13px 12px;
      font-family: 'DM Sans', inherit;
      font-size: 13px;
      font-weight: 500;
      background: transparent;
      color: #475569;
      border: 1px solid rgba(255,255,255,0.05);
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .csht-btn-close:hover { background: rgba(255,255,255,0.04); color: #64748b; }

    /* Thin rule inside sidebar */
    .csht-nav-rule {
      height: 1px;
      background: rgba(255,255,255,0.05);
      margin-bottom: 28px;
    }

    /* ── REPORT AREA ── */
    #csht-report-area {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      background: #f1f5f9;
      overflow: hidden;
    }

    #csht-paper-scroll {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 40px 48px 60px;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    #csht-paper-scroll::-webkit-scrollbar { width: 8px; }
    #csht-paper-scroll::-webkit-scrollbar-track { background: #f1f5f9; }
    #csht-paper-scroll::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }

    #csht-paper {
      width: 100%;
      max-width: 8.5in;
      min-height: 480px;
      display: flex;
      flex-direction: column;
      gap: 48px;
    }

    #csht-report-content {
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 48px;
    }

    .csht-preview-page {
      width: 100%;
      background: #ffffff;
      color: #111827;
      box-shadow: 0 1px 3px rgba(0,0,0,0.07), 0 8px 32px rgba(15,23,42,0.10);
      border-radius: 3px;
      min-height: 11in;
      padding: 0.75in !important;
      border: 1px solid #e2e8f0;
    }

    .csht-preview-page-guide { page-break-after: always; break-after: page; }
    .csht-preview-page-guide:last-child { page-break-after: auto; break-after: auto; }

    #csht-placeholder {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 400px;
      gap: 10px;
      text-align: center;
      background: #fff;
      border-radius: 3px;
      border: 1px solid #e2e8f0;
      box-shadow: 0 1px 3px rgba(0,0,0,0.06);
      padding: 60px;
    }
    .ph-icon { font-size: 36px; opacity: 0.18; margin-bottom: 4px; }
    .ph-title { font-size: 15px; font-weight: 600; color: #6b7280; }
    .ph-sub { font-size: 12px; color: #9ca3af; line-height: 1.6; max-width: 260px; }

    /* ── REPORT CONTENT ── */

    /* Header */
    .r-header { border-bottom: 2px solid #111827; padding-bottom: 28px; margin-bottom: 44px; }
    .r-eyebrow { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.14em; color: #9ca3af; margin-bottom: 12px; }
    .r-title { font-size: 28px; font-weight: 700; color: #0f172a; margin-bottom: 10px; line-height: 1.2; }
    .r-meta { font-size: 13px; color: #6b7280; line-height: 1.8; }

    /* Summary stat strip */
    .r-summary { display: grid; grid-template-columns: repeat(4,1fr); gap: 16px; margin: 0.5in 0; }
    .r-stat { border: 1px solid #e5e7eb; border-radius: 8px; padding: 22px 24px; background: #ffffff; }
    .r-stat-label { font-size: 11px; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 10px; }
    .r-stat-val { font-size: 36px; font-weight: 700; line-height: 1; }

    /* Student cards */
    .r-student { border: 1px solid #e5e7eb; border-radius: 8px; background: #ffffff; }
    .r-student-head { background: #f9fafb; border-bottom: 1px solid #e5e7eb; padding: 20px 24px; display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
    .r-student-name { font-size: 17px; font-weight: 700; color: #111827; margin-bottom: 8px; }
    .r-student-facts { font-size: 13px; color: #6b7280; display: flex; flex-wrap: wrap; gap: 20px; line-height: 1.5; }
    .r-student-facts strong { color: #374151; }
    .r-badge { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; padding: 6px 14px; border-radius: 999px; border: 1px solid; white-space: nowrap; flex-shrink: 0; }
    .r-student-body { padding: 24px; background: #ffffff; }
    .r-concern-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #9ca3af; margin-bottom: 16px; }

    /* Assignment table */
    .r-table { width: 100%; border-collapse: collapse; font-size: 13px; background: #ffffff; }
    .r-table th { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: #9ca3af; padding: 10px 16px; text-align: left; border-bottom: 1px solid #e5e7eb; background: #ffffff; }
    .r-table td { padding: 14px 16px; border-bottom: 1px solid #f3f4f6; color: #374151; vertical-align: top; background: #ffffff; line-height: 1.5; }
    .r-table tr:last-child td { border-bottom: none; }
    .r-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; vertical-align: middle; margin-right: 8px; }
    .r-muted { color: #9ca3af; font-style: italic; }
    .r-reasons { font-size: 13px; color: #6b7280; margin-top: 18px; font-style: italic; line-height: 1.6; padding-top: 16px; border-top: 1px solid #f3f4f6; }

    /* Student guide */
    .r-guide { background: #ffffff; }
    .r-guide-eyebrow { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.14em; color: #9ca3af; margin-bottom: 12px; }
    .r-guide-name { font-size: 30px; font-weight: 700; color: #0f172a; margin-bottom: 6px; line-height: 1.2; }
    .r-guide-course { font-size: 14px; color: #6b7280; margin-bottom: 28px; line-height: 1.5; }
    .r-guide-rule { border: none; border-top: 2px solid #111827; margin-bottom: 40px; }
    .r-guide-section { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.14em; color: #6b7280; margin: 40px 0 18px; }

    /* Snapshot boxes */
    .r-snapshot { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .r-snap-box { border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px 22px; background: #ffffff; }
    .r-snap-label { font-size: 11px; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 8px; }
    .r-snap-val { font-size: 20px; font-weight: 700; color: #111827; line-height: 1.2; }

    /* Concern list */
    .r-concern-list { list-style: none; padding: 0; margin: 0; }
    .r-concern-list li { font-size: 13px; color: #374151; padding: 16px 0; border-bottom: 1px solid #f3f4f6; display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; line-height: 1.5; }
    .r-concern-list li:last-child { border-bottom: none; }
    .r-concern-name { flex: 1; font-weight: 500; min-width: 160px; }
    .r-concern-date { font-size: 12px; color: #9ca3af; white-space: nowrap; }
    .r-concern-score { font-size: 12px; color: #6b7280; white-space: nowrap; }

    /* Bullet recommendations */
    .r-bullets { list-style: none; padding: 0; margin: 0; }
    .r-bullets li { font-size: 14px; color: #374151; padding: 16px 0 16px 28px; border-bottom: 1px solid #f3f4f6; position: relative; line-height: 1.6; }
    .r-bullets li:last-child { border-bottom: none; }
    .r-bullets li::before { content: '•'; position: absolute; left: 10px; color: #9ca3af; font-size: 18px; top: 14px; }

    /* Message block */
    .r-message { background: #f8fafc; border-left: 4px solid #2563eb; padding: 22px 26px; margin-top: 36px; font-size: 14px; color: #374151; line-height: 1.8; }

    /* Signature */
    .r-sig-row { display: flex; gap: 48px; margin-top: 64px; align-items: flex-end; }
    .r-sig-block { flex: 1; }
    .r-sig-narrow { flex: 0 0 200px; }
    .r-sig-line { border-bottom: 1px solid #374151; height: 48px; }
    .r-sig-label { margin-top: 10px; font-size: 12px; color: #9ca3af; }

    .r-no-data { text-align: center; color: #9ca3af; padding: 64px; font-size: 14px; font-style: italic; background: #ffffff; }
  `);

  document.body.appendChild(buildApp());
  wireEvents();
  tryRegister();

  /* ── BUILD DOM ── */
  function buildApp() {
    const root = document.createElement("div");
    root.id = APP_ID;
    root.innerHTML = `
      <div id="csht-shell">

        <!-- ═══ SIDEBAR ═══ -->
        <div id="csht-sidebar">

          <div id="csht-brand">
            <div id="csht-brand-eyebrow">Canvas LMS</div>
            <div id="csht-brand-title">At-Risk Reports</div>
            <div id="csht-course-line">Open a course to begin</div>
          </div>

          <div id="csht-sidebar-scroll">

            <!-- Report type -->
            <div class="csht-nav-section">
              <div class="csht-nav-section-label">Report</div>
              <div class="csht-field">
                <label class="csht-field-label">Type</label>
                <select id="csht-report-type">
                  <option value="class">Class Progress</option>
                  <option value="guides">Student Reports</option>
                  <option value="both">Both</option>
                </select>
              </div>
            </div>

            <div class="csht-nav-rule"></div>

            <!-- Status filters -->
            <div class="csht-nav-section">
              <div class="csht-nav-section-label">Filters</div>
              <div class="csht-filter-row">
                <button class="csht-filter-btn on on-red" data-status="red">
                  <span class="csht-filter-dot" style="background:#dc2626;"></span>
                  Red <span class="csht-filter-count" id="csht-count-red"></span>
                </button>
                <button class="csht-filter-btn on on-yellow" data-status="yellow">
                  <span class="csht-filter-dot" style="background:#d97706;"></span>
                  Yellow <span class="csht-filter-count" id="csht-count-yellow"></span>
                </button>
                <button class="csht-filter-btn on on-green" data-status="green">
                  <span class="csht-filter-dot" style="background:#16a34a;"></span>
                  Green <span class="csht-filter-count" id="csht-count-green"></span>
                </button>
              </div>
            </div>

            <div class="csht-nav-rule"></div>

            <!-- Thresholds -->
            <div class="csht-nav-section">
              <div class="csht-nav-section-label">Thresholds</div>
              <div class="csht-field">
                <label class="csht-field-label">Lookback window (days)</label>
                <input id="csht-lookback-days" type="number" min="1" max="180" step="1">
              </div>
              <div class="csht-field">
                <label class="csht-field-label">Red below (%)</label>
                <input id="csht-red-grade" type="number" min="0" max="100" step="1">
              </div>
              <div class="csht-field">
                <label class="csht-field-label">Yellow below (%)</label>
                <input id="csht-yellow-grade" type="number" min="0" max="100" step="1">
              </div>
            </div>

            <!-- Status message -->
            <div id="csht-sidebar-status"></div>

          </div><!-- /scroll -->

          <!-- Fixed action bar -->
          <div id="csht-action-bar">
            <button class="csht-btn-generate" id="csht-gen-btn">Generate Report</button>
            <div class="csht-btn-row">
              <button class="csht-btn-print" id="csht-print-btn" disabled>Print</button>
              <button class="csht-btn-close" id="csht-close-btn">Close</button>
            </div>
          </div>

        </div><!-- /sidebar -->

        <!-- ═══ REPORT AREA ═══ -->
        <div id="csht-report-area">
          <div id="csht-paper-scroll">
            <div id="csht-paper">
              <div id="csht-placeholder">
                <div class="ph-icon">📋</div>
                <div class="ph-title">No report generated yet</div>
                <div class="ph-sub">Set your thresholds on the left and click <strong>Generate Report</strong>.</div>
              </div>
              <div id="csht-report-content" style="display:none;"></div>
            </div>
          </div>
        </div>

      </div>
    `;
    return root;
  }

  /* ── WIRE EVENTS ── */
  function wireEvents() {
    document.getElementById("csht-close-btn").addEventListener("click", closeApp);
    document.getElementById(APP_ID).addEventListener("click", e => { if (e.target.id === APP_ID) closeApp(); });
    document.getElementById("csht-gen-btn").addEventListener("click", loadCourseData);
    document.getElementById("csht-print-btn").addEventListener("click", handlePrint);

    document.getElementById("csht-report-type").addEventListener("change", e => {
      state.settings.reportType = e.target.value;
      persistSettings();
      if (state.students.length) renderReport();
    });

    document.getElementById("csht-shell").querySelectorAll(".csht-filter-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const s = btn.getAttribute("data-status");
        state.activeFilters[s] = !state.activeFilters[s];
        // toggle colour classes
        btn.classList.toggle("on", state.activeFilters[s]);
        btn.classList.toggle(`on-${s}`, state.activeFilters[s]);
        if (state.students.length) renderReport();
      });
    });

    bindSetting("csht-lookback-days",  "lookbackDays");
    bindSetting("csht-red-grade",      "redGradeBelow");
    bindSetting("csht-yellow-grade",   "yellowGradeBelow");
  }

  function bindSetting(id, key) {
    document.getElementById(id).addEventListener("change", e => {
      state.settings[key] = normalizeInt(e.target.value, DEFAULT_SETTINGS[key]);
      clampSettings();
      persistSettings();
      syncInputs();
    });
  }

  /* ── OPEN / CLOSE ── */
  function openApp() {
    state.open = true;
    document.getElementById(APP_ID).classList.add("open");
    syncInputs();
    updateCourseLine();
    if (!getCourseId()) setSidebarStatus("Open a Canvas course first.", true);
  }

  function closeApp() {
    state.open = false;
    document.getElementById(APP_ID).classList.remove("open");
  }

  /* ── LOAD DATA ── */
  async function loadCourseData() {
    const courseId = getCourseId();
    if (!courseId) { setSidebarStatus("Open a Canvas course first.", true); return; }

    state.courseId = courseId;
    state.courseName = getCourseName();
    state.loading = true;

    // Fetch real course name from API
    try {
      const courseRes = await canvasFetch(`/api/v1/courses/${courseId}`);
      const courseData = await courseRes.json();
      if (courseData && courseData.name) state.courseName = courseData.name;
    } catch(e) { /* keep fallback name */ }

    const btn = document.getElementById("csht-gen-btn");
    btn.disabled = true;
    btn.textContent = "Loading…";

    try {
      // Fetch enrollments first - this is required
      setSidebarStatus("Loading enrollments…");
      let enrollments = [];
      try {
        enrollments = await fetchPaginated(`/api/v1/courses/${courseId}/enrollments`, {
          "type[]": "StudentEnrollment", "state[]": "active", "include[]": "user", per_page: 100
        });
      } catch (e) {
        setSidebarStatus("Enrollments failed: " + e.message, true);
        return;
      }

      // Analytics - not fatal if it fails (some courses have it disabled)
      setSidebarStatus("Loading analytics…");
      let analytics = [];
      try {
        analytics = await fetchPaginated(`/api/v1/courses/${courseId}/analytics/student_summaries`, {
          per_page: 100, sort_column: "name"
        });
      } catch (e) {
        console.warn("Canvas Reports: analytics failed, skipping.", e.message);
      }

      // Submissions - not fatal if it fails
      setSidebarStatus("Loading submissions…");
      let submissions = [];
      try {
        submissions = await fetchPaginated(`/api/v1/courses/${courseId}/students/submissions`, {
          "student_ids[]": "all", grouped: true, "include[]": "assignment", per_page: 100
        });
      } catch (e) {
        console.warn("Canvas Reports: submissions failed, skipping.", e.message);
      }

      state.students = buildStudents({ enrollments, analytics, submissions });
      state.lastLoadedAt = new Date().toISOString();
      const flagged = state.students.filter(s => s.status !== "green").length;
      setSidebarStatus(`${state.students.length} students · ${flagged} flagged`);
      updateFilterCounts();
      renderReport();

    } catch (err) {
      setSidebarStatus("Error: " + err.message, true);
    } finally {
      state.loading = false;
      btn.disabled = false;
      btn.textContent = "Generate Report";
    }
  }

  function updateFilterCounts() {
    const counts = { red: 0, yellow: 0, green: 0 };
    state.students.forEach(s => counts[s.status]++);
    ["red","yellow","green"].forEach(k => {
      const el = document.getElementById(`csht-count-${k}`);
      if (el) el.textContent = counts[k];
    });
  }

  /* ── BUILD STUDENTS ── */
  function buildStudents({ enrollments, analytics, submissions }) {
    const analyticsMap = new Map((analytics || []).map(a => [String(a.id), a]));
    const submissionMap = new Map();
    for (const group of submissions || []) {
      if (!group || group.user_id == null) continue;
      submissionMap.set(String(group.user_id), Array.isArray(group.submissions) ? group.submissions : []);
    }

    return sortStudents(dedupeEnrollments(enrollments || []).map(enrollment => {
      const user = enrollment.user || {};
      const id = String(user.id);
      const gradeScore = getGradeScore(enrollment);
      const an = analyticsMap.get(id) || {};
      const { missingAssignments, zeroAssignments, allAssignments } = summarizeAssignments(submissionMap.get(id) || []);
      const poorGradeAssignments = getPoorGradeAssignments(allAssignments);
      const concernAssignments = combineConcernAssignments(missingAssignments, poorGradeAssignments);

      const redReasons = [], yellowReasons = [];

      if (isNum(gradeScore)) {
        if (gradeScore < state.settings.redGradeBelow)
          redReasons.push(`Grade is ${formatPercent(gradeScore)}, below the red threshold.`);
        else if (gradeScore < state.settings.yellowGradeBelow)
          yellowReasons.push(`Grade is ${formatPercent(gradeScore)}, below the yellow threshold.`);
      }

      if (missingAssignments.length >= state.settings.redMissingAtOrAbove)
        redReasons.push(`${missingAssignments.length} assignment${missingAssignments.length !== 1 ? "s are" : " is"} missing.`);
      else if (missingAssignments.length >= state.settings.yellowMissingAtOrAbove)
        yellowReasons.push(`${missingAssignments.length} assignment is missing.`);

      if (zeroAssignments.length > 0)
        redReasons.push(`${zeroAssignments.length} assignment${zeroAssignments.length !== 1 ? "s" : ""} scored zero.`);

      const reasons = [...redReasons, ...yellowReasons];
      const status = redReasons.length ? "red" : yellowReasons.length ? "yellow" : "green";

      return {
        id,
        name: user.sortable_name || user.name || `Student ${id}`,
        displayName: user.name || user.short_name || `Student ${id}`,
        courseId: state.courseId, courseName: state.courseName,
        gradeScore, gradeText: getGradeText(enrollment),
        lastActivityAt: enrollment.last_activity_at || enrollment.last_attended_at || null,
        inactiveDays: getInactiveDays(enrollment),
        pageViews: normalizeInt(an.page_views, 0),
        participations: normalizeInt(an.participations, 0),
        missingAssignments, zeroAssignments, concernAssignments, allAssignments,
        reasons, status,
        riskScore: computeRiskScore(status, gradeScore, missingAssignments.length, zeroAssignments.length)
      };
    }));
  }

  /* ── RENDER REPORT ── */
  function renderReport() {
    document.getElementById("csht-placeholder").style.display = "none";
    document.getElementById("csht-report-content").style.display = "flex";
    document.getElementById("csht-print-btn").disabled = false;
    updateCourseLine();

    const type = state.settings.reportType;
    let html = "";

    if (type === "class") {
      html = wrapPreviewPage(buildClassReportHTML());
    } else if (type === "guides") {
      html = buildGuidesHTML(state.students.filter(s => s.status !== "green"));
    } else {
      html = wrapPreviewPage(buildClassReportHTML()) +
        buildGuidesHTML(state.students.filter(s => s.status !== "green"));
    }

    document.getElementById("csht-report-content").innerHTML = html;
  }

  function wrapPreviewPage(content, extraClass = "") {
    const cls = extraClass ? `csht-preview-page ${extraClass}` : "csht-preview-page";
    return `<section class="${cls}">${content}</section>`;
  }

  /* ── CLASS REPORT ── */
  function buildClassReportHTML() {
    const all = state.students;
    const red = all.filter(s => s.status === "red");
    const yellow = all.filter(s => s.status === "yellow");
    const green = all.filter(s => s.status === "green");
    const visible = all.filter(s => state.activeFilters[s.status]);

    const cardsHTML = visible.length
      ? visible.map(s => buildStudentCardHTML(s)).join('<div style="height:0.5in;background:#ffffff;"></div>')
      : `<div class="r-no-data">No students match the current filters. Use the toggles on the left to show groups.</div>`;

    return `
      <div class="r-header">
        <div class="r-eyebrow">Class Progress Report</div>
        <div class="r-title">${escHtml(state.courseName || "Canvas Course")}</div>
        <div class="r-meta">
          Generated ${escHtml(formatDateTime(new Date().toISOString()))}
          &nbsp;·&nbsp; Lookback: ${state.settings.lookbackDays} days (${escHtml(getConcernDateRangeLabel())})
          &nbsp;·&nbsp; Red &lt; ${state.settings.redGradeBelow}%
          &nbsp;·&nbsp; Yellow &lt; ${state.settings.yellowGradeBelow}%
        </div>
      </div>
      <div class="r-summary" style="margin-top:0.5in;margin-bottom:0.5in;">
        <div class="r-stat">
          <div class="r-stat-label">Total Students</div>
          <div class="r-stat-val" style="color:#0f172a;">${all.length}</div>
        </div>
        <div class="r-stat" style="border-color:#fca5a5;">
          <div class="r-stat-label" style="color:#991b1b;">At Risk</div>
          <div class="r-stat-val" style="color:#991b1b;">${red.length}</div>
        </div>
        <div class="r-stat" style="border-color:#fcd34d;">
          <div class="r-stat-label" style="color:#92400e;">Needs Attention</div>
          <div class="r-stat-val" style="color:#92400e;">${yellow.length}</div>
        </div>
        <div class="r-stat" style="border-color:#86efac;">
          <div class="r-stat-label" style="color:#166534;">Good To Go</div>
          <div class="r-stat-val" style="color:#166534;">${green.length}</div>
        </div>
      </div>
      ${cardsHTML}
    `;
  }

  function buildStudentCardHTML(s) {
    const meta = STATUS_META[s.status];
    let assignBody = "";
    if (s.concernAssignments.length) {
      assignBody = s.concernAssignments.map(a => {
        const pct = isNum(a.score) && a.pointsPossible > 0 ? (a.score / a.pointsPossible) * 100 : null;
        const dotColor = a.missing ? "#dc2626"
          : (isNum(pct) && pct < state.settings.redGradeBelow) ? "#dc2626"
          : (isNum(pct) && pct < state.settings.yellowGradeBelow) ? "#d97706"
          : "#16a34a";
        const statusTxt = a.missing ? "Missing"
          : (isNum(pct) && pct < state.settings.redGradeBelow) ? "Low grade"
          : (isNum(pct) && pct < state.settings.yellowGradeBelow) ? "Below avg"
          : "Graded";
        return `<tr>
          <td><span class="r-dot" style="background:${dotColor};"></span>${escHtml(a.name)}</td>
          <td>${escHtml(formatShortDate(a.dueAt))}</td>
          <td>${escHtml(formatScore(a.score, a.pointsPossible))}</td>
          <td>${escHtml(statusTxt)}</td>
        </tr>`;
      }).join("");
    } else {
      assignBody = `<tr><td colspan="4" class="r-muted" style="padding:6px 8px;">No concerns found in the lookback window.</td></tr>`;
    }
    const reasonHtml = s.reasons.length ? `<div class="r-reasons">${escHtml(s.reasons.join(" "))}</div>` : "";
    return `
      <div class="r-student">
        <div class="r-student-head">
          <div>
            <div class="r-student-name">${escHtml(s.displayName)}</div>
            <div class="r-student-facts">
              <span>Grade: <strong>${escHtml(s.gradeText || "—")}</strong></span>
              <span>Last login: <strong>${escHtml(formatRelativeActivity(s.lastActivityAt, s.inactiveDays))}</strong></span>
              <span>Missing: <strong>${s.missingAssignments.length}</strong></span>
              <span>Zeroes: <strong>${s.zeroAssignments.length}</strong></span>
            </div>
          </div>
          <span class="r-badge" style="background:${meta.bg};color:${meta.color};border-color:${meta.border};">${meta.title}</span>
        </div>
        <div class="r-student-body">
          <div class="r-concern-label">Areas of Concern &nbsp;·&nbsp; ${escHtml(getConcernDateRangeLabel())}</div>
          <table class="r-table">
            <thead><tr><th>Assignment</th><th>Due Date</th><th>Score</th><th>Status</th></tr></thead>
            <tbody>${assignBody}</tbody>
          </table>
          ${reasonHtml}
        </div>
      </div>`;
  }

  /* ── STUDENT GUIDES ── */
  function buildGuidesHTML(students) {
    if (!students.length) {
      return wrapPreviewPage(`<div class="r-no-data">No flagged students — everyone is Good To Go.</div>`, "csht-preview-page-guide");
    }
    return students.map(s => wrapPreviewPage(buildGuideHTML(s), "csht-preview-page-guide")).join("");
  }

  function buildGuideHTML(s) {
    const meta = STATUS_META[s.status];
    const missingColor = s.missingAssignments.length > 0 ? "#dc2626" : "#166534";
    let concernItems = "";
    if (s.concernAssignments.length) {
      concernItems = s.concernAssignments.map(a => `
        <li>
          <span class="r-dot" style="background:${a.missing ? "#dc2626" : "#d97706"};flex-shrink:0;margin-top:3px;"></span>
          <span class="r-concern-name">${escHtml(a.name)}</span>
          <span class="r-concern-date">${escHtml(formatShortDate(a.dueAt))}</span>
          <span class="r-concern-score">${escHtml(formatScore(a.score, a.pointsPossible))}${a.missing ? " &nbsp;<strong style='color:#dc2626;'>Missing</strong>" : ""}</span>
        </li>`).join("");
    } else {
      concernItems = `<li><span class="r-muted">No specific concerns found in the current lookback window.</span></li>`;
    }
    return `
      <div class="r-guide">
        <div class="r-guide-eyebrow">Student Support Report &nbsp;·&nbsp; ${escHtml(state.courseName || "Canvas Course")} &nbsp;·&nbsp; ${escHtml(formatShortDate(new Date().toISOString()))}</div>
        <div class="r-guide-name">${escHtml(s.displayName)}</div>
        <div class="r-guide-course">${escHtml(state.courseName || "Canvas Course")}</div>
        <div class="r-guide-course">Report generated ${escHtml(formatDateTime(new Date().toISOString()))}</div>
        <hr class="r-guide-rule">
        <div class="r-guide-section">Current Snapshot</div>
        <div class="r-snapshot">
          <div class="r-snap-box"><div class="r-snap-label">Current Grade</div><div class="r-snap-val">${escHtml(s.gradeText || "No grade on record")}</div></div>
          <div class="r-snap-box"><div class="r-snap-label">Last Canvas Login</div><div class="r-snap-val">${escHtml(formatRelativeActivity(s.lastActivityAt, s.inactiveDays))}</div></div>
          <div class="r-snap-box"><div class="r-snap-label">Missing Assignments</div><div class="r-snap-val" style="color:${missingColor};">${s.missingAssignments.length}</div></div>
          <div class="r-snap-box"><div class="r-snap-label">Standing</div><div class="r-snap-val"><span class="r-badge" style="background:${meta.bg};color:${meta.color};border-color:${meta.border};">${meta.title}</span></div></div>
        </div>
        <div style="height:0.5in;"></div>
        <div class="r-guide-section">Areas of Concern &nbsp;<span style="font-weight:400;color:#9ca3af;">(${escHtml(getConcernDateRangeLabel())})</span></div>
        <ul class="r-concern-list">${concernItems}</ul>
        <div style="height:0.5in;"></div>
        <div class="r-guide-section">What You Need To Do</div>
        <ul class="r-bullets">
          <li>Log in to Canvas every day. Announcements, due dates, new assignments, and grade updates are all posted there — you cannot afford to miss them.</li>
          <li>Check your email regularly. Your instructor may send important messages directly to your inbox that do not appear inside Canvas.</li>
          <li>Do not wait until the last minute. Submit work early so that technical problems do not cost you points when deadlines arrive.</li>
          <li>Points are lost on late work, and missing assignments become permanent once the submission window closes. Act now, not later.</li>
          <li>Ask for help early. If you are confused or falling behind, reach out to your instructor before the deadline — not after.</li>
        </ul>
        <div style="height:0.5in;"></div>
        <div class="r-sig-row">
          <div class="r-sig-block"><div class="r-sig-line"></div><div class="r-sig-label">Student Signature</div></div>
          <div class="r-sig-narrow"><div class="r-sig-line"></div><div class="r-sig-label">Date</div></div>
        </div>
      </div>`;
  }

  /* ── PRINT ── */
  function handlePrint() {
    if (!state.students.length) return;
    const type = state.settings.reportType;
    const flagged = state.students.filter(s => s.status !== "green");

    let body = "";
    if (type === "class") {
      body = buildClassReportHTML();
    } else if (type === "guides") {
      body = flagged.length
        ? flagged.map((s, i) => i > 0 ? `<div style="page-break-before:always;">${buildGuideHTML(s)}</div>` : buildGuideHTML(s)).join("")
        : `<div class="r-no-data">No flagged students.</div>`;
    } else {
      const guideParts = flagged.length
        ? flagged.map((s, i) => i > 0 ? `<div style="page-break-before:always;">${buildGuideHTML(s)}</div>` : buildGuideHTML(s)).join("")
        : `<div class="r-no-data">No flagged students.</div>`;
      body = buildClassReportHTML() + `<div style="page-break-before:always;">${guideParts}</div>`;
    }

    const title = type === "guides"
      ? `${state.courseName || "Canvas Course"} — Student Reports`
      : `${state.courseName || "Canvas Course"} — At Risk Report`;

    openPrintWindow(title, body);
  }

  function openPrintWindow(title, body) {
    const popup = window.open("", "_blank", "width=1040,height=860,left=80,top=60");
    if (!popup) { alert("Pop-ups are blocked. Please allow pop-ups for Canvas and try again."); return; }
    popup.document.write(`<!doctype html><html><head><meta charset="utf-8">
      <title>${escHtml(title)}</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: "Segoe UI", system-ui, Arial, sans-serif; color: #111827; font-size: 13px; line-height: 1.5; margin: 0.75in; background: #ffffff; }
        .r-header { border-bottom: 2px solid #111827; padding-bottom: 12px; margin-bottom: 18px; }
        .r-eyebrow { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #9ca3af; margin-bottom: 3px; }
        .r-title { font-size: 19px; font-weight: 700; color: #0f172a; margin-bottom: 2px; }
        .r-meta { font-size: 10px; color: #6b7280; }
        .r-summary { display: grid; grid-template-columns: repeat(4,1fr); gap: 6px; margin: 0.5in 0; }
        .r-stat { border: 1px solid #e5e7eb; border-radius: 4px; padding: 8px 10px; }
        .r-stat-label { font-size: 9px; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.07em; }
        .r-stat-val { font-size: 22px; font-weight: 700; margin-top: 2px; line-height: 1; }
        .r-student { border: 1px solid #e5e7eb; border-radius: 4px; page-break-inside: avoid; }
        .r-student-head { background: #fafafa; border-bottom: 1px solid #e5e7eb; padding: 8px 12px; display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
        .r-student-name { font-size: 13px; font-weight: 700; color: #111827; margin-bottom: 2px; }
        .r-student-facts { font-size: 10px; color: #6b7280; display: flex; flex-wrap: wrap; gap: 10px; }
        .r-student-facts strong { color: #374151; }
        .r-badge { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; padding: 2px 8px; border-radius: 999px; border: 1px solid; white-space: nowrap; flex-shrink: 0; }
        .r-student-body { padding: 10px 12px; }
        .r-concern-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #9ca3af; margin-bottom: 6px; }
        .r-table { width: 100%; border-collapse: collapse; font-size: 11px; }
        .r-table th { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: #9ca3af; padding: 3px 6px; text-align: left; border-bottom: 1px solid #f3f4f6; }
        .r-table td { padding: 5px 6px; border-bottom: 1px solid #f9fafb; color: #374151; vertical-align: top; }
        .r-table tr:last-child td { border-bottom: none; }
        .r-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; vertical-align: middle; margin-right: 4px; }
        .r-muted { color: #9ca3af; font-style: italic; }
        .r-reasons { font-size: 10px; color: #6b7280; margin-top: 6px; font-style: italic; }
        .r-guide-eyebrow { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #9ca3af; margin-bottom: 3px; }
        .r-guide-name { font-size: 22px; font-weight: 700; color: #0f172a; }
        .r-guide-course { font-size: 10px; color: #6b7280; margin-top: 2px; margin-bottom: 14px; }
        .r-guide-rule { border: none; border-top: 2px solid #111827; margin-bottom: 16px; }
        .r-guide-section { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #6b7280; margin: 16px 0 7px; }
        .r-snapshot { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
        .r-snap-box { border: 1px solid #e5e7eb; border-radius: 4px; padding: 7px 10px; }
        .r-snap-label { font-size: 9px; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.07em; }
        .r-snap-val { font-size: 14px; font-weight: 700; color: #111827; margin-top: 1px; }
        .r-concern-list { list-style: none; padding: 0; margin: 0; }
        .r-concern-list li { font-size: 11px; color: #374151; padding: 5px 0; border-bottom: 1px solid #f3f4f6; display: flex; align-items: baseline; gap: 7px; flex-wrap: wrap; }
        .r-concern-list li:last-child { border-bottom: none; }
        .r-concern-name { flex: 1; font-weight: 500; min-width: 140px; }
        .r-concern-date { font-size: 10px; color: #9ca3af; white-space: nowrap; }
        .r-concern-score { font-size: 10px; color: #6b7280; white-space: nowrap; }
        .r-bullets { list-style: none; padding: 0; margin: 0; }
        .r-bullets li { font-size: 11px; color: #374151; padding: 5px 0 5px 18px; border-bottom: 1px solid #f3f4f6; position: relative; line-height: 1.5; }
        .r-bullets li:last-child { border-bottom: none; }
        .r-bullets li::before { content: '•'; position: absolute; left: 5px; color: #374151; font-size: 13px; top: 4px; }
        .r-message { background: #f8fafc; border-left: 3px solid #2563eb; padding: 10px 14px; margin-top: 16px; font-size: 11px; color: #374151; line-height: 1.6; }
        .r-sig-row { display: flex; gap: 24px; margin-top: 32px; align-items: flex-end; }
        .r-sig-block { flex: 1; }
        .r-sig-narrow { flex: 0 0 140px; }
        .r-sig-line { border-bottom: 1px solid #374151; height: 28px; }
        .r-sig-label { margin-top: 4px; font-size: 9px; color: #9ca3af; }
        .r-no-data { text-align: center; color: #9ca3af; padding: 28px; font-size: 13px; font-style: italic; }
        @media print { body { margin: 0.45in; } .r-student { page-break-inside: avoid; } }
      </style>
    </head><body>${body}</body></html>`);
    popup.document.close();
    popup.focus();
    setTimeout(() => popup.print(), 400);
  }

  /* ── DATA HELPERS ── */
  function summarizeAssignments(submissions) {
    const missing = [], zeroes = [], all = [];
    const days = state.settings.lookbackDays;
    for (const sub of submissions || []) {
      const assignment = sub.assignment || {};
      const pointsPossible = Number(assignment.points_possible || 0);
      const score = sub.score == null ? null : Number(sub.score);
      const dueAt = assignment.due_at || sub.cached_due_date || null;
      const item = {
        assignmentId: sub.assignment_id,
        name: assignment.name || "Untitled assignment",
        dueAt, score, pointsPossible,
        missing: Boolean(sub.missing || sub.late_policy_status === "missing"),
        late: Boolean(sub.late),
        submittedAt: sub.submitted_at || null,
        workflowState: sub.workflow_state || "",
        htmlUrl: assignment.html_url || ""
      };
      if (!isWithinLookback(item, days)) continue;
      all.push(item);
      if (item.missing) missing.push(item);
      if (!sub.excused && isNum(score) && score === 0 && pointsPossible > 0) zeroes.push(item);
    }
    missing.sort(byDueDate); zeroes.sort(byDueDate); all.sort(byDueDate);
    return { missingAssignments: missing, zeroAssignments: zeroes, allAssignments: all };
  }

  function getPoorGradeAssignments(assignments) {
    return (assignments || []).filter(a => {
      if (!isNum(a.score) || !isNum(a.pointsPossible) || a.pointsPossible <= 0 || a.missing) return false;
      return (a.score / a.pointsPossible) * 100 < state.settings.yellowGradeBelow;
    });
  }

  function combineConcernAssignments(missing, poor) {
    const seen = new Set(), out = [];
    for (const item of [...missing, ...poor]) {
      const key = `${item.assignmentId || item.name}|${item.dueAt || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    return out.sort(byDueDate);
  }

  function computeRiskScore(status, gradeScore, missingCount, zeroCount) {
    const base = status === "red" ? 300 : status === "yellow" ? 200 : 100;
    return base + missingCount * 20 + zeroCount * 25 + (isNum(gradeScore) ? Math.max(0, 100 - gradeScore) : 0);
  }

  function dedupeEnrollments(enrollments) {
    const byUser = new Map();
    for (const e of enrollments) {
      const user = e.user || {};
      if (user.id == null) continue;
      const key = String(user.id);
      const existing = byUser.get(key);
      if (!existing || preferEnrollment(e, existing)) byUser.set(key, e);
    }
    return Array.from(byUser.values());
  }

  function preferEnrollment(candidate, existing) {
    const cs = getGradeScore(candidate), es = getGradeScore(existing);
    if (isNum(cs) && !isNum(es)) return true;
    if (!isNum(cs) && isNum(es)) return false;
    return new Date(candidate.updated_at || 0).getTime() > new Date(existing.updated_at || 0).getTime();
  }

  function sortStudents(students) {
    return [...students].sort((a, b) => {
      const rd = statusRank(a.status) - statusRank(b.status);
      if (rd !== 0) return rd;
      if (b.riskScore !== a.riskScore) return b.riskScore - a.riskScore;
      return a.name.localeCompare(b.name);
    });
  }

  function statusRank(s) { return s === "red" ? 0 : s === "yellow" ? 1 : 2; }
  function byDueDate(a, b) {
    const at = a && a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
    const bt = b && b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
    return at - bt;
  }

  /* ── CANVAS API ── */
  async function fetchPaginated(path, params) {
    let nextUrl = buildUrl(path, params).toString();
    const rows = [];
    while (nextUrl) {
      const res = await canvasFetch(nextUrl);
      const payload = await res.json();
      if (!Array.isArray(payload)) return payload;
      rows.push(...payload);
      nextUrl = getNextPage(res.headers.get("Link"));
    }
    return rows;
  }

  async function canvasFetch(url) {
    const res = await fetch(url, {
      method: "GET", credentials: "same-origin",
      headers: { "Accept": "application/json", "X-CSRF-Token": getCSRF() }
    });
    if (!res.ok) { const t = await res.text(); throw new Error(`Canvas API ${res.status}: ${t.slice(0, 220)}`); }
    return res;
  }

  function buildUrl(path, params) {
    const url = new URL(path, window.location.origin);
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v == null) return;
      if (Array.isArray(v)) v.forEach(i => url.searchParams.append(k, String(i)));
      else url.searchParams.append(k, String(v));
    });
    return url;
  }

  function getNextPage(linkHeader) {
    if (!linkHeader) return null;
    for (const part of linkHeader.split(",")) {
      const m = part.match(/<([^>]+)>\s*;\s*rel="([^"]+)"/);
      if (m && m[2] === "next") return m[1];
    }
    return null;
  }

  /* ── CANVAS PAGE HELPERS ── */
  function getCourseId() {
    const m = window.location.pathname.match(/\/courses\/(\d+)/);
    return m ? m[1] : null;
  }

  function getCourseName() {
    const envName = hostWindow.ENV && (hostWindow.ENV.course_name || hostWindow.ENV.COURSE_NAME);
    if (envName) return String(envName);
    const crumb = document.querySelector(".ellipsible");
    if (crumb && crumb.textContent.trim()) return crumb.textContent.trim();
    return document.title.replace(/\s+\|\s+Canvas.*$/i, "").trim() || "Canvas Course";
  }

  function getCSRF() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    if (meta && meta.getAttribute("content")) return meta.getAttribute("content");
    const m = document.cookie.match(/(?:^|;\s*)_csrf_token=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : "";
  }

  function getGradeScore(enrollment) {
    const grades = (enrollment && enrollment.grades) ? enrollment.grades : {};
    const score = grades.current_score != null ? Number(grades.current_score) : Number(grades.final_score);
    return isNum(score) ? score : null;
  }

  function getGradeText(enrollment) {
    const grades = (enrollment && enrollment.grades) ? enrollment.grades : {};
    const score = getGradeScore(enrollment);
    const label = grades.current_grade || grades.final_grade || "";
    if (isNum(score) && label) return `${label} (${formatPercent(score)})`;
    if (isNum(score)) return formatPercent(score);
    return label || "No current grade";
  }

  function getInactiveDays(enrollment) {
    const ts = enrollment.last_activity_at || enrollment.last_attended_at || null;
    if (!ts) return null;
    const diff = Date.now() - new Date(ts).getTime();
    if (!Number.isFinite(diff) || diff < 0) return 0;
    return Math.floor(diff / 86400000);
  }

  /* ── UI HELPERS ── */
  function updateCourseLine() {
    const el = document.getElementById("csht-course-line");
    if (!el) return;
    el.textContent = state.courseName || "Open a course to begin";
  }

  function setSidebarStatus(msg, isError) {
    const el = document.getElementById("csht-sidebar-status");
    if (!el) return;
    el.textContent = msg || "";
    el.className = isError ? "error" : "";
  }

  function syncInputs() {
    document.getElementById("csht-lookback-days").value = state.settings.lookbackDays;
    document.getElementById("csht-red-grade").value = state.settings.redGradeBelow;
    document.getElementById("csht-yellow-grade").value = state.settings.yellowGradeBelow;
    document.getElementById("csht-report-type").value = state.settings.reportType;
  }

  /* ── FORMAT HELPERS ── */
  function formatPercent(v) { return `${Number(v).toFixed(1)}%`; }

  function formatDateTime(iso) {
    if (!iso) return "Unknown";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "Unknown";
    return d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  }

  function formatShortDate(iso) {
    if (!iso) return "No due date";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "No due date";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  function formatRelativeActivity(iso, inactiveDays) {
    if (!iso) return "No recent activity";
    if (inactiveDays == null) return formatShortDate(iso);
    if (inactiveDays === 0) return "Today";
    if (inactiveDays === 1) return "1 day ago";
    return `${inactiveDays} days ago`;
  }

  function formatScore(score, pointsPossible) {
    if (!isNum(score)) return pointsPossible > 0 ? `Not graded / ${pointsPossible}` : "Not graded";
    if (pointsPossible > 0) return `${score} / ${pointsPossible}`;
    return String(score);
  }

  function getConcernDateRangeLabel() {
    const end = new Date();
    const start = new Date(end.getTime() - Math.max(1, state.settings.lookbackDays) * 86400000);
    return `${formatShortDate(start.toISOString())} – ${formatShortDate(end.toISOString())}`;
  }

  /* ── UTILITY ── */
  function normalizeInt(value, fallback) {
    const p = Number.parseInt(value, 10);
    return Number.isFinite(p) ? p : fallback;
  }

  function isNum(v) { return typeof v === "number" && Number.isFinite(v); }

  function isWithinLookback(item, days) {
    const src = item && (item.dueAt || item.submittedAt);
    if (!src) return true;
    const ts = new Date(src).getTime();
    if (!Number.isFinite(ts)) return true;
    return ts >= Date.now() - days * 86400000;
  }

  function clampSettings() {
    state.settings.lookbackDays = clamp(state.settings.lookbackDays, 1, 180);
    state.settings.redGradeBelow = clamp(state.settings.redGradeBelow, 0, 100);
    state.settings.yellowGradeBelow = clamp(state.settings.yellowGradeBelow, state.settings.redGradeBelow, 100);
    state.settings.redMissingAtOrAbove = clamp(state.settings.redMissingAtOrAbove, 1, 20);
    state.settings.yellowMissingAtOrAbove = clamp(state.settings.yellowMissingAtOrAbove, 1, state.settings.redMissingAtOrAbove);
  }

  function clamp(v, min, max) { return Math.max(min, Math.min(max, normalizeInt(v, min))); }

  function loadSettings() {
    const stored = GM_getValue(SETTINGS_KEY, null);
    if (!stored || typeof stored !== "object") return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...stored };
  }

  function persistSettings() { GM_setValue(SETTINGS_KEY, { ...state.settings }); }

  function escHtml(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /* ── CANVASDASH REGISTRATION ── */
  function tryRegister() {
    try {
      if (hostWindow.CanvasDash && typeof hostWindow.CanvasDash.register === "function") {
        hostWindow.CanvasDash.register({
          id: "canvas-student-help-tools",
          name: "Reports",
          color: "#2563eb",
          description: "At-risk reporting with printable class reports and student support guides",
          run: openApp
        });
      } else {
        setTimeout(tryRegister, 500);
      }
    } catch (_) {
      setTimeout(tryRegister, 500);
    }
  }

})();
