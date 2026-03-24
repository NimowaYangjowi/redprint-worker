import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isBackupEnabled,
  getBackupHourUTC,
  getRetentionDays,
  DEFAULT_BACKUP_HOUR_UTC,
  DEFAULT_RETENTION_DAYS,
} from '../../src/lib/backup/constants';

describe('backup constants', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('isBackupEnabled', () => {
    it('returns true when BACKUP_ENABLED=true', () => {
      process.env.BACKUP_ENABLED = 'true';
      expect(isBackupEnabled()).toBe(true);
    });

    it('returns false when BACKUP_ENABLED is not set', () => {
      delete process.env.BACKUP_ENABLED;
      expect(isBackupEnabled()).toBe(false);
    });

    it('returns false when BACKUP_ENABLED=false', () => {
      process.env.BACKUP_ENABLED = 'false';
      expect(isBackupEnabled()).toBe(false);
    });
  });

  describe('getBackupHourUTC', () => {
    it('returns configured hour', () => {
      process.env.BACKUP_HOUR_UTC = '10';
      expect(getBackupHourUTC()).toBe(10);
    });

    it('returns default when not set', () => {
      delete process.env.BACKUP_HOUR_UTC;
      expect(getBackupHourUTC()).toBe(DEFAULT_BACKUP_HOUR_UTC);
    });

    it('returns default for invalid value', () => {
      process.env.BACKUP_HOUR_UTC = 'abc';
      expect(getBackupHourUTC()).toBe(DEFAULT_BACKUP_HOUR_UTC);
    });

    it('returns default for out-of-range value (24)', () => {
      process.env.BACKUP_HOUR_UTC = '24';
      expect(getBackupHourUTC()).toBe(DEFAULT_BACKUP_HOUR_UTC);
    });

    it('returns default for negative value', () => {
      process.env.BACKUP_HOUR_UTC = '-1';
      expect(getBackupHourUTC()).toBe(DEFAULT_BACKUP_HOUR_UTC);
    });

    it('accepts hour 0 (midnight)', () => {
      process.env.BACKUP_HOUR_UTC = '0';
      expect(getBackupHourUTC()).toBe(0);
    });

    it('accepts hour 23', () => {
      process.env.BACKUP_HOUR_UTC = '23';
      expect(getBackupHourUTC()).toBe(23);
    });
  });

  describe('getRetentionDays', () => {
    it('returns configured days', () => {
      process.env.BACKUP_RETENTION_DAYS = '14';
      expect(getRetentionDays()).toBe(14);
    });

    it('returns default when not set', () => {
      delete process.env.BACKUP_RETENTION_DAYS;
      expect(getRetentionDays()).toBe(DEFAULT_RETENTION_DAYS);
    });

    it('returns default for zero', () => {
      process.env.BACKUP_RETENTION_DAYS = '0';
      expect(getRetentionDays()).toBe(DEFAULT_RETENTION_DAYS);
    });

    it('returns default for negative', () => {
      process.env.BACKUP_RETENTION_DAYS = '-5';
      expect(getRetentionDays()).toBe(DEFAULT_RETENTION_DAYS);
    });

    it('accepts 1 day', () => {
      process.env.BACKUP_RETENTION_DAYS = '1';
      expect(getRetentionDays()).toBe(1);
    });
  });
});
