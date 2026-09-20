// Merges freshly loaded daily limits into the admin's input texts. A row keeps
// what the admin typed when it differs from what was last loaded (an unsaved
// edit); every other row, new rows, and rows in `resetIds` (just saved) take
// the server value. Rows no longer on the server are dropped.
export function mergeLimits(
  prevLoaded: Record<string, string>,
  inputs: Record<string, string>,
  nextLoaded: Record<string, string>,
  resetIds: readonly string[] = [],
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const [id, serverValue] of Object.entries(nextLoaded)) {
    const edited = id in inputs && id in prevLoaded && inputs[id] !== prevLoaded[id];
    merged[id] = edited && !resetIds.includes(id) ? inputs[id] : serverValue;
  }
  return merged;
}
