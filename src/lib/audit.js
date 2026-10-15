import { cleanImei, deviceName } from './format';

const DAY = 86400000;

export const normCode = (v) => cleanImei(v).toLowerCase();

const matches = (e, code) => e.imei === code || (e.imei2 && e.imei2 === code) || (e.sn && e.sn.toLowerCase() === code);

export const isExpired = (a, now = Date.now()) => Boolean(a.expireAt?.toMillis) && a.expireAt.toMillis() <= now;

export const daysLeft = (a, now = Date.now()) =>
  a.expireAt?.toMillis ? Math.max(0, Math.ceil((a.expireAt.toMillis() - now) / DAY)) : null;

/** The expected device a scanned code belongs to, if any. */
export const findExpected = (audit, code) => audit.expected.find((e) => matches(e, normCode(code)));

/**
 * Splits an audit into found / missing / sold-during / extra.
 * devices    - what this user may see (private sales hidden while locked)
 * rawDevices - every device, used only for the status of expected phones
 */
export function auditResult(audit, devices, rawDevices = devices) {
  if (audit.status === 'completed' && audit.result) return audit.result;

  const foundIds = new Map(); // deviceId → scan
  const extras = [];
  const extraCodes = new Set();
  for (const s of audit.scans || []) {
    const code = normCode(s.code);
    const e = audit.expected.find((x) => matches(x, code));
    if (e) {
      if (!foundIds.has(e.deviceId)) foundIds.set(e.deviceId, s);
      continue;
    }
    if (extraCodes.has(code)) continue;
    extraCodes.add(code);
    const hit = devices.find((x) => x.imei === code || x.imei2 === code || (x.sn && x.sn.toLowerCase() === code));
    // a privately sold phone is reported as "not in system" so the frozen report never reveals it
    const d = hit && !hit.hidden ? hit : null;
    extras.push({
      code: s.code,
      at: s.at,
      by: s.by || '',
      kind: !d ? 'unknown' : d.status === 'sold' ? 'sold' : d.status === 'in_repair' ? 'in_repair' : d.status === 'returned' ? 'returned' : 'new',
      name: d ? deviceName(d) : '',
      sn: d?.sn || '',
      ref: d?.status === 'sold' ? d.saleNo || '' : d?.status === 'returned' ? d.returnNo || '' : '',
    });
  }

  const status = new Map(rawDevices.map((d) => [d.id, d]));
  const found = [];
  const missing = [];
  const soldDuring = [];
  for (const e of audit.expected) {
    const s = foundIds.get(e.deviceId);
    if (s) {
      found.push({ ...e, at: s.at, by: s.by || '', manual: Boolean(s.manual) });
      continue;
    }
    const d = status.get(e.deviceId);
    if (!d) missing.push({ ...e, note: 'Deleted from stock' });
    else if (d.status !== 'in_stock') {
      soldDuring.push({ ...e, status: d.status, ref: d.status === 'sold' && !d.hidden ? d.saleNo || '' : '' });
    } else missing.push(e);
  }
  return { found, missing, soldDuring, extras };
}

export const EXTRA_LABEL = {
  sold: 'Already sold',
  in_repair: 'Marked at repair',
  returned: 'Returned to supplier',
  new: 'Bought after audit started',
  unknown: 'Not in system',
};
