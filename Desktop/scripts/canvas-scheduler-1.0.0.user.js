// ==UserScript==
// @name         Canvas Scheduler
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  Drag assignments, discussions, and quizzes onto weekday-based due dates and publish the schedule back to Canvas.
// @match        https://*.instructure.com/*
// @match        *://canvas.*.edu/*
// @match        *://canvas.*.com/*
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/MarkAlanBrest/scripts/main/canvas-scheduler-1.0.0.user.js
// @updateURL    https://raw.githubusercontent.com/MarkAlanBrest/scripts/main/canvas-scheduler-1.0.0.user.js
// ==/UserScript==

(function () {
  'use strict';

  const SETTINGS_KEY = 'canvas_scheduler_settings_v1';
  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const TYPE_COLORS = {
    Assignment: '#2563eb',
    Discussion: '#c2410c',
    Test: '#0f766e'
  };

  const savedSettings = GM_getValue(SETTINGS_KEY, {});
  const state = {
    open: false,
    loading: false,
    saving: false,
    notice: '',
    noticeType: 'info',
    courseId: null,
    search: '',
    draggedItemId: null,
    slotCount: Math.max(12, Number(savedSettings.slotCount) || 12),
    settings: {
      startDate: savedSettings.startDate || todayKey(),
      weekdays: normalizeWeekdays(savedSettings.weekdays),
      dueTime: savedSettings.dueTime || '23:59',
      openDaysBefore: normalizeInt(savedSettings.openDaysBefore, 2),
      closeDaysAfter: normalizeInt(savedSettings.closeDaysAfter, 2),
      answersDaysAfter: normalizeInt(savedSettings.answersDaysAfter, 1)
    },
    modules: [],
    items: [],
    generatedDateKeys: [],
    schedule: {}
  };

  function normalizeInt(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  }

  function normalizeWeekdays(value) {
    if (!Array.isArray(value)) return [1, 3];
    const normalized = value
      .map((entry) => Number(entry))
      .filter((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 6);
    const unique = [...new Set(normalized)].slice(0, 2);
    return unique.length ? unique : [1, 3];
  }

  function todayKey() {
    return toDateKey(new Date());
  }

  function toDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function fromDateKey(dateKey) {
    const [year, month, day] = String(dateKey).split('-').map(Number);
    return new Date(year, (month || 1) - 1, day || 1, 12, 0, 0, 0);
  }

  function addDays(dateKey, delta) {
    const date = fromDateKey(dateKey);
    date.setDate(date.getDate() + delta);
    return toDateKey(date);
  }

  function combineLocalDateAndTime(dateKey, timeValue) {
    const [hours, minutes] = String(timeValue || '23:59').split(':').map(Number);
    const date = fromDateKey(dateKey);
    date.setHours(Number.isFinite(hours) ? hours : 23, Number.isFinite(minutes) ? minutes : 59, 0, 0);
    return date.toISOString();
  }

  function formatDateLabel(dateKey) {
    const date = fromDateKey(dateKey);
    return date.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });
  }

  function formatFullDateLabel(dateKey) {
    const date = fromDateKey(dateKey);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }

  function formatCanvasDate(isoValue) {
    if (!isoValue) return 'Not set';
    const date = new Date(isoValue);
    if (Number.isNaN(date.getTime())) return 'Not set';
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  function formatCompactCanvasDate(isoValue) {
    if (!isoValue) return 'No due date';
    const date = new Date(isoValue);
    if (Number.isNaN(date.getTime())) return 'No due date';
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  function getCourseId() {
    const match = window.location.pathname.match(/\/courses\/(\d+)/);
    return match ? match[1] : null;
  }

  function getCSRF() {
    const cookieMatch = document.cookie.match(/(?:^|;\s*)_csrf_token=([^;]+)/);
    if (cookieMatch) return decodeURIComponent(cookieMatch[1]);
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.getAttribute('content') : '';
  }

  function escHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function setNotice(message, type) {
    state.notice = message;
    state.noticeType = type || 'info';
    render();
  }

  function persistSettings() {
    GM_setValue(SETTINGS_KEY, {
      startDate: state.settings.startDate,
      weekdays: state.settings.weekdays,
      dueTime: state.settings.dueTime,
      openDaysBefore: state.settings.openDaysBefore,
      closeDaysAfter: state.settings.closeDaysAfter,
      answersDaysAfter: state.settings.answersDaysAfter,
      slotCount: state.slotCount
    });
  }

  function getGeneratedDates() {
    const selected = [...state.settings.weekdays].sort((a, b) => a - b);
    if (!selected.length) return [];

    const dates = [];
    const seen = new Set();
    const cursor = fromDateKey(state.settings.startDate);
    let attempts = 0;
    const target = Math.max(4, state.slotCount);

    while (dates.length < target && attempts < 500) {
      const key = toDateKey(cursor);
      if (selected.includes(cursor.getDay()) && !seen.has(key)) {
        seen.add(key);
        dates.push(key);
      }
      cursor.setDate(cursor.getDate() + 1);
      attempts += 1;
    }

    return dates;
  }

  function syncGeneratedDates() {
    const generated = getGeneratedDates();
    const assignedDates = Object.values(state.schedule).filter(Boolean);
    const merged = [...generated];

    assignedDates.forEach((dateKey) => {
      if (!merged.includes(dateKey)) merged.push(dateKey);
    });

    merged.sort();
    state.generatedDateKeys = merged;
  }

  function matchesSearch(item) {
    if (!state.search.trim()) return true;
    const needle = state.search.trim().toLowerCase();
    return [
      item.title,
      item.type,
      item.primaryModuleName,
      ...(item.moduleNames || [])
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(needle));
  }

  function isScheduled(itemId) {
    return Boolean(state.schedule[itemId]);
  }

  function getUnscheduledItems() {
    return state.items.filter((item) => !isScheduled(item.id) && matchesSearch(item));
  }

  function getItemsForDate(dateKey) {
    return state.items.filter((item) => state.schedule[item.id] === dateKey && matchesSearch(item));
  }

  function getPrimaryModuleLabel(item) {
    if (!item.primaryModuleName) return 'No module';
    if (item.moduleNames.length <= 1) return item.primaryModuleName;
    return `${item.primaryModuleName} +${item.moduleNames.length - 1}`;
  }

  function inferItemType(assignment, quiz) {
    if (quiz || assignment.is_quiz_assignment) return 'Test';
    if (Array.isArray(assignment.submission_types) && assignment.submission_types.includes('discussion_topic')) return 'Discussion';
    return 'Assignment';
  }

  function buildItems(modules, assignments, quizzes) {
    const quizByAssignmentId = new Map();
    const quizById = new Map();
    quizzes.forEach((quiz) => {
      quizById.set(Number(quiz.id), quiz);
      if (quiz.assignment_id) quizByAssignmentId.set(Number(quiz.assignment_id), quiz);
    });

    const moduleLookup = new Map();
    const discussionAssignmentsByName = new Map();

    assignments.forEach((assignment) => {
      if (Array.isArray(assignment.submission_types) && assignment.submission_types.includes('discussion_topic')) {
        const list = discussionAssignmentsByName.get(assignment.name) || [];
        list.push(assignment);
        discussionAssignmentsByName.set(assignment.name, list);
      }
    });

    modules.forEach((module) => {
      (module.items || []).forEach((moduleItem) => {
        let assignmentId = null;
        if (moduleItem.type === 'Assignment') {
          assignmentId = Number(moduleItem.content_id);
        } else if (moduleItem.type === 'Quiz') {
          const quiz = quizById.get(Number(moduleItem.content_id));
          assignmentId = quiz ? Number(quiz.assignment_id) : null;
        } else if (moduleItem.type === 'Discussion') {
          const match = (discussionAssignmentsByName.get(moduleItem.title) || []).find((assignment) => !moduleLookup.has(Number(assignment.id)));
          assignmentId = match ? Number(match.id) : null;
        }

        if (!assignmentId) return;

        const list = moduleLookup.get(assignmentId) || [];
        list.push({
          moduleId: module.id,
          moduleName: module.name,
          modulePosition: Number(module.position) || 9999,
          itemPosition: Number(moduleItem.position) || 9999
        });
        moduleLookup.set(assignmentId, list);
      });
    });

    const items = assignments.flatMap((assignment) => {
      const modulesForItem = (moduleLookup.get(Number(assignment.id)) || []).sort((a, b) => {
        if (a.modulePosition !== b.modulePosition) return a.modulePosition - b.modulePosition;
        return a.itemPosition - b.itemPosition;
      });
      if (!modulesForItem.length) return [];
      const quiz = quizByAssignmentId.get(Number(assignment.id)) || null;
      const moduleNames = modulesForItem.map((entry) => entry.moduleName);
      return [{
        id: `assignment-${assignment.id}`,
        assignmentId: Number(assignment.id),
        quizId: quiz ? Number(quiz.id) : null,
        title: assignment.name || 'Untitled item',
        type: inferItemType(assignment, quiz),
        color: TYPE_COLORS[inferItemType(assignment, quiz)] || '#2563eb',
        moduleNames,
        primaryModuleName: moduleNames[0] || '',
        currentDueAt: assignment.due_at || '',
        currentUnlockAt: assignment.unlock_at || '',
        currentLockAt: assignment.lock_at || '',
        currentAnswersAt: quiz ? (quiz.show_correct_answers_at || '') : '',
        published: assignment.published !== false,
        htmlUrl: assignment.html_url || '',
        orderKey: [
          String(modulesForItem[0]?.modulePosition || 9999).padStart(4, '0'),
          String(modulesForItem[0]?.itemPosition || 9999).padStart(4, '0'),
          (assignment.name || '').toLowerCase()
        ].join('-')
      }];
    });

    items.sort((a, b) => a.orderKey.localeCompare(b.orderKey));
    return items;
  }

  async function canvasRequest(url, options) {
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-CSRF-Token': getCSRF()
      },
      credentials: 'same-origin',
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Canvas API ${response.status}: ${text.slice(0, 200)}`);
    }

    if (response.status === 204) {
      return { data: null, response };
    }

    return { data: await response.json(), response };
  }

  function getNextLink(linkHeader) {
    if (!linkHeader) return null;
    const parts = linkHeader.split(',');
    for (const part of parts) {
      const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
      if (match && match[2] === 'next') return match[1];
    }
    return null;
  }

  async function canvasList(path) {
    let nextUrl = path.startsWith('http') ? path : `${window.location.origin}${path}`;
    const all = [];
    while (nextUrl) {
      const { data, response } = await canvasRequest(nextUrl, { method: 'GET' });
      if (Array.isArray(data)) all.push(...data);
      nextUrl = getNextLink(response.headers.get('Link'));
    }
    return all;
  }

  async function canvasAPI(method, path, body) {
    const url = path.startsWith('http') ? path : `${window.location.origin}${path}`;
    const { data } = await canvasRequest(url, { method, body });
    return data;
  }

  async function loadModules(courseId) {
    const modules = await canvasList(`/api/v1/courses/${courseId}/modules?per_page=100`);
    const withItems = await Promise.all(
      modules.map(async (module) => ({
        ...module,
        items: await canvasList(`/api/v1/courses/${courseId}/modules/${module.id}/items?per_page=100`)
      }))
    );
    return withItems;
  }

  function hydrateExistingSchedule() {
    const nextSchedule = {};
    state.items.forEach((item) => {
      if (!item.currentDueAt) return;
      const dueDate = new Date(item.currentDueAt);
      if (Number.isNaN(dueDate.getTime())) return;
      nextSchedule[item.id] = toDateKey(dueDate);
    });
    state.schedule = nextSchedule;
  }

  async function loadCourseData() {
    const courseId = getCourseId();
    if (!courseId) {
      setNotice('Open a Canvas course first.', 'err');
      return;
    }

    state.loading = true;
    state.courseId = courseId;
    setNotice('Loading course items from Canvas...', 'info');

    try {
      const [modules, assignments, quizzes] = await Promise.all([
        loadModules(courseId),
        canvasList(`/api/v1/courses/${courseId}/assignments?per_page=100`),
        canvasList(`/api/v1/courses/${courseId}/quizzes?per_page=100`)
      ]);

      state.modules = modules;
      state.items = buildItems(modules, assignments, quizzes);
      hydrateExistingSchedule();
      syncGeneratedDates();
      setNotice(`Loaded ${state.items.length} module items from this course.`, 'ok');
    } catch (error) {
      setNotice(`Could not load Canvas data: ${error.message}`, 'err');
    } finally {
      state.loading = false;
      render();
    }
  }

  function updateSetting(name, value) {
    state.settings[name] = value;
    persistSettings();
    syncGeneratedDates();
    render();
  }

  function toggleWeekday(dayIndex) {
    const selected = [...state.settings.weekdays];
    const existingIndex = selected.indexOf(dayIndex);
    if (existingIndex >= 0) {
      selected.splice(existingIndex, 1);
    } else {
      if (selected.length >= 2) {
        setNotice('Choose up to two due weekdays at a time.', 'info');
        return;
      }
      selected.push(dayIndex);
    }

    selected.sort((a, b) => a - b);
    state.settings.weekdays = selected;
    persistSettings();
    syncGeneratedDates();
    render();
  }

  function updateSchedule(itemId, dateKey) {
    if (dateKey) {
      state.schedule[itemId] = dateKey;
    } else {
      delete state.schedule[itemId];
    }
    syncGeneratedDates();
    render();
  }

  function buildTileMarkup(item) {
    const dueLabel = formatCompactCanvasDate(item.currentDueAt);
    const statusLabel = item.published ? dueLabel : `Draft | ${dueLabel}`;

    return `
      <div class="csch-item-top">
        <span class="csch-type-pill" style="background:${item.color}">${escHtml(item.type)}</span>
      </div>
      <div class="csch-item-title">${escHtml(item.title)}</div>
      <div class="csch-item-module">${escHtml(getPrimaryModuleLabel(item))}</div>
      <div class="csch-item-meta-row">
        <span class="csch-item-meta">${escHtml(statusLabel)}</span>
        ${item.htmlUrl ? `<a class="csch-item-link" href="${item.htmlUrl}" target="_blank" rel="noopener noreferrer">Open</a>` : ''}
      </div>
    `;
  }

  function groupItemsByModule(items) {
    const grouped = new Map();
    items.forEach((item) => {
      const key = item.primaryModuleName || 'No module';
      const list = grouped.get(key) || [];
      list.push(item);
      grouped.set(key, list);
    });
    return [...grouped.entries()];
  }

  async function publishSchedule() {
    const scheduledItems = state.items.filter((item) => Boolean(state.schedule[item.id]));
    if (!scheduledItems.length) {
      setNotice('Drag at least one item onto a date before publishing.', 'err');
      return;
    }

    if (!state.courseId) {
      setNotice('Open a Canvas course first.', 'err');
      return;
    }

    state.saving = true;
    setNotice(`Publishing ${scheduledItems.length} item${scheduledItems.length === 1 ? '' : 's'} to Canvas...`, 'info');
    render();

    try {
      for (const item of scheduledItems) {
        const dueDateKey = state.schedule[item.id];
        const dueAt = combineLocalDateAndTime(dueDateKey, state.settings.dueTime);
        const unlockAt = combineLocalDateAndTime(addDays(dueDateKey, -state.settings.openDaysBefore), '00:00');
        const lockAt = combineLocalDateAndTime(addDays(dueDateKey, state.settings.closeDaysAfter), '23:59');

        await canvasAPI('PUT', `/api/v1/courses/${state.courseId}/assignments/${item.assignmentId}`, {
          assignment: {
            due_at: dueAt,
            unlock_at: unlockAt,
            lock_at: lockAt
          }
        });

        if (item.quizId) {
          const answersAt = combineLocalDateAndTime(addDays(dueDateKey, state.settings.answersDaysAfter), state.settings.dueTime);
          await canvasAPI('PUT', `/api/v1/courses/${state.courseId}/quizzes/${item.quizId}`, {
            quiz: {
              show_correct_answers: true,
              show_correct_answers_at: answersAt
            }
          });
        }
      }

      state.items = state.items.map((item) => {
        const dueDateKey = state.schedule[item.id];
        if (!dueDateKey) return item;
        return {
          ...item,
          currentDueAt: combineLocalDateAndTime(dueDateKey, state.settings.dueTime),
          currentUnlockAt: combineLocalDateAndTime(addDays(dueDateKey, -state.settings.openDaysBefore), '00:00'),
          currentLockAt: combineLocalDateAndTime(addDays(dueDateKey, state.settings.closeDaysAfter), '23:59'),
          currentAnswersAt: item.quizId
            ? combineLocalDateAndTime(addDays(dueDateKey, state.settings.answersDaysAfter), state.settings.dueTime)
            : item.currentAnswersAt
        };
      });

      setNotice(`Canvas updated ${scheduledItems.length} item${scheduledItems.length === 1 ? '' : 's'}.`, 'ok');
    } catch (error) {
      setNotice(`Canvas could not save the schedule: ${error.message}`, 'err');
    } finally {
      state.saving = false;
      render();
    }
  }

  function handleTileDragStart(itemId, event) {
    state.draggedItemId = itemId;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', itemId);
  }

  function wireDragAndDrop() {
    document.querySelectorAll('[data-csch-item-id]').forEach((element) => {
      element.addEventListener('dragstart', (event) => handleTileDragStart(element.getAttribute('data-csch-item-id'), event));
    });

    document.querySelectorAll('[data-csch-drop-date]').forEach((zone) => {
      zone.addEventListener('dragover', (event) => {
        event.preventDefault();
        zone.classList.add('csch-drop-active');
      });
      zone.addEventListener('dragleave', () => zone.classList.remove('csch-drop-active'));
      zone.addEventListener('drop', (event) => {
        event.preventDefault();
        zone.classList.remove('csch-drop-active');
        const itemId = event.dataTransfer.getData('text/plain') || state.draggedItemId;
        if (!itemId) return;
        updateSchedule(itemId, zone.getAttribute('data-csch-drop-date') || '');
      });
    });
  }

  function render() {
    const status = document.getElementById('csch-toolbar-status');
    const leftBody = document.getElementById('csch-left-body');
    const rightBody = document.getElementById('csch-board');
    if (!status || !leftBody || !rightBody) return;

    status.className = `csch-toolbar-status csch-toolbar-status-${state.noticeType}`;
    status.textContent = state.notice || (state.items.length
      ? `${Object.keys(state.schedule).length} scheduled of ${state.items.length} items`
      : 'Open a course to load items');

    const unscheduledItems = getUnscheduledItems();
    const grouped = groupItemsByModule(unscheduledItems);
    leftBody.innerHTML = `
      <div class="csch-dropzone csch-unscheduled" data-csch-drop-date="">
        <div class="csch-dropzone-head">
          <strong>Unscheduled</strong>
          <span>${unscheduledItems.length}</span>
        </div>
        <div class="csch-dropzone-help">Drag any tile back here to clear its due date slot.</div>
      </div>
      ${grouped.length ? grouped.map(([moduleName, items]) => `
        <section class="csch-module-group">
          <div class="csch-module-head">${escHtml(moduleName)}</div>
          <div class="csch-tile-stack">
            ${items.map((item) => `
              <article class="csch-item" draggable="true" data-csch-item-id="${item.id}">
                ${buildTileMarkup(item)}
              </article>
            `).join('')}
          </div>
        </section>
      `).join('') : `
        <div class="csch-empty-state">
          ${state.items.length ? 'No unscheduled items match this filter.' : 'Load a Canvas course to see module items here.'}
        </div>
      `}
    `;

    rightBody.innerHTML = state.generatedDateKeys.length ? state.generatedDateKeys.map((dateKey) => {
      const items = getItemsForDate(dateKey);
      return `
        <section class="csch-date-col">
          <div class="csch-date-head">
            <div class="csch-date-head-main">
              <div class="csch-date-title">${escHtml(formatDateLabel(dateKey))}</div>
              <div class="csch-date-count">${items.length}</div>
            </div>
            <div class="csch-date-sub">${escHtml(formatFullDateLabel(dateKey))}</div>
          </div>
          <div class="csch-dropzone csch-date-drop" data-csch-drop-date="${dateKey}">
            ${items.length ? items.map((item) => `
              <article class="csch-item csch-item-scheduled" draggable="true" data-csch-item-id="${item.id}">
                ${buildTileMarkup(item)}
              </article>
            `).join('') : `
              <div class="csch-empty-slot">Drop items here</div>
            `}
          </div>
        </section>
      `;
    }).join('') : `
      <div class="csch-empty-board">Pick one or two weekdays to generate due-date columns.</div>
    `;

    document.getElementById('csch-load-btn').disabled = state.loading;
    document.getElementById('csch-publish-btn').disabled = state.loading || state.saving || !state.items.length;
    document.getElementById('csch-publish-btn').textContent = state.saving ? 'Publishing...' : 'Publish';

    document.querySelectorAll('[data-weekday]').forEach((button) => {
      const dayIndex = Number(button.getAttribute('data-weekday'));
      button.classList.toggle('active', state.settings.weekdays.includes(dayIndex));
    });

    document.getElementById('csch-start-date').value = state.settings.startDate;
    document.getElementById('csch-due-time').value = state.settings.dueTime;
    document.getElementById('csch-open-offset').value = String(state.settings.openDaysBefore);
    document.getElementById('csch-close-offset').value = String(state.settings.closeDaysAfter);
    document.getElementById('csch-answer-offset').value = String(state.settings.answersDaysAfter);

    wireDragAndDrop();
  }

  function openApp() {
    app.classList.add('open');
    state.open = true;
    if (!state.items.length && !state.loading) loadCourseData();
    render();
  }

  function closeApp() {
    app.classList.remove('open');
    state.open = false;
  }

  const app = document.createElement('div');
  app.id = 'csch-app';
  app.innerHTML = `
    <div id="csch-shell">
      <div id="csch-topbar">
        <div class="csch-toolbar-inline">
          <span id="csch-toolbar-status" class="csch-toolbar-status csch-toolbar-status-info">Open a course to load items</span>
          <details class="csch-settings-menu">
            <summary class="csch-btn">Controls</summary>
            <div class="csch-settings-popover">
              <div class="csch-settings-section">
                <div class="csch-settings-title">Scheduling</div>
                <div class="csch-toolbar-block csch-toolbar-block-date">
                  <label for="csch-start-date">Start date</label>
                  <input id="csch-start-date" type="date">
                </div>
                <div class="csch-toolbar-block csch-toolbar-block-days">
                  <span>Due days</span>
                  <div class="csch-weekdays">
                    ${DAY_NAMES.map((day, index) => `<button type="button" class="csch-day-btn" data-weekday="${index}">${day}</button>`).join('')}
                  </div>
                </div>
                <div class="csch-toolbar-block csch-toolbar-block-time">
                  <label for="csch-due-time">Due time</label>
                  <input id="csch-due-time" type="time">
                </div>
              </div>
              <div class="csch-settings-section">
                <div class="csch-settings-title">Availability</div>
                <div class="csch-toolbar-block">
                  <label for="csch-open-offset">Open days before</label>
                  <input id="csch-open-offset" type="number" min="0" step="1">
                </div>
                <div class="csch-toolbar-block">
                  <label for="csch-close-offset">Close days after</label>
                  <input id="csch-close-offset" type="number" min="0" step="1">
                </div>
                <div class="csch-toolbar-block">
                  <label for="csch-answer-offset">Show answers days after</label>
                  <input id="csch-answer-offset" type="number" min="0" step="1">
                </div>
              </div>
              <div class="csch-settings-section">
                <div class="csch-settings-title">Actions</div>
                <div class="csch-settings-actions">
                  <button type="button" class="csch-btn" id="csch-more-dates-btn">More Dates</button>
                  <button type="button" class="csch-btn" id="csch-load-btn">Reload</button>
                  <button type="button" class="csch-btn csch-btn-primary" id="csch-publish-btn">Publish</button>
                </div>
              </div>
            </div>
          </details>
        </div>
        <div class="csch-top-actions">
          <button type="button" class="csch-btn csch-btn-ghost" id="csch-close-btn">Close</button>
        </div>
      </div>

      <div id="csch-layout">
        <aside id="csch-left">
          <div class="csch-pane-head">
            <h2>Course Items</h2>
          </div>
          <div id="csch-left-body"></div>
        </aside>
        <main id="csch-right">
          <div class="csch-pane-head">
            <h2>Schedule Board</h2>
            <span class="csch-pane-note">2 weekdays max</span>
          </div>
          <div id="csch-board"></div>
        </main>
      </div>
    </div>
  `;
  document.body.appendChild(app);

  const fallbackLauncher = document.createElement('button');
  fallbackLauncher.id = 'csch-launcher';
  fallbackLauncher.type = 'button';
  fallbackLauncher.textContent = 'Scheduler';
  fallbackLauncher.addEventListener('click', openApp);
  document.body.appendChild(fallbackLauncher);

  GM_addStyle(`
    #csch-launcher {
      position: fixed;
      right: 18px;
      bottom: 18px;
      z-index: 2147483000;
      border: none;
      border-radius: 999px;
      padding: 12px 18px;
      background: linear-gradient(135deg, #0f766e, #2563eb);
      color: #fff;
      font: 700 13px/1 "Segoe UI", Arial, sans-serif;
      box-shadow: 0 16px 32px rgba(15, 118, 110, 0.25);
      cursor: pointer;
    }

    #csch-app {
      display: none;
      position: fixed;
      inset: 0;
      z-index: 2147483640;
      background: rgba(15, 23, 42, 0.42);
      font-family: "Segoe UI", Arial, sans-serif;
      color: #172554;
    }

    #csch-app.open {
      display: block;
    }

    #csch-app * {
      box-sizing: border-box;
    }

    #csch-shell {
      position: absolute;
      inset: 8px;
      border-radius: 16px;
      overflow: hidden;
      display: grid;
      grid-template-rows: auto 1fr;
      background:
        radial-gradient(circle at top right, rgba(59, 130, 246, 0.18), transparent 26%),
        linear-gradient(180deg, #f8fbff, #eef5ff 48%, #f9fcff 100%);
      box-shadow: 0 28px 80px rgba(15, 23, 42, 0.3);
    }

    #csch-topbar {
      padding: 8px 12px;
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
      background: linear-gradient(135deg, #0f766e, #1d4ed8 72%);
      color: #fff;
    }

    .csch-pane-head h2,
    .csch-pane-head p {
      margin: 0;
    }

    .csch-top-actions {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
      justify-content: flex-end;
      margin-left: auto;
    }

    .csch-toolbar-inline {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
      max-width: 100%;
      position: relative;
    }

    .csch-toolbar-block {
      min-width: 0;
      display: grid;
      gap: 3px;
    }

    .csch-toolbar-block-date {
      width: 120px;
    }

    .csch-toolbar-block-time {
      width: 88px;
    }

    .csch-toolbar-block-days {
      min-width: 170px;
    }

    .csch-toolbar-block label,
    .csch-toolbar-block span {
      font-size: 10px;
      font-weight: 600;
      color: #334155;
      line-height: 1.1;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .csch-toolbar-status {
      display: inline-flex;
      align-items: center;
      max-width: 320px;
      min-height: 28px;
      padding: 5px 8px;
      border-radius: 999px;
      font-size: 10px;
      font-weight: 700;
      line-height: 1.15;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      background: rgba(255, 255, 255, 0.16);
      color: #ffffff;
      border: 1px solid rgba(255, 255, 255, 0.2);
    }

    .csch-toolbar-status-info {
      background: rgba(255, 255, 255, 0.16);
      color: #ffffff;
      border: 1px solid rgba(255, 255, 255, 0.2);
    }

    .csch-toolbar-status-ok {
      background: rgba(34, 197, 94, 0.2);
      color: #f0fdf4;
      border: 1px solid rgba(187, 247, 208, 0.35);
    }

    .csch-toolbar-status-err {
      background: rgba(239, 68, 68, 0.2);
      color: #fef2f2;
      border: 1px solid rgba(254, 202, 202, 0.35);
    }

    .csch-settings-menu {
      position: relative;
    }

    .csch-settings-menu summary {
      list-style: none;
    }

    .csch-settings-menu summary::-webkit-details-marker {
      display: none;
    }

    .csch-settings-popover {
      position: absolute;
      right: 0;
      top: calc(100% + 6px);
      z-index: 3;
      width: 240px;
      padding: 8px;
      border-radius: 10px;
      border: 1px solid rgba(148, 163, 184, 0.3);
      background: rgba(255, 255, 255, 0.98);
      box-shadow: 0 14px 30px rgba(15, 23, 42, 0.12);
      display: grid;
      gap: 8px;
    }

    .csch-settings-section {
      display: grid;
      gap: 6px;
      padding-top: 2px;
    }

    .csch-settings-section + .csch-settings-section {
      border-top: 1px solid rgba(148, 163, 184, 0.18);
      padding-top: 8px;
    }

    .csch-settings-title {
      font-size: 10px;
      font-weight: 800;
      color: #475569;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .csch-settings-actions {
      display: grid;
      gap: 6px;
    }

    .csch-weekdays {
      display: flex;
      gap: 4px;
      flex-wrap: wrap;
    }

    .csch-day-btn,
    .csch-btn {
      border: 1px solid rgba(148, 163, 184, 0.35);
      border-radius: 8px;
      background: #fff;
      color: #1e293b;
      padding: 6px 8px;
      font: inherit;
      font-size: 11px;
      line-height: 1.1;
      cursor: pointer;
      transition: transform 0.12s ease, background 0.12s ease;
    }

    .csch-day-btn:hover,
    .csch-btn:hover {
      transform: translateY(-1px);
      background: #f8fafc;
    }

    .csch-day-btn.active {
      background: linear-gradient(135deg, #0f766e, #1d4ed8);
      border-color: transparent;
      color: #fff;
      box-shadow: 0 12px 24px rgba(37, 99, 235, 0.18);
    }

    .csch-btn-primary {
      background: linear-gradient(135deg, #0f766e, #1d4ed8);
      border-color: transparent;
      color: #fff;
      font-weight: 700;
    }

    .csch-btn-ghost {
      background: rgba(255, 255, 255, 0.14);
      border-color: rgba(255, 255, 255, 0.28);
      color: #fff;
    }

    .csch-btn:disabled {
      opacity: 0.5;
      cursor: default;
      transform: none;
    }

    .csch-settings-popover input {
      border: 1px solid rgba(148, 163, 184, 0.45);
      border-radius: 8px;
      padding: 6px 8px;
      font: inherit;
      font-size: 11px;
      line-height: 1.1;
      color: #0f172a;
      background: #fff;
    }

    #csch-layout {
      min-height: 0;
      display: grid;
      grid-template-columns: minmax(240px, 280px) 1fr;
    }

    #csch-left,
    #csch-right {
      min-height: 0;
      overflow: hidden;
      display: grid;
      grid-template-rows: auto 1fr;
    }

    #csch-left {
      border-right: 1px solid rgba(37, 99, 235, 0.12);
      background: rgba(255, 255, 255, 0.78);
    }

    #csch-right {
      background: linear-gradient(180deg, rgba(241, 245, 249, 0.9), rgba(226, 232, 240, 0.74));
    }

    .csch-pane-head {
      padding: 10px 12px 8px;
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: center;
      border-bottom: 1px solid rgba(37, 99, 235, 0.08);
    }

    .csch-pane-head h2 {
      font-size: 13px;
      line-height: 1.1;
    }

    .csch-pane-note {
      font-size: 10px;
      font-weight: 700;
      color: #475569;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .csch-pane-head p {
      margin-top: 5px;
      font-size: 11px;
      color: #475569;
      line-height: 1.45;
    }

    #csch-left-body {
      overflow: auto;
      padding: 10px;
      display: grid;
      gap: 10px;
      align-content: start;
    }

    #csch-board {
      overflow: auto;
      padding: 10px;
      display: grid;
      grid-auto-flow: column;
      grid-auto-columns: minmax(176px, 200px);
      gap: 10px;
      align-content: start;
    }

    .csch-module-group {
      display: grid;
      gap: 6px;
    }

    .csch-module-head {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #475569;
    }

    .csch-tile-stack {
      display: grid;
      gap: 6px;
    }

    .csch-item {
      padding: 8px 9px;
      border-radius: 12px;
      border: 1px solid rgba(148, 163, 184, 0.24);
      background: linear-gradient(180deg, #ffffff, #f8fbff);
      box-shadow: 0 6px 14px rgba(148, 163, 184, 0.12);
      cursor: grab;
      display: grid;
      gap: 5px;
    }

    .csch-item:active {
      cursor: grabbing;
    }

    .csch-item-top {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }

    .csch-type-pill,
    .csch-module-pill {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      padding: 2px 7px;
      font-size: 10px;
      font-weight: 700;
      color: #fff;
      line-height: 1.15;
    }

    .csch-module-pill {
      background: #dbeafe;
      color: #1d4ed8;
    }

    .csch-item-title {
      font-size: 12px;
      font-weight: 700;
      color: #0f172a;
      line-height: 1.25;
    }

    .csch-item-module {
      font-size: 10px;
      font-weight: 700;
      color: #1d4ed8;
      line-height: 1.2;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .csch-item-meta-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .csch-item-meta {
      font-size: 10px;
      color: #475569;
      line-height: 1.2;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .csch-item-link {
      font-size: 10px;
      font-weight: 700;
      color: #1d4ed8;
      text-decoration: none;
      flex: 0 0 auto;
    }

    .csch-date-col {
      min-height: 0;
      display: grid;
      grid-template-rows: auto 1fr;
      gap: 6px;
    }

    .csch-date-head {
      padding: 8px 9px;
      border-radius: 12px;
      background: linear-gradient(135deg, rgba(15, 118, 110, 0.1), rgba(37, 99, 235, 0.14));
      border: 1px solid rgba(37, 99, 235, 0.12);
      box-shadow: 0 6px 14px rgba(37, 99, 235, 0.07);
    }

    .csch-date-head-main {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .csch-date-title {
      font-size: 13px;
      font-weight: 800;
      color: #0f172a;
      line-height: 1.15;
    }

    .csch-date-sub,
    .csch-date-count {
      margin-top: 2px;
      font-size: 10px;
      color: #475569;
      line-height: 1.2;
    }

    .csch-date-count {
      margin-top: 0;
      padding: 2px 6px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.72);
      color: #0f766e;
      font-weight: 800;
      flex: 0 0 auto;
    }

    .csch-dropzone {
      min-height: 84px;
      border: 1px dashed rgba(148, 163, 184, 0.5);
      border-radius: 12px;
      padding: 8px;
      background: rgba(255, 255, 255, 0.56);
      transition: border-color 0.12s ease, background 0.12s ease;
    }

    .csch-drop-active {
      border-color: #2563eb;
      background: rgba(219, 234, 254, 0.74);
    }

    .csch-dropzone-head {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      font-size: 11px;
      color: #0f172a;
      margin-bottom: 6px;
    }

    .csch-dropzone-help,
    .csch-empty-slot,
    .csch-empty-board,
    .csch-empty-state {
      font-size: 10px;
      color: #64748b;
      line-height: 1.35;
    }

    .csch-date-drop {
      display: grid;
      gap: 6px;
      align-content: start;
      min-height: 160px;
    }

    .csch-unscheduled {
      background: linear-gradient(180deg, #fefce8, #fff);
    }

    @media (max-width: 1100px) {
      #csch-shell {
        inset: 6px;
      }

      .csch-toolbar-inline {
        width: 100%;
      }

      .csch-toolbar-status {
        max-width: 100%;
      }

      .csch-top-actions {
        margin-left: 0;
      }

      #csch-layout {
        grid-template-columns: 1fr;
        grid-template-rows: minmax(220px, 34%) 1fr;
      }

      #csch-left {
        border-right: none;
        border-bottom: 1px solid rgba(37, 99, 235, 0.12);
      }
    }
  `);

  document.getElementById('csch-close-btn').addEventListener('click', closeApp);
  document.getElementById('csch-load-btn').addEventListener('click', loadCourseData);
  document.getElementById('csch-publish-btn').addEventListener('click', publishSchedule);
  document.getElementById('csch-more-dates-btn').addEventListener('click', () => {
    state.slotCount += 6;
    persistSettings();
    syncGeneratedDates();
    render();
  });
  document.getElementById('csch-start-date').addEventListener('change', (event) => {
    updateSetting('startDate', event.target.value || todayKey());
  });
  document.getElementById('csch-due-time').addEventListener('change', (event) => {
    updateSetting('dueTime', event.target.value || '23:59');
  });
  document.getElementById('csch-open-offset').addEventListener('change', (event) => {
    updateSetting('openDaysBefore', normalizeInt(event.target.value, 0));
  });
  document.getElementById('csch-close-offset').addEventListener('change', (event) => {
    updateSetting('closeDaysAfter', normalizeInt(event.target.value, 0));
  });
  document.getElementById('csch-answer-offset').addEventListener('change', (event) => {
    updateSetting('answersDaysAfter', normalizeInt(event.target.value, 0));
  });
  document.querySelectorAll('[data-weekday]').forEach((button) => {
    button.addEventListener('click', () => toggleWeekday(Number(button.getAttribute('data-weekday'))));
  });

  function tryRegister() {
    try {
      if (typeof unsafeWindow !== 'undefined' && unsafeWindow.CanvasDash) {
        unsafeWindow.CanvasDash.register({
          id: 'canvas-scheduler',
          name: 'Scheduler',
          color: '#0f766e',
          description: 'Drag-and-drop due date scheduler for Canvas assignments, discussions, and quizzes',
          run: openApp
        });
        fallbackLauncher.style.display = 'none';
      } else {
        setTimeout(tryRegister, 500);
      }
    } catch (_) {
      setTimeout(tryRegister, 500);
    }
  }

  syncGeneratedDates();
  render();
  tryRegister();
})();
