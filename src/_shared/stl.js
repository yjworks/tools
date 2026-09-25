/* STL 메시 계산: 부피·겉넓이·크기, 3D 프린팅 무게·필라멘트 길이·비용 추정.
   positions 는 삼각형 꼭짓점 좌표를 이어 붙인 Float32Array (x0,y0,z0, x1,y1,z1, ...), 단위 mm. */

export function meshStats(positions) {
  let vol = 0, area = 0;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const n = positions.length - (positions.length % 9);
  for (let i = 0; i < n; i += 9) {
    const ax = positions[i], ay = positions[i + 1], az = positions[i + 2];
    const bx = positions[i + 3], by = positions[i + 4], bz = positions[i + 5];
    const cx = positions[i + 6], cy = positions[i + 7], cz = positions[i + 8];
    // 원점 기준 사면체의 부호 있는 부피를 더하면 닫힌 메시의 부피가 된다
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    area += Math.sqrt(nx * nx + ny * ny + nz * nz) / 2;
    for (let k = 0; k < 9; k++) { const a = k % 3, v = positions[i + k]; if (v < min[a]) min[a] = v; if (v > max[a]) max[a] = v; }
  }
  return {
    triangles: n / 9,
    volume: Math.abs(vol),      // mm³
    area,                       // mm²
    size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],   // mm
    signed: vol,                // 음수면 면 방향(법선)이 뒤집힌 파일
  };
}

/* 대표 밀도(g/cm³). 제조사·색상에 따라 ±5% 정도 차이가 난다. */
export const MATERIALS = {
  PLA: 1.24, PETG: 1.27, ABS: 1.04, ASA: 1.07, TPU: 1.21, 'PLA-CF': 1.30,
};

/**
 * 출력 무게 추정. 슬라이서의 결과와는 다르며, 벽·윗면·아랫면을 한 겹의 껍질로 단순화한다.
 * shell = 겉넓이 × 벽 두께 (부피를 넘지 않게), 나머지 안쪽은 채움률만큼만 찬다고 본다.
 * @param {{volume:number, area:number}} s  mm³, mm²
 * @param {{density:number, infill:number, wall:number, pricePerKg:number, diameter?:number}} o
 *   infill 0~1, wall mm (벽 줄 수 × 노즐 폭), pricePerKg 원, diameter 필라멘트 지름 mm (1.75)
 */
export function estimatePrint(s, o) {
  const shell = Math.min(s.volume, s.area * o.wall);
  const solid = shell + (s.volume - shell) * o.infill;           // mm³
  const grams = (solid / 1000) * o.density;
  const d = o.diameter ?? 1.75;
  const gramsPerMeter = Math.PI * (d / 20) ** 2 * 100 * o.density; // 단면적(cm²) × 100cm × 밀도
  return {
    solidVolume: solid,
    grams,
    meters: grams / gramsPerMeter,
    cost: (grams / 1000) * o.pricePerKg,
    fullGrams: (s.volume / 1000) * o.density,   // 100% 채움일 때
  };
}

export const UNIT_TO_MM = { mm: 1, cm: 10, inch: 25.4 };
