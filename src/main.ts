import "./style.css";
import { boot } from "./game/Game";
import { initPrivacy } from './privacy/privacy';
import { registerGamePwa } from './pwa/register';

registerGamePwa();
if (new URLSearchParams(location.search).get('capture') === '1') {
  void import('./debug/assetCapture').then(({ bootAssetCapture }) => bootAssetCapture());
} else { initPrivacy(); void boot(); }
