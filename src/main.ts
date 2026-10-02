import './style.css';
import { Game } from './game';
import { Hud } from './hud';
import { loadRoster } from './roster';
import { SettingsPanel } from './settings';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `<canvas id="gl"></canvas><div id="hud"></div><div id="settings"></div>`;

const canvas = document.querySelector<HTMLCanvasElement>('#gl')!;
const roster = loadRoster();
const hud = new Hud(document.querySelector<HTMLElement>('#hud')!);
const game = new Game(canvas, roster.spots[roster.spotIndex], roster.surfers[roster.surferIndex], hud);
new SettingsPanel(document.querySelector<HTMLElement>('#settings')!, roster, game);

declare global {
  interface Window {
    paddlesurf: Game;
  }
}
window.paddlesurf = game;

let last = performance.now();
function frame(now: number): void {
  const dt = (now - last) / 1000;
  last = now;
  game.update(dt);
  hud.update(
    {
      phase: game.phase,
      fatigue: game.fatigue,
      stance: game.stance,
      score: game.score,
      caught: game.caught,
      setLabel: game.phase === 'start' ? '' : game.setLabel(),
      hint: game.hint,
      surfer: game.surfer.name,
      spot: game.spot.name,
      ridePoints: game.ride?.points ?? 0,
    },
    now,
  );
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
