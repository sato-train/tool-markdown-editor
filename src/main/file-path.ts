import { existsSync } from 'node:fs'
import { extname, isAbsolute, resolve } from 'node:path'

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown'])

export function extractMarkdownPath(
  argv: string[],
  workingDirectory = process.cwd(),
  pathExists: (path: string) => boolean = existsSync
): string | null {
  for (let index = argv.length - 1; index >= 0; index -= 1) {
    const argument = argv[index].replace(/^"|"$/g, '')
    if (argument.startsWith('-') || !MARKDOWN_EXTENSIONS.has(extname(argument).toLowerCase())) continue

    const filePath = isAbsolute(argument) ? argument : resolve(workingDirectory, argument)
    if (pathExists(filePath)) return filePath
  }

  return null
}
