// -----------------------------------------------------------------------------
// The state kept in /data (the only writable place of the container): the
// guard of the consumption index, the device seen and its features, the date
// of its last values, the pause after a 429/5xx and the time of the last
// read, so that a restart never forgets a jump the user has not accepted,
// never sends an old value as new, nor reads too soon. A small JSON file,
// written through a temporary file and a rename, one save after the other.
// A missing file is an empty state; a file that cannot be read is NOT: the
// load says so (`unreadable`) and the app never writes over it. Failures are
// logged, never fatal. Taken from gladys-iskra (approved).
// -----------------------------------------------------------------------------

import { readFileSync, statSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';

export const DEFAULT_STATE_FILE = '/data/pure-energie-state.json';
/** A larger file is not ours: ignored (read bounded). */
const MAX_STATE_BYTES = 256 * 1024;

/** What a load gives for a file that exists but cannot be read as our state. */
const UNREADABLE = () => ({ unreadable: true });

export function createFileStore(file = DEFAULT_STATE_FILE) {
  /** The saves one after the other: two never share the temporary file. */
  let queue = Promise.resolve();
  const write = async (data) => {
    const tmp = `${file}.tmp`;
    await writeFile(tmp, JSON.stringify(data), 'utf8');
    await rename(tmp, file);
  };
  return {
    load() {
      try {
        if (statSync(file).size > MAX_STATE_BYTES) {
          return UNREADABLE();
        }
        const data = JSON.parse(readFileSync(file, 'utf8'));
        return data && typeof data === 'object' && !Array.isArray(data) ? data : UNREADABLE();
      } catch (err) {
        // No file yet: an empty state. Anything else is not one.
        return err?.code === 'ENOENT' ? {} : UNREADABLE();
      }
    },
    save(data) {
      const job = queue.then(
        () => write(data),
        () => write(data),
      );
      queue = job.catch(() => {});
      return job;
    },
  };
}

/** The same in memory (tests). */
export function createMemoryStore(initial = {}) {
  let data = structuredClone(initial);
  return {
    load: () => structuredClone(data),
    async save(next) {
      data = structuredClone(next);
    },
    get data() {
      return data;
    },
  };
}
