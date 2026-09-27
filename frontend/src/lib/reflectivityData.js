// Missing samples must not silently become zero reflectivity through Number(null).
export function finiteSeries(values, length) {
  if (!Array.isArray(values) || !values.length || values.length !== length)
    return null;
  if (
    !values.every(
      (value) =>
        (typeof value === "number" || typeof value === "string") &&
        String(value).trim() !== "" &&
        Number.isFinite(Number(value)),
    )
  )
    return null;
  return values.map(Number);
}
