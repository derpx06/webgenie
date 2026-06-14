import { StorageEnum } from '../base/enums';
import { createStorage } from '../base/base';
import type { BaseStorage } from '../base/types';

// Interface for user profile configuration
export interface UserProfile {
  userId: string;
  name?: string;
  email?: string;
  preferences?: {
    theme?: 'light' | 'dark' | 'system';
    language?: string;
    customInstructions?: string;
    [key: string]: any;
  };
  facts?: string[];
  lastUpdated?: string;
}

export type UserStorage = BaseStorage<UserProfile> & {
  createProfile: (profile: Partial<UserProfile>) => Promise<void>;
  updateProfile: (profile: Partial<UserProfile>) => Promise<void>;
  getProfile: () => Promise<UserProfile>;
  getUserId: () => Promise<string>;
  addFacts: (facts: string[]) => Promise<void>;
  removeFact: (fact: string) => Promise<void>;
  clearFacts: () => Promise<void>;
};

// Default profile
export const DEFAULT_USER_PROFILE: UserProfile = {
  userId: 'unknown',
  facts: [],
  preferences: {
    theme: 'system',
    language: 'en',
  },
};

const storage = createStorage<UserProfile>('user-profile', DEFAULT_USER_PROFILE, {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

export const userStore: UserStorage = {
  ...storage,

  async createProfile(profile: Partial<UserProfile>) {
    const fullProfile = {
      ...DEFAULT_USER_PROFILE,
      ...profile,
      userId: profile.userId || crypto.randomUUID(),
      lastUpdated: new Date().toISOString(),
    };
    await storage.set(fullProfile);
  },

  async updateProfile(profile: Partial<UserProfile>) {
    const currentProfile = (await storage.get()) || DEFAULT_USER_PROFILE;
    
    // Deep merge simple preferences
    const preferences = {
      ...DEFAULT_USER_PROFILE.preferences,
      ...currentProfile.preferences,
      ...profile.preferences,
    };

    await storage.set({
      ...currentProfile,
      ...profile,
      preferences,
      lastUpdated: new Date().toISOString(),
    });
  },

  async getProfile() {
    const profile = await storage.get();
    return profile || DEFAULT_USER_PROFILE;
  },

  async getUserId() {
    const profile = await this.getProfile();
    if (!profile.userId || profile.userId === 'unknown') {
      const newUserId = crypto.randomUUID();
      await this.updateProfile({ userId: newUserId });
      return newUserId;
    }
    return profile.userId;
  },

  async addFacts(newFacts: string[]) {
    const currentProfile = (await storage.get()) || DEFAULT_USER_PROFILE;
    const existingFacts = currentProfile.facts || [];
    
    // Filter out duplicates (exact matches)
    const combined = [...existingFacts];
    for (const f of newFacts) {
      const trimmed = f.trim();
      if (trimmed && !combined.includes(trimmed)) {
        combined.push(trimmed);
      }
    }

    await storage.set({
      ...currentProfile,
      facts: combined,
      lastUpdated: new Date().toISOString(),
    });
  },

  async removeFact(fact: string) {
    const currentProfile = (await storage.get()) || DEFAULT_USER_PROFILE;
    const existingFacts = currentProfile.facts || [];
    const filtered = existingFacts.filter(f => f !== fact);

    await storage.set({
      ...currentProfile,
      facts: filtered,
      lastUpdated: new Date().toISOString(),
    });
  },

  async clearFacts() {
    const currentProfile = (await storage.get()) || DEFAULT_USER_PROFILE;
    await storage.set({
      ...currentProfile,
      facts: [],
      lastUpdated: new Date().toISOString(),
    });
  },
};

