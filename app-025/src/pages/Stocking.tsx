import { useMemo, useState } from 'react';
import type { Plan } from '../core/types';
import { FISHES, fishById } from '../data/db';
import { updatePlan } from '../state/plans';
import { Link } from '../router';
import { effectiveVolumeL, nominalVolumeL } from '../core/volume';
import { checkStocking, checkDensity } from '../core/compatibility';

export default function Stocking({ plan }: { plan: Plan }) {
  const [pickId, setPickId] = useState('');
  const eff = effectiveVolumeL(plan.tank, plan.substrate, plan.items);
  const nominal = nominalVolumeL(plan.tank);
  const hasPlants = plan.items.some((i) => i.kind === 'plant');

  const entries = useMemo(
    () =>
      plan.fishes
        .map((f) => ({ fish: fishById(f.fishId), count: f.count }))
        .filter((e): e is { fish: NonNullable<ReturnType<typeof fishById>>; count: number } => !!e.fish),
    [plan.fishes],
  );

  // 结论已合并（同一对鱼/同一尾鱼一条）并按处理顺序排序
  const issues = useMemo(
    () => checkStocking(entries, { nominalL: nominal, effectiveL: eff, hasPlants }),
    [entries, nominal, eff, hasPlants],
  );
  const density = checkDensity(entries, eff);

  function addFish() {
    if (!pickId) return;
    const found = plan.fishes.find((f) => f.fishId === pickId);
    const next = found
      ? plan.fishes.map((f) => (f.fishId === pickId ? { ...f, count: f.count + 1 } : f))
      : [...plan.fishes, { fishId: pickId, count: 1 }];
    updatePlan(plan.id, { fishes: next });
  }

  function setCount(fishId: string, count: number) {
    const next = count <= 0
      ? plan.fishes.filter((f) => f.fishId !== fishId)
      : plan.fishes.map((f) => (f.fishId === fishId ? { ...f, count } : f));
    updatePlan(plan.id, { fishes: next });
  }

  const nameOf = (id: string) => fishById(id)?.name ?? id;
  const sevLabel = { conflict: '硬冲突', warning: '警告', info: '建议' } as const;
  const nConflict = issues.filter((i) => i.severity === 'conflict').length;
  const nWarning = issues.filter((i) => i.severity === 'warning').length;
  const nInfo = issues.filter((i) => i.severity === 'info').length;

  return (
    <div className="page" data-testid="stocking-page">
      <nav className="row tabs">
        <Link to={`/plan/${plan.id}`} className="tab">
          ← 造景编辑
        </Link>
        <Link to={`/plan/${plan.id}/water`} className="tab">
          水质与设备
        </Link>
        <span className="tab active">生物兼容</span>
        <Link to={`/plan/${plan.id}/bom`} className="tab">
          物料清单 →
        </Link>
      </nav>
      <h1>生物清单与兼容性检查（{plan.name}）</h1>
      <p className="muted">
        标称容积 {nominal.toFixed(0)}L（对比鱼种最小缸容） · 有效水量 {eff.toFixed(1)}L（密度与群游余量估算） ·{' '}
        {hasPlants ? '草缸' : '无植物'}
      </p>

      <div className="row">
        <select data-testid="fish-select" value={pickId} onChange={(e) => setPickId(e.target.value)}>
          <option value="">选择鱼种…</option>
          {FISHES.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}（成体 {f.adultCm}cm，≥{f.minTankL}L）
            </option>
          ))}
        </select>
        <button className="btn primary" data-testid="add-fish" onClick={addFish} disabled={!pickId}>
          加入
        </button>
      </div>

      <table className="table" data-testid="fish-table">
        <thead>
          <tr>
            <th>鱼种</th>
            <th>成体</th>
            <th>耐受（水温/GH/pH）</th>
            <th>性格</th>
            <th>数量</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {entries.length === 0 && (
            <tr>
              <td colSpan={6} className="muted">
                还没有选择鱼种。
              </td>
            </tr>
          )}
          {entries.map(({ fish, count }) => (
            <tr key={fish.id} data-testid={`fish-row-${fish.id}`}>
              <td>{fish.name}</td>
              <td>{fish.adultCm}cm</td>
              <td className="muted small">
                {fish.tempRange.join('~')}°C / GH {fish.ghRange.join('~')} / pH {fish.phRange.join('~')}
              </td>
              <td>
                {fish.temperament === 'aggressive' ? '凶' : fish.temperament === 'semi' ? '半凶' : '温和'}
                {fish.plantNip && ' · 啃草'}
                {fish.schooling && ' · 群游'}
              </td>
              <td>
                <div className="row">
                  <button className="btn sm" data-testid={`dec-${fish.id}`} onClick={() => setCount(fish.id, count - 1)}>
                    −
                  </button>
                  <span data-testid={`count-${fish.id}`}>{count}</span>
                  <button className="btn sm" data-testid={`inc-${fish.id}`} onClick={() => setCount(fish.id, count + 1)}>
                    ＋
                  </button>
                </div>
              </td>
              <td>
                <button className="btn ghost sm" onClick={() => setCount(fish.id, 0)}>
                  移除
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {density && (
        <section className={`card2 ${density.over ? 'over' : ''}`} data-testid="density-card">
          <h3>密度校验（经验估算，建议）</h3>
          <p>
            总成体长度 <b>{density.totalCm.toFixed(1)}cm</b> ÷ {eff.toFixed(1)}L ={' '}
            <b>{density.cmPerL}cm/L</b>（经验阈值 {density.threshold}cm/L）
          </p>
          <p className={density.over ? 'bad' : 'ok'}>
            {density.over
              ? `⚠ 超出经验密度：建议减少约 ${density.suggestRemove} 尾，或换更大缸/强化过滤（不阻断）`
              : '✓ 在经验范围内'}
          </p>
          <p className="muted small">{density.note}</p>
        </section>
      )}

      <h3>检查结果（按建议处理顺序排列）</h3>
      <div data-testid="issues">
        {issues.length === 0 && entries.length > 0 && (
          <div className="okbox" data-testid="no-issues">
            ✓ 未发现混养冲突，密度也在经验范围内。
          </div>
        )}
        {issues.length > 0 && (
          <p className="muted small" data-testid="issues-summary">
            硬冲突 {nConflict} · 警告 {nWarning} · 建议 {nInfo} —— 同一对鱼/同一尾鱼的多条原因已合并；
            按序号处理，每条的「改法」生效后该结论即消失。
          </p>
        )}
        {issues.map((iss, idx) => (
          <div key={iss.key} className={`issue issue-${iss.severity}`} data-testid={`issue-${iss.code}`}>
            <div className="issue-head">
              <span className="issue-rank">#{idx + 1}</span>
              <span className={`issue-sev sev-${iss.severity}`}>{sevLabel[iss.severity]}</span>
              <span className="issue-fish">
                {iss.fishIds.length > 0 ? iss.fishIds.map((id) => `「${nameOf(id)}」`).join(' × ') : '整缸'}
              </span>
              {iss.reasons.map((r) => (
                <span key={r.code} className="tag">
                  {r.rule}
                </span>
              ))}
            </div>
            <ul className="issue-reasons">
              {iss.reasons.map((r, i) => (
                <li key={i}>{r.message}</li>
              ))}
            </ul>
            <div className="issue-fix" data-testid={`fix-${iss.code}`}>
              改法：
              <ol>
                {iss.fixes.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ol>
            </div>
            {iss.countDeltas.length > 0 && (
              <div className="issue-delta">
                {iss.countDeltas.map((d, i) => (
                  <span key={i} className="tag">
                    「{nameOf(d.fishId)}」{d.delta > 0 ? `补 ${d.delta}` : `减 ${-d.delta}`} 尾
                  </span>
                ))}
                <span className="muted small">（数量建议为经验估算，不阻断）</span>
              </div>
            )}
          </div>
        ))}
        {entries.length === 0 && <p className="muted">加入鱼种后自动逐对检查（攻击性、体长差、水质区间、啃草、群游）。</p>}
      </div>
    </div>
  );
}
