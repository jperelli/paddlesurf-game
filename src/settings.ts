import type { Game } from './game';
import { KEY_LABELS, SURFER_KEYS, WATER_KEYS, type PaletteKey, type SurferPalette, type WaterPalette } from './palette';
import { resetRoster, saveRoster, type Roster } from './roster';

/** Settings drawer: pick surfer and spot, rename them, tweak their colours. */
export class SettingsPanel {
  private root: HTMLElement;
  private open = false;

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
          <label>Rights only (share) <input id="st-right" type="number" step="0.05" min="0" max="1" /></label>
          <label>Lefts only (share) <input id="st-left" type="number" step="0.05" min="0" max="1" /></label>
          <label>Waves per set (min) <input id="st-setmin" type="number" step="1" min="1" max="12" /></label>
          <label>Waves per set (max) <input id="st-setmax" type="number" step="1" min="1" max="12" /></label>
        </div>
      </section>
      <section>
        <h3>Colours</h3>
        <p class="small">Defaults come from the reference photo. Tweak a swatch to give a friend their own board.</p>
        <div class="swatches" id="st-swatches"></div>
      </section>
      <section class="row">
        <button id="st-save">Save</button>
        <button id="st-reset" class="danger">Reset to defaults</button>
        <span id="st-msg" class="small"></span>
      </section>
    `;
    this.bind();
    this.render();
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') this.toggle();
    });
  }

  private q<T extends HTMLElement>(sel: string): T {
    return this.root.querySelector<T>(sel)!;
  }

  /** Re-read the roster (e.g. after the start-card level picker changed the spot). */
  refresh(): void {
    this.render();
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
    type NumKey = 'minHeight' | 'maxHeight' | 'peelSpeed' | 'sectionChance' | 'rightOnly' | 'leftOnly' | 'setMin' | 'setMax';
    const num = (id: string, key: NumKey) => {
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
    num('#st-right', 'rightOnly');
    num('#st-left', 'leftOnly');
    num('#st-setmin', 'setMin');
    num('#st-setmax', 'setMax');

    this.q('#st-save').onclick = () => {
      saveRoster(this.roster);
      this.q('#st-msg').textContent = 'Saved in this browser.';
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
    this.q<HTMLInputElement>('#st-right').value = String(this.spot.rightOnly);
    this.q<HTMLInputElement>('#st-left').value = String(this.spot.leftOnly);
    this.q<HTMLInputElement>('#st-setmin').value = String(this.spot.setMin);
    this.q<HTMLInputElement>('#st-setmax').value = String(this.spot.setMax);
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
