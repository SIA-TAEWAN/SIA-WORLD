/**
 * 시아핑거 시뮬레이션용 결정적 수학 (PRD "서버와 검증").
 * 같은 조작이면 Deno(V8)와 아이폰 Safari(JavaScriptCore)에서 비트 단위로 같은 결과가 나와야 하므로
 * IEEE 754 사칙연산과 Math.sqrt · floor · round · abs · min · max 만 쓴다.
 * 엔진마다 결과가 다를 수 있는 삼각·지수 함수 대신, 사칙연산만으로 만든 다항식으로 각도 표를 미리 만든다.
 */

/** 원주율 (리터럴: 어느 엔진에서나 같은 double) */
export const PI = 3.141592653589793;

/** 각도 단위: 0.1° (0~3599). 0 = 오른쪽(+x), 900 = 아래(+y, 화면 좌표), 2700 = 위 */
export const ANGLE_STEPS = 3600;

/** sin(x), 0 ≤ x ≤ π/2 — 테일러 전개 x^19 항까지를 곱셈·나눗셈 순서를 고정해 계산 (오차 < 1e-15) */
function sinPoly(x: number): number {
  const x2 = x * x;
  return (
    x *
    (1 -
      (x2 / 6) *
        (1 -
          (x2 / 20) *
            (1 - (x2 / 42) * (1 - (x2 / 72) * (1 - (x2 / 110) * (1 - (x2 / 156) * (1 - (x2 / 210) * (1 - (x2 / 272) * (1 - x2 / 342)))))))))
  );
}

/** 0°~90° (0~900, 0.1° 단위) 의 sin 표 */
const QUARTER: number[] = [];
for (let k = 0; k <= 900; k++) QUARTER.push(sinPoly((k * PI) / 1800));
// 끝값은 정확히
QUARTER[0] = 0;
QUARTER[900] = 1;

/** 정수 각도(0.1° 단위) → 0~3599 */
export function normAngle(a: number): number {
  const k = Math.round(a) % ANGLE_STEPS;
  return k < 0 ? k + ANGLE_STEPS : k;
}

/** sin (각도는 0.1° 단위 정수) */
export function sinT(a: number): number {
  const k = normAngle(a);
  const q = Math.floor(k / 900);
  const r = k - q * 900;
  if (q === 0) return QUARTER[r];
  if (q === 1) return QUARTER[900 - r];
  if (q === 2) return -QUARTER[r];
  return -QUARTER[900 - r];
}

/** cos (각도는 0.1° 단위 정수) */
export const cosT = (a: number) => sinT(a + 900);

/** 각도 → 방향 단위 벡터 [x, y] (화면 좌표: y 아래가 +) */
export const dirOf = (a: number): [number, number] => [cosT(a), sinT(a)];

/** 1/√2 (45° 판정: 두 단위 벡터 내적이 이 값 이상이면 45° 안) */
export const COS45 = 0.7071067811865476;

/** 선분 위에서 점(px,py)에 가장 가까운 점 */
export function closestOnSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): [number, number] {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return [ax + t * dx, ay + t * dy];
}

export const dist2 = (ax: number, ay: number, bx: number, by: number) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
