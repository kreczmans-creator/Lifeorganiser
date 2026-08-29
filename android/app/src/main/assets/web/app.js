/*
 * Life Organiser — the whole UI.
 *
 * Every view reads from and writes to markdown in the vault. There is no
 * database and no separate model: what you see is what the files say, which is
 * what keeps the phone, Obsidian and Claude Code in agreement.
 */
const App = (function () {

  const SECTIONS = [
    { dir: '00-Inbox',    icon: '📥', name: 'Inbox' },
    { dir: '01-Values',   icon: '🧭', name: 'Values' },
    { dir: '02-Goals',    icon: '🏔', name: 'Goals' },
    { dir: '03-Projects', icon: '🚀', name: 'Projects' },
    { dir: '04-Areas',    icon: '🌳', name: 'Areas' },
    { dir: '05-Knowledge',icon: '📚', name: 'Knowledge' },
    { dir: '06-People',   icon: '🤝', name: 'People' },
    { dir: '07-Journal',  icon: '📓', name: 'Journal' },
    { dir: '08-Archive',  icon: '🗄', name: 'Archive' },
    { dir: '_templates',  icon: '📄', name: 'Templates' },
  ];

  const STATUS = {
    'on-track': { emoji: '🟢', label: 'On track' },
    'needs-attention': { emoji: '🟡', label: 'Needs attention' },
    'stalled': { emoji: '🔴', label: 'Stalled' },
  };

  const INBOX = '00-Inbox/Inbox.md';

  const state = {
    route: 'today',
    param: null,
    stack: [],
    files: {},
    prefs: {},
    editing: false,
    draft: null,
    syncing: false,
    dirty: false,
    prefill: null,
    calendar: { events: [], fetchedAt: null, error: null },
  };

  // ---- utilities --------------------------------------------------------

  const esc = MD.escapeHtml;
  const $ = function (sel) { return document.querySelector(sel); };

  function toast(message, isError) {
    const node = $('#toast');
    node.textContent = message;
    node.className = isError ? 'show err' : 'show';
    clearTimeout(node._timer);
    node._timer = setTimeout(function () { node.className = ''; }, isError ? 4200 : 2200);
  }

  function reload() {
    state.files = Bridge.readAll();
    state.prefs = Bridge.getPrefs();
  }

  function save(path, content) {
    Bridge.writeFile(path, content);
    state.files[path] = content;
    state.dirty = true;
  }

  function read(path) {
    return Object.prototype.hasOwnProperty.call(state.files, path) ? state.files[path] : null;
  }

  function filesIn(dir) {
    return Object.keys(state.files)
      .filter(function (p) { return p.indexOf(dir + '/') === 0; })
      .sort();
  }

  function parseDate(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  }

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function fmtDate(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function daysBetween(a, b) {
    return Math.round((b - a) / 86400000);
  }

  function shiftDays(dateStr, delta) {
    const d = parseDate(dateStr);
    if (!d) return dateStr;
    d.setDate(d.getDate() + delta);
    return fmtDate(d);
  }

  function friendlyDate(dateStr) {
    const today = Bridge.today();
    const diff = daysBetween(parseDate(today), parseDate(dateStr));
    if (diff === 0) return 'today';
    if (diff === 1) return 'tomorrow';
    if (diff === -1) return 'yesterday';
    if (diff < 0) return Math.abs(diff) + ' days ago';
    if (diff < 7) return 'in ' + diff + ' days';
    return dateStr;
  }

  function longDate(dateStr) {
    const d = parseDate(dateStr);
    if (!d) return dateStr;
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
                    'August', 'September', 'October', 'November', 'December'];
    return days[d.getDay()] + ' ' + d.getDate() + ' ' + months[d.getMonth()];
  }

  function slug(name) {
    return String(name).replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
  }

  // ---- derived views over the vault -------------------------------------

  function dailyPath(dateStr) { return '07-Journal/' + dateStr + '.md'; }

  function journalDates() {
    return Object.keys(state.files)
      .map(function (p) {
        const m = /^07-Journal\/(\d{4}-\d{2}-\d{2})\.md$/.exec(p);
        return m ? m[1] : null;
      })
      .filter(Boolean)
      .sort()
      .reverse();
  }

  function todayNote() { return read(dailyPath(Bridge.today())); }

  function oneThing() {
    const note = todayNote();
    if (!note) return null;
    const body = MD.getSection(note, "today's one thing");
    if (!body) return null;
    const text = body.split('\n')
      .map(function (l) { return l.trim(); })
      .filter(Boolean)
      .join(' ');
    if (!text || /^\*.*\*$/.test(text)) return null;
    return text;
  }

  function habitNames(noteText) {
    const source = noteText || read('_templates/Daily Note.md') || '';
    const section = MD.getSection(source, 'habits');
    if (!section) return [];
    return MD.tasksIn(section).map(function (t) { return t.text; });
  }

  function habitDoneOn(dateStr, name) {
    const note = read(dailyPath(dateStr));
    if (!note) return null;
    const section = MD.getSection(note, 'habits');
    if (!section) return null;
    const found = MD.tasksIn(section).find(function (t) { return t.text === name; });
    return found ? found.done : null;
  }

  function habitStats() {
    const today = Bridge.today();
    const names = habitNames(todayNote());

    return names.map(function (name) {
      // A habit not yet ticked today shouldn't read as a broken streak.
      let streak = 0;
      let cursor = habitDoneOn(today, name) === true ? today : shiftDays(today, -1);
      for (let i = 0; i < 400; i++) {
        if (habitDoneOn(cursor, name) !== true) break;
        streak++;
        cursor = shiftDays(cursor, -1);
      }

      const spark = [];
      let done7 = 0;
      let tracked7 = 0;
      for (let i = 6; i >= 0; i--) {
        const day = shiftDays(today, -i);
        const value = habitDoneOn(day, name);
        if (value === null) { spark.push('·'); continue; }
        tracked7++;
        if (value) { spark.push('✅'); done7++; }
        // The day isn't over: an unticked habit today is pending, not missed.
        else spark.push(i === 0 ? '·' : '❌');
      }

      return {
        name: name,
        done: habitDoneOn(today, name) === true,
        streak: streak,
        spark: spark.join(''),
        rate7: tracked7 ? Math.round((done7 / tracked7) * 100) : null,
      };
    });
  }

  function allTasks() {
    const out = [];
    Object.keys(state.files).forEach(function (path) {
      if (path.indexOf('_templates/') === 0) return;
      if (path.indexOf('08-Archive/') === 0) return;
      MD.tasksIn(state.files[path], path).forEach(function (t) { out.push(t); });
    });
    return out;
  }

  function dueTasks(horizonDays) {
    const today = Bridge.today();
    const limit = shiftDays(today, horizonDays === undefined ? 7 : horizonDays);
    return allTasks()
      .filter(function (t) { return !t.done && t.due && t.due <= limit; })
      .sort(function (a, b) { return a.due < b.due ? -1 : a.due > b.due ? 1 : 0; });
  }

  function projects() {
    return filesIn('03-Projects')
      .filter(function (p) { return p !== '03-Projects/Projects.md'; })
      .map(function (path) {
        const text = state.files[path];
        const meta = MD.parseFrontmatter(text).meta;
        const next = MD.tasksIn(MD.getSection(text, 'next actions') || '')
          .filter(function (t) { return !t.done; })[0];
        return {
          path: path,
          title: MD.title(path, text),
          status: meta.status || 'on-track',
          next: next ? next.text : null,
        };
      });
  }

  function followups() {
    const out = [];
    filesIn('06-People').forEach(function (path) {
      if (path === '06-People/People.md') return;
      const text = state.files[path];
      const section = MD.getSection(text, 'follow-ups');
      if (!section) return;
      MD.tasksIn(section).forEach(function (t) {
        if (t.done || !t.text) return;
        out.push({ person: MD.title(path, text), path: path, text: t.text });
      });
    });
    return out;
  }

  function birthdaysSoon() {
    const today = Bridge.today();
    const out = [];
    filesIn('06-People').forEach(function (path) {
      const meta = MD.parseFrontmatter(state.files[path]).meta;
      if (!meta.birthday) return;
      const bd = parseDate(meta.birthday);
      if (!bd) return;
      const now = parseDate(today);
      bd.setFullYear(now.getFullYear());
      if (bd < now) bd.setFullYear(now.getFullYear() + 1);
      const days = daysBetween(now, bd);
      if (days <= 14) {
        out.push({ person: MD.title(path, state.files[path]), path: path, days: days });
      }
    });
    return out.sort(function (a, b) { return a.days - b.days; });
  }

  function inboxItems() {
    const text = read(INBOX);
    if (!text) return [];
    const range = MD.sectionRange(text, MD.matcher('captures'));
    if (!range.found) return [];
    const lines = text.split('\n');
    const out = [];
    for (let i = range.start; i < range.end; i++) {
      const m = /^\s*[-*]\s+(.*)$/.exec(lines[i]);
      if (!m || !m[1].trim()) continue;
      const body = m[1].trim();
      const stamp = /^(\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?)\s+—\s+(.*)$/.exec(body);
      out.push({
        line: i,
        raw: lines[i],
        when: stamp ? stamp[1] : null,
        text: stamp ? stamp[2] : body,
      });
    }
    return out;
  }

  // ---- actions ----------------------------------------------------------

  function capture(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return false;

    let note = read(INBOX);
    if (note === null) {
      note = '---\ntype: inbox\nupdated: ' + Bridge.today() +
        '\n---\n\n# 📥 Inbox\n\nCapture first, organise later.\n\n## Captures\n\n';
    }
    // Keep multi-line captures on one bullet so each item stays one item.
    const oneLine = trimmed.replace(/\s*\n\s*/g, ' · ');
    save(INBOX, MD.touch(MD.appendToSection(note, 'Captures', '- ' + Bridge.now() + ' — ' + oneLine)));
    return true;
  }

  function removeInboxLine(lineIndex) {
    const text = read(INBOX);
    if (!text) return;
    const lines = text.split('\n');
    lines.splice(lineIndex, 1);
    save(INBOX, MD.touch(lines.join('\n')));
  }

  /** The phone's /daily: today's note, yesterday's leftovers carried over. */
  function startDay() {
    const today = Bridge.today();
    const path = dailyPath(today);
    if (read(path) !== null) return path;

    const template = read('_templates/Daily Note.md') ||
      '---\ntype: daily\ndate: {{date}}\nupdated: {{date}}\n---\n\n# {{date}}\n\n' +
      "## 🎯 Today's One Thing\n\n*The single thing that would make today a win.*\n\n" +
      '## ✅ Tasks\n\n- [ ] \n\n## 🔁 Habits\n\n- [ ] Move\n\n## 🌙 Evening reflection\n\n';

    let note = MD.fill(template, { date: today, week: Bridge.isoWeek(), title: today });

    // Reset habit ticks inherited from the template.
    const habitRange = MD.sectionRange(note, MD.matcher('habits'));
    if (habitRange.found) {
      const lines = note.split('\n');
      for (let i = habitRange.start; i < habitRange.end; i++) {
        lines[i] = lines[i].replace(/^(\s*[-*]\s+\[)[xX](\])/, '$1 $2');
      }
      note = lines.join('\n');
    }

    const previous = journalDates().filter(function (d) { return d < today; })[0];
    if (previous) {
      const carried = MD.tasksIn(MD.getSection(read(dailyPath(previous)), 'tasks') || '')
        .filter(function (t) { return !t.done && t.text; });
      carried.forEach(function (t) {
        const due = t.due ? ' 📅 ' + t.due : '';
        note = MD.appendToSection(note, 'Tasks', '- [ ] ' + t.text + due + ' (carried)');
      });
    }

    // Drop the template's empty starter checkbox once real tasks exist.
    const taskRange = MD.sectionRange(note, MD.matcher('tasks'));
    if (taskRange.found) {
      const lines = note.split('\n');
      const kept = [];
      let realTasks = 0;
      for (let i = taskRange.start; i < taskRange.end; i++) {
        const m = lines[i].match(MD.TASK_RE);
        if (m && m[3].trim()) realTasks++;
      }
      for (let i = 0; i < lines.length; i++) {
        const inTasks = i >= taskRange.start && i < taskRange.end;
        const m = lines[i].match(MD.TASK_RE);
        if (inTasks && m && !m[3].trim() && realTasks > 0) continue;
        kept.push(lines[i]);
      }
      note = kept.join('\n');
    }

    save(path, note);
    return path;
  }

  function toggleTask(path, lineIndex) {
    const text = read(path);
    if (text === null) return;
    save(path, MD.touch(MD.toggleLine(text, lineIndex)));
  }

  function setOneThing(text) {
    const path = startDay();
    const note = read(path);
    save(path, MD.touch(MD.setSectionBody(note, "🎯 Today's One Thing", String(text).trim())));
  }

  function createFromTemplate(kind, title) {
    const specs = {
      project:   { dir: '03-Projects',  tpl: '_templates/Project.md',        index: '03-Projects/Projects.md',   section: 'Active',       suffix: ' 🟢' },
      goal:      { dir: '02-Goals',     tpl: '_templates/Goal.md',           index: '02-Goals/Goals.md',         section: 'Active goals', suffix: '' },
      area:      { dir: '04-Areas',     tpl: '_templates/Area.md',           index: '04-Areas/Areas.md',         section: 'My areas',     suffix: '' },
      knowledge: { dir: '05-Knowledge', tpl: '_templates/Knowledge Note.md', index: '05-Knowledge/Knowledge.md', section: 'Notes',        suffix: '' },
      person:    { dir: '06-People',    tpl: '_templates/Person.md',         index: '06-People/People.md',       section: 'Notes',        suffix: '' },
    };
    const spec = specs[kind];
    if (!spec) return null;

    const clean = slug(title);
    const path = spec.dir + '/' + clean + '.md';
    if (read(path) !== null) return path;

    const today = Bridge.today();
    const template = read(spec.tpl) || '---\ntype: ' + kind + '\nupdated: {{date}}\n---\n\n# {{title}}\n\n';
    save(path, MD.fill(template, { date: today, title: clean, name: clean, week: Bridge.isoWeek() }));

    const index = read(spec.index);
    if (index !== null) {
      const link = '- [[' + clean + ']]' + spec.suffix;
      if (index.indexOf('[[' + clean + ']]') === -1) {
        let updated = MD.appendToSection(index, spec.section, link);
        // Clear the "None yet" placeholder now that something is there.
        updated = updated.split('\n').filter(function (l) {
          return !/^\*(None yet|No goals yet).*\*$/i.test(l.trim());
        }).join('\n');
        save(spec.index, MD.touch(updated));
      }
    }
    return path;
  }

  function addTaskTo(path, taskText, due) {
    const text = read(path);
    if (text === null) return false;
    const section = MD.sectionRange(text, MD.matcher('next actions')).found ? 'Next actions' : 'Tasks';
    const line = '- [ ] ' + taskText + (due ? ' 📅 ' + due : '');
    save(path, MD.touch(MD.appendToSection(text, section, line)));
    return true;
  }

  function weeklyReview() {
    const week = Bridge.isoWeek();
    const path = '07-Journal/' + week + ' Review.md';
    if (read(path) === null) {
      const template = read('_templates/Weekly Review.md') ||
        '---\ntype: weekly-review\nweek: {{week}}\n---\n\n# Week {{week}} Review\n\n## 🏆 Wins\n\n- \n';
      save(path, MD.fill(template, { week: week, date: Bridge.today(), title: 'Week ' + week + ' Review' }));
    }
    return path;
  }

  function archiveNote(path) {
    const name = path.split('/').pop();
    const target = '08-Archive/' + name;
    Bridge.moveFile(path, target);
    state.files[target] = state.files[path];
    delete state.files[path];
    state.dirty = true;
    return target;
  }

  // ---- calendar ----------------------------------------------------------

  const CAL_CACHE = 'lifeorganiser.calcache';

  function calendarConfigured() {
    return /https:\/\//.test(state.prefs.icalUrls || '');
  }

  function loadCalendarCache() {
    try {
      const raw = JSON.parse(localStorage.getItem(CAL_CACHE) || 'null');
      if (!raw) return;
      state.calendar = {
        fetchedAt: raw.fetchedAt,
        error: null,
        events: (raw.events || []).map(function (e) {
          return {
            title: e.title, location: e.location, allDay: e.allDay,
            start: new Date(e.start), end: e.end ? new Date(e.end) : null,
          };
        }),
      };
    } catch (e) { /* cache is a convenience only */ }
  }

  function saveCalendarCache() {
    try {
      localStorage.setItem(CAL_CACHE, JSON.stringify({
        fetchedAt: state.calendar.fetchedAt,
        events: state.calendar.events.map(function (e) {
          return {
            title: e.title, location: e.location, allDay: e.allDay,
            start: e.start.getTime(), end: e.end ? e.end.getTime() : null,
          };
        }),
      }));
    } catch (e) { /* ditto */ }
  }

  function eventsOn(dateStr) {
    return state.calendar.events.filter(function (e) {
      return ICS.dayKey(e.start) === dateStr;
    });
  }

  /** Mirror today's agenda into the daily note so the vault sees it too. */
  function writeAgendaToDailyNote() {
    const today = Bridge.today();
    const note = read(dailyPath(today));
    if (note === null) return;

    const events = eventsOn(today);
    if (!events.length) return;

    const lines = events.map(function (e) {
      if (e.allDay) return '- ' + e.title + ' (all day)';
      const span = ICS.fmtTime(e.start) + (e.end ? '–' + ICS.fmtTime(e.end) : '');
      return '- ' + span + ' — ' + e.title + (e.location ? ' @ ' + e.location : '');
    }).join('\n');

    // setSectionBody creates the section at the end of the note if missing.
    const existing = MD.getSection(note, 'calendar');
    if (existing === lines) return;
    save(dailyPath(today), MD.setSectionBody(note, '📅 Calendar', lines));
  }

  function refreshCalendar(silent) {
    if (!calendarConfigured()) return Promise.resolve();

    return Bridge.fetchCalendars().then(function (results) {
      const windowStart = new Date();
      windowStart.setHours(0, 0, 0, 0);
      windowStart.setDate(windowStart.getDate() - 1);
      const windowEnd = new Date(windowStart);
      windowEnd.setDate(windowEnd.getDate() + 15);

      const events = [];
      const failures = [];
      (results || []).forEach(function (feed) {
        if (!feed.ok) { failures.push(feed.error || 'fetch failed'); return; }
        try {
          ICS.parse(feed.body, windowStart, windowEnd).forEach(function (e) { events.push(e); });
        } catch (e) {
          failures.push('could not parse a feed');
        }
      });
      events.sort(function (a, b) { return a.start - b.start; });

      state.calendar = {
        events: events,
        fetchedAt: Bridge.now(),
        error: failures.length ? failures[0] : null,
      };
      saveCalendarCache();
      writeAgendaToDailyNote();
      render();
      if (!silent && failures.length) toast('Calendar: ' + failures[0], true);
    }).catch(function (err) {
      state.calendar.error = err.message;
      if (!silent) toast('Calendar: ' + err.message, true);
    });
  }

  // ---- sync -------------------------------------------------------------

  function doSync(silent) {
    if (state.syncing) return Promise.resolve();
    if (!state.prefs.syncConfigured) {
      if (!silent) toast('Set up GitHub sync in Settings first', true);
      return Promise.resolve();
    }
    state.syncing = true;
    render();

    return Bridge.sync().then(function (result) {
      state.syncing = false;
      state.dirty = false;
      reload();
      render();

      const bits = [];
      if (result.pulled) bits.push(result.pulled + ' in');
      if (result.pushed) bits.push(result.pushed + ' out');
      if (result.deletedLocally) bits.push(result.deletedLocally + ' removed');
      const conflicts = result.conflicts || [];
      if (conflicts.length) {
        toast(conflicts.length + ' conflict' + (conflicts.length > 1 ? 's' : '') +
          ' — repo copies saved beside yours', true);
      } else if (!silent) {
        toast(bits.length ? 'Synced (' + bits.join(', ') + ')' : 'Already up to date');
      }
    }).catch(function (err) {
      state.syncing = false;
      render();
      if (!silent) toast(err.message, true);
    });
  }

  // ---- sheets -----------------------------------------------------------

  function closeSheet() {
    const scrim = $('#scrim');
    if (scrim) scrim.remove();
  }

  /**
   * options: [{ icon, label, desc, onSelect }]
   * Optionally an input field at the top, whose value is passed to onSelect.
   */
  function openSheet(config) {
    closeSheet();
    const scrim = document.createElement('div');
    scrim.className = 'scrim';
    scrim.id = 'scrim';

    const sheet = document.createElement('div');
    sheet.className = 'sheet';

    let html = '<div class="grab"></div>';
    if (config.title) html += '<h3>' + esc(config.title) + '</h3>';
    if (config.sub) html += '<div class="sub">' + esc(config.sub) + '</div>';
    if (config.input) {
      html += '<label class="field"><input type="text" id="sheet-input" placeholder="' +
        esc(config.input.placeholder || '') + '" value="' + esc(config.input.value || '') + '"></label>';
    }
    config.options.forEach(function (opt, i) {
      html += '<div class="opt" data-opt="' + i + '">' +
        '<span class="ico">' + (opt.icon || '') + '</span>' +
        '<span><span>' + esc(opt.label) + '</span>' +
        (opt.desc ? '<span class="desc">' + esc(opt.desc) + '</span>' : '') +
        '</span></div>';
    });
    html += '<div style="height:8px"></div><button class="btn ghost block" data-opt="cancel">Cancel</button>';
    sheet.innerHTML = html;

    scrim.appendChild(sheet);
    document.body.appendChild(scrim);

    const input = sheet.querySelector('#sheet-input');
    if (input) setTimeout(function () { input.focus(); }, 60);

    scrim.addEventListener('click', function (e) {
      if (e.target === scrim) { closeSheet(); return; }
      const opt = e.target.closest('[data-opt]');
      if (!opt) return;
      const key = opt.getAttribute('data-opt');
      if (key === 'cancel') { closeSheet(); return; }
      const value = input ? input.value.trim() : null;
      if (config.input && config.input.required && !value) {
        toast('Give it a name first', true);
        return;
      }
      closeSheet();
      config.options[Number(key)].onSelect(value);
    });
  }

  // ---- views ------------------------------------------------------------

  function header(title, sub, actions) {
    return '<header class="top"><div class="row"><div style="min-width:0">' +
      '<h1>' + esc(title) + '</h1>' +
      (sub ? '<div class="sub">' + esc(sub) + '</div>' : '') +
      '</div>' + (actions || '') + '</div></header>';
  }

  function syncLine() {
    if (state.syncing) {
      return '<div class="syncline"><span class="spinner"></span> Syncing…</div>';
    }
    if (!state.prefs.syncConfigured) {
      return '<div class="syncline">Not syncing — <a href="#" data-action="nav" data-route="settings" ' +
        'style="color:var(--accent-text)">set up GitHub</a></div>';
    }
    const last = state.prefs.lastSyncAt;
    return '<div class="syncline">' +
      (state.dirty ? 'Unsynced changes' : 'Synced') +
      (last ? ' · last ' + esc(last) : '') +
      ' · <a href="#" data-action="sync" style="color:var(--accent-text)">sync now</a></div>';
  }

  function taskRow(task, showSource) {
    const today = Bridge.today();
    let dueHtml = '';
    if (task.due) {
      const cls = task.due < today ? 'due over' : (task.due <= shiftDays(today, 2) ? 'due soon' : 'due');
      dueHtml = ' <span class="' + cls + '">' + esc(friendlyDate(task.due)) + '</span>';
    }
    const source = showSource
      ? '<div class="src">' + esc(MD.title(task.path, state.files[task.path] || '')) + '</div>'
      : '';
    return '<li class="task' + (task.done ? ' done' : '') + '">' +
      '<button class="check" data-action="toggle" data-path="' + esc(task.path) +
      '" data-line="' + task.line + '" aria-pressed="' + task.done + '">' +
      (task.done ? '✓' : '') + '</button>' +
      '<span>' + esc(MD.plain(task.text)) + dueHtml + source + '</span></li>';
  }

  function calRow(e) {
    const when = e.allDay
      ? 'All day'
      : ICS.fmtTime(e.start) + (e.end ? '–' + ICS.fmtTime(e.end) : '');
    return '<div class="rowitem" style="cursor:default">' +
      '<span>📅</span><div class="body"><div class="t">' + esc(e.title) + '</div>' +
      '<div class="m">' + esc(when) + (e.location ? ' · ' + esc(e.location) : '') +
      '</div></div></div>';
  }

  function viewToday() {
    const today = Bridge.today();
    const note = todayNote();
    const inbox = inboxItems();

    let html = header('Today', longDate(today),
      '<button class="btn small ghost" data-action="sync" ' + (state.syncing ? 'disabled' : '') + '>' +
      (state.syncing ? '…' : '↻') + '</button>');

    html += '<main>' + syncLine();

    if (!note) {
      html += '<div class="card"><h2>Start the day</h2>' +
        '<p style="margin-top:0;color:var(--muted)">Create today\'s note, carry over ' +
        'yesterday\'s unfinished tasks, and set your one thing.</p>' +
        '<button class="btn primary block" data-action="start-day">Start the day</button></div>';
    } else {
      const one = oneThing();
      html += '<div class="card onething" data-action="edit-onething"><h2>Today\'s one thing</h2>' +
        '<div class="value' + (one ? '' : ' placeholder') + '">' +
        (one ? esc(one) : 'Tap to set the one thing that would make today a win') +
        '</div></div>';

      const tasks = MD.tasksIn(note, dailyPath(today)).filter(function (t) {
        return t.section.toLowerCase().indexOf('habit') === -1 && t.text;
      });
      html += '<div class="card"><h2>Today\'s tasks' +
        '<button class="btn small ghost" data-action="add-today-task">+ Add</button></h2>';
      html += tasks.length
        ? '<ul class="tasks">' + tasks.map(function (t) { return taskRow(t, false); }).join('') + '</ul>'
        : '<div class="empty">Nothing planned yet.</div>';
      html += '</div>';

      const habits = habitStats();
      if (habits.length) {
        html += '<div class="card"><h2>Habits</h2>';
        habits.forEach(function (h) {
          const habitLine = MD.tasksIn(note, dailyPath(today))
            .find(function (t) {
              return t.text === h.name && t.section.toLowerCase().indexOf('habit') !== -1;
            });
          html += '<div class="habit">' +
            '<button class="check" data-action="toggle" data-path="' + esc(dailyPath(today)) +
            '" data-line="' + (habitLine ? habitLine.line : -1) + '" aria-pressed="' + h.done + '">' +
            (h.done ? '✓' : '') + '</button>' +
            '<span class="name">' + esc(MD.plain(h.name)) +
            '<div class="spark">' + h.spark + '</div></span>' +
            '<span class="streak">' + (h.streak ? h.streak + '🔥' : '—') + '</span></div>';
        });
        html += '</div>';
      }
    }

    if (calendarConfigured() || state.calendar.events.length) {
      const todayEvents = eventsOn(today);
      const tomorrowEvents = eventsOn(shiftDays(today, 1));
      html += '<div class="card"><h2>Calendar' +
        (state.calendar.error ? '<span class="chip warn">feed error</span>' : '') + '</h2>';
      if (!todayEvents.length && !tomorrowEvents.length) {
        html += '<div class="empty">' +
          (state.calendar.fetchedAt ? 'Nothing scheduled today or tomorrow.' :
           'Fetching your calendar\u2026') + '</div>';
      } else {
        todayEvents.forEach(function (e) { html += calRow(e); });
        if (tomorrowEvents.length) {
          html += '<div class="src" style="padding:8px 0 2px">Tomorrow</div>';
          tomorrowEvents.forEach(function (e) { html += calRow(e); });
        }
      }
      html += '</div>';
    }

    const due = dueTasks(7).filter(function (t) {
      return t.path !== dailyPath(today);
    });
    if (due.length) {
      const overdue = due.filter(function (t) { return t.due < today; }).length;
      html += '<div class="card"><h2>Due &amp; overdue' +
        (overdue ? '<span class="chip danger">' + overdue + ' overdue</span>' : '') + '</h2>' +
        '<ul class="tasks">' + due.slice(0, 12).map(function (t) { return taskRow(t, true); }).join('') +
        '</ul></div>';
    }

    const active = projects();
    if (active.length) {
      html += '<div class="card"><h2>Active projects</h2>';
      active.forEach(function (p) {
        const status = STATUS[p.status] || STATUS['on-track'];
        html += '<div class="rowitem" data-action="open" data-path="' + esc(p.path) + '">' +
          '<span>' + status.emoji + '</span>' +
          '<div class="body"><div class="t">' + esc(p.title) + '</div>' +
          '<div class="m">' + (p.next ? esc(MD.plain(p.next)) : 'No next action — decide one') + '</div></div>' +
          '<span class="go">›</span></div>';
      });
      html += '</div>';
    }

    const follow = followups();
    const birthdays = birthdaysSoon();
    if (follow.length || birthdays.length) {
      html += '<div class="card"><h2>Follow-ups</h2>';
      birthdays.forEach(function (b) {
        html += '<div class="rowitem" data-action="open" data-path="' + esc(b.path) + '">' +
          '<span>🎂</span><div class="body"><div class="t">' + esc(b.person) + '</div>' +
          '<div class="m">Birthday ' + (b.days === 0 ? 'today' : 'in ' + b.days + ' days') + '</div></div>' +
          '<span class="go">›</span></div>';
      });
      follow.forEach(function (f) {
        html += '<div class="rowitem" data-action="open" data-path="' + esc(f.path) + '">' +
          '<span>🤝</span><div class="body"><div class="t">' + esc(MD.plain(f.text)) + '</div>' +
          '<div class="m">' + esc(f.person) + '</div></div><span class="go">›</span></div>';
      });
      html += '</div>';
    }

    html += '<div class="card tight"><div class="rowitem" data-action="nav" data-route="inbox">' +
      '<span>📥</span><div class="body"><div class="t">Inbox</div>' +
      '<div class="m">' + (inbox.length
        ? inbox.length + ' to process'
        : 'Empty — nicely done') + '</div></div><span class="go">›</span></div></div>';

    html += '<div class="section-title">Actions</div>' +
      '<div class="btnrow">' +
      '<button class="btn" data-action="weekly-review">📋 Weekly review</button>' +
      '<button class="btn" data-action="open-today">📓 Today\'s note</button>' +
      '</div>';

    html += '</main>';
    return html;
  }

  function viewCapture() {
    const prefill = state.prefill || '';
    state.prefill = null;
    return header('Capture', 'Get it out of your head') +
      '<main>' +
      '<div class="card"><textarea class="capture" id="capture-box" placeholder="' +
      'A task, an idea, a worry, something to remember…">' + esc(prefill) + '</textarea>' +
      '<div style="height:10px"></div>' +
      '<button class="btn primary block" data-action="capture-save">Add to Inbox</button></div>' +
      '<div class="empty" style="padding:0 4px">Don\'t organise it now — that\'s what the ' +
      'Inbox is for. File it later from the Inbox tab.</div>' +
      '</main>';
  }

  function viewInbox() {
    const items = inboxItems();
    let html = header('Inbox', items.length ? items.length + ' to process' : 'Empty');
    html += '<main>';

    if (!items.length) {
      html += '<div class="card"><div class="empty">Nothing waiting. Capture something with ' +
        'the + button, or share text into Life Organiser from any app.</div></div>';
    } else {
      if (state.prefs.hasAnthropicKey) {
        html += '<button class="btn block" data-action="ai-clarify" style="margin-bottom:12px">' +
          '✨ Clarify all with Claude</button>';
      }
      html += '<div class="card">';
      items.slice().reverse().forEach(function (item) {
        html += '<div class="rowitem" data-action="file-item" data-line="' + item.line + '">' +
          '<span>•</span><div class="body"><div class="t">' + esc(MD.plain(item.text)) + '</div>' +
          (item.when ? '<div class="m">' + esc(item.when) + '</div>' : '') +
          '</div><span class="go">File ›</span></div>';
      });
      html += '</div>';
    }

    html += '</main>';
    return html;
  }

  function viewNotes() {
    let html = header('Notes', 'Everything, by section');
    html += '<main><div class="card">';
    SECTIONS.forEach(function (section) {
      const count = filesIn(section.dir).length;
      html += '<div class="rowitem" data-action="nav" data-route="section" data-param="' +
        esc(section.dir) + '">' +
        '<span>' + section.icon + '</span>' +
        '<div class="body"><div class="t">' + esc(section.name) + '</div>' +
        '<div class="m">' + count + (count === 1 ? ' note' : ' notes') + '</div></div>' +
        '<span class="go">›</span></div>';
    });
    html += '</div>';
    html += '<div class="section-title">Create</div><div class="btnrow">' +
      '<button class="btn" data-action="new" data-kind="project">🚀 Project</button>' +
      '<button class="btn" data-action="new" data-kind="goal">🏔 Goal</button>' +
      '</div><div style="height:8px"></div><div class="btnrow">' +
      '<button class="btn" data-action="new" data-kind="person">🤝 Person</button>' +
      '<button class="btn" data-action="new" data-kind="knowledge">📚 Note</button>' +
      '<button class="btn" data-action="new" data-kind="area">🌳 Area</button>' +
      '</div>';
    html += '</main>';
    return html;
  }

  function viewSection(dir) {
    const section = SECTIONS.find(function (s) { return s.dir === dir; }) ||
      { icon: '📁', name: dir };
    const paths = filesIn(dir);

    let html = header(section.name, paths.length + (paths.length === 1 ? ' note' : ' notes'),
      '<button class="btn small ghost" data-action="back">Back</button>');
    html += '<main><div class="card">';
    if (!paths.length) {
      html += '<div class="empty">Nothing here yet.</div>';
    } else {
      paths.forEach(function (path) {
        const text = state.files[path];
        const meta = MD.parseFrontmatter(text).meta;
        const status = STATUS[meta.status];
        const open = MD.tasksIn(text).filter(function (t) { return !t.done && t.text; }).length;
        html += '<div class="rowitem" data-action="open" data-path="' + esc(path) + '">' +
          '<span>' + (status ? status.emoji : '📄') + '</span>' +
          '<div class="body"><div class="t">' + esc(MD.title(path, text)) + '</div>' +
          '<div class="m">' + (open ? open + ' open task' + (open === 1 ? '' : 's') : 'No open tasks') +
          (meta.updated ? ' · ' + esc(meta.updated) : '') + '</div></div>' +
          '<span class="go">›</span></div>';
      });
    }
    html += '</div></main>';
    return html;
  }

  function viewNote(path) {
    const text = read(path);
    if (text === null) {
      return header('Not found', path) +
        '<main><div class="card"><div class="empty">That note is gone.</div>' +
        '<button class="btn block" data-action="back">Back</button></div></main>';
    }

    const title = MD.title(path, text);

    if (state.editing) {
      return header(title, 'Editing') +
        '<main><div class="card"><textarea class="editor" id="note-editor">' +
        esc(state.draft !== null ? state.draft : text) + '</textarea></div>' +
        '<div class="btnrow">' +
        '<button class="btn ghost" data-action="cancel-edit">Cancel</button>' +
        '<button class="btn primary" data-action="save-edit">Save</button>' +
        '</div></main>';
    }

    return header(title, path,
      '<button class="btn small ghost" data-action="back">Back</button>') +
      '<main><div class="card note">' + MD.render(text, path) + '</div>' +
      '<div class="btnrow">' +
      '<button class="btn" data-action="edit-note">✎ Edit</button>' +
      '<button class="btn" data-action="add-task-here">+ Task</button>' +
      '</div><div style="height:8px"></div><div class="btnrow">' +
      (path.indexOf('08-Archive/') === 0 ? '' :
        '<button class="btn ghost" data-action="archive-note">🗄 Archive</button>') +
      '</div></main>';
  }

  function viewSettings() {
    const p = state.prefs;
    return header('Settings', 'Sync and assistance') +
      '<main>' +
      '<div class="card"><h2>GitHub sync</h2>' +
      '<label class="field"><span class="lab">Owner</span>' +
      '<input type="text" id="s-owner" value="' + esc(p.owner || '') + '" placeholder="your-username" autocapitalize="none"></label>' +
      '<label class="field"><span class="lab">Repository</span>' +
      '<input type="text" id="s-repo" value="' + esc(p.repo || '') + '" placeholder="lifeorganiser" autocapitalize="none"></label>' +
      '<label class="field"><span class="lab">Branch</span>' +
      '<input type="text" id="s-branch" value="' + esc(p.branch || 'main') + '" autocapitalize="none"></label>' +
      '<label class="field"><span class="lab">Personal access token</span>' +
      '<input type="password" id="s-token" placeholder="' +
      (p.hasToken ? 'Saved — type to replace' : 'github_pat_…') + '" autocapitalize="none">' +
      '<span class="hint">Fine-grained token with Contents: read and write on this one ' +
      'repository. Stored only on this phone.</span></label>' +
      '<div class="switch"><span>Sync automatically</span>' +
      '<input type="checkbox" id="s-auto" ' + (p.autoSync ? 'checked' : '') +
      ' style="width:auto;transform:scale(1.3)"></div>' +
      '<div style="height:10px"></div>' +
      '<div class="btnrow">' +
      '<button class="btn" data-action="test-connection">Test</button>' +
      '<button class="btn primary" data-action="save-settings">Save</button>' +
      '</div></div>' +

      '<div class="card"><h2>Google Calendar <span class="chip">Optional</span></h2>' +
      '<label class="field"><span class="lab">iCal feed URLs (one per line)</span>' +
      '<textarea id="s-ical" rows="3" style="min-height:70px" placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" autocapitalize="none">' +
      esc(p.icalUrls || '') + '</textarea>' +
      '<span class="hint">Google Calendar → Settings → your calendar → ' +
      '“Secret address in iCal format”. Read-only: the app never writes to ' +
      'your calendar. Today\'s agenda also lands in the daily note.</span></label>' +
      '<button class="btn block" data-action="save-settings">Save</button></div>' +

      '<div class="card"><h2>Claude assistance <span class="chip">Optional</span></h2>' +
      '<label class="field"><span class="lab">Anthropic API key</span>' +
      '<input type="password" id="s-anthropic" placeholder="' +
      (p.hasAnthropicKey ? 'Saved — type to replace' : 'sk-ant-…') + '" autocapitalize="none">' +
      '<span class="hint">Only needed for “Clarify all with Claude”. Everything else ' +
      'works without it.</span></label>' +
      '<label class="field"><span class="lab">Model</span>' +
      '<select id="s-model">' +
      ['claude-sonnet-5', 'claude-opus-5', 'claude-haiku-4-5-20251001'].map(function (m) {
        return '<option value="' + m + '"' + (p.model === m ? ' selected' : '') + '>' + m + '</option>';
      }).join('') +
      '</select></label>' +
      '<button class="btn block" data-action="save-settings">Save</button></div>' +

      '<div class="card"><h2>Vault</h2>' +
      '<div class="m" style="color:var(--muted);font-size:14px">' +
      Object.keys(state.files).length + ' notes on this phone.' +
      (p.lastSyncAt ? ' Last synced ' + esc(p.lastSyncAt) + '.' : ' Never synced.') +
      '</div><div style="height:10px"></div>' +
      '<button class="btn block" data-action="sync">Sync now</button></div>' +
      '</main>';
  }

  // ---- router -----------------------------------------------------------

  const TABS = [
    { route: 'today', icon: '🧭', label: 'Today' },
    { route: 'inbox', icon: '📥', label: 'Inbox' },
    { route: 'notes', icon: '📚', label: 'Notes' },
    { route: 'settings', icon: '⚙️', label: 'Settings' },
  ];

  function nav() {
    const inboxCount = inboxItems().length;
    return '<nav class="bottom">' + TABS.map(function (tab) {
      const active = state.route === tab.route ||
        (tab.route === 'notes' && (state.route === 'section' || state.route === 'note'));
      const badge = tab.route === 'inbox' && inboxCount
        ? '<span class="badge">' + inboxCount + '</span>' : '';
      return '<button data-action="nav" data-route="' + tab.route + '"' +
        (active ? ' class="active"' : '') + '>' +
        '<span class="ico">' + tab.icon + '</span>' + badge + tab.label + '</button>';
    }).join('') + '</nav>';
  }

  function render() {
    let body;
    switch (state.route) {
      case 'capture':  body = viewCapture(); break;
      case 'inbox':    body = viewInbox(); break;
      case 'notes':    body = viewNotes(); break;
      case 'section':  body = viewSection(state.param); break;
      case 'note':     body = viewNote(state.param); break;
      case 'settings': body = viewSettings(); break;
      default:         body = viewToday();
    }

    const showFab = ['today', 'inbox', 'notes'].indexOf(state.route) !== -1;
    document.getElementById('app').innerHTML =
      body + (showFab ? '<button class="fab" data-action="nav" data-route="capture">＋</button>' : '') + nav();

    window.scrollTo(0, 0);
  }

  function go(route, param, keepStack) {
    // Note-to-note moves (following a wikilink) change only the param, and
    // still need a history entry to come back to.
    if (!keepStack && (state.route !== route || state.param !== (param || null))) {
      state.stack.push({ route: state.route, param: state.param });
      if (state.stack.length > 20) state.stack.shift();
    }
    state.editing = false;
    state.draft = null;
    state.route = route;
    state.param = param || null;
    render();
  }

  function back() {
    if (state.editing) { state.editing = false; state.draft = null; render(); return true; }
    if (!state.stack.length) return false;
    const prev = state.stack.pop();
    state.route = prev.route;
    state.param = prev.param;
    render();
    return true;
  }

  // ---- inbox filing -----------------------------------------------------

  function fileItemSheet(lineIndex) {
    const item = inboxItems().find(function (i) { return i.line === lineIndex; });
    if (!item) return;

    function finish(message) {
      removeInboxLine(lineIndex);
      reload();
      render();
      toast(message);
    }

    openSheet({
      title: 'File this',
      sub: item.text,
      options: [
        {
          icon: '🚀', label: 'New project', desc: 'A multi-step effort with a finish line',
          onSelect: function () { promptCreate('project', item, finish); },
        },
        {
          icon: '🏔', label: 'New goal', desc: 'An outcome with a deadline',
          onSelect: function () { promptCreate('goal', item, finish); },
        },
        {
          icon: '✅', label: 'Task on an existing note', desc: 'Add to a project or area',
          onSelect: function () { pickNoteForTask(item, finish); },
        },
        {
          icon: '📚', label: 'Knowledge note', desc: 'Worth keeping and re-finding',
          onSelect: function () { promptCreate('knowledge', item, finish); },
        },
        {
          icon: '🤝', label: 'Person', desc: 'Someone who matters',
          onSelect: function () { promptCreate('person', item, finish); },
        },
        {
          icon: '🌳', label: 'New area', desc: 'An ongoing responsibility',
          onSelect: function () { promptCreate('area', item, finish); },
        },
        {
          icon: '🗄', label: 'Archive it', desc: 'Keep it, but out of the way',
          onSelect: function () {
            const path = '08-Archive/Captures.md';
            const existing = read(path) ||
              '---\ntype: note\nupdated: ' + Bridge.today() + '\n---\n\n# Archived captures\n\n## Items\n\n';
            save(path, MD.touch(MD.appendToSection(existing, 'Items', '- ' + item.text)));
            finish('Archived');
          },
        },
        {
          icon: '🗑', label: 'Delete', desc: 'It served its purpose',
          onSelect: function () { finish('Deleted'); },
        },
      ],
    });
  }

  function promptCreate(kind, item, finish) {
    const labels = {
      project: 'Project name', goal: 'Goal', area: 'Area name',
      knowledge: 'Note title', person: 'Their name',
    };
    openSheet({
      title: labels[kind],
      sub: item.text,
      input: { placeholder: labels[kind], value: kind === 'person' ? '' : item.text, required: true },
      options: [{
        icon: '✓', label: 'Create',
        onSelect: function (value) {
          const path = createFromTemplate(kind, value);
          // Keep the original wording when the title was edited down.
          if (path && value.trim() !== item.text.trim()) {
            const text = read(path);
            const target = ['Notes', 'Log'].find(function (s) {
              return text !== null && MD.sectionRange(text, MD.matcher(s)).found;
            });
            if (target) {
              save(path, MD.appendToSection(text, target, '- ' + Bridge.today() + ' — ' + item.text));
            }
          }
          finish('Created ' + value);
          if (path) go('note', path);
        },
      }],
    });
  }

  function pickNoteForTask(item, finish) {
    const candidates = projects().map(function (p) { return { path: p.path, title: p.title }; })
      .concat(filesIn('04-Areas')
        .filter(function (p) { return p !== '04-Areas/Areas.md'; })
        .map(function (p) { return { path: p, title: MD.title(p, state.files[p]) }; }))
      .concat([{ path: dailyPath(Bridge.today()), title: "Today's note" }]);

    openSheet({
      title: 'Add as a task to…',
      sub: item.text,
      options: candidates.map(function (c) {
        return {
          icon: '📄', label: c.title,
          onSelect: function () {
            if (c.path === dailyPath(Bridge.today())) startDay();
            if (addTaskTo(c.path, item.text)) finish('Added to ' + c.title);
            else toast('Could not add it there', true);
          },
        };
      }),
    });
  }

  function aiClarify() {
    const items = inboxItems();
    if (!items.length) return;

    const context = {
      projects: projects().map(function (p) { return p.title; }),
      areas: filesIn('04-Areas').map(function (p) { return MD.title(p, state.files[p]); }),
      people: filesIn('06-People').map(function (p) { return MD.title(p, state.files[p]); }),
    };

    const system =
      'You file inbox items for a personal life-management vault. For each item choose ' +
      'exactly one destination and reply with JSON only: an array of ' +
      '{"text":<original item text>,"action":"project|goal|area|knowledge|person|task|archive",' +
      '"name":<note title to create, or the existing note to add the task to>}. ' +
      'Use "task" when it belongs on an existing project or area, and put that note\'s exact ' +
      'title in "name". Use "archive" for things that need no action. No prose, no code fences.';

    const user = 'Existing projects: ' + JSON.stringify(context.projects) +
      '\nExisting areas: ' + JSON.stringify(context.areas) +
      '\nExisting people: ' + JSON.stringify(context.people) +
      '\n\nItems to file:\n' + items.map(function (i) { return '- ' + i.text; }).join('\n');

    toast('Asking Claude…');
    Bridge.aiAsk(system, user).then(function (reply) {
      let plan;
      try {
        plan = JSON.parse(String(reply).replace(/^```(?:json)?/, '').replace(/```$/, '').trim());
      } catch (e) {
        toast('Claude replied in an unexpected format', true);
        return;
      }
      if (!Array.isArray(plan)) { toast('Claude replied in an unexpected format', true); return; }

      let filed = 0;
      plan.forEach(function (entry) {
        const item = inboxItems().find(function (i) { return i.text === entry.text; });
        if (!item) return;

        if (entry.action === 'task') {
          const target = Object.keys(state.files).find(function (p) {
            return MD.title(p, state.files[p]) === entry.name;
          });
          if (target && addTaskTo(target, item.text)) { removeInboxLine(item.line); filed++; }
          return;
        }
        if (entry.action === 'archive') {
          const path = '08-Archive/Captures.md';
          const existing = read(path) ||
            '---\ntype: note\nupdated: ' + Bridge.today() + '\n---\n\n# Archived captures\n\n## Items\n\n';
          save(path, MD.touch(MD.appendToSection(existing, 'Items', '- ' + item.text)));
          removeInboxLine(item.line);
          filed++;
          return;
        }
        if (['project', 'goal', 'area', 'knowledge', 'person'].indexOf(entry.action) !== -1) {
          createFromTemplate(entry.action, entry.name || item.text);
          removeInboxLine(item.line);
          filed++;
        }
      });

      reload();
      render();
      toast(filed ? 'Filed ' + filed + ' item' + (filed === 1 ? '' : 's') : 'Nothing was filed');
    }).catch(function (err) {
      toast(err.message, true);
    });
  }

  /** Follow a [[wikilink]] by note title, then by filename. */
  function openByName(name) {
    const wanted = String(name || '').trim().toLowerCase();
    if (!wanted) return;

    const paths = Object.keys(state.files);
    const hit =
      paths.find(function (p) {
        return MD.title(p, state.files[p]).toLowerCase() === wanted;
      }) ||
      paths.find(function (p) {
        return p.split('/').pop().replace(/\.md$/, '').toLowerCase() === wanted;
      });

    if (hit) { go('note', hit); return; }

    openSheet({
      title: 'No note called “' + name + '”',
      sub: 'Create it now?',
      options: [
        { icon: '📚', label: 'Create a knowledge note', onSelect: function () {
          go('note', createFromTemplate('knowledge', name));
        } },
        { icon: '🚀', label: 'Create a project', onSelect: function () {
          go('note', createFromTemplate('project', name));
        } },
      ],
    });
  }

  // ---- events -----------------------------------------------------------

  function onAction(action, target) {
    switch (action) {
      case 'nav':
        go(target.getAttribute('data-route'), target.getAttribute('data-param'));
        return;

      case 'back':
        if (!back()) go('today');
        return;

      case 'sync':
        doSync(false);
        refreshCalendar(true);
        return;

      case 'toggle': {
        const path = target.getAttribute('data-path');
        const line = Number(target.getAttribute('data-line'));
        if (line < 0) return;
        toggleTask(path, line);
        render();
        return;
      }

      case 'open':
        go('note', target.getAttribute('data-path'));
        return;

      case 'open-today':
        go('note', startDay());
        return;

      case 'start-day':
        startDay();
        writeAgendaToDailyNote();
        reload();
        render();
        toast('Today is ready');
        return;

      case 'edit-onething':
        openSheet({
          title: "Today's one thing",
          sub: 'The single thing that would make today a win',
          input: { placeholder: 'e.g. Finish the proposal draft', value: oneThing() || '', required: true },
          options: [{ icon: '🎯', label: 'Set it', onSelect: function (value) {
            setOneThing(value); reload(); render(); toast('Set');
          } }],
        });
        return;

      case 'add-today-task':
        openSheet({
          title: 'Add a task for today',
          input: { placeholder: 'What needs doing?', required: true },
          options: [{ icon: '✅', label: 'Add', onSelect: function (value) {
            const path = startDay();
            const text = read(path);
            save(path, MD.touch(MD.appendToSection(text, 'Tasks', '- [ ] ' + value)));
            reload(); render(); toast('Added');
          } }],
        });
        return;

      case 'capture-save': {
        const box = document.getElementById('capture-box');
        if (!capture(box.value)) { toast('Nothing to capture', true); return; }
        box.value = '';
        reload();
        go('today');
        toast('Captured');
        if (state.prefs.autoSync && state.prefs.syncConfigured) doSync(true);
        return;
      }

      case 'file-item':
        fileItemSheet(Number(target.getAttribute('data-line')));
        return;

      case 'ai-clarify':
        aiClarify();
        return;

      case 'weekly-review':
        go('note', weeklyReview());
        return;

      case 'new': {
        const kind = target.getAttribute('data-kind');
        const labels = {
          project: 'New project', goal: 'New goal', area: 'New area',
          knowledge: 'New note', person: 'New person',
        };
        openSheet({
          title: labels[kind],
          input: { placeholder: 'Name it', required: true },
          options: [{ icon: '✓', label: 'Create', onSelect: function (value) {
            const path = createFromTemplate(kind, value);
            reload();
            if (path) go('note', path); else toast('Could not create it', true);
          } }],
        });
        return;
      }

      case 'edit-note':
        state.editing = true;
        state.draft = null;
        render();
        return;

      case 'cancel-edit':
        state.editing = false;
        state.draft = null;
        render();
        return;

      case 'save-edit': {
        const editor = document.getElementById('note-editor');
        save(state.param, MD.touch(editor.value));
        state.editing = false;
        state.draft = null;
        reload();
        render();
        toast('Saved');
        return;
      }

      case 'add-task-here':
        openSheet({
          title: 'Add a task',
          sub: MD.title(state.param, read(state.param) || ''),
          input: { placeholder: 'What needs doing?', required: true },
          options: [{ icon: '✅', label: 'Add', onSelect: function (value) {
            addTaskTo(state.param, value);
            reload(); render(); toast('Added');
          } }],
        });
        return;

      case 'archive-note':
        openSheet({
          title: 'Archive this note?',
          sub: 'It moves to 08-Archive. Nothing is deleted.',
          options: [{ icon: '🗄', label: 'Archive', onSelect: function () {
            archiveNote(state.param);
            reload();
            if (!back()) go('notes');
            toast('Archived');
          } }],
        });
        return;

      case 'test-connection':
        collectSettings();
        toast('Checking…');
        Bridge.testConnection().then(function (info) {
          toast('Connected to ' + info.repo + ' @' + info.head);
        }).catch(function (err) { toast(err.message, true); });
        return;

      case 'save-settings':
        collectSettings();
        reload();
        render();
        toast('Saved');
        refreshCalendar(true);
        return;
    }
  }

  function collectSettings() {
    const value = function (id) {
      const node = document.getElementById(id);
      return node ? node.value.trim() : undefined;
    };
    const payload = {};
    const ical = value('s-ical');     if (ical !== undefined) payload.icalUrls = ical;
    const owner = value('s-owner');   if (owner !== undefined) payload.owner = owner;
    const repo = value('s-repo');     if (repo !== undefined) payload.repo = repo;
    const branch = value('s-branch'); if (branch !== undefined) payload.branch = branch || 'main';
    const model = value('s-model');   if (model !== undefined) payload.model = model;

    const token = value('s-token');
    if (token) payload.githubToken = token;
    const anthropic = value('s-anthropic');
    if (anthropic) payload.anthropicKey = anthropic;

    const auto = document.getElementById('s-auto');
    if (auto) payload.autoSync = auto.checked;

    Bridge.setPrefs(payload);
    state.prefs = Bridge.getPrefs();
  }

  // ---- lifecycle --------------------------------------------------------

  function applyTheme() {
    document.documentElement.setAttribute('data-theme', Bridge.isDark() ? 'dark' : 'light');
  }

  function handleLaunchIntent() {
    const intent = Bridge.takeLaunchIntent();
    if (intent.share) {
      state.prefill = intent.share;
      go('capture');
      return true;
    }
    if (intent.route) {
      go(intent.route === 'capture' ? 'capture' : 'today');
      return true;
    }
    return false;
  }

  function init() {
    applyTheme();
    reload();
    loadCalendarCache();

    document.addEventListener('click', function (e) {
      const link = e.target.closest('a.wl');
      if (link) {
        e.preventDefault();
        openByName(link.getAttribute('data-note'));
        return;
      }
      const target = e.target.closest('[data-action]');
      if (!target) return;
      e.preventDefault();
      onAction(target.getAttribute('data-action'), target);
    });

    document.addEventListener('scroll', function () {
      const top = document.querySelector('header.top');
      if (top) top.classList.toggle('scrolled', window.scrollY > 4);
    }, { passive: true });

    window.__onBack = function () { return back(); };
    window.__onThemeChange = applyTheme;
    window.__onNewIntent = function () { handleLaunchIntent(); };
    window.__onPause = function () {
      if (state.dirty && state.prefs.autoSync && state.prefs.syncConfigured) doSync(true);
    };

    if (!handleLaunchIntent()) render();

    if (state.prefs.autoSync && state.prefs.syncConfigured) doSync(true);
    refreshCalendar(true);
  }

  return { init: init, go: go, state: state };
})();

document.addEventListener('DOMContentLoaded', App.init);
