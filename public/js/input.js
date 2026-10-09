// Entrées : clavier (QWERTY/AZERTY via codes physiques), manette, tactile.
// Les directions sont exprimées "vue joueur" : x = droite, y = vers le filet.

const KEYS = {
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  drive: ['KeyJ', 'Space', 'Numpad1', 'KeyN'],
  slice: ['KeyK', 'Numpad2', 'KeyM'],
  lob: ['KeyL', 'Numpad3', 'Comma'],
  pause: ['Escape', 'KeyP'],
};
const SHOTS = ['drive', 'slice', 'lob'];

export class Input {
  constructor() {
    this.down = new Set();
    this.pressQueue = [];
    this.pauseQueue = 0;
    this.touch = { x: 0, y: 0, active: false, held: new Set() };
    this.gpPrev = [];
    this.enabled = true;

    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      if (!e.repeat) {
        for (const s of SHOTS) if (KEYS[s].includes(e.code)) this.pressQueue.push(s);
        if (KEYS.pause.includes(e.code)) this.pauseQueue++;
      }
      if (Object.values(KEYS).some(a => a.includes(e.code))) e.preventDefault();
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
  }

  is(action) {
    return KEYS[action].some(k => this.down.has(k));
  }

  // Lecture d'une frame : { mx, my, held, presses: [...], pause }
  poll() {
    let mx = 0, my = 0;
    if (this.is('left')) mx -= 1;
    if (this.is('right')) mx += 1;
    if (this.is('up')) my += 1;
    if (this.is('down')) my -= 1;
    let held = SHOTS.some(s => this.is(s));
    const presses = this.pressQueue.splice(0);
    let pause = this.pauseQueue > 0;
    this.pauseQueue = 0;

    // Manette
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp) continue;
      const prev = this.gpPrev[gp.index] || [];
      const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
      if (Math.hypot(ax, ay) > 0.25) { mx += ax; my -= ay; }
      const b = gp.buttons.map(x => x.pressed);
      if (b[14]) mx -= 1;
      if (b[15]) mx += 1;
      if (b[12]) my += 1;
      if (b[13]) my -= 1;
      const map = [[0, 'drive'], [1, 'slice'], [2, 'lob'], [3, 'lob']];
      for (const [i, s] of map) {
        if (b[i] && !prev[i]) presses.push(s);
        if (b[i]) held = true;
      }
      if (b[9] && !prev[9]) pause = true;
      this.gpPrev[gp.index] = b;
    }

    // Tactile
    if (this.touch.active) { mx += this.touch.x; my += this.touch.y; }
    if (this.touch.held.size) held = true;
    if (this.touch.presses) { presses.push(...this.touch.presses); this.touch.presses = null; }

    const m = Math.hypot(mx, my);
    if (m > 1) { mx /= m; my /= m; }
    return { mx, my, held, presses, pause };
  }

  // Contrôles tactiles : joystick à gauche, 3 boutons à droite
  attachTouch(root) {
    const stick = root.querySelector('.stick');
    const knob = root.querySelector('.knob');
    let id = null, cx = 0, cy = 0;
    const R = 50;
    stick.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      id = t.identifier;
      const r = stick.getBoundingClientRect();
      cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      this.touch.active = true;
      move(t);
      e.preventDefault();
    }, { passive: false });
    const move = (t) => {
      let dx = t.clientX - cx, dy = t.clientY - cy;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx = dx / d * R; dy = dy / d * R; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.touch.x = dx / R;
      this.touch.y = -dy / R;
    };
    stick.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) if (t.identifier === id) move(t);
      e.preventDefault();
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === id) {
          id = null;
          this.touch.active = false;
          this.touch.x = this.touch.y = 0;
          knob.style.transform = '';
        }
      }
    };
    stick.addEventListener('touchend', end);
    stick.addEventListener('touchcancel', end);
    for (const btn of root.querySelectorAll('[data-shot]')) {
      const s = btn.dataset.shot;
      btn.addEventListener('touchstart', (e) => {
        (this.touch.presses ||= []).push(s);
        this.touch.held.add(s);
        btn.classList.add('on');
        e.preventDefault();
      }, { passive: false });
      const up = (e) => { this.touch.held.delete(s); btn.classList.remove('on'); e.preventDefault(); };
      btn.addEventListener('touchend', up);
      btn.addEventListener('touchcancel', up);
    }
  }
}
