// Minimal asar reader: list matching file paths, or print one file's contents.
// Usage: node asar.mjs <asarPath> list <regex> | node asar.mjs <asarPath> read <pathFragment>
import fs from 'node:fs'

const [, , asarPath, mode, arg] = process.argv
const fd = fs.openSync(asarPath, 'r')
const sizeBuf = Buffer.alloc(8)
fs.readSync(fd, sizeBuf, 0, 8, 0)
const headerSize = sizeBuf.readUInt32LE(4)
const headerBuf = Buffer.alloc(headerSize)
fs.readSync(fd, headerBuf, 0, headerSize, 8)
const headerJsonSize = headerBuf.readUInt32LE(4)
const header = JSON.parse(headerBuf.subarray(8, 8 + headerJsonSize).toString('utf8'))
const base = 8 + headerSize

/** Flatten the header tree into {path, offset, size}. */
function walk (node, prefix, out) {
  for (const [name, entry] of Object.entries(node.files ?? {})) {
    const path = prefix ? `${prefix}/${name}` : name
    if (entry.files) walk(entry, path, out)
    else if (entry.unpacked) out.push({ path, unpacked: `${asarPath}.unpacked/${path}` })
    else out.push({ path, offset: base + Number(entry.offset), size: entry.size })
  }
  return out
}
const files = walk(header, '', [])

function readAt (file) {
  if (file.unpacked) return fs.readFileSync(file.unpacked, 'utf8')
  const buf = Buffer.alloc(file.size)
  fs.readSync(fd, buf, 0, file.size, file.offset)
  return buf.toString('utf8')
}

if (mode === 'list') {
  const re = new RegExp(arg)
  for (const file of files) if (re.test(file.path)) console.log(`${file.size}\t${file.path}`)
} else if (mode === 'grep') {
  const [pattern, filter] = arg.split('::')
  const re = new RegExp(pattern)
  const filterRe = filter ? new RegExp(filter) : null
  for (const file of files) {
    if (filterRe && !filterRe.test(file.path)) continue
    const text = readAt(file)
    if (!re.test(text)) continue
    console.log(file.path)
    text.split('\n').forEach((line, i) => { if (re.test(line)) console.log(`  ${i + 1}: ${line.slice(0, 300)}`) })
  }
} else if (mode === 'read') {
  const hit = files.find((file) => file.path.includes(arg))
  if (!hit) {
    console.error(`no file matching ${arg}`)
    process.exit(1)
  }
  console.log(readAt(hit))
}
fs.closeSync(fd)
