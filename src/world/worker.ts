/// <reference lib="webworker" />
/**
 * 地形のワーカー：世界の状態（plotBuild.ts の BuildState）を持ち続け、
 * 「最初の生成」「区画の追加」「編集した所の作り直し」を受け取って、メッシュを返す。
 */
import { addPlot, applyDelta, chunkBuffers, initWorld, modelBuffers, placementBuffers, type BuildState, type WorkerRequest } from './plotBuild';

export type { ChunkMesh, DetailModel, PlotPlacements, InitResult, PlotResult, RemeshResult, WorkerResult, WorkerRequest } from './plotBuild';

const post = (msg: unknown, transfer: ArrayBufferLike[]) =>
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer as Transferable[]);

let state: BuildState | null = null;

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  if (req.type === 'init') {
    const r = initWorld(req);
    state = r.state;
    const res = r.result;
    post(res, [
      res.world.voxels.buffer, res.world.heights.buffer, res.world.walkable.buffer,
      ...res.chunks.flatMap(chunkBuffers), ...res.models.flatMap(modelBuffers), ...res.placements.flatMap(placementBuffers),
    ]);
  } else if (req.type === 'addPlot') {
    if (!state) return;
    const res = addPlot(state, req.plot, req.edits, req.gen);
    if (!res) return;
    post(res, [res.voxels.buffer, res.heights.buffer, res.walkable.buffer, ...res.chunks.flatMap(chunkBuffers), ...placementBuffers(res.placements)]);
  } else if (req.type === 'remesh') {
    if (!state) return;
    const chunks = applyDelta(state, req.delta, req.chunks, req.gen);
    if (!chunks) return;
    post({ type: 'remesh', gen: req.gen, id: req.id, chunks }, chunks.flatMap(chunkBuffers));
  }
};
