import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from './app.js'
import { Store } from './db.js'

const roots:string[]=[]
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true})})

describe('无请求体管理接口',()=>{
  it('可以取消注册项目且不删除真实目录',async()=>{
    const root=await mkdtemp(join(tmpdir(),'skill-manager-api-'));roots.push(root)
    const projectPath=join(root,'project');await mkdir(projectPath)
    const store=new Store(join(root,'data','test.db'))
    const project=store.addProject({name:'测试项目',path:projectPath,skillsDir:join(projectPath,'.codex','skills')})
    const app=createApp(store,{token:'test-token'})
    const response=await app.inject({method:'DELETE',url:`/api/projects/${project.id}`,headers:{'x-session-token':'test-token'}})
    expect(response.statusCode).toBe(200)
    expect(store.projects()).toHaveLength(0)
    await expect(mkdir(projectPath)).rejects.toThrow()
    await app.close()
  })
})
