import { it, expect } from 'vitest';
import { httpFixture, TOKEN } from './helpers.mjs';
import puppeteer from 'puppeteer';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { homebrewRom } from '../scripts/homebrew.mjs';

it.skipIf(process.env.RUN_BROWSER_TESTS !== 'true')('real browser authenticates, uploads, loads, presses buttons and disconnects without persistent secrets', async () => {
  const f = await httpFixture();
  const browser = await puppeteer.launch({ headless: true, executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: (process.getuid?.() === 0 || process.env.MCP_TEST_NO_SANDBOX === 'true') ? ['--no-sandbox'] : [] });
  try {
    const page = await browser.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(f.origin);
    await page.type('#token', TOKEN);
    await page.click('#connect button');
    await page.waitForFunction(() => !document.querySelector('#controls').hidden);
    expect(await page.$eval('#token', element => element.value)).toBe('');
    expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length, cookies: document.cookie, url: location.href }))).toEqual({ local: 0, session: 0, cookies: '', url: f.origin + '/' });
    await page.select('#roms', (await import('node:path')).default.join(f.directory, 'homebrew.gb'));
    await page.click('#load');
    await page.waitForFunction(() => document.querySelector('#cartridge').textContent.includes('5 frames'));
    await page.click('[data-button="a"]');
    await page.waitForFunction(() => document.querySelector('#cartridge').textContent.includes('31 frames'));
    expect(f.service.status().frames).toBe(31);
    await page.click('#skip');
    await page.waitForFunction(() => document.querySelector('#cartridge').textContent.includes('131 frames'));
    // Upload an actual generated cartridge through the browser's multipart form.
    const input = await page.$('#file');
    await mkdir(path.join(f.directory, 'source'));
    const source = path.join(f.directory, 'source', 'uploaded.gb');
    await writeFile(source, homebrewRom());
    await input.uploadFile(source);
    await page.click('#upload button');
    await page.waitForFunction(() => [...document.querySelector('#roms').options].some(option => option.textContent === 'uploaded.gb'));
    await page.select('#roms', path.join(f.directory, 'uploaded.gb'));
    await page.click('#load');
    await page.waitForFunction(() => document.querySelector('#cartridge').textContent.includes('uploaded.gb'));
    await page.click('#autoplay');
    await page.waitForFunction(() => Number(document.querySelector('#cartridge').textContent.match(/(\d+) frames/)[1]) > 8);
    await page.click('#autoplay');
    await page.click('#disconnect');
    expect(await page.$eval('#controls', element => element.hidden)).toBe(true);
    expect(await page.$eval('#screen', element => element.getAttribute('src'))).toBeNull();
    expect(errors).toEqual([]);
  } finally { await browser.close(); await f.close(); }
}, 60000);
