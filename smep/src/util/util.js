/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export function insist(arg, type = null) {

  if (arg === undefined || arg === null) {
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

  if (typeof type === "function") {

    if (!(arg instanceof type)) {
      throw new Error(
        `Expected instance of ${type.name}`
      );
    }

    return arg;
  }

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