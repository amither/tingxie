import { h, mount } from './dom.js';
import { getAllCards, getSettings, putCards } from '../data/store.js';
import { pickSession, pickPractice, isNew, gradeCorrect, markWrong, markRetryCorrect } from '../core/scheduler.js';
import { createSession, currentId, answer, isFinished, stats } from '../core/session.js';
import { speak, speakChinese } from '../platform/speech.js';

const normalize = (s) => s.trim().replace(/\s+/g, ' ').toLowerCase();

// 额外练习里已经练过的词；连续多轮时轮流练，全练过一遍后再从头开始
const practiced = new Set();

export async function render(root, { navigate }) {
  const [cards, settings] = await Promise.all([getAllCards(), getSettings()]);
  let picked = pickSession(cards, new Date(), settings);
  const practice = picked.length === 0; // 今天的任务都做完了：额外练习
  if (practice) {
    if (practiced.size >= cards.filter((c) => !isNew(c)).length) practiced.clear();
    picked = pickPractice(cards, settings.sessionSize, practiced);
    picked.forEach((c) => practiced.add(c.id));
  }
  if (picked.length === 0) { navigate('home'); return; }

  const byId = new Map(picked.map((c) => [c.id, c]));
  const session = createSession(picked.map((c) => c.id));

  function showQuestion() {
    if (isFinished(session)) return showSummary();
    const card = byId.get(currentId(session));
    const input = h('input', {
      class: 'answer', type: 'text', autocapitalize: 'off', autocorrect: 'off', autocomplete: 'off', spellcheck: 'false',
      placeholder: '写出英文单词',
    });
    const feedback = h('div', { class: 'feedback' });
    const submit = h('button', { class: 'big' }, '提交');
    let locked = false;

    // 退出后残留的定时器不应覆盖当前页面
    const next = () => { if (root.contains(input)) showQuestion(); };

    const onSubmit = async () => {
      if (locked) return;
      locked = true; input.disabled = true; submit.disabled = true;
      const ok = normalize(input.value) === normalize(card.en);
      const outcome = answer(session, ok);
      const now = new Date();
      // 额外练习时，提前复习写对的词不改变它的复习计划；写错仍然照常记录
      const updated = outcome === 'correct' ? (practice ? card : gradeCorrect(card, now))
        : outcome === 'retry-correct' ? markRetryCorrect(card, now)
        : outcome === 'wrong' ? markWrong(card, now) : card;
      byId.set(card.id, updated);
      if (updated !== card) await putCards([updated]);

      if (ok) {
        feedback.className = 'feedback ok'; feedback.textContent = '✓ 正确';
        setTimeout(next, 800);
      } else {
        feedback.className = 'feedback bad'; feedback.textContent = `✗ 正确答案：${card.en}`;
        speak(card.en);
        submit.textContent = '知道了'; submit.disabled = false;
        submit.onclick = next;
      }
    };
    submit.onclick = onSubmit;
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') onSubmit(); });

    const { done, total } = stats(session);
    mount(root,
      h('div', { class: 'progress' }, `${practice ? '额外练习 · ' : ''}${Math.min(done + 1, total)} / ${total}`),
      h('div', { class: 'zh' }, card.zh,
        h('button', { class: 'secondary small speaker', 'aria-label': '听中文发音', onclick: () => speakChinese(card.zh) }, '🔊')),
      h('div', { class: 'row' }, h('button', { class: 'secondary small', onclick: () => speak(card.en) }, '🔊 听发音')),
      input, feedback, submit,
      h('button', { class: 'secondary small', onclick: () => navigate('home') }, '退出'),
    );
    input.focus();
  }

  function showSummary() {
    const s = stats(session);
    const hard = s.struggled.map((id) => byId.get(id));
    mount(root,
      h('h1', {}, practice ? '额外练习完成 🎉' : '本轮完成 🎉'),
      h('div', { class: 'card' }, `一次写对 ${s.firstTryCorrect} / ${s.total}`),
      hard.length ? h('div', { class: 'card' }, h('h2', {}, '要多练的词'), ...hard.map((c) => h('div', {}, `${c.en}  ${c.zh}`))) : '',
      h('div', { class: 'row' },
        // 已在 #/dictation，改变 hash 不会重新渲染，直接重新开一轮
        h('button', { onclick: () => render(root, { navigate }) }, '再来一轮'),
        h('button', { class: 'secondary', onclick: () => navigate('home') }, '回首页')),
    );
  }

  showQuestion();
}
