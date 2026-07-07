/**
 * Shared skill-name cleanup used by both the AI-based (aiResumeParser.js)
 * and regex-based (resumeParser.js) resume parsers.
 *
 * Resumes often lay out their Skills section one category per line, e.g.:
 *   Languages: Python, JavaScript, Java
 *   Frameworks: React, Node.js, Express
 * A naive comma/line splitter turns the FIRST item on each line into
 * "Languages: Python" / "Frameworks: React" instead of "Python" / "React" —
 * the category label survives as part of the skill string. cleanSkill()
 * strips that label (and any stray bullet marker) so what's left is the
 * actual skill name.
 */
function cleanSkill(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';

  // Strip a leading "Category:" style label — but only if there's real
  // content left after it, so we never wipe a value down to nothing.
  const withoutLabel = s.replace(/^[A-Za-z][A-Za-z&/+ ]{1,28}:\s*(?=\S)/, '').trim();
  if (withoutLabel) s = withoutLabel;

  // Strip a stray leading bullet marker that sometimes survives upstream splitting
  s = s.replace(/^[-*•\u2022\u25AA\u25CF\u25BA\u27A2\u27B3▪▸]\s*/, '').trim();

  return s;
}

module.exports = { cleanSkill };
