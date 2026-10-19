#!/usr/bin/env node
// Offline, deterministic generation from pinned public schema sources escrowed beside this file.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const outdir = path.dirname(fileURLToPath(import.meta.url));
const moduleRoot = process.argv[2] || process.cwd();
const fixturePrefix = process.argv[3] || 'client-derived-230-tools';
const require = createRequire(path.join(path.resolve(moduleRoot), 'package.json'));
const ts = require('typescript');
const effect = require('effect');
const { Schema } = effect;
const sourceDir = path.join(outdir, 'public-schema-sources');
const opencodeSha = 'aec0b9a6d8898f68f923aaf08b7306d931fd9d76';
const githubSha = 'e3809fe91c7546633241006bf0b91f23b2595e28';
const digest = text => crypto.createHash('sha256').update(text).digest('hex');
function evaluate(source, extras = {}) {
  const exports = {};
  const context = vm.createContext({ exports, require: name => {
    if (name === 'effect') return effect;
    if (name === './json-schema') return exports;
    throw new Error(`Unexpected public source dependency: ${name}`);
  }, Schema, Effect: effect.Effect, ...extras });
  const js = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInContext(js, context, {timeout:1000});
  return exports;
}
const converter = evaluate(fs.readFileSync(path.join(sourceDir, 'opencode-json-schema.ts'), 'utf8'));
const nativeNames = ['apply_patch','edit','glob','grep','lsp','skill','webfetch','websearch','write','read','task'];
const native = [];
const provenance = [];
for (const name of nativeNames) {
  const filename = `opencode-${name}.ts`;
  const source = fs.readFileSync(path.join(sourceDir, filename), 'utf8');
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names = new Set(name === 'task' ? ['BaseParameterFields','BaseParameters'] : name === 'lsp' ? ['operations','Parameters'] : ['Parameters']);
  const selected = [];
  for (const statement of ast.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const decl of statement.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && names.has(decl.name.text)) selected.push(`export const ${decl.getText(ast)};`);
    }
  }
  if (selected.length !== names.size) throw new Error(`Missing declarations for ${name}`);
  const values = evaluate(selected.join('\n'), {NonNegativeInt:Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))});
  const input_schema = converter.fromSchema(values[name === 'task' ? 'BaseParameters' : 'Parameters']);
  const description = fs.readFileSync(path.join(sourceDir, `opencode-${name}.txt`), 'utf8');
  native.push({name,description,input_schema});
  provenance.push({fixtureName:name,sourceKind:'OpenCode native tool',sourceName:name,sourceUrl:`https://github.com/anomalyco/opencode/blob/${opencodeSha}/packages/opencode/src/tool/${name}.ts`,sourceSha256:digest(source),descriptionTemplate:true,conversion:'Extract only public Parameters expression (BaseParameters for default task mode); evaluate real Effect Schema; use unmodified public ToolJsonSchema.fromSchema converter.',...(name==='read'?{dependency:'NonNegativeInt copied exactly from packages/schema/src/schema.ts at same commit'}:{}),...(name==='task'?{mode:'Default foreground, experimental background disabled'}:{})});
}
const snapshots = fs.readdirSync(path.join(sourceDir,'github-mcp')).filter(n=>n.endsWith('.snap')).sort();
const candidates = snapshots.map(filename=>{
 const source=fs.readFileSync(path.join(sourceDir,'github-mcp',filename),'utf8');
 const tool=JSON.parse(source);
 if(!tool.name || !tool.inputSchema || !tool.description) return null;
 return {filename,source,tool};
}).filter(Boolean);
const seedMap = new Map();
for (const seed of candidates) {
 if (!seedMap.has(seed.tool.name) || seed.filename === `${seed.tool.name}.snap`) seedMap.set(seed.tool.name,seed);
}
const seeds = [...seedMap.values()].sort((a,b)=>a.tool.name.localeCompare(b.tool.name,'en'));
const result = [...native];
function append(seed, server) {
 const name=`mcp__github_${server}__${seed.tool.name}`;
 result.push({name,description:seed.tool.description,input_schema:seed.tool.inputSchema});
 provenance.push({fixtureName:name,sourceKind:'GitHub MCP committed tool snapshot',sourceName:seed.tool.name,serverAlias:server,sourceUrl:`https://github.com/github/github-mcp-server/blob/${githubSha}/pkg/github/__toolsnaps__/${seed.filename}`,sourceSha256:digest(seed.source),conversion:'Preserve exact parsed inputSchema and description; namespace tool name as an explicit constructed MCP server alias. Discard outputSchema/annotations because Anthropic tools carry input schemas.'});
}
for(const seed of seeds) append(seed,'primary');
for(const seed of seeds.slice(0,230-result.length)) append(seed,'secondary');
if(result.length!==230 || new Set(result.map(t=>t.name)).size!==230) throw new Error('Roster size/name mismatch');
const schemaCounts = {objects:0,arrays:0,enums:0,anyOf:0,oneOf:0,allOf:0,refs:0,properties:0,maxObjectDepth:0};
function walk(x,depth=0) {
 if(!x||typeof x!=='object')return;
 if(Array.isArray(x)) {for(const y of x)walk(y,depth);return;}
 let next=depth;
 if(x.type==='object'||x.properties){schemaCounts.objects++;next++;schemaCounts.maxObjectDepth=Math.max(schemaCounts.maxObjectDepth,next);}
 if(x.type==='array'||x.items)schemaCounts.arrays++;
 if(x.enum)schemaCounts.enums++;
 for(const keyword of ['anyOf','oneOf','allOf'])if(x[keyword])schemaCounts[keyword]++;
 if(x.$ref)schemaCounts.refs++;
 if(x.properties)schemaCounts.properties+=Object.keys(x.properties).length;
 for(const y of Object.values(x))walk(y,next);
}
for(const tool of result)walk(tool.input_schema);
const json=JSON.stringify(result,null,2)+'\n';
fs.writeFileSync(path.join(outdir,`${fixturePrefix}.json`),json);
const metadata={format:'Anthropic tools[]: {name,description,input_schema}',fixtureSha256:digest(json),toolCount:result.length,nativeToolCount:native.length,githubSourceToolCount:seeds.length,githubSecondaryAliases:230-native.length-seeds.length,uniqueInputSchemas:new Set(result.map(t=>JSON.stringify(t.input_schema))).size,inputSchemaBytes:Buffer.byteLength(JSON.stringify(result.map(t=>t.input_schema))),fixtureBytes:Buffer.byteLength(json),schemaCounts,runtime:{node:process.version,typescript:require('typescript/package.json').version,effect:require('effect/package.json').version},sources:{opencode:{version:'1.18.34',commit:opencodeSha},githubMcpServer:{commit:githubSha}},limitations:['Constructed realistic client-consumable catalog; not a captured reporter catalog or proof of any installed client/server configuration.',`Eleven selected public native OpenCode tools plus all ${seeds.length} unique-named GitHub MCP committed tool snapshots at pinned revision, and ${230-native.length-seeds.length} explicit second-instance aliases; aliases have identical schemas/descriptions to their source tools.`,`Source snapshot directory may contain deprecated/conditional tools, so the ${seeds.length}-source set is a schema workload rather than a claim that one default GitHub MCP server advertises all ${seeds.length} simultaneously.`,'Duplicate-named variant snapshots are deduplicated, preferring the canonical <tool-name>.snap file; output-only snapshots are excluded.',
'OpenCode native descriptions are public source templates, without expanding installed agent or skill metadata.','No model calls, credentials, user configuration, SDK transcripts, or client requests were read.'],tools:provenance};
fs.writeFileSync(path.join(outdir,`${fixturePrefix}.provenance.json`),JSON.stringify(metadata,null,2)+'\n');
console.log(JSON.stringify({...metadata,tools:undefined},null,2));
