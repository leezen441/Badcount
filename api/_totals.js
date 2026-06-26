// ============================================================
// Cost calculation — ยกมาจาก app.js (calcSessionTotals + parseShuttleCount)
// เป็น pure function ของ session object → ใช้ใน serverless ได้ (cron คำนวณยอดเอง)
// ⚠️ ต้องตรงกับฝั่งเว็บเป๊ะ (เรื่องเงิน)
// ============================================================

export function parseShuttleCount(str, s) {
  if (!str) return 0;
  if (s && s.simpleShuttleCount) {
    const val = parseInt(str, 10);
    return isNaN(val) ? 0 : val;
  }
  let count = 0;
  const parts = String(str).trim().split(/[\s,\/\\|]+/);
  parts.forEach(p => {
    if (!p) return;
    if (p.includes("-")) {
      const [a, b] = p.split("-");
      const start = parseInt(a, 10);
      const end = parseInt(b, 10);
      if (!isNaN(start) && !isNaN(end) && end >= start && end - start < 50) count += (end - start + 1);
      else if (p) count += 1;
    } else if (p) count += 1;
  });
  return count;
}

export function calcSessionTotals(s) {
  const members = s.members || [];
  const matches = s.matches || [];
  const N = members.length;

  const courtFee = +s.courtFee || 0;
  const courtFeeType = s.courtFeeType || "total";
  const shuttlePrice = +s.shuttlePrice || 0;
  const otherCost = +s.otherCost || 0;
  const otherCostType = s.otherCostType || "perPerson";

  const manualShuttles = members.reduce((sum, m) => sum + (m.shuttlesUsed || 0), 0);
  let matchShuttlesTotal = 0;
  const matchShuttlesMap = {};

  matches.forEach(match => {
    const pIds = match.players || [match.a1, match.a2, match.b1, match.b2].filter(Boolean);
    if (pIds.length === 0) return;

    const count = parseShuttleCount(match.shuttleNumbers, s);
    matchShuttlesTotal += count;

    const exemptPlayers = match.exemptPlayers || [];
    const activeExempts = pIds.filter(id => exemptPlayers.includes(id));
    const exemptCount = activeExempts.length;

    if (exemptCount > 0 && exemptCount < pIds.length) {
      const payingCount = pIds.length - exemptCount;
      const multiplier = pIds.length / payingCount;
      pIds.forEach(id => {
        if (!exemptPlayers.includes(id)) {
          matchShuttlesMap[id] = (matchShuttlesMap[id] || 0) + (count * multiplier);
        }
      });
    } else {
      pIds.forEach(id => {
        matchShuttlesMap[id] = (matchShuttlesMap[id] || 0) + count;
      });
    }
  });

  const totalShuttles = manualShuttles + matchShuttlesTotal;

  const courtPer = N > 0 ? (courtFeeType === "total" ? courtFee / N : courtFee) : 0;
  const otherPer = N > 0 ? (otherCostType === "total" ? otherCost / N : otherCost) : 0;

  let totalAll = 0;
  let unpaidTotal = 0;

  const perMember = members.map((m) => {
    if (m.manualFee !== undefined && m.manualFee !== null && m.manualFee !== "" && !isNaN(m.manualFee)) {
      const cost = +m.manualFee;
      totalAll += cost;
      if (!m.isPaid) unpaidTotal += cost;
      return cost;
    }

    const individualShuttles = (m.shuttlesUsed || 0) + (matchShuttlesMap[m.id] || 0);

    let payableShuttles = individualShuttles;
    if (m.excludeAllShuttles) {
      payableShuttles = 0;
    } else if (m.shuttlesExcluded && m.shuttlesExcluded > 0) {
      payableShuttles = Math.max(0, individualShuttles - m.shuttlesExcluded);
    }

    const cost = courtPer + otherPer + (payableShuttles * shuttlePrice);
    totalAll += cost;
    if (!m.isPaid) unpaidTotal += cost;
    return cost;
  });

  return { totalShuttles, totalAll, unpaidTotal, perMember };
}
