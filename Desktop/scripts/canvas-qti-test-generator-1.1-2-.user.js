// ==UserScript==
// @name         Canvas QTI Test Generator
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  AI-powered QTI quiz generator for Canvas LMS
// @match        https://*.instructure.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      api.anthropic.com
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/MarkAlanBrest/scripts/main/Canvas%20QTI%20Test%20Generator-1.1%20(2).user.js
// @updateURL    https://raw.githubusercontent.com/MarkAlanBrest/scripts/main/Canvas%20QTI%20Test%20Generator-1.1%20(2).user.js
// ==/UserScript==

(function () {
    "use strict";

    if (window.__CANVAS_QTI_GENERATOR__) return;
    window.__CANVAS_QTI_GENERATOR__ = true;

    // ─────────────────────────────────────────────
    // CONSTANTS
    // ─────────────────────────────────────────────
    const APIKEY_KEY  = "AIgrader_APIKey";
    const PANEL_WIDTH = "480px";
const AI_MODEL = "claude-haiku-4-5-20251001";
    // ─────────────────────────────────────────────
    // STATE
    // ─────────────────────────────────────────────
    let panelInjected = false;
    let panel = null;

    const state = {
        view:       "build",    // "build" | "preview" | "setup"
        status:     "",
        statusType: "idle",

        // The only settings that matter
        quizTitle:  "My Quiz",
        difficulty: "medium",   // easy | medium | hard

        // Question counts
        mcCount:    5,
        tfCount:    3,
        saCount:    2,
        essayCount: 0,

        // Content
        textContent:  "",
        uploadedFile: "",
        uploadedName: "",

        // Results
        generatedQuestions: null,
        apiKey: GM_getValue(APIKEY_KEY, ""),
    };

    // DOK level mapping
    const DOK_MAP = {
        easy:   { levels: [1, 2], label: "Easy (DOK 1–2)", desc: "Recall & basic concepts" },
        medium: { levels: [2, 3], label: "Medium (DOK 2–3)", desc: "Apply & analyze" },
        hard:   { levels: [3, 4], label: "Hard (DOK 3–4)", desc: "Strategic & extended thinking" }
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

    function statusBorder(type) {
        return { success: "#86efac", error: "#fca5a5", loading: "#bfdbfe", idle: "#e5e7eb" }[type] || "#e5e7eb";
    }

    function sectionLabel(text) {
        return div({
            fontSize: "11px", fontWeight: "700", color: "#6b7280",
            textTransform: "uppercase", letterSpacing: "0.06em",
            padding: "14px 0 8px"
        }, { textContent: text });
    }

    function card(children = [], extraStyles = {}) {
        const c = div({
            background: "#fff", border: "1px solid #e5e7eb",
            borderRadius: "10px", padding: "14px",
            boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
            marginBottom: "10px", ...extraStyles
        });
        children.forEach(child => c.appendChild(child));
        return c;
    }

    function inputRow(label, inputEl, hint = "") {
        const wrap = div({ marginBottom: "10px" });
        wrap.appendChild(div({ fontSize: "13px", fontWeight: "500", color: "#374151", marginBottom: "4px" }, { textContent: label }));
        wrap.appendChild(inputEl);
        if (hint) wrap.appendChild(div({ fontSize: "11px", color: "#9ca3af", marginTop: "3px" }, { textContent: hint }));
        return wrap;
    }

    function numberInput(value, min, max, onChange) {
        const inp = el("input", {
            width: "70px", padding: "7px 10px", borderRadius: "8px",
            border: "1px solid #d1d5db", fontSize: "13px",
            boxSizing: "border-box", textAlign: "center"
        }, { type: "number", min: String(min), max: String(max), value: String(value) });
        inp.oninput = () => onChange(Math.max(min, Math.min(max, parseInt(inp.value) || 0)));
        return inp;
    }

    function textInput(value, placeholder, onChange, extraStyles = {}) {
        const inp = el("input", {
            width: "100%", padding: "8px 10px", borderRadius: "8px",
            border: "1px solid #d1d5db", fontSize: "13px",
            boxSizing: "border-box", background: "#f9fafb", ...extraStyles
        }, { value, placeholder });
        inp.oninput = () => onChange(inp.value);
        return inp;
    }

    function toggleSwitch(checked, onChange) {
        let val = checked;
        const wrap = div({
            width: "40px", height: "22px", borderRadius: "11px",
            background: val ? "#2563eb" : "#d1d5db",
            position: "relative", cursor: "pointer",
            transition: "background 0.2s", flexShrink: "0"
        });
        const knob = div({
            position: "absolute", top: "3px",
            left: val ? "21px" : "3px",
            width: "16px", height: "16px",
            borderRadius: "50%", background: "#fff",
            transition: "left 0.2s",
            boxShadow: "0 1px 3px rgba(0,0,0,0.2)"
        });
        wrap.appendChild(knob);
        wrap.onclick = () => {
            val = !val;
            wrap.style.background = val ? "#2563eb" : "#d1d5db";
            knob.style.left = val ? "21px" : "3px";
            onChange(val);
        };
        return wrap;
    }

    function settingRow(label, control, desc = "") {
        const row = div({
            display: "flex", alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 0", borderBottom: "1px solid #f1f5f9"
        });
        const left = div({ display: "flex", flexDirection: "column", gap: "2px" });
        left.appendChild(div({ fontSize: "13px", fontWeight: "500", color: "#111827" }, { textContent: label }));
        if (desc) left.appendChild(div({ fontSize: "11px", color: "#9ca3af" }, { textContent: desc }));
        row.appendChild(left);
        row.appendChild(control);
        return row;
    }

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
            background: "#f0fdf9", borderLeft: "1px solid #ccfbf1",
            zIndex: "999996", display: "flex", flexDirection: "column",
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

        if      (state.view === "setup")   content.appendChild(buildSetupView());
        else if (state.view === "build")   content.appendChild(buildBuildView());
        else if (state.view === "preview") content.appendChild(buildPreviewView());

        panel.appendChild(content);

        if (state.status) {
            panel.appendChild(div({
                padding: "10px 14px", fontSize: "13px", fontWeight: "500",
                borderTop: `1px solid ${statusBorder(state.statusType)}`,
                background: statusBg(state.statusType),
                color: statusColor(state.statusType),
                flexShrink: "0", textAlign: "center"
            }, { textContent: state.status }));
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
            background: "#134e4a", color: "#fff", flexShrink: "0"
        });

        const left = div({ display: "flex", alignItems: "center", gap: "10px" });
        const logo = div({
            width: "30px", height: "30px", borderRadius: "8px",
            background: "#0f766e", display: "flex",
            alignItems: "center", justifyContent: "center", fontSize: "16px"
        }, { textContent: "📝" });
        const title = div({ fontWeight: "700", fontSize: "15px" }, {
            textContent: state.view === "setup"   ? "API Setup"
                       : state.view === "preview" ? "Test Preview"
                       : "QTI Test Generator"
        });
        left.appendChild(logo);
        left.appendChild(title);
        bar.appendChild(left);

        const right = div({ display: "flex", alignItems: "center", gap: "8px" });
        if (state.view !== "setup") {
            right.appendChild(navTab("Build",   state.view === "build",   () => { state.view = "build";   render(); }));
            if (state.generatedQuestions) {
                right.appendChild(navTab("Preview", state.view === "preview", () => { state.view = "preview"; render(); }));
            }
            right.appendChild(navTab("⚙", false, () => { state.view = "setup"; render(); }));
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
            background: active ? "#0f766e" : "rgba(255,255,255,0.1)",
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
            background: "#f0fdf4", border: "1px solid #86efac",
            borderRadius: "10px", padding: "14px",
            fontSize: "13px", lineHeight: "1.6", color: "#166534"
        }, { innerHTML: `<strong>Shared API Key</strong><br>This uses the same Anthropic API key as AI Grader and Content Builder. If you already set it up, just click Save.` }));

        const keyInput = el("input", {
            padding: "10px 12px", borderRadius: "8px",
            border: "1px solid #d1d5db", fontSize: "13px",
            width: "100%", boxSizing: "border-box",
            fontFamily: "monospace", background: "#fff"
        }, { type: "password", placeholder: "sk-ant-api03-…", value: state.apiKey || "" });

        wrap.appendChild(keyInput);

        const saveBtn = btn("Save & Start Building", "#0f766e", "#fff", { width: "100%", boxSizing: "border-box" });
        saveBtn.onclick = () => {
            const key = keyInput.value.trim();
            if (!key.startsWith("sk-ant-")) {
                setStatus("Invalid key — should start with sk-ant-", "error");
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
        const wrap = div({ padding: "14px" });

        // ── QUIZ SETTINGS ──
        wrap.appendChild(sectionLabel("Quiz Settings"));
        const settingsCard = card();

        // Title
        settingsCard.appendChild(inputRow(
            "Quiz Title",
            textInput(state.quizTitle, "Enter quiz title…", val => { state.quizTitle = val; })
        ));

        // Difficulty
        settingsCard.appendChild(div({ fontSize: "13px", fontWeight: "500", color: "#374151", marginBottom: "6px" }, { textContent: "Difficulty Level" }));
        const diffRow = div({ display: "flex", gap: "6px", marginBottom: "4px" });

        ["easy", "medium", "hard"].forEach(level => {
            const dok    = DOK_MAP[level];
            const active = state.difficulty === level;
            const colors = { easy: "#166534", medium: "#92400e", hard: "#991b1b" };
            const bgs    = { easy: "#f0fdf4", medium: "#fffbeb", hard: "#fef2f2" };

            const b = el("button", {
                flex: "1", padding: "10px 6px", borderRadius: "10px",
                border: `2px solid ${active ? colors[level] : "#e5e7eb"}`,
                background: active ? bgs[level] : "#f9fafb",
                cursor: "pointer", textAlign: "center",
                transition: "all 0.15s"
            });
            b.innerHTML = `<div style="font-size:18px;margin-bottom:2px">${level === "easy" ? "🟢" : level === "medium" ? "🟡" : "🔴"}</div>
                <div style="font-size:12px;font-weight:700;color:${active ? colors[level] : "#6b7280"}">${dok.label.split("(")[0].trim()}</div>
                <div style="font-size:10px;color:#9ca3af">${dok.desc}</div>`;
            b.onclick = () => { state.difficulty = level; render(); };
            diffRow.appendChild(b);
        });
        settingsCard.appendChild(diffRow);

        settingsCard.appendChild(div({
            fontSize: "11px", color: "#9ca3af", marginBottom: "4px", textAlign: "center"
        }, { textContent: "All other quiz settings (time limit, attempts, shuffle, etc.) can be set inside Canvas after import" }));

        wrap.appendChild(settingsCard);

        // ── QUESTION MIX ──
        wrap.appendChild(sectionLabel("Question Mix"));

        const totalQ = state.mcCount + state.tfCount + state.saCount + state.essayCount;
        const totalVersions = totalQ * 3;

        const mixCard = card();

        const qTypes = [
            { key: "mcCount",    label: "Multiple Choice", icon: "🔘", color: "#2563eb" },
            { key: "tfCount",    label: "True / False",    icon: "✅", color: "#16a34a" },
            { key: "saCount",    label: "Short Answer",    icon: "✏️", color: "#d97706" },
            { key: "essayCount", label: "Essay",           icon: "📄", color: "#9333ea" },
        ];

        qTypes.forEach(qt => {
            const row = div({
                display: "flex", alignItems: "center", gap: "10px",
                padding: "10px 0", borderBottom: "1px solid #f1f5f9"
            });

            const labelWrap = div({ flex: "1" });
            labelWrap.appendChild(div({
                fontSize: "13px", fontWeight: "600", color: "#111827"
            }, { textContent: `${qt.icon} ${qt.label}` }));
            labelWrap.appendChild(div({
                fontSize: "11px", color: "#9ca3af"
            }, { textContent: state[qt.key] > 0 ? `${state[qt.key] * 3} versions will be generated` : "Not included" }));
            row.appendChild(labelWrap);

            // Count input
            const countWrap = div({ display: "flex", flexDirection: "column", alignItems: "center", gap: "2px" });
            countWrap.appendChild(div({ fontSize: "10px", color: "#9ca3af", textAlign: "center" }, { textContent: "Questions" }));
            countWrap.appendChild(numberInput(state[qt.key], 0, 20, v => { state[qt.key] = v; render(); }));
            row.appendChild(countWrap);

            // Points removed — set inside Canvas after import

            mixCard.appendChild(row);
        });

        // Summary
        mixCard.appendChild(div({
            marginTop: "10px", padding: "10px", borderRadius: "8px",
            background: "#f0fdf4", border: "1px solid #86efac",
            fontSize: "13px", color: "#166534", fontWeight: "600"
        }, { textContent: `${totalQ} questions on test  •  ${totalVersions} total versions generated (3 per question)` }));

        wrap.appendChild(mixCard);

        // ── CONTENT ──
        wrap.appendChild(sectionLabel("Content"));
        const contentCard = card();

        // File upload
        const uploadRow = div({ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" });

        const fileChip = div({
            flex: "1", padding: "8px 12px", borderRadius: "8px",
            border: "1px dashed #94a3b8",
            background: state.uploadedName ? "#f0fdf4" : "#f9fafb",
            fontSize: "12px",
            color: state.uploadedName ? "#166534" : "#6b7280",
            textAlign: "center", overflow: "hidden",
            textOverflow: "ellipsis", whiteSpace: "nowrap"
        }, { textContent: state.uploadedName ? `📎 ${state.uploadedName}` : "No file selected" });

        uploadRow.appendChild(fileChip);

        const uploadBtn = btn("📁 Upload", "#64748b", "#fff", { padding: "8px 12px", fontSize: "12px", flexShrink: "0" });
        uploadBtn.onclick = () => {
            document.getElementById("qti-file-input")?.remove();
            const fileInput = document.createElement("input");
            fileInput.id = "qti-file-input";
            fileInput.type = "file";
            fileInput.accept = ".txt,.pdf,.doc,.docx,.csv,.md";
            fileInput.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0;";
            fileInput.onchange = () => {
                const file = fileInput.files[0];
                fileInput.remove();
                if (!file) return;
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

        contentCard.appendChild(div({
            fontSize: "12px", color: "#6b7280", marginBottom: "6px"
        }, { textContent: "Paste content, topic notes, or your own questions:" }));

        const textArea = el("textarea", {
            width: "100%", minHeight: "130px", resize: "vertical",
            padding: "10px", borderRadius: "8px",
            border: "1px solid #d1d5db", fontSize: "13px",
            boxSizing: "border-box", fontFamily: "Inter, system-ui, Arial",
            lineHeight: "1.5", background: "#f9fafb"
        }, {
            placeholder: "Example: Chapter 5 — The Civil War. Cover causes, key battles, and the aftermath.\n\nOR paste your own questions here and Claude will create 3 versions of each.",
            value: state.textContent
        });
        textArea.oninput = () => { state.textContent = textArea.value; };
        contentCard.appendChild(textArea);
        wrap.appendChild(contentCard);

        // ── GENERATE ──
        const totalQCheck = state.mcCount + state.tfCount + state.saCount + state.essayCount;
        const generateBtn = btn(
            totalQCheck === 0 ? "Add some questions first" : `✦ Generate ${totalVersions} Questions with Claude`,
            totalQCheck === 0 ? "#94a3b8" : "#0f766e", "#fff", {
                width: "100%", boxSizing: "border-box",
                padding: "14px", fontSize: "14px",
                boxShadow: totalQCheck > 0 ? "0 4px 14px rgba(15,118,110,0.35)" : "none",
                marginBottom: "6px", cursor: totalQCheck === 0 ? "not-allowed" : "pointer"
            }
        );

        if (totalQCheck > 0) generateBtn.onclick = handleGenerate;
        wrap.appendChild(generateBtn);

        wrap.appendChild(div({
            fontSize: "12px", color: "#9ca3af", textAlign: "center", marginBottom: "14px"
        }, { textContent: `Claude will generate ${totalVersions} questions (3 versions × ${totalQCheck} questions) — this may take 15–30 seconds` }));

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

        const totalQ = state.mcCount + state.tfCount + state.saCount + state.essayCount;
        if (totalQ === 0) {
            setStatus("Add at least one question type.", "error");
            render();
            return;
        }

        setStatus(`Generating ${totalQ * 3} questions… this takes 15–30 seconds`, "loading");
        render();

        const prompt = buildPrompt();

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
                max_tokens: 8192,
                messages:   [{ role: "user", content: prompt }]
            }),
            timeout: 120000,
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
                raw = raw.replace(/```json/gi, "").replace(/```/g, "").trim();

                let parsed;
                try {
                    parsed = JSON.parse(raw);
                } catch (e) {
                    setStatus(`Could not parse Claude's response. Try again. (${e.message})`, "error");
                    render();
                    return;
                }

                state.generatedQuestions = parsed;
                state.view = "preview";
                setStatus("Questions generated! Review and download.", "success");
                render();
            },
            onerror()   { setStatus("Network error — check your connection.", "error"); render(); },
            ontimeout() { setStatus("Timed out — try fewer questions or less content.", "error"); render(); }
        });
    }

    // ─────────────────────────────────────────────
    // PROMPT BUILDER
    // ─────────────────────────────────────────────
    function buildPrompt() {
        const dok    = DOK_MAP[state.difficulty];
        let prompt   = "";

        prompt += `You are an expert educator creating a Canvas LMS quiz with randomized question groups.\n\n`;

        prompt += `═══════════════════════════════\n`;
        prompt += `QUIZ CONFIGURATION\n`;
        prompt += `═══════════════════════════════\n`;
        prompt += `Title: ${state.quizTitle}\n`;
        prompt += `Difficulty: ${dok.label} — ${dok.desc}\n`;
        prompt += `DOK Levels to use: ${dok.levels.join(" and ")}\n\n`;

        prompt += `QUESTION GROUPS NEEDED:\n`;
        if (state.mcCount > 0)    prompt += `- ${state.mcCount} Multiple Choice questions × 3 versions each = ${state.mcCount * 3} MC questions total\n`;
        if (state.tfCount > 0)    prompt += `- ${state.tfCount} True/False questions × 3 versions each = ${state.tfCount * 3} TF questions total\n`;
        if (state.saCount > 0)    prompt += `- ${state.saCount} Short Answer questions × 3 versions each = ${state.saCount * 3} SA questions total\n`;
        if (state.essayCount > 0) prompt += `- ${state.essayCount} Essay questions × 3 versions each = ${state.essayCount * 3} Essay questions total\n`;
        prompt += `\n`;

        prompt += `IMPORTANT — How groups work:\n`;
        prompt += `Each group has exactly 3 versions of the SAME concept but worded differently.\n`;
        prompt += `Canvas will randomly pick ONE version from each group per student.\n`;
        prompt += `All 3 versions must test the same concept at the same DOK level.\n\n`;

        prompt += `═══════════════════════════════\n`;
        prompt += `CONTENT TO USE\n`;
        prompt += `═══════════════════════════════\n`;

        if (state.textContent.trim()) prompt += `${state.textContent}\n\n`;
        if (state.uploadedFile)       prompt += `FILE CONTENT (${state.uploadedName}):\n${state.uploadedFile}\n\n`;

        prompt += `═══════════════════════════════\n`;
        prompt += `RESPONSE FORMAT\n`;
        prompt += `═══════════════════════════════\n`;
        prompt += `Return ONLY a valid JSON object — no explanations, no markdown.\n\n`;
        prompt += `{\n`;
        prompt += `  "quizTitle": "${state.quizTitle}",\n`;
        prompt += `  "groups": [\n`;
        prompt += `    {\n`;
        prompt += `      "groupNumber": 1,\n`;
        prompt += `      "type": "mc",\n`;
        prompt += `      "concept": "Brief description of what this group tests",\n`;
        prompt += `      "dokLevel": 1,\n`;
        prompt += `      "questions": [\n`;
        prompt += `        {\n`;
        prompt += `          "version": 1,\n`;
        prompt += `          "question": "Question text here?",\n`;
        prompt += `          "answers": [\n`;
        prompt += `            { "text": "Answer A", "correct": true },\n`;
        prompt += `            { "text": "Answer B", "correct": false },\n`;
        prompt += `            { "text": "Answer C", "correct": false },\n`;
        prompt += `            { "text": "Answer D", "correct": false }\n`;
        prompt += `          ]\n`;
        prompt += `        }\n`;
        prompt += `      ]\n`;
        prompt += `    }\n`;
        prompt += `  ]\n`;
        prompt += `}\n\n`;

        prompt += `RULES:\n`;
        prompt += `- MC questions must have exactly 4 answer choices with exactly 1 correct\n`;
        prompt += `- TF questions must have exactly 2 answers: "True" and "False"\n`;
        prompt += `- SA questions have no answers array — omit it\n`;
        prompt += `- Essay questions have no answers array — omit it\n`;
        prompt += `- Each group must have exactly 3 questions (versions)\n`;
        prompt += `- All 3 versions in a group test the same concept differently\n`;
        prompt += `- Distribute DOK levels: ${dok.levels[0]} and ${dok.levels[1]} evenly across groups\n`;
        prompt += `- JSON must be valid — no trailing commas, proper escaping\n`;

        return prompt;
    }

    // ─────────────────────────────────────────────
    // PREVIEW VIEW
    // ─────────────────────────────────────────────
    function buildPreviewView() {
        const wrap = div({ display: "flex", flexDirection: "column", height: "100%" });
        const data = state.generatedQuestions;

        if (!data || !data.groups) {
            wrap.appendChild(div({ padding: "20px", textAlign: "center", color: "#9ca3af" }, { textContent: "No questions generated yet." }));
            return wrap;
        }

        // Stats bar
        const stats = div({
            padding: "10px 14px", background: "#134e4a", color: "#fff",
            fontSize: "12px", display: "flex", gap: "16px", flexShrink: "0"
        });
        const totalGroups = data.groups.length;
        const totalVersions = data.groups.reduce((sum, g) => sum + (g.questions?.length || 0), 0);
        stats.appendChild(div({}, { textContent: `📊 ${totalGroups} groups • ${totalVersions} total questions` }));
        stats.appendChild(div({}, { textContent: `⚡ ${DOK_MAP[state.difficulty].label}` }));
        wrap.appendChild(stats);

        // Question list
        const list = div({ flex: "1", overflowY: "auto", padding: "12px 14px" });

        const typeColors = { mc: "#2563eb", tf: "#16a34a", sa: "#d97706", essay: "#9333ea" };
        const typeLabels = { mc: "Multiple Choice", tf: "True / False", sa: "Short Answer", essay: "Essay" };

        data.groups.forEach((group, gi) => {
            const groupCard = div({
                background: "#fff", border: "1px solid #e5e7eb",
                borderRadius: "10px", marginBottom: "12px",
                overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.05)"
            });

            // Group header
            const groupHeader = div({
                padding: "10px 14px",
                background: typeColors[group.type] || "#374151",
                display: "flex", alignItems: "center",
                justifyContent: "space-between"
            });

            groupHeader.appendChild(div({
                fontSize: "13px", fontWeight: "700", color: "#fff"
            }, { textContent: `Group ${gi + 1} — ${typeLabels[group.type] || group.type}` }));

            const badges = div({ display: "flex", gap: "6px" });
            badges.appendChild(div({
                padding: "2px 8px", borderRadius: "999px",
                background: "rgba(255,255,255,0.2)",
                fontSize: "11px", color: "#fff", fontWeight: "600"
            }, { textContent: `DOK ${group.dokLevel}` }));
            badges.appendChild(div({
                padding: "2px 8px", borderRadius: "999px",
                background: "rgba(255,255,255,0.2)",
                fontSize: "11px", color: "#fff"
            }, { textContent: `${group.questions?.length || 0} versions` }));
            groupHeader.appendChild(badges);
            groupCard.appendChild(groupHeader);

            // Concept
            if (group.concept) {
                groupCard.appendChild(div({
                    padding: "8px 14px", background: "#f8fafc",
                    fontSize: "12px", color: "#6b7280",
                    borderBottom: "1px solid #f1f5f9"
                }, { textContent: `Concept: ${group.concept}` }));
            }

            // Versions
            (group.questions || []).forEach((q, qi) => {
                const qBlock = div({
                    padding: "12px 14px",
                    borderBottom: qi < group.questions.length - 1 ? "1px solid #f1f5f9" : "none"
                });

                // Version badge + question
                const qHeader = div({ display: "flex", gap: "8px", alignItems: "flex-start", marginBottom: "6px" });
                qHeader.appendChild(div({
                    padding: "2px 8px", borderRadius: "999px",
                    background: "#f1f5f9", fontSize: "11px",
                    color: "#6b7280", fontWeight: "600", flexShrink: "0", marginTop: "2px"
                }, { textContent: `v${q.version || qi + 1}` }));

                // Editable question text
                const qText = el("textarea", {
                    flex: "1", padding: "6px 8px", borderRadius: "6px",
                    border: "1px solid #e5e7eb", fontSize: "13px",
                    fontFamily: "Inter, system-ui, Arial", lineHeight: "1.5",
                    resize: "vertical", minHeight: "50px",
                    background: "#f9fafb", width: "100%",
                    boxSizing: "border-box"
                }, { value: q.question || "" });
                qText.oninput = () => { q.question = qText.value; };
                qHeader.appendChild(qText);
                qBlock.appendChild(qHeader);

                // Answers
                if (q.answers && q.answers.length) {
                    q.answers.forEach((ans, ai) => {
                        const ansRow = div({
                            display: "flex", alignItems: "center", gap: "6px",
                            marginBottom: "4px", paddingLeft: "32px"
                        });

                        const correctDot = div({
                            width: "10px", height: "10px", borderRadius: "50%",
                            background: ans.correct ? "#16a34a" : "#d1d5db",
                            flexShrink: "0", cursor: "pointer"
                        });
                        correctDot.title = ans.correct ? "Correct answer" : "Click to mark correct";
                        correctDot.onclick = () => {
                            // Mark this as correct, unmark others
                            q.answers.forEach((a, i) => { a.correct = i === ai; });
                            render();
                        };

                        const ansText = el("input", {
                            flex: "1", padding: "4px 8px", borderRadius: "6px",
                            border: `1px solid ${ans.correct ? "#86efac" : "#e5e7eb"}`,
                            fontSize: "12px", background: ans.correct ? "#f0fdf4" : "#fff"
                        }, { value: ans.text || "", type: "text" });
                        ansText.oninput = () => { ans.text = ansText.value; };

                        ansRow.appendChild(correctDot);
                        ansRow.appendChild(ansText);
                        qBlock.appendChild(ansRow);
                    });
                }

                groupCard.appendChild(qBlock);
            });

            list.appendChild(groupCard);
        });

        wrap.appendChild(list);

        // ── ACTIONS ──
        const actions = div({
            padding: "12px 14px", borderTop: "1px solid #ccfbf1",
            background: "#f0fdf9", display: "flex",
            flexDirection: "column", gap: "8px", flexShrink: "0"
        });

        const downloadBtn = btn("⬇ Download QTI ZIP for Canvas", "#0f766e", "#fff", {
            width: "100%", boxSizing: "border-box", padding: "13px", fontSize: "14px",
            boxShadow: "0 4px 14px rgba(15,118,110,0.35)"
        });
        downloadBtn.onclick = handleDownloadQTI;
        actions.appendChild(downloadBtn);

        actions.appendChild(div({
            padding: "10px 12px", borderRadius: "8px",
            background: "#fffbeb", border: "1px solid #fde68a",
            fontSize: "12px", color: "#92400e", lineHeight: "1.6"
        }, { innerHTML: `<strong>How to import into Canvas:</strong><br>
            1. Go to your Canvas course<br>
            2. Click <strong>Quizzes</strong> → <strong>⋮ Options</strong> → <strong>Import</strong><br>
            3. Upload the downloaded ZIP file<br>
            4. Your quiz appears with all question groups ready` }));

        const rebuildBtn = btn("← Change Settings", "#e2e8f0", "#374151", {
            width: "100%", boxSizing: "border-box", fontSize: "12px", padding: "9px"
        });
        rebuildBtn.onclick = () => { state.view = "build"; setStatus("", "idle"); render(); };
        actions.appendChild(rebuildBtn);

        wrap.appendChild(actions);
        return wrap;
    }

    // ─────────────────────────────────────────────
    // QTI BUILDER
    // ─────────────────────────────────────────────
    // ─────────────────────────────────────────────
    // MINIMAL ZIP BUILDER (no external library)
    // Builds a valid ZIP file using pure JS
    // ─────────────────────────────────────────────
    function buildZip(files) {
        // files = [{ name: "foo.xml", content: "string" }, ...]
        // Returns a Uint8Array of the ZIP binary

        function strToBytes(str) {
            const encoder = new TextEncoder();
            return encoder.encode(str);
        }

        function crc32(bytes) {
            const table = new Uint32Array(256);
            for (let i = 0; i < 256; i++) {
                let c = i;
                for (let j = 0; j < 8; j++) {
                    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
                }
                table[i] = c;
            }
            let crc = 0xFFFFFFFF;
            for (let i = 0; i < bytes.length; i++) {
                crc = table[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
            }
            return (crc ^ 0xFFFFFFFF) >>> 0;
        }

        function writeUint16LE(val) {
            return [val & 0xFF, (val >> 8) & 0xFF];
        }

        function writeUint32LE(val) {
            return [val & 0xFF, (val >> 8) & 0xFF, (val >> 16) & 0xFF, (val >> 24) & 0xFF];
        }

        function concat(...arrays) {
            const total = arrays.reduce((sum, a) => sum + a.length, 0);
            const result = new Uint8Array(total);
            let offset = 0;
            for (const a of arrays) {
                result.set(a, offset);
                offset += a.length;
            }
            return result;
        }

        const now = new Date();
        const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
        const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);

        const localHeaders = [];
        const centralHeaders = [];
        let offset = 0;

        for (const file of files) {
            const nameBytes    = strToBytes(file.name);
            const contentBytes = strToBytes(file.content);
            const crc          = crc32(contentBytes);
            const size         = contentBytes.length;

            // Local file header
            const localHeader = new Uint8Array([
                0x50, 0x4B, 0x03, 0x04,   // signature
                0x14, 0x00,               // version needed: 2.0
                0x00, 0x00,               // flags
                0x00, 0x00,               // compression: stored
                ...writeUint16LE(dosTime),
                ...writeUint16LE(dosDate),
                ...writeUint32LE(crc),
                ...writeUint32LE(size),
                ...writeUint32LE(size),
                ...writeUint16LE(nameBytes.length),
                0x00, 0x00,               // extra field length
            ]);

            const localEntry = concat(localHeader, nameBytes, contentBytes);
            localHeaders.push(localEntry);

            // Central directory header
            const centralHeader = new Uint8Array([
                0x50, 0x4B, 0x01, 0x02,   // signature
                0x14, 0x00,               // version made by
                0x14, 0x00,               // version needed
                0x00, 0x00,               // flags
                0x00, 0x00,               // compression: stored
                ...writeUint16LE(dosTime),
                ...writeUint16LE(dosDate),
                ...writeUint32LE(crc),
                ...writeUint32LE(size),
                ...writeUint32LE(size),
                ...writeUint16LE(nameBytes.length),
                0x00, 0x00,               // extra field length
                0x00, 0x00,               // comment length
                0x00, 0x00,               // disk number start
                0x00, 0x00,               // internal attributes
                0x00, 0x00, 0x00, 0x00,   // external attributes
                ...writeUint32LE(offset),
            ]);

            centralHeaders.push(concat(centralHeader, nameBytes));
            offset += localEntry.length;
        }

        const centralDirData   = concat(...centralHeaders);
        const centralDirSize   = centralDirData.length;
        const centralDirOffset = offset;

        // End of central directory record
        const endRecord = new Uint8Array([
            0x50, 0x4B, 0x05, 0x06,   // signature
            0x00, 0x00,               // disk number
            0x00, 0x00,               // disk with central dir
            ...writeUint16LE(files.length),
            ...writeUint16LE(files.length),
            ...writeUint32LE(centralDirSize),
            ...writeUint32LE(centralDirOffset),
            0x00, 0x00,               // comment length
        ]);

        return concat(...localHeaders, centralDirData, endRecord);
    }

    function handleDownloadQTI() {
        const data = state.generatedQuestions;
        if (!data || !data.groups) {
            setStatus("No questions to export.", "error");
            render();
            return;
        }

        setStatus("Building QTI ZIP…", "loading");
        render();

        try {
            const quizId   = "quiz_" + Date.now();
            const allItems = [];
            const files    = [];

            // Build each question item XML
            data.groups.forEach((group, gi) => {
                (group.questions || []).forEach((q, qi) => {
                    const itemId = `item_${gi + 1}_${qi + 1}`;
                    const type   = group.type;
                    // Default points — instructor sets these in Canvas after import
                    const points = type === "mc" ? 1 : type === "tf" ? 1 : type === "sa" ? 5 : 10;

                    files.push({ name: `${itemId}.xml`, content: buildQTIItem(itemId, q, type, points) });
                    allItems.push({ id: itemId, points, groupIndex: gi });
                });
            });

            // Assessment + manifest
            files.push({ name: "assessment.xml",  content: buildAssessmentXML(quizId, data, allItems) });
            files.push({ name: "imsmanifest.xml", content: buildManifestXML(quizId, allItems) });

            // Build ZIP entirely in JS — no external library
            const zipBytes = buildZip(files);
            const blob     = new Blob([zipBytes], { type: "application/zip" });
            const url      = URL.createObjectURL(blob);
            const link     = document.createElement("a");
            const fileName = `${state.quizTitle.replace(/[^a-z0-9]/gi, "_")}_QTI.zip`;

            link.href     = url;
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            setStatus(`✓ ${fileName} downloaded! Import into Canvas Quizzes.`, "success");
            render();

        } catch (err) {
            setStatus(`Error building QTI: ${err.message}`, "error");
            render();
        }
    }

    function escXml(str) {
        return String(str || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&apos;");
    }

    // Build a single self-contained assessment XML with all items inline
    // Canvas QTI needs items embedded directly — it does not follow external item_ref files
    function buildItemXml(itemId, q, type, points) {
        if (type === "mc" || type === "tf") {
            const choices = (q.answers || []).map((ans, i) => {
                return "          <response_label ident=\"choice_" + i + "\">" +
                    "\n            <material><mattext texttype=\"text/plain\">" + escXml(ans.text) + "</mattext></material>" +
                    "\n          </response_label>";
            }).join("\n");

            const correctIdx = (q.answers || []).findIndex(a => a.correct);
            const conditions = correctIdx >= 0
                ? "        <respcondition continue=\"No\">" +
                  "\n          <conditionvar><varequal respident=\"response1\">choice_" + correctIdx + "</varequal></conditionvar>" +
                  "\n          <setvar action=\"Set\" varname=\"SCORE\">" + points + "</setvar>" +
                  "\n        </respcondition>"
                : "";

            return "      <item ident=\"" + itemId + "\" title=\"" + escXml((q.question || "").slice(0, 60)) + "\">" +
                "\n        <itemmetadata><qtimetadata>" +
                "\n          <qtimetadatafield><fieldlabel>question_type</fieldlabel>" +
                "<fieldentry>" + (type === "tf" ? "true_false_question" : "multiple_choice_question") + "</fieldentry></qtimetadatafield>" +
                "\n          <qtimetadatafield><fieldlabel>points_possible</fieldlabel><fieldentry>" + points + "</fieldentry></qtimetadatafield>" +
                "\n        </qtimetadata></itemmetadata>" +
                "\n        <presentation>" +
                "\n          <material><mattext texttype=\"text/html\">" + escXml(q.question || "") + "</mattext></material>" +
                "\n          <response_lid ident=\"response1\" rcardinality=\"Single\">" +
                "\n            <render_choice shuffle=\"Yes\">" +
                "\n" + choices +
                "\n            </render_choice>" +
                "\n          </response_lid>" +
                "\n        </presentation>" +
                "\n        <resprocessing>" +
                "\n          <outcomes><decvar maxvalue=\"" + points + "\" minvalue=\"0\" varname=\"SCORE\" vartype=\"Decimal\"/></outcomes>" +
                "\n" + conditions +
                "\n        </resprocessing>" +
                "\n      </item>";
        }

        // Short answer / Essay
        return "      <item ident=\"" + itemId + "\" title=\"" + escXml((q.question || "").slice(0, 60)) + "\">" +
            "\n        <itemmetadata><qtimetadata>" +
            "\n          <qtimetadatafield><fieldlabel>question_type</fieldlabel>" +
            "<fieldentry>" + (type === "essay" ? "essay_question" : "short_answer_question") + "</fieldentry></qtimetadatafield>" +
            "\n          <qtimetadatafield><fieldlabel>points_possible</fieldlabel><fieldentry>" + points + "</fieldentry></qtimetadatafield>" +
            "\n        </qtimetadata></itemmetadata>" +
            "\n        <presentation>" +
            "\n          <material><mattext texttype=\"text/html\">" + escXml(q.question || "") + "</mattext></material>" +
            "\n          <response_str ident=\"response1\" rcardinality=\"Single\">" +
            "\n            <render_fib><response_label ident=\"answer1\" rshuffle=\"No\"/></render_fib>" +
            "\n          </response_str>" +
            "\n        </presentation>" +
            "\n        <resprocessing>" +
            "\n          <outcomes><decvar maxvalue=\"" + points + "\" minvalue=\"0\" varname=\"SCORE\" vartype=\"Decimal\"/></outcomes>" +
            "\n        </resprocessing>" +
            "\n      </item>";
    }

    function buildFullAssessmentXML(quizId, data) {
        const groups = data.groups || [];

        const sections = groups.map((group, gi) => {
            const groupNum  = gi + 1;
            const type      = group.type;
            const points    = type === "mc" ? 1 : type === "tf" ? 1 : type === "sa" ? 5 : 10;
            const questions = group.questions || [];

            // All 3 versions of this question as inline items
            const itemsXml = questions.map((q, qi) => {
                const itemId = "item_" + groupNum + "_" + (qi + 1);
                return buildItemXml(itemId, q, type, points);
            }).join("\n");

            return "    <section ident=\"group_" + groupNum + "\" title=\"Group " + groupNum + " - " + (group.concept || type) + "\">" +
                "\n      <selection_ordering>" +
                "\n        <selection><selection_number>1</selection_number></selection>" +
                "\n        <order order_type=\"Random\"/>" +
                "\n      </selection_ordering>" +
                "\n" + itemsXml +
                "\n    </section>";
        }).join("\n");

        return "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" +
            "<questestinterop xmlns=\"http://www.imsglobal.org/xsd/ims_qtiasiv1p2\">\n" +
            "  <assessment ident=\"" + quizId + "\" title=\"" + escXml(state.quizTitle) + "\">\n" +
            "    <qtimetadata>\n" +
            "      <qtimetadatafield><fieldlabel>cc_maxattempts</fieldlabel><fieldentry>1</fieldentry></qtimetadatafield>\n" +
            "    </qtimetadata>\n" +
            "    <section ident=\"root_section\">\n" +
            sections + "\n" +
            "    </section>\n" +
            "  </assessment>\n" +
            "</questestinterop>";
    }

    function buildManifestXML(quizId) {
        return "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" +
            "<manifest identifier=\"canvas_export\" xmlns=\"http://www.imsglobal.org/xsd/imsccv1p1/imscp_v1p1\">\n" +
            "  <metadata>\n" +
            "    <schema>IMS Content</schema>\n" +
            "    <schemaversion>1.1.3</schemaversion>\n" +
            "  </metadata>\n" +
            "  <organizations/>\n" +
            "  <resources>\n" +
            "    <resource identifier=\"" + quizId + "\" type=\"imsqti_xmlv1p2\" href=\"assessment.xml\">\n" +
            "      <file href=\"assessment.xml\"/>\n" +
            "    </resource>\n" +
            "  </resources>\n" +
            "</manifest>";
    }

    function handleDownloadQTI() {
        const data = state.generatedQuestions;
        if (!data || !data.groups) {
            setStatus("No questions to export.", "error");
            render();
            return;
        }

        setStatus("Building QTI ZIP…", "loading");
        render();

        try {
            const quizId = "quiz_" + Date.now();

            // Single assessment.xml with all items inline — Canvas needs this
            const assessmentXml = buildFullAssessmentXML(quizId, data);
            const manifestXml   = buildManifestXML(quizId);

            const files = [
                { name: "assessment.xml",  content: assessmentXml },
                { name: "imsmanifest.xml", content: manifestXml   }
            ];

            const zipBytes = buildZip(files);
            const blob     = new Blob([zipBytes], { type: "application/zip" });
            const url      = URL.createObjectURL(blob);
            const link     = document.createElement("a");
            const fileName = state.quizTitle.replace(/[^a-z0-9]/gi, "_") + "_QTI.zip";

            link.href     = url;
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            setStatus("✓ " + fileName + " downloaded! Import into Canvas Quizzes.", "success");
            render();

        } catch (err) {
            setStatus("Error building QTI: " + err.message, "error");
            render();
        }
    }

        // ─────────────────────────────────────────────
    // INIT — wait for body to be ready (Canvas SPA)
    // ─────────────────────────────────────────────
    function waitAndLaunch(tries) {
        if (tries === undefined) tries = 0;
        if (tries > 40) return;
        if (document.body) {

    // ─────────────────────────────────────────────
    // REGISTER WITH CANVAS DASHBOARD
    // ─────────────────────────────────────────────
    (function tryRegister() {
        if (unsafeWindow.CanvasDash) {
            unsafeWindow.CanvasDash.register({
                id:          "qti-generator",
                name:        "QTI Generator",
                icon:        "📝",
                description: "AI-powered quiz & test generator (QTI format)",
                color:       "#27ae60",
                run:         togglePanel
            });
        } else {
            setTimeout(tryRegister, 100);
        }
    })();

        } else {
            setTimeout(function() { waitAndLaunch(tries + 1); }, 250);
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", function() { waitAndLaunch(0); });
    } else {
        waitAndLaunch(0);
    }

})();