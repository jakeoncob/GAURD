import test from 'node:test';
import assert from 'node:assert/strict';
import {invocationSchema,driverMessageSchema,sessionOptionsSchema} from '../scripts/connector-preview/protocol.mjs';

test('preview invocation and result envelopes retain arbitrary JSON records after the schema update',()=>{
 const call={connectorId:'example',actionName:'read',arguments:{query:'city',options:{limit:3},filters:['a','b']}};
 assert.deepEqual(invocationSchema.parse(call),call);
 assert.equal(invocationSchema.safeParse({...call,accountId:'unapproved'}).success,false);
 assert.equal(invocationSchema.safeParse({...call,arguments:[]}).success,false);
 const result={jsonrpc:'2.0',id:'a579583b-9c17-40a5-9eca-3ef9b5d94576',result:{content:[],structuredContent:{count:1}}};
 assert.deepEqual(driverMessageSchema.parse(result),result);
 assert.equal(sessionOptionsSchema.parse({}).timeoutMs,120000);
 assert.equal(sessionOptionsSchema.safeParse({maxConcurrent:-1}).success,false);
});
