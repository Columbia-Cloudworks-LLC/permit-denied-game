import type { Material } from "../structure/types";

export const PAL = {
  lot: 0xb89b6a,
  lotDark: 0x8e7548,
  grass: 0x5a7340,
  grassDark: 0x3e522c,
  dirt: 0x8a6a40,
  gravel: 0x8a8478,
  planted: 0x3e562c,
  water: 0x3a6a8a,
  waterDark: 0x1e3a50,
  forestFloor: 0x283c24,
  fieldTilled: 0x7a5430,
  fieldShort: 0x4a6e34,
  fieldMature: 0x365826,
  fieldStubble: 0xb08a48,
  dust: 0xc4a36a,
  asphalt: 0x3a3a3c,
  asphaltLine: 0xd4c56a,
  curb: 0x8a8680,
  wood: 0xb8733a,
  woodDark: 0x7a4a24,
  woodTop: 0xc98a4e,
  brick: 0x8a3a32,
  brickDark: 0x5c241f,
  brickTop: 0xa44a40,
  concrete: 0x8a8778,
  concreteDark: 0x5c5a50,
  concreteTop: 0xa3a08e,
  metal: 0x6d7270,
  metalDark: 0x3e4240,
  metalTop: 0x8b908c,
  interior: 0x1a1410,
  interiorDeep: 0x120e0c,
  plaster: 0xc4b49a,
  plasterShadow: 0x6a5c4a,
  plank: 0xb08a52,
  plankDark: 0x7a5c32,
  tile: 0x8a9a94,
  tileDark: 0x5c6a66,
  linoleum: 0xb89658,
  linoleumDark: 0x7a6238,
  sofa: 0x6a5848,
  sofaDark: 0x3e342c,
  ceramic: 0xc8c2b4,
  ceramicDark: 0x7a7568,
  trim: 0x6a6458,
  frame: 0x4a4038,
  glass: 0x2a3a48,
  glassLit: 0x3e5868,
  crack: 0x2a1c14,
  dozer: 0xf0c83a,
  dozerDark: 0xa68618,
  dozerCabin: 0x2c4050,
  dozerTrack: 0x2a2a28,
  cabGlass: 0x6a90a4,
  blade: 0x8d9094,
  shadow: 0x1a140c,
  fence: 0xc4a056,
  car: 0x3d5c8a,
  dumpster: 0x3d6a3a,
  bird: 0xe8d8a0,
  roofShingle: 0x6e3a30,
  roofShingleDark: 0x4a241e,
  roofMetal: 0x6d7270,
  roofFelt: 0x3c3a36,
  roofTpo: 0xd9ddd6,
  roofTpoSeam: 0xb9beb6,
  roofBur: 0x6e685d,
  roofBurLight: 0x8f887a,
  roofBurDark: 0x4d483f,
  roofMastic: 0x24211d,
  roofEpdm: 0x33373a,
  roofEpdmBar: 0x8e9594,
  roofPaver: 0xa9a698,
  roofAdobe: 0xc49a70,
  roofAdobeLight: 0xd4ae86,
  roofTile: 0xb5583a,
  roofTileDark: 0x7e3a26,
  roofSeamMetal: 0xb7c2c4,
  roofSeamMetalDark: 0x7f8b8e,
  roofSnow: 0xd5e0e8,
  roofSnowFlat: 0xc5ced6,
  copingMetal: 0xb4bab8,
  copingStone: 0xcfc8b2,
  copingBrick: 0x74362c,
  viga: 0x6b4526,
  galv: 0xc3c9c8,
  galvDark: 0x7f8886,
  galvMid: 0xa1a9a7,
  louver: 0x444c4a,
  solarCell: 0x1f3a66,
  foundation: 0x6a6458,
  awning: 0x6a2c28,
} as const;

export function matColors(material: Material): { side: number; dark: number; top: number } {
  switch (material) {
    case "wood":
      return { side: PAL.wood, dark: PAL.woodDark, top: PAL.woodTop };
    case "brick":
      return { side: PAL.brick, dark: PAL.brickDark, top: PAL.brickTop };
    case "metal":
      return { side: PAL.metal, dark: PAL.metalDark, top: PAL.metalTop };
    case "glass":
      return { side: PAL.glass, dark: PAL.interior, top: PAL.glassLit };
    case "concrete":
      return { side: PAL.concrete, dark: PAL.concreteDark, top: PAL.concreteTop };
    default: {
      const _never: never = material;
      return _never;
    }
  }
}

/** Scale each RGB channel, clamped so brightening never bleeds into the next channel. */
export function shade(color: number, mul: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 255) * mul));
  const g = Math.min(255, Math.round(((color >> 8) & 255) * mul));
  const b = Math.min(255, Math.round((color & 255) * mul));
  return (r << 16) | (g << 8) | b;
}
