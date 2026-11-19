/**
 * AI（ChatGPT・Claude など）に建物を作ってもらうための説明文と、直してもらうための文。
 * パレットと上限は、検査（geoParse.ts）と同じ定数から書き出す（説明文と検査がずれないように）
 */
import { LIMITS, UNITS_PER_VOXEL } from './limits';
import { PALETTE } from './palette';
import type { ParseIssue } from './geoParse';

const hex6 = (h: number) => '#' + h.toString(16).toUpperCase().padStart(6, '0');

const EXAMPLE = `{
  "format_version": "1.12.0",
  "minecraft:geometry": [{
    "description": { "identifier": "geometry.chiisana_koya" },
    "bones": [
      { "name": "stone", "pivot": [0, 0, 0], "cubes": [ { "origin": [-24, 0, -24], "size": [48, 4, 48] } ] },
      { "name": "wall",  "pivot": [0, 0, 0], "cubes": [ { "origin": [-20, 4, -20], "size": [40, 28, 40] } ] },
      { "name": "wood_door", "parent": "wall", "pivot": [0, 0, 0], "cubes": [ { "origin": [-5, 4, -21], "size": [10, 20, 1] } ] },
      { "name": "wall_gable", "pivot": [0, 0, 0], "cubes": [
        { "origin": [-13, 32, -20], "size": [26, 4, 40] },
        { "origin": [-6, 36, -20], "size": [12, 4, 40] }
      ] },
      { "name": "roof", "pivot": [0, 44, 0], "cubes": [
        { "origin": [-28, 44, -24], "size": [28, 3, 48], "pivot": [0, 44, 0], "rotation": [0, 0, -30] },
        { "origin": [0, 44, -24], "size": [28, 3, 48], "pivot": [0, 44, 0], "rotation": [0, 0, 30] }
      ] }
    ]
  }]
}`;

export function buildPrompt(idea: string): string {
  const U = UNITS_PER_VOXEL;
  const palette = PALETTE.map((p) => `   * ${p.name}：${hex6(p.hex)}（${p.use}）`).join('\n');
  // 文面は利用者の決めたテンプレート（2026-11-20）。数字とパレットは検査と同じ定数から入れる
  return `あなたは 3D モデルを作るアシスタントです。次の規格を厳密に守って、ローポリの建物を
Minecraft Bedrock のジオメトリ JSON（Blockbench の「Bedrock Entity」形式の .geo.json）で作ってください。
## 作ってほしいもの
${idea.trim()}
## 規格（必ず守る）

* 形式："format_version": "1.12.0"、"minecraft:geometry" の中に 1 つだけ。部品は "bones"（グループ）の中の "cubes"（直方体）で作る
* 直方体の書き方："origin"（一番小さい角の座標）、"size"（幅・高さ・奥行）、必要なら "pivot"（回転の中心）と "rotation"（度、[x, y, z]）
* グループも "pivot" と "rotation" を持てる。入れ子にするときは子に "parent": "親の名前" を書く。pivot は親からの相対ではなく、建物全体の座標で書く
* 形は直方体だけ。"poly_mesh" は使わない。"uv" やテクスチャは要らない（あっても無視される）
* 単位：${U} 単位 = 1 マス（約 1 m）。Y が上。建物の底は y = 0、中心は x = 0, z = 0 のあたり
* 向き：正面は −Z（北）。正面から建物を見たとき、右が +X
* 大きさ：回転した分も含めて、幅・奥行は ${LIMITS.widthUnits} 単位（${LIMITS.widthUnits / U} マス）以内、高さは ${LIMITS.heightUnits} 単位（${LIMITS.heightUnits / U} マス）以内
* 数：直方体は ${LIMITS.cubes} 個以内、グループは ${LIMITS.bones} 個以内、入れ子は ${LIMITS.depth} 段以内。JSON 全体で ${LIMITS.fileBytes / 1024} KB 以内
* 色：グループの名前で決まる。名前を次のどれかにするか、「名前_何か」（例：roof_left、wall_front）にする。色のないグループは、親のグループの色になる
${palette}

## 例（小さな小屋）
${EXAMPLE}
## 出力

* JSON だけを 1 つのコードブロックで出す。省略しない、「…」を使わない、コメントを書かない。
* めり込んでいる場合はそれが適切かどうか確かめてから出力する。
* Z-fightingを起こして変になっていないか確認する。`;
}

export function buildFixPrompt(issues: ParseIssue[]): string {
  return `さきほどの建物の JSON を箱庭に読み込んだところ、次の問題がありました。

${issues.map((i) => `- ${i.message}`).join('\n')}

この点だけを直して、JSON 全体をもう一度出してください。規格は最初に伝えたものと同じです。`;
}
