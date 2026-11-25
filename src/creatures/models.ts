import * as THREE from 'three/webgpu';

export type ResidentId = 'rabbit' | 'tanuki' | 'fox' | 'deer' | 'duck' | 'squirrel' | 'hedgehog'
  | 'sheep' | 'bear' | 'otter' | 'mole' | 'serow' | 'stoat' | 'beaver' | 'capybara' | 'cat';

export type VisitorModelId = 'butterfly' | 'bee' | 'sparrow' | 'frog' | 'fish' | 'dragonfly' | 'woodpecker' | 'snail'
  | 'longtailedTit' | 'owl' | 'kingfisher' | 'mejiro' | 'skylark' | 'cricket' | 'flyingSquirrel' | 'eagle'
  | 'heron' | 'crane' | 'crab' | 'gull' | 'seaTurtle' | 'swallow' | 'gecko';

/** Natural coat colours, with the most typical first. */
export const RESIDENT_COLORS: Record<ResidentId, number[]> = {
  rabbit: [0xc2a387, 0xf1e9df, 0x978e8b],
  tanuki: [0x95795e, 0x7e776b, 0xae9272],
  fox: [0xcf703c, 0xb75936, 0xd88b4f],
  deer: [0xad7147, 0x955c40, 0xbd8754],
  duck: [0xf4f0e7, 0xe6d9ba],
  squirrel: [0xa75b36, 0x856c63, 0xbf7950],
  hedgehog: [0x78604d, 0x62534a, 0x9a8065],
  sheep: [0xf3ecdd, 0xe0d2b5, 0xc8c4bd],
  bear: [0x875c45, 0x674b3d, 0xa87a54],
  otter: [0x93684c, 0x745340, 0xab8059],
  mole: [0x4f494d, 0x5c5553],
  serow: [0xa7a29a, 0xc8c3b7, 0x8e8e85],
  stoat: [0xf6efe3, 0xe9e1d4],
  beaver: [0x986744, 0x78543e, 0xae8155],
  capybara: [0xb18a58, 0x9b744e, 0xc09b69],
  cat: [0xce894e, 0x484750, 0xd6d3ce],
};

/** Wing groups are hinge-local and lie flat in the x-z plane when spread. */
export interface WingSet {
  /** Extends along +x. Positive z rotation raises the wing. */
  left: THREE.Group;
  /** Extends along -x. Negative z rotation raises the wing. */
  right: THREE.Group;
  /** Body-space hinge for the left wing. Negate x for the right wing. */
  pivot: [number, number, number];
  /** Left-wing angle in radians when perched. Negate it for the right wing. */
  folded: number;
}

export interface VisitorParts { body: THREE.Group; wings?: WingSet }

type Point = [number, number, number];
type Side = -1 | 1;

const SIDES = [-1, 1] as const;
const INK = 0x1a1a1a;
const CREAM = 0xf5e9d7;
const DOWN = 0xf8f4eb;
const BOX = new THREE.BoxGeometry(1, 1, 1);
// Give an unrotated oval the specified extent on each axis.
const OVAL = new THREE.IcosahedronGeometry(Math.sqrt(1 + ((Math.sqrt(5) - 1) / 2) ** 2), 0);
const EYE = new THREE.IcosahedronGeometry(1, 0);
const POINT = new THREE.ConeGeometry(0.5, 1, 4);
const TUBE = new THREE.CylinderGeometry(0.5, 0.5, 1, 6);
const PANEL = new THREE.CylinderGeometry(0.55, 1, 1, 6);
const TIP = new THREE.CylinderGeometry(0.08, 1, 1, 6);
const UP = new THREE.Vector3(0, 1, 0);

function part(
  group: THREE.Group, geometry: THREE.BufferGeometry, color: number,
  x: number, y: number, z: number, sx: number, sy: number, sz: number,
  pitch = 0, yaw = 0, roll = 0,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85 }));
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  mesh.rotation.set(pitch, yaw, roll);
  mesh.castShadow = true;
  mesh.updateMatrix();
  group.add(mesh);
  return mesh;
}

function oval(
  g: THREE.Group, c: number, x: number, y: number, z: number,
  rx: number, ry: number, rz: number, pitch = 0, yaw = 0, roll = 0,
): void {
  part(g, OVAL, c, x, y, z, rx, ry, rz, pitch, yaw, roll);
}

function box(
  g: THREE.Group, c: number, x: number, y: number, z: number,
  w: number, h: number, d: number, pitch = 0, yaw = 0, roll = 0,
): void {
  part(g, BOX, c, x, y, z, w, h, d, pitch, yaw, roll);
}

function segment(
  g: THREE.Group, c: number, from: Point, to: Point,
  width: number, depth = width, geometry: THREE.BufferGeometry = BOX,
): void {
  const direction = new THREE.Vector3(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
  const mesh = part(g, geometry, c, (from[0] + to[0]) / 2, (from[1] + to[1]) / 2,
    (from[2] + to[2]) / 2, width, direction.length(), depth);
  mesh.quaternion.setFromUnitVectors(UP, direction.normalize());
  mesh.updateMatrix();
}

function eyes(g: THREE.Group, x: number, y: number, z: number, radius: number): void {
  for (const side of SIDES) {
    part(g, EYE, INK, side * x, y, z, radius, radius, radius);
    const glint = radius * 0.3;
    part(g, EYE, 0xffffff, side * (x + radius * 0.21), y + radius * 0.54, z + radius * 0.59,
      glint, glint, glint);
  }
}

function paws(g: THREE.Group, c: number, x: number, front: number, rear: number, h: number, w: number, d: number): void {
  for (const side of SIDES) {
    box(g, c, side * x, h / 2, front, w, h, d);
    box(g, c, side * x, h / 2, rear, w, h, d);
  }
}

/** Shift the actual lowest vertex to ground level and keep the merge matrices current. */
function ground(g: THREE.Group, wings?: WingSet): void {
  const vertex = new THREE.Vector3();
  let lowest = Infinity;
  for (const child of g.children) {
    if (!(child instanceof THREE.Mesh)) continue;
    const positions = child.geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      vertex.fromBufferAttribute(positions, i).applyMatrix4(child.matrix);
      lowest = Math.min(lowest, vertex.y);
    }
  }
  for (const child of g.children) {
    child.position.y -= lowest;
    child.updateMatrix();
  }
  if (wings) wings.pivot[1] -= lowest;
}

/** Build a ground resident in its selected coat colour. */
export function buildResidentModel(id: ResidentId, color: number): THREE.Group {
  const g = new THREE.Group();
  switch (id) {
    case 'rabbit': {
      // Upright pink-lined ears and a white powder-puff tail.
      oval(g, color, 0, 0.28, -0.07, 0.24, 0.25, 0.29);
      paws(g, color, 0.13, 0.18, -0.22, 0.13, 0.14, 0.19);
      oval(g, color, 0, 0.50, 0.18, 0.198, 0.186, 0.195);
      for (const s of SIDES) {
        oval(g, color, s * 0.093, 0.745, 0.151, 0.058, 0.155, 0.050, -0.09, 0, -s * 0.15);
        oval(g, 0xd89b9e, s * 0.096, 0.755, 0.185, 0.032, 0.112, 0.023, -0.09, 0, -s * 0.15);
      }
      oval(g, DOWN, 0, 0.285, -0.349, 0.095, 0.091, 0.092);
      oval(g, CREAM, 0, 0.448, 0.333, 0.106, 0.067, 0.062);
      oval(g, 0xcb8086, 0, 0.478, 0.387, 0.041, 0.027, 0.024);
      eyes(g, 0.132, 0.546, 0.307, 0.044);
      break;
    }
    case 'tanuki': {
      // A dark face band, round ears, and a thick ringed tail.
      const mask = 0x514033;
      oval(g, color, 0, 0.326, -0.06, 0.282, 0.285, 0.32);
      paws(g, mask, 0.166, 0.154, -0.222, 0.158, 0.126, 0.146);
      oval(g, color, 0, 0.540, 0.197, 0.227, 0.191, 0.204);
      oval(g, mask, 0, 0.552, 0.343, 0.209, 0.083, 0.071);
      for (const s of SIDES) oval(g, mask, s * 0.151, 0.729, 0.168, 0.073, 0.071, 0.056);
      oval(g, CREAM, 0, 0.497, 0.361, 0.125, 0.073, 0.101);
      oval(g, 0x352923, 0, 0.522, 0.443, 0.049, 0.034, 0.039);
      oval(g, color, 0, 0.275, -0.456, 0.131, 0.117, 0.212, -0.13);
      for (const [z, r] of [[-0.409, 0.13], [-0.515, 0.129], [-0.612, 0.091]] as const) {
        oval(g, mask, 0, 0.277 + (z + 0.45) * 0.13, z, r, r * 0.9, 0.037, -0.13);
      }
      eyes(g, 0.125, 0.58, 0.39, 0.048);
      break;
    }
    case 'fox': {
      // Dark-tipped ears, white bib, and a white-tipped brush.
      const dark = 0x53382d;
      oval(g, color, 0, 0.301, -0.05, 0.216, 0.207, 0.321);
      paws(g, dark, 0.125, 0.167, -0.236, 0.183, 0.092, 0.128);
      oval(g, CREAM, 0, 0.314, 0.207, 0.154, 0.182, 0.117);
      oval(g, color, 0, 0.506, 0.216, 0.205, 0.158, 0.193);
      for (const s of SIDES) {
        segment(g, color, [s * 0.105, 0.575, 0.193], [s * 0.152, 0.8, 0.181], 0.169, 0.121, POINT);
        segment(g, dark, [s * 0.135, 0.704, 0.190], [s * 0.152, 0.8, 0.181], 0.084, 0.065, POINT);
        oval(g, CREAM, s * 0.098, 0.454, 0.337, 0.105, 0.058, 0.105, 0, s * -0.33);
      }
      oval(g, CREAM, 0, 0.455, 0.415, 0.085, 0.052, 0.10);
      oval(g, 0x342722, 0, 0.474, 0.498, 0.044, 0.031, 0.031);
      oval(g, color, 0.041, 0.289, -0.48, 0.148, 0.129, 0.234, -0.21, -0.26);
      oval(g, DOWN, 0.105, 0.321, -0.657, 0.115, 0.103, 0.109, -0.21, -0.33);
      eyes(g, 0.123, 0.535, 0.352, 0.043);
      break;
    }
    case 'deer': {
      // Long legs, short forked antlers, and a spotted saddle.
      const hoof = 0x514034;
      const antler = 0xa28665;
      oval(g, color, 0, 0.669, -0.05, 0.223, 0.257, 0.405);
      for (const s of SIDES) {
        segment(g, color, [s * 0.116, 0.061, 0.216], [s * 0.132, 0.627, 0.221], 0.070, 0.077);
        segment(g, color, [s * 0.132, 0.061, -0.302], [s * 0.146, 0.631, -0.282], 0.076, 0.095);
        box(g, hoof, s * 0.116, 0.05, 0.224, 0.079, 0.1, 0.094);
        box(g, hoof, s * 0.132, 0.05, -0.293, 0.081, 0.1, 0.096);
        for (const [y, z] of [[0.869, 0.077], [0.885, -0.077], [0.85, -0.226]] as const) {
          oval(g, CREAM, s * 0.103, y, z, 0.034, 0.023, 0.042);
        }
        oval(g, CREAM, s * 0.170, 0.792, -0.155, 0.032, 0.033, 0.044);
      }
      segment(g, color, [0, 0.677, 0.176], [0, 1.091, 0.328], 0.206, 0.209, TUBE);
      oval(g, color, 0, 1.09, 0.336, 0.144, 0.146, 0.175);
      oval(g, CREAM, 0, 1.038, 0.475, 0.094, 0.067, 0.11);
      oval(g, hoof, 0, 1.054, 0.566, 0.045, 0.028, 0.031);
      oval(g, DOWN, 0, 0.708, -0.404, 0.121, 0.100, 0.062);
      oval(g, CREAM, 0, 0.755, -0.453, 0.054, 0.064, 0.074, -0.5);
      for (const s of SIDES) {
        oval(g, color, s * 0.151, 1.168, 0.292, 0.104, 0.044, 0.056, 0, 0, s * 0.34);
        oval(g, CREAM, s * 0.169, 1.174, 0.321, 0.068, 0.025, 0.027, 0, 0, s * 0.34);
        segment(g, antler, [s * 0.078, 1.184, 0.29], [s * 0.135, 1.443, 0.23], 0.039);
        segment(g, antler, [s * 0.106, 1.311, 0.255], [s * 0.172, 1.401, 0.282], 0.031);
      }
      eyes(g, 0.104, 1.125, 0.45, 0.034);
      break;
    }
    case 'duck': {
      // A flat orange bill and broad webbed feet under a white body.
      const orange = 0xe69a42;
      oval(g, color, 0, 0.218, -0.058, 0.202, 0.169, 0.273);
      oval(g, color, 0, 0.407, 0.141, 0.146, 0.143, 0.139);
      box(g, orange, 0, 0.371, 0.29, 0.122, 0.043, 0.153, 0.09);
      segment(g, color, [0, 0.23, -0.233], [0, 0.336, -0.349], 0.19, 0.084, POINT);
      for (const s of SIDES) {
        oval(g, DOWN, s * 0.154, 0.242, -0.104, 0.064, 0.078, 0.172, -0.22);
        box(g, orange, s * 0.077, 0.062, 0.03, 0.046, 0.092, 0.052);
        box(g, orange, s * 0.087, 0.022, 0.068, 0.105, 0.044, 0.131, 0, s * 0.14);
      }
      eyes(g, 0.103, 0.437, 0.239, 0.034);
      break;
    }
    case 'squirrel': {
      // The bushy tail curls forward over the back, above a pale belly.
      oval(g, color, 0, 0.224, -0.015, 0.148, 0.201, 0.159);
      oval(g, CREAM, 0, 0.216, 0.101, 0.102, 0.147, 0.075);
      oval(g, color, 0, 0.422, 0.116, 0.139, 0.122, 0.133);
      oval(g, color, 0, 0.198, -0.209, 0.104, 0.111, 0.164, 0.34);
      oval(g, color, 0, 0.373, -0.314, 0.129, 0.204, 0.145, -0.34);
      oval(g, color, 0, 0.481, -0.202, 0.111, 0.109, 0.172, -0.30);
      for (const s of SIDES) {
        segment(g, color, [s * 0.072, 0.464, 0.102], [s * 0.101, 0.6, 0.081], 0.091, 0.072, POINT);
        box(g, color, s * 0.091, 0.043, 0.041, 0.103, 0.086, 0.168);
        oval(g, color, s * 0.104, 0.210, 0.13, 0.052, 0.09, 0.059, -0.5);
      }
      oval(g, CREAM, 0, 0.378, 0.212, 0.071, 0.049, 0.052);
      oval(g, 0x49312c, 0, 0.4, 0.256, 0.024, 0.019, 0.019);
      eyes(g, 0.095, 0.449, 0.212, 0.033);
      break;
    }
    case 'hedgehog': {
      // Three staggered rows of chunky spines leave the pale snout clear.
      oval(g, color, 0, 0.148, -0.06, 0.198, 0.155, 0.238);
      paws(g, 0x906d57, 0.087, 0.123, -0.171, 0.059, 0.077, 0.110);
      for (const [x, y, z, height] of [
        [0, 0.257, -0.215, 0.081], [0, 0.263, -0.102, 0.087], [0, 0.259, 0.02, 0.088],
        [0.091, 0.232, -0.18, 0.094], [0.109, 0.243, -0.065, 0.096], [0.087, 0.228, 0.064, 0.093],
        [0.15, 0.177, -0.141, 0.088], [0.151, 0.179, -0.007, 0.087],
      ] as const) {
        for (const s of x === 0 ? [1] : SIDES) {
          segment(g, z < -0.15 ? color : 0x665040, [s * x, y, z],
            [s * (x + x * 0.36), y + height, z - 0.039], 0.106, 0.106, POINT);
        }
      }
      oval(g, 0xd9bd9d, 0, 0.119, 0.148, 0.121, 0.102, 0.145);
      oval(g, 0xe1c5a7, 0, 0.102, 0.251, 0.070, 0.053, 0.073);
      oval(g, 0x352a26, 0, 0.108, 0.313, 0.030, 0.026, 0.024);
      for (const s of SIDES) oval(g, 0xb68f77, s * 0.103, 0.184, 0.12, 0.042, 0.036, 0.031);
      eyes(g, 0.087, 0.151, 0.227, 0.029);
      break;
    }
    case 'sheep': {
      // Overlapping wool clumps, lateral ears, and slim charcoal legs.
      const face = 0x605956;
      const legs = 0x4b484a;
      oval(g, color, 0, 0.5, -0.06, 0.313, 0.301, 0.361);
      paws(g, legs, 0.144, 0.169, -0.234, 0.316, 0.071, 0.090);
      for (const s of SIDES) {
        oval(g, color, s * 0.181, 0.643, -0.202, 0.183, 0.180, 0.190, 0.13);
        oval(g, color, s * 0.191, 0.645, 0.018, 0.178, 0.177, 0.190, -0.23);
        oval(g, color, s * 0.168, 0.428, -0.115, 0.186, 0.190, 0.232, 0, 0, s * 0.23);
        oval(g, face, s * 0.174, 0.638, 0.267, 0.122, 0.047, 0.068, 0, 0, -s * 0.24);
      }
      oval(g, color, 0, 0.739, -0.098, 0.223, 0.161, 0.240);
      oval(g, color, 0, 0.505, -0.401, 0.088, 0.104, 0.087);
      oval(g, face, 0, 0.607, 0.266, 0.162, 0.180, 0.157);
      oval(g, face, 0, 0.520, 0.379, 0.105, 0.080, 0.077);
      oval(g, color, 0, 0.761, 0.282, 0.169, 0.083, 0.114);
      eyes(g, 0.108, 0.655, 0.374, 0.039);
      break;
    }
    case 'bear': {
      // A broad, heavy body with round button ears and a light muzzle.
      oval(g, color, 0, 0.538, -0.111, 0.401, 0.379, 0.502);
      oval(g, color, 0, 0.568, 0.193, 0.341, 0.343, 0.324);
      paws(g, color, 0.227, 0.221, -0.34, 0.354, 0.199, 0.233);
      oval(g, color, 0, 0.850, 0.344, 0.294, 0.249, 0.261);
      for (const s of SIDES) {
        oval(g, color, s * 0.202, 1.09, 0.293, 0.112, 0.109, 0.078);
        oval(g, 0xae806e, s * 0.206, 1.09, 0.346, 0.071, 0.069, 0.036);
      }
      oval(g, 0xd5ac85, 0, 0.789, 0.551, 0.174, 0.108, 0.118);
      oval(g, INK, 0, 0.828, 0.647, 0.073, 0.046, 0.041);
      oval(g, color, 0, 0.454, -0.598, 0.099, 0.098, 0.087);
      eyes(g, 0.167, 0.897, 0.531, 0.056);
      break;
    }
    case 'otter': {
      // A low river otter with a pale throat and a tapered swimming tail.
      oval(g, color, 0, 0.204, -0.072, 0.190, 0.170, 0.345);
      paws(g, color, 0.115, 0.161, -0.238, 0.123, 0.112, 0.145);
      oval(g, 0xd4b08e, 0, 0.224, 0.208, 0.139, 0.129, 0.115);
      oval(g, color, 0, 0.372, 0.224, 0.167, 0.152, 0.167);
      for (const s of SIDES) oval(g, color, s * 0.123, 0.494, 0.196, 0.056, 0.056, 0.043);
      oval(g, 0xe4c6a2, 0, 0.326, 0.347, 0.137, 0.073, 0.106);
      oval(g, 0x47312b, 0, 0.35, 0.439, 0.052, 0.033, 0.029);
      oval(g, color, 0.043, 0.116, -0.389, 0.122, 0.079, 0.168, -0.23, -0.28);
      oval(g, color, 0.125, 0.078, -0.548, 0.072, 0.052, 0.143, -0.07, -0.51);
      eyes(g, 0.105, 0.406, 0.349, 0.036);
      break;
    }
    case 'mole': {
      // Broad pink digging shovels frame a small pointed muzzle.
      const pink = 0xd49294;
      oval(g, color, 0, 0.169, -0.045, 0.194, 0.179, 0.243);
      oval(g, 0x655b5d, 0, 0.176, 0.143, 0.138, 0.119, 0.145);
      oval(g, 0xaf747a, 0, 0.135, 0.251, 0.071, 0.048, 0.095, 0.14);
      oval(g, pink, 0, 0.127, 0.331, 0.037, 0.031, 0.025);
      for (const s of SIDES) {
        box(g, 0xba7e84, s * 0.103, 0.034, -0.139, 0.085, 0.068, 0.093);
        oval(g, color, s * 0.147, 0.090, 0.103, 0.087, 0.074, 0.082);
        box(g, pink, s * 0.203, 0.046, 0.138, 0.127, 0.064, 0.117, 0, -s * 0.48);
        for (const z of [0.123, 0.159, 0.195]) box(g, 0xefb6b1, s * 0.260, 0.048, z, 0.047, 0.032, 0.025);
      }
      eyes(g, 0.113, 0.211, 0.24, 0.025);
      break;
    }
    case 'serow': {
      // A shaggy mountain goat silhouette with short swept-back black horns.
      const leg = 0x504b48;
      const cheek = 0xc4beb1;
      oval(g, color, 0, 0.621, -0.06, 0.285, 0.304, 0.399);
      oval(g, color, 0, 0.729, 0.154, 0.253, 0.281, 0.248);
      paws(g, leg, 0.160, 0.178, -0.270, 0.448, 0.108, 0.125);
      oval(g, color, 0, 0.915, 0.262, 0.171, 0.169, 0.167);
      oval(g, cheek, 0, 0.869, 0.382, 0.116, 0.103, 0.119);
      oval(g, leg, 0, 0.864, 0.481, 0.056, 0.036, 0.029);
      for (const s of SIDES) {
        oval(g, color, s * 0.191, 0.964, 0.218, 0.103, 0.050, 0.065, 0, 0, s * 0.36);
        oval(g, cheek, s * 0.141, 0.759, 0.244, 0.109, 0.151, 0.101, 0.31, 0, s * 0.3);
        segment(g, color, [s * 0.21, 0.55, -0.12], [s * 0.246, 0.325, -0.20], 0.192, 0.205, POINT);
        segment(g, color, [s * 0.158, 0.52, 0.141], [s * 0.186, 0.328, 0.169], 0.172, 0.162, POINT);
        segment(g, 0x33312f, [s * 0.083, 1.011, 0.242], [s * 0.105, 1.2, 0.131], 0.084, 0.081, POINT);
      }
      oval(g, color, 0, 0.553, -0.453, 0.073, 0.105, 0.084, -0.37);
      eyes(g, 0.118, 0.942, 0.372, 0.036);
      break;
    }
    case 'stoat': {
      // A slim winter-white body and a conspicuous black tail tip.
      oval(g, color, 0, 0.155, -0.057, 0.127, 0.129, 0.292);
      paws(g, color, 0.088, 0.132, -0.218, 0.09, 0.080, 0.107);
      oval(g, color, 0, 0.224, 0.166, 0.118, 0.126, 0.157, 0.4);
      oval(g, color, 0, 0.311, 0.251, 0.128, 0.109, 0.135);
      oval(g, DOWN, 0, 0.279, 0.356, 0.081, 0.060, 0.082);
      oval(g, 0x493934, 0, 0.297, 0.428, 0.027, 0.021, 0.024);
      for (const s of SIDES) {
        oval(g, color, s * 0.091, 0.400, 0.221, 0.050, 0.050, 0.039);
        oval(g, 0xcdaaa0, s * 0.093, 0.404, 0.249, 0.029, 0.031, 0.019);
      }
      oval(g, color, 0.024, 0.148, -0.361, 0.061, 0.054, 0.150, -0.25, -0.3);
      oval(g, 0x3a3233, 0.081, 0.100, -0.499, 0.049, 0.042, 0.102, -0.22, -0.43);
      eyes(g, 0.086, 0.334, 0.347, 0.028);
      break;
    }
    case 'beaver': {
      // The wide paddle and the two orange incisors identify the beaver.
      const paddle = 0x594238;
      oval(g, color, 0, 0.242, -0.086, 0.252, 0.225, 0.301);
      paws(g, 0x76523c, 0.152, 0.134, -0.206, 0.138, 0.136, 0.155);
      oval(g, color, 0, 0.408, 0.151, 0.194, 0.156, 0.173);
      box(g, paddle, 0, 0.084, -0.365, 0.173, 0.071, 0.250, -0.35);
      box(g, paddle, 0, 0.038, -0.547, 0.244, 0.069, 0.204, 0, 0.05);
      oval(g, paddle, 0, 0.040, -0.633, 0.108, 0.033, 0.076);
      for (const s of SIDES) {
        oval(g, color, s * 0.13, 0.548, 0.131, 0.058, 0.052, 0.046);
        box(g, 0xde964d, s * 0.025, 0.30, 0.366, 0.044, 0.082, 0.037, -0.12);
        oval(g, 0xc69b73, s * 0.059, 0.367, 0.306, 0.089, 0.076, 0.079);
      }
      oval(g, 0x523a30, 0, 0.41, 0.361, 0.052, 0.031, 0.032);
      eyes(g, 0.128, 0.445, 0.272, 0.039);
      break;
    }
    case 'capybara': {
      // A broad barrel, little high-set ears, and a long squared-off nose.
      oval(g, color, 0, 0.338, -0.112, 0.244, 0.287, 0.385);
      paws(g, 0x8d694b, 0.145, 0.147, -0.307, 0.218, 0.11, 0.132);
      oval(g, color, 0, 0.475, 0.191, 0.189, 0.186, 0.245);
      box(g, color, 0, 0.392, 0.336, 0.269, 0.206, 0.208, 0.11);
      oval(g, 0xa3805c, 0, 0.427, 0.427, 0.131, 0.073, 0.046);
      for (const s of SIDES) {
        oval(g, 0x8a694e, s * 0.113, 0.645, 0.163, 0.049, 0.055, 0.045, 0, 0, -s * 0.18);
        oval(g, 0x785946, s * 0.062, 0.456, 0.448, 0.020, 0.012, 0.014);
      }
      eyes(g, 0.144, 0.525, 0.325, 0.034);
      break;
    }
    case 'cat': {
      // Pointed ears and a raised hooked tail stay visible above the body.
      oval(g, color, 0, 0.267, -0.082, 0.174, 0.184, 0.287);
      paws(g, color, 0.112, 0.127, -0.234, 0.154, 0.084, 0.114);
      oval(g, color, 0, 0.46, 0.169, 0.173, 0.143, 0.157);
      for (const s of SIDES) {
        segment(g, color, [s * 0.097, 0.51, 0.145], [s * 0.142, 0.7, 0.13], 0.154, 0.109, POINT);
        segment(g, 0xc0908d, [s * 0.103, 0.547, 0.189], [s * 0.133, 0.662, 0.153], 0.085, 0.045, POINT);
        oval(g, 0xdfcabb, s * 0.045, 0.410, 0.301, 0.065, 0.045, 0.043);
      }
      oval(g, 0xbe8284, 0, 0.433, 0.339, 0.027, 0.018, 0.018);
      oval(g, color, 0, 0.296, -0.325, 0.063, 0.093, 0.074, -0.68);
      segment(g, color, [0, 0.31, -0.35], [0, 0.537, -0.434], 0.094, 0.092, TUBE);
      oval(g, color, 0.012, 0.54, -0.435, 0.053, 0.078, 0.054, 0.2, 0, -0.23);
      oval(g, color, 0.051, 0.612, -0.393, 0.086, 0.050, 0.053, 0, -0.52, 0.13);
      if (color === RESIDENT_COLORS.cat[0]) {
        const stripe = 0xa55f35;
        for (const z of [-0.237, -0.115, 0.006]) oval(g, stripe, 0, 0.419, z, 0.142, 0.041, 0.032);
        for (const s of SIDES) oval(g, stripe, s * 0.048, 0.579, 0.202, 0.017, 0.025, 0.052, 0, s * 0.2);
      }
      eyes(g, 0.098, 0.501, 0.29, 0.04);
      break;
    }
  }
  ground(g);
  return g;
}

function wingSet(pivot: Point, folded: number, build: (group: THREE.Group, side: Side) => void): WingSet {
  const left = new THREE.Group();
  const right = new THREE.Group();
  build(left, 1);
  build(right, -1);
  return { left, right, pivot, folded };
}

/** Flatten a tapered prism and sweep it between two points in the wing plane. */
function blade(
  g: THREE.Group, c: number, side: Side, x0: number, z0: number, x1: number, z1: number,
  chord: number, thickness: number, y = 0, pointed = false,
): void {
  const dx = x1 - x0;
  const dz = z1 - z0;
  part(g, pointed ? TIP : PANEL, c, side * (x0 + x1) / 2, y, (z0 + z1) / 2,
    thickness / Math.sqrt(3), Math.hypot(dx, dz), chord / 2,
    0, -side * Math.atan2(dz, dx), -side * Math.PI / 2);
}

function birdWings(
  pivot: Point, folded: number, reach: number, chord: number, sweep: number,
  coverts: number, flights: number, accent?: number,
): WingSet {
  return wingSet(pivot, folded, (g, side) => {
    const thickness = Math.min(0.046, chord * 0.27);
    blade(g, coverts, side, -0.02, 0, reach * 0.62, -sweep * 0.4, chord, thickness);
    blade(g, flights, side, reach * 0.42, -sweep * 0.28, reach, -sweep, chord * 0.67, thickness * 0.65, 0, true);
    if (accent !== undefined) {
      blade(g, accent, side, reach * 0.06, chord * 0.19, reach * 0.57, -sweep * 0.29 + chord * 0.14,
        chord * 0.31, thickness * 0.44, thickness * 0.41);
    }
  });
}

function birdFeet(g: THREE.Group, c: number, x: number, z: number, h: number, length: number): void {
  for (const s of SIDES) {
    box(g, c, s * x, h * 0.53, z, length * 0.33, h * 0.94, length * 0.4);
    box(g, c, s * x, length * 0.12, z + length * 0.20, length * 0.51, length * 0.24, length, 0, s * 0.13);
  }
}

/** Build a visitor with independently hinged wings where applicable. */
export function buildVisitorParts(id: VisitorModelId): VisitorParts {
  const body = new THREE.Group();
  const g = body;
  let wings: WingSet | undefined;
  switch (id) {
    case 'butterfly': {
      // Orange forewings and hindwings each carry a broad chocolate edge.
      const edge = 0x513029;
      oval(g, edge, 0, 0.031, -0.022, 0.031, 0.028, 0.070);
      oval(g, 0x79513a, 0, 0.048, 0.018, 0.037, 0.034, 0.039);
      oval(g, 0x634536, 0, 0.055, 0.052, 0.036, 0.033, 0.036);
      for (const s of SIDES) {
        segment(g, edge, [s * 0.018, 0.075, 0.068], [s * 0.038, 0.102, 0.100], 0.008);
        oval(g, edge, s * 0.039, 0.103, 0.102, 0.009, 0.008, 0.009);
      }
      eyes(g, 0.025, 0.064, 0.075, 0.025);
      wings = wingSet([0.019, 0.06, 0], 1.35, (wing, side) => {
        oval(wing, edge, side * 0.065, 0, 0.037, 0.081, 0.009, 0.067, 0, -side * 0.44);
        oval(wing, edge, side * 0.055, 0, -0.048, 0.071, 0.009, 0.059, 0, side * 0.2);
        oval(wing, 0xf2913a, side * 0.063, 0.006, 0.039, 0.065, 0.006, 0.053, 0, -side * 0.44);
        oval(wing, 0xdf7435, side * 0.052, 0.006, -0.045, 0.055, 0.006, 0.045, 0, side * 0.2);
        oval(wing, 0xffc573, side * 0.11, 0.011, 0.058, 0.019, 0.003, 0.012, 0, side * 0.3);
      });
      break;
    }
    case 'bee': {
      // A honey-yellow abdomen with dark bands and two pale-blue wings.
      const band = 0x57402b;
      oval(g, 0xe8b54e, 0, 0.040, -0.030, 0.036, 0.035, 0.054);
      oval(g, band, 0, 0.040, -0.054, 0.033, 0.032, 0.013);
      oval(g, band, 0, 0.041, -0.020, 0.037, 0.035, 0.011);
      oval(g, 0xb67d37, 0, 0.044, 0.009, 0.034, 0.032, 0.028);
      oval(g, 0x9a6636, 0, 0.05, 0.034, 0.032, 0.030, 0.025);
      for (const s of SIDES) {
        segment(g, band, [s * 0.010, 0.069, 0.047], [s * 0.023, 0.092, 0.059], 0.007);
        for (const z of [-0.026, -0.004, 0.019]) {
          segment(g, band, [s * 0.020, 0.030, z], [s * 0.035, 0.004, z + 0.009], 0.007);
        }
      }
      eyes(g, 0.023, 0.056, 0.045, 0.025);
      wings = wingSet([0.013, 0.065, 0], 1.05, (wing, side) => {
        oval(wing, 0xbad9e8, side * 0.024, 0, -0.019, 0.037, 0.005, 0.018, 0, side * 0.46);
        oval(wing, 0xe1f0f4, side * 0.025, 0.003, -0.018, 0.025, 0.003, 0.012, 0, side * 0.46);
      });
      break;
    }
    case 'sparrow': {
      // A chestnut cap, light cheeks, and a short seed-cracking bill.
      const cap = 0x89583e;
      oval(g, 0xa67d5d, 0, 0.112, -0.032, 0.089, 0.082, 0.106);
      oval(g, 0xd4b99c, 0, 0.10, 0.022, 0.075, 0.07, 0.074);
      oval(g, cap, 0, 0.167, 0.052, 0.081, 0.072, 0.080);
      for (const s of SIDES) {
        oval(g, CREAM, s * 0.053, 0.153, 0.086, 0.035, 0.033, 0.041);
        oval(g, 0x624638, s * 0.078, 0.145, 0.090, 0.013, 0.015, 0.014);
      }
      segment(g, 0x57443a, [0, 0.15, 0.112], [0, 0.143, 0.153], 0.048, 0.038, POINT);
      box(g, 0x71523e, 0, 0.108, -0.143, 0.078, 0.028, 0.106, 0.15);
      birdFeet(g, 0xae816d, 0.038, 0.004, 0.056, 0.054);
      eyes(g, 0.052, 0.182, 0.111, 0.025);
      wings = birdWings([0.063, 0.139, -0.005], -1.14, 0.123, 0.120, 0.037, 0x956b4d, 0x735440, 0xc0a181);
      break;
    }
    case 'frog': {
      // Raised pale eye pads and folded haunches define the squat silhouette.
      oval(g, 0x71934f, 0, 0.093, -0.034, 0.135, 0.091, 0.161);
      oval(g, 0x86a95e, 0, 0.118, 0.079, 0.136, 0.077, 0.102);
      oval(g, 0xcbd299, 0, 0.073, 0.121, 0.110, 0.054, 0.067);
      for (const s of SIDES) {
        oval(g, 0x638348, s * 0.112, 0.058, -0.081, 0.079, 0.058, 0.093, 0, s * 0.3);
        box(g, 0x709951, s * 0.132, 0.019, -0.010, 0.081, 0.038, 0.099, 0, s * 0.43);
        box(g, 0x83a456, s * 0.074, 0.014, 0.095, 0.055, 0.028, 0.082, 0, s * 0.28);
        oval(g, 0x83a456, s * 0.085, 0.186, 0.092, 0.055, 0.063, 0.051);
        oval(g, 0xe0d7a7, s * 0.093, 0.194, 0.118, 0.043, 0.043, 0.035);
      }
      eyes(g, 0.098, 0.205, 0.144, 0.033);
      break;
    }
    case 'fish': {
      // A silver belly, blue dorsal ridge, and a forked vertical tail.
      const fin = 0x527789;
      oval(g, 0x638898, 0, 0.091, 0.023, 0.090, 0.088, 0.192);
      oval(g, 0xc8dad7, 0, 0.057, 0.059, 0.076, 0.051, 0.150);
      oval(g, 0x7d9da7, 0, 0.091, 0.158, 0.070, 0.069, 0.073);
      oval(g, fin, 0, 0.081, -0.163, 0.037, 0.034, 0.092);
      segment(g, fin, [0, 0.080, -0.223], [0, 0.151, -0.37], 0.085, 0.038, POINT);
      segment(g, fin, [0, 0.065, -0.230], [0, 0.008, -0.349], 0.069, 0.034, POINT);
      segment(g, fin, [0, 0.145, 0.031], [0, 0.225, -0.079], 0.13, 0.027, POINT);
      for (const s of SIDES) oval(g, 0x8facb8, s * 0.074, 0.055, 0.036, 0.061, 0.015, 0.075, 0, -s * 0.63);
      eyes(g, 0.055, 0.116, 0.182, 0.027);
      break;
    }
    case 'dragonfly': {
      // A long blue abdomen and two narrow wings on each hinge.
      oval(g, 0x386d81, 0, 0.036, -0.108, 0.022, 0.023, 0.152);
      oval(g, 0x498da0, 0, 0.048, -0.013, 0.039, 0.037, 0.066);
      oval(g, 0x548f92, 0, 0.053, 0.055, 0.044, 0.036, 0.044);
      for (const z of [-0.174, -0.131, -0.088]) oval(g, 0x6c9ea7, 0, 0.044, z, 0.019, 0.021, 0.009);
      for (const s of SIDES) segment(g, 0x46696c, [s * 0.018, 0.036, 0.015], [s * 0.039, 0.003, 0.051], 0.01);
      eyes(g, 0.034, 0.063, 0.076, 0.028);
      wings = wingSet([0.022, 0.069, 0.002], 0.95, (wing, side) => {
        blade(wing, 0xd2e5ef, side, -0.013, 0.023, 0.171, 0.046, 0.059, 0.007, 0, true);
        blade(wing, 0xbddae6, side, -0.013, -0.025, 0.155, -0.060, 0.064, 0.007, -0.002, true);
        blade(wing, 0xeaf3f4, side, 0.003, 0.026, 0.14, 0.045, 0.015, 0.003, 0.003, true);
        blade(wing, 0xddeef1, side, 0.003, -0.022, 0.126, -0.052, 0.016, 0.003, 0.001, true);
      });
      break;
    }
    case 'woodpecker': {
      // A red cap, bold white cheeks, and stiff prop-like tail feathers.
      const black = 0x39383d;
      oval(g, black, 0, 0.157, -0.052, 0.087, 0.129, 0.126, 0.36);
      oval(g, DOWN, 0, 0.157, 0.012, 0.071, 0.095, 0.091, 0.33);
      oval(g, black, 0, 0.272, 0.050, 0.077, 0.072, 0.088);
      oval(g, 0xb94942, 0, 0.324, 0.038, 0.068, 0.035, 0.077, -0.14);
      for (const s of SIDES) oval(g, DOWN, s * 0.056, 0.263, 0.083, 0.037, 0.047, 0.052);
      segment(g, 0x62606a, [0, 0.27, 0.109], [0, 0.262, 0.192], 0.047, 0.042, POINT);
      box(g, black, 0, 0.09, -0.175, 0.078, 0.027, 0.165, -0.23);
      oval(g, 0xb4564c, 0, 0.093, -0.107, 0.061, 0.058, 0.058);
      birdFeet(g, 0x7c695f, 0.036, -0.012, 0.069, 0.058);
      eyes(g, 0.055, 0.291, 0.112, 0.025);
      wings = birdWings([0.063, 0.203, -0.04], -1.16, 0.163, 0.136, 0.056, black, 0x4a4851, DOWN);
      break;
    }
    case 'snail': {
      // A side-visible spiral on a round shell and two tall eye stalks.
      const flesh = 0xcab091;
      box(g, flesh, 0, 0.015, -0.006, 0.085, 0.030, 0.228);
      oval(g, flesh, 0, 0.034, 0.080, 0.045, 0.034, 0.049);
      oval(g, 0xaa774d, 0, 0.089, -0.034, 0.078, 0.083, 0.078);
      for (const s of SIDES) {
        oval(g, 0xba8a59, s * 0.052, 0.091, -0.031, 0.038, 0.067, 0.064);
        let previous: Point = [s * 0.068, 0.097, -0.077];
        for (const [x, y, z] of [
          [0.072, 0.126, -0.063], [0.078, 0.139, -0.035], [0.077, 0.128, -0.003],
          [0.085, 0.101, 0.010], [0.088, 0.078, -0.009], [0.087, 0.079, -0.038],
          [0.091, 0.097, -0.048], [0.092, 0.108, -0.032],
        ] as const) {
          const next: Point = [s * x, y, z];
          segment(g, 0x82583f, previous, next, 0.012);
          previous = next;
        }
        segment(g, flesh, [s * 0.024, 0.04, 0.082], [s * 0.041, 0.107, 0.104], 0.021, 0.021, TUBE);
        oval(g, 0xe0c7a5, s * 0.041, 0.104, 0.105, 0.021, 0.021, 0.019);
      }
      eyes(g, 0.043, 0.112, 0.116, 0.025);
      break;
    }
    case 'longtailedTit': {
      // A tiny white snowball on a thin, dark tail almost as long as its body.
      const tail = 0x4a4149;
      oval(g, DOWN, 0, 0.103, -0.038, 0.096, 0.085, 0.113);
      oval(g, 0xfffbf1, 0, 0.148, 0.042, 0.087, 0.079, 0.088);
      for (const s of SIDES) {
        box(g, tail, s * 0.012, 0.113, -0.207, 0.024, 0.021, 0.189, 0.12, -s * 0.058);
        oval(g, 0xc9a2a0, s * 0.070, 0.14, -0.075, 0.030, 0.045, 0.054);
      }
      segment(g, 0x4e4342, [0, 0.135, 0.105], [0, 0.128, 0.148], 0.034, 0.027, POINT);
      birdFeet(g, 0x8d7063, 0.036, -0.021, 0.051, 0.050);
      eyes(g, 0.055, 0.165, 0.106, 0.025);
      wings = birdWings([0.065, 0.137, -0.048], -1.13, 0.127, 0.125, 0.048, 0x71666b, tail, 0xe5d9d1);
      break;
    }
    case 'owl': {
      // A round body, raised ear tufts, and large pale facial discs.
      const feather = 0x937151;
      oval(g, feather, 0, 0.225, -0.030, 0.183, 0.199, 0.151);
      oval(g, 0xceae7f, 0, 0.201, 0.059, 0.131, 0.147, 0.099);
      oval(g, 0xa27d59, 0, 0.365, 0.035, 0.178, 0.139, 0.136);
      for (const s of SIDES) {
        segment(g, feather, [s * 0.109, 0.436, 0.012], [s * 0.155, 0.55, -0.005], 0.099, 0.078, POINT);
        oval(g, 0xe9c993, s * 0.072, 0.367, 0.138, 0.089, 0.092, 0.048, 0, s * 0.27);
        oval(g, 0xf5dfa8, s * 0.078, 0.38, 0.164, 0.058, 0.063, 0.036, 0, s * 0.24);
        oval(g, 0xb99a73, s * 0.049, 0.205, 0.144, 0.020, 0.048, 0.014, 0, 0, s * 0.22);
      }
      segment(g, 0xc68845, [0, 0.352, 0.168], [0, 0.296, 0.206], 0.057, 0.054, POINT);
      box(g, feather, 0, 0.105, -0.157, 0.115, 0.058, 0.121, 0.35);
      birdFeet(g, 0xb2804d, 0.075, 0.024, 0.071, 0.079);
      eyes(g, 0.078, 0.39, 0.192, 0.046);
      wings = birdWings([0.133, 0.307, -0.014], -1.32, 0.238, 0.174, 0.072, 0x846348, 0x6a5143, 0xac8c68);
      break;
    }
    case 'kingfisher': {
      // Electric blue upperparts, a copper belly, and a long dark dagger bill.
      oval(g, 0x2587ae, 0, 0.126, -0.043, 0.090, 0.091, 0.114);
      oval(g, 0xd78343, 0, 0.105, 0.002, 0.078, 0.066, 0.099);
      oval(g, 0x227e9f, 0, 0.192, 0.055, 0.085, 0.080, 0.092);
      oval(g, 0x42b0c6, 0, 0.246, 0.039, 0.072, 0.033, 0.078);
      for (const s of SIDES) oval(g, CREAM, s * 0.064, 0.167, 0.077, 0.034, 0.033, 0.052);
      segment(g, 0x3d414e, [0, 0.185, 0.114], [0, 0.154, 0.267], 0.061, 0.046, POINT);
      box(g, 0x286e94, 0, 0.094, -0.135, 0.071, 0.028, 0.096, -0.15);
      birdFeet(g, 0xb97151, 0.040, -0.011, 0.056, 0.052);
      eyes(g, 0.053, 0.209, 0.121, 0.027);
      wings = birdWings([0.068, 0.163, -0.02], -1.09, 0.151, 0.123, 0.036, 0x258db9, 0x2c72a3, 0x4db8ca);
      break;
    }
    case 'mejiro': {
      // Japanese white-eye with crisp white rings and a lemon throat.
      const olive = 0x81974f;
      oval(g, olive, 0, 0.108, -0.031, 0.075, 0.078, 0.100);
      oval(g, 0xd1c5a1, 0, 0.087, 0.008, 0.067, 0.059, 0.073);
      oval(g, olive, 0, 0.154, 0.063, 0.075, 0.067, 0.077);
      oval(g, 0xd8ca69, 0, 0.119, 0.1, 0.059, 0.043, 0.053);
      for (const s of SIDES) oval(g, 0xffffff, s * 0.054, 0.174, 0.113, 0.035, 0.037, 0.024, 0, s * 0.61);
      segment(g, 0x514d42, [0, 0.149, 0.12], [0, 0.143, 0.166], 0.037, 0.030, POINT);
      box(g, 0x647653, 0, 0.105, -0.137, 0.059, 0.022, 0.091, 0.15);
      birdFeet(g, 0x8f8470, 0.035, -0.004, 0.058, 0.047);
      eyes(g, 0.061, 0.18, 0.128, 0.025);
      wings = birdWings([0.059, 0.123, -0.015], -1.13, 0.117, 0.115, 0.04, 0x788e50, 0x627352, 0xa2aa65);
      break;
    }
    case 'skylark': {
      // A swept crest and dark feather streaks across a sandy chest.
      const bark = 0x80624d;
      oval(g, 0x9e7c60, 0, 0.118, -0.037, 0.088, 0.089, 0.118);
      oval(g, 0xddc5a3, 0, 0.11, 0.029, 0.075, 0.075, 0.081);
      oval(g, 0xa68568, 0, 0.169, 0.054, 0.076, 0.069, 0.083);
      segment(g, bark, [0, 0.211, 0.064], [0, 0.269, 0.007], 0.070, 0.065, POINT);
      for (const s of SIDES) {
        oval(g, bark, s * 0.040, 0.127, 0.091, 0.018, 0.041, 0.022, -0.35, 0, -s * 0.28);
        oval(g, bark, s * 0.054, 0.157, -0.070, 0.030, 0.041, 0.055, 0, s * 0.16);
      }
      segment(g, 0x6e5545, [0, 0.155, 0.115], [0, 0.145, 0.176], 0.042, 0.030, POINT);
      box(g, bark, 0, 0.104, -0.153, 0.076, 0.030, 0.139, 0.19);
      birdFeet(g, 0xa0775f, 0.037, 0, 0.057, 0.054);
      eyes(g, 0.055, 0.188, 0.118, 0.025);
      wings = birdWings([0.064, 0.143, -0.008], -1.12, 0.132, 0.128, 0.052, 0x9b7859, bark, 0xc3a381);
      break;
    }
    case 'cricket': {
      // High bent jumping legs and fine antennae stretch the silhouette.
      const leg = 0x634737;
      oval(g, 0x695140, 0, 0.040, -0.052, 0.040, 0.034, 0.061);
      oval(g, 0x80644a, 0, 0.052, -0.030, 0.038, 0.025, 0.066);
      oval(g, 0x635045, 0, 0.048, 0.023, 0.041, 0.032, 0.034);
      for (const s of SIDES) {
        segment(g, leg, [s * 0.028, 0.045, -0.042], [s * 0.065, 0.102, -0.018], 0.028, 0.032, TUBE);
        segment(g, leg, [s * 0.065, 0.11, -0.018], [s * 0.077, 0.013, -0.089], 0.014);
        box(g, leg, s * 0.077, 0.007, -0.090, 0.016, 0.014, 0.033);
        for (const z of [-0.015, 0.018]) segment(g, leg, [s * 0.025, 0.036, z], [s * 0.048, 0.007, z + 0.014], 0.013);
        segment(g, leg, [s * 0.012, 0.067, 0.046], [s * 0.038, 0.104, 0.084], 0.010);
        segment(g, leg, [s * 0.036, 0.102, 0.080], [s * 0.064, 0.108, 0.134], 0.008);
      }
      eyes(g, 0.031, 0.060, 0.045, 0.025);
      break;
    }
    case 'flyingSquirrel': {
      // The gliding membrane runs from forepaw to hindpaw on each side.
      const fur = 0x967054;
      const membrane = 0xb58a67;
      oval(g, fur, 0, 0.073, -0.037, 0.101, 0.060, 0.135);
      oval(g, 0xb99271, 0, 0.088, 0.081, 0.100, 0.078, 0.087);
      oval(g, CREAM, 0, 0.06, 0.137, 0.065, 0.034, 0.044);
      oval(g, 0x654638, 0, 0.075, 0.172, 0.026, 0.016, 0.019);
      oval(g, 0x855f48, 0.015, 0.038, -0.218, 0.078, 0.027, 0.093, 0, -0.19);
      for (const s of SIDES) {
        blade(g, membrane, s, 0.025, -0.036, 0.272, -0.042, 0.225, 0.024, 0.037);
        segment(g, fur, [s * 0.065, 0.053, 0.058], [s * 0.277, 0.035, 0.034], 0.047, 0.050, TUBE);
        segment(g, fur, [s * 0.070, 0.050, -0.131], [s * 0.253, 0.030, -0.108], 0.045, 0.053, TUBE);
        oval(g, 0xb99576, s * 0.275, 0.019, 0.034, 0.025, 0.019, 0.028);
        oval(g, 0xb99576, s * 0.256, 0.018, -0.106, 0.027, 0.018, 0.024);
        oval(g, fur, s * 0.070, 0.146, 0.060, 0.036, 0.034, 0.027);
        oval(g, 0xc69e96, s * 0.071, 0.150, 0.078, 0.023, 0.024, 0.014);
      }
      eyes(g, 0.064, 0.113, 0.14, 0.037);
      break;
    }
    case 'eagle': {
      // Broad dark wings, pale head, and a yellow bill with a hooked tip.
      const plumage = 0x60463a;
      const gold = 0xd8a64f;
      oval(g, plumage, 0, 0.247, -0.043, 0.171, 0.155, 0.237);
      oval(g, 0x735443, 0, 0.266, 0.088, 0.137, 0.135, 0.149);
      oval(g, 0xe8dec5, 0, 0.348, 0.166, 0.118, 0.113, 0.129);
      oval(g, 0xf3e9d4, 0, 0.328, 0.238, 0.097, 0.081, 0.085);
      oval(g, gold, 0, 0.322, 0.302, 0.058, 0.040, 0.053);
      segment(g, gold, [0, 0.326, 0.328], [0, 0.268, 0.359], 0.062, 0.049, POINT);
      for (const s of SIDES) {
        box(g, 0x846954, s * 0.045, 0.218, -0.313, 0.089, 0.040, 0.241, 0.12, -s * 0.13);
        oval(g, 0xcbbca3, s * 0.075, 0.392, 0.250, 0.047, 0.019, 0.037, 0, s * 0.45, -s * 0.17);
      }
      birdFeet(g, gold, 0.079, 0.076, 0.137, 0.125);
      eyes(g, 0.088, 0.369, 0.264, 0.037);
      wings = birdWings([0.125, 0.307, 0.013], 1.41, 0.773, 0.298, 0.162, plumage, 0x8b6b50, 0x775743);
      break;
    }
    case 'heron': {
      // A kinked pale neck, thin yellow legs, and an eye stripe over the bill.
      const grey = 0x929eaa;
      const neck = 0xb9bdba;
      const yellow = 0xcaa45e;
      oval(g, grey, 0, 0.573, -0.077, 0.159, 0.138, 0.247, 0.11);
      oval(g, 0xb7bdbd, 0, 0.555, 0.028, 0.129, 0.109, 0.142);
      oval(g, 0x677382, 0, 0.598, -0.277, 0.091, 0.052, 0.101, 0.23);
      segment(g, neck, [0, 0.581, 0.067], [0, 0.751, 0.161], 0.115, 0.113);
      segment(g, neck, [0, 0.723, 0.159], [0, 0.925, 0.091], 0.086, 0.089);
      segment(g, 0xd9d9ce, [0, 0.887, 0.098], [0, 1.030, 0.186], 0.077, 0.086);
      oval(g, 0xdedfd4, 0, 1.019, 0.208, 0.084, 0.077, 0.098);
      segment(g, 0xdea950, [0, 0.997, 0.277], [0, 0.970, 0.481], 0.058, 0.047, POINT);
      for (const s of SIDES) {
        box(g, yellow, s * 0.070, 0.015, 0.030, 0.046, 0.030, 0.108, 0, s * 0.14);
        segment(g, yellow, [s * 0.070, 0.018, 0.003], [s * 0.074, 0.312, -0.072], 0.027, 0.027, TUBE);
        segment(g, yellow, [s * 0.074, 0.295, -0.073], [s * 0.077, 0.518, -0.030], 0.033, 0.033, TUBE);
        oval(g, 0x4b4a52, s * 0.060, 1.062, 0.199, 0.032, 0.027, 0.100, -0.21, s * 0.22);
      }
      eyes(g, 0.062, 1.044, 0.27, 0.029);
      wings = birdWings([0.111, 0.624, -0.030], -1.22, 0.479, 0.221, 0.135, grey, 0x626c7b, 0xb3babe);
      break;
    }
    case 'crane': {
      // Long dark legs, a black neck and bustle, and a vermilion crown.
      const dark = 0x49474b;
      oval(g, DOWN, 0, 0.663, -0.095, 0.169, 0.138, 0.253, 0.14);
      oval(g, 0xe5e4dc, 0, 0.674, 0.049, 0.128, 0.133, 0.139);
      for (const s of SIDES) {
        oval(g, dark, s * 0.068, 0.643, -0.255, 0.083, 0.064, 0.145, -0.11, s * 0.28);
        box(g, dark, s * 0.071, 0.015, 0.066, 0.041, 0.030, 0.131, 0, s * 0.13);
        segment(g, dark, [s * 0.071, 0.021, 0.03], [s * 0.072, 0.351, -0.056], 0.027, 0.027, TUBE);
        segment(g, dark, [s * 0.072, 0.340, -0.057], [s * 0.074, 0.608, -0.011], 0.033, 0.033, TUBE);
      }
      segment(g, dark, [0, 0.654, 0.087], [0, 0.881, 0.159], 0.113, 0.116, TUBE);
      segment(g, dark, [0, 0.840, 0.157], [0, 1.202, 0.213], 0.082, 0.089, TUBE);
      oval(g, 0xe9e7de, 0, 1.197, 0.211, 0.081, 0.077, 0.096);
      oval(g, dark, 0, 1.169, 0.254, 0.065, 0.055, 0.060);
      oval(g, 0xc64847, 0, 1.271, 0.222, 0.053, 0.029, 0.061);
      segment(g, 0xbf9c64, [0, 1.19, 0.286], [0, 1.162, 0.43], 0.050, 0.041, POINT);
      eyes(g, 0.057, 1.221, 0.273, 0.029);
      wings = birdWings([0.119, 0.698, -0.051], -1.23, 0.526, 0.241, 0.142, DOWN, dark, 0xfdf9f0);
      break;
    }
    case 'crab': {
      // Orange claws, six little walking legs, and two high eye stalks.
      const shell = 0xdb664b;
      const claw = 0xe87a53;
      oval(g, shell, 0, 0.071, -0.011, 0.134, 0.061, 0.095);
      oval(g, 0xf18f60, 0, 0.106, -0.013, 0.110, 0.036, 0.083);
      for (const s of SIDES) {
        for (const z of [-0.067, -0.031, 0.007]) {
          segment(g, shell, [s * 0.103, 0.069, z], [s * 0.161, 0.055, z - 0.02], 0.027);
          segment(g, shell, [s * 0.154, 0.058, z - 0.019], [s * 0.19, 0.008, z + 0.004], 0.024);
        }
        segment(g, shell, [s * 0.09, 0.063, 0.034], [s * 0.134, 0.062, 0.098], 0.042, 0.040, TUBE);
        oval(g, claw, s * 0.135, 0.073, 0.112, 0.060, 0.041, 0.059, 0, s * 0.2);
        segment(g, claw, [s * 0.113, 0.071, 0.131], [s * 0.076, 0.084, 0.209], 0.052, 0.043, POINT);
        segment(g, 0xc95843, [s * 0.155, 0.073, 0.137], [s * 0.145, 0.087, 0.216], 0.048, 0.043, POINT);
        segment(g, shell, [s * 0.058, 0.098, 0.044], [s * 0.071, 0.154, 0.061], 0.027, 0.033, TUBE);
        oval(g, 0xf3a474, s * 0.071, 0.151, 0.063, 0.028, 0.028, 0.024);
      }
      eyes(g, 0.072, 0.162, 0.078, 0.026);
      break;
    }
    case 'gull': {
      // A white head, grey mantle, and black tips along a long wing.
      const grey = 0xa7aeb4;
      oval(g, DOWN, 0, 0.160, -0.047, 0.123, 0.116, 0.188);
      oval(g, grey, 0, 0.216, -0.067, 0.108, 0.073, 0.164);
      oval(g, DOWN, 0, 0.255, 0.104, 0.094, 0.092, 0.109);
      box(g, DOWN, 0, 0.154, -0.253, 0.124, 0.045, 0.152, 0.12);
      const bill = 0xdeae53;
      oval(g, bill, 0, 0.232, 0.216, 0.038, 0.028, 0.060);
      oval(g, 0xd58254, 0, 0.217, 0.256, 0.020, 0.012, 0.015);
      birdFeet(g, 0xd3a18d, 0.054, 0.024, 0.090, 0.092);
      eyes(g, 0.068, 0.273, 0.178, 0.026);
      wings = wingSet([0.091, 0.21, -0.018], 1.41, (wing, side) => {
        blade(wing, DOWN, side, -0.020, 0, 0.315, -0.045, 0.199, 0.046, -0.002);
        blade(wing, grey, side, -0.015, -0.008, 0.308, -0.046, 0.165, 0.026, 0.013);
        blade(wing, 0x494d56, side, 0.213, -0.031, 0.508, -0.112, 0.133, 0.030, 0, true);
      });
      break;
    }
    case 'seaTurtle': {
      // A domed, patterned shell over two pairs of wide flippers.
      oval(g, 0x687a57, 0, 0.079, -0.035, 0.178, 0.057, 0.259);
      oval(g, 0x797951, 0, 0.115, -0.041, 0.183, 0.113, 0.26);
      oval(g, 0xa49e63, 0, 0.213, -0.045, 0.080, 0.024, 0.106);
      for (const s of SIDES) {
        oval(g, 0x9a925e, s * 0.102, 0.177, 0.004, 0.065, 0.023, 0.102, 0.04, s * 0.44, -s * 0.48);
        oval(g, 0x9d945f, s * 0.089, 0.166, -0.146, 0.060, 0.031, 0.081, -0.28, -s * 0.24, -s * 0.48);
        oval(g, 0x6e845b, s * 0.161, 0.041, 0.115, 0.070, 0.041, 0.164, 0, s * 0.93);
        oval(g, 0x687d56, s * 0.128, 0.035, -0.173, 0.054, 0.032, 0.102, 0, -s * 0.80);
      }
      oval(g, 0x7e8c61, 0, 0.071, 0.211, 0.072, 0.061, 0.081);
      oval(g, 0x91a574, 0, 0.092, 0.292, 0.092, 0.072, 0.103);
      oval(g, 0xb2b888, 0, 0.067, 0.362, 0.057, 0.035, 0.037);
      eyes(g, 0.067, 0.113, 0.35, 0.027);
      break;
    }
    case 'swallow': {
      // Long navy wings, a red throat, and two streaming tail feathers.
      const navy = 0x32445c;
      oval(g, navy, 0, 0.099, -0.031, 0.079, 0.070, 0.110);
      oval(g, DOWN, 0, 0.079, 0.007, 0.069, 0.061, 0.094);
      oval(g, navy, 0, 0.137, 0.058, 0.075, 0.063, 0.073);
      oval(g, 0xad573f, 0, 0.122, 0.109, 0.065, 0.039, 0.036);
      for (const s of SIDES) {
        blade(g, navy, s, 0.015, -0.112, 0.064, -0.25, 0.047, 0.022, 0.10, true);
      }
      segment(g, 0x4c4246, [0, 0.128, 0.123], [0, 0.120, 0.147], 0.036, 0.029, POINT);
      birdFeet(g, 0x90645c, 0.034, 0.005, 0.042, 0.044);
      eyes(g, 0.052, 0.153, 0.107, 0.025);
      wings = birdWings([0.054, 0.131, -0.005], 1.42, 0.345, 0.109, 0.177, navy, 0x292f47, 0x4e627c);
      break;
    }
    case 'gecko': {
      // A flattened gecko with splayed feet and three round pads per foot.
      const skin = 0xa7a477;
      const toes = 0xc5bd94;
      oval(g, skin, 0, 0.029, -0.022, 0.055, 0.029, 0.086);
      oval(g, 0xb4ab83, 0, 0.035, 0.065, 0.062, 0.031, 0.064);
      oval(g, skin, 0.013, 0.020, -0.109, 0.031, 0.019, 0.065, 0, -0.20);
      oval(g, skin, 0.045, 0.012, -0.173, 0.016, 0.012, 0.055, 0, -0.50);
      for (const s of SIDES) {
        for (const z of [-0.060, 0.033]) {
          segment(g, skin, [s * 0.039, 0.024, z], [s * 0.078, 0.020, z - 0.018], 0.022, 0.020, TUBE);
          segment(g, skin, [s * 0.075, 0.020, z - 0.020], [s * 0.092, 0.007, z + 0.012], 0.018);
          for (const dz of [-0.009, 0.006, 0.020]) {
            oval(g, toes, s * (0.099 - Math.abs(dz) * 0.2), 0.008, z + 0.012 + dz, 0.014, 0.008, 0.010);
          }
        }
      }
      for (const z of [-0.075, -0.036, 0.002]) oval(g, 0x8f8a69, 0.013, 0.046, z, 0.016, 0.012, 0.013);
      eyes(g, 0.045, 0.047, 0.087, 0.025);
      break;
    }
  }
  ground(body, wings);
  return wings ? { body, wings } : { body };
}
