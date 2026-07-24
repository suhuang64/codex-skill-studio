import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { execFile } from 'node:child_process'
import { access, realpath } from 'node:fs/promises'
import { promisify } from 'node:util'
import { basename, join, resolve } from 'node:path'
import { z } from 'zod'
import { Store } from './db.js'
import { audit, applyPlan, makePlan, status, undo } from './linker.js'
import { isDirectory, scanSource } from './scanner.js'
import type { Plan } from './types.js'

const run=promisify(execFile)
const pathInput=z.object({path:z.string().min(1),name:z.string().trim().optional()})
export function createApp(store:Store, options:{token:string;staticRoot?:string}){
  const app=Fastify({logger:false}); const plans=new Map<string,Plan>()
  app.addHook('onRequest',async(req,reply)=>{if(req.url.startsWith('/api')&&req.headers['x-session-token']!==options.token)return reply.code(403).send({error:'无效的本地会话'})})
  app.setErrorHandler((error,_req,reply)=>reply.code((error as any).statusCode||400).send({error:error instanceof Error?error.message:String(error)}))
  app.get('/api/bootstrap',async()=>({projects:store.projects(),sources:store.sources(),skills:store.skills(),groups:store.groups(),bundles:store.bundles(),history:store.history(),audit:await audit(store)}))
  app.post('/api/dialog/directory',async(req)=>{const title=String((req.body as any)?.title||'选择目录').replace(/["\\]/g,''); try{const {stdout}=await run('/usr/bin/osascript',['-e',`POSIX path of (choose folder with prompt "${title}")`]); return {path:stdout.trim().replace(/\/$/,'')}}catch{return {cancelled:true}}})
  app.post('/api/projects',async(req)=>{const input=pathInput.parse(req.body); const path=await realpath(input.path); if(!await isDirectory(path))throw new Error('项目路径不是目录'); return store.addProject({name:input.name||basename(path),path,skillsDir:join(path,'.codex','skills')})})
  app.delete('/api/projects/:id',async req=>{store.run('DELETE FROM projects WHERE id=?',(req.params as any).id);return {ok:true}})
  app.post('/api/sources',async(req)=>{const input=pathInput.extend({mode:z.enum(['single','pack'])}).parse(req.body); const path=await realpath(input.path); if(!await isDirectory(path))throw new Error('技能源路径不是目录'); if(input.mode==='single')await access(join(path,'SKILL.md')); const source=store.addSource({name:input.name||basename(path),path,mode:input.mode}); const count=await scanSource(store,source as any);return {source,count}})
  app.delete('/api/sources/:id',async req=>{store.run('DELETE FROM sources WHERE id=?',(req.params as any).id);return {ok:true}})
  app.post('/api/scan',async()=>{let count=0;for(const s of store.sources())try{count+=await scanSource(store,s)}catch{store.run('UPDATE skills SET available=0 WHERE source_id=?',s.id)}return {count}})
  app.patch('/api/skills/:id',async req=>{const body=z.object({alias:z.string().trim().min(1).optional(),favorite:z.boolean().optional(),tags:z.array(z.string().trim().min(1)).optional()}).parse(req.body); const sid=(req.params as any).id;if(body.alias)store.run('UPDATE skills SET alias=? WHERE id=?',body.alias,sid);if(body.favorite!==undefined)store.run('UPDATE skills SET favorite=? WHERE id=?',body.favorite?1:0,sid);if(body.tags)store.run('UPDATE skills SET tags=? WHERE id=?',JSON.stringify(body.tags),sid);return {ok:true}})
  app.get('/api/projects/:id/status',async req=>{const project=store.projects().find(p=>p.id===(req.params as any).id);if(!project)throw new Error('项目不存在');return Promise.all(store.skills().map(async s=>({...s,...await status(project,s)})))})
  app.post('/api/plans',async req=>{const body=z.object({projectIds:z.array(z.string()).min(1),skillIds:z.array(z.string()).min(1),action:z.enum(['link','replace','remove']),bundleId:z.string().optional()}).parse(req.body);const plan=await makePlan(store,body.projectIds,body.skillIds,body.action);plan.bundleId=body.bundleId;plans.set(plan.id,plan);return plan})
  app.post('/api/plans/:id/apply',async req=>{const plan=plans.get((req.params as any).id);if(!plan)throw new Error('变更计划已过期');const result=await applyPlan(store,plan);if(plan.bundleId)for(const pid of plan.projectIds||[])store.run('INSERT OR IGNORE INTO project_bundles VALUES(?,?)',pid,plan.bundleId);plans.delete(plan.id);return result})
  app.post('/api/operations/:id/undo',async req=>{await undo(store,(req.params as any).id);return {ok:true}})
  app.post('/api/groups',async req=>{const b=z.object({name:z.string().trim().min(1),color:z.string().default('#007AFF')}).parse(req.body);const id=crypto.randomUUID();store.run('INSERT INTO project_groups VALUES(?,?,?,?)',id,b.name,b.color,new Date().toISOString());return {id,...b}})
  app.patch('/api/projects/:id/group',async req=>{const groupId=z.object({groupId:z.string().nullable()}).parse(req.body).groupId;store.run('UPDATE projects SET group_id=? WHERE id=?',groupId,(req.params as any).id);return {ok:true}})
  app.post('/api/bundles',async req=>{const b=z.object({name:z.string().trim().min(1),description:z.string().default(''),skillIds:z.array(z.string()).default([])}).parse(req.body);const id=crypto.randomUUID();store.db.exec('BEGIN');try{store.run('INSERT INTO bundles VALUES(?,?,?,?)',id,b.name,b.description,new Date().toISOString());for(const sid of b.skillIds)store.run('INSERT INTO bundle_skills VALUES(?,?)',id,sid);store.db.exec('COMMIT')}catch(e){store.db.exec('ROLLBACK');throw e}return {id,...b}})
  app.delete('/api/bundles/:id',async req=>{store.run('DELETE FROM bundles WHERE id=?',(req.params as any).id);return {ok:true}})
  app.delete('/api/bundles/:bundleId/projects/:projectId',async req=>{const p=req.params as any;store.run('DELETE FROM project_bundles WHERE bundle_id=? AND project_id=?',p.bundleId,p.projectId);return {ok:true}})
  app.get('/api/export',async()=>({version:1,exportedAt:new Date().toISOString(),projects:store.projects(),sources:store.sources(),groups:store.groups(),bundles:store.bundles(),skillPreferences:store.skills().map(({path,alias,tags,favorite})=>({path,alias,tags,favorite}))}))
  app.post('/api/import',async req=>{const body=req.body as any;if(!body||body.version!==1)throw new Error('不支持的配置格式');let added=0;for(const p of body.projects||[])try{store.addProject({name:p.name,path:p.path,skillsDir:p.skillsDir||join(p.path,'.codex','skills')});added++}catch{}for(const s of body.sources||[])try{const source=store.addSource({name:s.name,path:s.path,mode:s.mode});await scanSource(store,source as any);added++}catch{}return {added}})
  if(options.staticRoot)app.register(fastifyStatic,{root:resolve(options.staticRoot),wildcard:false}).after(()=>app.setNotFoundHandler((req,reply)=>req.url.startsWith('/api')?reply.code(404).send({error:'接口不存在'}):reply.sendFile('index.html')))
  return app
}
