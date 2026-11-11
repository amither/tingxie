const norm = (lang) => lang.replace('_', '-');

// 在系统语音里挑一个：优先精确匹配 preferred（如 en-US、zh-CN），否则取同语种的第一个
function pickVoice(prefix, preferred) {
  const voices = speechSynthesis.getVoices().filter((v) => norm(v.lang).toLowerCase().startsWith(prefix));
  return voices.find((v) => norm(v.lang) === preferred) ?? voices[0] ?? null;
}

const englishVoice = () => pickVoice('en', 'en-US');
const chineseVoice = () => pickVoice('zh', 'zh-CN');

export const hasEnglishVoice = () => 'speechSynthesis' in window && englishVoice() !== null;
export const hasChineseVoice = () => 'speechSynthesis' in window && chineseVoice() !== null;

function say(text, voice, fallbackLang) {
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  if (voice) u.voice = voice;
  u.lang = voice ? voice.lang : fallbackLang;
  u.rate = 0.8;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

export const speak = (text) => say(text, 'speechSynthesis' in window ? englishVoice() : null, 'en-US');
export const speakChinese = (text) => say(text, 'speechSynthesis' in window ? chineseVoice() : null, 'zh-CN');
