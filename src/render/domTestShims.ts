// Browser APIs happy-dom lacks that the HUD and debug panels touch. Import from DOM tests only.
// happy-dom lays nothing out and plays no animations; these just need to exist.
globalThis.ResizeObserver ??= class { observe(): void {} unobserve(): void {} disconnect(): void {} } as unknown as typeof ResizeObserver;
Element.prototype.animate ??= function () { return {} as Animation; };
Element.prototype.getAnimations ??= function () { return []; };
// The yard panel builds its pickers with the Option constructor.
globalThis.Option ??= function (text = "", value = text) {
  const option = document.createElement("option");
  option.textContent = text;
  option.value = value;
  return option;
} as unknown as typeof Option;
