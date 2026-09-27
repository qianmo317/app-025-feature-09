import type { Fish } from './types';

/**
 * 混养兼容性检查——需求文档 §8 规则：
 * 1. 攻击性 × 温和 → 冲突（除非缸体标称容积 ≥ 攻击性鱼种 minTankL × 1.5 且有隔离区）
 * 2. 成体体长差 > 3 倍 → 小鱼被吃风险
 * 3. 水温/GH/pH 区间无交集 → 硬冲突
 * 4. 啃草鱼 × 草缸 → 警告
 * 5. 群游鱼数量 < minSchool（默认 6）→ 建议补足（结合缸内余量给补尾数）
 *
 * 结论组织方式：
 * - 每条规则各自产出 Finding，标注依据规则、涉及鱼种、消除改法；
 * - checkStocking 把同一对象（同一对鱼 / 同一尾鱼 / 整缸）的多条 Finding
 *   合并为一条 StockingIssue（保留全部原因），并按优先级排序输出，
 *   页面按序展示即"先改哪条"的处理顺序；
 * - 口径约定：缸体够不够一律对比「标称容积」（minTankL 的口径），
 *   密度与群游余量用「有效水量」，两者不混用；
 * - 数量类结论（群游/单养雄鱼/密度）给出补/减尾数建议，标注"经验估算，不阻断"。
 */

export type Severity = 'conflict' | 'warning' | 'info';

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

/** 规则元数据：结论标注 + 同严重度内的处理次序（rank 小者先改） */
export const RULE_META: Record<IssueCode, { rule: string; rank: number }> = {
  'param-temp': { rule: '规则3·水温区间无交集', rank: 0 },
  'param-gh': { rule: '规则3·GH 区间无交集', rank: 1 },
  'param-ph': { rule: '规则3·pH 区间无交集', rank: 2 },
  'size-gap': { rule: '规则2·成体体长差超 3 倍', rank: 3 },
  aggression: { rule: '规则1·攻击性×温和', rank: 4 },
  'tank-too-small': { rule: '附加·低于最小缸容', rank: 5 },
  'single-male': { rule: '附加·单养雄鱼多尾', rank: 6 },
  'plant-nip': { rule: '规则4·啃草×草缸', rank: 7 },
  schooling: { rule: '规则5·群游数量不足', rank: 8 },
  density: { rule: '附加·密度经验估算', rank: 9 },
};

/** 严重度决定处理次序的百位：硬冲突 < 警告 < 建议 */
const SEVERITY_BASE: Record<Severity, number> = { conflict: 0, warning: 100, info: 200 };

/** 数量类建议：补（正）/减（负）尾数。经验估算，不阻断 */
export type CountDelta = { fishId: string; delta: number };

/** 单条规则检出的原始结论 */
export type Finding = {
  severity: Severity;
  code: IssueCode;
  /** 依据的规则（含编号），如「规则3·水温区间无交集」 */
  rule: string;
  /** 涉及的鱼种 id；整缸结论（密度）为 [] */
  fishIds: string[];
  /** 原因描述 */
  message: string;
  /** 改哪一项能让该结论消失 */
  fix: string;
  /** 数量类建议（补/减尾数，经验估算不阻断） */
  countDelta?: CountDelta;
};

/** 合并后的结论：同一对象的多条原因合并保留，按优先级排序展示 */
export type StockingIssue = {
  /** 稳定键：pair:a|b / fish:a / tank */
  key: string;
  /** 各原因中最高的严重度 */
  severity: Severity;
  /** 主原因（优先级最高的那条），用于展示定位 */
  code: IssueCode;
  fishIds: string[];
  /** 全部原因（按优先级排列，合并不丢） */
  reasons: { code: IssueCode; rule: string; message: string }[];
  /** 消除该结论的改法（去重，按优先级排列） */
  fixes: string[];
  countDeltas: CountDelta[];
  /** 处理顺序权重，越小越应先改 */
  priority: number;
};

export type PairCheckContext = {
  /** 缸体标称容积 L（l×w×h/1000）：minTankL 的对比口径 */
  nominalL: number;
  hasPlants: boolean;
};

export type StockingContext = PairCheckContext & {
  /** 有效水量 L（扣除底砂与素材）：密度与群游余量的估算口径 */
  effectiveL: number;
};

function finding(
  code: IssueCode,
  severity: Severity,
  fishIds: string[],
  message: string,
  fix: string,
  countDelta?: CountDelta,
): Finding {
  return { severity, code, rule: RULE_META[code].rule, fishIds, message, fix, countDelta };
}

function priorityOf(f: { severity: Severity; code: IssueCode }): number {
  return SEVERITY_BASE[f.severity] + RULE_META[f.code].rank;
}

/** 两个区间的交集判断 */
export function rangesOverlap(a: [number, number], b: [number, number]): boolean {
  return a[0] <= b[1] && b[0] <= a[1];
}

/** 逐对兼容性检查（规则 1~4），每条结论带规则标注与消除改法 */
export function checkPair(a: Fish, b: Fish, ctx: PairCheckContext): Finding[] {
  const issues: Finding[] = [];
  if (a.id === b.id) return issues;
  const pair = [a.id, b.id];
  const big = a.adultCm >= b.adultCm ? a : b;
  const small = a.adultCm >= b.adultCm ? b : a;

  // 规则 3：水质区间无交集 → 硬冲突（水温 / GH / pH）
  if (!rangesOverlap(a.tempRange, b.tempRange)) {
    issues.push(
      finding(
        'param-temp',
        'conflict',
        pair,
        `「${a.name}」(${a.tempRange.join('~')}°C) 与「${b.name}」(${b.tempRange.join('~')}°C) 水温区间无交集，硬冲突`,
        `将「${a.name}」「${b.name}」之一移出本缸（区间无交集，调水质无法相容）`,
      ),
    );
  }
  if (!rangesOverlap(a.ghRange, b.ghRange)) {
    issues.push(
      finding(
        'param-gh',
        'conflict',
        pair,
        `「${a.name}」GH(${a.ghRange.join('~')}) 与「${b.name}」GH(${b.ghRange.join('~')}) 区间无交集，硬冲突`,
        `将「${a.name}」「${b.name}」之一移出本缸（区间无交集，调水质无法相容）`,
      ),
    );
  }
  if (!rangesOverlap(a.phRange, b.phRange)) {
    issues.push(
      finding(
        'param-ph',
        'conflict',
        pair,
        `「${a.name}」pH(${a.phRange.join('~')}) 与「${b.name}」pH(${b.phRange.join('~')}) 区间无交集，硬冲突`,
        `将「${a.name}」「${b.name}」之一移出本缸（区间无交集，调水质无法相容）`,
      ),
    );
  }

  // 规则 1：攻击性 × 温和（semi 视为过渡，仅在缸偏小时提示）
  // 口径：minTankL 是标称容积，对比 ctx.nominalL
  const aggressive = [a, b].find((f) => f.temperament === 'aggressive');
  const other = aggressive ? (aggressive === a ? b : a) : null;
  if (aggressive && other && other.temperament === 'peaceful') {
    const need = Math.round(aggressive.minTankL * 1.5);
    if (ctx.nominalL >= aggressive.minTankL * 1.5) {
      issues.push(
        finding(
          'aggression',
          'warning',
          pair,
          `「${aggressive.name}」攻击性强，与「${other.name}」混养需缸体标称 ≥ ${need}L（当前满足），且必须布置隔离区/躲避物`,
          `布置隔离区/躲避物；若仍追咬，移出「${other.name}」或「${aggressive.name}」`,
        ),
      );
    } else {
      issues.push(
        finding(
          'aggression',
          'conflict',
          pair,
          `「${aggressive.name}」攻击性强 × 「${other.name}」温和 → 混养冲突：缸体标称需 ≥ ${need}L（当前标称约 ${Math.round(ctx.nominalL)}L，不满足）`,
          `换标称 ≥ ${need}L 的缸并布置隔离区，或将「${aggressive.name}」「${other.name}」之一移出`,
        ),
      );
    }
  } else if (aggressive && other && other.temperament === 'semi') {
    issues.push(
      finding(
        'aggression',
        'warning',
        pair,
        `「${aggressive.name}」×「${other.name}」均为强势鱼，建议留意追咬`,
        `布置躲避物并观察；追咬严重时移出「${other.name}」`,
      ),
    );
  }

  // 规则 2：成体体长差 > 3 倍 → 小鱼被吃风险
  if (big.adultCm > small.adultCm * 3) {
    issues.push(
      finding(
        'size-gap',
        'conflict',
        pair,
        `「${big.name}」成体 ${big.adultCm}cm 超过「${small.name}」(${small.adultCm}cm) 的 3 倍，存在被吞食风险`,
        `将「${big.name}」「${small.name}」之一移出，或待「${small.name}」长到 > ${Math.ceil(big.adultCm / 3)}cm 再合缸`,
      ),
    );
  }

  // 规则 4：啃草鱼 × 草缸（涉及的是啃草的那尾鱼，与配对另一方无关）
  if (ctx.hasPlants && (a.plantNip || b.plantNip)) {
    const nipper = a.plantNip ? a : b;
    issues.push(
      finding(
        'plant-nip',
        'warning',
        [nipper.id],
        `「${nipper.name}」有啃草/拔草习性，与草缸混养会破坏水草`,
        `移出「${nipper.name}」，或改无水草缸/换耐啃水草`,
      ),
    );
  }

  return issues;
}

/**
 * 群游鱼数量检查（规则 5）与单养雄鱼提示。
 * 给 ctx.effectiveL 时按缸内余量（密度经验阈值）评估"还能再养几尾"：
 * 余量不足时改口建议先减其他鱼/换大缸，而不是盲目让补尾数。
 */
export function checkSchooling(
  entries: { fish: Fish; count: number }[],
  ctx?: { effectiveL: number },
): Finding[] {
  const issues: Finding[] = [];
  const totalCm = entries.reduce((s, e) => s + e.fish.adultCm * e.count, 0);
  const totalCount = entries.reduce((s, e) => s + e.count, 0);
  for (const { fish, count } of entries) {
    if (fish.schooling && count > 0) {
      const min = fish.minSchool ?? 6;
      if (count < min) {
        const need = min - count;
        let fix = `再补 ${need} 尾「${fish.name}」（${count}→${min} 尾）`;
        if (ctx && ctx.effectiveL > 0 && totalCount > 0) {
          // 缸内余量 = 当前密度阈值允许的总鱼体长 − 已有总鱼体长
          const threshold = densityThresholdCmPerL(totalCm / totalCount);
          const addable = Math.max(0, Math.floor((threshold * ctx.effectiveL - totalCm) / fish.adultCm));
          if (addable < need) {
            fix = `缸内余量约只够再养 ${addable} 尾「${fish.name}」（还差 ${need} 尾）：先减少其他鱼或换更大缸再补足；若无法补足，建议移出该鱼`;
          }
        }
        issues.push(
          finding(
            'schooling',
            'info',
            [fish.id],
            `「${fish.name}」为群游鱼，当前 ${count} 尾 < ${min} 尾，单养会应激，建议补足到 ${min} 尾以上`,
            `${fix}（经验估算，不阻断）`,
            { fishId: fish.id, delta: need },
          ),
        );
      }
    }
    if (fish.singleMale && count > 1) {
      issues.push(
        finding(
          'single-male',
          'warning',
          [fish.id],
          `「${fish.name}」雄性间会激烈互斗，建议只养 1 尾（当前 ${count} 尾）`,
          `减 ${count - 1} 尾，只留 1 尾雄鱼（或分缸饲养）（经验估算，不阻断）`,
          { fishId: fish.id, delta: -(count - 1) },
        ),
      );
    }
  }
  return issues;
}

/** 缸体最小容量检查（口径：标称容积 vs minTankL） */
export function checkTankSize(entries: { fish: Fish; count: number }[], nominalL: number): Finding[] {
  return entries
    .filter(({ fish, count }) => count > 0 && nominalL > 0 && nominalL < fish.minTankL)
    .map(({ fish }) =>
      finding(
        'tank-too-small',
        'conflict',
        [fish.id],
        `「${fish.name}」最小缸体要求 ${fish.minTankL}L（标称容积），当前缸体标称约 ${Math.round(nominalL)}L，不建议饲养`,
        `换标称 ≥ ${fish.minTankL}L 的缸，或移出「${fish.name}」`,
      ),
    );
}

export type DensityCheck = {
  totalCm: number;
  cmPerL: number;
  threshold: number;
  over: boolean;
  /** 超标时按平均成体估算的建议减尾数（经验估算，不阻断） */
  suggestRemove: number;
  note: string;
};

/**
 * 密度经验阈值（cm/L）：平均成体 3cm → 1cm/1L，10cm → 1cm/2L，中间线性过渡。
 * 过滤强可上浮；该阈值同时用于密度校验与群游余量估算。
 */
export function densityThresholdCmPerL(avgCm: number): number {
  const lPerCm = 1 + Math.min(1, Math.max(0, (avgCm - 3) / 7));
  return 1 / lPerCm;
}

/**
 * 密度校验（经验估算，不阻断）：
 * 小型鱼(平均成体 <5cm) 1cm/1L；大型鱼 1cm/2L，中间线性过渡；
 * 过滤强可上浮，结果仅作建议。
 */
export function checkDensity(entries: { fish: Fish; count: number }[], effectiveL: number): DensityCheck | null {
  const fishCount = entries.reduce((s, e) => s + e.count, 0);
  if (fishCount === 0 || effectiveL <= 0) return null;
  const totalCm = entries.reduce((s, e) => s + e.fish.adultCm * e.count, 0);
  const avgCm = totalCm / fishCount;
  const threshold = densityThresholdCmPerL(avgCm);
  const cmPerL = totalCm / effectiveL;
  const over = cmPerL > threshold;
  return {
    totalCm,
    cmPerL: Math.round(cmPerL * 100) / 100,
    threshold: Math.round(threshold * 100) / 100,
    over,
    suggestRemove: over ? Math.max(1, Math.ceil((totalCm - threshold * effectiveL) / avgCm)) : 0,
    note: '经验估算：按 1cm 鱼/1~2L 水计，过滤能力强可适当上浮；超标只作建议，不阻断',
  };
}

/** 把同一对象（同一对鱼 / 同一尾鱼 / 整缸）的多条结论合并为一条，保留全部原因 */
export function mergeFindings(findings: Finding[]): StockingIssue[] {
  const groups = new Map<string, Finding[]>();
  for (const f of findings) {
    const key =
      f.fishIds.length >= 2
        ? `pair:${[...f.fishIds].sort().join('|')}`
        : f.fishIds.length === 1
          ? `fish:${f.fishIds[0]}`
          : 'tank';
    const arr = groups.get(key);
    if (arr) arr.push(f);
    else groups.set(key, [f]);
  }
  const issues: StockingIssue[] = [];
  for (const [key, list] of groups) {
    // 组内按优先级排序：首条即主原因（严重度最高、规则最靠前）
    const sorted = [...list].sort((x, y) => priorityOf(x) - priorityOf(y));
    issues.push({
      key,
      severity: sorted[0].severity,
      code: sorted[0].code,
      fishIds: sorted[0].fishIds,
      reasons: sorted.map((f) => ({ code: f.code, rule: f.rule, message: f.message })),
      fixes: [...new Set(sorted.map((f) => f.fix))],
      countDeltas: sorted.flatMap((f) => (f.countDelta ? [f.countDelta] : [])),
      priority: priorityOf(sorted[0]),
    });
  }
  // 输出按处理顺序排序（优先级相同按键名保证确定性）
  return issues.sort((x, y) => x.priority - y.priority || (x.key < y.key ? -1 : 1));
}

/** 汇总入口：全部混养检查 → 合并 + 按处理顺序排序 */
export function checkStocking(
  entries: { fish: Fish; count: number }[],
  ctx: StockingContext,
): StockingIssue[] {
  const findings: Finding[] = [];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      findings.push(...checkPair(entries[i].fish, entries[j].fish, ctx));
    }
  }
  findings.push(...checkSchooling(entries, ctx));
  findings.push(...checkTankSize(entries, ctx.nominalL));
  const density = checkDensity(entries, ctx.effectiveL);
  if (density && density.over) {
    findings.push(
      finding(
        'density',
        'info',
        [],
        `总密度 ${density.cmPerL}cm/L 超经验阈值 ${density.threshold}cm/L（总鱼体长 ${density.totalCm.toFixed(1)}cm ÷ 有效水量 ${ctx.effectiveL.toFixed(1)}L）`,
        `约减 ${density.suggestRemove} 尾，或换更大缸/强化过滤（经验估算，不阻断）`,
      ),
    );
  }
  return mergeFindings(findings);
}
