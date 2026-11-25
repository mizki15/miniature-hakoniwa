import * as THREE from 'three/webgpu';
import { U } from './materials';
import { SKY } from './sky';
import type { WeatherParams } from '../weather';

const C = (h: number) => new THREE.Color(h);
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// 夜：青みを抑えた紺。月明かりは白に近い淡い青。ホタルが映えるよう暗めに
const NIGHT = { top: C(0x0c1322), bottom: C(0x262f48), light: C(0xc4d0ec), hemiSky: C(0x3e4866), hemiGround: C(0x18181e) };
const DAY = { top: C(0x4f9be0), bottom: C(0xd8ecfb), light: C(0xfff4e0), hemiSky: C(0xcfe8ff), hemiGround: C(0x7a6644) };
const DUSK = { top: C(0x5b6fb0), bottom: C(0xffb98a), light: C(0xffa266), hemiSky: C(0xffc8a0), hemiGround: C(0x5a4030) };
const OVERCAST = C(0x9aa3ad);

export interface Daylight {
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  /** 夜の明るさの倍率（1 が標準。月の光と空からの光に、夜の度合いに応じて掛ける） */
  nightBrightness: number;
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
  const snapped = new THREE.Vector3();
  const mixSet = (out: THREE.Color, key: 'top' | 'bottom' | 'light' | 'hemiSky' | 'hemiGround', day: number, dusk: number) => {
    out.copy(NIGHT[key]).lerp(DAY[key], day);
    tmp.copy(DUSK[key]);
    out.lerp(tmp, dusk);
    return out;
  };

  return {
    sun, hemi,
    nightBrightness: 1,
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
      // 影の範囲の真ん中（注目点）を、影の地図の 1 画素の格子にそろえる（カメラを動かしても影の縁がちらつかないように。v0.18.1）
      const center = snapToShadowTexel(focus, dir, (2 * radius) / sun.shadow.mapSize.x, snapped);
      sun.position.copy(center).addScaledVector(dir, radius * 2);
      sun.target.position.copy(center);
      mixSet(sun.color, 'light', day, dusk);
      const base = isDay ? 0.4 + 2.4 * smooth(-0.05, 0.35, elev) : 0.55;
      // 夜の明るさ：昼は 1、夜になるほど nightBrightness に近づく
      const nightK = 1 + (this.nightBrightness - 1) * (1 - day);
      sun.intensity = base * (isDay ? weather.sun : 0.6 + 0.4 * (1 - weather.cloudCover)) * nightK;

      const cam = sun.shadow.camera;
      cam.left = -radius; cam.right = radius; cam.top = radius; cam.bottom = -radius;
      cam.near = 1; cam.far = radius * 4;
      cam.updateProjectionMatrix();

      mixSet(hemi.color, 'hemiSky', day, dusk);
      mixSet(hemi.groundColor, 'hemiGround', day, dusk);
      // 曇りの日は日差しが弱いぶん、空からの光を少し増やす
      hemi.intensity = (0.45 + 0.7 * day) * (1 + overcast * 0.35) * nightK;

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

const _right = new THREE.Vector3(), _up = new THREE.Vector3(), _ref = new THREE.Vector3();
/**
 * 点 p を、光の向き dir から見た平面の上で texel の格子にそろえる（光の向きの成分はそのまま）。
 * 影の地図は光から見た正射影なので、こうすると注目点が動いても影の地図の画素の並びが変わらず、縁がちらつかない
 */
export function snapToShadowTexel(p: THREE.Vector3, dir: THREE.Vector3, texel: number, out = new THREE.Vector3()): THREE.Vector3 {
  out.copy(p);
  if (!(texel > 0)) return out;
  _ref.set(0, 1, 0);
  if (Math.abs(dir.y) > 0.99) _ref.set(0, 0, 1);
  _right.crossVectors(dir, _ref).normalize();
  _up.crossVectors(_right, dir).normalize();
  const rx = p.dot(_right), uy = p.dot(_up);
  out.addScaledVector(_right, Math.round(rx / texel) * texel - rx).addScaledVector(_up, Math.round(uy / texel) * texel - uy);
  return out;
}
