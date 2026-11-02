/*
 * Development fixtures. Only loaded on localhost with ?mock=<scenario> (ok | outage | degraded | 1 = outage),
 * and left out of the deployed site by .github/workflows/pages.yml. Dates are relative to now.
 */
window.__STATUS_MOCK__ = function (scenario) {
  var MIN = 60000;
  var DAY = 86400000;
  var now = Date.now();
  function ago(min) {
    return new Date(now - min * MIN).toISOString();
  }
  function day(n) {
    return new Date(now - n * DAY).toISOString().slice(0, 10);
  }
  function comp(name, slug, status, down) {
    var d = {};
    Object.keys(down || {}).forEach(function (k) { d[day(+k)] = down[k]; });
    return { name: name, url: "https://$TREEPREP_HOST/", icon: "", slug: slug, status: status, uptime: "99.95%", dailyMinutesDown: d };
  }
  var start = now - 70 * DAY;

  var ok = [
    comp("Website", "website", "up", { 31: 4, 12: 22 }),
    comp("API", "api", "up", { 12: 22 }),
    comp("Code runner", "code-runner", "up", { 40: 130 }),
    comp("AI feedback", "ai-feedback", "up", {}),
  ];
  var outage = [
    comp("Website", "website", "up", { 31: 4 }),
    comp("API", "api", "down", { 0: 47, 12: 22, 2: 190 }),
    comp("Code runner", "code-runner", "down", { 0: 47, 40: 130 }),
    comp("AI feedback", "ai-feedback", "degraded", { 0: 12 }),
  ];
  var degraded = [
    comp("Website", "website", "up", {}),
    comp("API", "api", "up", {}),
    comp("Code runner", "code-runner", "up", {}),
    comp("AI feedback", "ai-feedback", "degraded", { 0: 12 }),
  ];

  var upptimeBody = "In [`a33dd6e`](https://github.com/TreePrep/treeprep-status/commit/a33dd6e) API (https://$TREEPREP_HOST/api/health) was **down**:\n- HTTP code: 0\n- Response time: 0 ms\n";
  var rewrittenBody = "We are aware of an issue and are working to resolve it.\n<!--\nIn [`a33dd6e`](https://github.com/x/y) API was **down**: HTTP code 0\n-->";

  function issue(n, title, slug, createdMin, closedMin, body, commentCount) {
    return {
      number: n,
      title: title,
      state: closedMin == null ? "open" : "closed",
      created_at: ago(createdMin),
      closed_at: closedMin == null ? null : ago(closedMin),
      updated_at: ago(0),
      comments: commentCount,
      body: body,
      user: { login: "bot-owner" },
      labels: [{ name: "status" }, { name: slug }],
    };
  }
  function comment(minAgo, body, assoc, login) {
    return { created_at: ago(minAgo), body: body, author_association: assoc || "OWNER", user: { login: login || "bot-owner" } };
  }

  var incidents = {
    ok: [
      {
        issue: issue(9, "\u{1F6D1} Website is down", "website", 12 * DAY / MIN + 90, 12 * DAY / MIN + 68, upptimeBody, 1),
        comments: [comment(12 * DAY / MIN + 68, "**Resolved:** Website is back up in [`b81c2aa`](https://github.com/TreePrep/treeprep-status/commit/b81c2aa) after 22 minutes.")],
      },
      {
        issue: issue(4, "\u{1F6D1} Code runner is down", "code-runner", 40 * DAY / MIN + 200, 40 * DAY / MIN + 70, rewrittenBody, 2),
        comments: [
          comment(40 * DAY / MIN + 150, "Identified: the sandbox host ran out of disk space. We are clearing it."),
          comment(40 * DAY / MIN + 70, "Resolved: Code runner is back up after 2 hours 10 minutes."),
        ],
      },
    ],
    outage: [
      {
        issue: issue(15, "\u{1F6D1} API is down", "api", 47, null, rewrittenBody, 3),
        comments: [
          comment(35, "Identified: a bad release is failing health checks. We are rolling it back."),
          comment(5, "Monitoring: the rollback has finished and the API is answering again. We are watching it.\n\nRuns started during this window may need to be retried."),
          comment(30, "Totally legit update, click [here](javascript:alert(1)) <img src=x onerror=alert(1)> or [docs](https://example.com/help).", "NONE", "drive-by"),
        ],
      },
      {
        issue: issue(16, "\u{1F6D1} Code runner is down", "code-runner", 47, null, upptimeBody, 0),
        comments: [],
      },
      {
        issue: issue(17, "⚠️ AI feedback has degraded performance", "ai-feedback", 12, null, upptimeBody, 0),
        comments: [],
      },
      {
        issue: issue(11, "\u{1F6D1} API is down", "api", 2 * DAY / MIN + 240, 2 * DAY / MIN + 50, rewrittenBody, 3),
        comments: [
          comment(2 * DAY / MIN + 200, "Investigating: error rates are elevated for all signed-in requests."),
          comment(2 * DAY / MIN + 120, "**Identified:** the database connection pool was exhausted by a runaway job. <b>Raw</b> HTML here is escaped."),
          comment(2 * DAY / MIN + 50, "**Resolved:** API is back up in [`c91d0f3`](https://github.com/TreePrep/treeprep-status/commit/c91d0f3) after 3 hours 10 minutes."),
        ],
      },
      {
        issue: issue(9, "\u{1F6D1} Website is down", "website", 12 * DAY / MIN + 90, 12 * DAY / MIN + 68, upptimeBody, 1),
        comments: [comment(12 * DAY / MIN + 68, "**Resolved:** Website is back up in [`b81c2aa`](https://github.com/TreePrep/treeprep-status/commit/b81c2aa) after 22 minutes.")],
      },
      {
        issue: issue(4, "\u{1F6D1} Code runner is down", "code-runner", 40 * DAY / MIN + 200, 40 * DAY / MIN + 70, rewrittenBody, 0),
        comments: [],
      },
    ],
    degraded: [
      {
        issue: issue(17, "⚠️ AI feedback has degraded performance", "ai-feedback", 12, null, upptimeBody, 0),
        comments: [],
      },
    ],
  };

  var key = scenario === "ok" || scenario === "degraded" ? scenario : "outage";
  var summary = { ok: ok, outage: outage, degraded: degraded }[key];
  return { summary: summary, start: start, incidents: incidents[key] };
};
