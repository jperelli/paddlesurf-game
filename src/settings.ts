import type { Game } from './game';
import { isSaved, saveQuality } from './quality';
import { BOARDS, BODIES, FACES, PADDLES, photoToDataUrl } from './looks';
import { KEY_LABELS, SURFER_KEYS, WATER_KEYS, type PaletteKey, type SurferPalette, type WaterPalette } from './palette';
import { resetRoster, saveRoster, type Roster } from './roster';
import { t } from './i18n';

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
      <div class="settings-head"><h2>${t('Surfers & spots')}</h2><button id="st-close">✕</button></div>
      <section>
        <label>${t('Surfer')} <select id="st-surfer"></select></label>
        <input id="st-surfer-name" placeholder="${t('Surfer name')}" />
        <button id="st-surfer-add">${t('Add surfer')}</button>
        <div class="label">${t('Face')}</div>
        <div id="st-face" class="picks"></div>
        <div class="row photo-row">
          <label class="file">${t('Use a photo of your face')} <input id="st-face-photo" type="file" accept="image/*" /></label>
          <button id="st-face-clear">${t('Drawn face')}</button>
          <span id="st-face-note" class="small"></span>
        </div>
        <div class="label">${t('Body')}</div>
        <div id="st-body" class="picks"></div>
        <div class="label">${t('Board')}</div>
        <div id="st-board" class="picks"></div>
        <div class="label">${t('Paddle')}</div>
        <div id="st-paddle" class="picks"></div>
      </section>
      <section>
        <label>${t('Spot')} <select id="st-spot"></select></label>
        <input id="st-spot-name" placeholder="${t('Spot name')}" />
        <button id="st-spot-add">${t('Add spot')}</button>
        <div class="grid">
          <label>${t('Min height (m)')} <input id="st-minh" type="number" step="0.1" min="0.5" max="4" /></label>
          <label>${t('Max height (m)')} <input id="st-maxh" type="number" step="0.1" min="0.5" max="4" /></label>
          <label>${t('Peel speed (m/s)')} <input id="st-peel" type="number" step="0.1" min="1" max="8" /></label>
          <label>${t('Closeout chance')} <input id="st-section" type="number" step="0.05" min="0" max="1" /></label>
          <label>${t('Rights only (share)')} <input id="st-right" type="number" step="0.05" min="0" max="1" /></label>
          <label>${t('Lefts only (share)')} <input id="st-left" type="number" step="0.05" min="0" max="1" /></label>
          <label>${t('Waves per set (min)')} <input id="st-setmin" type="number" step="1" min="1" max="12" /></label>
          <label>${t('Waves per set (max)')} <input id="st-setmax" type="number" step="1" min="1" max="12" /></label>
        </div>
      </section>
      <section>
        <h3>${t('Gameplay')}</h3>
        <label><input id="st-hints" type="checkbox" /> ${t('Show the subtle peak and pocket hints (red = peak, green = pockets; H toggles them)')}</label>
      </section>
      <section>
        <h3>${t('Graphics')}</h3>
        <label>${t('Quality')} <select id="st-quality"><option value="high">${t('High: full water detail, all the spray')}</option><option value="low">${t('Low: smoother on phones')}</option></select></label>
        <p class="small" id="st-quality-note"></p>
      </section>
      <section>
        <h3>${t('Colours')}</h3>
        <p class="small">${t('Defaults come from the reference photo. Tweak a swatch to give a friend their own board.')}</p>
        <div class="swatches" id="st-swatches"></div>
      </section>
      <section class="row">
        <button id="st-save">${t('Save')}</button>
        <button id="st-start">${t('Back to the start screen')}</button>
        <button id="st-reset" class="danger">${t('Reset to defaults')}</button>
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
    if (this.open) this.q<HTMLInputElement>('#st-hints').checked = this.game.hint;
  }

  private get surfer() {
    return this.roster.surfers[this.roster.surferIndex];
  }
  private get spot() {
    return this.roster.spots[this.roster.spotIndex];
  }

  private bind(): void {
    this.q('#st-close').onclick = () => this.toggle(false);
    const hints = this.q<HTMLInputElement>('#st-hints');
    hints.onchange = () => this.game.setHint(hints.checked);
    const qsel = this.q<HTMLSelectElement>('#st-quality');
    qsel.value = this.game.quality;
    this.q('#st-quality-note').textContent = isSaved()
      ? t('Using {q} quality.', { q: t(this.game.quality) })
      : t('Picked {q} for this device. Changing it reloads the page (your spot, conditions and session code are kept in the link).', { q: t(this.game.quality) });
    qsel.onchange = () => {
      const v = qsel.value === 'low' ? 'low' : 'high';
      saveQuality(v);
      const u = new URL(location.href);
      u.searchParams.delete('q');
      location.href = u.toString();
    };
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
      this.roster.surfers.push({ name: t('Surfer {n}', { n: this.roster.surfers.length + 1 }), palette: { ...this.surfer.palette }, look: { ...this.surfer.look } });
      this.roster.surferIndex = this.roster.surfers.length - 1;
      this.apply();
      this.render();
    };
    this.q('#st-spot-add').onclick = () => {
      this.roster.spots.push({ ...this.spot, name: t('Spot {n}', { n: this.roster.spots.length + 1 }), water: { ...this.spot.water } });
      this.roster.spotIndex = this.roster.spots.length - 1;
      this.apply();
      this.render();
    };
    this.q<HTMLInputElement>('#st-face-photo').onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        this.surfer.look.facePhoto = photoToDataUrl(img);
        this.apply();
        this.renderPicks();
        this.q('#st-face-note').textContent = t('Photo on the face. Press Save to keep it.');
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        this.q('#st-face-note').textContent = t('Could not read that image.');
      };
      img.src = url;
    };
    this.q('#st-face-clear').onclick = () => {
      this.surfer.look.facePhoto = null;
      this.apply();
      this.renderPicks();
      this.q('#st-face-note').textContent = '';
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
      this.q('#st-msg').textContent = t('Saved in this browser.');
    };
    this.q('#st-start').onclick = () => {
      this.game.toStart();
      this.toggle(false);
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
    this.renderPicks();
    this.renderSwatches();
  }

  private renderPicks(): void {
    type LookKey = 'face' | 'body' | 'board' | 'paddle';
    const row = (id: string, key: LookKey, list: { name: string; desc: string }[]) => {
      const el = this.q(id);
      el.innerHTML = '';
      list.forEach((o, i) => {
        const b = document.createElement('button');
        b.className = `pick${this.surfer.look[key] === i ? ' on' : ''}`;
        b.innerHTML = '<b></b><span></span>';
        b.querySelector('b')!.textContent = t(o.name);
        b.querySelector('span')!.textContent = t(o.desc);
        b.onclick = () => {
          this.surfer.look[key] = i;
          this.apply();
          this.renderPicks();
        };
        el.appendChild(b);
      });
    };
    row('#st-face', 'face', FACES);
    row('#st-body', 'body', BODIES);
    row('#st-board', 'board', BOARDS);
    row('#st-paddle', 'paddle', PADDLES);
    const hasPhoto = !!this.surfer.look.facePhoto;
    this.q('#st-face').classList.toggle('dim', hasPhoto);
    this.q<HTMLButtonElement>('#st-face-clear').disabled = !hasPhoto;
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
      s.innerHTML = `<input type="color" value="${hex}" /><span>${t(KEY_LABELS[key])}</span>`;
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
