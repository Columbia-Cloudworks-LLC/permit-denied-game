import "./style.css";
import { boot } from "./game/Game";

if (new URLSearchParams(location.search).get('capture') === '1') {
  void import('./debug/assetCapture').then(({ bootAssetCapture }) => bootAssetCapture());
} else void boot();
