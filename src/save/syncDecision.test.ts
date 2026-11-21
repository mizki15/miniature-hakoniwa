import { describe, it, expect } from 'vitest';
import { decideSync, decideViewer } from './syncDecision';

const pc = (remoteVersion: string | null, markerVersion: string | null, localChanged: boolean, localHasProgress = true) =>
  decideSync({ remoteVersion, markerVersion, localChanged, localHasProgress });

describe('decideSync（PC）', () => {
  it('nothingChanged', () => expect(pc('5', '5', false)).toBe('none'));
  it('localOnlyUploads', () => expect(pc('5', '5', true)).toBe('upload'));
  it('stalePcNeverUploads', () => expect(pc('7', '5', false, true)).toBe('download'));
  it('bothChangedAsks', () => expect(pc('7', '5', true)).toBe('ask'));
  it('firstSyncEmptyDriveUploads', () => expect(pc(null, null, false, false)).toBe('upload'));
  it('firstSyncFreshLocalDownloads', () => expect(pc('3', null, false, false)).toBe('download'));
  it('firstSyncWithProgressAsks', () => expect(pc('3', null, false, true)).toBe('ask'));
  it('driveFileDeletedUploads', () => expect(pc(null, '5', false)).toBe('upload'));
});

const ph = (remoteVersion: string | null, markerVersion: string | null, localHasProgress = false) =>
  decideViewer({ remoteVersion, markerVersion, localHasProgress });

describe('decideViewer（スマホ）', () => {
  it('viewerSameVersionNone', () => expect(ph('5', '5')).toBe('none'));
  it('viewerNewVersionDownloads', () => expect(ph('6', '5')).toBe('download'));
  it('viewerFirstTimeWithProgressAsks', () => expect(ph('6', null, true)).toBe('askReplace'));
  it('viewerFirstTimeFreshDownloads', () => expect(ph('6', null, false)).toBe('download'));
  it('viewerNoRemoteNone', () => expect(ph(null, null)).toBe('none'));
});
