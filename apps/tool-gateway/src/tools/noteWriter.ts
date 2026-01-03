import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { z } from 'zod';
import { ToolDefinition } from './types';
import fs from 'node:fs';
import path from 'node:path';

const noteSchema = z.object({
  title: z.string().min(1).max(100),
  content: z.string().min(1).max(5000),
});

async function getDb() {
  const dbPath = path.resolve('data/notes.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = await open({ filename: dbPath, driver: sqlite3.Database });
  await db.exec(`CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);
  return db;
}

export function createNoteWriterTool(): ToolDefinition {
  return {
    name: 'note_writer',
    description: 'Stores a short note in a local sqlite database',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short note title' },
        content: { type: 'string', description: 'Note body text' },
      },
      required: ['title', 'content'],
      additionalProperties: false,
    },
    schema: noteSchema,
    async handler(rawArgs) {
      const parsed = noteSchema.safeParse(rawArgs);
      if (!parsed.success) throw new Error('invalid_args');
      const db = await getDb();
      const createdAt = new Date().toISOString();
      const stmt = await db.run('INSERT INTO notes (title, content, created_at) VALUES (?, ?, ?)', parsed.data.title, parsed.data.content, createdAt);
      return { id: stmt.lastID, created_at: createdAt };
    },
  };
}
