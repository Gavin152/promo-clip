// script.md parser. Format (written by the script stage):
//
//   # Script: <title>
//   ## 01-intro                      <- one heading per scene; the id becomes scenes/01-intro.js
//   > [excited] Introducing Demo Product. Your week, sorted in seconds.   <- spoken lines ("> ")
//   Picture: what we see …           <- anything else is the picture idea
//
// [tags] in spoken lines are TTS style directions: kept for TTS, stripped for QA and timing.

export const stripTags = (s) => s.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
/** spoken text -> words as written (punctuation kept), tags removed */
export const words = (s) => stripTags(s).split(/\s+/).filter(Boolean);

export function parseScript(md) {
  const scenes = [];
  let title = null, cur = null;
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd();
    let m;
    if ((m = /^#\s+(.*)$/.exec(line)) && !title) { title = m[1].replace(/^script:\s*/i, '').trim(); continue; }
    if ((m = /^##\s+(.*)$/.exec(line))) {
      const id = m[1].trim();
      const n = parseInt(id, 10);
      cur = { id, n: Number.isFinite(n) ? n : scenes.length + 1, name: id.replace(/^\d+[-_ ]*/, ''), lines: [], picture: [] };
      scenes.push(cur);
      continue;
    }
    if (!cur) continue;
    if ((m = /^>\s?(.*)$/.exec(line))) { if (m[1].trim()) cur.lines.push(m[1].trim()); continue; }
    if (line.trim()) cur.picture.push(line.trim());
  }
  for (const s of scenes) {
    s.text = s.lines.join(' ');
    s.spoken = stripTags(s.text);
    s.words = words(s.text);
    s.picture = s.picture.join('\n');
  }
  const spoken = scenes.map((s) => s.spoken).filter(Boolean).join(' ');
  return {
    title,
    scenes,
    /** text for the TTS (with tags), one paragraph per scene */
    ttsText: scenes.map((s) => s.text).filter(Boolean).join('\n\n'),
    spoken,
    words: words(spoken),
    /** scene boundaries: the pause between the last word of a scene and the first word of the next */
    boundaries: scenes.slice(1).map((s, i) => ({ scene: s.id, after: scenes[i].words.at(-1), before: s.words[0], afterIndex: scenes.slice(0, i + 1).reduce((n, x) => n + x.words.length, 0) - 1 })).filter((b) => b.after && b.before),
  };
}
