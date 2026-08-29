/*
 * iCalendar parsing — enough of RFC 5545 for a personal Google Calendar feed:
 * folded lines, VEVENTs, dates and date-times (floating, UTC and TZID),
 * recurring events (DAILY/WEEKLY/MONTHLY/YEARLY with INTERVAL, BYDAY, UNTIL,
 * COUNT), EXDATE, and RECURRENCE-ID overrides.
 *
 * Everything returns plain local Dates; the expansion window keeps the cost
 * bounded no matter what the feed contains.
 */
const ICS = (function () {

  function unfold(text) {
    return String(text || '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\n[ \t]/g, '');
  }

  function unescapeText(s) {
    return String(s || '')
      .replace(/\\n/gi, ' · ')
      .replace(/\\,/g, ',')
      .replace(/\\;/g, ';')
      .replace(/\\\\/g, '\\');
  }

  /** "DTSTART;TZID=Europe/London:20260829T093000" -> {name, params, value} */
  function parseLine(line) {
    const colon = findUnquotedColon(line);
    if (colon === -1) return null;
    const left = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const parts = left.split(';');
    const params = {};
    for (let i = 1; i < parts.length; i++) {
      const eq = parts[i].indexOf('=');
      if (eq !== -1) {
        params[parts[i].slice(0, eq).toUpperCase()] =
          parts[i].slice(eq + 1).replace(/^"|"$/g, '');
      }
    }
    return { name: parts[0].toUpperCase(), params: params, value: value };
  }

  function findUnquotedColon(line) {
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') quoted = !quoted;
      else if (ch === ':' && !quoted) return i;
    }
    return -1;
  }

  // ---- date handling ------------------------------------------------------

  /**
   * Epoch for a wall-clock time in an IANA timezone, without a timezone
   * library: guess UTC, see what that instant reads as in the zone, and
   * correct by the difference. A second pass handles DST edges.
   */
  function zonedEpoch(y, mo, d, h, mi, s, tzid) {
    const wall = Date.UTC(y, mo - 1, d, h, mi, s);

    let formatter;
    try {
      formatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: tzid, hour12: false,
        year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', second: 'numeric',
      });
    } catch (e) {
      // Unknown TZID: treat the time as device-local.
      return new Date(y, mo - 1, d, h, mi, s).getTime();
    }

    function asZone(epoch) {
      const parts = {};
      formatter.formatToParts(epoch).forEach(function (p) { parts[p.type] = p.value; });
      return Date.UTC(
        Number(parts.year), Number(parts.month) - 1, Number(parts.day),
        Number(parts.hour) % 24, Number(parts.minute), Number(parts.second)
      );
    }

    // Fixed-point iteration on g: we want asZone(g) == wall.
    let guess = wall + (wall - asZone(wall));
    guess = guess + (wall - asZone(guess));
    return guess;
  }

  /** ICS date/date-time -> { date: Date, allDay: bool } */
  function parseWhen(value, params) {
    const isDate = (params && params.VALUE === 'DATE') || /^\d{8}$/.test(value);
    if (isDate) {
      const m = /^(\d{4})(\d{2})(\d{2})/.exec(value);
      if (!m) return null;
      return {
        date: new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])),
        allDay: true,
      };
    }

    const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(value);
    if (!m) return null;
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    const h = Number(m[4]), mi = Number(m[5]), s = Number(m[6] || 0);

    if (m[7] === 'Z') {
      return { date: new Date(Date.UTC(y, mo - 1, d, h, mi, s)), allDay: false };
    }
    if (params && params.TZID) {
      return { date: new Date(zonedEpoch(y, mo, d, h, mi, s, params.TZID)), allDay: false };
    }
    return { date: new Date(y, mo - 1, d, h, mi, s), allDay: false };
  }

  function dayKey(date) {
    return date.getFullYear() + '-' +
      String(date.getMonth() + 1).padStart(2, '0') + '-' +
      String(date.getDate()).padStart(2, '0');
  }

  // ---- recurrence ---------------------------------------------------------

  const WEEKDAYS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

  function parseRRule(value) {
    const rule = {};
    value.split(';').forEach(function (pair) {
      const eq = pair.indexOf('=');
      if (eq !== -1) rule[pair.slice(0, eq).toUpperCase()] = pair.slice(eq + 1);
    });
    return rule;
  }

  /**
   * Occurrence start Dates for one event inside [windowStart, windowEnd).
   * COUNT is honoured by walking from DTSTART; everything is capped so a
   * malformed rule can't loop forever.
   */
  function expand(event, windowStart, windowEnd) {
    const first = event.start;
    if (!event.rrule) {
      return (first >= windowStart && first < windowEnd) ? [first] : [];
    }

    const rule = event.rrule;
    const freq = rule.FREQ;
    if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) {
      return (first >= windowStart && first < windowEnd) ? [first] : [];
    }

    const interval = Math.max(1, parseInt(rule.INTERVAL || '1', 10) || 1);
    const count = rule.COUNT ? parseInt(rule.COUNT, 10) : null;
    let until = null;
    if (rule.UNTIL) {
      const parsed = parseWhen(rule.UNTIL, {});
      if (parsed) {
        until = parsed.date;
        if (parsed.allDay) until = new Date(until.getTime() + 86399000);
      }
    }

    const byday = (freq === 'WEEKLY' && rule.BYDAY)
      ? rule.BYDAY.split(',').map(function (d) { return WEEKDAYS[d.slice(-2)]; })
          .filter(function (n) { return n !== undefined; })
      : null;

    const out = [];
    let made = 0;         // total occurrences generated (for COUNT)
    let cursor = new Date(first);
    let guard = 0;

    while (guard++ < 8000) {
      if (until && cursor > until) break;
      if (count !== null && made >= count) break;
      if (cursor >= windowEnd) break;

      if (freq === 'WEEKLY' && byday && byday.length) {
        // Walk the 7 days of this week individually.
        const weekStart = new Date(cursor);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        for (let i = 0; i < 7; i++) {
          const day = new Date(weekStart);
          day.setDate(day.getDate() + i);
          day.setHours(first.getHours(), first.getMinutes(), first.getSeconds(), 0);
          if (day < first) continue;
          if (!byday.includes(day.getDay())) continue;
          if (until && day > until) continue;
          if (count !== null && made >= count) break;
          made++;
          if (day >= windowStart && day < windowEnd) out.push(day);
        }
        cursor.setDate(cursor.getDate() + 7 * interval);
        continue;
      }

      made++;
      if (cursor >= windowStart) out.push(new Date(cursor));

      if (freq === 'DAILY') cursor.setDate(cursor.getDate() + interval);
      else if (freq === 'WEEKLY') cursor.setDate(cursor.getDate() + 7 * interval);
      else if (freq === 'MONTHLY') cursor.setMonth(cursor.getMonth() + interval);
      else cursor.setFullYear(cursor.getFullYear() + interval);
    }

    return out;
  }

  // ---- main ---------------------------------------------------------------

  /**
   * Parse one ICS body into concrete occurrences within the window.
   * Returns [{title, location, start, end, allDay}] sorted by start.
   */
  function parse(text, windowStart, windowEnd) {
    const lines = unfold(text).split('\n');
    const events = [];
    let current = null;

    for (const raw of lines) {
      const line = raw.trim();
      if (line === 'BEGIN:VEVENT') { current = { exdates: [] }; continue; }
      if (line === 'END:VEVENT') {
        if (current && current.start && current.title) events.push(current);
        current = null;
        continue;
      }
      if (!current) continue;

      const parsed = parseLine(line);
      if (!parsed) continue;

      switch (parsed.name) {
        case 'SUMMARY':
          current.title = unescapeText(parsed.value);
          break;
        case 'LOCATION':
          current.location = unescapeText(parsed.value);
          break;
        case 'UID':
          current.uid = parsed.value;
          break;
        case 'DTSTART': {
          const when = parseWhen(parsed.value, parsed.params);
          if (when) { current.start = when.date; current.allDay = when.allDay; }
          break;
        }
        case 'DTEND': {
          const when = parseWhen(parsed.value, parsed.params);
          if (when) current.end = when.date;
          break;
        }
        case 'RRULE':
          current.rrule = parseRRule(parsed.value);
          break;
        case 'EXDATE':
          parsed.value.split(',').forEach(function (v) {
            const when = parseWhen(v, parsed.params);
            if (when) current.exdates.push(when.date.getTime());
          });
          break;
        case 'RECURRENCE-ID': {
          const when = parseWhen(parsed.value, parsed.params);
          if (when) current.recurrenceId = when.date.getTime();
          break;
        }
        case 'STATUS':
          current.cancelled = parsed.value === 'CANCELLED';
          break;
      }
    }

    // An override instance replaces one occurrence of its series.
    const overridden = {};
    events.forEach(function (ev) {
      if (ev.uid && ev.recurrenceId !== undefined) {
        (overridden[ev.uid] = overridden[ev.uid] || []).push(ev.recurrenceId);
      }
    });

    const out = [];
    events.forEach(function (ev) {
      if (ev.cancelled) return;
      const duration = (ev.end && ev.start) ? ev.end - ev.start : 0;
      const skip = (ev.exdates || []).concat(
        ev.recurrenceId === undefined ? (overridden[ev.uid] || []) : []
      );

      const starts = (ev.recurrenceId !== undefined)
        ? ((ev.start >= windowStart && ev.start < windowEnd) ? [ev.start] : [])
        : expand(ev, windowStart, windowEnd);

      starts.forEach(function (start) {
        if (skip.includes(start.getTime())) return;
        out.push({
          title: ev.title,
          location: ev.location || null,
          start: start,
          end: duration ? new Date(start.getTime() + duration) : null,
          allDay: !!ev.allDay,
        });
      });
    });

    out.sort(function (a, b) { return a.start - b.start; });
    return out;
  }

  function fmtTime(date) {
    return String(date.getHours()).padStart(2, '0') + ':' +
      String(date.getMinutes()).padStart(2, '0');
  }

  return { parse: parse, dayKey: dayKey, fmtTime: fmtTime, _zonedEpoch: zonedEpoch };
})();
