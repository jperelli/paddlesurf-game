import type { Game } from './game';
import type { Hud } from './hud';
import { BOARDS, PADDLES, type BoardSpec, type PaddleSpec } from './looks';
import type { SurferPalette } from './palette';
import { describeSpot, type Roster } from './roster';
import { loadPlayerName, savePlayerName } from './scores';
import { paintDeck } from './surfer';

const TILE = 96;

/**
 * Fullscreen start screen in two steps. Step 1 shows the surfer idling on the board (the game
 * renders behind the overlay) with face, board and paddle tiles and a name field. Step 2 picks the
 * spot from photo tiles, plus conditions and the session code, and paddles out.
 */
export class StartScreen {
  private root: HTMLElement;
  private roster: Roster;
  private game: Game;
  private hud: Hud;
  private onChange: () => void;
  private step: 1 | 2 = 1;
  private facesEl: HTMLElement;
  private boardsEl: HTMLElement;
  private paddlesEl: HTMLElement;
  private spotsEl: HTMLElement;
  private condsEl: HTMLElement;
  private nameEl: HTMLInputElement;
  private seedEl: HTMLInputElement;
  private seedNote: HTMLElement;
  private onSpot: (i: number) => void = () => undefined;
  private visible = true;

  constructor(root: HTMLElement, roster: Roster, game: Game, hud: Hud, onChange: () => void) {
    this.root = root;
    this.roster = roster;
    this.game = game;
    this.hud = hud;
    this.onChange = onChange;
    root.className = 'start-screen';
    root.innerHTML = `
      <div class="ss-step ss-surfer">
        <div class="ss-top">
          <h1>Paddle Surf</h1>
          <div class="ss-group"><div class="label">Who is paddling?</div><div id="ss-faces" class="tiles faces"></div></div>
        </div>
        <div class="ss-side">
          <div class="ss-group"><div class="label">Board</div><div id="ss-boards" class="tiles"></div></div>
          <div class="ss-group"><div class="label">Paddle</div><div id="ss-paddles" class="tiles"></div></div>
        </div>
        <div class="ss-bottom">
          <label class="ss-name">Name for the high scores <input id="ss-name" maxlength="24" autocomplete="off" spellcheck="false"></label>
          <button id="ss-next" class="primary">Next: pick the spot</button>
          <button id="ss-scores" class="mini">High scores</button>
        </div>
      </div>
      <div class="ss-step ss-spot hidden">
        <div class="ss-top row ss-head">
          <button id="ss-back" class="mini">Back</button>
          <h2>Where are we surfing?</h2>
        </div>
        <div class="ss-middle">
          <div id="ss-spots" class="tiles spots"></div>
          <div class="label">Conditions</div>
          <div id="ss-conds" class="conds"></div>
          <div class="row seed-row"><span class="label">Session code</span>
            <input id="ss-seed" maxlength="12" spellcheck="false" autocomplete="off">
            <button id="ss-seed-new" class="mini">New</button>
            <button id="ss-seed-copy" class="mini">Copy link</button>
            <span id="ss-seed-note" class="label small"></span></div>
        </div>
        <div class="ss-bottom">
          <button id="ss-play" class="primary">Paddle out</button>
          <p class="small ss-help">Wait for the set, paddle into the <b>pocket</b> next to the peak (not on it), then ride away from the breaking lip.
            <span class="keyboard-only"><b>Arrows</b> paddle / steer, <b>up/down</b> step on the board while riding, <b>Space</b> power stroke, <b>H</b> hints, <b>Esc</b> settings.</span></p>
        </div>
      </div>`;
    const q = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>(id)!;
    this.facesEl = q('#ss-faces');
    this.boardsEl = q('#ss-boards');
    this.paddlesEl = q('#ss-paddles');
    this.spotsEl = q('#ss-spots');
    this.condsEl = q('#ss-conds');
    this.nameEl = q<HTMLInputElement>('#ss-name');
    this.seedEl = q<HTMLInputElement>('#ss-seed');
    this.seedNote = q('#ss-seed-note');
    this.nameEl.value = loadPlayerName(this.surfer.name);
    // Clicks and keys inside the overlay are UI, not game input.
    for (const ev of ['pointerdown', 'click', 'keydown', 'keyup', 'touchstart']) root.addEventListener(ev, (e) => e.stopPropagation());

    q('#ss-next').addEventListener('click', () => this.goto(2));
    q('#ss-back').addEventListener('click', () => this.goto(1));
    q('#ss-scores').addEventListener('click', () => hud.openBoard());
    q('#ss-play').addEventListener('click', () => this.play());
    this.nameEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.goto(2);
      }
    });
    this.nameEl.addEventListener('change', () => this.commitName());
    this.render();
  }

  private get surfer() {
    return this.roster.surfers[this.roster.surferIndex];
  }

  private commitName(): void {
    const name = this.nameEl.value.trim().slice(0, 24) || this.surfer.name;
    this.nameEl.value = name;
    savePlayerName(name);
    this.hud.setPlayerName(name);
  }

  private goto(step: 1 | 2): void {
    this.step = step;
    if (step === 2) this.commitName();
    this.game.startView = step === 1 ? 'surfer' : 'spot';
    this.root.querySelector('.ss-surfer')!.classList.toggle('hidden', step !== 1);
    this.root.querySelector('.ss-spot')!.classList.toggle('hidden', step !== 2);
  }

  private play(): void {
    this.commitName();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    this.game.start();
  }

  /** Shown while the game is on its start phase; hidden otherwise. Re-renders tiles when coming back. */
  setVisible(v: boolean): void {
    if (v === this.visible) return;
    this.visible = v;
    this.root.classList.toggle('hidden', !v);
    if (v) {
      this.goto(this.step);
      this.render();
    }
  }

  /** Redraws every tile from the roster (after settings changed a surfer, for instance). */
  render(): void {
    this.renderFaces();
    this.renderGear();
    this.renderSpots();
  }

  private renderFaces(): void {
    this.facesEl.innerHTML = '';
    this.roster.surfers.forEach((s, i) => {
      const b = document.createElement('button');
      b.className = `tile face${i === this.roster.surferIndex ? ' on' : ''}`;
      if (s.look.facePhoto) {
        const img = document.createElement('img');
        img.src = s.look.facePhoto;
        img.alt = s.name;
        img.draggable = false;
        b.appendChild(img);
      } else {
        const ph = document.createElement('div');
        ph.className = 'face-blank';
        ph.textContent = s.name.slice(0, 1);
        b.appendChild(ph);
      }
      const cap = document.createElement('span');
      cap.textContent = s.name;
      b.appendChild(cap);
      b.onclick = () => {
        this.roster.surferIndex = i;
        this.nameEl.value = s.name;
        this.commitName();
        this.game.applySurfer(s);
        this.onChange();
        this.render();
      };
      this.facesEl.appendChild(b);
    });
  }

  private renderGear(): void {
    const s = this.surfer;
    this.boardsEl.innerHTML = '';
    BOARDS.forEach((spec, i) => {
      const b = this.gearTile(spec.name, s.look.board === i, (c) => drawBoard(c, spec, s.palette));
      b.onclick = () => {
        s.look.board = i;
        this.game.applySurfer(s);
        this.onChange();
        this.renderGear();
      };
      this.boardsEl.appendChild(b);
    });
    this.paddlesEl.innerHTML = '';
    PADDLES.forEach((spec, i) => {
      const b = this.gearTile(spec.name, s.look.paddle === i, (c) => drawPaddle(c, spec, s.palette));
      b.onclick = () => {
        s.look.paddle = i;
        this.game.applySurfer(s);
        this.onChange();
        this.renderGear();
      };
      this.paddlesEl.appendChild(b);
    });
  }

  private gearTile(name: string, on: boolean, draw: (ctx: CanvasRenderingContext2D) => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = `tile gear${on ? ' on' : ''}`;
    const c = document.createElement('canvas');
    c.width = TILE * 2;
    c.height = TILE * 2;
    draw(c.getContext('2d')!);
    const cap = document.createElement('span');
    cap.textContent = name;
    b.append(c, cap);
    return b;
  }

  private renderSpots(): void {
    this.spotsEl.innerHTML = '';
    this.roster.spots.forEach((s, i) => {
      const b = document.createElement('button');
      b.className = `tile spot${i === this.roster.spotIndex ? ' on' : ''}`;
      if (s.photo) {
        const img = document.createElement('img');
        img.src = s.photo;
        img.alt = s.name;
        img.draggable = false;
        b.appendChild(img);
      } else {
        const sw = document.createElement('div');
        sw.className = 'spot-blank';
        sw.style.background = `linear-gradient(${s.water.sky}, ${s.water.face} 55%, ${s.water.sand})`;
        b.appendChild(sw);
      }
      const cap = document.createElement('span');
      cap.innerHTML = '<b></b><i></i>';
      cap.querySelector('b')!.textContent = s.name;
      cap.querySelector('i')!.textContent = describeSpot(s);
      b.appendChild(cap);
      b.onclick = () => {
        this.onSpot(i);
        this.renderSpots();
      };
      this.spotsEl.appendChild(b);
    });
  }

  bindSpot(onPick: (i: number) => void): void {
    this.onSpot = onPick;
  }

  /** Conditions picker (glassy / offshore / ...). Rendered by the caller so the current preset stays in one place. */
  setConditions(presets: { id: string; name: string; desc: string }[], current: string, onPick: (id: string) => void): void {
    this.condsEl.innerHTML = '';
    for (const p of presets) {
      const b = document.createElement('button');
      b.className = `cond${p.id === current ? ' on' : ''}`;
      b.innerHTML = '<b></b><span></span>';
      b.querySelector('b')!.textContent = p.name;
      b.querySelector('span')!.textContent = p.desc;
      b.onclick = () => onPick(p.id);
      this.condsEl.appendChild(b);
    }
  }

  setSeed(code: string): void {
    if (this.seedEl.value !== code) this.seedEl.value = code;
  }

  bindSeed(onChange: (raw: string) => void, onNew: () => void, onCopy: () => void): void {
    this.seedEl.addEventListener('input', () => onChange(this.seedEl.value));
    this.seedEl.addEventListener('change', () => onChange(this.seedEl.value));
    this.root.querySelector('#ss-seed-new')!.addEventListener('click', onNew);
    this.root.querySelector('#ss-seed-copy')!.addEventListener('click', onCopy);
  }

  seedNoteText(s: string): void {
    this.seedNote.textContent = s;
  }
}

/** Top-down board thumbnail: the deck design clipped to the outline (nose up), rails and fins. */
function drawBoard(ctx: CanvasRenderingContext2D, spec: BoardSpec, p: SurferPalette): void {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const L = H * 0.88;
  const top = (H - L) / 2;
  const cx = W / 2;
  const hw = (spec.halfW / 0.42) * W * 0.17;
  const tailW = spec.tailShape === 'pin' ? 0.12 : spec.tailShape === 'squash' ? 0.55 : 0.4;
  const noseW = 0.95 - 0.75 * spec.pointy;
  const path = (dx: number, dy: number, grow: number) => {
    const h = hw + grow;
    const t = top + dy;
    const bottom = top + L + dy;
    const mid = top + L * 0.5 + dy;
    ctx.beginPath();
    ctx.moveTo(cx + dx, t);
    ctx.bezierCurveTo(cx + dx + h * noseW, t, cx + dx + h, t + L * 0.28, cx + dx + h, mid);
    ctx.bezierCurveTo(cx + dx + h, bottom - L * 0.22, cx + dx + h * tailW * 1.25, bottom, cx + dx + h * tailW, bottom);
    ctx.lineTo(cx + dx - h * tailW, bottom);
    ctx.bezierCurveTo(cx + dx - h * tailW * 1.25, bottom, cx + dx - h, bottom - L * 0.22, cx + dx - h, mid);
    ctx.bezierCurveTo(cx + dx - h, t + L * 0.28, cx + dx - h * noseW, t, cx + dx, t);
    ctx.closePath();
  };
  ctx.clearRect(0, 0, W, H);
  path(4, 6, 0);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fill();
  const deck = document.createElement('canvas');
  deck.width = 128;
  deck.height = 512;
  paintDeck(deck.getContext('2d')!, p, spec.deck);
  ctx.save();
  path(0, 0, 0);
  ctx.clip();
  ctx.drawImage(deck, cx - hw, top, hw * 2, L);
  ctx.restore();
  path(0, 0, 0);
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.stroke();
  // Fins peek out past the tail so the single fin / thruster difference reads at a glance.
  ctx.fillStyle = '#20242a';
  const finY = top + L * 0.86;
  const fins = spec.fins === 3 ? [-0.55, 0, 0.55] : [0];
  for (const f of fins) {
    const x = cx + f * hw * 0.9;
    const s = f === 0 ? 1 : 0.7;
    ctx.beginPath();
    ctx.moveTo(x - 4 * s, finY - 2 * s);
    ctx.lineTo(x + 4 * s, finY - 2 * s);
    ctx.lineTo(x + 2 * s, finY + 16 * s);
    ctx.lineTo(x - 2 * s, finY + 16 * s);
    ctx.closePath();
    ctx.fill();
  }
}

/** Paddle thumbnail: grip on top, shaft, blade at the bottom, in the surfer's paddle colours. */
function drawPaddle(ctx: CanvasRenderingContext2D, spec: PaddleSpec, p: SurferPalette): void {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  ctx.clearRect(0, 0, W, H);
  const cx = W / 2;
  const top = H * 0.06;
  const bottom = H * 0.94;
  const bladeLen = (spec.bladeLen / 0.5) * H * 0.3;
  const bladeW = spec.bladeW * W * 0.3;
  const shaftW = (spec.shaftR / 0.017) * W * 0.045;
  const bladeTop = bottom - bladeLen;
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetX = 3;
  ctx.shadowOffsetY = 4;
  // Shaft.
  ctx.fillStyle = p.paddle;
  ctx.fillRect(cx - shaftW / 2, top + H * 0.05, shaftW, bladeTop - top - H * 0.05 + 4);
  // Grip.
  ctx.beginPath();
  if (spec.grip === 't') {
    ctx.roundRect(cx - W * 0.11, top, W * 0.22, H * 0.055, 6);
  } else {
    ctx.ellipse(cx, top + H * 0.035, W * 0.08, H * 0.04, 0, 0, Math.PI * 2);
  }
  ctx.fill();
  if (spec.collar) {
    ctx.fillStyle = p.blade;
    ctx.fillRect(cx - shaftW * 0.9, top + H * 0.42, shaftW * 1.8, H * 0.06);
  }
  // Blade: teardrop that widens toward the tip.
  ctx.fillStyle = p.blade;
  ctx.beginPath();
  ctx.moveTo(cx - shaftW / 2, bladeTop);
  ctx.bezierCurveTo(cx - bladeW * 0.9, bladeTop + bladeLen * 0.3, cx - bladeW, bottom - bladeLen * 0.15, cx, bottom);
  ctx.bezierCurveTo(cx + bladeW, bottom - bladeLen * 0.15, cx + bladeW * 0.9, bladeTop + bladeLen * 0.3, cx + shaftW / 2, bladeTop);
  ctx.closePath();
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, bladeTop + 4);
  ctx.lineTo(cx, bottom - bladeLen * 0.2);
  ctx.stroke();
}
