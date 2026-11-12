import * as THREE from 'three/webgpu';
import { U } from './materials';
import { SKY } from './sky';
import type { WeatherParams } from '../weather';

const C = (h: number) => new THREE.Color(h);
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// 夜：青みを抑えた紺。月明かりは白に近い淡い青。暗くなりすぎないように少し明るめ
const NIGHT = { top: C(0x16213a), bottom: C(0x3a4664), light: C(0xcdd6ee), hemiSky: C(0x5a6482), hemiGround: C(0x24242c) };
const DAY = { top: C(0x4f9be0), bottom: C(0xd8ecfb), light: C(0xfff4e0), hemiSky: C(0xcfe8ff), hemiGround: C(0x7a6644) };
const DUSK = { top: C(0x5b6fb0), bottom: C(0xffb98a), light: C(0xffa266), hemiSky: C(0xffc8a0), hemiGround: C(0x5a4030) };
const OVERCAST = C(0x9aa3ad);

export interface Daylight {
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  /** 時刻（0..24）と天気を反映する */
  apply(hour: number, focus: THREE.Vector3, radius: number, weather: WeatherParams): void;
}

export function createDaylight(scene: THREE.Scene): Daylight {
  const sun = new THREE.DirectionalLight(0xffffff, 2.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0004;
  // normalBias は「曲げた法線」で影の参照位置をずらしてしまい、角丸の縁で影がギザギザになる。
  // 代わりに各マテリアルの receivedShadowPositionNode で、曲げる前の法線方向にずらす
  sun.shadow.normalBias = 0;
  sun.shadow.radius = 1.5; // 影の縁を少しやわらかく（大きいと縁がざらつく）
  scene.add(sun, sun.target);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  scene.add(hemi);

  const tmp = new THREE.Color();
  const mixSet = (out: THREE.Color, key: 'top' | 'bottom' | 'light' | 'hemiSky' | 'hemiGround', day: number, dusk: number) => {
    out.copy(NIGHT[key]).lerp(DAY[key], day);
    tmp.copy(DUSK[key]);
    out.lerp(tmp, dusk);
    return out;
  };

  return {
    sun, hemi,
    apply(hour, focus, radius, weather) {
      // 6 時に日の出、18 時に日の入り
      const elev = Math.sin(((hour - 6) / 12) * Math.PI);
      const day = smooth(-0.12, 0.3, elev);
      const dusk = smooth(0.4, 0.0, Math.abs(elev)) * 0.85 * (1 - weather.cloudDark * 0.7);
      const overcast = Math.min(1, weather.cloudCover * 0.6 + weather.cloudDark * 0.6) * day;

      // 昼は太陽、夜は月（反対側）から照らす
      const az = ((hour - 6) / 24) * Math.PI * 2 + 0.6;
      const sunDir = new THREE.Vector3(Math.cos(az) * Math.cos(Math.asin(Math.max(-1, Math.min(1, elev)))), elev, Math.sin(az) * Math.cos(Math.asin(Math.max(-1, Math.min(1, elev)))));
      const isDay = elev > -0.05;
      const e = isDay ? Math.max(0.12, elev) : Math.max(0.35, -elev);
      const dir = new THREE.Vector3(Math.cos(az) * Math.sqrt(1 - e * e), e, Math.sin(az) * Math.sqrt(1 - e * e));
      if (!isDay) dir.x *= -1, dir.z *= -1;
      sun.position.copy(focus).addScaledVector(dir, radius * 2);
      sun.target.position.copy(focus);
      mixSet(sun.color, 'light', day, dusk);
      const base = isDay ? 0.4 + 2.4 * smooth(-0.05, 0.35, elev) : 1.0;
      sun.intensity = base * (isDay ? weather.sun : 0.6 + 0.4 * (1 - weather.cloudCover));

      const cam = sun.shadow.camera;
      cam.left = -radius; cam.right = radius; cam.top = radius; cam.bottom = -radius;
      cam.near = 1; cam.far = radius * 4;
      cam.updateProjectionMatrix();

      mixSet(hemi.color, 'hemiSky', day, dusk);
      mixSet(hemi.groundColor, 'hemiGround', day, dusk);
      // 曇りの日は日差しが弱いぶん、空からの光を少し増やす
      hemi.intensity = (0.75 + 0.4 * day) * (1 + overcast * 0.35);

      // 空の色（曇り・雨は灰色がかる）
      mixSet(SKY.zenith.value, 'top', day, dusk).lerp(OVERCAST, overcast * 0.8);
      mixSet(SKY.horizon.value, 'bottom', day, dusk).lerp(OVERCAST, overcast * 0.6);
      SKY.sunDir.value.copy(sunDir);
      SKY.sunColor.value.copy(sun.color);
      SKY.night.value = 1 - day;
      SKY.cloudCover.value = weather.cloudCover;
      SKY.cloudDark.value = weather.cloudDark;

      U.skyColor.value.copy(SKY.horizon.value).lerp(SKY.zenith.value, 0.35);
      U.sunColor.value.copy(sun.color);
      U.daylight.value = day * (0.5 + 0.5 * weather.sun);
      U.wind.value = weather.wind;
    },
  };
}
