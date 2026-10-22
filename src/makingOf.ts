// The case study page: shares the site's tokens and only needs the copy button.

import './ui/styles.css';
import './ui/making-of.css';

const email = document.getElementById('doc-email')!;
const toastEl = document.getElementById('toast')!;
let timer = 0;

function toast(msg: string) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => (toastEl.hidden = true), 2600);
}

document.getElementById('doc-copy')!.addEventListener('click', () => {
  const selectIt = () => {
    const range = document.createRange();
    range.selectNodeContents(email);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    toast('Email selected. Press Ctrl+C (or ⌘C) to copy.');
  };
  try {
    navigator.clipboard.writeText(email.textContent?.trim() ?? '').then(() => toast('Email copied.'), selectIt);
  } catch {
    selectIt();
  }
});
