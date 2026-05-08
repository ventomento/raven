/**
 * require - Lightweight runtime argument validator
 * @param {*} arg   - Value to check
 * @param {string|null} type - Optional expected type
 */
export function require(arg, type = null) {
  if (arg === undefined || arg === null) {
    throw new Error(`Required value is missing (was ${arg === undefined ? 'undefined' : 'null'})`);
  }

  if (type === null) {
    return arg;
  }

  // Type checking
  let isValid = false;
  const lowerType = type.toLowerCase();

  switch (lowerType) {
    case 'array':
      isValid = Array.isArray(arg);
      break;
    case 'object':
      isValid = arg !== null && typeof arg === 'object' && !Array.isArray(arg);
      break;
    default:
      isValid = typeof arg === lowerType;
  }

  if (!isValid) {
    throw new Error(`Expected type "${type}" but got "${typeof arg}"`);
  }

  return arg;
}
