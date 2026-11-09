import type { Job, Row } from "./domain";

export function expiredCompletedBackups(job: Job, cutoff: number) {
  const paths = new Set<string>();
  let changed = false;
  const rows = job.rows.map((row) => {
    if (row.phase !== "completed" || (!row.backup && !row.outgoing)) return row;
    const completed = row.history.slice().reverse().find((entry) => entry.phase === "completed");
    if (!completed || !(Date.parse(completed.at) <= cutoff)) return row;

    const namespace = (row as Row & { backupNamespace?: string }).backupNamespace ?? row.id;
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(namespace)) return row;
    const directory = `${job.account}/${namespace}`;
    const images = row.backup?.images ?? [];
    // Paths must belong to this specific article's immutable backup.
    if (images.some(({ path }) => !path.startsWith(directory + "/") ||
      !/^image-\d+$/.test(path.slice(directory.length + 1)))) return row;
    for (const { path } of images) paths.add(path);
    if (images.length) paths.add(`${directory}/backup.json`);

    changed = true;
    const { backup: _backup, outgoing: _outgoing, ...summary } = row;
    return summary;
  });
  return changed ? { document: { ...job, rows }, paths: [...paths] } : undefined;
}
