// ==UserScript==
// @name         Canvas Content Builder
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  AI-powered Canvas page and assignment HTML generator
// @match        https://*.instructure.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_deleteValue
// @grant        unsafeWindow
// @connect      api.anthropic.com
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/MarkAlanBrest/scripts/main/canvas-content-builder-1.0.user.js
// @updateURL    https://raw.githubusercontent.com/MarkAlanBrest/scripts/main/canvas-content-builder-1.0.user.js
// ==/UserScript==

(function () {
    "use strict";

    if (window.__CANVAS_CONTENT_BUILDER__) return;
    window.__CANVAS_CONTENT_BUILDER__ = true;
    if (window.top !== window.self) return;

    // ─────────────────────────────────────────────
    // CONSTANTS
    // ─────────────────────────────────────────────
    const APIKEY_KEY  = "AIgrader_APIKey"; // shared with AI Grader
    const PANEL_WIDTH = "480px";

//  const AI_MODEL = "claude-haiku-4-5-20251001";
    const AI_MODEL    = "claude-sonnet-4-5";

    // ─────────────────────────────────────────────
    // STATE
    // ─────────────────────────────────────────────
    let panelInjected = false;
    let panel = null;

    const state = {
        view:        "build",   // "build" | "result" | "setup"
        contentType: "page",    // "page" | "assignment"
        status:      "",
        statusType:  "idle",

        // Content
        textContent:    "",
        uploadedFile:   "",
        uploadedName:   "",

        // Page options
        pageStyle:   "pastel",  // pastel | bold | dark | earth | custom
        customColor: "#1e3a5f",
        pageElements: {
            emojiIcons:       true,
            sectionDividers:  true,
            tipBoxes:         true,
            imagePlaceholders:false,
            collapsible:      false,
            quoteBoxes:       false,
            alertBoxes:       false,
        },

        // Assignment options
        assignmentElements: {
            numberedSteps:    true,
            checklist:        false,
            rubricTable:      false,
            pointValue:       false,
            dueDate:          false,
            videoEmbed:       false,
            watchFirst:       false,
        },
        pointValue: "",
        dueDate:    "",

        // Result
        generatedHTML:   "",
        generatedPreview:"",

        apiKey: GM_getValue(APIKEY_KEY, ""),
    };

    // ─────────────────────────────────────────────
    // DOM HELPERS
    // ─────────────────────────────────────────────
    function el(tag, styles = {}, props = {}) {
        const node = document.createElement(tag);
        Object.assign(node.style, styles);
        Object.assign(node, props);
        return node;
    }

    function div(styles = {}, props = {}) { return el("div", styles, props); }

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
    }

    function statusColor(type) {
        return { success: "#166534", error: "#b91c1c", loading: "#1d4ed8", idle: "#6b7280" }[type] || "#6b7280";
    }

    function statusBg(type) {
        return { success: "#f0fdf4", error: "#fef2f2", loading: "#eff6ff", idle: "#f9fafb" }[type] || "#f9fafb";
    }

    function toggle(label, checked, onChange, description = "") {
        const row = div({
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "8px 0", borderBottom: "1px solid #f1f5f9"
        });

        const left = div({ display: "flex", flexDirection: "column", gap: "2px" });
        left.appendChild(div({ fontSize: "13px", fontWeight: "500", color: "#111827" }, { textContent: label }));
        if (description) {
            left.appendChild(div({ fontSize: "11px", color: "#9ca3af" }, { textContent: description }));
        }

        // Toggle switch
        const switchWrap = div({
            width: "40px", height: "22px", borderRadius: "11px",
            background: checked ? "#2563eb" : "#d1d5db",
            position: "relative", cursor: "pointer",
            transition: "background 0.2s", flexShrink: "0"
        });

        const knob = div({
            position: "absolute", top: "3px",
            left: checked ? "21px" : "3px",
            width: "16px", height: "16px",
            borderRadius: "50%", background: "#fff",
            transition: "left 0.2s",
            boxShadow: "0 1px 3px rgba(0,0,0,0.2)"
        });

        switchWrap.appendChild(knob);
        switchWrap.onclick = () => {
            const newVal = !checked;
            onChange(newVal);
            switchWrap.style.background = newVal ? "#2563eb" : "#d1d5db";
            knob.style.left = newVal ? "21px" : "3px";
            checked = newVal;
        };

        row.appendChild(left);
        row.appendChild(switchWrap);
        return row;
    }

    function sectionHeader(text) {
        return div({
            fontSize: "11px", fontWeight: "700", color: "#6b7280",
            textTransform: "uppercase", letterSpacing: "0.06em",
            padding: "14px 0 6px"
        }, { textContent: text });
    }

    function card(styles = {}) {
        return div({
            background: "#fff", border: "1px solid #e5e7eb",
            borderRadius: "10px", padding: "14px",
            boxShadow: "0 1px 4px rgba(0,0,0,0.05)", ...styles
        });
    }

    // ─────────────────────────────────────────────
    // THEME COLORS
    // ─────────────────────────────────────────────
    const THEMES = {
        pastel: {
            name: "🌸 Pastel / Soft",
            primary: "#7c3aed", secondary: "#a78bfa",
            bg: "#faf5ff", headerBg: "#ede9fe",
            accent: "#8b5cf6", text: "#1e1b4b",
            cardBg: "#f5f3ff", border: "#c4b5fd"
        },
        bold: {
            name: "⚡ Bold / Vibrant",
            primary: "#dc2626", secondary: "#f97316",
            bg: "#fff7ed", headerBg: "#fee2e2",
            accent: "#ea580c", text: "#1c1917",
            cardBg: "#fff1f2", border: "#fca5a5"
        },
        dark: {
            name: "🌙 Dark / Professional",
            primary: "#0ea5e9", secondary: "#38bdf8",
            bg: "#0f172a", headerBg: "#1e293b",
            accent: "#7dd3fc", text: "#f1f5f9",
            cardBg: "#1e293b", border: "#334155"
        },
        earth: {
            name: "🌿 Earth Tones",
            primary: "#854d0e", secondary: "#a16207",
            bg: "#fefce8", headerBg: "#fef9c3",
            accent: "#ca8a04", text: "#1c1917",
            cardBg: "#fffbeb", border: "#fde68a"
        },
        custom: {
            name: "🏫 School Colors",
            primary: "#1e3a5f", secondary: "#2563eb",
            bg: "#f0f7ff", headerBg: "#dbeafe",
            accent: "#3b82f6", text: "#111827",
            cardBg: "#eff6ff", border: "#bfdbfe"
        }
    };

    // ─────────────────────────────────────────────
    // LAUNCHER
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
            background: "#f1f5f9", borderLeft: "1px solid #e2e8f0",
            zIndex: "999997", display: "flex", flexDirection: "column",
            boxShadow: "-6px 0 24px rgba(0,0,0,0.10)",
            fontFamily: "Inter, system-ui, Arial",
            boxSizing: "border-box", overflow: "hidden"
        });

        document.body.appendChild(panel);
        if (!state.apiKey) state.view = "setup";
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

        if      (state.view === "setup")  content.appendChild(buildSetupView());
        else if (state.view === "build")  content.appendChild(buildBuildView());
        else if (state.view === "result") content.appendChild(buildResultView());

        panel.appendChild(content);

        // Status bar
        if (state.status) {
            const bar = div({
                padding: "10px 14px", fontSize: "13px", fontWeight: "500",
                borderTop: `1px solid ${state.statusType === "error" ? "#fca5a5" : state.statusType === "success" ? "#86efac" : "#bfdbfe"}`,
                background: statusBg(state.statusType),
                color: statusColor(state.statusType),
                flexShrink: "0", textAlign: "center"
            }, { textContent: state.status });
            panel.appendChild(bar);
        }
    }

    // ─────────────────────────────────────────────
    // TOP BAR
    // ─────────────────────────────────────────────
    function buildTopBar() {
        const bar = div({
            display: "flex", alignItems: "center",
            justifyContent: "space-between",
            padding: "0 14px", height: "52px",
            background: "#2d1b69", color: "#fff", flexShrink: "0"
        });

        const left = div({ display: "flex", alignItems: "center", gap: "10px" });

        const logo = div({
            width: "30px", height: "30px", borderRadius: "8px",
            background: "#7c3aed", display: "flex",
            alignItems: "center", justifyContent: "center", fontSize: "16px"
        }, { textContent: "✦" });

        const title = div({ fontWeight: "700", fontSize: "15px" }, {
            textContent: state.view === "setup"  ? "API Setup"
                       : state.view === "result" ? "Generated Content"
                       : "Content Builder"
        });

        left.appendChild(logo);
        left.appendChild(title);
        bar.appendChild(left);

        const right = div({ display: "flex", alignItems: "center", gap: "8px" });

        if (state.view !== "setup") {
            right.appendChild(navTab("Build",   state.view === "build",  () => { state.view = "build";  render(); }));
            right.appendChild(navTab("⚙",       false,                   () => { state.view = "setup";  render(); }));
        }

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
            background: active ? "#7c3aed" : "rgba(255,255,255,0.1)",
            color: active ? "#fff" : "#cbd5e1"
        }, { textContent: label });
        t.onclick = onClick;
        return t;
    }

    // ─────────────────────────────────────────────
    // SETUP VIEW
    // ─────────────────────────────────────────────
    function buildSetupView() {
        const wrap = div({ padding: "20px", display: "flex", flexDirection: "column", gap: "14px" });

        wrap.appendChild(div({
            background: "#eff6ff", border: "1px solid #bfdbfe",
            borderRadius: "10px", padding: "14px",
            fontSize: "13px", lineHeight: "1.6", color: "#1e40af"
        }, { innerHTML: `<strong>Anthropic API Key Required</strong><br>This tool shares the same API key as AI Grader. If you already set it up there, just click Save below.` }));

        const keyInput = el("input", {
            padding: "10px 12px", borderRadius: "8px",
            border: "1px solid #d1d5db", fontSize: "13px",
            width: "100%", boxSizing: "border-box",
            fontFamily: "monospace", background: "#fff"
        }, { type: "password", placeholder: "sk-ant-api03-…", value: state.apiKey || "" });

        wrap.appendChild(keyInput);

        const saveBtn = btn("Save & Start Building", "#7c3aed", "#fff", { width: "100%", boxSizing: "border-box" });
        saveBtn.onclick = () => {
            const key = keyInput.value.trim();
            if (!key.startsWith("sk-ant-")) {
                setStatus("Invalid API key — should start with sk-ant-", "error");
                render();
                return;
            }
            state.apiKey = key;
            GM_setValue(APIKEY_KEY, key);
            state.view = "build";
            setStatus("API key saved!", "success");
            render();
        };
        wrap.appendChild(saveBtn);
        return wrap;
    }

    // ─────────────────────────────────────────────
    // BUILD VIEW
    // ─────────────────────────────────────────────
    function buildBuildView() {
        const wrap = div({ padding: "14px", display: "flex", flexDirection: "column", gap: "0" });

        // ── TYPE SELECTOR ──
        const typeCard = card({ marginBottom: "10px" });
        typeCard.appendChild(sectionHeader("What are you creating?"));

        const typeRow = div({ display: "flex", gap: "8px" });

        ["page", "assignment"].forEach(type => {
            const active = state.contentType === type;
            const typeBtn = el("button", {
                flex: "1", padding: "12px", borderRadius: "10px",
                border: `2px solid ${active ? "#7c3aed" : "#e5e7eb"}`,
                background: active ? "#f5f3ff" : "#f9fafb",
                cursor: "pointer", fontWeight: "600", fontSize: "13px",
                color: active ? "#7c3aed" : "#6b7280",
                transition: "all 0.15s"
            }, {
                innerHTML: type === "page"
                    ? `<div style="font-size:20px;margin-bottom:4px">📄</div>Canvas Page`
                    : `<div style="font-size:20px;margin-bottom:4px">📝</div>Assignment`
            });
            typeBtn.onclick = () => { state.contentType = type; render(); };
            typeRow.appendChild(typeBtn);
        });

        typeCard.appendChild(typeRow);
        wrap.appendChild(typeCard);

        // ── PAGE OPTIONS ──
        if (state.contentType === "page") {
            const pageCard = card({ marginBottom: "10px" });
            pageCard.appendChild(sectionHeader("Page Style"));

            // Theme picker
            const themeGrid = div({
                display: "grid", gridTemplateColumns: "1fr 1fr",
                gap: "6px", marginBottom: "12px"
            });

            Object.entries(THEMES).forEach(([key, theme]) => {
                const active = state.pageStyle === key;
                const themeBtn = el("button", {
                    padding: "8px 10px", borderRadius: "8px",
                    border: `2px solid ${active ? "#7c3aed" : "#e5e7eb"}`,
                    background: active ? "#f5f3ff" : "#f9fafb",
                    cursor: "pointer", fontSize: "12px", fontWeight: "500",
                    color: active ? "#7c3aed" : "#374151",
                    textAlign: "left", transition: "all 0.15s"
                }, { textContent: theme.name });
                themeBtn.onclick = () => { state.pageStyle = key; render(); };
                themeGrid.appendChild(themeBtn);
            });

            pageCard.appendChild(themeGrid);

            // Custom color if school colors selected
            if (state.pageStyle === "custom") {
                const colorRow = div({ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" });
                colorRow.appendChild(div({ fontSize: "13px", color: "#374151" }, { textContent: "Primary color:" }));
                const colorInput = el("input", { width: "50px", height: "30px", borderRadius: "6px", border: "1px solid #d1d5db", cursor: "pointer" });
                colorInput.type = "color";
                colorInput.value = state.customColor;
                colorInput.oninput = () => { state.customColor = colorInput.value; };
                colorRow.appendChild(colorInput);
                pageCard.appendChild(colorRow);
            }

            pageCard.appendChild(sectionHeader("Design Elements"));

            const elementLabels = {
                emojiIcons:        ["Emoji Icons",        "Add relevant emojis to section headers"],
                sectionDividers:   ["Section Dividers",   "Visual breaks between sections"],
                tipBoxes:          ["Tip / Reminder Boxes","Highlighted boxes for important info"],
                imagePlaceholders: ["Image Placeholders", "Boxes where images can be inserted"],
                collapsible:       ["Collapsible Sections","Click-to-expand content areas"],
                quoteBoxes:        ["Quote / Highlight",  "Styled callout boxes"],
                alertBoxes:        ["Warning / Alert Boxes","Red/yellow alert boxes"],
            };

            Object.entries(elementLabels).forEach(([key, [label, desc]]) => {
                pageCard.appendChild(toggle(
                    label, state.pageElements[key],
                    val => { state.pageElements[key] = val; },
                    desc
                ));
            });

            wrap.appendChild(pageCard);
        }

        // ── ASSIGNMENT OPTIONS ──
        if (state.contentType === "assignment") {
            const assignCard = card({ marginBottom: "10px" });
            assignCard.appendChild(sectionHeader("Assignment Style"));

            // Theme picker (same themes, different use)
            const themeGrid = div({
                display: "grid", gridTemplateColumns: "1fr 1fr",
                gap: "6px", marginBottom: "12px"
            });

            Object.entries(THEMES).forEach(([key, theme]) => {
                const active = state.pageStyle === key;
                const themeBtn = el("button", {
                    padding: "8px 10px", borderRadius: "8px",
                    border: `2px solid ${active ? "#7c3aed" : "#e5e7eb"}`,
                    background: active ? "#f5f3ff" : "#f9fafb",
                    cursor: "pointer", fontSize: "12px", fontWeight: "500",
                    color: active ? "#7c3aed" : "#374151",
                    textAlign: "left"
                }, { textContent: theme.name });
                themeBtn.onclick = () => { state.pageStyle = key; render(); };
                themeGrid.appendChild(themeBtn);
            });
            assignCard.appendChild(themeGrid);

            assignCard.appendChild(sectionHeader("Assignment Elements"));

            const elementLabels = {
                numberedSteps: ["Numbered Steps",           "Step-by-step directions"],
                checklist:     ["Checklist",                "Checkbox list students can follow"],
                rubricTable:   ["Rubric Table",             "Grading criteria table"],
                pointValue:    ["Point Value",              "Show total points"],
                dueDate:       ["Due Date",                 "Show due date prominently"],
                videoEmbed:    ["Video Embed Placeholder",  "Box for a YouTube/video link"],
                watchFirst:    ["Watch Before You Begin",   "Video reminder at the top"],
            };

            Object.entries(elementLabels).forEach(([key, [label, desc]]) => {
                assignCard.appendChild(toggle(
                    label, state.assignmentElements[key],
                    val => { state.assignmentElements[key] = val; },
                    desc
                ));
            });

            // Point value + due date inputs
            if (state.assignmentElements.pointValue) {
                const ptRow = div({ display: "flex", alignItems: "center", gap: "8px", marginTop: "8px" });
                ptRow.appendChild(div({ fontSize: "13px", color: "#374151", whiteSpace: "nowrap" }, { textContent: "Points:" }));
                const ptInput = el("input", {
                    flex: "1", padding: "7px 10px", borderRadius: "8px",
                    border: "1px solid #d1d5db", fontSize: "13px", boxSizing: "border-box"
                }, { type: "number", placeholder: "100", value: state.pointValue });
                ptInput.oninput = () => { state.pointValue = ptInput.value; };
                ptRow.appendChild(ptInput);
                assignCard.appendChild(ptRow);
            }

            if (state.assignmentElements.dueDate) {
                const dateRow = div({ display: "flex", alignItems: "center", gap: "8px", marginTop: "8px" });
                dateRow.appendChild(div({ fontSize: "13px", color: "#374151", whiteSpace: "nowrap" }, { textContent: "Due Date:" }));
                const dateInput = el("input", {
                    flex: "1", padding: "7px 10px", borderRadius: "8px",
                    border: "1px solid #d1d5db", fontSize: "13px", boxSizing: "border-box"
                }, { type: "date", value: state.dueDate });
                dateInput.oninput = () => { state.dueDate = dateInput.value; };
                dateRow.appendChild(dateInput);
                assignCard.appendChild(dateRow);
            }

            wrap.appendChild(assignCard);
        }

        // ── CONTENT INPUT ──
        const contentCard = card({ marginBottom: "10px" });
        contentCard.appendChild(sectionHeader("Content"));

        // File upload
        const uploadRow = div({ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" });

        const fileChip = div({
            flex: "1", padding: "8px 12px", borderRadius: "8px",
            border: "1px dashed #94a3b8",
            background: state.uploadedName ? "#eff6ff" : "#f9fafb",
            fontSize: "12px",
            color: state.uploadedName ? "#1d4ed8" : "#6b7280",
            textAlign: "center", boxSizing: "border-box",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
        }, { textContent: state.uploadedName ? `📎 ${state.uploadedName}` : "No file selected" });

        uploadRow.appendChild(fileChip);

        const uploadBtn = btn("📁 Upload", "#64748b", "#fff", { padding: "8px 12px", fontSize: "12px", flexShrink: "0" });
        uploadBtn.onclick = () => {
            document.getElementById("cb-file-input")?.remove();
            const fileInput = document.createElement("input");
            fileInput.id = "cb-file-input";
            fileInput.type = "file";
            fileInput.accept = ".txt,.pdf,.doc,.docx,.csv,.md";
            fileInput.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0;";

            fileInput.onchange = () => {
                const file = fileInput.files[0];
                fileInput.remove();
                if (!file) return;

                const ext = file.name.split(".").pop().toLowerCase();
                const reader = new FileReader();

                reader.onload = e => {
                    state.uploadedFile = e.target.result;
                    state.uploadedName = file.name;
                    setStatus(`✓ File loaded: ${file.name}`, "success");
                    render();
                };
                reader.onerror = () => { setStatus("Failed to read file", "error"); render(); };
                reader.readAsText(file);
            };

            document.body.appendChild(fileInput);
            fileInput.click();
        };
        uploadRow.appendChild(uploadBtn);

        if (state.uploadedName) {
            const clearBtn = btn("✕", "#ef4444", "#fff", { padding: "6px 10px", fontSize: "12px" });
            clearBtn.onclick = () => { state.uploadedFile = ""; state.uploadedName = ""; render(); };
            uploadRow.appendChild(clearBtn);
        }

        contentCard.appendChild(uploadRow);

        // Text area
        contentCard.appendChild(div({
            fontSize: "12px", color: "#6b7280", marginBottom: "6px"
        }, { textContent: "Paste content, notes, or describe what you want:" }));

        const textArea = el("textarea", {
            width: "100%", minHeight: "120px", resize: "vertical",
            padding: "10px", borderRadius: "8px",
            border: "1px solid #d1d5db", fontSize: "13px",
            boxSizing: "border-box", fontFamily: "Inter, system-ui, Arial",
            lineHeight: "1.5", background: "#f9fafb"
        }, { placeholder: "Example: This is a lesson on the Civil War. Include key dates, causes, and effects. Use the uploaded document as the main content source…", value: state.textContent });

        textArea.oninput = () => { state.textContent = textArea.value; };
        contentCard.appendChild(textArea);
        wrap.appendChild(contentCard);

        // ── GENERATE BUTTON ──
        const generateBtn = btn(
            state.contentType === "page" ? "✦ Generate Canvas Page" : "✦ Generate Assignment",
            "#7c3aed", "#fff", {
                width: "100%", boxSizing: "border-box",
                padding: "14px", fontSize: "15px",
                boxShadow: "0 4px 14px rgba(124,58,237,0.35)",
                marginBottom: "6px"
            }
        );
        generateBtn.onclick = handleGenerate;
        wrap.appendChild(generateBtn);

        // Last result button
        if (state.generatedHTML) {
            const viewResultBtn = btn("View Last Result →", "#e2e8f0", "#374151", {
                width: "100%", boxSizing: "border-box", fontSize: "13px"
            });
            viewResultBtn.onclick = () => { state.view = "result"; render(); };
            wrap.appendChild(viewResultBtn);
        }

        return wrap;
    }

    // ─────────────────────────────────────────────
    // GENERATE HANDLER
    // ─────────────────────────────────────────────
    function handleGenerate() {
        if (!state.apiKey) {
            setStatus("No API key — go to ⚙ Settings first.", "error");
            render();
            return;
        }

        if (!state.textContent.trim() && !state.uploadedFile) {
            setStatus("Add some content or a file first.", "error");
            render();
            return;
        }

        setStatus("Claude is building your content…", "loading");
        render();

        const theme = state.pageStyle === "custom"
            ? { ...THEMES.custom, primary: state.customColor, secondary: state.customColor }
            : THEMES[state.pageStyle] || THEMES.pastel;

        const prompt = buildPrompt(theme);

        GM_xmlhttpRequest({
            method: "POST",
            url: "https://api.anthropic.com/v1/messages",
            headers: {
                "Content-Type":      "application/json",
                "x-api-key":         state.apiKey,
                "anthropic-version": "2023-06-01",
                "anthropic-dangerous-direct-browser-access": "true"
            },
            data: JSON.stringify({
                model:      AI_MODEL,
                max_tokens: 8096,
                messages:   [{ role: "user", content: prompt }]
            }),
            timeout: 90000,
            onload(response) {
                let data;
                try { data = JSON.parse(response.responseText); } catch {
                    setStatus("Invalid response from Claude.", "error");
                    render();
                    return;
                }

                if (response.status !== 200) {
                    setStatus(`Claude error: ${data?.error?.message || "HTTP " + response.status}`, "error");
                    render();
                    return;
                }

                let raw = data?.content?.[0]?.text || "";
                // Strip markdown code fences
                raw = raw.replace(/```html/gi, "").replace(/```/g, "").trim();

                state.generatedHTML    = raw;
                state.generatedPreview = raw;
                state.view             = "result";
                setStatus("Content generated!", "success");
                render();
            },
            onerror()   { setStatus("Network error — check your connection.", "error"); render(); },
            ontimeout() { setStatus("Timed out — try with less content.", "error"); render(); }
        });
    }

    // ─────────────────────────────────────────────
    // PROMPT BUILDER
    // ─────────────────────────────────────────────
    function buildPrompt(theme) {
        const isPage       = state.contentType === "page";
        const elements     = isPage ? state.pageElements : state.assignmentElements;

        let prompt = "";

        prompt += `You are an expert Canvas LMS content designer. `;
        prompt += `Generate professional, visually beautiful HTML that can be pasted directly into a Canvas ${isPage ? "page" : "assignment"} editor.\n\n`;

        prompt += `═══════════════════════════════\n`;
        prompt += `DESIGN REQUIREMENTS\n`;
        prompt += `═══════════════════════════════\n`;
        prompt += `Type: Canvas ${isPage ? "Page" : "Assignment"}\n`;
        prompt += `Color Theme: ${THEMES[state.pageStyle]?.name || "Pastel"}\n`;
        prompt += `Primary Color: ${theme.primary}\n`;
        prompt += `Secondary Color: ${theme.secondary}\n`;
        prompt += `Background Color: ${theme.bg}\n`;
        prompt += `Header Background: ${theme.headerBg}\n`;
        prompt += `Accent Color: ${theme.accent}\n`;
        prompt += `Text Color: ${theme.text}\n`;
        prompt += `Card Background: ${theme.cardBg}\n`;
        prompt += `Border Color: ${theme.border}\n\n`;

        prompt += `═══════════════════════════════\n`;
        prompt += `ELEMENTS TO INCLUDE\n`;
        prompt += `═══════════════════════════════\n`;

        if (isPage) {
            if (elements.emojiIcons)        prompt += `✓ Add relevant emojis to all section headers\n`;
            if (elements.sectionDividers)   prompt += `✓ Include styled horizontal dividers between sections\n`;
            if (elements.tipBoxes)          prompt += `✓ Include tip/reminder boxes with a lightbulb icon for important info\n`;
            if (elements.imagePlaceholders) prompt += `✓ Include placeholder boxes where images can be inserted (styled grey boxes with image icon and caption)\n`;
            if (elements.collapsible)       prompt += `✓ Include collapsible sections using HTML details/summary tags\n`;
            if (elements.quoteBoxes)        prompt += `✓ Include styled quote/highlight callout boxes\n`;
            if (elements.alertBoxes)        prompt += `✓ Include warning/alert boxes with ⚠️ icon for important warnings\n`;
        } else {
            if (elements.watchFirst)        prompt += `✓ Include a "📺 Watch Before You Begin" section at the top with a video placeholder\n`;
            if (elements.numberedSteps)     prompt += `✓ Format all directions as clearly numbered steps\n`;
            if (elements.checklist)         prompt += `✓ Include a student checklist with HTML checkboxes\n`;
            if (elements.rubricTable)       prompt += `✓ Include a styled rubric/grading criteria table\n`;
            if (elements.videoEmbed)        prompt += `✓ Include a video embed placeholder box\n`;
            if (elements.pointValue && state.pointValue) prompt += `✓ Show total points: ${state.pointValue} points\n`;
            if (elements.dueDate && state.dueDate)       prompt += `✓ Show due date prominently: ${state.dueDate}\n`;
        }

        prompt += `\n`;

        prompt += `═══════════════════════════════\n`;
        prompt += `CONTENT TO USE\n`;
        prompt += `═══════════════════════════════\n`;

        if (state.textContent.trim()) {
            prompt += `User Provided Content:\n${state.textContent}\n\n`;
        }

        if (state.uploadedFile) {
            prompt += `Uploaded File Content (${state.uploadedName}):\n${state.uploadedFile}\n\n`;
        }

        prompt += `═══════════════════════════════\n`;
        prompt += `HTML REQUIREMENTS\n`;
        prompt += `═══════════════════════════════\n`;
        prompt += `- Return ONLY the HTML — no explanations, no markdown, no preamble\n`;
        prompt += `- Use only inline CSS styles (no external stylesheets, no <style> tags, no <head> or <body> tags)\n`;
        prompt += `- All CSS must be inline on each element\n`;
        prompt += `- Start with a beautiful styled header/banner using the theme colors\n`;
        prompt += `- Use the exact colors provided above throughout\n`;
        prompt += `- Make it visually professional and engaging for students\n`;
        prompt += `- Use proper HTML structure with divs, tables, lists as needed\n`;
        prompt += `- Include all the elements listed above\n`;
        prompt += `- Make sure fonts are web-safe (Georgia, Arial, Verdana, etc.)\n`;
        prompt += `- Do NOT use JavaScript — Canvas strips it out\n`;
        prompt += `- Do NOT use external images — use CSS styled placeholder boxes instead\n`;
        prompt += `- The HTML should be ready to paste directly into Canvas Rich Content Editor\n`;

        return prompt;
    }

    // ─────────────────────────────────────────────
    // RESULT VIEW
    // ─────────────────────────────────────────────
    function buildResultView() {
        const wrap = div({ display: "flex", flexDirection: "column", height: "100%" });

        // ── PREVIEW TOGGLE ──
        const tabRow = div({
            display: "flex", borderBottom: "1px solid #e5e7eb",
            background: "#fff", flexShrink: "0"
        });

        let showPreview = true;

        const previewTab = el("button", {
            flex: "1", padding: "10px", border: "none", borderBottom: "2px solid #7c3aed",
            background: "#fff", cursor: "pointer", fontSize: "13px",
            fontWeight: "700", color: "#7c3aed"
        }, { textContent: "👁 Preview" });

        const codeTab = el("button", {
            flex: "1", padding: "10px", border: "none", borderBottom: "2px solid transparent",
            background: "#f9fafb", cursor: "pointer", fontSize: "13px",
            fontWeight: "500", color: "#6b7280"
        }, { textContent: "< > HTML Code" });

        const previewFrame = el("iframe", {
            flex: "1", border: "none", background: "#fff"
        });
        previewFrame.srcdoc = state.generatedPreview || "<p>No content generated.</p>";

        const codeBox = el("textarea", {
            flex: "1", padding: "12px", fontFamily: "Consolas, monospace",
            fontSize: "11px", border: "none", resize: "none",
            background: "#1e293b", color: "#e2e8f0",
            lineHeight: "1.6", display: "none"
        }, { value: state.generatedHTML, readOnly: true });

        previewTab.onclick = () => {
            showPreview = true;
            previewFrame.style.display = "block";
            codeBox.style.display = "none";
            previewTab.style.borderBottomColor = "#7c3aed";
            previewTab.style.color = "#7c3aed";
            previewTab.style.fontWeight = "700";
            previewTab.style.background = "#fff";
            codeTab.style.borderBottomColor = "transparent";
            codeTab.style.color = "#6b7280";
            codeTab.style.fontWeight = "500";
            codeTab.style.background = "#f9fafb";
        };

        codeTab.onclick = () => {
            showPreview = false;
            previewFrame.style.display = "none";
            codeBox.style.display = "block";
            codeTab.style.borderBottomColor = "#7c3aed";
            codeTab.style.color = "#7c3aed";
            codeTab.style.fontWeight = "700";
            codeTab.style.background = "#fff";
            previewTab.style.borderBottomColor = "transparent";
            previewTab.style.color = "#6b7280";
            previewTab.style.fontWeight = "500";
            previewTab.style.background = "#f9fafb";
        };

        tabRow.appendChild(previewTab);
        tabRow.appendChild(codeTab);
        wrap.appendChild(tabRow);

        // Content area
        const contentArea = div({ flex: "1", display: "flex", flexDirection: "column", overflow: "hidden" });
        contentArea.appendChild(previewFrame);
        contentArea.appendChild(codeBox);
        wrap.appendChild(contentArea);

        // ── ACTIONS ──
        const actions = div({
            padding: "12px 14px", borderTop: "1px solid #e5e7eb",
            background: "#f8fafc", display: "flex",
            flexDirection: "column", gap: "8px", flexShrink: "0"
        });

        const copyBtn = btn("📋 Copy HTML for Canvas", "#7c3aed", "#fff", {
            width: "100%", boxSizing: "border-box", padding: "12px"
        });
        copyBtn.onclick = () => {
            navigator.clipboard.writeText(state.generatedHTML).then(() => {
                setStatus("✓ HTML copied! Paste into Canvas Rich Content Editor → HTML view.", "success");
                render();
            });
        };
        actions.appendChild(copyBtn);

        const howTo = div({
            padding: "10px 12px", borderRadius: "8px",
            background: "#fffbeb", border: "1px solid #fde68a",
            fontSize: "12px", color: "#92400e", lineHeight: "1.6"
        }, { innerHTML: `<strong>How to paste into Canvas:</strong><br>
            1. Open your Canvas page or assignment editor<br>
            2. Click the <strong>&lt;/&gt;</strong> HTML button in the toolbar<br>
            3. Select all existing code and delete it<br>
            4. Paste the copied HTML<br>
            5. Click <strong>Done</strong> to see the result` });
        actions.appendChild(howTo);

        const rebuildBtn = btn("← Rebuild / Change Options", "#e2e8f0", "#374151", {
            width: "100%", boxSizing: "border-box", fontSize: "12px", padding: "9px"
        });
        rebuildBtn.onclick = () => { state.view = "build"; setStatus("", "idle"); render(); };
        actions.appendChild(rebuildBtn);

        wrap.appendChild(actions);
        return wrap;
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
                id:          "content-builder",
                name:        "Content Builder",
                icon:        "📄",
                description: "Generate Canvas page & assignment HTML with AI",
                color:       "#16a085",
                run:         togglePanel
            });
        } else {
            setTimeout(tryRegister, 100);
        }
    })();


})();
