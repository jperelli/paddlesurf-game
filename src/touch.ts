import type { Input } from './input';
import type { SettingsPanel } from './settings';

const PAD: { code: string; cls: string; label: string }[] = [
  { code: 'ArrowUp', cls: 'up', label: '▲' },
  { code: 'ArrowLeft', cls: 'left', label: '◀' },
  { code: 'ArrowRight', cls: 'right', label: '▶' },
  { code: 'ArrowDown', cls: 'down', label: '▼' },
];

/** On-screen controls for touch devices: D-pad, power button, hints/settings, tap-to-continue. */
export class TouchControls {
  private root: HTMLElement;

  constructor(root: HTMLElement, canvas: HTMLCanvasElement, hud: HTMLElement, input: Input, settings: SettingsPanel) {
    this.root = root;
    root.className = 'touch';
    root.innerHTML = `
      <div class="dpad">${PAD.map((b) => `<button class="tbtn ${b.cls}" data-code="${b.code}">${b.label}</button>`).join('')}</div>
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

  get element(): HTMLElement {
    return this.root;
  }
}
