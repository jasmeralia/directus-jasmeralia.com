#!/usr/bin/env node
/**
 * Backfill release years from account-gated itch.io Published fields.
 *
 * Reads a local Firefox cookie export from mcp/scripts/ignored/cookies.json.
 * That file is intentionally gitignored and must never be committed.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');
const cookiePath = path.join(scriptDir, 'ignored', 'cookies.json');
const cachePath = path.join(repoRoot, 'mcp', 'cache', 'itch_published_dates.json');
const userAgent = 'Mozilla/5.0 (Android 16; Mobile; rv:155.0) Gecko/155.0 Firefox/155.0';
const apply = process.argv.includes('--apply');

function usage() {
  console.log('Usage: node mcp/scripts/itch_published_dates.mjs [--apply]');
  console.log('');
  console.log('Reads mcp/scripts/ignored/cookies.json, fetches itch.io Published dates,');
  console.log('and saves results to mcp/cache/itch_published_dates.json.');
  console.log('Pass --apply to PATCH confidently parsed release years to Directus.');
}

function config() {
  const contents = fs.readFileSync(path.join(repoRoot, '.mcp.json'), 'utf8');
  return JSON.parse(contents).mcpServers.directus.env;
}

function cookieHeader() {
  const cookies = JSON.parse(fs.readFileSync(cookiePath, 'utf8'));
  return cookies
    .map((cookie) => `${cookie['Name raw']}=${cookie['Content raw']}`)
    .join('; ');
}

function itchUrls(game) {
  return (game.links || [])
    .map((link) => link.url)
    .filter((url) => {
      try {
        const hostname = new URL(url).hostname;
        return hostname === 'itch.io' || hostname.endsWith('.itch.io');
      } catch {
        return false;
      }
    });
}

async function directusRequest(environment, method, endpoint, body) {
  const response = await fetch(`${environment.DIRECTUS_URL}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${environment.DIRECTUS_TOKEN}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error(`Directus ${method} ${endpoint}: HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
}

async function candidates(environment) {
  const params = new URLSearchParams({
    limit: '-1',
    fields: 'id,title,release_year,links.url,links.kind',
    'filter[release_year][_null]': 'true',
  });
  const response = await directusRequest(environment, 'GET', `/items/games?${params}`);
  return response.data.filter((game) => itchUrls(game).length > 0);
}

function decodeHtml(text) {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .trim();
}

function publishedDate(html) {
  const match = html.match(/<tr>\s*<td>Published<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/i);
  return match ? decodeHtml(match[1]) : null;
}

function releaseYear(date) {
  const match = date?.match(/\b(?:19|20)\d{2}\b/);
  return match ? Number.parseInt(match[0], 10) : null;
}

async function fetchPublished(url, cookies) {
  const response = await fetch(url, {
    headers: { Cookie: cookies, 'User-Agent': userAgent },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`itch.io HTTP ${response.status}`);
  return publishedDate(await response.text());
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    usage();
    return;
  }
  if (!fs.existsSync(cookiePath)) throw new Error(`Missing local cookie export: ${cookiePath}`);

  const environment = config();
  const cookies = cookieHeader();
  const games = await candidates(environment);
  const records = {};

  for (const [index, game] of games.entries()) {
    const urls = itchUrls(game);
    const record = { title: game.title, urls, url: null, published: null, release_year: null, error: null };
    for (const url of urls) {
      try {
        const date = await fetchPublished(url, cookies);
        if (date) {
          record.url = url;
          record.published = date;
          record.release_year = releaseYear(date);
          break;
        }
      } catch (error) {
        record.error = error.message;
      }
    }
    records[game.id] = record;
    console.log(`${game.id}\t${record.published || 'NO DATE'}\t${game.title}`);
    if (index < games.length - 1) await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  const result = { fetched_at: new Date().toISOString(), candidate_count: games.length, records };
  fs.writeFileSync(cachePath, `${JSON.stringify(result, null, 2)}\n`);
  const resolvable = Object.entries(records).filter(([, record]) => record.release_year);
  console.error(`Candidates: ${games.length}; parsed years: ${resolvable.length}`);

  if (!apply) return;
  for (const [gameId, record] of resolvable) {
    await directusRequest(environment, 'PATCH', `/items/games/${gameId}`, {
      release_year: record.release_year,
    });
    console.log(`updated\t${gameId}\t${record.release_year}\t${record.title}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
