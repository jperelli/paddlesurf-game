import type { Input } from './input';
import type { SettingsPanel } from './settings';

const STICK_R = 72;
const DEAD = 0.18;
/** 8-way sectors from a unit direction, with hysteresis so a wobble on the edge does not re-press. */
const SECTOR_ON = 0.45;
const SECTOR_OFF = 0.3;

/** On-screen controls for touch devices: virtual joystick, power button, hints/settings, tap-to-continue. */
export class TouchControls {
  private root: HTMLElement;

  constructor(root: HTMLElement, canvas: HTMLCanvasElement, hud: HTMLElement, input: Input, settings: SettingsPanel) {
    this.root = root;
    root.className = 'touch';
    root.innerHTML = `
      <div class="stick" id="stick"><div class="stick-ring"><span>▲</span><span>▶</span><span>▼</span><span>◀</span></div><div class="stick-knob"></div></div>
      <button class="tbtn power" data-code="Space">POWER</button>
      <div class="tmenu">
        <button class="tbtn small" data-tap="KeyH">Hints</button>
        <button class="tbtn small" data-settings>Settings</button>
      </div>`;

    for (const btn of root.querySelectorAll<HTMLButtonElement>('button[data-code]')) {
      const code = btn.dataset.code!;
      const down = (e: PointerEvent) => {
        e.preventDefault();
        btn.setPointerCapture(e.pointerId);
        btn.classList.add('held');
        input.press(code);
      };
      const up = () => {
        btn.classList.remove('held');
        input.release(code);
      };
      btn.addEventListener('pointerdown', down);
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('lostpointercapture', up);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    this.bindStick(root.querySelector<HTMLElement>('#stick')!, input);

    root.querySelector<HTMLButtonElement>('button[data-tap]')!.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      input.press('KeyH');
      input.release('KeyH');
    });
    root.querySelector<HTMLButtonElement>('button[data-settings]')!.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      settings.toggle();
    });

    // Tapping the scene or a card (start / wave over) = "press any key".
    const tap = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      input.tap();
    };
    canvas.addEventListener('pointerdown', tap);
    for (const card of hud.querySelectorAll<HTMLElement>('.card')) card.addEventListener('pointerdown', tap);

    const coarse = window.matchMedia('(pointer: coarse)');
    const apply = () => {
      root.classList.toggle('hidden', !coarse.matches);
      document.body.classList.toggle('touch-device', coarse.matches);
    };
    apply();
    coarse.addEventListener('change', apply);
  }

  private bindStick(stick: HTMLElement, input: Input): void {
    const knob = stick.querySelector<HTMLElement>('.stick-knob')!;
    const held = new Set<string>();
    let pointer: number | null = null;

    const setHeld = (code: string, on: boolean) => {
      if (on && !held.has(code)) {
        held.add(code);
        input.press(code);
      } else if (!on && held.has(code)) {
        held.delete(code);
        input.release(code);
      }
    };
    const axis = (v: number, pos: string, neg: string) => {
      setHeld(pos, v > (held.has(pos) ? SECTOR_OFF : SECTOR_ON));
      setHeld(neg, v < -(held.has(neg) ? SECTOR_OFF : SECTOR_ON));
    };
    const move = (e: PointerEvent) => {
      const r = stick.getBoundingClientRect();
      let dx = e.clientX - (r.left + r.width / 2);
      let dy = e.clientY - (r.top + r.height / 2);
      const len = Math.hypot(dx, dy);
      if (len > STICK_R) {
        dx *= STICK_R / len;
        dy *= STICK_R / len;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      if (len < DEAD * STICK_R) {
        for (const c of ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp']) setHeld(c, false);
        return;
      }
      axis(dx / len, 'ArrowRight', 'ArrowLeft');
      axis(dy / len, 'ArrowDown', 'ArrowUp');
    };
    const end = () => {
      pointer = null;
      stick.classList.remove('held');
      knob.style.transform = '';
      for (const c of [...held]) setHeld(c, false);
    };
    stick.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (pointer !== null) return;
      pointer = e.pointerId;
      stick.setPointerCapture(e.pointerId);
      stick.classList.add('held');
      move(e);
    });
    stick.addEventListener('pointermove', (e) => {
      if (e.pointerId === pointer) move(e);
    });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      stick.addEventListener(ev, (e) => {
        if (e.pointerId === pointer) end();
      });
    }
    stick.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get element(): HTMLElement {
    return this.root;
  }
}
