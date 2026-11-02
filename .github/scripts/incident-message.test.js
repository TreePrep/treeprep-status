// Run with: node .github/scripts/incident-message.test.js
const assert = require("node:assert/strict");
const { MESSAGE, cleanTitle, cleanBody, cleanResolvedComment, rewriteComment } = require("./incident-message.js");

// Titles exactly as Upptime writes them.
assert.equal(cleanTitle("🛑 Website is down"), "Website is down");
assert.equal(cleanTitle("🛑 AI feedback is down"), "AI feedback is down");
assert.equal(cleanTitle("⚠️ AI feedback has degraded performance"), "AI feedback has degraded performance");
assert.equal(cleanTitle("  ⚠️  API has degraded performance"), "API has degraded performance");
assert.equal(cleanTitle("Website is down"), "Website is down"); // idempotent
assert.equal(cleanTitle("🛑"), "🛑"); // never produce an empty title
assert.equal(cleanTitle("2FA is down"), "2FA is down"); // digits are not stripped
assert.ok(cleanTitle("⚠️ X has degraded performance").includes("degraded")); // Upptime checks this word

// Body as Upptime writes it (the commit link really does contain a newline).
const upptime =
  "In [`0b78c34`](https://github.com/TreePrep/treeprep-status/commit/0b78c34203\n), Website (https://$TREEPREP_HOST/) was **down**:\n- HTTP code: 0\n- Response time: 0 ms\n";
const once = cleanBody(upptime);
assert.ok(once.startsWith(`${MESSAGE}\n\n<!-- Original Upptime report:\n`));
assert.ok(once.endsWith("\n-->"));
assert.ok(once.includes("HTTP code: 0"));
assert.equal(once.split("-->").length, 2); // exactly one comment terminator
assert.equal(cleanBody(once), null); // idempotent
assert.equal(cleanBody(`${MESSAGE}`), null);
assert.equal(cleanBody(""), MESSAGE);
assert.equal(cleanBody(null), MESSAGE);

// Content must not break out of the comment.
for (const evil of ["x --> <script>alert(1)</script>", "x --!> y", "x -->-->", "--><b>hi</b>", "<!-- nested -->"]) {
  const out = cleanBody(evil);
  const inside = out.slice(out.indexOf("<!--") + 4, out.lastIndexOf("-->"));
  assert.ok(!/--!?>/.test(inside), `comment can be closed early: ${evil}`);
}

// Resolved comments.
const up =
  "**Resolved:** Website is back up in [`7a1b2c3`](https://github.com/TreePrep/treeprep-status/commit/7a1b2c3d4e\n) after 5 minutes.";
const done = cleanResolvedComment(up);
assert.ok(done.startsWith("Resolved: Website is back up after 5 minutes.\n\n<!--"));
assert.ok(!done.split("<!--")[0].includes("7a1b2c3"));
assert.ok(done.includes(up)); // original preserved in the comment
assert.equal(cleanResolvedComment(done), null); // idempotent
assert.match(
  cleanResolvedComment("**Resolved:** AI feedback performance has improved in [`abc`](https://x/y) after 1 hour, 2 minutes."),
  /^Resolved: AI feedback performance has improved after 1 hour, 2 minutes\.\n/
);
assert.equal(cleanResolvedComment("Thanks for fixing this"), null);
assert.equal(cleanResolvedComment("**Resolved:** something unexpected"), null);
assert.equal(cleanResolvedComment(null), null);
const evilName = cleanResolvedComment("**Resolved:** A --> B is back up in [`abc`](https://x) after 1 minute.");
assert.ok(!/--!?>/.test(evilName.slice(evilName.indexOf("<!--") + 4, evilName.lastIndexOf("-->"))));

// Only the issue author's comment is rewritten.
(async () => {
  const calls = [];
  const github = { rest: { issues: { updateComment: async (a) => calls.push(a) } } };
  const core = { info() {} };
  const issue = { user: { login: "upptime-user" } };
  const args = { github, core, owner: "o", repo: "r", issue };
  await rewriteComment({ ...args, comment: { id: 1, user: { login: "someone-else" }, body: up } });
  assert.equal(calls.length, 0);
  await rewriteComment({ ...args, comment: { id: 2, user: { login: "upptime-user" }, body: up } });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].body.startsWith("Resolved: Website is back up after 5 minutes."));
  await rewriteComment({ ...args, comment: { id: 3, user: { login: "upptime-user" }, body: calls[0].body } });
  assert.equal(calls.length, 1); // idempotent
  console.log("all tests passed");
})();
