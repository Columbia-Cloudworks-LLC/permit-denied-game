/** Stable catalog IDs make test links independent of placement/runtime IDs. */
export type TestMapRequest = { kind: 'yard' } | { kind: 'asset'; assetId: string; variant: number };

export function testMapSearch(request: TestMapRequest, seed: number): string {
  const params = new URLSearchParams();
  if (request.kind === 'yard') params.set('yard', '1');
  else { params.set('testAsset', request.assetId); params.set('variant', String(request.variant)); }
  params.set('seed', String(seed));
  return '?' + params;
}
