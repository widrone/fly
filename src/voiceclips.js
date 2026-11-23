// Pre-recorded speech: every line Nimbus says can have its own MP3 in docs/voice/<lang>/.
// The file is found by a short hash of the exact words, so editing a line in i18n.js simply
// falls back to the browser's voice until a new clip is made (tools/voice-lines.mjs lists them).
export function speechText(s) {
  return s
    .replace(/\s*[*—–]\s*/g, ', ')
    .replace(/\s*…\s*/g, ', ')
    .replace(/\b[A-ZÆØÅ]{3,}\b/g, (w) => w.toLowerCase())
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/([.!?])[.,]+/g, '$1')
    .replace(/,\s*,/g, ',')
    .replace(/,\s*$/, '.')
    .trim();
}
export function joinSpeech(title, text) {
  return speechText([title, text].filter(Boolean).join('. '));
}
export function clipName(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0') + '.mp3';
}
