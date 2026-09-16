// Shared by browser update checks and the Node changelog generator.
// SemVer 2.0.0 precedence: https://semver.org/#spec-item-11
const VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const isNumeric = (identifier) => /^\d+$/.test(identifier);

/** @param {unknown} version */
function parseVersion(version) {
  if (typeof version !== 'string') return null;
  const match = version.match(VERSION_PATTERN);
  if (!match || match[0] !== version) return null;
  const prerelease = match[4] ? match[4].split('.') : [];
  if (
    prerelease.some(
      (part) => isNumeric(part) && part.length > 1 && part[0] === '0',
    )
  ) {
    return null;
  }
  return { core: match.slice(1, 4), prerelease };
}

// Numeric strings avoid losing precision for large version identifiers.
function compareNumeric(left, right) {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1;
  return left === right ? 0 : left < right ? -1 : 1;
}

/**
 * @param {unknown} leftVersion
 * @param {unknown} rightVersion
 * @returns {-1 | 0 | 1 | null}
 */
function compareVersionStrings(leftVersion, rightVersion) {
  const left = parseVersion(leftVersion);
  const right = parseVersion(rightVersion);
  if (!left || !right) return null;
  for (let index = 0; index < 3; index++) {
    const order = compareNumeric(left.core[index], right.core[index]);
    if (order !== 0) return order;
  }
  if (!left.prerelease.length || !right.prerelease.length) {
    if (left.prerelease.length === right.prerelease.length) return 0;
    return left.prerelease.length ? -1 : 1;
  }
  for (
    let index = 0;
    index < Math.max(left.prerelease.length, right.prerelease.length);
    index++
  ) {
    const a = left.prerelease[index];
    const b = right.prerelease[index];
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    if (a === b) continue;
    const aNumeric = isNumeric(a);
    const bNumeric = isNumeric(b);
    if (aNumeric && bNumeric) return compareNumeric(a, b);
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    return a < b ? -1 : 1;
  }
  return 0;
}

module.exports = { parseVersion, compareVersionStrings };
