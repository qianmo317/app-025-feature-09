import type { Fish } from './types';

/**
 * 混养兼容性检查——需求文档 §8 规则：
 * R1. 攻击性 × 温和 → 冲突（除非缸体标称 ≥ 攻击性鱼种 minTankL × 1.5 且有隔离区）
 * R2. 成体体长差 > 3 倍 → 小鱼被吃风险
 * R3. 水温/GH/pH 区间无交集 → 硬冲突
 * R4. 啃草鱼 × 草缸 → 警告
 * R5. 群游鱼数量 < minSchool → 建议补足（结合缸内余量）；singleMale 多尾 → 减员
 * R6. 缸体标称容积 < minTankL（同为标称口径）→ 硬冲突
 * R7. 密度校验（经验估算，不阻断）
 *
 * 输出约定（结论有次序）：
 * - 每条结论（IssueReason）标注依据规则 rule、涉及的鱼种 fishIds、以及改哪一项能让它消失 fix；
 * - 同一组鱼的多条结论由 groupReasons 合并为一条 StockingIssue，保留全部原因；
 * - 数量类结论带 countAdjust（补/减尾数建议），estimated=true 表示经验估算、不阻断；
 * - checkStocking 返回按优先级排序（硬冲突 → 警告 → 建议）的合并结论列表。
 *
 * 口径约定：minTankL 与 R1/R6 的缸容阈值均为「缸体标称容积」口径，
 * 与有效水量（加药/密度用）严格分开，避免同一套鱼因底砂/素材不同而结论打架。
 */

export type Severity = 'conflict' | 'warning' | 'info';

/** 严重度排序权重（值小者优先处理） */
export const SEVERITY_ORDER: Record<Severity, number> = { conflict: 0, warning: 1, info: 2 };

export type IssueCode =
  | 'aggression'
  | 'size-gap'
  | 'param-temp'
  | 'param-gh'
  | 'param-ph'
  | 'plant-nip'
  | 'schooling'
  | 'single-male'
  | 'tank-too-small'
  | 'density';

export type RuleId = 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6' | 'R7';

/** 规则编号 → 规则名（UI 标注「依据的规则」用） */
export const RULES: Record<RuleId, string> = {
  R1: '攻击性×温和',
  R2: '成体体长差',
  R3: '水质区间交集',
  R4: '啃草×草缸',
  R5: '群游/单养数量',
  R6: '最小缸容(标称)',
  R7: '饲养密度(经验)',
};

/** 数量调整建议（补/减尾数） */
export type CountAdjust = {
  fishId: string;
  /** 正数=补几尾，负数=减几尾 */
  delta: number;
  /** 调整后的目标尾数 */
  target: number;
};

/** 单条规则结论（合并前） */
export type IssueReason = {
  code: IssueCode;
  /** 依据的规则 */
  rule: RuleId;
  severity: Severity;
  /** 原因描述 */
  message: string;
  /** 改哪一项能让该结论消失 */
  fix: string;
  /** 经验估算（不阻断） */
  estimated?: boolean;
  /** 数量类建议：补/减尾数 */
  countAdjust?: CountAdjust;
};

/** 带涉及鱼种的结论（分组前） */
export type RawIssue = IssueReason & {
  /** 涉及的鱼种 id（1~2 个） */
  fishIds: string[];
};

/** 合并后的结论：同一组鱼只出一条，保留全部原因 */
export type StockingIssue = {
  /** 分组键：排序后的鱼种 id 连接 */
  key: string;
  scope: 'pair' | 'fish';
  /** 涉及的鱼种 id（已排序） */
  fishIds: string[];
  /** 组内最高严重度 */
  severity: Severity;
  /** 全部原因（按严重度排序） */
  reasons: IssueReason[];
};

export type PairCheckContext = {
  /** 缸体标称容积 L（与鱼种 minTankL 同一口径） */
  nominalL: number;
};

export type StockingContext = PairCheckContext & {
  /** 有效水量 L（密度与群游余量估算用） */
  effectiveL: number;
  hasPlants: boolean;
};

/** 两个区间的交集判断 */
export function rangesOverlap(a: [number, number], b: [number, number]): boolean {
  return a[0] <= b[1] && b[0] <= a[1];
}

/** 逐对兼容性检查（规则 R1/R2/R3） */
export function checkPair(a: Fish, b: Fish, ctx: PairCheckContext): RawIssue[] {
  const issues: RawIssue[] = [];
  if (a.id === b.id) return issues;
  const fishIds = [a.id, b.id].sort();
  const big = a.adultCm >= b.adultCm ? a : b;
  const small = a.adultCm >= b.adultCm ? b : a;

  // 规则 3：水质区间无交集 → 硬冲突（水温 / GH / pH）
  if (!rangesOverlap(a.tempRange, b.tempRange)) {
    issues.push({
      severity: 'conflict',
      code: 'param-temp',
      rule: 'R3',
      fishIds,
      message: `「${a.name}」(${a.tempRange.join('~')}°C) 与「${b.name}」(${b.tempRange.join('~')}°C) 水温区间无交集，硬冲突`,
      fix: `移除「${a.name}」或「${b.name}」之一（水温区间无交集，调水无法调和）`,
    });
  }
  if (!rangesOverlap(a.ghRange, b.ghRange)) {
    issues.push({
      severity: 'conflict',
      code: 'param-gh',
      rule: 'R3',
      fishIds,
      message: `「${a.name}」GH(${a.ghRange.join('~')}) 与「${b.name}」GH(${b.ghRange.join('~')}) 区间无交集，硬冲突`,
      fix: `移除「${a.name}」或「${b.name}」之一（GH 区间无交集，调水无法调和）`,
    });
  }
  if (!rangesOverlap(a.phRange, b.phRange)) {
    issues.push({
      severity: 'conflict',
      code: 'param-ph',
      rule: 'R3',
      fishIds,
      message: `「${a.name}」pH(${a.phRange.join('~')}) 与「${b.name}」pH(${b.phRange.join('~')}) 区间无交集，硬冲突`,
      fix: `移除「${a.name}」或「${b.name}」之一（pH 区间无交集，调水无法调和）`,
    });
  }

  // 规则 1：攻击性 × 温和（semi 视为过渡，仅提示留意）
  const aggressive = [a, b].find((f) => f.temperament === 'aggressive');
  const other = aggressive ? (aggressive === a ? b : a) : null;
  if (aggressive && other && other.temperament === 'peaceful') {
    const needL = Math.round(aggressive.minTankL * 1.5);
    if (ctx.nominalL >= needL) {
      issues.push({
        severity: 'warning',
        code: 'aggression',
        rule: 'R1',
        fishIds,
        message: `「${aggressive.name}」攻击性强，与「${other.name}」混养需缸体标称 ≥ ${needL}L（当前满足），且必须布置隔离区/躲避物`,
        fix: `布置隔离区/躲避物；无法布置则移除「${aggressive.name}」或「${other.name}」之一`,
      });
    } else {
      issues.push({
        severity: 'conflict',
        code: 'aggression',
        rule: 'R1',
        fishIds,
        message: `「${aggressive.name}」攻击性强 × 「${other.name}」温和 → 混养冲突：缸体标称需 ≥ ${needL}L（当前约 ${Math.round(ctx.nominalL)}L，不满足）`,
        fix: `换标称 ≥ ${needL}L 的缸，或移除「${aggressive.name}」/「${other.name}」之一`,
      });
    }
  } else if (aggressive && other && other.temperament === 'semi') {
    issues.push({
      severity: 'warning',
      code: 'aggression',
      rule: 'R1',
      fishIds,
      message: `「${aggressive.name}」×「${other.name}」均为强势鱼，建议留意追咬`,
      fix: `提供躲避物并观察，出现追咬时隔离其一`,
    });
  }

  // 规则 2：成体体长差 > 3 倍 → 小鱼被吃风险
  if (big.adultCm > small.adultCm * 3) {
    issues.push({
      severity: 'conflict',
      code: 'size-gap',
      rule: 'R2',
      fishIds,
      message: `「${big.name}」成体 ${big.adultCm}cm 超过「${small.name}」(${small.adultCm}cm) 的 3 倍，存在被吞食风险`,
      fix: `移除「${big.name}」或「${small.name}」之一（体长差无法调和）`,
    });
  }

  return issues;
}

/** 规则 4：啃草鱼 × 草缸（按鱼种各出一条，与配对无关，避免同一鱼重复报警） */
export function checkPlantNip(
  entries: { fish: Fish; count: number }[],
  hasPlants: boolean,
): RawIssue[] {
  if (!hasPlants) return [];
  return entries
    .filter(({ fish, count }) => count > 0 && fish.plantNip)
    .map(({ fish }) => ({
      severity: 'warning' as Severity,
      code: 'plant-nip' as const,
      rule: 'R4' as RuleId,
      fishIds: [fish.id],
      message: `「${fish.name}」有啃草/拔草习性，与草缸混养会破坏水草`,
      fix: `移除「${fish.name}」，或改无草缸`,
    }));
}

export type SchoolingContext = {
  /**
   * 距经验密度上限的剩余成体长度（cm），负值表示已超标。
   * 缺省表示不考虑缸内余量（单独调用时）。
   */
  remainingCm?: number;
};

/** 规则 5：群游鱼数量（结合缸内余量给补尾建议）与 singleMale 减员建议 */
export function checkSchooling(
  entries: { fish: Fish; count: number }[],
  sctx: SchoolingContext = {},
): RawIssue[] {
  const issues: RawIssue[] = [];
  const round1 = (n: number) => Math.round(n * 10) / 10;
  for (const { fish, count } of entries) {
    if (count <= 0) continue;
    if (fish.schooling) {
      const min = fish.minSchool ?? 6;
      if (count < min) {
        const need = min - count;
        let capacityNote = '';
        let fix = `补 ${need} 尾「${fish.name}」至 ${min} 尾`;
        if (sctx.remainingCm !== undefined) {
          const addCm = need * fish.adultCm;
          if (sctx.remainingCm < 0) {
            capacityNote = `；注意缸内密度已超经验上限，不宜直接补鱼`;
            fix = `先减少其他鱼或换更大缸，再补 ${need} 尾「${fish.name}」至 ${min} 尾`;
          } else if (addCm > sctx.remainingCm) {
            capacityNote = `；按经验密度估算缸内余量约 ${round1(sctx.remainingCm)}cm，补 ${need} 尾（约 ${round1(addCm)}cm）会超出余量`;
            fix = `换更大缸或减少其他鱼腾出约 ${round1(addCm - sctx.remainingCm)}cm 余量后，再补 ${need} 尾至 ${min} 尾`;
          } else {
            capacityNote = `；缸内经验余量约 ${round1(sctx.remainingCm)}cm，可容纳补足`;
          }
        }
        issues.push({
          severity: 'info',
          code: 'schooling',
          rule: 'R5',
          fishIds: [fish.id],
          estimated: true,
          countAdjust: { fishId: fish.id, delta: need, target: min },
          message: `「${fish.name}」为群游鱼，当前 ${count} 尾 < ${min} 尾，单养会应激，建议补足到 ${min} 尾以上（+${need} 尾）${capacityNote}`,
          fix,
        });
      }
    }
    if (fish.singleMale && count > 1) {
      issues.push({
        severity: 'warning',
        code: 'single-male',
        rule: 'R5',
        fishIds: [fish.id],
        countAdjust: { fishId: fish.id, delta: -(count - 1), target: 1 },
        message: `「${fish.name}」雄性间会激烈互斗，建议只养 1 尾（当前 ${count} 尾，需移出 ${count - 1} 尾）`,
        fix: `移出 ${count - 1} 尾「${fish.name}」，只留 1 尾`,
      });
    }
  }
  return issues;
}

/**
 * 规则 6：缸体最小容量检查（标称口径）。
 * minTankL 是鱼种资料对「缸体标称容积」的要求，必须与标称容积比较；
 * 有效水量仅随文展示，不参与判定，否则同一套鱼会因底砂/素材多少而结论打架。
 */
export function checkTankSize(
  entries: { fish: Fish; count: number }[],
  nominalL: number,
  effectiveL?: number,
): RawIssue[] {
  return entries
    .filter(({ fish, count }) => count > 0 && nominalL > 0 && nominalL < fish.minTankL)
    .map(({ fish }) => ({
      severity: 'conflict' as Severity,
      code: 'tank-too-small' as const,
      rule: 'R6' as RuleId,
      fishIds: [fish.id],
      message: `「${fish.name}」最小缸体（标称）要求 ${fish.minTankL}L，当前缸体标称约 ${Math.round(nominalL)}L${
        effectiveL !== undefined ? `（有效水量约 ${Math.round(effectiveL)}L）` : ''
      }，不建议饲养`,
      fix: `换标称 ≥ ${fish.minTankL}L 的缸，或移除「${fish.name}」`,
    }));
}

export type DensityCheck = {
  totalCm: number;
  cmPerL: number;
  threshold: number;
  over: boolean;
  /** 距经验上限的剩余成体长度 cm（负值=已超标；群游补尾建议据此判断余量） */
  remainingCm: number;
  /** 超出经验上限的总成体长度 cm（未超标为 0） */
  excessCm: number;
  /** 建议减少的尾数（按平均成体长度估算；未超标为 0） */
  suggestRemove: number;
  note: string;
};

/**
 * 规则 7：密度校验（经验估算，不阻断）：
 * 小型鱼(平均成体 <5cm) 1cm/1L；大型鱼 1cm/2L，中间线性过渡；
 * 过滤强可上浮，结果仅作建议。超标时给出建议减少的尾数（经验估算）。
 */
export function checkDensity(entries: { fish: Fish; count: number }[], effectiveL: number): DensityCheck | null {
  const fishCount = entries.reduce((s, e) => s + e.count, 0);
  if (fishCount === 0 || effectiveL <= 0) return null;
  const totalCm = entries.reduce((s, e) => s + e.fish.adultCm * e.count, 0);
  const totalN = fishCount;
  const avgCm = totalCm / totalN;
  // 1cm/1L (avg 3cm) → 1cm/2L (avg 10cm) 线性过渡
  const lPerCm = 1 + Math.min(1, Math.max(0, (avgCm - 3) / 7));
  const threshold = 1 / lPerCm; // 允许的最大 cm/L
  const cmPerL = totalCm / effectiveL;
  const over = cmPerL > threshold;
  const remainingCm = threshold * effectiveL - totalCm;
  const excessCm = over ? -remainingCm : 0;
  return {
    totalCm,
    cmPerL: Math.round(cmPerL * 100) / 100,
    threshold: Math.round(threshold * 100) / 100,
    over,
    remainingCm: Math.round(remainingCm * 10) / 10,
    excessCm: Math.round(excessCm * 10) / 10,
    suggestRemove: over ? Math.max(1, Math.ceil(excessCm / avgCm)) : 0,
    note: '经验估算：按 1cm 鱼/1~2L 水计，过滤能力强可适当上浮；超标只作建议，不阻断',
  };
}

/**
 * 合并同一组鱼的多条结论为一条（保留全部原因），并按优先级排序：
 * 严重度（硬冲突→警告→建议）→ 原因数（纠缠多的优先）→ 键名（稳定序）。
 */
export function groupReasons(raw: RawIssue[]): StockingIssue[] {
  const map = new Map<string, StockingIssue>();
  for (const r of raw) {
    const fishIds = [...new Set(r.fishIds)].sort();
    const key = fishIds.join('|');
    const { fishIds: _drop, ...reason } = r;
    const g = map.get(key);
    if (g) {
      g.reasons.push(reason);
    } else {
      map.set(key, {
        key,
        scope: fishIds.length > 1 ? 'pair' : 'fish',
        fishIds,
        severity: reason.severity,
        reasons: [reason],
      });
    }
  }
  const groups = [...map.values()];
  for (const g of groups) {
    g.reasons.sort((x, y) => SEVERITY_ORDER[x.severity] - SEVERITY_ORDER[y.severity]);
    g.severity = g.reasons[0].severity;
  }
  groups.sort(
    (x, y) =>
      SEVERITY_ORDER[x.severity] - SEVERITY_ORDER[y.severity] ||
      y.reasons.length - x.reasons.length ||
      x.key.localeCompare(y.key),
  );
  return groups;
}

/** 汇总入口：全部混养检查 → 合并同类 + 优先级排序后的结论列表 */
export function checkStocking(
  entries: { fish: Fish; count: number }[],
  ctx: StockingContext,
): StockingIssue[] {
  const raw: RawIssue[] = [];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      raw.push(...checkPair(entries[i].fish, entries[j].fish, ctx));
    }
  }
  raw.push(...checkPlantNip(entries, ctx.hasPlants));
  // 群游补尾建议需结合缸内余量（缸里已有多少别的鱼），先算密度
  const density = checkDensity(entries, ctx.effectiveL);
  raw.push(...checkSchooling(entries, { remainingCm: density?.remainingCm }));
  raw.push(...checkTankSize(entries, ctx.nominalL, ctx.effectiveL));
  return groupReasons(raw);
}
