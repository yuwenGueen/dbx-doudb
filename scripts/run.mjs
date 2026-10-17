import {spawn} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const root=fileURLToPath(new URL('..',import.meta.url));
const command=process.argv[2];
const env={...process.env,GOCACHE:process.env.GOCACHE||join(root,'.cache/go-build'),GOMODCACHE:process.env.GOMODCACHE||join(root,'.cache/go-mod')};
const run=(args)=>new Promise((resolve,reject)=>{const child=spawn('go',args,{cwd:join(root,'backend'),env,stdio:'inherit'});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`go ${args[0]} exited ${code}`)));});
try{if(command==='test')await run(['test','-race','./...']);else if(command==='build'){mkdirSync(join(root,'bin'),{recursive:true});await run(['build','-trimpath','-ldflags=-s -w','-o',join(root,'bin',process.platform==='win32'?'doudb.exe':'doudb'),'.']);}else if(command==='dev'){await run(['run','.','--preview',`127.0.0.1:${process.env.DOUDB_PORT||5190}`,'--ui',join(root,'ui'),'--data',join(root,'.dbx-dev/preview')]);}else throw new Error('Use dev, build, or test');}catch(error){console.error(error.message);process.exitCode=1;}
