import { Env } from './index';

export interface User {
  id: string;
  email: string;
  espn_s2: string;
  espn_swid: string;
  created_at: string;
  updated_at: string;
}

export interface CreateUserRequest {
  email: string;
  espn_s2: string;
  espn_swid: string;
}

export interface UpdateUserRequest {
  espn_s2?: string;
  espn_swid?: string;
}

export class DatabaseService {
  constructor(private env: Env) {}

  async createUser(userData: CreateUserRequest): Promise<User> {
    const id = crypto.randomUUID();
    
    const result = await this.env.DB.prepare(`
      INSERT INTO users (id, email, espn_s2, espn_swid)
      VALUES (?, ?, ?, ?)
      RETURNING *
    `).bind(id, userData.email, userData.espn_s2, userData.espn_swid).first<User>();

    if (!result) {
      throw new Error('Failed to create user');
    }

    return result;
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const result = await this.env.DB.prepare(`
      SELECT * FROM users WHERE email = ?
    `).bind(email).first<User>();

    return result || null;
  }

  async getUserById(id: string): Promise<User | null> {
    const result = await this.env.DB.prepare(`
      SELECT * FROM users WHERE id = ?
    `).bind(id).first<User>();

    return result || null;
  }

  async updateUser(id: string, userData: UpdateUserRequest): Promise<User | null> {
    const updates: string[] = [];
    const values: any[] = [];

    if (userData.espn_s2 !== undefined) {
      updates.push('espn_s2 = ?');
      values.push(userData.espn_s2);
    }

    if (userData.espn_swid !== undefined) {
      updates.push('espn_swid = ?');
      values.push(userData.espn_swid);
    }

    if (updates.length === 0) {
      return await this.getUserById(id);
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    const result = await this.env.DB.prepare(`
      UPDATE users SET ${updates.join(', ')} WHERE id = ?
      RETURNING *
    `).bind(...values).first<User>();

    return result || null;
  }

  async deleteUser(id: string): Promise<boolean> {
    const result = await this.env.DB.prepare(`
      DELETE FROM users WHERE id = ?
    `).bind(id).run();

    return result.success && result.changes > 0;
  }

  async getUserCredentials(userId: string): Promise<{ espn_s2: string; espn_swid: string } | null> {
    const result = await this.env.DB.prepare(`
      SELECT espn_s2, espn_swid FROM users WHERE id = ?
    `).bind(userId).first<{ espn_s2: string; espn_swid: string }>();

    return result || null;
  }
}