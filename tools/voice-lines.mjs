// Lists every line Nimbus reads aloud in one language, with the file name the app looks for.
// Usage: node tools/voice-lines.mjs nb  > lines.json
import { LANGS } from '../src/i18n.js';
import { clipName, speechText, joinSpeech } from '../src/voiceclips.js';
const lang = process.argv[2] || 'nb';
const L = LANGS[lang];
const set = new Map();
const add = (s) => { if (!s) return; const t = speechText(s); set.set(clipName(t), t); };
const join = joinSpeech;
for (const v of Object.values(L.steps)) { if (v.title || v.text) add(join(v.title, v.text)); if (v.say) add(v.say); }
for (const v of Object.values(L.cap)) add(join(v[0], v[1]));
add(L.breath && L.breath.sayIn); add(L.breath && L.breath.sayOut);
for (const v of Object.values(L.bumpSay || {})) add(v);
console.log(JSON.stringify([...set].map(([file, text]) => ({ file, text })), null, 1));
