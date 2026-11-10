const norm = (lang) => lang.replace('_', '-');

function englishVoice() {
  const voices = speechSynthesis.getVoices().filter((v) => norm(v.lang).startsWith('en'));
  return voices.find((v) => norm(v.lang) === 'en-US') ?? voices[0] ?? null;
}

export const hasEnglishVoice = () => 'speechSynthesis' in window && englishVoice() !== null;

export function speak(text) {
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  const voice = englishVoice();
  if (voice) u.voice = voice;
  u.lang = voice ? voice.lang : 'en-US';
  u.rate = 0.8;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}
