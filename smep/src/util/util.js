/**
 * insist - Lightweight runtime argument validator
 * @param {*} arg
 * @param {string|Function|null} type
 */
export function insist(arg, type = null) {

  if (arg === undefined || arg === null) {
    console.log("require debug: args=", arg, type);
    throw new Error(
      `Required value is missing (was ${
        arg === undefined
          ? "undefined"
          : "null"
      })`
    );
  }

  if (type === null) {
    return arg;
  }

  // =========================================
  // CLASS / CONSTRUCTOR CHECK
  // =========================================

  if (typeof type === "function") {

    if (!(arg instanceof type)) {
      throw new Error(
        `Expected instance of ${type.name}`
      );
    }

    return arg;
  }

  // =========================================
  // STRING TYPE CHECK
  // =========================================

  let isValid = false;

  const lowerType =
    type.toLowerCase();

  switch (lowerType) {

    case "array":
      isValid =
        Array.isArray(arg);
      break;

    case "object":
      isValid =
        arg !== null &&
        typeof arg === "object" &&
        !Array.isArray(arg);
      break;

    default:
      isValid =
        typeof arg === lowerType;
  }

  if (!isValid) {
    throw new Error(
      `Expected type "${type}" but got "${typeof arg}"`
    );
  }

  return arg;
}