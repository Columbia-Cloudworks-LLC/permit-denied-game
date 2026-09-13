import { ISO_H, ISO_Z } from '../game/constants';
export interface Vertex {
    x: number;
    y: number;
    z: number;
}
export interface VehicleFace {
    points: Vertex[];
    color: number;
    part: string;
}
interface Plane {
    normal: Vertex;
    offset: number;
}
interface Node {
    plane: Plane;
    faces: VehicleFace[];
    front?: Node;
    back?: Node;
}
const EPSILON = 1e-6;
const dot = (a: Vertex, b: Vertex) => a.x * b.x + a.y * b.y + a.z * b.z;
const sub = (a: Vertex, b: Vertex): Vertex => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const cross = (a: Vertex, b: Vertex): Vertex => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
// The null direction of worldToScreen: moving toward the viewer leaves a pixel fixed.
const VIEW: Vertex = { x: 1, y: 1, z: 2 * ISO_H / ISO_Z };
function planeOf(points: Vertex[]): Plane | undefined {
    const a = points[0]!;
    for (let i = 1; i < points.length - 1; i++) {
        const normal = cross(sub(points[i]!, a), sub(points[i + 1]!, a));
        const length = Math.hypot(normal.x, normal.y, normal.z);
        if (length < EPSILON)
            continue;
        normal.x /= length;
        normal.y /= length;
        normal.z /= length;
        return { normal, offset: dot(normal, a) };
    }
    return undefined;
}
export function faceVisible(points: Vertex[]): boolean {
    const plane = planeOf(points);
    return !!plane && dot(plane.normal, VIEW) > EPSILON;
}
/** Order a small cached assembly by surfaces, not whole parts. Splitting intersecting
 * faces lets a cab hide the far wheel while the near wheel covers the cab's base.
 * Coplanar trim retains insertion order. This has no effect on physics. */
export function orderVehicleFaces(faces: VehicleFace[]): VehicleFace[] {
    let tree: Node | undefined;
    const insert = (node: Node | undefined, face: VehicleFace): Node | undefined => {
        if (!node) {
            const plane = planeOf(face.points);
            return plane ? { plane, faces: [face] } : undefined;
        }
        const distances = face.points.map(p => dot(node.plane.normal, p) - node.plane.offset);
        const front = distances.some(d => d > EPSILON), back = distances.some(d => d < -EPSILON);
        if (!front && !back) {
            node.faces.push(face);
            return node;
        }
        if (!back) {
            node.front = insert(node.front, face);
            return node;
        }
        if (!front) {
            node.back = insert(node.back, face);
            return node;
        }
        const frontPoints: Vertex[] = [], backPoints: Vertex[] = [];
        for (let i = 0; i < face.points.length; i++) {
            const a = face.points[i]!, b = face.points[(i + 1) % face.points.length]!;
            const da = distances[i]!, db = distances[(i + 1) % face.points.length]!;
            if (da >= -EPSILON)
                frontPoints.push(a);
            if (da <= EPSILON)
                backPoints.push(a);
            if ((da > EPSILON && db < -EPSILON) || (da < -EPSILON && db > EPSILON)) {
                const t = da / (da - db), p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
                frontPoints.push(p);
                backPoints.push(p);
            }
        }
        node.front = insert(node.front, { ...face, points: frontPoints });
        node.back = insert(node.back, { ...face, points: backPoints });
        return node;
    };
    // Large body planes partition first. Starting with tire facets would slice the
    // entire cab into tiny fragments along every tread and create raster seams.
    const area = (face: VehicleFace) => {
        let sum = 0;
        const a = face.points[0]!;
        for (let i = 1; i < face.points.length - 1; i++) {
            const n = cross(sub(face.points[i]!, a), sub(face.points[i + 1]!, a));
            sum += Math.hypot(n.x, n.y, n.z);
        }
        return sum;
    };
    const planes = faces.map(face => ({ face, area: area(face) })).sort((a, b) => b.area - a.area);
    for (const { face } of planes)
        tree = insert(tree, face);
    const result: VehicleFace[] = [];
    const visit = (node: Node | undefined): void => {
        if (!node)
            return;
        const front = dot(node.plane.normal, VIEW) > 0;
        visit(front ? node.back : node.front);
        result.push(...node.faces);
        visit(front ? node.front : node.back);
    };
    visit(tree);
    return result;
}
