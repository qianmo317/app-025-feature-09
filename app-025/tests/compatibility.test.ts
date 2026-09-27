import { describe, it, expect } from 'vitest';
import {
  checkPair,
  checkPlantNip,
  checkSchooling,
  checkTankSize,
  checkDensity,
  checkStocking,
  groupReasons,
  rangesOverlap,
  RULES,
  SEVERITY_ORDER,
  type RawIssue,
  type StockingIssue,
} from '../src/core/compatibility';
import type { Fish } from '../src/core/types';

function fish(p: Partial<Fish> & { id: string; name: string }): Fish {
  return {
    adultCm: 5,
    minTankL: 40,
    tempRange: [22, 26],
    ghRange: [2, 15],
    phRange: [6.0, 7.5],
    temperament: 'peaceful',
    plantNip: false,
    schooling: false,
    ...p,
  };
}

function codes(issues: { code: string }[]) {
  return issues.map((i) => i.code);
}

/** 展开合并结论里的全部原因 */
function allReasons(issues: StockingIssue[]) {
  return issues.flatMap((i) => i.reasons);
}

describe('区间交集', () => {
  it('交集/无交集', () => {
    expect(rangesOverlap([20, 26], [24, 28])).toBe(true);
    expect(rangesOverlap([20, 24], [25, 28])).toBe(false);
  });
});

describe('混养兼容性（验收：30 组用例全部检出并给出原因）', () => {
  const ctx = { nominalL: 60 };
  const aggressive = fish({ id: 'agg', name: '斗鱼', temperament: 'aggressive', adultCm: 6, minTankL: 20 });
  const peaceful = fish({ id: 'pea', name: '灯鱼', temperament: 'peaceful', adultCm: 3, minTankL: 30 });
  const semi = fish({ id: 'semi', name: '虎皮', temperament: 'semi', adultCm: 6, plantNip: true });

  // ---- 规则 1：攻击性 × 温和（10 组）----
  it('攻击性×温和，缸体不足 → 硬冲突', () => {
    const small = { nominalL: 29 };
    for (let i = 0; i < 3; i++) {
      const r = checkPair(aggressive, peaceful, small);
      expect(codes(r)).toContain('aggression');
      const a = r.find((x) => x.code === 'aggression')!;
      expect(a.severity).toBe('conflict');
      expect(a.message).toContain('混养冲突');
      expect(a.message).toContain('30'); // 20×1.5
    }
  });

  it('攻击性×温和，缸体达标 → 降级为警告（需隔离区）', () => {
    const r = checkPair(aggressive, peaceful, { nominalL: 30 });
    const a = r.find((x) => x.code === 'aggression')!;
    expect(a.severity).toBe('warning');
    expect(a.message).toContain('隔离区');
  });

  it('攻击性×半凶 → 警告', () => {
    const r = checkPair(aggressive, semi, ctx);
    expect(codes(r)).toContain('aggression');
    expect(r.find((x) => x.code === 'aggression')!.severity).toBe('warning');
  });

  it('温和×温和无攻击性问题', () => {
    const r = checkPair(peaceful, fish({ id: 'p2', name: '月光', temperament: 'peaceful' }), ctx);
    expect(codes(r)).not.toContain('aggression');
  });

  it('minTankL 边界 1.5 倍精确判定（3 组）', () => {
    for (const minTankL of [40, 100, 200]) {
      const a = fish({ id: `a${minTankL}`, name: `凶鱼${minTankL}`, temperament: 'aggressive', minTankL });
      const need = minTankL * 1.5;
      expect(checkPair(a, peaceful, { nominalL: need - 1 }).find((x) => x.code === 'aggression')!.severity).toBe('conflict');
      expect(checkPair(a, peaceful, { nominalL: need }).find((x) => x.code === 'aggression')!.severity).toBe('warning');
    }
  });

  // ---- 规则 2：体长差 > 3 倍（5 组）----
  it.each([
    [30, 3],
    [15, 4],
    [20, 5],
    [12, 3.5],
    [60, 2],
  ])('%icm 与 %icm → 检出被食风险', (big, small) => {
    const r = checkPair(fish({ id: 'b', name: '大鱼', adultCm: big }), fish({ id: 's', name: '小鱼', adultCm: small }), ctx);
    if (big > small * 3) {
      const gap = r.find((x) => x.code === 'size-gap')!;
      expect(gap).toBeTruthy();
      expect(gap.severity).toBe('conflict');
      expect(gap.message).toContain('吞食');
    } else {
      expect(codes(r)).not.toContain('size-gap');
    }
  });

  // ---- 规则 3：水温/GH/pH 无交集 → 硬冲突（8 组）----
  it('水温无交集', () => {
    const cold = fish({ id: 'c', name: '金鱼', tempRange: [10, 24] });
    const hot = fish({ id: 'h', name: '七彩', tempRange: [27, 30] });
    const r = checkPair(cold, hot, ctx);
    const t = r.find((x) => x.code === 'param-temp')!;
    expect(t.severity).toBe('conflict');
    expect(t.message).toContain('水温');
  });

  it('GH 无交集', () => {
    const soft = fish({ id: 's1', name: '水晶虾', ghRange: [4, 8] });
    const hard = fish({ id: 'h1', name: '马鲷', ghRange: [12, 30] });
    const r = checkPair(soft, hard, ctx);
    const g = r.find((x) => x.code === 'param-gh')!;
    expect(g.severity).toBe('conflict');
    expect(g.message).toContain('GH');
  });

  it('pH 无交集', () => {
    const acid = fish({ id: 'a1', name: '灯鱼', phRange: [5.0, 6.5] });
    const alk = fish({ id: 'k1', name: '马鲷', phRange: [7.7, 9.0] });
    const r = checkPair(acid, alk, ctx);
    const p = r.find((x) => x.code === 'param-ph')!;
    expect(p.severity).toBe('conflict');
    expect(p.message).toContain('pH');
  });

  it('三项均无交集 → 三条硬冲突', () => {
    const a = fish({ id: 'x', name: 'A', tempRange: [10, 20], ghRange: [1, 3], phRange: [5.0, 6.0] });
    const b = fish({ id: 'y', name: 'B', tempRange: [26, 30], ghRange: [15, 30], phRange: [8.0, 9.0] });
    const r = checkPair(a, b, ctx);
    expect(codes(r)).toEqual(expect.arrayContaining(['param-temp', 'param-gh', 'param-ph']));
    expect(r.filter((x) => x.code.startsWith('param-')).every((x) => x.severity === 'conflict')).toBe(true);
  });

  it('边界相接（26 与 26）视为有交集（4 组边界）', () => {
    for (const edge of [20, 24, 26, 28]) {
      const a = fish({ id: `e${edge}a`, name: 'A', tempRange: [edge, edge + 2] });
      const b = fish({ id: `e${edge}b`, name: 'B', tempRange: [edge - 2, edge] });
      expect(codes(checkPair(a, b, ctx))).not.toContain('param-temp');
    }
  });

  // ---- 规则 4：啃草鱼 × 草缸（3 组）----
  it('啃草鱼在草缸 → 警告；无植物缸不提示', () => {
    for (const nipper of [
      fish({ id: 'n1', name: '虎皮', plantNip: true }),
      fish({ id: 'n2', name: '金鱼', plantNip: true, adultCm: 20 }),
    ]) {
      const r = checkPlantNip([{ fish: nipper, count: 1 }, { fish: peaceful, count: 5 }], true);
      const w = r.find((x) => x.code === 'plant-nip')!;
      expect(w).toBeTruthy();
      expect(w.severity).toBe('warning');
      expect(w.message).toContain('啃草');
      expect(w.fishIds).toEqual([nipper.id]);
    }
    // 无植物缸不提示
    expect(checkPlantNip([{ fish: fish({ id: 'n3', name: '虎皮2', plantNip: true }), count: 1 }], false)).toHaveLength(0);
  });

  it('啃草鱼与多种鱼混养只报一次（按鱼种而非按配对）', () => {
    const nipper = fish({ id: 'nip', name: '虎皮', plantNip: true });
    const entries = [
      { fish: nipper, count: 6 },
      { fish: fish({ id: 'o1', name: '甲' }), count: 1 },
      { fish: fish({ id: 'o2', name: '乙' }), count: 1 },
    ];
    const issues = checkStocking(entries, { nominalL: 500, effectiveL: 400, hasPlants: true });
    expect(allReasons(issues).filter((r) => r.code === 'plant-nip')).toHaveLength(1);
  });

  // ---- 规则 5：群游鱼数量（4 组在 checkSchooling）----
  it('群游鱼 <6 尾 → 建议补足', () => {
    const school = fish({ id: 'sc', name: '红绿灯', schooling: true, minSchool: 6 });
    for (const count of [1, 3, 5]) {
      const r = checkSchooling([{ fish: school, count }]);
      const s = r.find((x) => x.code === 'schooling')!;
      expect(s.severity).toBe('info');
      expect(s.message).toContain('应激');
      expect(s.message).toContain(String(count));
    }
    expect(checkSchooling([{ fish: school, count: 6 }]).map((x) => x.code)).not.toContain('schooling');
  });

  it('singleMale 多尾 → 警告并建议减到 1 尾', () => {
    const betta = fish({ id: 'bt', name: '斗鱼', singleMale: true });
    const r = checkSchooling([{ fish: betta, count: 3 }]);
    const s = r.find((x) => x.code === 'single-male')!;
    expect(s.severity).toBe('warning');
    expect(s.countAdjust).toEqual({ fishId: 'bt', delta: -2, target: 1 });
  });

  it('逐对汇总 checkStocking 检出已知组合', () => {
    const entries = [
      { fish: aggressive, count: 1 },
      { fish: fish({ id: 'tiny', name: '迷你灯', adultCm: 1.5, temperament: 'peaceful' }), count: 10 },
    ];
    const issues = checkStocking(entries, { nominalL: 60, effectiveL: 50, hasPlants: true });
    expect(codes(allReasons(issues))).toEqual(expect.arrayContaining(['size-gap', 'aggression']));
  });
});

describe('结论标注：规则 / 涉及鱼种 / 消除项', () => {
  it('每条结论都标注依据规则、涉及鱼种与「改哪一项」', () => {
    const entries = [
      { fish: fish({ id: 'a', name: '斗鱼', temperament: 'aggressive', minTankL: 20 }), count: 1 },
      { fish: fish({ id: 'b', name: '红绿灯', schooling: true, minSchool: 6, adultCm: 3 }), count: 2 },
      { fish: fish({ id: 'c', name: '金鱼', plantNip: true, adultCm: 20, tempRange: [10, 24] }), count: 1 },
    ];
    const issues = checkStocking(entries, { nominalL: 25, effectiveL: 20, hasPlants: true });
    expect(issues.length).toBeGreaterThan(0);
    for (const iss of issues) {
      expect(iss.fishIds.length).toBeGreaterThan(0);
      for (const r of iss.reasons) {
        expect(RULES[r.rule]).toBeTruthy(); // 依据的规则
        expect(r.fix.length).toBeGreaterThan(0); // 改哪一项能让它消失
        expect(r.message.length).toBeGreaterThan(0);
      }
    }
  });

  it('群游/密度等数量类结论带补减尾数建议且标注经验估算', () => {
    const school = fish({ id: 'sc', name: '红绿灯', schooling: true, minSchool: 8, adultCm: 3 });
    const r = checkSchooling([{ fish: school, count: 5 }]).find((x) => x.code === 'schooling')!;
    expect(r.countAdjust).toEqual({ fishId: 'sc', delta: 3, target: 8 });
    expect(r.estimated).toBe(true);
  });
});

describe('合并：同一组鱼的多条结论合并为一条并保留全部原因', () => {
  const a = fish({ id: 'x', name: 'A', tempRange: [10, 20], ghRange: [1, 3], phRange: [5.0, 6.0], adultCm: 30 });
  const b = fish({ id: 'y', name: 'B', tempRange: [26, 30], ghRange: [15, 30], phRange: [8.0, 9.0], adultCm: 3 });

  it('同一对鱼的 3 条水质冲突 + 体长差合并成 1 条，原因全保留', () => {
    const issues = checkStocking(
      [
        { fish: a, count: 1 },
        { fish: b, count: 1 },
      ],
      { nominalL: 500, effectiveL: 400, hasPlants: false },
    );
    expect(issues).toHaveLength(1);
    const g = issues[0];
    expect(g.scope).toBe('pair');
    expect(g.fishIds).toEqual(['x', 'y']);
    expect(g.severity).toBe('conflict');
    expect(codes(g.reasons)).toEqual(
      expect.arrayContaining(['param-temp', 'param-gh', 'param-ph', 'size-gap']),
    );
    expect(g.reasons).toHaveLength(4);
  });

  it('同一鱼的群游+缸容问题合并到该鱼一条', () => {
    const sc = fish({ id: 'sc', name: '刚果美人', schooling: true, minSchool: 6, minTankL: 200 });
    const issues = checkStocking([{ fish: sc, count: 2 }], { nominalL: 100, effectiveL: 400, hasPlants: false });
    expect(issues).toHaveLength(1);
    expect(issues[0].scope).toBe('fish');
    expect(codes(issues[0].reasons)).toEqual(expect.arrayContaining(['schooling', 'tank-too-small']));
  });

  it('组内严重度取最高，原因按严重度排序', () => {
    const raw: RawIssue[] = [
      { code: 'schooling', rule: 'R5', severity: 'info', message: 'm1', fix: 'f1', fishIds: ['a'] },
      { code: 'tank-too-small', rule: 'R6', severity: 'conflict', message: 'm2', fix: 'f2', fishIds: ['a'] },
    ];
    const [g] = groupReasons(raw);
    expect(g.severity).toBe('conflict');
    expect(codes(g.reasons)).toEqual(['tank-too-small', 'schooling']);
  });
});

describe('排序：结论按优先级有序', () => {
  it('硬冲突 → 警告 → 建议，同严重度下原因多的组靠前', () => {
    const entries = [
      // 硬冲突：体长差（30 vs 3）
      { fish: fish({ id: 'big', name: '大鱼', adultCm: 30 }), count: 1 },
      { fish: fish({ id: 'small', name: '小鱼', adultCm: 3 }), count: 1 },
      // 警告：啃草
      { fish: fish({ id: 'nip', name: '虎皮', plantNip: true }), count: 1 },
      // 建议：群游不足
      { fish: fish({ id: 'sch', name: '红绿灯', schooling: true, minSchool: 6, adultCm: 3 }), count: 2 },
    ];
    const issues = checkStocking(entries, { nominalL: 2000, effectiveL: 1500, hasPlants: true });
    expect(issues.length).toBeGreaterThanOrEqual(3);
    const orders = issues.map((i) => SEVERITY_ORDER[i.severity]);
    expect([...orders]).toEqual([...orders].sort((x, y) => x - y));
    expect(issues[0].severity).toBe('conflict');
    expect(issues[issues.length - 1].severity).toBe('info');
  });
});

describe('缸容口径：minTankL 对缸体标称容积，不与有效水量混用', () => {
  it('低于 minTankL → 硬冲突提示（标称与有效水量都展示）', () => {
    const big = fish({ id: 'big', name: '地图鱼', minTankL: 300 });
    const r = checkTankSize([{ fish: big, count: 1 }], 120, 100);
    expect(r[0].code).toBe('tank-too-small');
    expect(r[0].severity).toBe('conflict');
    expect(r[0].message).toContain('300L');
    expect(r[0].message).toContain('120'); // 标称
    expect(r[0].message).toContain('100'); // 有效水量随文展示
  });

  it('标称够、有效水量不足 → 不报（口径一致，不被底砂/素材影响）', () => {
    const f = fish({ id: 'm', name: '玛丽鱼', minTankL: 60 });
    // 标称 80L 的缸，铺厚底砂后有效水量仅 50L（< 60L minTankL）
    expect(checkTankSize([{ fish: f, count: 1 }], 80, 50)).toHaveLength(0);
    const issues = checkStocking([{ fish: f, count: 2 }], { nominalL: 80, effectiveL: 50, hasPlants: false });
    expect(codes(allReasons(issues))).not.toContain('tank-too-small');
  });

  it('同一套鱼、同样标称、不同有效水量 → 缸容结论一致', () => {
    const f = fish({ id: 'm', name: '玛丽鱼', minTankL: 60 });
    const heavySubstrate = checkStocking([{ fish: f, count: 2 }], { nominalL: 80, effectiveL: 45, hasPlants: false });
    const bareTank = checkStocking([{ fish: f, count: 2 }], { nominalL: 80, effectiveL: 75, hasPlants: false });
    const tankIssue = (iss: StockingIssue[]) => codes(allReasons(iss)).filter((c) => c === 'tank-too-small');
    expect(tankIssue(heavySubstrate)).toEqual(tankIssue(bareTank));
  });

  it('攻击性 1.5 倍阈值同样按标称容积判定', () => {
    const agg = fish({ id: 'agg', name: '斗鱼', temperament: 'aggressive', minTankL: 20 });
    const pea = fish({ id: 'pea', name: '灯鱼', temperament: 'peaceful' });
    // 标称 30L（=20×1.5 达标），即便有效水量仅 18L 也降级为警告
    const a = checkPair(agg, pea, { nominalL: 30 }).find((x) => x.code === 'aggression')!;
    expect(a.severity).toBe('warning');
  });
});

describe('群游建议结合缸内余量（考虑缸里已有的其他鱼）', () => {
  const school = fish({ id: 'sc', name: '红绿灯', schooling: true, minSchool: 6, adultCm: 4 });

  it('余量充足 → 可容纳补足', () => {
    const r = checkSchooling([{ fish: school, count: 4 }], { remainingCm: 50 })[0];
    expect(r.message).toContain('可容纳补足');
    expect(r.countAdjust).toEqual({ fishId: 'sc', delta: 2, target: 6 });
  });

  it('余量不足 → 提示会超出余量并给出换缸/减鱼路径', () => {
    const r = checkSchooling([{ fish: school, count: 4 }], { remainingCm: 5 })[0];
    expect(r.message).toContain('超出余量');
    expect(r.fix).toContain('换更大缸或减少其他鱼');
  });

  it('密度已超标 → 不宜直接补鱼', () => {
    const r = checkSchooling([{ fish: school, count: 4 }], { remainingCm: -3 })[0];
    expect(r.message).toContain('不宜直接补鱼');
    expect(r.fix).toContain('先减少其他鱼或换更大缸');
  });

  it('checkStocking 集成：缸里其他鱼占满余量时，群游建议带余量提示', () => {
    // 有效 100L：大鱼 4×10cm=40cm + 群游 4×4cm=16cm，余量 ≈7.6cm < 补 2 尾所需 8cm
    const entries = [
      { fish: fish({ id: 'big', name: '大鱼', adultCm: 10 }), count: 4 },
      { fish: school, count: 4 },
    ];
    const issues = checkStocking(entries, { nominalL: 200, effectiveL: 100, hasPlants: false });
    const s = allReasons(issues).find((r) => r.code === 'schooling')!;
    expect(s.message).toContain('超出余量');
    // 对照：同样的群游鱼但缸里没有其他鱼 → 余量充足
    const alone = checkStocking([{ fish: school, count: 4 }], { nominalL: 200, effectiveL: 100, hasPlants: false });
    expect(allReasons(alone).find((r) => r.code === 'schooling')!.message).toContain('可容纳补足');
  });
});

describe('密度校验（经验估算，不阻断）', () => {
  it('密度超标 → 提示但不阻断（建议性质）', () => {
    const small = fish({ id: 's', name: '灯鱼', adultCm: 3 });
    // 60L 养 40 尾 3cm = 120cm → 2cm/L > 1cm/L 阈值
    const d = checkDensity([{ fish: small, count: 40 }], 60)!;
    expect(d.over).toBe(true);
    expect(d.cmPerL).toBeGreaterThan(d.threshold);
    expect(d.note).toContain('经验估算');
    expect(d.note).toContain('不阻断');
  });

  it('超标给出减尾建议：超出 60cm ÷ 平均 3cm → 约减 20 尾', () => {
    const small = fish({ id: 's', name: '灯鱼', adultCm: 3 });
    const d = checkDensity([{ fish: small, count: 40 }], 60)!;
    expect(d.excessCm).toBeCloseTo(60, 1);
    expect(d.suggestRemove).toBe(20);
  });

  it('未超标不建议减尾', () => {
    const small = fish({ id: 's', name: '灯鱼', adultCm: 3 });
    const d = checkDensity([{ fish: small, count: 10 }], 60)!;
    expect(d.over).toBe(false);
    expect(d.suggestRemove).toBe(0);
    expect(d.excessCm).toBe(0);
  });

  it('大鱼阈值放宽到 1cm/2L', () => {
    const big = fish({ id: 'b', name: '中鱼', adultCm: 10 });
    // 200L 养 20 尾 10cm = 200cm → 1cm/L，阈值 0.5 → 超标
    expect(checkDensity([{ fish: big, count: 20 }], 200)!.over).toBe(true);
    // 500L 养 25 尾 = 250cm → 0.5cm/L = 阈值边界 → 未超
    expect(checkDensity([{ fish: big, count: 25 }], 500)!.over).toBe(false);
  });

  it('无鱼或无水时不输出', () => {
    expect(checkDensity([], 100)).toBeNull();
    const f = fish({ id: 'f', name: 'F', adultCm: 3 });
    expect(checkDensity([{ fish: f, count: 5 }], 0)).toBeNull();
  });
});
