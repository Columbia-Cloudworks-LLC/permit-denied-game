import { describe, expect, it } from 'vitest';
import { CAMPAIGN_LEVELS } from '../game/campaign';
import { edgeExitNodes } from './edgeRoads';
import { findRoadRoute, indexNetwork } from './roads';
import { createTown } from './town';

/** Lanes that leave the town through an exit node, and lanes that enter from one. */
function exitLanes(town: ReturnType<typeof createTown>) {
  const idx = indexNetwork(town.network);
  const exits = edgeExitNodes(town.network, town);
  const inbound: string[] = [], outbound: string[] = [];
  for (const n of exits) {
    const seg = idx.segmentById.get(n.segmentIds[0]!)!;
    for (const id of seg.laneIds) {
      const lane = idx.laneById.get(id)!;
      const arrivesAtExit = (seg.endId === n.id) === (lane.dir === 1);
      (arrivesAtExit ? outbound : inbound).push(id);
    }
  }
  return { exits, inbound, outbound };
}

describe('edge roads', () => {
  for (const level of CAMPAIGN_LEVELS) {
    it(`runs public roads to the map edge on ${level.id}`, () => {
      const town = createTown({ district: 'd30', seed: 19, campaign: level });
      const { exits, inbound, outbound } = exitLanes(town);
      expect(exits.length, level.id).toBeGreaterThanOrEqual(2);
      // Every entrance can reach some other exit.
      for (const start of inbound) {
        expect(outbound.some(end => findRoadRoute(town.network, start, end)), `${level.id} ${start}`).toBe(true);
      }
    });
  }
});
