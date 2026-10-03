// High-score client: talks to /api/scores and renders the leaderboard with its period tabs.

export type Period = 'day' | 'week' | 'month' | 'all';

export interface ScoreRow {
  id: number;
  name: string;
  waves: number;
  points: number;
  spot: string;
  at: number;
}

export interface RunResult {
  waves: number;
  points: number;
  spot: string;
  seed: string;
}

export interface Submitted {
  id: number;
  rank: Record<Period, number>;
}

export const PERIODS: { id: Period; name: string }[] = [
  { id: 'day', name: 'Today' },
  { id: 'week', name: 'This week' },
  { id: 'month', name: 'This month' },
  { id: 'all', name: 'All time' },
];

const NAME_KEY = 'paddlesurf.player';

export function loadPlayerName(fallback: string): string {
  return localStorage.getItem(NAME_KEY) ?? fallback;
}

export function savePlayerName(name: string): void {
  localStorage.setItem(NAME_KEY, name);
}

const tz = () => new Date().getTimezoneOffset();

export async function fetchScores(period: Period, limit = 20): Promise<ScoreRow[]> {
  const r = await fetch(`/api/scores?period=${period}&limit=${limit}&tz=${tz()}`);
  if (!r.ok) throw new Error(`scores ${r.status}`);
  const data = (await r.json()) as { scores: ScoreRow[] };
  return data.scores;
}

export async function submitScore(name: string, run: RunResult): Promise<Submitted> {
  const r = await fetch(`/api/scores?tz=${tz()}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, ...run }),
  });
  if (!r.ok) throw new Error(`submit ${r.status}`);
  return (await r.json()) as Submitted;
}

function when(at: number): string {
  const d = new Date(at);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

/** Leaderboard with Today / week / month / all-time tabs, rendered into `root`. */
export class Leaderboard {
  private period: Period = 'day';
  private highlight: number | null = null;
  private tabsEl: HTMLElement;
  private bodyEl: HTMLElement;
  private seq = 0;
  readonly root: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
    root.classList.add('board');
    root.innerHTML = '<div class="tabs"></div><div class="board-body"></div>';
    this.tabsEl = root.querySelector('.tabs')!;
    this.bodyEl = root.querySelector('.board-body')!;
    for (const ev of ['pointerdown', 'click', 'touchstart']) root.addEventListener(ev, (e) => e.stopPropagation());
    for (const p of PERIODS) {
      const b = document.createElement('button');
      b.className = 'tab';
      b.textContent = p.name;
      b.dataset.period = p.id;
      b.addEventListener('click', () => {
        b.blur();
        this.show(p.id, this.highlight);
      });
      this.tabsEl.appendChild(b);
    }
  }

  /** Loads and renders a period; `highlight` marks the player's fresh entry. */
  show(period: Period = this.period, highlight: number | null = this.highlight): void {
    this.period = period;
    this.highlight = highlight;
    for (const b of this.tabsEl.querySelectorAll<HTMLElement>('.tab')) b.classList.toggle('on', b.dataset.period === period);
    const seq = ++this.seq;
    this.bodyEl.innerHTML = '<p class="small">Loading…</p>';
    fetchScores(period)
      .then((rows) => {
        if (seq !== this.seq) return;
        this.render(rows);
      })
      .catch(() => {
        if (seq !== this.seq) return;
        this.bodyEl.innerHTML = '<p class="small">High scores unavailable right now.</p>';
      });
  }

  private render(rows: ScoreRow[]): void {
    if (!rows.length) {
      this.bodyEl.innerHTML = '<p class="small">No runs yet. Be the first.</p>';
      return;
    }
    const table = document.createElement('table');
    table.innerHTML = '<thead><tr><th>#</th><th class="l">Name</th><th>Waves</th><th>Points</th><th class="l">Spot</th><th>When</th></tr></thead><tbody></tbody>';
    const tbody = table.querySelector('tbody')!;
    rows.forEach((r, i) => {
      const tr = document.createElement('tr');
      if (r.id === this.highlight) tr.className = 'me';
      const cells = [String(i + 1), r.name, String(r.waves), String(r.points), r.spot.replace(/,.*$/, ''), when(r.at)];
      cells.forEach((c, j) => {
        const td = document.createElement('td');
        td.textContent = c;
        if (j === 1 || j === 4) td.className = 'l';
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    this.bodyEl.innerHTML = '';
    this.bodyEl.appendChild(table);
  }
}
