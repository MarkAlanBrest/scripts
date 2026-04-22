// ==UserScript==
// @name         AIgrader — Claude Edition
// @namespace    http://tampermonkey.net/
// @version      5.2
// @description  Grade Canvas submissions using Claude AI directly in SpeedGrader — auto-detects course, pulls assignments from Canvas API
// @match        https://*.instructure.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_deleteValue
// @require      https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js
// @connect      api.anthropic.com
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/MarkAlanBrest/scripts/main/AIgrader%20%E2%80%94%20Claude%20Edition-5.2.user.js
// @updateURL    https://raw.githubusercontent.com/MarkAlanBrest/scripts/main/AIgrader%20%E2%80%94%20Claude%20Edition-5.2.user.js
// ==/UserScript==

(function () {
    "use strict";

    // ─────────────────────────────────────────────
    // CONSTANTS
    // ─────────────────────────────────────────────
    const DB_KEY      = "AIgrader_DB_v5";
    const APIKEY_KEY  = "AIgrader_APIKey";
    const PANEL_WIDTH = "460px";
    const AI_MODEL    = "claude-sonnet-4-6";
    const MAX_TOKENS  = 2048;
    const CANVAS_BASE = window.location.origin;
    const API         = CANVAS_BASE + "/api/v1";

    // ─────────────────────────────────────────────
    // PDF.js WORKER SETUP
    // ─────────────────────────────────────────────
    if (typeof pdfjsLib !== "undefined") {
        pdfjsLib.GlobalWorkerOptions.workerSrc =
            "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    }

    // ─────────────────────────────────────────────
    // STATE
    // ─────────────────────────────────────────────
    let panelInjected = false;
    let panel = null;

    const state = {
        view:               "grade",
        // Auto-detected from URL
        detectedCourseId:   null,
        detectedCourseName: "",
        // Canvas API data
        canvasAssignments:  [],
        assignmentsLoaded:  false,
        assignmentsLoading: false,
        // Selection
        selectedAssignmentId: "",
        selectedAssignmentName: "",
        selectedClass:      "",
        selectedAssignment: "",
        // Grading settings (per-assignment)
        gradingSettings:    {},
        showSettings:       false,
        // Results
        suggestedGrade:     "",
        comments:           [],
        status:             "",
        statusType:         "idle",
        uploadedFileName:   "",
        uploadedFileContent:"",
        apiKey:             GM_getValue(APIKEY_KEY, ""),
    };

    // ─────────────────────────────────────────────
    // COURSE AUTO-DETECTION
    // ─────────────────────────────────────────────
    function detectCourseFromUrl() {
        const match = window.location.pathname.match(/\/courses\/(\d+)/);
        if (match) {
            state.detectedCourseId = match[1];
            return match[1];
        }
        return null;
    }

    async function fetchCourseName(courseId) {
        try {
            const resp = await fetch(`${API}/courses/${courseId}`, { credentials: "same-origin" });
            if (resp.ok) {
                const data = await resp.json();
                state.detectedCourseName = data.name || `Course ${courseId}`;
                state.selectedClass = state.detectedCourseName;
            }
        } catch (e) {
            state.detectedCourseName = `Course ${courseId}`;
            state.selectedClass = state.detectedCourseName;
        }
    }

    async function fetchAssignments(courseId) {
        state.assignmentsLoading = true;
        render();
        try {
            let results = [];
            let url = `${API}/courses/${courseId}/assignments?order_by=due_at&per_page=100`;
            while (url) {
                const resp = await fetch(url, { credentials: "same-origin" });
                if (!resp.ok) break;
                const data = await resp.json();
                results = results.concat(data);
                const link = resp.headers.get("Link") || "";
                const nextMatch = link.match(/<([^>]+)>;\s*rel="next"/);
                url = nextMatch ? nextMatch[1] : null;
            }
            state.canvasAssignments = results;
            state.assignmentsLoaded = true;
        } catch (e) {
            state.canvasAssignments = [];
            state.assignmentsLoaded = true;
        }
        state.assignmentsLoading = false;
        render();
    }

    // Also try to detect assignment from SpeedGrader URL
    function detectAssignmentFromUrl() {
        const match = window.location.pathname.match(/\/assignments\/(\d+)/);
        if (match) return match[1];
        const params = new URLSearchParams(window.location.search);
        return params.get("assignment_id") || null;
    }

    // ─────────────────────────────────────────────
    // DATABASE (rubrics/settings storage)
    // ─────────────────────────────────────────────
    function loadDB()      { return GM_getValue(DB_KEY, { items: [] }); }
    function saveDB(db)    { GM_setValue(DB_KEY, db); }
    function makeId()      { return "item_" + Math.random().toString(36).slice(2, 11); }
    function norm(v)       { return (v || "").trim(); }

    function getClasses(db) {
        return [...new Set(db.items.map(i => norm(i.className)).filter(Boolean))].sort();
    }

    function getAssignments(db, className) {
        return db.items
            .filter(i => norm(i.className) === norm(className))
            .map(i => norm(i.assignmentName))
            .filter(Boolean)
            .sort();
    }

    function getItem(db, className, assignmentName) {
        return db.items.find(
            i => norm(i.className) === norm(className) &&
                 norm(i.assignmentName) === norm(assignmentName)
        ) || null;
    }

    function getItemByAssignmentId(db, assignmentId) {
        return db.items.find(i => String(i.canvasAssignmentId) === String(assignmentId)) || null;
    }

    function upsertItem(db, item) {
        const idx = db.items.findIndex(i => i.id === item.id);
        if (idx >= 0) db.items[idx] = item;
        else db.items.push(item);
    }

    function deleteItem(db, id) {
        db.items = db.items.filter(i => i.id !== id);
    }

    function getItemsForList(db, className) {
        const items = norm(className)
            ? db.items.filter(i => norm(i.className) === norm(className))
            : db.items.slice();
        return items.sort((a, b) => {
            const c = norm(a.className).localeCompare(norm(b.className));
            return c !== 0 ? c : norm(a.assignmentName).localeCompare(norm(b.assignmentName));
        });
    }

    // ─────────────────────────────────────────────
    // GRADING SETTINGS STORAGE (keyed by assignment name)
    // ─────────────────────────────────────────────
    const SETTINGS_KEY     = "AIgrader_GradeSettings_v2";
    const SETTINGS_KEY_OLD = "AIgrader_GradeSettings_v1";

    // Build a canonical key from the assignment name (case-insensitive, trimmed)
    function settingsKey(assignmentName) {
        return norm(assignmentName).toLowerCase();
    }

    // Migrate v1 (ID-keyed) settings into v2 (name-keyed) on first access
    function migrateSettingsV1toV2() {
        const v2 = GM_getValue(SETTINGS_KEY, null);
        if (v2 !== null) return; // already migrated or fresh
        const v1 = GM_getValue(SETTINGS_KEY_OLD, {});
        const migrated = {};
        // We need the DB to map IDs → names
        const db = loadDB();
        for (const [id, settings] of Object.entries(v1)) {
            const item = db.items.find(i => String(i.canvasAssignmentId) === String(id));
            const name = item ? norm(item.assignmentName) : "";
            if (name) {
                const key = settingsKey(name);
                // Don't overwrite if two IDs mapped to the same name
                if (!migrated[key]) migrated[key] = settings;
            }
        }
        GM_setValue(SETTINGS_KEY, migrated);
    }

    function loadGradingSettings(assignmentName) {
        migrateSettingsV1toV2();
        const all = GM_getValue(SETTINGS_KEY, {});
        const key = settingsKey(assignmentName);
        return all[key] || getDefaultGradingSettings();
    }

    function saveGradingSettings(assignmentName, settings) {
        migrateSettingsV1toV2();
        const all = GM_getValue(SETTINGS_KEY, {});
        const key = settingsKey(assignmentName);
        all[key] = settings;
        GM_setValue(SETTINGS_KEY, all);
    }

    // Check if settings already exist under a given assignment name
    function hasGradingSettings(assignmentName) {
        migrateSettingsV1toV2();
        const all = GM_getValue(SETTINGS_KEY, {});
        const key = settingsKey(assignmentName);
        return !!all[key];
    }

    // Return all saved assignment names that share the same key
    function getDuplicateSettingsNames(assignmentName) {
        migrateSettingsV1toV2();
        const all = GM_getValue(SETTINGS_KEY, {});
        const key = settingsKey(assignmentName);
        if (!all[key]) return [];
        // We can't recover the original casing from the key, but we can
        // check the DB for any items whose name normalises to the same key
        const db = loadDB();
        return db.items
            .filter(i => settingsKey(i.assignmentName) === key)
            .map(i => `${norm(i.className)} › ${norm(i.assignmentName)}`);
    }

    function getDefaultGradingSettings() {
        return {
            gradeIntensity: "balanced",      // lenient, balanced, strict
            rubricText: "",                   // free-form rubric criteria
            answerKey: "",                    // answer key for comparison
            commentSuggestions: "",           // teacher's suggested comments
            acceptIntent: true,               // accept intent/meaning even if wording differs
            partialCredit: true,              // allow partial credit
            totalPoints: 100,                 // total points for the assignment
            customInstructions: "",           // any additional AI instructions
            feedbackTone: "encouraging",      // encouraging, neutral, direct
            focusAreas: "",                   // specific areas to focus feedback on
        };
    }

    // ─────────────────────────────────────────────
    // CANVAS HELPERS
    // ─────────────────────────────────────────────
    function getSubmissionText() {
        const selectors = [
            ".submission_details .user_content",
            ".user_content",
            ".submission_content",
            "#submission_text",
        ];
        for (const sel of selectors) {
            const text = document.querySelector(sel)?.innerText?.trim();
            if (text) return text;
        }
        for (const frame of document.querySelectorAll("iframe")) {
            try {
                const doc = frame.contentDocument || frame.contentWindow?.document;
                if (!doc) continue;
                for (const sel of selectors) {
                    const text = doc.querySelector(sel)?.innerText?.trim();
                    if (text) return text;
                }
                const body = doc.body?.innerText?.trim();
                if (body) return body;
            } catch { /* cross-origin */ }
        }
        return "";
    }

    function getAttachedFileLinks() {
        const links = [];
        document.querySelectorAll("a").forEach(a => {
            const href = a.href || "";
            if (href.includes("/files/") &&
                (href.includes("/download") || href.includes("?download=1"))) {
                links.push({ name: a.textContent.trim() || "Attached file", url: href });
            }
        });
        return links;
    }

    function getStudentName() {
        const nameEl = document.querySelector('[data-testid="student-select-trigger"]');
        let name = nameEl?.innerText || nameEl?.textContent || "the student";
        name = name.replace(/\s+/g, " ").trim();
        const parts = name.split(" ");
        if (parts.length >= 3 && parts[0].length <= 2) return parts[1];
        return parts[0] || "the student";
    }

    function pasteToCanvasComment(text) {
        const textarea =
            document.querySelector("#speed_grader_comment_textarea") ||
            document.querySelector("textarea.grading_comment") ||
            document.querySelector("textarea[name='comment[text_comment]']") ||
            document.querySelector("textarea");
        if (!textarea) return false;
        textarea.focus();
        textarea.value = text;
        textarea.dispatchEvent(new Event("input",  { bubbles: true }));
        textarea.dispatchEvent(new Event("change", { bubbles: true }));
        textarea.scrollIntoView({ behavior: "smooth", block: "center" });
        return true;
    }

    // ─────────────────────────────────────────────
    // PDF TEXT EXTRACTION
    // ─────────────────────────────────────────────
    async function extractPdfText(arrayBuffer) {
        if (typeof pdfjsLib === "undefined") {
            throw new Error("PDF.js not loaded. Please reload the page and try again.");
        }
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        let fullText = "";
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            const pageText = content.items.map(item => item.str).join(" ").trim();
            if (pageText) fullText += pageText + "\n\n";
        }
        return { text: fullText.trim(), pages: pdf.numPages };
    }

    // ─────────────────────────────────────────────
    // PROMPT BUILDER (enhanced with grading settings)
    // ─────────────────────────────────────────────
    function buildPrompt(item, studentName, settings) {
        let rubric;
        try { rubric = JSON.parse(item.jsonText); } catch { rubric = {}; }

        const submissionText = getSubmissionText();
        const fileLinks      = getAttachedFileLinks();

        let prompt = `You are an expert teacher grading a student assignment.\n`;
        prompt += `Student: ${studentName}\n\n`;

        // Grading intensity
        const intensityMap = {
            lenient: "Be generous in your grading. Give benefit of the doubt. Focus on what the student did well while gently noting improvements.",
            balanced: "Grade fairly and consistently. Acknowledge strengths and provide constructive feedback on weaknesses.",
            strict: "Grade rigorously. Hold students to high standards. Be thorough in identifying errors and areas for improvement.",
        };
        prompt += `GRADING APPROACH: ${intensityMap[settings.gradeIntensity] || intensityMap.balanced}\n`;

        // Feedback tone
        const toneMap = {
            encouraging: "Use an encouraging, supportive tone. Start with positives before constructive criticism.",
            neutral: "Use a neutral, professional tone. Be objective and factual.",
            direct: "Be direct and concise. Focus on what needs improvement without excessive praise.",
        };
        prompt += `FEEDBACK TONE: ${toneMap[settings.feedbackTone] || toneMap.encouraging}\n`;

        if (settings.acceptIntent) {
            prompt += `ACCEPT INTENT: If the student's answer conveys the correct meaning or intent even if the exact wording differs, give credit.\n`;
        }
        if (settings.partialCredit) {
            prompt += `PARTIAL CREDIT: Award partial credit for partially correct answers.\n`;
        }
        prompt += `\n`;

        // Total points
        const totalPoints = settings.totalPoints || rubric.totalPoints || 100;
        prompt += `GRADING RUBRIC\n`;
        if (rubric.assignmentTitle || state.selectedAssignmentName) {
            prompt += `Assignment: ${rubric.assignmentTitle || state.selectedAssignmentName}\n`;
        }
        prompt += `Total Points: ${totalPoints}\n\n`;

        // Custom AI instructions
        if (settings.customInstructions) {
            prompt += `ADDITIONAL INSTRUCTIONS:\n${settings.customInstructions}\n\n`;
        }
        if (rubric.aiInstructions || rubric.instructions || rubric.directions) {
            prompt += `Instructions:\n${rubric.aiInstructions || rubric.instructions || rubric.directions}\n\n`;
        }

        // Focus areas
        if (settings.focusAreas) {
            prompt += `FOCUS AREAS (pay special attention to):\n${settings.focusAreas}\n\n`;
        }

        // Rubric criteria from settings
        if (settings.rubricText) {
            prompt += `RUBRIC CRITERIA:\n${settings.rubricText}\n\n`;
        }
        // Rubric from JSON
        if (rubric.checks?.length) {
            prompt += `Grading Checks:\n`;
            rubric.checks.forEach((c, i) => {
                prompt += `  ${i + 1}. ${c.name} — ${c.points} pts\n`;
                if (c.description) prompt += `     ${c.description}\n`;
            });
            prompt += "\n";
        }
        if (rubric.rubric?.length) {
            prompt += `Rubric Criteria:\n`;
            rubric.rubric.forEach((r, i) => {
                prompt += `  ${i + 1}. ${r.name || r.criteria} — ${r.points} pts\n`;
                if (r.description) prompt += `     ${r.description}\n`;
            });
            prompt += "\n";
        }

        // Answer key
        if (settings.answerKey) {
            prompt += `ANSWER KEY:\n${settings.answerKey}\n\n`;
        }
        if (rubric.answerKey?.length) {
            prompt += `Answer Key (from rubric):\n`;
            rubric.answerKey.forEach((a, i) => {
                prompt += `  Q${i + 1}: ${typeof a === "string" ? a : JSON.stringify(a)}\n`;
            });
            prompt += "\n";
        }

        // Comment suggestions
        if (settings.commentSuggestions) {
            prompt += `SUGGESTED COMMENTS (use or adapt these where applicable):\n${settings.commentSuggestions}\n\n`;
        }
        if (rubric.commentBank?.length) {
            prompt += `Comment Bank:\n`;
            rubric.commentBank.forEach(c => { prompt += `  - ${c}\n`; });
            prompt += "\n";
        }
        if (rubric.notes) prompt += `Notes:\n${rubric.notes}\n\n`;

        // Submission
        prompt += `STUDENT SUBMISSION\n`;
        if (submissionText) {
            prompt += `${submissionText}\n\n`;
        }
        if (state.uploadedFileContent) {
            prompt += `Uploaded File (${state.uploadedFileName}):\n${state.uploadedFileContent}\n\n`;
        }
        if (fileLinks.length) {
            prompt += `Attached Files:\n`;
            fileLinks.forEach(f => { prompt += `  - ${f.name}: ${f.url}\n`; });
            prompt += "\n";
        }
        if (!submissionText && !state.uploadedFileContent && !fileLinks.length) {
            prompt += `[No submission detected]\n\n`;
        }

        // Output format
        prompt += `RESPONSE FORMAT\n`;
        prompt += `Return ONLY valid JSON — no preamble, no explanation:\n`;
        prompt += `{\n`;
        prompt += `  "grade": "${totalPoints > 0 ? '88/' + totalPoints : '88/100'}",\n`;
        prompt += `  "summary": "One sentence overall assessment.",\n`;
        prompt += `  "comments": [\n`;
        prompt += `    "Specific feedback comment addressed to ${studentName}.",\n`;
        prompt += `    "Second comment.",\n`;
        prompt += `    "Third comment."\n`;
        prompt += `  ]\n`;
        prompt += `}\n`;
        prompt += `Rules: address ${studentName} directly, 3–6 comments, Canvas-ready, JSON only.\n`;

        return prompt;
    }

    // ─────────────────────────────────────────────
    // CLAUDE API CALL
    // ─────────────────────────────────────────────
    function callClaude(prompt, onSuccess, onError) {
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
                max_tokens: MAX_TOKENS,
                messages:   [{ role: "user", content: prompt }]
            }),
            timeout: 60000,
            onload(response) {
                let data;
                try { data = JSON.parse(response.responseText); }
                catch { onError(`Server returned invalid response (HTTP ${response.status})`); return; }

                if (response.status !== 200) {
                    onError(`Claude API error: ${data?.error?.message || `HTTP ${response.status}`}`);
                    return;
                }

                const raw = data?.content?.[0]?.text || "";
                try {
                    const clean = raw.replace(/```json|```/g, "").trim();
                    onSuccess(JSON.parse(clean));
                } catch {
                    onError(`Could not parse Claude's response as JSON.\n\nRaw:\n${raw}`);
                }
            },
            onerror()   { onError("Network error — could not reach the Anthropic API."); },
            ontimeout() { onError("Request timed out after 60 seconds. Try again."); }
        });
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
    function div(styles = {}, props = {}) { return el("div", styles, props); }

    function btn(label, bg, color = "#fff", extraStyles = {}) {
        const b = el("button", {
            padding: "10px 16px", borderRadius: "8px", fontWeight: "600",
            cursor: "pointer", fontSize: "13px", border: "none",
            background: bg, color, transition: "opacity 0.15s", ...extraStyles
        }, { textContent: label });
        b.onmouseenter = () => b.style.opacity = "0.85";
        b.onmouseleave = () => b.style.opacity = "1";
        return b;
    }

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;")
            .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }

    function buildSelect(options, selectedValue, placeholder, onChange) {
        const select = el("select", {
            padding: "9px 10px", borderRadius: "8px", border: "1px solid #d1d5db",
            background: "#f9fafb", fontSize: "13px", width: "100%",
            boxSizing: "border-box", color: "#111827"
        });
        select.innerHTML =
            `<option value="">${escapeHtml(placeholder)}</option>` +
            options.filter(Boolean).map(v =>
                `<option value="${escapeHtml(v)}"${v === selectedValue ? " selected" : ""}>${escapeHtml(v)}</option>`
            ).join("");
        select.onchange = () => onChange(select.value);
        return select;
    }

    function buildSelectWithIds(options, selectedId, placeholder, onChange) {
        const select = el("select", {
            padding: "9px 10px", borderRadius: "8px", border: "1px solid #d1d5db",
            background: "#f9fafb", fontSize: "13px", width: "100%",
            boxSizing: "border-box", color: "#111827"
        });
        select.innerHTML =
            `<option value="">${escapeHtml(placeholder)}</option>` +
            options.map(o => {
                const due = o.due_at ? ` (Due: ${new Date(o.due_at).toLocaleDateString()})` : "";
                const pts = o.points_possible ? ` — ${o.points_possible} pts` : "";
                return `<option value="${o.id}"${String(o.id) === String(selectedId) ? " selected" : ""}>${escapeHtml(o.name)}${pts}${due}</option>`;
            }).join("");
        select.onchange = () => {
            const assignment = options.find(o => String(o.id) === select.value);
            onChange(select.value, assignment);
        };
        return select;
    }

    function statusColor(type) {
        return { success: "#166534", loading: "#1d4ed8", error: "#b91c1c", idle: "#6b7280" }[type] || "#6b7280";
    }

    function setStatus(text, type = "idle") {
        state.status     = text;
        state.statusType = type;
    }

    // ─────────────────────────────────────────────
    // FILE UPLOAD HANDLER
    // ─────────────────────────────────────────────
    function handleFileUpload(file) {
        if (file.size > 20 * 1024 * 1024) {
            setStatus("File too large (max 20MB)", "error");
            render();
            return;
        }

        setStatus(`Reading ${file.name}…`, "loading");
        render();

        const ext = file.name.split(".").pop().toLowerCase();

        if (ext === "docx" || ext === "doc") {
            const reader = new FileReader();
            reader.onload = e => {
                mammoth.extractRawText({ arrayBuffer: e.target.result })
                    .then(result => {
                        state.uploadedFileContent = result.value;
                        state.uploadedFileName    = file.name;
                        setStatus(`✓ Word file loaded: ${file.name}`, "success");
                        render();
                    })
                    .catch(err => {
                        setStatus(`Failed to read Word file: ${err.message}`, "error");
                        render();
                    });
            };
            reader.onerror = () => { setStatus("Failed to read file", "error"); render(); };
            reader.readAsArrayBuffer(file);

        } else if (ext === "xlsx" || ext === "xls") {
            const reader = new FileReader();
            reader.onload = e => {
                try {
                    const workbook = XLSX.read(e.target.result, { type: "array" });
                    let allText = "";
                    workbook.SheetNames.forEach(sheetName => {
                        const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]);
                        if (csv.trim()) allText += `--- Sheet: ${sheetName} ---\n${csv}\n\n`;
                    });
                    state.uploadedFileContent = allText || "[Empty spreadsheet]";
                    state.uploadedFileName    = file.name;
                    setStatus(`✓ Excel file loaded: ${file.name}`, "success");
                    render();
                } catch (err) {
                    setStatus(`Failed to read Excel file: ${err.message}`, "error");
                    render();
                }
            };
            reader.onerror = () => { setStatus("Failed to read file", "error"); render(); };
            reader.readAsArrayBuffer(file);

        } else if (ext === "pdf") {
            const reader = new FileReader();
            reader.onload = async e => {
                try {
                    const { text, pages } = await extractPdfText(e.target.result);
                    if (!text) {
                        setStatus("PDF appears to be scanned/image-only — no text could be extracted.", "error");
                        render();
                        return;
                    }
                    state.uploadedFileContent = text;
                    state.uploadedFileName    = file.name;
                    setStatus(`✓ PDF loaded: ${file.name} (${pages} page${pages !== 1 ? "s" : ""}, ~${Math.round(text.length / 4)} tokens)`, "success");
                    render();
                } catch (err) {
                    setStatus(`Failed to read PDF: ${err.message}`, "error");
                    render();
                }
            };
            reader.onerror = () => { setStatus("Failed to read PDF", "error"); render(); };
            reader.readAsArrayBuffer(file);

        } else {
            const reader = new FileReader();
            reader.onload = e => {
                state.uploadedFileContent = e.target.result;
                state.uploadedFileName    = file.name;
                setStatus(`✓ File loaded: ${file.name}`, "success");
                render();
            };
            reader.onerror = () => { setStatus("Failed to read file", "error"); render(); };
            reader.readAsText(file);
        }
    }


    // ─────────────────────────────────────────────
    // PANEL LIFECYCLE
    // ─────────────────────────────────────────────
    async function injectPanel() {
        if (panelInjected) return;
        panelInjected = true;
        panel = div({
            position: "fixed", top: "0", right: "0", width: PANEL_WIDTH,
            height: "100vh", background: "#f1f5f9", borderLeft: "1px solid #e2e8f0",
            zIndex: "999999", display: "flex", flexDirection: "column",
            boxShadow: "-6px 0 24px rgba(0,0,0,0.10)", fontFamily: "Inter, system-ui, Arial",
            boxSizing: "border-box", overflow: "hidden"
        });
        document.body.appendChild(panel);

        if (!state.apiKey) state.view = "setup";

        // Auto-detect course
        const courseId = detectCourseFromUrl();
        if (courseId) {
            await fetchCourseName(courseId);
            fetchAssignments(courseId); // loads async

            // Auto-select assignment if on SpeedGrader
            const assignId = detectAssignmentFromUrl();
            if (assignId) {
                state.selectedAssignmentId = assignId;
            }
        }

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

        const db = loadDB();

        // If we have auto-detected course, use it
        if (state.detectedCourseName) {
            state.selectedClass = state.detectedCourseName;
        } else {
            const classes = getClasses(db);
            if (!state.selectedClass && classes.length) state.selectedClass = classes[0];
        }

        // Sync selected assignment name from Canvas assignment
        if (state.selectedAssignmentId && state.canvasAssignments.length) {
            const ca = state.canvasAssignments.find(a => String(a.id) === String(state.selectedAssignmentId));
            if (ca) {
                state.selectedAssignmentName = ca.name;
                state.selectedAssignment = ca.name;
            }
        }

        // Check if we have a DB item for this assignment
        const assignments = getAssignments(db, state.selectedClass);
        if (!state.selectedAssignment && !state.selectedAssignmentId) {
            if (assignments.length) state.selectedAssignment = assignments[0];
        }

        panel.appendChild(buildTopBar());

        const content = div({ flex: "1", overflowY: "auto", display: "flex", flexDirection: "column" });
        if      (state.view === "setup")    content.appendChild(buildSetupView());
        else if (state.view === "grade")    content.appendChild(buildGradeView(db));
        else if (state.view === "results")  content.appendChild(buildResultsView());
        else if (state.view === "help")     content.appendChild(buildHelpView());
        else if (state.view === "settings") content.appendChild(buildSettingsEditorView());
        panel.appendChild(content);
    }

    // ─────────────────────────────────────────────
    // TOP BAR
    // ─────────────────────────────────────────────
    function buildTopBar() {
        const bar = div({
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "0 14px", height: "52px", background: "#1e3a5f",
            color: "#fff", flexShrink: "0"
        });

        const left = div({ display: "flex", alignItems: "center", gap: "10px" });
        left.appendChild(div({
            width: "30px", height: "30px", borderRadius: "8px", background: "#2563eb",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: "700", fontSize: "13px", color: "#fff"
        }, { textContent: "AI" }));
        const titleMap = {
            setup: "Setup",
            help: "Help",
            results: "Grading Results",
            settings: "Assignment Settings",
            grade: "AI Grader",
        };
        left.appendChild(div({ fontWeight: "700", fontSize: "15px" }, {
            textContent: titleMap[state.view] || "AI Grader"
        }));
        bar.appendChild(left);

        const right = div({ display: "flex", alignItems: "center", gap: "8px" });
        if (state.view !== "setup") {
            const gradeTab = navTab("Grade",  state.view === "grade",  () => { state.view = "grade"; render(); });
            const helpTab  = navTab("Help",   state.view === "help",   () => { state.view = "help";  render(); });
            const setupTab = navTab("⚙",      state.view === "setup",  () => { state.view = "setup"; render(); });
            setupTab.title = "API Key Settings";
            right.appendChild(gradeTab);
            right.appendChild(helpTab);
            right.appendChild(setupTab);
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
            background: active ? "#2563eb" : "rgba(255,255,255,0.1)",
            color: active ? "#fff" : "#cbd5e1", transition: "background 0.15s"
        }, { textContent: label });
        t.onclick = onClick;
        return t;
    }

    // ─────────────────────────────────────────────
    // SETUP VIEW
    // ─────────────────────────────────────────────
    function buildSetupView() {
        const wrap = div({ padding: "20px", display: "flex", flexDirection: "column", gap: "16px" });

        wrap.appendChild(div({
            background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: "10px",
            padding: "14px", fontSize: "13px", lineHeight: "1.6", color: "#1e40af"
        }, { innerHTML: `
            <strong>How to get your API key:</strong><br>
            1. Go to <strong>console.anthropic.com</strong><br>
            2. Sign up / log in<br>
            3. Click <strong>API Keys</strong> → <strong>Create Key</strong><br>
            4. Add $5 credit (lasts hundreds of gradings)<br>
            5. Paste your key below
        ` }));

        wrap.appendChild(div({
            background: "#f0fdf4", border: "1px solid #86efac", borderRadius: "10px",
            padding: "12px", fontSize: "12px", color: "#166534"
        }, { textContent: "Cost: ~$0.006 per paper on Sonnet 4.6. A $5 credit = ~800 papers graded." }));

        wrap.appendChild(div({ fontSize: "13px", fontWeight: "600", color: "#374151" }, { textContent: "Anthropic API Key" }));

        const keyInput = el("input", {
            padding: "10px 12px", borderRadius: "8px", border: "1px solid #d1d5db",
            fontSize: "13px", width: "100%", boxSizing: "border-box",
            fontFamily: "monospace", background: "#fff"
        }, { type: "password", placeholder: "sk-ant-api03-...", value: state.apiKey || "" });
        wrap.appendChild(keyInput);

        const toggle = el("button", {
            background: "none", border: "none", color: "#2563eb",
            fontSize: "12px", cursor: "pointer", padding: "0", textAlign: "left"
        }, { textContent: "Show key" });
        toggle.onclick = () => {
            keyInput.type = keyInput.type === "password" ? "text" : "password";
            toggle.textContent = keyInput.type === "password" ? "Show key" : "Hide key";
        };
        wrap.appendChild(toggle);

        wrap.appendChild(div(
            { fontSize: "13px", minHeight: "18px", color: statusColor(state.statusType) },
            { textContent: state.status }
        ));

        const saveBtn = btn("Save API Key & Start Grading", "#2563eb");
        saveBtn.style.width = "100%";
        saveBtn.onclick = () => {
            const key = keyInput.value.trim();
            if (!key.startsWith("sk-ant-")) {
                setStatus("Invalid key — must start with sk-ant-", "error");
                render();
                return;
            }
            state.apiKey = key;
            GM_setValue(APIKEY_KEY, key);
            setStatus("API key saved!", "success");
            state.view = "grade";
            render();
        };
        wrap.appendChild(saveBtn);

        if (state.apiKey) {
            const clearBtn = btn("Clear Saved Key", "#ef4444");
            clearBtn.style.width = "100%";
            clearBtn.onclick = () => {
                if (!confirm("Remove saved API key?")) return;
                state.apiKey = "";
                GM_deleteValue(APIKEY_KEY);
                setStatus("API key removed.", "idle");
                render();
            };
            wrap.appendChild(clearBtn);
        }
        return wrap;
    }

    // ─────────────────────────────────────────────
    // GRADE VIEW (enhanced with auto-detect)
    // ─────────────────────────────────────────────
    function buildGradeView(db) {
        const wrap = div({ display: "flex", flexDirection: "column", gap: "0" });

        // Course detection banner
        const courseSection = div({
            padding: "12px 14px", background: "#fff", borderBottom: "1px solid #e5e7eb",
            display: "flex", flexDirection: "column", gap: "8px"
        });

        if (state.detectedCourseId) {
            courseSection.appendChild(div({
                padding: "8px 12px", borderRadius: "8px",
                background: "#f0fdf4", border: "1px solid #86efac",
                fontSize: "12px", color: "#166534", display: "flex",
                alignItems: "center", gap: "6px"
            }, { innerHTML: `<strong>Course:</strong> ${escapeHtml(state.detectedCourseName || "Loading...")}` }));
        } else {
            courseSection.appendChild(div({
                padding: "8px 12px", borderRadius: "8px",
                background: "#fef2f2", border: "1px solid #fca5a5",
                fontSize: "12px", color: "#b91c1c"
            }, { textContent: "Navigate to a Canvas course page to auto-detect the course." }));

            // Fallback: manual class select from saved rubrics
            courseSection.appendChild(div({
                fontSize: "11px", fontWeight: "700", color: "#6b7280",
                textTransform: "uppercase", letterSpacing: "0.05em"
            }, { textContent: "Or select from saved rubrics" }));
            courseSection.appendChild(buildSelect(
                getClasses(db), state.selectedClass, "— Select Class —",
                value => { state.selectedClass = value; state.selectedAssignment = ""; state.suggestedGrade = ""; state.comments = []; setStatus("", "idle"); render(); }
            ));
        }

        // Assignment selector - pulled from Canvas API
        courseSection.appendChild(div({
            fontSize: "11px", fontWeight: "700", color: "#6b7280",
            textTransform: "uppercase", letterSpacing: "0.05em", marginTop: "4px"
        }, { textContent: "Assignment" }));

        if (state.detectedCourseId && state.assignmentsLoading) {
            courseSection.appendChild(div({
                padding: "8px 12px", borderRadius: "8px", background: "#eff6ff",
                border: "1px solid #bfdbfe", fontSize: "12px", color: "#1d4ed8"
            }, { textContent: "Loading assignments from Canvas..." }));
        } else if (state.detectedCourseId && state.canvasAssignments.length > 0) {
            // Canvas API assignment dropdown
            courseSection.appendChild(buildSelectWithIds(
                state.canvasAssignments,
                state.selectedAssignmentId,
                "— Select Assignment —",
                (id, assignment) => {
                    state.selectedAssignmentId = id;
                    state.selectedAssignmentName = assignment ? assignment.name : "";
                    state.selectedAssignment = assignment ? assignment.name : "";
                    state.suggestedGrade = "";
                    state.comments = [];
                    state.showSettings = false;

                    // Load grading settings for this assignment (by name, not ID)
                    if (assignment && assignment.name) {
                        state.gradingSettings = loadGradingSettings(assignment.name);
                        if (assignment.points_possible) {
                            state.gradingSettings.totalPoints = assignment.points_possible;
                        }
                    }

                    setStatus(assignment ? `Ready: ${assignment.name}` : "", "idle");
                    render();
                }
            ));
        } else if (!state.detectedCourseId) {
            // Fallback: select from saved DB assignments
            courseSection.appendChild(buildSelect(
                getAssignments(db, state.selectedClass), state.selectedAssignment, "— Select Assignment —",
                value => { state.selectedAssignment = value; state.suggestedGrade = ""; state.comments = []; setStatus(value ? `Ready: ${state.selectedClass} › ${value}` : "", "idle"); render(); }
            ));
        } else {
            courseSection.appendChild(div({
                padding: "6px 10px", borderRadius: "6px", background: "#fef2f2",
                border: "1px solid #fca5a5", fontSize: "12px", color: "#b91c1c"
            }, { textContent: "No assignments found in this course." }));
        }

        // Show assignment info if selected
        if (state.selectedAssignmentId) {
            const ca = state.canvasAssignments.find(a => String(a.id) === String(state.selectedAssignmentId));
            if (ca) {
                const infoText = [
                    ca.points_possible ? `${ca.points_possible} pts` : null,
                    ca.due_at ? `Due: ${new Date(ca.due_at).toLocaleDateString()}` : null,
                    ca.submission_types ? ca.submission_types.join(", ") : null,
                ].filter(Boolean).join(" | ");
                if (infoText) {
                    courseSection.appendChild(div({
                        padding: "6px 10px", borderRadius: "6px", background: "#eff6ff",
                        border: "1px solid #bfdbfe", fontSize: "12px", color: "#1d4ed8"
                    }, { textContent: infoText }));
                }
            }

            // Settings button
            const settingsBtn = btn("⚙ Grading Settings", "#64748b", "#fff", {
                width: "100%", boxSizing: "border-box", padding: "8px", fontSize: "12px", marginTop: "4px"
            });
            settingsBtn.onclick = () => {
                state.gradingSettings = loadGradingSettings(state.selectedAssignmentName || state.selectedAssignment);
                state.view = "settings";
                render();
            };
            courseSection.appendChild(settingsBtn);
        } else if (state.selectedAssignment && !state.detectedCourseId) {
            // Legacy: show rubric info from DB
            const item = getItem(db, state.selectedClass, state.selectedAssignment);
            if (item) {
                let rubric = {};
                try { rubric = JSON.parse(item.jsonText); } catch {}
                courseSection.appendChild(div({
                    padding: "6px 10px", borderRadius: "6px", background: "#eff6ff",
                    border: "1px solid #bfdbfe", fontSize: "12px", color: "#1d4ed8"
                }, { textContent: `${rubric.assignmentTitle || state.selectedAssignment}${rubric.totalPoints ? ` — ${rubric.totalPoints} pts` : ""}` }));
            }
        }
        wrap.appendChild(courseSection);

        // Submission detection
        const subSection = div({
            padding: "14px", background: "#fff", borderBottom: "1px solid #e5e7eb",
            display: "flex", flexDirection: "column", gap: "8px", marginTop: "8px"
        });
        subSection.appendChild(div({
            fontSize: "11px", fontWeight: "700", color: "#6b7280",
            textTransform: "uppercase", letterSpacing: "0.05em"
        }, { textContent: "Submission" }));

        const submissionText = getSubmissionText();
        const fileLinks = getAttachedFileLinks();

        subSection.appendChild(div({
            padding: "8px 10px", borderRadius: "8px",
            background: submissionText ? "#f0fdf4" : "#fef2f2",
            border: `1px solid ${submissionText ? "#86efac" : "#fca5a5"}`,
            fontSize: "12px", color: submissionText ? "#166534" : "#b91c1c"
        }, {
            textContent: submissionText
                ? `✓ Submission detected (${submissionText.length.toLocaleString()} chars)`
                : "No text submission detected"
        }));

        if (fileLinks.length) {
            fileLinks.forEach(f => {
                subSection.appendChild(div({
                    padding: "6px 10px", borderRadius: "6px", background: "#fffbeb",
                    border: "1px solid #fde68a", fontSize: "12px", color: "#92400e"
                }, { textContent: `Attached: ${f.name}` }));
            });
        }

        // File upload row
        const uploadRow = div({ display: "flex", alignItems: "center", gap: "8px" });
        uploadRow.appendChild(div({
            flex: "1", padding: "8px 12px", borderRadius: "8px",
            border: "1px dashed #94a3b8",
            background: state.uploadedFileName ? "#eff6ff" : "#f9fafb",
            fontSize: "12px", color: state.uploadedFileName ? "#1d4ed8" : "#6b7280",
            textAlign: "center", boxSizing: "border-box",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
        }, { textContent: state.uploadedFileName ? `${state.uploadedFileName}` : "No file selected" }));

        const uploadBtn = btn("Upload File", "#64748b", "#fff", {
            padding: "8px 12px", fontSize: "12px", flexShrink: "0", whiteSpace: "nowrap"
        });
        uploadBtn.onclick = () => {
            document.getElementById("aigrader-file-input")?.remove();
            const fileInput = document.createElement("input");
            fileInput.id = "aigrader-file-input";
            fileInput.type = "file";
            fileInput.accept = ".txt,.pdf,.doc,.docx,.csv,.json,.md,.xlsx,.xls";
            fileInput.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0;";
            fileInput.onchange = () => {
                const file = fileInput.files[0];
                fileInput.remove();
                if (file) handleFileUpload(file);
            };
            document.body.appendChild(fileInput);
            fileInput.click();
        };
        uploadRow.appendChild(uploadBtn);

        if (state.uploadedFileName) {
            const clearFile = btn("✕", "#ef4444", "#fff", { padding: "6px 10px", fontSize: "12px", flexShrink: "0" });
            clearFile.title = "Remove uploaded file";
            clearFile.onclick = () => {
                state.uploadedFileContent = "";
                state.uploadedFileName    = "";
                setStatus("", "idle");
                render();
            };
            uploadRow.appendChild(clearFile);
        }
        subSection.appendChild(uploadRow);
        wrap.appendChild(subSection);

        // Student name
        const studentName = getStudentName();
        const studentSection = div({
            padding: "10px 14px", background: "#fff", borderBottom: "1px solid #e5e7eb",
            marginTop: "8px", display: "flex", alignItems: "center", gap: "8px"
        });
        studentSection.appendChild(div({ fontSize: "12px", color: "#6b7280" }, { textContent: "Grading: " }));
        studentSection.appendChild(div({ fontSize: "13px", fontWeight: "600", color: "#111827" }, { textContent: studentName }));
        wrap.appendChild(studentSection);

        // Current grading settings summary
        if (state.selectedAssignmentName || state.selectedAssignment) {
            const settings = loadGradingSettings(state.selectedAssignmentName || state.selectedAssignment);
            const summaryParts = [
                `Intensity: ${settings.gradeIntensity || "balanced"}`,
                `Tone: ${settings.feedbackTone || "encouraging"}`,
                settings.acceptIntent ? "Accept intent" : null,
                settings.partialCredit ? "Partial credit" : null,
                settings.rubricText ? "Has rubric" : null,
                settings.answerKey ? "Has answer key" : null,
            ].filter(Boolean);

            const settingsSummary = div({
                padding: "8px 14px", background: "#f8fafc", borderBottom: "1px solid #e5e7eb",
                fontSize: "11px", color: "#64748b", lineHeight: "1.5"
            }, { textContent: summaryParts.join(" · ") });
            wrap.appendChild(settingsSummary);
        }

        // Grade button + status
        const actionSection = div({ padding: "14px", display: "flex", flexDirection: "column", gap: "10px", marginTop: "8px" });

        const gradeBtn = btn("Grade with Claude", "#2563eb", "#fff", {
            width: "100%", padding: "13px", fontSize: "14px",
            boxSizing: "border-box", boxShadow: "0 2px 8px rgba(37,99,235,0.3)"
        });
        gradeBtn.onclick = handleGrade;
        actionSection.appendChild(gradeBtn);

        if (state.status) {
            actionSection.appendChild(div({
                padding: "10px 12px", borderRadius: "8px", fontSize: "13px", lineHeight: "1.5",
                background: state.statusType === "error"   ? "#fef2f2"
                          : state.statusType === "loading" ? "#eff6ff"
                          : state.statusType === "success" ? "#f0fdf4" : "#f9fafb",
                color: statusColor(state.statusType),
                border: `1px solid ${
                    state.statusType === "error"   ? "#fca5a5" :
                    state.statusType === "loading" ? "#bfdbfe" :
                    state.statusType === "success" ? "#86efac" : "#e5e7eb"}`
            }, { textContent: state.status }));
        }

        if (state.statusType === "loading") {
            actionSection.appendChild(div({
                textAlign: "center", padding: "8px", fontSize: "13px", color: "#2563eb"
            }, { textContent: "Claude is grading... this takes 5-15 seconds" }));
        }

        if (state.suggestedGrade || state.comments.length) {
            const resultsBtn = btn("View Results →", "#166534", "#fff", { width: "100%", boxSizing: "border-box" });
            resultsBtn.onclick = () => { state.view = "results"; render(); };
            actionSection.appendChild(resultsBtn);
        }
        wrap.appendChild(actionSection);

        wrap.appendChild(div({
            margin: "8px 14px", padding: "12px", borderRadius: "8px",
            background: "#f8fafc", border: "1px solid #e2e8f0",
            fontSize: "12px", color: "#64748b", lineHeight: "1.6"
        }, { innerHTML: `
            <strong>Tips:</strong><br>
            • Select an assignment, then click "Grading Settings" to configure rubric, answer key, and intensity<br>
            • Upload PDF, Word, or Excel files — text is extracted automatically<br>
            • Claude returns a suggested grade + feedback comments<br>
            • Pick the comments you want and paste them into Canvas
        ` }));

        return wrap;
    }

    // ─────────────────────────────────────────────
    // GRADING SETTINGS EDITOR VIEW
    // ─────────────────────────────────────────────
    function buildSettingsEditorView() {
        const assignmentName = state.selectedAssignmentName || state.selectedAssignment || "Assignment";
        const settings = state.gradingSettings || loadGradingSettings(assignmentName);
        const wrap = div({ display: "flex", flexDirection: "column", height: "100%" });

        const scrollArea = div({ flex: "1", overflowY: "auto", padding: "14px", display: "flex", flexDirection: "column", gap: "14px" });

        // Assignment info
        const assignName = state.selectedAssignmentName || "Assignment";
        scrollArea.appendChild(div({
            padding: "10px 12px", borderRadius: "8px", background: "#eff6ff",
            border: "1px solid #bfdbfe", fontSize: "13px", color: "#1d4ed8", fontWeight: "600"
        }, { textContent: `Settings for: ${assignName}` }));

        // Shared-name info banner
        const dupes = getDuplicateSettingsNames(assignmentName);
        if (dupes.length > 1) {
            scrollArea.appendChild(div({
                padding: "10px 12px", borderRadius: "8px", background: "#fffbeb",
                border: "1px solid #fde68a", fontSize: "12px", color: "#92400e", lineHeight: "1.5"
            }, { innerHTML: `<strong>Shared settings:</strong> These settings are saved by assignment name and are shared across all classes that use an assignment called "<em>${escapeHtml(assignmentName)}</em>". Changes here will apply everywhere this assignment name appears.` }));
        }

        // --- Grade Intensity ---
        scrollArea.appendChild(buildSettingsCard("Grade Intensity", "How strict should the grading be?", () => {
            const card = div({ display: "flex", flexDirection: "column", gap: "8px" });
            ["lenient", "balanced", "strict"].forEach(level => {
                const descriptions = {
                    lenient: "Generous grading, benefit of the doubt",
                    balanced: "Fair and consistent grading",
                    strict: "Rigorous, high standards",
                };
                const row = div({
                    display: "flex", alignItems: "center", gap: "10px", padding: "8px 10px",
                    borderRadius: "8px", cursor: "pointer",
                    background: settings.gradeIntensity === level ? "#eff6ff" : "#fff",
                    border: `1px solid ${settings.gradeIntensity === level ? "#2563eb" : "#e5e7eb"}`,
                    transition: "all 0.15s"
                });
                const radio = el("input", { accentColor: "#2563eb" });
                radio.type = "radio";
                radio.name = "gradeIntensity";
                radio.checked = settings.gradeIntensity === level;
                row.onclick = () => { settings.gradeIntensity = level; render(); };
                row.appendChild(radio);
                const label = div({ display: "flex", flexDirection: "column" });
                label.appendChild(div({ fontSize: "13px", fontWeight: "600", color: "#111827", textTransform: "capitalize" }, { textContent: level }));
                label.appendChild(div({ fontSize: "11px", color: "#6b7280" }, { textContent: descriptions[level] }));
                row.appendChild(label);
                card.appendChild(row);
            });
            return card;
        }));

        // --- Feedback Tone ---
        scrollArea.appendChild(buildSettingsCard("Feedback Tone", "How should feedback be worded?", () => {
            const card = div({ display: "flex", flexDirection: "column", gap: "8px" });
            ["encouraging", "neutral", "direct"].forEach(tone => {
                const descriptions = {
                    encouraging: "Supportive, start with positives",
                    neutral: "Professional and objective",
                    direct: "Concise, focus on improvements",
                };
                const row = div({
                    display: "flex", alignItems: "center", gap: "10px", padding: "8px 10px",
                    borderRadius: "8px", cursor: "pointer",
                    background: settings.feedbackTone === tone ? "#eff6ff" : "#fff",
                    border: `1px solid ${settings.feedbackTone === tone ? "#2563eb" : "#e5e7eb"}`,
                    transition: "all 0.15s"
                });
                const radio = el("input", { accentColor: "#2563eb" });
                radio.type = "radio";
                radio.name = "feedbackTone";
                radio.checked = settings.feedbackTone === tone;
                row.onclick = () => { settings.feedbackTone = tone; render(); };
                row.appendChild(radio);
                const label = div({ display: "flex", flexDirection: "column" });
                label.appendChild(div({ fontSize: "13px", fontWeight: "600", color: "#111827", textTransform: "capitalize" }, { textContent: tone }));
                label.appendChild(div({ fontSize: "11px", color: "#6b7280" }, { textContent: descriptions[tone] }));
                row.appendChild(label);
                card.appendChild(row);
            });
            return card;
        }));

        // --- Total Points ---
        scrollArea.appendChild(buildSettingsCard("Total Points", "Maximum points for this assignment", () => {
            const input = el("input", {
                padding: "9px 12px", borderRadius: "8px", border: "1px solid #d1d5db",
                fontSize: "14px", width: "120px", boxSizing: "border-box", background: "#fff"
            }, { type: "number", value: String(settings.totalPoints || 100), min: "0", max: "10000" });
            input.oninput = () => { settings.totalPoints = parseInt(input.value) || 100; };
            return input;
        }));

        // --- Rubric Input ---
        scrollArea.appendChild(buildSettingsCard("Rubric / Grading Criteria", "Enter rubric criteria, point breakdowns, or grading guidelines", () => {
            const textarea = el("textarea", {
                width: "100%", minHeight: "120px", resize: "vertical",
                padding: "10px", border: "1px solid #d1d5db", borderRadius: "8px",
                fontFamily: "Inter, system-ui, Arial", fontSize: "13px",
                background: "#fff", color: "#1e293b", boxSizing: "border-box", lineHeight: "1.5"
            }, {
                value: settings.rubricText || "",
                placeholder: "Example:\n- Content & Understanding (40 pts): Student demonstrates clear understanding of key concepts\n- Organization (20 pts): Well-structured with logical flow\n- Grammar & Mechanics (20 pts): Proper spelling, grammar, punctuation\n- Citations (20 pts): Proper APA/MLA format"
            });
            textarea.oninput = () => { settings.rubricText = textarea.value; };
            return textarea;
        }));

        // --- Answer Key ---
        scrollArea.appendChild(buildSettingsCard("Answer Key", "Provide correct answers for comparison (optional)", () => {
            const textarea = el("textarea", {
                width: "100%", minHeight: "100px", resize: "vertical",
                padding: "10px", border: "1px solid #d1d5db", borderRadius: "8px",
                fontFamily: "Inter, system-ui, Arial", fontSize: "13px",
                background: "#fff", color: "#1e293b", boxSizing: "border-box", lineHeight: "1.5"
            }, {
                value: settings.answerKey || "",
                placeholder: "Example:\nQ1: The Civil War began in 1861\nQ2: Photosynthesis converts light energy to chemical energy\nQ3: The answer should mention supply and demand"
            });
            textarea.oninput = () => { settings.answerKey = textarea.value; };
            return textarea;
        }));

        // --- Suggested Comments ---
        scrollArea.appendChild(buildSettingsCard("Comment Suggestions", "Pre-written comments the AI can use or adapt (optional)", () => {
            const textarea = el("textarea", {
                width: "100%", minHeight: "80px", resize: "vertical",
                padding: "10px", border: "1px solid #d1d5db", borderRadius: "8px",
                fontFamily: "Inter, system-ui, Arial", fontSize: "13px",
                background: "#fff", color: "#1e293b", boxSizing: "border-box", lineHeight: "1.5"
            }, {
                value: settings.commentSuggestions || "",
                placeholder: "Example:\n- Great work on this assignment!\n- Please review the formatting guidelines\n- Consider adding more detail to your analysis\n- See me during office hours if you have questions"
            });
            textarea.oninput = () => { settings.commentSuggestions = textarea.value; };
            return textarea;
        }));

        // --- Accept Intent ---
        scrollArea.appendChild(buildSettingsCard("Grading Options", null, () => {
            const card = div({ display: "flex", flexDirection: "column", gap: "10px" });

            const intentRow = div({ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" });
            const intentCheck = el("input", { accentColor: "#2563eb" });
            intentCheck.type = "checkbox";
            intentCheck.checked = settings.acceptIntent !== false;
            intentCheck.onchange = () => { settings.acceptIntent = intentCheck.checked; };
            intentRow.appendChild(intentCheck);
            const intentLabel = div({});
            intentLabel.appendChild(div({ fontSize: "13px", fontWeight: "600", color: "#111827" }, { textContent: "Accept Intent" }));
            intentLabel.appendChild(div({ fontSize: "11px", color: "#6b7280" }, { textContent: "Give credit if the student conveys the correct meaning even with different wording" }));
            intentRow.appendChild(intentLabel);
            intentRow.onclick = (e) => { if (e.target !== intentCheck) { intentCheck.checked = !intentCheck.checked; settings.acceptIntent = intentCheck.checked; } };
            card.appendChild(intentRow);

            const partialRow = div({ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" });
            const partialCheck = el("input", { accentColor: "#2563eb" });
            partialCheck.type = "checkbox";
            partialCheck.checked = settings.partialCredit !== false;
            partialCheck.onchange = () => { settings.partialCredit = partialCheck.checked; };
            partialRow.appendChild(partialCheck);
            const partialLabel = div({});
            partialLabel.appendChild(div({ fontSize: "13px", fontWeight: "600", color: "#111827" }, { textContent: "Partial Credit" }));
            partialLabel.appendChild(div({ fontSize: "11px", color: "#6b7280" }, { textContent: "Award partial points for partially correct answers" }));
            partialRow.appendChild(partialLabel);
            partialRow.onclick = (e) => { if (e.target !== partialCheck) { partialCheck.checked = !partialCheck.checked; settings.partialCredit = partialCheck.checked; } };
            card.appendChild(partialRow);

            return card;
        }));

        // --- Focus Areas ---
        scrollArea.appendChild(buildSettingsCard("Focus Areas", "Specific areas to emphasize in feedback (optional)", () => {
            const textarea = el("textarea", {
                width: "100%", minHeight: "60px", resize: "vertical",
                padding: "10px", border: "1px solid #d1d5db", borderRadius: "8px",
                fontFamily: "Inter, system-ui, Arial", fontSize: "13px",
                background: "#fff", color: "#1e293b", boxSizing: "border-box", lineHeight: "1.5"
            }, {
                value: settings.focusAreas || "",
                placeholder: "Example: thesis statement clarity, use of evidence, transitions between paragraphs"
            });
            textarea.oninput = () => { settings.focusAreas = textarea.value; };
            return textarea;
        }));

        // --- Custom AI Instructions ---
        scrollArea.appendChild(buildSettingsCard("Custom AI Instructions", "Any additional instructions for the AI grader (optional)", () => {
            const textarea = el("textarea", {
                width: "100%", minHeight: "60px", resize: "vertical",
                padding: "10px", border: "1px solid #d1d5db", borderRadius: "8px",
                fontFamily: "Inter, system-ui, Arial", fontSize: "13px",
                background: "#fff", color: "#1e293b", boxSizing: "border-box", lineHeight: "1.5"
            }, {
                value: settings.customInstructions || "",
                placeholder: "Example: This is an ESL class, be lenient with grammar. Focus on content understanding."
            });
            textarea.oninput = () => { settings.customInstructions = textarea.value; };
            return textarea;
        }));

        wrap.appendChild(scrollArea);

        // Footer with save button
        const footer = div({
            padding: "12px 14px", borderTop: "1px solid #e5e7eb", background: "#f8fafc",
            display: "flex", flexDirection: "column", gap: "8px", flexShrink: "0"
        });

        const saveBtn = btn("Save Settings & Return to Grading", "#2563eb", "#fff", {
            width: "100%", boxSizing: "border-box", padding: "12px"
        });
        saveBtn.onclick = () => {
            // Check for duplicate assignment names across classes
            const dupes = getDuplicateSettingsNames(assignmentName);
            if (dupes.length > 0 && !hasGradingSettings(assignmentName)) {
                // First time saving under this name but other classes use it
                const msg = `Note: Grading settings are shared by assignment name.\n\n` +
                    `The following assignments share this name:\n` +
                    dupes.join("\n") + `\n\n` +
                    `Saving will apply these settings to ALL of them. Continue?`;
                if (!confirm(msg)) return;
            }
            saveGradingSettings(assignmentName, settings);
            state.gradingSettings = settings;
            state.view = "grade";
            setStatus("Grading settings saved!", "success");
            render();
        };
        footer.appendChild(saveBtn);

        const cancelBtn = btn("Cancel", "#e2e8f0", "#374151", {
            width: "100%", boxSizing: "border-box", padding: "10px", fontSize: "12px"
        });
        cancelBtn.onclick = () => { state.view = "grade"; render(); };
        footer.appendChild(cancelBtn);

        wrap.appendChild(footer);
        return wrap;
    }

    function buildSettingsCard(title, subtitle, buildContent) {
        const card = div({
            background: "#fff", border: "1px solid #e5e7eb", borderRadius: "10px",
            padding: "14px", display: "flex", flexDirection: "column", gap: "8px"
        });
        card.appendChild(div({ fontSize: "13px", fontWeight: "700", color: "#111827" }, { textContent: title }));
        if (subtitle) {
            card.appendChild(div({ fontSize: "11px", color: "#6b7280", marginTop: "-4px" }, { textContent: subtitle }));
        }
        card.appendChild(buildContent());
        return card;
    }

    // ─────────────────────────────────────────────
    // GRADE HANDLER (enhanced)
    // ─────────────────────────────────────────────
    function handleGrade() {
        if (!state.apiKey) {
            setStatus("No API key. Go to Settings to add your Anthropic API key.", "error");
            render(); return;
        }

        const db = loadDB();
        let item = null;
        let settings = getDefaultGradingSettings();

        if (state.selectedAssignmentId) {
            // Using Canvas-detected assignment — look up by name first, fall back to ID
            item = getItem(db, state.selectedClass, state.selectedAssignmentName) ||
                   getItemByAssignmentId(db, state.selectedAssignmentId);
            settings = loadGradingSettings(state.selectedAssignmentName);

            // If no rubric item in DB, create a minimal one
            if (!item) {
                item = {
                    id: makeId(),
                    className: state.selectedClass,
                    assignmentName: state.selectedAssignmentName,
                    canvasAssignmentId: state.selectedAssignmentId,
                    jsonText: JSON.stringify({
                        assignmentTitle: state.selectedAssignmentName,
                        totalPoints: settings.totalPoints || 100,
                    })
                };
            }
        } else if (state.selectedClass && state.selectedAssignment) {
            // Legacy: using saved rubric
            item = getItem(db, state.selectedClass, state.selectedAssignment);
            if (!item) {
                setStatus("No rubric found. Configure grading settings for this assignment.", "error");
                render(); return;
            }
        } else {
            setStatus("Please select an assignment first.", "error");
            render(); return;
        }

        const submissionText = getSubmissionText();
        const fileLinks      = getAttachedFileLinks();
        if (!submissionText && !state.uploadedFileContent && !fileLinks.length) {
            setStatus("No submission found. Try uploading the student's file.", "error");
            render(); return;
        }

        const studentName = getStudentName();
        const prompt = buildPrompt(item, studentName, settings);

        setStatus("Sending to Claude...", "loading");
        state.suggestedGrade = "";
        state.comments = [];
        render();

        callClaude(prompt,
            (parsed) => {
                state.suggestedGrade = parsed.grade || parsed.score || "—";
                state.comments = Array.isArray(parsed.comments)
                    ? parsed.comments.filter(Boolean)
                    : parsed.summary ? [parsed.summary] : [];
                if (parsed.summary && !state.comments.includes(parsed.summary)) {
                    state.comments.unshift(parsed.summary);
                }
                setStatus("Grading complete!", "success");
                state.view = "results";
                render();
            },
            (errMsg) => { setStatus(errMsg, "error"); render(); }
        );
    }

    // ─────────────────────────────────────────────
    // RESULTS VIEW
    // ─────────────────────────────────────────────
    function buildResultsView() {
        const wrap = div({ display: "flex", flexDirection: "column", height: "100%" });

        const gradeCard = div({
            margin: "14px", padding: "16px", borderRadius: "12px",
            background: "#1e3a5f", color: "#fff", display: "flex",
            flexDirection: "column", gap: "4px", boxShadow: "0 4px 12px rgba(30,58,95,0.3)"
        });
        gradeCard.appendChild(div({
            fontSize: "11px", fontWeight: "700", color: "#93c5fd",
            textTransform: "uppercase", letterSpacing: "0.08em"
        }, { textContent: "Suggested Grade" }));
        gradeCard.appendChild(div({ fontSize: "28px", fontWeight: "800", color: "#fff" }, { textContent: state.suggestedGrade || "—" }));
        gradeCard.appendChild(div({ fontSize: "12px", color: "#93c5fd" }, {
            textContent: `${state.detectedCourseName || state.selectedClass} › ${state.selectedAssignmentName || state.selectedAssignment}`
        }));
        wrap.appendChild(gradeCard);

        wrap.appendChild(div({
            padding: "0 14px 8px", fontSize: "11px", fontWeight: "700",
            color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em"
        }, { textContent: "Feedback Comments" }));

        const listWrap = div({ flex: "1", overflowY: "auto", padding: "0 14px 14px" });
        const comments = state.comments.filter(Boolean);

        if (!comments.length) {
            listWrap.appendChild(div({
                padding: "16px", textAlign: "center", color: "#9ca3af", fontSize: "13px"
            }, { textContent: "No comments returned." }));
        } else {
            const selectAllRow = div({ display: "flex", justifyContent: "space-between", marginBottom: "8px", alignItems: "center" });
            selectAllRow.appendChild(div({ fontSize: "13px", color: "#374151", fontWeight: "600" }, { textContent: `${comments.length} comments` }));
            const selectAllBtn = el("button", {
                fontSize: "12px", color: "#2563eb", background: "none",
                border: "none", cursor: "pointer", fontWeight: "600"
            }, { textContent: "Select all" });
            selectAllBtn.onclick = () => panel.querySelectorAll(".ai-comment-check").forEach(c => c.checked = true);
            selectAllRow.appendChild(selectAllBtn);
            listWrap.appendChild(selectAllRow);

            comments.forEach((commentText, i) => {
                const card = div({
                    background: "#fff", border: "1px solid #e5e7eb", borderRadius: "10px",
                    padding: "12px", marginBottom: "8px", display: "flex",
                    gap: "10px", alignItems: "flex-start", cursor: "pointer",
                    transition: "border-color 0.15s", boxShadow: "0 1px 4px rgba(0,0,0,0.05)"
                });
                card.onmouseenter = () => card.style.borderColor = "#93c5fd";
                card.onmouseleave = () => card.style.borderColor = "#e5e7eb";

                const check = el("input", { marginTop: "2px", flexShrink: "0", cursor: "pointer", accentColor: "#2563eb" });
                check.type = "checkbox";
                check.className = "ai-comment-check";
                check.dataset.index = String(i);
                check.checked = true;
                card.onclick = (e) => { if (e.target !== check) check.checked = !check.checked; };

                card.appendChild(check);
                card.appendChild(div({
                    fontSize: "13px", lineHeight: "1.6", whiteSpace: "pre-wrap", color: "#1e293b"
                }, { textContent: commentText }));
                listWrap.appendChild(card);
            });
        }
        wrap.appendChild(listWrap);

        const bottom = div({
            padding: "12px 14px", borderTop: "1px solid #e5e7eb", background: "#f8fafc",
            display: "flex", flexDirection: "column", gap: "8px", flexShrink: "0"
        });

        const pasteBtn = btn("Paste Selected to Canvas Comment", "#166534", "#fff", { width: "100%", boxSizing: "border-box", padding: "12px" });
        pasteBtn.onclick = handleCopyAndPaste;
        bottom.appendChild(pasteBtn);

        const copyOnlyBtn = btn("Copy to Clipboard Only", "#64748b", "#fff", { width: "100%", boxSizing: "border-box", padding: "10px", fontSize: "12px" });
        copyOnlyBtn.onclick = () => {
            const text = getSelectedComments();
            if (!text) { alert("Select at least one comment."); return; }
            navigator.clipboard.writeText(text).then(() => { setStatus("Copied to clipboard!", "success"); render(); });
        };
        bottom.appendChild(copyOnlyBtn);

        const backBtn = btn("← Grade Another Student", "#e2e8f0", "#374151", { width: "100%", boxSizing: "border-box", padding: "10px", fontSize: "12px" });
        backBtn.onclick = () => {
            state.view = "grade";
            state.suggestedGrade = "";
            state.comments = [];
            setStatus("", "idle");
            render();
        };
        bottom.appendChild(backBtn);

        if (state.status) {
            bottom.appendChild(div({
                fontSize: "12px", color: statusColor(state.statusType), textAlign: "center"
            }, { textContent: state.status }));
        }
        wrap.appendChild(bottom);
        return wrap;
    }

    function getSelectedComments() {
        return Array.from(panel.querySelectorAll(".ai-comment-check:checked"))
            .map(ch => state.comments[Number(ch.dataset.index)])
            .filter(Boolean)
            .join("\n\n");
    }

    function handleCopyAndPaste() {
        const text = getSelectedComments();
        if (!text) { alert("Select at least one comment first."); return; }
        const pasted = pasteToCanvasComment(text);
        navigator.clipboard.writeText(text).then(() => {
            setStatus(pasted ? "Pasted into Canvas & copied to clipboard!" : "Copied to clipboard! (Canvas comment box not found)", "success");
            render();
        }).catch(() => {
            setStatus(pasted ? "Pasted into Canvas comment box." : "Could not copy.", pasted ? "success" : "error");
            render();
        });
    }

    // ─────────────────────────────────────────────
    // HELP VIEW
    // ─────────────────────────────────────────────
    function buildHelpView() {
        const wrap = div({ flex: "1", overflowY: "auto", padding: "14px", display: "flex", flexDirection: "column", gap: "14px" });

        // Header
        wrap.appendChild(div({
            padding: "14px", borderRadius: "10px", background: "#1e3a5f",
            color: "#fff", textAlign: "center"
        }, { innerHTML: `<div style="font-size:24px;margin-bottom:4px;">🎓</div><div style="font-weight:700;font-size:15px;">AI Grader — Help Guide</div><div style="font-size:12px;color:#93c5fd;margin-top:4px;">Grade student submissions with Claude AI</div>` }));

        // Quick Start
        wrap.appendChild(buildHelpCard("🚀 Quick Start", `
            <ol style="margin:0;padding-left:18px;">
                <li><strong>Navigate to SpeedGrader</strong> — Open any assignment in Canvas SpeedGrader. The course and assignment will be auto-detected.</li>
                <li><strong>Open the AI Grader</strong> — Click the AI Grader button in your Canvas Dashboard.</li>
                <li><strong>Select the assignment</strong> — Choose the assignment from the dropdown (auto-populated from Canvas).</li>
                <li><strong>Configure settings</strong> — Click "⚙ Grading Settings" to set up your rubric and preferences.</li>
                <li><strong>Grade</strong> — Click "Grade with Claude" to get a suggested grade and feedback comments.</li>
                <li><strong>Paste feedback</strong> — Select the comments you want and paste them into the Canvas comment box.</li>
            </ol>
        `));

        // Setting Up Grading Criteria
        wrap.appendChild(buildHelpCard("📋 Setting Up Grading Criteria", `
            <p style="margin:0 0 8px;">Click <strong>"⚙ Grading Settings"</strong> after selecting an assignment. You can configure:</p>
            <ul style="margin:0;padding-left:18px;">
                <li><strong>Rubric / Grading Criteria</strong> — Enter your rubric as plain text. Be specific about what earns points.<br>
                    <em style="color:#6b7280;">Example:<br>
                    - Content & Understanding (40 pts): Demonstrates clear grasp of key concepts<br>
                    - Organization (20 pts): Logical structure with clear intro, body, conclusion<br>
                    - Grammar & Mechanics (20 pts): Proper spelling, grammar, punctuation<br>
                    - Citations (20 pts): Proper APA/MLA format with at least 3 sources</em></li>
                <li><strong>Answer Key</strong> — Provide correct answers so Claude can compare student responses.<br>
                    <em style="color:#6b7280;">Example:<br>
                    Q1: The Civil War began in 1861<br>
                    Q2: Photosynthesis converts light energy into chemical energy</em></li>
                <li><strong>Comment Suggestions</strong> — Pre-written comments Claude can use or adapt in feedback.</li>
                <li><strong>Custom AI Instructions</strong> — Special instructions for the AI grader.<br>
                    <em style="color:#6b7280;">Example: "This is an ESL class — be lenient with grammar. Focus on content understanding."</em></li>
            </ul>
        `));

        // Grading Options
        wrap.appendChild(buildHelpCard("⚖️ Grading Options", `
            <ul style="margin:0;padding-left:18px;">
                <li><strong>Grade Intensity</strong>
                    <ul style="padding-left:14px;">
                        <li><em>Lenient</em> — Generous, benefit of the doubt</li>
                        <li><em>Balanced</em> — Fair and consistent (default)</li>
                        <li><em>Strict</em> — Rigorous, high standards</li>
                    </ul>
                </li>
                <li><strong>Feedback Tone</strong>
                    <ul style="padding-left:14px;">
                        <li><em>Encouraging</em> — Supportive, starts with positives (default)</li>
                        <li><em>Neutral</em> — Professional and objective</li>
                        <li><em>Direct</em> — Concise, focuses on improvements</li>
                    </ul>
                </li>
                <li><strong>Accept Intent</strong> — Give credit when the student conveys the right meaning even with different wording.</li>
                <li><strong>Partial Credit</strong> — Award partial points for partially correct answers.</li>
                <li><strong>Focus Areas</strong> — Tell Claude to pay extra attention to specific aspects (e.g., "thesis clarity, use of evidence").</li>
            </ul>
        `));

        // Settings Persistence
        wrap.appendChild(buildHelpCard("💾 How Settings Are Saved", `
            <ul style="margin:0;padding-left:18px;">
                <li>Grading settings are <strong>saved by assignment name</strong>, not by Canvas ID.</li>
                <li>When you copy a course in Canvas, the new course gets new IDs — but since settings are saved by name, they <strong>automatically carry over</strong> to the copied class.</li>
                <li>If two different classes have an assignment with the same name, they will <strong>share the same grading settings</strong>. A warning banner will appear in the settings editor when this happens.</li>
                <li>Settings are stored locally in your browser via Tampermonkey — they are <strong>not</strong> synced to Canvas or the cloud.</li>
            </ul>
        `));

        // File Uploads
        wrap.appendChild(buildHelpCard("📄 Uploading Student Work", `
            <ul style="margin:0;padding-left:18px;">
                <li>If a student submitted a file attachment (PDF, Word, Excel), click <strong>"Upload File"</strong> to load it.</li>
                <li>Supported formats: <strong>PDF, DOCX, DOC, XLSX, XLS, TXT, CSV, JSON, MD</strong></li>
                <li>Text is automatically extracted from PDFs and Word/Excel documents.</li>
                <li>Max file size: <strong>20 MB</strong></li>
                <li>If the submission text is detected on the page, it will be used automatically — no upload needed.</li>
            </ul>
        `));

        // Tips
        wrap.appendChild(buildHelpCard("💡 Tips & Best Practices", `
            <ul style="margin:0;padding-left:18px;">
                <li>The more specific your rubric, the better Claude's grading will be.</li>
                <li>Use the <strong>Answer Key</strong> for objective assignments (quizzes, short answer) for most accurate grading.</li>
                <li>Use <strong>Comment Suggestions</strong> to maintain your personal voice in feedback.</li>
                <li>Always review Claude's suggested grade and comments before posting — AI is a helper, not a replacement.</li>
                <li>Cost is approximately <strong>$0.006 per paper</strong> on Claude Sonnet — a $5 credit grades ~800 papers.</li>
            </ul>
        `));

        // Troubleshooting
        wrap.appendChild(buildHelpCard("🔧 Troubleshooting", `
            <ul style="margin:0;padding-left:18px;">
                <li><strong>"No submission detected"</strong> — The student may have submitted a file attachment. Use the Upload File button to load it manually.</li>
                <li><strong>"No assignments found"</strong> — Make sure you're on a Canvas course page. Navigate to SpeedGrader for best results.</li>
                <li><strong>API errors</strong> — Check that your Anthropic API key is valid and has credit. Go to ⚙ Settings to update it.</li>
                <li><strong>PDF text extraction fails</strong> — The PDF may be scanned/image-only. Try copying text from the PDF manually.</li>
            </ul>
        `));

        return wrap;
    }

    function buildHelpCard(title, htmlContent) {
        const card = div({
            background: "#fff", border: "1px solid #e5e7eb", borderRadius: "10px",
            padding: "14px", display: "flex", flexDirection: "column", gap: "6px",
            boxShadow: "0 1px 4px rgba(0,0,0,0.05)"
        });
        card.appendChild(div({ fontSize: "14px", fontWeight: "700", color: "#111827" }, { textContent: title }));
        const body = div({ fontSize: "12px", color: "#374151", lineHeight: "1.7" });
        body.innerHTML = htmlContent.trim();
        card.appendChild(body);
        return card;
    }

    // ─────────────────────────────────────────────
    // INIT
    // ─────────────────────────────────────────────
    detectCourseFromUrl();

    // ─────────────────────────────────────────────
    // REGISTER WITH CANVAS DASHBOARD
    // ─────────────────────────────────────────────
    (function tryRegister() {
        if (unsafeWindow.CanvasDash) {
            unsafeWindow.CanvasDash.register({
                id:          "aigrader",
                name:        "AI Grader",
                icon:        "🎓",
                description: "Grade submissions with Claude AI in SpeedGrader",
                color:       "#c0392b",
                run:         injectPanel
            });
        } else {
            setTimeout(tryRegister, 100);
        }
    })();


})();
