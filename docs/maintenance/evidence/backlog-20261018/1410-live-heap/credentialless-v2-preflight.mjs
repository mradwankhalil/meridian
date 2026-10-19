#!/usr/bin/env node
// Credentialless actual OpenCode V2 plugin/config/catalog preflight. No inference.
// Uses tested Meridian setup; fixture rejects all requests except GET /v1/models.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {mkdirSync,mkdtempSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
const out=process.env.E2E_PREFLIGHT_REPORT_DIR ?? '/tmp/meridian-1410-live-evidence/v2-preflight';
mkdirSync(out,{recursive:true,mode:0o700});
const repo=realpathSync(process.env.E2E_MERIDIAN_ROOT ?? '/Volumes/DevSSD/meridian/t3-worktrees/t3-8a106dbe');
const binary=realpathSync(process.env.E2E_OPENCODE_BIN ?? '/tmp/meridian-1410-opencode-2021/node_modules/.bin/opencode');
const root=realpathSync(mkdtempSync(join(tmpdir(),'meridian-1410-client-preflight-')));
for(const name of ['home','config','data','cache','state','project','meridian'])mkdirSync(join(root,name),{mode:0o700});
const model='claude-opus-5-5',display='Owned credentialless discovery '+randomUUID(),context=1000031;
const observations=[],children=[];
const report={result:'RUNNING',scope:'Credentialless actual stable client + built Meridian V2 plugin; controlled local catalog; no SDK or model inference',root,repo,binary,model,context,platform:process.platform+'/'+process.arch,node:process.version,modelCalls:0,requests:observations,children};
const server=createServer((req,res)=>{
  const path=new URL(req.url,'http://127.0.0.1').pathname;
  const row={method:req.method,path,status:0};observations.push(row);
  if(req.method==='GET'&&path==='/v1/models'){
    row.status=200;res.writeHead(200,{'content-type':'application/json'});
    res.end(JSON.stringify({data:[{id:model,object:'model',owned_by:'anthropic',display_name:display,context_window:context,capabilities:{effort:{low:{supported:true},medium:{supported:true},high:{supported:true},xhigh:{supported:true},max:{supported:true}}}}]}));return;
  }
  row.status=405;res.writeHead(405,{'content-type':'application/json'});res.end(JSON.stringify({error:'No inference or other route admitted by credentialless preflight'}));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const baseURL='http://127.0.0.1:'+server.address().port+'/v1';
const env={PATH:process.env.PATH,HOME:join(root,'home'),LANG:'en_US.UTF-8',OPENCODE_CONFIG_DIR:join(root,'config'),OPENCODE_DISABLE_AUTOUPDATE:'1',OPENCODE_SERVER_PASSWORD:'local-owned-preflight',OPENCODE_PASSWORD:'local-owned-preflight',MERIDIAN_CONFIG_DIR:join(root,'meridian'),PWD:join(root,'project'),INIT_CWD:join(root,'project')};
for(const kind of ['CONFIG','DATA','CACHE','STATE'])env['XDG_'+kind+'_HOME']=join(root,kind.toLowerCase());
writeFileSync(join(root,'config/opencode.json'),JSON.stringify({model:'anthropic/'+model,share:'disabled',providers:{anthropic:{settings:{apiKey:'local-owned-nonsecret',baseURL}}}},null,2),{mode:0o600});
let host;
async function run(command,args,label,limit=30000){
 const child=spawn(command,args,{cwd:join(root,'project'),env,stdio:['ignore','pipe','pipe']});
 const row={label,pid:child.pid,close:false,stdoutClose:false,stderrClose:false};children.push(row);
 let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);child.stdout.on('close',()=>row.stdoutClose=true);child.stderr.on('close',()=>row.stderrClose=true);
 const timer=setTimeout(()=>child.kill('SIGKILL'),limit);
 const [code,signal]=await once(child,'close').finally(()=>clearTimeout(timer));Object.assign(row,{close:true,code,signal});
 writeFileSync(join(out,label+'.stdout'),stdout,{mode:0o600});writeFileSync(join(out,label+'.stderr'),stderr,{mode:0o600});
 assert.equal(code,0,label+' failed');assert.equal(signal,null);return stdout;
}
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
try{
 report.client=(await run(binary,['--version'],'version')).trim();assert.equal(report.client,'opencode v2.0.21');
 await run(process.execPath,[join(repo,'dist/cli.js'),'setup','--v2','--opencode-bin',binary],'setup');
 const configured=JSON.parse(readFileSync(join(root,'config/opencode.json'),'utf8'));
 const plugin=realpathSync(join(repo,'dist/meridian-v2'));
 const resolvePlugin=p=>realpathSync(p.startsWith('file:')?new URL(p):p);
 assert.deepEqual(configured.plugins.map(resolvePlugin),[plugin]);assert.equal(configured.providers.anthropic.settings.baseURL,baseURL);assert(!configured.plugin);
 report.plugin={path:plugin,entrySha256:hash(join(plugin,'index.js')),manifest:JSON.parse(readFileSync(join(plugin,'package.json'),'utf8')),owner:JSON.parse(readFileSync(join(repo,'package.json'),'utf8')).name,ownerVersion:JSON.parse(readFileSync(join(repo,'package.json'),'utf8')).version,effectiveEntries:1,setupExit:0};
 report.config={generation:'v2',field:'plugins',exactlyOne:true,providerBaseURL:baseURL,model:'anthropic/'+model,hardcodedModelWindow:false,isolatedHome:true,isolatedXdg:true};
 writeFileSync(join(out,'configured-summary.json'),JSON.stringify({plugin:report.plugin,config:report.config},null,2)+'\n',{mode:0o600});
 // Debug config starts a persistent background service on stable 2.0.21.
 // Configuration is checked through setup output and the owned API catalog.
 const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
 host=spawn(binary,['serve','--hostname','127.0.0.1','--port',String(port),'--print-logs','--log-level','debug'],{cwd:join(root,'project'),env,stdio:['ignore','pipe','pipe']});
 const hostRow={label:'actual-client-api',pid:host.pid,close:false,stdoutClose:false,stderrClose:false};children.push(hostRow);
 let stdout='',stderr='';host.stdout.on('data',c=>stdout+=c);host.stderr.on('data',c=>stderr+=c);host.stdout.once('close',()=>hostRow.stdoutClose=true);host.stderr.once('close',()=>hostRow.stderrClose=true);host.once('close',(code,signal)=>Object.assign(hostRow,{close:true,code,signal}));
 const auth='Basic '+Buffer.from('opencode:local-owned-preflight').toString('base64');
 let catalog,selected;
 for(let attempt=0;attempt<100;attempt++){
   if(host.exitCode!==null)throw Error('OpenCode API exited before catalog discovery');
   try{
    const response=await fetch('http://127.0.0.1:'+port+'/api/model',{headers:{authorization:auth},signal:AbortSignal.timeout(1000)});
    if(response.ok){catalog=await response.json();selected=catalog.data?.find(row=>row.providerID==='anthropic'&&row.id===model);if(selected?.name===display&&selected?.limit?.context===context)break;}
   }catch{}
   await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert(selected,'Actual client did not expose selected model');assert.equal(selected.name,display);assert.equal(selected.limit.context,context);assert(selected.variants.some(v=>v.id==='xhigh'));
 assert(observations.some(row=>row.method==='GET'&&row.path==='/v1/models'&&row.status===200));assert(observations.every(row=>row.method==='GET'&&row.path==='/v1/models'),'Unexpected request attempted');
 report.catalogAdoption={providerID:selected.providerID,id:selected.id,name:selected.name,context:selected.limit.context,variants:selected.variants.map(v=>v.id)};
 writeFileSync(join(out,'catalog-adoption.json'),JSON.stringify(report.catalogAdoption,null,2)+'\n',{mode:0o600});
 report.loadWitness={beforeInference:true,kind:'Actual OpenCode API catalog adopted uniquely named model and window from plugin-issued GET /v1/models',fixtureOnly:true};
 writeFileSync(join(out,'client-api.stdout'),stdout,{mode:0o600});writeFileSync(join(out,'client-api.stderr'),stderr,{mode:0o600});
 report.result='PASS';
}catch(error){report.result='FAIL';report.failure=String(error);}
finally{
 if(host&&host.exitCode===null){host.kill('SIGTERM');const timer=setTimeout(()=>host.kill('SIGKILL'),5000);await once(host,'close').finally(()=>clearTimeout(timer));}
 server.closeAllConnections();await new Promise(resolve=>server.close(resolve));report.joined=children.every(c=>c.close&&c.stdoutClose&&c.stderrClose);if(!report.joined)report.result='FAIL';
 writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({result:report.result,report:join(out,'report.json'),root,joined:report.joined,failure:report.failure}));process.exitCode=report.result==='PASS'?0:1;
}

