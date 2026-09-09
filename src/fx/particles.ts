import { PARTICLE_CAP } from "../game/constants";
import { Rng } from "../game/rng";
import type { Particle, ParticleKind } from "../structure/types";

export class ParticlePool {
  readonly items: Particle[] = [];
  private readonly rng = new Rng(0x51f00d);

  constructor() {
    for (let i = 0; i < PARTICLE_CAP; i++) {
      this.items.push({
        alive: false,
        kind: "dust",
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        maxLife: 1,
        size: 1,
        rot: 0,
        spin: 0,
        settled: false,
      });
    }
  }

  clear(): void {
    for (const p of this.items) p.alive = false;
  }

  spawn(
    kind: ParticleKind,
    x: number,
    y: number,
    z: number,
    count: number,
    speed: number,
    up = 3.2,
  ): void {
    let n = 0;
    for (const p of this.items) {
      if (n >= count) return;
      if (p.alive && !p.settled) continue;
      const ang = this.rng.range(0, Math.PI * 2);
      const sp = this.rng.range(0.2, 1) * speed;
      p.alive = true;
      p.kind = kind;
      p.x = x + this.rng.range(-0.15, 0.15);
      p.y = y + this.rng.range(-0.15, 0.15);
      p.z = Math.max(0.05, z + this.rng.range(-0.2, 0.4));
      p.vx = Math.cos(ang) * sp;
      p.vy = Math.sin(ang) * sp;
      p.vz = this.rng.range(0.4, 1) * up;
      p.maxLife = kind === "dust" ? this.rng.range(0.28, 0.7) : this.rng.range(0.9, 2.4);
      p.life = p.maxLife;
      p.size = kind === "dust" ? this.rng.range(0.18, 0.45) : this.rng.range(0.08, 0.22);
      p.rot = this.rng.range(0, Math.PI * 2);
      p.spin = this.rng.range(-8, 8);
      p.settled = false;
      n++;
    }
  }

  burst(kind: ParticleKind, x: number, y: number, z: number, mag: number): void {
    const chunks = kind === "dust" ? 0 : Math.min(18, 4 + Math.floor(mag * 3));
    const dust = Math.min(22, 6 + Math.floor(mag * 4));
    if (chunks) this.spawn(kind, x, y, z, chunks, 2.4 + mag, 4 + mag);
    this.spawn("dust", x, y, z, dust, 1.6 + mag * 0.6, 1.8);
  }

  collapseCloud(x: number, y: number, z: number, dx: number, dy: number): void {
    this.spawn("dust", x, y, z, 28, 3.4, 2.2);
    for (const p of this.items) {
      if (!p.alive || p.kind !== "dust") continue;
      if (Math.hypot(p.x - x, p.y - y) > 0.8) continue;
      p.vx += dx * 2.8;
      p.vy += dy * 2.8;
    }
  }

  step(dt: number): void {
    for (const p of this.items) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        continue;
      }
      if (p.settled) continue;
      p.vx *= 1 - 1.4 * dt;
      p.vy *= 1 - 1.4 * dt;
      p.vz -= (p.kind === "dust" ? 4.5 : 18) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.rot += p.spin * dt;
      if (p.z <= 0) {
        p.z = 0;
        p.vz *= -0.28;
        p.vx *= 0.55;
        p.vy *= 0.55;
        if (p.kind === "dust" || Math.abs(p.vz) < 1.1) {
          p.settled = true;
          p.vz = 0;
          p.vx = 0;
          p.vy = 0;
          if (p.kind === "dust") p.life = Math.min(p.life, 0.35);
        }
      }
    }
  }
}

export function debrisKind(material: string): ParticleKind {
  if (material === "wood") return "wood";
  if (material === "brick") return "brick";
  if (material === "metal") return "metal";
  if (material === "glass") return "glass";
  return "concrete";
}
