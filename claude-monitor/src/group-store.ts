import { readFile, writeFile, mkdir, copyFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import type { Group } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, "../data");
const DATA_FILE = path.resolve(DATA_DIR, "groups.json");

export class GroupStore {
  private groups = new Map<string, Group>();
  private onChange: (group: Group) => void;
  private writePromise: Promise<void> = Promise.resolve();

  constructor(onChange: (group: Group) => void) {
    this.onChange = onChange;
  }

  async load(): Promise<void> {
    try {
      await mkdir(DATA_DIR, { recursive: true });
      const data = await readFile(DATA_FILE, "utf-8");
      const list: Group[] = JSON.parse(data);
      for (const g of list) {
        this.groups.set(g.id, g);
      }
    } catch (e: unknown) {
      if (e instanceof Error && "code" in e && (e as NodeJS.ErrnoException).code === "ENOENT") {
        // ファイルが存在しない場合は空配列で起動
        return;
      }
      console.error("Failed to load groups.json:", e);
      // 破損ファイルをバックアップ退避してから空配列で起動
      try {
        const bakFile = `${DATA_FILE}.${Date.now()}.bak`;
        await copyFile(DATA_FILE, bakFile);
        console.warn(`Corrupted groups.json backed up to: ${bakFile}`);
      } catch {
        // バックアップ失敗時（ファイル削除済み等）は無視
      }
    }
  }

  private async save(): Promise<void> {
    this.writePromise = this.writePromise.catch(() => {}).then(async () => {
      await mkdir(DATA_DIR, { recursive: true });
      const data = JSON.stringify(Array.from(this.groups.values()), null, 2);
      await writeFile(DATA_FILE, data, "utf-8");
    });
    return this.writePromise;
  }

  getAll(): Group[] {
    return Array.from(this.groups.values());
  }

  get(id: string): Group | undefined {
    return this.groups.get(id);
  }

  async create(name: string): Promise<Group> {
    const id = crypto.randomUUID();
    const group: Group = {
      id,
      name,
      session_ids: [],
      created_at: new Date().toISOString(),
    };
    this.groups.set(id, group);
    await this.save();
    this.onChange(group);
    return group;
  }

  async update(id: string, name: string): Promise<Group | undefined> {
    const group = this.groups.get(id);
    if (!group) return undefined;
    group.name = name;
    await this.save();
    this.onChange(group);
    return group;
  }

  async delete(id: string): Promise<boolean> {
    const deleted = this.groups.delete(id);
    if (deleted) {
      await this.save();
    }
    return deleted;
  }

  async addSession(groupId: string, sessionId: string): Promise<Group | undefined> {
    const group = this.groups.get(groupId);
    if (!group) return undefined;
    // 他グループに所属している場合は自動除外
    const changedGroups: Group[] = [];
    for (const g of this.groups.values()) {
      if (g.id !== groupId) {
        const idx = g.session_ids.indexOf(sessionId);
        if (idx !== -1) {
          g.session_ids.splice(idx, 1);
          changedGroups.push(g);
        }
      }
    }
    // 冪等: 既に所属していれば無視
    const added = !group.session_ids.includes(sessionId);
    if (added) {
      group.session_ids.push(sessionId);
    }
    await this.save();
    // save成功後にbroadcast
    for (const g of changedGroups) {
      this.onChange(g);
    }
    if (added) {
      this.onChange(group);
    }
    return group;
  }

  async removeSessionFromAll(sessionId: string): Promise<void> {
    const changedGroups: Group[] = [];
    for (const group of this.groups.values()) {
      const idx = group.session_ids.indexOf(sessionId);
      if (idx !== -1) {
        group.session_ids.splice(idx, 1);
        changedGroups.push(group);
      }
    }
    if (changedGroups.length > 0) {
      await this.save();
      changedGroups.forEach((g) => this.onChange(g));
    }
  }

  async removeSession(groupId: string, sessionId: string): Promise<Group | undefined> {
    const group = this.groups.get(groupId);
    if (!group) return undefined;
    const idx = group.session_ids.indexOf(sessionId);
    if (idx === -1) return undefined; // 未所属は undefined を返す（呼び出し側で 404）
    group.session_ids.splice(idx, 1);
    await this.save();
    this.onChange(group);
    return group;
  }
}
