import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { Client } from 'pg';
import path from 'path';
import { getSettings } from './settings';

export async function introspectDatabase(dbType: 'sqlite' | 'postgres', connectionString: string): Promise<string> {
  try {
    if (dbType === 'sqlite') {
      // connectionString is the file path relative to the configured workspace
      const { workspaceRoot } = await getSettings();
      const dbPath = path.join(workspaceRoot, connectionString);
      
      const db = await open({
        filename: dbPath,
        driver: sqlite3.Database
      });

      const tables = await db.all("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
      await db.close();

      if (tables.length === 0) return "SYSTEM MESSAGE: Database berhasil terhubung tapi kosong (tidak ada tabel). Beritahu user bahwa database kosong sehingga Anda tidak bisa membuat Prisma schema.";

      let schemaStr = "=== SQLite Database Schema ===\n\n";
      tables.forEach((t: any) => {
        schemaStr += `-- Table: ${t.name}\n${t.sql};\n\n`;
      });
      return schemaStr;

    } else if (dbType === 'postgres') {
      const client = new Client({ connectionString });
      await client.connect();
      
      const query = `
        SELECT table_name, column_name, data_type 
        FROM information_schema.columns 
        WHERE table_schema = 'public'
        ORDER BY table_name;
      `;
      const res = await client.query(query);
      await client.end();

      if (res.rows.length === 0) return "SYSTEM MESSAGE: Database Postgres terhubung tapi tidak ada tabel di schema public. Beritahu user bahwa database kosong.";

      let schemaStr = "=== PostgreSQL Database Schema ===\n\n";
      let currentTable = "";
      
      res.rows.forEach((row) => {
        if (currentTable !== row.table_name) {
          if (currentTable !== "") schemaStr += "\n";
          currentTable = row.table_name;
          schemaStr += `Table: ${currentTable}\n`;
        }
        schemaStr += `  - ${row.column_name} (${row.data_type})\n`;
      });
      
      return schemaStr;
    }
    
    return "Unsupported database type. Please use 'sqlite' or 'postgres'.";
  } catch (error: any) {
    if (error.code === 'ENOENT' || error.message.includes('ENOENT')) {
      return `SYSTEM MESSAGE: File database tidak ditemukan. Beritahu user bahwa file tersebut tidak ada. JANGAN jalankan perintah terminal untuk mencarinya.`;
    }
    return `Error introspecting database: ${error.message}`;
  }
}
