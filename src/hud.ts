import type { EndReason } from './game';

const END_TITLES: Record<EndReason, string> = {
  peak: 'Wipeout at the peak',
  closeout: 'Closed out',
  caught: 'Caught by the foam',
  overback: 'Over the back',
  faded: 'Ride complete',
};

export interface HudState {
  phase: string;
  fatigue: number;
  stance: number;
  score: number;
  caught: number;
  setLabel: string;
  hint: boolean;
  surfer: string;
  spot: string;
  ridePoints: number;
}

export class Hud {
  private root: HTMLElement;
  private phaseEl: HTMLElement;
  private setEl: HTMLElement;
  private msgEl: HTMLElement;
  private fatigueBar: HTMLElement;
  private stanceEls: HTMLElement[];
  private scoreEl: HTMLElement;
  private caughtEl: HTMLElement;
  private rideEl: HTMLElement;
  private hintEl: HTMLElement;
  private whoEl: HTMLElement;
  private endCard: HTMLElement;
  private startCard: HTMLElement;
  private msgTimer = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = `
      <div class="panel top-left">
        <div class="row"><span id="hud-phase" class="phase"></span><span id="hud-who" class="who"></span></div>
        <div id="hud-set" class="set"></div>
        <div class="label">Tiredness</div>
        <div class="bar"><div id="hud-fatigue" class="fill"></div></div>
        <div class="row stance-row"><span class="label">Stance</span>
          <span class="stance"><i data-s="-1"></i><i data-s="0"></i><i data-s="1"></i></span>
          <span class="label small">back · centre · front</span></div>
        <div class="row"><span>Score <b id="hud-score">0</b></span><span>Waves <b id="hud-caught">0</b></span><span id="hud-ride"></span></div>
        <div id="hud-hint" class="label small"></div>
      </div>
      <div id="hud-msg" class="msg"></div>
      <div id="hud-end" class="card hidden"></div>
      <div id="hud-start" class="card start">
        <h1>Paddle Surf</h1>
        <p>Wait for the set, paddle into the <b>pocket</b> next to the peak (not on it), then ride away from the breaking lip.</p>
        <ul>
          <li><b>Arrows</b>: paddle (waiting) · left/right steer, up/down step forward/back on the board (riding)</li>
          <li><b>Space</b>: power stroke while paddling (tires you out)</li>
          <li><b>H</b>: toggle peak/pocket hints · <b>Esc</b>: settings (surfers, spots, colours)</li>
        </ul>
        <p class="go">Press any key to paddle out</p>
      </div>
      <div class="panel bottom controls">←↑↓→ paddle / steer · Space power · ↑↓ stance while riding · H hints · Esc settings</div>
    `;
    const q = (id: string) => root.querySelector<HTMLElement>(id)!;
    this.phaseEl = q('#hud-phase');
    this.setEl = q('#hud-set');
    this.msgEl = q('#hud-msg');
    this.fatigueBar = q('#hud-fatigue');
    this.stanceEls = Array.from(root.querySelectorAll<HTMLElement>('.stance i'));
    this.scoreEl = q('#hud-score');
    this.caughtEl = q('#hud-caught');
    this.rideEl = q('#hud-ride');
    this.hintEl = q('#hud-hint');
    this.whoEl = q('#hud-who');
    this.endCard = q('#hud-end');
    this.startCard = q('#hud-start');
  }

  update(s: HudState, now: number): void {
    const phaseNames: Record<string, string> = {
      start: 'Ready',
      waiting: '1 · Waiting for the wave',
      riding: '2 · Riding',
      ended: '3 · Wave over',
    };
    this.phaseEl.textContent = phaseNames[s.phase] ?? s.phase;
    this.whoEl.textContent = `${s.surfer} @ ${s.spot}`;
    this.setEl.textContent = s.setLabel;
    this.fatigueBar.style.width = `${Math.round(s.fatigue * 100)}%`;
    this.fatigueBar.classList.toggle('hot', s.fatigue > 0.7);
    for (const el of this.stanceEls) el.classList.toggle('on', Number(el.dataset.s) === s.stance);
    this.scoreEl.textContent = String(s.score);
    this.caughtEl.textContent = String(s.caught);
    this.rideEl.textContent = s.phase === 'riding' ? `+${Math.round(s.ridePoints * 10)}` : '';
    this.hintEl.textContent = s.hint ? 'Hints on (H): red = peak, green = pockets' : 'Hints off (H)';
    this.startCard.classList.toggle('hidden', s.phase !== 'start');
    if (this.msgTimer && now > this.msgTimer) {
      this.msgEl.classList.remove('show');
      this.msgTimer = 0;
    }
  }

  flash(text: string, ms = 3000): void {
    this.msgEl.textContent = text;
    this.msgEl.classList.add('show');
    this.msgTimer = performance.now() + ms;
  }

  showEnd(reason: EndReason, points: number, rideTime: number): void {
    const wipe = reason === 'peak' || reason === 'closeout' || reason === 'caught';
    this.endCard.innerHTML = `
      <h2 class="${wipe ? 'bad' : 'good'}">${END_TITLES[reason]}</h2>
      <p>${rideTime > 0 ? `Ride ${rideTime.toFixed(1)} s · ` : ''}<b>+${points}</b> points</p>
      <p class="go">Press any key to paddle back out</p>`;
    this.endCard.classList.remove('hidden');
  }

  hideEnd(): void {
    this.endCard.classList.add('hidden');
  }

  get element(): HTMLElement {
    return this.root;
  }
}
