// The calculator and saved configurations use keV. Convert only at the UI boundary.
export function kevToEvInput(value) {
  if (value === null || value === undefined || String(value).trim() === "") return "";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return String(Number((numeric * 1000).toPrecision(15)));
}

export function evInputToKev(value) {
  if (value === null || value === undefined || String(value).trim() === "") return "";
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric / 1000 : value;
}
