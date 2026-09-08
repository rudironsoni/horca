export function deletedPathsFromPatch(text) {
  const paths = []
  for (const block of text.split(/(?=^diff --git )/m)) {
    const match = block.match(/^diff --git a\/(.+) b\/.+$/m)
    if (!match) {
      continue
    }
    const hunk = block.indexOf('\n@@')
    const header = hunk === -1 ? block : block.slice(0, hunk)
    if (!/^deleted file mode /m.test(header)) {
      continue
    }
    paths.push(match[1])
  }
  return paths
}
