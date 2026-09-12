import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import { extractSymbols } from './ast.mjs';
import { transaction, getSyncMeta, setSyncMeta } from './database.mjs';
import { executeMutate } from './mutation-engine.mjs';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const ignored = new Set(['.git','.contextos','node_modules','.build','build','dist','coverage','.next','release-assets']);
const extensions = new Set(['.js','.mjs','.cjs','.ts','.tsx','.jsx','.swift','.py','.go','.rs','.java','.kt','.kts','.c','.cc','.cpp','.h','.hpp']);
export function sourceInventory(root) {
  const files = [];
  const listing = spawnSync('git',['ls-files','-z','--cached','--others','--exclude-standard'],{cwd:root,encoding:'utf8',maxBuffer:20_000_000,timeout:5000});
  const included = listing.status === 0 ? new Set(listing.stdout.split('\0')) : null;
  const visit = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes:true }).sort((a,b)=>a.name.localeCompare(b.name))) {
      if (ignored.has(entry.name) || entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
      const absolute = path.join(dir,entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if ((!included || included.has(path.relative(root,absolute).split(path.sep).join('/'))) && extensions.has(path.extname(entry.name)) && !absolute.endsWith('plugins/contextos/server/contextos-mcp.mjs')) {
        const content = fs.readFileSync(absolute,'utf8');
        files.push({ path:path.relative(root,absolute).split(path.sep).join('/'), hash:hash(content), content });
      }
    }
  };
  visit(root);
  return files;
}
export function indexSources(service) {
  const inventory = sourceInventory(service.paths.projectRoot);
  const db = service.database;
  return transaction(db,()=>{
  const old = new Map(db.prepare('SELECT * FROM source_index').all().map(r=>[r.path,r]));
  let revision = Number(getSyncMeta(db).repository_source_revision ?? 0);
  const changes = inventory.filter(f=>old.get(f.path)?.file_hash!==f.hash).map(f=>({ ...f,kind:old.has(f.path)?'changed':'added' }));
  const names = new Set(inventory.map(f=>f.path));
  for (const [name] of old) if (!names.has(name)) changes.push({path:name,kind:'removed'});
  if (changes.length) {
    revision++;
    {
      const now = new Date().toISOString();
      for (const item of changes) {
        if (item.kind==='removed') db.prepare('DELETE FROM source_index WHERE path=?').run(item.path);
        else {
          const symbols = extractSymbols(item.content,{filePath:item.path});
          db.prepare('INSERT INTO source_index VALUES(?,?,?,?,?) ON CONFLICT(path) DO UPDATE SET file_hash=excluded.file_hash,symbols_json=excluded.symbols_json,revision=excluded.revision,supported=excluded.supported')
            .run(item.path,item.hash,JSON.stringify(symbols.map(({name,qualifiedName,startLine,endLine})=>({name:qualifiedName??name,startLine,endLine}))),revision,Number(symbols.length>0));
        }
        db.prepare('INSERT INTO sync_events(path,kind,revision,created_at) VALUES(?,?,?,?)').run(item.path,item.kind,revision,now);
      }
      setSyncMeta(db,'repository_source_revision',String(revision));
    }
  }
  const boundPaths = new Set(db.prepare('SELECT DISTINCT path FROM source_refs').all().map(r=>r.path));
  const unboundFiles = inventory.filter(f=>!boundPaths.has(f.path)).map(f=>f.path);
  return { revision, sourceRevision:hash(inventory.map(f=>`${f.path}:${f.hash}`).join('\n')), files:inventory.length, unboundCount:unboundFiles.length, unboundFiles:unboundFiles.slice(0,30),
    changes:changes.map(({path,kind})=>({path,kind})) };
  });
}
function session(service,id) {
  const row = service.database.prepare('SELECT * FROM task_sessions WHERE id=? AND project_id=?').get(id,service.paths.descriptor.id);
  if (!row) throw new Error(`Task session not found: ${id}`);
  return {...row,scope:JSON.parse(row.scope_json)};
}
export function beginTask(service,{intent,blockIds=[],chainId=null,feature=null,standaloneReason='',readOnly=false}={}) {
  if (!intent?.trim()) throw new Error('intent is required');
  service.ensureSynced();
  const snapshot=service.snapshot();
  for(const id of blockIds) if(!snapshot.blocks.some(b=>b.id===id)) throw new Error(`Register Block before task: ${id}`);
  if(feature) {
    chainId=feature.id;
    const current=snapshot.chains.find(c=>c.id===chainId);
    const operations=[];
    if(!current) operations.push({action:'create_chain',id:chainId,fields:{title:feature.title,intent, inputContract:feature.inputContract??'',outputContract:feature.outputContract??'',deliveryState:'planned'}});
    operations.push({action:'set_chain_path',id:chainId,expectedRevision:current?.currentRevision??1,fields:{nodeIds:feature.nodeIds??blockIds,linkIds:feature.linkIds??[]}});
    const result=service.mutate({reason:'Declare task feature network',operations});
    if(result.success===false) throw new Error(result.projection.error);
  }
  if(chainId&&!service.snapshot().chains.some(c=>c.id===chainId)) throw new Error('Unknown Chain');
  const index=indexSources(service); const now=new Date().toISOString();const id=`task_${crypto.randomUUID()}`;
  const scope={blockIds,chainId,standaloneReason,readOnly,startRevision:index.revision};
  service.database.prepare('INSERT INTO task_sessions(id,project_id,intent,scope_json,source_revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
    .run(id,service.paths.descriptor.id,intent,JSON.stringify(scope),index.sourceRevision,now,now);
  const unfinished=service.database.prepare("SELECT id,intent FROM task_sessions WHERE status='active' AND id<>? AND project_id=?").all(id,service.paths.descriptor.id);
  return {taskId:id,updatedAt:now,...index,resumableTasks:unfinished,nextActions:['Implement from registered locators','task_reconcile','run_command / checkpoint_record','task_finish']};
}
export function reconcileTask(service,{taskId}={}) {
  service.ensureSynced();const task=session(service,taskId);const index=indexSources(service);const snapshot=service.snapshot();
  const scope=task.scope; const issues=[]; const add=(kind,target,detail)=>issues.push({kind,target,detail});
  const changed=service.database.prepare('SELECT DISTINCT path FROM sync_events WHERE revision>?').all(scope.startRevision).map(r=>r.path);
  for(const relative of changed) {
    const file=service.database.prepare('SELECT * FROM source_index WHERE path=?').get(relative);
    if(!file) continue;
    const refs=snapshot.sourceRefs.filter(r=>r.path===relative);
    if(!refs.length && !scope.excludedPaths?.some(item=>item.path===relative)) add('unbound_file',relative,'New/changed source has no architecture binding; bind it or explicitly revise the task scope');
  }
  for(const id of scope.blockIds) {
    const bindings=[...service.sourceBindingState.values()].filter(b=>b.blockId===id);
    const block=snapshot.blocks.find(b=>b.id===id);
    if(!block) {add('missing_block',id,'Block was removed');continue;}
    if(['flow','ui','service','function','integration','api','data','database'].includes(block.kind)&&!bindings.length) add('unbound_block',id,'Bind implementation symbol');
    for(const binding of bindings) if(['missing','ambiguous','stale','unreadable','outside_project','line_only'].includes(binding.bindingStatus)||!binding.symbol) add('invalid_binding',id,`${binding.path}: ${binding.bindingStatus}`);
    if(!snapshot.checkpoints.some(c=>c.targetType==='block'&&c.targetId===id&&c.status==='passed'&&c.freshness?.status==='fresh')) add('verification_required',id,'Fresh direct Checkpoint required before delivery');
    if(['proposed','planned'].includes(block.deliveryState)&&bindings.some(b=>b.symbol&&!['missing','ambiguous','stale','unreadable','outside_project'].includes(b.bindingStatus))) {
      service.mutate({reason:'Source anchored; verification remains separate',operations:[{action:'update_block',id,expectedRevision:block.currentRevision,fields:{deliveryState:'implementing'}}]});
    }
  }
  if(scope.blockIds.length&&!scope.chainId&&!scope.standaloneReason) add('feature_membership_missing',taskId,'Declare a feature Chain or an explicit standalone reason');
  if(scope.chainId) {
    const chain=snapshot.chains.find(c=>c.id===scope.chainId);
    if(!chain) add('missing_chain',scope.chainId,'Declared feature Chain was removed');
    else if(!chain.inputContract?.trim() || !chain.outputContract?.trim()) add('chain_contract_missing',scope.chainId,'Describe the feature input and observable outcome');
    const nodes=snapshot.chainNodes.filter(n=>n.chainId===scope.chainId).map(n=>n.blockId);
    const edges=snapshot.chainEdges.filter(e=>e.chainId===scope.chainId);
    for(const id of scope.blockIds) if(!nodes.includes(id)) add('chain_incomplete',id,'Task Block absent from feature Chain');
    if(nodes.length>1) {
      const adjacency=new Map(nodes.map(id=>[id,new Set()]));
      for(const edge of edges) {const link=snapshot.links.find(l=>l.id===edge.linkId);if(link&&adjacency.has(link.sourceId)&&adjacency.has(link.targetId)){adjacency.get(link.sourceId).add(link.targetId);adjacency.get(link.targetId).add(link.sourceId);}}
      const visited=new Set();const queue=nodes.slice(0,1);while(queue.length){const id=queue.shift();if(visited.has(id))continue;visited.add(id);queue.push(...adjacency.get(id));}
      if(visited.size!==nodes.length) add('chain_disconnected',scope.chainId,'Declare links joining the serial/parallel feature network');
    }
  }
  transaction(service.database,()=>{
    service.database.prepare("UPDATE sync_issues SET status='resolved' WHERE task_id=?").run(taskId);
    for(const issue of issues) service.database.prepare("INSERT INTO sync_issues VALUES(?,?,?,?,?,'open',?) ON CONFLICT(id) DO UPDATE SET detail=excluded.detail,status='open',updated_at=excluded.updated_at")
      .run(hash(`${taskId}:${issue.kind}:${issue.target}`),taskId,issue.kind,issue.target,issue.detail,new Date().toISOString());
    service.database.prepare('UPDATE task_sessions SET source_revision=?,updated_at=? WHERE id=?').run(index.sourceRevision,new Date().toISOString(),taskId);
  });
  return {taskId,updatedAt:session(service,taskId).updated_at,...index,issues,status:issues.length?'needs_work':'ready',graphRevision:service.project().graph_revision};
}
export function finishTask(service,{taskId,expectedGraphRevision,sourceRevision,idempotencyKey,summary=''}={}) {
  if(!idempotencyKey)throw new Error('idempotencyKey is required');
  service.ensureSynced();const task=session(service,taskId);
  if(task.status==='complete') {
    if(task.idempotency_key!==idempotencyKey)throw new Error('Task already completed with another idempotency key');
    return {...JSON.parse(task.result_json),idempotent:true};
  }
  if(service.project().graph_revision!==expectedGraphRevision)throw new Error('Graph revision conflict; reconcile again');
  const report=reconcileTask(service,{taskId});
  if(report.sourceRevision!==sourceRevision)throw new Error('Source changed; reconcile and verify again');
  if(report.issues.length)return report;
  const needsVerification=(issue)=>{
    service.database.prepare("INSERT INTO sync_issues VALUES(?,?,?,?,?,'open',?) ON CONFLICT(id) DO UPDATE SET detail=excluded.detail,status='open',updated_at=excluded.updated_at")
      .run(hash(`${taskId}:${issue.kind}:${issue.target}`),taskId,issue.kind,issue.target,issue.detail??'Fresh Chain Checkpoint required',new Date().toISOString());
    return {...report,status:'needs_work',issues:[issue]};
  };
  const snapshot=service.snapshot();const operations=[];
  for(const id of task.scope.blockIds) {
    const block=snapshot.blocks.find(b=>b.id===id);
    const checkpoint=snapshot.checkpoints.find(c=>c.targetType==='block'&&c.targetId===id&&c.status==='passed'&&c.freshness?.status==='fresh');
    if(!checkpoint) return needsVerification({kind:'verification_required',target:id,detail:'Fresh direct Checkpoint required'});
    operations.push({action:'update_block',id,expectedRevision:block.currentRevision,fields:{deliveryState:'complete',healthState:'healthy'}});
  }
  if(task.scope.chainId) {
    const chain=snapshot.chains.find(c=>c.id===task.scope.chainId);
    const checks=snapshot.checkpoints.filter(c=>c.targetType==='chain'&&c.targetId===chain.id);
    if(checks.length&&!checks.some(c=>c.status==='passed'&&c.freshness?.status==='fresh'))return needsVerification({kind:'chain_verification_required',target:chain.id});
    operations.push({action:'update_chain',id:chain.id,expectedRevision:chain.currentRevision,fields:{deliveryState:'complete'}});
  }
  const result={taskId,status:'complete',summary,sourceRevision,changedRefs:operations.map(o=>`${o.action==='update_chain'?'chain':'block'}:${o.id}`)};
  const commitHook=()=>{
    const currentHash=hash(sourceInventory(service.paths.projectRoot).map(f=>`${f.path}:${f.hash}`).join('\n'));
    if(currentHash!==sourceRevision)throw new Error('Source changed during task finish');
    service.database.prepare("UPDATE task_sessions SET status='complete',idempotency_key=?,result_json=?,updated_at=? WHERE id=?")
      .run(idempotencyKey,JSON.stringify(result),new Date().toISOString(),taskId);
    setSyncMeta(service.database,'task_handoff',JSON.stringify({taskId,summary,nextUp:'',updatedAt:new Date().toISOString()}));
  };
  if(operations.length) result.mutation=executeMutate(service,{reason:'Atomic task completion',operations},{commitHook});
  else transaction(service.database,commitHook);
  if(result.mutation?.projection?.status==='pending') return {...result,status:'projection_pending',success:false,projection:result.mutation.projection};
  return result;
}

export function updateTaskScope(service,{taskId,expectedUpdatedAt,blockIds,chainId,standaloneReason,excludedPaths,nextAction,summary}={}) {
  service.ensureSynced();
  const db=service.database;
  return transaction(db,()=>{
    const task=session(service,taskId);
    if(task.status==='complete')throw new Error('Completed task cannot be edited');
    if(task.updated_at!==expectedUpdatedAt)throw new Error('Task revision conflict; read sync_issues/task_reconcile first');
    const scope={...task.scope};
    if(blockIds!==undefined){
      for(const id of blockIds) if(!db.prepare('SELECT id FROM blocks WHERE id=? AND project_id=?').get(id,service.paths.descriptor.id))throw new Error(`Unknown Block: ${id}`);
      scope.blockIds=blockIds;
    }
    if(chainId!==undefined){
      if(chainId&&!db.prepare('SELECT id FROM chains WHERE id=? AND project_id=?').get(chainId,service.paths.descriptor.id))throw new Error('Unknown Chain');
      scope.chainId=chainId;
    }
    if(standaloneReason!==undefined)scope.standaloneReason=standaloneReason;
    if(excludedPaths!==undefined){
      for(const item of excludedPaths)if(!item.reason?.trim()||path.isAbsolute(item.path)||item.path.split('/').includes('..'))throw new Error('Excluded paths require a project-relative path and reason');
      scope.excludedPaths=excludedPaths;
    }
    if(nextAction!==undefined)scope.nextAction=nextAction;
    if(summary!==undefined)scope.summary=summary;
    const updatedAt=new Date().toISOString();
    db.prepare('UPDATE task_sessions SET scope_json=?,updated_at=? WHERE id=?').run(JSON.stringify(scope),updatedAt,taskId);
    return {taskId,updatedAt,scope};
  });
}
