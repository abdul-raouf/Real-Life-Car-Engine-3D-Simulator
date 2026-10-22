// Styles load first, so the no-WebGL message is styled too.
import './ui/styles.css';

// Entry point: check the browser can draw 3D before loading the engine room.

function webgl2(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

function fallback() {
  const copy = document.querySelector('.gate-copy');
  const start = document.getElementById('start');
  if (copy) {
    copy.textContent =
      "This browser can't draw the 3D engines (WebGL 2 is switched off or not supported). You can still hear all eight engines and read how they work.";
  }
  if (start) {
    const link = document.createElement('a');
    link.className = 'btn primary big';
    link.href = './making-of.html#listen';
    link.textContent = 'Listen to the engines';
    start.replaceWith(link);
  }
}

if (webgl2()) {
  import('./main.ts').catch((err) => {
    console.error(err);
    fallback();
  });
} else {
  fallback();
}
