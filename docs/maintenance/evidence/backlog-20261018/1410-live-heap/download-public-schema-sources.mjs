#!/usr/bin/env node
// Public pinned source download only. No client config, credentials, models, or inference.
import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const dir=join(dirname(fileURLToPath(import.meta.url)),'public-schema-sources');
const opencode='aec0b9a6d8898f68f923aaf08b7306d931fd9d76';
const github='e3809fe91c7546633241006bf0b91f23b2595e28';
mkdirSync(join(dir,'github-mcp'),{recursive:true});
async function save(url,path){const response=await fetch(url);if(!response.ok)throw new Error(`${response.status} ${url}`);writeFileSync(path,Buffer.from(await response.arrayBuffer()));}
const tools=['apply_patch','edit','glob','grep','lsp','skill','webfetch','websearch','write','read','task'];
for(const name of [...tools,'json-schema']){
 await save(`https://raw.githubusercontent.com/anomalyco/opencode/${opencode}/packages/opencode/src/tool/${name}.ts`,join(dir,`opencode-${name}.ts`));
 if(name!=='json-schema')await save(`https://raw.githubusercontent.com/anomalyco/opencode/${opencode}/packages/opencode/src/tool/${name}.txt`,join(dir,`opencode-${name}.txt`));
}
await save(`https://raw.githubusercontent.com/anomalyco/opencode/${opencode}/package.json`,join(dir,'opencode-package.json'));
await save(`https://raw.githubusercontent.com/anomalyco/opencode/${opencode}/packages/schema/src/schema.ts`,join(dir,'opencode-shared-schema.ts'));
const response=await fetch(`https://api.github.com/repos/github/github-mcp-server/contents/pkg/github/__toolsnaps__?ref=${github}`);
if(!response.ok)throw new Error(`GitHub public listing ${response.status}`);
const listing=await response.json();writeFileSync(join(dir,'github-mcp','listing.json'),JSON.stringify(listing,null,2)+'\n');
for(const item of listing.filter(x=>x.name.endsWith('.snap')))await save(`https://raw.githubusercontent.com/github/github-mcp-server/${github}/pkg/github/__toolsnaps__/${item.name}`,join(dir,'github-mcp',item.name));
await save(`https://raw.githubusercontent.com/anomalyco/opencode/${opencode}/LICENSE`,join(dir,'LICENSE-opencode.txt'));
await save(`https://raw.githubusercontent.com/github/github-mcp-server/${github}/LICENSE`,join(dir,'LICENSE-github-mcp-server.txt'));
console.log(JSON.stringify({opencode,github,snapshots:listing.filter(x=>x.name.endsWith('.snap')).length}));
