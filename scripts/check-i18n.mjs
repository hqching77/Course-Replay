// Lists UI strings that have no English translation, and Chinese text that isn't wrapped in t().
// Usage: node scripts/check-i18n.mjs [--keys]   (exit code 1 if anything is missing)
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const SRC = new URL('../src/', import.meta.url).pathname
const files = readdirSync(SRC).filter((name) => /\.(ts|tsx)$/.test(name) && name !== 'i18n-en.ts')
const enSource = readFileSync(join(SRC, 'i18n-en.ts'), 'utf8')
const en = new Function(`${enSource.replace(/export const EN[^=]*=/, 'return ')}`)()

// Keys passed to t() through variables (data, presets, server messages).
const INDIRECT = [
  '前置知识', '核心知识点', '进阶应用', 'CORE · 按讲课逻辑',
  '前置知识', '核心概念',
  '没听懂，换个说法', '举个具体例子', '这个公式怎么来的？', '和前面讲的有什么联系？',
  '硅基流动 SiliconFlow', '阿里云百炼 DashScope', '硅基流动 SenseVoice', '硅基流动国际版 SenseVoice', '自定义', 'free', 'text-only',
  '登录已过期，请重新登录', '暂时连不上服务器。可以稍后重试，或先用离线模式。', '已退出登录',
  '刚刚', '刚刚导入', '新课程', '程序设计', 'NEW · 2026 秋',
  '请先登录', '请先登录后再使用 AI 功能', '请先登录后再使用语音识别', '请先登录后再上传文件', '用户名已被使用', '用户名或密码错误',
  '当前服务器未开放注册', '昵称不能为空', 'AI 服务尚未配置', '服务器还没有配置 AI 服务',
  '服务器还没有配置语音识别，可以在设置里填写自己的语音识别接口', '服务器还没有配置语音识别，可以改用自己的接口或浏览器内置识别', '尝试次数太多，请过几分钟再试', '注册太频繁，请稍后再试', '音频为空', '找不到之前上传的文件，请重新上传',
  '至少上传一个文件或提供课堂转写', '自定义接口地址必须使用 https://', '自定义接口地址不能指向内网或本机', '自定义接口地址必须以 http:// 或 https:// 开头',
  '服务器未开放自定义 AI 接口', '服务器未开放自定义语音识别接口', '处理任务不存在或服务已重启', '材料处理失败', '课程不存在，请先保存课程', 'AI 尚未配置',
  '模型处理失败，可重试或取消', '材料准备失败',
  '导入任务不存在或已过期', '章节范围无效', '章节范围超出页数', '这种文件没有页面预览', '页码超出范围', '文件不存在',
  'AI 没有按格式出题，请重试', 'AI 没有按格式批改，请重试',
  '不支持的文件格式：{name}', '文件不能超过 {mb} MB：{name}', '文件不能超过 {mb} MB', '本次上传总大小不能超过 {mb} MB', '音频不能超过 {mb} MB',
  '一次最多导入 {n} 个文件', 'AI 回答失败：{error}', 'AI 读试卷失败：{error}',
  '这个接口地址返回的是网页，不是 API：请检查接口地址（通常以 /v1 结尾），并确认这家服务提供这项功能', '语音识别接口返回的格式不对', 'AI 服务返回的格式不对，请检查接口地址',
  '先上传题目，或写下题目', '先写下或上传你的解答', '链接打不开：可能需要密码、已经过期，或者文件已被删除', '只支持这些网盘的共享链接：{hosts}', '这不是网盘的共享链接（应该像 https://…/d/xxxx/ 或 /f/xxxx/）', '请选择一个文件',
  '题目编号无效', '这道题的内容太多了', '题目不存在', '这道题已经被删除了', '这道题刚在另一台设备上更新过，已载入最新内容', '没有从图片里读到内容，请换一张更清楚的照片', 'AI 没有按格式回答，请重试', 'AI 没有按格式总结，请重试', 'AI 读图失败：{error}',
]

const keys = new Map()
const unwrapped = []
for (const name of files) {
  let text = readFileSync(join(SRC, name), 'utf8')
  if (name === 'App.tsx') text = text.split('// Not routed:')[0]
  const call = /\bt\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g
  for (const match of text.matchAll(call)) keys.set(match[2].replace(/\\n/g, '\n').replace(/\\(['"`])/g, '$1'), name)
  if (name === 'data.ts' || name === 'i18n.tsx') continue
  // Chinese inside quotes or JSX text that isn't the first argument of t()/tl().
  text.split('\n').forEach((line, index) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line) || line.includes('i18n-ok')) return
    const stripped = line
      .replace(/\b(?:t|tl)\(\s*(['"`])(?:\\.|(?!\1).)*\1/g, 't(')
      .replace(/\/\/.*$/, '')
      .replace(/\/\*.*?\*\//g, '')
      .replace(/\/(?:\\.|[^/\n])+\/[gimsuy]*/g, '//') // regex literals
    if (/[一-鿿]/.test(stripped)) unwrapped.push(`${name}:${index + 1}: ${line.trim().slice(0, 140)}`)
  })
}
for (const key of INDIRECT) keys.set(key, 'indirect')

const missing = [...keys.keys()].filter((key) => !(key in en))
const unused = Object.keys(en).filter((key) => !keys.has(key))
if (process.argv.includes('--keys')) console.log(JSON.stringify([...keys.keys()], null, 1))
console.log(`${keys.size} keys · ${missing.length} missing · ${unused.length} unused · ${unwrapped.length} unwrapped lines`)
missing.forEach((key) => console.log(`  missing: ${JSON.stringify(key)}  (${keys.get(key)})`))
unused.forEach((key) => console.log(`  unused: ${JSON.stringify(key)}`))
unwrapped.forEach((line) => console.log(`  unwrapped: ${line}`))
process.exit(missing.length || unwrapped.length ? 1 : 0)
