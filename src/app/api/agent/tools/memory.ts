import fs from 'fs/promises';
import path from 'path';

const MEMORY_FILE = path.join(process.cwd(), '.agentic-memory.json');

export async function getPreferences(): Promise<string[]> {
  try {
    const data = await fs.readFile(MEMORY_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return [];
    }
    console.error("Error reading memory:", error);
    return [];
  }
}

export async function savePreference(rule: string): Promise<string> {
  try {
    const prefs = await getPreferences();
    
    if (!prefs.includes(rule)) {
      prefs.push(rule);
      await fs.writeFile(MEMORY_FILE, JSON.stringify(prefs, null, 2), 'utf8');
      return `SYSTEM: Rule saved successfully. I will remember this preference for all future interactions.`;
    }
    
    return `SYSTEM: This preference already exists in memory.`;
  } catch (error: any) {
    return `Error saving preference: ${error.message}`;
  }
}
