import { randomBytes } from 'node:crypto'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Store } from './db.js'
import { createApp } from './app.js'

const dev=process.argv.includes('--dev'); const port=8765; const token=process.env.SKILL_MANAGER_TOKEN||randomBytes(24).toString('hex')
const dataDir=process.env.SKILL_MANAGER_DATA_DIR||join(homedir(),'Library','Application Support','Codex Skill Manager')
const staticRoot=join(process.cwd(),'dist','client')
const store=new Store(join(dataDir,'manager.db')); const app=createApp(store,{token,staticRoot:!dev&&existsSync(staticRoot)?staticRoot:undefined})
await app.listen({host:'127.0.0.1',port}); const url=`http://127.0.0.1:${dev?5173:port}/?token=${token}`
console.log(`\nCodex 技能管理器已启动：${url.replace(token,'••••••')}\n按 Ctrl+C 停止服务。`)
if(process.env.SKILL_MANAGER_NO_OPEN!=='1')execFile('/usr/bin/open',[url])
