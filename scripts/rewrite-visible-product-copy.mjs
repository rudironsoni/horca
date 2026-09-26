import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.html', '.sh', '.cmd', '.ps1'])
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'out',
  'coverage',
  '.git',
  'goldens',
  '__fixtures__'
])
const SKIP_FILE_NAMES = new Set([
  'plugin-display-name.ts',
  'distribution-identity.ts',
  'distribution-identity.json',
  'distribution-product-copy.ts',
  'horca-product-copy.ts',
  'distribution-translation-catalog-plugin.ts',
  'distribution-translation-catalog-plugin.test.ts'
])

const PROTECTED_PATTERNS = [
  /Orca Computer Use/g,
  /Orca Nerd Font Symbols/g,
  /X-Orca-Agent-Hook[A-Za-z0-9-]*/g,
  /Orca\.MobilePairing/g,
  /\/CN=Orca Runtime/g,
  /Orca\.exe/g,
  /Orca\.app/g,
  /Orca\.xcworkspace/g,
  /Orca\.xcodeproj/g,
  /Orca\.ipa/g,
  /(?:[/\\])Orca\b/g
]

const KEEP_EXACT_ORCA_LINE =
  /BASE_APP_NAME|LOCAL_HOST_ROOT_NAME|windowsDaemonHostRootName|TERM_PROGRAM|speech-models|Application Support|APPDATA|\.config|joinPath\(|\bjoin\(|Programs|ProgramFiles|MacOS|setName\(|productName\b|Safe Storage|\bSCHEME\b|BUNDLE_ID|s\.name\b/

function rewriteProductText(value) {
  const saved = []
  let masked = value
  for (const pattern of PROTECTED_PATTERNS) {
    pattern.lastIndex = 0
    masked = masked.replace(pattern, (match) => {
      const token = `\u0000${saved.length}\u0000`
      saved.push(match)
      return token
    })
  }
  // `\nOrca` in source is the letters n+Orca, so a word boundary does not see it.
  masked = masked.replaceAll(
    /(?<![A-Za-z0-9_])Orca(?![A-Za-z0-9_])|(?<=\\[nrt])Orca(?![A-Za-z0-9_])/g,
    'Horca'
  )
  return masked.replaceAll(/\u0000(\d+)\u0000/g, (_, index) => saved[Number(index)])
}

function keepExactOrca(line, literal) {
  return literal === 'Orca' && KEEP_EXACT_ORCA_LINE.test(line)
}

function lineAt(text, index) {
  const start = text.lastIndexOf('\n', index - 1) + 1
  const end = text.indexOf('\n', index)
  return text.slice(start, end === -1 ? text.length : end)
}

function isJsxTagEnd(text, index) {
  if (text[index] !== '>') {
    return false
  }
  let cursor = index - 1
  let sawNewline = false
  while (cursor >= 0 && /\s/.test(text[cursor])) {
    if (text[cursor] === '\n') {
      sawNewline = true
    }
    cursor -= 1
  }
  if (cursor < 0) {
    return false
  }
  const previous = text[cursor]
  if (previous === '=' || previous === '-') {
    return false
  }
  if (!sawNewline && index > 0 && /\s/.test(text[index - 1])) {
    return false
  }
  return /[A-Za-z0-9_'" `}\/)]/.test(previous)
}

function rewriteQuoted(text, kind) {
  let out = ''
  let index = 0
  let previousSignificant = ''
  let braceDepth = 0
  let jsxExprBrace = 0

  function appendCode(chunk) {
    out += chunk
    const trimmed = chunk.trim()
    if (trimmed) {
      previousSignificant = trimmed
    }
  }

  while (index < text.length) {
    const rest = text.slice(index)
    if (kind === 'ruby' && text[index] === '#') {
      const end = text.indexOf('\n', index)
      const next = end === -1 ? text.length : end
      appendCode(text.slice(index, next))
      index = next
      continue
    }
    if ((kind === 'code' || kind === 'jsx') && rest.startsWith('//')) {
      const end = text.indexOf('\n', index)
      const next = end === -1 ? text.length : end
      appendCode(text.slice(index, next))
      index = next
      continue
    }
    if ((kind === 'code' || kind === 'jsx') && rest.startsWith('/*')) {
      const end = text.indexOf('*/', index + 2)
      const next = end === -1 ? text.length : end + 2
      appendCode(text.slice(index, next))
      index = next
      continue
    }
    const quote = text[index]
    if (quote === "'" || quote === '"' || quote === '`') {
      const parsed = readQuoted(text, index, quote)
      const line = lineAt(text, index)
      const body = parsed.body
      const rewritten = keepExactOrca(line, body) ? body : rewriteProductText(body)
      out += quote + rewritten + parsed.suffix
      previousSignificant = 'string'
      index = parsed.next
      continue
    }
    if (
      kind === 'jsx' &&
      quote === '>' &&
      isJsxTagEnd(text, index)
    ) {
      let next = index + 1
      while (next < text.length && text[next] !== '<' && text[next] !== '{') {
        next += 1
      }
      out += `>${rewriteProductText(text.slice(index + 1, next))}`
      previousSignificant = '>'
      if (text[next] === '{') {
        jsxExprBrace = braceDepth + 1
      }
      index = next
      continue
    }
    if (kind === 'jsx' && quote === '{') {
      braceDepth += 1
      appendCode(quote)
      index += 1
      continue
    }
    if (kind === 'jsx' && quote === '}') {
      braceDepth = Math.max(0, braceDepth - 1)
      appendCode(quote)
      index += 1
      if (jsxExprBrace > 0 && braceDepth < jsxExprBrace) {
        jsxExprBrace = 0
        let next = index
        while (next < text.length && text[next] !== '<' && text[next] !== '{') {
          next += 1
        }
        out += rewriteProductText(text.slice(index, next))
        if (text[next] === '{') {
          jsxExprBrace = braceDepth + 1
        }
        index = next
      }
      continue
    }
    if ((kind === 'code' || kind === 'jsx') && quote === '/' && isRegexStart(previousSignificant)) {
      const parsed = readRegex(text, index)
      if (parsed) {
        const rewritten = rewriteProductText(parsed.body)
        out += `/${rewritten}/${parsed.flags}`
        previousSignificant = 'regex'
        index = parsed.next
        continue
      }
    }
    appendCode(text[index])
    index += 1
  }
  return out
}

function isRegexStart(previous) {
  if (!previous || previous === 'string' || previous === 'regex') {
    return previous === ''
  }
  if (
    /^(return|case|throw|else|do|in|of|typeof|void|delete|await|yield)$/.test(previous)
  ) {
    return true
  }
  return /[([{:;,=!?&|~^*%<>+-]$/.test(previous)
}

function readQuoted(text, start, quote) {
  let index = start + 1
  let body = ''
  while (index < text.length) {
    const char = text[index]
    if (char === '\\') {
      body += text.slice(index, index + 2)
      index += 2
      continue
    }
    if (quote === '`' && char === '$' && text[index + 1] === '{') {
      const expression = readBalanced(text, index + 1)
      const rewrittenExpression = rewriteQuoted(expression.body, 'code')
      body += `\${${rewrittenExpression}}`
      index = expression.next
      continue
    }
    if (char === quote) {
      return { body, suffix: quote, next: index + 1 }
    }
    if (char === '\n' && quote !== '`') {
      break
    }
    body += char
    index += 1
  }
  return { body: text.slice(start + 1, index), suffix: '', next: index }
}

function readBalanced(text, braceIndex) {
  let index = braceIndex + 1
  let depth = 1
  const start = index
  while (index < text.length && depth > 0) {
    const char = text[index]
    if (char === "'" || char === '"' || char === '`') {
      const parsed = readQuoted(text, index, char)
      index = parsed.next
      continue
    }
    if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return { body: text.slice(start, index), next: index + 1 }
      }
    }
    index += 1
  }
  return { body: text.slice(start), next: text.length }
}

function readRegex(text, start) {
  let index = start + 1
  let body = ''
  while (index < text.length) {
    const char = text[index]
    if (char === '\\') {
      body += text.slice(index, index + 2)
      index += 2
      continue
    }
    if (char === '\n') {
      return null
    }
    if (char === '/') {
      let flags = ''
      index += 1
      while (index < text.length && /[a-z]/i.test(text[index])) {
        flags += text[index]
        index += 1
      }
      return { body, flags, next: index }
    }
    body += char
    index += 1
  }
  return null
}

function rewriteJsonValues(text) {
  let index = 0

  function takeWhitespace() {
    const start = index
    while (index < text.length && /\s/.test(text[index])) {
      index += 1
    }
    return text.slice(start, index)
  }

  function rewriteString(asValue) {
    const parsed = readQuoted(text, index, '"')
    index = parsed.next
    if (!asValue) {
      return `"${parsed.body}"`
    }
    return JSON.stringify(rewriteProductText(decodeJsonString(parsed.body)))
  }

  function rewriteValue() {
    const leading = takeWhitespace()
    const char = text[index]
    if (char === '"') {
      return leading + rewriteString(true)
    }
    if (char === '{') {
      return leading + rewriteObject()
    }
    if (char === '[') {
      return leading + rewriteArray()
    }
    const start = index
    while (index < text.length && !/[,\]}]/.test(text[index])) {
      index += 1
    }
    return leading + text.slice(start, index)
  }

  function rewriteObject() {
    let out = text[index]
    index += 1
    out += takeWhitespace()
    if (text[index] === '}') {
      out += text[index]
      index += 1
      return out
    }
    while (index < text.length) {
      out += takeWhitespace()
      out += rewriteString(false)
      out += takeWhitespace()
      if (text[index] !== ':') {
        throw new Error('JSON object expected ":"')
      }
      out += text[index]
      index += 1
      out += rewriteValue()
      out += takeWhitespace()
      if (text[index] === ',') {
        out += text[index]
        index += 1
        continue
      }
      if (text[index] === '}') {
        out += text[index]
        index += 1
        return out
      }
      throw new Error('JSON object expected "," or "}"')
    }
    return out
  }

  function rewriteArray() {
    let out = text[index]
    index += 1
    out += takeWhitespace()
    if (text[index] === ']') {
      out += text[index]
      index += 1
      return out
    }
    while (index < text.length) {
      out += rewriteValue()
      out += takeWhitespace()
      if (text[index] === ',') {
        out += text[index]
        index += 1
        continue
      }
      if (text[index] === ']') {
        out += text[index]
        index += 1
        return out
      }
      throw new Error('JSON array expected "," or "]"')
    }
    return out
  }

  const rewritten = rewriteValue()
  const trailing = takeWhitespace()
  if (index !== text.length) {
    throw new Error('JSON rewrite did not consume the file')
  }
  return rewritten + trailing
}

function decodeJsonString(body) {
  return JSON.parse(`"${body}"`)
}

function extensionOf(filePath) {
  const name = filePath.slice(filePath.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot)
}

function rewriteHtmlTextNodes(text) {
  let out = ''
  let index = 0
  let raw = null
  while (index < text.length) {
    if (text[index] !== '<') {
      const next = text.indexOf('<', index)
      const end = next === -1 ? text.length : next
      const chunk = text.slice(index, end)
      out += raw ? chunk : rewriteProductText(chunk)
      index = end
      continue
    }
    const end = text.indexOf('>', index)
    if (end === -1) {
      out += text.slice(index)
      break
    }
    const tag = text.slice(index, end + 1)
    out += tag
    index = end + 1
    const match = /^<\s*(\/?)\s*([a-zA-Z0-9:-]+)/.exec(tag)
    if (!match) {
      continue
    }
    const name = match[2].toLowerCase()
    if (name !== 'script' && name !== 'style') {
      continue
    }
    if (match[1] === '/') {
      raw = null
    } else if (!tag.endsWith('/>')) {
      raw = name
    }
  }
  return out
}

function shouldSkipFile(relativePath) {
  const name = relativePath.slice(relativePath.lastIndexOf('/') + 1)
  if (SKIP_FILE_NAMES.has(name)) {
    return true
  }
  if (name.includes('marine-creature-names')) {
    return true
  }
  if (name.includes('.test.') || name.endsWith('.spec.ts') || name.endsWith('.spec.tsx')) {
    return true
  }
  return false
}

function walk(directory, root, files) {
  for (const entry of readdirSync(directory)) {
    if (SKIP_DIRS.has(entry)) {
      continue
    }
    const fullPath = join(directory, entry)
    const info = statSync(fullPath)
    if (info.isDirectory()) {
      walk(fullPath, root, files)
      continue
    }
    const relativePath = relative(root, fullPath).split('\\').join('/')
    if (shouldSkipFile(relativePath)) {
      continue
    }
    files.push({ fullPath, relativePath })
  }
}

function selfCheck() {
  const replaced = rewriteProductText(
    'Hide non-Orca worktrees. Grant Accessibility to Orca Computer Use. /opt/Orca Orca.exe'
  )
  if (replaced !== 'Hide non-Horca worktrees. Grant Accessibility to Orca Computer Use. /opt/Orca Orca.exe') {
    throw new Error(`product rewrite self-check failed: ${replaced}`)
  }
  if (keepExactOrca("TERM_PROGRAM: 'Orca',", 'Orca') !== true) {
    throw new Error('exact Orca keep self-check failed')
  }
  if (keepExactOrca("title: 'Orca',", 'Orca') !== false) {
    throw new Error('visible Orca title was kept')
  }
  if (keepExactOrca('SCHEME = "Orca"', 'Orca') !== true) {
    throw new Error('mobile scheme Orca was not kept')
  }
  const html = rewriteHtmlTextNodes(
    rewriteQuoted(
      '<span class="brand-name">Orca</span><script>const name = "Orca"</script>',
      'text'
    )
  )
  if (html !== '<span class="brand-name">Horca</span><script>const name = "Horca"</script>') {
    throw new Error(`html rewrite self-check failed: ${html}`)
  }
  if (rewriteProductText('ios/Orca.xcworkspace Orca.ipa') !== 'ios/Orca.xcworkspace Orca.ipa') {
    throw new Error('Xcode artifact names were rewritten')
  }
  const ruby = rewriteQuoted(
    '# archive fails: "Signing for Orca requires a development team".\nSCHEME = "Orca"\nchangelog = "Latest Orca Mobile"\n',
    'ruby'
  )
  if (
    ruby !==
    '# archive fails: "Signing for Orca requires a development team".\nSCHEME = "Orca"\nchangelog = "Latest Horca Mobile"\n'
  ) {
    throw new Error(`ruby rewrite self-check failed: ${ruby}`)
  }
}

function main(worktreePath) {
  if (!worktreePath) {
    throw new Error('rewrite-visible-product-copy requires a worktree path')
  }
  selfCheck()
  const files = []
  for (const rootName of ['src', 'mobile', 'resources']) {
    walk(join(worktreePath, rootName), worktreePath, files)
  }
  let changedFiles = 0
  let replacements = 0
  for (const file of files) {
    const extension = extensionOf(file.relativePath)
    const before = readFileSync(file.fullPath, 'utf8')
    if (!before.includes('Orca')) {
      continue
    }
    let after
    const fileName = file.relativePath.slice(file.relativePath.lastIndexOf('/') + 1)
    if (extension === '.json') {
      after = rewriteJsonValues(before)
    } else if (extension === '.md') {
      after = rewriteProductText(before)
    } else if (extension === '.html') {
      after = rewriteHtmlTextNodes(rewriteQuoted(before, 'text'))
    } else if (fileName === 'Fastfile') {
      after = rewriteQuoted(before, 'ruby')
    } else if (extension === '.podspec') {
      after = rewriteQuoted(before, 'text')
    } else if (CODE_EXTENSIONS.has(extension) || file.relativePath.includes('/bin/')) {
      const codeKind =
      extension === '.tsx'
        ? 'jsx'
        : extension === '.ts' ||
            extension === '.js' ||
            extension === '.mjs' ||
            extension === '.cjs'
          ? 'code'
          : 'text'
      after = rewriteQuoted(before, codeKind)
      if (codeKind === 'text') {
        after = after
          .split('\n')
          .map((line) =>
            /^\s*(?:echo|printf)\b/.test(line) ? rewriteProductText(line) : line
          )
          .join('\n')
      }
    } else {
      continue
    }
    if (after === before) {
      continue
    }
    for (const phrase of ['Orca Computer Use', 'Orca Nerd Font Symbols', 'X-Orca-Agent-Hook', 'Orca.MobilePairing']) {
      const beforeCount = before.split(phrase).length
      const afterCount = after.split(phrase).length
      if (beforeCount !== afterCount) {
        throw new Error(`Protected phrase ${phrase} changed in ${file.relativePath}`)
      }
    }
    replacements += countDelta(before, after)
    writeFileSync(file.fullPath, after)
    changedFiles += 1
  }
  console.log(
    `[rewrite-visible-product-copy] Updated ${changedFiles} files, ${replacements} Orca -> Horca replacements`
  )
}

function countDelta(before, after) {
  const pattern = /\bOrca\b/g
  const beforeCount = before.match(pattern)?.length ?? 0
  const afterCount = after.match(pattern)?.length ?? 0
  return Math.max(0, beforeCount - afterCount)
}

main(process.argv[2])
