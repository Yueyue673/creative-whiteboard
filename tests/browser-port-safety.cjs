const assert=require('node:assert/strict'),net=require('node:net');
const modulePath=require.resolve('./browser-port.cjs'),originalCreate=net.createServer;
async function withPorts(ports,check){
 let requested=0,closed=0;
 net.createServer=()=>{const port=ports[Math.min(requested++,ports.length-1)];return{once(){return this},listen(_port,host,ready){assert.equal(host,'127.0.0.1');queueMicrotask(ready)},address(){return{port}},close(done){closed++;queueMicrotask(()=>done())}}};
 delete require.cache[modulePath];
 try{await check(require(modulePath),()=>({requested,closed}))}
 finally{net.createServer=originalCreate;delete require.cache[modulePath]}
}
(async()=>{
 await withPorts([4190,6679,54321],async(choose,counts)=>{assert.equal(await choose(),54321,'Listening successfully does not make a Fetch-forbidden port usable for health checks');assert.deepEqual(counts(),{requested:3,closed:3})});
 await withPorts([4191],async(choose,counts)=>{assert.equal(await choose(),4191,'Keep ordinary ports available');assert.deepEqual(counts(),{requested:1,closed:1})});
 await withPorts([4190],async(choose,counts)=>{await assert.rejects(choose(),/Could not allocate/);assert.equal(counts().requested,counts().closed);assert(counts().requested<=64,'Repeated forbidden assignments must stop without leaking listeners')});
 console.log('Browser test ports: Fetch-forbidden assignments skipped, ordinary ports retained and repeated assignments bounded with listeners closed');
})().catch(error=>{console.error(error);process.exitCode=1});
