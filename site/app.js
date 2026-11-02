/*
 * TreePrep status page. Plain JS, no dependencies, nothing is rendered with innerHTML.
 *
 * Data (all public, read at page load):
 *   - history/summary.json  (raw.githubusercontent.com): per-component status, uptime and dailyMinutesDown,
 *                           written by Upptime's summary job.
 *   - history/<slug>.yml    (raw.githubusercontent.com): only startTime is read, to know when tracking began.
 *   - issues labelled "status" and their comments (api.github.com, unauthenticated, 60 requests/hour/IP):
 *                           one list request, plus one comments request per recent incident that has comments.
 *                           Everything from the API is cached in sessionStorage.
 *
 * Site URLs in summary.json are placeholders ($TREEPREP_HOST) and are never read or shown.
 */
(function () {
  "use strict";

  var REPO = "TreePrep/treeprep-status";
  var RAW = "https://raw.githubusercontent.com/" + REPO + "/master/history/";
  var API = "https://api.github.com/repos/" + REPO + "/issues";
  var HISTORY_URL = "https://github.com/" + REPO + "/issues?q=label%3Astatus";

  var BAR_DAYS = 90; // bars per component
  var SHOW_DAYS = 14; // days always listed under Past incidents, and how far back comments are fetched
  var MAX_INCIDENT_DAYS = 90; // incidents older than this are not shown
  var CACHE_TTL = 5 * 60 * 1000;
  var REFRESH_MS = 5 * 60 * 1000;
  var DAY = 86400000;
  var DEFAULT_OPEN = "We are aware of an issue and are working to resolve it.";
  var DEFAULT_RESOLVED = "This incident has been resolved.";
  var TRUSTED = { OWNER: 1, MEMBER: 1, COLLABORATOR: 1 };
  var LABELS = ["Investigating", "Identified", "Monitoring", "Update", "Resolved"];

  var host = location.hostname;
  var MOCK = host === "localhost" || host === "127.0.0.1" ? new URLSearchParams(location.search).get("mock") : null;

  /* ---------- small helpers ---------- */

  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (attrs[k] == null || attrs[k] === false) continue;
        if (k === "class") el.className = attrs[k];
        else el.setAttribute(k, attrs[k] === true ? "" : attrs[k]);
      }
    }
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c == null || c === false) continue;
      el.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  var dayFmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
  var shortDayFmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
  var timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", hour12: false });

  function isoDay(ms) {
    return new Date(ms).toISOString().slice(0, 10);
  }
  function dayMs(iso) {
    return Date.parse(iso + "T00:00:00Z");
  }
  function fmtDay(iso) {
    return dayFmt.format(dayMs(iso));
  }
  function fmtTime(ms) {
    return timeFmt.format(ms) + " UTC";
  }

  /** 45 -> "45 min", 125 -> "2 h 5 min", 1500 -> "1 d 1 h" */
  function fmtMinutes(min) {
    min = Math.max(0, Math.round(min));
    if (min < 1) return "less than a minute";
    if (min < 60) return min + " min";
    var hrs = Math.floor(min / 60);
    var m = min % 60;
    if (hrs < 24) return hrs + " h" + (m ? " " + m + " min" : "");
    var d = Math.floor(hrs / 24);
    var hh = hrs % 24;
    return d + " d" + (hh ? " " + hh + " h" : "");
  }

  /* ---------- cache ---------- */

  function cacheGet(key) {
    try {
      return JSON.parse(sessionStorage.getItem("tp:" + key));
    } catch (e) {
      return null;
    }
  }
  function cacheSet(key, data) {
    try {
      sessionStorage.setItem("tp:" + key, JSON.stringify({ t: Date.now(), data: data }));
    } catch (e) {
      /* storage full or blocked */
    }
  }
  /** Fresh cache wins; otherwise fetch, and fall back to a stale copy if the request fails. */
  function cached(key, ttl, fetcher) {
    var c = cacheGet(key);
    if (c && Date.now() - c.t < ttl) return Promise.resolve(c.data);
    return fetcher().then(
      function (d) {
        cacheSet(key, d);
        return d;
      },
      function (err) {
        if (c) return c.data;
        throw err;
      }
    );
  }

  function getJSON(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  /* ---------- data loading ---------- */

  var mockP = null;
  function loadMock() {
    return mockP || (mockP = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = "/mock.js";
      s.onload = function () {
        resolve(window.__STATUS_MOCK__(MOCK));
      };
      s.onerror = function () {
        reject(new Error("mock.js not found"));
      };
      document.head.append(s);
    }));
  }

  function loadStart(slug) {
    return fetch(RAW + slug + ".yml")
      .then(function (r) {
        return r.ok ? r.text() : "";
      })
      .then(function (t) {
        var m = /^startTime:\s*(\S+)/m.exec(t);
        return m ? Date.parse(m[1]) : NaN;
      })
      .catch(function () {
        return NaN;
      });
  }

  function loadStatus() {
    if (MOCK) return loadMock().then(function (m) { return { summary: m.summary, start: m.start }; });
    return getJSON(RAW + "summary.json").then(function (summary) {
      return Promise.all(summary.map(function (s) { return loadStart(s.slug); })).then(function (starts) {
        var valid = starts.filter(function (n) { return n > 0; });
        return { summary: summary, start: valid.length ? Math.min.apply(null, valid) : NaN };
      });
    });
  }

  function loadIncidents() {
    if (MOCK) return loadMock().then(function (m) { return m.incidents; });
    return cached("issues", CACHE_TTL, function () {
      return getJSON(API + "?labels=status&state=all&per_page=100&sort=created&direction=desc");
    }).then(function (issues) {
      var now = Date.now();
      var jobs = issues.map(function (issue) {
        var recent = !issue.closed_at || now - Date.parse(issue.created_at) < SHOW_DAYS * DAY;
        if (!recent || !issue.comments) return Promise.resolve({ issue: issue, comments: [] });
        // keyed by updated_at, so a comment (or edit) makes the next load fetch again
        return cached("c:" + issue.number + ":" + issue.updated_at, 1e15, function () {
          return getJSON(issue.comments_url + "?per_page=100");
        }).then(
          function (comments) { return { issue: issue, comments: comments }; },
          function () { return { issue: issue, comments: [] }; }
        );
      });
      return Promise.all(jobs);
    });
  }

  /* ---------- incident model ---------- */

  var EMOJI_LEAD = /^[\s\p{Extended_Pictographic}\p{Emoji_Modifier}️‍⃣]+/u;

  function cleanTitle(t) {
    return String(t || "").replace(EMOJI_LEAD, "").trim() || "Incident";
  }

  function stripComments(s) {
    return String(s || "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<!--[\s\S]*$/, "")
      .replace(/\r\n?/g, "\n")
      .trim();
  }

  /** "Resolved: text", "**Resolved:** text", "**Resolved**: text" -> { label, text } */
  var LABEL_RE = /^\s*(?:\*\*\s*(Investigating|Identified|Monitoring|Update|Resolved)\s*:?\s*\*\*\s*:?|(Investigating|Identified|Monitoring|Update|Resolved)\s*:)\s*/i;

  function splitLabel(raw) {
    var text = stripComments(raw);
    var m = LABEL_RE.exec(text);
    if (!m) return { label: "Update", text: text };
    var word = (m[1] || m[2]).toLowerCase();
    var label = LABELS.filter(function (l) { return l.toLowerCase() === word; })[0];
    return { label: label, text: text.slice(m[0].length).trim() };
  }

  /** Upptime's own texts carry commit hashes and links; show a plain sentence instead. */
  function tidyAutoText(label, text, isBody) {
    if (isBody && (!text || /^In \[`?[0-9a-f]{7,}/.test(text))) return DEFAULT_OPEN;
    if (label === "Resolved") {
      var m = /^(.*?)\s+(is back up|performance has improved)\s+in\s+\[/.exec(text);
      if (m) return m[1] + " " + m[2] + ".";
      if (!text) return DEFAULT_RESOLVED;
    }
    return text || (isBody ? DEFAULT_OPEN : "");
  }

  function buildIncident(entry, byslug) {
    var issue = entry.issue;
    var authorLogin = issue.user && issue.user.login;
    var created = Date.parse(issue.created_at);
    var closed = issue.closed_at ? Date.parse(issue.closed_at) : null;

    var slugLabel = (issue.labels || [])
      .map(function (l) { return typeof l === "string" ? l : l.name; })
      .filter(function (n) { return byslug[n]; })[0];

    var updates = [
      { label: "Investigating", ts: created, text: tidyAutoText("Investigating", stripComments(issue.body), true) },
    ];

    (entry.comments || [])
      .filter(function (c) {
        return TRUSTED[c.author_association] || (c.user && c.user.login === authorLogin);
      })
      .sort(function (a, b) { return Date.parse(a.created_at) - Date.parse(b.created_at); })
      .forEach(function (c) {
        var s = splitLabel(c.body);
        var text = tidyAutoText(s.label, s.text, false);
        if (!text && s.label === "Update") return;
        updates.push({ label: s.label, ts: Date.parse(c.created_at), text: text });
      });

    var resolvedUpdate = updates.filter(function (u) { return u.label === "Resolved"; }).pop();
    if (closed && !resolvedUpdate) {
      resolvedUpdate = { label: "Resolved", ts: closed, text: DEFAULT_RESOLVED };
      updates.push(resolvedUpdate);
    }

    var status = "Investigating";
    if (closed) status = "Resolved";
    else {
      var named = updates.filter(function (u) { return u.label !== "Update"; }).pop();
      if (named && named.label !== "Resolved") status = named.label;
    }

    var end = closed ? (resolvedUpdate ? resolvedUpdate.ts : closed) : null;
    updates.sort(function (a, b) { return b.ts - a.ts; });

    return {
      title: cleanTitle(issue.title),
      degraded: /degrad/i.test(issue.title || ""),
      component: slugLabel ? byslug[slugLabel] : null,
      created: created,
      end: end,
      status: status,
      updates: updates,
    };
  }

  /* ---------- safe text rendering: paragraphs, **bold**, `code`, [text](http/https link) ---------- */

  var INLINE_RE = /\*\*([^*\n]+)\*\*|`([^`\n]+)`|\[([^\]\n]+)\]\(([^)\s]+)\)/g;

  function safeHref(u) {
    try {
      var url = new URL(u);
      return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
    } catch (e) {
      return null;
    }
  }

  function inline(parent, line) {
    var last = 0;
    var m;
    INLINE_RE.lastIndex = 0;
    while ((m = INLINE_RE.exec(line))) {
      if (m.index > last) parent.append(line.slice(last, m.index));
      if (m[1] != null) parent.append(h("strong", null, m[1]));
      else if (m[2] != null) parent.append(h("code", null, m[2]));
      else {
        var href = safeHref(m[4]);
        if (href) parent.append(h("a", { href: href, target: "_blank", rel: "noopener noreferrer nofollow" }, m[3]));
        else parent.append(m[3]);
      }
      last = INLINE_RE.lastIndex;
    }
    if (last < line.length) parent.append(line.slice(last));
  }

  function renderText(text) {
    var frag = document.createDocumentFragment();
    text.split(/\n{2,}/).forEach(function (para) {
      if (!para.trim()) return;
      var p = h("p");
      para.split("\n").forEach(function (line, i) {
        if (i) p.append(h("br"));
        inline(p, line);
      });
      frag.append(p);
    });
    return frag;
  }

  /* ---------- components, banner ---------- */

  var STATE = {
    up: { text: "Operational", cls: "" },
    degraded: { text: "Degraded performance", cls: "state--warn" },
    down: { text: "Major outage", cls: "state--bad" },
  };

  function overall(summary) {
    var down = summary.filter(function (s) { return s.status === "down"; }).length;
    var deg = summary.filter(function (s) { return s.status === "degraded"; }).length;
    if (down && down === summary.length) return { tone: "bad", text: "Major outage" };
    if (down) return { tone: "bad", text: "Partial outage" };
    if (deg) return { tone: "warn", text: "Degraded performance" };
    return { tone: "ok", text: "All systems operational" };
  }

  var ICONS = {
    ok: "M6.5 12.5l3.8 3.8 7.2-8",
    warn: "M12 7v6M12 16.6v.2",
    bad: "M8.2 8.2l7.6 7.6M15.8 8.2l-7.6 7.6",
  };

  function icon(tone) {
    var ns = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(ns, "svg");
    svg.setAttribute("class", "banner__icon");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    var c = document.createElementNS(ns, "circle");
    c.setAttribute("cx", "12");
    c.setAttribute("cy", "12");
    c.setAttribute("r", "10");
    c.setAttribute("fill", "none");
    c.setAttribute("stroke", "currentColor");
    c.setAttribute("stroke-width", "1.8");
    var p = document.createElementNS(ns, "path");
    p.setAttribute("d", ICONS[tone]);
    p.setAttribute("fill", "none");
    p.setAttribute("stroke", "currentColor");
    p.setAttribute("stroke-width", "2");
    p.setAttribute("stroke-linecap", "round");
    p.setAttribute("stroke-linejoin", "round");
    svg.append(c, p);
    return svg;
  }

  function renderBanner(summary, error) {
    var el = document.getElementById("banner");
    el.replaceChildren();
    if (error) {
      el.className = "banner banner--none";
      var btn = h("button", { class: "banner__retry", type: "button" }, "Try again");
      btn.addEventListener("click", function () { load(true); });
      el.append(h("span", { class: "banner__text" }, "Status is temporarily unavailable"), btn);
      return;
    }
    var o = overall(summary);
    el.className = "banner" + (o.tone === "ok" ? "" : " banner--" + o.tone);
    el.append(icon(o.tone), h("span", { class: "banner__text" }, o.text));
  }

  /* ---------- 90-day bars ---------- */

  var tip = document.getElementById("tip");
  var live = document.getElementById("live");

  function tipText(b) {
    return b.date + ": " + b.what;
  }

  function showTip(barEl, b) {
    tip.replaceChildren(h("span", { class: "tip__date" }, fmtDay(b.date)), h("span", { class: "tip__what" }, b.what));
    tip.hidden = false;
    var r = barEl.getBoundingClientRect();
    var tw = tip.offsetWidth;
    var left = Math.min(Math.max(8, r.left + r.width / 2 - tw / 2), window.innerWidth - tw - 8);
    var top = r.top - tip.offsetHeight - 8;
    if (top < 8) top = r.bottom + 8;
    tip.style.left = left + "px";
    tip.style.top = top + "px";
  }
  function hideTip() {
    tip.hidden = true;
  }

  function buildBars(s, start) {
    var today = dayMs(isoDay(Date.now()));
    var startDay = start > 0 ? dayMs(isoDay(start)) : -Infinity;
    var down = s.dailyMinutesDown || {};
    var bars = [];
    var totalDown = 0;
    var daysWithDown = 0;
    for (var i = BAR_DAYS - 1; i >= 0; i--) {
      var ms = today - i * DAY;
      var date = isoDay(ms);
      var min = down[date] || 0;
      var bar = { date: date, min: min };
      if (ms < startDay) {
        bar.cls = "bar--none";
        bar.what = "No data";
      } else {
        totalDown += min;
        if (min > 0) daysWithDown++;
        bar.cls = min === 0 ? "" : min < 60 ? "bar--warn" : "bar--bad";
        bar.what = min === 0 ? "No downtime recorded" : fmtMinutes(min) + " of downtime";
      }
      bars.push(bar);
    }

    // uptime over the last 90 days (or since tracking began, if that is shorter)
    var trackedMin = start > 0 ? Math.min(BAR_DAYS * 1440, (Date.now() - start) / 60000) : BAR_DAYS * 1440;
    var pct = 100 - (totalDown / Math.max(trackedMin, 1)) * 100;
    if (!(pct >= 0)) pct = 100;
    pct = Math.floor(Math.min(100, Math.max(0, pct)) * 100) / 100;
    if (pct >= 100 && totalDown > 0) pct = 99.99;

    return { bars: bars, pct: pct, totalDown: totalDown, daysWithDown: daysWithDown };
  }

  function renderBars(s, model) {
    var summaryLabel =
      s.name + ", last 90 days: " + model.pct.toFixed(2) + "% uptime" +
      (model.daysWithDown
        ? ", downtime on " + model.daysWithDown + (model.daysWithDown === 1 ? " day" : " days")
        : ", no downtime recorded") +
      ". Use the left and right arrow keys to read each day.";
    var wrap = h("div", { class: "bars", role: "img", "aria-label": summaryLabel, tabindex: "0" });
    var els = model.bars.map(function (b) {
      var el = h("span", { class: "bar " + b.cls });
      el.addEventListener("pointerenter", function (e) {
        if (e.pointerType === "mouse") show(el, b);
      });
      el.addEventListener("pointerdown", function () { show(el, b); });
      return el;
    });
    wrap.append.apply(wrap, els);

    var active = -1;
    function show(el, b) {
      els.forEach(function (x) { x.classList.remove("is-active"); });
      el.classList.add("is-active");
      showTip(el, b);
    }
    function clear() {
      els.forEach(function (x) { x.classList.remove("is-active"); });
      hideTip();
    }
    function go(i) {
      active = Math.max(0, Math.min(els.length - 1, i));
      show(els[active], model.bars[active]);
      live.textContent = fmtDay(model.bars[active].date) + ": " + model.bars[active].what;
    }
    wrap.addEventListener("pointerleave", clear);
    wrap.addEventListener("blur", function () { active = -1; clear(); });
    wrap.addEventListener("keydown", function (e) {
      var k = e.key;
      if (k === "ArrowLeft") go((active < 0 ? els.length : active) - 1);
      else if (k === "ArrowRight") go(active < 0 ? els.length - 1 : active + 1);
      else if (k === "Home") go(0);
      else if (k === "End") go(els.length - 1);
      else if (k === "Escape") { active = -1; clear(); return; }
      else return;
      e.preventDefault();
    });
    return wrap;
  }

  function renderComponents(summary, start) {
    var box = document.getElementById("components");
    box.replaceChildren();
    summary.forEach(function (s) {
      var st = STATE[s.status] || STATE.up;
      var model = buildBars(s, start);
      box.append(
        h("div", { class: "comp" },
          h("div", { class: "comp__top" },
            h("h3", { class: "comp__name" }, s.name),
            h("span", { class: "state " + st.cls }, st.text)),
          renderBars(s, model),
          h("div", { class: "legend", "aria-hidden": "true" },
            h("span", null, "90 days ago"),
            h("span", { class: "legend__rule" }),
            h("span", { class: "legend__pct" }, model.pct.toFixed(2) + "% uptime"),
            h("span", { class: "legend__rule" }),
            h("span", null, "Today")))
      );
    });
    box.removeAttribute("aria-busy");
  }

  /* ---------- past incidents ---------- */

  function renderIncident(inc) {
    var chipCls = inc.status === "Resolved" ? "chip--ok" : inc.status === "Monitoring" ? "chip--info" : inc.degraded ? "chip--warn" : "";
    var duration = inc.end
      ? "Lasted " + fmtMinutes((inc.end - inc.created) / 60000)
      : "Ongoing for " + fmtMinutes((Date.now() - inc.created) / 60000);
    var titleId = "inc-" + inc.created;

    var list = h("ol", { class: "upd" });
    inc.updates.forEach(function (u) {
      var body = h("div", { class: "upd__body" });
      var lab = h("strong", { class: "upd__label" + (u.label === "Resolved" ? " upd__label--resolved" : "") }, u.label);
      var text = renderText(u.text || "");
      var first = text.firstChild;
      if (first) {
        first.prepend(lab, " – ");
        body.append(text);
      } else {
        body.append(h("p", null, lab));
      }
      list.append(
        h("li", { class: "upd__item" },
          h("time", { class: "upd__time", datetime: new Date(u.ts).toISOString() }, fmtTime(u.ts)),
          body)
      );
    });

    return h("article", { class: "inc" + (inc.degraded ? " inc--warn" : ""), "aria-labelledby": titleId },
      h("h4", { class: "inc__title", id: titleId }, inc.title),
      h("div", { class: "inc__meta" },
        h("span", { class: "chip " + chipCls }, inc.status),
        h("span", null, duration),
        inc.component ? h("span", { class: "inc__comp" }, inc.component) : null),
      list);
  }

  function renderIncidents(entries, summary) {
    var box = document.getElementById("incidents");
    box.replaceChildren();
    box.removeAttribute("aria-busy");

    var byslug = {};
    summary.forEach(function (s) { byslug[s.slug] = s.name; });

    var now = Date.now();
    var byDay = {};
    entries.forEach(function (e) {
      var inc = buildIncident(e, byslug);
      if (now - inc.created > MAX_INCIDENT_DAYS * DAY) return;
      var d = isoDay(inc.created);
      (byDay[d] = byDay[d] || []).push(inc);
    });

    var days = {};
    for (var i = 0; i < SHOW_DAYS; i++) days[isoDay(now - i * DAY)] = true;
    Object.keys(byDay).forEach(function (d) { days[d] = true; });

    Object.keys(days).sort().reverse().forEach(function (d) {
      var sec = h("section", { class: "day", "aria-label": fmtDay(d) }, h("h3", { class: "day__h" }, fmtDay(d)));
      var list = (byDay[d] || []).sort(function (a, b) { return b.created - a.created; });
      if (!list.length) sec.append(h("p", { class: "day__none" }, "No incidents reported."));
      list.forEach(function (inc) { sec.append(renderIncident(inc)); });
      box.append(sec);
    });
  }

  function renderIncidentsError() {
    var box = document.getElementById("incidents");
    box.replaceChildren(
      h("p", { class: "note" }, "Incident history could not be loaded just now. ",
        h("a", { href: HISTORY_URL, rel: "noopener" }, "See it on GitHub"), ".")
    );
    box.removeAttribute("aria-busy");
  }

  /* ---------- main ---------- */

  var loading = false;

  function load(force) {
    if (loading) return;
    loading = true;
    if (force) {
      try {
        Object.keys(sessionStorage).forEach(function (k) {
          if (k.indexOf("tp:issues") === 0) sessionStorage.removeItem(k);
        });
      } catch (e) { /* ignore */ }
    }

    var statusP = loadStatus();
    var incP = loadIncidents();

    statusP.then(
      function (data) {
        renderBanner(data.summary);
        renderComponents(data.summary, data.start);
        incP.then(
          function (entries) { renderIncidents(entries, data.summary); },
          renderIncidentsError
        ).then(function () { loading = false; });
      },
      function () {
        renderBanner(null, true);
        document.getElementById("components").replaceChildren(h("p", { class: "note" }, "Component status could not be loaded."));
        document.getElementById("components").removeAttribute("aria-busy");
        incP.then(
          function (entries) { renderIncidents(entries, []); },
          renderIncidentsError
        ).then(function () { loading = false; });
      }
    );
  }

  window.addEventListener("scroll", hideTip, { passive: true });
  load(false);
  setInterval(function () { load(false); }, REFRESH_MS);
})();
