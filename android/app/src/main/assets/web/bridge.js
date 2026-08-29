/*
 * The bridge to Android. Synchronous calls pass straight through; network
 * calls return promises that the Kotlin side settles by id.
 *
 * When window.Android is absent the same API is served from localStorage, so
 * the whole UI runs in a desktop browser for development.
 */
const Bridge = (function () {

  const native = window.Android;
  const pending = {};
  let seq = 0;

  window.__settle = function (result) {
    const entry = pending[result.id];
    if (!entry) return;
    delete pending[result.id];
    if (result.ok) entry.resolve(result.payload);
    else entry.reject(new Error(result.payload || 'Something went wrong'));
  };

  function asyncCall(method, args) {
    return new Promise(function (resolve, reject) {
      const id = 'r' + (++seq);
      pending[id] = { resolve: resolve, reject: reject };
      try {
        native[method].apply(native, [id].concat(args || []));
      } catch (e) {
        delete pending[id];
        reject(e);
      }
    });
  }

  if (native) {
    return {
      isNative: true,
      listFiles: function () { return JSON.parse(native.listFiles()); },
      readFile: function (p) { return native.readFile(p); },
      writeFile: function (p, c) { return native.writeFile(p, c); },
      deleteFile: function (p) { return native.deleteFile(p); },
      moveFile: function (a, b) { return native.moveFile(a, b); },
      fileExists: function (p) { return native.fileExists(p); },
      readAll: function () { return JSON.parse(native.readAll()); },
      today: function () { return native.today(); },
      now: function () { return native.now(); },
      isoWeek: function () { return native.isoWeek(); },
      getPrefs: function () { return JSON.parse(native.getPrefs()); },
      setPrefs: function (o) { return native.setPrefs(JSON.stringify(o)); },
      takeLaunchIntent: function () { return JSON.parse(native.takeLaunchIntent()); },
      isDark: function () { return native.isDark(); },
      log: function (m) { native.log(String(m)); },
      sync: function () { return asyncCall('sync'); },
      testConnection: function () { return asyncCall('testConnection'); },
      aiAsk: function (system, user) { return asyncCall('aiAsk', [system, user]); },
    };
  }

  // ---- browser fallback -------------------------------------------------

  const KEY = 'lifeorganiser.vault';
  const PKEY = 'lifeorganiser.prefs';

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null') || seed(); }
    catch (e) { return seed(); }
  }
  function save(files) { localStorage.setItem(KEY, JSON.stringify(files)); }

  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function seed() {
    const files = {
      'Command Center.md': '---\ntype: dashboard\n---\n\n# 🧭 Command Center\n',
      '00-Inbox/Inbox.md':
        '---\ntype: inbox\n---\n\n# 📥 Inbox\n\nCapture first, organise later.\n\n' +
        '## Captures\n\n- ' + todayStr() + ' 09:12 — Book the dentist\n' +
        '- ' + todayStr() + ' 09:20 — Idea: weekend trip to the coast\n',
      '01-Values/Values.md':
        '---\ntype: index\n---\n\n# 🧭 Values\n\n## My values\n\n' +
        '1. **Health** — energy for everything else\n2. **Family** — the people who stay\n3. **Growth** — build things that last\n',
      '02-Goals/Goals.md': '---\ntype: index\n---\n\n# 🏔 Goals\n\n## Active goals\n\n- [[Run a half marathon]]\n',
      '02-Goals/Run a half marathon.md':
        '---\ntype: goal\nvalue: "[[Values]]"\ntarget-date: 2026-11-15\n---\n\n' +
        '# Run a half marathon\n\n**Why:** Serves [[Values|Health]].\n\n**Measure:** Cross the line under 2h.\n\n' +
        '**Progress:** ▰▰▰▰▱▱▱▱▱▱ 40%\n\n## Milestones\n\n- [x] Run 10k without stopping\n- [ ] Run 15k 📅 2026-09-20\n- [ ] Book the race 📅 2026-09-05\n',
      '03-Projects/Projects.md': '---\ntype: index\n---\n\n# 🚀 Projects\n\n## Active\n\n- [[Set up my Life Organiser]] 🟢\n- [[Kitchen shelves]] 🟡\n',
      '03-Projects/Set up my Life Organiser.md':
        '---\ntype: project\nstatus: on-track\n---\n\n# Set up my Life Organiser\n\n' +
        '**Outcome:** The system reflects my real life.\n\n## Next actions\n\n' +
        '- [x] Install the app\n- [ ] Fill in [[Values]]\n- [ ] Capture everything on my mind 📅 ' + todayStr() + '\n\n## Log\n\n- ' + todayStr() + ' — Created.\n',
      '03-Projects/Kitchen shelves.md':
        '---\ntype: project\nstatus: needs-attention\n---\n\n# Kitchen shelves\n\n' +
        '**Outcome:** Shelves up and loaded.\n\n## Next actions\n\n- [ ] Measure the alcove 📅 2026-08-20\n- [ ] Order brackets\n\n## Log\n\n',
      '04-Areas/Areas.md': '---\ntype: index\n---\n\n# 🌳 Areas\n\n## My areas\n\n- [[Health]]\n- [[Finances]]\n',
      '04-Areas/Health.md': '---\ntype: area\n---\n\n# Health\n\n**Standard:** Sleep 7h+, move daily.\n\n## Next actions\n\n- [ ] Book dental check-up 📅 2026-09-02\n',
      '04-Areas/Finances.md': '---\ntype: area\n---\n\n# Finances\n\n**Standard:** No surprise money.\n\n## Next actions\n\n- [ ] Review subscriptions\n',
      '05-Knowledge/Knowledge.md': '---\ntype: index\n---\n\n# 📚 Knowledge\n\n## Notes\n\n',
      '06-People/People.md': '---\ntype: index\n---\n\n# 🤝 People\n\n## Notes\n\n- [[Sam]]\n',
      '06-People/Sam.md': '---\ntype: person\nbirthday: 2026-09-04\n---\n\n# Sam\n\n**Context:** Oldest friend.\n\n## Follow-ups\n\n- [ ] Reply about the weekend\n\n## Notes\n\n',
      '_templates/Daily Note.md':
        '---\ntype: daily\ndate: {{date}}\nupdated: {{date}}\n---\n\n# {{date}}\n\n' +
        "## 🎯 Today's One Thing\n\n*The single thing that would make today a win.*\n\n" +
        '## ✅ Tasks\n\n- [ ] \n\n## 🔁 Habits\n\n- [ ] Sleep 7h+\n- [ ] Move (walk / gym / anything)\n' +
        '- [ ] No phone first hour\n- [ ] Read 10 minutes\n\n' +
        '## 🌙 Evening reflection\n\n**Went well:** \n**Didn\'t:** \n**Grateful for:** \n**Energy (1–5):** \n',
      '_templates/Project.md':
        '---\ntype: project\nstatus: on-track\ncreated: {{date}}\nupdated: {{date}}\n---\n\n# {{title}}\n\n' +
        '**Outcome:** \n\n## Next actions\n\n- [ ] \n\n## Log\n\n- {{date}} — Project created.\n',
      '_templates/Goal.md':
        '---\ntype: goal\ncreated: {{date}}\nupdated: {{date}}\nvalue: ""\ntarget-date: ""\n---\n\n# {{title}}\n\n' +
        '**Why:** \n\n**Measure:** \n\n**Progress:** ▱▱▱▱▱▱▱▱▱▱ 0%\n\n## Milestones\n\n- [ ] \n',
      '_templates/Area.md':
        '---\ntype: area\nupdated: {{date}}\n---\n\n# {{title}}\n\n**Standard:** \n\n## Next actions\n\n- [ ] \n\n## Notes\n\n',
      '_templates/Person.md':
        '---\ntype: person\nupdated: {{date}}\nbirthday: ""\n---\n\n# {{title}}\n\n**Context:** \n\n## Follow-ups\n\n- [ ] \n\n## Notes\n\n- {{date}} — \n',
      '_templates/Knowledge Note.md':
        '---\ntype: knowledge\ncreated: {{date}}\nupdated: {{date}}\n---\n\n# {{title}}\n\n\n\n## Source\n\n\n\n## Connects to\n\n',
      '_templates/Weekly Review.md':
        '---\ntype: weekly-review\nweek: {{week}}\n---\n\n# Week {{week}} Review\n\n## 🏆 Wins\n\n- \n\n## 📖 Lessons\n\n- \n\n' +
        '## 🚀 Projects check\n\n## 🏔 Goals check\n\n## 🔁 Habits this week\n\n## 🤝 People\n\n' +
        '## 🧹 Loose ends\n\n- [ ] Inbox at zero\n\n## 🎯 Next week\'s One Thing\n\n',
    };
    save(files);
    return files;
  }

  let files = load();

  function fakeAsync(value, delay) {
    return new Promise(function (resolve) { setTimeout(function () { resolve(value); }, delay || 400); });
  }

  return {
    isNative: false,
    listFiles: function () { return Object.keys(files).sort(); },
    readFile: function (p) { return Object.prototype.hasOwnProperty.call(files, p) ? files[p] : null; },
    writeFile: function (p, c) { files[p] = c; save(files); return true; },
    deleteFile: function (p) { delete files[p]; save(files); return true; },
    moveFile: function (a, b) { files[b] = files[a]; delete files[a]; save(files); return true; },
    fileExists: function (p) { return Object.prototype.hasOwnProperty.call(files, p); },
    readAll: function () { return Object.assign({}, files); },
    today: todayStr,
    now: function () {
      const d = new Date();
      return todayStr() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    },
    isoWeek: function () {
      const d = new Date();
      const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7));
      const week1 = new Date(t.getFullYear(), 0, 4);
      const week = 1 + Math.round(((t - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
      return t.getFullYear() + '-W' + pad(week);
    },
    getPrefs: function () {
      try { return JSON.parse(localStorage.getItem(PKEY) || 'null') || defaults(); }
      catch (e) { return defaults(); }
    },
    setPrefs: function (o) {
      const merged = Object.assign(this.getPrefs(), o);
      merged.hasToken = !!(o.githubToken || merged.hasToken);
      merged.hasAnthropicKey = !!(o.anthropicKey || merged.hasAnthropicKey);
      delete merged.githubToken;
      delete merged.anthropicKey;
      merged.syncConfigured = merged.hasToken && !!merged.owner && !!merged.repo;
      localStorage.setItem(PKEY, JSON.stringify(merged));
      return true;
    },
    takeLaunchIntent: function () { return { route: null, share: null }; },
    isDark: function () {
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    },
    log: function (m) { console.log('[bridge]', m); },
    sync: function () {
      return fakeAsync({ pulled: 0, pushed: 2, deletedLocally: 0, deletedRemotely: 0, conflicts: [], lastSyncAt: this.now() }, 700);
    },
    testConnection: function () {
      return fakeAsync({ repo: 'you/lifeorganiser', private: true, branch: 'main', head: 'abc1234' }, 500);
    },
    aiAsk: function () {
      return Promise.reject(new Error('AI actions need the Android app and an API key.'));
    },
  };

  function defaults() {
    return {
      hasToken: false, hasAnthropicKey: false, owner: '', repo: '',
      branch: 'main', model: 'claude-sonnet-5', autoSync: true,
      lastSyncAt: '', syncConfigured: false,
    };
  }
})();
