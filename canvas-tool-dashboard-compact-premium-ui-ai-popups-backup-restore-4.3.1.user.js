// ==UserScript==
// @name         Canvas Tool Dashboard (Compact Premium UI + AI Popups + Backup/Restore)
// @namespace    http://tampermonkey.net/
// @version      4.3.1
// @description  Collapsible bottom toolbar with compact clean UI, AI popups, and per-script Backup/Restore
// @match        https://*.instructure.com/*
// @match        *://canvas.*.edu/*
// @match        *://canvas.*.com/*
// @grant        GM_addStyle
// @grant        GM_listValues
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @run-at       document-start
// @downloadURL  https://raw.githubusercontent.com/MarkAlanBrest/scripts/main/canvas-tool-dashboard-compact-premium-ui-ai-popups-backup-restore-4.3.1.user.js
// @updateURL    https://raw.githubusercontent.com/MarkAlanBrest/scripts/main/canvas-tool-dashboard-compact-premium-ui-ai-popups-backup-restore-4.3.1.user.js
// ==/UserScript==

(function () {
    "use strict";

    const hostWindow = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;

    if (hostWindow.__CANVAS_DASHBOARD__) return;
    hostWindow.__CANVAS_DASHBOARD__ = true;
    if (window.top !== window.self) return;

    const _queue = [];
    let _domReady = false;
    const _tools = [];
    const STICKY_NOTES_KEY = "cvd_sticky_notes_v1";
    let stickySaveTimer = null;

    hostWindow.CanvasDash = {
        register(tool) {
            if (_domReady) _addTool(tool);
            else _queue.push(tool);
        }
    };

    /* ---------------- AI TOOLS ---------------- */

    const popup = url =>
        window.open(url, "_blank", "width=600,height=750,left=80,top=80");

    const BUILTIN_TOOLS = [
        { id: "open-chatgpt", name: "ChatGPT", shortLabel: "CG", color: "#10a37f", description: "Open ChatGPT", run: () => popup("https://chat.openai.com"), dot: true },
        { id: "open-claude", name: "Claude", shortLabel: "CL", color: "#c96442", description: "Open Claude AI", run: () => popup("https://claude.ai/new"), dot: true },
        { id: "open-copilot", name: "Copilot", shortLabel: "CP", color: "#2563eb", description: "Open Microsoft Copilot", run: () => popup("https://copilot.microsoft.com"), dot: true },
        { id: "open-gemini", name: "Gemini", shortLabel: "GM", color: "#8b5cf6", description: "Open Google Gemini", run: () => popup("https://gemini.google.com"), dot: true },
        { id: "open-sticky-notes", name: "Notes", color: "#f4b400", description: "Open sticky notes", run: () => openStickyNotes() }
    ];

    /* ---------------- STYLES ---------------- */

    GM_addStyle(`
        #cvd-bar, #cvd-bar * {
            box-sizing: border-box !important;
            font-family: 'Segoe UI', system-ui, -apple-system, sans-serif !important;
        }

        #cvd-bar {
            position: fixed !important;
            bottom: 0 !important;
            left: 0 !important;
            right: 0 !important;
            z-index: 2147483647 !important;
            display: flex !important;
            flex-direction: column !important;
            align-items: center !important;
            pointer-events: none !important;
        }

        #cvd-tab {
            pointer-events: all !important;
            background: #ffffff !important;
            color: #4b5563 !important;
            border: 1px solid #d1d5db !important;
            border-bottom: none !important;
            border-radius: 9px 9px 0 0 !important;
            padding: 3px 10px !important;
            font-size: 10px !important;
            font-weight: 600 !important;
            cursor: pointer !important;
            display: flex !important;
            align-items: center !important;
            gap: 5px !important;
            box-shadow: 0 -2px 6px rgba(0,0,0,0.06) !important;
        }

        #cvd-tab-arrow {
            font-size: 8px !important;
            opacity: 0.6 !important;
            transition: transform 0.25s !important;
        }

        #cvd-bar.collapsed #cvd-tab-arrow {
            transform: rotate(180deg) !important;
        }

        #cvd-panel {
            pointer-events: all !important;
            width: 100% !important;
            background: rgba(248, 249, 250, 0.98) !important;
            border-top: 1px solid #e5e7eb !important;
            padding: 5px 10px !important;
            display: flex !important;
            align-items: center !important;
            gap: 6px !important;
            overflow-x: auto !important;
            height: 36px !important;
            transition: height 0.25s ease, opacity 0.2s ease, padding 0.25s ease !important;
        }

        #cvd-bar.collapsed #cvd-panel {
            height: 0 !important;
            opacity: 0 !important;
            padding-top: 0 !important;
            padding-bottom: 0 !important;
            pointer-events: none !important;
        }

        .cvd-divider {
            width: 1px !important;
            height: 16px !important;
            background: #d1d5db !important;
            flex-shrink: 0 !important;
            opacity: 0.75 !important;
        }

        .cvd-btn {
            pointer-events: all !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            padding: 0 10px !important;
            height: 24px !important;
            border-radius: 999px !important;
            border: none !important;
            background: var(--cvd-color) !important;
            color: #ffffff !important;
            font-size: 11px !important;
            font-weight: 600 !important;
            cursor: pointer !important;
            white-space: nowrap !important;
            flex-shrink: 0 !important;
            box-shadow: 0 1px 4px rgba(0,0,0,0.12) !important;
            position: relative !important;
        }

        .cvd-btn:hover {
            filter: brightness(1.08) !important;
        }

        .cvd-btn.cvd-dot {
            width: 24px !important;
            min-width: 24px !important;
            height: 24px !important;
            padding: 0 !important;
            border-radius: 50% !important;
            box-shadow: 0 0 0 2px #ffffff, 0 1px 4px rgba(0,0,0,0.18) !important;
            font-size: 9px !important;
            font-weight: 700 !important;
            letter-spacing: 0.02em !important;
        }

        .cvd-btn.cvd-dot .cvd-label {
            display: inline !important;
        }

        #cvd-empty {
            color: #9ca3af !important;
            font-size: 11px !important;
            font-style: italic !important;
            white-space: nowrap !important;
            line-height: 1 !important;
        }

        .cvd-tip {
            display: none !important;
            position: fixed !important;
            background: #111827 !important;
            color: #f3f4f6 !important;
            font-size: 11px !important;
            padding: 5px 8px !important;
            border-radius: 6px !important;
            max-width: 180px !important;
            text-align: center !important;
            z-index: 2147483647 !important;
        }

        .cvd-btn:hover .cvd-tip {
            display: block !important;
        }

        /* ---- BACKUP MODAL ---- */
        #ct-backup-modal {
            position: fixed;
            top: 0; left: 0;
            width: 100%; height: 100%;
            background: rgba(0,0,0,0.45);
            display: none;
            justify-content: center;
            align-items: center;
            z-index: 2147483647;
            font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
        }

        #ct-backup-content {
            background: white;
            border-radius: 10px;
            padding: 22px;
            width: 500px;
            max-width: 95vw;
            max-height: 90vh;
            overflow-y: auto;
            box-shadow: 0 4px 24px rgba(0,0,0,0.18);
        }

        #ct-backup-content h3 {
            margin: 0;
            font-size: 16px;
            font-weight: 600;
            color: #111827;
        }

        #ct-backup-content p {
            font-size: 13px;
            color: #6b7280;
            margin: 6px 0 18px;
        }

        .ct-backup-row {
            background: #f9fafb;
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            padding: 12px 14px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 12px;
            margin-bottom: 10px;
        }

        .ct-backup-row-info {
            flex: 1;
            min-width: 0;
        }

        .ct-backup-row-info strong {
            display: block;
            font-size: 13px;
            font-weight: 600;
            color: #111827;
        }

        .ct-backup-row-info span {
            display: block;
            font-size: 12px;
            color: #6b7280;
            margin-top: 2px;
        }

        .ct-backup-row-btns {
            display: flex;
            gap: 6px;
            flex-shrink: 0;
        }

        .ct-backup-btn {
            font-size: 12px;
            padding: 5px 12px;
            border-radius: 6px;
            border: 1px solid #d1d5db;
            background: white;
            cursor: pointer;
            color: #374151;
            font-weight: 500;
            transition: background 0.15s;
        }

        .ct-backup-btn:hover {
            background: #f3f4f6;
        }

        #ct-backup-footer {
            margin-top: 16px;
            padding-top: 14px;
            border-top: 1px solid #e5e7eb;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        #ct-backup-footer span {
            font-size: 12px;
            color: #9ca3af;
        }

        #ct-backup-close-btn {
            font-size: 13px;
            padding: 6px 16px;
            border-radius: 6px;
            border: 1px solid #d1d5db;
            background: white;
            cursor: pointer;
            color: #374151;
            font-weight: 500;
        }

        #ct-backup-close-btn:hover {
            background: #f3f4f6;
        }

        #ct-backup-x {
            background: none;
            border: none;
            font-size: 20px;
            cursor: pointer;
            color: #6b7280;
            line-height: 1;
            padding: 0;
        }

        /* ---- STICKY NOTES MODAL ---- */
        #cvd-notes-modal {
            position: fixed;
            inset: 0;
            background: rgba(17, 24, 39, 0.36);
            display: none;
            justify-content: center;
            align-items: center;
            z-index: 2147483647;
        }

        #cvd-notes-content {
            width: 360px;
            max-width: calc(100vw - 24px);
            background: linear-gradient(180deg, #fff7b8, #fde68a);
            border: 1px solid #eab308;
            border-radius: 14px;
            box-shadow: 0 16px 40px rgba(0,0,0,0.22);
            padding: 14px;
        }

        #cvd-notes-head {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 10px;
            margin-bottom: 10px;
        }

        #cvd-notes-title {
            font-size: 14px;
            font-weight: 700;
            color: #78350f;
        }

        #cvd-notes-status {
            font-size: 11px;
            color: #92400e;
            min-height: 16px;
        }

        #cvd-notes-close {
            width: 28px;
            height: 28px;
            border: none;
            border-radius: 999px;
            background: rgba(255,255,255,0.55);
            color: #78350f;
            font-size: 16px;
            cursor: pointer;
            line-height: 1;
            flex-shrink: 0;
        }

        #cvd-notes-text {
            width: 100%;
            min-height: 260px;
            resize: vertical;
            border: 1px solid rgba(146, 64, 14, 0.18);
            border-radius: 10px;
            background: rgba(255,255,255,0.42);
            padding: 12px;
            font-size: 13px;
            line-height: 1.45;
            color: #451a03;
            outline: none;
        }

        #cvd-notes-text:focus {
            border-color: #d97706;
            box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.18);
        }

        #cvd-notes-footer {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 10px;
            margin-top: 10px;
        }

        #cvd-notes-meta {
            font-size: 11px;
            color: #92400e;
        }

        #cvd-notes-actions {
            display: flex;
            gap: 8px;
        }

        .cvd-notes-btn {
            border: 1px solid rgba(146, 64, 14, 0.18);
            background: rgba(255,255,255,0.65);
            color: #78350f;
            font-size: 12px;
            font-weight: 600;
            border-radius: 8px;
            padding: 6px 10px;
            cursor: pointer;
        }

        .cvd-notes-btn:hover {
            background: rgba(255,255,255,0.82);
        }
    `);

    /* ---------------- UI BUILD ---------------- */

    function buildBar() {
        const bar = document.createElement("div");
        bar.id = "cvd-bar";

        const tab = document.createElement("button");
        tab.id = "cvd-tab";
        tab.innerHTML = `<span>Canvas</span><span id="cvd-tab-arrow">▲</span>`;
        tab.addEventListener("click", toggleBar);
        bar.appendChild(tab);

        const panel = document.createElement("div");
        panel.id = "cvd-panel";

        BUILTIN_TOOLS.forEach(t => panel.appendChild(makeButton(t)));

        panel.appendChild(makeDivider());

        const empty = document.createElement("span");
        empty.id = "cvd-empty";
        empty.textContent = "Install a script";
        panel.appendChild(empty);

        panel.appendChild(makeDivider());

        const backupBtn = document.createElement("button");
        backupBtn.className = "cvd-btn";
        backupBtn.style.setProperty("--cvd-color", "#374151");
        backupBtn.textContent = "Backup";
        backupBtn.onclick = () => {
            document.getElementById("ct-backup-modal").style.display = "flex";
        };
        panel.appendChild(backupBtn);

        bar.appendChild(panel);
        document.body.appendChild(bar);

        buildBackupModal();
        buildStickyNotesModal();

        if (localStorage.getItem("cvd_collapsed") === "1") {
            bar.classList.add("collapsed");
        }
    }

    /* ---------------- BACKUP MODAL ---------------- */

    const BACKUP_SCRIPTS = [
        {
            id: "aigrader",
            name: "AIgrader - Claude Edition",
            description: "All graded submissions and grade scale settings",
            keys: ["AIgrader_DB_v5", "AIgrader_GradeSettings_v1"]
        },
        {
            id: "api-key",
            name: "Shared Claude API Key",
            description: "Your Claude API key - used by AIgrader, AI Module Builder, Content Builder, and QTI Generator",
            keys: ["AIgrader_APIKey"]
        },
        {
            id: "email-storage",
            name: "Canvas Email Storage Center",
            description: "All saved and archived emails",
            keys: ["canvasEmailStorage_v4"]
        },
        {
            id: "email-system",
            name: "Canvas Email System",
            description: "Email templates, teacher name, date window settings, last selected course, and any pending draft",
            keys: [
                "ces_templates",
                "ces_teacher_name",
                "ces_days_forward",
                "ces_days_back",
                "ces_last_course",
                "ces_compose_pending"
            ]
        },
        {
            id: "teacher-eval",
            name: "Canvas Teacher Evaluation Tool",
            description: "Evaluation rubric configuration and display settings",
            keys: ["cte_settings"]
        },
        {
            id: "sticky-notes",
            name: "Canvas Sticky Notes",
            description: "Saved notes from the dashboard sticky note app",
            keys: [STICKY_NOTES_KEY]
        }
    ];

    function buildBackupModal() {
        const modal = document.createElement("div");
        modal.id = "ct-backup-modal";

        const content = document.createElement("div");
        content.id = "ct-backup-content";

        const headerRow = document.createElement("div");
        headerRow.style.cssText = "display:flex; justify-content:space-between; align-items:center;";
        headerRow.innerHTML = `<h3>Backup & Restore</h3><button id="ct-backup-x">&#x2715;</button>`;
        content.appendChild(headerRow);

        const subtitle = document.createElement("p");
        subtitle.textContent = "Each script stores its own data. Download a backup or restore from a file individually.";
        content.appendChild(subtitle);

        BACKUP_SCRIPTS.forEach(script => {
            content.appendChild(makeBackupRow(script));
        });

        const footer = document.createElement("div");
        footer.id = "ct-backup-footer";
        footer.innerHTML = `
            <span>Restoring only affects the keys in that script's backup file.</span>
            <button id="ct-backup-close-btn">Close</button>
        `;
        content.appendChild(footer);

        modal.appendChild(content);
        document.body.appendChild(modal);

        document.getElementById("ct-backup-x").onclick = () => modal.style.display = "none";
        document.getElementById("ct-backup-close-btn").onclick = () => modal.style.display = "none";
        modal.addEventListener("click", e => { if (e.target === modal) modal.style.display = "none"; });
    }

    function makeBackupRow({ id, name, description, keys }) {
        const row = document.createElement("div");
        row.className = "ct-backup-row";

        const info = document.createElement("div");
        info.className = "ct-backup-row-info";
        info.innerHTML = `<strong>${name}</strong><span>${description}</span>`;

        const btns = document.createElement("div");
        btns.className = "ct-backup-row-btns";

        const dlBtn = document.createElement("button");
        dlBtn.className = "ct-backup-btn";
        dlBtn.textContent = "Download";
        dlBtn.onclick = async () => {
            const data = {};
            for (const key of keys) {
                const val = await GM_getValue(key, undefined);
                if (val !== undefined) data[key] = val;
            }
            if (Object.keys(data).length === 0) {
                alert(`No saved data found for "${name}".`);
                return;
            }
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `backup-${id}.json`;
            a.click();
            URL.revokeObjectURL(url);
        };

        const restoreBtn = document.createElement("button");
        restoreBtn.className = "ct-backup-btn";
        restoreBtn.textContent = "Restore";
        restoreBtn.onclick = () => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = ".json,application/json";
            input.onchange = async () => {
                const file = input.files[0];
                if (!file) return;
                try {
                    const text = await file.text();
                    const parsed = JSON.parse(text);
                    let count = 0;
                    for (const key of keys) {
                        if (key in parsed) {
                            await GM_setValue(key, parsed[key]);
                            count++;
                        }
                    }
                    if (count === 0) {
                        alert(`No matching data for "${name}" found in that file.`);
                    } else {
                        alert(`Restored ${count} setting(s) for "${name}". Reload Canvas to apply.`);
                    }
                } catch {
                    alert("Could not read file - make sure it is a valid JSON backup.");
                }
            };
            input.click();
        };

        btns.appendChild(dlBtn);
        btns.appendChild(restoreBtn);
        row.appendChild(info);
        row.appendChild(btns);
        return row;
    }

    function buildStickyNotesModal() {
        const modal = document.createElement("div");
        modal.id = "cvd-notes-modal";
        modal.innerHTML = `
            <div id="cvd-notes-content">
                <div id="cvd-notes-head">
                    <div>
                        <div id="cvd-notes-title">Sticky Notes</div>
                        <div id="cvd-notes-status"></div>
                    </div>
                    <button id="cvd-notes-close" aria-label="Close sticky notes">&#x2715;</button>
                </div>
                <textarea id="cvd-notes-text" placeholder="Jot down reminders, course notes, links, or anything you want to keep handy..."></textarea>
                <div id="cvd-notes-footer">
                    <span id="cvd-notes-meta">0 characters</span>
                    <div id="cvd-notes-actions">
                        <button id="cvd-notes-clear" class="cvd-notes-btn">Clear</button>
                        <button id="cvd-notes-save" class="cvd-notes-btn">Save</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const textarea = modal.querySelector("#cvd-notes-text");
        const closeBtn = modal.querySelector("#cvd-notes-close");
        const saveBtn = modal.querySelector("#cvd-notes-save");
        const clearBtn = modal.querySelector("#cvd-notes-clear");

        closeBtn.onclick = closeStickyNotes;
        saveBtn.onclick = () => saveStickyNotes(true);
        clearBtn.onclick = async () => {
            textarea.value = "";
            updateStickyMeta();
            await saveStickyNotes(true);
            textarea.focus();
        };

        textarea.addEventListener("input", () => {
            updateStickyMeta();
            setStickyStatus("Saving...");
            if (stickySaveTimer) clearTimeout(stickySaveTimer);
            stickySaveTimer = setTimeout(() => {
                saveStickyNotes(false);
            }, 350);
        });

        modal.addEventListener("click", e => {
            if (e.target === modal) closeStickyNotes();
        });
    }

    async function openStickyNotes() {
        const modal = document.getElementById("cvd-notes-modal");
        const textarea = document.getElementById("cvd-notes-text");
        if (!modal || !textarea) return;

        const saved = await GM_getValue(STICKY_NOTES_KEY, "");
        textarea.value = saved || "";
        updateStickyMeta();
        setStickyStatus(saved ? "Loaded" : "Ready");
        modal.style.display = "flex";
        requestAnimationFrame(() => textarea.focus());
    }

    function closeStickyNotes() {
        const modal = document.getElementById("cvd-notes-modal");
        if (modal) modal.style.display = "none";
    }

    async function saveStickyNotes(showSavedLabel) {
        const textarea = document.getElementById("cvd-notes-text");
        if (!textarea) return;

        if (stickySaveTimer) {
            clearTimeout(stickySaveTimer);
            stickySaveTimer = null;
        }

        await GM_setValue(STICKY_NOTES_KEY, textarea.value);
        updateStickyMeta();
        setStickyStatus(showSavedLabel ? "Saved" : "Autosaved");
    }

    function updateStickyMeta() {
        const textarea = document.getElementById("cvd-notes-text");
        const meta = document.getElementById("cvd-notes-meta");
        if (!textarea || !meta) return;

        const count = textarea.value.length;
        meta.textContent = `${count} character${count === 1 ? "" : "s"}`;
    }

    function setStickyStatus(text) {
        const status = document.getElementById("cvd-notes-status");
        if (!status) return;
        status.textContent = text || "";
    }

    /* ---------------- TOOLBAR HELPERS ---------------- */

    function toggleBar() {
        const bar = document.getElementById("cvd-bar");
        bar.classList.toggle("collapsed");
        localStorage.setItem("cvd_collapsed", bar.classList.contains("collapsed") ? "1" : "0");
    }

    function makeDivider() {
        const el = document.createElement("div");
        el.className = "cvd-divider";
        return el;
    }

    function makeButton(tool) {
        const btn = document.createElement("button");
        btn.className = tool.dot ? "cvd-btn cvd-dot" : "cvd-btn";
        btn.style.setProperty("--cvd-color", tool.color || "#2563eb");
        btn.setAttribute("aria-label", tool.name);
        btn.title = tool.name;

        const labelSpan = document.createElement("span");
        labelSpan.className = "cvd-label";
        labelSpan.textContent = tool.dot ? (tool.shortLabel || tool.name.slice(0, 2).toUpperCase()) : tool.name;
        btn.appendChild(labelSpan);

        if (tool.description) {
            const tip = document.createElement("div");
            tip.className = "cvd-tip";
            tip.textContent = tool.description;
            btn.appendChild(tip);

            btn.addEventListener("mouseenter", () => {
                requestAnimationFrame(() => {
                    const br = btn.getBoundingClientRect();
                    const th = tip.offsetHeight || 36;
                    const tw = 180;
                    let left = br.left + br.width / 2 - tw / 2;
                    left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
                    tip.style.left = left + "px";
                    tip.style.top = (br.top - th - 8) + "px";
                });
            });
        }

        btn.addEventListener("click", () => {
            try { tool.run(); }
            catch (e) { console.error("[CanvasDash]", tool.name, e); }
        });

        return btn;
    }

    function _addTool(tool) {
        if (tool.id && _tools.find(t => t.id === tool.id)) return;
        _tools.push(tool);

        const panel = document.getElementById("cvd-panel");
        if (!panel) return;

        const empty = document.getElementById("cvd-empty");
        if (empty) empty.remove();

        const backupBtn = panel.lastElementChild;
        const dividerBeforeBackup = backupBtn && backupBtn.previousElementSibling;

        if (dividerBeforeBackup && dividerBeforeBackup.classList.contains("cvd-divider")) {
            panel.insertBefore(makeButton(tool), dividerBeforeBackup);
        } else {
            panel.appendChild(makeButton(tool));
        }
    }

    /* ---------------- INIT ---------------- */

    function init() {
        buildBar();
        _domReady = true;
        _queue.forEach(_addTool);
        _queue.length = 0;
    }

    function waitForBody() {
        if (document.body) init();
        else requestAnimationFrame(waitForBody);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        waitForBody();
    }

})();
