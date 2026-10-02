import type { Game } from './game';
import {
  KEY_LABELS,
  SURFER_KEYS,
  WATER_KEYS,
  autoWaterPalette,
  samplePatch,
  type PaletteKey,
  type SurferPalette,
  type WaterPalette,
} from './palette';
import { resetRoster, saveRoster, type Roster } from './roster';

/** Settings drawer: pick surfer and spot, rename them, and sample their colours from a photo. */
export class SettingsPanel {
  private root: HTMLElement;
  private open = false;
  private ctx: CanvasRenderingContext2D | null = null;
  private target: PaletteKey = 'face';
  private canvas: HTMLCanvasElement;

  private roster: Roster;
  private game: Game;

  constructor(root: HTMLElement, roster: Roster, game: Game) {
    this.root = root;
    this.roster = roster;
    this.game = game;
    root.className = 'settings hidden';
    root.innerHTML = `
      <div class="settings-head"><h2>Surfers & spots</h2><button id="st-close">✕</button></div>
      <section>
        <label>Surfer <select id="st-surfer"></select></label>
        <input id="st-surfer-name" placeholder="Surfer name" />
        <button id="st-surfer-add">Add surfer</button>
      </section>
      <section>
        <label>Spot <select id="st-spot"></select></label>
        <input id="st-spot-name" placeholder="Spot name" />
        <button id="st-spot-add">Add spot</button>
        <div class="grid">
          <label>Min height (m) <input id="st-minh" type="number" step="0.1" min="0.5" max="4" /></label>
          <label>Max height (m) <input id="st-maxh" type="number" step="0.1" min="0.5" max="4" /></label>
          <label>Peel speed (m/s) <input id="st-peel" type="number" step="0.1" min="1" max="8" /></label>
          <label>Closeout chance <input id="st-section" type="number" step="0.05" min="0" max="1" /></label>
        </div>
      </section>
      <section>
        <h3>Colours from a photo</h3>
        <p class="small">Load a photo, pick what you want to colour, then click on the photo.</p>
        <input id="st-photo" type="file" accept="image/*" />
        <div class="targets" id="st-targets"></div>
        <canvas id="st-canvas" width="360" height="240"></canvas>
        <div class="row"><button id="st-auto">Auto water from photo</button><span id="st-picked" class="small"></span></div>
        <div class="swatches" id="st-swatches"></div>
      </section>
      <section class="row">
        <button id="st-save">Save</button>
        <button id="st-reset" class="danger">Reset to defaults</button>
      </section>
    `;
    this.canvas = this.q<HTMLCanvasElement>('#st-canvas');
    this.bind();
    this.render();
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') this.toggle();
    });
  }

  private q<T extends HTMLElement>(sel: string): T {
    return this.root.querySelector<T>(sel)!;
  }

  toggle(force?: boolean): void {
    this.open = force ?? !this.open;
    this.root.classList.toggle('hidden', !this.open);
  }

  private get surfer() {
    return this.roster.surfers[this.roster.surferIndex];
  }
  private get spot() {
    return this.roster.spots[this.roster.spotIndex];
  }

  private bind(): void {
    this.q('#st-close').onclick = () => this.toggle(false);
    this.q<HTMLSelectElement>('#st-surfer').onchange = (e) => {
      this.roster.surferIndex = Number((e.target as HTMLSelectElement).value);
      this.apply();
      this.render();
    };
    this.q<HTMLSelectElement>('#st-spot').onchange = (e) => {
      this.roster.spotIndex = Number((e.target as HTMLSelectElement).value);
      this.apply();
      this.render();
    };
    this.q<HTMLInputElement>('#st-surfer-name').oninput = (e) => {
      this.surfer.name = (e.target as HTMLInputElement).value;
      this.renderSelects();
    };
    this.q<HTMLInputElement>('#st-spot-name').oninput = (e) => {
      this.spot.name = (e.target as HTMLInputElement).value;
      this.renderSelects();
    };
    this.q('#st-surfer-add').onclick = () => {
      this.roster.surfers.push({ name: `Surfer ${this.roster.surfers.length + 1}`, palette: { ...this.surfer.palette } });
      this.roster.surferIndex = this.roster.surfers.length - 1;
      this.apply();
      this.render();
    };
    this.q('#st-spot-add').onclick = () => {
      this.roster.spots.push({ ...this.spot, name: `Spot ${this.roster.spots.length + 1}`, water: { ...this.spot.water } });
      this.roster.spotIndex = this.roster.spots.length - 1;
      this.apply();
      this.render();
    };
    const num = (id: string, key: 'minHeight' | 'maxHeight' | 'peelSpeed' | 'sectionChance') => {
      this.q<HTMLInputElement>(id).onchange = (e) => {
        const v = Number((e.target as HTMLInputElement).value);
        if (Number.isFinite(v)) this.spot[key] = v;
        this.apply();
      };
    };
    num('#st-minh', 'minHeight');
    num('#st-maxh', 'maxHeight');
    num('#st-peel', 'peelSpeed');
    num('#st-section', 'sectionChance');

    this.q<HTMLInputElement>('#st-photo').onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(360 / img.width, 240 / img.height);
        this.canvas.width = Math.round(img.width * scale);
        this.canvas.height = Math.round(img.height * scale);
        const ctx = this.canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, this.canvas.width, this.canvas.height);
        this.ctx = ctx;
        URL.revokeObjectURL(img.src);
      };
      img.src = URL.createObjectURL(file);
    };
    this.canvas.onclick = (e) => {
      if (!this.ctx) return;
      const r = this.canvas.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * this.canvas.width;
      const y = ((e.clientY - r.top) / r.height) * this.canvas.height;
      const hex = samplePatch(this.ctx, x, y, 5);
      this.setColour(this.target, hex);
      this.q('#st-picked').textContent = `${KEY_LABELS[this.target]} = ${hex}`;
    };
    this.q('#st-auto').onclick = () => {
      if (!this.ctx) return;
      Object.assign(this.spot.water, autoWaterPalette(this.ctx));
      this.apply();
      this.renderSwatches();
    };
    this.q('#st-save').onclick = () => {
      saveRoster(this.roster);
      this.q('#st-picked').textContent = 'Saved in this browser.';
    };
    this.q('#st-reset').onclick = () => {
      const fresh = resetRoster();
      this.roster.surfers = fresh.surfers;
      this.roster.spots = fresh.spots;
      this.roster.surferIndex = 0;
      this.roster.spotIndex = 0;
      this.apply();
      this.render();
    };
  }

  private setColour(key: PaletteKey, hex: string): void {
    if ((WATER_KEYS as string[]).includes(key)) this.spot.water[key as keyof WaterPalette] = hex;
    else this.surfer.palette[key as keyof SurferPalette] = hex;
    this.apply();
    this.renderSwatches();
  }

  private apply(): void {
    this.game.applySpot(this.spot);
    this.game.applySurfer(this.surfer);
  }

  private render(): void {
    this.renderSelects();
    this.q<HTMLInputElement>('#st-surfer-name').value = this.surfer.name;
    this.q<HTMLInputElement>('#st-spot-name').value = this.spot.name;
    this.q<HTMLInputElement>('#st-minh').value = String(this.spot.minHeight);
    this.q<HTMLInputElement>('#st-maxh').value = String(this.spot.maxHeight);
    this.q<HTMLInputElement>('#st-peel').value = String(this.spot.peelSpeed);
    this.q<HTMLInputElement>('#st-section').value = String(this.spot.sectionChance);
    const targets = this.q('#st-targets');
    targets.innerHTML = '';
    for (const key of [...WATER_KEYS, ...SURFER_KEYS]) {
      const b = document.createElement('button');
      b.textContent = KEY_LABELS[key];
      b.classList.toggle('on', key === this.target);
      b.onclick = () => {
        this.target = key;
        this.render();
      };
      targets.appendChild(b);
    }
    this.renderSwatches();
  }

  private renderSelects(): void {
    const fill = (sel: HTMLSelectElement, names: string[], idx: number) => {
      sel.innerHTML = names.map((n, i) => `<option value="${i}" ${i === idx ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('');
    };
    fill(this.q<HTMLSelectElement>('#st-surfer'), this.roster.surfers.map((s) => s.name), this.roster.surferIndex);
    fill(this.q<HTMLSelectElement>('#st-spot'), this.roster.spots.map((s) => s.name), this.roster.spotIndex);
  }

  private renderSwatches(): void {
    const el = this.q('#st-swatches');
    el.innerHTML = '';
    const add = (key: PaletteKey, hex: string) => {
      const s = document.createElement('label');
      s.className = 'swatch';
      s.innerHTML = `<input type="color" value="${hex}" /><span>${KEY_LABELS[key]}</span>`;
      s.querySelector('input')!.oninput = (e) => this.setColour(key, (e.target as HTMLInputElement).value);
      el.appendChild(s);
    };
    for (const k of WATER_KEYS) add(k, this.spot.water[k]);
    for (const k of SURFER_KEYS) add(k, this.surfer.palette[k]);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
