// ==UserScript==
// @name         Canvas AI Module Builder (Direct API Insert)
// @namespace    https://github.com/MarkAlanBrest/canvas-module-builder
// @version      4.0.0
// @description  AI-powered Canvas LMS module builder — builds and inserts modules, pages, assignments & quizzes directly via Canvas API
// @author       MarkAlanBrest
// @match        *://*.instructure.com/courses/*
// @match        *://canvas.*.edu/courses/*
// @match        *://canvas.*.com/courses/*
// @match        *://*.canvas.*.edu/courses/*
// @match        *://*.instructure.com/*
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_deleteValue
// @grant        unsafeWindow
// @require      https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js
// @connect      api.anthropic.com
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/MarkAlanBrest/scripts/main/canvas-ai-module-builder-direct-api-insert-4.0.0-3-.user.js
// @updateURL    https://raw.githubusercontent.com/MarkAlanBrest/scripts/main/canvas-ai-module-builder-direct-api-insert-4.0.0-3-.user.js
// ==/UserScript==

(function () {
    "use strict";

    if (window.__CANVAS_MODULE_BUILDER__) return;
    window.__CANVAS_MODULE_BUILDER__ = true;
    if (window.top !== window.self) return;

    const APIKEY_KEY = "AIgrader_APIKey";
    const AI_MODEL_CONTENT = "claude-sonnet-4-5";
    const AI_MODEL_QUIZ = "claude-haiku-4-5-20251001";

    const ITEM_TYPES = {
        intro:{label:"Intro Page",icon:"\u{1F4D8}",group:"page"},
        content:{label:"Content Page",icon:"\u{1F4C4}",group:"page"},
        video:{label:"Video Page",icon:"\u{1F3AC}",group:"page"},
        reading:{label:"Reading Page",icon:"\u{1F4D6}",group:"page"},
        activity:{label:"Activity Page",icon:"\u{1F3AF}",group:"page"},
        discussion:{label:"Discussion Prompt",icon:"\u{1F4AC}",group:"page"},
        summary:{label:"Summary Page",icon:"\u{1F4CB}",group:"page"},
        resource:{label:"Resource Page",icon:"\u{1F517}",group:"page"},
        assignment:{label:"Assignment",icon:"\u{1F4DD}",group:"assessment"},
        quiz:{label:"Quiz",icon:"\u{1F4DD}",group:"assessment"},
        miniquiz:{label:"Mini Quiz",icon:"\u270F\uFE0F",group:"assessment"},
    };

    const MODULE_TEMPLATES = {
        standard:{label:"Standard Module",desc:"Balanced mix of content, assessment, and wrap-up",items:["intro","content","content","miniquiz","content","assignment","summary","quiz"]},
        quiz_heavy:{label:"Quiz-Heavy Module",desc:"Frequent knowledge checks throughout",items:["intro","content","miniquiz","content","miniquiz","content","summary","quiz"]},
        project_based:{label:"Project-Based Module",desc:"Focused on hands-on activities and project work",items:["intro","content","activity","content","activity","assignment","summary"]},
        discussion:{label:"Discussion-Based",desc:"Emphasizes peer interaction and discussion",items:["intro","content","discussion","content","discussion","content","summary"]},
        reading:{label:"Reading-Intensive",desc:"Heavy on reading with comprehension checks",items:["intro","reading","content","reading","miniquiz","reading","assignment","summary"]},
        custom:{label:"Custom (Start Empty)",desc:"Build your module from scratch",items:[]}
    };

    const PAGE_THEMES = {
        pastel:{name:"\u{1F338} Pastel / Soft",primary:"#7c3aed",secondary:"#a78bfa",bg:"#faf5ff",headerBg:"#ede9fe",accent:"#8b5cf6",text:"#1e1b4b",cardBg:"#f5f3ff",border:"#c4b5fd"},
        bold:{name:"\u26A1 Bold / Vibrant",primary:"#dc2626",secondary:"#f97316",bg:"#fff7ed",headerBg:"#fee2e2",accent:"#ea580c",text:"#1c1917",cardBg:"#fff1f2",border:"#fca5a5"},
        dark:{name:"\u{1F319} Dark / Professional",primary:"#0ea5e9",secondary:"#38bdf8",bg:"#0f172a",headerBg:"#1e293b",accent:"#7dd3fc",text:"#f1f5f9",cardBg:"#1e293b",border:"#334155"},
        earth:{name:"\u{1F33F} Earth Tones",primary:"#854d0e",secondary:"#a16207",bg:"#fefce8",headerBg:"#fef9c3",accent:"#ca8a04",text:"#1c1917",cardBg:"#fffbeb",border:"#fde68a"},
        custom:{name:"\u{1F3EB} School Colors",primary:"#1e3a5f",secondary:"#2563eb",bg:"#f0f7ff",headerBg:"#dbeafe",accent:"#3b82f6",text:"#111827",cardBg:"#eff6ff",border:"#bfdbfe"}
    };

    const DOK_MAP = {
        easy:{levels:[1,2],label:"Easy (DOK 1-2)",desc:"Recall & basic concepts"},
        medium:{levels:[2,3],label:"Medium (DOK 2-3)",desc:"Apply & analyze"},
        hard:{levels:[3,4],label:"Hard (DOK 3-4)",desc:"Strategic & extended thinking"}
    };

    const PAGE_EL = {
        emojiIcons:["Emoji Icons","Add relevant emojis to section headers"],
        sectionDividers:["Section Dividers","Visual breaks between sections"],
        tipBoxes:["Tip / Reminder Boxes","Highlighted boxes for important info"],
        imagePlaceholders:["Image Placeholders","Boxes where images can be inserted"],
        collapsible:["Collapsible Sections","Click-to-expand content areas"],
        quoteBoxes:["Quote / Highlight","Styled callout boxes"],
        alertBoxes:["Warning / Alert Boxes","Red/yellow alert boxes"],
    };

    const ASSIGN_EL = {
        numberedSteps:["Numbered Steps","Step-by-step directions"],
        checklist:["Checklist","Checkbox list students can follow"],
        rubricTable:["Rubric Table","Grading criteria table"],
        pointValue:["Point Value","Show total points"],
        dueDate:["Due Date","Show due date prominently"],
        videoEmbed:["Video Embed Placeholder","Box for a YouTube/video link"],
        watchFirst:["Watch Before You Begin","Video reminder at the top"],
    };

    let overlayEl = null;

    const state = {
        step: "setup",
        apiKey: "",
        modules: [],
        currentModuleIndex: 0,
        currentItemIndex: 0,
        itemData: {},
        status: "",
        statusType: "idle",
        insertProgress: null, // tracks insertion progress
    };

    try { state.apiKey = GM_getValue(APIKEY_KEY, ""); } catch(e) {}

    function curMod() { return state.modules[state.currentModuleIndex] || null; }
    function esc(s){var d=document.createElement("div");d.textContent=s||"";return d.innerHTML;}
    function uid(){return "cmb_"+Date.now().toString(36)+"_"+Math.random().toString(36).substr(2,6);}
    function saveApiKey(k){try{GM_setValue(APIKEY_KEY,k);}catch(e){}}

    function slugify(s){
        return (s||"untitled").toLowerCase()
            .replace(/[^a-z0-9\s-]/g,"")
            .replace(/\s+/g,"-")
            .replace(/-+/g,"-")
            .replace(/^-|-$/g,"")
            .substring(0,50)||"item";
    }

    // ========== COURSE ID EXTRACTION ==========

    function getCourseId(){
        var m = window.location.pathname.match(/\/courses\/(\d+)/);
        return m ? m[1] : null;
    }

    // ========== CANVAS API HELPERS ==========

    function getCSRFToken(){
        var match = document.cookie.match(/(?:^|;\s*)_csrf_token=([^;]+)/);
        if(match) return decodeURIComponent(match[1]);
        // Fallback: look for meta tag
        var meta = document.querySelector('meta[name="csrf-token"]');
        return meta ? meta.getAttribute("content") : "";
    }

    async function canvasAPI(method, path, body){
        var courseId = getCourseId();
        if(!courseId) throw new Error("Could not determine course ID from URL. Navigate to a course page first.");
        var url = "/api/v1/courses/" + courseId + path;
        var opts = {
            method: method,
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
                "X-CSRF-Token": getCSRFToken()
            },
            credentials: "same-origin"
        };
        if(body && (method === "POST" || method === "PUT")){
            opts.body = JSON.stringify(body);
        }
        var resp = await fetch(url, opts);
        if(!resp.ok){
            var errText = "";
            try { errText = await resp.text(); } catch(e){}
            throw new Error("Canvas API error " + resp.status + ": " + errText);
        }
        // Some endpoints return 204 No Content
        if(resp.status === 204) return null;
        return resp.json();
    }

    // ========== CANVAS API: CREATE FUNCTIONS ==========

    async function createModule(title, position){
        return canvasAPI("POST", "/modules", {
            module: {
                name: title,
                position: position,
                workflow_state: "active"
            }
        });
    }

    async function createPage(title, html){
        return canvasAPI("POST", "/pages", {
            wiki_page: {
                title: title,
                body: html,
                editing_roles: "teachers",
                published: false
            }
        });
    }

    async function createAssignment(title, html, pointValue){
        return canvasAPI("POST", "/assignments", {
            assignment: {
                name: title,
                description: html,
                submission_types: ["online_text_entry", "online_upload"],
                points_possible: parseFloat(pointValue) || 100,
                grading_type: "points",
                published: false
            }
        });
    }

    async function createQuiz(title, pointsPossible){
        return canvasAPI("POST", "/quizzes", {
            quiz: {
                title: title,
                quiz_type: "assignment",
                points_possible: pointsPossible,
                shuffle_answers: true,
                show_correct_answers: true,
                allowed_attempts: -1,
                scoring_policy: "keep_highest",
                published: false
            }
        });
    }

    async function createQuestionGroup(quizId, name, pickCount, pointsPerQuestion){
        return canvasAPI("POST", "/quizzes/" + quizId + "/groups", {
            quiz_groups: [{
                name: name,
                pick_count: pickCount,
                question_points: pointsPerQuestion
            }]
        });
    }

    async function createQuizQuestion(quizId, groupId, questionData){
        var payload = {
            question: {
                question_name: (questionData.question || "").slice(0, 60),
                question_text: "<p>" + esc(questionData.question || "") + "</p>",
                question_type: questionData._type,
                points_possible: questionData._points,
                quiz_group_id: groupId
            }
        };
        // Add answers for MC and TF
        if(questionData._type === "multiple_choice_question" || questionData._type === "true_false_question"){
            payload.question.answers = (questionData.answers || []).map(function(a, idx){
                return {
                    answer_text: a.text,
                    answer_weight: a.correct ? 100 : 0
                };
            });
        }
        // Short answer
        if(questionData._type === "short_answer_question" && questionData.answers && questionData.answers.length){
            payload.question.answers = questionData.answers.filter(function(a){return a.correct;}).map(function(a){
                return { answer_text: a.text, answer_weight: 100 };
            });
        }
        // Essay has no answers
        return canvasAPI("POST", "/quizzes/" + quizId + "/questions", payload);
    }

    async function addModuleItem(moduleId, itemType, contentIdOrUrl, title, position){
        var item = {
            module_item: {
                title: title,
                type: itemType,
                position: position
            }
        };
        // Canvas Pages require page_url, not content_id
        if(itemType === "Page"){
            item.module_item.page_url = contentIdOrUrl;
        } else {
            item.module_item.content_id = contentIdOrUrl;
        }
        return canvasAPI("POST", "/modules/" + moduleId + "/items", item);
    }

    // ========== INSERT ALL CONTENT ==========

    async function insertAllContent(progressCallback){
        var courseId = getCourseId();
        if(!courseId) throw new Error("Navigate to a Canvas course page first.");

        var totalSteps = 0;
        var completedSteps = 0;

        // Count total steps
        for(var mi = 0; mi < state.modules.length; mi++){
            totalSteps++; // creating the module
            var mod = state.modules[mi];
            for(var i = 0; i < mod.items.length; i++){
                var item = mod.items[i];
                var data = state.itemData[item.id] || {};
                totalSteps++; // creating the item
                if((item.type === "quiz" || item.type === "miniquiz") && data.generatedQuestions){
                    var groups = data.generatedQuestions.groups || [];
                    for(var g = 0; g < groups.length; g++){
                        totalSteps++; // creating each question group
                        totalSteps += (groups[g].questions || []).length; // creating each question
                    }
                }
            }
        }

        function report(msg){
            completedSteps++;
            if(progressCallback) progressCallback(completedSteps, totalSteps, msg);
        }

        var results = { modules: [], errors: [] };

        for(var mi = 0; mi < state.modules.length; mi++){
            var mod = state.modules[mi];
            var modTitle = mod.title || ("Module " + (mi + 1));

            // Create module
            var canvasMod;
            try {
                canvasMod = await createModule(modTitle, mi + 1);
                report("Created module: " + modTitle);
            } catch(err) {
                results.errors.push("Module '" + modTitle + "': " + err.message);
                report("ERROR creating module: " + modTitle);
                continue; // skip items in this module
            }

            results.modules.push({ title: modTitle, id: canvasMod.id, items: [] });
            var itemPosition = 0;

            for(var i = 0; i < mod.items.length; i++){
                var item = mod.items[i];
                var data = state.itemData[item.id] || {};
                var itemInfo = ITEM_TYPES[item.type] || {label:"Item", icon:"?"};
                var itemNum = i + 1;
                itemPosition++;

                try {
                    if(item.type === "quiz" || item.type === "miniquiz"){
                        // ---- QUIZ ----
                        var qTitle = data.quizTitle || (itemInfo.label + " " + itemNum);

                        if(!data.generatedQuestions || !data.generatedQuestions.groups){
                            report("Skipped (not built): " + qTitle);
                            results.modules[results.modules.length-1].items.push({ title: qTitle, status: "skipped" });
                            continue;
                        }

                        var groups = data.generatedQuestions.groups || [];
                        var totalPts = groups.reduce(function(sum, g){
                            return sum + (g.type==="mc"?1 : g.type==="tf"?1 : g.type==="sa"?5 : 10);
                        }, 0);

                        // Create quiz
                        var quiz = await createQuiz(qTitle, totalPts);
                        report("Created quiz: " + qTitle);

                        // Create question groups & questions
                        for(var gi = 0; gi < groups.length; gi++){
                            var grp = groups[gi];
                            var pts = grp.type==="mc"?1 : grp.type==="tf"?1 : grp.type==="sa"?5 : 10;
                            var qType = grp.type==="mc"?"multiple_choice_question" :
                                        grp.type==="tf"?"true_false_question" :
                                        grp.type==="essay"?"essay_question" : "short_answer_question";

                            // Create question group - pick 1 from each group
                            var groupResp = await createQuestionGroup(quiz.id, "Group " + (gi+1) + ": " + (grp.concept || grp.type), 1, pts);
                            var groupId = groupResp.quiz_groups ? groupResp.quiz_groups[0].id : (groupResp.id || null);
                            report("Created question group " + (gi+1) + " in " + qTitle);

                            // Create questions in the group
                            var qs = grp.questions || [];
                            for(var qi = 0; qi < qs.length; qi++){
                                var q = qs[qi];
                                q._type = qType;
                                q._points = pts;
                                await createQuizQuestion(quiz.id, groupId, q);
                                report("Added question V" + (qi+1) + " to group " + (gi+1));
                            }
                        }

                        // Add quiz to module
                        await addModuleItem(canvasMod.id, "Quiz", quiz.id, qTitle, itemPosition);
                        results.modules[results.modules.length-1].items.push({ title: qTitle, status: "inserted", type: "quiz" });

                    } else if(item.type === "assignment"){
                        // ---- ASSIGNMENT ----
                        var assignTitle = itemInfo.label + " " + itemNum;
                        var assignHtml = data.generatedHTML || "<p>Assignment content not yet generated.</p>";
                        var pts = data.pointValue || "100";

                        var assignment = await createAssignment(assignTitle, assignHtml, pts);
                        report("Created assignment: " + assignTitle);

                        // Add assignment to module
                        await addModuleItem(canvasMod.id, "Assignment", assignment.id, assignTitle, itemPosition);
                        results.modules[results.modules.length-1].items.push({ title: assignTitle, status: "inserted", type: "assignment" });

                    } else {
                        // ---- PAGE ----
                        var pageTitle = itemInfo.label + " " + itemNum;
                        var pageHtml = data.generatedHTML || "<p>Content not yet generated.</p>";

                        var page = await createPage(pageTitle, pageHtml);
                        report("Created page: " + pageTitle);

                        // Add page to module — Canvas Pages use page_url (the slug), not page_id
                        await addModuleItem(canvasMod.id, "Page", page.url, pageTitle, itemPosition);
                        results.modules[results.modules.length-1].items.push({ title: pageTitle, status: "inserted", type: "page" });
                    }
                } catch(err){
                    var errTitle = (item.type === "quiz" || item.type === "miniquiz") ? (data.quizTitle || itemInfo.label) :
                                   item.type === "assignment" ? (itemInfo.label + " " + itemNum) : (itemInfo.label + " " + itemNum);
                    results.errors.push(errTitle + ": " + err.message);
                    report("ERROR: " + errTitle);
                    results.modules[results.modules.length-1].items.push({ title: errTitle, status: "error", error: err.message });
                }
            }
        }

        return results;
    }

    // ========== FILE PARSING ==========

    async function parsePDF(file){
        return new Promise(function(res,rej){
            var r=new FileReader();
            r.onload=async function(e){
                try{
                    var ta=new Uint8Array(e.target.result);
                    var pdf=await pdfjsLib.getDocument({data:ta}).promise;
                    var t="";
                    for(var i=1;i<=pdf.numPages;i++){var pg=await pdf.getPage(i);var c=await pg.getTextContent();t+=c.items.map(function(x){return x.str;}).join(" ")+"\n\n";}
                    res(t.trim());
                }catch(err){rej(err);}
            };
            r.onerror=rej; r.readAsArrayBuffer(file);
        });
    }

    async function parseDOCX(file){
        return new Promise(function(res,rej){
            var r=new FileReader();
            r.onload=async function(e){
                try{var result=await mammoth.extractRawText({arrayBuffer:e.target.result});res(result.value.trim());}catch(err){rej(err);}
            };
            r.onerror=rej; r.readAsArrayBuffer(file);
        });
    }

    async function parseFile(file){
        var n=file.name.toLowerCase();
        if(n.endsWith(".pdf"))return parsePDF(file);
        if(n.endsWith(".docx"))return parseDOCX(file);
        return new Promise(function(res,rej){var r=new FileReader();r.onload=function(e){res(e.target.result);};r.onerror=rej;r.readAsText(file);});
    }

    // ========== ITEM DATA INIT ==========

    function initItemData(item){
        if(state.itemData[item.id])return;
        if(item.type==="quiz"||item.type==="miniquiz"){
            var m=item.type==="miniquiz";
            state.itemData[item.id]={quizTitle:m?"Mini Quiz":"Quiz",difficulty:"medium",mcCount:m?3:5,tfCount:m?2:3,saCount:m?0:2,essayCount:0,textContent:"",uploadedFile:"",uploadedName:"",generatedQuestions:null,subView:"build"};
        }else if(item.type==="assignment"){
            state.itemData[item.id]={contentType:"assignment",pageStyle:"pastel",customColor:"#1e3a5f",assignmentElements:{numberedSteps:true,checklist:false,rubricTable:false,pointValue:false,dueDate:false,videoEmbed:false,watchFirst:false},pointValue:"",dueDate:"",textContent:"",uploadedFile:"",uploadedName:"",generatedHTML:"",subView:"build"};
        }else{
            state.itemData[item.id]={contentType:"page",pageStyle:"pastel",customColor:"#1e3a5f",pageElements:{emojiIcons:true,sectionDividers:true,tipBoxes:true,imagePlaceholders:false,collapsible:false,quoteBoxes:false,alertBoxes:false},textContent:"",uploadedFile:"",uploadedName:"",generatedHTML:"",subView:"build"};
        }
    }

    // ========== CLAUDE API ==========

    function callClaude(prompt,model,maxTok){
        return new Promise(function(resolve,reject){
            if(!state.apiKey){reject(new Error("No API key"));return;}
            GM_xmlhttpRequest({
                method:"POST",url:"https://api.anthropic.com/v1/messages",
                headers:{"Content-Type":"application/json","x-api-key":state.apiKey,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},
                data:JSON.stringify({model:model||AI_MODEL_CONTENT,max_tokens:maxTok||4096,messages:[{role:"user",content:prompt}]}),
                timeout:120000,
                onload:function(resp){
                    var d;try{d=JSON.parse(resp.responseText);}catch(e){reject(new Error("Invalid response"));return;}
                    if(resp.status!==200){reject(new Error(d&&d.error?d.error.message:"HTTP "+resp.status));return;}
                    resolve(d&&d.content&&d.content[0]?d.content[0].text:"");
                },
                onerror:function(){reject(new Error("Network error"));},
                ontimeout:function(){reject(new Error("Timed out"));}
            });
        });
    }

    function getModuleSourceContext(){
        var mod=curMod();
        if(!mod||!mod.sources||!mod.sources.length)return "";
        return "\n\nMODULE SOURCE MATERIAL:\n"+mod.sources.map(function(s){return "--- "+s.name+" ---\n"+s.text.substring(0,8000);}).join("\n\n");
    }

    // ========== CONTENT BUILDER PROMPT ==========

    function buildContentPrompt(itemData,itemType){
        var isA=itemData.contentType==="assignment";
        var tk=itemData.pageStyle||"pastel";
        var theme=tk==="custom"?Object.assign({},PAGE_THEMES.custom,{primary:itemData.customColor||"#1e3a5f",secondary:itemData.customColor||"#1e3a5f"}):(PAGE_THEMES[tk]||PAGE_THEMES.pastel);
        var els=isA?(itemData.assignmentElements||{}):(itemData.pageElements||{});
        var typeLabel=ITEM_TYPES[itemType]?ITEM_TYPES[itemType].label:"Content Page";
        var p="You are an expert Canvas LMS content designer. Generate professional, visually beautiful HTML for a Canvas "+(isA?"assignment":"page")+" editor.\n\n";
        p+="PAGE TYPE: "+typeLabel+"\n\nDESIGN REQUIREMENTS\nColor Theme: "+(PAGE_THEMES[tk]?PAGE_THEMES[tk].name:"Pastel")+"\n";
        p+="Primary: "+theme.primary+" | Secondary: "+theme.secondary+" | BG: "+theme.bg+"\n";
        p+="Header BG: "+theme.headerBg+" | Accent: "+theme.accent+" | Text: "+theme.text+"\n";
        p+="Card BG: "+theme.cardBg+" | Border: "+theme.border+"\n\nELEMENTS TO INCLUDE\n";
        if(isA){
            if(els.watchFirst)p+="- Watch Before You Begin section at top with video placeholder\n";
            if(els.numberedSteps)p+="- Format directions as clearly numbered steps\n";
            if(els.checklist)p+="- Include student checklist with HTML checkboxes\n";
            if(els.rubricTable)p+="- Include styled rubric/grading criteria table\n";
            if(els.videoEmbed)p+="- Include video embed placeholder box\n";
            if(els.pointValue&&itemData.pointValue)p+="- Show total points: "+itemData.pointValue+"\n";
            if(els.dueDate&&itemData.dueDate)p+="- Show due date: "+itemData.dueDate+"\n";
        }else{
            if(els.emojiIcons)p+="- Add relevant emojis to section headers\n";
            if(els.sectionDividers)p+="- Include styled horizontal dividers between sections\n";
            if(els.tipBoxes)p+="- Include tip/reminder boxes for important info\n";
            if(els.imagePlaceholders)p+="- Include placeholder boxes where images can be inserted\n";
            if(els.collapsible)p+="- Include collapsible sections using details/summary tags\n";
            if(els.quoteBoxes)p+="- Include styled quote/highlight callout boxes\n";
            if(els.alertBoxes)p+="- Include warning/alert boxes\n";
        }
        p+="\nCONTENT\n";
        if(itemData.textContent&&itemData.textContent.trim())p+=itemData.textContent+"\n\n";
        if(itemData.uploadedFile)p+="FILE ("+itemData.uploadedName+"):\n"+itemData.uploadedFile+"\n\n";
        p+=getModuleSourceContext();
        p+="\n\nHTML REQUIREMENTS\n- Return ONLY the HTML body content, no explanations, no markdown\n- Do NOT include <html>, <head>, or <body> tags \u2014 body content only\n- Use only inline CSS styles (no style tags)\n- Start with a beautiful styled header/banner using theme colors\n- Use exact colors provided above\n- Professional and engaging for students\n- Web-safe fonts (Georgia, Arial, Verdana)\n- No JavaScript, no external images\n- Ready to paste into Canvas Rich Content Editor\n";
        return p;
    }

    // ========== QUIZ BUILDER PROMPT ==========

    function buildQuizPrompt(itemData){
        var dok=DOK_MAP[itemData.difficulty||"medium"];
        var p="You are an expert educator creating a Canvas LMS quiz with randomized question groups.\n\n";
        p+="QUIZ CONFIGURATION\nTitle: "+(itemData.quizTitle||"Quiz")+"\n";
        p+="Difficulty: "+dok.label+" - "+dok.desc+"\nDOK Levels: "+dok.levels.join(" and ")+"\n\nQUESTION GROUPS NEEDED:\n";
        if(itemData.mcCount>0)p+="- "+itemData.mcCount+" Multiple Choice x3 versions = "+(itemData.mcCount*3)+" MC total\n";
        if(itemData.tfCount>0)p+="- "+itemData.tfCount+" True/False x3 versions = "+(itemData.tfCount*3)+" TF total\n";
        if(itemData.saCount>0)p+="- "+itemData.saCount+" Short Answer x3 versions = "+(itemData.saCount*3)+" SA total\n";
        if(itemData.essayCount>0)p+="- "+itemData.essayCount+" Essay x3 versions = "+(itemData.essayCount*3)+" Essay total\n";
        p+="\nIMPORTANT - How groups work:\nEach group has exactly 3 versions of the SAME concept but worded differently.\nCanvas randomly picks ONE version from each group per student.\n\nCONTENT\n";
        if(itemData.textContent&&itemData.textContent.trim())p+=itemData.textContent+"\n\n";
        if(itemData.uploadedFile)p+="FILE ("+itemData.uploadedName+"):\n"+itemData.uploadedFile+"\n\n";
        p+=getModuleSourceContext();
        p+='\n\nRESPONSE FORMAT\nReturn ONLY a valid JSON object, no explanations, no markdown.\n\n{"quizTitle":"'+(itemData.quizTitle||"Quiz")+'","groups":[{"groupNumber":1,"type":"mc","concept":"Description","dokLevel":1,"questions":[{"version":1,"question":"Q?","answers":[{"text":"A","correct":true},{"text":"B","correct":false},{"text":"C","correct":false},{"text":"D","correct":false}]}]}]}\n\n';
        p+="RULES:\n- MC: exactly 4 choices, 1 correct\n- TF: exactly 2 answers: True and False\n- SA: no answers array\n- Essay: no answers array\n- Each group: exactly 3 question versions\n- Valid JSON only\n";
        return p;
    }

    // ========== CSS STYLES ==========

    var CSS = `
    #cmb-overlay{position:fixed;inset:0;z-index:100000;background:rgba(15,23,42,0.6);backdrop-filter:blur(4px);display:flex;justify-content:center;align-items:flex-start;overflow-y:auto;padding:30px 20px;font-family:system-ui,-apple-system,sans-serif;}
    #cmb-panel{background:#F8FAFC;border-radius:20px;max-width:1100px;width:100%;box-shadow:0 25px 50px rgba(0,0,0,0.2);overflow:hidden;display:flex;flex-direction:column;max-height:calc(100vh - 60px);}
    .cmb-topbar{background:linear-gradient(135deg,#7C3AED,#4C1D95);color:#fff;padding:18px 24px;display:flex;justify-content:space-between;align-items:center;}
    .cmb-topbar h1{margin:0;font-size:18px;font-weight:700;}
    .cmb-topbar-sub{font-size:12px;color:rgba(255,255,255,0.7);margin-top:2px;}
    .cmb-close{background:rgba(255,255,255,0.15);border:none;color:#fff;border-radius:8px;padding:6px 14px;cursor:pointer;font-size:13px;}
    .cmb-close:hover{background:rgba(255,255,255,0.25);}
    .cmb-stepbar{display:flex;gap:4px;padding:16px 24px 0;}
    .cmb-stepdot{flex:1;height:4px;border-radius:4px;background:#E2E8F0;transition:background 0.3s;}
    .cmb-stepdot.active{background:#7C3AED;}
    .cmb-stepdot.done{background:#10B981;}
    .cmb-body{flex:1;overflow-y:auto;padding:20px 24px 24px;}
    .cmb-status{padding:10px 24px;font-size:13px;border-top:1px solid #e5e7eb;}
    .cmb-card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,0.04);}
    .cmb-h2{font-size:18px;font-weight:700;color:#1E293B;margin:0 0 4px;}
    .cmb-desc{font-size:13px;color:#64748B;margin:0 0 16px;}
    .cmb-label{display:block;font-size:13px;font-weight:600;color:#1E293B;margin-bottom:4px;}
    .cmb-input,.cmb-select,.cmb-textarea{width:100%;padding:9px 12px;border:1px solid #CBD5E1;border-radius:8px;font-size:13px;color:#1E293B;background:#fff;box-sizing:border-box;font-family:inherit;}
    .cmb-input:focus,.cmb-select:focus,.cmb-textarea:focus{outline:none;border-color:#7C3AED;box-shadow:0 0 0 3px rgba(124,58,237,0.12);}
    .cmb-textarea{resize:vertical;min-height:80px;}
    .cmb-btn{display:inline-flex;align-items:center;gap:6px;padding:10px 20px;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;border:none;transition:transform 0.15s;}
    .cmb-btn:hover{transform:translateY(-1px);}
    .cmb-btn:disabled{opacity:0.5;cursor:not-allowed;transform:none;}
    .cmb-btn-primary{background:linear-gradient(135deg,#7C3AED,#6D28D9);color:#fff;box-shadow:0 4px 14px rgba(124,58,237,0.3);}
    .cmb-btn-secondary{background:#fff;color:#475569;border:1px solid #CBD5E1;}
    .cmb-btn-success{background:linear-gradient(135deg,#10B981,#059669);color:#fff;}
    .cmb-btn-ai{background:linear-gradient(135deg,#F59E0B,#D97706);color:#fff;box-shadow:0 4px 14px rgba(245,158,11,0.3);}
    .cmb-btn-danger{background:#fff;color:#EF4444;border:1px solid #FCA5A5;}
    .cmb-btn-row{display:flex;gap:10px;margin-top:16px;flex-wrap:wrap;}
    .cmb-tpl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;margin-bottom:16px;}
    .cmb-tpl-card{background:#fff;border:2px solid #E2E8F0;border-radius:12px;padding:14px;cursor:pointer;transition:border-color 0.2s;}
    .cmb-tpl-card:hover{border-color:#7C3AED;}
    .cmb-tpl-card.sel{border-color:#7C3AED;background:#F5F3FF;}
    .cmb-tpl-card h3{margin:0 0 4px;font-size:14px;}
    .cmb-tpl-card p{margin:0 0 8px;font-size:12px;color:#64748B;}
    .cmb-tpl-tags{display:flex;flex-wrap:wrap;gap:3px;}
    .cmb-tpl-tag{background:#EDE9FE;color:#6D28D9;font-size:10px;padding:2px 6px;border-radius:4px;font-weight:500;}
    .cmb-layout-list{list-style:none;padding:0;margin:0 0 16px;}
    .cmb-layout-item{display:flex;align-items:center;gap:10px;padding:10px 12px;background:#fff;border:1px solid #E2E8F0;border-radius:10px;margin-bottom:6px;cursor:grab;}
    .cmb-layout-item:hover{box-shadow:0 2px 8px rgba(0,0,0,0.08);}
    .cmb-layout-item .icon{font-size:18px;}
    .cmb-layout-item .lbl{flex:1;font-size:13px;font-weight:500;}
    .cmb-layout-item .rm{color:#ef4444;cursor:pointer;font-size:16px;border:none;background:none;padding:4px;}
    .cmb-add-bar{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px;}
    .cmb-add-btn{font-size:11px;padding:5px 10px;border-radius:6px;cursor:pointer;border:1px solid #CBD5E1;background:#fff;color:#475569;}
    .cmb-add-btn:hover{background:#F5F3FF;border-color:#7C3AED;color:#7C3AED;}
    .cmb-build-wrap{display:flex;gap:16px;min-height:500px;}
    .cmb-sidebar{width:220px;flex-shrink:0;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:12px;overflow-y:auto;max-height:600px;}
    .cmb-sidebar-item{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:500;color:#475569;border:1px solid transparent;margin-bottom:4px;transition:all 0.15s;}
    .cmb-sidebar-item:hover{background:#F5F3FF;}
    .cmb-sidebar-item.active{background:#F5F3FF;border-color:#7C3AED;color:#7C3AED;}
    .cmb-sidebar-item .icon{font-size:14px;}
    .cmb-sidebar-item .done-badge{font-size:10px;margin-left:auto;}
    .cmb-content-area{flex:1;min-width:0;}
    .cmb-el-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;}
    .cmb-el-toggle{display:flex;align-items:center;gap:8px;padding:8px 10px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;cursor:pointer;font-size:12px;transition:border-color 0.2s;}
    .cmb-el-toggle:hover{border-color:#a78bfa;}
    .cmb-el-toggle.on{border-color:#7C3AED;background:#F5F3FF;}
    .cmb-el-toggle .dot{width:8px;height:8px;border-radius:50%;background:#CBD5E1;}
    .cmb-el-toggle.on .dot{background:#7C3AED;}
    .cmb-style-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin-bottom:12px;}
    .cmb-style-card{padding:10px;border:2px solid #e5e7eb;border-radius:10px;cursor:pointer;text-align:center;font-size:12px;font-weight:500;transition:border-color 0.2s;}
    .cmb-style-card:hover{border-color:#a78bfa;}
    .cmb-style-card.sel{border-color:#7C3AED;background:#F5F3FF;}
    .cmb-file-row{display:flex;gap:8px;align-items:center;margin-bottom:8px;}
    .cmb-file-chip{background:#EDE9FE;color:#6D28D9;padding:4px 10px;border-radius:6px;font-size:11px;display:flex;align-items:center;gap:4px;}
    .cmb-file-chip .x{cursor:pointer;font-weight:bold;}
    .cmb-tab-bar{display:flex;gap:0;margin-bottom:0;border-bottom:2px solid #e5e7eb;}
    .cmb-tab{padding:8px 16px;cursor:pointer;font-size:13px;font-weight:500;color:#64748B;border-bottom:2px solid transparent;margin-bottom:-2px;}
    .cmb-tab.active{color:#7C3AED;border-bottom-color:#7C3AED;}
    .cmb-preview-frame{width:100%;min-height:400px;border:1px solid #e5e7eb;border-radius:0 0 8px 8px;background:#fff;}
    .cmb-code-area{width:100%;min-height:400px;font-family:monospace;font-size:12px;border:1px solid #e5e7eb;border-radius:0 0 8px 8px;padding:10px;box-sizing:border-box;resize:vertical;}
    .cmb-diff-grid{display:flex;gap:8px;margin-bottom:12px;}
    .cmb-diff-btn{flex:1;padding:10px;border-radius:10px;cursor:pointer;text-align:center;font-weight:600;font-size:13px;border:2px solid #e5e7eb;background:#fff;transition:border-color 0.2s;}
    .cmb-diff-btn:hover{border-color:#a78bfa;}
    .cmb-diff-btn.sel{border-color:#7C3AED;background:#F5F3FF;}
    .cmb-qmix-row{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f1f5f9;}
    .cmb-qmix-row .qlabel{flex:1;font-size:13px;font-weight:500;}
    .cmb-qmix-row .qcount{display:flex;align-items:center;gap:6px;}
    .cmb-qmix-row .qcount button{width:24px;height:24px;border-radius:6px;border:1px solid #CBD5E1;background:#fff;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;}
    .cmb-qmix-row .qcount button:hover{background:#F5F3FF;}
    .cmb-qmix-row .qcount span{min-width:20px;text-align:center;font-weight:600;font-size:14px;}
    .cmb-group-card{background:#fff;border:1px solid #e5e7eb;border-radius:10px;margin-bottom:12px;overflow:hidden;}
    .cmb-group-header{padding:10px 14px;font-size:13px;font-weight:600;color:#fff;display:flex;justify-content:space-between;align-items:center;}
    .cmb-group-body{padding:12px 14px;}
    .cmb-q-block{margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid #f1f5f9;}
    .cmb-q-block:last-child{border-bottom:none;margin-bottom:0;padding-bottom:0;}
    .cmb-ver-badge{font-size:10px;font-weight:600;padding:2px 6px;border-radius:4px;color:#fff;}
    .cmb-q-text{width:100%;border:1px solid #e5e7eb;border-radius:6px;padding:6px 8px;font-size:12px;min-height:40px;resize:vertical;font-family:inherit;margin:6px 0;}
    .cmb-ans-row{display:flex;align-items:center;gap:6px;margin-bottom:4px;font-size:12px;}
    .cmb-ans-dot{width:14px;height:14px;border-radius:50%;border:2px solid #CBD5E1;cursor:pointer;flex-shrink:0;}
    .cmb-ans-dot.correct{background:#10B981;border-color:#10B981;}
    .cmb-ans-input{flex:1;border:1px solid #e5e7eb;border-radius:4px;padding:4px 6px;font-size:12px;}
    .cmb-insert-item{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px;}
    .cmb-insert-item .icon{font-size:16px;}
    .cmb-insert-item .status{font-size:11px;padding:2px 6px;border-radius:4px;}
    .cmb-insert-item .status.ready{background:#D1FAE5;color:#065F46;}
    .cmb-insert-item .status.empty{background:#FEE2E2;color:#991B1B;}
    .cmb-insert-item .status.inserting{background:#DBEAFE;color:#1E40AF;}
    .cmb-insert-item .status.done{background:#D1FAE5;color:#065F46;}
    .cmb-insert-item .status.error{background:#FEE2E2;color:#991B1B;}
    .cmb-color-input{width:60px;height:30px;border:none;border-radius:6px;cursor:pointer;padding:0;}
    .cmb-import-steps{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:14px;margin-top:12px;}
    .cmb-import-steps h4{margin:0 0 8px;font-size:13px;font-weight:700;color:#065F46;}
    .cmb-import-steps ol{margin:0;padding-left:18px;}
    .cmb-import-steps li{font-size:12px;color:#065F46;margin-bottom:4px;line-height:1.5;}
    .cmb-mod-tabs{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;}
    .cmb-mod-tab{display:inline-flex;align-items:center;gap:4px;padding:5px 12px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:500;border:1px solid #e2e8f0;background:#fff;color:#475569;transition:border-color 0.2s;}
    .cmb-mod-tab:hover{border-color:#a78bfa;}
    .cmb-mod-tab.active{border-color:#7C3AED;background:#F5F3FF;color:#7C3AED;}
    .cmb-mod-del{font-size:13px;font-weight:bold;color:#94a3b8;cursor:pointer;padding:0 2px;line-height:1;}
    .cmb-mod-del:hover{color:#ef4444;}
    .cmb-mod-divider{height:1px;background:#e5e7eb;margin:8px 0;}
    .cmb-progress-bar{width:100%;background:#E2E8F0;border-radius:8px;height:8px;overflow:hidden;margin:12px 0;}
    .cmb-progress-fill{height:100%;background:linear-gradient(90deg,#7C3AED,#10B981);border-radius:8px;transition:width 0.3s;}
    .cmb-progress-log{max-height:200px;overflow-y:auto;background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;padding:10px;font-size:11px;font-family:monospace;color:#475569;margin-top:8px;}
    .cmb-progress-log div{padding:2px 0;}
    .cmb-progress-log .error{color:#EF4444;}
    .cmb-progress-log .success{color:#10B981;}
    `;

    // ========== RENDER SYSTEM ==========

    function render(){
        if(!overlayEl)return;
        var panel=overlayEl.querySelector("#cmb-panel");
        if(!panel)return;
        var body=panel.querySelector(".cmb-body");
        if(!body)return;
        body.innerHTML="";
        renderStepBar(panel);
        switch(state.step){
            case "setup": renderSetup(body); break;
            case "layout": renderLayout(body); break;
            case "build": renderBuild(body); break;
            case "insert": renderInsert(body); break;
        }
        renderStatus(panel);
    }

    function renderStepBar(panel){
        var bar=panel.querySelector(".cmb-stepbar");
        if(!bar)return;
        var steps=["setup","layout","build","insert"];
        var ci=steps.indexOf(state.step);
        bar.innerHTML="";
        for(var i=0;i<steps.length;i++){
            var d=document.createElement("div");
            d.className="cmb-stepdot"+(i<ci?" done":"")+(i===ci?" active":"");
            bar.appendChild(d);
        }
    }

    function renderStatus(panel){
        var el=panel.querySelector(".cmb-status");
        if(!el)return;
        if(!state.status){el.style.display="none";return;}
        el.style.display="block";
        var colors={success:"#166534",error:"#b91c1c",loading:"#1d4ed8",idle:"#6b7280"};
        var bgs={success:"#f0fdf4",error:"#fef2f2",loading:"#eff6ff",idle:"#f9fafb"};
        el.style.color=colors[state.statusType]||"#6b7280";
        el.style.background=bgs[state.statusType]||"#f9fafb";
        el.textContent=state.status;
    }

    // ========== SETUP VIEW ==========

    function renderSetup(body){
        var courseId = getCourseId();
        var h='<h2 class="cmb-h2">Setup</h2>';
        h+='<p class="cmb-desc">Enter your Claude API key to get started. Content will be inserted directly into your current Canvas course via the API.</p>';

        if(courseId){
            h+='<div class="cmb-card" style="background:#f0fdf4;border-color:#bbf7d0;"><div style="font-size:13px;color:#065F46;font-weight:600;">\u2705 Course Detected: ID ' + courseId + '</div>';
            h+='<div style="font-size:11px;color:#065F46;margin-top:4px;">Modules, pages, assignments, and quizzes will be inserted directly into this course.</div></div>';
        } else {
            h+='<div class="cmb-card" style="background:#fef2f2;border-color:#fca5a5;"><div style="font-size:13px;color:#991B1B;font-weight:600;">\u26A0\uFE0F No Course Detected</div>';
            h+='<div style="font-size:11px;color:#991B1B;margin-top:4px;">Navigate to a Canvas course page (e.g., /courses/12345) before inserting content.</div></div>';
        }

        h+='<div class="cmb-card"><label class="cmb-label">Claude API Key</label>';
        h+='<input type="password" class="cmb-input" id="cmb-apikey" placeholder="sk-ant-..." value="'+esc(state.apiKey)+'">';
        h+='<div style="font-size:11px;color:#94A3B8;margin-top:4px;">Get a key at <a href="https://console.anthropic.com/settings/keys" target="_blank">console.anthropic.com</a></div></div>';
        h+='<div class="cmb-btn-row"><button class="cmb-btn cmb-btn-primary" id="cmb-next-layout">Next: Design Modules &rarr;</button></div>';
        body.innerHTML=h;

        body.querySelector("#cmb-apikey").addEventListener("input",function(e){state.apiKey=e.target.value;saveApiKey(state.apiKey);});
        body.querySelector("#cmb-next-layout").addEventListener("click",function(){
            if(!state.apiKey){state.status="Please enter your Claude API key first.";state.statusType="error";renderStatus(overlayEl.querySelector("#cmb-panel"));return;}
            state.step="layout";render();
        });
    }

    // ========== LAYOUT VIEW ==========

    function renderLayout(body){
        if(state.modules.length===0){
            state.modules.push({id:uid(),title:"Module 1",sources:[],items:[]});
            state.currentModuleIndex=0;
        }
        var mod=curMod();

        var h='<h2 class="cmb-h2">Module Layout</h2>';
        h+='<p class="cmb-desc">Build multiple modules. Each module has its own title, source material, and items. All will be inserted directly into Canvas.</p>';

        h+='<div class="cmb-card">';
        h+='<div style="display:flex;align-items:center;gap:10px;">';
        h+='<label class="cmb-label" style="margin:0;">Modules</label>';
        h+='<button class="cmb-btn cmb-btn-secondary" id="cmb-add-module" style="padding:4px 14px;font-size:12px;">+ Add Module</button>';
        h+='</div>';
        h+='<div class="cmb-mod-tabs">';
        for(var m=0;m<state.modules.length;m++){
            var isActive=m===state.currentModuleIndex;
            h+='<div class="cmb-mod-tab'+(isActive?' active':'')+'" data-mod="'+m+'">';
            h+='\u{1F4E6} '+esc(state.modules[m].title||'Module '+(m+1));
            if(state.modules.length>1) h+=' <span class="cmb-mod-del" data-mod="'+m+'">&times;</span>';
            h+='</div>';
        }
        h+='</div></div>';

        h+='<div class="cmb-card">';
        h+='<label class="cmb-label">Module Title</label>';
        h+='<input type="text" class="cmb-input" id="cmb-modtitle" value="'+esc(mod.title||'')+'" placeholder="e.g. Chapter 3: Cell Biology">';
        h+='<div style="margin-top:14px;"><label class="cmb-label">Source Material (optional)</label>';
        h+='<div style="font-size:12px;color:#64748B;margin-bottom:8px;">Upload PDF, DOCX, or TXT to guide AI for this module.</div>';
        h+='<div class="cmb-file-row"><input type="file" id="cmb-srcfile" accept=".pdf,.docx,.txt,.md,.html" multiple style="font-size:12px;"></div>';
        h+='<div id="cmb-srclist" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">';
        for(var s=0;s<mod.sources.length;s++){
            h+='<div class="cmb-file-chip">'+esc(mod.sources[s].name)+' <span class="x" data-idx="'+s+'">&times;</span></div>';
        }
        h+='</div>';
        h+='<label class="cmb-label">Or paste text</label>';
        h+='<textarea class="cmb-textarea" id="cmb-srcpaste" rows="3" placeholder="Paste chapter text or notes..."></textarea>';
        h+='</div></div>';

        h+='<div style="font-size:14px;font-weight:700;color:#1E293B;margin-bottom:8px;">Choose a Template</div>';
        h+='<div class="cmb-tpl-grid">';
        var keys=Object.keys(MODULE_TEMPLATES);
        for(var i=0;i<keys.length;i++){
            var k=keys[i],t=MODULE_TEMPLATES[k];
            var tags=t.items.map(function(it){return'<span class="cmb-tpl-tag">'+(ITEM_TYPES[it]?ITEM_TYPES[it].icon+" "+ITEM_TYPES[it].label:it)+'</span>';}).join("");
            h+='<div class="cmb-tpl-card" data-tpl="'+k+'"><h3>'+esc(t.label)+'</h3><p>'+esc(t.desc)+'</p><div class="cmb-tpl-tags">'+tags+'</div></div>';
        }
        h+='</div>';

        if(mod.items.length>0){
            h+='<div class="cmb-card"><label class="cmb-label">Current Layout ('+mod.items.length+' items)</label>';
            h+='<ul class="cmb-layout-list">';
            for(var j=0;j<mod.items.length;j++){
                var it=mod.items[j],info=ITEM_TYPES[it.type]||{label:it.type,icon:"?"};
                h+='<li class="cmb-layout-item" data-idx="'+j+'" draggable="true"><span class="icon">'+info.icon+'</span><span class="lbl">'+esc(info.label)+'</span><button class="rm" data-idx="'+j+'">&times;</button></li>';
            }
            h+='</ul></div>';
        }

        h+='<div class="cmb-card"><label class="cmb-label">Add Items</label><div class="cmb-add-bar">';
        var addTypes=Object.keys(ITEM_TYPES);
        for(var a=0;a<addTypes.length;a++){
            var ai=ITEM_TYPES[addTypes[a]];
            h+='<button class="cmb-add-btn" data-type="'+addTypes[a]+'">'+ai.icon+' '+ai.label+'</button>';
        }
        h+='</div></div>';

        h+='<div class="cmb-btn-row">';
        h+='<button class="cmb-btn cmb-btn-secondary" id="cmb-back-setup">&larr; Back</button>';
        h+='<button class="cmb-btn cmb-btn-primary" id="cmb-next-build"'+(mod.items.length===0?' disabled':'')+'>Next: Build Items &rarr;</button>';
        h+='</div>';

        body.innerHTML=h;

        body.querySelectorAll(".cmb-mod-tab").forEach(function(tab){
            tab.addEventListener("click",function(e){
                if(e.target.classList.contains("cmb-mod-del"))return;
                state.currentModuleIndex=parseInt(tab.dataset.mod);render();
            });
        });
        body.querySelectorAll(".cmb-mod-del").forEach(function(btn){
            btn.addEventListener("click",function(e){
                e.stopPropagation();
                var idx=parseInt(btn.dataset.mod);
                state.modules.splice(idx,1);
                if(state.currentModuleIndex>=state.modules.length)state.currentModuleIndex=state.modules.length-1;
                render();
            });
        });
        body.querySelector("#cmb-add-module").addEventListener("click",function(){
            state.modules.push({id:uid(),title:"Module "+(state.modules.length+1),sources:[],items:[]});
            state.currentModuleIndex=state.modules.length-1;render();
        });
        body.querySelector("#cmb-modtitle").addEventListener("input",function(e){curMod().title=e.target.value;});
        body.querySelector("#cmb-srcfile").addEventListener("change",async function(e){
            var files=e.target.files;
            for(var i=0;i<files.length;i++){
                try{
                    state.status="Parsing "+files[i].name+"...";state.statusType="loading";renderStatus(overlayEl.querySelector("#cmb-panel"));
                    var text=await parseFile(files[i]);
                    curMod().sources.push({name:files[i].name,text:text});
                }catch(err){state.status="Error: "+err.message;state.statusType="error";}
            }
            state.status=curMod().sources.length+" source(s) loaded";state.statusType="success";render();
        });
        body.querySelector("#cmb-srcpaste").addEventListener("blur",function(e){
            if(e.target.value.trim()){
                var mod2=curMod();
                var exists=mod2.sources.find(function(s){return s.name==="Pasted Text";});
                if(exists){exists.text=e.target.value;}else{mod2.sources.push({name:"Pasted Text",text:e.target.value});}
                state.status="Text saved";state.statusType="success";renderStatus(overlayEl.querySelector("#cmb-panel"));
            }
        });
        body.querySelectorAll("#cmb-srclist .x").forEach(function(x){
            x.addEventListener("click",function(){curMod().sources.splice(parseInt(x.dataset.idx),1);render();});
        });
        body.querySelectorAll(".cmb-tpl-card").forEach(function(card){
            card.addEventListener("click",function(){
                var tpl=MODULE_TEMPLATES[card.dataset.tpl];
                if(!tpl)return;
                var mod3=curMod();
                mod3.items=tpl.items.map(function(t){var item={id:uid(),type:t};initItemData(item);return item;});
                state.currentItemIndex=0;render();
            });
        });
        body.querySelectorAll(".cmb-layout-item .rm").forEach(function(btn){
            btn.addEventListener("click",function(e){
                e.stopPropagation();
                var idx=parseInt(btn.dataset.idx);
                var removed=curMod().items.splice(idx,1)[0];
                if(removed)delete state.itemData[removed.id];render();
            });
        });
        body.querySelectorAll(".cmb-add-btn").forEach(function(btn){
            btn.addEventListener("click",function(){
                var item={id:uid(),type:btn.dataset.type};
                initItemData(item);curMod().items.push(item);render();
            });
        });
        var dragIdx=null;
        body.querySelectorAll(".cmb-layout-item").forEach(function(li){
            li.addEventListener("dragstart",function(){dragIdx=parseInt(li.dataset.idx);li.style.opacity="0.5";});
            li.addEventListener("dragend",function(){li.style.opacity="1";});
            li.addEventListener("dragover",function(e){e.preventDefault();});
            li.addEventListener("drop",function(e){
                e.preventDefault();
                var dropIdx=parseInt(li.dataset.idx);
                if(dragIdx!==null&&dragIdx!==dropIdx){
                    var arr=curMod().items;
                    var el=arr.splice(dragIdx,1)[0];
                    arr.splice(dropIdx,0,el);
                    render();
                }
            });
        });
        body.querySelector("#cmb-back-setup").addEventListener("click",function(){state.step="setup";render();});
        body.querySelector("#cmb-next-build").addEventListener("click",function(){
            if(!curMod()||curMod().items.length===0)return;
            for(var x=0;x<state.modules.length;x++){
                for(var y=0;y<state.modules[x].items.length;y++){
                    initItemData(state.modules[x].items[y]);
                }
            }
            state.currentModuleIndex=0;state.currentItemIndex=0;state.step="build";render();
        });
    }

    // ========== BUILD VIEW ==========

    function renderBuild(body){
        var allItems=[];
        for(var mi=0;mi<state.modules.length;mi++){
            var mod=state.modules[mi];
            for(var i=0;i<mod.items.length;i++){
                allItems.push({moduleIndex:mi,itemIndex:i,item:mod.items[i],modTitle:mod.title||"Module "+(mi+1)});
            }
        }
        if(allItems.length===0){state.step="layout";render();return;}

        var flatIdx=-1;
        var c=0;
        for(var x=0;x<allItems.length;x++){
            if(allItems[x].moduleIndex===state.currentModuleIndex&&allItems[x].itemIndex===state.currentItemIndex){flatIdx=x;break;}
        }
        if(flatIdx<0){flatIdx=0;state.currentModuleIndex=allItems[0].moduleIndex;state.currentItemIndex=allItems[0].itemIndex;}

        var h='<div class="cmb-build-wrap">';
        h+='<div class="cmb-sidebar">';
        var lastMod=-1;
        for(var s=0;s<allItems.length;s++){
            var ai=allItems[s];
            if(ai.moduleIndex!==lastMod){
                if(lastMod>=0) h+='<div class="cmb-mod-divider"></div>';
                h+='<div style="font-size:11px;font-weight:700;color:#7C3AED;padding:4px 10px;margin-bottom:2px;">\u{1F4E6} '+esc(ai.modTitle)+'</div>';
                lastMod=ai.moduleIndex;
            }
            var info=ITEM_TYPES[ai.item.type]||{label:ai.item.type,icon:"?"};
            var d=state.itemData[ai.item.id]||{};
            var done=(ai.item.type==="quiz"||ai.item.type==="miniquiz")?!!d.generatedQuestions:!!d.generatedHTML;
            var isActive=s===flatIdx;
            h+='<div class="cmb-sidebar-item'+(isActive?' active':'')+'" data-flat="'+s+'"><span class="icon">'+info.icon+'</span>'+esc(info.label);
            if(done) h+='<span class="done-badge">\u2705</span>';
            h+='</div>';
        }
        h+='</div>';
        h+='<div class="cmb-content-area" id="cmb-item-content"></div>';
        h+='</div>';

        h+='<div class="cmb-btn-row">';
        h+='<button class="cmb-btn cmb-btn-secondary" id="cmb-back-layout">&larr; Back to Layout</button>';
        if(flatIdx>0) h+='<button class="cmb-btn cmb-btn-secondary" id="cmb-prev-item">&larr; Previous</button>';
        if(flatIdx<allItems.length-1) h+='<button class="cmb-btn cmb-btn-primary" id="cmb-next-item">Next &rarr;</button>';
        h+='<button class="cmb-btn cmb-btn-success" id="cmb-go-insert">Review & Insert into Canvas &rarr;</button>';
        h+='</div>';

        body.innerHTML=h;

        var currentItemObj=allItems[flatIdx];
        var container=body.querySelector("#cmb-item-content");
        var item=currentItemObj.item;
        var dd=state.itemData[item.id];
        if(!dd){initItemData(item);dd=state.itemData[item.id];}
        if(item.type==="quiz"||item.type==="miniquiz"){renderQuizBuilder(container,item,dd);}
        else{renderContentBuilder(container,item,dd);}

        body.querySelectorAll(".cmb-sidebar-item").forEach(function(si){
            si.addEventListener("click",function(){
                var fi=parseInt(si.dataset.flat);
                state.currentModuleIndex=allItems[fi].moduleIndex;
                state.currentItemIndex=allItems[fi].itemIndex;
                render();
            });
        });
        body.querySelector("#cmb-back-layout").addEventListener("click",function(){state.step="layout";render();});
        var prevBtn=body.querySelector("#cmb-prev-item");
        if(prevBtn) prevBtn.addEventListener("click",function(){
            state.currentModuleIndex=allItems[flatIdx-1].moduleIndex;
            state.currentItemIndex=allItems[flatIdx-1].itemIndex;render();
        });
        var nextBtn=body.querySelector("#cmb-next-item");
        if(nextBtn) nextBtn.addEventListener("click",function(){
            state.currentModuleIndex=allItems[flatIdx+1].moduleIndex;
            state.currentItemIndex=allItems[flatIdx+1].itemIndex;render();
        });
        body.querySelector("#cmb-go-insert").addEventListener("click",function(){state.step="insert";state.insertProgress=null;render();});
    }

    // ========== CONTENT BUILDER ==========

    function renderContentBuilder(container,item,d){
        var info=ITEM_TYPES[item.type]||{label:"Page",icon:"?"};
        if(d.subView==="result"&&d.generatedHTML){renderContentResult(container,item,d);return;}
        var isA=d.contentType==="assignment";
        var h='<h2 class="cmb-h2">'+info.icon+' Build: '+esc(info.label)+'</h2>';
        h+='<p class="cmb-desc">Configure and generate this '+(isA?"assignment":"page")+' with AI. It will be inserted directly into Canvas.</p>';
        h+='<div class="cmb-card"><label class="cmb-label">Page Style</label><div class="cmb-style-grid">';
        var themes=Object.keys(PAGE_THEMES);
        for(var i=0;i<themes.length;i++){
            var tk=themes[i],t=PAGE_THEMES[tk];
            h+='<div class="cmb-style-card'+(d.pageStyle===tk?' sel':'')+'" data-style="'+tk+'" style="'+(d.pageStyle===tk?'border-color:'+t.primary:'')+'"><div style="font-size:16px;">'+t.name+'</div></div>';
        }
        h+='</div>';
        if(d.pageStyle==="custom"){
            h+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;"><label class="cmb-label" style="margin:0;">Primary Color</label><input type="color" class="cmb-color-input" id="cmb-custom-color" value="'+(d.customColor||"#1e3a5f")+'"></div>';
        }
        h+='</div>';
        h+='<div class="cmb-card"><label class="cmb-label">Elements</label><div class="cmb-el-grid">';
        var elMap=isA?ASSIGN_EL:PAGE_EL;
        var elData=isA?(d.assignmentElements||{}):(d.pageElements||{});
        var elKeys=Object.keys(elMap);
        for(var j=0;j<elKeys.length;j++){
            var ek=elKeys[j],ev=elMap[ek];
            h+='<div class="cmb-el-toggle'+(elData[ek]?' on':'')+'" data-el="'+ek+'"><div class="dot"></div><div><div style="font-weight:500;">'+ev[0]+'</div><div style="font-size:10px;color:#94A3B8;">'+ev[1]+'</div></div></div>';
        }
        h+='</div>';
        if(isA){
            h+='<div style="display:flex;gap:10px;margin-top:8px;">';
            h+='<div style="flex:1;"><label class="cmb-label">Points</label><input type="text" class="cmb-input" id="cmb-pts" value="'+esc(d.pointValue||"")+'" placeholder="100"></div>';
            h+='<div style="flex:1;"><label class="cmb-label">Due Date</label><input type="text" class="cmb-input" id="cmb-due" value="'+esc(d.dueDate||"")+'" placeholder="e.g. Friday 11:59pm"></div>';
            h+='</div>';
        }
        h+='</div>';
        h+='<div class="cmb-card"><label class="cmb-label">Content / Instructions</label>';
        h+='<div class="cmb-file-row"><input type="file" id="cmb-cfile" accept=".pdf,.docx,.txt" style="font-size:12px;">';
        if(d.uploadedName){h+='<div class="cmb-file-chip">'+esc(d.uploadedName)+' <span class="x" id="cmb-rm-file">&times;</span></div>';}
        h+='</div><textarea class="cmb-textarea" id="cmb-ctext" rows="3" placeholder="Describe what this page should contain...">'+esc(d.textContent||"")+'</textarea></div>';
        h+='<div class="cmb-btn-row"><button class="cmb-btn cmb-btn-ai" id="cmb-gen-content">\u2728 Generate with AI</button></div>';
        container.innerHTML=h;

        container.querySelectorAll(".cmb-style-card").forEach(function(sc){
            sc.addEventListener("click",function(){d.pageStyle=sc.dataset.style;render();});
        });
        var cc=container.querySelector("#cmb-custom-color");
        if(cc) cc.addEventListener("input",function(e){d.customColor=e.target.value;});
        container.querySelectorAll(".cmb-el-toggle").forEach(function(el){
            el.addEventListener("click",function(){
                var key=el.dataset.el;
                if(isA){d.assignmentElements[key]=!d.assignmentElements[key];}
                else{d.pageElements[key]=!d.pageElements[key];}
                render();
            });
        });
        var ptsInput=container.querySelector("#cmb-pts");
        if(ptsInput) ptsInput.addEventListener("input",function(e){d.pointValue=e.target.value;});
        var dueInput=container.querySelector("#cmb-due");
        if(dueInput) dueInput.addEventListener("input",function(e){d.dueDate=e.target.value;});
        container.querySelector("#cmb-ctext").addEventListener("input",function(e){d.textContent=e.target.value;});
        container.querySelector("#cmb-cfile").addEventListener("change",async function(e){
            if(!e.target.files.length)return;
            var f=e.target.files[0];
            try{
                state.status="Parsing "+f.name+"...";state.statusType="loading";renderStatus(overlayEl.querySelector("#cmb-panel"));
                d.uploadedFile=await parseFile(f);d.uploadedName=f.name;
                state.status="File loaded: "+f.name;state.statusType="success";render();
            }catch(err){state.status="Error: "+err.message;state.statusType="error";renderStatus(overlayEl.querySelector("#cmb-panel"));}
        });
        var rmFile=container.querySelector("#cmb-rm-file");
        if(rmFile)rmFile.addEventListener("click",function(){d.uploadedFile="";d.uploadedName="";render();});
        container.querySelector("#cmb-gen-content").addEventListener("click",async function(){
            if(!state.apiKey){state.status="Enter API key first";state.statusType="error";renderStatus(overlayEl.querySelector("#cmb-panel"));return;}
            if(!d.textContent&&!d.uploadedFile&&!(curMod()&&curMod().sources.length)){state.status="Add some content first";state.statusType="error";renderStatus(overlayEl.querySelector("#cmb-panel"));return;}
            state.status="Generating "+ITEM_TYPES[item.type].label+" with AI...";state.statusType="loading";renderStatus(overlayEl.querySelector("#cmb-panel"));
            var btn=container.querySelector("#cmb-gen-content");btn.disabled=true;btn.textContent="Generating...";
            try{
                var html=await callClaude(buildContentPrompt(d,item.type),AI_MODEL_CONTENT,4096);
                d.generatedHTML=html;d.subView="result";
                state.status="Content generated!";state.statusType="success";render();
            }catch(err){
                state.status="Error: "+err.message;state.statusType="error";
                btn.disabled=false;btn.textContent="\u2728 Generate with AI";
                renderStatus(overlayEl.querySelector("#cmb-panel"));
            }
        });
    }

    function renderContentResult(container,item,d){
        var info=ITEM_TYPES[item.type]||{label:"Page",icon:"?"};
        var h='<h2 class="cmb-h2">'+info.icon+' '+esc(info.label)+' - Result</h2>';
        h+='<div class="cmb-tab-bar"><div class="cmb-tab active" data-tab="preview">Preview</div><div class="cmb-tab" data-tab="code">HTML Code</div></div>';
        h+='<div id="cmb-result-content"></div>';
        h+='<div class="cmb-btn-row">';
        h+='<button class="cmb-btn cmb-btn-secondary" id="cmb-copy-html">Copy HTML</button>';
        h+='<button class="cmb-btn cmb-btn-ai" id="cmb-regen">Regenerate</button>';
        h+='<button class="cmb-btn cmb-btn-secondary" id="cmb-back-build">Back to Settings</button>';
        h+='</div>';
        container.innerHTML=h;
        var contentDiv=container.querySelector("#cmb-result-content");
        showPreviewTab(contentDiv,d.generatedHTML);
        container.querySelectorAll(".cmb-tab").forEach(function(tab){
            tab.addEventListener("click",function(){
                container.querySelectorAll(".cmb-tab").forEach(function(t){t.classList.remove("active");});
                tab.classList.add("active");
                if(tab.dataset.tab==="preview"){showPreviewTab(contentDiv,d.generatedHTML);}
                else{showCodeTab(contentDiv,d.generatedHTML);}
            });
        });
        container.querySelector("#cmb-copy-html").addEventListener("click",function(){
            navigator.clipboard.writeText(d.generatedHTML).then(function(){
                state.status="HTML copied!";state.statusType="success";renderStatus(overlayEl.querySelector("#cmb-panel"));
            });
        });
        container.querySelector("#cmb-regen").addEventListener("click",function(){d.subView="build";render();});
        container.querySelector("#cmb-back-build").addEventListener("click",function(){d.subView="build";render();});
    }

    function showPreviewTab(container,html){
        container.innerHTML='<iframe class="cmb-preview-frame" id="cmb-pframe"></iframe>';
        var frame=container.querySelector("#cmb-pframe");
        frame.onload=function(){
            try{var doc=frame.contentDocument||frame.contentWindow.document;doc.open();doc.write('<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:16px;font-family:Georgia,serif;">'+html+'</body></html>');doc.close();}catch(e){}
        };
        frame.src="about:blank";
    }

    function showCodeTab(container,html){
        container.innerHTML='<textarea class="cmb-code-area">'+esc(html)+'</textarea>';
    }

    // ========== QUIZ BUILDER ==========

    function renderQuizBuilder(container,item,d){
        var info=ITEM_TYPES[item.type]||{label:"Quiz",icon:"?"};
        if(d.subView==="preview"&&d.generatedQuestions){renderQuizPreview(container,item,d);return;}
        var h='<h2 class="cmb-h2">'+info.icon+' Build: '+esc(info.label)+'</h2>';
        h+='<p class="cmb-desc">Configure and generate quiz questions. Questions will be inserted directly into Canvas as a Classic Quiz with question groups.</p>';
        h+='<div class="cmb-card"><label class="cmb-label">Quiz Title</label>';
        h+='<input type="text" class="cmb-input" id="cmb-quiz-title" value="'+esc(d.quizTitle||"")+'" placeholder="Enter quiz title"></div>';
        h+='<div class="cmb-card"><label class="cmb-label">Difficulty Level</label><div class="cmb-diff-grid">';
        var diffs=[["easy","Easy","DOK 1-2","#10B981"],["medium","Medium","DOK 2-3","#F59E0B"],["hard","Hard","DOK 3-4","#EF4444"]];
        for(var i=0;i<diffs.length;i++){
            var df=diffs[i];
            h+='<div class="cmb-diff-btn'+(d.difficulty===df[0]?' sel':'')+'" data-diff="'+df[0]+'" style="'+(d.difficulty===df[0]?'border-color:'+df[3]+';background:'+df[3]+'15':'')+'">';
            h+='<div style="font-weight:700;">'+df[1]+'</div><div style="font-size:11px;color:#6b7280;">'+df[2]+'</div></div>';
        }
        h+='</div></div>';
        h+='<div class="cmb-card"><label class="cmb-label">Question Mix</label>';
        h+='<div style="font-size:11px;color:#64748B;margin-bottom:8px;">Each question generates 3 versions for randomized groups.</div>';
        var qTypes=[["mc","Multiple Choice",d.mcCount],["tf","True / False",d.tfCount],["sa","Short Answer",d.saCount],["essay","Essay",d.essayCount]];
        for(var j=0;j<qTypes.length;j++){
            var qt=qTypes[j];
            h+='<div class="cmb-qmix-row"><span class="qlabel">'+qt[1]+'</span><div class="qcount">';
            h+='<button data-qtype="'+qt[0]+'" data-dir="down">-</button><span>'+qt[2]+'</span><button data-qtype="'+qt[0]+'" data-dir="up">+</button>';
            h+='<span style="font-size:10px;color:#9ca3af;margin-left:4px;">= '+(qt[2]*3)+' versions</span></div></div>';
        }
        var total=d.mcCount+d.tfCount+d.saCount+d.essayCount;
        h+='<div style="margin-top:8px;font-size:12px;font-weight:600;color:#7C3AED;">Total: '+total+' questions &times; 3 = '+(total*3)+' versions</div></div>';
        h+='<div class="cmb-card"><label class="cmb-label">Quiz Content (optional)</label>';
        h+='<div class="cmb-file-row"><input type="file" id="cmb-qfile" accept=".pdf,.docx,.txt" style="font-size:12px;">';
        if(d.uploadedName){h+='<div class="cmb-file-chip">'+esc(d.uploadedName)+' <span class="x" id="cmb-qrm-file">&times;</span></div>';}
        h+='</div><textarea class="cmb-textarea" id="cmb-qtext" rows="3" placeholder="Paste content for quiz generation...">'+esc(d.textContent||"")+'</textarea></div>';
        h+='<div class="cmb-btn-row"><button class="cmb-btn cmb-btn-ai" id="cmb-gen-quiz">\u2728 Generate '+(total*3)+' Questions</button></div>';
        container.innerHTML=h;

        container.querySelector("#cmb-quiz-title").addEventListener("input",function(e){d.quizTitle=e.target.value;});
        container.querySelectorAll(".cmb-diff-btn").forEach(function(db){
            db.addEventListener("click",function(){d.difficulty=db.dataset.diff;render();});
        });
        container.querySelectorAll(".cmb-qmix-row button").forEach(function(btn){
            btn.addEventListener("click",function(){
                var qt=btn.dataset.qtype,dir=btn.dataset.dir;
                var key=qt==="mc"?"mcCount":qt==="tf"?"tfCount":qt==="sa"?"saCount":"essayCount";
                if(dir==="up")d[key]++;else if(d[key]>0)d[key]--;render();
            });
        });
        container.querySelector("#cmb-qtext").addEventListener("input",function(e){d.textContent=e.target.value;});
        container.querySelector("#cmb-qfile").addEventListener("change",async function(e){
            if(!e.target.files.length)return;
            var f=e.target.files[0];
            try{
                state.status="Parsing "+f.name+"...";state.statusType="loading";renderStatus(overlayEl.querySelector("#cmb-panel"));
                d.uploadedFile=await parseFile(f);d.uploadedName=f.name;
                state.status="File loaded: "+f.name;state.statusType="success";render();
            }catch(err){state.status="Error: "+err.message;state.statusType="error";renderStatus(overlayEl.querySelector("#cmb-panel"));}
        });
        var rmf=container.querySelector("#cmb-qrm-file");
        if(rmf)rmf.addEventListener("click",function(){d.uploadedFile="";d.uploadedName="";render();});
        container.querySelector("#cmb-gen-quiz").addEventListener("click",async function(){
            if(!state.apiKey){state.status="Enter API key first";state.statusType="error";renderStatus(overlayEl.querySelector("#cmb-panel"));return;}
            if(!d.textContent&&!d.uploadedFile&&!(curMod()&&curMod().sources.length)){state.status="Add some content first";state.statusType="error";renderStatus(overlayEl.querySelector("#cmb-panel"));return;}
            var total2=d.mcCount+d.tfCount+d.saCount+d.essayCount;
            if(total2===0){state.status="Add at least one question";state.statusType="error";renderStatus(overlayEl.querySelector("#cmb-panel"));return;}
            state.status="Generating "+(total2*3)+" questions...";state.statusType="loading";renderStatus(overlayEl.querySelector("#cmb-panel"));
            var btn2=container.querySelector("#cmb-gen-quiz");btn2.disabled=true;btn2.textContent="Generating...";
            try{
                var raw=await callClaude(buildQuizPrompt(d),AI_MODEL_QUIZ,8192);
                var cleaned=raw.replace(/```json\n?/g,"").replace(/```\n?/g,"").trim();
                d.generatedQuestions=JSON.parse(cleaned);d.subView="preview";
                state.status="Questions generated!";state.statusType="success";render();
            }catch(err){
                state.status="Error: "+err.message;state.statusType="error";
                btn2.disabled=false;btn2.textContent="\u2728 Generate "+(total2*3)+" Questions";
                renderStatus(overlayEl.querySelector("#cmb-panel"));
            }
        });
    }

    function renderQuizPreview(container,item,d){
        var info=ITEM_TYPES[item.type]||{label:"Quiz",icon:"?"};
        var data=d.generatedQuestions;
        var groups=data.groups||[];
        var h='<h2 class="cmb-h2">'+info.icon+' '+esc(d.quizTitle||info.label)+' - Preview</h2>';
        h+='<p class="cmb-desc">'+groups.length+' question groups, 3 versions each. Click answers to toggle correct.</p>';
        var typeColors={mc:"#7C3AED",tf:"#0EA5E9",sa:"#F59E0B",essay:"#EF4444"};
        var typeLabels={mc:"Multiple Choice",tf:"True/False",sa:"Short Answer",essay:"Essay"};
        var verColors=["#7C3AED","#0EA5E9","#10B981"];
        for(var i=0;i<groups.length;i++){
            var g=groups[i];
            var tc=typeColors[g.type]||"#6b7280";
            h+='<div class="cmb-group-card">';
            h+='<div class="cmb-group-header" style="background:'+tc+';">Group '+(i+1)+': '+(typeLabels[g.type]||g.type)+' <span style="font-size:11px;opacity:0.8;">DOK '+g.dokLevel+' | '+esc(g.concept||"")+'</span></div>';
            h+='<div class="cmb-group-body">';
            var qs=g.questions||[];
            for(var j=0;j<qs.length;j++){
                var q=qs[j];
                h+='<div class="cmb-q-block">';
                h+='<span class="cmb-ver-badge" style="background:'+verColors[j%3]+'">V'+(j+1)+'</span>';
                h+='<textarea class="cmb-q-text" data-gi="'+i+'" data-qi="'+j+'">'+esc(q.question||"")+'</textarea>';
                if(q.answers&&q.answers.length){
                    for(var k=0;k<q.answers.length;k++){
                        var a=q.answers[k];
                        h+='<div class="cmb-ans-row">';
                        h+='<div class="cmb-ans-dot'+(a.correct?" correct":"")+'" data-gi="'+i+'" data-qi="'+j+'" data-ai="'+k+'"></div>';
                        h+='<input type="text" class="cmb-ans-input" data-gi="'+i+'" data-qi="'+j+'" data-ai="'+k+'" value="'+esc(a.text||"")+'">';
                        h+='</div>';
                    }
                }
                h+='</div>';
            }
            h+='</div></div>';
        }
        h+='<div class="cmb-btn-row">';
        h+='<button class="cmb-btn cmb-btn-ai" id="cmb-regen-quiz">Regenerate</button>';
        h+='<button class="cmb-btn cmb-btn-secondary" id="cmb-back-quiz">Back to Settings</button>';
        h+='</div>';
        container.innerHTML=h;

        container.querySelectorAll(".cmb-q-text").forEach(function(ta){
            ta.addEventListener("input",function(){
                var gi=parseInt(ta.dataset.gi),qi=parseInt(ta.dataset.qi);
                if(data.groups[gi]&&data.groups[gi].questions[qi])data.groups[gi].questions[qi].question=ta.value;
            });
        });
        container.querySelectorAll(".cmb-ans-input").forEach(function(inp){
            inp.addEventListener("input",function(){
                var gi=parseInt(inp.dataset.gi),qi=parseInt(inp.dataset.qi),ai=parseInt(inp.dataset.ai);
                if(data.groups[gi]&&data.groups[gi].questions[qi]&&data.groups[gi].questions[qi].answers[ai])data.groups[gi].questions[qi].answers[ai].text=inp.value;
            });
        });
        container.querySelectorAll(".cmb-ans-dot").forEach(function(dot){
            dot.addEventListener("click",function(){
                var gi=parseInt(dot.dataset.gi),qi=parseInt(dot.dataset.qi),ai=parseInt(dot.dataset.ai);
                var q=data.groups[gi]&&data.groups[gi].questions[qi];
                if(!q||!q.answers)return;
                var gtype=data.groups[gi].type;
                if(gtype==="mc"||gtype==="tf"){q.answers.forEach(function(a){a.correct=false;});q.answers[ai].correct=true;}
                else{q.answers[ai].correct=!q.answers[ai].correct;}
                var block=dot.closest(".cmb-q-block");
                block.querySelectorAll(".cmb-ans-dot").forEach(function(dd,idx){dd.classList.toggle("correct",q.answers[idx]&&q.answers[idx].correct);});
            });
        });
        container.querySelector("#cmb-regen-quiz").addEventListener("click",function(){d.subView="build";d.generatedQuestions=null;render();});
        container.querySelector("#cmb-back-quiz").addEventListener("click",function(){d.subView="build";render();});
    }

    // ========== INSERT VIEW (replaces Export) ==========

    function renderInsert(body){
        var courseId = getCourseId();
        var h='<h2 class="cmb-h2">Review & Insert into Canvas</h2>';

        if(!courseId){
            h+='<div class="cmb-card" style="background:#fef2f2;border-color:#fca5a5;">';
            h+='<div style="font-size:13px;color:#991B1B;font-weight:600;">\u26A0\uFE0F No Course Detected</div>';
            h+='<div style="font-size:12px;color:#991B1B;margin-top:4px;">Navigate to a Canvas course page before inserting content.</div>';
            h+='</div>';
        } else {
            h+='<p class="cmb-desc">All modules will be created directly in <strong>Course ' + courseId + '</strong> via the Canvas API \u2014 pages, assignments, and quizzes with full question content included.</p>';
        }

        for(var m=0;m<state.modules.length;m++){
            var mod=state.modules[m];
            h+='<div class="cmb-card">';
            h+='<label class="cmb-label">\u{1F4E6} Module '+(m+1)+': '+esc(mod.title||'Untitled')+'</label>';
            h+='<div style="margin-top:8px;">';
            var modReady=0;
            for(var i=0;i<mod.items.length;i++){
                var it=mod.items[i],info=ITEM_TYPES[it.type]||{label:it.type,icon:"?"};
                var d=state.itemData[it.id]||{};
                var done=(it.type==="quiz"||it.type==="miniquiz")?!!d.generatedQuestions:!!d.generatedHTML;
                if(done)modReady++;
                h+='<div class="cmb-insert-item"><span class="icon">'+info.icon+'</span>';
                h+='<span style="flex:1;">'+esc(info.label+(it.type==="quiz"||it.type==="miniquiz"?" \u2014 "+(d.quizTitle||""):""))+'</span>';
                h+='<span class="status '+(done?"ready":"empty")+'">'+(done?"\u2713 Ready":"Not Built")+'</span></div>';
            }
            if(mod.items.length===0){h+='<div style="font-size:12px;color:#94a3b8;">No items.</div>';}
            h+='</div>';
            if(modReady<mod.items.length&&mod.items.length>0){
                h+='<div style="margin-top:8px;padding:6px 10px;background:#fef9c3;border-radius:6px;font-size:12px;color:#713f12;">\u26A0\uFE0F '+(mod.items.length-modReady)+' unbuilt item(s) will be inserted as placeholders.</div>';
            }
            h+='</div>';
        }

        h+='<div class="cmb-btn-row">';
        h+='<button class="cmb-btn cmb-btn-secondary" id="cmb-back-build2">&larr; Back to Build</button>';
        h+='<button class="cmb-btn cmb-btn-success" id="cmb-insert-all"'+(courseId?'':' disabled')+' style="font-size:15px;padding:12px 28px;">\u{1F680} Insert into Canvas</button>';
        h+='</div>';

        // Progress area
        h+='<div id="cmb-insert-progress" style="display:none;">';
        h+='<div class="cmb-card" style="margin-top:16px;">';
        h+='<label class="cmb-label" id="cmb-progress-label">Inserting...</label>';
        h+='<div class="cmb-progress-bar"><div class="cmb-progress-fill" id="cmb-progress-fill" style="width:0%;"></div></div>';
        h+='<div class="cmb-progress-log" id="cmb-progress-log"></div>';
        h+='</div></div>';

        // Results area (shown after completion)
        h+='<div id="cmb-insert-results" style="display:none;"></div>';

        h+='<div class="cmb-import-steps">';
        h+='<h4>\u{1F680} How Direct API Insert Works</h4><ol>';
        h+='<li>Click <strong>Insert into Canvas</strong> above.</li>';
        h+='<li>The script creates <strong>modules</strong> in your course via the Canvas API.</li>';
        h+='<li>It then creates all <strong>pages, assignments, and quizzes</strong> with full content.</li>';
        h+='<li>Each item is linked to its module automatically.</li>';
        h+='<li>Go to <strong>Modules</strong> in your course \u2014 everything will be there (unpublished)!</li>';
        h+='</ol></div>';

        body.innerHTML=h;

        body.querySelector("#cmb-back-build2").addEventListener("click",function(){state.step="build";render();});
        body.querySelector("#cmb-insert-all").addEventListener("click",async function(){
            var btn = body.querySelector("#cmb-insert-all");
            btn.disabled = true;
            btn.textContent = "Inserting...";

            var progressArea = body.querySelector("#cmb-insert-progress");
            var progressLabel = body.querySelector("#cmb-progress-label");
            var progressFill = body.querySelector("#cmb-progress-fill");
            var progressLog = body.querySelector("#cmb-progress-log");
            var resultsArea = body.querySelector("#cmb-insert-results");

            progressArea.style.display = "block";
            resultsArea.style.display = "none";
            progressLog.innerHTML = "";

            state.status = "Inserting content into Canvas...";
            state.statusType = "loading";
            renderStatus(overlayEl.querySelector("#cmb-panel"));

            try {
                var results = await insertAllContent(function(completed, total, msg){
                    var pct = Math.round((completed / total) * 100);
                    progressFill.style.width = pct + "%";
                    progressLabel.textContent = "Inserting... " + completed + " / " + total + " steps (" + pct + "%)";

                    var logLine = document.createElement("div");
                    logLine.className = msg.startsWith("ERROR") ? "error" : "success";
                    logLine.textContent = "[" + completed + "/" + total + "] " + msg;
                    progressLog.appendChild(logLine);
                    progressLog.scrollTop = progressLog.scrollHeight;
                });

                // Show results
                progressFill.style.width = "100%";
                progressLabel.textContent = "Insertion complete!";

                var rh = '<div class="cmb-card" style="margin-top:16px;background:#f0fdf4;border-color:#bbf7d0;">';
                rh += '<h3 style="margin:0 0 8px;color:#065F46;">\u2705 Insertion Complete!</h3>';

                for(var r = 0; r < results.modules.length; r++){
                    var rm = results.modules[r];
                    rh += '<div style="margin-bottom:8px;"><strong>\u{1F4E6} ' + esc(rm.title) + '</strong> (Module ID: ' + rm.id + ')<ul style="margin:4px 0 0 16px;font-size:12px;">';
                    for(var ri = 0; ri < rm.items.length; ri++){
                        var rItem = rm.items[ri];
                        var statusIcon = rItem.status === "inserted" ? "\u2713" : rItem.status === "skipped" ? "\u23ED" : "\u2717";
                        var statusColor = rItem.status === "inserted" ? "#065F46" : rItem.status === "skipped" ? "#92400E" : "#991B1B";
                        rh += '<li style="color:' + statusColor + ';">' + statusIcon + ' ' + esc(rItem.title) + ' (' + rItem.status + ')';
                        if(rItem.error) rh += ' \u2014 ' + esc(rItem.error);
                        rh += '</li>';
                    }
                    rh += '</ul></div>';
                }

                if(results.errors.length > 0){
                    rh += '<div style="margin-top:12px;padding:8px;background:#fef2f2;border-radius:6px;font-size:12px;color:#991B1B;">';
                    rh += '<strong>Errors:</strong><ul style="margin:4px 0 0 16px;">';
                    for(var ei = 0; ei < results.errors.length; ei++){
                        rh += '<li>' + esc(results.errors[ei]) + '</li>';
                    }
                    rh += '</ul></div>';
                }

                rh += '<div style="margin-top:12px;font-size:13px;color:#065F46;">Go to your course\'s <strong>Modules</strong> page to see all inserted content. Items are created as <strong>unpublished</strong> \u2014 publish them when ready!</div>';
                rh += '</div>';

                resultsArea.innerHTML = rh;
                resultsArea.style.display = "block";

                state.status = "\u2705 All content inserted into Canvas! Check your Modules page.";
                state.statusType = "success";

            } catch(err){
                state.status = "Insert error: " + err.message;
                state.statusType = "error";
                btn.disabled = false;
                btn.textContent = "\u{1F680} Insert into Canvas";
            }

            renderStatus(overlayEl.querySelector("#cmb-panel"));
        });
    }

    // ========== OVERLAY ==========

    function openOverlay(){
        if(overlayEl)return;
        overlayEl=document.createElement("div");
        overlayEl.id="cmb-overlay";
        overlayEl.innerHTML='<div id="cmb-panel"><div class="cmb-topbar"><div><h1>Canvas AI Module Builder</h1><div class="cmb-topbar-sub">v4.0 \u2014 Direct API Insert \u00B7 Multi-Module \u00B7 Full Content</div></div><button class="cmb-close" id="cmb-close-btn">Close</button></div><div class="cmb-stepbar"></div><div class="cmb-body"></div><div class="cmb-status" style="display:none;"></div></div>';
        document.body.appendChild(overlayEl);
        overlayEl.querySelector("#cmb-close-btn").addEventListener("click",closeOverlay);
        overlayEl.addEventListener("click",function(e){if(e.target===overlayEl)closeOverlay();});
        render();
    }

    function closeOverlay(){
        if(overlayEl){overlayEl.remove();overlayEl=null;}
    }

    function init(){
        GM_addStyle(CSS);
    }

    function waitAndLaunch(tries){
        if(tries===undefined)tries=0;
        if(tries>40)return;
        if(document.body){init();}else{setTimeout(function(){waitAndLaunch(tries+1);},250);}
    }

    if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",function(){waitAndLaunch(0);});}
    else{waitAndLaunch(0);}

    // ─────────────────────────────────────────────
    // REGISTER WITH CANVAS DASHBOARD
    // ─────────────────────────────────────────────
    (function tryRegister() {
        if (unsafeWindow.CanvasDash) {
            unsafeWindow.CanvasDash.register({
                id:          "module-builder",
                name:        "Module Builder",
                icon:        "🏗️",
                description: "Build Canvas modules, pages & quizzes with AI",
                color:       "#8e44ad",
                run:         openOverlay
            });
        } else {
            setTimeout(tryRegister, 100);
        }
    })();

})();
