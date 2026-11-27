import type { VoxelGrid } from '../types';
import { createGrid, gridIndexRaw } from './utils';
import { packRgb } from './palette';

type RGB = [number, number, number];

function setVoxel(g: VoxelGrid, x: number, y: number, z: number, rgb: RGB): void {
  if (x < 0 || y < 0 || z < 0 || x >= g.nx || y >= g.ny || z >= g.nz) return;
  const i = gridIndexRaw(g.nx, g.nz, x, y, z);
  g.kind[i] = 1;
  g.sourceRGB[i] = packRgb(rgb[0], rgb[1], rgb[2]);
}

function fillEllipsoid(
  g: VoxelGrid,
  cx: number,
  cy: number,
  cz: number,
  rx: number,
  ry: number,
  rz: number,
  rgb: RGB,
  paint = false,
): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        const dz = (z - cz) / rz;
        if (dx * dx + dy * dy + dz * dz <= 1) {
          if (!paint && g.kind[gridIndexRaw(g.nx, g.nz, x, y, z)] === 0) setVoxel(g, x, y, z, rgb);
          else if (paint) setVoxel(g, x, y, z, rgb);
        }
      }
    }
  }
}

function fillBox(
  g: VoxelGrid,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number,
  rgb: RGB,
): void {
  for (let y = y0; y <= y1; y++)
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) setVoxel(g, x, y, z, rgb);
}

function fillConeY(
  g: VoxelGrid,
  cx: number,
  y0: number,
  z: number,
  radius: number,
  height: number,
  rgb: RGB,
): void {
  for (let h = 0; h < height; h++) {
    const r = radius * (1 - h / height) + 0.35;
    fillEllipsoid(g, cx, y0 + h, z, r, 1, r, rgb);
  }
}

function tailTube(g: VoxelGrid, rgb: RGB): void {
  const pts: Array<[number, number, number, number]> = [
    [8, 4, -4, 2.8],
    [10, 7, -5, 2.7],
    [11, 11, -5, 2.5],
    [10, 15, -4, 2.3],
    [8, 18, -3, 2.1],
    [6, 19, -1, 1.9],
  ];
  for (const [x, y, z, r] of pts) fillEllipsoid(g, x, y, z, r, r, r, rgb);
}

export function createCatGrid(): VoxelGrid {
  const g = createGrid(30, 44, 28);
  const orange: RGB = [218, 139, 55];
  const orangeDark: RGB = [174, 91, 35];
  const cream: RGB = [246, 218, 177];
  const black: RGB = [28, 25, 24];
  const pink: RGB = [235, 132, 132];
  const green: RGB = [72, 158, 92];

  // Tail and haunches first so the body overlaps them into one connected sit.
  tailTube(g, orangeDark);
  fillEllipsoid(g, 8, 10, -2, 5.5, 7, 6, orange);
  fillEllipsoid(g, -8, 10, -2, 5.5, 7, 6, orange);

  // Body, chest and head.
  fillEllipsoid(g, 0, 16, -1, 9, 14, 7.5, orange);
  fillEllipsoid(g, 0, 18, 4, 6.5, 11, 4.8, orange);
  fillEllipsoid(g, 0, 32, 2, 7.5, 6.5, 6.5, orange);

  // Ears.
  fillConeY(g, -4.8, 37, 1.5, 3.2, 6, orangeDark);
  fillConeY(g, 4.8, 37, 1.5, 3.2, 6, orangeDark);
  fillConeY(g, -4.8, 38, 2.2, 1.5, 3, pink);
  fillConeY(g, 4.8, 38, 2.2, 1.5, 3, pink);

  // Front legs and broad sitting paws.
  fillEllipsoid(g, -3.4, 8, 5.2, 2.2, 7.5, 2.2, cream);
  fillEllipsoid(g, 3.4, 8, 5.2, 2.2, 7.5, 2.2, cream);
  fillEllipsoid(g, -3.6, 2.6, 7, 3.4, 2.2, 3.2, cream);
  fillEllipsoid(g, 3.6, 2.6, 7, 3.4, 2.2, 3.2, cream);

  // Belly and muzzle are painted over the base coat.
  fillEllipsoid(g, 0, 16, 6.2, 4.8, 9, 2.2, cream, true);
  fillEllipsoid(g, 0, 30.2, 7.4, 3.8, 2.7, 2.2, cream, true);
  fillEllipsoid(g, -2.2, 30.4, 8.4, 1.8, 1.5, 1.2, cream, true);
  fillEllipsoid(g, 2.2, 30.4, 8.4, 1.8, 1.5, 1.2, cream, true);

  // Eyes, nose and tabby marks.
  fillEllipsoid(g, -2.8, 33, 7.7, 1.05, 1.25, 0.8, green, true);
  fillEllipsoid(g, 2.8, 33, 7.7, 1.05, 1.25, 0.8, green, true);
  setVoxel(g, -2.8, 33, 8.3, black);
  setVoxel(g, 2.8, 33, 8.3, black);
  fillEllipsoid(g, 0, 31.4, 9.1, 1.1, 0.8, 0.7, pink, true);
  for (let y = 24; y <= 29; y += 2) {
    setVoxel(g, 0, y, 7.2, orangeDark);
    setVoxel(g, -1, y + 1, 7.1, orangeDark);
    setVoxel(g, 1, y + 1, 7.1, orangeDark);
  }
  for (let x = -5; x <= 5; x += 2) setVoxel(g, x, 37, 3, orangeDark);

  return g;
}

export function createHouseGrid(): VoxelGrid {
  const g = createGrid(40, 32, 32);
  const foundation: RGB = [126, 128, 122];
  const wall: RGB = [226, 196, 145];
  const wallDark: RGB = [198, 159, 103];
  const roof: RGB = [166, 45, 35];
  const roofDark: RGB = [116, 31, 27];
  const door: RGB = [101, 61, 32];
  const glass: RGB = [116, 190, 220];
  const chimney: RGB = [132, 76, 61];

  // Foundation and floor.
  fillBox(g, 3, 36, 0, 1, 3, 28, foundation);

  // Thick perimeter walls, leaving the interior genuinely empty.
  for (let y = 2; y <= 16; y++) {
    for (let x = 6; x <= 33; x++) {
      setVoxel(g, x, y, 6, wall);
      setVoxel(g, x, y, 25, wall);
    }
    for (let z = 6; z <= 25; z++) {
      setVoxel(g, 6, y, z, wallDark);
      setVoxel(g, 33, y, z, wallDark);
    }
  }

  // A one-stud attic/ceiling course ties all walls together and gives the
  // stepped roof a continuous clutch surface, avoiding tall false supports.
  fillBox(g, 6, 33, 17, 17, 6, 25, wallDark);

  // Stepped pitched roof with overlapping courses.
  for (let step = 0; step <= 8; step++) {
    const y = 18 + step;
    const x0 = 4 + step * 1.5;
    const x1 = 35 - step * 1.5;
    fillBox(g, Math.round(x0), Math.round(x1), y, y, 4, 27, step % 2 ? roof : roofDark);
  }
  fillBox(g, 15, 24, 26, 27, 4, 27, roofDark);

  // Chimney.
  fillBox(g, 27, 30, 20, 29, 9, 12, chimney);
  fillBox(g, 26, 31, 29, 30, 8, 13, foundation);

  // Door and frame.
  fillBox(g, 17, 22, 2, 10, 25, 26, door);
  fillBox(g, 16, 23, 10, 11, 25, 26, wallDark);
  setVoxel(g, 21, 6, 27, [230, 190, 80]);

  // Front windows with bright glass and sills.
  for (const xc of [12, 28]) {
    fillBox(g, xc - 2, xc + 2, 8, 13, 25, 26, glass);
    fillBox(g, xc - 3, xc + 3, 7, 7, 25, 27, foundation);
    setVoxel(g, xc, 10, 27, wall);
    setVoxel(g, xc, 8, 27, wall);
  }

  // Side windows.
  fillBox(g, 6, 7, 9, 13, 12, 17, glass);
  fillBox(g, 5, 7, 8, 8, 11, 18, foundation);

  return g;
}
