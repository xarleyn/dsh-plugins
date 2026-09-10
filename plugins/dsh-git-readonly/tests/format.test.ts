/** Unit tests for deterministic git output parsing (SPEC §7). */

import { describe, expect, it } from 'vitest';

import {
  parseDecorations,
  parseFormatRecord,
  parseNumstat,
  parsePorcelainBlame,
  SHOW_META_FORMAT,
  UNIT_SEP,
} from '../src/git/format.js';

describe('parseFormatRecord', () => {
  it('splits fixed fields and keeps the remainder as the last field', () => {
    const record = ['h1', 'h2', 'Author', '2026-01-01T00:00:00+00:00', 'subject', 'p1 p2', 'body\nlines'].join(UNIT_SEP);
    expect(parseFormatRecord(record, 6)).toEqual([
      'h1',
      'h2',
      'Author',
      '2026-01-01T00:00:00+00:00',
      'subject',
      'p1 p2',
      'body\nlines',
    ]);
  });

  it('absorbs separator characters inside the body field', () => {
    const body = `line${UNIT_SEP}with${UNIT_SEP}seps`;
    const record = ['h', 's', 'h', 'd', 'sub', 'p', body].join(UNIT_SEP);
    expect(parseFormatRecord(record, 6)[6]).toBe(body);
  });

  it('tolerates truncated records', () => {
    const parsed = parseFormatRecord(['h', 's'].join(UNIT_SEP), 3);
    expect(parsed).toEqual(['h', 's', '', '']);
  });

  it('uses the documented show template shape', () => {
    expect(SHOW_META_FORMAT.split(UNIT_SEP)).toEqual([
      '%H',
      '%h',
      '%an',
      '%aI',
      '%s',
      '%P',
      '%b',
    ]);
  });
});

describe('parseDecorations', () => {
  it('splits and cleans decoration entries', () => {
    expect(parseDecorations(' (HEAD -> main, origin/main, tag: v1.0)')).toEqual([
      'HEAD -> main',
      'origin/main',
      'v1.0',
    ]);
    expect(parseDecorations('')).toEqual([]);
  });
});

describe('parseNumstat', () => {
  it('parses additions, deletions and binary rows', () => {
    const output = [
      '12\t3\tsrc/a.ts',
      '-\t-\tlogo.png',
      '0\t1\trenamed "with spaces".txt',
      '',
    ].join('\n');
    expect(parseNumstat(output)).toEqual([
      { path: 'src/a.ts', additions: 12, deletions: 3 },
      { path: 'logo.png', additions: undefined, deletions: undefined },
      { path: 'renamed "with spaces".txt', additions: 0, deletions: 1 },
    ]);
  });
});

describe('parsePorcelainBlame', () => {
  const porcelain = [
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1 1 1',
    'author Alice',
    'author-time 1700000000',
    'summary add line one',
    'filename one.txt',
    '\tline one',
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 1 2 1',
    'author Bob',
    'author-time 1700000100',
    'summary change to line two',
    'filename one.txt',
    '\tline two (edited)',
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 1 3',
    '\tline three from b',
    '',
  ].join('\n');

  it('attributes each line to its commit with metadata', () => {
    const lines = parsePorcelainBlame(porcelain);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({
      line: 1,
      oid: 'a'.repeat(40),
      author: 'Alice',
      summary: 'add line one',
      content: 'line one',
    });
    expect(lines[1]).toMatchObject({
      line: 2,
      oid: 'b'.repeat(40),
      author: 'Bob',
      content: 'line two (edited)',
    });
    // Abbreviated porcelain block reuses the metadata of the commit.
    expect(lines[2]).toMatchObject({
      line: 3,
      oid: 'b'.repeat(40),
      author: 'Bob',
      content: 'line three from b',
    });
  });

  it('parses author-time into ISO strings', () => {
    const lines = parsePorcelainBlame(porcelain);
    expect(lines[0]?.authoredAt).toBe(new Date(1_700_000_000 * 1000).toISOString());
  });
});
