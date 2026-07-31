/**
 * Scene painter registry for the WIND DOWN world tour.
 *
 * A chapter names its scene by key. Adding a chapter therefore adds a data row
 * and, optionally, one painter. An unknown key must degrade to a readable
 * placeholder rather than throwing, so a future content pack can never break a
 * deployed build.
 */

import type { WindDownMember } from "@/features/winddown/game/model/roster";

export type ScenePaintArgs = {
  readonly scene: string;
  readonly width: number;
  readonly height: number;
  readonly time: number;
  /** 0..1, how built-up this city is right now */
  readonly growth: number;
  readonly member: WindDownMember;
};

type Painter = (
  context: CanvasRenderingContext2D,
  args: ScenePaintArgs,
  baseline: number,
) => void;

const INK = "rgba(255,255,255,";

function readToken(context: CanvasRenderingContext2D, token: string, fallback: string): string {
  const canvas = context.canvas;
  const value = getComputedStyle(canvas).getPropertyValue(token).trim();
  return value.length > 0 ? value : fallback;
}

/** Stable per-building gate; animated screen position must never affect state. */
function isBuilt(identity: number, growth: number): boolean {
  const k = Math.abs(Math.round(identity) * 7919) % 1000;
  return k / 1000 <= 0.18 + growth * 0.82;
}

function block(
  context: CanvasRenderingContext2D,
  x: number,
  width: number,
  height: number,
  baseline: number,
  growth: number,
  alpha: string,
  identity: number,
): void {
  if (!isBuilt(identity, growth)) {
    context.strokeStyle = `${INK}0.12)`;
    context.lineWidth = 1;
    const stub = height * 0.34;
    context.strokeRect(x + 2, baseline - stub, width - 4, stub);
    return;
  }
  const grown = height * (0.55 + growth * 0.45);
  context.fillStyle = `${INK}${alpha})`;
  context.fillRect(x, baseline - grown, width, grown);
}

function skylinePainter(density: number, alpha: string): Painter {
  return (context, args, baseline) => {
    for (let i = 0; i < density; i += 1) {
      const x = ((i * 56 - args.time * 0.02) % (args.width + 70)) - 35;
      const height = 30 + ((i * 41) % 60);
      block(context, x, 28, height, baseline, args.growth, alpha, i);
    }
  };
}

function stagePainter(beams: number): Painter {
  return (context, args, baseline) => {
    const accent = readToken(context, "--wd-accent", "transparent");
    context.fillStyle = `${INK}0.14)`;
    context.fillRect(0, baseline - 16, args.width, 16);
    for (let i = 0; i < beams; i += 1) {
      const x = 14 + i * ((args.width - 28) / Math.max(1, beams - 1));
      const gradient = context.createLinearGradient(x, baseline - 16, x, baseline - 96);
      gradient.addColorStop(0, `${INK}0.22)`);
      gradient.addColorStop(1, `${INK}0)`);
      context.beginPath();
      context.moveTo(x, baseline - 16);
      context.lineTo(x - 13, baseline - 96);
      context.lineTo(x + 13, baseline - 96);
      context.closePath();
      context.fillStyle = gradient;
      context.fill();
    }
    context.fillStyle = accent;
    context.beginPath();
    context.arc(args.width / 2, baseline - 58, 8, 0, Math.PI * 2);
    context.fill();
  };
}

function paintMember(
  context: CanvasRenderingContext2D,
  args: ScenePaintArgs,
  baseline: number,
): void {
  const { member } = args;
  const accent = readToken(context, "--wd-accent", "transparent");
  const sway = Math.sin(args.time * 0.001 * member.tempo) * 2;
  const center = args.width / 2 + sway;
  const headY = baseline - 56;
  const hairDrop = 7 + member.hair.length * 3;

  context.fillStyle = `${INK}0.78)`;
  context.beginPath();
  context.ellipse(center, headY, 10, 12, 0, 0, Math.PI * 2);
  context.fill();
  context.fillRect(center - 8, headY + 10, 16, 28);

  context.strokeStyle = accent;
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(center - 10, headY - 6);
  context.quadraticCurveTo(
    center - 13 - member.hair.wave,
    headY + hairDrop / 2,
    center - 9,
    headY + hairDrop,
  );
  context.moveTo(center + 10, headY - 6);
  context.quadraticCurveTo(
    center + 13 + member.hair.wave,
    headY + hairDrop / 2,
    center + 9,
    headY + hairDrop,
  );
  context.stroke();

  context.fillStyle = accent;
  for (let index = 0; index < member.hair.strands; index += 1) {
    const offset = (index - (member.hair.strands - 1) / 2) * 2.1;
    context.fillRect(center + offset, headY - 12, 1, 4);
  }
}

export const SCENE_PAINTERS: Readonly<Record<string, Painter>> = {
  studio: stagePainter(3),
  audition: stagePainter(4),
  dorm: skylinePainter(6, "0.16"),
  reveal: stagePainter(6),
  musicshow: stagePainter(8),
  firstwin: stagePainter(9),
  dome: skylinePainter(8, "0.2"),
  daesang: stagePainter(7),
  tokyo: skylinePainter(12, "0.22"),
  bangkok: skylinePainter(9, "0.18"),
  palm: skylinePainter(7, "0.16"),
  skyline: skylinePainter(14, "0.24"),
  sphere: skylinePainter(7, "0.2"),
  bigben: skylinePainter(8, "0.2"),
  eiffel: skylinePainter(8, "0.16"),
  sagrada: skylinePainter(7, "0.16"),
  colosseo: skylinePainter(6, "0.18"),
  burj: skylinePainter(7, "0.18"),
  opera: skylinePainter(6, "0.2"),
  christ: skylinePainter(6, "0.16"),
  mama: stagePainter(9),
  billboard: stagePainter(9),
  awards: stagePainter(7),
  grammy: stagePainter(8),
};

export function paintScene(context: CanvasRenderingContext2D, args: ScenePaintArgs): void {
  const { width, height } = args;
  const baseline = height - 30;
  context.clearRect(0, 0, width, height);

  const sky = context.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, readToken(context, "--wd-bg", "transparent"));
  sky.addColorStop(1, readToken(context, "--wd-surface", "transparent"));
  context.fillStyle = sky;
  context.fillRect(0, 0, width, height);

  const painter = SCENE_PAINTERS[args.scene];
  if (painter) {
    painter(context, args, baseline);
  } else {
    context.fillStyle = `${INK}0.12)`;
    context.fillRect(0, baseline - 40, width, 40);
    context.fillStyle = `${INK}0.4)`;
    context.font = '800 11px -apple-system,system-ui,sans-serif';
    context.textAlign = "center";
    context.fillText(args.scene, width / 2, baseline - 52);
  }

  paintMember(context, args, baseline);
  context.fillStyle = `${INK}0.1)`;
  context.fillRect(0, baseline, width, height - baseline);
}
