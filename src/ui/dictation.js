import { h, mount } from './dom.js';
import { getAllCards, getSettings, saveSettings, putCards } from '../data/store.js';
import { pickSession, pickPractice, isNew, gradeCorrect, markWrong, markRetryCorrect } from '../core/scheduler.js';
import { createSession, currentId, answer, isFinished, stats } from '../core/session.js';
import { speak, speakChinese } from '../platform/speech.js';
import { takePicked, setPicked } from './selection.js';
import { loadRecognizer, createPad } from './pad.js';

const normalize = (s) => s.trim().replace(/\s+/g, ' ').toLowerCase();

// 额外练习里已经练过的词；连续多轮时轮流练，全练过一遍后再从头开始
const practiced = new Set();

export async function render(root, { navigate }) {
  const [cards, settings] = await Promise.all([getAllCards(), getSettings()]);
  const now0 = Date.now();
  const chosen = takePicked(); // 词表页勾选的词；有的话按勾选的听写
  const custom = chosen !== null;
  let picked;
  if (custom) {
    const want = new Set(chosen);
    picked = cards.filter((c) => want.has(c.id));
  } else {
    picked = pickSession(cards, new Date(), settings);
  }
  const practice = !custom && picked.length === 0; // 今天的任务都做完了：额外练习
  if (practice) {
    if (practiced.size >= cards.filter((c) => !isNew(c)).length) practiced.clear();
    picked = pickPractice(cards, settings.sessionSize, practiced);
    picked.forEach((c) => practiced.add(c.id));
  }
  if (picked.length === 0) { navigate('home'); return; }

  // 是否影响复习计划：额外练习都不影响；自选时，没到期的词写对不影响（写错照常记录）
  const affectsSchedule = (c) => !practice && (!custom || isNew(c) || c.dueAt <= now0);
  const label = practice ? '额外练习 · ' : custom ? '自选 · ' : '';

  const byId = new Map(picked.map((c) => [c.id, c]));
  const session = createSession(picked.map((c) => c.id));

  // 输入方式：手写板（模型识别）或输入框（系统手写输入法）；手写板加载失败时自动退回输入框
  let mode = settings.inputMode;
  let recognizer = null;
  let notice = '';
  async function ensureMode() {
    if (mode !== 'pad' || recognizer) return;
    try { recognizer = await loadRecognizer(); }
    catch (e) { console.error(e); mode = 'keyboard'; notice = '手写识别加载失败，先用输入法写'; }
  }
  await ensureMode();

  // pad：手写板；否则：输入框。都提供 value / lock / focus
  function makeAnswerWidget(word) {
    if (mode === 'pad') {
      const pad = createPad(recognizer, word);
      return {
        nodes: [pad.el, h('div', { class: 'row center' },
          h('button', { class: 'secondary small', onclick: () => pad.undo() }, '↩︎ 撤销一笔'),
          h('button', { class: 'secondary small', onclick: () => pad.clearAll() }, '全部擦掉'))],
        value: pad.value, lock: pad.lock, focus() {},
      };
    }
    const input = h('input', {
      class: 'answer', type: 'text', autocapitalize: 'off', autocorrect: 'off', autocomplete: 'off', spellcheck: 'false',
      placeholder: '写出英文单词',
    });
    return { nodes: [input], input, value: () => input.value, lock() { input.disabled = true; }, focus() { input.focus(); } };
  }

  function showQuestion() {
    if (isFinished(session)) return showSummary();
    const card = byId.get(currentId(session));
    const widget = makeAnswerWidget(card.en);
    const feedback = h('div', { class: 'feedback' }, notice);
    notice = '';
    const submit = h('button', { class: 'submit' }, '提交');
    const progressEl = h('div', { class: 'progress' });
    let locked = false;

    // 退出后残留的定时器不应覆盖当前页面
    const next = () => { if (root.contains(progressEl)) showQuestion(); };

    const onSubmit = async () => {
      if (locked) return;
      if (!widget.value().trim()) { feedback.className = 'feedback'; feedback.textContent = '还没写哦'; return; }
      locked = true; widget.lock(); submit.disabled = true;
      const ok = normalize(widget.value()) === normalize(card.en);
      const outcome = answer(session, ok);
      const now = new Date();
      // 提前复习写对的词不改变它的复习计划；写错仍然照常记录
      const updated = outcome === 'correct' ? (affectsSchedule(card) ? gradeCorrect(card, now) : card)
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
    widget.input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') onSubmit(); });

    const switchMode = async () => {
      if (locked) return; // 已提交、等着点“知道了”时不切换
      mode = mode === 'pad' ? 'keyboard' : 'pad';
      await saveSettings({ inputMode: mode });
      await ensureMode();
      showQuestion(); // 同一题，换个方式重新写
    };

    // 输入框模式下键盘会盖住屏幕下半部分：提交按钮放在输入框右边，退出放到顶部，关键内容都留在上半屏
    const { done, total } = stats(session);
    progressEl.textContent = `${label}${Math.min(done + 1, total)} / ${total}`;
    mount(root,
      h('div', { class: 'topbar' },
        h('button', { class: 'secondary small', onclick: () => navigate('home') }, '退出'),
        progressEl,
        h('button', { class: 'secondary small', onclick: switchMode }, mode === 'pad' ? '⌨️ 用输入法' : '✍️ 用手写板')),
      h('div', { class: 'zh' }, card.zh,
        h('button', { class: 'secondary small speaker', 'aria-label': '听中文发音', onclick: () => speakChinese(card.zh) }, '🔊')),
      h('div', { class: 'row center' }, h('button', { class: 'secondary small', onclick: () => speak(card.en) }, '🔊 听发音')),
      ...(mode === 'pad'
        ? [...widget.nodes, h('div', { class: 'row center' }, submit)]
        : [h('div', { class: 'answer-row' }, ...widget.nodes, submit)]),
      feedback,
    );
    widget.focus();
  }

  function showSummary() {
    const s = stats(session);
    const hard = s.struggled.map((id) => byId.get(id));
    mount(root,
      h('h1', {}, practice ? '额外练习完成 🎉' : custom ? '自选听写完成 🎉' : '本轮完成 🎉'),
      h('div', { class: 'card' }, `一次写对 ${s.firstTryCorrect} / ${s.total}`),
      hard.length ? h('div', { class: 'card' }, h('h2', {}, '要多练的词'), ...hard.map((c) => h('div', {}, `${c.en}  ${c.zh}`))) : '',
      h('div', { class: 'row' },
        // 已在 #/dictation，改变 hash 不会重新渲染，直接重新开一轮；自选的重练同一批词
        h('button', {
          onclick: () => { if (custom) setPicked(chosen); render(root, { navigate }); },
        }, custom ? '再练这些词' : '再来一轮'),
        h('button', { class: 'secondary', onclick: () => navigate('home') }, '回首页')),
    );
  }

  showQuestion();
}
