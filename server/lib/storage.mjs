import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

function defaultData() {
  return {
    version: 1,
    meta: {
      secret: randomBytes(32).toString("base64url"),
      createdAt: Date.now(),
    },
    users: [],
    userStates: {},
    userEvents: {},
    webhooks: {},
    templates: [],
    runtime: {},
  };
}

export class JsonDatabase {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = defaultData();
    this.queue = Promise.resolve();
  }

  async load() {
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8"));
      if (parsed && typeof parsed === "object") {
        const base = defaultData();
        this.data = { ...base, ...parsed, meta: { ...base.meta, ...parsed.meta } };
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await this.save();
    }
    return this.data;
  }

  async update(mutator) {
    const run = async () => {
      const result = await mutator(this.data);
      await this.save();
      return result;
    };
    this.queue = this.queue.then(run, run);
    return this.queue;
  }

  async save() {
    const temporary = `${this.filePath}.tmp`;
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(temporary, `${JSON.stringify(this.data, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(temporary, this.filePath);
  }
}

export function createDatabase(dataDirectory) {
  return new JsonDatabase(join(dataDirectory, "jianding-backend.json"));
}
