import { readFile, writeFile, mkdir, copyFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import type { PromptTemplate } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, "../data");
const DATA_FILE = path.resolve(DATA_DIR, "prompt-templates.json");

export class PromptTemplateStore {
  private templates = new Map<string, PromptTemplate>();
  private onUpsert: (template: PromptTemplate) => void;
  private onDelete: (id: string) => void;
  private writePromise: Promise<void> = Promise.resolve();

  constructor(
    onUpsert: (template: PromptTemplate) => void,
    onDelete: (id: string) => void,
  ) {
    this.onUpsert = onUpsert;
    this.onDelete = onDelete;
  }

  async load(): Promise<void> {
    try {
      await mkdir(DATA_DIR, { recursive: true });
      const data = await readFile(DATA_FILE, "utf-8");
      const list: PromptTemplate[] = JSON.parse(data);
      for (const t of list) {
        this.templates.set(t.id, t);
      }
    } catch (e: unknown) {
      if (e instanceof Error && "code" in e && (e as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      console.error("Failed to load prompt-templates.json:", e);
      try {
        const bakFile = `${DATA_FILE}.${Date.now()}.bak`;
        await copyFile(DATA_FILE, bakFile);
        console.warn(`Corrupted prompt-templates.json backed up to: ${bakFile}`);
      } catch {
        // バックアップ失敗時は無視
      }
    }
  }

  private async save(): Promise<void> {
    this.writePromise = this.writePromise.catch((e) => { console.error("PromptTemplate save failed:", e); }).then(async () => {
      await mkdir(DATA_DIR, { recursive: true });
      const data = JSON.stringify(Array.from(this.templates.values()), null, 2);
      await writeFile(DATA_FILE, data, "utf-8");
    });
    return this.writePromise;
  }

  getAll(): PromptTemplate[] {
    return Array.from(this.templates.values());
  }

  async create(name: string, body: string): Promise<PromptTemplate> {
    const now = new Date().toISOString();
    const template: PromptTemplate = {
      id: crypto.randomUUID(),
      name,
      body,
      created_at: now,
      updated_at: now,
    };
    this.templates.set(template.id, template);
    await this.save();
    this.onUpsert(template);
    return template;
  }

  async update(id: string, name: string, body: string): Promise<PromptTemplate | undefined> {
    const template = this.templates.get(id);
    if (!template) return undefined;
    template.name = name;
    template.body = body;
    template.updated_at = new Date().toISOString();
    await this.save();
    this.onUpsert(template);
    return template;
  }

  async delete(id: string): Promise<boolean> {
    const deleted = this.templates.delete(id);
    if (deleted) {
      await this.save();
      this.onDelete(id);
    }
    return deleted;
  }
}
