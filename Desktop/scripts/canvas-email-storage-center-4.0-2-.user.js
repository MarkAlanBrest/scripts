// ==UserScript==
// @name         Canvas Email Storage Center
// @namespace    http://tampermonkey.net/
// @version      4.0
// @description  Quick-send pre-written emails in Canvas Conversations
// @match        https://*.instructure.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/MarkAlanBrest/scripts/main/Canvas%20Email%20Storage%20Center-4.0%20(2).user.js
// @updateURL    https://raw.githubusercontent.com/MarkAlanBrest/scripts/main/Canvas%20Email%20Storage%20Center-4.0%20(2).user.js
// ==/UserScript==

(function () {
    "use strict";

    // ─────────────────────────────────────────────
    // CONSTANTS
    // ─────────────────────────────────────────────
    const STORAGE_KEY = "canvasEmailStorage_v4";
    const PANEL_WIDTH = "420px";
    const MAX_TILES   = 12;

    // ─────────────────────────────────────────────
    // STATE
    // ─────────────────────────────────────────────
    let panelInjected = false;
    let panel = null;

    const state = {
        view:        "browse",  // "browse" | "manage"
        activeTab:   0,
        searchQuery: "",
        status:      "",
        statusType:  "idle"     // "idle" | "success" | "error"
    };

    // ─────────────────────────────────────────────
    // DATABASE
    // ─────────────────────────────────────────────
    function loadDB() {
        const saved = GM_getValue(STORAGE_KEY, null);
        if (saved) {
            try { return JSON.parse(saved); } catch {}
        }
        return {
            tabs: [
                { name: "General",   tiles: blankTiles() },
                { name: "Parents",   tiles: blankTiles() },
                { name: "Reminders", tiles: blankTiles() }
            ]
        };
    }

    function saveDB(db) {
        GM_setValue(STORAGE_KEY, JSON.stringify(db));
    }

    function blankTiles() {
        return Array.from({ length: MAX_TILES }, () => ({ subject: "", body: "" }));
    }

    // ─────────────────────────────────────────────
    // CANVAS FIELD DETECTION + PASTE
    // ─────────────────────────────────────────────
    function pasteEmail(subject, body) {
        let pastedSubject = false;
        let pastedBody    = false;

        // Subject field
        const subjectField =
            document.querySelector('input[name="subject"]') ||
            document.querySelector('input[placeholder*="ubject"]') ||
            document.querySelector(".message-header-row input");

        if (subjectField) {
            subjectField.focus();
            subjectField.value = subject;
            subjectField.dispatchEvent(new Event("input",  { bubbles: true }));
            subjectField.dispatchEvent(new Event("change", { bubbles: true }));
            pastedSubject = true;
        }

        // Body — TinyMCE iframe first


  const iframes = document.querySelectorAll('iframe[id^="tinyMCE_iframe"], iframe.tox-edit-area__iframe');

for (const frame of iframes) {
    try {
        const doc = frame.contentDocument || frame.contentWindow?.document;
        if (!doc) continue;

        const bodyEl = doc.getElementById("tinymce") || doc.body;
        if (!bodyEl) continue;

        bodyEl.focus();

        // convert line breaks to HTML
        const formatted = body.replace(/\n/g, "<br>");

        // insert content properly
        bodyEl.innerHTML = formatted;

        // trigger Canvas to recognize change
        bodyEl.dispatchEvent(new Event("input", { bubbles: true }));
        bodyEl.dispatchEvent(new Event("change", { bubbles: true }));

        pastedBody = true;
        break;

    } catch {}
}



        // Body — plain textarea fallback
        if (!pastedBody) {
            const bodyField =
                document.querySelector("textarea#message_body") ||
                document.querySelector("textarea.message-body") ||
                document.querySelector("textarea");
            if (bodyField) {
                bodyField.focus();
                bodyField.value = body;
                bodyField.dispatchEvent(new Event("input",  { bubbles: true }));
                bodyField.dispatchEvent(new Event("change", { bubbles: true }));
                pastedBody = true;
            }
        }

        return { pastedSubject, pastedBody };
    }

    // ─────────────────────────────────────────────
    // DOM HELPERS
    // ─────────────────────────────────────────────
    function el(tag, styles = {}, props = {}) {
        const node = document.createElement(tag);
        Object.assign(node.style, styles);
        Object.assign(node, props);
        return node;
    }

    function div(styles = {}, props = {}) {
        return el("div", styles, props);
    }

    function btn(label, bg, color = "#fff", extra = {}) {
        const b = el("button", {
            padding: "9px 14px", borderRadius: "8px", fontWeight: "600",
            cursor: "pointer", fontSize: "13px", border: "none",
            background: bg, color, transition: "opacity 0.15s", ...extra
        }, { textContent: label });
        b.onmouseenter = () => b.style.opacity = "0.85";
        b.onmouseleave = () => b.style.opacity = "1";
        return b;
    }

    function setStatus(text, type = "idle") {
        state.status     = text;
        state.statusType = type;

        // Auto-clear success messages after 3 seconds
        if (type === "success") {
            setTimeout(() => {
                if (state.status === text) {
                    state.status     = "";
                    state.statusType = "idle";
                    renderStatusBar();
                }
            }, 3000);
        }
    }

    function statusColor(type) {
        return {
            success: "#166534",
            error:   "#b91c1c",
            idle:    "#6b7280"
        }[type] || "#6b7280";
    }

    function statusBg(type) {
        return {
            success: "#f0fdf4",
            error:   "#fef2f2",
            idle:    "transparent"
        }[type] || "transparent";
    }

    function statusBorder(type) {
        return {
            success: "#86efac",
            error:   "#fca5a5",
            idle:    "transparent"
        }[type] || "transparent";
    }

    // Update just the status bar without a full re-render
    function renderStatusBar() {
        const bar = document.getElementById("email-status-bar");
        if (!bar) return;
        bar.textContent   = state.status;
        bar.style.color   = statusColor(state.statusType);
        bar.style.background  = statusBg(state.statusType);
        bar.style.borderColor = statusBorder(state.statusType);
        bar.style.display = state.status ? "block" : "none";
    }

    // ─────────────────────────────────────────────
    // LAUNCHER BUTTON
    // ─────────────────────────────────────────────

    // ─────────────────────────────────────────────
    // PANEL LIFECYCLE
    // ─────────────────────────────────────────────
    function togglePanel() {
        if (panelInjected) closePanel();
        else injectPanel();
    }

    function injectPanel() {
        if (panelInjected) return;
        panelInjected = true;

        panel = div({
            position: "fixed", top: "0", right: "0",
            width: PANEL_WIDTH, height: "100vh",
            background: "#f1f5f9",
            borderLeft: "1px solid #e2e8f0",
            zIndex: "999998",
            display: "flex", flexDirection: "column",
            boxShadow: "-6px 0 24px rgba(0,0,0,0.10)",
            fontFamily: "Inter, system-ui, Arial",
            boxSizing: "border-box", overflow: "hidden"
        });

        document.body.appendChild(panel);
        render();
    }

    function closePanel() {
        panel?.remove();
        panel = null;
        panelInjected = false;
    }

    // ─────────────────────────────────────────────
    // RENDER
    // ─────────────────────────────────────────────
    function render() {
        if (!panel) return;
        panel.innerHTML = "";
        panel.appendChild(buildTopBar());

        const content = div({ flex: "1", overflowY: "auto", display: "flex", flexDirection: "column" });

        if      (state.view === "browse") content.appendChild(buildBrowseView());
        else if (state.view === "manage") content.appendChild(buildManageView());

        panel.appendChild(content);

        // Status bar pinned at the bottom
        panel.appendChild(buildStatusBar());
    }

    // ─────────────────────────────────────────────
    // TOP BAR
    // ─────────────────────────────────────────────
    function buildTopBar() {
        const bar = div({
            display: "flex", alignItems: "center",
            justifyContent: "space-between",
            padding: "0 14px", height: "52px",
            background: "#1e3a5f", color: "#fff", flexShrink: "0"
        });

        const left = div({ display: "flex", alignItems: "center", gap: "10px" });

        const logo = div({
            width: "30px", height: "30px", borderRadius: "8px",
            background: "#2c7be5", display: "flex",
            alignItems: "center", justifyContent: "center", fontSize: "16px"
        }, { textContent: "✉️" });

        const title = div({ fontWeight: "700", fontSize: "15px" }, {
            textContent: state.view === "manage" ? "Manage Emails" : "Email Storage"
        });

        left.appendChild(logo);
        left.appendChild(title);
        bar.appendChild(left);

        const right = div({ display: "flex", alignItems: "center", gap: "8px" });

        right.appendChild(navTab("Emails",  state.view === "browse", () => { state.view = "browse"; render(); }));
        right.appendChild(navTab("Manage",  state.view === "manage", () => { state.view = "manage"; render(); }));

        const closeX = el("button", {
            background: "none", border: "none", color: "#94a3b8",
            fontSize: "20px", cursor: "pointer", padding: "4px 6px", lineHeight: "1"
        }, { textContent: "✕" });
        closeX.onclick = closePanel;
        right.appendChild(closeX);
        bar.appendChild(right);

        return bar;
    }

    function navTab(label, active, onClick) {
        const t = el("button", {
            padding: "5px 10px", borderRadius: "6px", border: "none",
            cursor: "pointer", fontSize: "12px", fontWeight: "600",
            background: active ? "#2563eb" : "rgba(255,255,255,0.1)",
            color: active ? "#fff" : "#cbd5e1",
            transition: "background 0.15s"
        }, { textContent: label });
        t.onclick = onClick;
        return t;
    }

    // ─────────────────────────────────────────────
    // STATUS BAR (inline, no popup)
    // ─────────────────────────────────────────────
    function buildStatusBar() {
        const bar = el("div", {
            padding:      state.status ? "10px 14px" : "0",
            fontSize:     "13px",
            fontWeight:   "500",
            borderRadius: "0",
            borderTop:    state.status ? `1px solid ${statusBorder(state.statusType)}` : "none",
            background:   statusBg(state.statusType),
            color:        statusColor(state.statusType),
            flexShrink:   "0",
            display:      state.status ? "block" : "none",
            transition:   "all 0.2s",
            textAlign:    "center"
        }, { id: "email-status-bar", textContent: state.status });
        return bar;
    }

    // ─────────────────────────────────────────────
    // BROWSE VIEW
    // ─────────────────────────────────────────────
    function buildBrowseView() {
        const db   = loadDB();
        const wrap = div({ display: "flex", flexDirection: "column" });

        // ── TAB BAR ──
        const tabBar = div({
            display: "flex", padding: "10px 14px 0",
            gap: "4px", background: "#fff",
            borderBottom: "1px solid #e5e7eb",
            flexShrink: "0", flexWrap: "wrap"
        });

        db.tabs.forEach((tab, i) => {
            const active = i === state.activeTab;
            const tabBtn = el("button", {
                padding: "7px 14px",
                borderRadius: "8px 8px 0 0",
                border: "1px solid " + (active ? "#e5e7eb" : "transparent"),
                borderBottom: active ? "1px solid #fff" : "1px solid #e5e7eb",
                background: active ? "#fff" : "#f1f5f9",
                cursor: "pointer", fontSize: "13px",
                fontWeight: active ? "700" : "500",
                color: active ? "#1e3a5f" : "#6b7280",
                marginBottom: active ? "-1px" : "0"
            }, { textContent: tab.name || `Tab ${i + 1}` });

            tabBtn.onclick = () => {
                state.activeTab   = i;
                state.searchQuery = "";
                setStatus("", "idle");
                render();
            };
            tabBar.appendChild(tabBtn);
        });

        wrap.appendChild(tabBar);

        // ── SEARCH ──
        const searchWrap = div({
            padding: "10px 14px", background: "#fff",
            borderBottom: "1px solid #e5e7eb"
        });

        const searchInput = el("input", {
            width: "100%", padding: "9px 12px", borderRadius: "8px",
            border: "1px solid #d1d5db", fontSize: "13px",
            boxSizing: "border-box", background: "#f9fafb", color: "#111827"
        }, { placeholder: "🔍 Search emails…", value: state.searchQuery });

        searchInput.oninput = () => {
            state.searchQuery = searchInput.value;
            render();
        };

        searchWrap.appendChild(searchInput);
        wrap.appendChild(searchWrap);

        // ── ON CONVERSATIONS PAGE HINT ──
        const onConvo = window.location.href.includes("/conversations");
        if (onConvo) {
            const hint = div({
                padding: "8px 14px",
                background: "#eff6ff",
                borderBottom: "1px solid #bfdbfe",
                fontSize: "12px", color: "#1d4ed8"
            }, { textContent: "✓ Canvas email detected — clicking an email will auto-fill the fields." });
            wrap.appendChild(hint);
        } else {
            const hint = div({
                padding: "8px 14px",
                background: "#fffbeb",
                borderBottom: "1px solid #fde68a",
                fontSize: "12px", color: "#92400e"
            }, { textContent: "💡 Go to Inbox → Compose to auto-fill. Or click to copy." });
            wrap.appendChild(hint);
        }

        // ── EMAIL TILES ──
        const tilesWrap = div({ padding: "12px 14px", display: "flex", flexDirection: "column", gap: "8px" });

        const currentTiles = db.tabs[state.activeTab]?.tiles || [];
        const query        = state.searchQuery.toLowerCase();

        const filtered = currentTiles.filter(tile =>
            tile.subject || tile.body
        ).filter(tile =>
            !query ||
            tile.subject.toLowerCase().includes(query) ||
            tile.body.toLowerCase().includes(query)
        );

        if (!filtered.length) {
            tilesWrap.appendChild(div({
                padding: "24px 16px", textAlign: "center",
                color: "#9ca3af", fontSize: "13px"
            }, {
                innerHTML: query
                    ? `No emails match "<strong>${query}</strong>"`
                    : "No emails saved in this tab yet.<br>Go to <strong>Manage</strong> to add some."
            }));
        } else {
            filtered.forEach(tile => {
                tilesWrap.appendChild(buildEmailTile(tile, onConvo));
            });
        }

        wrap.appendChild(tilesWrap);
        return wrap;
    }

    // ─────────────────────────────────────────────
    // EMAIL TILE
    // ─────────────────────────────────────────────
    function buildEmailTile(tile, onConvo) {
        const card = div({
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderLeft: "4px solid #2c7be5",
            borderRadius: "10px",
            padding: "12px",
            display: "flex",
            flexDirection: "column",
            gap: "6px",
            boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
            transition: "border-color 0.15s"
        });

        card.onmouseenter = () => card.style.borderColor = "#2c7be5";
        card.onmouseleave = () => card.style.borderColor = "#e5e7eb";

        // Subject line
        if (tile.subject) {
            card.appendChild(div({
                fontSize: "13px", fontWeight: "700",
                color: "#1e3a5f", lineHeight: "1.4"
            }, { textContent: tile.subject }));
        }

        // Body preview
        if (tile.body) {
            const preview = tile.body.split("\n").slice(0, 2).join(" ");
            card.appendChild(div({
                fontSize: "12px", color: "#6b7280",
                lineHeight: "1.5", overflow: "hidden",
                display: "-webkit-box",
                webkitLineClamp: "2",
                webkitBoxOrient: "vertical"
            }, { textContent: preview }));
        }

        // Action buttons
        const actions = div({ display: "flex", gap: "6px", marginTop: "4px", flexWrap: "wrap" });

        if (onConvo) {
            // Auto-fill button — pastes into Canvas fields directly
            const fillBtn = btn("✓ Fill Email", "#1e3a5f", "#fff", {
                padding: "6px 12px", fontSize: "12px", flex: "1"
            });
            fillBtn.onclick = () => {
                const { pastedSubject, pastedBody } = pasteEmail(tile.subject, tile.body);

                if (pastedSubject && pastedBody) {
                    setStatus("✓ Subject and message filled in!", "success");
                } else if (pastedBody) {
                    setStatus("✓ Message filled in — subject field not found.", "success");
                } else if (pastedSubject) {
                    setStatus("✓ Subject filled in — message field not found.", "success");
                } else {
                    setStatus("⚠ Could not find Canvas email fields. Try Copy instead.", "error");
                }
                renderStatusBar();
            };
            actions.appendChild(fillBtn);
        }

        // Copy subject button
        if (tile.subject) {
            const copySubBtn = btn("Copy Subject", "#f1f5f9", "#374151", {
                padding: "6px 10px", fontSize: "11px",
                border: "1px solid #d1d5db"
            });
            copySubBtn.onclick = () => {
                navigator.clipboard.writeText(tile.subject).then(() => {
                    setStatus("✓ Subject copied to clipboard.", "success");
                    renderStatusBar();
                });
            };
            actions.appendChild(copySubBtn);
        }

        // Copy body button
        if (tile.body) {
            const copyBodyBtn = btn("Copy Message", "#f1f5f9", "#374151", {
                padding: "6px 10px", fontSize: "11px",
                border: "1px solid #d1d5db"
            });
            copyBodyBtn.onclick = () => {
                navigator.clipboard.writeText(tile.body).then(() => {
                    setStatus("✓ Message copied to clipboard.", "success");
                    renderStatusBar();
                });
            };
            actions.appendChild(copyBodyBtn);
        }

        card.appendChild(actions);
        return card;
    }

    // ─────────────────────────────────────────────
    // MANAGE VIEW
    // ─────────────────────────────────────────────
    function buildManageView() {
        const db   = loadDB();
        const wrap = div({ display: "flex", flexDirection: "column" });

        // ── TAB MANAGER ──
        const tabSection = div({
            padding: "14px", background: "#fff",
            borderBottom: "1px solid #e5e7eb"
        });

        tabSection.appendChild(div({
            fontSize: "11px", fontWeight: "700", color: "#6b7280",
            textTransform: "uppercase", letterSpacing: "0.05em",
            marginBottom: "8px"
        }, { textContent: "Tab Names" }));

        db.tabs.forEach((tab, i) => {
            const row = div({ display: "flex", gap: "8px", marginBottom: "6px", alignItems: "center" });

            const nameInput = el("input", {
                flex: "1", padding: "8px 10px", borderRadius: "8px",
                border: "1px solid #d1d5db", fontSize: "13px",
                boxSizing: "border-box", background: "#f9fafb"
            }, { value: tab.name || "", placeholder: `Tab ${i + 1} name` });

            nameInput.oninput = () => { tab.name = nameInput.value; };

            // Save tab name
            const saveTabBtn = btn("Save", "#166534", "#fff", { padding: "7px 12px", fontSize: "12px" });
            saveTabBtn.onclick = () => {
                tab.name = nameInput.value.trim() || `Tab ${i + 1}`;
                saveDB(db);
                setStatus(`✓ Tab renamed to "${tab.name}"`, "success");
                render();
            };

            row.appendChild(nameInput);
            row.appendChild(saveTabBtn);
            tabSection.appendChild(row);
        });

        // Add tab button
        const addTabBtn = btn("+ Add Tab", "#2563eb", "#fff", {
            width: "100%", boxSizing: "border-box",
            marginTop: "6px", padding: "8px"
        });
        addTabBtn.onclick = () => {
            db.tabs.push({ name: `Tab ${db.tabs.length + 1}`, tiles: blankTiles() });
            saveDB(db);
            state.activeTab = db.tabs.length - 1;
            setStatus("✓ New tab added.", "success");
            render();
        };
        tabSection.appendChild(addTabBtn);
        wrap.appendChild(tabSection);

        // ── EMAIL EDITOR ──
        const editorSection = div({ padding: "14px", display: "flex", flexDirection: "column", gap: "10px" });

        editorSection.appendChild(div({
            fontSize: "11px", fontWeight: "700", color: "#6b7280",
            textTransform: "uppercase", letterSpacing: "0.05em"
        }, { textContent: `Editing: ${db.tabs[state.activeTab]?.name || "Tab"}` }));

        // Tab selector for editing
        editorSection.appendChild(buildSelect(
            db.tabs.map((t, i) => ({ label: t.name || `Tab ${i + 1}`, value: String(i) })),
            String(state.activeTab),
            value => { state.activeTab = Number(value); render(); }
        ));

        const currentTiles = db.tabs[state.activeTab]?.tiles || [];

        currentTiles.forEach((tile, idx) => {
            const card = div({
                background: "#fff", border: "1px solid #e5e7eb",
                borderRadius: "10px", padding: "12px",
                display: "flex", flexDirection: "column", gap: "8px",
                boxShadow: "0 1px 4px rgba(0,0,0,0.05)"
            });

            // Email number label
            card.appendChild(div({
                fontSize: "11px", fontWeight: "700", color: "#6b7280",
                textTransform: "uppercase"
            }, { textContent: `Email ${idx + 1}` }));

            // Subject input
            const subjectInput = el("input", {
                width: "100%", padding: "8px 10px", borderRadius: "8px",
                border: "1px solid #d1d5db", fontSize: "13px",
                boxSizing: "border-box", background: "#f9fafb"
            }, { value: tile.subject || "", placeholder: "Subject line…" });

            subjectInput.oninput = () => { tile.subject = subjectInput.value; };
            card.appendChild(subjectInput);

            // Body textarea
            const bodyArea = el("textarea", {
                width: "100%", minHeight: "100px", resize: "vertical",
                padding: "8px 10px", borderRadius: "8px",
                border: "1px solid #d1d5db", fontSize: "13px",
                boxSizing: "border-box", background: "#f9fafb",
                fontFamily: "Inter, system-ui, Arial", lineHeight: "1.5"
            }, { value: tile.body || "", placeholder: "Email body…" });

            bodyArea.oninput = () => { tile.body = bodyArea.value; };
            card.appendChild(bodyArea);

            // Save + Clear buttons
            const btnRow = div({ display: "flex", gap: "8px", justifyContent: "flex-end" });

            const saveBtn = btn("Save", "#166534", "#fff", { padding: "6px 14px", fontSize: "12px" });
            saveBtn.onclick = () => {
                tile.subject = subjectInput.value;
                tile.body    = bodyArea.value;
                saveDB(db);
                setStatus(`✓ Email ${idx + 1} saved.`, "success");
                renderStatusBar();
            };

            const clearBtn = btn("Clear", "#ef4444", "#fff", { padding: "6px 14px", fontSize: "12px" });
            clearBtn.onclick = () => {
                if (!confirm(`Clear Email ${idx + 1}? This cannot be undone.`)) return;
                tile.subject        = "";
                tile.body           = "";
                subjectInput.value  = "";
                bodyArea.value      = "";
                saveDB(db);
                setStatus(`Email ${idx + 1} cleared.`, "idle");
                renderStatusBar();
            };

            btnRow.appendChild(saveBtn);
            btnRow.appendChild(clearBtn);
            card.appendChild(btnRow);
            editorSection.appendChild(card);
        });

        wrap.appendChild(editorSection);
        return wrap;
    }

    // ─────────────────────────────────────────────
    // SELECT HELPER
    // ─────────────────────────────────────────────
    function buildSelect(options, selectedValue, onChange) {
        const select = el("select", {
            width: "100%", padding: "9px 10px", borderRadius: "8px",
            border: "1px solid #d1d5db", background: "#f9fafb",
            fontSize: "13px", boxSizing: "border-box", color: "#111827"
        });

        options.forEach(opt => {
            const o = document.createElement("option");
            o.value       = opt.value;
            o.textContent = opt.label;
            if (opt.value === selectedValue) o.selected = true;
            select.appendChild(o);
        });

        select.onchange = () => onChange(select.value);
        return select;
    }

    // ─────────────────────────────────────────────
    // INIT
    // ─────────────────────────────────────────────

    // ─────────────────────────────────────────────
    // REGISTER WITH CANVAS DASHBOARD
    // ─────────────────────────────────────────────
    (function tryRegister() {
        if (unsafeWindow.CanvasDash) {
            unsafeWindow.CanvasDash.register({
                id:          "email-storage",
                name:        "Email Storage",
                icon:        "📬",
                description: "Quick-send pre-written email templates",
                color:       "#d35400",
                run:         togglePanel
            });
        } else {
            setTimeout(tryRegister, 100);
        }
    })();


})();