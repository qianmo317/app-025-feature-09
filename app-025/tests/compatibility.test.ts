import { describe, it, expect } from 'vitest';
import {
  checkPair,
  checkSchooling,
  checkTankSize,
  checkDensity,
  checkStocking,
  mergeFindings,
  rangesOverlap,
  type Finding,
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

describe('区间交集', () => {
  it('交集/无交集', () => {
    expect(rangesOverlap([20, 26], [24, 28])).toBe(true);
    expect(rangesOverlap([20, 24], [25, 28])).toBe(false);
  });
});

describe('混养兼容性（验收：30 组用例全部检出并给出原因）', () => {
  const ctx = { nominalL: 60, hasPlants: true };
  const aggressive = fish({ id: 'agg', name: '斗鱼', temperament: 'aggressive', adultCm: 6, minTankL: 20 });
  const peaceful = fish({ id: 'pea', name: '灯鱼', temperament: 'peaceful', adultCm: 3, minTankL: 30 });
  const semi = fish({ id: 'semi', name: '虎皮', temperament: 'semi', adultCm: 6, plantNip: true });

  // ---- 规则 1：攻击性 × 温和（10 组）----
  it('攻击性×温和，缸体不足 → 硬冲突', () => {
    const small = { nominalL: 29, hasPlants: true };
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
    const r = checkPair(aggressive, peaceful, { nominalL: 30, hasPlants: true });
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
      expect(checkPair(a, peaceful, { nominalL: need - 1, hasPlants: true }).find((x) => x.code === 'aggression')!.severity).toBe('conflict');
      expect(checkPair(a, peaceful, { nominalL: need, hasPlants: true }).find((x) => x.code === 'aggression')!.severity).toBe('warning');
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
  it('啃草鱼在草缸 → 警告', () => {
    for (const nipper of [
      fish({ id: 'n1', name: '虎皮', plantNip: true }),
      fish({ id: 'n2', name: '金鱼', plantNip: true, adultCm: 20 }),
    ]) {
      const r = checkPair(nipper, peaceful, { nominalL: 200, hasPlants: true });
      const w = r.find((x) => x.code === 'plant-nip')!;
      expect(w).toBeTruthy();
      expect(w.severity).toBe('warning');
      expect(w.message).toContain('啃草');
    }
    // 无植物缸不提示
    const r2 = checkPair(fish({ id: 'n3', name: '虎皮2', plantNip: true }), peaceful, { nominalL: 200, hasPlants: false });
    expect(codes(r2)).not.toContain('plant-nip');
  });

  // ---- 规则 5：群游鱼数量（4 组在 checkSchooling）----
  it('群游鱼 <6 尾 → 建议补足并给出补尾数', () => {
    const school = fish({ id: 'sc', name: '红绿灯', schooling: true, minSchool: 6 });
    for (const count of [1, 3, 5]) {
      const r = checkSchooling([{ fish: school, count }]);
      const s = r.find((x) => x.code === 'schooling')!;
      expect(s.severity).toBe('info');
      expect(s.message).toContain('应激');
      expect(s.message).toContain(String(count));
      expect(s.countDelta).toEqual({ fishId: 'sc', delta: 6 - count });
      expect(s.fix).toContain(`补 ${6 - count} 尾`);
      expect(s.fix).toContain('经验估算');
    }
    expect(checkSchooling([{ fish: school, count: 6 }]).map((x) => x.code)).not.toContain('schooling');
  });

  it('singleMale 多尾 → 警告并给出减尾数', () => {
    const betta = fish({ id: 'bt', name: '斗鱼', singleMale: true });
    const r = checkSchooling([
      { fish: betta, count: 2 },
    ]);
    const s = r.find((x) => x.code === 'single-male')!;
    expect(s.severity).toBe('warning');
    expect(s.countDelta).toEqual({ fishId: 'bt', delta: -1 });
    expect(s.fix).toContain('减 1 尾');
  });

  it('逐对汇总 checkStocking 合并检出已知组合', () => {
    const entries = [
      { fish: aggressive, count: 1 },
      { fish: fish({ id: 'tiny', name: '迷你灯', adultCm: 1.5, temperament: 'peaceful' }), count: 10 },
    ];
    const issues = checkStocking(entries, { nominalL: 60, effectiveL: 50, hasPlants: true });
    // 同一对鱼的 size-gap + aggression 合并为一条，全部原因保留
    const pair = issues.find((i) => i.key === 'pair:agg|tiny')!;
    expect(pair).toBeTruthy();
    expect(pair.reasons.map((r) => r.code)).toEqual(expect.arrayContaining(['size-gap', 'aggression']));
    expect(pair.severity).toBe('conflict');
  });
});

describe('结论标注：规则 / 涉及鱼种 / 消除改法', () => {
  const ctx = { nominalL: 25, hasPlants: true };
  const a = fish({ id: 'a', name: '凶鱼', temperament: 'aggressive', minTankL: 40 });
  const b = fish({ id: 'b', name: '温和鱼', temperament: 'peaceful' });

  it('每条 Finding 都带规则标注、涉及鱼种与改法', () => {
    const findings = checkPair(a, b, ctx);
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.rule).toMatch(/规则|附加/);
      expect(f.fishIds).toEqual(expect.arrayContaining(['a', 'b']));
      expect(f.fix.length).toBeGreaterThan(0);
    }
  });

  it('水质冲突的改法是移出其一（区间无交集无法调水质相容）', () => {
    const cold = fish({ id: 'c', name: '金鱼', tempRange: [10, 24] });
    const hot = fish({ id: 'h', name: '七彩', tempRange: [27, 30] });
    const t = checkPair(cold, hot, { nominalL: 200, hasPlants: false }).find((x) => x.code === 'param-temp')!;
    expect(t.fix).toContain('移出');
  });

  it('攻击性冲突的改法给出所需标称容积', () => {
    const agg = checkPair(a, b, ctx).find((x) => x.code === 'aggression')!;
    expect(agg.fix).toContain('60'); // 40×1.5
    expect(agg.fix).toContain('移出');
  });
});

describe('合并：同一对象的多条结论合并为一条并保留全部原因', () => {
  it('同一对鱼的三条水质冲突 → 一条 issue 三条原因', () => {
    const x = fish({ id: 'x', name: 'A', tempRange: [10, 20], ghRange: [1, 3], phRange: [5.0, 6.0] });
    const y = fish({ id: 'y', name: 'B', tempRange: [26, 30], ghRange: [15, 30], phRange: [8.0, 9.0] });
    const issues = mergeFindings(checkPair(x, y, { nominalL: 200, hasPlants: false }));
    expect(issues).toHaveLength(1);
    expect(issues[0].key).toBe('pair:x|y');
    expect(issues[0].reasons.map((r) => r.code)).toEqual(['param-temp', 'param-gh', 'param-ph']);
    expect(issues[0].severity).toBe('conflict');
    expect(issues[0].fixes.length).toBeGreaterThan(0);
  });

  it('同一尾鱼的群游不足 + 缸体过小 → 一条 issue', () => {
    const neon = fish({ id: 'n', name: '红绿灯', schooling: true, minSchool: 6, minTankL: 100 });
    const issues = checkStocking([{ fish: neon, count: 3 }], { nominalL: 60, effectiveL: 50, hasPlants: false });
    expect(issues).toHaveLength(1);
    expect(issues[0].key).toBe('fish:n');
    expect(issues[0].reasons.map((r) => r.code)).toEqual(expect.arrayContaining(['schooling', 'tank-too-small']));
    // 主原因取严重度最高的（tank-too-small 为硬冲突）
    expect(issues[0].code).toBe('tank-too-small');
    expect(issues[0].severity).toBe('conflict');
    expect(issues[0].countDeltas).toEqual([{ fishId: 'n', delta: 3 }]);
  });

  it('啃草提示只挂在啃草鱼身上，不与配对另一方合并', () => {
    const nipper = fish({ id: 'nip', name: '虎皮', plantNip: true });
    const other = fish({ id: 'o', name: '灯鱼' });
    const issues = mergeFindings(checkPair(nipper, other, { nominalL: 200, hasPlants: true }));
    expect(issues).toHaveLength(1);
    expect(issues[0].key).toBe('fish:nip');
    expect(issues[0].fishIds).toEqual(['nip']);
  });
});

describe('排序：结论按处理顺序输出', () => {
  it('硬冲突全部排在警告与建议之前，同级按规则次序', () => {
    const entries = [
      { fish: fish({ id: 'betta', name: '斗鱼', temperament: 'aggressive', minTankL: 20, singleMale: true }), count: 2 },
      { fish: fish({ id: 'neon', name: '红绿灯', temperament: 'peaceful', schooling: true, minSchool: 6, adultCm: 3 }), count: 3 },
      { fish: fish({ id: 'gold', name: '金鱼', tempRange: [10, 24], adultCm: 20 }), count: 1 },
      { fish: fish({ id: 'discus', name: '七彩', tempRange: [27, 30], adultCm: 18, minTankL: 250 }), count: 1 },
    ];
    const issues = checkStocking(entries, { nominalL: 120, effectiveL: 100, hasPlants: false });
    const priorities = issues.map((i) => i.priority);
    expect([...priorities].sort((x, y) => x - y)).toEqual(priorities);
    // 水温无交集（金鱼×七彩）是第一条
    expect(issues[0].code).toBe('param-temp');
    // 群游建议排在硬冲突之后
    const schoolingIdx = issues.findIndex((i) => i.reasons.some((r) => r.code === 'schooling'));
    const lastConflictIdx = issues.map((i, idx) => (i.severity === 'conflict' ? idx : -1)).reduce((a, b) => Math.max(a, b));
    expect(schoolingIdx).toBeGreaterThan(lastConflictIdx);
  });
});

describe('缸容口径：标称容积 vs 有效水量不混用', () => {
  it('minTankL 对比标称容积：底砂再多也不影响缸体够不够的结论', () => {
    const big = fish({ id: 'big', name: '地图鱼', minTankL: 300 });
    // 标称 300L 刚好达标：即使有效水量只剩 200L 也不报缸体过小
    expect(checkTankSize([{ fish: big, count: 1 }], 300)).toHaveLength(0);
    expect(checkTankSize([{ fish: big, count: 1 }], 299)).toHaveLength(1);
  });

  it('低于 minTankL → 硬冲突提示（按标称容积表述）', () => {
    const big = fish({ id: 'big', name: '地图鱼', minTankL: 300 });
    const r = checkTankSize([{ fish: big, count: 1 }], 120);
    expect(r[0].code).toBe('tank-too-small');
    expect(r[0].severity).toBe('conflict');
    expect(r[0].message).toContain('300L');
    expect(r[0].message).toContain('标称');
    expect(r[0].fix).toContain('300');
  });

  it('同一套鱼：标称够、有效水量小 → 不报缸体过小，但密度按有效水量报警', () => {
    const neon = fish({ id: 'n', name: '红绿灯', minTankL: 30, adultCm: 3.5, schooling: true, minSchool: 6 });
    // 标称 120L（≥30，缸体够），有效水量仅 20L（塞满底砂素材）→ 密度超标
    const entries = [{ fish: neon, count: 30 }];
    const issues = checkStocking(entries, { nominalL: 120, effectiveL: 20, hasPlants: false });
    expect(issues.flatMap((i) => i.reasons.map((r) => r.code))).not.toContain('tank-too-small');
    expect(issues.flatMap((i) => i.reasons.map((r) => r.code))).toContain('density');
  });

  it('规则 1 的 1.5 倍判定同样用标称容积', () => {
    const agg = fish({ id: 'agg', name: '凶鱼', temperament: 'aggressive', minTankL: 40 });
    const pea = fish({ id: 'pea', name: '温和鱼', temperament: 'peaceful' });
    // 标称 60L = 40×1.5 → 降级警告（不管有效水量多少）
    const r = checkPair(agg, pea, { nominalL: 60, hasPlants: false });
    expect(r.find((x) => x.code === 'aggression')!.severity).toBe('warning');
  });
});

describe('群游余量：考虑缸里已有的鱼', () => {
  const neon = fish({ id: 'n', name: '红绿灯', schooling: true, minSchool: 6, adultCm: 3.5 });
  const others = fish({ id: 'o', name: '月光鱼', adultCm: 5 });

  it('余量充足 → 直接建议补尾数', () => {
    const r = checkSchooling([{ fish: neon, count: 3 }], { effectiveL: 100 });
    const s = r.find((x) => x.code === 'schooling')!;
    expect(s.fix).toContain('补 3 尾');
    expect(s.fix).not.toContain('余量');
  });

  it('缸已塞满其他鱼 → 改口建议先减鱼/换缸，而不是盲目补尾数', () => {
    // 60L 已养 110 尾 5cm 鱼（远超经验密度），再让补 3 尾灯鱼不合理
    const r = checkSchooling(
      [
        { fish: neon, count: 3 },
        { fish: others, count: 110 },
      ],
      { effectiveL: 60 },
    );
    const s = r.find((x) => x.code === 'schooling')!;
    expect(s.fix).toContain('余量');
    expect(s.fix).toContain('减少其他鱼或换更大缸');
    expect(s.countDelta).toEqual({ fishId: 'n', delta: 3 });
  });

  it('不传水量上下文时退化为只比最小群游数', () => {
    const r = checkSchooling([{ fish: neon, count: 3 }]);
    expect(r.find((x) => x.code === 'schooling')!.fix).toContain('补 3 尾');
  });
});

describe('密度校验（经验估算，不阻断）', () => {
  it('密度超标 → 提示但不阻断（建议性质），并给出减尾数估算', () => {
    const small = fish({ id: 's', name: '灯鱼', adultCm: 3 });
    // 60L 养 40 尾 3cm = 120cm → 2cm/L > 1cm/L 阈值
    const d = checkDensity([{ fish: small, count: 40 }], 60)!;
    expect(d.over).toBe(true);
    expect(d.cmPerL).toBeGreaterThan(d.threshold);
    expect(d.note).toContain('经验估算');
    expect(d.note).toContain('不阻断');
    // 超 60cm，平均每尾 3cm → 约减 20 尾
    expect(d.suggestRemove).toBe(20);
  });

  it('未超标不建议减尾数', () => {
    const small = fish({ id: 's', name: '灯鱼', adultCm: 3 });
    const d = checkDensity([{ fish: small, count: 10 }], 60)!;
    expect(d.over).toBe(false);
    expect(d.suggestRemove).toBe(0);
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

  it('密度超标进入汇总结论（info 级，标注经验估算不阻断）', () => {
    const small = fish({ id: 's', name: '灯鱼', adultCm: 3 });
    const issues = checkStocking([{ fish: small, count: 40 }], { nominalL: 100, effectiveL: 60, hasPlants: false });
    const d = issues.find((i) => i.key === 'tank')!;
    expect(d.severity).toBe('info');
    expect(d.reasons[0].rule).toContain('密度');
    expect(d.fixes[0]).toContain('减 20 尾');
    expect(d.fixes[0]).toContain('不阻断');
  });
});
