// ==UserScript==
// @name         Canvas Teacher Evaluation Tool
// @namespace    https://github.com/MarkAlanBrest/canvas-teacher-eval
// @version      1.1.0
// @description  Data-driven teacher/course evaluation dashboard for Canvas LMS admins
// @author       MarkAlanBrest
// @match        *://*.instructure.com/courses/*
// @match        *://canvas.*.edu/courses/*
// @match        *://canvas.*.com/courses/*
// @match        *://*.canvas.*.edu/courses/*
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        unsafeWindow
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/MarkAlanBrest/scripts/main/canvas-teacher-evaluation-tool-1.1.0.user.js
// @updateURL    https://raw.githubusercontent.com/MarkAlanBrest/scripts/main/canvas-teacher-evaluation-tool-1.1.0.user.js
// ==/UserScript==

(function () {
  "use strict";

  // ============================================================
  // 1. CONSTANTS & CONFIGURATION
  // ============================================================

  const VERSION = "1.1.0";

  const CATEGORY_WEIGHTS = {
    assignmentStructure: 0.2,
    studentEngagement: 0.2,
    gradingEfficiency: 0.15,
    communication: 0.15,
    courseQuality: 0.15,
    studentPerformance: 0.15,
  };

  const DELIVERY_MULTIPLIERS = {
    online: { communication: 1.2, engagement: 1.1, assignments: 1.0 },
    hybrid: { communication: 1.05, engagement: 1.0, assignments: 0.95 },
    "in-person": { communication: 0.85, engagement: 0.9, assignments: 0.9 },
  };

  const SCORE_LABELS = [
    { min: 90, label: "Excellent", color: "#10B981" },
    { min: 80, label: "Very Good", color: "#34D399" },
    { min: 70, label: "Good", color: "#FBBF24" },
    { min: 60, label: "Needs Improvement", color: "#F59E0B" },
    { min: 0, label: "Critical", color: "#EF4444" },
  ];

  const API_DELAY_MS = 150;
  const PER_PAGE = 100;

  // ============================================================
  // 1b. SETTINGS DEFINITION & METADATA
  // ============================================================

  const SETTINGS_META = {
    assignmentStructure: {
      label: "Assignment Structure",
      icon: "\u{1F4DD}",
      description:
        "Evaluates how well the course assignments are organized. Looks at quantity, frequency, use of rubrics, due dates, and how detailed the instructions are. A well-structured course sets students up for success.",
      items: {
        assignmentCount: {
          label: "Assignment Count & Frequency",
          description:
            "Counts total assignments and how many per week. Compares against expected volume based on course hours. Too few may indicate lack of engagement opportunities; too many may overwhelm students.",
        },
        rubricUsage: {
          label: "Rubric Usage",
          description:
            "Percentage of assignments that include a grading rubric. Rubrics set clear expectations and ensure consistent, transparent grading across all students.",
        },
        dueDateUsage: {
          label: "Due Date Usage",
          description:
            "Percentage of assignments with a due date set. Due dates drive accountability and help students manage their time. Missing due dates often lead to procrastination and pileups.",
        },
        instructionLength: {
          label: "Instruction Clarity (Length)",
          description:
            "Average character length of assignment descriptions. Longer, more detailed instructions typically correlate with clearer expectations and fewer student questions.",
        },
      },
    },

    studentEngagement: {
      label: "Student Engagement",
      icon: "\u{1F4CA}",
      description:
        "Measures how actively students are participating in the course. Tracks submission rates, missing work, and on-time behavior. Low engagement is a leading indicator of student risk.",
      items: {
        submissionRate: {
          label: "Submission Rate",
          description:
            "Percentage of expected submissions that were actually turned in. A low rate may indicate disengagement, unclear requirements, or course design issues.",
        },
        missingWork: {
          label: "Missing Work",
          description:
            "Percentage of expected work that was never submitted. High missing work is a red flag for student support needs or unclear assignment expectations.",
        },
        onTimeRate: {
          label: "On-Time Submission Rate",
          description:
            "Of all submitted work, what percentage was turned in before the due date. Chronic lateness may signal workload issues or poor time management support.",
        },
      },
    },

    gradingEfficiency: {
      label: "Grading Efficiency",
      icon: "\u23F1\uFE0F",
      description:
        "How quickly and consistently the teacher returns graded work. Timely, predictable feedback is one of the strongest drivers of student improvement.",
      items: {
        gradingSpeed: {
          label: "Average Grading Speed",
          description:
            "Mean number of days between student submission and teacher grading. Best practice is under 3 days. Slow turnaround reduces the feedback's learning impact.",
        },
        quickGrading: {
          label: "Quick Grading Rate (\u2264 3 days)",
          description:
            "Percentage of submissions graded within 3 days. Measures how often students get prompt feedback when it matters most.",
        },
        gradingConsistency: {
          label: "Grading Consistency",
          description:
            "Standard deviation of grading turnaround times. Low variance means students can reliably predict when they'll get feedback. High variance signals irregular grading habits.",
        },
      },
    },

    communication: {
      label: "Communication",
      icon: "\u{1F4AC}",
      description:
        "Assesses teacher presence and communication with students. Includes announcements, discussion boards, and personalized feedback comments on submitted work. Strong communication builds trust and engagement.",
      items: {
        announcements: {
          label: "Announcements",
          description:
            "Number and frequency of course announcements. Regular announcements (at least 1/week) keep students informed, set expectations, and demonstrate active instructor presence.",
        },
        discussions: {
          label: "Discussion Boards",
          description:
            "Number of discussion topics created in the course. Discussions encourage peer interaction, critical thinking, and community building \u2014 especially important in online courses.",
        },
        feedbackComments: {
          label: "Submission Feedback Comments",
          description:
            "Percentage of graded submissions that include at least one teacher comment. Personalized feedback shows students their work was reviewed individually, not just auto-scored.",
        },
      },
    },

    courseQuality: {
      label: "Course Quality / Rigor",
      icon: "\u{1F3AF}",
      description:
        "Examines the depth and variety of course content. Looks at assignment type diversity, point values, rubric depth, and whether all modules have content. Variety and structure lead to better learning outcomes.",
      items: {
        assignmentVariety: {
          label: "Assignment Type Variety",
          description:
            "How many different submission types are used (essays, uploads, quizzes, discussions, external tools, etc.). Variety engages different learning styles and assesses skills more holistically.",
        },
        assignmentDepth: {
          label: "Assignment Depth",
          description:
            "Composite measure of average points per assignment, rubric presence, and instruction length. Higher depth means assignments are substantive and well-designed, not just busy work.",
        },
        moduleCoverage: {
          label: "Module Coverage",
          description:
            "Percentage of course modules that contain at least one content item. Empty modules suggest incomplete course setup or abandoned sections students may find confusing.",
        },
      },
    },

    studentPerformance: {
      label: "Student Performance",
      icon: "\u{1F3C6}",
      description:
        "The ultimate outcome metric. Looks at class-wide grade averages, pass rates, and whether scores improved over the term. This is the result of everything else combined.",
      items: {
        classAverage: {
          label: "Class Average Grade",
          description:
            "Mean current score across all enrolled students. Very low averages may indicate overly difficult assessments or insufficient support. Very high averages may suggest lack of rigor.",
        },
        passRate: {
          label: "Pass Rate (\u2265 70%)",
          description:
            "Percentage of students currently at or above 70%. Low pass rates are a direct signal that students are struggling and may need intervention.",
        },
        improvementTrend: {
          label: "Score Improvement Trend",
          description:
            "Compares average assignment scores from the first half vs. second half of the term. A positive trend means students are learning and improving. A negative trend may signal disengagement or increasing difficulty without support.",
        },
      },
    },
  };

  function getDefaultSettings() {
    const s = {};
    for (const [catKey, catMeta] of Object.entries(SETTINGS_META)) {
      s[catKey] = { enabled: true, items: {} };
      for (const itemKey of Object.keys(catMeta.items)) {
        s[catKey].items[itemKey] = true;
      }
    }
    return s;
  }

  // ============================================================
  // 1c. SETTINGS STORAGE (Tampermonkey GM_setValue / GM_getValue)
  // ============================================================

  function loadSettings() {
    try {
      const stored = GM_getValue("cte_settings", null);
      if (stored) {
        const parsed = typeof stored === "string" ? JSON.parse(stored) : stored;
        const defaults = getDefaultSettings();
        for (const catKey of Object.keys(defaults)) {
          if (!parsed[catKey]) {
            parsed[catKey] = defaults[catKey];
          } else {
            if (parsed[catKey].enabled === undefined) parsed[catKey].enabled = true;
            if (!parsed[catKey].items) parsed[catKey].items = {};
            for (const itemKey of Object.keys(defaults[catKey].items)) {
              if (parsed[catKey].items[itemKey] === undefined) {
                parsed[catKey].items[itemKey] = true;
              }
            }
          }
        }
        return parsed;
      }
    } catch (e) {
      console.warn("[CTE] Failed to load settings, using defaults", e);
    }
    return getDefaultSettings();
  }

  function saveSettings(settings) {
    try {
      GM_setValue("cte_settings", JSON.stringify(settings));
    } catch (e) {
      console.error("[CTE] Failed to save settings", e);
    }
  }

  // ============================================================
  // 2. UTILITY FUNCTIONS
  // ============================================================

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  function mean(arr) {
    if (!arr.length) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  function stddev(arr) {
    if (arr.length < 2) return 0;
    const m = mean(arr);
    return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
  }

  function daysBetween(a, b) {
    return (new Date(b) - new Date(a)) / (1000 * 60 * 60 * 24);
  }

  function scoreLabel(score) {
    for (const s of SCORE_LABELS) {
      if (score >= s.min) return s;
    }
    return SCORE_LABELS[SCORE_LABELS.length - 1];
  }

  function pct(num, den) {
    if (!den) return 0;
    return (num / den) * 100;
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function escHtml(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  function weightedAvg(items) {
    const active = items.filter((i) => i.enabled !== false);
    if (!active.length) return 50;
    const totalWeight = active.reduce((s, i) => s + i.weight, 0);
    if (totalWeight === 0) return 50;
    return active.reduce((s, i) => s + i.value * (i.weight / totalWeight), 0);
  }

  // ============================================================
  // 3. CANVAS API LAYER
  // ============================================================

  function getCourseId() {
    const m = window.location.pathname.match(/\/courses\/(\d+)/);
    return m ? m[1] : null;
  }

  function apiBase() {
    return window.location.origin + "/api/v1";
  }

  async function apiFetch(url, params = {}) {
    const u = new URL(url, window.location.origin);
    u.searchParams.set("per_page", PER_PAGE);
    for (const [k, v] of Object.entries(params)) {
      if (Array.isArray(v)) {
        v.forEach((item) => u.searchParams.append(k, item));
      } else {
        u.searchParams.set(k, v);
      }
    }
    const resp = await fetch(u.toString(), { credentials: "same-origin" });
    if (!resp.ok) throw new Error("API " + resp.status + ": " + u.pathname);
    return resp;
  }

  async function apiFetchAll(url, params = {}) {
    let results = [];
    const firstResp = await apiFetch(url, params);
    const firstData = await firstResp.json();
    results = results.concat(firstData);
    let nextUrl = parseLinkNext(firstResp.headers.get("Link"));
    while (nextUrl) {
      await sleep(API_DELAY_MS);
      const resp = await fetch(nextUrl, { credentials: "same-origin" });
      if (!resp.ok) break;
      const data = await resp.json();
      results = results.concat(data);
      nextUrl = parseLinkNext(resp.headers.get("Link"));
    }
    return results;
  }

  function parseLinkNext(header) {
    if (!header) return null;
    for (const part of header.split(",")) {
      const match = part.match(/<([^>]+)>;\s*rel="next"/);
      if (match) return match[1];
    }
    return null;
  }

  // ============================================================
  // 4. DATA COLLECTION LAYER
  // ============================================================

  async function fetchCourseInfo(courseId) {
    const resp = await apiFetch(apiBase() + "/courses/" + courseId, {
      "include[]": ["total_students", "teachers"],
    });
    return resp.json();
  }

  async function fetchAssignments(courseId) {
    return apiFetchAll(apiBase() + "/courses/" + courseId + "/assignments", {
      "include[]": ["rubric"],
      order_by: "due_at",
    });
  }

  async function fetchSubmissionsForAssignment(courseId, assignmentId) {
    return apiFetchAll(
      apiBase() + "/courses/" + courseId + "/assignments/" + assignmentId + "/submissions",
      { "include[]": ["submission_comments"] }
    );
  }

  async function fetchAllSubmissions(courseId, assignmentIds, onProgress) {
    const allSubs = {};
    for (let i = 0; i < assignmentIds.length; i++) {
      const aid = assignmentIds[i];
      try {
        allSubs[aid] = await fetchSubmissionsForAssignment(courseId, aid);
      } catch (e) {
        allSubs[aid] = [];
      }
      if (onProgress) onProgress("Fetching submissions... " + (i + 1) + "/" + assignmentIds.length);
      if (i < assignmentIds.length - 1) await sleep(API_DELAY_MS);
    }
    return allSubs;
  }

  async function fetchEnrollments(courseId, type) {
    return apiFetchAll(apiBase() + "/courses/" + courseId + "/enrollments", {
      "type[]": [type],
      "state[]": ["active", "completed"],
    });
  }

  async function fetchDiscussionTopics(courseId) {
    return apiFetchAll(apiBase() + "/courses/" + courseId + "/discussion_topics", {
      plain_user_content: true,
    });
  }

  async function fetchAnnouncements(courseId) {
    return apiFetchAll(apiBase() + "/announcements", {
      "context_codes[]": ["course_" + courseId],
    });
  }

  async function fetchModules(courseId) {
    return apiFetchAll(apiBase() + "/courses/" + courseId + "/modules", {
      "include[]": ["items"],
    });
  }

  async function collectAllData(courseId, onProgress) {
    onProgress("Fetching course info...");
    const courseInfo = await fetchCourseInfo(courseId);

    onProgress("Fetching assignments...");
    const assignments = await fetchAssignments(courseId);

    const assignmentIds = assignments.map(function (a) { return a.id; });
    const submissions = await fetchAllSubmissions(courseId, assignmentIds, onProgress);

    onProgress("Fetching student enrollments...");
    const studentEnrollments = await fetchEnrollments(courseId, "StudentEnrollment");

    onProgress("Fetching teacher enrollments...");
    const teacherEnrollments = await fetchEnrollments(courseId, "TeacherEnrollment");

    onProgress("Fetching announcements...");
    const announcements = await fetchAnnouncements(courseId);

    onProgress("Fetching discussion topics...");
    const discussions = await fetchDiscussionTopics(courseId);

    onProgress("Fetching modules...");
    const modules = await fetchModules(courseId);

    return {
      courseInfo: courseInfo,
      assignments: assignments,
      submissions: submissions,
      studentEnrollments: studentEnrollments,
      teacherEnrollments: teacherEnrollments,
      announcements: announcements,
      discussions: discussions,
      modules: modules,
    };
  }

  // ============================================================
  // 5. METRICS COMPUTATION
  // ============================================================

  function computeMetrics(data, context) {
    var assignments = data.assignments;
    var submissions = data.submissions;
    var studentEnrollments = data.studentEnrollments;
    var announcements = data.announcements;
    var discussions = data.discussions;
    var modules = data.modules;
    var courseHours = context.courseHours;
    var termWeeks = context.termWeeks;

    var studentCount = studentEnrollments.length || 1;
    var publishedAssignments = assignments.filter(function (a) { return a.published !== false; });
    var assignmentCount = publishedAssignments.length;
    var assignmentsPerWeek = termWeeks ? assignmentCount / termWeeks : 0;

    var descriptionLengths = publishedAssignments.map(function (a) {
      return (a.description || "").replace(/<[^>]*>/g, "").length;
    });
    var avgAssignmentLength = mean(descriptionLengths);
    var withRubric = publishedAssignments.filter(function (a) { return a.rubric && a.rubric.length > 0; }).length;
    var rubricUsagePct = pct(withRubric, assignmentCount);
    var withDueDate = publishedAssignments.filter(function (a) { return a.due_at; }).length;
    var dueDateUsagePct = pct(withDueDate, assignmentCount);

    var totalExpected = 0, totalSubmitted = 0, totalOnTime = 0, totalLate = 0;
    var gradingDays = [], totalGraded = 0, totalWithComments = 0, quickGraded = 0;

    for (var ai = 0; ai < publishedAssignments.length; ai++) {
      var a = publishedAssignments[ai];
      var subs = submissions[a.id] || [];
      var dueDate = a.due_at ? new Date(a.due_at) : null;
      for (var si = 0; si < subs.length; si++) {
        var s = subs[si];
        if (s.workflow_state === "unsubmitted" && !s.submitted_at) continue;
        totalExpected++;
        if (s.workflow_state === "submitted" || s.workflow_state === "graded" || s.submitted_at) {
          totalSubmitted++;
          if (dueDate && s.submitted_at) {
            if (new Date(s.submitted_at) <= dueDate) totalOnTime++;
            else totalLate++;
          }
        }
        if (s.workflow_state === "graded" && s.graded_at && s.submitted_at) {
          totalGraded++;
          var days = daysBetween(s.submitted_at, s.graded_at);
          if (days >= 0) { gradingDays.push(days); if (days <= 3) quickGraded++; }
        }
        if (s.submission_comments && s.submission_comments.length > 0) totalWithComments++;
      }
    }

    var assignmentsWithDue = publishedAssignments.filter(function (a) { return a.due_at && new Date(a.due_at) < new Date(); });
    totalExpected = Math.max(totalExpected, assignmentsWithDue.length * studentCount);
    var totalMissing = Math.max(0, totalExpected - totalSubmitted);
    var submissionRatePct = pct(totalSubmitted, totalExpected);
    var missingWorkPct = pct(totalMissing, totalExpected);
    var onTimePct = totalSubmitted ? pct(totalOnTime, totalSubmitted) : 0;
    var avgGradingDays = mean(gradingDays);
    var gradingDaysStdDev = stddev(gradingDays);
    var quickGradedPct = totalGraded ? pct(quickGraded, totalGraded) : 0;
    var feedbackCoveragePct = totalGraded ? pct(totalWithComments, totalGraded) : 0;

    var announcementCount = announcements.length;
    var announcementsPerWeek = termWeeks ? announcementCount / termWeeks : 0;
    var discussionCount = discussions.filter(function (d) { return d.discussion_type !== "side_comment" && !d.is_announcement; }).length;

    var submissionTypes = new Set();
    publishedAssignments.forEach(function (a) { if (a.submission_types) a.submission_types.forEach(function (t) { submissionTypes.add(t); }); });
    var possibleTypes = ["online_text_entry","online_upload","online_quiz","discussion_topic","external_tool","media_recording","online_url"];
    var assignmentTypeVariety = pct(submissionTypes.size, possibleTypes.length);
    var avgPoints = mean(publishedAssignments.map(function (a) { return a.points_possible || 0; }));
    var moduleCount = modules.length;
    var modulesWithItems = modules.filter(function (m) { return m.items && m.items.length > 0; }).length;
    var moduleCoveragePct = moduleCount ? pct(modulesWithItems, moduleCount) : 100;

    var finalGrades = studentEnrollments
      .map(function (e) { return (e.grades && e.grades.current_score != null) ? e.grades.current_score : null; })
      .filter(function (g) { return g !== null; });
    var classAvgPct = mean(finalGrades);
    var passCount = finalGrades.filter(function (g) { return g >= 70; }).length;
    var passRatePct = pct(passCount, finalGrades.length);

    var improvementTrend = 0;
    if (publishedAssignments.length >= 4) {
      var sorted = publishedAssignments.slice().sort(function (a, b) { return new Date(a.due_at || 0) - new Date(b.due_at || 0); });
      var mid = Math.floor(sorted.length / 2);
      var avgScoreFn = function (assgns) {
        var scores = [];
        for (var i = 0; i < assgns.length; i++) {
          var subsArr = submissions[assgns[i].id] || [];
          for (var j = 0; j < subsArr.length; j++) {
            if (subsArr[j].score != null && assgns[i].points_possible > 0)
              scores.push((subsArr[j].score / assgns[i].points_possible) * 100);
          }
        }
        return mean(scores);
      };
      improvementTrend = avgScoreFn(sorted.slice(mid)) - avgScoreFn(sorted.slice(0, mid));
    }

    return {
      assignmentCount: assignmentCount,
      assignmentsPerWeek: assignmentsPerWeek,
      avgAssignmentLength: avgAssignmentLength,
      rubricUsagePct: rubricUsagePct,
      dueDateUsagePct: dueDateUsagePct,
      submissionRatePct: submissionRatePct,
      missingWorkPct: missingWorkPct,
      onTimePct: onTimePct,
      totalSubmitted: totalSubmitted,
      totalExpected: totalExpected,
      avgGradingDays: avgGradingDays,
      quickGradedPct: quickGradedPct,
      gradingDaysStdDev: gradingDaysStdDev,
      totalGraded: totalGraded,
      announcementCount: announcementCount,
      announcementsPerWeek: announcementsPerWeek,
      feedbackCoveragePct: feedbackCoveragePct,
      discussionCount: discussionCount,
      assignmentTypeVariety: assignmentTypeVariety,
      avgPoints: avgPoints,
      moduleCoveragePct: moduleCoveragePct,
      moduleCount: moduleCount,
      classAvgPct: classAvgPct,
      passRatePct: passRatePct,
      improvementTrend: improvementTrend,
      studentCount: studentCount,
      withRubric: withRubric,
      withDueDate: withDueDate,
      quickGraded: quickGraded,
      totalWithComments: totalWithComments,
      assignmentsWithDueCount: assignmentsWithDue.length,
    };
  }

  // ============================================================
  // 6. NORMALIZATION ENGINE
  // ============================================================

  function normalizeExpectations(context) {
    var courseHours = context.courseHours;
    var termWeeks = context.termWeeks;
    var deliveryType = context.deliveryType;
    var mult = DELIVERY_MULTIPLIERS[deliveryType] || DELIVERY_MULTIPLIERS.online;
    var expectedAssignments = Math.max(1, (courseHours / 5) * mult.assignments);
    return {
      expectedAssignments: expectedAssignments,
      expectedAssignmentsPerWeek: termWeeks ? expectedAssignments / termWeeks : 1,
      expectedAnnouncementsPerWeek: 1.0 * mult.communication,
      expectedSubmissionRate: 85 * mult.engagement,
      mult: mult,
    };
  }

  // ============================================================
  // 7. SCORING ENGINE (settings-aware)
  // ============================================================

  function scoreAssignmentStructure(metrics, norm, settings) {
    var si = settings.assignmentStructure.items;
    var quantityRatio = clamp(metrics.assignmentCount / norm.expectedAssignments, 0, 1.5);
    var quantityScore = clamp(quantityRatio <= 1 ? quantityRatio * 100 : 100 - (quantityRatio - 1) * 30, 0, 100);
    var rubricScore = clamp(metrics.rubricUsagePct, 0, 100);
    var dueDateScore = clamp(metrics.dueDateUsagePct, 0, 100);
    var len = metrics.avgAssignmentLength;
    var lengthScore;
    if (len < 50) lengthScore = 15;
    else if (len < 150) lengthScore = 40;
    else if (len < 300) lengthScore = 65;
    else if (len < 600) lengthScore = 85;
    else lengthScore = 100;

    var score = weightedAvg([
      { value: quantityScore, weight: 0.3, enabled: si.assignmentCount },
      { value: rubricScore, weight: 0.25, enabled: si.rubricUsage },
      { value: dueDateScore, weight: 0.25, enabled: si.dueDateUsage },
      { value: lengthScore, weight: 0.2, enabled: si.instructionLength },
    ]);
    return { score: clamp(Math.round(score), 0, 100) };
  }

  function scoreStudentEngagement(metrics, norm, settings) {
    var si = settings.studentEngagement.items;
    var submissionScore = clamp((metrics.submissionRatePct / norm.expectedSubmissionRate) * 100, 0, 100);
    var onTimeScore = clamp(metrics.onTimePct, 0, 100);
    var missingInverse = clamp(100 - metrics.missingWorkPct, 0, 100);
    var score = weightedAvg([
      { value: submissionScore, weight: 0.4, enabled: si.submissionRate },
      { value: onTimeScore, weight: 0.3, enabled: si.onTimeRate },
      { value: missingInverse, weight: 0.3, enabled: si.missingWork },
    ]);
    return { score: clamp(Math.round(score), 0, 100) };
  }

  function scoreGradingEfficiency(metrics, settings) {
    var si = settings.gradingEfficiency.items;
    var d = metrics.avgGradingDays;
    var speedScore;
    if (d <= 1) speedScore = 100;
    else if (d <= 2) speedScore = 90;
    else if (d <= 3) speedScore = 80;
    else if (d <= 5) speedScore = 65;
    else if (d <= 7) speedScore = 45;
    else if (d <= 10) speedScore = 25;
    else if (d <= 14) speedScore = 10;
    else speedScore = 0;
    if (metrics.totalGraded === 0) speedScore = 50;

    var quickScore = clamp(metrics.quickGradedPct, 0, 100);
    var sd = metrics.gradingDaysStdDev;
    var consistencyScore;
    if (sd <= 1) consistencyScore = 100;
    else if (sd <= 2) consistencyScore = 85;
    else if (sd <= 4) consistencyScore = 65;
    else if (sd <= 7) consistencyScore = 40;
    else consistencyScore = 20;
    if (metrics.totalGraded === 0) consistencyScore = 50;

    var score = weightedAvg([
      { value: speedScore, weight: 0.4, enabled: si.gradingSpeed },
      { value: quickScore, weight: 0.3, enabled: si.quickGrading },
      { value: consistencyScore, weight: 0.3, enabled: si.gradingConsistency },
    ]);
    return { score: clamp(Math.round(score), 0, 100) };
  }

  function scoreCommunication(metrics, norm, settings) {
    var si = settings.communication.items;
    var annFreq = metrics.announcementsPerWeek;
    var expected = norm.expectedAnnouncementsPerWeek;
    var annScore;
    if (annFreq >= expected * 2) annScore = 100;
    else if (annFreq >= expected) annScore = 80;
    else if (annFreq >= expected * 0.5) annScore = 55;
    else if (annFreq > 0) annScore = 30;
    else annScore = 0;

    var discScore;
    if (metrics.discussionCount >= 10) discScore = 100;
    else if (metrics.discussionCount >= 5) discScore = 75;
    else if (metrics.discussionCount >= 2) discScore = 50;
    else if (metrics.discussionCount >= 1) discScore = 30;
    else discScore = 0;

    var feedbackScore = clamp(metrics.feedbackCoveragePct, 0, 100);
    var score = weightedAvg([
      { value: annScore, weight: 0.35, enabled: si.announcements },
      { value: discScore, weight: 0.25, enabled: si.discussions },
      { value: feedbackScore, weight: 0.4, enabled: si.feedbackComments },
    ]);
    return { score: clamp(Math.round(score), 0, 100) };
  }

  function scoreCourseQuality(metrics, settings) {
    var si = settings.courseQuality.items;
    var varietyScore = clamp(metrics.assignmentTypeVariety, 0, 100);
    var depthScore =
      (metrics.avgAssignmentLength > 200 ? 40 : metrics.avgAssignmentLength / 5) +
      (metrics.avgPoints > 50 ? 30 : (metrics.avgPoints / 50) * 30) +
      (metrics.rubricUsagePct / 100) * 30;
    depthScore = clamp(Math.round(depthScore), 0, 100);
    var coverageScore = clamp(metrics.moduleCoveragePct, 0, 100);
    var score = weightedAvg([
      { value: varietyScore, weight: 0.35, enabled: si.assignmentVariety },
      { value: depthScore, weight: 0.35, enabled: si.assignmentDepth },
      { value: coverageScore, weight: 0.3, enabled: si.moduleCoverage },
    ]);
    return { score: clamp(Math.round(score), 0, 100) };
  }

  function scoreStudentPerformance(metrics, settings) {
    var si = settings.studentPerformance.items;
    var avgScore = clamp(metrics.classAvgPct, 0, 100);
    var passScore = clamp(metrics.passRatePct, 0, 100);
    var trendScore = 50;
    if (metrics.improvementTrend > 5) trendScore = 90;
    else if (metrics.improvementTrend > 2) trendScore = 75;
    else if (metrics.improvementTrend > 0) trendScore = 60;
    else if (metrics.improvementTrend > -2) trendScore = 45;
    else if (metrics.improvementTrend > -5) trendScore = 30;
    else trendScore = 15;
    var score = weightedAvg([
      { value: avgScore, weight: 0.35, enabled: si.classAverage },
      { value: passScore, weight: 0.35, enabled: si.passRate },
      { value: trendScore, weight: 0.3, enabled: si.improvementTrend },
    ]);
    return { score: clamp(Math.round(score), 0, 100) };
  }

  function computeAllScores(metrics, context, settings) {
    var norm = normalizeExpectations(context);
    var scoreFns = {
      assignmentStructure: function () { return scoreAssignmentStructure(metrics, norm, settings); },
      studentEngagement: function () { return scoreStudentEngagement(metrics, norm, settings); },
      gradingEfficiency: function () { return scoreGradingEfficiency(metrics, settings); },
      communication: function () { return scoreCommunication(metrics, norm, settings); },
      courseQuality: function () { return scoreCourseQuality(metrics, settings); },
      studentPerformance: function () { return scoreStudentPerformance(metrics, settings); },
    };

    var catMetrics = {
      assignmentStructure: [
        { label: "Total Assignments", value: metrics.assignmentCount },
        { label: "Assignments / Week", value: metrics.assignmentsPerWeek.toFixed(1) },
        { label: "Rubric Usage", value: metrics.rubricUsagePct.toFixed(0) + "%" },
        { label: "Due Date Usage", value: metrics.dueDateUsagePct.toFixed(0) + "%" },
        { label: "Avg Instruction Length", value: metrics.avgAssignmentLength.toFixed(0) + " chars" },
      ],
      studentEngagement: [
        { label: "Submission Rate", value: metrics.submissionRatePct.toFixed(1) + "%" },
        { label: "Missing Work", value: metrics.missingWorkPct.toFixed(1) + "%" },
        { label: "On-Time Rate", value: metrics.onTimePct.toFixed(1) + "%" },
        { label: "Total Submissions", value: metrics.totalSubmitted },
      ],
      gradingEfficiency: [
        { label: "Avg Grading Time", value: metrics.avgGradingDays.toFixed(1) + " days" },
        { label: "Graded \u2264 3 Days", value: metrics.quickGradedPct.toFixed(0) + "%" },
        { label: "Consistency (\u03C3)", value: metrics.gradingDaysStdDev.toFixed(1) + " days" },
        { label: "Total Graded", value: metrics.totalGraded },
      ],
      communication: [
        { label: "Announcements", value: metrics.announcementCount },
        { label: "Announcements / Week", value: metrics.announcementsPerWeek.toFixed(1) },
        { label: "Discussion Topics", value: metrics.discussionCount },
        { label: "Feedback Coverage", value: metrics.feedbackCoveragePct.toFixed(0) + "%" },
      ],
      courseQuality: [
        { label: "Assignment Variety", value: metrics.assignmentTypeVariety.toFixed(0) + "%" },
        { label: "Avg Points/Assignment", value: metrics.avgPoints.toFixed(1) },
        { label: "Module Coverage", value: metrics.moduleCoveragePct.toFixed(0) + "%" },
        { label: "Modules", value: metrics.moduleCount },
      ],
      studentPerformance: [
        { label: "Class Average", value: metrics.classAvgPct.toFixed(1) + "%" },
        { label: "Pass Rate (\u226570%)", value: metrics.passRatePct.toFixed(1) + "%" },
        { label: "Improvement Trend", value: (metrics.improvementTrend >= 0 ? "+" : "") + metrics.improvementTrend.toFixed(1) + "%" },
        { label: "Students", value: metrics.studentCount },
      ],
    };

    var catExplanations = {
      assignmentStructure: "Measures assignment quantity relative to course hours, rubric adoption, due date consistency, and instruction clarity.",
      studentEngagement: "Tracks student participation through submission rates, on-time behavior, and missing work.",
      gradingEfficiency: "Evaluates how quickly and consistently assignments are graded.",
      communication: "Assesses teacher presence through announcements, discussions, and personalized feedback.",
      courseQuality: "Examines assignment diversity, depth, and structural coverage across course modules.",
      studentPerformance: "Class-wide grade distribution, pass rates, and score improvement over the term.",
    };

    var categories = {};
    for (var key in scoreFns) {
      if (!scoreFns.hasOwnProperty(key)) continue;
      if (!settings[key].enabled) continue;
      var meta = SETTINGS_META[key];
      var result = scoreFns[key]();
      categories[key] = {
        name: meta.label,
        icon: meta.icon,
        score: result.score,
        metrics: catMetrics[key],
        explanation: catExplanations[key],
      };
    }

    var enabledKeys = Object.keys(categories);
    var totalWeight = enabledKeys.reduce(function (s, k) { return s + (CATEGORY_WEIGHTS[k] || 0); }, 0);
    var overallScore = 0;
    if (totalWeight > 0) {
      for (var i = 0; i < enabledKeys.length; i++) {
        overallScore += categories[enabledKeys[i]].score * ((CATEGORY_WEIGHTS[enabledKeys[i]] || 0) / totalWeight);
      }
    }
    overallScore = clamp(Math.round(overallScore), 0, 100);
    return { categories: categories, overallScore: overallScore };
  }

  // ============================================================
  // 8. FLAGS ENGINE
  // ============================================================

  function generateFlags(scores) {
    var flags = [];
    for (var key in scores.categories) {
      if (!scores.categories.hasOwnProperty(key)) continue;
      var cat = scores.categories[key];
      if (cat.score < 50)
        flags.push({ level: "critical", category: cat.name, message: cat.name + " score is critically low (" + cat.score + "/100)." });
      else if (cat.score < 70)
        flags.push({ level: "warning", category: cat.name, message: cat.name + " needs attention (" + cat.score + "/100)." });
    }
    if (scores.overallScore < 50)
      flags.unshift({ level: "critical", category: "Overall", message: "Overall score is critically low (" + scores.overallScore + "/100). Immediate review recommended." });
    else if (scores.overallScore < 70)
      flags.unshift({ level: "warning", category: "Overall", message: "Overall score needs attention (" + scores.overallScore + "/100)." });
    return flags;
  }

  // ============================================================
  // 9. RECOMMENDATION ENGINE (settings-aware)
  // ============================================================

  function generateRecommendations(metrics, scores, settings) {
    var recs = [];
    if (settings.assignmentStructure.enabled && scores.categories.assignmentStructure && scores.categories.assignmentStructure.score < 70) {
      if (metrics.rubricUsagePct < 50) recs.push("Add rubrics to more assignments for clearer grading expectations.");
      if (metrics.dueDateUsagePct < 80) recs.push("Set due dates on all assignments to improve student time management.");
      if (metrics.avgAssignmentLength < 150) recs.push("Expand assignment instructions \u2014 aim for 150+ characters with clear expectations.");
      if (metrics.assignmentsPerWeek < 1) recs.push("Consider adding more weekly assignments to maintain consistent student engagement.");
    }
    if (settings.studentEngagement.enabled && scores.categories.studentEngagement && scores.categories.studentEngagement.score < 70) {
      if (metrics.submissionRatePct < 75) recs.push("Investigate low submission rates \u2014 consider reminders, office hours, or participation activities.");
      if (metrics.missingWorkPct > 30) recs.push("High missing work percentage \u2014 introduce check-ins or early warning outreach.");
      if (metrics.onTimePct < 70) recs.push("Many late submissions \u2014 review due date spacing and workload distribution.");
    }
    if (settings.gradingEfficiency.enabled && scores.categories.gradingEfficiency && scores.categories.gradingEfficiency.score < 70) {
      if (metrics.avgGradingDays > 5) recs.push("Aim to return graded work within 3 days for timely feedback.");
      if (metrics.gradingDaysStdDev > 4) recs.push("Grading turnaround is inconsistent \u2014 try scheduling regular grading blocks.");
    }
    if (settings.communication.enabled && scores.categories.communication && scores.categories.communication.score < 70) {
      if (metrics.announcementsPerWeek < 0.5) recs.push("Increase announcements to at least 1 per week to maintain instructor presence.");
      if (metrics.feedbackCoveragePct < 50) recs.push("Add personalized comments to more graded submissions.");
    }
    if (settings.courseQuality.enabled && scores.categories.courseQuality && scores.categories.courseQuality.score < 70) {
      if (metrics.assignmentTypeVariety < 40) recs.push("Diversify assignment types \u2014 use quizzes, discussions, uploads, and external tools.");
      if (metrics.moduleCoveragePct < 80) recs.push("Populate all course modules with content for better navigation.");
    }
    if (settings.studentPerformance.enabled && scores.categories.studentPerformance && scores.categories.studentPerformance.score < 70) {
      if (metrics.classAvgPct < 70) recs.push("Class average is low \u2014 review assignment difficulty and provide more support resources.");
      if (metrics.passRatePct < 80) recs.push("Pass rate is below 80% \u2014 consider tutoring referrals or supplemental instruction.");
      if (metrics.improvementTrend < -2) recs.push("Scores are declining over the term \u2014 schedule a mid-term check-in.");
    }
    if (recs.length === 0) recs.push("Great work! All categories are performing well. Continue current practices.");
    return recs;
  }

  // ============================================================
  // 10. CSS STYLES
  // ============================================================

  var STYLES = [
    ".cte-btn-group {",
    "  position: fixed; top: 16px; left: 16px; z-index: 99999;",
    "  display: flex; flex-direction: column; gap: 8px;",
    "  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;",
    "}",
    ".cte-round-btn {",
    "  width: 48px; height: 48px; border-radius: 50%; border: none; color: #fff;",
    "  font-size: 20px; cursor: pointer; display: flex; align-items: center;",
    "  justify-content: center; padding: 0; line-height: 1; position: relative;",
    "  transition: transform 0.2s, box-shadow 0.2s, background 0.2s;",
    "}",
    "#cte-trigger-btn {",
    "  background: linear-gradient(135deg, #2563EB, #1D4ED8);",
    "  box-shadow: 0 4px 20px rgba(37,99,235,0.35);",
    "}",
    "#cte-trigger-btn:hover { transform: scale(1.1); box-shadow: 0 6px 28px rgba(37,99,235,0.45); }",
    "#cte-trigger-btn.cte-active {",
    "  background: linear-gradient(135deg, #EF4444, #DC2626);",
    "  box-shadow: 0 4px 20px rgba(239,68,68,0.35);",
    "}",
    "#cte-settings-btn {",
    "  background: linear-gradient(135deg, #6B7280, #4B5563);",
    "  box-shadow: 0 3px 14px rgba(107,114,128,0.35);",
    "  width: 38px; height: 38px; font-size: 17px;",
    "}",
    "#cte-settings-btn:hover { transform: scale(1.1); box-shadow: 0 5px 20px rgba(107,114,128,0.45); }",
    ".cte-round-btn .cte-tooltip {",
    "  position: absolute; left: calc(100% + 12px); top: 50%; transform: translateY(-50%);",
    "  background: #1E293B; color: #fff; padding: 6px 12px; border-radius: 8px;",
    "  font-size: 13px; font-weight: 500; white-space: nowrap;",
    "  opacity: 0; pointer-events: none; transition: opacity 0.15s;",
    "}",
    ".cte-round-btn:hover .cte-tooltip { opacity: 1; }",
    "#cte-overlay {",
    "  position: fixed; inset: 0; z-index: 100000;",
    "  background: rgba(15,23,42,0.6); backdrop-filter: blur(4px);",
    "  display: flex; justify-content: center; align-items: flex-start;",
    "  overflow-y: auto; padding: 30px 20px;",
    "  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;",
    "}",
    "#cte-container { background: #F8FAFC; border-radius: 20px; max-width: 1100px; width: 100%; box-shadow: 0 25px 50px rgba(0,0,0,0.2); overflow: hidden; }",
    ".cte-header { background: linear-gradient(135deg, #1E293B, #0F172A); color: #fff; padding: 28px 36px; display: flex; justify-content: space-between; align-items: center; }",
    ".cte-header h1 { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.3px; }",
    ".cte-header-sub { font-size: 13px; color: #94A3B8; margin-top: 4px; }",
    ".cte-close-btn { background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.15); color: #fff; border-radius: 10px; padding: 8px 16px; cursor: pointer; font-size: 14px; transition: background 0.15s; }",
    ".cte-close-btn:hover { background: rgba(255,255,255,0.2); }",
    ".cte-body { padding: 32px 36px; }",
    ".cte-context-bar { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 28px; }",
    ".cte-context-chip { background: #E2E8F0; color: #334155; padding: 6px 14px; border-radius: 8px; font-size: 13px; font-weight: 500; }",
    ".cte-score-hero { display: flex; align-items: center; gap: 28px; background: #fff; border-radius: 16px; padding: 28px 36px; margin-bottom: 28px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }",
    ".cte-score-circle { width: 110px; height: 110px; border-radius: 50%; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #fff; font-weight: 800; font-size: 36px; flex-shrink: 0; box-shadow: 0 4px 12px rgba(0,0,0,0.15); }",
    ".cte-score-circle small { font-size: 12px; font-weight: 600; opacity: 0.9; margin-top: 2px; }",
    ".cte-score-hero-text h2 { margin: 0 0 6px; font-size: 22px; color: #1E293B; }",
    ".cte-score-hero-text p { margin: 0; font-size: 14px; color: #64748B; line-height: 1.5; }",
    ".cte-cat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 20px; margin-bottom: 28px; }",
    ".cte-cat-card { background: #fff; border-radius: 14px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); transition: box-shadow 0.15s; }",
    ".cte-cat-card:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.1); }",
    ".cte-cat-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }",
    ".cte-cat-title { font-size: 15px; font-weight: 700; color: #1E293B; display: flex; align-items: center; gap: 8px; }",
    ".cte-cat-score-badge { padding: 4px 12px; border-radius: 8px; color: #fff; font-weight: 700; font-size: 16px; }",
    ".cte-cat-metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 16px; margin-bottom: 14px; }",
    ".cte-metric { display: flex; justify-content: space-between; font-size: 13px; padding: 4px 0; border-bottom: 1px solid #F1F5F9; }",
    ".cte-metric-label { color: #64748B; }",
    ".cte-metric-value { color: #1E293B; font-weight: 600; }",
    ".cte-cat-explain { font-size: 12px; color: #94A3B8; line-height: 1.5; margin-top: 8px; padding-top: 10px; border-top: 1px solid #F1F5F9; }",
    ".cte-score-bar-bg { background: #E2E8F0; border-radius: 4px; height: 6px; width: 100%; margin-top: 8px; overflow: hidden; }",
    ".cte-score-bar-fill { height: 100%; border-radius: 4px; transition: width 0.6s ease; }",
    ".cte-flags-section { margin-bottom: 28px; }",
    ".cte-flags-section h3 { font-size: 16px; font-weight: 700; color: #1E293B; margin: 0 0 14px; }",
    ".cte-flag { padding: 12px 18px; border-radius: 10px; margin-bottom: 8px; font-size: 14px; font-weight: 500; display: flex; align-items: center; gap: 10px; }",
    ".cte-flag-critical { background: #FEF2F2; color: #991B1B; border-left: 4px solid #EF4444; }",
    ".cte-flag-warning { background: #FFFBEB; color: #92400E; border-left: 4px solid #F59E0B; }",
    ".cte-no-flags { background: #F0FDF4; color: #166534; padding: 14px 18px; border-radius: 10px; font-size: 14px; font-weight: 500; display: flex; align-items: center; gap: 10px; }",
    ".cte-recs-section h3 { font-size: 16px; font-weight: 700; color: #1E293B; margin: 0 0 14px; }",
    ".cte-rec-item { background: #EFF6FF; color: #1E40AF; padding: 12px 18px; border-radius: 10px; margin-bottom: 8px; font-size: 14px; display: flex; align-items: flex-start; gap: 10px; line-height: 1.5; }",
    ".cte-rec-icon { flex-shrink: 0; margin-top: 1px; }",
    ".cte-footer { display: flex; justify-content: space-between; align-items: center; padding: 20px 36px; border-top: 1px solid #E2E8F0; font-size: 12px; color: #94A3B8; }",
    ".cte-print-btn { background: #2563EB; color: #fff; border: none; border-radius: 8px; padding: 8px 20px; font-size: 13px; font-weight: 600; cursor: pointer; transition: background 0.15s; }",
    ".cte-print-btn:hover { background: #1D4ED8; }",
    ".cte-form { max-width: 520px; margin: 0 auto; }",
    ".cte-form-group { margin-bottom: 20px; }",
    ".cte-form-group label { display: block; font-size: 14px; font-weight: 600; color: #1E293B; margin-bottom: 6px; }",
    ".cte-form-group input, .cte-form-group select { width: 100%; padding: 10px 14px; border: 1px solid #CBD5E1; border-radius: 10px; font-size: 14px; color: #1E293B; background: #fff; box-sizing: border-box; transition: border 0.15s; }",
    ".cte-form-group input:focus, .cte-form-group select:focus { outline: none; border-color: #2563EB; box-shadow: 0 0 0 3px rgba(37,99,235,0.15); }",
    ".cte-form-group .cte-hint { font-size: 12px; color: #94A3B8; margin-top: 4px; }",
    ".cte-form-submit { background: linear-gradient(135deg, #2563EB, #1D4ED8); color: #fff; border: none; border-radius: 12px; padding: 14px 28px; font-size: 15px; font-weight: 600; cursor: pointer; width: 100%; transition: transform 0.15s; }",
    ".cte-form-submit:hover { transform: translateY(-1px); }",
    ".cte-form-submit:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }",
    ".cte-loading { text-align: center; padding: 80px 20px; }",
    ".cte-loading h2 { color: #1E293B; margin: 0 0 12px; font-size: 18px; }",
    ".cte-loading p { color: #64748B; font-size: 14px; margin: 0; }",
    ".cte-spinner { width: 48px; height: 48px; border: 4px solid #E2E8F0; border-top: 4px solid #2563EB; border-radius: 50%; animation: cte-spin 0.8s linear infinite; margin: 0 auto 20px; }",
    "@keyframes cte-spin { to { transform: rotate(360deg); } }",
    ".cte-error-box { background: #FEF2F2; border: 1px solid #FECACA; color: #991B1B; padding: 20px; border-radius: 12px; text-align: center; margin: 40px auto; max-width: 500px; }",
    ".cte-settings { max-width: 720px; margin: 0 auto; }",
    ".cte-settings-intro { background: #EFF6FF; border-radius: 14px; padding: 20px 24px; margin-bottom: 28px; border-left: 4px solid #2563EB; }",
    ".cte-settings-intro h2 { margin: 0 0 8px; font-size: 18px; font-weight: 700; color: #1E293B; display: flex; align-items: center; gap: 10px; }",
    ".cte-settings-intro p { margin: 0; font-size: 14px; color: #475569; line-height: 1.6; }",
    ".cte-settings-cat { background: #fff; border-radius: 14px; padding: 24px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }",
    ".cte-settings-cat-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }",
    ".cte-settings-cat-title { font-size: 16px; font-weight: 700; color: #1E293B; display: flex; align-items: center; gap: 8px; }",
    ".cte-settings-cat-desc { font-size: 13px; color: #64748B; line-height: 1.5; margin-bottom: 16px; padding-bottom: 16px; border-bottom: 1px solid #F1F5F9; }",
    ".cte-settings-item { display: flex; justify-content: space-between; align-items: flex-start; padding: 12px 0; border-bottom: 1px solid #F1F5F9; }",
    ".cte-settings-item:last-child { border-bottom: none; }",
    ".cte-settings-item-info { flex: 1; padding-right: 16px; }",
    ".cte-settings-item-label { font-size: 14px; font-weight: 600; color: #1E293B; margin-bottom: 3px; }",
    ".cte-settings-item-desc { font-size: 12px; color: #94A3B8; line-height: 1.5; }",
    ".cte-toggle { position: relative; width: 44px; height: 24px; flex-shrink: 0; margin-top: 2px; }",
    ".cte-toggle input { opacity: 0; width: 0; height: 0; }",
    ".cte-toggle-slider { position: absolute; cursor: pointer; inset: 0; background: #CBD5E1; border-radius: 24px; transition: 0.2s; }",
    ".cte-toggle-slider:before { content: ''; position: absolute; height: 18px; width: 18px; left: 3px; bottom: 3px; background: #fff; border-radius: 50%; transition: 0.2s; box-shadow: 0 1px 3px rgba(0,0,0,0.15); }",
    ".cte-toggle input:checked + .cte-toggle-slider { background: #2563EB; }",
    ".cte-toggle input:checked + .cte-toggle-slider:before { transform: translateX(20px); }",
    ".cte-toggle input:disabled + .cte-toggle-slider { opacity: 0.4; cursor: not-allowed; }",
    ".cte-settings-cat.cte-disabled .cte-settings-item { opacity: 0.4; pointer-events: none; }",
    ".cte-settings-footer { display: flex; justify-content: space-between; align-items: center; margin-top: 24px; gap: 12px; }",
    ".cte-settings-save { background: linear-gradient(135deg, #2563EB, #1D4ED8); color: #fff; border: none; border-radius: 12px; padding: 12px 28px; font-size: 14px; font-weight: 600; cursor: pointer; transition: transform 0.15s; }",
    ".cte-settings-save:hover { transform: translateY(-1px); }",
    ".cte-settings-reset { background: #fff; color: #64748B; border: 1px solid #CBD5E1; border-radius: 12px; padding: 12px 20px; font-size: 14px; font-weight: 500; cursor: pointer; transition: border-color 0.15s, color 0.15s; }",
    ".cte-settings-reset:hover { border-color: #EF4444; color: #EF4444; }",
    ".cte-settings-saved { background: #F0FDF4; color: #166534; padding: 10px 18px; border-radius: 10px; font-size: 14px; font-weight: 500; text-align: center; margin-top: 16px; display: none; }",
    "@media print { body * { visibility: hidden; } #cte-overlay, #cte-overlay * { visibility: visible; } #cte-overlay { position: static; background: #fff; padding: 0; } #cte-container { box-shadow: none; } .cte-close-btn, .cte-btn-group, .cte-print-btn { display: none !important; } }",
  ].join("\n");

  // ============================================================
  // 11. UI RENDERING
  // ============================================================

  function renderInputForm(courseInfo) {
    var courseName = courseInfo ? courseInfo.name : "";
    var teacherName = courseInfo && courseInfo.teachers && courseInfo.teachers.length
      ? courseInfo.teachers[0].display_name : "";
    return '<div class="cte-form">' +
      '<div style="text-align:center; margin-bottom: 28px;">' +
        '<div style="font-size: 40px; margin-bottom: 8px;">\u{1F4CA}</div>' +
        '<h2 style="margin:0; font-size:20px; color:#1E293B;">Course Evaluation Setup</h2>' +
        '<p style="margin:6px 0 0; font-size:14px; color:#64748B;">Provide context for fair, normalized scoring</p>' +
      '</div>' +
      '<div class="cte-form-group"><label>Course Name</label><input type="text" id="cte-course-name" value="' + escHtml(courseName) + '" /></div>' +
      '<div class="cte-form-group"><label>Teacher Name</label><input type="text" id="cte-teacher-name" value="' + escHtml(teacherName) + '" /></div>' +
      '<div class="cte-form-group"><label>Course Hours</label><input type="number" id="cte-course-hours" placeholder="e.g. 40" value="40" min="1" max="1000" /><div class="cte-hint">Total instructional hours for the course</div></div>' +
      '<div class="cte-form-group"><label>Term Length (weeks)</label><input type="number" id="cte-term-weeks" placeholder="e.g. 10" value="10" min="1" max="52" /></div>' +
      '<button class="cte-form-submit" id="cte-run-btn">Run Evaluation</button>' +
    '</div>';
  }

  function renderLoading(message) {
    return '<div class="cte-loading"><div class="cte-spinner"></div><h2>Collecting Data...</h2><p id="cte-loading-msg">' + escHtml(message || "Initializing...") + '</p></div>';
  }

  function renderError(msg) {
    return '<div class="cte-error-box"><div style="font-size:28px; margin-bottom:10px;">\u26A0\uFE0F</div><strong>Error</strong><p style="margin:8px 0 0;">' + escHtml(msg) + '</p></div>';
  }

  function renderDashboard(scores, metrics, flags, recommendations, context) {
    var overall = scores.overallScore;
    var overallLabel = scoreLabel(overall);

    var flagsHtml = flags.length === 0
      ? '<div class="cte-no-flags">\u2705 No flags \u2014 all categories are performing adequately.</div>'
      : flags.map(function (f) { return '<div class="cte-flag cte-flag-' + f.level + '"><span>' + (f.level === "critical" ? "\u{1F6A8}" : "\u26A0\uFE0F") + '</span><span>' + escHtml(f.message) + '</span></div>'; }).join("");

    var recsHtml = recommendations.map(function (r) { return '<div class="cte-rec-item"><span class="cte-rec-icon">\u{1F4A1}</span><span>' + escHtml(r) + '</span></div>'; }).join("");

    var catCardsHtml = Object.keys(scores.categories).map(function (key) {
      var cat = scores.categories[key];
      var catLabel = scoreLabel(cat.score);
      var metricsHtml = cat.metrics.map(function (m) {
        return '<div class="cte-metric"><span class="cte-metric-label">' + escHtml(m.label) + '</span><span class="cte-metric-value">' + escHtml(String(m.value)) + '</span></div>';
      }).join("");
      return '<div class="cte-cat-card">' +
        '<div class="cte-cat-header"><span class="cte-cat-title">' + cat.icon + ' ' + escHtml(cat.name) + '</span><span class="cte-cat-score-badge" style="background:' + catLabel.color + '">' + cat.score + '</span></div>' +
        '<div class="cte-score-bar-bg"><div class="cte-score-bar-fill" style="width:' + cat.score + '%; background:' + catLabel.color + '"></div></div>' +
        '<div class="cte-cat-metrics" style="margin-top:14px;">' + metricsHtml + '</div>' +
        '<div class="cte-cat-explain">' + escHtml(cat.explanation) + '</div>' +
      '</div>';
    }).join("");

    var enabledCount = Object.keys(scores.categories).length;
    var totalCount = Object.keys(SETTINGS_META).length;
    var settingsNote = enabledCount < totalCount
      ? '<span class="cte-context-chip">\u2699\uFE0F ' + enabledCount + '/' + totalCount + ' categories enabled</span>' : "";

    return '<div class="cte-context-bar">' +
      '<span class="cte-context-chip">\u{1F464} ' + escHtml(context.teacherName) + '</span>' +
      '<span class="cte-context-chip">\u{1F4DA} ' + escHtml(context.courseName) + '</span>' +
      '<span class="cte-context-chip">\u{1F550} ' + context.courseHours + ' hours</span>' +
      '<span class="cte-context-chip">\u{1F4C5} ' + context.termWeeks + ' weeks</span>' +
      '<span class="cte-context-chip">\u{1F465} ' + metrics.studentCount + ' students</span>' +
      settingsNote +
    '</div>' +
    '<div class="cte-score-hero">' +
      '<div class="cte-score-circle" style="background: linear-gradient(135deg, ' + overallLabel.color + ', ' + overallLabel.color + 'dd)">' + overall + '<small>/100</small></div>' +
      '<div class="cte-score-hero-text"><h2>' + overallLabel.label + '</h2><p>Weighted evaluation across ' + enabledCount + ' categories. Normalized for a ' + context.courseHours + '-hour course over ' + context.termWeeks + ' weeks.</p></div>' +
    '</div>' +
    '<div class="cte-cat-grid">' + catCardsHtml + '</div>' +
    '<div class="cte-flags-section"><h3>\u{1F6A9} Flags</h3>' + flagsHtml + '</div>' +
    '<div class="cte-recs-section"><h3>\u{1F4A1} Recommendations</h3>' + recsHtml + '</div>';
  }

  // ============================================================
  // 11b. SETTINGS UI
  // ============================================================

  function renderSettingsPage(settings) {
    var categoriesHtml = "";
    var catKeys = Object.keys(SETTINGS_META);
    for (var ci = 0; ci < catKeys.length; ci++) {
      var catKey = catKeys[ci];
      var catMeta = SETTINGS_META[catKey];
      var catEnabled = settings[catKey].enabled;
      var disabledClass = catEnabled ? "" : "cte-disabled";

      var itemsHtml = "";
      var itemKeys = Object.keys(catMeta.items);
      for (var ii = 0; ii < itemKeys.length; ii++) {
        var itemKey = itemKeys[ii];
        var itemMeta = catMeta.items[itemKey];
        var itemEnabled = settings[catKey].items[itemKey];
        itemsHtml +=
          '<div class="cte-settings-item">' +
            '<div class="cte-settings-item-info">' +
              '<div class="cte-settings-item-label">' + escHtml(itemMeta.label) + '</div>' +
              '<div class="cte-settings-item-desc">' + escHtml(itemMeta.description) + '</div>' +
            '</div>' +
            '<label class="cte-toggle">' +
              '<input type="checkbox" data-cat="' + catKey + '" data-item="' + itemKey + '" ' + (itemEnabled ? "checked" : "") + ' ' + (!catEnabled ? "disabled" : "") + ' />' +
              '<span class="cte-toggle-slider"></span>' +
            '</label>' +
          '</div>';
      }

      categoriesHtml +=
        '<div class="cte-settings-cat ' + disabledClass + '" data-cat-key="' + catKey + '">' +
          '<div class="cte-settings-cat-header">' +
            '<span class="cte-settings-cat-title">' + catMeta.icon + ' ' + escHtml(catMeta.label) + '</span>' +
            '<label class="cte-toggle">' +
              '<input type="checkbox" data-cat-toggle="' + catKey + '" ' + (catEnabled ? "checked" : "") + ' />' +
              '<span class="cte-toggle-slider"></span>' +
            '</label>' +
          '</div>' +
          '<div class="cte-settings-cat-desc">' + escHtml(catMeta.description) + '</div>' +
          itemsHtml +
        '</div>';
    }

    return '<div class="cte-settings">' +
      '<div class="cte-settings-intro">' +
        '<h2>\u2699\uFE0F Evaluation Settings</h2>' +
        '<p>Choose which data sources and metrics are included in the evaluation. ' +
        'Disable entire categories or individual items to customize the report for your needs. ' +
        "For example, if your institution doesn't use announcements, turn them off under Communication " +
        "so they don't unfairly lower the score. Settings are saved in Tampermonkey storage and persist across sessions.</p>" +
      '</div>' +
      categoriesHtml +
      '<div class="cte-settings-footer">' +
        '<button class="cte-settings-reset" id="cte-reset-settings">Reset to Defaults</button>' +
        '<button class="cte-settings-save" id="cte-save-settings">Save Settings</button>' +
      '</div>' +
      '<div class="cte-settings-saved" id="cte-saved-msg">\u2705 Settings saved!</div>' +
    '</div>';
  }

  function attachSettingsListeners(bodyEl) {
    bodyEl.querySelectorAll("input[data-cat-toggle]").forEach(function (toggle) {
      toggle.addEventListener("change", function () {
        var catKey = toggle.getAttribute("data-cat-toggle");
        var catCard = bodyEl.querySelector('.cte-settings-cat[data-cat-key="' + catKey + '"]');
        var itemToggles = catCard.querySelectorAll("input[data-item]");
        if (toggle.checked) {
          catCard.classList.remove("cte-disabled");
          itemToggles.forEach(function (it) { it.disabled = false; });
        } else {
          catCard.classList.add("cte-disabled");
          itemToggles.forEach(function (it) { it.disabled = true; });
        }
      });
    });

    document.getElementById("cte-save-settings").addEventListener("click", function () {
      var newSettings = getDefaultSettings();
      bodyEl.querySelectorAll("input[data-cat-toggle]").forEach(function (toggle) {
        newSettings[toggle.getAttribute("data-cat-toggle")].enabled = toggle.checked;
      });
      bodyEl.querySelectorAll("input[data-item]").forEach(function (toggle) {
        newSettings[toggle.getAttribute("data-cat")].items[toggle.getAttribute("data-item")] = toggle.checked;
      });
      saveSettings(newSettings);
      var msg = document.getElementById("cte-saved-msg");
      msg.style.display = "block";
      setTimeout(function () { msg.style.display = "none"; }, 2500);
    });

    document.getElementById("cte-reset-settings").addEventListener("click", function () {
      var defaults = getDefaultSettings();
      saveSettings(defaults);
      bodyEl.innerHTML = renderSettingsPage(defaults);
      attachSettingsListeners(bodyEl);
      var msg = document.getElementById("cte-saved-msg");
      msg.style.display = "block";
      setTimeout(function () { msg.style.display = "none"; }, 2500);
    });
  }

  // ============================================================
  // 12. MAIN ORCHESTRATION
  // ============================================================

  var overlayEl = null;

  function createOverlay(title, subtitle) {
    if (overlayEl) overlayEl.remove();
    overlayEl = document.createElement("div");
    overlayEl.id = "cte-overlay";
    document.body.appendChild(overlayEl);
    overlayEl.innerHTML =
      '<div id="cte-container">' +
        '<div class="cte-header"><div>' +
          '<h1>' + escHtml(title || "Canvas Teacher Evaluation") + '</h1>' +
          '<div class="cte-header-sub">' + escHtml(subtitle || ("v" + VERSION + " \u2014 Data-Driven Evaluation System")) + '</div>' +
        '</div>' +
        '<button class="cte-close-btn" id="cte-close">\u2715 Close</button></div>' +
        '<div class="cte-body" id="cte-body"></div>' +
        '<div class="cte-footer" id="cte-footer" style="display:none;">' +
          '<span>Generated ' + new Date().toLocaleDateString() + ' \u2014 Canvas Teacher Evaluation Tool</span>' +
          '<button class="cte-print-btn" id="cte-print">\u{1F5A8}\uFE0F Print Report</button>' +
        '</div>' +
      '</div>';
    document.getElementById("cte-close").addEventListener("click", closeOverlay);
    document.getElementById("cte-print").addEventListener("click", function () { window.print(); });
    overlayEl.addEventListener("click", function (e) { if (e.target === overlayEl) closeOverlay(); });
    return document.getElementById("cte-body");
  }

  function closeOverlay() {
    if (overlayEl) { overlayEl.remove(); overlayEl = null; }
    var btn = document.getElementById("cte-trigger-btn");
    if (btn) btn.classList.remove("cte-active");
  }

  function toggleEvaluation() {
    if (overlayEl) { closeOverlay(); return; }
    launchEvaluation();
  }

  function openSettings() {
    if (overlayEl) closeOverlay();
    var bodyEl = createOverlay("Evaluation Settings", "Customize which metrics are evaluated");
    var settings = loadSettings();
    bodyEl.innerHTML = renderSettingsPage(settings);
    attachSettingsListeners(bodyEl);
  }

  async function launchEvaluation() {
    var courseId = getCourseId();
    if (!courseId) { alert("Please navigate to a Canvas course page first."); return; }

    var triggerBtn = document.getElementById("cte-trigger-btn");
    if (triggerBtn) triggerBtn.classList.add("cte-active");

    var bodyEl = createOverlay();
    var courseInfo = null;
    try {
      bodyEl.innerHTML = renderLoading("Loading course info...");
      courseInfo = await fetchCourseInfo(courseId);
    } catch (e) { /* continue */ }

    bodyEl.innerHTML = renderInputForm(courseInfo);

    document.getElementById("cte-run-btn").addEventListener("click", async function () {
      var courseName = document.getElementById("cte-course-name").value.trim() || "Unknown Course";
      var teacherName = document.getElementById("cte-teacher-name").value.trim() || "Unknown Teacher";
      var courseHours = parseInt(document.getElementById("cte-course-hours").value, 10) || 40;
      var termWeeks = parseInt(document.getElementById("cte-term-weeks").value, 10) || 10;
      // Delivery type is fixed to "online" for scoring normalization
      var deliveryType = "online";
      var context = { courseName: courseName, teacherName: teacherName, courseHours: courseHours, termWeeks: termWeeks, deliveryType: deliveryType };
      var settings = loadSettings();

      bodyEl.innerHTML = renderLoading("Starting data collection...");
      var loadingMsg = document.getElementById("cte-loading-msg");

      try {
        var data = await collectAllData(courseId, function (msg) { if (loadingMsg) loadingMsg.textContent = msg; });
        if (loadingMsg) loadingMsg.textContent = "Computing metrics...";
        var metrics = computeMetrics(data, context);
        if (loadingMsg) loadingMsg.textContent = "Scoring...";
        var scores = computeAllScores(metrics, context, settings);
        var flags = generateFlags(scores);
        var recommendations = generateRecommendations(metrics, scores, settings);
        bodyEl.innerHTML = renderDashboard(scores, metrics, flags, recommendations, context);
        document.getElementById("cte-footer").style.display = "flex";
      } catch (err) {
        bodyEl.innerHTML = renderError(err.message || "An error occurred during evaluation.");
        console.error("[CTE]", err);
      }
    });
  }

  // ============================================================
  // 13. INITIALIZATION
  // ============================================================

  function init() {
    var styleEl = document.createElement("style");
    styleEl.textContent = STYLES;
    document.head.appendChild(styleEl);

    if (getCourseId()) {





    }

    if (typeof GM_registerMenuCommand !== "undefined") {
      GM_registerMenuCommand("\u{1F4CA} Evaluate This Course", toggleEvaluation);
      GM_registerMenuCommand("\u2699\uFE0F Evaluation Settings", openSettings);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // ─────────────────────────────────────────────
  // REGISTER WITH CANVAS DASHBOARD TOOLBAR
  // ─────────────────────────────────────────────
  (function tryRegister() {
    if (unsafeWindow.CanvasDash) {
      unsafeWindow.CanvasDash.register({
        id:          "teacher-eval",
        name:        "Teacher Eval",
        description: "Run a data-driven evaluation of this course",
        color:       "#f39c12",
        run:         toggleEvaluation
      });
      unsafeWindow.CanvasDash.register({
        id:          "teacher-eval-settings",
        name:        "⚙️",
        description: "Evaluation settings — configure which metrics are included",
        color:       "#6b7280",
        run:         openSettings
      });
    } else {
      setTimeout(tryRegister, 100);
    }
  })();

})();
