#!/usr/bin/env node
/**
 * scripts/shot.mjs — deterministic page screenshots at an explicit viewport
 * width and colour scheme, via Playwright's Chromium.
 *
 * Why this exists: the Claude-in-Chrome extension (and any tool that captures a
 * real OS Chrome window) can't render below Chrome's minimum window width, so
 * mobile-width verification was impossible. Playwright sets the layout viewport
 * and `prefers-color-scheme` directly, headless, at any size.
 *
 * Usage:
 *   node scripts/shot.mjs <url> <out.png> [options]
 *
 * Options:
 *   --viewport WxH   layout viewport, default 1440x900  (e.g. --viewport 390x844)
 *   --scheme S       'light' (default) or 'dark' -> real prefers-color-scheme
 *   --dpr N          devicePixelRatio, default 2
 *   --full           full-page capture (default: viewport only)
 *   --wait MS        extra settle time after networkidle, default 400
 *
 * Examples:
 *   node scripts/shot.mjs http://localhost:5173/login shots/login-1440-light.png
 *   node scripts/shot.mjs http://localhost:5173/register shots/reg-390-dark.png \
 *     --viewport 390x844 --scheme dark --full
 */
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const args = process.argv.slice(2)
const [url, out] = args.filter((a) => !a.startsWith('--'))
if (!url || !out) {
  console.error('usage: node scripts/shot.mjs <url> <out.png> [--viewport WxH] [--scheme light|dark] [--dpr N] [--full] [--wait MS]')
  process.exit(1)
}
const flag = (name, def) => {
  const i = args.indexOf(name)
  return i === -1 || args[i + 1]?.startsWith('--') ? def : args[i + 1]
}
const [width, height] = flag('--viewport', '1440x900').split('x').map(Number)
const colorScheme = flag('--scheme', 'light')
const deviceScaleFactor = Number(flag('--dpr', '2'))
const fullPage = args.includes('--full')
const settle = Number(flag('--wait', '400'))

const browser = await chromium.launch()
const page = await browser.newPage({
  viewport: { width, height },
  deviceScaleFactor,
  colorScheme,
})
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(settle) // let webfonts / async data settle
const path = resolve(out)
await mkdir(dirname(path), { recursive: true })
await page.screenshot({ path, fullPage })
await browser.close()
console.log(`${path}  ${width}x${height} @${deviceScaleFactor}x  ${colorScheme}${fullPage ? '  fullPage' : ''}`)
