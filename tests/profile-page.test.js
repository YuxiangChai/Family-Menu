const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8')
}

test('管理员端不再暴露示例菜初始化能力', () => {
  const profileScript = readProjectFile('miniprogram/pages/profile/index.js')
  const profileTemplate = readProjectFile('miniprogram/pages/profile/index.wxml')
  const menuService = readProjectFile('cloudfunctions/menuService/index.js')

  assert.doesNotMatch(profileScript, /initializeData|performInitialize|initializeSampleData/)
  assert.doesNotMatch(profileTemplate, /初始化示例|initializeData/)
  assert.doesNotMatch(menuService, /initializeSampleData|sampleData/)
})
