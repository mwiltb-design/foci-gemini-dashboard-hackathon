import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'

const moduleDir = dirname(fileURLToPath(import.meta.url))
const projectRoot = [
  resolve(moduleDir, '../..'),
  resolve(moduleDir, '../../../..'),
].find((candidate) => existsSync(resolve(candidate, 'package.json')))

if (projectRoot) {
  config({ path: resolve(projectRoot, '.env'), override: false })
}
