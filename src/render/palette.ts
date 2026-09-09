import type { Material } from "../structure/types";

export const PAL = {
  lot: 0xb89b6a,
  lotDark: 0x8e7548,
  dust: 0xc4a36a,
  asphalt: 0x3a3a3c,
  asphaltLine: 0xd4c56a,
  curb: 0x6a6558,
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
  glass: 0x2a3a48,
  glassLit: 0x3e5868,
  crack: 0x2a1c14,
  dozer: 0xe6c034,
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
