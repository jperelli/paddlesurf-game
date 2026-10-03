import type { EndReason } from './game';
import { Leaderboard, loadPlayerName, savePlayerName, submitScore, type RunResult } from './scores';

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
  surfer: string;
  spot: string;
  ridePoints: number;
}

export class Hud {
  readonly root: HTMLElement;
  private phaseEl: HTMLElement;
  private setEl: HTMLElement;
  private msgEl: HTMLElement;
  private fatigueBar: HTMLElement;
  private stanceEls: HTMLElement[];
  private scoreEl: HTMLElement;
  private caughtEl: HTMLElement;
  private rideEl: HTMLElement;
  private whoEl: HTMLElement;
  private endCard: HTMLElement;
  private msgTimer = 0;
  private endBoard: Leaderboard;
  private boardCard: HTMLElement;
  private board: Leaderboard;
  private playerName = '';
  /** Set once a name was typed this page load; later runs save under it without asking again. */
  private nameGiven = false;
  /** True when the end card needs no input, so the game can paddle back out on its own. */
  quickRestart = false;
  /** True while the end card is asking for a name; "any key" must not paddle out yet. */
  awaitingName = false;

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = `
      <canvas id="hud-lens"></canvas>
      <div class="panel top-left">
        <div class="row"><span id="hud-phase" class="phase"></span><span id="hud-who" class="who"></span></div>
        <div id="hud-set" class="set"></div>
        <div class="label">Tiredness</div>
        <div class="bar"><div id="hud-fatigue" class="fill"></div></div>
        <div class="row stance-row"><span class="label">Stance</span>
          <span class="stance"><i data-s="-1"></i><i data-s="0"></i><i data-s="1"></i></span>
          <span class="label small">back · centre · front</span></div>
        <div class="row"><span>Score <b id="hud-score">0</b></span><span>Waves <b id="hud-caught">0</b></span><span id="hud-ride"></span></div>
      </div>
      <div id="hud-msg" class="msg"></div>
      <div id="hud-end" class="card hidden"></div>
      <div id="hud-board" class="card board-card hidden">
        <div class="row board-head"><h2>High scores</h2><button id="hud-board-close" class="mini">Close</button></div>
        <p class="small">Best runs: waves and points in one session without falling.</p>
        <div id="hud-board-list"></div>
      </div>
      <div class="panel bottom controls keyboard-only">←↑↓→ paddle / steer · Space power · ↑↓ stance while riding · H hints · Esc settings</div>
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
    this.whoEl = q('#hud-who');
    this.endCard = q('#hud-end');
    this.boardCard = q('#hud-board');
    this.board = new Leaderboard(q('#hud-board-list'));
    this.endBoard = new Leaderboard(document.createElement('div'));
    for (const ev of ['pointerdown', 'click', 'touchstart']) this.boardCard.addEventListener(ev, (e) => e.stopPropagation());
    q('#hud-board-close').addEventListener('click', () => this.boardCard.classList.add('hidden'));
  }

  /** The start screen asks for the name up front, so the wave-over card never has to. */
  setPlayerName(name: string): void {
    this.playerName = name;
    this.nameGiven = true;
  }

  openBoard(): void {
    this.boardCard.classList.remove('hidden');
    this.board.show('day', null);
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
    if (!this.playerName) this.playerName = loadPlayerName(s.surfer);
    if (s.phase !== 'start') this.boardCard.classList.add('hidden');
    this.setEl.textContent = s.setLabel;
    this.fatigueBar.style.width = `${Math.round(s.fatigue * 100)}%`;
    this.fatigueBar.classList.toggle('hot', s.fatigue > 0.7);
    for (const el of this.stanceEls) el.classList.toggle('on', Number(el.dataset.s) === s.stance);
    this.scoreEl.textContent = String(s.score);
    this.caughtEl.textContent = String(s.caught);
    this.rideEl.textContent = s.phase === 'riding' ? `+${Math.round(s.ridePoints * 10)}` : '';
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

  /** Wave-over card. A wipeout ends the run: `run` carries its totals and the card asks for a name for the leaderboard. */
  showEnd(reason: EndReason, points: number, rideTime: number, run: RunResult | null): void {
    const wipe = reason === 'peak' || reason === 'closeout' || reason === 'caught';
    this.endCard.innerHTML = `
      <h2 class="${wipe ? 'bad' : 'good'}">${END_TITLES[reason]}</h2>
      <p>${rideTime > 0 ? `Ride ${rideTime.toFixed(1)} s · ` : ''}<b>+${points}</b> points</p>`;
    const go = document.createElement('p');
    go.className = 'go';
    go.textContent = 'Press any key or tap to paddle back out';
    if (!run) {
      this.endCard.appendChild(go);
      this.endCard.classList.remove('hidden');
      return;
    }
    if (this.nameGiven) {
      const p = document.createElement('p');
      p.className = 'run';
      p.textContent = `Run over: ${run.waves} wave${run.waves === 1 ? '' : 's'} · ${run.points} points`;
      this.endCard.appendChild(p);
      if (run.waves > 0) submitScore(this.playerName, run).catch(() => undefined);
      go.textContent = 'Paddling back out';
      this.endCard.appendChild(go);
      this.endCard.classList.remove('hidden');
      this.quickRestart = true;
      return;
    }
    this.awaitingName = true;
    const form = document.createElement('form');
    form.className = 'run-form';
    form.innerHTML = `
      <p class="run">Run over: <b>${run.waves}</b> wave${run.waves === 1 ? '' : 's'} · <b>${run.points}</b> points without falling</p>
      <div class="row"><label>Your name <input id="hud-name" maxlength="24" autocomplete="off" spellcheck="false"></label>
        <button type="submit">Save score</button><button type="button" id="hud-skip" class="mini">Skip</button></div>
      <p class="small" id="hud-run-note"></p>`;
    for (const ev of ['pointerdown', 'click', 'keydown', 'keyup', 'touchstart']) form.addEventListener(ev, (e) => e.stopPropagation());
    const nameEl = form.querySelector<HTMLInputElement>('#hud-name')!;
    const note = form.querySelector<HTMLElement>('#hud-run-note')!;
    nameEl.value = this.playerName;
    const finish = (highlight: number | null, ranks?: Record<string, number>) => {
      this.awaitingName = false;
      form.remove();
      if (ranks) {
        const p = document.createElement('p');
        p.className = 'run';
        p.textContent = `Saved for ${this.playerName}: #${ranks.day} today · #${ranks.week} this week · #${ranks.month} this month · #${ranks.all} all time`;
        this.endCard.appendChild(p);
      }
      this.endCard.appendChild(this.endBoard.root);
      this.endBoard.show('day', highlight);
      this.endCard.appendChild(go);
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = nameEl.value.trim().slice(0, 24);
      if (!name) {
        nameEl.focus();
        return;
      }
      this.playerName = name;
      this.nameGiven = true;
      savePlayerName(name);
      note.textContent = 'Saving…';
      for (const b of form.querySelectorAll('button')) b.disabled = true;
      submitScore(name, run)
        .then((res) => finish(res.id, res.rank))
        .catch(() => {
          note.textContent = 'Could not reach the server, score not saved.';
          for (const b of form.querySelectorAll('button')) b.disabled = false;
        });
    });
    form.querySelector('#hud-skip')!.addEventListener('click', () => finish(null));
    this.endCard.appendChild(form);
    this.endCard.classList.remove('hidden');
    setTimeout(() => nameEl.focus(), 50);
  }

  hideEnd(): void {
    this.awaitingName = false;
    this.quickRestart = false;
    this.endCard.classList.add('hidden');
  }

  get element(): HTMLElement {
    return this.root;
  }
}
