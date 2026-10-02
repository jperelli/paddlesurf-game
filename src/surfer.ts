import * as THREE from 'three';
import type { SurferPalette } from './palette';

export type Stance = -1 | 0 | 1;

/** Low-poly stand-up paddler. Local +z is the nose of the board. */
export class SurferRig {
  readonly group = new THREE.Group();
  private body = new THREE.Group();
  private board: THREE.Mesh;
  private boardAccent: THREE.Mesh;
  private torso: THREE.Mesh;
  private head: THREE.Mesh;
  private legL: THREE.Mesh;
  private legR: THREE.Mesh;
  private armL: THREE.Mesh;
  private armR: THREE.Mesh;
  private paddle = new THREE.Group();
  private shaft: THREE.Mesh;
  private blade: THREE.Mesh;
  private mats: Record<keyof SurferPalette, THREE.MeshStandardMaterial>;

  constructor(palette: SurferPalette) {
    const m = (c: string, rough = 0.6) => new THREE.MeshStandardMaterial({ color: c, roughness: rough });
    this.mats = {
      wetsuit: m(palette.wetsuit, 0.75),
      skin: m(palette.skin, 0.8),
      board: m(palette.board, 0.35),
      boardAccent: m(palette.boardAccent, 0.35),
      paddle: m(palette.paddle, 0.5),
    };

    const boardShape = new THREE.Shape();
    boardShape.moveTo(0, 1.7);
    boardShape.bezierCurveTo(0.42, 1.5, 0.42, -1.2, 0.3, -1.55);
    boardShape.lineTo(-0.3, -1.55);
    boardShape.bezierCurveTo(-0.42, -1.2, -0.42, 1.5, 0, 1.7);
    const boardGeo = new THREE.ExtrudeGeometry(boardShape, { depth: 0.14, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2 });
    boardGeo.rotateX(Math.PI / 2);
    boardGeo.translate(0, 0.14, 0);
    this.board = new THREE.Mesh(boardGeo, this.mats.board);
    this.board.castShadow = true;

    const accentGeo = new THREE.BoxGeometry(0.62, 0.02, 0.8);
    this.boardAccent = new THREE.Mesh(accentGeo, this.mats.boardAccent);
    this.boardAccent.position.set(0, 0.155, -1.0);

    this.legL = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.8, 8), this.mats.wetsuit);
    this.legR = this.legL.clone();
    this.legL.position.set(-0.18, 0.55, 0.12);
    this.legR.position.set(0.18, 0.55, -0.12);

    this.torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.62, 0.24), this.mats.wetsuit);
    this.torso.position.set(0, 1.25, 0);
    this.head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), this.mats.skin);
    this.head.position.set(0, 1.75, 0.02);

    this.armL = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.62, 8), this.mats.wetsuit);
    this.armR = this.armL.clone();
    this.armL.position.set(-0.28, 1.25, 0.15);
    this.armR.position.set(0.28, 1.25, 0.15);
    this.armL.rotation.x = -1.0;
    this.armR.rotation.x = -1.0;

    this.shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.1, 6), this.mats.paddle);
    this.shaft.position.y = -0.4;
    this.blade = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.46, 0.02), this.mats.paddle);
    this.blade.position.y = -1.6;
    this.paddle.add(this.shaft, this.blade);
    this.paddle.position.set(0.32, 1.45, 0.25);

    this.body.add(this.legL, this.legR, this.torso, this.head, this.armL, this.armR, this.paddle);
    this.body.traverse((o) => {
      o.castShadow = true;
    });
    this.group.add(this.board, this.boardAccent, this.body);
  }

  setPalette(p: SurferPalette): void {
    for (const k of Object.keys(this.mats) as (keyof SurferPalette)[]) this.mats[k].color.set(p[k]);
  }

  /**
   * @param stance -1 back, 0 centre, 1 front
   * @param strokePhase paddling animation phase (radians), 0 to freeze
   * @param crouch 0..1
   */
  pose(stance: Stance, strokePhase: number, crouch: number, paddleSide: 1 | -1): void {
    this.body.position.z = stance * 0.45;
    const c = 1 - 0.25 * crouch;
    this.body.scale.set(1, c, 1);
    if (strokePhase !== 0) {
      const s = Math.sin(strokePhase);
      this.paddle.rotation.x = -0.35 + 0.55 * s;
      this.paddle.rotation.z = paddleSide * 0.15;
      this.paddle.position.x = paddleSide * 0.32;
      this.armL.rotation.x = -1.0 + 0.4 * s;
      this.armR.rotation.x = -1.0 + 0.4 * s;
      this.torso.rotation.x = 0.12 + 0.08 * s;
    } else {
      this.paddle.rotation.x = -0.9;
      this.paddle.rotation.z = paddleSide * 0.7;
      this.paddle.position.x = paddleSide * 0.32;
      this.armL.rotation.x = -1.1;
      this.armR.rotation.x = -1.1;
      this.torso.rotation.x = 0.25 * crouch;
    }
  }

  setWipeout(progress: number): void {
    // Tumble the body off the board.
    this.body.rotation.x = -progress * 1.6;
    this.body.position.y = -progress * 0.8;
    this.body.position.x = progress * 1.2;
    this.board.rotation.z = progress * 0.9;
  }

  resetWipeout(): void {
    this.body.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);
    this.board.rotation.set(0, 0, 0);
  }
}
