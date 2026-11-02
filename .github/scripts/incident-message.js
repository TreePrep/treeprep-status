// Rewrites Upptime's incident issues so they read well on the public status page.
// Used by .github/workflows/incident-message.yml. Pure functions are exported for testing
// (node .github/scripts/incident-message.test.js).
//
// Upptime finds its open issue by the labels "status,<slug>" and decides "degraded" versus
// "down" by looking for the word "degraded" in the title, so labels are never touched and
// the title keeps that word.

const MESSAGE = "We are aware of an issue and are working to resolve it.";

// A "-->" or "--!>" in the original text would end the HTML comment early. Break both up.
const defang = (text) => text.replace(/--(!?)>/g, "--$1&gt;");

// "🛑 Website is down" -> "Website is down"; "⚠️ AI feedback has degraded performance" -> "AI feedback has ...".
function cleanTitle(title) {
  const cleaned = title.replace(/^[\s\p{Extended_Pictographic}\p{Emoji_Modifier}‍️]+/u, "");
  return cleaned || title;
}

// Returns the new body, or null if the body already starts with the message.
function cleanBody(body) {
  const original = (body || "").trim();
  if (original.startsWith(MESSAGE)) return null;
  if (!original) return MESSAGE;
  return `${MESSAGE}\n\n<!-- Original Upptime report:\n${defang(original)}\n-->`;
}

// "**Resolved:** Website is back up in [`abc1234`](https://github.com/...) after 5 minutes."
//   -> "Resolved: Website is back up after 5 minutes."
// The status page reads a leading "Resolved:" as the update label, so the new text starts with it.
// Returns the new comment, or null if it is not an Upptime resolved comment.
function cleanResolvedComment(body) {
  const original = (body || "").trim();
  const match = original.match(
    /^\*\*Resolved:\*\* ([^\n]+?) (is back up|performance has improved) in \[`[^`\n]*`\]\([^)]*\) after ([^\n]+?)\.?$/
  );
  if (!match) return null;
  const [, name, what, time] = match;
  return `Resolved: ${name} ${what} after ${time}.\n\n<!-- Original Upptime comment:\n${defang(original)}\n-->`;
}

// Applies the title and body rewrite to one issue, skipping the call when nothing changes.
async function rewriteIssue({ github, core, owner, repo, issue }) {
  const update = {};
  const title = cleanTitle(issue.title);
  if (title !== issue.title) update.title = title;
  const body = cleanBody(issue.body);
  if (body !== null) update.body = body;
  if (!Object.keys(update).length) return core.info(`#${issue.number}: already clean`);
  await github.rest.issues.update({ owner, repo, issue_number: issue.number, ...update });
  core.info(`#${issue.number}: rewrote ${Object.keys(update).join(" and ")}`);
}

// Applies the resolved-comment rewrite to one comment. Only Upptime's own comment is touched: it is
// posted with the same token that opened the issue, so its author must be the issue's author.
async function rewriteComment({ github, core, owner, repo, issue, comment }) {
  if (comment.user.login !== issue.user.login) return core.info(`Comment ${comment.id}: not by the issue author`);
  const body = cleanResolvedComment(comment.body);
  if (body === null) return core.info(`Comment ${comment.id}: nothing to change`);
  await github.rest.issues.updateComment({ owner, repo, comment_id: comment.id, body });
  core.info(`Comment ${comment.id}: rewrote`);
}

module.exports = { MESSAGE, cleanTitle, cleanBody, cleanResolvedComment, rewriteIssue, rewriteComment };
