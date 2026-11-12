import { isOpenCol } from '../world/plots';

/** その列のボクセルを変えてよいか（開いた区画の中だけ） */
export const canSetCol = (plots: number, x: number, z: number) => isOpenCol(plots, x, z);

/** 掘った穴に水が流れ込む時、その列まで広がってよいか（開いていない区画へは流れない） */
export const floodAllowed = (plots: number, x: number, z: number) => isOpenCol(plots, x, z);
