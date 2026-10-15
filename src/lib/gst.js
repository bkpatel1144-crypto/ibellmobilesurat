// GST rules for bills.
// The shop can charge GST on every bill, or only on bills paid into the bank (UPI, card,
// bank transfer, cheque) - cash bills then carry no GST. Prices can include GST (the customer
// pays the shown price; GST is taken out of it) or exclude it (GST is added on top).
import { num, round2 } from './format';

export const GST_STATES = {
  '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand',
  '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', 10: 'Bihar', 11: 'Sikkim',
  12: 'Arunachal Pradesh', 13: 'Nagaland', 14: 'Manipur', 15: 'Mizoram', 16: 'Tripura', 17: 'Meghalaya',
  18: 'Assam', 19: 'West Bengal', 20: 'Jharkhand', 21: 'Odisha', 22: 'Chhattisgarh', 23: 'Madhya Pradesh',
  24: 'Gujarat', 26: 'Dadra & Nagar Haveli and Daman & Diu', 27: 'Maharashtra', 29: 'Karnataka', 30: 'Goa',
  31: 'Lakshadweep', 32: 'Kerala', 33: 'Tamil Nadu', 34: 'Puducherry', 35: 'Andaman & Nicobar', 36: 'Telangana',
  37: 'Andhra Pradesh', 38: 'Ladakh',
};

const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const validGstin = (v) => GSTIN.test(String(v || '').trim().toUpperCase());
export const stateOf = (gstin) => {
  const code = String(gstin || '').slice(0, 2);
  return GST_STATES[code] || GST_STATES[Number(code)] ? code : '';
};
export const stateName = (code) => GST_STATES[code] || GST_STATES[Number(code)] || '';

/** Does GST apply to a bill paid with this mode? */
export function gstApplies(settings, mode) {
  if (!settings?.gstEnabled) return false;
  return settings.gstOn === 'all' || mode !== 'Cash';
}

/**
 * Bill totals. Returns taxable value, GST and the bill total.
 *   inclusive: price already contains GST → GST = total − total / (1 + rate)
 *   exclusive: GST is added on top of the price
 */
export function billTotals({ subtotal, discount, rate, inclusive }) {
  const r = num(rate);
  const net = round2(num(subtotal) - num(discount));
  if (!r) return { taxable: net, tax: 0, total: net };
  if (inclusive) {
    const taxable = round2(net / (1 + r / 100));
    return { taxable, tax: round2(net - taxable), total: net };
  }
  const tax = round2((net * r) / 100);
  return { taxable: net, tax, total: round2(net + tax) };
}

/** CGST + SGST inside the shop's state; IGST when the customer's GSTIN is from another state. */
export function splitGst(tax, shopGstin, customerGstin) {
  const shop = stateOf(shopGstin);
  const cust = stateOf(customerGstin);
  if (shop && cust && shop !== cust) return { inter: true, cgst: 0, sgst: 0, igst: round2(tax), placeOfSupply: cust };
  const cgst = round2(tax / 2);
  return { inter: false, cgst, sgst: round2(tax - cgst), igst: 0, placeOfSupply: cust || shop };
}

/** Spreads discount and GST over the lines in proportion to their price (last line takes the rounding). */
export function spreadLines(prices, { discount, taxable, tax }) {
  const sum = prices.reduce((s, p) => s + num(p), 0) || 1;
  let leftTaxable = taxable;
  let leftTax = tax;
  return prices.map((p, i) => {
    if (i === prices.length - 1) return { taxable: round2(leftTaxable), tax: round2(leftTax) };
    const share = num(p) / sum;
    const t = round2(taxable * share);
    const g = round2(tax * share);
    leftTaxable -= t;
    leftTax -= g;
    return { taxable: t, tax: g };
  });
}
